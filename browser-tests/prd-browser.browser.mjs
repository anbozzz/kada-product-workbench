import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { startStudio } from '../src/server.mjs';
import { makeReadOnlyReviewConfig } from '../src/review-package.mjs';

const root = resolve(import.meta.dirname, '..');
const source = `# 页面相关 PRD 示例产品需求文档

<!-- prd-profile: 可映射PRD-v1 -->

> 文档状态：草稿
> 适用版本：v0.1

[reference]: <./参考 图片.png>

## 4. 详细功能说明

### 4.1 任务功能域

#### 4.1.1 新建任务
<!-- prd-section-id: 需求-任务-新建任务 -->

##### 创建任务的入口
帮助用户创建新的任务。
从任务板进入。
![正文参考图片](./reference.png)
![缺失图片](./missing.png)
![引用式中文图片][reference]
##### 创建成功
提交后页面出现新任务。
##### 标题为空时如何继续
标题不能为空；保留已填写内容，补齐后可再次提交。

##### 流程图

\`\`\`mermaid
flowchart LR
  A[填写任务] --> B{标题完整?}
  B -->|是| C[创建成功]
  B -->|否| D[保留输入并提示]
\`\`\`

#### 4.1.2 归档任务
<!-- prd-section-id: 需求-任务-归档任务 -->

##### 功能说明
帮助用户归档不再处理的任务。
##### 入口与页面
从任务板进入。
##### 用户操作与产品结果
确认后任务移入归档区。
##### 必要规则
归档前必须明确确认。

## 5. 全局产品规则

### 5.1 当前任务板
<!-- prd-section-id: 规则-任务上下文-当前任务板 -->

操作始终作用于当前任务板。

#### 失败重试
失败后可在本任务板重试。

## 6. 附录
普通说明。

`;

const temp = await mkdtemp(join(tmpdir(), 'ips-prd-browser-'));
const htmlPath = join(temp, 'index.html');
const prdPath = join(temp, '产品需求文档.md');
const prdMapPath = join(temp, 'prd-map.json');
const specPath = join(temp, 'product.spec.json');
const sourceSpecPath = join(temp, 'task-board.spec.md');
await writeFile(htmlPath, '<!doctype html><html><head><title>任务板</title></head><body><main><h1>任务板</h1><button>新建任务</button></main></body></html>', 'utf8');
await writeFile(prdPath, source, 'utf8');
await writeFile(join(temp, 'reference.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
await writeFile(join(temp, '参考 图片.png'), await readFile(join(temp, 'reference.png')));
await writeFile(specPath, await readFile(resolve(root, 'examples/task-board/product.spec.json')), 'utf8');
await writeFile(sourceSpecPath, await readFile(resolve(root, 'examples/task-board/task-board.spec.md')), 'utf8');

const studio = await startStudio({
  appRoot: root,
  statePath: join(temp, 'tool-state', 'projects.json'),
  host: '127.0.0.1',
  port: 0,
});
const confirm = await fetch(`${studio.url}api/project/confirm`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'PRD 与 Spec 同一工作台',
    projectPath: temp,
    sourceType: 'html',
    htmlPath,
    prdPath,
    specPath,
    sourceSpecPath,
    mapPolicy: 'tool',
    confirmMapCreate: true,
    confirmPrdMapCreate: true,
    mode: 'map',
  }),
});
assert.equal(confirm.status, 200);
const configWithImages = await confirm.json();
assert.match(configWithImages.prd.images['./reference.png'].src, /^data:image\/png;base64,/);

const browser = await launchHeadlessBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1626, height: 960 } });
  await page.goto(studio.url, { waitUntil: 'networkidle' });
  const relatedButton = page.getByTestId('related-prd');
  await page.getByTestId('work-mode-switch').waitFor();
  await page.getByRole('tab', { name: '绑定模式' }).waitFor();
  await page.getByRole('tab', { name: '评审模式' }).waitFor();
  await page.getByTestId('spec-binding-status').waitFor();
  assert.equal(await page.getByText('Spec 绑定', { exact: true }).count() > 0, true);
  await relatedButton.getByText('相关 PRD（0）').waitFor();
  await relatedButton.click();
  await page.getByRole('heading', { name: '页面相关 PRD 示例产品需求文档' }).first().waitFor();
  await page.getByRole('heading', { name: '标题为空时如何继续', exact: true }).waitFor();
  assert.equal(await page.getByText('标题不能为空；保留已填写内容，补齐后可再次提交。', { exact: true }).count(), 1);
  assert.equal(await page.getByText('显示完整产品文档', { exact: false }).count() > 0, true);
  assert.equal(await page.getByRole('checkbox', { name: '关联 归档任务' }).count(), 1, '绑定模式必须保留未关联章节');
  const inlineImage = page.getByRole('img', { name: '正文参考图片', exact: true });
  await inlineImage.waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector('img[alt="正文参考图片"]');
    return img?.complete && img.naturalWidth > 0;
  });
  assert.equal(await page.getByText('图片不存在或无法读取，请检查 PRD 引用路径。', { exact: true }).count(), 1);
  const imageCard = page.getByTestId('prd-image-card').first();
  const resizeImage = page.getByRole('separator', { name: '调整图片大小：正文参考图片' });
  const initialImageWidth = await imageCard.evaluate(el => el.getBoundingClientRect().width);
  await resizeImage.press('ArrowLeft');
  assert.ok(await imageCard.evaluate(el => el.getBoundingClientRect().width) < initialImageWidth, '图片支持键盘缩小');
  await resizeImage.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const pointer = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientY: rect.top, buttons: 1 };
    element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: rect.left }));
    element.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: rect.left - 90 }));
    element.dispatchEvent(new PointerEvent('pointerup', { ...pointer, clientX: rect.left - 90, buttons: 0 }));
  });
  await page.waitForTimeout(50);
  const shrunkenWidth = await imageCard.evaluate(el => el.getBoundingClientRect().width);
  assert.ok(shrunkenWidth < initialImageWidth - 70, '图片右下角应实际拖窄');
  await resizeImage.press('ArrowRight');
  assert.ok(await imageCard.evaluate(el => el.getBoundingClientRect().width) > shrunkenWidth, '图片支持再放大');
  const ratio = await inlineImage.evaluate(img => img.getBoundingClientRect().width / img.getBoundingClientRect().height);
  assert.ok(Math.abs(ratio - 1) < 0.02, '拉伸后保持原图比例');
  await page.getByRole('button', { name: '放大查看图片：正文参考图片' }).click();
  const imageDialog = page.getByTestId('prd-image-dialog');
  await imageDialog.waitFor();
  const zoomImage = imageDialog.getByTestId('prd-image-zoom');
  const beforeZoom = await zoomImage.evaluate(el => el.getBoundingClientRect().width);
  await imageDialog.getByRole('button', { name: '放大图片', exact: true }).click();
  assert.ok(await zoomImage.evaluate(el => el.getBoundingClientRect().width) > beforeZoom, '图片浮层应真正缩放图片');
  await imageDialog.getByRole('button', { name: '关闭图片放大查看' }).click();
  assert.equal(await page.getByTestId('prd-document').isVisible(), true, '关闭图片后保持 PRD 抽屉');
  const mermaid = page.getByTestId('prd-mermaid');
  await mermaid.waitFor();
  assert.equal(await mermaid.getByTestId('prd-mermaid-inline-svg').locator('svg').count(), 1, 'Mermaid 代码块应渲染为 SVG 流程图');
  assert.equal(await page.getByText('流程图暂时无法渲染', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '放大查看流程图' }).click();
  const mermaidDialog = page.getByTestId('prd-mermaid-dialog');
  await mermaidDialog.waitFor();
  const expandedMermaid = mermaidDialog.getByTestId('prd-mermaid-zoom-svg');
  await expandedMermaid.locator('svg').waitFor();
  assert.equal(await mermaidDialog.locator('img[alt="放大后的 Mermaid 流程图"]').count(), 0, '放大查看不得把含 HTML 标签的 Mermaid SVG 转成破图');
  const expandedWidthBefore = await expandedMermaid.evaluate(element => Math.round(element.getBoundingClientRect().width));
  assert.equal(await mermaidDialog.getByText('100%', { exact: true }).count(), 1, '流程图放大查看默认应为 100%');
  await mermaidDialog.getByRole('button', { name: '放大流程图' }).click();
  assert.equal(await mermaidDialog.getByText('125%', { exact: true }).count(), 1, '流程图应支持继续放大');
  const expandedWidthAfter = await expandedMermaid.evaluate(element => Math.round(element.getBoundingClientRect().width));
  assert.equal(expandedWidthAfter > expandedWidthBefore, true, `流程图矢量画布应实际放大：${expandedWidthBefore} -> ${expandedWidthAfter}`);
  await mermaidDialog.getByRole('button', { name: '重置流程图缩放' }).click();
  assert.equal(await mermaidDialog.getByText('100%', { exact: true }).count(), 1, '流程图应可重置缩放');
  await mermaidDialog.getByRole('button', { name: '关闭流程图放大查看' }).click();
  await mermaidDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-markdown-renderer="react-markdown"]').count(), 1);
  const sheetRect = await page.locator('[data-slot="sheet-content"]').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  const articleWidth = await page.getByTestId('prd-document').evaluate(element => element.getBoundingClientRect().width);
  assert.equal(sheetRect.left >= 300, true, `PRD 面板不应覆盖整个工作台：${JSON.stringify(sheetRect)}`);
  assert.equal(sheetRect.width >= 760, true, `PRD 面板宽度异常：${sheetRect.width}`);
  assert.equal(articleWidth >= 520, true, `PRD 正文宽度异常：${articleWidth}`);
  const dragSeparator = async (separator, deltaX) => separator.evaluate((element, horizontalDelta) => {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + Math.min(120, rect.height / 2);
    const pointer = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX, clientY, buttons: 1 }));
    element.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: clientX + horizontalDelta, clientY, buttons: 1 }));
    element.dispatchEvent(new PointerEvent('pointerup', { ...pointer, clientX: clientX + horizontalDelta, clientY, buttons: 0 }));
  }, deltaX);
  assert.equal(await page.getByRole('separator', { name: /调整 PRD (左侧目录|右侧正文导航)宽度/ }).count(), 0, 'Markdown 内部栏之间不应出现拖拽手柄');
  await dragSeparator(page.getByRole('separator', { name: '调整 PRD 预览抽屉宽度' }), -70);
  await page.waitForTimeout(50);
  const sheetWidthAfter = await page.locator('[data-slot="sheet-content"]').evaluate(element => Math.round(element.getBoundingClientRect().width));
  assert.equal(sheetWidthAfter >= sheetRect.width + 50, true, `抽屉左侧外边界应可横向拖宽：${sheetRect.width} -> ${sheetWidthAfter}`);
  await dragSeparator(page.getByRole('separator', { name: '调整 PRD 预览抽屉宽度' }), 120);
  assert.ok(await imageCard.evaluate(el => el.getBoundingClientRect().width <= el.parentElement.getBoundingClientRect().width), '抽屉缩窄时图片不能超出正文');
  const outline = page.getByTestId('prd-outline');
  await outline.waitFor();
  await outline.getByRole('button', { name: '5. 全局产品规则', exact: true }).click();
  const outlineTargetTop = await page.getByRole('heading', { name: '5. 全局产品规则', exact: true }).evaluate(element => Math.round(element.getBoundingClientRect().top));
  const documentScrollTop = await page.getByTestId('prd-document-scroll').locator('[data-slot="scroll-area-viewport"]').evaluate(element => Math.round(element.scrollTop));
  assert.equal(documentScrollTop > 0, true, '正文导航应立即滚动正文视口');
  assert.equal(outlineTargetTop >= 100 && outlineTargetTop < 900, true, `正文导航目标章节未进入可见区域：${outlineTargetTop}`);
  await page.waitForFunction(() => document.querySelector('[data-testid=prd-outline] [aria-current=location]')?.textContent?.includes('5. 全局产品规则'));
  assert.equal(await outline.getByRole('button', { name: '5. 全局产品规则', exact: true }).getAttribute('aria-current'), 'location');
  await outline.getByRole('button', { name: '5.1 当前任务板', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'PRD 目录' }).getByRole('button', { name: /当前任务板/ }).getAttribute('aria-current'), 'location');
  await outline.getByRole('button', { name: '失败重试', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'PRD 目录' }).getByRole('button', { name: /当前任务板/ }).getAttribute('aria-current'), 'location');
  await outline.getByRole('button', { name: '6. 附录', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'PRD 目录' }).locator('[aria-current="location"]').count(), 0);
  await page.getByTestId('prd-document-scroll').locator('[data-slot="scroll-area-viewport"]').evaluate(element => { element.scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('[data-testid=prd-outline] [aria-current=location]')?.textContent?.trim() === '4. 详细功能说明');


  const search = page.getByPlaceholder('搜索章节和正文');
  await search.fill('任务');
  const matches = page.locator('mark.prd-search-match');
  await matches.first().waitFor();
  const matchCount = await matches.count();
  assert.equal(matchCount > 1, true, `全文搜索应找到多个正文匹配，实际 ${matchCount}`);
  await page.locator('mark.prd-search-match-current').waitFor();
  assert.equal(await page.locator('mark.prd-search-match-current').count(), 1, '全文搜索只能有一个当前匹配');
  const searchNavigation = page.getByLabel('正文搜索结果导航');
  const waitForSearchPosition = async position => {
    await searchNavigation.getByRole('status').filter({ hasText: new RegExp(`^${position}/${matchCount}$`) }).waitFor();
  };
  await waitForSearchPosition(1);
  await page.getByRole('button', { name: '下一个正文匹配' }).click();
  await waitForSearchPosition(2);
  await page.getByRole('button', { name: '上一个正文匹配' }).click();
  await waitForSearchPosition(1);
  await search.press('Enter');
  await waitForSearchPosition(2);
  await search.press('Shift+Enter');
  await waitForSearchPosition(1);
  await search.fill('帮助用户创建');
  await page.locator('mark.prd-search-match-current').waitFor();
  assert.equal(await page.locator('mark.prd-search-match').count(), 1, '正文独有词应可检索');
  await page.getByRole('button', { name: '清空搜索' }).click();
  assert.equal(await page.locator('mark.prd-search-match').count(), 0, '清空搜索应移除正文高亮');

  await page.getByRole('checkbox', { name: '关联 新建任务' }).check();
  await page.getByRole('checkbox', { name: '关联 当前任务板' }).check();
  await page.getByRole('button', { name: '保存当前页面关联' }).click();
  await page.getByText('当前页面的 PRD 关联已保存').waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await relatedButton.getByText('相关 PRD（2）').waitFor();
  await page.getByTestId('work-mode-switch').waitFor();
  assert.equal(await page.getByRole('tab', { name: '绑定模式' }).count(), 1);
  assert.equal(await page.getByText('Spec 绑定', { exact: true }).count() > 0, true);

  await page.getByRole('tab', { name: '评审模式' }).click();
  await relatedButton.click();
  await page.getByText('评审模式只展示当前页面已经绑定的 PRD 内容。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox').count(), 0, '评审模式不得提供 PRD 绑定动作');
  assert.equal(await page.getByRole('heading', { name: '4.1.1 新建任务', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: '5.1 当前任务板', exact: true }).count(), 1);
  assert.equal(await page.getByText('4.1.2 归档任务', { exact: true }).count(), 0, '评审模式不得展示未绑定章节目录');
  assert.equal(await page.getByRole('heading', { name: '4.1.2 归档任务', exact: true }).count(), 0, '评审模式不得展示未绑定章节正文');
  assert.equal(await page.getByText('帮助用户归档不再处理的任务。', { exact: true }).count(), 0, '评审模式不得泄漏未绑定章节内容');
  assert.equal(await page.getByRole('img', { name: '正文参考图片', exact: true }).count(), 1, '相关章节图片在评审模式继续显示');
  await page.waitForFunction(() => {
    const img = document.querySelector('img[alt="引用式中文图片"]');
    return img?.complete && img.naturalWidth > 0;
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  const relationsBeforeScopeChange = await readFile(prdMapPath, 'utf8');
  await relatedButton.click();
  const scopeSwitch = page.getByRole('switch', { name: '仅看当前页面关联内容' });
  assert.equal(await scopeSwitch.isChecked(), true);
  await scopeSwitch.click();
  await page.getByRole('heading', { name: '4.1.2 归档任务', exact: true }).waitFor();
  await scopeSwitch.click();
  assert.equal(await page.getByRole('heading', { name: '4.1.2 归档任务', exact: true }).count(), 0);
  assert.equal(await readFile(prdMapPath, 'utf8'), relationsBeforeScopeChange);
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  // Both portable viewers consume the same frozen config; no local image URL is required.
  const portable = makeReadOnlyReviewConfig(await (await fetch(`${studio.url}api/config`)).json(), 'index.html', new Date().toISOString());
  await page.route('**/api/config', route => route.fulfill({ json: portable }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('related-prd').click();
  await page.waitForFunction(() => {
    const img = document.querySelector('img[alt="正文参考图片"]');
    return img?.complete && img.naturalWidth > 0;
  });
  assert.equal(await page.getByRole('checkbox').count(), 0);

  const saved = JSON.parse(await readFile(prdMapPath, 'utf8'));
  assert.deepEqual(saved.items[0].sectionIds, [
    '需求-任务-新建任务',
    '规则-任务上下文-当前任务板',
  ]);
  process.stdout.write('PRD 与原 Spec 工作台同屏、绑定并返回的浏览器旅程通过\n');
} finally {
  await browser.close();
  await studio.stop();
}
