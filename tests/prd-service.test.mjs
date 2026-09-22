import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parsePrdMarkdown, readPrdDocument } from '../src/prd-service.mjs';
import { readPrdMap, savePrdMap } from '../src/prd-map-store.mjs';

const validPrd = `# MDT 会诊 App 产品需求文档

<!-- prd-profile: 可映射PRD-v1 -->

> 文档状态：草稿  
> 适用版本：v0.3

## 4. 详细功能说明

### 4.1 会诊协作

#### 4.1.1 发起并完成会诊
<!-- prd-section-id: 需求-会诊-发起并完成会诊 -->

##### 功能说明

帮助医生完成一次会诊闭环。

##### 入口与页面

从患者页进入。

##### 用户操作与产品结果

1. 发起会诊并提交。

##### 必要规则

- 必须选择当前患者。

## 5. 全局产品规则

### 5.1 当前患者
<!-- prd-section-id: 规则-患者身份-当前患者 -->

- 页面操作始终作用于当前患者。

## 6. 待确认事项
`;

test('parsePrdMarkdown extracts mapping-ready function and rule sections', () => {
  const parsed = parsePrdMarkdown(validPrd, { path: '/tmp/MDT产品需求文档.md' });
  assert.equal(parsed.valid, true, parsed.errors.join('\n'));
  assert.equal(parsed.document.profileVersion, '可映射PRD-v1');
  assert.equal(parsed.document.version, 'v0.3');
  assert.deepEqual(parsed.document.sections.map(section => section.id), [
    '需求-会诊-发起并完成会诊',
    '规则-患者身份-当前患者',
  ]);
  assert.equal(parsed.document.sections[0].blocks['入口与页面'], '从患者页进入。');
});

test('invalid PRD fails closed with precise remediation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ips-prd-invalid-'));
  const path = join(folder, '输入PRD.md');
  await writeFile(path, validPrd.replace('<!-- prd-profile: 可映射PRD-v1 -->\n', ''), 'utf8');
  await assert.rejects(
    () => readPrdDocument(path),
    error => {
      assert.match(error.message, /缺少 PRD 格式标记/);
      assert.match(error.message, /保留原文件/);
      assert.match(error.message, /\$product-documentation/);
      assert.match(error.message, /drafts-documents/);
      return true;
    },
  );
});

test('function structure follows authored branches and preserves nested content without fixed blocks', () => {
  const body = `本功能先创建记录，再发送通知。

##### 创建成功但通知失败
保留已创建记录，只重试通知。
###### 恢复到原记录
通知成功后回到同一记录，不再次创建。

##### 提交结果尚未确认
先查询原请求；结果确认前不另发创建。
`;
  const source = validPrd.replace(/##### 功能说明[\s\S]*?(?=## 5\.)/, body + '\n');
  const parsed = parsePrdMarkdown(source);
  assert.equal(parsed.valid, true, parsed.errors.join('\n'));
  const section = parsed.document.sections[0];
  assert.equal(section.id, '需求-会诊-发起并完成会诊');
  assert.deepEqual(Object.keys(section.blocks), ['正文', '创建成功但通知失败', '提交结果尚未确认']);
  assert.equal(section.blocks['正文'], '本功能先创建记录，再发送通知。');
  assert.match(section.blocks['创建成功但通知失败'], /###### 恢复到原记录\n通知成功后回到同一记录，不再次创建。/);
  assert.equal(section.markdown.slice(section.markdown.indexOf(body.trim())), body.trim());
  assert.equal(parsed.document.sections[1].markdown, parsePrdMarkdown(validPrd).document.sections[1].markdown);
});

test('simple prose is valid, empty functions fail, and repeated headings do not discard content', () => {
  const withBody = body => validPrd.replace(/##### 功能说明[\s\S]*?(?=## 5\.)/, body + '\n\n');
  const simple = parsePrdMarkdown(withBody('点击展开说明，再次点击收起；离开页面后重置。'));
  assert.equal(simple.valid, true);
  assert.deepEqual(simple.document.sections[0].blocks, { 正文: '点击展开说明，再次点击收起；离开页面后重置。' });
  const empty = parsePrdMarkdown(withBody('##### 尚未编写'));
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.some(error => error.includes('缺少功能正文')));
  const repeated = parsePrdMarkdown(withBody('##### 恢复\n回到原记录。\n##### 恢复\n保留当前输入。'));
  assert.equal(repeated.valid, true);
  assert.equal(repeated.document.sections[0].blocks['恢复'], '回到原记录。\n\n保留当前输入。');
});

test('PRD map persists page-to-section links and rejects stale saves', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ips-prd-map-'));
  const prdPath = join(folder, '产品需求文档.md');
  const mapPath = join(folder, 'prd-map.json');
  await writeFile(prdPath, validPrd, 'utf8');
  const { document } = await readPrdDocument(prdPath);
  const loaded = await readPrdMap({
    mapPath,
    prdDocument: document,
    targetSource: join(folder, 'index.html'),
    createOnDisk: true,
  });
  const now = new Date().toISOString();
  const nextMap = structuredClone(loaded.map);
  nextMap.items.push({
    id: '页面-会诊发起',
    page: {
      pageId: null,
      title: '会诊发起页',
      context: { url: '/target/index.html#/consultation/create' },
    },
    sectionIds: ['需求-会诊-发起并完成会诊', '规则-患者身份-当前患者'],
    confirmedAt: now,
    updatedAt: now,
  });
  const saved = await savePrdMap({
    mapPath,
    prdDocument: document,
    nextMap,
    baseRevision: loaded.revision,
  });
  assert.equal(saved.ok, true);
  const onDisk = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.deepEqual(onDisk.items[0].sectionIds, nextMap.items[0].sectionIds);
  const tamperedTarget = structuredClone(saved.map);
  tamperedTarget.targetSource = '/tmp/other-page.html';
  const targetSafeSave = await savePrdMap({
    mapPath,
    prdDocument: document,
    nextMap: tamperedTarget,
    baseRevision: saved.revision,
  });
  assert.equal(targetSafeSave.ok, true);
  assert.equal(targetSafeSave.map.targetSource, join(folder, 'index.html'));
  await assert.rejects(
    () => readPrdMap({
      mapPath,
      prdDocument: document,
      targetSource: join(folder, 'other.html'),
      createOnDisk: false,
    }),
    /targetSource 与当前页面来源不一致/,
  );
  const changedPrd = parsePrdMarkdown(
    validPrd.replace('需求-会诊-发起并完成会诊', '需求-会诊-重新定义会诊'),
    { path: prdPath },
  ).document;
  const drifted = await readPrdMap({
    mapPath,
    prdDocument: changedPrd,
    targetSource: join(folder, 'index.html'),
    createOnDisk: false,
  });
  assert.equal(drifted.stale, true);
  assert.deepEqual(drifted.missingSectionIds, ['需求-会诊-发起并完成会诊']);
  await assert.rejects(
    () => savePrdMap({ mapPath, prdDocument: document, nextMap, baseRevision: loaded.revision }),
    error => error.code === 'PRD_MAP_CHANGED',
  );
});
