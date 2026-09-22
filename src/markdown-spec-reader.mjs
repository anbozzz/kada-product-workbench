import { fromMarkdown } from 'mdast-util-from-markdown';
import { flattenSpecNodes, validateSpecBundle } from './contracts.mjs';
import { validateSpecProjectionIntegrity } from './spec-projection-integrity.mjs';

const plain = value => value.replace(/[`*]/g, '').trim();
const references = value => [...value.matchAll(/`([^`]+)`/g)].map(match => match[1]);
const hints = value => (references(value).length ? references(value) : value.split(/[；;、]/)).map(plain).filter(Boolean);
const sectionTitle = value => plain(value.replace(/^#{1,6}\s+/, '').replace(/^\d+(?:\.\d+)*[.、]?\s*/, ''));

// 页面身份集中登记时，只读取明确的页面表；代码、引用及节点内的示例不参与登记。
function readPageRegistry(blocks, raw, headings) {
  const ranges = headings.filter(heading => /^(页面与模块依赖总览|页面登记(?:与复用)?|页面清单|页面总览)$/.test(sectionTitle(raw(heading)))).map(heading => ({
    start: heading.position.end.offset,
    end: headings.find(next => next.position.start.offset > heading.position.start.offset && next.depth <= heading.depth)?.position.start.offset ?? Infinity,
  }));
  const pages = new Map();
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => plain(cell.replace(/\\\|/g, '|')));
  for (const block of blocks) {
    if (block.type !== 'paragraph' || !ranges.some(range => block.position.start.offset >= range.start && block.position.end.offset <= range.end)) continue;
    const lines = raw(block).split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const header = cells(lines[i]);
      const idColumn = header.findIndex(cell => /^页面\s*ID$/i.test(cell));
      const titleColumn = header.findIndex(cell => /^(职责\/场景|页面名称|名称|职责)$/.test(cell));
      const routeColumn = header.findIndex(cell => /^(当前评审地址|评审地址|页面路由提示|路由提示|路由)$/.test(cell));
      if (idColumn < 0 || titleColumn < 0 || routeColumn < 0 || !cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) continue;
      const parentColumn = header.findIndex(cell => /^(父页面或上下文|父页面|父页面 ID)$/.test(cell));
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const row = cells(lines[i]);
        if (row.length !== header.length) throw new Error('页面登记表列数不一致，已保留旧版');
        const id = row[idColumn];
        if (pages.has(id)) throw new Error(`页面登记 ID 重复：${id}`);
        pages.set(id, { id, title: row[titleColumn], anchorHints: [], routeHints: hints(row[routeColumn]), parentPageId: parentColumn < 0 ? null : row[parentColumn] });
      }
    }
  }
  // 上下文文字和多入口不推断为单一父页面；只有明确登记的页面 ID 才能形成导航。
  for (const page of pages.values()) if (!pages.has(page.parentPageId)) page.parentPageId = null;
  return pages;
}

// 只解释明确的标准标题；字段正文按原始 Markdown 保存，不生成产品决定。
export function readMarkdownBundle(source, previous) {
  const blocks = fromMarkdown(source).children;
  const raw = block => source.slice(block.position.start.offset, block.position.end.offset);
  const headings = blocks.filter(block => block.type === 'heading');
  const bodyAfter = heading => {
    const next = headings.find(item => item.position.start.offset > heading.position.start.offset && item.depth <= heading.depth);
    return source.slice(heading.position.end.offset, next?.position.start.offset ?? source.length).trim();
  };
  const oldNodes = new Map(flattenSpecNodes(previous).map(node => [node.id, node]));
  const oldPages = new Map([...(previous.pages || []), ...previous.modules.flatMap(module => module.pages || [])].map(page => [page.id, page]));
  const modules = [];
  const pages = readPageRegistry(blocks, raw, headings);
  let currentModule = null;
  let currentPage = null;
  let sharedSection = false;
  const fieldBlocks = (body, old = []) => {
    const ast = fromMarkdown(body).children;
    const result = [];
    const add = (label, content) => result.push({ id: old.find(item => item.label === label)?.id || `source-${result.length + 1}`, label, content });
    const fieldDepth = Math.min(...ast.filter(block => block.type === 'heading').map(block => block.depth));
    for (let index = 0; index < ast.length; index += 1) {
      const block = ast[index];
      if (block.type === 'heading' && block.depth === fieldDepth) {
        const next = ast.findIndex((item, at) => at > index && item.type === 'heading' && item.depth === fieldDepth);
        const end = next < 0 ? body.length : ast[next].position.start.offset;
        add(plain(body.slice(block.position.start.offset, block.position.end.offset).replace(/^#{1,6}\s+/, '')),
          body.slice(block.position.end.offset, end).trim());
        index = next < 0 ? ast.length : next - 1;
        continue;
      }
      if (block.type === 'list') {
        for (const item of block.children) {
          const text = body.slice(item.position.start.offset, item.position.end.offset).replace(/^\s*[-+*]\s+/, '');
          const match = text.match(/^([^\n：:]+)[：:]\s*([\s\S]*)$/);
          if (match) add(plain(match[1]), match[2].replace(/\n {2}/g, '\n').trim());
          else add('正文', text);
        }
      } else add('正文', body.slice(block.position.start.offset, block.position.end.offset));
    }
    // 重复字段保留，块 ID 必须唯一。
    const seen = new Set();
    return result.map((block, index) => {
      if (seen.has(block.id)) block.id = `source-block-${index + 1}`;
      seen.add(block.id);
      return block;
    });
  };
  for (const heading of headings) {
    const title = raw(heading);
    if (heading.depth <= 2) { currentModule = null; currentPage = null; sharedSection = false; }
    if (heading.depth === 2 && /^公共约束(?:与未决项)?$/.test(sectionTitle(title))) {
      // 工具侧阅读分组，不按节点 ID 前缀猜测业务模块，也不改写正式文档。
      let id = 'SPEC-SHARED-CONSTRAINTS';
      const explicitIds = headings.map(item => raw(item).match(/^#{1,6}\s+MODULE\s+`([^`]+)`/)?.[1]);
      while (explicitIds.includes(id) || modules.some(module => module.id === id)) id += '-SHARED';
      currentModule = { id, title: sectionTitle(title), purpose: '集中阅读文档中直接定义的公共约束', nodes: [] };
      modules.push(currentModule);
      sharedSection = true;
      continue;
    }
    const moduleMatch = title.match(/^#{1,6}\s+MODULE\s+`([^`]+)`[：:]\s*(.+)$/);
    if (moduleMatch) {
      currentModule = { id: moduleMatch[1], title: moduleMatch[2], purpose: moduleMatch[2], nodes: [] };
      modules.push(currentModule);
      currentPage = null;
      sharedSection = false;
      continue;
    }
    const pageMatch = title.match(/^#{1,6}\s+页面[：:]\s*(.+?)[（(]`([^`]+)`[）)]/) || title.match(/^#{1,6}\s+页面\s+`([^`]+)`[：:]\s*(.+)$/);
    if (pageMatch) {
      const firstStyle = /页面[：:]/.test(title);
      const id = pageMatch[firstStyle ? 2 : 1];
      const pageTitle = pageMatch[firstStyle ? 1 : 2];
      const body = bodyAfter(heading).split(/\n#{3,6}\s/)[0];
      const route = body.match(/^- (?:页面路由提示|路由提示)[：:]\s*(.*)$/m);
      const anchors = body.match(/^- 页面匹配提示[：:]\s*(.*)$/m);
      currentPage = id;
      const metadata = pages.get(id) || oldPages.get(id);
      pages.set(id, { ...metadata, id, title: pageTitle, anchorHints: anchors ? hints(anchors[1]) : metadata?.anchorHints || [], ...(route ? { routeHints: hints(route[1]) } : {}) });
      continue;
    }
    const nodeMatch = title.match(/^#{3,6}\s+(SURFACE|ACTION|RULE|STATE|EVENT|PERMISSION|EXTERNAL|AC|TBD)\s+`([^`]+)`[：:]\s*(.*)$/);
    if (!nodeMatch) {
      if (heading.depth <= 2) { currentPage = null; currentModule = null; }
      continue;
    }
    const [, type, id, nodeTitle] = nodeMatch;
    if (!currentModule || (sharedSection && ['SURFACE', 'ACTION'].includes(type))) throw new Error(`节点 ${id} 缺少标准 MODULE 标题；请从项目来源重新生成视图`);
    const old = oldNodes.get(id);
    const contentBlocks = fieldBlocks(bodyAfter(heading), old?.contentBlocks);
    const value = label => contentBlocks.find(block => block.label === label)?.content || '';
    const status = plain(value('状态')).match(/^(draft|reviewing|confirmed|superseded)\b/)?.[1];
    const sourceKind = plain(value('来源')).match(/^(observed-ui|product-decision|candidate|formal-source|simulation|tbd)\b/)?.[1];
    if (!status || !sourceKind) throw new Error(`节点 ${id} 的状态或来源不明确，已保留旧版`);
    const explicitPage = references(value('页面'))[0];
    const node = { id, type, title: nodeTitle, status, sourceKind, anchorHints: hints(value('页面匹配提示')), contentBlocks };
    if (explicitPage || currentPage) node.pageId = explicitPage || currentPage;
    const prdIds = references(value('关联 PRD'));
    if (prdIds.length) node.prdSectionIds = prdIds;
    const relationIds = references(value('关联'));
    if (relationIds.length) node.relations = relationIds.map(targetId => ({ type: old?.relations?.find(item => item.targetId === targetId)?.type || 'related', targetId }));
    currentModule.nodes.push(node);
  }
  const usableModules = modules.filter(module => module.nodes.length);
  if (!usableModules.length) throw new Error('当前 Markdown 不是可直接读取的标准节点格式；请从项目来源重新生成视图');
  const nodeIds = new Set(usableModules.flatMap(module => module.nodes.map(node => node.id)));
  const warnings = [];
  for (const module of usableModules) for (const node of module.nodes) {
    node.relations = node.relations?.filter(relation => {
      if (nodeIds.has(relation.targetId)) return true;
      warnings.push(`${node.id} 引用了不存在的 ${relation.targetId}（原文已保留）`);
      return false;
    });
    if (node.pageId && !pages.has(node.pageId)) {
      if (oldPages.has(node.pageId)) pages.set(node.pageId, oldPages.get(node.pageId));
      else throw new Error(`节点 ${node.id} 引用的页面 ${node.pageId} 没有明确页面定义`);
    }
  }
  const product = { ...previous.product };
  const version = source.match(/^>\s*版本[：:]\s*(.+)$/m)?.[1] || source.match(/^version:\s*(.+)$/m)?.[1];
  if (version) product.version = plain(version);
  const status = source.match(/^>\s*状态[：:]\s*(\w+)/m)?.[1] || source.match(/^status:\s*(\w+)/m)?.[1];
  if (status) product.status = status;
  const title = headings.find(item => item.depth === 1);
  if (title) product.title = raw(title).replace(/^#\s+/, '');
  const bundle = { schemaVersion: '0.1', product, pages: [...pages.values()], modules: usableModules };
  const errors = [...validateSpecBundle(bundle), ...validateSpecProjectionIntegrity(source, bundle)];
  if (errors.length) throw new Error(`新版 Spec 无法载入：${errors.slice(0, 5).join('；')}`);
  return { bundle, warnings };
}
