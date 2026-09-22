import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { startGateStudio, startStudio, startWorkbench } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const example = relative => resolve(root, 'examples/task-board', relative);
const mappingReadyPrd = `# 独立 PRD 示例产品需求文档

<!-- prd-profile: 可映射PRD-v1 -->

> 文档状态：草稿
> 适用版本：v0.1

## 4. 详细功能说明

### 4.1 任务功能域

#### 4.1.1 新建任务
<!-- prd-section-id: 需求-任务-新建任务 -->

##### 功能说明
创建新的任务。
##### 入口与页面
从任务板进入。
##### 用户操作与产品结果
用户提交后看到新任务。
##### 必要规则
标题不能为空。

## 5. 全局产品规则

### 5.1 当前任务板
<!-- prd-section-id: 规则-任务上下文-当前任务板 -->

操作始终作用于当前任务板。
`;

const readZipEntries = buffer => {
  const entries = new Map();
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let cursor = 0;
  while (cursor < buffer.length) {
    const offset = buffer.indexOf(centralSignature, cursor);
    if (offset < 0) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), `ZIP 条目不得越界：${name}`);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `ZIP 本地条目损坏：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed));
    cursor = offset + 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const waitForReviewUrl = child => new Promise((resolveUrl, reject) => {
  let output = '';
  const timeout = setTimeout(() => reject(new Error(`只读评审包启动超时：${output}`)), 5000);
  const receive = chunk => {
    output += chunk.toString();
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
    if (!match) return;
    clearTimeout(timeout);
    resolveUrl(match[0]);
  };
  child.stdout.on('data', receive);
  child.stderr.on('data', receive);
  child.once('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
});

test('工作台提供同源页面、配置与原子保存', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'interactive-product-spec-'));
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));
  const result = await startWorkbench({ appRoot: root, mode: 'map', htmlPath: example('index.html'), specPath: example('product.spec.json'), mapPath, initialRoute: '#task-board', host: '127.0.0.1', port: 0 });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const configResponse = await fetch(`${result.url}api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.productSpec.product.id, 'TRAIL-TASKS');
  assert.equal(config.canSave, true);
  assert.equal(config.canReturnToProjects, true);
  assert.equal(config.capabilities.saveSpecMap, true);
  assert.equal(config.reviewBaseline.artifacts.projectionRevision, config.specRevision);
  assert.match(config.targetUrl, /#task-board$/);

  const workbenchResponse = await fetch(result.url);
  assert.equal(workbenchResponse.status, 200);
  assert.match(await workbenchResponse.text(), /<title>咔哒 · 产品工作台<\/title>/);

  const targetResponse = await fetch(`${result.url}${config.targetUrl.slice(1)}`);
  assert.equal(targetResponse.status, 200);
  assert.match(await targetResponse.text(), /山径任务/);

  config.specMap.items.push({
    id: 'urn:test:create', type: 'Annotation', motivation: 'linking',
    body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
    target: { source: config.specMap.targetSource, selector: { type: 'CssSelector', value: '.new-task' }, fingerprint: { tag: 'button', role: '', text: '+ 新建任务', ariaLabel: '新建任务' } },
    status: 'confirmed', confirmedAt: new Date().toISOString(),
  });
  const saveResponse = await fetch(`${result.url}api/map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: config.mapRevision, specMap: config.specMap }),
  });
  assert.equal(saveResponse.status, 200);
  const saveResult = await saveResponse.json();
  assert.notEqual(saveResult.mapRevision, config.mapRevision);
  assert.equal(saveResult.reviewBaseline.artifacts.specMapRevision, saveResult.mapRevision);
  const saved = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.equal(saved.items[0].body.id, 'TASK-ACTION-CREATE');

  const closeResponse = await fetch(`${result.url}api/project/close`, { method: 'POST' });
  assert.equal(closeResponse.status, 200);
  assert.equal((await fetch(`${result.url}api/config`)).status, 409);
  const launcherResponse = await fetch(`${result.url}api/launcher`);
  assert.equal(launcherResponse.status, 200);
});

test('运行时映射校验状态不会污染正式 spec-map', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-map-status-'));
  const mapPath = join(temp, 'spec-map.json');
  const legacyMap = JSON.parse(await readFile(example('spec-map.json'), 'utf8'));
  legacyMap.items.push({
    id: 'urn:test:legacy-status',
    type: 'Annotation',
    motivation: 'linking',
    body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
    target: {
      source: example('index.html'),
      context: { url: '/target/index.html#task-board' },
      selector: { type: 'CssSelector', value: '.new-task' },
      fingerprint: { tag: 'button', role: '', text: '+ 新建任务', ariaLabel: '新建任务' },
    },
    status: 'out-of-context',
    confirmedAt: new Date().toISOString(),
  });
  await writeFile(mapPath, `${JSON.stringify(legacyMap, null, 2)}\n`, 'utf8');

  const result = await startWorkbench({
    appRoot: root,
    mode: 'map',
    htmlPath: example('index.html'),
    specPath: example('product.spec.json'),
    mapPath,
    initialRoute: '#task-board',
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const config = await (await fetch(`${result.url}api/config`)).json();
  assert.equal(config.specMap.items[0].status, 'confirmed', '旧 Map 的派生状态只作为兼容输入，不作为持久事实');
  config.specMap.items[0].status = 'drifted';
  const saveResponse = await fetch(`${result.url}api/map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: config.mapRevision, specMap: config.specMap }),
  });
  assert.equal(saveResponse.status, 200);
  const saved = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.equal(saved.items[0].status, 'confirmed', '服务端保存边界必须拒绝持久化运行时校验状态');
});

test('导出 ZIP 只读评审包保留查看交互资源并隔离本机写能力', async t => {
  const imageProject = await mkdtemp(join(tmpdir(), 'ips-image-package-'));
  await mkdir(join(imageProject, 'pages'));
  await mkdir(join(imageProject, 'docs'));
  await mkdir(join(imageProject, 'screens'));
  await writeFile(join(imageProject, 'pages/index.html'), await readFile(example('index.html')));
  await writeFile(join(imageProject, 'docs/product.spec.json'), await readFile(example('product.spec.json')));
  await writeFile(join(imageProject, 'docs/prd.md'), mappingReadyPrd.replace('从任务板进入。', '从任务板进入。\n\n![参考图](../screens/reference.png)'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(imageProject, 'screens/reference.png'), png);
  const result = await startStudio({
    appRoot: root,
    statePath: join(imageProject, 'tool/projects.json'),
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));
  const sourceConfirmation = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath: imageProject, sourceType: 'html', mode: 'map',
      htmlPath: join(imageProject, 'pages/index.html'), specPath: join(imageProject, 'docs/product.spec.json'),
      prdPath: join(imageProject, 'docs/prd.md'), mapPolicy: 'tool', confirmMapCreate: true, confirmPrdMapCreate: true }),
  });
  assert.equal(sourceConfirmation.status, 200);

  const liveConfig = await (await fetch(`${result.url}api/config`)).json();
  assert.equal(liveConfig.reviewPackage.canExport, true);
  const preparedResponse = await fetch(`${result.url}api/review-package/prepare`, { method: 'POST' });
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  assert.match(prepared.filename, /只读评审包\.zip$/);
  assert.ok(prepared.fileCount > 5);

  const archiveResponse = await fetch(`${result.url}api/review-package/${prepared.id}`);
  assert.equal(archiveResponse.status, 200);
  assert.equal(archiveResponse.headers.get('content-type'), 'application/zip');
  const entries = readZipEntries(Buffer.from(await archiveResponse.arrayBuffer()));
  for (const required of [
    'web/index.html',
    'pages/index.html',
    'data/config.json',
    'manifest.json',
    'open-review.mjs',
    '打开评审.exe',
    '打开评审.command',
    '打开评审.bat',
  ]) assert.ok(entries.has(required), `ZIP 缺少 ${required}`);
  assert.equal(entries.get('documents/PRD.md')?.toString('utf8'), await readFile(join(imageProject, 'docs/prd.md'), 'utf8'));
  const windowsLauncher = entries.get('打开评审.exe');
  assert.equal(windowsLauncher.subarray(0, 2).toString('ascii'), 'MZ', 'Windows 启动器必须具有 DOS/PE 文件头');
  const peOffset = windowsLauncher.readUInt32LE(0x3c);
  assert.equal(windowsLauncher.subarray(peOffset, peOffset + 4).toString('binary'), 'PE\u0000\u0000', 'Windows 启动器必须是有效 PE 文件');
  const packagedWorkbenchSource = [...entries.entries()]
    .filter(([name]) => name.startsWith('web/') && name.endsWith('.js'))
    .map(([, content]) => content.toString('utf8'))
    .join('\n');
  assert.match(packagedWorkbenchSource, /prd-mermaid-dialog/, '导出包应保留流程图放大查看交互');
  assert.match(packagedWorkbenchSource, /prd-drawer-resize-handle/, '导出包应保留 PRD 抽屉外沿拖拽交互');
  assert.match(packagedWorkbenchSource, /prd-image-resize-handle/, '导出包应保留图片显示和拖拽控件');
  assert.equal(entries.has('pages/product.spec.json'), false, '页面包不能重复带出内部 Spec 投影');
  assert.equal(entries.has('pages/spec-map.json'), false, '页面包不能重复带出正式映射文件');

  const packagedConfigText = entries.get('data/config.json').toString('utf8');
  const packagedConfig = JSON.parse(packagedConfigText);
  assert.equal(packagedConfig.prd.images['../screens/reference.png'].src, `data:image/png;base64,${png.toString('base64')}`, '页面目录之外的 PRD 图片也必须随评审包冻结');
  assert.equal(packagedConfig.mode, 'review');
  assert.equal(packagedConfig.canSave, false);
  assert.equal(packagedConfig.canSaveSpec, false);
  assert.equal(packagedConfig.canSaveSpecMap, false);
  assert.equal(packagedConfig.canSavePrdMap, false);
  assert.equal(packagedConfig.canSubmitToCodex, false);
  assert.equal(packagedConfig.canReturnToProjects, false);
  assert.ok(Object.values(packagedConfig.capabilities).every(value => value === false));
  assert.equal(packagedConfig.reviewBaseline.target.source, 'pages/index.html');
  assert.equal(packagedConfig.prdMap.targetSource, 'pages/index.html');
  assert.equal(packagedConfig.prdMap.prd.path, 'prd.md');
  assert.equal(liveConfig.prdMap.prd.path, join(imageProject, 'docs/prd.md'), '导出不改变活动项目路径');
  assert.equal(packagedConfig.project, null);
  assert.equal(packagedConfig.reviewPackage.portable, true);
  assert.doesNotMatch(packagedConfigText, /\/Users\/|\/var\/folders\/|[A-Za-z]:\\/);

  const extracted = await mkdtemp(join(tmpdir(), 'ips-readonly-package-test-'));
  for (const name of ['open-review.mjs', 'data/config.json', 'pages/index.html', 'web/index.html']) {
    const path = join(extracted, ...name.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entries.get(name));
  }
  const child = spawn(process.execPath, [join(extracted, 'open-review.mjs'), '--no-open'], {
    cwd: extracted,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  const reviewUrl = await waitForReviewUrl(child);
  const readonlyConfig = await (await fetch(`${reviewUrl}api/config`)).json();
  assert.equal(readonlyConfig.specEditMode, 'readonly');
  assert.equal(readonlyConfig.prd.images['../screens/reference.png'].src, packagedConfig.prd.images['../screens/reference.png'].src);
  const targetResponse = await fetch(`${reviewUrl}${readonlyConfig.targetUrl.slice(1)}`);
  assert.equal(targetResponse.status, 200);
  assert.match(await targetResponse.text(), /山径任务/);
  const denied = await fetch(`${reviewUrl}api/map`, { method: 'POST' });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'READ_ONLY_PACKAGE');
  child.kill('SIGTERM');
});

test('映射保存使用文件 revision 防止多窗口后写覆盖', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-map-revision-'));
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));
  const result = await startWorkbench({
    appRoot: root,
    mode: 'map',
    htmlPath: example('index.html'),
    specPath: example('product.spec.json'),
    mapPath,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const firstConfig = await (await fetch(`${result.url}api/config`)).json();
  const secondConfig = structuredClone(firstConfig);
  firstConfig.specMap.items.push({
    id: 'urn:test:first-window',
    type: 'Annotation',
    motivation: 'linking',
    body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
    target: {
      source: firstConfig.specMap.targetSource,
      selector: { type: 'CssSelector', value: '.new-task' },
      fingerprint: { tag: 'button', text: '+ 新建任务' },
    },
    status: 'confirmed',
  });
  const firstSave = await fetch(`${result.url}api/map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseRevision: firstConfig.mapRevision,
      specMap: firstConfig.specMap,
    }),
  });
  assert.equal(firstSave.status, 200);

  const staleSave = await fetch(`${result.url}api/map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseRevision: secondConfig.mapRevision,
      specMap: secondConfig.specMap,
    }),
  });
  assert.equal(staleSave.status, 409);
  assert.equal((await staleSave.json()).code, 'MAP_CHANGED');
  const saved = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.equal(saved.items[0].id, 'urn:test:first-window');
});

test('普通工作台不要求连接 Codex，操作定义独立直写本地 Spec 原文件', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-direct-spec-edit-'));
  const htmlPath = join(temp, 'index.html');
  const specPath = join(temp, 'product.spec.json');
  const sourceSpecPath = join(temp, 'task-board.spec.md');
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(htmlPath, await readFile(example('index.html'), 'utf8'));
  await writeFile(specPath, await readFile(example('product.spec.json'), 'utf8'));
  await writeFile(sourceSpecPath, await readFile(example('task-board.spec.md'), 'utf8'));
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));
  const result = await startWorkbench({
    appRoot: root,
    mode: 'map',
    htmlPath,
    specPath,
    sourceSpecPath,
    mapPath,
    projectPath: temp,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const config = await (await fetch(`${result.url}api/config`)).json();
  assert.equal(config.canSaveSpec, true);
  assert.equal(config.canSubmitToCodex, false);
  assert.equal(config.specEditMode, 'direct-source');

  const nextSpec = structuredClone(config.productSpec);
  const node = nextSpec.modules
    .flatMap(module => module.nodes)
    .find(item => item.id === 'TASK-ACTION-CREATE');
  node.title = '直接保存的新建任务';
  const saveResponse = await fetch(`${result.url}api/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: node.id,
      productSpec: nextSpec,
      baseRevision: config.specRevision,
    }),
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.saveTarget, 'source-spec-markdown');
  assert.equal(saved.changeCount, 0);
  assert.equal(saved.reviewBaseline.artifacts.projectionRevision, saved.specRevision);
  const savedSource = await readFile(sourceSpecPath, 'utf8');
  assert.match(savedSource, /### ACTION `TASK-ACTION-CREATE`：直接保存的新建任务/);
  assert.equal(saved.specDocument.source, savedSource);
  assert.equal(saved.specDocument.revision, saved.sourceSpecRevision);
  assert.match(savedSource, /- 用户目标：创建一个新任务。/);
  assert.equal(JSON.parse(await readFile(specPath, 'utf8')).modules[0].nodes[0].title, node.title);
  const finalConfig = await (await fetch(`${result.url}api/config`)).json();
  assert.equal(finalConfig.productSpec.modules[0].nodes[0].title, node.title);
  assert.equal(finalConfig.draftChangeCount, 0);

  await writeFile(sourceSpecPath, `${savedSource}\n工作台外部修改。\n`);
  const staleSpec = structuredClone(finalConfig.productSpec);
  staleSpec.modules[0].nodes[0].title = '不应覆盖外部修改';
  const staleResponse = await fetch(`${result.url}api/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: node.id,
      productSpec: staleSpec,
      baseRevision: finalConfig.specRevision,
    }),
  });
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).code, 'SOURCE_SPEC_CHANGED');
  assert.match(await readFile(sourceSpecPath, 'utf8'), /工作台外部修改/);
});

test('Codex 门禁只保存会话草稿，并把节点差异返回给等待中的调用', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-spec-review-'));
  const specPath = join(temp, 'product.spec.json');
  const sourceSpecPath = join(temp, 'task-board.spec.md');
  const mapPath = join(temp, 'spec-map.json');
  const originalView = await readFile(example('product.spec.json'), 'utf8');
  const originalSource = await readFile(example('task-board.spec.md'), 'utf8');
  await writeFile(specPath, originalView);
  await writeFile(sourceSpecPath, originalSource);
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));
  const result = await startWorkbench({
    appRoot: root,
    mode: 'map',
    htmlPath: example('index.html'),
    specPath,
    sourceSpecPath,
    mapPath,
    gate: true,
    projectPath: temp,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const config = await (await fetch(`${result.url}api/config`)).json();
  assert.equal(config.canSaveSpec, true);
  assert.equal(config.canSubmitToCodex, true);
  assert.equal(config.canReturnToProjects, true);
  assert.equal(config.sourceSpecPath, sourceSpecPath);
  assert.equal(config.bundlePath, specPath);
  assert.match(config.specRevision, /^[a-f0-9]{64}$/);
  assert.match(config.sourceSpecRevision, /^[a-f0-9]{64}$/);

  const nextSpec = structuredClone(config.productSpec);
  const boardNode = nextSpec.modules[1].nodes.find(node => node.id === 'TASK-SURFACE-BOARD');
  boardNode.statement = '已在工作台中完成编辑，等待 Codex 修订 Markdown。';
  const savedResponse = await fetch(`${result.url}api/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productSpec: nextSpec, baseRevision: config.specRevision }),
  });
  assert.equal(savedResponse.status, 200);
  const savedResult = await savedResponse.json();
  assert.notEqual(savedResult.specRevision, config.specRevision);
  assert.equal(savedResult.changeCount, 1);
  assert.equal(await readFile(specPath, 'utf8'), originalView);
  assert.equal(await readFile(sourceSpecPath, 'utf8'), originalSource);
  assert.equal((await (await fetch(`${result.url}api/config`)).json()).productSpec.modules[1].nodes.find(node => node.id === 'TASK-SURFACE-BOARD').statement, boardNode.statement);

  const staleResponse = await fetch(`${result.url}api/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productSpec: nextSpec, baseRevision: config.specRevision }),
  });
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).code, 'SPEC_DRAFT_CHANGED');

  const incompatibleSpec = structuredClone(nextSpec);
  incompatibleSpec.product.id = 'ANOTHER-PRODUCT';
  const incompatibleResponse = await fetch(`${result.url}api/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productSpec: incompatibleSpec, baseRevision: savedResult.specRevision }),
  });
  assert.equal(incompatibleResponse.status, 400);
  assert.match((await incompatibleResponse.json()).error, /映射不一致/);
  assert.equal(await readFile(specPath, 'utf8'), originalView);

  await writeFile(sourceSpecPath, `${originalSource}\n外部修改`);
  const conflictedSubmit = await fetch(`${result.url}api/review/submit`, { method: 'POST' });
  assert.equal(conflictedSubmit.status, 409);
  assert.equal((await conflictedSubmit.json()).code, 'SOURCE_SPEC_CHANGED');
  await writeFile(sourceSpecPath, originalSource);

  const waiting = result.waitForDecision();
  const submitResponse = await fetch(`${result.url}api/review/submit`, { method: 'POST' });
  assert.equal(submitResponse.status, 200);
  const submitted = (await submitResponse.json()).submission;
  const decision = await waiting;
  assert.deepEqual(decision, submitted);
  assert.equal(submitted.applyTarget, 'source-spec-markdown-only');
  assert.equal(submitted.sourceSpec.path, sourceSpecPath);
  assert.equal(submitted.viewSpec.path, specPath);
  assert.equal(submitted.changes.length, 1);
  assert.equal(submitted.changes[0].nodeId, 'TASK-SURFACE-BOARD');
  assert.equal(submitted.changes[0].after.statement, boardNode.statement);
  assert.equal(await readFile(sourceSpecPath, 'utf8'), originalSource);
});

test('Codex 统一入口先确认来源，再在同一地址编辑并提交', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-unified-gate-'));
  const htmlPath = join(temp, 'index.html');
  const specPath = join(temp, 'product.spec.json');
  const sourceSpecPath = join(temp, 'task-board.spec.md');
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(htmlPath, await readFile(example('index.html'), 'utf8'));
  await writeFile(specPath, await readFile(example('product.spec.json'), 'utf8'));
  await writeFile(sourceSpecPath, await readFile(example('task-board.spec.md'), 'utf8'));
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));

  const result = await startGateStudio({
    appRoot: root,
    projectPath: temp,
    htmlPath,
    specPath,
    sourceSpecPath,
    mapPath,
    statePath: join(temp, 'tool-state', 'projects.json'),
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const initialConfig = await fetch(`${result.url}api/config`);
  assert.equal(initialConfig.status, 409);
  assert.equal((await initialConfig.json()).code, 'PROJECT_REQUIRED');

  const launcher = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(launcher.gateSession, true);
  assert.equal(launcher.bootstrap.step, 2);
  assert.equal(launcher.bootstrap.draft.htmlPath, htmlPath);
  assert.equal(launcher.bootstrap.draft.sourceSpecPath, sourceSpecPath);
  assert.equal(launcher.bootstrap.draft.specPath, specPath);
  assert.equal(launcher.bootstrap.draft.mapPath, mapPath);
  assert.equal(launcher.bootstrap.draft.mode, 'map');
  const launcherAfterReload = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(launcherAfterReload.bootstrap.draft.projectPath, temp);
  assert.equal(launcherAfterReload.bootstrap.draft.specPath, specPath);

  const confirmResponse = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(launcher.bootstrap.draft),
  });
  assert.equal(confirmResponse.status, 200);
  const config = await confirmResponse.json();
  assert.equal(config.canReturnToProjects, true);
  assert.equal(config.canSaveSpec, true);
  assert.equal(config.canSubmitToCodex, true);
  assert.equal(config.sourceSpecPath, sourceSpecPath);
  const launcherAfterConfirm = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(launcherAfterConfirm.bootstrap, null);

  const waiting = result.waitForDecision();
  const submitResponse = await fetch(`${result.url}api/review/submit`, { method: 'POST' });
  assert.equal(submitResponse.status, 200);
  const submitted = (await submitResponse.json()).submission;
  assert.deepEqual(await waiting, submitted);
  assert.equal(submitted.sourceSpec.path, sourceSpecPath);
  assert.equal(submitted.changes.length, 0);
});

test('Codex Skill 会话在默认端口被旧项目占用时使用独立地址', async t => {
  const occupied = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('旧项目服务');
  });
  await new Promise((resolveListen, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => occupied.close(resolveClose)));
  const occupiedAddress = occupied.address();
  const occupiedPort = typeof occupiedAddress === 'object' && occupiedAddress
    ? occupiedAddress.port
    : 0;

  const temp = await mkdtemp(join(tmpdir(), 'ips-gate-port-fallback-'));
  const htmlPath = join(temp, 'index.html');
  const specPath = join(temp, 'product.spec.json');
  const sourceSpecPath = join(temp, 'task-board.spec.md');
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(htmlPath, await readFile(example('index.html'), 'utf8'));
  await writeFile(specPath, await readFile(example('product.spec.json'), 'utf8'));
  await writeFile(sourceSpecPath, await readFile(example('task-board.spec.md'), 'utf8'));
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));

  const result = await startGateStudio({
    appRoot: root,
    projectPath: temp,
    htmlPath,
    specPath,
    sourceSpecPath,
    mapPath,
    statePath: join(temp, 'tool-state', 'projects.json'),
    host: '127.0.0.1',
    port: occupiedPort,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  assert.equal(result.usedFallbackPort, true);
  assert.notEqual(new URL(result.url).port, String(occupiedPort));
  assert.equal(await (await fetch(`http://127.0.0.1:${occupiedPort}/`)).text(), '旧项目服务');
  const launcher = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(launcher.bootstrap.draft.projectPath, temp);
  assert.equal(launcher.bootstrap.draft.specPath, specPath);
  assert.equal(launcher.bootstrap.draft.mapPath, mapPath);
});

test('只读查看模式拒绝写入', async t => {
  const result = await startWorkbench({ appRoot: root, mode: 'review', htmlPath: example('index.html'), specPath: example('product.spec.json'), mapPath: example('spec-map.json'), host: '127.0.0.1', port: 0 });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));
  const config = await (await fetch(`${result.url}api/config`)).json();
  assert.equal(config.canSaveSpec, false);
  const response = await fetch(`${result.url}api/map`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config.specMap) });
  assert.equal(response.status, 403);
  const specResponse = await fetch(`${result.url}api/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productSpec: config.productSpec, baseRevision: config.specRevision }),
  });
  assert.equal(specResponse.status, 403);
});

test('项目中心扫描、确认、返回并恢复最近配置', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-studio-'));
  const statePath = join(temp, 'tool-state', 'projects.json');
  const result = await startStudio({
    appRoot: root,
    statePath,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const initialConfig = await fetch(`${result.url}api/config`);
  assert.equal(initialConfig.status, 409);
  assert.equal((await initialConfig.json()).code, 'PROJECT_REQUIRED');

  const scanResponse = await fetch(`${result.url}api/project/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectPath: resolve(root, 'examples/task-board'),
      sourceType: 'directory',
    }),
  });
  assert.equal(scanResponse.status, 200);
  const scan = await scanResponse.json();
  assert.equal(scan.recommended.htmlPath, example('index.html'));
  assert.equal(scan.recommended.specPath, example('product.spec.json'));
  assert.equal(scan.recommended.sourceSpecPath, example('task-board.spec.md'));

  const confirmResponse = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: '../../untrusted-project-id',
      name: '任务板评审',
      projectPath: resolve(root, 'examples/task-board'),
      sourceType: 'html',
      htmlPath: example('index.html'),
      specPath: example('product.spec.json'),
      sourceSpecPath: example('task-board.spec.md'),
      mapPolicy: 'tool',
      confirmMapCreate: true,
      mode: 'map',
    }),
  });
  assert.equal(confirmResponse.status, 200);
  const config = await confirmResponse.json();
  assert.equal(config.canReturnToProjects, true);
  assert.equal(config.sourceSpecPath, example('task-board.spec.md'));
  assert.equal(config.project.mapPolicy, 'tool');
  assert.equal(config.specMap.items.length, 0);

  const targetResponse = await fetch(`${result.url}${config.targetUrl.slice(1)}`);
  assert.equal(targetResponse.status, 200);
  assert.match(await targetResponse.text(), /山径任务/);

  const launcherAfterOpen = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(launcherAfterOpen.recentProjects.length, 1);
  assert.equal(launcherAfterOpen.lastProject.name, '任务板评审');
  assert.match(launcherAfterOpen.lastProject.id, /^project-[a-f0-9]{14}$/);
  assert.equal(dirname(launcherAfterOpen.lastProject.mapPath), join(dirname(statePath), 'maps'));
  const toolMap = JSON.parse(await readFile(launcherAfterOpen.lastProject.mapPath, 'utf8'));
  assert.equal(toolMap.productSpecId, 'TRAIL-TASKS');

  const closeResponse = await fetch(`${result.url}api/project/close`, { method: 'POST' });
  assert.equal(closeResponse.status, 200);
  assert.equal((await fetch(`${result.url}api/config`)).status, 409);
  const restored = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(restored.lastProject.htmlPath, example('index.html'));
  assert.equal(restored.lastProject.confirmTargetWrite, undefined);

  const reopenResponse = await fetch(`${result.url}api/project/reopen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: restored.lastProject.id }),
  });
  assert.equal(reopenResponse.status, 200);
  const reopened = await reopenResponse.json();
  assert.equal(reopened.productSpec.product.id, 'TRAIL-TASKS');
  assert.equal(reopened.project.id, restored.lastProject.id);
  assert.equal(reopened.specMap.items.length, 0);
  assert.equal((await fetch(`${result.url}api/config`)).status, 200);

  const activeRemoval = await fetch(`${result.url}api/project/remove-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: restored.lastProject.id }),
  });
  assert.equal(activeRemoval.status, 409);

  await fetch(`${result.url}api/project/close`, { method: 'POST' });
  const toolMapWithOneItem = JSON.parse(await readFile(restored.lastProject.mapPath, 'utf8'));
  toolMapWithOneItem.items.push({
    id: 'urn:test:removal-preview',
    type: 'Annotation',
    motivation: 'linking',
    body: { id: 'TASK-ACTION-CREATE', type: 'Text' },
    target: { source: toolMapWithOneItem.targetSource, selector: { type: 'CssSelector', value: '.new-task' } },
    status: 'confirmed',
  });
  await writeFile(restored.lastProject.mapPath, `${JSON.stringify(toolMapWithOneItem, null, 2)}\n`, 'utf8');

  const removalPreview = await fetch(`${result.url}api/project/remove-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: restored.lastProject.id }),
  });
  assert.equal(removalPreview.status, 200);
  assert.deepEqual(
    await removalPreview.json(),
    {
      id: restored.lastProject.id,
      name: '任务板评审',
      projectPath: resolve(root, 'examples/task-board'),
      mapPolicy: 'tool',
      deleteToolMaps: true,
      mappingFileCount: 1,
      mappingCount: 1,
    },
  );

  const unconfirmedRemoval = await fetch(`${result.url}api/project/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: restored.lastProject.id }),
  });
  assert.equal(unconfirmedRemoval.status, 400);
  assert.equal(JSON.parse(await readFile(restored.lastProject.mapPath, 'utf8')).items.length, 1);

  const confirmedRemoval = await fetch(`${result.url}api/project/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: restored.lastProject.id, confirm: true }),
  });
  assert.equal(confirmedRemoval.status, 200);
  const removalResult = await confirmedRemoval.json();
  assert.equal(removalResult.deletedToolMaps, 1);
  assert.equal(removalResult.deletedMappings, 1);
  assert.deepEqual(removalResult.recentProjects, []);
  assert.equal(removalResult.lastProject, null);
  await assert.rejects(readFile(restored.lastProject.mapPath, 'utf8'), { code: 'ENOENT' });
});

test('没有 Spec 时合法 PRD 仍可进入页面工作台并单独保存 prd-map.json', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-prd-only-studio-'));
  const htmlPath = join(temp, 'index.html');
  const prdPath = join(temp, '产品需求文档.md');
  const prdMapPath = join(temp, 'prd-map.json');
  await writeFile(htmlPath, '<!doctype html><title>任务板</title><main>新建任务</main>', 'utf8');
  await writeFile(prdPath, '# 非标准 PRD\n\n没有格式合同。\n', 'utf8');
  const result = await startStudio({
    appRoot: root,
    statePath: join(temp, 'tool-state', 'projects.json'),
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const invalidPrd = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'PRD 独立工作台',
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      prdPath,
      mapPolicy: 'tool',
      confirmPrdMapCreate: true,
      mode: 'map',
    }),
  });
  assert.equal(invalidPrd.status, 400);
  assert.match((await invalidPrd.json()).error, /PRD 格式不符合可映射合同/);
  await assert.rejects(readFile(prdMapPath, 'utf8'), { code: 'ENOENT' });
  assert.equal(await readFile(prdPath, 'utf8'), '# 非标准 PRD\n\n没有格式合同。\n');
  await writeFile(prdPath, mappingReadyPrd, 'utf8');

  const sourceSpecPath = join(temp, 'product.spec.md');
  await writeFile(sourceSpecPath, '# 已选择但尚未投影的 Spec\n', 'utf8');
  const degradedSpec = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'PRD 与 Spec 集成工作台',
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      prdPath,
      sourceSpecPath,
      mapPolicy: 'tool',
      confirmPrdMapCreate: true,
      mode: 'map',
    }),
  });
  assert.equal(degradedSpec.status, 400);
  assert.match((await degradedSpec.json()).error, /不能降级进入仅含 PRD 的工作台/);

  const wrongConfirmation = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'PRD 独立工作台',
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      prdPath,
      mapPolicy: 'tool',
      confirmTargetWrite: true,
      mode: 'map',
    }),
  });
  assert.equal(wrongConfirmation.status, 400);
  assert.match((await wrongConfirmation.json()).error, /prd-map\.json 前需要明确确认/);
  await assert.rejects(readFile(prdMapPath, 'utf8'), { code: 'ENOENT' });

  const confirmResponse = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'PRD 独立工作台',
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      prdPath,
      mapPolicy: 'tool',
      confirmPrdMapCreate: true,
      mode: 'map',
    }),
  });
  assert.equal(confirmResponse.status, 200);
  const config = await confirmResponse.json();
  assert.equal(config.prd.title, '独立 PRD 示例产品需求文档');
  assert.equal(config.productSpec.modules.length, 0);
  assert.equal(config.canSaveSpecMap, false);
  assert.equal(config.canSavePrdMap, true);
  assert.equal(config.prdMap.items.length, 0);

  const now = new Date().toISOString();
  const nextMap = structuredClone(config.prdMap);
  nextMap.items.push({
    id: '页面关联-任务板',
    page: { pageId: null, title: '任务板', context: { url: config.targetUrl } },
    sectionIds: ['需求-任务-新建任务', '规则-任务上下文-当前任务板'],
    confirmedAt: now,
    updatedAt: now,
  });
  const saveResponse = await fetch(`${result.url}api/prd-map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRevision: config.prdMapRevision, prdMap: nextMap }),
  });
  assert.equal(saveResponse.status, 200);
  const saved = JSON.parse(await readFile(prdMapPath, 'utf8'));
  assert.deepEqual(saved.items[0].sectionIds, nextMap.items[0].sectionIds);
  await assert.rejects(readFile(join(temp, 'spec-map.json'), 'utf8'), { code: 'ENOENT' });
});

test('移除最近项目不删除用户已有映射文件', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-remove-existing-map-'));
  const statePath = join(temp, 'tool-state', 'projects.json');
  const externalMapPath = join(temp, 'existing.spec-map.json');
  const originalMap = await readFile(example('spec-map.json'), 'utf8');
  await writeFile(externalMapPath, originalMap, 'utf8');
  const result = await startStudio({ appRoot: root, statePath, host: '127.0.0.1', port: 0 });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const savedResponse = await fetch(`${result.url}api/project/save-draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '外部映射项目',
      projectPath: temp,
      sourceType: 'directory',
      htmlPath: example('index.html'),
      specPath: example('product.spec.json'),
      sourceSpecPath: example('task-board.spec.md'),
      mapPolicy: 'existing',
      mapPath: externalMapPath,
      mode: 'map',
    }),
  });
  assert.equal(savedResponse.status, 200);
  const saved = (await savedResponse.json()).project;

  const preview = await fetch(`${result.url}api/project/remove-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: saved.id }),
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).deleteToolMaps, false);

  const removed = await fetch(`${result.url}api/project/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: saved.id, confirm: true }),
  });
  assert.equal(removed.status, 200);
  assert.equal(await readFile(externalMapPath, 'utf8'), originalMap);
});

test('显式创建可见 Codex 对话后生成工具侧临时投影', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-codex-projection-'));
  const statePath = join(temp, 'tool-state', 'projects.json');
  const htmlPath = join(temp, 'index.html');
  const sourceSpecPath = join(temp, 'product.spec.md');
  const sourceMarkdown = await readFile(example('task-board.spec.md'), 'utf8');
  await writeFile(htmlPath, await readFile(example('index.html'), 'utf8'));
  await writeFile(sourceSpecPath, sourceMarkdown);
  // 此测试的模拟生成器必须忠实于上面的 Markdown，不能返回另一份演示 bundle。
  const projectedSource = {
    schemaVersion: '0.1',
    product: { id: 'TRAIL-TASKS', title: '山径任务', version: '0.1', status: 'draft' },
    modules: [{ id: 'TASK', title: '任务', purpose: '查看与创建任务', nodes: [
      ['TASK-SURFACE-ENTRY', 'SURFACE', '任务入口'],
      ['TASK-ACTION-OPEN-BOARD', 'ACTION', '进入任务看板'],
      ['TASK-SURFACE-BOARD', 'SURFACE', '任务看板'],
      ['TASK-ACTION-CREATE', 'ACTION', '新建任务'],
      ['TASK-RULE-NAME', 'RULE', '任务名称要求'],
    ].map(([id, type, title]) => ({ id, type, title, status: 'draft', sourceKind: 'observed-ui', anchorHints: [] })) }],
  };
  let generatorInput;
  let generatorCallCount = 0;
  const result = await startStudio({
    appRoot: root,
    statePath,
    host: '127.0.0.1',
    port: 0,
    codexModelLister: async () => [{
      id: 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      description: 'Balanced agentic coding model.',
      supportedReasoningEfforts: [{ id: 'medium', description: 'Balanced' }],
      defaultReasoningEffort: 'medium',
      isDefault: true,
    }],
    projectionGenerator: async input => {
      generatorCallCount += 1;
      generatorInput = input;
      input.onThreadCreated({
        threadId: 'thread-test-projection',
        threadTitle: 'Interactive Product Spec · product.spec',
        model: input.model,
        effort: input.effort,
      });
      return {
        bundle: projectedSource,
        threadId: 'thread-test-projection',
        threadTitle: 'Interactive Product Spec · product.spec',
        model: input.model,
        effort: input.effort,
        usage: null,
      };
    },
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const modelsResponse = await fetch(`${result.url}api/codex/models`);
  assert.equal(modelsResponse.status, 200);
  assert.equal((await modelsResponse.json()).models[0].id, 'gpt-5.6-terra');

  const startResponse = await fetch(`${result.url}api/project/projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      sourceSpecPath,
      model: 'gpt-5.6-terra',
      effort: 'medium',
    }),
  });
  assert.equal(startResponse.status, 202);
  let job = await startResponse.json();
  for (let count = 0; count < 50 && !['completed', 'failed'].includes(job.status); count += 1) {
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
    job = await (await fetch(`${result.url}api/project/projection/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.threadId, 'thread-test-projection');
  assert.equal(job.threadTitle, 'Interactive Product Spec · product.spec');
  assert.equal(job.model, 'gpt-5.6-terra');
  assert.equal(job.effort, 'medium');
  assert.match(job.specPath, /tool-state\/projections\/project-[a-f0-9]{14}\/product\.spec\.json$/);
  assert.equal(generatorInput.projectPath, temp);
  assert.equal(generatorInput.sourceSpecPath, sourceSpecPath);
  assert.equal(generatorInput.htmlPath, htmlPath);
  assert.equal(generatorInput.model, 'gpt-5.6-terra');
  assert.equal(generatorInput.effort, 'medium');
  assert.equal(generatorInput.signal.aborted, false);
  assert.equal(JSON.parse(await readFile(job.specPath, 'utf8')).product.id, 'TRAIL-TASKS');
  assert.equal(await readFile(sourceSpecPath, 'utf8'), sourceMarkdown);

  const cachedResponse = await fetch(`${result.url}api/project/projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      sourceSpecPath,
      model: 'gpt-5.6-terra',
      effort: 'medium',
    }),
  });
  assert.equal(cachedResponse.status, 200);
  assert.equal((await cachedResponse.json()).status, 'completed');
  assert.equal(generatorCallCount, 1);

  const changedModelResponse = await fetch(`${result.url}api/project/projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectPath: temp,
      sourceType: 'html',
      htmlPath,
      sourceSpecPath,
      model: 'gpt-5.6-luna',
      effort: 'medium',
    }),
  });
  assert.equal(changedModelResponse.status, 202);
  let changedModelJob = await changedModelResponse.json();
  for (let count = 0; count < 50 && !['completed', 'failed'].includes(changedModelJob.status); count += 1) {
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
    changedModelJob = await (await fetch(
      `${result.url}api/project/projection/${changedModelJob.id}`,
    )).json();
  }
  assert.equal(changedModelJob.status, 'completed');
  assert.equal(changedModelJob.model, 'gpt-5.6-luna');
  assert.equal(generatorCallCount, 2);
});

test('不合格 PRD 可显式创建可见 Codex 对话并生成受校验的标准化草稿', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-codex-prd-draft-'));
  const statePath = join(temp, 'tool-state', 'projects.json');
  const sourcePrdPath = join(temp, '产品需求文档.md');
  const originalPrd = '# 原始产品需求文档\n\n## 4. 详细功能说明\n';
  await writeFile(sourcePrdPath, originalPrd, 'utf8');
  let generatorInput;
  const result = await startStudio({
    appRoot: root,
    statePath,
    host: '127.0.0.1',
    port: 0,
    prdDraftGenerator: async input => {
      generatorInput = input;
      input.onThreadCreated({
        threadId: 'thread-test-prd-draft',
        threadTitle: 'PRD 标准化草稿 · 产品需求文档',
        model: input.model,
        effort: input.effort,
      });
      await writeFile(input.draftPath, mappingReadyPrd, 'utf8');
      return {
        threadId: 'thread-test-prd-draft',
        threadTitle: 'PRD 标准化草稿 · 产品需求文档',
        model: input.model,
        effort: input.effort,
      };
    },
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const startResponse = await fetch(`${result.url}api/project/prd-draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectPath: temp,
      sourcePrdPath,
      model: 'gpt-5.6-terra',
      effort: 'high',
    }),
  });
  assert.equal(startResponse.status, 202);
  let job = await startResponse.json();
  for (let count = 0; count < 50 && !['completed', 'failed'].includes(job.status); count += 1) {
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
    job = await (await fetch(`${result.url}api/project/prd-draft/${job.id}`)).json();
  }

  assert.equal(job.status, 'completed');
  assert.equal(job.threadId, 'thread-test-prd-draft');
  assert.match(job.draftPath, /drafts-documents\/产品需求文档\.md$/);
  assert.ok(job.draftRevision);
  assert.equal(generatorInput.projectPath, await realpath(temp));
  assert.equal(generatorInput.sourcePrdPath, await realpath(sourcePrdPath));
  assert.equal(generatorInput.draftPath, job.draftPath);
  assert.equal(generatorInput.model, 'gpt-5.6-terra');
  assert.equal(generatorInput.effort, 'high');
  assert.equal(await readFile(sourcePrdPath, 'utf8'), originalPrd);
  assert.equal(await readFile(job.draftPath, 'utf8'), mappingReadyPrd);
});

test('Codex 投影拒绝读取项目目录之外的 Markdown', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-projection-boundary-'));
  const outside = await mkdtemp(join(tmpdir(), 'ips-projection-outside-'));
  const sourceSpecPath = join(outside, 'product.spec.md');
  await writeFile(sourceSpecPath, '# 越界 Spec');
  const result = await startStudio({
    appRoot: root,
    statePath: join(temp, 'state', 'projects.json'),
    host: '127.0.0.1',
    port: 0,
    projectionGenerator: async () => assert.fail('不应调用 Codex'),
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const response = await fetch(`${result.url}api/project/projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath: temp, sourceType: 'directory', sourceSpecPath }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /必须位于当前项目目录/);
});

test('项目内创建映射必须显式确认', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-target-write-'));
  const htmlPath = join(temp, 'index.html');
  const specPath = join(temp, 'product.spec.json');
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(htmlPath, '<!doctype html><title>确认写入</title>');
  await writeFile(specPath, await readFile(example('product.spec.json'), 'utf8'));
  const result = await startStudio({
    appRoot: root,
    statePath: join(temp, 'state', 'projects.json'),
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const body = {
    projectPath: temp,
    sourceType: 'html',
    htmlPath,
    specPath,
    mapPath,
    mapPolicy: 'project',
    mode: 'map',
  };
  const rejected = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /明确确认/);
  await assert.rejects(readFile(mapPath, 'utf8'), { code: 'ENOENT' });

  const accepted = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, confirmTargetWrite: true }),
  });
  assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(await readFile(mapPath, 'utf8')).productSpecId, 'TRAIL-TASKS');
});

test('工具侧创建映射必须显式确认', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-tool-map-confirm-'));
  const htmlPath = join(temp, 'index.html');
  const specPath = join(temp, 'product.spec.json');
  const statePath = join(temp, 'state', 'projects.json');
  await writeFile(htmlPath, '<!doctype html><title>确认创建工具侧映射</title>');
  await writeFile(specPath, await readFile(example('product.spec.json'), 'utf8'));
  const result = await startStudio({
    appRoot: root,
    statePath,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const body = {
    projectPath: temp,
    sourceType: 'html',
    htmlPath,
    specPath,
    mapPolicy: 'tool',
    mode: 'map',
  };
  const rejected = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /明确确认/);

  const accepted = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, confirmMapCreate: true }),
  });
  assert.equal(accepted.status, 200);
  const config = await accepted.json();
  assert.equal(config.specMap.items.length, 0);
  const launcher = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(JSON.parse(await readFile(launcher.lastProject.mapPath, 'utf8')).productSpecId, 'TRAIL-TASKS');
});

test('新 Spec 使用独立工具侧映射并保留旧映射', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-regenerated-spec-map-'));
  const htmlPath = join(temp, 'index.html');
  const specPath = join(temp, 'product.spec.json');
  const statePath = join(temp, 'state', 'projects.json');
  const originalBundle = JSON.parse(await readFile(example('product.spec.json'), 'utf8'));
  await writeFile(htmlPath, '<!doctype html><title>重新生成 Spec</title>');
  await writeFile(specPath, JSON.stringify(originalBundle));
  const result = await startStudio({
    appRoot: root,
    statePath,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const body = {
    projectPath: temp,
    sourceType: 'html',
    htmlPath,
    specPath,
    mapPolicy: 'tool',
    confirmMapCreate: true,
    mode: 'map',
  };
  const first = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const firstLauncher = await (await fetch(`${result.url}api/launcher`)).json();
  const oldMapPath = firstLauncher.lastProject.mapPath;
  assert.equal(JSON.parse(await readFile(oldMapPath, 'utf8')).productSpecId, 'TRAIL-TASKS');

  const regeneratedBundle = structuredClone(originalBundle);
  regeneratedBundle.product.id = 'TRAIL-TASKS-V2';
  await writeFile(specPath, JSON.stringify(regeneratedBundle));
  const second = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(second.status, 200);
  const secondLauncher = await (await fetch(`${result.url}api/launcher`)).json();
  const newMapPath = secondLauncher.lastProject.mapPath;
  assert.notEqual(newMapPath, oldMapPath);
  assert.equal(JSON.parse(await readFile(oldMapPath, 'utf8')).productSpecId, 'TRAIL-TASKS');
  assert.equal(JSON.parse(await readFile(newMapPath, 'utf8')).productSpecId, 'TRAIL-TASKS-V2');
});

test('已移除开发地址入口拒绝旧请求且不访问开发服务', async t => {
  let requests = 0;
  const dev = createServer((request, response) => {
    requests += 1;
    if (request.url === '/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end('window.proxyReady = true');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>本地开发页面</title><script src="/app.js"></script>');
  });
  await new Promise((resolveListen, reject) => {
    dev.once('error', reject);
    dev.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => dev.close(resolveClose)));
  const devAddress = dev.address();
  const devPort = typeof devAddress === 'object' && devAddress ? devAddress.port : 0;

  const temp = await mkdtemp(join(tmpdir(), 'ips-dev-proxy-'));
  const specPath = join(temp, 'product.spec.json');
  await writeFile(specPath, await readFile(example('product.spec.json'), 'utf8'));
  const result = await startStudio({
    appRoot: root,
    statePath: join(temp, 'state', 'projects.json'),
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));

  const confirm = await fetch(`${result.url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectPath: temp,
      sourceType: 'dev',
      devUrl: `http://127.0.0.1:${devPort}/demo/`,
      specPath,
      mapPolicy: 'tool',
      confirmMapCreate: true,
      mode: 'map',
    }),
  });
  assert.equal(confirm.status, 400);
  assert.match((await confirm.json()).error, /开发地址接入已移除/);
  const page = await fetch(`${result.url}target-dev/`);
  assert.equal(page.status, 410);
  assert.match((await page.json()).error, /开发地址接入已移除/);
  assert.equal(requests, 0);

});
