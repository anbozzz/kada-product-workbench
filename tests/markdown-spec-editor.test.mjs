import test from 'node:test';
import assert from 'node:assert/strict';
import { updateMarkdownSpecNode } from '../src/markdown-spec-editor.mjs';

test('操作定义保存只重写对应 Markdown 节点并保留其他章节', () => {
  const source = `# 示例\n\n## MODULE\n\n### ACTION \`ACTION-ONE\`：原标题\n\n- 状态：\`draft\`\n- 来源：\`product-decision\`；正式文档。\n- 产品意图：原始意图。\n- 边界与例外：第一行\n  第二行\n\n### RULE \`RULE-KEEP\`：保持不变\n\n- 规则：不得被重写。\n`;
  const before = {
    id: 'ACTION-ONE', type: 'ACTION', title: '原标题', status: 'draft',
    sourceKind: 'product-decision', anchorHints: ['原锚点'],
    contentBlocks: [
      { id: 'status', label: '状态', content: '`draft`' },
      { id: 'source', label: '来源', content: '`product-decision`；正式文档。' },
      { id: 'intent', label: '产品意图', content: '原始意图。' },
      { id: 'boundary', label: '边界与例外', content: '第一行\n第二行' },
    ],
  };
  const after = {
    ...before,
    title: '修订标题',
    status: 'reviewing',
    anchorHints: ['按钮文案', '页面标题'],
    contentBlocks: before.contentBlocks.map(block =>
      block.id === 'intent' ? { ...block, content: '直接写回本地原文件。' } : block),
  };
  const updated = updateMarkdownSpecNode(source, before, after);

  assert.match(updated, /### ACTION `ACTION-ONE`：修订标题/);
  assert.match(updated, /- 状态：`reviewing`/);
  assert.match(updated, /- 产品意图：直接写回本地原文件。/);
  assert.match(updated, /- 页面匹配提示：按钮文案；页面标题/);
  assert.match(updated, /### RULE `RULE-KEEP`：保持不变[\s\S]*- 规则：不得被重写。/);
  assert.equal((updated.match(/ACTION-ONE/g) || []).length, 1);
});

test('Markdown 节点缺失或重复时拒绝写回', () => {
  const node = { id: 'ACTION-ONE', type: 'ACTION', title: '标题', status: 'draft', sourceKind: 'candidate', anchorHints: [], contentBlocks: [] };
  assert.throws(() => updateMarkdownSpecNode('# 空文档\n', node, node), /找不到节点/);
  assert.throws(
    () => updateMarkdownSpecNode('### ACTION `ACTION-ONE`：一\n\n### ACTION `ACTION-ONE`：二\n', node, node),
    /出现多次/,
  );
});

test('按页面组织的普通操作可原位修订，保留下一页面及共享约束', () => {
  const source = '# Spec\n\n## MODULE `TASK`：任务\n\n### 编辑页\n\n#### ACTION `CANCEL`：取消\n\n- 产品结果：关闭弹窗。\n\n### 列表页\n\n#### SURFACE `LIST`：列表\n\n- 产品结果：显示列表。\n\n### RULE `ACCESS`：权限\n\n- 规则：保留权限。\n';
  const before = { id: 'CANCEL', type: 'ACTION', title: '取消', contentBlocks: [{ id: 'result', label: '产品结果', content: '关闭弹窗。' }] };
  const after = { ...before, contentBlocks: [{ id: 'result', label: '产品结果', content: '关闭弹窗并丢弃未提交修改。' }] };
  const updated = updateMarkdownSpecNode(source, before, after);
  assert.equal(updated.slice(updated.indexOf('### 列表页')), source.slice(source.indexOf('### 列表页')));
  assert.ok(updated.includes('- 产品结果：关闭弹窗并丢弃未提交修改。'));
});

test('统一 Spec 局部写回保留前置来源、页面身份与后续工程和验收章节', () => {
  const prefix = '# 统一 Spec\n\n> PRD 基线：prd.md@v2\n\n## 页面总览\n\n| 页面 ID | 职责 | 拟定路由 |\n| --- | --- | --- |\n| PAGE-EDIT | 编辑记录 | /records/:id |\n\n## MODULE `RECORD`：记录\n\n### 页面 `PAGE-EDIT`\n\n';
  const engineering = '## 工程实现约束\n\n### 决定 `TECH-SOURCE`\n\n- 状态：adopted\n- 源码：src/；构建产物：dist/，后续修改回源码。\n\n```text\nsrc/pages/record.ts\nsrc/data/records.ts\n```\n\n## 验收与变更影响\n\n取消后重新打开记录，原已保存内容保持不变。\n';
  const source = `${prefix}#### ACTION \`CANCEL-EDIT\`：取消编辑\n\n- 产品结果：关闭编辑。\n\n${engineering}`;
  const before = { id: 'CANCEL-EDIT', type: 'ACTION', title: '取消编辑', contentBlocks: [{ id: 'result', label: '产品结果', content: '关闭编辑。' }] };
  const after = { ...before, contentBlocks: [{ id: 'result', label: '产品结果', content: '关闭编辑并丢弃未提交修改，已保存内容不变。' }] };
  const updated = updateMarkdownSpecNode(source, before, after);
  assert.equal(updated.slice(0, prefix.length), prefix);
  assert.equal(updated.slice(updated.indexOf('## 工程实现约束')), engineering);
  assert.ok(updated.includes('- 产品结果：关闭编辑并丢弃未提交修改，已保存内容不变。'));
});
