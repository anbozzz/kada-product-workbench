import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { createPrdReviewMcp } from '../src/prd-review-mcp.mjs';
import { readPrdDocument } from '../src/prd-service.mjs';
import { source } from '../tests/fixtures/prd-review.mjs';

const root = resolve(import.meta.dirname, '..');
const projectPath = await mkdtemp(join(tmpdir(), 'ips-prd-review-browser-'));
const htmlPath = join(projectPath, 'index.html'), prdPath = join(projectPath, 'PRD.md');
await writeFile(htmlPath, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>任务板</title><body style="font-family:system-ui;padding:40px;background:#f4f6f9"><h1>任务板</h1><p>与右侧 PRD 对照阅读</p><button onclick="this.textContent=\'新任务已创建\'">创建任务</button></body></html>');
await writeFile(prdPath, source);
const manager = createPrdReviewMcp({ statePath: join(projectPath, '.state/projects.json'), elicit: async () => ({ action: 'accept', content: { review: '开始评审' } }) });
const opened = await manager.call('request_prd_review', { projectPath, htmlPath, prdPath });
const browser = await launchHeadlessBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const wait = () => manager.call('wait_prd_feedback', { sessionId: opened.sessionId, timeoutMs: 5000 });
const screenshotRoot = resolve(root, 'output/playwright');
await mkdir(screenshotRoot, { recursive: true });
try {
  await page.goto(opened.url);
  await page.getByTestId('prd-review-panel').waitFor();
  await page.getByTestId('prd-document').getByText('帮助团队管理任务。', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-component-source="beautiful-ui/prompt-bar"]').count(), 1);
  // The original canvas remains interactive; the review is the existing resizable drawer.
  const drawer = page.locator('[data-slot="sheet-content"]').filter({ has: page.getByTestId('prd-review-panel') });
  const toolbar = page.getByTestId('prd-review-toolbar');
  const assertCompactToolbar = async () => {
    const rect = await toolbar.boundingBox();
    assert.ok(rect.height <= 48, 'PRD toolbar leaves vertical space for Markdown');
    assert.equal(await page.getByRole('button', { name: '收起 PRD', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '载入磁盘版本（保留草稿）', exact: true }).count(), 0);
    for (const label of ['新版全文', '上轮修订差异', 'PRD 更多操作', '关闭 PRD']) {
      const box = await toolbar.getByRole('button', { name: label, exact: true }).boundingBox();
      assert.ok(box.x >= rect.x && box.x + box.width <= rect.x + rect.width + 1 && box.y + box.height <= rect.y + rect.height, `${label} remains inside the compact toolbar`);
    }
  };
  await assertCompactToolbar();
  const initialInput = page.getByRole('textbox', { name: 'PRD 修改意见', exact: true });
  await initialInput.fill('重新读取时仍保留的草稿');
  await toolbar.getByRole('button', { name: 'PRD 更多操作' }).click();
  await page.getByText('用于本地文件已修改、尚未发布到工作台时。保留当前草稿，不会发送意见或回滚文件；修订进行中不可用。', { exact: true }).waitFor();
  await page.getByRole('menuitem', { name: '重新读取本地 PRD' }).click();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="PRD 修改意见"]').disabled);
  assert.equal(await initialInput.inputValue(), '重新读取时仍保留的草稿');
  await initialInput.fill('');
  const handle = page.getByRole('separator', { name: '调整 PRD 预览抽屉宽度' });
  await handle.hover();
  const originalWidth = (await drawer.boundingBox()).width;
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 130, grip.y + grip.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(width => Number(document.querySelector('[data-testid="prd-drawer-resize-handle"]').getAttribute('aria-valuenow')) > width + 100, originalWidth);
  assert.ok((await drawer.boundingBox()).width > originalWidth + 100, 'dragging left expands the original drawer');
  await handle.press('ArrowRight');
  const controls = page.getByTestId('canvas-controls');
  const canvasViewport = page.getByTestId('canvas-viewport');
  const ensureControlsAccessible = async () => {
    for (const label of ['缩小画布', '放大画布', '适应画布', '持续拖动画布']) {
      const button = controls.getByRole('button', { name: label, exact: true });
      await button.click({ trial: true });
      const rect = await button.boundingBox(), drawerRect = await drawer.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= drawerRect.x + 1, `${label} must not be behind the PRD drawer`);
    }
  };
  await ensureControlsAccessible();
  // Wait for the actual transform animation, not only the optimistic percentage label.
  const settleZoom = target => page.waitForFunction(scale => {
    const canvas = document.querySelector('[data-testid="target-canvas"]');
    return Math.abs(canvas.getBoundingClientRect().width / canvas.offsetWidth - scale) < 0.0001;
  }, target);
  let zoom = Number(await canvasViewport.getAttribute('data-zoom'));
  await controls.getByRole('button', { name: '放大画布', exact: true }).click();
  await page.waitForFunction(before => Number(document.querySelector('[data-testid="canvas-viewport"]').dataset.zoom) > before, zoom);
  await settleZoom((Math.round(zoom * 100) + 1) / 100);
  zoom = Number(await canvasViewport.getAttribute('data-zoom'));
  await controls.getByRole('button', { name: '缩小画布', exact: true }).click();
  await page.waitForFunction(before => Number(document.querySelector('[data-testid="canvas-viewport"]').dataset.zoom) < before, zoom);
  await controls.getByRole('combobox').click();
  await page.getByRole('option', { name: '桌面 1280 × 800', exact: true }).click();
  await controls.getByRole('button', { name: '适应画布', exact: true }).click();
  const pan = controls.getByRole('button', { name: '持续拖动画布', exact: true });
  const dragCanvas = async () => {
    const before = await page.getByTestId('target-canvas').boundingBox();
    const viewport = await canvasViewport.boundingBox();
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width / 2 + 60, viewport.y + viewport.height / 2 + 35, { steps: 8 });
    await page.mouse.up();
    const after = await page.getByTestId('target-canvas').boundingBox();
    assert.ok(Math.abs(after.x - before.x) > 25 || Math.abs(after.y - before.y) > 15, 'canvas actually pans while PRD remains open');
  };
  await pan.click();
  await dragCanvas();
  await pan.click();
  const frame = page.frameLocator('iframe').first();
  await frame.getByRole('button', { name: '创建任务', exact: true }).click();
  await frame.getByRole('button', { name: '新任务已创建' }).waitFor();
  await page.keyboard.down('Space');
  assert.equal(await pan.getAttribute('aria-pressed'), 'true');
  await dragCanvas();
  await page.keyboard.up('Space');
  assert.equal(await pan.getAttribute('aria-pressed'), 'false');
  await controls.getByRole('button', { name: '适应画布', exact: true }).click();
  await controls.getByRole('button', { name: '关闭画布操作提示' }).click();
  await ensureControlsAccessible();
  const selectText = async text => {
    const paragraph = page.getByTestId('prd-document').getByText(text, { exact: true });
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  };
  // Start with a real mouse drag across bold + ordinary text, not a mocked selection event.
  const firstPassage = page.getByTestId('prd-document').getByText('帮助用户创建新的任务。', { exact: true });
  await firstPassage.scrollIntoViewIfNeeded();
  const textRect = await firstPassage.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(textRect.x, textRect.y + textRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(textRect.x + textRect.width + 1, textRect.y + textRect.height / 2, { steps: 14 });
  await page.mouse.up();
  const inline = page.getByTestId('prd-selection-popover');
  const inlineInput = page.getByRole('textbox', { name: '选区评价', exact: true });
  const bottomInput = page.getByRole('textbox', { name: 'PRD 修改意见', exact: true });
  await inline.waitFor();
  assert.equal(await inline.getByRole('combobox').count(), 0, 'passage feedback has no operation-type selector');
  assert.equal(await page.getByTestId('prd-review-panel').getByRole('combobox').count(), 0, 'the batch composer has no type selector either');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选区评价');
  const nearSelection = async passage => {
    await page.waitForFunction(element => {
      const selected = element.getBoundingClientRect(), floating = document.querySelector('[data-testid="prd-selection-popover"]')?.getBoundingClientRect();
      return floating && Math.min(Math.abs(floating.bottom - selected.top), Math.abs(selected.bottom - floating.top)) < 32;
    }, await passage.elementHandle());
    const selected = await passage.boundingBox(), floating = await inline.boundingBox();
    assert.ok(Math.min(Math.abs(floating.y + floating.height - selected.y), Math.abs(selected.y + selected.height - floating.y)) < 32, 'evaluation floats beside the selected passage');
    assert.ok(floating.x >= 0 && floating.x + floating.width <= (page.viewportSize()).width, 'popover stays inside screen');
  };
  await nearSelection(firstPassage);
  assert.equal(await page.getByTestId('prd-reference-card').count(), 0, 'selection alone does not become a bottom reference');
  await inlineInput.fill('请补充批量创建任务的说明。');
  await inlineInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  assert.equal(await inline.count(), 1, 'IME Enter does not add the evaluation');
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-selection-popover.png') });
  // Scroll the document with an open evaluation; it tracks the text, then safely tucks away offscreen.
  const scrollViewport = page.getByTestId('prd-document-scroll').locator('[data-radix-scroll-area-viewport]');
  await scrollViewport.evaluate(element => { element.scrollTop += 60; });
  await nearSelection(firstPassage);
  await scrollViewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await inline.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '继续评价', exact: true }).click();
  assert.equal(await inlineInput.inputValue(), '请补充批量创建任务的说明。', 'scrolling offscreen preserves the in-progress evaluation');
  // Selecting another passage stages the previous typed evaluation, without losing or combining comments.
  await selectText('帮助团队管理任务。');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="prd-reference-card"]').length === 1);
  assert.equal(await inlineInput.inputValue(), '');
  assert.equal(await bottomInput.inputValue(), '', 'passage comments never move into the general composer');
  await inlineInput.fill('请在目标中说明批量操作。');
  await inlineInput.press('Shift+Enter');
  assert.match(await inlineInput.inputValue(), /\n$/);
  await inlineInput.press('Escape');
  await inline.waitFor({ state: 'hidden' });
  await drawer.waitFor();
  await page.getByRole('button', { name: '继续评价', exact: true }).click();
  assert.equal(await inlineInput.inputValue(), '请在目标中说明批量操作。\n');
  // Dragging the original drawer while editing keeps the floating input near the text.
  const secondGrip = await handle.boundingBox();
  await page.mouse.move(secondGrip.x + secondGrip.width / 2, secondGrip.y + 4);
  await page.mouse.down();
  await page.mouse.move(secondGrip.x - 35, secondGrip.y + 4, { steps: 8 });
  await page.mouse.up();
  await inline.waitFor();
  await nearSelection(page.getByTestId('prd-document').getByText('帮助团队管理任务。', { exact: true }));
  await page.getByRole('button', { name: '关闭 PRD' }).click();
  await page.getByTestId('related-prd').click();
  await page.getByRole('button', { name: '继续评价', exact: true }).click();
  assert.equal(await inlineInput.inputValue(), '请在目标中说明批量操作。\n');
  await page.reload();
  await page.getByTestId('prd-composer').waitFor();
  await page.getByRole('button', { name: '继续评价', exact: true }).click();
  assert.equal(await inlineInput.inputValue(), '请在目标中说明批量操作。\n', 'in-progress inline comment survives refresh');
  await inlineInput.fill('删除这段产品目标说明。');
  await inlineInput.press('Enter');
  await inline.waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('prd-reference-card').count(), 2);
  assert.match(await page.getByTestId('prd-reference-card').nth(1).innerText(), /删除这段产品目标说明/);
  // Empty/cancelled selection must not contaminate the outgoing batch.
  await selectText('从任务板进入。');
  await inline.getByRole('button', { name: '取消这条评价', exact: true }).click();
  assert.equal(await page.getByTestId('prd-reference-card').count(), 2);
  await selectText('从任务板进入。');
  await inlineInput.press('Escape');
  await inline.waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('prd-pending-evaluation').count(), 0, 'empty selection dismissed with Escape never blocks sending');
  assert.equal((await manager.call('wait_prd_feedback', { sessionId: opened.sessionId, timeoutMs: 1 })).status, 'pending', 'adding local evaluations does not submit to the original task');
  await page.getByRole('button', { name: '预览引用 1', exact: true }).click();
  await page.getByTestId('prd-feedback-preview').getByText('帮助用户创建新的任务。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '编辑已有意见' }).inputValue(), '请补充批量创建任务的说明。');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-comment.png') });
  await page.getByRole('button', { name: '预览发送内容' }).click();
  assert.equal(await page.getByTestId('prd-outgoing-annotation').count(), 2);
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-send-preview.png') });
  await page.getByRole('button', { name: '返回编辑' }).click();
  await page.route('**/api/prd-review', async route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await page.getByRole('button', { name: '发送给原 Codex 任务', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByTestId('prd-reference-card').count(), 2, 'failed send retains both independent evaluations');
  await page.unroute('**/api/prd-review');
  // Server accepts the batch but its HTTP response is lost. Reconcile the stable batch ID.
  await page.route('**/api/prd-review', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('failed');
  });
  const feedback = wait();
  await page.getByRole('button', { name: '预览发送内容' }).click();
  await page.getByTestId('prd-feedback-preview').getByRole('button', { name: '发送给原 Codex 任务', exact: true }).click();
  const result = await feedback;
  await page.waitForFunction(() => !document.querySelector('[data-testid="prd-feedback-preview"]'));
  await page.unroute('**/api/prd-review');
  assert.equal(await page.getByTestId('prd-reference-card').count(), 0, 'a lost success response reconciles without resubmitting or retaining a duplicate draft');
  assert.equal(result.status, 'submitted');
  assert.equal(result.batch.annotations[0].anchor.quote, '帮助用户创建新的任务。');
  assert.equal(result.batch.annotations[1].comment, '删除这段产品目标说明。');
  assert.equal(result.batch.annotations[1].kind, 'comment', 'deletion remains an ordinary suggestion for the agent');
  assert.equal(await readFile(prdPath, 'utf8'), source);
  const activeCard = page.locator(`[data-batch-id="${result.batch.id}"]`);
  await activeCard.locator('[data-status="processing"], :scope[data-status="processing"]').waitFor();
  assert.equal(await activeCard.getByRole('button', { name: '撤回编辑' }).count(), 0, 'running batches cannot be withdrawn');
  await toolbar.getByRole('button', { name: 'PRD 更多操作' }).click();
  assert.equal(await page.getByRole('menuitem', { name: '重新读取本地 PRD' }).getAttribute('aria-disabled'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await toolbar.isVisible(), true, 'Escape closes only the menu, not the PRD drawer');
  await bottomInput.fill('下一批补充意见');
  await bottomInput.press('Enter');
  assert.match(await bottomInput.inputValue(), /\n$/, 'ordinary Enter only adds a new line');
  await page.getByRole('button', { name: '发送给原 Codex 任务', exact: true }).click();
  await page.locator('[data-testid="prd-queue-batch"][data-status="queued"]').waitFor();
  await bottomInput.fill('正在写第三批');
  await page.locator('[data-status="queued"]').getByRole('button', { name: '撤回编辑' }).click();
  await page.getByText('已撤回并保留在批次历史；当前草稿不受影响，可稍后继续编辑该批。', { exact: true }).waitFor();
  assert.equal(await bottomInput.inputValue(), '正在写第三批', 'withdrawal never overwrites a newer draft');
  await bottomInput.fill('');
  await page.getByText('批次历史 · 1', { exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByTestId('prd-reference-card').getByText('下一批补充意见', { exact: true }).waitFor();
  const updated = source.replace('帮助用户创建**新的任务**。', '帮助用户批量创建新的任务。');
  // Simulate only the original agent's file write, not browser-side writing.
  await writeFile(prdPath, updated);
  const { document } = await readPrdDocument(prdPath);
  await manager.call('publish_prd_revision', { sessionId: opened.sessionId, batchId: result.batch.id, revision: document.revision, summary: '补充了批量创建任务的说明。' });
  await page.getByTestId('prd-revision-summary').waitFor();
  await page.getByTestId('prd-stale-draft').waitFor();
  assert.equal(await page.getByRole('button', { name: '发送给原 Codex 任务', exact: true }).isDisabled(), true);
  await page.reload();
  await page.getByTestId('prd-stale-draft').waitFor();
  await page.getByTestId('prd-reference-card').getByText('下一批补充意见', { exact: true }).waitFor();
  await page.getByRole('button', { name: '已核对，适配新版' }).click();
  await page.getByTestId('prd-stale-draft').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '移除引用 1', exact: true }).click();
  await page.getByRole('button', { name: '上轮修订差异' }).click();
  await page.getByTestId('prd-revision-diff').getByText(/帮助用户批量创建新的任务/).waitFor();
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-diff.png') });
  await page.getByRole('button', { name: '新版全文', exact: true }).click();
  await page.getByTestId('prd-document').getByText('帮助用户批量创建新的任务。', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'PRD 修改意见' }).fill('本轮没有其他修改建议。');
  await page.getByRole('textbox', { name: 'PRD 修改意见' }).press('Shift+Enter');
  assert.match(await page.getByRole('textbox', { name: 'PRD 修改意见' }).inputValue(), /\n$/);
  const feedback2 = wait();
  await page.getByRole('textbox', { name: 'PRD 修改意见' }).press('Control+Enter');
  const round2 = await feedback2;
  await manager.call('publish_prd_revision', { sessionId: opened.sessionId, batchId: round2.batch.id, revision: document.revision, summary: '用户无其他修改建议，保留正文。', unchanged: true });
  await page.getByTestId('prd-composer').waitFor();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="PRD 修改意见"]').value === '');
  // Exercise real browser actions against a simulated original-task consumer. This is not a native Codex interruption test.
  await bottomInput.fill('本批用于验证停止');
  await page.getByRole('button', { name: '发送给原 Codex 任务', exact: true }).click();
  await page.locator('[data-testid="prd-queue-batch"][data-status="queued"]').waitFor();
  const stopping = await wait();
  await page.locator(`[data-batch-id="${stopping.batch.id}"][data-status="processing"]`).waitFor();
  await bottomInput.fill('停止完成后才可领取的下一批');
  await page.getByRole('button', { name: '发送给原 Codex 任务', exact: true }).click();
  await page.locator('[data-testid="prd-queue-batch"][data-status="queued"]').waitFor();
  await bottomInput.fill('停止期间仍可编写');
  await page.locator(`[data-batch-id="${stopping.batch.id}"]`).getByRole('button', { name: '停止', exact: true }).click();
  await page.locator(`[data-batch-id="${stopping.batch.id}"][data-status="stop_requested"]`).waitFor();
  assert.equal((await wait()).status, 'stop_requested');
  assert.equal(await page.locator('[data-testid="prd-queue-batch"][data-status="queued"]').count(), 1);
  assert.equal(await bottomInput.inputValue(), '停止期间仍可编写');
  await ensureControlsAccessible();
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-batch-queue.png') });
  await manager.call('acknowledge_prd_stop', { sessionId: opened.sessionId, batchId: stopping.batch.id, summary: '确认停止，未修改正文。' });
  await page.locator(`[data-batch-id="${stopping.batch.id}"][data-status="stopped"]`).waitFor({ state: 'attached' });
  await page.locator('[data-status="queued"]').getByRole('button', { name: '撤回编辑' }).click();
  await page.locator('[data-testid="prd-queue-batch"][data-status="queued"]').waitFor({ state: 'hidden' });
  assert.equal(await bottomInput.inputValue(), '停止期间仍可编写');
  await bottomInput.fill('');
  // Compact viewport keeps send/preview reachable without horizontal overflow.
  await page.setViewportSize({ width: 780, height: 760 });
  await ensureControlsAccessible();
  await assertCompactToolbar();
  await selectText('帮助团队管理任务。');
  await inline.waitFor();
  await nearSelection(page.getByTestId('prd-document').getByText('帮助团队管理任务。', { exact: true }));
  await inline.getByRole('button', { name: '取消这条评价', exact: true }).click();
  await page.getByRole('textbox', { name: 'PRD 修改意见' }).fill('窄屏测试');
  await page.getByRole('button', { name: '预览发送内容' }).click();
  await page.getByTestId('prd-feedback-preview').waitFor();
  await page.keyboard.press('Escape');
  const composerBox = await page.getByTestId('prd-composer').boundingBox();
  assert.ok(composerBox.x >= 0 && composerBox.x + composerBox.width <= 780 && composerBox.y + composerBox.height <= 760);
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-compact.png') });
  await page.getByRole('textbox', { name: 'PRD 修改意见' }).fill('');
  await page.getByRole('button', { name: '关闭 PRD' }).click();
  await page.getByTestId('related-prd').click();
  await page.getByRole('button', { name: '确认当前版本', exact: true }).click();
  const confirmation = await wait();
  assert.equal(confirmation.status, 'confirmation_requested');
  await page.getByText('已提交确认，等待 Codex 完成正式文档确认', { exact: true }).waitFor();
  const confirmedSource = updated.replace('> 文档状态：草稿', '> 文档状态：已确认');
  await writeFile(prdPath, confirmedSource);
  const { document: confirmedDocument } = await readPrdDocument(prdPath);
  await manager.call('complete_prd_confirmation', {
    sessionId: opened.sessionId,
    sourceRevision: confirmation.revision,
    confirmedPrdPath: prdPath,
    revision: confirmedDocument.revision,
    summary: '浏览器测试模拟原任务完成正式确认。',
  });
  await page.getByText('当前版本已确认', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PRD 浏览器闭环通过：就地评价、原画布/拖宽、多批持续编辑、等待撤回、处理中仅停止、停止确认前阻塞领取、旧版草稿保留与核对、预览与差异、键盘、窄屏、多轮及正式确认。');
} catch (error) {
  await page.screenshot({ path: join(screenshotRoot, 'prd-review-failure.png') });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await manager.close();
}
