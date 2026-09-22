import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpecProjectionIntegrity } from '../src/spec-projection-integrity.mjs';

const source = `# 产品 Spec
## MODULE \`TASK\`：任务
### 列表页
#### SURFACE \`LIST\`：列表
- 产品结果：显示任务。
#### ACTION \`SEARCH\`：搜索
- 产品结果：筛选列表。
### 编辑弹窗
#### ACTION \`CANCEL\`：取消
- 产品结果：关闭且丢弃未提交内容。
### RULE \`ACCESS\`：权限
- 规则：只操作自己创建的任务。
`;
const nodes = [
  { id: 'LIST', type: 'SURFACE' },
  { id: 'SEARCH', type: 'ACTION' },
  { id: 'CANCEL', type: 'ACTION' },
  { id: 'ACCESS', type: 'RULE' },
];
const bundle = values => ({ modules: [{ id: 'TASK', nodes: values }] });

test('页面小节内普通操作和共用规则完整保留，顺序不影响身份核对', () => {
  assert.deepEqual(validateSpecProjectionIntegrity(source, bundle([...nodes].reverse())), []);
});

test('遗漏搜索或取消、改变类型、凭空新增节点均被拒绝', () => {
  assert.deepEqual(validateSpecProjectionIntegrity(source, bundle(nodes.filter(n => n.id !== 'CANCEL'))), [
    '工作台投影遗漏原始节点：CANCEL',
  ]);
  assert.match(validateSpecProjectionIntegrity(source, bundle(nodes.map(n => n.id === 'SEARCH' ? { ...n, type: 'RULE' } : n))).join(), /改变节点类型：SEARCH/);
  assert.match(validateSpecProjectionIntegrity(source, bundle([...nodes, { id: 'INVENTED', type: 'ACTION' }])).join(), /不存在的节点：INVENTED/);
});

test('代码块、引用和 HTML 注释中的示例标题不作为实际节点', () => {
  const examples = '\n```markdown\n### ACTION `EXAMPLE`：示例\n```\n\n> ### ACTION `QUOTE`：引用\n\n<!--\n### ACTION `COMMENT`：注释\n-->\n';
  assert.deepEqual(validateSpecProjectionIntegrity(source + examples, bundle(nodes)), []);
});

test('重复源 ID 被指出；无标准标题的历史自由格式不猜测节点', () => {
  assert.match(validateSpecProjectionIntegrity(source + '\n### ACTION `SEARCH`：重复\n', bundle(nodes)).join(), /ID 重复：SEARCH/);
  assert.deepEqual(validateSpecProjectionIntegrity('# 历史正文\n普通段落', bundle(nodes)), []);
});
