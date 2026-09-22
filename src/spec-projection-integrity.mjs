import { fromMarkdown } from 'mdast-util-from-markdown';
import { flattenSpecNodes } from './contracts.mjs';

// 只检查实际顶层标题，代码示例、注释和引用中的节点不属于正文。
export function validateSpecProjectionIntegrity(source, bundle) {
  const sourceNodes = fromMarkdown(source).children.flatMap(block => {
    if (block.type !== 'heading' || block.depth < 3) return [];
    const text = source.slice(block.position.start.offset, block.position.end.offset);
    const match = text.match(/^#{3,6}\s+(SURFACE|ACTION|RULE|STATE|EVENT|PERMISSION|EXTERNAL|AC|TBD)\s+`([^`]+)`[：:]/);
    return match ? [{ type: match[1], id: match[2] }] : [];
  });
  // 旧版自由格式正文仍兼容；没有标准节点标题时不猜测其结构。
  if (!sourceNodes.length) return [];

  const projected = new Map(flattenSpecNodes(bundle).map(node => [node.id, node]));
  const seen = new Set();
  const errors = [];
  for (const node of sourceNodes) {
    if (seen.has(node.id)) errors.push(`原始 Markdown 节点 ID 重复：${node.id}`);
    seen.add(node.id);
    const actual = projected.get(node.id);
    if (!actual) errors.push(`工作台投影遗漏原始节点：${node.id}`);
    else if (actual.type !== node.type) {
      errors.push(`工作台投影改变节点类型：${node.id}（${node.type} → ${actual.type}）`);
    }
  }
  for (const id of projected.keys()) {
    if (!seen.has(id)) errors.push(`工作台投影包含来源中不存在的节点：${id}`);
  }
  return errors;
}
