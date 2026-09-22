import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('组件化 UI 只发布一份 Vite 构建产物', async () => {
  const html = await readFile(resolve(root, 'web/index.html'), 'utf8');
  const files = await readdir(resolve(root, 'web'));
  assert.match(html, /<title>咔哒 · 产品工作台<\/title>/);
  assert.match(html, /\/studio-assets\/assets\/index-/);
  assert.ok(files.includes('assets'));
  assert.ok(!files.includes('editor.js'));
  assert.ok(!files.includes('editor.css'));
  assert.ok(!files.includes('editor.html'));
});

test('页面映射与代理点击共用扩展后的交互语义适配层', async () => {
  const mappingSource = await readFile(resolve(root, 'ui/src/lib/spec-mapping.ts'), 'utf8');
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');

  for (const role of ['tab', 'switch', 'menuitem', 'combobox', 'treeitem']) {
    assert.match(mappingSource, new RegExp(`"${role}"`));
  }
  assert.match(mappingSource, /\[tabindex\]/);
  assert.match(mappingSource, /style\.cursor === "pointer"/);
  assert.match(mappingSource, /export const resolveInteractiveTarget/);
  assert.match(appSource, /resolveInteractiveTarget\(rawElement\)/);
  assert.doesNotMatch(appSource, /rawElement\?\.closest<HTMLElement>/);
});

test('页面区域适配不依赖业务 HTML，并压缩遮挡或重叠的候选框', async () => {
  const mappingSource = await readFile(resolve(root, 'ui/src/lib/spec-mapping.ts'), 'utf8');
  const overlaySource = await readFile(resolve(root, 'ui/src/lib/frame-overlay.ts'), 'utf8');

  assert.match(mappingSource, /export const EXPLICIT_SURFACE_SELECTOR/);
  assert.match(mappingSource, /export const isVisualSurface/);
  assert.match(mappingSource, /export const surfaceTargetScore/);
  assert.match(mappingSource, /collectVisualSurfaceTargets/);
  assert.doesNotMatch(mappingSource, /record-detail|chat-stream|MDT/);
  assert.match(overlaySource, /doc\.elementFromPoint/);
  assert.match(overlaySource, /overlapRatio/);
  assert.match(overlaySource, /const previewLimit = strong\.length \? 5 : 3/);
  assert.match(overlaySource, /selected\.length >= previewLimit/);
});

test('映射标记层始终绘制在区域轮廓层之上', async () => {
  const overlaySource = await readFile(resolve(root, 'ui/src/lib/frame-overlay.ts'), 'utf8');

  assert.match(overlaySource, /#outlines \{ position: relative; z-index: 10; \}/);
  assert.match(overlaySource, /#markers \{ position: relative; z-index: 20; \}/);
  assert.ok(overlaySource.indexOf('<div id="outlines"></div>') < overlaySource.indexOf('<div id="markers"></div>'));
});

test('PRD 输入栏采用 Beautiful UI 源码适配并随构建保留 MIT 许可', async () => {
  const componentRoot = resolve(root, 'ui/src/components/beautiful-ui');
  const source = await readFile(resolve(componentRoot, 'prompt-bar.tsx'), 'utf8');
  const panel = await readFile(resolve(root, 'ui/src/components/workbench/prd-review-panel.tsx'), 'utf8');
  const license = await readFile(resolve(componentRoot, 'LICENSE'), 'utf8');
  assert.match(panel, /import \{ PromptBar \} from "@\/components\/beautiful-ui\/prompt-bar"/);
  assert.match(source, /https:\/\/www\.beautifului\.dev\/#prompt-bar/);
  assert.match(source, /data-component-source="beautiful-ui\/prompt-bar"/);
  assert.match(license, /Copyright \(c\) 2026 Shane Levine/);
  assert.equal(await readFile(resolve(root, 'web/LICENSE.beautiful-ui.txt'), 'utf8'), license);
});

test('画布平移支持空格临时模式与底栏持续模式，并覆盖 iframe 焦点', async () => {
  const canvasSource = await readFile(resolve(root, 'ui/src/components/workbench/canvas-workbench.tsx'), 'utf8');

  assert.match(canvasSource, /data-testid="canvas-pan-toggle"/);
  assert.match(canvasSource, /const \[buttonPanMode, setButtonPanMode\] = useState\(false\)/);
  assert.match(canvasSource, /const \[spacePanActive, setSpacePanActive\] = useState\(false\)/);
  assert.match(canvasSource, /const panMode = buttonPanMode \|\| spacePanActive/);
  assert.match(canvasSource, /aria-pressed=\{panMode\}/);
  assert.match(canvasSource, /disabled: !panMode \|\| mappingActive \|\| dragging/);
  assert.match(canvasSource, /pointerEvents:\s*mappingActive \|\| dragging \|\| panMode/);
  assert.match(canvasSource, /frameWindow\.addEventListener\("keydown", handleFrameKeyDown, true\)/);
  assert.match(canvasSource, /frameWindow\.addEventListener\("keyup", handleFrameKeyUp, true\)/);
  assert.match(canvasSource, /onPointerDownCapture=\{releaseExternalControlFocus\}/);
  assert.match(canvasSource, /if \(!isTextEntryTarget\(event\.target\)\) releaseExternalControlFocus\(\)/);
  assert.match(canvasSource, /if \(viewportRef\.current\?\.contains\(active\)\) return/);
  assert.match(canvasSource, /window\.addEventListener\("keyup", handleKeyUp, true\)/);
  assert.match(canvasSource, /input, textarea, select, \[contenteditable='true'\]/);
  assert.match(canvasSource, /setTemporarySpacePan\(false\)/);
});

test('离开与本地 Spec 原文件编辑保留明确入口，普通工作台没有常驻连接按钮', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');
  const definitionSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-definition-panel.tsx'), 'utf8');

  assert.match(appSource, /离开当前工作台/);
  assert.match(appSource, /切换项目或文件/);
  assert.match(appSource, /继续 Spec 绑定/);
  assert.match(appSource, /尚未提交给 Codex 的 Spec 修订草稿将被放弃/);
  assert.doesNotMatch(appSource, /\/api\/codex\/connect/);
  assert.doesNotMatch(appSource, /连接 Codex/);
  assert.match(definitionSource, /编辑完整节点/);
  assert.match(definitionSource, /保存到原文件/);
  assert.match(definitionSource, /这项手工编辑不要求先连接 Codex/);

  const header = appSource.slice(
    appSource.indexOf('data-testid="work-mode-switch"'),
    appSource.indexOf('</header>'),
  );
  assert.ok(header.indexOf('data-testid="spec-binding-status"') < header.indexOf('data-testid="leave-workbench"'));
  assert.ok(header.indexOf('data-testid="leave-workbench"') < header.indexOf('data-testid="map-save-status"'));
});

test('最近项目删除先展示影响范围，并明确保护项目源文件与外部映射', async () => {
  const projectCenterSource = await readFile(
    resolve(root, 'ui/src/components/project-center/project-center.tsx'),
    'utf8',
  );
  const projectCenterApiSource = await readFile(
    resolve(root, 'ui/src/components/project-center/project-center-api.ts'),
    'utf8',
  );

  assert.match(projectCenterSource, /previewProjectRemoval/);
  assert.match(projectCenterSource, /removeProject/);
  assert.match(projectCenterApiSource, /\/api\/project\/remove-preview/);
  assert.match(projectCenterApiSource, /\/api\/project\/remove/);
  assert.match(projectCenterSource, /<AlertDialog\.Root/);
  assert.match(projectCenterSource, /移除项目并删除映射/);
  assert.match(projectCenterSource, /已有或项目内的 spec-map\.json 不会被删除/);
  assert.match(projectCenterSource, /不会删除 HTML、Markdown Spec 或 product\.spec\.json/);
});

test('顶部映射保存使用紧凑状态图标，不再占用文字按钮宽度', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');

  assert.match(appSource, /data-testid="map-save-status"/);
  assert.match(appSource, /size="icon-sm"/);
  assert.match(appSource, /<CircleCheck className="text-emerald-300"/);
  assert.match(appSource, /<LoaderCircle className="animate-spin"/);
  assert.match(appSource, /<CloudUpload \/>/);
  assert.match(appSource, /<CircleAlert \/>/);
  assert.doesNotMatch(appSource, /<span className="hidden lg:inline" aria-live="polite">\{mapSaveLabel\}<\/span>/);
});

test('只读评审包明确提供 Windows x64 免安装入口', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');

  assert.match(appSource, /Windows 10\/11 x64 解压后可直接双击 EXE/);
  assert.match(appSource, /无需安装 Node/);
});

test('Markdown Spec 通过显式、可见且可选模型的 Codex 对话生成投影', async () => {
  const projectCenterSource = await readFile(resolve(root, 'ui/src/components/project-center/project-center.tsx'), 'utf8');
  const projectionConversationSource = await readFile(
    resolve(root, 'ui/src/components/project-center/use-projection-conversation.ts'),
    'utf8',
  );
  const projectCenterApiSource = await readFile(
    resolve(root, 'ui/src/components/project-center/project-center-api.ts'),
    'utf8',
  );
  const projectionSource = await readFile(resolve(root, 'src/codex-projection.mjs'), 'utf8');
  const appServerSource = await readFile(resolve(root, 'src/codex-app-server.mjs'), 'utf8');

  assert.match(projectCenterSource, /useProjectionConversation/);
  assert.match(projectCenterSource, /创建 Codex 对话并生成/);
  assert.match(projectCenterSource, /Codex 左侧任务列表/);
  assert.match(projectCenterSource, /codex:\/\/threads\//);
  assert.match(projectCenterSource, /在 Codex 中打开/);
  assert.match(projectionConversationSource, /startProjectionJob/);
  assert.match(projectionConversationSource, /loadCodexModelOptions/);
  assert.match(projectCenterApiSource, /\/api\/project\/projection/);
  assert.match(projectCenterApiSource, /\/api\/codex\/models/);
  assert.match(projectionConversationSource, /codexModel/);
  assert.match(projectionConversationSource, /codexEffort/);
  assert.match(projectionConversationSource, /setTimeout\(\(\) => void poll\(\), delay\)/);
  assert.doesNotMatch(projectionConversationSource, /setInterval/);
  assert.doesNotMatch(projectCenterSource, /requestedProjectionRef/);
  assert.match(projectionSource, /type: 'skill', name: 'product-documentation'/);
  assert.match(projectionSource, /startVisibleCodexThread/);
  assert.match(projectionSource, /sandbox: 'read-only'/);
  assert.match(projectionSource, /approvalPolicy: 'never'/);
  assert.match(appServerSource, /spawn\(binary, \['app-server', '--stdio'\]/);
  assert.match(appServerSource, /threadSource: 'user'/);
  assert.match(appServerSource, /ephemeral: false/);
  assert.match(appServerSource, /thread\/name\/set/);
  assert.doesNotMatch(projectionSource, /@openai\/codex-sdk/);
});

test('不合格 PRD 可从原错误卡片创建可见 Codex 对话并生成标准化草稿', async () => {
  const projectCenterSource = await readFile(resolve(root, 'ui/src/components/project-center/project-center.tsx'), 'utf8');
  const prdConversationSource = await readFile(
    resolve(root, 'ui/src/components/project-center/use-prd-draft-conversation.ts'),
    'utf8',
  );
  const projectCenterApiSource = await readFile(
    resolve(root, 'ui/src/components/project-center/project-center-api.ts'),
    'utf8',
  );
  const generatorSource = await readFile(resolve(root, 'src/codex-prd-draft.mjs'), 'utf8');

  assert.match(projectCenterSource, /usePrdDraftConversation/);
  assert.match(projectCenterSource, /新建一条可见的 Codex 对话/);
  assert.match(projectCenterSource, /Product Documentation Skill/);
  assert.match(projectCenterSource, /不会覆盖当前 PRD/);
  assert.match(projectCenterSource, /创建 Codex 对话并生成/);
  assert.match(projectCenterSource, /在 Codex 中打开/);
  assert.match(prdConversationSource, /startPrdDraftJob/);
  assert.match(prdConversationSource, /setTimeout\(\(\) => void poll\(\), delay\)/);
  assert.doesNotMatch(prdConversationSource, /setInterval/);
  assert.match(projectCenterApiSource, /\/api\/project\/prd-draft/);
  assert.match(generatorSource, /type: 'skill', name: 'product-documentation'/);
  assert.match(generatorSource, /startVisibleCodexThread/);
  assert.match(generatorSource, /sandbox: 'workspace-write'/);
  assert.match(generatorSource, /type: 'workspaceWrite'/);
  assert.match(generatorSource, /writableRoots: \[projectPath\]/);
  assert.match(generatorSource, /networkAccess: false/);
  assert.match(generatorSource, /不修改原始 PRD/);
});

test('项目中心可直接继续最近一次 Spec 绑定，失败时才回来源配置', async () => {
  const projectCenterSource = await readFile(resolve(root, 'ui/src/components/project-center/project-center.tsx'), 'utf8');
  const projectCenterApiSource = await readFile(resolve(root, 'ui/src/components/project-center/project-center-api.ts'), 'utf8');

  assert.match(projectCenterSource, /reopenProjectRequest/);
  assert.match(projectCenterApiSource, /\/api\/project\/reopen/);
  assert.match(projectCenterSource, /继续 Spec 绑定/);
  assert.match(projectCenterSource, /continueProject\(project\)/);
  assert.match(projectCenterSource, /dismissProjectBootstrap/);
  assert.match(projectCenterApiSource, /\/api\/project\/bootstrap\/dismiss/);
});

test('项目中心自动使用已有映射，并在创建工具侧映射前要求确认', async () => {
  const projectCenterSource = await readFile(resolve(root, 'ui/src/components/project-center/project-center.tsx'), 'utf8');

  assert.match(projectCenterSource, /validMaps\.length === 1/);
  assert.match(projectCenterSource, /已自动载入已有映射/);
  assert.match(projectCenterSource, /confirmMapCreate/);
  assert.match(projectCenterSource, /未发现已有映射，创建新的工具侧映射/);
  assert.match(projectCenterSource, /已有映射与当前 Spec 不兼容/);
  assert.match(projectCenterSource, /旧映射会原样保留，不会覆盖或自动迁移/);
  assert.match(projectCenterSource, /创建适用于新 Spec 的工具侧映射/);
  assert.match(projectCenterSource, /当前未绑定 Spec/);
  assert.match(projectCenterSource, /!sourceSpecReady \|\| specReady/);
  assert.match(projectCenterSource, /不能降级进入仅含 PRD 的工作台/);
  assert.doesNotMatch(projectCenterSource, /path !== current\.sourceSpecPath \? \{ specPath: "" \}/);
  assert.match(projectCenterSource, /这不影响进入页面阅读和关联 PRD/);
  assert.match(projectCenterSource, /Spec 节点到页面元素的映射依赖经过校验的内部投影/);
  assert.doesNotMatch(projectCenterSource, /工具侧空映射/);
  assert.doesNotMatch(projectCenterSource, /项目内创建/);
});

test('评审模式页面优先，映射模式恢复完整三栏 Spec 绑定工作台', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');
  const canvasSource = await readFile(resolve(root, 'ui/src/components/workbench/canvas-workbench.tsx'), 'utf8');
  const inspectorSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-inspector.tsx'), 'utf8');
  const overlaySource = await readFile(resolve(root, 'ui/src/lib/frame-overlay.ts'), 'utf8');

  assert.match(appSource, /specBrowserOpen/);
  assert.match(appSource, /查找 Spec/);
  assert.match(appSource, /inspectorPinned/);
  assert.match(appSource, /workMode === "map"/);
  assert.match(appSource, /workMode === "review"/);
  assert.match(appSource, /data-testid="work-mode-switch"/);
  assert.match(appSource, /绑定模式/);
  assert.match(appSource, /评审模式/);
  assert.match(appSource, /canSave=\{Boolean\(config\?\.canSave && workMode === "map"\)\}/);
  assert.match(appSource, /canSaveSpec=\{Boolean\(config\?\.canSaveSpec && workMode === "map"\)\}/);
  assert.match(appSource, /reviewMode=\{workMode === "review"\}/);
  assert.match(appSource, /if \(workMode === "map"\) setSpecBrowserOpen\(false\)/);
  assert.match(appSource, /ResizablePanelGroup/);
  assert.match(appSource, /id="spec-binding-tree"/);
  assert.match(appSource, /id="mapping-canvas"/);
  assert.match(appSource, /id="mapping-inspector"/);
  assert.match(appSource, /defaultSize="340px"/);
  assert.match(canvasSource, /title="功能页面"/);
  assert.doesNotMatch(canvasSource, /只读评审/);
  assert.match(inspectorSource, /固定详情/);
  assert.match(inspectorSource, /返回 Spec 列表/);
  assert.match(inspectorSource, /重新选择页面位置/);
  assert.match(inspectorSource, /!reviewMode \? <TabsTrigger value="mapping" className="text-xs">页面映射<\/TabsTrigger> : null/);
  assert.match(inspectorSource, /!reviewMode \? <TabsContent value="mapping"/);
  assert.doesNotMatch(inspectorSource, /<TabsTrigger value="mapping"[\s\S]{0,260}!annotation && candidate/);
  assert.match(overlaySource, /marker-dot/);
  assert.doesNotMatch(overlaySource, /marker-number/);
});

test('绑定与评审模式共用同一个画布和 iframe，只折叠两侧面板', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');
  const sidebarSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-sidebar.tsx'), 'utf8');

  assert.match(appSource, /usePanelRef/);
  assert.match(appSource, /panelRef=\{navigatorPanelRef\}/);
  assert.match(appSource, /panelRef=\{inspectorPanelRef\}/);
  assert.match(appSource, /collapsedSize="0px"/);
  assert.match(appSource, /if \(workMode === "map"\) panel\?\.expand\(\)/);
  assert.match(appSource, /else panel\?\.collapse\(\)/);
  assert.doesNotMatch(appSource, /\{workMode === "map" \? \(\s*<ResizablePanelGroup/);
  assert.match(sidebarSource, /const effectiveFilter = reviewMode \? "all" : filter/);
  assert.match(sidebarSource, /!reviewMode \? <Tabs value=\{filter\}/);
  assert.match(sidebarSource, /reviewMode \? <FileText/);
});

test('画布底部控制区不覆盖功能页面，并保留连续加速缩放与焦点锚定', async () => {
  const canvasSource = await readFile(resolve(root, 'ui/src/components/workbench/canvas-workbench.tsx'), 'utf8');
  const zoomMotionSource = await readFile(resolve(root, 'ui/src/lib/zoom-motion.ts'), 'utf8');

  assert.match(canvasSource, /data-testid="canvas-controls"/);
  assert.match(canvasSource, /data-testid="canvas-controls-hint"/);
  // Native hit testing and per-project persistence are covered by canvas-hints.browser.mjs.
  assert.match(canvasSource, /data-layout="floating"/);
  assert.match(canvasSource, /aria-label="关闭画布模式提示"/);
  assert.match(canvasSource, /aria-label="关闭画布操作提示"/);
  assert.match(canvasSource, /Ctrl\/⌘ \+ 滚轮：连续加速缩放/);
  assert.match(canvasSource, /normalizedWheelZoomDelta/);
  assert.match(canvasSource, /acceleratedWheelZoomTarget/);
  assert.match(canvasSource, /wheelZoomSmoothingAlpha/);
  assert.match(canvasSource, /requestAnimationFrame\(runWheelZoomFrame\)/);
  assert.match(canvasSource, /motion\.focalX - motion\.contentX \* nextScale/);
  assert.match(canvasSource, /motion\.focalY - motion\.contentY \* nextScale/);
  assert.match(zoomMotionSource, /WHEEL_ACCELERATION_GAIN/);
  assert.match(zoomMotionSource, /baseScale \* 2 \*\* \(delta \* acceleration\)/);
  assert.match(zoomMotionSource, /1 - Math\.exp/);
  assert.match(
    canvasSource,
    /pointerEvents:\s*mappingActive \|\| dragging \|\| panMode\s*\? "auto"\s*:\s*"none"/,
  );
  assert.ok(
    canvasSource.indexOf('data-testid="canvas-controls"') >
      canvasSource.indexOf('</TransformWrapper>'),
    '缩放控制区应位于页面画布之外，不能覆盖底部页面交互',
  );
});

test('操作定义使用有序动态内容块而不是固定字段模板', async () => {
  const panelSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-definition-panel.tsx'), 'utf8');
  const mappingSource = await readFile(resolve(root, 'ui/src/lib/spec-mapping.ts'), 'utf8');
  const inspectorSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-inspector.tsx'), 'utf8');
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');

  assert.match(panelSource, /draft\.contentBlocks\.map/);
  assert.match(panelSource, /onDoubleClick=\{\(\) => beginInlineEditing\(block\)\}/);
  assert.match(panelSource, /仅编辑当前一条/);
  assert.match(panelSource, /保存此项/);
  assert.match(panelSource, /currentDraft\.contentBlocks\.map/);
  assert.match(panelSource, /blockKind === "status"/);
  assert.match(panelSource, /blockKind === "source"/);
  assert.match(panelSource, /blockKind === "statement"/);
  assert.match(panelSource, /anchorHintsFromContent/);
  assert.match(panelSource, /inlineBlockKind\(node, block\) !== "anchor-hints"/);
  assert.match(panelSource, /readableContentBlocks\.map/);
  assert.match(panelSource, /⌘\/Ctrl \+ Enter 保存 · Esc 取消/);
  assert.match(panelSource, /输入任意原文字段名称/);
  assert.match(panelSource, /按当前顺序回传/);
  assert.doesNotMatch(panelSource, /STANDARD_FIELDS/);
  assert.match(mappingSource, /export const contentBlocksForNode/);
  assert.doesNotMatch(inspectorSource, /这里会展示前端行为、后端结果/);
  assert.match(appSource, /setInspectorTab\("definition"\)/);
});

test('工作台按稳定页面导航树分组，模块只作为筛选和标签', async () => {
  const mappingSource = await readFile(resolve(root, 'ui/src/lib/spec-mapping.ts'), 'utf8');
  const sidebarSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-sidebar.tsx'), 'utf8');
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');

  assert.match(mappingSource, /export const matchCurrentPages/);
  assert.match(mappingSource, /export const specPages/);
  assert.match(mappingSource, /export const pagesForModule/);
  assert.match(mappingSource, /bundle\.modules\s*\.flatMap/);
  assert.match(mappingSource, /candidate\.pageId !== best\?\.pageId/);
  assert.match(mappingSource, /item\.pageId === best\.pageId/);
  assert.match(mappingSource, /Math\.floor\(explicitAnchors\.length \/ 2\) \+ 1/);
  assert.match(appSource, /currentPages\.get\(node\.moduleId\)\?\.pageId !== node\.pageId/);
  assert.match(appSource, /selectorCounts/);
  assert.match(appSource, /dirtyRef\.current && !\(await saveMap\(false\)\)/);
  assert.match(sidebarSource, /PageBranch/);
  assert.match(sidebarSource, /parentPageId/);
  assert.match(sidebarSource, /搜索页面、操作或模块/);
  assert.doesNotMatch(sidebarSource, /搜索模块、操作或规则/);
  assert.match(sidebarSource, /按模块筛选/);
  assert.match(sidebarSource, /effectiveFilter !== "all" \|\| moduleFilter !== "all"/);
  assert.match(sidebarSource, /moduleTitle/);
  assert.doesNotMatch(sidebarSource, /data-hierarchy-level="module-children"/);
  assert.match(sidebarSource, /data-hierarchy-level="page"/);
  assert.match(sidebarSource, /data-hierarchy-level="node"/);
  assert.match(sidebarSource, /data-page-depth/);
  assert.doesNotMatch(sidebarSource, /currentPageIds/);
  assert.doesNotMatch(sidebarSource, /setActivePageId\(currentPageId\)/);
  assert.match(sidebarSource, /const opening = activePageId !== pageId/);
  assert.match(sidebarSource, /setActivePageId\(opening \? pageId : null\)/);
  assert.doesNotMatch(sidebarSource, />\s*当前页\s*</);
  assert.match(sidebarSource, /需复核 \{problemCount\}/);
  assert.doesNotMatch(sidebarSource, />有变化</);
  assert.match(sidebarSource, /selected \? "line-clamp-2" : "line-clamp-1"/);
  assert.doesNotMatch(sidebarSource, /\{disabled \? "点击查看" : "点击定位 · 可拖拽"\}/);
  assert.doesNotMatch(sidebarSource, /当前页(?:找到|暂无).*自动候选/);
  assert.doesNotMatch(sidebarSource, /确认本页 \{highConfidenceCandidateCount\} 项/);
  assert.doesNotMatch(appSource, /acceptPageCandidates/);
  assert.match(appSource, /const mappingNeedsAttention = !annotation \|\| \["invalid", "ambiguous", "drifted"\]\.includes\(status\)/);
  assert.match(appSource, /openNode\(nodeId, workMode === "review" \? "definition" : mappingNeedsAttention \? "mapping" : "definition"\)/);
  const locateBestCandidateSource = appSource.slice(
    appSource.indexOf('const locateBestCandidate'),
    appSource.indexOf('const selectSpecNode'),
  );
  assert.doesNotMatch(locateBestCandidateSource, /setInspectorTab/);
});

test('Spec 节点按映射状态进入正确详情，且所有标签持续显示映射状态', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');
  const inspectorSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-inspector.tsx'), 'utf8');

  assert.match(appSource, /const status = visibleMap \? mappingStatus\(visibleMap, nodeId\) : "unmapped"/);
  assert.match(appSource, /const selectingAnotherNode = selectedId !== nodeId/);
  assert.match(appSource, /if \(selectingAnotherNode\)[\s\S]*?mappingNeedsAttention \? "mapping" : "definition"/);
  assert.match(appSource, /else \{[\s\S]*?setInspectorOpen\(true\)/);
  assert.match(inspectorSource, /data-testid="inspector-mapping-status"/);
  assert.match(inspectorSource, /\{STATUS_LABELS\[status\]\}/);
});

// Navigation order and non-writing behavior are exercised against the built UI in
// browser-tests/page-navigation.browser.mjs, rather than source-string ordering.

test('人工关联不以 HTML 可冷启动为前提，目标未出现时保留关联并等待手动进入', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');
  const mappingSource = await readFile(resolve(root, 'ui/src/lib/spec-mapping.ts'), 'utf8');
  const sidebarSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-sidebar.tsx'), 'utf8');

  assert.doesNotMatch(appSource, /reviewRouteContract|__IPS_REVIEW_ROUTE__/);
  assert.doesNotMatch(appSource, /请先补齐原始页面路由/);
  assert.match(appSource, /toast\.success\(`已关联：/);
  assert.match(appSource, /关联仍然有效。请在中间页面手动进入对应演示场景/);
  assert.match(mappingSource, /matches\.length === 0[\s\S]*status: "out-of-context"/);
  assert.match(
    mappingSource,
    /matches\.length === 0[\s\S]*context !== contextUrl[\s\S]*status: "confirmed"[\s\S]*status: "out-of-context"/,
  );
  assert.ok(
    mappingSource.indexOf('if (resolveMappedTarget(') < mappingSource.indexOf('const contextChanged'),
    '组件已经唯一命中且指纹一致时必须先恢复已关联，页面地址只能作为未命中时的导航提示',
  );
  assert.match(appSource, /await resolveMappedDestination/);
  assert.doesNotMatch(appSource, /已把当前页面地址更新为后续自动跳转提示/);
  assert.match(mappingSource, /saved\.text && saved\.text !== current\.text/);
  assert.ok(
    appSource.indexOf('if (frame.contentDocument)', appSource.indexOf('const restoreMappedNode'))
      < appSource.indexOf('await resolveMappedDestination', appSource.indexOf('const restoreMappedNode')),
    '点击已关联节点时必须先检查当前页面组件，再考虑旧页面地址',
  );
  assert.match(mappingSource, /"out-of-context": "已关联 · 需手动进入"/);
  assert.match(mappingSource, /当前演示场景尚未显示该组件/);
  assert.match(sidebarSource, /\["confirmed", "out-of-context"\]\.includes\(status\)/);
  assert.doesNotMatch(sidebarSource, /REVIEW_STATUSES[^\n]*out-of-context/);
});

test('非页面约束只在右侧分组阅读且不进入映射任务', async () => {
  const mappingSource = await readFile(resolve(root, 'ui/src/lib/spec-mapping.ts'), 'utf8');
  const sidebarSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-sidebar.tsx'), 'utf8');
  const inspectorSource = await readFile(resolve(root, 'ui/src/components/workbench/spec-inspector.tsx'), 'utf8');

  assert.match(sidebarSource, /\.filter\(\(node\) => MAPPABLE_TYPES\.has\(node\.type\)\)/);
  assert.match(sidebarSource, /mappedCount\}\/\{branchRecords\.length/);
  assert.match(mappingSource, /export const collectConstraintSections/);
  assert.match(mappingSource, /!MAPPABLE_TYPES\.has\(relatedNode\.type\)/);
  assert.match(mappingSource, /!directIds\.has\(candidate\.id\)/);
  assert.match(mappingSource, /relationType: "同模块未直接关联"/);
  assert.doesNotMatch(inspectorSource, /TabsTrigger value="relations"/);
  assert.match(inspectorSource, /SpecReadingContext/);
  assert.match(inspectorSource, /constraints={constraints.direct}/);

});

test('PRD 可独立于 Spec 从当前页面打开、检索并保存章节关系', async () => {
  const appSource = await readFile(resolve(root, 'ui/src/App.tsx'), 'utf8');
  const browserSource = await readFile(resolve(root, 'ui/src/components/workbench/prd-browser.tsx'), 'utf8');
  const stylesSource = await readFile(resolve(root, 'ui/src/index.css'), 'utf8');
  const projectCenterSource = await readFile(resolve(root, 'ui/src/components/project-center/project-center.tsx'), 'utf8');
  const workbenchApiSource = await readFile(resolve(root, 'ui/src/components/workbench/workbench-api.ts'), 'utf8');

  assert.match(appSource, /RelatedPrdButton compact count=\{relatedPrdSectionIds\.length\}/);
  assert.match(appSource, /prepareReviewPackage/);
  assert.match(workbenchApiSource, /\/api\/review-package\/prepare/);
  assert.match(appSource, /data-testid="open-review-export"/);
  assert.match(appSource, /data-testid="export-review-package"/);
  assert.match(appSource, /aria-label="评审资料"/);
  assert.match(appSource, /aria-label="交付与会话"/);
  assert.match(appSource, /savePrdPageMap/);
  assert.match(workbenchApiSource, /\/api\/prd-map/);
  assert.match(appSource, /page\.context\.url === frameContext/);
  assert.doesNotMatch(browserSource, /embedded/);
  assert.match(browserSource, /document\.sections\.filter\(\(section\) => relatedIds\.has\(section\.id\) \|\| section\.id === sourceTarget\?\.id\)/);
  assert.match(browserSource, /displayedSections\.map\(\(section\) => section\.markdown\)\.join/);
  assert.match(browserSource, /评审模式只展示当前页面已经绑定的 PRD 内容/);
  assert.match(browserSource, /显示完整产品文档/);
  assert.match(browserSource, /当前页面未绑定 PRD 内容/);
  assert.match(browserSource, /placeholder="搜索章节和正文"/);
  assert.match(browserSource, /markit\(root\)/);
  assert.match(browserSource, /aria-label="正文搜索结果导航"/);
  assert.match(browserSource, /aria-label="上一个正文匹配"/);
  assert.match(browserSource, /aria-label="下一个正文匹配"/);
  assert.match(browserSource, /prd-search-match-current/);
  assert.match(stylesSource, /mark\.prd-search-match/);
  assert.match(stylesSource, /mark\.prd-search-match-current/);
  assert.match(browserSource, /保存当前页面关联/);
  assert.match(browserSource, /当前页面相关/);
  assert.match(browserSource, /data-markdown-renderer="react-markdown"/);
  assert.match(browserSource, /language-mermaid/);
  assert.match(browserSource, /data-testid="prd-mermaid"/);
  assert.match(browserSource, /aria-label="放大查看流程图"/);
  assert.match(browserSource, /data-testid="prd-mermaid-dialog"/);
  assert.match(browserSource, /data-testid="prd-mermaid-zoom-svg"/);
  assert.doesNotMatch(browserSource, /data:image\/svg\+xml/);
  assert.match(browserSource, /aria-label="放大流程图"/);
  assert.match(browserSource, /data-testid="prd-outline"/);
  assert.match(browserSource, /aria-label="PRD 正文导航"/);
  assert.match(browserSource, /aria-label="正文导航"/);
  assert.match(browserSource, /定位章节，不参与页面关联/);
  assert.match(browserSource, /data-testid="prd-drawer-resize-handle"/);
  assert.match(browserSource, /aria-label="调整 PRD 预览抽屉宽度"/);
  assert.doesNotMatch(browserSource, /data-testid="prd-left-resize-handle"/);
  assert.doesNotMatch(browserSource, /data-testid="prd-right-resize-handle"/);
  assert.match(browserSource, /2xl:grid-cols-\[240px_minmax\(0,1fr\)_190px\]/);
  assert.match(browserSource, /behavior: "auto"/);
  assert.doesNotMatch(browserSource, /behavior: "smooth"/);
  assert.match(projectCenterSource, /PRD 可独立进入工作台/);
  assert.match(projectCenterSource, /\(prdReady \|\| specReady\)/);
  assert.match(projectCenterSource, /confirmPrdMapCreate/);
  assert.match(projectCenterSource, /mapPolicy === "project" && Boolean\(draft\.confirmTargetWrite\)/);
  assert.match(projectCenterSource, /原有 Spec 绑定与评审能力不会被降级或替换/);
});
