import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { documentFixture, specText, prdText } from './fixtures/document-updates.mjs';
import { prepareStudioProject } from '../src/review-session.mjs';
import { checkDocumentUpdates, documentBaseline, reloadDocuments } from '../src/document-update-service.mjs';
import { readMarkdownBundle } from '../src/markdown-spec-reader.mjs';
import { startStudio } from '../src/server.mjs';
import { makeReadOnlyReviewConfig } from '../src/review-package.mjs';
import { createWorkbenchConfig } from '../src/review-session.mjs';

async function setup(t) {
  const fixture = await documentFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  return { ...fixture, active: await prepareStudioProject(fixture.project, join(fixture.directory, 'state/projects.json')) };
}

test('正文未改版本号仍检测，两个文档一起更新，原始文件与 Map 不写回', async t => {
  const f = await setup(t);
  assert.equal((await checkDocumentUpdates(f.active)).changed, false);
  const map = await readFile(f.mapPath, 'utf8');
  const projection = await readFile(f.specPath, 'utf8');
  await writeFile(f.sourceSpecPath, specText.replace('可以重试', '可在原页面重试，新说明'));
  await writeFile(f.prdPath, prdText.replace('标题必填', '标题和描述必填'));
  assert.deepEqual((await checkDocumentUpdates(f.active)).documents, ['PRD', 'Spec']);
  await reloadDocuments(f.active, documentBaseline(f.active));
  assert.match(JSON.stringify(f.active.bundle), /新说明/);
  assert.equal(f.active.specDocument.source, await readFile(f.sourceSpecPath, 'utf8'));
  assert.equal(f.active.specDocument.revision, f.active.sourceSpecRevision);
  assert.match(f.active.prdDocument.source, /标题和描述必填/);
  assert.equal((await checkDocumentUpdates(f.active)).changed, false);
  assert.equal(await readFile(f.mapPath, 'utf8'), map);
  assert.equal(await readFile(f.specPath, 'utf8'), projection);
  assert.equal(makeReadOnlyReviewConfig(createWorkbenchConfig(f.active, true), 'index.html', 'now').documentUpdates, false);
});

test('旧投影首次进入也提示；格式错误或删除不部分更新，修复可重试', async t => {
  const f = await setup(t);
  f.active.bundle.product.version = '0.5';
  assert.equal((await checkDocumentUpdates(f.active)).changed, true);
  const original = f.active.bundle;
  await writeFile(f.prdPath, '尚未写完');
  await assert.rejects(reloadDocuments(f.active, documentBaseline(f.active)));
  assert.equal(f.active.bundle, original);
  await unlink(f.sourceSpecPath);
  assert.match((await checkDocumentUpdates(f.active)).error, /已载入版本/);
  await writeFile(f.sourceSpecPath, specText);
  await writeFile(f.prdPath, prdText);
  await reloadDocuments(f.active, documentBaseline(f.active));
  assert.equal(f.active.bundle.product.version, '1.0');
});

test('gate 草稿、旧请求和项目切换不能覆盖当前快照', async t => {
  const f = await setup(t);
  await assert.rejects(reloadDocuments(f.active, 'stale'), /版本已变化/);
  f.active.gate = true;
  f.active.bundle.modules[0].nodes[0].title = '尚未提交';
  await assert.rejects(reloadDocuments(f.active, documentBaseline(f.active)), /修订草稿/);
  f.active.gate = false;
  const original = f.active.bundle;
  await assert.rejects(reloadDocuments(f.active, documentBaseline(f.active), () => false), /项目或工作台/);
  assert.equal(f.active.bundle, original);
});

test('语法树不读取代码块里的假节点；完整保留多行异常、新增节点与失效关联原文', () => {
  const seed = { product: { id: 'UPDATES', title: 'demo', version: '1', status: 'draft' }, modules: [] };
  const source = specText + '\n  第二段异常说明。\n\n```markdown\n#### ACTION `FAKE`：示例\n```\n\n#### ACTION `TASK-CANCEL`：取消\n- 状态：`draft`\n- 来源：`formal-source`\n- 关联：`MISSING`\n- 产品结果：保留原结果。\n';
  const result = readMarkdownBundle(source, seed);
  assert.deepEqual(result.bundle.modules[0].nodes.map(n => n.id), ['TASK-SAVE', 'TASK-CANCEL']);
  assert.match(JSON.stringify(result.bundle), /第二段异常说明/);
  assert.match(JSON.stringify(result.bundle), /MISSING/);
  assert.equal(result.warnings.length, 1);
  assert.throws(() => readMarkdownBundle(specText + '\n' + specText, seed), /重复/);
});

test('统一 Spec 的公共约束独立读取，页面总表更新路由及父页面，不依赖旧投影', () => {
  const seed = { product: { id: 'UPDATES', title: 'demo', version: '1', status: 'draft' }, modules: [] };
  const source = `# 文档更新演示
## 2. 页面与模块依赖总览
### 2.1 页面登记与复用
| 页面 ID | 职责/场景 | 当前评审地址 | 父页面或上下文 |
|---|---|---|---|
| \`PAGE-HOME\` | 首页 | \`#home\` | 当前账户 |
| \`PAGE-TASK\` | 任务板 | \`?view=task#new\` | PAGE-HOME |
## 3. 公共约束与未决项
#### PERMISSION \`TASK-PERMISSION\`：保存权限
- 状态：\`draft\`
- 来源：\`product-decision\`
- 拒绝与恢复：无权限时保留输入；重新获得权限后可以重试。
## 4. 页面、区域与操作说明
${specText.slice(specText.indexOf('## MODULE')).replace('- 页面路由提示：\`#task\`', '- 页面身份与路由：见 2.1')}
- 关联：\`TASK-PERMISSION\`
## 5. 工程实现约束
这里不是业务节点。
\`\`\`markdown
#### RULE \`FAKE\`：示例
\`\`\`
`;
  for (const previous of [seed, { ...seed, pages: [{ id: 'PAGE-TASK', title: '旧任务板', anchorHints: [], routeHints: ['#old'], parentPageId: 'PAGE-REMOVED' }] }]) {
    const { bundle, warnings } = readMarkdownBundle(source, previous);
    const nodes = bundle.modules.flatMap(module => module.nodes);
    assert.deepEqual(nodes.map(node => node.id), ['TASK-PERMISSION', 'TASK-SAVE']);
    assert.equal(nodes[0].pageId, undefined);
    assert.match(JSON.stringify(nodes[0].contentBlocks), /重新获得权限后可以重试/);
    assert.equal(nodes[1].relations[0].targetId, 'TASK-PERMISSION');
    assert.equal(nodes[1].pageId, 'PAGE-TASK');
    assert.deepEqual(bundle.pages.find(page => page.id === 'PAGE-TASK').routeHints, ['?view=task#new']);
    assert.equal(bundle.pages.find(page => page.id === 'PAGE-TASK').parentPageId, 'PAGE-HOME');
    assert.equal(bundle.pages.find(page => page.id === 'PAGE-HOME').parentPageId, null);
    assert.deepEqual(warnings, []);
  }
  assert.throws(() => readMarkdownBundle(source.replace('公共约束与未决项', '其他说明'), seed), /缺少标准 MODULE/);
  assert.throws(() => readMarkdownBundle(source.replace('PERMISSION `TASK-PERMISSION`', 'ACTION `TASK-PERMISSION`'), seed), /MODULE/);
  assert.throws(() => readMarkdownBundle(source + '\n#### RULE `UNSCOPED`：未归属\n- 状态：`draft`\n- 来源：`formal-source`', seed), /缺少标准 MODULE/);
});

test('HTTP 加载要求当前会话基线、同源 JSON；失败保留会话', async t => {
  const f = await setup(t);
  const studio = await startStudio({ appRoot: resolve(import.meta.dirname, '..'), statePath: join(f.directory, 'http/projects.json'), host: '127.0.0.1', port: 0 });
  t.after(() => studio.stop());
  const post = (path, body, headers = {}) => fetch(`${studio.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('api/project/confirm', f.project)).status, 200);
  const checked = await (await fetch(`${studio.url}api/document-updates`)).json();
  assert.equal((await post('api/document-updates', { baseline: checked.baseline }, { origin: 'https://example.com' })).status, 403);
  assert.equal((await post('api/document-updates', { baseline: 'stale' })).status, 409);
  assert.equal((await post('api/document-updates', { baseline: checked.baseline })).status, 200);
});


test('已删除节点的人工 Map 保留；兼容 JSON 和仅 PRD 也可更新', async t => {
  const f = await setup(t);
  const item = { id: 'MAP-SAVE', type: 'Annotation', motivation: 'linking', body: { id: 'TASK-SAVE', type: 'Text' }, target: { source: f.htmlPath, selector: { type: 'CssSelector', value: 'button' }, fingerprint: { tag: 'button', text: '保存任务' } }, status: 'confirmed' };
  f.active.map.items = [item];
  const original = JSON.stringify(f.active.map);
  await writeFile(f.mapPath, original);
  await writeFile(f.sourceSpecPath, specText.replaceAll('TASK-SAVE', 'TASK-NEW'));
  const result = await reloadDocuments(f.active, documentBaseline(f.active));
  assert.equal(f.active.map.items[0].body.id, 'TASK-SAVE');
  assert.match(result.warnings.join(''), /节点已删除/);
  assert.equal(await readFile(f.mapPath, 'utf8'), original);
  const jsonOnly = await prepareStudioProject({ ...f.project, sourceSpecPath: '' }, join(f.directory, 'json/projects.json'));
  const next = structuredClone(f.bundle); next.product.version = '2.0';
  await writeFile(f.specPath, JSON.stringify(next));
  assert.equal((await checkDocumentUpdates(jsonOnly)).changed, true);
  await reloadDocuments(jsonOnly, documentBaseline(jsonOnly));
  assert.equal(jsonOnly.bundle.product.version, '2.0');
  const prdOnly = await prepareStudioProject({ ...f.project, sourceSpecPath: '', specPath: '' }, join(f.directory, 'prd/projects.json'));
  await writeFile(f.prdPath, prdText.replace('v1.0', 'v2.0'));
  await reloadDocuments(prdOnly, documentBaseline(prdOnly));
  assert.equal(prdOnly.bundle.product.version, 'v2.0');
});


test('全文冻结包含节点外定义，gate 草稿不能伪装成已写回原文', async t => {
  const f = await setup(t);
  const source = specText + '\n## 工程实现约束\n请求重试复用操作标识。\n';
  await writeFile(f.sourceSpecPath, source);
  await reloadDocuments(f.active, documentBaseline(f.active));
  const current = createWorkbenchConfig(f.active, true);
  assert.equal(current.specDocument.source, source);
  assert.equal(JSON.stringify(current.productSpec).includes('请求重试复用操作标识'), false);
  f.active.gate = true;
  f.active.bundle.modules[0].nodes[0].title = '尚未提交';
  const frozen = makeReadOnlyReviewConfig(createWorkbenchConfig(f.active, true), 'index.html', 'now');
  assert.equal(frozen.specDocument.source, source);
  assert.equal(frozen.specDocument.pendingDraft, true);
  assert.equal(frozen.canSaveSpec, false);
  f.active.specDocument.source = '未来版本';
  assert.equal(frozen.specDocument.source, source);
});
