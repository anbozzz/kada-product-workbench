import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PLUGIN_SKILLS } from '../src/plugin-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const source = async path => await readFile(resolve(root, path), 'utf8');

const [server, contracts, mapStore, projectionService, specService, reviewSession, reviewPackage, htmlDelivery, htmlDeliverySession, htmlDeliveryMcp, pluginBuilder, app, projectCenter, projectionConversation, mapPersistence, pathPicker] =
  await Promise.all([
    source('src/server.mjs'),
    source('src/contracts.mjs'),
    source('src/map-store.mjs'),
    source('src/projection-service.mjs'),
    source('src/spec-service.mjs'),
    source('src/review-session.mjs'),
    source('src/review-package.mjs'),
    source('src/html-delivery.mjs'),
    source('src/html-delivery-session.mjs'),
    source('src/html-delivery-mcp.mjs'),
    source('scripts/build-plugin-bundle.mjs'),
    source('ui/src/App.tsx'),
    source('ui/src/components/project-center/project-center.tsx'),
    source('ui/src/components/project-center/use-projection-conversation.ts'),
    source('ui/src/components/workbench/use-map-persistence.ts'),
    source('ui/src/components/project-center/path-picker-sheet.tsx'),
  ]);

for (const moduleName of ['map-store', 'projection-service', 'spec-service', 'review-session', 'review-package']) {
  assert.match(
    server,
    new RegExp(`from './${moduleName}\\.mjs'`),
    `server.mjs 必须通过 ${moduleName}.mjs 组合职责`,
  );
}

for (const [name, moduleSource] of [
  ['map-store.mjs', mapStore],
  ['projection-service.mjs', projectionService],
  ['spec-service.mjs', specService],
  ['review-session.mjs', reviewSession],
  ['review-package.mjs', reviewPackage],
]) {
  assert.doesNotMatch(moduleSource, /from ['"]\.\/server\.mjs['"]/, `${name} 不得反向依赖 server.mjs`);
}

assert.match(contracts, /from ['"]\.\/schema-validation\.mjs['"]/, '运行时契约必须委托给 Schema 校验器');
assert.match(server, /createWorkbenchConfig/, 'server.mjs 必须通过 Review Session 装配工作台配置');
assert.match(specService, /DirectSourceCommit/, 'Spec 服务必须显式实现本地来源提交策略');
assert.match(specService, /CodexGateCommit/, 'Spec 服务必须显式实现 Codex gate 提交策略');
assert.doesNotMatch(server, /active\.gate[\s\S]{0,120}saveSpecNode/, 'HTTP 路由不得决定 Spec 提交策略');
assert.doesNotMatch(app, /fetch\(/, 'App.tsx 不得直接持有 HTTP 传输');
assert.doesNotMatch(app, /fetch\(['"]\/api\/map/, 'App.tsx 不应重新持有映射持久化请求');
assert.match(app, /useMapPersistence/, 'App.tsx 必须委托映射持久化状态');
assert.match(reviewPackage, /READ_ONLY_PACKAGE/, '评审包查看器必须显式拒绝写入 API');
assert.match(reviewPackage, /打开评审\.exe/, '评审包必须带出 Windows x64 免安装查看器');
const windowsLauncherInfo = await stat(resolve(root, 'runtime/windows-x64/open-review.exe'));
assert.ok(windowsLauncherInfo.isFile() && windowsLauncherInfo.size > 0, 'Windows x64 查看器制品必须存在');
assert.doesNotMatch(reviewPackage, /scanProjectDirectory|saveSpecMap|savePrdMap|saveSpecNode|listLocalPath|listCodexModels|generateProjectionWithCodex/, '评审包不得依赖项目扫描、写入或 Codex 职责');
assert.doesNotMatch(projectCenter, /fetch\(['"]\/api\/project\/projection/, '项目中心不应重新持有投影轮询');
assert.match(projectCenter, /useProjectionConversation/, '项目中心必须委托 Codex 投影会话');
assert.doesNotMatch(projectCenter, /fetch\(/, '项目中心不得直接持有 HTTP 传输');
assert.doesNotMatch(projectionConversation, /fetch\(/, '投影会话不得直接持有 HTTP 传输');
assert.doesNotMatch(mapPersistence, /fetch\(/, '映射保存 hook 不得直接持有 HTTP 传输');
assert.doesNotMatch(pathPicker, /fetch\(/, '路径选择器不得直接持有 HTTP 传输');
assert.doesNotMatch(htmlDelivery, /readdir|scanHtml|prdPath|specPath|loadProjectState/, 'HTML 完成上报不得扫描目录或提前读取 PRD/Spec');
assert.match(htmlDeliveryMcp, /publish_html_ready/, 'HTML MCP 必须暴露显式完成上报工具');
assert.doesNotMatch(htmlDeliveryMcp, /decision:\s*['"]block|stopHookActive|offer_spec_review/, 'HTML MCP 不得返回 Stop 续跑合同');
assert.match(htmlDeliverySession, /hookEventName:\s*['"]SessionStart['"]/, '完成协议只能通过 SessionStart 注入');
assert.match(htmlDeliverySession, /不得使用 Stop、UserPromptSubmit、目录扫描/, '完成协议必须明确禁止旧触发链');
assert.match(pluginBuilder, /SessionStart/, '插件 bundle 必须发布 SessionStart 完成协议');
assert.doesNotMatch(pluginBuilder, /UserPromptSubmit\s*:/, '插件 bundle 不得重新发布 UserPromptSubmit Hook');
assert.doesNotMatch(pluginBuilder, /Stop\s*:/, '插件 bundle 不得重新发布 Stop Hook');
assert.match(pluginBuilder, /for \(const skillName of PLUGIN_SKILLS\)/);
assert.deepEqual([...PLUGIN_SKILLS], ['product-documentation', 'software-architecture-design', 'prd-concise-cn', 'grilling', 'diagram-design', 'ui-ux-pro-max', 'ant-design-html']);
assert.doesNotMatch(htmlDelivery, /elicitation\/create|writeFile|writeJsonAtomic|readJson|deliveryRuns/, 'HTML 上报不得弹窗或持久化选择来免除文档同步');
assert.match(htmlDelivery, /document-sync-required/, 'HTML 上报必须返回待同步要求，不能声称文档已处理');
assert.match(htmlDelivery, /先核对 PRD 再核对 Spec/, '统一入口仍须按原顺序核对两份文档');

console.log('架构边界检查通过');
