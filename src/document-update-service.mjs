import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { diffSpecBundles, flattenSpecNodes } from './contracts.mjs';
import { readPrdDocument } from './prd-service.mjs';
import { loadPrdImages, prdImageDefinitions } from './prd-images.mjs';
import { readPrdMap } from './prd-map-store.mjs';
import { readSpecMap } from './map-store.mjs';
import { readMarkdownBundle } from './markdown-spec-reader.mjs';
import { readSpecSource } from './spec-service.mjs';

const hash = source => createHash('sha256').update(source).digest('hex');
const fail = message => Object.assign(new Error(message), { status: 409 });
export const documentBaseline = active => `${active.sessionId}:${active.prdDocument?.revision || ''}:${active.sourceSpecRevision || ''}:${active.specRevision}:${active.mapRevision || ''}:${active.prdMapRevision || ''}`;
const paths = active => ({ prd: active.prdDocument?.path, spec: active.sourceSpecPath || active.specPath });
const sources = async active => Object.fromEntries(await Promise.all(Object.entries(paths(active)).filter(([, path]) => path).map(async ([kind, path]) => [kind, await readFile(path, 'utf8')])));
const revisions = texts => JSON.stringify(Object.fromEntries(Object.entries(texts).map(([kind, text]) => [kind, hash(text)])));

export async function checkDocumentUpdates(active) {
  if (active.prdReview) return { changed: false, documents: [], supported: false };
  try {
    const text = await sources(active);
    const documents = [];
    if (text.prd && hash(text.prd) !== active.prdDocument.revision) documents.push('PRD');
    if (text.spec) {
      const revision = hash(text.spec);
      let different = revision !== (active.sourceSpecPath ? active.sourceSpecRevision : active.specRevision);
      // 启动时 Markdown 的摘要不能证明旧 JSON 已承接正文；核对一次后缓存结果。
      if (active.sourceSpecPath && !different && !active.gate) {
        if (active.documentCheck?.revision !== revision || active.documentCheck?.specRevision !== active.specRevision) {
          const { bundle } = readMarkdownBundle(text.spec, active.bundle);
          active.documentCheck = { revision, specRevision: active.specRevision, different: JSON.stringify(bundle) !== JSON.stringify(active.bundle) };
        }
        different = active.documentCheck.different;
      }
      if (different) documents.push('Spec');
    }
    return { changed: Boolean(documents.length), documents, supported: true, baseline: documentBaseline(active) };
  } catch (error) {
    return { changed: true, documents: [], supported: true, error: `无法检查本地文档，当前仍为已载入版本：${error.message}`, baseline: documentBaseline(active) };
  }
}

export async function reloadDocuments(active, baseline, isCurrent = () => true) {
  if (active.prdReview) throw fail('PRD 批注会话请使用已有的发布或重新读取入口');
  if (baseline !== documentBaseline(active)) throw fail('工作台版本已变化，请重试加载新版');
  if (active.gate && diffSpecBundles(active.baseBundle, active.bundle).length) throw fail('当前有未提交的 Spec 修订草稿，请先处理后再加载新版');
  if (active.documentLoading) throw fail('文档正在加载，请稍候');
  active.documentLoading = true;
  try {
    const before = await sources(active);
    const next = { ...active };
    const warnings = [];
    if (before.spec) {
      if (active.sourceSpecPath) {
        const result = readMarkdownBundle(before.spec, active.bundle);
        next.bundle = result.bundle;
        warnings.push(...result.warnings);
        next.sourceSpecRevision = hash(before.spec);
        next.specDocument = { source: before.spec, revision: next.sourceSpecRevision, images: await loadPrdImages({ source: before.spec, path: active.sourceSpecPath }, active.projectPath) };
        next.specRevision = hash(JSON.stringify(next.bundle));
      } else {
        const result = await readSpecSource(active.specPath);
        next.bundle = result.bundle;
        next.specRevision = result.revision;
      }
      next.baseBundle = structuredClone(next.bundle);
    }
    if (before.prd) {
      const { document } = await readPrdDocument(active.prdDocument.path);
      next.prdDocument = { ...document, images: await loadPrdImages(document, active.projectPath), imageDefinitions: prdImageDefinitions(document.source) };
      if (!active.specPath) next.bundle = { ...active.bundle, product: { ...active.bundle.product, title: document.title, version: document.version } };
      if (active.prdMapPath) {
        await readFile(active.prdMapPath);
        const loaded = await readPrdMap({ mapPath: active.prdMapPath, prdDocument: document, targetSource: active.target.type === 'dev' ? active.target.url : active.target.htmlPath, createOnDisk: false });
        Object.assign(next, { prdMap: loaded.map, prdMapRevision: loaded.revision, prdMapStale: loaded.stale, missingPrdSectionIds: loaded.missingSectionIds });
      }
    }
    if (active.mapPath) {
      await readFile(active.mapPath);
      const loaded = await readSpecMap({ mapPath: active.mapPath, bundle: next.bundle, targetSource: active.target.type === 'dev' ? active.target.url : active.target.htmlPath, createOnDisk: false });
      next.map = loaded.map;
      next.mapRevision = loaded.revision;
      const ids = new Set(flattenSpecNodes(next.bundle).map(node => node.id));
      const missing = next.map.items.filter(item => !ids.has(item.body.id));
      if (missing.length) warnings.push(`${missing.length} 条映射的节点已删除；原映射保留，请核对`);
    }
    if (revisions(before) !== revisions(await sources(active))) throw fail('读取期间文档再次变化，请重试；当前仍为旧版');
    if (!isCurrent() || baseline !== documentBaseline(active)) throw fail('当前项目或工作台版本已变化，请重试');
    next.documentCheck = { revision: next.sourceSpecRevision, specRevision: next.specRevision, different: false };
    Object.assign(active, next);
    return { warnings };
  } finally {
    active.documentLoading = false;
  }
}
