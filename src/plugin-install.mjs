import { execFile } from 'node:child_process';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PLUGIN_NAME, MARKETPLACE_NAME, PLUGIN_PREFIX, sha256, verifyRelease } from './plugin-release.mjs';
import { validatePluginRoot } from './plugin-readiness.mjs';

const exec = promisify(execFile);
export const execute = async (file, args) => {
  try {
    const result = await exec(file, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return result.stdout;
  } catch (error) {
    throw new Error(`执行失败：${file} ${args.join(' ')}\n${error.stderr || error.message}\n未自动卸载或修改信任；处理原因后可重试。`);
  }
};

async function checkInstalledFiles(release, pluginRoot) {
  const root = await realpath(pluginRoot);
  for (const [path, digest] of Object.entries(release.files)) {
    if (!path.startsWith(PLUGIN_PREFIX)) continue;
    const target = join(root, path.slice(PLUGIN_PREFIX.length));
    const info = await lstat(target);
    const canonical = await realpath(target);
    if (!info.isFile() || !canonical.startsWith(`${root}/`) && !canonical.startsWith(`${root}\\`)
      || sha256(await readFile(target)) !== digest) throw new Error(`已安装副本与发布包不一致：${path}`);
  }
  const readiness = await validatePluginRoot(root);
  if (!readiness.ok) throw new Error(readiness.failures.join('\n'));
  return root;
}

async function installedRootFor(release, record, configHome) {
  // Codex versions use either the manifest version or "local" for local plugin caches.
  for (const version of [record.version, 'local'].filter(Boolean)) {
    if (!/^[a-zA-Z0-9.+_-]+$/.test(version)) throw new Error('Codex 返回了无效的插件版本');
    const candidate = join(configHome, 'plugins', 'cache', MARKETPLACE_NAME, PLUGIN_NAME, version);
    try { await access(candidate); } catch { continue; }
    return checkInstalledFiles(release, candidate);
  }
  throw new Error('Codex 报告已安装，但未找到可校验的安装副本；请检查 Codex 版本和安装结果。');
}

export async function installPlugin({ bundleRoot, apply = false, upgrade = false, codex = 'codex',
  run = execute, configHome = process.env.CODEX_HOME || join(homedir(), '.codex') }) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || major === 20 && minor < 11) throw new Error('需要 Node.js 20.11 或更高版本');
  if (/\.(cmd|bat)$/i.test(codex)) throw new Error('请通过 --codex 提供 Codex 原生可执行文件，而不是 .cmd/.bat 启动器');
  const root = await realpath(bundleRoot);
  const release = await verifyRelease(root);
  const sourceRoot = join(root, PLUGIN_PREFIX);
  const ready = await validatePluginRoot(sourceRoot);
  if (!ready.ok) throw new Error(ready.failures.join('\n'));
  // Actual imports catch missing production dependencies; this doesn't launch a server.
  await run(process.execPath, [join(sourceRoot, 'cli.mjs'), '--help']);
  for (const args of [['plugin', 'add', '--help'], ['plugin', 'marketplace', 'add', '--help']]) await run(codex, args);
  const parse = async args => {
    try { return JSON.parse(await run(codex, args)); }
    catch (error) { throw new Error(`无法读取 Codex 安装状态：${error.message}`); }
  };
  const listArgs = ['plugin', 'list', '--json'];
  const listed = await parse(listArgs);
  const markets = await parse(['plugin', 'marketplace', 'list', '--json']);
  if (!Array.isArray(listed.installed) || !Array.isArray(markets.marketplaces)) throw new Error('Codex 返回的安装状态格式不受支持');
  const existing = listed.installed.filter(p => p.name === PLUGIN_NAME && p.installed);
  if (existing.some(p => p.marketplaceName !== MARKETPLACE_NAME) || existing.length > 1) {
    throw new Error('其他来源已安装同名插件。请让用户选择保留或迁移；不会自动卸载或安装第二份。');
  }
  const record = existing[0];
  if (record && record.enabled !== true) throw new Error('已有插件被禁用；请由用户明确启用后重试，不自动改变禁用决定。');
  const marketplace = markets.marketplaces.find(m => m.name === MARKETPLACE_NAME);
  if (marketplace) {
    let same = false;
    try { same = await realpath(marketplace.root) === root; } catch { /* Preserve stale registration for user review. */ }
    if (!same) throw new Error('同名安装来源已指向其他目录。请保留原目录，或经用户授权用官方命令移除该来源后重试；不会自动重定向。');
  }
  if (record?.version === release.version) {
    const pluginRoot = await installedRootFor(release, record, configHome);
    return { status: 'already-installed', version: release.version, pluginRoot, sessionVerification: 'pending' };
  }
  if (record && !upgrade) throw new Error(`已安装 ${record.version}，发布包为 ${release.version}。版本变更需要用户明确同意后使用 --upgrade。`);
  const plan = { status: 'checked', version: release.version, bundleRoot: root,
    writes: ['通过 Codex 注册本安装来源', '通过 Codex 安装插件'],
    sessionVerification: 'pending' };
  if (!apply) return plan;
  // No shell, config-file editing, cache copying, hook trusting, or automatic removal.
  if (!marketplace) await run(codex, ['plugin', 'marketplace', 'add', root, '--json']);
  await run(codex, ['plugin', 'add', `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, '--json']);
  const result = await parse(listArgs);
  const installed = result.installed?.find(p => p.pluginId === `${PLUGIN_NAME}@${MARKETPLACE_NAME}` && p.installed && p.enabled);
  if (!installed || installed.version !== release.version) throw new Error('安装命令已执行，但 Codex 未报告正确版本已启用。请保留错误现场检查，不要重复宣称成功。');
  const pluginRoot = await installedRootFor(release, installed, configHome);
  await run(process.execPath, [join(pluginRoot, 'cli.mjs'), '--help']);
  return { status: 'installed', version: release.version, pluginRoot, sessionVerification: 'pending' };
}

export async function main(bundleRoot, args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    process.stdout.write('用法：node install.mjs [--check | --install] [--upgrade] [--codex <原生可执行文件路径>]\n默认只检查。--install 会让 Codex 写入插件配置与缓存；不会信任 Hook 或修改项目。\n');
    return;
  }
  const options = { bundleRoot };
  let mode = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--install' || arg === '--check') {
      if (mode) throw new Error('只能选择一个检查或安装模式');
      mode = arg; options.apply = arg === '--install';
    } else if (arg === '--upgrade') options.upgrade = true;
    else if (arg === '--codex' && args[i + 1] && !args[i + 1].startsWith('--')) options.codex = args[++i];
    else throw new Error(`未知参数或缺少值：${arg}`);
  }
  const result = await installPlugin(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write('下一步：用户审阅并信任插件启动脚本，再新建 Codex 任务验证 Skill、MCP 和目标项目工作台；安装结果不代表这些步骤已完成。\n');
}
