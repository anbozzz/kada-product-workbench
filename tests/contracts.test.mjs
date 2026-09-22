import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createEmptySpecMap,
  diffSpecBundles,
  validateSpecBundle,
  validateSpecMap,
} from '../src/contracts.mjs';

const root = resolve(import.meta.dirname, '..');
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));

test('非医疗示例符合 Spec 与映射契约', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const map = await readJson('examples/task-board/spec-map.json');
  assert.deepEqual(validateSpecBundle(bundle), []);
  assert.deepEqual(validateSpecMap(map, bundle), []);
});

test('拒绝重复节点和无效关系目标', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const duplicate = structuredClone(bundle.modules[0].nodes[0]);
  bundle.modules[1].nodes.push(duplicate);
  bundle.modules[0].nodes[0].relations.push({ type: 'governed-by', targetId: 'MISSING-RULE' });
  const errors = validateSpecBundle(bundle);
  assert.ok(errors.some(error => error.includes('Spec 节点 ID 重复')));
  assert.ok(errors.some(error => error.includes('不存在的节点')));
});

test('映射文件必须与 Product Spec 一致且每个节点只映射一次', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const map = createEmptySpecMap('WRONG-PRODUCT', 'index.html');
  const item = {
    id: 'urn:test:one', type: 'Annotation', motivation: 'linking',
    body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
    target: { source: 'index.html', selector: { type: 'CssSelector', value: '.new-task' }, fingerprint: { tag: 'button', text: '新建任务' } },
    status: 'confirmed',
  };
  map.items.push(item, { ...structuredClone(item), id: 'urn:test:two' });
  const errors = validateSpecMap(map, bundle);
  assert.ok(errors.some(error => error.includes('productSpecId 与 Spec bundle 不一致')));
  assert.ok(errors.some(error => error.includes('被重复映射')));
});

test('规则和状态节点不能直接映射 DOM', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const map = createEmptySpecMap(bundle.product.id, 'index.html');
  map.items.push({
    id: 'urn:test:rule', type: 'Annotation', motivation: 'linking',
    body: { id: 'TASK-RULE-NAME', type: 'Text' },
    target: { source: 'index.html', selector: { type: 'CssSelector', value: '.new-task' }, fingerprint: { tag: 'button', text: '新建任务' } },
    status: 'confirmed',
  });
  assert.ok(validateSpecMap(map, bundle).some(error => error.includes('不能把 RULE 节点直接映射到 DOM')));
});

test('Schema 与运行时共同接受本地开发代理上下文，并要求映射 revision', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const map = createEmptySpecMap(bundle.product.id, 'http://127.0.0.1:4317');
  map.items.push({
    id: 'urn:test:dev-context',
    type: 'Annotation',
    motivation: 'linking',
    body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
    target: {
      source: 'http://127.0.0.1:4317',
      context: { url: '/target-dev/#tasks' },
      selector: { type: 'CssSelector', value: '.new-task' },
      fingerprint: { tag: 'button', text: '新建任务' },
    },
    status: 'confirmed',
  });
  assert.deepEqual(validateSpecMap(map, bundle), []);

  delete map.updatedAt;
  assert.ok(validateSpecMap(map, bundle).some(error => error.includes('updatedAt 是必填项')));
});

test('审阅差异只包含可由 Codex 回写正文的节点字段', async () => {
  const base = await readJson('examples/task-board/product.spec.json');
  const draft = structuredClone(base);
  const node = draft.modules[1].nodes.find(item => item.id === 'TASK-SURFACE-BOARD');
  node.statement = '新的审阅定义';
  const changes = diffSpecBundles(base, draft);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].nodeId, 'TASK-SURFACE-BOARD');
  assert.equal(changes[0].operation, 'update');
  assert.equal(changes[0].after.statement, '新的审阅定义');
  assert.equal('relations' in changes[0].after, false);
  assert.equal('fields' in changes[0].after, false);
});

test('内容块允许任意字段标题并保留原文顺序', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const node = bundle.modules[0].nodes.find(item => item.id === 'TASK-ACTION-CREATE');
  assert.deepEqual(node.contentBlocks.map(block => block.label), [
    '使用意图',
    '发生之前',
    '触发方式',
    '页面反馈',
    '结果边界',
    '失败处理',
    '可观察检查',
  ]);
  assert.deepEqual(validateSpecBundle(bundle), []);
});

test('内容块展示协议拒绝重复 ID、空标题、非文本内容和双重正文来源', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const node = bundle.modules[0].nodes.find(item => item.id === 'TASK-ACTION-CREATE');
  node.fields = { arbitrary: '旧版字段' };
  node.contentBlocks[1].id = node.contentBlocks[0].id;
  node.contentBlocks[2].label = '   ';
  node.contentBlocks[3].content = { nested: true };

  const errors = validateSpecBundle(bundle);
  assert.ok(errors.some(error => error.includes('不能同时使用 contentBlocks 和旧版 fields')));
  assert.ok(errors.some(error => error.includes('内容块 ID 重复')));
  assert.ok(errors.some(error => error.includes('.label 必须是非空字符串')));
  assert.ok(errors.some(error => error.includes('.content 必须是非空字符串')));
});

test('全局页面要求稳定引用并校验显式导航父子关系', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  assert.deepEqual(validateSpecBundle(bundle), []);

  const page = bundle.pages[0];
  const node = bundle.modules[0].nodes.find(item => item.id === 'TASK-ACTION-CREATE');
  page.anchorHints.push('   ');
  node.pageId = 'TASK-PAGE-MISSING';
  const errors = validateSpecBundle(bundle);
  assert.ok(errors.some(error => error.includes('anchorHints 只能包含非空字符串')));
  assert.ok(errors.some(error => error.includes('pageId 未引用顶层页面')));
});

test('页面父级必须存在且不能形成循环', async () => {
  const missingParent = await readJson('examples/task-board/product.spec.json');
  missingParent.pages[0].parentPageId = 'TASK-PAGE-MISSING';
  assert.ok(validateSpecBundle(missingParent).some(error => error.includes('引用了不存在的页面')));

  const cycle = await readJson('examples/task-board/product.spec.json');
  cycle.pages.push({
    id: 'TASK-PAGE-CHILD',
    title: '任务子页面',
    parentPageId: cycle.pages[0].id,
    anchorHints: ['任务子页面'],
  });
  cycle.pages[0].parentPageId = cycle.pages[1].id;
  assert.ok(validateSpecBundle(cycle).some(error => error.includes('形成页面导航循环')));
});

test('同一全局页面可承载多个模块的节点', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  assert.equal(bundle.modules[0].nodes.find(item => item.id === 'TASK-ACTION-CREATE').pageId, 'TASK-PAGE-BOARD');
  assert.equal(bundle.modules[1].nodes.find(item => item.id === 'TASK-ACTION-COMPLETE').pageId, 'TASK-PAGE-BOARD');
  assert.deepEqual(validateSpecBundle(bundle), []);
});

test('页面投影允许空页面和部分节点未归页，不反向约束功能正文', async () => {
  const withoutPageEvidence = await readJson('examples/task-board/product.spec.json');
  withoutPageEvidence.pages = [];
  for (const module of withoutPageEvidence.modules) {
    for (const node of module.nodes) node.pageId = null;
  }
  assert.deepEqual(validateSpecBundle(withoutPageEvidence), []);

  const partialPageEvidence = await readJson('examples/task-board/product.spec.json');
  partialPageEvidence.modules[0].nodes.find(item => item.id === 'TASK-ACTION-CREATE').pageId = null;
  assert.deepEqual(validateSpecBundle(partialPageEvidence), []);
});

test('旧版 module.pages 和完全无页面元数据继续兼容', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  const [sharedPage] = bundle.pages;
  for (const module of bundle.modules) {
    const legacyPageId = `${module.id}-PAGE`;
    module.pages = [{ ...sharedPage, id: legacyPageId }];
    for (const node of module.nodes) {
      if (node.pageId) node.pageId = legacyPageId;
    }
  }
  delete bundle.pages;
  assert.deepEqual(validateSpecBundle(bundle), []);

  for (const module of bundle.modules) {
    delete module.pages;
    for (const node of module.nodes) delete node.pageId;
  }
  assert.deepEqual(validateSpecBundle(bundle), []);
});

test('旧版 fields 与等价 contentBlocks 不产生伪审阅差异', async () => {
  const base = await readJson('examples/task-board/product.spec.json');
  const draft = structuredClone(base);
  const node = draft.modules[0].nodes.find(item => item.id === 'TASK-RULE-NAME');
  const content = node.fields.failure;
  delete node.fields;
  node.contentBlocks = [{ id: 'legacy-1', label: '异常与失败', content }];
  assert.deepEqual(diffSpecBundles(base, draft), []);
});

test('Spec 内部投影可记录来源 PRD 版本和中文章节 ID', async () => {
  const bundle = await readJson('examples/task-board/product.spec.json');
  bundle.product.prdSource = {
    path: '产品文档/产品需求文档.md',
    version: 'v0.3',
    revision: 'sha256:abc123',
  };
  bundle.modules[0].nodes[0].prdSectionIds = [
    '需求-任务-新建任务',
    '规则-任务上下文-当前任务板',
  ];
  assert.deepEqual(validateSpecBundle(bundle), []);
  bundle.modules[0].nodes[0].prdSectionIds = ['TASK-PRD-001'];
  assert.match(validateSpecBundle(bundle).join('\n'), /必须使用包含中文语义/);
});
