const NODE_HEADING = /^(#{3,6})\s+(SURFACE|ACTION|RULE|STATE|EVENT|PERMISSION|EXTERNAL|AC|TBD)\s+`([^`]+)`[：:]\s*(.*)$/;

import { fromMarkdown } from 'mdast-util-from-markdown';

const sourceKindContent = (content, sourceKind) => {
  const suffix = String(content || '').match(/[；;].*$/)?.[0] || '';
  return `\`${sourceKind}\`${suffix}`;
};

const statusContent = (content, status) =>
  String(content || '').includes('`') ? `\`${status}\`` : status;

const sourceBlocksForNode = (beforeNode, afterNode) => {
  const rawBlocks = Array.isArray(afterNode.contentBlocks)
    ? afterNode.contentBlocks
    : Object.entries(afterNode.fields || {}).map(([label, content], index) => ({
        id: `legacy-${index + 1}`,
        label,
        content: Array.isArray(content) ? content.join('\n') : content,
      }));
  const blocks = rawBlocks.map(block => ({ ...block }));
  const status = blocks.find(block => block.id === 'status' || block.label === '状态');
  if (status) status.content = statusContent(status.content, afterNode.status);
  const source = blocks.find(block => block.id === 'source' || block.label === '来源');
  if (source) source.content = sourceKindContent(source.content, afterNode.sourceKind);

  if (String(beforeNode.statement || '') !== String(afterNode.statement || '')) {
    const definition = blocks.find(block =>
      ['statement', 'definition'].includes(block.id)
      || ['定义', '概括性定义'].includes(block.label)
      || String(block.content || '').trim() === String(beforeNode.statement || '').trim());
    if (!definition) {
      throw new Error('原始 Markdown 中无法定位概括性定义，请编辑对应的原文字段');
    }
    definition.content = afterNode.statement || '';
  }

  if (
    JSON.stringify(beforeNode.anchorHints || []) !== JSON.stringify(afterNode.anchorHints || [])
  ) {
    const hints = blocks.find(block => block.label === '页面匹配提示');
    const content = (afterNode.anchorHints || []).join('；');
    if (hints) hints.content = content;
    else if (content) blocks.push({ id: 'anchor-hints', label: '页面匹配提示', content });
  }
  if (!blocks.length && afterNode.statement) {
    blocks.push({ id: 'definition', label: '定义', content: afterNode.statement });
  }
  return blocks.filter(block => String(block.label || '').trim() && String(block.content || '').trim());
};

const serializeBlock = block => {
  const content = String(block.content).trim().replace(/\r?\n/g, '\n  ');
  return `- ${String(block.label).trim()}：${content}`;
};

export function updateMarkdownSpecNode(source, beforeNode, afterNode) {
  if (!beforeNode?.id || beforeNode.id !== afterNode?.id) {
    throw new Error('只能更新同一个稳定 Spec 节点');
  }
  if (/\r|\n/.test(afterNode.title || '')) {
    throw new Error('节点标题不能包含换行');
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const matches = [];
  lines.forEach((line, index) => {
    const match = line.match(NODE_HEADING);
    if (match?.[3] === beforeNode.id) matches.push({ index, match });
  });
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `原始 Markdown 中节点 ${beforeNode.id} 出现多次`
      : `原始 Markdown 中找不到节点 ${beforeNode.id}`);
  }

  const { index: headingIndex, match } = matches[0];
  const headingLevel = match[1].length;
  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/);
    if (heading && heading[1].length <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  const blocks = sourceBlocksForNode(beforeNode, afterNode);
  const originalBody = lines.slice(headingIndex + 1, endIndex).join('\n');
  const fieldHeadings = fromMarkdown(originalBody).children.filter(block => block.type === 'heading');
  const fieldDepth = Math.min(...fieldHeadings.map(block => block.depth));
  const headingLabels = new Set(fieldHeadings.filter(block => block.depth === fieldDepth).map(block =>
    originalBody.slice(block.position.start.offset, block.position.end.offset).replace(/^#{1,6}\s+/, '').replace(/[`*]/g, '').trim()));
  const beforeBlocks = sourceBlocksForNode(beforeNode, beforeNode);
  const headingBlockIds = new Set(beforeBlocks.filter(block => headingLabels.has(block.label)).map(block => block.id));
  // 新增定位元数据必须仍在标题字段之前，否则重读时会成为最后一段正文。
  const renderedBlocks = headingBlockIds.size
    ? [...blocks.filter(block => block.label === '页面匹配提示'), ...blocks.filter(block => block.label !== '页面匹配提示')]
    : blocks;
  const bodyChanged = JSON.stringify(beforeBlocks) !== JSON.stringify(blocks);
  if (!bodyChanged) {
    lines[headingIndex] = `${match[1]} ${match[2]} \`${afterNode.id}\`：${afterNode.title.trim()}`;
    return `${lines.join(newline).replace(/\s+$/, '')}${newline}`;
  }
  const nextSection = [
    `${match[1]} ${match[2]} \`${afterNode.id}\`：${afterNode.title.trim()}`,
    '',
    ...renderedBlocks.map(block => headingBlockIds.has(block.id)
      ? `${'#'.repeat(fieldDepth)} ${block.label}\n\n${String(block.content).trim()}\n`
      : serializeBlock(block)),
    '',
  ];
  const nextLines = [
    ...lines.slice(0, headingIndex),
    ...nextSection,
    ...lines.slice(endIndex),
  ];
  while (nextLines.length > 1 && nextLines.at(-1) === '' && nextLines.at(-2) === '') {
    nextLines.pop();
  }
  return `${nextLines.join(newline).replace(/\s+$/, '')}${newline}`;
}
