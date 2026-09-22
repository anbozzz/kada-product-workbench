#!/usr/bin/env node
// Opt-in real-CLI test. Only child processes receive the isolated CODEX_HOME.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../src/plugin-release.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const bundle = process.argv[2];
const codex = process.argv[3] || 'codex';
if (!bundle) throw new Error('用法：node scripts/verify-plugin-install.mjs <解压包> [Codex原生路径]');
const temp = await mkdtemp(join(tmpdir(), 'ips-real-install-'));
const configHome = join(temp, '隔离 Codex');
const moved = join(temp, '移动后的 安装包');
await mkdir(configHome);
await cp(resolve(bundle), moved, { recursive: true });
const env = { ...process.env, CODEX_HOME: configHome, IPS_HOME: join(temp, 'tool-state') };
const install = async mode => {
  const { stdout } = await exec(process.execPath, [join(moved, 'install.mjs'), mode, '--codex', codex], { env, cwd: temp, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
  const result = JSON.parse(stdout.slice(0, stdout.indexOf('\n下一步：')));
  console.log(`安装阶段：${result.status}`);
  return result;
};
const checked = await install('--check');
assert.equal(checked.status, 'checked');
const installed = await install('--install');
assert.equal(installed.status, 'installed');
assert.equal((await install('--install')).status, 'already-installed');

// Launch the real installed CLI with an unrelated explicit Project, never the source checkout.
const project = join(temp, '目标 项目');
await mkdir(project);
for (const name of ['index.html', 'product.spec.json', 'task-board.spec.md', 'spec-map.json']) {
  await cp(join(root, 'examples/task-board', name), join(project, name));
}
const before = await Promise.all(['index.html', 'task-board.spec.md', 'spec-map.json'].map(async name => [name, sha256(await readFile(join(project, name)))]));
const child = spawn(process.execPath, [join(installed.pluginRoot, 'cli.mjs'), project, '--port', '0', '--state', join(temp, 'projects.json')], { env, cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
child.stderr.on('data', chunk => { diagnostics += chunk; });
try {
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`工作台启动超时：${diagnostics}`)), 20_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`工作台退出：${code} ${diagnostics}`)); });
    child.stdout.on('data', chunk => {
      diagnostics += chunk;
      const match = diagnostics.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) { clearTimeout(timer); resolveUrl(match[0]); }
    });
  });
  const config = await (await fetch(`${url}api/config`)).json();
  assert.ok(config.productSpec, '应从目标项目加载既有 Spec');
  const html = await (await fetch(url)).text();
  assert.match(html, /<title>咔哒 · 产品工作台<\/title>/);
  const resource = html.match(/src="(\/studio-assets\/[^"]+)"/);
  assert.ok(resource, '应提供工作台构建资源');
  assert.equal((await fetch(new URL(resource[1], url))).status, 200);
  for (const [name, digest] of before) assert.equal(sha256(await readFile(join(project, name))), digest);
  // The ordinary browser suite verifies the complete original workflow separately.
  console.log(`安装副本工作台启动成功，目标 Project 已加载且未改写：${url}`);
  await writeFile(join(temp, 'verification.json'), JSON.stringify({ installed, project, checks: ['checked', 'installed', 'already-installed', 'installed-cli-project-start', 'assets', 'unchanged-project'], userSession: 'pending', platform: process.platform }, null, 2));
} finally {
  child.kill('SIGTERM');
}

// Verify the installed MCP can actually announce the delivery tool, without reporting any HTML.
const server = spawn(process.execPath, [join(installed.pluginRoot, 'src/html-delivery-mcp.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
try {
  const tools = await new Promise((resolveTools, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('安装副本 MCP 握手超时')), 10_000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        if (message.id === 1) server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
        if (message.id === 2) { clearTimeout(timer); resolveTools(message.result.tools); }
      }
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'install-verifier', version: '1.0.0' } } })}\n`);
  });
  assert.ok(tools.some(tool => tool.name === 'publish_html_ready'));
  const hookPending = exec(process.execPath, [join(installed.pluginRoot, 'src/html-delivery-session.mjs')], { env, timeout: 10_000 });
  hookPending.child.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart' }));
  const hook = await hookPending;
  assert.match(hook.stdout, /publish_html_ready/);
  const { validatePluginRoot } = await import(pathToFileURL(join(installed.pluginRoot, 'src/plugin-readiness.mjs')));
  assert.equal((await validatePluginRoot(installed.pluginRoot)).ok, true);
} finally {
  server.kill('SIGTERM');
}
console.log(`真实安装验证通过；未修改正常用户配置。隔离证据：${temp}\n仍需用户确认 Hook 信任并在新任务验收；Windows 需实机验证。`);
