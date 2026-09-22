#!/usr/bin/env node
import { access, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PLUGIN_SKILLS, SHARED_PLUGIN_SKILLS, BUNDLED_PLUGIN_SKILLS, validatePluginRoot, sessionCommand, sessionCommandWindows } from '../src/plugin-readiness.mjs';
import { readSkillSnapshot, validateSkillReferences, verifySkillSnapshot } from '../src/plugin-skill-snapshot.mjs';
import { inventory, MARKETPLACE_NAME } from '../src/plugin-release.mjs';

const appRoot = resolve(import.meta.dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const outputRoot = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] || '' : '');
const skillsIndex = process.argv.indexOf('--skills-root');
const skillsRoot = skillsIndex >= 0 && process.argv[skillsIndex + 1] ? resolve(process.argv[skillsIndex + 1]) : resolve(appRoot, 'plugin-skills');
const pluginName = 'interactive-product-spec';

if (outputIndex < 0 || !process.argv[outputIndex + 1] || (skillsIndex >= 0 && (!process.argv[skillsIndex + 1] || process.argv[skillsIndex + 1].startsWith('--')))) {
  process.stderr.write('用法：npm run package:plugin -- --output <空目录> [--skills-root <显式兼容输入>]\n默认使用仓库 plugin-skills 中的完整发行快照，无需开发 Workspace。\n');
  process.exit(1);
}

if (skillsIndex < 0) await verifySkillSnapshot(skillsRoot);
else await validateSkillReferences(skillsRoot, await readSkillSnapshot(skillsRoot));
for (const name of SHARED_PLUGIN_SKILLS) await access(resolve(skillsRoot, name, 'SKILL.md'));
for (const name of BUNDLED_PLUGIN_SKILLS) await access(resolve(appRoot, 'plugin-skills', name, 'SKILL.md'));

const ensureEmpty = async path => {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error('输出路径已存在且不是目录');
    if ((await readdir(path)).length) throw new Error('输出目录必须为空，避免覆盖已有文件');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(path, { recursive: true });
  }
};

const copyPath = async (from, to) => {
  await access(from);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: false, errorOnExist: true, dereference: true,
    filter: source => !/(?:^|\/)(?:\.DS_Store|__pycache__|\.git)(?:\/|$)|\.pyc$/.test(source)
      && !(source.startsWith(`${resolve(appRoot, 'web')}/`) && / \d+\.(?:js|css|html|svg|woff2)$/.test(source)),
  });
};

await ensureEmpty(outputRoot);
const pluginRoot = resolve(outputRoot, 'plugins', pluginName);
await mkdir(pluginRoot, { recursive: true });

for (const relativePath of [
  'cli.mjs',
  'src',
  'web',
  'runtime',
  'schemas',
  'scripts/plugin-readiness.mjs',
  'README.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
]) {
  await copyPath(resolve(appRoot, relativePath), resolve(pluginRoot, relativePath));
}

for (const skillName of PLUGIN_SKILLS) {
  await copyPath(
    resolve(BUNDLED_PLUGIN_SKILLS.includes(skillName) ? resolve(appRoot, 'plugin-skills') : skillsRoot, skillName),
    resolve(pluginRoot, 'skills', skillName),
  );
}

const wrapperPath = resolve(pluginRoot, 'skills', 'product-documentation', 'scripts', 'cli.mjs');
await copyPath(resolve(appRoot, 'plugin-skills/sources.json'), resolve(pluginRoot, 'skills/sources.json'));
await writeFile(resolve(pluginRoot, 'skills/shared-snapshot.json'), `${JSON.stringify({
  schemaVersion: 1, source: '本发布包的共享 Skill 输入快照，文件路径相对于 skills 目录。',
  files: await readSkillSnapshot(skillsRoot),
}, null, 2)}\n`);
await mkdir(dirname(wrapperPath), { recursive: true });
await writeFile(wrapperPath, '#!/usr/bin/env node\nawait import(new URL(\'../../../cli.mjs\', import.meta.url));\n', 'utf8');

const lock = JSON.parse(await readFile(resolve(appRoot, 'package-lock.json'), 'utf8'));
const productionDependencies = Object.entries(lock.packages || {})
  .filter(([path, metadata]) => path.startsWith('node_modules/') && metadata?.dev !== true)
  .map(([path]) => path)
  .sort();
for (const dependencyPath of productionDependencies) {
  await copyPath(resolve(appRoot, dependencyPath), resolve(pluginRoot, dependencyPath));
}

const packageJson = JSON.parse(await readFile(resolve(appRoot, 'package.json'), 'utf8'));
const manifestPath = resolve(pluginRoot, '.codex-plugin', 'plugin.json');
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify({
  name: pluginName,
  version: packageJson.version,
  description: '用 PRD 与统一 Product Spec 定义产品、页面和工程约束，按真实页面证据映射与评审。',
  author: { name: 'Interactive Product Spec' },
  license: 'MIT',
  keywords: ['prd', 'product-spec', 'page-mapping'],
  skills: './skills/',
  mcpServers: './.mcp.json',
  interface: {
    displayName: 'Interactive Product Spec',
    shortDescription: '统一 PRD 与 Spec，支持设计、工程约束和页面评审',
    longDescription: '内置想法审问、图形表达、UI UX Pro Max、Ant Design／Ant Design Mobile HTML 生成，以及统一 PRD／Spec 产品文档、软件架构和保真压缩技能。用户的 Agent 从想法接续 PRD、Spec 与 PC／APP 形态 HTML；工作台沿原入口映射和评审。',
    developerName: 'Interactive Product Spec',
    category: 'Productivity',
    capabilities: ['Interactive', 'Read', 'Write'],
    defaultPrompt: [
      '帮我把想法说清楚，按需要画流程图，并依据 PRD 和 Spec 做成 PC 或 APP 形态的 HTML 页面。',
      '检查当前 PRD 格式并从页面打开相关产品说明。',
      '依据当前 PRD 与可用页面生成或修订统一 Spec，覆盖适用操作、规则、工程约束和验收。',
    ],
    brandColor: '#58E0AA',
  },
}, null, 2)}\n`, 'utf8');

await writeFile(resolve(pluginRoot, '.mcp.json'), `${JSON.stringify({
  mcpServers: {
    'html-delivery': {
      command: 'node',
      args: ['./src/html-delivery-mcp.mjs'],
      cwd: '.',
      tool_timeout_sec: 43260,
    },
  },
}, null, 2)}\n`, 'utf8');

const hooksPath = resolve(pluginRoot, 'hooks', 'hooks.json');
await mkdir(dirname(hooksPath), { recursive: true });
await writeFile(hooksPath, `${JSON.stringify({
  description: '告诉 Codex 在 HTML 交付时同轮核对并修订 PRD 与统一 Spec；不弹窗、不扫描目录、不使用 Stop。',
  hooks: {
    SessionStart: [{
      hooks: [{
        type: 'command',
        command: sessionCommand,
        commandWindows: sessionCommandWindows,
        timeout: 30,
      }],
    }],
  },
}, null, 2)}\n`, 'utf8');

const marketplacePath = resolve(outputRoot, '.agents', 'plugins', 'marketplace.json');
await mkdir(dirname(marketplacePath), { recursive: true });
await writeFile(marketplacePath, `${JSON.stringify({
  name: MARKETPLACE_NAME,
  interface: { displayName: 'Interactive Product Spec Local' },
  plugins: [{
    name: pluginName,
    source: { source: 'local', path: `./plugins/${pluginName}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
  }],
}, null, 2)}\n`, 'utf8');

await copyPath(resolve(appRoot, 'INSTALL.md'), resolve(outputRoot, 'INSTALL.md'));
await copyPath(resolve(appRoot, 'scripts/install-plugin.mjs'), resolve(outputRoot, 'install.mjs'));
const readiness = await validatePluginRoot(pluginRoot);
if (!readiness.ok) throw new Error(readiness.failures.join('\n'));
await writeFile(resolve(outputRoot, 'release.json'), `${JSON.stringify({
  schemaVersion: 1, plugin: pluginName, marketplace: MARKETPLACE_NAME,
  version: packageJson.version, files: await inventory(outputRoot),
}, null, 2)}\n`, 'utf8');

process.stdout.write(`插件包已生成：${pluginRoot}\n`);
process.stdout.write(`包含 Skill：${PLUGIN_SKILLS.join('、')}\n`);
