import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';

import { createEmptySpecMap } from '../src/contracts.mjs';
import { startWorkbench } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const example = name => resolve(root, 'examples/task-board', name);
const screenshotPath = resolve(root, 'output/playwright/candidate-spec-locates-dom.png');
const inlineEditScreenshotPath = resolve(root, 'output/playwright/inline-content-edit.png');
const temp = await mkdtemp(join(tmpdir(), 'ips-browser-'));
const mapPath = join(temp, 'spec-map.json');
const specPath = join(temp, 'product.spec.json');
const sourceSpecPath = join(temp, 'task-board.spec.md');
const statePath = join(temp, 'state', 'projects.json');
await Promise.all([
  copyFile(example('product.spec.json'), specPath),
  copyFile(example('task-board.spec.md'), sourceSpecPath),
]);
const browserFixture = JSON.parse(await readFile(specPath, 'utf8'));
const browserFixtureNode = browserFixture.modules
  .flatMap(module => module.nodes)
  .find(node => node.id === 'TASK-ACTION-CREATE');
if (!browserFixtureNode) throw new Error('测试 Spec 缺少 TASK-ACTION-CREATE');
browserFixtureNode.status = 'draft';
browserFixtureNode.sourceKind = 'observed-ui';
browserFixtureNode.contentBlocks.unshift(
  { id: 'status', label: '状态', content: '`draft`' },
  { id: 'source', label: '来源', content: '`observed-ui`' },
  { id: 'anchor-hints', label: '页面匹配提示', content: '新建任务；create task' },
);
await writeFile(specPath, `${JSON.stringify(browserFixture, null, 2)}\n`, 'utf8');
await writeFile(
  mapPath,
  `${JSON.stringify(createEmptySpecMap('TRAIL-TASKS', example('index.html')), null, 2)}\n`,
  'utf8',
);

const studio = await startWorkbench({
  appRoot: root,
  statePath,
  mode: 'map',
  htmlPath: example('index.html'),
  specPath,
  sourceSpecPath,
  mapPath,
  host: '127.0.0.1',
  port: 0,
});
const browser = await launchHeadlessBrowser();
let discoveryStudio = null;
let discoveryDelayServer = null;

try {
  const page = await browser.newPage({ viewport: { width: 1626, height: 870 } });
  await page.goto(studio.url, { waitUntil: 'networkidle' });

  const viewport = page.getByTestId('canvas-viewport');
  await viewport.waitFor();
  await assert.doesNotReject(async () => {
    await page.getByTestId('map-save-status').getAttribute('aria-label');
  });
  assert.equal(await page.getByTestId('map-save-status').getAttribute('aria-label'), '已自动保存');
  const headerOrder = await page.locator('header').evaluate(header => {
    const ids = ['work-mode-switch', 'spec-binding-status', 'open-review-export', 'leave-workbench', 'map-save-status'];
    return ids.map(id => {
      const element = header.querySelector(`[data-testid="${id}"]`);
      if (!element) throw new Error(`顶部缺少 ${id}`);
      return element.getBoundingClientRect().left;
    });
  });
  assert.ok(
    headerOrder.every((left, index) => index === 0 || headerOrder[index - 1] < left),
    '顶部应按工作模式、评审资料、导出、离开、保存分组排列',
  );
  await page.getByTestId('open-review-export').click();
  await page.getByRole('heading', { name: '导出与发布' }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-review-package').click();
  const reviewDownload = await downloadPromise;
  assert.match(reviewDownload.suggestedFilename(), /只读评审包\.zip$/);

  const canvasHint = page.getByTestId('canvas-controls-hint');
  await canvasHint.waitFor();
  const guidedViewportBox = await page.getByTestId('canvas-viewport').boundingBox();
  if (!guidedViewportBox) throw new Error('无法读取首次提示存在时的画布高度');
  await page.getByRole('button', { name: '关闭画布操作提示' }).click();
  assert.equal(await canvasHint.count(), 0, '关闭后应立即隐藏画布操作提示');
  assert.equal(await page.getByTestId('canvas-controls').getAttribute('data-layout'), 'floating');
  const floatingViewportBox = await page.getByTestId('canvas-viewport').boundingBox();
  if (!floatingViewportBox) throw new Error('无法读取关闭提示后的画布高度');
  assert.equal(floatingViewportBox.height, guidedViewportBox.height, '关闭提示不得改变画布尺寸与点击坐标');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('canvas-viewport').waitFor();
  assert.equal(await page.getByTestId('canvas-controls-hint').count(), 0, '刷新后不应再次显示已关闭的画布操作提示');
  assert.equal(await page.getByTestId('canvas-controls').getAttribute('data-layout'), 'floating');
  const mappingTree = page.locator('#spec-binding-tree');
  await mappingTree.getByTestId('spec-page-group-TASK-PAGE-BOARD').waitFor();
  assert.equal(await mappingTree.getByRole('tab', { name: /需复核/ }).count(), 0, '没有映射异常时不显示需复核入口');
  assert.equal(await mappingTree.getByRole('button', { name: /任务执行.*页面/ }).count(), 0, '模块不能占据页面导航树层级');
  assert.equal(await mappingTree.getByText('当前页', { exact: true }).count(), 0, '左侧不应镜像中间页面的当前页状态');
  const currentPageButton = mappingTree.getByTestId('spec-page-group-TASK-PAGE-BOARD').getByRole('button').first();
  assert.equal(await currentPageButton.getAttribute('aria-expanded'), 'false', '初始页面树不应跟随中间页面自动展开');
  await currentPageButton.click();
  await mappingTree.getByTestId('spec-card-TASK-ACTION-CREATE').waitFor();
  assert.equal(await currentPageButton.getAttribute('aria-expanded'), 'true', '点击页面行应展开节点并可单向驱动中间页面');
  await currentPageButton.click();
  await mappingTree.getByTestId('spec-card-TASK-ACTION-CREATE').waitFor({ state: 'hidden' });
  assert.equal(await currentPageButton.getAttribute('aria-expanded'), 'false', '再次点击页面行应只收起左侧节点');
  await currentPageButton.click();
  await mappingTree.getByTestId('spec-card-TASK-ACTION-CREATE').waitFor();
  assert.equal(await currentPageButton.getAttribute('aria-expanded'), 'true', '收起后再次点击应恢复展开');

  const frame = page.locator('iframe[title="功能页面"]');
  const scrollBeforeSelection = await frame.evaluate(frameElement => {
    const body = frameElement.contentDocument?.body;
    const view = frameElement.contentWindow;
    if (!body || !view) throw new Error('功能页面 iframe 尚未载入');
    body.style.paddingBottom = '1800px';
    view.scrollTo(0, body.scrollHeight);
    return view.scrollY;
  });
  assert.ok(scrollBeforeSelection > 500, '测试页面应先滚离候选 DOM');

  await page.getByTestId('spec-card-TASK-ACTION-CREATE').click();
  assert.equal(
    await page.getByRole('tab', { name: '页面映射' }).getAttribute('aria-selected'),
    'true',
    '待映射节点应直接进入页面映射处理候选',
  );
  assert.equal(
    await page.getByTestId('inspector-mapping-status').innerText(),
    '待映射',
    '进入页面映射后仍应直接看到当前映射状态',
  );
  await page.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    const outline = shadow?.querySelector('.outline.suggestion');
    const rect = outline?.getBoundingClientRect();
    return Boolean(
      outline && rect &&
      shadow?.querySelector('.suggestion-label')?.textContent?.includes('新建任务') &&
      rect.top >= 0 && rect.left >= 0 &&
      rect.bottom <= (frameElement?.contentWindow?.innerHeight ?? 0) &&
      rect.right <= (frameElement?.contentWindow?.innerWidth ?? 0),
    );
  });
  const candidateLocation = await frame.evaluate(frameElement => {
    const shadow = frameElement.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    const outline = shadow?.querySelector('.outline.suggestion');
    const rect = outline?.getBoundingClientRect();
    return {
      outlineCount: shadow?.querySelectorAll('.outline.suggestion').length ?? 0,
      eligibleCount: shadow?.querySelectorAll('.outline.eligible-target').length ?? 0,
      label: shadow?.querySelector('.suggestion-label')?.textContent ?? '',
      outlineWithinViewport: Boolean(
        rect && rect.top >= 0 && rect.left >= 0 &&
        rect.bottom <= (frameElement.contentWindow?.innerHeight ?? 0) &&
        rect.right <= (frameElement.contentWindow?.innerWidth ?? 0)
      ),
    };
  });
  assert.deepEqual(candidateLocation, {
    outlineCount: 1,
    eligibleCount: 0,
    label: '候选定位 · 新建任务',
    outlineWithinViewport: true,
  });

  const beforeInlineProjection = JSON.parse(await readFile(specPath, 'utf8'));
  const beforeInlineNode = beforeInlineProjection.modules
    .flatMap(module => module.nodes)
    .find(node => node.id === 'TASK-ACTION-CREATE');
  if (!beforeInlineNode) throw new Error('测试 Spec 缺少 TASK-ACTION-CREATE');
  await page.getByRole('tab', { name: '操作定义' }).click();
  assert.equal(await page.getByTestId('content-block-anchor-hints').count(), 0, '页面匹配提示不应出现在操作定义阅读视图');
  const inlineBlock = page.getByTestId('content-block-intent');
  await inlineBlock.dblclick();
  assert.equal(await inlineBlock.getAttribute('data-inline-editing'), 'true');
  const inlineContent = '记录一项新的待办工作，并保留当前上下文。';
  await page.getByLabel('使用意图内容').fill(inlineContent);
  await mkdir(resolve(root, 'output/playwright'), { recursive: true });
  await page.screenshot({ path: inlineEditScreenshotPath, fullPage: true });
  await page.getByRole('button', { name: '保存此项' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="content-block-intent"]')?.getAttribute('data-inline-editing') === 'false');
  const afterInlineProjection = JSON.parse(await readFile(specPath, 'utf8'));
  const afterInlineNode = afterInlineProjection.modules
    .flatMap(module => module.nodes)
    .find(node => node.id === 'TASK-ACTION-CREATE');
  assert.equal(afterInlineNode.contentBlocks.find(block => block.id === 'intent')?.content, inlineContent);
  assert.deepEqual(
    afterInlineNode.contentBlocks.filter(block => block.id !== 'intent'),
    beforeInlineNode.contentBlocks.filter(block => block.id !== 'intent'),
    '单条编辑必须保留其他内容块原样',
  );
  assert.match(await readFile(sourceSpecPath, 'utf8'), new RegExp(inlineContent));

  const statusBlock = page.getByTestId('content-block-status');
  await statusBlock.dblclick();
  await page.getByLabel('状态内容').fill('`reviewing`');
  await page.getByRole('button', { name: '保存此项' }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="content-block-status"]')?.getAttribute('data-inline-editing') === 'false');
  const afterStatusProjection = JSON.parse(await readFile(specPath, 'utf8'));
  const afterStatusNode = afterStatusProjection.modules
    .flatMap(module => module.nodes)
    .find(node => node.id === 'TASK-ACTION-CREATE');
  assert.equal(afterStatusNode.status, 'reviewing', '状态内容块单条编辑必须同步结构化 status');
  assert.equal(afterStatusNode.contentBlocks.find(block => block.id === 'status')?.content, '`reviewing`');
  assert.match(await readFile(sourceSpecPath, 'utf8'), /- 状态：`reviewing`/);

  const repeatedCandidateScroll = await frame.evaluate(frameElement => {
    const body = frameElement.contentDocument?.body;
    const view = frameElement.contentWindow;
    if (!body || !view) throw new Error('功能页面 iframe 尚未载入');
    view.scrollTo(0, body.scrollHeight);
    return view.scrollY;
  });
  assert.ok(repeatedCandidateScroll > 500, '重复定位前应再次滚离候选 DOM');
  await page.getByTestId('spec-card-TASK-ACTION-CREATE').click();
  assert.equal(
    await page.getByRole('tab', { name: '操作定义' }).getAttribute('aria-selected'),
    'true',
    '重复点击当前节点应保留用户手动选择的操作定义标签',
  );
  await page.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    const rect = shadow?.querySelector('.outline.suggestion')?.getBoundingClientRect();
    return Boolean(rect && rect.top >= 0 && rect.bottom <= (frameElement?.contentWindow?.innerHeight ?? 0));
  });
  await mkdir(resolve(root, 'output/playwright'), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.getByRole('tab', { name: '页面映射' }).click();
  const confirmCandidate = page.getByRole('button', { name: '确认映射' });
  await confirmCandidate.waitFor();
  assert.equal(JSON.parse(await readFile(mapPath, 'utf8')).items.length, 0, '候选定位不能自动写入 Map');
  await confirmCandidate.click();
  assert.equal(
    await page.getByRole('tab', { name: '操作定义' }).getAttribute('aria-selected'),
    'true',
    '确认候选映射成功后应自动回到操作定义',
  );
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="map-save-status"]')?.getAttribute('aria-label') !== '已自动保存');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="map-save-status"]')?.getAttribute('aria-label') === '已自动保存');
  const mapAfterCandidateConfirmation = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.equal(mapAfterCandidateConfirmation.items.length, 1, '确认候选后应保存单项 Map');
  const createMappingBeforeReselect = mapAfterCandidateConfirmation.items.find(
    item => item.body.id === 'TASK-ACTION-CREATE',
  );
  if (!createMappingBeforeReselect) throw new Error('确认候选后缺少 TASK-ACTION-CREATE 映射');
  await page.getByRole('tab', { name: '页面映射' }).click();
  await page.getByRole('button', { name: '重新选择页面位置' }).click();
  const createCard = page.getByTestId('spec-card-TASK-ACTION-CREATE');
  assert.match(
    await createCard.innerText(),
    /重新选择页面位置/,
    '已有映射进入定位态时，不能继续显示首次绑定提示',
  );
  await page.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    return Boolean(shadow?.querySelector('.outline:not(.suggestion):not(.eligible-target)'));
  });
  const existingTarget = await frame.evaluate(frameElement => {
    const shadow = frameElement.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    const rect = shadow
      ?.querySelector('.outline:not(.suggestion):not(.eligible-target)')
      ?.getBoundingClientRect();
    if (!rect) throw new Error('页面缺少已有映射标记');
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      frameWidth: frameElement.clientWidth,
      frameHeight: frameElement.clientHeight,
    };
  });
  const frameBoxForReselect = await frame.boundingBox();
  if (!frameBoxForReselect) throw new Error('无法读取重新定位时的 iframe 位置');
  const reselectPoint = {
    x: frameBoxForReselect.x + existingTarget.x * (frameBoxForReselect.width / existingTarget.frameWidth),
    y: frameBoxForReselect.y + existingTarget.y * (frameBoxForReselect.height / existingTarget.frameHeight),
  };
  await page.mouse.click(reselectPoint.x, reselectPoint.y);
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="frame-interaction-layer"]')?.getAttribute('data-mapping-active') === 'false');
  await page.waitForTimeout(700);
  assert.equal(await page.getByTestId('map-save-status').getAttribute('aria-label'), '已自动保存');
  const mapAfterReselect = JSON.parse(await readFile(mapPath, 'utf8'));
  const createMappingAfterReselect = mapAfterReselect.items.find(item => item.body.id === 'TASK-ACTION-CREATE');
  assert.notEqual(
    createMappingAfterReselect?.confirmedAt,
    createMappingBeforeReselect.confirmedAt,
    '点击已有标记覆盖的原位置时，必须重新写入映射而不是只退出定位态',
  );
  assert.equal(
    createMappingAfterReselect?.target.selector.value,
    createMappingBeforeReselect.target.selector.value,
    '重新选择同一位置后应保持目标选择器稳定',
  );
  await frame.evaluate(frameElement => {
    if (frameElement.contentDocument?.body) frameElement.contentDocument.body.style.paddingBottom = '';
  });

  const panToggle = page.getByTestId('canvas-pan-toggle');
  assert.equal(await panToggle.getAttribute('aria-pressed'), 'false');
  const canvasBeforePan = await page.getByTestId('target-canvas').boundingBox();
  if (!canvasBeforePan) throw new Error('无法读取拖动画布前的位置');
  await panToggle.click();
  assert.equal(await panToggle.getAttribute('aria-pressed'), 'true');
  await frame.evaluate(frameElement => {
    const view = frameElement.contentWindow;
    if (!view) throw new Error('功能页面 iframe 尚未载入');
    view.dispatchEvent(new view.KeyboardEvent('keydown', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }));
    view.dispatchEvent(new view.KeyboardEvent('keyup', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }));
  });
  assert.equal(
    await panToggle.getAttribute('aria-pressed'),
    'true',
    '空格松开不能关闭按钮开启的持续平移模式',
  );
  const interactionLayer = page.getByTestId('frame-interaction-layer');
  const interactionBox = await interactionLayer.boundingBox();
  if (!interactionBox) throw new Error('无法读取画布交互层');
  await page.mouse.move(interactionBox.x + interactionBox.width / 2, interactionBox.y + interactionBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    interactionBox.x + interactionBox.width / 2 + 72,
    interactionBox.y + interactionBox.height / 2 + 36,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  const canvasAfterPan = await page.getByTestId('target-canvas').boundingBox();
  if (!canvasAfterPan) throw new Error('无法读取拖动画布后的位置');
  assert.ok(
    Math.abs(canvasAfterPan.x - canvasBeforePan.x) > 30 ||
      Math.abs(canvasAfterPan.y - canvasBeforePan.y) > 20,
    '开启拖动画布后，应能在 iframe 上方直接平移画布',
  );
  await panToggle.click();
  assert.equal(await panToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(
    await interactionLayer.evaluate(element => getComputedStyle(element).pointerEvents),
    'none',
    '关闭拖动画布后应恢复 iframe 页面操作',
  );

  const canvasBeforeSpacePan = await page.getByTestId('target-canvas').boundingBox();
  if (!canvasBeforeSpacePan) throw new Error('无法读取空格拖动画布前的位置');
  await frame.evaluate(frameElement => {
    const view = frameElement.contentWindow;
    if (!view) throw new Error('功能页面 iframe 尚未载入');
    view.dispatchEvent(new view.KeyboardEvent('keydown', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }));
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="canvas-pan-toggle"]')?.getAttribute('aria-pressed') === 'true');
  const spaceInteractionBox = await interactionLayer.boundingBox();
  if (!spaceInteractionBox) throw new Error('无法读取空格平移交互层');
  await page.mouse.move(
    spaceInteractionBox.x + spaceInteractionBox.width / 2,
    spaceInteractionBox.y + spaceInteractionBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    spaceInteractionBox.x + spaceInteractionBox.width / 2 - 64,
    spaceInteractionBox.y + spaceInteractionBox.height / 2 - 32,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForFunction(before => {
    const after = document.querySelector('[data-testid="target-canvas"]')?.getBoundingClientRect();
    return after && (Math.abs(after.x - before.x) > 25 || Math.abs(after.y - before.y) > 15);
  }, canvasBeforeSpacePan);
  const canvasAfterSpacePan = await page.getByTestId('target-canvas').boundingBox();
  if (!canvasAfterSpacePan) throw new Error('无法读取空格拖动画布后的位置');
  assert.ok(
    Math.abs(canvasAfterSpacePan.x - canvasBeforeSpacePan.x) > 25 ||
      Math.abs(canvasAfterSpacePan.y - canvasBeforeSpacePan.y) > 15,
    'iframe 获得焦点后，按住空格仍应能平移画布',
  );
  await frame.evaluate(frameElement => {
    const view = frameElement.contentWindow;
    if (!view) throw new Error('功能页面 iframe 尚未载入');
    view.dispatchEvent(new view.KeyboardEvent('keyup', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }));
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="canvas-pan-toggle"]')?.getAttribute('aria-pressed') === 'false');
  assert.equal(
    await interactionLayer.evaluate(element => getComputedStyle(element).pointerEvents),
    'none',
    '松开空格后应立即恢复 iframe 页面操作',
  );
  await frame.evaluate(frameElement => {
    const view = frameElement.contentWindow;
    const input = frameElement.contentDocument?.querySelector('input');
    if (!view || !input) throw new Error('测试页面缺少可编辑输入框');
    input.dispatchEvent(new view.KeyboardEvent('keydown', {
      key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }));
  });
  await page.waitForTimeout(50);
  assert.equal(
    await panToggle.getAttribute('aria-pressed'),
    'false',
    '输入框中的空格必须保留输入语义，不能启动画布平移',
  );

  assert.equal(
    await page.getByRole('button', { name: /确认本页/ }).count(),
    0,
    '候选映射必须逐项检查，不能保留批量确认入口',
  );
  for (const nodeId of ['TASK-SURFACE-BOARD', 'TASK-ACTION-FILTER-OVERDUE']) {
    await page.getByTestId(`spec-card-${nodeId}`).click();
    const confirmMapping = page.getByRole('button', { name: '确认映射' });
    await confirmMapping.waitFor();
    await confirmMapping.click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="map-save-status"]')?.getAttribute('aria-label') !== '已自动保存');
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="map-save-status"]')?.getAttribute('aria-label') === '已自动保存');
  }
  const savedMap = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.deepEqual(
    savedMap.items.map(item => item.body.id).sort(),
    [
      'TASK-ACTION-CREATE',
      'TASK-ACTION-FILTER-OVERDUE',
      'TASK-SURFACE-BOARD',
    ],
    '同源 Spec 与页面应逐项确认三个唯一高置信候选，并保留重复控件的人工复核',
  );
  const repeatedMappedScroll = await frame.evaluate(frameElement => {
    const body = frameElement.contentDocument?.body;
    const view = frameElement.contentWindow;
    if (!body || !view) throw new Error('功能页面 iframe 尚未载入');
    body.style.paddingBottom = '1800px';
    view.scrollTo(0, body.scrollHeight);
    return view.scrollY;
  });
  assert.ok(repeatedMappedScroll > 500, '人工映射重复定位前应先滚离已关联 DOM');
  await page.getByTestId('spec-card-TASK-ACTION-CREATE').click();
  assert.equal(
    await page.getByRole('tab', { name: '操作定义' }).getAttribute('aria-selected'),
    'true',
    '切换到已关联节点应进入操作定义，同时恢复页面定位',
  );
  assert.equal(
    await page.getByTestId('inspector-mapping-status').innerText(),
    '已关联',
    '进入操作定义后仍应直接看到当前映射状态',
  );
  await page.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    const rect = shadow?.querySelector('.outline:not(.suggestion):not(.eligible-target)')?.getBoundingClientRect();
    return Boolean(rect && rect.top >= 0 && rect.bottom <= (frameElement?.contentWindow?.innerHeight ?? 0));
  });
  await frame.evaluate(frameElement => {
    if (frameElement.contentDocument?.body) frameElement.contentDocument.body.style.paddingBottom = '';
  });
  await page.getByText('标记完成', { exact: true }).first().waitFor();
  const projectionSource = await readFile(example('product.spec.json'), 'utf8');
  assert.doesNotMatch(projectionSource, /"(?:selector|fingerprint)"\s*:/);

  const initialZoom = Number(await viewport.getAttribute('data-zoom'));
  await page.locator('iframe[title="功能页面"]').evaluate(async frame => {
    const target = frame.contentWindow;
    if (!target) throw new Error('功能页面 iframe 尚未载入');
    for (let index = 0; index < 4; index += 1) {
      target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 240,
        clientY: 180,
        ctrlKey: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -48,
      }));
      await new Promise(resolveDelay => setTimeout(resolveDelay, 18));
    }
  });
  await page.waitForFunction(
    initial => Number(document.querySelector('[data-testid="canvas-viewport"]')?.getAttribute('data-zoom')) > initial,
    initialZoom,
  );

  const continuityToken = `mode-continuity-${Date.now()}`;
  await frame.evaluate((frameElement, token) => {
    frameElement.dataset.modeContinuity = token;
    frameElement.contentWindow.__ipsModeContinuity = token;
  }, continuityToken);
  const assertFrameContinuity = async mode => {
    await page.waitForTimeout(120);
    const continuity = await frame.evaluate(frameElement => ({
      element: frameElement.dataset.modeContinuity ?? '',
      contentWindow: frameElement.contentWindow?.__ipsModeContinuity ?? '',
    }));
    assert.deepEqual(continuity, {
      element: continuityToken,
      contentWindow: continuityToken,
    }, `${mode}切换不能重建 iframe 或重新载入页面`);
  };

  await page.getByRole('tab', { name: '评审模式' }).click();
  assert.equal(await page.getByRole('tab', { name: '评审模式' }).getAttribute('aria-selected'), 'true');
  await assertFrameContinuity('评审模式');
  await page.getByRole('button', { name: /查找 Spec/ }).click();
  await page.getByTestId('spec-card-TASK-ACTION-CREATE').press('Enter');
  await page.getByRole('button', { name: '关闭 Spec 查找' }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '页面映射' }).count(), 0, '评审详情不应展示页面映射标签');
  assert.equal(await page.getByRole('button', { name: /编辑完整/ }).count(), 0, '评审模式不应展示 Spec 编辑入口');
  assert.equal(await page.getByRole('button', { name: '当前只读' }).count(), 0, '只读模式不占用编辑工具栏');
  await page.setViewportSize({ width: 1000, height: 870 });
  await page.getByRole('button', { name: '返回 Spec 列表' }).click();
  await page.getByTestId('spec-card-TASK-ACTION-CREATE').waitFor();
  await page.getByTestId('spec-card-TASK-ACTION-CREATE').press('Enter');
  await page.getByRole('button', { name: '返回 Spec 列表' }).waitFor();
  await page.setViewportSize({ width: 1626, height: 870 });
  await page.getByRole('button', { name: '固定详情' }).click();
  await assertFrameContinuity('评审模式固定详情');

  await page.getByRole('tab', { name: '绑定模式' }).click();
  assert.equal(await page.getByRole('tab', { name: '绑定模式' }).getAttribute('aria-selected'), 'true');
  await assertFrameContinuity('绑定模式');

  await page.getByRole('tab', { name: '评审模式' }).click();
  await assertFrameContinuity('再次进入评审模式');

  await page.getByRole('button', { name: '离开当前工作台' }).click();
  await page.getByRole('button', { name: '继续 Spec 绑定' }).waitFor();
  await page.getByRole('button', { name: '切换项目或文件' }).waitFor();

  const discoveryHtmlPath = join(temp, 'cross-page.html');
  const discoverySpecPath = join(temp, 'cross-page.product.spec.json');
  const discoverySourcePath = join(temp, 'cross-page.spec.md');
  const discoveryMapPath = join(temp, 'cross-page.spec-map.json');
  const discoveryStatePath = join(temp, 'cross-page-projects.json');
  discoveryDelayServer = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(204);
      response.end();
    }, 450);
  });
  await new Promise((resolveListen, rejectListen) => {
    discoveryDelayServer.once('error', rejectListen);
    discoveryDelayServer.listen(0, '127.0.0.1', resolveListen);
  });
  const discoveryDelayAddress = discoveryDelayServer.address();
  if (!discoveryDelayAddress || typeof discoveryDelayAddress === 'string') {
    throw new Error('无法启动候选定位延迟资源服务');
  }
  await writeFile(discoveryHtmlPath, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>候选探查测试</title>
<style>body{font-family:sans-serif;padding:32px}button{display:block;margin:16px;padding:12px}</style></head>
<body><script>if(window.frameElement?.title==='候选路由校验')document.write('<img hidden alt="" src="http://127.0.0.1:${discoveryDelayAddress.port}/slow-resource">')</script><main id="root"><h1>协作首页</h1><button class="circle-plus"><svg aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button><button id="discard-voice">清除语音</button><button id="delete-data">删除全部数据</button><button id="open-profile">查看联系人资料</button></main>
<script>
document.querySelector('#delete-data').onclick=()=>localStorage.setItem('ips-danger-clicked','1');
document.querySelector('#discard-voice').onclick=()=>localStorage.setItem('ips-candidate-invoked','1');
const renderProfile=()=>{document.querySelector('#root').innerHTML='<h1>联系人资料</h1><button id="online-call">在线通话</button><button id="remove-contact">删除联系人</button>';document.querySelector('#online-call').onclick=()=>localStorage.setItem('ips-candidate-invoked','1');document.querySelector('#remove-contact').onclick=()=>localStorage.setItem('ips-danger-clicked','1')};
const renderWeak=()=>{document.querySelector('#root').innerHTML='<h1>权重候选页</h1><button id="weak-match">归档临时内容并检查档审字段及审计记录</button>'};
document.querySelector('#open-profile').onclick=()=>{location.hash='profile';renderProfile()};
addEventListener('hashchange',()=>{if(location.hash==='#profile')renderProfile();if(location.hash==='#weak')renderWeak()});
if(location.hash==='#profile')renderProfile();
if(location.hash==='#weak')renderWeak();
</script></body></html>`, 'utf8');
  const discoverySpec = {
    schemaVersion: '0.1',
    product: {
      id: 'CROSS-PAGE-CANDIDATE', title: '跨页面候选测试', version: '0.1.0',
      status: 'reviewing', description: '验证安全的跨页面候选定位。', sourceRefs: [discoveryHtmlPath],
    },
    modules: [{
      id: 'COLLAB', title: '消息协作', purpose: '定位联系人操作。', scope: '只读导航。', journeys: ['从首页进入联系人资料'],
      pages: [
        { id: 'HOME', title: '协作首页', responsibility: '提供新增与联系人资料入口。', anchorHints: ['协作首页'] },
        { id: 'PROFILE', title: '联系人资料', responsibility: '展示联系人操作。', routeHints: ['#profile'], anchorHints: ['联系人资料', '在线通话'] },
        { id: 'WEAK', title: '权重候选页', responsibility: '验证低权重候选不自动跳转。', routeHints: ['#weak'], anchorHints: ['权重候选页'] },
      ],
      nodes: [
        {
          id: 'COLLAB-ACTION-CREATE-GROUP', type: 'ACTION', title: '创建中心业务群', pageId: 'HOME',
          status: 'reviewing', sourceKind: 'product-decision', statement: '用户从首页新增入口创建中心业务群。',
          anchorHints: ['创建中心业务群', '新增'], contentBlocks: [{ id: 'definition', label: '定义', content: '创建中心业务群。' }], relations: [],
        },
        {
          id: 'COLLAB-ACTION-ONLINE-CALL', type: 'ACTION', title: '发起一对一在线视频', pageId: 'PROFILE',
          status: 'reviewing', sourceKind: 'product-decision', statement: '用户从联系人资料发起在线通话。',
          anchorHints: ['在线通话', '视频通话'], contentBlocks: [{ id: 'definition', label: '定义', content: '发起一对一在线视频。' }], relations: [],
        },
        {
          id: 'COLLAB-ACTION-CLEAR-VOICE', type: 'ACTION', title: '清除本次未保存的语音回填', pageId: 'HOME',
          status: 'reviewing', sourceKind: 'product-decision', statement: '用户清除本次尚未保存的语音回填。',
          anchorHints: [], contentBlocks: [{ id: 'definition', label: '定义', content: '清除本次未保存的语音回填。' }], relations: [],
        },
        {
          id: 'COLLAB-ACTION-WEAK-ROUTE', type: 'ACTION', title: '低权重路由候选', pageId: 'WEAK',
          status: 'reviewing', sourceKind: 'product-decision', statement: '先打开明确页面，再辅助定位页面内候选。',
          anchorHints: ['归档审计'], contentBlocks: [{ id: 'definition', label: '定义', content: '验证低权重自动跳转门槛。' }], relations: [],
        },
      ],
    }, {
      id: 'SECONDARY', title: '次要模块', purpose: '验证旧版跨模块页面竞争。', scope: '不写入映射。', journeys: ['从首页查看次要信息'],
      pages: [{
        id: 'SECONDARY-HOME', title: '协作首页', responsibility: '展示次要协作记录。',
        anchorHints: ['不存在的证据'],
      }],
      nodes: [{
        id: 'SECONDARY-ACTION-REVIEW', type: 'ACTION', title: '归档质控结果', pageId: 'SECONDARY-HOME',
        status: 'reviewing', sourceKind: 'product-decision', statement: '用户归档质控结果。',
        anchorHints: ['不存在的证据'], contentBlocks: [{ id: 'definition', label: '定义', content: '归档质控结果。' }], relations: [],
      }],
    }],
  };
  await writeFile(discoverySpecPath, `${JSON.stringify(discoverySpec, null, 2)}\n`, 'utf8');
  await writeFile(discoverySourcePath, '# 跨页面候选测试\n\n`COLLAB-ACTION-ONLINE-CALL` 发起一对一在线视频。\n', 'utf8');
  await writeFile(
    discoveryMapPath,
    `${JSON.stringify(createEmptySpecMap('CROSS-PAGE-CANDIDATE', discoveryHtmlPath), null, 2)}\n`,
    'utf8',
  );
  discoveryStudio = await startWorkbench({
    appRoot: root,
    statePath: discoveryStatePath,
    mode: 'map',
    htmlPath: discoveryHtmlPath,
    specPath: discoverySpecPath,
    sourceSpecPath: discoverySourcePath,
    mapPath: discoveryMapPath,
    host: '127.0.0.1',
    port: 0,
  });
  const discoveryPage = await browser.newPage({ viewport: { width: 1500, height: 820 } });
  await discoveryPage.goto(discoveryStudio.url, { waitUntil: 'networkidle' });
  const discoveryFrame = discoveryPage.locator('iframe[title="功能页面"]');
  await discoveryFrame.evaluate(frameElement => {
    frameElement.contentWindow?.localStorage.removeItem('ips-danger-clicked');
    frameElement.contentWindow?.localStorage.removeItem('ips-candidate-invoked');
  });
  const discoveryTree = discoveryPage.locator('#spec-binding-tree');
  assert.equal(await discoveryTree.getByText('当前页', { exact: true }).count(), 0, '左侧不应展示随中间页面变化的当前页徽标');
  assert.equal(await discoveryTree.getByTestId('spec-card-SECONDARY-ACTION-REVIEW').count(), 0, '页面节点初始保持收起');
  const collaborationPageButton = discoveryTree.getByTestId('spec-page-group-HOME').getByRole('button').first();
  await collaborationPageButton.click();
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-CREATE-GROUP').waitFor();
  await discoveryPage.getByTestId('spec-card-COLLAB-ACTION-CREATE-GROUP').click();
  await discoveryPage.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    return shadow?.querySelector('.suggestion-label')?.textContent?.includes('新增');
  });
  assert.equal(
    await discoveryPage.locator('iframe[title="候选路由校验"]').count(),
    0,
    '当前页已经算出的唯一候选应直接定位，不能启动隐藏路由校验 iframe',
  );
  assert.equal(
    await discoveryPage.getByText(/首次查找「创建中心业务群」/).isVisible(),
    false,
    '当前页候选定位不能再显示查找提示',
  );
  assert.equal(
    await discoveryFrame.evaluate(frameElement => frameElement.contentWindow?.location.hash ?? ''),
    '',
    '直接定位只高亮候选，不能执行候选动作',
  );
  await discoveryPage.evaluate(() => {
    window.__ipsLowConfidenceSearchSeen = false;
    window.__ipsLowConfidenceObserver = new MutationObserver(() => {
      if (document.body?.innerText.includes('首次查找「清除本次未保存的语音回填」')) {
        window.__ipsLowConfidenceSearchSeen = true;
      }
    });
    window.__ipsLowConfidenceObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await discoveryPage.getByTestId('spec-card-COLLAB-ACTION-CLEAR-VOICE').click();
  await discoveryPage.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    return shadow?.querySelector('.suggestion-label')?.textContent?.includes('清除语音');
  });
  assert.equal(await discoveryPage.locator('iframe[title="候选路由校验"]').count(), 0, '低置信当前页匹配必须直接定位');
  assert.equal(
    await discoveryPage.evaluate(() => {
      window.__ipsLowConfidenceObserver?.disconnect();
      return window.__ipsLowConfidenceSearchSeen;
    }),
    false,
    '低置信当前页匹配不能闪现首次查找提示',
  );
  assert.equal(
    await discoveryFrame.evaluate(frameElement => frameElement.contentWindow?.localStorage.getItem('ips-candidate-invoked')),
    null,
    '低置信定位不能执行候选动作',
  );
  assert.equal(await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-ONLINE-CALL').count(), 0, '未主动展开的页面只保留页面行');
  const discoverySearch = discoveryTree.getByLabel('搜索 Spec');
  await discoverySearch.fill('归档质控结果');
  await discoveryTree.getByTestId('spec-card-SECONDARY-ACTION-REVIEW').waitFor();
  await discoveryTree.getByTestId('spec-card-SECONDARY-ACTION-REVIEW').click();
  await discoveryPage
    .getByText(/当前页没有可靠候选，且未配置明确路由，未自动跨页检索/)
    .waitFor({ timeout: 1000 });
  assert.equal(
    await discoveryPage.locator('iframe[title="候选页面探查"], iframe[title="候选路由校验"]').count(),
    0,
    '没有明确路由时必须立即提示，不能创建跨页检索 iframe',
  );
  assert.equal(
    await discoveryFrame.evaluate(frameElement => frameElement.contentWindow?.location.hash ?? ''),
    '',
    '没有明确路由时必须保留用户当前页面',
  );
  assert.equal(
    await discoveryPage.getByRole('tab', { name: '页面映射' }).getAttribute('aria-selected'),
    'true',
    '停止自动检索后应直接展示人工选择位置入口',
  );

  await discoverySearch.fill('低权重路由候选');
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-WEAK-ROUTE').waitFor();
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-WEAK-ROUTE').click();
  await discoveryPage.waitForFunction(() => document.querySelector('iframe[title="功能页面"]')?.contentWindow?.location.hash === '#weak');
  assert.equal(
    await discoveryFrame.evaluate(frameElement => frameElement.contentWindow?.location.hash ?? ''),
    '#weak',
    '明确页面的导航不能被页内元素匹配分数阻断',
  );
  assert.equal(
    await discoveryPage.locator('iframe[title="候选路由校验"]').count(),
    0,
    '权重判断完成后必须立即清理隐藏路由校验 iframe',
  );
  assert.equal(
    await discoveryPage.getByText(/首次查找/).count(),
    0,
    '低权重任务不得再显示持续的首次关联检索提示',
  );

  await discoverySearch.fill('发起一对一在线视频');
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-ONLINE-CALL').waitFor();
  await discoveryPage.evaluate(() => {
    window.__ipsFirstSearchToastSeen = false;
    window.__ipsFirstSearchObserver = new MutationObserver(() => {
      if (document.body?.innerText.includes('首次查找「发起一对一在线视频」')) {
        window.__ipsFirstSearchToastSeen = true;
      }
    });
    window.__ipsFirstSearchObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-ONLINE-CALL').click();
  try {
    await discoveryPage.waitForFunction(() => {
      const frameElement = document.querySelector('iframe[title="功能页面"]');
      const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
      return frameElement?.contentWindow?.location.hash === '#profile' &&
        shadow?.querySelector('.suggestion-label')?.textContent?.includes('在线通话');
    }, null, { timeout: 15000 });
  } catch (error) {
    const evidence = await discoveryFrame.evaluate(frameElement => ({
      hash: frameElement.contentWindow?.location.hash ?? '',
      heading: frameElement.contentDocument?.querySelector('h1')?.textContent ?? '',
      label: frameElement.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot?.querySelector('.suggestion-label')?.textContent ?? '',
    }));
    throw new Error(`routeHints 快速定位失败：${JSON.stringify(evidence)}`, { cause: error });
  }
  assert.equal(
    await discoveryPage.getByText(/首次查找「发起一对一在线视频」/).isVisible(),
    false,
    '可直接使用 routeHints 时不应显示首次查找提示',
  );
  assert.equal(
    await discoveryPage.evaluate(() => {
      window.__ipsFirstSearchObserver?.disconnect();
      return window.__ipsFirstSearchToastSeen;
    }),
    false,
    'routeHints 直接定位期间不能短暂闪现首次查找提示',
  );
  const discoveryEvidence = await discoveryFrame.evaluate(frameElement => ({
    hash: frameElement.contentWindow?.location.hash ?? '',
    danger: frameElement.contentWindow?.localStorage.getItem('ips-danger-clicked'),
    candidateInvoked: frameElement.contentWindow?.localStorage.getItem('ips-candidate-invoked'),
    label: frameElement.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot?.querySelector('.suggestion-label')?.textContent ?? '',
  }));
  assert.deepEqual(discoveryEvidence, {
    hash: '#profile',
    danger: null,
    candidateInvoked: null,
    label: '候选定位 · 在线通话',
  }, '显式高置信路由只能定位候选，不得执行候选动作');
  assert.equal(JSON.parse(await readFile(discoveryMapPath, 'utf8')).items.length, 0, '跨页面候选定位不能自动写入 Map');
  await discoveryPage
    .getByText(/首次查找「发起一对一在线视频」/)
    .waitFor({ state: 'hidden', timeout: 5000 });
  await discoverySearch.fill('');

  await discoveryFrame.evaluate(frameElement => {
    const view = frameElement.contentWindow;
    if (!view) throw new Error('功能页面 iframe 尚未载入');
    view.location.href = `${view.location.pathname}${view.location.search}`;
  });
  await discoveryPage.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    return frameElement?.contentWindow?.location.hash === '' &&
      frameElement?.contentDocument?.querySelector('h1')?.textContent === '协作首页';
  });
  const profilePageButton = discoveryTree.getByTestId('spec-page-group-PROFILE').getByRole('button').first();
  const selectedOnlineCall = discoveryTree.getByTestId('spec-card-COLLAB-ACTION-ONLINE-CALL');
  await selectedOnlineCall.waitFor();
  assert.equal(await profilePageButton.getAttribute('aria-expanded'), 'true', '中间页面浏览不能收起左侧正在处理的页面');
  assert.equal(await selectedOnlineCall.getAttribute('aria-pressed'), 'true', '中间页面浏览不能改变左侧当前选中节点');
  await discoverySearch.fill('发起一对一在线视频');
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-ONLINE-CALL').click();
  assert.equal(
    await discoveryPage.locator('iframe[title="候选路由校验"]').count(),
    0,
    '直接导航不应启动隐藏候选路由校验',
  );
  assert.equal(
    await discoveryPage.getByText(/首次查找「发起一对一在线视频」/).isVisible(),
    false,
    '重复点击已知页面不应显示查找提示',
  );
  await discoveryPage.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    const shadow = frameElement?.contentDocument?.querySelector('#ips-overlay-host')?.shadowRoot;
    return frameElement?.contentWindow?.location.hash === '#profile' &&
      shadow?.querySelector('.suggestion-label')?.textContent?.includes('在线通话');
  }, null, { timeout: 15000 });

  await discoverySearch.fill('');
  await discoveryFrame.evaluate(frameElement => {
    const view = frameElement.contentWindow;
    if (!view) throw new Error('功能页面 iframe 尚未载入');
    view.location.href = `${view.location.pathname}${view.location.search}`;
  });
  await discoveryPage.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    return frameElement?.contentWindow?.location.hash === '' &&
      frameElement?.contentDocument?.querySelector('h1')?.textContent === '协作首页';
  });
  await profilePageButton.click();
  assert.equal(await profilePageButton.getAttribute('aria-expanded'), 'false', '收起左侧页面不应改变中间页面');
  assert.equal(await discoveryFrame.evaluate(frameElement => frameElement.contentWindow?.location.hash ?? ''), '');
  await profilePageButton.click();
  await discoveryPage.waitForFunction(() => {
    const frameElement = document.querySelector('iframe[title="功能页面"]');
    return frameElement?.contentWindow?.location.hash === '#profile' &&
      frameElement?.contentDocument?.querySelector('h1')?.textContent === '联系人资料';
  });
  await discoveryTree.getByTestId('spec-card-COLLAB-ACTION-ONLINE-CALL').waitFor();

  console.log('关键浏览器旅程通过：画布提示按项目关闭并保留悬浮工具条，关闭不改变画布尺寸；顶部状态/离开/保存顺序正确，单条内容双击编辑只写目标项且结构化镜像同步；当前页候选直接读取实时 DOM 定位，跨页面按 routeHints 先导航再定位；左侧可单向导航中间页面，中间浏览不改变左侧展开与选中；候选与人工映射每次点击均重新定位且不执行业务动作、不写 Map；空格临时平移和底栏持续平移在 iframe 焦点下均可用；批量确认、歧义复核、缩放、模式连续性和离开入口均通过');
} finally {
  if (discoveryStudio) await discoveryStudio.stop();
  if (discoveryDelayServer) {
    await new Promise(resolveClose => discoveryDelayServer.close(resolveClose));
  }
  await browser.close();
  await studio.stop();
}
