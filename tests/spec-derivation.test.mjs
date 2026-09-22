import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileSpec, deriveSpec, inspectSpecEdits, revisionOf } from '../src/spec-derivation.mjs';
import { readMarkdownBundle } from '../src/markdown-spec-reader.mjs';
import { updateMarkdownSpecNode } from '../src/markdown-spec-editor.mjs';

const definition = () => ({ version: 1, product: { id: 'DEMO', title: '说明产品', version: 'v1', status: 'draft' }, modules: [{ id: 'HELP', title: '帮助' }], nodes: [{ id: 'HELP-OPEN', title: '查看说明', type: 'ACTION', moduleId: 'HELP', status: 'draft', sourceKind: 'product-decision', prd: ['需求-帮助-说明'], architecture: ['HELP-STATE'] }] });
const prd = (body = '点击后展示说明；再次进入回到正文顶部。', config = definition()) => `# 说明 PRD\n\n<!-- spec-view\n${JSON.stringify(config)}\n-->\n\n#### 查看说明\n<!-- prd-section-id: 需求-帮助-说明 -->\n\n##### 正常流程与结果\n${body}\n\n| 条件 | 结果 |\n|---|---|\n| 取消 | 返回原页面 |\n\n\`\`\`text\n<!-- prd-section-id: 不能当作真实来源 -->\n\`\`\`\n`;
const arch = '# 架构\n\n## 说明状态\n<!-- architecture-id: HELP-STATE -->\n\n弹层组件持有打开状态，不修改原页面业务数据。\n';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'spec-derived-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { projectPath: root, specPath: join(root, 'Spec.md'), prdPath: join(root, 'PRD.md'), architecturePath: join(root, 'Architecture.md'), statePath: join(root, 'tool', 'projects.json') };
  await writeFile(options.prdPath, prd()); await writeFile(options.architecturePath, arch);
  return options;
}
test('派生只引用完整来源，保留嵌套标题、表格和代码，兼容现有节点读取', () => {
  const r = compileSpec({ prdText: prd(), architectureText: arch, prdPath: 'PRD.md', architecturePath: 'Architecture.md' });
  const b = readMarkdownBundle(r.text, r.bundle).bundle;
  assert.equal(b.modules[0].nodes.length, 1);
  const block = b.modules[0].nodes[0].contentBlocks.find(b => b.label === '产品定义 · 需求-帮助-说明');
  const restored = block.content.split('\n').map(s => s.replace(/^> ?/, '')).join('\n');
  assert.equal(restored, prd().slice(prd().indexOf('#### 查看说明')).trimEnd());
  assert.equal(b.modules[0].nodes[0].id, 'HELP-OPEN');
  assert.throws(() => compileSpec({ prdText: prd() + '\n#### 新功能\n<!-- prd-section-id: 需求-遗漏 -->\n未纳入', architectureText: arch }), /未纳入/);
  assert.throws(() => compileSpec({ prdText: prd(), architectureText: arch.replace('HELP-STATE', 'OTHER') }), /来源不存在/);
});
test('输出重复一致；不写来源、Map；无基线不能覆盖已有 Spec', async t => {
  const o = await fixture(t); await writeFile(join(o.projectPath, 'spec-map.json'), '人工映射');
  const first = await deriveSpec(o), original = await readFile(o.specPath, 'utf8');
  assert.equal((await deriveSpec(o)).specRevision, first.specRevision);
  assert.equal(await readFile(o.prdPath, 'utf8'), prd());
  assert.equal(await readFile(o.architecturePath, 'utf8'), arch);
  assert.equal(await readFile(join(o.projectPath, 'spec-map.json'), 'utf8'), '人工映射');
  await assert.rejects(deriveSpec({ ...o, statePath: join(o.projectPath, 'other-tool', 'projects.json') }), /没有派生基线/);
  assert.equal(await readFile(o.specPath, 'utf8'), original);
});
test('工作台编辑和外部编辑均保留，连续编辑形成当前差异，派生禁止覆盖', async t => {
  const o = await fixture(t); await deriveSpec(o);
  const source = await readFile(o.specPath, 'utf8');
  const compiled = compileSpec({ prdText: prd(), architectureText: arch });
  const b = readMarkdownBundle(source, compiled.bundle).bundle;
  const before = b.modules[0].nodes[0], after = structuredClone(before);
  after.contentBlocks.find(b => b.label.startsWith('产品定义')).content = after.contentBlocks.find(b => b.label.startsWith('产品定义')).content.replace('正文顶部', '上次位置');
  await writeFile(o.specPath, updateMarkdownSpecNode(source, before, after));
  let report = await inspectSpecEdits(o);
  assert.equal(report.pending, true); assert.equal(report.changes.length, 1);
  assert.equal(report.changes[0].sources[0].id, '需求-帮助-说明');
  await assert.rejects(deriveSpec(o), /待同步手改/);
  await writeFile(o.specPath, (await readFile(o.specPath, 'utf8')).replace('上次位置', '上次阅读位置'));
  const edited = await readFile(o.specPath, 'utf8');
  report = await inspectSpecEdits(o);
  assert.match(report.changes[0].before, /正文顶部/); assert.match(report.changes[0].after, /上次阅读位置/);
  assert.equal((await deriveSpec({ ...o, preview: true })).preview, true);
  assert.equal(await readFile(o.specPath, 'utf8'), edited);
});
test('逐项来源修订回执闭环；拒绝未改来源、漏项与过期回执', async t => {
  const o = await fixture(t); await deriveSpec(o);
  await writeFile(o.specPath, (await readFile(o.specPath, 'utf8')).replace('正文顶部', '上次位置'));
  let r = await inspectSpecEdits(o);
  const receipt = { specRevision: r.specRevision, sourceRevisions: r.sourceRevisions, resolutions: r.changes.map(c => ({ changeId: c.changeId, updatedSources: [{kind:'prd',id:'需求-帮助-说明'}], reason: '已更新对应返回行为并核对派生结果' })) };
  receipt.candidateRevision = revisionOf((await deriveSpec({ ...o, preview: true })).text);
  await assert.rejects(deriveSpec({ ...o, receipt }), /来源块没有更新/);
  await writeFile(o.prdPath, prd('点击后展示说明；再次进入回到上次位置。'));
  r = await inspectSpecEdits(o); receipt.sourceRevisions = r.sourceRevisions;
  receipt.candidateRevision = revisionOf((await deriveSpec({ ...o, preview: true })).text);
  await assert.rejects(deriveSpec({ ...o, receipt: { ...receipt, resolutions: [] } }), /全部改动/);
  const preview = await deriveSpec({ ...o, preview: true }); assert.match(preview.text, /上次位置/);
  const result = await deriveSpec({ ...o, receipt });
  assert.equal(result.synchronizedChanges, 1); assert.equal((await inspectSpecEdits(o)).pending, false);
  await writeFile(o.specPath, (await readFile(o.specPath, 'utf8')).replace('上次位置', '新的位置'));
  await assert.rejects(deriveSpec({ ...o, receipt }), /过期/);
});
test('文档框架或新增节点改动不得静默遗漏；外部删除不得重建', async t => {
  const o = await fixture(t); await deriveSpec(o);
  await writeFile(o.specPath, (await readFile(o.specPath, 'utf8')) + '\n## 用户补充\n尚未有来源的新规则。\n');
  const r = await inspectSpecEdits(o); assert(r.changes.some(c => c.nodeId === '$document'));
  await assert.rejects(deriveSpec(o), /待同步手改/);
  await rm(o.specPath); await assert.rejects(deriveSpec(o), /外部删除/);
});
test('校验目标和来源边界，不允许把 Spec 写到 PRD 或 Project 外', async t => {
  const o = await fixture(t);
  await assert.rejects(deriveSpec({ ...o, specPath: o.prdPath }), /已有文件/);
  await assert.rejects(deriveSpec({ ...o, specPath: join(o.projectPath, '..', 'escape.md') }), /Project 内/);
  const invalid = definition(); invalid.pages = [{ id: 'PAGE', title: '候选页', htmlPath: 'missing.html' }];
  await writeFile(o.prdPath, prd('说明', invalid));
  await assert.rejects(deriveSpec(o), /ENOENT/);
});
test('恢复写入中断，保留后来编辑，不用旧基线覆盖', async t => {
  const o = await fixture(t); await deriveSpec(o);
  const cacheDir = join(o.projectPath, 'tool/spec-derivations');
  const cache = join(cacheDir, (await readdir(cacheDir)).find(f => f.endsWith('.json')));
  const state = JSON.parse(await readFile(cache, 'utf8'));
  const old = state.baseline.text;
  state.publication = { expectedRevision: revisionOf(old), next: { ...state.baseline, text: old.replace('正文顶部', '候选位置') } };
  await writeFile(cache, JSON.stringify(state));
  assert.equal((await inspectSpecEdits(o)).pending, false);
  await writeFile(cache, JSON.stringify(state));
  await writeFile(o.specPath, old.replace('正文顶部', '后来手改'));
  await assert.rejects(inspectSpecEdits(o), /写入中断/);
  assert.match(await readFile(o.specPath, 'utf8'), /后来手改/);
});

test('未标记的新增正文拒绝生成，来源相同图片别名保持各自目标', () => {
  assert.throws(() => compileSpec({prdText:prd()+'\n## 新规则\n未经标记的正文。',architectureText:arch}), /未标记来源/);
  const r=compileSpec({prdText:prd('![产品图][diagram]\n\n[diagram]: ../assets/product.svg'),architectureText:arch+'\n![技术图][diagram]\n\n[diagram]: ../assets/architecture.svg',prdPath:'../docs/PRD.md',architecturePath:'../design/Architecture.md'});
  assert.match(r.text,/!\[产品图\]\(<\.\.\/assets\/product.svg>\)/);
  assert.match(r.text,/!\[技术图\]\(<\.\.\/assets\/architecture.svg>\)/);
});
test('可在尚未存在的目录派生，代码中的相对链接不被改写', async t => {
  const o=await fixture(t);o.specPath=join(o.projectPath,'product-spec/current/Spec.md');
  await writeFile(o.prdPath,prd('[文档](./other.md)\n\n`[代码](./other.md)`'));
  await deriveSpec(o);const text=await readFile(o.specPath,'utf8');
  assert.match(text,/\[文档\]\(<\.\.\/\.\.\/other.md>\)/);
  assert.match(text,/`\[代码\]\(\.\/other.md\)`/);
});
test('中断在原文件移走后，恢复原路径且下次派生可继续', async t => {
  const o=await fixture(t);await deriveSpec(o);
  const dir=join(o.projectPath,'tool/spec-derivations'),cache=join(dir,(await readdir(dir)).find(f=>f.endsWith('.json')));
  const state=JSON.parse(await readFile(cache,'utf8')),old=await readFile(o.specPath,'utf8');
  const previousPath=o.specPath+'.derivation-previous';
  await writeFile(previousPath,old);await rm(o.specPath);
  state.publication={expectedRevision:revisionOf(old),next:{...state.baseline,text:old.replace('正文顶部','候选')},previousPath};
  await writeFile(cache,JSON.stringify(state));
  assert.equal((await inspectSpecEdits(o)).pending,false);
  assert.equal(await readFile(o.specPath,'utf8'),old);
  assert.equal((await deriveSpec(o)).derived,true);
});


test('仅以未标记标题表达的产品或技术决定也必须拒绝', () => {
  const config = definition(); config.nodes[0].architecture = [];
  assert.throws(() => compileSpec({ prdText: prd('说明', config), architectureText: '# 架构\n\n## 决定：申请模块拥有状态\n' }), /architecture存在未标记来源的标题/);
  assert.throws(() => compileSpec({ prdText: prd() + '\n## 产品规则：必须审计\n', architectureText: arch }), /prd存在未标记来源的标题/);
  assert.throws(() => compileSpec({ prdText: prd(), architectureText: arch + '\n# 后续决定\n' }), /architecture存在未标记来源的标题/);
});

test('文档标题和包含已标记后代的分组保持兼容，空分组不掩盖来源遗漏', () => {
  const groupedPrd = prd().replace('#### 查看说明', '## 功能说明\n\n### 帮助模块\n\n#### 查看说明');
  const groupedArch = arch.replace('## 说明状态', '## 组件设计\n\n### 说明状态');
  assert.match(compileSpec({ prdText: groupedPrd, architectureText: groupedArch }).text, /弹层组件持有打开状态/);
  assert.throws(() => compileSpec({ prdText: prd(), architectureText: arch.replace('## 说明状态', '## 未标记决定\n\n## 说明状态') }), /未标记来源的标题/);
  const config = definition(); config.nodes[0].architecture = [];
  assert.doesNotThrow(() => compileSpec({ prdText: prd('说明', config), architectureText: '# 架构\n' }));
});

test('有来源标记的标题本身可以完整表达决定，并保留在派生中', () => {
  const headingOnly = '# 架构\n\n## 决定：说明状态属于弹层组件\n<!-- architecture-id: HELP-STATE -->\n';
  assert.match(compileSpec({ prdText: prd(), architectureText: headingOnly }).text, /决定：说明状态属于弹层组件/);
});

test('源文档新增未标记标题时拒绝刷新，保留既有 Spec 与基线', async t => {
  const options = await fixture(t); await deriveSpec(options);
  const original = await readFile(options.specPath, 'utf8');
  await writeFile(options.architecturePath, arch + '\n## 新决定：必须追踪原操作\n');
  await assert.rejects(deriveSpec(options), /未标记来源的标题/);
  assert.equal(await readFile(options.specPath, 'utf8'), original);
  assert.equal((await inspectSpecEdits(options)).pending, false);
  await writeFile(options.architecturePath, arch);
  assert.equal((await deriveSpec(options)).derived, true);
});
