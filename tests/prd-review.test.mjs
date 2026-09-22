import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { startPrdReviewWorkbench } from '../src/server.mjs';
import { readPrdDocument } from '../src/prd-service.mjs';
import { makeReadOnlyReviewConfig } from '../src/review-package.mjs';
import { resolvePrdReviewSources } from '../src/prd-review-service.mjs';
import { source } from './fixtures/prd-review.mjs';

const root = resolve(import.meta.dirname, '..');
async function fixture() {
  const projectPath = await realpath(await mkdtemp(join(tmpdir(), 'ips-prd-review-')));
  const htmlPath = join(projectPath, 'index.html'), prdPath = join(projectPath, 'PRD.md');
  await writeFile(htmlPath, '<title>任务板</title><h1>任务板</h1>');
  await writeFile(prdPath, source);
  return { projectPath, htmlPath, prdPath, appRoot: root, statePath: join(projectPath, '.state/projects.json') };
}
const annotation = () => ({ id: 'one', kind: 'replace', comment: '改为支持批量创建任务', anchor: { quote: '帮助用户创建新的任务。', startLine: 21, endLine: 21 } });

test('PRD review preserves sources, validates anchors, submits idempotently and publishes multiple rounds', async t => {
  const options = await fixture();
  const wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const config = await (await fetch(`${wb.url}api/config`)).json();
  assert.equal(config.prd.source, source);
  assert.equal(config.prdMap, null);
  assert.deepEqual(config.productSpec.modules, []);
  assert.equal(config.canSaveSpec, false);
  assert.equal(config.canReturnToProjects, false);
  assert.equal((await readdir(options.projectPath)).includes('prd-map.json'), false);
  const mutate = (action, extra = {}) => review.mutate({ ...review.view(), action, ...extra });
  await assert.rejects(mutate('save', { annotations: [{ ...annotation(), anchor: { quote: '不存在的内容', startLine: 21, endLine: 21 } }] }), /不属于/);
  await mutate('save', { annotations: [annotation(), { id: 'general', kind: 'general', comment: '补充产品目标' }] });
  assert.match(review.view().annotations[0].anchor.context, /\*\*新的任务\*\*/);
  await assert.rejects(mutate('end'), /先提交或删除/);
  const waiting = review.wait(5000);
  await mutate('submit', { batchId: 'batch1' });
  const batch = await waiting;
  assert.equal(batch.batch.id, 'batch1');
  assert.equal(batch.prdPath, options.prdPath);
  assert.equal((await review.wait(0)).batch.id, 'batch1');
  await review.mutate({ action: 'submit', batchId: 'batch1', version: -1 });
  assert.equal(review.view().batches.length, 1);
  await mutate('save', { annotations: [] });
  await assert.rejects(review.publish({ batchId: 'wrong', summary: 'x' }), /当前待处理/);
  await assert.rejects(review.publish({ batchId: 'batch1', revision: config.prd.revision, summary: 'x' }), /未变化/);
  assert.equal(await readFile(options.prdPath, 'utf8'), source);
  const revised = source.replace('帮助用户创建**新的任务**。', '帮助用户批量创建新的任务。');
  await writeFile(options.prdPath, revised);
  const { document } = await readPrdDocument(options.prdPath);
  await assert.rejects(review.publish({ batchId: 'batch1', summary: 'x', revision: 'wrong' }), /不符/);
  await review.publish({ batchId: 'batch1', summary: '已补充批量创建。', revision: document.revision });
  assert.equal(review.view().previousSource, source);
  assert.equal(review.view().status, 'reviewing');
  assert.deepEqual(review.view().annotations, []);
  assert.equal((await review.wait(0)).status, 'pending');
  const updated = await (await fetch(`${wb.url}api/config`)).json();
  assert.equal(updated.prd.source, revised);
  const portable = makeReadOnlyReviewConfig(updated, 'index.html', new Date().toISOString());
  assert.equal(portable.prdReview, null);
  await mutate('end');
  assert.equal((await review.wait(0)).status, 'ended');
  assert.equal(await readFile(options.prdPath, 'utf8'), revised);
});

test('confirmation request is distinct from ending review and completes only after formal PRD confirmation', async t => {
  const options = await fixture();
  const wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const sourceRevision = review.view().revision;
  await review.mutate({ ...review.view(), action: 'confirm', annotations: [] });
  assert.equal(review.view().status, 'confirmation_requested');
  const requested = await review.wait(0);
  assert.equal(requested.status, 'confirmation_requested');
  assert.equal(requested.revision, sourceRevision);
  await assert.rejects(review.completeConfirmation({
    sourceRevision, confirmedPrdPath: options.prdPath, revision: sourceRevision, summary: '尚未确认',
  }), /尚未变更为“已确认”/);

  const confirmedDirectory = join(options.projectPath, 'confirmed-documents');
  const confirmedPrdPath = join(confirmedDirectory, 'PRD.md');
  await mkdir(confirmedDirectory);
  await writeFile(confirmedPrdPath, source
    .replace('> 文档状态：草稿', '> 文档状态：已确认')
    .replace('帮助团队管理任务。', '未再次评审的正文变化。'));
  const { document: changedDocument } = await readPrdDocument(confirmedPrdPath);
  await assert.rejects(review.completeConfirmation({
    sourceRevision, confirmedPrdPath, revision: changedDocument.revision, summary: '夹带正文变化',
  }), /正文变化/);
  await writeFile(confirmedPrdPath, source.replace('> 文档状态：草稿', '> 文档状态：已确认'));
  const { document } = await readPrdDocument(confirmedPrdPath);
  await assert.rejects(review.completeConfirmation({
    sourceRevision: 'wrong', confirmedPrdPath, revision: document.revision, summary: '确认',
  }), /源 revision/);
  await review.completeConfirmation({
    sourceRevision, confirmedPrdPath, revision: document.revision, summary: '已完成正式确认并移入确认目录。',
  });
  assert.equal(review.view().status, 'confirmed');
  assert.equal(review.view().confirmedPath, confirmedPrdPath);
  assert.equal((await review.wait(0)).status, 'confirmed');
  await review.completeConfirmation({
    sourceRevision, confirmedPrdPath, revision: document.revision, summary: '幂等重试',
  });
});

test('new writable review accepts only draft or reviewing PRD lifecycle states', async () => {
  for (const status of ['已确认', '已替代', '待定']) {
    const options = await fixture();
    await writeFile(options.prdPath, source.replace('> 文档状态：草稿', `> 文档状态：${status}`));
    await assert.rejects(startPrdReviewWorkbench(options), status === '待定' ? /无法识别/ : /不能进入可写评审/);
  }
});

test('HTTP write authorization and stale revision fail closed; explicit reload and restart retain feedback', async t => {
  const options = await fixture();
  const wb = await startPrdReviewWorkbench(options);
  t.after(async () => { if (wb.server.listening) await wb.stop(); });
  const review = wb.prdReview;
  const request = async (body, headers = {}) => fetch(`${wb.url}api/prd-review`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await request({ action: 'end' })).status, 403);
  assert.equal((await request({ ...review.view(), action: 'end' }, { origin: 'https://example.com' })).status, 403);
  const foreignHostStatus = await new Promise((resolveStatus, reject) => {
    const req = httpRequest(`${wb.url}api/config`, { headers: { host: 'attacker.invalid' } }, response => { response.resume(); resolveStatus(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHostStatus, 403);
  await review.mutate({ ...review.view(), action: 'save', annotations: [annotation()] });
  await writeFile(options.prdPath, source.replace('v0.1', 'v0.2'));
  assert.equal((await request({ ...review.view(), action: 'submit', batchId: 'stale' })).status, 409);
  assert.equal(review.view().annotations.length, 1);
  const id = review.sessionId;
  await wb.stop();
  const reopened = await startPrdReviewWorkbench({ ...options, resumeSessionId: id });
  t.after(() => reopened.stop());
  assert.equal(reopened.prdReview.view().annotations.length, 1);
  assert.equal(reopened.prdReview.view().revision, review.view().revision);
  assert.notEqual(reopened.prdReview.view().token, review.view().token);
  await reopened.prdReview.mutate({ ...reopened.prdReview.view(), action: 'reload' });
  assert.equal(reopened.prdReview.view().annotations.length, 0);
  assert.notEqual(reopened.prdReview.view().revision, review.view().revision);
});

test('PRD source must be in project including symlink realpaths', async () => {
  const options = await fixture(), other = await fixture();
  await symlink(other.prdPath, join(options.projectPath, 'outside.md'));
  await assert.rejects(resolvePrdReviewSources({ ...options, prdPath: join(options.projectPath, 'outside.md') }), /当前 Project/);
});

test('composer submits a full draft atomically without save; rejected drafts and retries preserve state', async t => {
  const options = await fixture();
  const wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const input = { ...review.view(), action: 'submit', batchId: 'composer-one', annotations: [annotation()] };
  await assert.rejects(review.mutate({ ...input, annotations: [{ ...annotation(), anchor: { quote: '不属于原文', startLine: 21, endLine: 21 } }] }), /不属于/);
  assert.equal(review.view().version, 0);
  assert.deepEqual(review.view().annotations, []);
  await review.mutate(input);
  assert.equal(review.view().version, 1);
  assert.equal(review.view().status, 'reviewing');
  assert.equal(review.view().batches[0].status, 'queued');
  assert.equal((await review.wait(0)).batch.annotations[0].comment, annotation().comment);
  await review.mutate(input);
  assert.equal(review.view().batches.length, 1);
  assert.equal(await readFile(options.prdPath, 'utf8'), source);
});

test('queue receipt, withdrawal and cooperative stop are distinct; drafts remain writable', async t => {
  const options = await fixture(), wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const mutate = (action, extra = {}) => review.mutate({ ...review.view(), action, ...extra });
  const submit = id => mutate('submit', { batchId: id, annotations: [annotation()] });
  await submit('first');
  await submit('second');
  assert.deepEqual(review.view().batches.map(b => b.status), ['queued', 'queued']);
  assert.equal(review.view().agentConnected, false);
  await assert.rejects(mutate('stop', { batchId: 'first' }), /进行中/);
  await mutate('withdraw', { batchId: 'second' });
  await review.mutate({ action: 'withdraw', batchId: 'second', version: -1 });
  assert.equal((await review.wait(0)).batch.id, 'first');
  await assert.rejects(mutate('withdraw', { batchId: 'first' }), /只能撤回/);
  await assert.rejects(review.acknowledgeStop({ batchId: 'first', summary: 'fake' }), /请求停止/);
  await submit('third');
  await mutate('save', { annotations: [{ id: 'draft', kind: 'general', comment: '下一批草稿' }] });
  await mutate('stop', { batchId: 'first' });
  await review.mutate({ action: 'stop', batchId: 'first', version: -1 });
  assert.equal((await review.feedbackStatus({ batchId: 'first' })).status, 'stop_requested');
  assert.equal((await review.wait(0)).status, 'stop_requested');
  assert.equal(review.view().batches[2].status, 'queued', 'stop request must not start another batch');
  await assert.rejects(review.publish({ batchId: 'first', revision: review.view().revision, summary: 'late', unchanged: true }), /停止/);
  await assert.rejects(mutate('end'), /等待/);
  await review.acknowledgeStop({ batchId: 'first', summary: '已停止，没有修改正文。' });
  await review.acknowledgeStop({ batchId: 'first', summary: 'retry' });
  assert.equal(review.view().batches[0].status, 'stopped');
  assert.equal(review.view().annotations[0].comment, '下一批草稿');
  assert.equal(await readFile(options.prdPath, 'utf8'), source, 'stop does not write or roll back PRD');
  assert.equal((await review.wait(0)).batch.id, 'third');
  await review.publish({ batchId: 'third', revision: review.view().revision, summary: '保持正文', unchanged: true });
  assert.equal(review.view().annotations[0].comment, '下一批草稿', 'publication does not clear the next draft');
});

test('claim vs withdrawal is atomic and a stop request survives restart without retrying execution', async t => {
  const options = await fixture();
  let wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  await review.mutate({ ...review.view(), action: 'submit', batchId: 'race', annotations: [annotation()] });
  const snapshot = review.view();
  const [claim, withdrawal] = await Promise.allSettled([review.wait(0), review.mutate({ ...snapshot, action: 'withdraw', batchId: 'race' })]);
  assert.equal(claim.status, 'fulfilled');
  assert.equal(withdrawal.status, 'rejected');
  assert.equal(review.view().batches[0].status, 'processing');
  await review.mutate({ ...review.view(), action: 'stop', batchId: 'race' });
  await writeFile(options.prdPath, source.replace('v0.1', 'v0.2'));
  await wb.stop();
  wb = await startPrdReviewWorkbench({ ...options, resumeSessionId: review.sessionId });
  assert.equal((await wb.prdReview.wait(0)).status, 'stop_requested');
  await wb.prdReview.acknowledgeStop({ batchId: 'race', summary: '版本标识已写入，后续修订已停止。' });
  assert.match(await readFile(options.prdPath, 'utf8'), /v0.2/);
  await wb.prdReview.mutate({ ...wb.prdReview.view(), action: 'reload' });
  assert.notEqual(wb.prdReview.view().revision, snapshot.revision);
});

test('published revisions retain queued feedback and draft rebase requires unique unchanged context', async t => {
  const options = await fixture(), wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const mutate = (action, extra = {}) => review.mutate({ ...review.view(), action, ...extra });
  const baseRevision = review.view().revision;
  await mutate('submit', { batchId: 'first', annotations: [annotation()] });
  await review.wait(0);
  await writeFile(options.prdPath, '\n' + source);
  // While the consumer is writing, submit against the published snapshot, not a transient disk file.
  await mutate('submit', { batchId: 'second', annotations: [annotation()] });
  await mutate('save', { annotations: [annotation()] });
  const { document } = await readPrdDocument(options.prdPath);
  await review.publish({ batchId: 'first', revision: document.revision, summary: '增加首行空行' });
  assert.equal(review.view().draftRevision, baseRevision, 'saved drafts must not inherit the newly published revision');
  assert.equal(review.view().annotations[0].anchor.startLine, 21);
  await assert.rejects(mutate('submit', { batchId: 'old-saved-draft', annotations: undefined }), /旧版草稿/);
  assert.equal(review.view().batches[1].status, 'queued');
  await mutate('withdraw', { batchId: 'second' });
  await mutate('rebase', { baseRevision, annotations: [annotation()] });
  assert.equal(review.view().annotations[0].anchor.startLine, 22);
  const preserved = review.view().annotations;
  await writeFile(options.prdPath, source.replace('帮助用户创建**新的任务**。', '此处已经被改写。'));
  await mutate('reload');
  await assert.rejects(mutate('rebase', { baseRevision, annotations: [annotation()] }), /原选区已变化/);
  assert.equal(review.view().batches[1].annotations[0].anchor.quote, annotation().anchor.quote);
  assert.equal(preserved[0].comment, annotation().comment);
});

test('legacy submitted feedback migrates conservatively without inventing receipt or losing annotations', async t => {
  const options = await fixture();
  let wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  await wb.prdReview.mutate({ ...wb.prdReview.view(), action: 'submit', batchId: 'old', annotations: [annotation()] });
  const id = wb.prdReview.sessionId;
  await wb.stop();
  const file = join(options.projectPath, '.state/prd-reviews', `${id}.json`);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.schemaVersion = 1; saved.status = 'submitted'; saved.annotations = saved.batches[0].annotations; saved.batches[0].status = 'submitted';
  await writeFile(file, JSON.stringify(saved));
  wb = await startPrdReviewWorkbench({ ...options, resumeSessionId: id });
  assert.equal(wb.prdReview.view().status, 'reviewing');
  assert.equal(wb.prdReview.view().batches[0].status, 'needs_review');
  assert.equal(wb.prdReview.view().batches[0].annotations[0].comment, annotation().comment);
  assert.equal((await wb.prdReview.wait(0)).status, 'pending');
});

test('unrelated receipt does not reject a batch and withdrawal winning first prevents receipt', async t => {
  const options = await fixture(), wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  await review.mutate({ ...review.view(), action: 'submit', batchId: 'first', annotations: [annotation()] });
  const beforeClaim = review.view();
  await review.wait(0);
  await review.mutate({ ...beforeClaim, action: 'submit', batchId: 'second', annotations: [annotation()] });
  await review.publish({ batchId: 'first', revision: beforeClaim.revision, summary: '无变化', unchanged: true });
  const [withdrawn, claim] = await Promise.all([
    review.mutate({ ...review.view(), action: 'withdraw', batchId: 'second' }), review.wait(0),
  ]);
  assert.equal(withdrawn.batches[1].status, 'withdrawn');
  assert.equal(claim.status, 'pending');
});

test('idle wait survives the old timeout and wakes only on submitted feedback', { timeout: 65000 }, async t => {
  const wb = await startPrdReviewWorkbench(await fixture());
  t.after(() => wb.stop());
  const review = wb.prdReview;
  let settled = false;
  const waiting = review.wait().then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 51000));
  assert.equal(settled, false, 'no pending response across the former 50 second boundary');
  assert.equal(review.view().agentConnected, true);
  await assert.rejects(review.wait(), /已有等待/);
  await review.mutate({ ...review.view(), action: 'submit', batchId: 'after-idle', annotations: [annotation()] });
  assert.equal((await waiting).batch.id, 'after-idle');
  assert.equal(review.view().agentConnected, false, 'a completed wait is not an online desktop task');
  await review.feedbackStatus({ batchId: 'after-idle' });
  assert.equal(review.view().agentConnected, false, 'a recent status check is not an active receiver');
});

test('cancelled and disconnected waits release their listener without claiming future feedback', async t => {
  const wb = await startPrdReviewWorkbench(await fixture());
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const controller = new AbortController();
  const waiting = review.wait(undefined, { signal: controller.signal });
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(review.view().agentConnected, false);
  await review.mutate({ ...review.view(), action: 'submit', batchId: 'later', annotations: [annotation()] });
  assert.equal(review.view().batches[0].status, 'queued');
  assert.equal((await review.wait(0)).batch.id, 'later');
  await review.publish({ batchId: 'later', revision: review.view().revision, unchanged: true, summary: '保留原文' });
  const disconnected = review.wait();
  review.close();
  assert.equal((await disconnected).status, 'disconnected');
});

test('short probe stops without prescribing repeated model polling; end wakes default wait', async t => {
  const wb = await startPrdReviewWorkbench(await fixture());
  t.after(() => wb.stop());
  const review = wb.prdReview;
  const idle = await review.wait(1);
  assert.equal(idle.status, 'pending');
  assert.match(idle.instruction, /不自动重试/);
  const waiting = review.wait();
  await review.mutate({ ...review.view(), action: 'end' });
  assert.equal((await waiting).status, 'ended');
});

test('external changes still block queued batches after a valid in-session publication', async t => {
  const options = await fixture(), wb = await startPrdReviewWorkbench(options);
  t.after(() => wb.stop());
  const review = wb.prdReview;
  for (const batchId of ['first', 'second', 'third']) await review.mutate({ ...review.view(), action: 'submit', batchId, annotations: [annotation()] });
  await review.wait(0);
  await writeFile(options.prdPath, source + '\n');
  const { document } = await readPrdDocument(options.prdPath);
  await review.publish({ batchId: 'first', revision: document.revision, summary: '首批修订' });
  await writeFile(options.prdPath, source + '\n外部新增内容\n');
  assert.equal((await review.wait(0)).status, 'pending');
  assert.deepEqual(review.view().batches.map(batch => batch.status), ['published', 'needs_review', 'queued']);
  assert.equal((await review.wait(0)).status, 'pending', 'must not skip unresolved external changes');
  await review.mutate({ ...review.view(), action: 'reload' });
  assert.deepEqual(review.view().batches.map(batch => batch.status), ['published', 'needs_review', 'needs_review']);
});
