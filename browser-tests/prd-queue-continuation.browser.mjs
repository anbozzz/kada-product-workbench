import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { source } from '../tests/fixtures/prd-review.mjs';

const appRoot = process.env.IPS_TEST_PLUGIN_ROOT || resolve(import.meta.dirname, '..');
const { createPrdReviewMcp } = await import(pathToFileURL(join(appRoot, 'src/prd-review-mcp.mjs')));
const projectPath = await mkdtemp(join(tmpdir(), 'ips-five-batches-'));
const prdPath = join(projectPath, 'PRD.md'), htmlPath = join(projectPath, 'index.html');
await writeFile(prdPath, source);
await writeFile(htmlPath, '<!doctype html><title>队列回归</title><button onclick="this.textContent=\'已操作\'">创建任务</button>');
const manager = createPrdReviewMcp({ statePath: join(projectPath, '.state/projects.json') });
const opened = await manager.call('open_prd_review', { projectPath, prdPath, htmlPath });
const browser = await launchHeadlessBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(opened.url);
  await page.getByTestId('prd-review-panel').waitFor();
  const input = page.getByRole('textbox', { name: 'PRD 修改意见', exact: true });
  for (let index = 1; index <= 5; index++) {
    await input.fill(`连续发送第 ${index} 批`);
    await page.getByRole('button', { name: '发送给原 Codex 任务', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('[data-testid="prd-queue-batch"][data-status="queued"]').length === count, index);
    assert.equal(await input.inputValue(), '');
  }
  let feedback = await manager.call('wait_prd_feedback', { sessionId: opened.sessionId, timeoutMs: 0 });
  let current = source;
  for (let index = 1; index <= 5; index++) {
    assert.equal(feedback.batch.annotations[0].comment, `连续发送第 ${index} 批`);
    current += '\n';
    await writeFile(prdPath, current);
    const result = await manager.call('publish_prd_revision', {
      sessionId: opened.sessionId, batchId: feedback.batch.id,
      revision: createHash('sha256').update(current).digest('hex'), summary: `第 ${index} 批已完成`,
    });
    await page.locator(`[data-batch-id="${feedback.batch.id}"][data-status="published"]`).waitFor({ state: 'attached' });
    if (index < 5) {
      assert.equal(result.nextFeedback.status, 'submitted');
      feedback = result.nextFeedback;
      await page.locator(`[data-batch-id="${feedback.batch.id}"][data-status="processing"]`).waitFor();
    } else assert.equal(result.nextFeedback, undefined);
  }
  assert.equal(await page.locator('[data-status="needs_review"]').count(), 0);
  await page.getByRole('button', { name: '关闭 PRD' }).click();
  await page.getByTestId('related-prd').click();
  await page.getByTestId('prd-review-panel').waitFor();
  await page.getByRole('button', { name: '结束评审', exact: true }).click();
  await page.getByText('本轮评审已结束', { exact: true }).waitFor();
  assert.equal((await manager.call('wait_prd_feedback', { sessionId: opened.sessionId, timeoutMs: 0 })).status, 'ended');
  assert.deepEqual(errors, []);
  console.log('五批浏览器连续发送 → MCP 逐批发布并返回下一批 → 历史及原 PRD 入口/结束评审通过');
} finally {
  await browser.close();
  await manager.close();
  await rm(projectPath, { recursive: true, force: true });
}
