import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const sessionCommand = 'node "$PLUGIN_ROOT/src/html-delivery-session.mjs"';
export const sessionCommandWindows = 'node "%PLUGIN_ROOT%\\src\\html-delivery-session.mjs"';
export const SHARED_PLUGIN_SKILLS = Object.freeze(['product-documentation', 'software-architecture-design', 'prd-concise-cn']);
export const BUNDLED_PLUGIN_SKILLS = Object.freeze(['grilling', 'diagram-design', 'ui-ux-pro-max', 'ant-design-html']);
export const PLUGIN_SKILLS = Object.freeze([...SHARED_PLUGIN_SKILLS, ...BUNDLED_PLUGIN_SKILLS]);
export const REQUIRED_SKILL_RESOURCES = Object.freeze([
  'product-documentation/references/standard-product-document.md',
  'product-documentation/references/product-spec.md',
  'product-documentation/references/spec-derivation.md',
  'product-documentation/references/projection.md',
  'product-documentation/references/mapping-workflow.md',
  'product-documentation/agents/prd-reviewer.md',
  'product-documentation/agents/spec-reviewer.md',
  'diagram-design/LICENSE', 'diagram-design/assets/template.html', 'diagram-design/scripts/self_check.py',
  'ui-ux-pro-max/LICENSE', 'ui-ux-pro-max/scripts/search.py', 'ui-ux-pro-max/scripts/core.py',
  'ui-ux-pro-max/data/styles.csv', 'ui-ux-pro-max/data/colors.csv',
  'ant-design-html/scripts/create-project.mjs', 'ant-design-html/references/pc.md', 'ant-design-html/references/app.md',
  'ant-design-html/assets/shared/build.mjs', 'ant-design-html/assets/shared/main.jsx',
  'ant-design-html/assets/pc/App.jsx', 'ant-design-html/assets/pc/style.css',
  'ant-design-html/assets/app/App.jsx', 'ant-design-html/assets/app/style.css',
]);

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export async function validatePluginRoot(rootPath) {
  const root = resolve(rootPath);
  const failures = [];
  let manifest;
  let mcp;
  let hooks;
  try {
    [manifest, mcp, hooks] = await Promise.all([
      readJson(resolve(root, '.codex-plugin/plugin.json')),
      readJson(resolve(root, '.mcp.json')),
      readJson(resolve(root, 'hooks/hooks.json')),
      access(resolve(root, 'src/html-delivery.mjs')),
      access(resolve(root, 'src/html-delivery-session.mjs')),
      access(resolve(root, 'src/html-delivery-mcp.mjs')),
      ...PLUGIN_SKILLS.map(name => access(resolve(root, 'skills', name, 'SKILL.md'))),
      ...REQUIRED_SKILL_RESOURCES.map(path => access(resolve(root, 'skills', path))),
      access(resolve(root, 'skills/product-documentation/scripts/cli.mjs')),
    ]);
  } catch (error) {
    return { ok: false, failures: [`插件文件不完整：${error.message}`] };
  }

  if (manifest?.name !== 'interactive-product-spec') failures.push('插件 name 必须是 interactive-product-spec');
  if (manifest?.skills !== './skills/') failures.push('插件必须从 ./skills/ 发布全部内置 Skill');
  if (manifest?.hooks !== undefined && manifest.hooks !== './hooks/hooks.json') failures.push('插件必须使用默认 hooks/hooks.json 或显式指向该文件');
  if (manifest?.mcpServers !== './.mcp.json') failures.push('插件必须显式声明 .mcp.json');

  const server = mcp?.mcpServers?.['html-delivery'];
  if (server?.cwd !== '.') failures.push('html-delivery MCP 必须从插件根目录启动，不能继承产品 Project 目录');
  if (server?.command !== 'node' || server?.args?.[0] !== './src/html-delivery-mcp.mjs') {
    failures.push('html-delivery MCP 入口不正确');
  }

  const eventNames = Object.keys(hooks?.hooks || {});
  if (eventNames.includes('UserPromptSubmit')) failures.push('不得保留 UserPromptSubmit HTML baseline Hook');
  if (eventNames.includes('Stop')) failures.push('不得保留 Stop HTML 询问 Hook');
  if (eventNames.length !== 1 || eventNames[0] !== 'SessionStart') {
    failures.push('插件生命周期只允许 SessionStart 完成协议 Hook');
  }
  const sessionHook = hooks?.hooks?.SessionStart?.[0]?.hooks?.[0];
  if (sessionHook?.type !== 'command') failures.push('SessionStart 必须使用 command Hook');
  if (sessionHook?.command !== sessionCommand) failures.push('SessionStart command 与稳定入口不一致');
  if (sessionHook?.commandWindows !== sessionCommandWindows) failures.push('SessionStart Windows command 与稳定入口不一致');

  return { ok: failures.length === 0, failures };
}
