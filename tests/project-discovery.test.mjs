import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listLocalPath,
  parseLocalDevUrl,
  scanProjectDirectory,
} from '../src/project-discovery.mjs';

const validSpec = {
  schemaVersion: '0.1',
  product: {
    id: 'SCAN-DEMO',
    title: '扫描示例',
    version: '0.1',
    status: 'draft',
  },
  modules: [{
    id: 'SCAN-MODULE',
    title: '示例模块',
    purpose: '验证只读扫描',
    nodes: [{
      id: 'SCAN-SURFACE',
      type: 'SURFACE',
      title: '首页',
      status: 'draft',
      sourceKind: 'observed-ui',
      anchorHints: [],
    }],
  }],
};

test('只读扫描区分 PRD、Markdown Spec、内部 JSON 视图与两类映射文件', async () => {
  const project = await mkdtemp(join(tmpdir(), 'ips-discovery-'));
  await mkdir(join(project, 'dist'));
  await writeFile(join(project, 'dist', 'index.html'), '<!doctype html><title>Demo</title>');
  await writeFile(join(project, 'preview.html'), '<!doctype html><title>Preview</title>');
  await writeFile(join(project, 'product.spec.json'), JSON.stringify(validSpec));
  await writeFile(join(project, 'product.spec.md'), '# 扫描示例\n\n### ACTION `SCAN-ACTION`：示例操作');
  await writeFile(join(project, '产品需求文档.md'), `# 扫描示例产品需求文档

<!-- prd-profile: 可映射PRD-v1 -->

> 文档状态：草稿
> 适用版本：v0.1

## 4. 详细功能说明

### 4.1 示例功能域

#### 4.1.1 示例页面
<!-- prd-section-id: 需求-示例-示例页面 -->

##### 功能说明
说明。
##### 入口与页面
入口。
##### 用户操作与产品结果
结果。
##### 必要规则
规则。

## 5. 全局产品规则

### 5.1 示例规则
<!-- prd-section-id: 规则-示例-一致规则 -->

规则正文。
`);
  await writeFile(join(project, 'spec-map.json'), JSON.stringify({
    type: 'AnnotationCollection',
    productSpecId: 'SCAN-DEMO',
  }));
  await writeFile(join(project, 'prd-map.json'), JSON.stringify({
    schemaVersion: '0.1',
    productId: '产品-扫描示例',
    prd: { path: '产品需求文档.md', revision: 'abc', profileVersion: '可映射PRD-v1' },
    targetSource: 'index.html',
    updatedAt: new Date().toISOString(),
    items: [],
  }));

  const result = await scanProjectDirectory(project);
  assert.equal(result.recommended.htmlPath, join(project, 'dist', 'index.html'));
  assert.equal(result.recommended.specPath, join(project, 'product.spec.json'));
  assert.equal(result.recommended.sourceSpecPath, join(project, 'product.spec.md'));
  assert.equal(result.recommended.mapPath, join(project, 'spec-map.json'));
  assert.equal(result.spec[0].valid, true);
  assert.equal(result.specSource.length, 1);
  assert.equal(result.specSource[0].valid, true);
  assert.equal(result.map[0].valid, true);
  assert.equal(result.recommended.prdPath, join(project, '产品需求文档.md'));
  assert.equal(result.prd[0].valid, true, result.prd[0].errors.join('\n'));
  assert.equal(result.recommended.prdMapPath, join(project, 'prd-map.json'));
  assert.equal(result.prdMap[0].valid, true);
});

test('路径选择器按用途过滤文件', async () => {
  const project = await mkdtemp(join(tmpdir(), 'ips-picker-'));
  await writeFile(join(project, 'index.html'), '<!doctype html>');
  await writeFile(join(project, 'product.spec.json'), '{}');
  await writeFile(join(project, 'product.spec.md'), '# Spec');
  await writeFile(join(project, 'ignore.txt'), 'ignore');
  const html = await listLocalPath(project, 'html');
  assert.deepEqual(html.items.filter(item => item.type === 'file').map(item => item.name), ['index.html']);
  const json = await listLocalPath(project, 'json');
  assert.deepEqual(json.items.filter(item => item.type === 'file').map(item => item.name), ['product.spec.json']);
  const markdown = await listLocalPath(project, 'markdown');
  assert.deepEqual(markdown.items.filter(item => item.type === 'file').map(item => item.name), ['product.spec.md']);
});

test('本地开发地址拒绝外部主机和凭据', () => {
  assert.equal(parseLocalDevUrl('http://127.0.0.1:5173/').hostname, '127.0.0.1');
  assert.throws(() => parseLocalDevUrl('https://example.com/'), /只允许连接/);
  assert.throws(() => parseLocalDevUrl('http://user:pass@localhost:5173/'), /不能包含账号密码/);
});
