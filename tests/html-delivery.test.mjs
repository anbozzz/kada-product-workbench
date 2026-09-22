import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, parse } from 'node:path';
import { publishHtmlReady, resolveHtmlDeliveryBatch } from '../src/html-delivery.mjs';

const fixture = async t => {
  const projectPath = await realpath(await mkdtemp(join(tmpdir(), 'ips-html-sync-')));
  t.after(() => rm(projectPath, { recursive: true, force: true }));
  const htmlPath = join(projectPath, 'index.html');
  await writeFile(htmlPath, '<title>page</title>');
  return { projectPath, htmlPath, input: { projectPath, htmlPaths: [htmlPath] } };
};

const assertSyncRequired = result => {
  assert.equal(result.status, 'document-sync-required');
  assert.equal(result.route, 'prd-spec');
  assert.equal(result.skill, 'product-documentation');
  assert.deepEqual(result.followUpSkills, []);
  assert.equal(result.prdStyle, undefined);
  assert.equal(result.decision, undefined);
};

const legacyFollowup = requirements => ({
  source: 'product-documentation', prdHandled: true, pageUpdateAuthorized: true, requirements,
});

test('任意明确交付的 HTML 固定接续两份文档，不调用旧弹窗回调或写状态', async t => {
  const { projectPath, input } = await fixture(t);
  const result = await publishHtmlReady(input, {
    stateRoot: join(projectPath, '.old-state'),
    elicit: () => { assert.fail('不得发起文档或类型选择'); },
  });
  assertSyncRequired(result);
  assert.deepEqual(await readdir(projectPath), ['index.html']);
  assert.match(result.instruction, /工具返回不表示文档已同步/);
  assert.match(result.instruction, /非产品 HTML/);
});

test('连续十轮页面修订每轮都要求 PRD 与 Spec，同一文件的 revision 随内容变化', async t => {
  const { htmlPath, input } = await fixture(t);
  const revisions = new Set();
  const deliveries = new Set();
  for (let round = 1; round <= 10; round += 1) {
    await writeFile(htmlPath, `<title>用户第 ${round} 轮修订</title>`);
    const result = await publishHtmlReady(input);
    assertSyncRequired(result);
    revisions.add(result.batch.artifacts[0].revision);
    deliveries.add(result.batch.deliveryId);
  }
  assert.equal(revisions.size, 10);
  assert.equal(deliveries.size, 10);
});

test('上报后中断或文档另有修改，相同 HTML 重试仍必须核对，不把上报当完成', async t => {
  const { projectPath, input } = await fixture(t);
  const first = await publishHtmlReady(input);
  // First result was not acted on; a document changes before the resumed call.
  await writeFile(join(projectPath, 'PRD.md'), '仍有待修订需求');
  const resumed = await publishHtmlReady(input);
  assertSyncRequired(first);
  assertSyncRequired(resumed);
  assert.equal(first.batch.deliveryId, resumed.batch.deliveryId);
  assert.equal(await readFile(join(projectPath, 'PRD.md'), 'utf8'), '仍有待修订需求');
});

test('并发重复上报都返回待同步，批次身份一致，无持久化完成标记', async t => {
  const { input, projectPath } = await fixture(t);
  const results = await Promise.all([publishHtmlReady(input), publishHtmlReady(input)]);
  results.forEach(assertSyncRequired);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(await readdir(projectPath), ['index.html']);
});

test('JS 组件改变页面但 HTML 入口未变时，同一入口仍接续两份文档', async t => {
  const { input, projectPath } = await fixture(t);
  const script = join(projectPath, 'app.js');
  await writeFile(script, 'document.body.textContent = "旧页面";');
  const first = await publishHtmlReady(input);
  await writeFile(script, 'document.body.textContent = "用户修订后的页面";');
  const changed = await publishHtmlReady(input);
  assert.equal(changed.batch.deliveryId, first.batch.deliveryId);
  assertSyncRequired(changed);
});

test('旧版选择、跳过或 covered 决定均不抑制同步，也不被迁移或删除', async t => {
  const { projectPath, input } = await fixture(t);
  const batch = await resolveHtmlDeliveryBatch(input);
  const stateRoot = join(projectPath, '.old-state');
  const directory = join(stateRoot, 'decisions');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${batch.deliveryId}.json`);
  for (const decision of [
    { schemaVersion: 1, route: 'spec' },
    { schemaVersion: 2, route: 'prd', prdStyle: 'faithful-compressed' },
    { schemaVersion: 2, route: 'skip' },
    { schemaVersion: 3, route: 'none', reason: 'prd-followup-covered' },
  ]) {
    const original = JSON.stringify(decision);
    await writeFile(path, original);
    assertSyncRequired(await publishHtmlReady(input, { stateRoot }));
    assert.equal(await readFile(path, 'utf8'), original);
  }
  await writeFile(path, 'corrupt legacy state');
  assertSyncRequired(await publishHtmlReady(input, { stateRoot }));
});

test('旧版 prdFollowup 的 covered 和新差异声明都不能跳过任一文档', async t => {
  const { input } = await fixture(t);
  for (const requirements of ['covered', 'new-or-uncertain']) {
    assertSyncRequired(await publishHtmlReady({ ...input, prdFollowup: legacyFollowup(requirements) }));
  }
});

test('旧声明形状非法时报错，修正后同一批次可以正常重试', async t => {
  const { input } = await fixture(t);
  for (const prdFollowup of [null, [], {}, { ...legacyFollowup('covered'), pageUpdateAuthorized: false },
    { ...legacyFollowup('covered'), unknown: true }, legacyFollowup('unknown')]) {
    await assert.rejects(publishHtmlReady({ ...input, prdFollowup }), /prdFollowup/);
  }
  assertSyncRequired(await publishHtmlReady(input));
});

test('一个交付批次只读取显式列出的 HTML，顺序不影响身份，不扫描 PRD 或其他产物', async t => {
  const { projectPath, htmlPath, input } = await fixture(t);
  const another = join(projectPath, 'another.HTM');
  await writeFile(another, '<title>other</title>');
  await writeFile(join(projectPath, 'incidental.html'), '');
  // A directory named PRD.md must never be opened as a document by this tool.
  await mkdir(join(projectPath, 'PRD.md'));
  const forward = await publishHtmlReady({ ...input, htmlPaths: [another, htmlPath] });
  const backward = await publishHtmlReady({ ...input, htmlPaths: [htmlPath, another] });
  assertSyncRequired(forward);
  assert.equal(forward.batch.artifacts.length, 2);
  assert.deepEqual(forward.batch, backward.batch);
  assert.deepEqual(forward.batch.artifacts.map(a => a.relativePath), ['another.HTM', 'index.html']);
  assert.equal((await readdir(projectPath)).length, 4);
});

test('不同 Project 的相同文件内容不会共用交付身份', async t => {
  const left = await fixture(t);
  const right = await fixture(t);
  const [a, b] = await Promise.all([publishHtmlReady(left.input), publishHtmlReady(right.input)]);
  assert.notEqual(a.batch.deliveryId, b.batch.deliveryId);
  assert.equal(a.batch.artifacts[0].revision, b.batch.artifacts[0].revision);
});

test('拒绝越界文件及越界符号链接，拒绝同一文件的重复别名', async t => {
  const { input, projectPath, htmlPath } = await fixture(t);
  const outside = await fixture(t);
  const link = join(projectPath, 'escape.html');
  await symlink(outside.htmlPath, link);
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [outside.htmlPath] }), /当前 Project 内/);
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [link] }), /当前 Project 内/);
  const alias = join(projectPath, 'alias.html');
  await symlink(htmlPath, alias);
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [htmlPath, alias] }), /重复文件/);
});

test('拒绝缺失、空、过大、非 HTML 或目录制品，失败后允许正常重试', async t => {
  const { input, projectPath } = await fixture(t);
  for (const [name, content, pattern] of [
    ['empty.html', '', /为空/], ['notes.md', 'notes', /只接受/],
    ['large.html', 'x', /10MB/],
  ]) {
    const path = join(projectPath, name);
    await writeFile(path, content);
    if (name === 'large.html') await truncate(path, 10 * 1024 * 1024 + 1);
    await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [path] }), pattern);
  }
  await mkdir(join(projectPath, 'folder.html'));
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [join(projectPath, 'folder.html')] }), /不是文件/);
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [join(projectPath, 'missing.html')] }), /不存在/);
  assertSyncRequired(await publishHtmlReady(input));
});

test('Project 和 HTML 必须是明确绝对路径，限制批次数量且拒绝宽泛根目录', async t => {
  const { input, htmlPath } = await fixture(t);
  for (const htmlPaths of [[], undefined, 'index.html']) {
    await assert.rejects(publishHtmlReady({ ...input, htmlPaths }), /至少包含/);
  }
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: Array(21).fill(htmlPath) }), /最多包含 20/);
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: [htmlPath, htmlPath] }), /重复文件/);
  await assert.rejects(publishHtmlReady({ ...input, htmlPaths: ['index.html'] }), /绝对路径/);
  await assert.rejects(publishHtmlReady({ ...input, projectPath: '.' }), /绝对路径/);
  await assert.rejects(publishHtmlReady({ ...input, projectPath: htmlPath }), /必须是目录/);
  for (const projectPath of [parse(htmlPath).root, homedir()]) {
    await assert.rejects(publishHtmlReady({ ...input, projectPath }), /根目录或用户主目录/);
  }
});
