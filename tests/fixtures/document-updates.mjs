import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMarkdownBundle } from '../../src/markdown-spec-reader.mjs';
import { createEmptySpecMap } from '../../src/contracts.mjs';

export const specText = `# 文档更新演示
> 状态：draft
> 版本：1.0

## MODULE \`TASK\`：任务
### 页面：任务板（\`PAGE-TASK\`）
- 页面路由提示：\`#task\`
#### ACTION \`TASK-SAVE\`：保存任务
- 状态：\`draft\`
- 来源：\`formal-source\`
- 产品结果：保存成功后显示任务。
- 异常与恢复：失败时保留输入，可以重试。
- 页面匹配提示：保存任务
`;
export const prdText = `# 更新演示产品需求文档
<!-- prd-profile: 可映射PRD-v1 -->
> 文档状态：草稿
> 适用版本：v1.0
## 4. 详细功能说明
### 4.1 任务
#### 4.1.1 任务板
<!-- prd-section-id: 需求-任务-任务板 -->
##### 功能说明
帮助用户管理任务。
##### 入口与页面
从首页进入任务板。
##### 用户操作与产品结果
创建后显示任务。
##### 必要规则
标题必填。
## 5. 全局产品规则
### 5.1 当前任务
<!-- prd-section-id: 规则-任务-当前任务 -->
操作只影响当前任务。
`;
export async function documentFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ips-document-updates-'));
  const htmlPath = join(directory, 'index.html');
  const sourceSpecPath = join(directory, 'product.spec.md');
  const specPath = join(directory, 'product.spec.json');
  const prdPath = join(directory, 'product-prd.md');
  const mapPath = join(directory, 'spec-map.json');
  const seed = { schemaVersion: '0.1', product: { id: 'UPDATES', title: '文档更新演示', version: '1.0', status: 'draft' }, modules: [] };
  const bundle = readMarkdownBundle(specText, seed).bundle;
  await Promise.all([
    writeFile(htmlPath, '<!doctype html><html lang="zh"><meta charset="utf-8"><title>任务板</title><main><h1>任务板</h1><input aria-label="保留画布输入"><button>保存任务</button></main></html>'),
    writeFile(sourceSpecPath, specText), writeFile(prdPath, prdText),
    writeFile(specPath, JSON.stringify(bundle)),
    writeFile(mapPath, JSON.stringify(createEmptySpecMap(bundle.product.id, htmlPath))),
  ]);
  return { directory, htmlPath, sourceSpecPath, specPath, prdPath, mapPath, bundle, project: { name: '文档更新演示', projectPath: directory, sourceType: 'html', htmlPath, sourceSpecPath, specPath, prdPath, mapPath, mapPolicy: 'existing', confirmPrdMapCreate: true, mode: 'map' } };
}
