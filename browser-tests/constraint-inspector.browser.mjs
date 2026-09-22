import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';

import { createEmptySpecMap } from '../src/contracts.mjs';
import { startWorkbench } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const example = name => resolve(root, 'examples/task-board', name);
const outputDir = resolve(root, 'output/playwright');
const temp = await mkdtemp(join(tmpdir(), 'ips-constraints-'));
const mapPath = join(temp, 'spec-map.json');
const specPath = join(temp, 'product.spec.json');
const statePath = join(temp, 'state', 'projects.json');
const bundle = JSON.parse(await readFile(example('product.spec.json'), 'utf8'));
const fixtureNodes = bundle.modules.flatMap(module => module.nodes);
const filterNode = fixtureNodes.find(node => node.id === 'TASK-ACTION-FILTER-OVERDUE');
filterNode.statement = filterNode.title;
filterNode.prdSectionIds = ['需求-任务-逾期'];
const ruleNode = fixtureNodes.find(node => node.id === 'TASK-RULE-OVERDUE');
const ruleStatement = ruleNode.statement;
ruleNode.statement = ruleNode.title;
ruleNode.contentBlocks = [
  { id: 'rule-status', label: '状态', content: 'draft' },
  { id: 'rule-definition', label: '定义', content: ruleNode.title },
  { id: 'rule-body', label: '规则', content: ruleStatement },
  { id: 'rule-boundary', label: '依赖结果', content: ruleNode.fields.backendOutcome },
];
delete ruleNode.fields;
bundle.pages.unshift({
  id: 'TASK-PAGE-HOME',
  title: '首页',
  responsibility: '作为页面导航根节点。',
  anchorHints: ['产品首页'],
});
bundle.pages.find(item => item.id === 'TASK-PAGE-BOARD').parentPageId = 'TASK-PAGE-HOME';
bundle.pages.find(item => item.id === 'TASK-PAGE-BOARD').routeHints = ['/target/index.html'];
bundle.pages.push({
  id: 'EMPTY-PAGE',
  title: '空约束页面',
  parentPageId: 'TASK-PAGE-BOARD',
  responsibility: '承载空约束测试操作。',
  routeHints: ['/target/index.html'],
  anchorHints: ['新建任务'],
});
bundle.modules.push({
  id: 'EMPTY-CONSTRAINTS',
  title: '无约束模块',
  purpose: '验证非页面约束的分组空状态。',
  scope: '只验证右侧阅读入口。',
  journeys: ['从页面操作查看空约束状态'],
  nodes: [{
    id: 'EMPTY-ACTION',
    type: 'ACTION',
    title: '空约束操作',
    pageId: 'EMPTY-PAGE',
    status: 'confirmed',
    sourceKind: 'product-decision',
    statement: '用于验证当前节点和模块都没有非页面约束时的分别空状态。',
    anchorHints: ['新建任务'],
    contentBlocks: [],
    relations: [],
  }, {
    id: 'HIDDEN-ACTION',
    type: 'ACTION',
    title: '同路由下的隐藏页面操作',
    pageId: 'EMPTY-PAGE',
    status: 'confirmed',
    sourceKind: 'product-decision',
    statement: '验证刷新后尚未进入原页面状态时不会误报映射失效。',
    anchorHints: ['隐藏页面操作'],
    contentBlocks: [],
    relations: [],
  }],
});
await writeFile(specPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
const fixtureMap = createEmptySpecMap('TRAIL-TASKS', example('index.html'));
fixtureMap.items.push({
  id: 'urn:interactive-product-spec:map:EMPTY-ACTION',
  type: 'Annotation',
  motivation: 'linking',
  body: { id: 'EMPTY-ACTION', type: 'Text' },
  target: {
    source: example('index.html'),
    selector: { type: 'CssSelector', value: '#missing-empty-action' },
    fingerprint: { tag: 'button', text: '空约束操作' },
  },
  status: 'confirmed',
});
fixtureMap.items.push({
  id: 'urn:interactive-product-spec:map:TASK-ACTION-CREATE',
  type: 'Annotation',
  motivation: 'linking',
  body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
  target: {
    source: example('index.html'),
    context: { url: '/target/index.html' },
    selector: { type: 'CssSelector', value: 'button[aria-label="新建任务"]' },
    fingerprint: { tag: 'button', role: '', text: '+ 新建任务', ariaLabel: '新建任务' },
  },
  status: 'out-of-context',
});
fixtureMap.items.push({
  id: 'urn:interactive-product-spec:map:HIDDEN-ACTION',
  type: 'Annotation',
  motivation: 'linking',
  body: { id: 'HIDDEN-ACTION', type: 'Text' },
  target: {
    source: example('index.html'),
    context: { url: '/target/index.html' },
    selector: { type: 'CssSelector', value: '#hidden-page-action' },
    fingerprint: { tag: 'button', text: '同路由下的隐藏页面操作' },
  },
  status: 'confirmed',
});
await writeFile(
  mapPath,
  `${JSON.stringify(fixtureMap, null, 2)}\n`,
  'utf8',
);
await mkdir(outputDir, { recursive: true });
const deliveryRoot = join(temp, 'delivery');
await cp(resolve(root, 'web'), join(deliveryRoot, 'web'), { recursive: true });
await cp(resolve(root, 'schemas'), join(deliveryRoot, 'schemas'), { recursive: true });
const sourceBeforeReading = await readFile(specPath, 'utf8');
const mapBeforeReading = await readFile(mapPath, 'utf8');

const studio = await startWorkbench({
  appRoot: deliveryRoot,
  statePath,
  mode: 'map',
  htmlPath: example('index.html'),
  specPath,
  sourceSpecPath: example('task-board.spec.md'),
  mapPath,
  host: '127.0.0.1',
  port: 0,
});
const browser = await launchHeadlessBrowser();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(studio.url, { waitUntil: 'networkidle' });

  const mappingTree = page.locator('#spec-binding-tree');
  await mappingTree
    .getByTestId('spec-page-group-TASK-PAGE-BOARD')
    .getByRole('button')
    .first()
    .click();
  await mappingTree.getByTestId('spec-card-TASK-ACTION-FILTER-OVERDUE').waitFor();
  assert.match(
    await mappingTree.getByTestId('spec-card-TASK-ACTION-CREATE').getAttribute('aria-label'),
    /已关联/,
    '共享路由无法唯一识别逻辑页时，当前 DOM 唯一命中的已有映射仍应恢复为已关联',
  );
  assert.equal(await mappingTree.getByText('任务执行', { exact: true }).count() > 0, true, '模块应作为节点标签保留');
  assert.equal(await mappingTree.getByRole('button', { name: /任务执行.*已映射/ }).count(), 0, '模块不能再作为树根');
  assert.equal(await mappingTree.locator('[data-page-depth="0"]').count(), 1);
  assert.equal(await mappingTree.locator('[data-page-depth="1"]').count(), 1);
  assert.equal(await mappingTree.locator('[data-page-depth="2"]').count(), 1);
  assert.equal(
    await mappingTree.getByRole('tab', { name: /需复核/ }).count(),
    0,
    '当前场景未显示的已关联组件都应暂停缺失校验，不能误报需复核',
  );
  const homePageRow = await mappingTree
    .getByTestId('spec-page-group-TASK-PAGE-HOME')
    .getByRole('button')
    .first()
    .innerText();
  assert.match(homePageRow, /TASK-PAGE-HOME/, '页面行应保留稳定页面 ID');
  assert.doesNotMatch(homePageRow, /需复核/, '页面行不显示节点级异常分类');
  assert.equal(await mappingTree.getByText('逾期判定规则', { exact: true }).count(), 0);
  assert.equal(await mappingTree.getByText('完成任务权限', { exact: true }).count(), 0);
  assert.equal(await mappingTree.getByText('新建任务验收', { exact: true }).count(), 0);

  const selectedCard = mappingTree.getByTestId('spec-card-TASK-ACTION-FILTER-OVERDUE');
  assert.match(await selectedCard.innerText(), /隐藏未逾期任务/);
  await selectedCard.click();
  await page.getByRole('tab', { name: '操作定义', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: /关联约束/ }).count(), 0);
  assert.equal(await page.getByRole('tab', { name: '页面映射', exact: true }).count(), 1);
  const reading = page.getByTestId('spec-reading-context');
  const rule = page.getByTestId('applicable-rule-TASK-RULE-OVERDUE');
  await rule.getByText(ruleStatement, { exact: true }).waitFor();
  assert.equal(await reading.getByText('完成任务权限', { exact: true }).count(), 0, '同模块未关联规则不混入操作');
  const prdSource = page.getByTestId('source-prd-需求-任务-逾期');
  await prdSource.getByText('当前工作台未载入对应 PRD，无法定位来源原文。').waitFor();
  assert.equal(await prdSource.getByRole('button').isDisabled(), true);
  const original = page.getByTestId('source-rule-TASK-RULE-OVERDUE');
  await original.click();
  assert.equal(await rule.getAttribute('data-source-highlight'), 'true');
  await rule.getByRole('button', { name: '隐藏高亮' }).click();
  assert.equal(await rule.getAttribute('data-source-highlight'), null);
  assert.equal(await selectedCard.getAttribute('aria-pressed'), 'true');
  await page.getByRole('tab', { name: '页面映射', exact: true }).click();
  await page.getByRole('tab', { name: '操作定义', exact: true }).click();
  await rule.getByText(ruleStatement, { exact: true }).waitFor();
  await page.screenshot({ path: resolve(outputDir, 'constraint-inspector-default.png'), fullPage: true });
  await original.click();
  await page.setViewportSize({ width: 1120, height: 720 });
  const inspector = page.locator('#mapping-inspector');
  await original.scrollIntoViewIfNeeded();
  await inspector.screenshot({ path: resolve(outputDir, 'constraint-inspector-expanded-narrow.png') });
  await original.screenshot({ path: resolve(outputDir, 'constraint-inspector-expanded-card.png') });
  const scrollViewport = inspector.locator('[data-slot="scroll-area-viewport"]');
  assert.equal(await scrollViewport.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await mappingTree.getByTestId('spec-card-TASK-ACTION-COMPLETE').click();
  await selectedCard.click();
  await page.getByRole('tab', { name: '操作定义', exact: true }).click();
  assert.equal(await rule.getAttribute('data-source-highlight'), null, '切换节点清除高亮');
  for (const id of ['TASK-ACTION-COMPLETE', 'TASK-ACTION-FILTER-OVERDUE', 'TASK-ACTION-COMPLETE', 'TASK-ACTION-FILTER-OVERDUE']) {
    await mappingTree.getByTestId(`spec-card-${id}`).click();
    await page.getByRole('tab', { name: '操作定义', exact: true }).click();
    assert.equal(await page.getByTestId('spec-reading-context').count(), 1, '切换后不能残留旧节点组件');
    assert.equal(await page.getByRole('button', { name: '编辑完整节点', exact: true }).count(), 1, '完整编辑入口唯一');
    assert.equal(await page.getByTestId('spec-edit-toolbar').getByRole('button').count(), 1);
  }

  const searchInput = mappingTree.getByLabel('搜索 Spec');
  await searchInput.fill('标记完成');
  await mappingTree.getByTestId('spec-card-TASK-ACTION-COMPLETE').waitFor();
  assert.equal(await mappingTree.getByTestId('spec-card-TASK-ACTION-FILTER-OVERDUE').count(), 0);
  await searchInput.fill('');

  await mappingTree.getByLabel('按模块筛选').click();
  await page.getByRole('option', { name: '无约束模块' }).click();
  assert.equal(await mappingTree.getByTestId('spec-card-TASK-ACTION-COMPLETE').count(), 0);
  const emptyCard = mappingTree.getByTestId('spec-card-EMPTY-ACTION');
  await emptyCard.click();
  await page.getByRole('tab', { name: '操作定义', exact: true }).click();
  assert.equal(await page.getByTestId('applicable-rules').count(), 0);
  assert.equal(await page.getByRole('tab', { name: /关联约束/ }).count(), 0);
  assert.equal(await page.getByTestId('source-current-node').count(), 0);

  assert.equal(await readFile(specPath, 'utf8'), sourceBeforeReading, '阅读不改写原 Spec');
  assert.equal(await readFile(mapPath, 'utf8'), mapBeforeReading, '阅读不改写人工 Map');
  console.log(`独立目录交付与完整操作阅读浏览器旅程通过；截图：${outputDir}`);
} finally {
  await browser.close();
  await studio.stop();
}
