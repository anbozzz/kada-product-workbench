import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PLUGIN_SKILLS, validatePluginRoot } from '../src/plugin-readiness.mjs';
import { createSkillFixtures } from './helpers/plugin-fixture.mjs';

const root = resolve(import.meta.dirname, '..');

const packagePlugin = async output => {
  const skillsRoot = await createSkillFixtures(`${output}-inputs`);
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/build-plugin-bundle.mjs'), '--output', output, '--skills-root', skillsRoot], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('exit', code => resolveRun({ code, stdout, stderr }));
  });
};

test('插件 bundle 提供全部产品 Skill 与所需资源，缺少依赖时拒绝就绪', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ips-plugin-bundle-'));
  const output = join(parent, 'marketplace');
  const packaged = await packagePlugin(output);
  assert.equal(packaged.code, 0, packaged.stderr);
  const pluginRoot = join(output, 'plugins', 'interactive-product-spec');
  const result = await validatePluginRoot(pluginRoot);
  assert.deepEqual(result, { ok: true, failures: [] });
  await assert.rejects(access(join(pluginRoot, 'skills/interactive-product-spec/SKILL.md')), { code: 'ENOENT' });
  const { generateProjectionWithCodex } = await import(pathToFileURL(join(pluginRoot, 'src/codex-projection.mjs')));
  let conversionInput;
  await generateProjectionWithCodex({
    projectPath: parent, sourceSpecPath: join(parent, 'external.spec.md'), outputSchema: {},
    clientFactory: () => ({
      async start() {}, close() {},
      async request(method, params) {
        if (method === 'thread/start') return { thread: { id: 'portable-projection' } };
        if (method === 'turn/start') { conversionInput = params; return { turn: { id: 'turn' } }; }
        return {};
      },
      async waitForTurn() { return { status: 'completed', items: [{ type: 'agentMessage', text: '{}' }] }; },
    }),
  });
  const invocation = conversionInput.input.find(item => item.type === 'skill');
  assert.equal(invocation.name, 'product-documentation');
  assert.equal(await realpath(invocation.path), await realpath(join(pluginRoot, 'skills/product-documentation/SKILL.md')));
  assert.deepEqual(conversionInput.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  const specMethod = join(pluginRoot, 'skills/product-documentation/references/product-spec.md');
  await rename(specMethod, `${specMethod}.missing`);
  assert.equal((await validatePluginRoot(pluginRoot)).ok, false, '文档入口存在但 Spec 方法缺失必须拒绝安装');
  await rename(`${specMethod}.missing`, specMethod);


  const [manifest, hooks, mcp] = await Promise.all([
    readFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8').then(JSON.parse),
    readFile(join(pluginRoot, 'hooks', 'hooks.json'), 'utf8').then(JSON.parse),
    readFile(join(pluginRoot, '.mcp.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(manifest.version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.equal(manifest.hooks, undefined, '使用 Codex 默认 hooks/hooks.json，兼容插件 manifest 校验');
  assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart']);
  assert.equal(hooks.hooks.Stop, undefined);
  assert.equal(hooks.hooks.UserPromptSubmit, undefined);
  assert.deepEqual(mcp.mcpServers['html-delivery'].args, ['./src/html-delivery-mcp.mjs']);
  assert.equal(mcp.mcpServers['html-delivery'].cwd, '.');
  delete mcp.mcpServers['html-delivery'].cwd;
  await writeFile(join(pluginRoot, '.mcp.json'), JSON.stringify(mcp));
  assert.match((await validatePluginRoot(pluginRoot)).failures.join('\n'), /插件根目录/);
  mcp.mcpServers['html-delivery'].cwd = '.';
  await writeFile(join(pluginRoot, '.mcp.json'), JSON.stringify(mcp));
  for (const name of PLUGIN_SKILLS) assert.match(await readFile(join(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8'), new RegExp(`name: ["']?${name}`));
  const mobileAsset = join(pluginRoot, 'skills/ant-design-html/assets/app/App.jsx');
  await rename(mobileAsset, `${mobileAsset}.missing`);
  const missingMobileAsset = await validatePluginRoot(pluginRoot);
  assert.equal(missingMobileAsset.ok, false, '只有 Skill 说明但缺少可运行资源不能通过');
  assert.match(missingMobileAsset.failures.join('\n'), /ant-design-html/);
  await rename(`${mobileAsset}.missing`, mobileAsset);
  assert.match(await readFile(join(pluginRoot, 'skills/prd-concise-cn/SKILL.md'), 'utf8'), /name: prd-concise-cn/);
  await rename(join(pluginRoot, 'skills/prd-concise-cn/SKILL.md'), join(pluginRoot, 'skills/prd-concise-cn/SKILL.backup.md'));
  const missingCompression = await validatePluginRoot(pluginRoot);
  assert.equal(missingCompression.ok, false);
  assert.match(missingCompression.failures.join('\n'), /prd-concise-cn/);
  await rename(join(pluginRoot, 'skills/prd-concise-cn/SKILL.backup.md'), join(pluginRoot, 'skills/prd-concise-cn/SKILL.md'));
  assert.match(await readFile(join(pluginRoot, 'skills/software-architecture-design/SKILL.md'), 'utf8'), /name: software-architecture-design/);
  await rename(join(pluginRoot, 'skills/software-architecture-design/SKILL.md'), join(pluginRoot, 'skills/software-architecture-design/SKILL.backup.md'));
  const missingArchitecture = await validatePluginRoot(pluginRoot);
  assert.equal(missingArchitecture.ok, false);
  assert.match(missingArchitecture.failures.join('\n'), /software-architecture-design/);
});

test('插件就绪检查拒绝重新加入 Stop 或 UserPromptSubmit', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ips-plugin-invalid-'));
  const output = join(parent, 'marketplace');
  const packaged = await packagePlugin(output);
  assert.equal(packaged.code, 0, packaged.stderr);
  const pluginRoot = join(output, 'plugins', 'interactive-product-spec');
  const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
  const hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
  hooks.hooks.Stop = [{ hooks: [{ type: 'mcp_tool', server: 'html-delivery', tool: 'publish_html_ready' }] }];
  await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');

  const result = await validatePluginRoot(pluginRoot);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /不得保留 Stop/);
  assert.match(result.failures.join('\n'), /只允许 SessionStart/);
});
