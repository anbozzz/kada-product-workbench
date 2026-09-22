import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export const PRD_PROFILE = '可映射PRD-v1';
export const PRD_LIFECYCLE = Object.freeze({
  draft: '草稿',
  reviewing: '评审中',
  confirmed: '已确认',
  superseded: '已替代',
});

const hashText = value => createHash('sha256').update(value).digest('hex');
const cleanHeading = value => value.trim().replace(/\s+#+\s*$/, '').trim();
const unnumbered = value => value.replace(/^\d+(?:\.\d+)*\.?\s*/, '').trim();
const semanticIdPattern = /^(需求|规则)-(?=.*\p{Script=Han})[^\s<>]+(?:-[^\s<>]+)*$/u;

export const prdLifecycleStatus = value => {
  const status = String(value || '').trim();
  return Object.entries(PRD_LIFECYCLE).find(([, label]) => status.startsWith(label))?.[0] || 'unknown';
};

const headingLines = source => {
  const lines = source.split(/\r?\n/);
  const headings = [];
  let fenced = false;
  let fenceMarker = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!fenced) {
        fenced = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        fenced = false;
      }
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ level: match[1].length, title: cleanHeading(match[2]), line: index });
  }
  return { lines, headings };
};

const sectionEndLine = (headings, heading, lineCount) =>
  headings.find(candidate => candidate.line > heading.line && candidate.level <= heading.level)?.line ?? lineCount;

const markerAfter = (lines, heading, endLine) => {
  for (let line = heading.line + 1; line < endLine; line += 1) {
    const value = lines[line].trim();
    if (!value) continue;
    return value.match(/^<!--\s*prd-section-id:\s*(.+?)\s*-->$/)?.[1]?.trim() || '';
  }
  return '';
};

const blockContent = (lines, heading, endLine) => lines
  .slice(heading.line + 1, endLine)
  .filter(line => !/^<!--\s*prd-section-id:/.test(line.trim()))
  .join('\n')
  .trim();

const metadataValue = (source, label) =>
  source.match(new RegExp(`^>\\s*${label}：\\s*(.+?)\\s{0,2}$`, 'm'))?.[1]?.trim() || '';

const normalizeProductName = title => title
  .replace(/产品需求文档\s*$/u, '')
  .replace(/\s+/g, '')
  .replace(/[^\p{Letter}\p{Number}_-]/gu, '');

export function parsePrdMarkdown(source, { path = '' } = {}) {
  const errors = [];
  const { lines, headings } = headingLines(source);
  const profileMatches = [...source.matchAll(/<!--\s*prd-profile:\s*(.+?)\s*-->/g)];
  const profileVersion = profileMatches[0]?.[1]?.trim() || '';
  if (!profileVersion) {
    errors.push(`缺少 PRD 格式标记：<!-- prd-profile: ${PRD_PROFILE} -->`);
  } else if (profileVersion !== PRD_PROFILE) {
    errors.push(`PRD 格式版本不受支持：${profileVersion}`);
  }
  if (profileMatches.length > 1) errors.push('PRD 格式标记重复');

  const titleHeading = headings.find(heading => heading.level === 1);
  const title = titleHeading?.title || '';
  if (!title) errors.push('缺少一级文档标题');

  const detailHeading = headings.find(heading =>
    heading.level === 2 && unnumbered(heading.title) === '详细功能说明');
  const globalRuleHeading = headings.find(heading =>
    heading.level === 2 && unnumbered(heading.title) === '全局产品规则');
  if (!detailHeading) errors.push('缺少“## 4. 详细功能说明”章节');
  if (!globalRuleHeading) errors.push('缺少“## 5. 全局产品规则”章节');

  const sections = [];
  const detailEnd = detailHeading
    ? sectionEndLine(headings, detailHeading, lines.length)
    : -1;
  const functionHeadings = detailHeading ? headings.filter(heading =>
    heading.level === 4
      && heading.line > detailHeading.line
      && heading.line < detailEnd
      && !/^业务流程(?:（可选）)?$/u.test(unnumbered(heading.title))) : [];

  if (detailHeading && functionHeadings.length === 0) {
    errors.push('“详细功能说明”中没有“#### 具体功能”章节');
  }

  for (const heading of functionHeadings) {
    const endLine = sectionEndLine(headings, heading, lines.length);
    const id = markerAfter(lines, heading, endLine);
    if (!id) {
      errors.push(`“${heading.title}”缺少紧随标题的 prd-section-id`);
    } else if (!id.startsWith('需求-')) {
      errors.push(`“${heading.title}”的章节 ID 必须以“需求-”开头：${id}`);
    } else if (!semanticIdPattern.test(id)) {
      errors.push(`“${heading.title}”的章节 ID 必须是包含中文语义的非空短语：${id}`);
    }
    const childHeadings = headings.filter(candidate =>
      candidate.level === 5 && candidate.line > heading.line && candidate.line < endLine);
    const body = blockContent(lines, heading, endLine);
    if (!body.replace(/^#{1,6}\s+.*$/gm, '').trim()) {
      errors.push(`“${heading.title}”缺少功能正文`);
    }
    const blocks = new Map();
    const addBlock = (name, content) => blocks.set(name, [blocks.get(name), content].filter(Boolean).join('\n\n'));
    const intro = blockContent(lines, heading, childHeadings[0]?.line ?? endLine);
    if (intro) addBlock('正文', intro);
    for (const child of childHeadings) {
      addBlock(unnumbered(child.title), blockContent(lines, child, sectionEndLine(childHeadings, child, endLine)));
    }
    const domainHeading = [...headings].reverse().find(candidate =>
      candidate.level === 3 && candidate.line < heading.line && candidate.line > detailHeading.line);
    sections.push({
      id,
      kind: 'function',
      title: heading.title,
      domainTitle: domainHeading?.title || '',
      headingPath: [detailHeading.title, domainHeading?.title, heading.title].filter(Boolean),
      startLine: heading.line + 1,
      endLine,
      markdown: lines.slice(heading.line, endLine).join('\n').trim(),
      blocks: Object.fromEntries(blocks),
    });
  }

  if (globalRuleHeading) {
    const globalEnd = sectionEndLine(headings, globalRuleHeading, lines.length);
    const ruleHeadings = headings.filter(heading =>
      heading.level === 3 && heading.line > globalRuleHeading.line && heading.line < globalEnd);
    for (const heading of ruleHeadings) {
      const endLine = sectionEndLine(headings, heading, lines.length);
      const id = markerAfter(lines, heading, endLine);
      if (!id) {
        errors.push(`全局规则“${heading.title}”缺少紧随标题的 prd-section-id`);
      } else if (!id.startsWith('规则-')) {
        errors.push(`全局规则“${heading.title}”的章节 ID 必须以“规则-”开头：${id}`);
      } else if (!semanticIdPattern.test(id)) {
        errors.push(`全局规则“${heading.title}”的章节 ID 必须是包含中文语义的非空短语：${id}`);
      }
      sections.push({
        id,
        kind: 'global-rule',
        title: heading.title,
        domainTitle: '',
        headingPath: [globalRuleHeading.title, heading.title],
        startLine: heading.line + 1,
        endLine,
        markdown: lines.slice(heading.line, endLine).join('\n').trim(),
        blocks: { 规则正文: blockContent(lines, heading, endLine) },
      });
    }
  }

  const seenIds = new Set();
  for (const section of sections) {
    if (!section.id) continue;
    if (seenIds.has(section.id)) errors.push(`prd-section-id 重复：${section.id}`);
    seenIds.add(section.id);
  }

  const version = metadataValue(source, '适用版本');
  const status = metadataValue(source, '文档状态');
  if (!version) errors.push('文档头缺少“> 适用版本：”或版本为空');
  if (!status) errors.push('文档头缺少“> 文档状态：”或状态为空');

  const resolvedPath = path ? resolve(path) : '';
  const normalizedName = normalizeProductName(title) || basename(resolvedPath).replace(/\.[^.]+$/, '') || '未命名产品';
  const revision = hashText(source);
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    document: {
      profileVersion,
      productId: `产品-${normalizedName}`,
      title,
      version,
      status,
      path: resolvedPath,
      revision,
      source,
      sections,
    },
  };
}

export async function readPrdDocument(path, { requireValid = true } = {}) {
  const resolvedPath = resolve(path);
  const source = await readFile(resolvedPath, 'utf8');
  const result = parsePrdMarkdown(source, { path: resolvedPath });
  if (requireValid && !result.valid) {
    throw new Error([
      'PRD 格式不符合可映射合同，不能建立页面绑定：',
      ...result.errors.map(error => `- ${error}`),
      '请保留原文件；可在项目中心明确创建 Codex 草稿任务，或手动调用 $product-documentation 在 drafts-documents/ 生成标准化 PRD 草稿，然后重新绑定。',
    ].join('\n'));
  }
  return result;
}
