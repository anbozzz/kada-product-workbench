import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrdReviewEntry } from '../src/prd-review-entry.mjs';
import { createPrdReviewMcp } from '../src/prd-review-mcp.mjs';
import { source } from './fixtures/prd-review.mjs';

async function fixture(t) {
  const projectPath = await realpath(await mkdtemp(join(tmpdir(), 'prd-entry-')));
  t.after(() => rm(projectPath, { recursive: true, force: true }));
  const prdPath = join(projectPath, 'PRD.md');
  await writeFile(prdPath, source);
  return { input: { projectPath, prdPath }, statePath: join(projectPath, '.state/projects.json') };
}

test('concurrent notifications and a new manager reuse the deferred choice; no source is written', async t => {
  const { input, statePath } = await fixture(t);
  let prompts = 0;
  const options = { statePath, elicit: async () => { prompts++; return { action: 'cancel' }; }, open: () => assert.fail('must not open') };
  const request = createPrdReviewEntry(options);
  const results = await Promise.all([request(input), request(input)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(prompts, 1);
  assert.equal((await createPrdReviewEntry(options)(input)).status, 'deferred');
  assert.equal(prompts, 1);
  assert.equal(await readFile(input.prdPath, 'utf8'), source);
});

test('failed workbench start retains accepted choice so retry does not ask again', async t => {
  const { input, statePath } = await fixture(t);
  let prompts = 0, starts = 0;
  const request = createPrdReviewEntry({ statePath,
    elicit: async () => { prompts++; return { action: 'accept', content: { review: '开始评审' } }; },
    open: async () => { if (++starts === 1) throw new Error('启动失败'); return { url: 'test' }; },
  });
  await assert.rejects(request(input), /启动失败/);
  assert.equal((await request(input)).status, 'reviewing');
  assert.equal(prompts, 1);
});

test('changed PRD during choice cannot silently start a different version', async t => {
  const { input, statePath } = await fixture(t);
  const request = createPrdReviewEntry({ statePath,
    elicit: async () => { await writeFile(input.prdPath, source.replace('v0.1', 'v0.2')); return { action: 'accept', content: { review: '开始评审' } }; },
    open: () => assert.fail('must not open changed document'),
  });
  await assert.rejects(request(input), /PRD 已变化/);
});

test('invalid lifecycle, bad format and paths outside Project fail before asking', async t => {
  const { input, statePath } = await fixture(t);
  const other = await fixture(t);
  const request = createPrdReviewEntry({ statePath, elicit: () => assert.fail('must not ask'), open: () => assert.fail('must not open') });
  await assert.rejects(request({ ...input, prdPath: other.input.prdPath }), /当前 Project/);
  await writeFile(input.prdPath, 'invalid');
  await assert.rejects(request(input), /格式/);
  await writeFile(input.prdPath, source.replace('文档状态：草稿', '文档状态：已确认'));
  await assert.rejects(request(input), /草稿/);
});


test('accepted entry restores the same persisted review after MCP reconnect', async t => {
  const { input, statePath } = await fixture(t);
  let manager = createPrdReviewMcp({ statePath, elicit: async () => ({ action: 'accept', content: { review: '开始评审' } }) });
  t.after(() => manager.close());
  const first = await manager.call('request_prd_review', input);
  await manager.close();
  manager = createPrdReviewMcp({ statePath, elicit: () => assert.fail('must not ask again') });
  const reopened = await manager.call('request_prd_review', input);
  assert.equal(reopened.sessionId, first.sessionId);
  assert.equal((await fetch(reopened.url)).status, 200);
});

test('five queued batches continue through publication responses across revisions and reconnect', async t => {
  const { input, statePath } = await fixture(t);
  let manager = createPrdReviewMcp({ statePath });
  t.after(() => manager.close());
  let opened = await manager.call('open_prd_review', input);
  const sessionId = opened.sessionId;
  const getConfig = async () => (await fetch(`${opened.url}api/config`)).json();
  const initial = await getConfig();
  for (let index = 1; index <= 5; index++) {
    const config = await getConfig();
    const response = await fetch(`${opened.url}api/prd-review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      ...config.prdReview, action: 'submit', batchId: `batch-${index}`,
      annotations: [{ id: `note-${index}`, kind: 'comment', comment: `第 ${index} 条意见`, anchor: { quote: '帮助用户创建新的任务。', startLine: 21, endLine: 21 } }],
    }) });
    assert.equal(response.status, 200);
  }
  let feedback = await manager.call('wait_prd_feedback', { sessionId, timeoutMs: 0 });
  let previousSource = source;
  for (let index = 1; index <= 5; index++) {
    assert.equal(feedback.status, 'submitted');
    assert.equal(feedback.batch.id, `batch-${index}`);
    assert.equal(feedback.batch.baseSource, source);
    assert.equal(feedback.batch.baseRevision, initial.prd.revision);
    assert.equal(feedback.batch.annotations[0].anchor.startLine, 21);
    assert.equal(feedback.currentSource, previousSource);
    assert.equal(feedback.currentRevision, (await getConfig()).prd.revision);
    if (index === 2) {
      await assert.rejects(manager.call('publish_prd_revision', { sessionId, batchId: feedback.batch.id, revision: feedback.currentRevision, summary: '未修改' }), /未变化/);
    }
    // Change the anchored text too: original feedback remains evidence, not current line coordinates.
    const revised = previousSource.replace(/帮助用户[^\n]*新的任务(?:\*\*)?。/, `帮助用户按第 ${index} 轮意见创建新的任务。`) + '\n';
    assert.ok(revised.includes(`帮助用户按第 ${index} 轮意见创建新的任务。`));
    await writeFile(input.prdPath, revised);
    const { createHash } = await import('node:crypto');
    const publishInput = { sessionId, batchId: feedback.batch.id, revision: createHash('sha256').update(revised).digest('hex'), summary: `完成第 ${index} 批` };
    const result = await manager.call('publish_prd_revision', publishInput);
    const config = await getConfig();
    assert.equal(config.prdReview.previousSource, previousSource);
    assert.equal(config.prdReview.batches.filter(batch => batch.status === 'published').length, index);
    assert.equal(config.prdReview.batches.some(batch => batch.status === 'needs_review'), false);
    assert.ok(config.prdReview.batches.filter(batch => batch.status === 'processing').length <= 1);
    if (index < 5) {
      assert.equal(result.nextFeedback.batch.id, `batch-${index + 1}`);
      const retry = await manager.call('publish_prd_revision', publishInput);
      assert.equal(retry.nextFeedback.batch.id, result.nextFeedback.batch.id, 'publication retry must not skip a batch');
      feedback = result.nextFeedback;
    } else assert.equal(result.nextFeedback, undefined);
    previousSource = revised;
    if (index === 2) {
      await manager.close();
      manager = createPrdReviewMcp({ statePath });
      opened = await manager.call('open_prd_review', { ...input, resumeSessionId: sessionId });
      feedback = await manager.call('wait_prd_feedback', { sessionId, timeoutMs: 0 });
    }
  }
  assert.equal((await manager.call('wait_prd_feedback', { sessionId, timeoutMs: 0 })).status, 'pending');
});
