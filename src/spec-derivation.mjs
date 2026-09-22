import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, realpath, rm, link } from 'node:fs/promises';
import { resolve, dirname, relative, join, isAbsolute } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { defaultStatePath } from './project-store.mjs';
import { validateSpecBundle } from './contracts.mjs';
import { readMarkdownBundle } from './markdown-spec-reader.mjs';

const MARKER = '<!-- spec-derived: v1 -->';
export const revisionOf = text => createHash('sha256').update(text).digest('hex');
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(x => typeof x === 'string' && x.length);
const unique = (items, name) => { if (new Set(items).size !== items.length) fail(`${name}重复`); };
const allowed = (value, keys, name) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(`${name}含未知字段或不是对象`);
};
const quote = text => text.split('\n').map(line => `> ${line}`).join('\n');
const label = value => typeof value === 'string' && value.trim() && !/[\r\n`<>]/.test(value);
const safeId = value => typeof value === 'string' && /^[A-Z0-9][A-Z0-9._-]*$/.test(value);

function rebaseLinks(raw, sourcePath, sourceText = raw) {
  if (!sourcePath) return raw;
  const destination = original => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(original)) return original;
    const hashAt = original.search(/[?#]/), pathname = hashAt < 0 ? original : original.slice(0, hashAt), suffix = hashAt < 0 ? '' : original.slice(hashAt);
    return original.startsWith('#') ? sourcePath + original : pathname.startsWith('/') ? original : join(dirname(sourcePath), pathname).replaceAll('\\', '/') + suffix;
  };
  const urlText = original => `<${destination(original).replaceAll(' ', '%20').replaceAll('<', '%3C').replaceAll('>', '%3E')}>`;
  const definitions = fromMarkdown(sourceText).children.filter(n => n.type === 'definition');
  const defs = new Map(definitions.map(n => [n.identifier, n]));
  // Resolve document-wide references before combining sources: identical aliases in
  // two Markdown files must not start pointing at the first file's image/link.
  const parseText = raw + '\n\n' + definitions.map(n => sourceText.slice(n.position.start.offset, n.position.end.offset)).join('\n');
  const edits = [];
  const visit = node => {
    if (node.position?.start.offset >= raw.length) return;
    if (['linkReference', 'imageReference'].includes(node.type)) {
      const def = defs.get(node.identifier);
      if (!def) fail(`引用式资源缺少定义：${node.identifier}`);
      let display = raw.slice(node.position.start.offset, node.position.end.offset);
      if (node.referenceType === 'full') display = display.slice(0, display.lastIndexOf('][') + 1);
      if (node.referenceType === 'collapsed') display = display.slice(0, -2);
      const title = def.title ? ' ' + JSON.stringify(def.title) : '';
      edits.push({ start: node.position.start.offset, end: node.position.end.offset, text: `${display}(${urlText(def.url)}${title})` });
      return;
    }
    if (['link', 'image', 'definition'].includes(node.type)) {
      const start = node.position.start.offset, text = raw.slice(start, node.position.end.offset);
      const marker = node.type === 'definition' ? text.indexOf(']:') : text.lastIndexOf('](');
      if (marker < 0) fail('无法无损定位 Markdown 资源地址');
      let a = marker + 2; while (a < text.length && /\s/.test(text[a])) a++;
      let b = a;
      if (text[a] === '<') { b = text.indexOf('>', a) + 1; if (!b) fail('资源地址缺少结束符'); }
      else {
        let depth = 0;
        while (b < text.length) {
          if (text[b] === '\\') { b += 2; continue; }
          if (/\s/.test(text[b]) || (text[b] === ')' && !depth)) break;
          if (text[b] === '(') depth++;
          if (text[b] === ')') depth--;
          b++;
        }
      }
      edits.push({ start: start + a, end: start + b, text: urlText(node.url) });
    }
    for (const child of node.children || []) visit(child);
  };
  visit(fromMarkdown(parseText));
  for (const edit of edits.sort((a, b) => b.start - a.start)) raw = raw.slice(0, edit.start) + edit.text + raw.slice(edit.end);
  return raw;
}

// IDs belong to source headings. Markdown code examples and quoted examples are never bindings.
function sourceDocument(text, kind) {
  const ast = fromMarkdown(text).children;
  const headings = ast.filter(x => x.type === 'heading');
  const sections = new Map();
  const ranges = [];
  const pattern = kind === 'prd' ? /^<!--\s*(?:prd-section-id|spec-source-id):\s*([^\s<>]+)\s*-->$/ : /^<!--\s*architecture-id:\s*([^\s<>]+)\s*-->$/;
  for (const node of ast) {
    if (node.type !== 'html') continue;
    const match = node.value.trim().match(pattern);
    if (!match) continue;
    const heading = headings.filter(h => h.position.end.offset <= node.position.start.offset).at(-1);
    if (!heading || text.slice(heading.position.end.offset, node.position.start.offset).trim()) fail(`${kind} ID 必须紧随标题：${match[1]}`);
    const end = headings.find(h => h.position.start.offset > heading.position.start.offset && h.depth <= heading.depth)?.position.start.offset ?? text.length;
    if (sections.has(match[1])) fail(`${kind}来源 ID 重复：${match[1]}`);
    sections.set(match[1], text.slice(heading.position.start.offset, end).trimEnd());
    ranges.push([heading.position.start.offset, end]);
  }
  const manifests = ast.filter(x => x.type === 'html' && /^<!--\s*spec-view\s*\n/.test(x.value));
  if (kind === 'prd' && manifests.length !== 1) fail('PRD 必须有且仅有一个 spec-view 声明；历史文档须先明确迁移绑定');
  let view;
  if (kind === 'prd') {
    try { view = JSON.parse(manifests[0].value.replace(/^<!--\s*spec-view\s*\n/, '').replace(/-->\s*$/, '')); }
    catch { fail('spec-view 声明不是有效 JSON'); }
  }
  for (const node of ast) {
    const offset = node.position.start.offset;
    if (ranges.some(([start, end]) => offset >= start && node.position.end.offset <= end)) continue;
    if (node.type === 'html' && /^(?:<!--\s*(?:spec-view|prd-profile|prd-section-id|spec-source-id|architecture-id)[:\s])/.test(node.value.trim())) continue;
    if (node.type === 'heading') {
      if (node === headings[0] && node.depth === 1) continue;
      const end = headings.find(h => h.position.start.offset > offset && h.depth <= node.depth)?.position.start.offset ?? text.length;
      // Unmarked headings may group marked descendants, but cannot silently drop a leaf decision.
      if (ranges.some(([start]) => start > offset && start < end)) continue;
      fail(`${kind}存在未标记来源的标题（第 ${node.position.start.line} 行），不能静默省略`);
    }
    fail(`${kind}存在未标记来源的正文（第 ${node.position.start.line} 行），不能静默省略`);
  }
  return { text, revision: revisionOf(text), sections, view };
}

export function compileSpec({ prdText, architectureText, prdPath, architecturePath }) {
  const sources = { prd: sourceDocument(prdText, 'prd'), architecture: sourceDocument(architectureText, 'architecture') };
  const view = sources.prd.view;
  allowed(view, ['version', 'product', 'modules', 'pages', 'nodes', 'context', 'excluded'], 'spec-view');
  if (view.version !== 1 || !Array.isArray(view.modules) || !Array.isArray(view.nodes) || !view.nodes.length) fail('spec-view 版本、模块或节点声明缺失');
  allowed(view.product, ['id', 'title', 'version', 'status'], 'product');
  if (![view.product.id, view.product.title, view.product.version].every(label)) fail('产品身份、标题或版本无效');
  for (const m of view.modules) {
    allowed(m, ['id', 'title'], 'module');
    if (!safeId(m.id) || !label(m.title)) fail('模块 ID 或标题无效');
  }
  unique(view.modules.map(m => m.id), '模块 ID');
  unique(view.nodes.map(n => n.id), '节点 ID');
  const usage = { prd: new Set(), architecture: new Set() };
  const refs = (kind, ids) => {
    if (!strings(ids)) fail(`${kind}引用必须为 ID 数组`);
    unique(ids, `${kind}引用`);
    return ids.map(id => {
      const raw = sources[kind].sections.get(id);
      if (!raw) fail(`${kind}来源不存在：${id}`);
      usage[kind].add(id);
      return { kind, id, raw, revision: revisionOf(raw) };
    });
  };
  const pages = view.pages || [];
  if (!Array.isArray(pages)) fail('pages 必须是数组');
  for (const p of pages) {
    allowed(p, ['id', 'title', 'parentPageId', 'routeHints', 'anchorHints', 'htmlPath'], 'page');
    if (!safeId(p.id) || !label(p.title) || !label(p.htmlPath)) fail('页面须声明稳定身份和实际 HTML 来源；拟定页面不要放入 pages');
  }
  unique(pages.map(p => p.id), '页面 ID');
  const parsedNodes = view.nodes.map(n => {
    allowed(n, ['id', 'type', 'title', 'moduleId', 'pageId', 'status', 'sourceKind', 'prd', 'architecture', 'relations'], 'node');
    if (!safeId(n.id) || !label(n.title) || !view.modules.some(m => m.id === n.moduleId)) fail(`节点身份或模块不明确：${n.id}`);
    if (!Array.isArray(n.prd) || !n.prd.length) fail(`节点缺少 PRD 来源：${n.id}`);
    if (n.pageId && !pages.some(p => p.id === n.pageId)) fail(`节点引用未登记页面：${n.id}`);
    if (!strings(n.relations || [])) fail(`节点关联无效：${n.id}`);
    const bindings = [...refs('prd', n.prd), ...refs('architecture', n.architecture || [])];
    const contentBlocks = bindings.map(b => ({ id: `${b.kind}-${revisionOf(b.id).slice(0, 16)}`, label: `${b.kind === 'prd' ? '产品定义' : '技术设计'} · ${b.id}`, content: quote(rebaseLinks(b.raw, b.kind === 'prd' ? prdPath : architecturePath, sources[b.kind].text)) }));
    return { declaration: n, bindings, node: { id: n.id, type: n.type, title: n.title, status: n.status, sourceKind: n.sourceKind, ...(n.pageId ? { pageId: n.pageId } : {}), prdSectionIds: n.prd.filter(id => id.startsWith('需求-') || id.startsWith('规则-')), anchorHints: [], relations: (n.relations || []).map(targetId => ({ type: 'related', targetId })), contentBlocks } };
  });
  const context = view.context || { prd: [], architecture: [] };
  allowed(context, ['prd', 'architecture'], 'context');
  const shared = [...refs('prd', context.prd || []), ...refs('architecture', context.architecture || [])];
  const excluded = view.excluded || { prd: {}, architecture: {} };
  allowed(excluded, ['prd', 'architecture'], 'excluded');
  for (const kind of ['prd', 'architecture']) {
    if (!object(excluded[kind] || {})) fail('范围外声明须使用 ID 到具体原因的对象');
    for (const [id, reason] of Object.entries(excluded[kind] || {})) {
      if (!sources[kind].sections.has(id) || usage[kind].has(id) || !label(reason)) fail(`无效或矛盾的范围外声明：${id}`);
    }
    for (const id of sources[kind].sections.keys()) if (!usage[kind].has(id) && !excluded[kind]?.[id]) fail(`${kind}来源未纳入也未说明范围外：${id}`);
  }
  const bundle = { schemaVersion: '0.1', product: view.product, pages: pages.map(({ htmlPath, ...p }) => ({ ...p, anchorHints: p.anchorHints || [] })), modules: view.modules.map(m => ({ ...m, purpose: m.title, nodes: parsedNodes.filter(n => n.declaration.moduleId === m.id).map(n => n.node) })) };
  const errors = validateSpecBundle(bundle);
  if (errors.length) fail(`派生结构无效：${errors.join('；')}`);
  for (const n of parsedNodes) for (const id of n.declaration.relations || []) if (!parsedNodes.some(v => v.node.id === id)) fail(`关联目标不存在：${id}`);
  const lines = [`# ${view.product.title}`, '', MARKER, '', `> 版本：${view.product.version}`, '> 状态：draft', `> PRD 来源：${prdPath} · ${sources.prd.revision}`, `> 架构来源：${architecturePath} · ${sources.architecture.revision}`, '', '本文件由明确来源派生；手动修改保留为待同步差异，不代表产品确认。', ''];
  // A derived revision never upgrades product confirmation.
  bundle.product = { ...bundle.product, status: 'draft' };
  if (pages.length) {
    lines.push('## 页面登记', '', '| 页面 ID | 职责 | 路由 |', '|---|---|---|');
    for (const p of pages) lines.push(`| ${p.id} | ${p.title.replaceAll('|', '\\|')} | ${(p.routeHints || []).join('；').replaceAll('|', '\\|')} |`);
    lines.push('');
  }
  for (const m of view.modules) {
    lines.push(`## MODULE \`${m.id}\`：${m.title}`, '');
    for (const { node: n } of parsedNodes.filter(n => n.declaration.moduleId === m.id)) {
      lines.push(`#### ${n.type} \`${n.id}\`：${n.title}`, '', `- 状态：\`${n.status}\``, `- 来源：\`${n.sourceKind}\``, `- 关联 PRD：${n.prdSectionIds.map(id => `\`${id}\``).join('、')}`);
      if (n.pageId) lines.push(`- 页面：\`${n.pageId}\``);
      if (n.relations.length) lines.push(`- 关联：${n.relations.map(r => `\`${r.targetId}\``).join('、')}`);
      lines.push('');
      for (const b of n.contentBlocks) lines.push(`##### ${b.label}`, '', b.content, '');
    }
  }
  if (shared.length) {
    lines.push('## 共同来源', '');
    for (const b of shared) lines.push(`### ${b.kind} · ${b.id}`, '', quote(rebaseLinks(b.raw, b.kind === 'prd' ? prdPath : architecturePath, sources[b.kind].text)), '');
  }
  const omitted = ['prd', 'architecture'].flatMap(kind => Object.entries(excluded[kind] || {}).map(([id, reason]) => `- ${kind} ${id}：${reason}`));
  if (omitted.length) lines.push('## 本批范围外', '', ...omitted, '');
  const text = lines.join('\n');
  const read = readMarkdownBundle(text, bundle);
  return { text, bundle: read.bundle, pages, sourceBlocks: { prd: { ...Object.fromEntries([...sources.prd.sections].map(([id, raw]) => [id, revisionOf(raw)])), '$view': revisionOf(JSON.stringify(view)) }, architecture: Object.fromEntries([...sources.architecture.sections].map(([id, raw]) => [id, revisionOf(raw)])) }, sourceRevisions: { prd: sources.prd.revision, architecture: sources.architecture.revision }, bindings: Object.fromEntries(parsedNodes.map(n => [n.node.id, n.bindings.map(({ raw, ...b }) => b)])), excluded };
}

function parts(text) {
  const heads = fromMarkdown(text).children.filter(x => x.type === 'heading');
  const result = new Map();
  let frame = ''; let cursor = 0;
  for (const h of heads) {
    const title = text.slice(h.position.start.offset, h.position.end.offset);
    const match = title.match(/^#{3,6}\s+(?:ACTION|SURFACE|RULE|STATE|EVENT|PERMISSION|EXTERNAL|AC|TBD)\s+`([^`]+)`/);
    if (!match) continue;
    if (result.has(match[1])) fail(`手改 Spec 含重复节点：${match[1]}`);
    const end = heads.find(x => x.position.start.offset > h.position.start.offset && x.depth <= h.depth)?.position.start.offset ?? text.length;
    result.set(match[1], text.slice(h.position.start.offset, end));
    frame += text.slice(cursor, h.position.start.offset) + `<!-- node-position:${match[1]} -->\n`;
    cursor = end;
  }
  result.set('$document', frame + text.slice(cursor));
  return result;
}
export function diffDerivedSpec(baseline, edited) {
  const before = parts(baseline.text), after = parts(edited);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(nodeId => {
    const left = before.get(nodeId) ?? null, right = after.get(nodeId) ?? null;
    if (left === right) return [];
    return [{ changeId: revisionOf(JSON.stringify([nodeId, left, right])), nodeId, before: left, after: right, sources: baseline.bindings[nodeId] || [] }];
  });
}
async function optionalText(path) { try { return await readFile(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function atomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, text); await rename(temp, path); } finally { await rm(temp, { force: true }); }
}
async function inside(root, input, mayCreate = false) {
  const path = resolve(root, input || '');
  let canonical;
  try { canonical = await realpath(path); }
  catch (e) {
    if (!mayCreate || e.code !== 'ENOENT') throw e;
    let ancestor = dirname(path);
    while (true) {
      try { canonical = resolve(await realpath(ancestor), relative(ancestor, path)); break; }
      catch (error) { if (error.code !== 'ENOENT' || ancestor === dirname(ancestor)) throw error; ancestor = dirname(ancestor); }
    }
  }
  const rel = relative(root, canonical);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('来源和 Spec 必须位于当前 Project 内');
  return canonical;
}
async function context({ projectPath, specPath, statePath }) {
  if (!projectPath || !specPath) fail('缺少 --project 或 --spec/--output');
  const root = await realpath(resolve(projectPath));
  const path = await inside(root, specPath, true);
  if (!/\.md$/i.test(path)) fail('Spec 必须是 Markdown 文件');
  return { root, path, cache: join(dirname(statePath || defaultStatePath()), 'spec-derivations', `${revisionOf(path)}.json`) };
}
async function loadState(ctx) {
  const raw = await optionalText(ctx.cache);
  if (raw === null) return null;
  const state = JSON.parse(raw);
  if (state.version !== 1 || state.specPath !== ctx.path || state.projectPath !== ctx.root || !state.baseline?.text || !object(state.baseline.bindings)) fail('派生基线无效，保留当前 Spec');
  return state;
}
async function locked(ctx, action) {
  await mkdir(dirname(ctx.cache), { recursive: true });
  const lock = `${ctx.cache}.lock`;
  try { await mkdir(lock); } catch (e) { if (e.code === 'EEXIST') fail('另一个派生操作尚未结束；保留当前文件，检查运行任务或遗留锁'); throw e; }
  try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
}
async function recover(ctx, state) {
  if (!state?.publication) return state;
  let current = await optionalText(ctx.path);
  if (current === null && state.publication.expectedRevision !== null && state.publication.previousPath) {
    const displaced = await optionalText(state.publication.previousPath);
    if (displaced !== null && revisionOf(displaced) === state.publication.expectedRevision) {
      try { await link(state.publication.previousPath, ctx.path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      current = await optionalText(ctx.path);
      state.previous = { path: state.publication.previousPath, revision: revisionOf(displaced) };
    }
  }
  if (current === state.publication.next.text) {
    if (state.publication.previousPath) {
      const displaced = await optionalText(state.publication.previousPath);
      if (displaced !== null) {
        if (revisionOf(displaced) !== state.publication.expectedRevision) fail('恢复副本含额外外部修改，保留后人工合并');
        state.previous = { path: state.publication.previousPath, revision: revisionOf(displaced) };
      }
    }
    state.baseline = state.publication.next;
  }
  else if ((current === null ? null : revisionOf(current)) !== state.publication.expectedRevision) fail('上次派生写入中断且 Spec 又有变化；保留基线和文件，请先恢复该批写入');
  if (state.publication.previousPath && !state.previous) {
    const displaced = await optionalText(state.publication.previousPath);
    if (displaced !== null && revisionOf(displaced) === state.publication.expectedRevision) state.previous = { path: state.publication.previousPath, revision: revisionOf(displaced) };
  }
  delete state.publication;
  await atomic(ctx.cache, JSON.stringify(state));
  return state;
}
export async function inspectSpecEdits(options) {
  const ctx = await context(options);
  return locked(ctx, async () => {
    const state = await recover(ctx, await loadState(ctx));
    const current = await optionalText(ctx.path);
    if (!state) return { managed: false, pending: false, reason: '没有派生基线；现有 Spec 保持原编辑流程，不能推断改动或直接覆盖' };
    if (current === null) fail('Spec 已在外部删除，保留基线；不得自动重新创建');
    const changes = diffDerivedSpec(state.baseline, current);
    const sourceRevisions = {};
    for (const kind of ['prd', 'architecture']) sourceRevisions[kind] = revisionOf(await readFile(state.sources[kind], 'utf8'));
    const report = { managed: true, sourceChanged: ['prd', 'architecture'].some(kind => sourceRevisions[kind] !== state.baseline.sourceRevisions[kind]), pending: Boolean(changes.length), specPath: ctx.path, specRevision: revisionOf(current), baselineRevision: revisionOf(state.baseline.text), sources: state.sources, baselineSourceRevisions: state.baseline.sourceRevisions, sourceRevisions, changes };
    state.pending = report; // One current batch, not an ever-growing history or a second product document.
    await atomic(ctx.cache, JSON.stringify(state));
    return report;
  });
}
export async function deriveSpec(options) {
  const ctx = await context({ ...options, specPath: options.specPath || options.outputPath });
  return locked(ctx, async () => {
    const state = await recover(ctx, await loadState(ctx));
    const current = await optionalText(ctx.path);
    if (!state && current !== null) fail('目标已有文件且没有派生基线；先明确迁移到新输出，禁止覆盖历史或手改 Spec');
    if (state && current === null) fail('Spec 已在外部删除，保留基线；不得自动重新创建');
    const paths = {};
    for (const kind of ['prd', 'architecture']) {
      paths[kind] = await inside(ctx.root, options[`${kind}Path`] || state?.sources[kind]);
      if (!/\.md$/i.test(paths[kind]) || paths[kind] === ctx.path) fail('PRD、架构和 Spec 必须是独立 Markdown 来源');
    }
    if (paths.prd === paths.architecture) fail('PRD 和架构不能使用同一文件');
    if (state && JSON.stringify(paths) !== JSON.stringify(state.sources)) fail('来源身份变化，需明确迁移，不能沿旧基线自动替换');
    const prdText = await readFile(paths.prd, 'utf8'), architectureText = await readFile(paths.architecture, 'utf8');
    const compiled = compileSpec({ prdText, architectureText, prdPath: relative(dirname(ctx.path), paths.prd), architecturePath: relative(dirname(ctx.path), paths.architecture) });
    for (const page of compiled.pages) {
      const html = await inside(ctx.root, page.htmlPath);
      if (!/\.html?$/i.test(html)) fail('登记页面须提供本 Project 实际 HTML 入口');
    }
    const changes = state ? diffDerivedSpec(state.baseline, current) : [];
    if (options.preview) return { preview: true, candidateRevision: revisionOf(compiled.text), text: compiled.text, bundle: compiled.bundle, sourceRevisions: compiled.sourceRevisions, changes };
    if (changes.length) {
      if (!options.receipt) fail('Spec 有待同步手改；先运行 spec-changes，修订对应来源并提供逐项同步回执，当前文件未覆盖');
      const receipt = options.receipt;
      if (receipt.candidateRevision !== revisionOf(compiled.text)) fail('回执未绑定当前已核对的派生候选');
      if (receipt.specRevision !== revisionOf(current) || ['prd', 'architecture'].some(k => receipt.sourceRevisions?.[k] !== compiled.sourceRevisions[k])) fail('同步回执版本已过期，保留后续修改');
      if (!Array.isArray(receipt.resolutions)) fail('同步回执缺少逐项结果');
      unique(receipt.resolutions.map(r => r.changeId), '同步回执');
      if (receipt.resolutions.length !== changes.length) fail('同步回执没有覆盖当前全部改动');
      for (const change of changes) {
        const r = receipt.resolutions.find(r => r.changeId === change.changeId);
        if (!r || !Array.isArray(r.updatedSources) || !r.updatedSources.length || !label(r.reason)) fail('每项改动须给出已修订来源及承接依据');
        for (const ref of r.updatedSources) {
          const { kind, id } = ref || {};
          if (!['prd', 'architecture'].includes(kind) || !id) fail('回执必须指定具体来源 kind/id');
          const before = state.baseline.sourceBlocks?.[kind]?.[id], after = compiled.sourceBlocks[kind]?.[id];
          if ((!before && !after) || before === after) fail('回执声称的来源块没有更新');
          if (change.nodeId !== '$document' && change.sources.length && !change.sources.some(b => b.kind === kind && b.id === id) && !(kind === 'prd' && id === '$view')) fail('回执来源与本项修改没有原始关联');
        }
      }
    } else if (options.receipt) fail('当前没有待同步改动，不接受无对应批次的回执');
    // Recheck all inputs immediately before the write. No source document or Map is written here.
    if (await optionalText(ctx.path) !== current || await readFile(paths.prd, 'utf8') !== prdText || await readFile(paths.architecture, 'utf8') !== architectureText) fail('文件在派生期间发生变化，未覆盖');
    const next = { text: compiled.text, sourceRevisions: compiled.sourceRevisions, bindings: compiled.bindings, sourceBlocks: compiled.sourceBlocks };
    const nextState = state || { version: 1, projectPath: ctx.root, specPath: ctx.path, sources: paths, baseline: next };
    const previousPath = `${ctx.path}.derivation-previous`;
    if (nextState.previous) {
      const previous = await optionalText(previousPath);
      if (previous !== null && revisionOf(previous) !== nextState.previous.revision) fail('上次替换的文件出现后续外部写入，已保留恢复副本');
      await rm(previousPath, { force: true });
      delete nextState.previous;
    } else if (await optionalText(previousPath) !== null) fail('存在未归属的恢复副本，不能覆盖');
    nextState.publication = { expectedRevision: current === null ? null : revisionOf(current), next, previousPath };
    await atomic(ctx.cache, JSON.stringify(nextState));
    await mkdir(dirname(ctx.path), { recursive: true });
    if (await inside(ctx.root, ctx.path, true) !== ctx.path) fail('输出目录身份发生变化，停止写入');
    const candidatePath = `${ctx.path}.${randomUUID()}.candidate`;
    try {
      await writeFile(candidatePath, compiled.text, { flag: 'wx' });
      if (await readFile(paths.prd, 'utf8') !== prdText || await readFile(paths.architecture, 'utf8') !== architectureText) fail('来源在提交期间变化，Spec 未覆盖');
      if (current !== null) {
        await rename(ctx.path, previousPath); // Capture the actual displaced file, including a late external atomic save.
        const displaced = await readFile(previousPath, 'utf8');
        if (displaced !== current) {
          try { await link(previousPath, ctx.path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
          fail(`提交时发现外部保存，修改已保留于 ${previousPath}`);
        }
      }
      try { await link(candidatePath, ctx.path); } catch (error) {
        if (error.code === 'EEXIST') fail(`提交期间出现外部文件，未覆盖；原文件保留于 ${previousPath}`);
        throw error;
      }
      if (await readFile(ctx.path, 'utf8') !== compiled.text || (current !== null && await readFile(previousPath, 'utf8') !== current)) fail('发布期间发生外部写入，当前文件和恢复副本均保留');
      nextState.baseline = next;
      if (current !== null) nextState.previous = { path: previousPath, revision: revisionOf(current) };
      delete nextState.publication; delete nextState.pending;
      await atomic(ctx.cache, JSON.stringify(nextState));
    } catch (error) {
      // A failed install must not leave the current document missing. Exclusive
      // restore preserves any newer external save and the publication journal.
      if (current !== null && await optionalText(ctx.path) === null) {
        try { await link(previousPath, ctx.path); } catch (restoreError) { if (restoreError.code !== 'EEXIST') error.message += `；恢复失败：${restoreError.message}`; }
      }
      throw error;
    } finally { await rm(candidatePath, { force: true }); }
    const sourceChanged = await readFile(paths.prd, 'utf8') !== prdText || await readFile(paths.architecture, 'utf8') !== architectureText;
    return { derived: true, sourceChanged, needsRefresh: sourceChanged, specPath: ctx.path, specRevision: revisionOf(compiled.text), sourceRevisions: compiled.sourceRevisions, synchronizedChanges: changes.length, productConfirmed: false };
  });
}
