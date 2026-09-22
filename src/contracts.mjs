import {
  validateProductSpecStructure,
  validatePrdMapStructure,
  validateSpecMapStructure,
} from './schema-validation.mjs';

export const SPEC_NODE_TYPES = new Set([
  'SURFACE',
  'ACTION',
  'RULE',
  'STATE',
  'EVENT',
  'PERMISSION',
  'EXTERNAL',
  'AC',
  'TBD',
]);

export const MAPPABLE_NODE_TYPES = new Set(['SURFACE', 'ACTION']);
export const MAP_STATUSES = new Set(['confirmed', 'invalid', 'ambiguous', 'drifted', 'out-of-context']);

const LEGACY_FIELD_LABELS = {
  userGoal: '用户目标',
  preconditions: '前置条件',
  trigger: '触发',
  frontendBehavior: '前端行为',
  backendOutcome: '后端结果',
  stateChange: '状态变化',
  success: '成功结果',
  failure: '异常与失败',
  permissions: '权限',
  audit: '审计',
  acceptance: '验收条件',
};

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const flattenSpecNodes = bundle => (bundle.modules || []).flatMap(module =>
  (module.nodes || []).map(node => ({
    ...node,
    moduleId: module.id,
    moduleTitle: module.title,
    pageTitle: (
      (bundle.pages || []).find(page => page.id === node.pageId)
      || (module.pages || []).find(page => page.id === node.pageId)
    )?.title,
  })),
);

const contentBlocksForNode = node => {
  if (Array.isArray(node.contentBlocks)) return node.contentBlocks;
  return Object.entries(node.fields || {}).flatMap(([key, value], index) => {
    if (value == null) return [];
    return [{
      id: `legacy-${index + 1}`,
      label: LEGACY_FIELD_LABELS[key] || key,
      content: Array.isArray(value) ? value.join('\n') : value,
    }];
  });
};

const reviewableNode = node => ({
  title: node.title,
  status: node.status,
  sourceKind: node.sourceKind,
  statement: node.statement || '',
  anchorHints: node.anchorHints || [],
  contentBlocks: contentBlocksForNode(node),
});

export function diffSpecBundles(baseBundle, draftBundle) {
  const baseNodes = new Map(flattenSpecNodes(baseBundle).map(node => [node.id, node]));
  const draftNodes = new Map(flattenSpecNodes(draftBundle).map(node => [node.id, node]));
  const nodeIds = new Set([...baseNodes.keys(), ...draftNodes.keys()]);
  const changes = [];

  for (const nodeId of nodeIds) {
    const beforeNode = baseNodes.get(nodeId);
    const afterNode = draftNodes.get(nodeId);
    const before = beforeNode ? reviewableNode(beforeNode) : null;
    const after = afterNode ? reviewableNode(afterNode) : null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({
      nodeId,
      moduleId: afterNode?.moduleId || beforeNode?.moduleId || '',
      moduleTitle: afterNode?.moduleTitle || beforeNode?.moduleTitle || '',
      operation: beforeNode && afterNode ? 'update' : afterNode ? 'add' : 'remove',
      before,
      after,
    });
  }
  return changes;
}

export function validateSpecBundle(bundle) {
  const errors = validateProductSpecStructure(bundle);
  if (!isObject(bundle)) return errors;
  const moduleIds = new Set();
  const pageIds = new Set();
  const pages = [];
  const nodeIds = new Set();
  const hasGlobalPages = Array.isArray(bundle.pages);
  const validatePage = (page, pagePath) => {
    if (pageIds.has(page?.id)) errors.push(`页面 ID 重复：${page?.id}`);
    pageIds.add(page?.id);
    pages.push({ page, path: pagePath });
    if (Array.isArray(page?.anchorHints) && page.anchorHints.some(hint => typeof hint !== 'string' || !hint.trim())) {
      errors.push(`${pagePath}.anchorHints 只能包含非空字符串`);
    }
    if (Array.isArray(page?.routeHints) && page.routeHints.some(hint => typeof hint !== 'string' || !hint.trim())) {
      errors.push(`${pagePath}.routeHints 只能是非空字符串数组`);
    }
  };
  for (const [pageIndex, page] of (bundle.pages || []).entries()) {
    validatePage(page, `pages[${pageIndex}]`);
  }
  for (const [moduleIndex, module] of (bundle.modules || []).entries()) {
    const modulePath = `modules[${moduleIndex}]`;
    if (moduleIds.has(module?.id)) errors.push(`模块 ID 重复：${module?.id}`);
    moduleIds.add(module?.id);
    const modulePageIds = new Set();
    if (Array.isArray(module?.pages)) {
      if (hasGlobalPages) {
        errors.push(`${modulePath}.pages 不能与顶层 pages 同时使用`);
      }
      for (const [pageIndex, page] of module.pages.entries()) {
        const pagePath = `${modulePath}.pages[${pageIndex}]`;
        validatePage(page, pagePath);
        modulePageIds.add(page?.id);
      }
    }
    for (const [nodeIndex, node] of (module?.nodes || []).entries()) {
      const nodePath = `${modulePath}.nodes[${nodeIndex}]`;
      if (node?.pageId !== undefined) {
        const validPageIds = hasGlobalPages ? pageIds : modulePageIds;
        if (node.pageId && !validPageIds.has(node.pageId)) {
          errors.push(hasGlobalPages
            ? `${nodePath}.pageId 未引用顶层页面：${node.pageId}`
            : `${nodePath}.pageId 未引用当前模块中的页面：${node.pageId}`);
        }
      }
      if (nodeIds.has(node?.id)) errors.push(`Spec 节点 ID 重复：${node?.id}`);
      nodeIds.add(node?.id);
      if (node.contentBlocks !== undefined && node.fields !== undefined) {
        errors.push(`${nodePath} 不能同时使用 contentBlocks 和旧版 fields`);
      }
      if (Array.isArray(node.contentBlocks)) {
        const blockIds = new Set();
        for (const [blockIndex, block] of node.contentBlocks.entries()) {
          const blockPath = `${nodePath}.contentBlocks[${blockIndex}]`;
          if (!isObject(block)) continue;
          if (blockIds.has(block.id)) errors.push(`${node.id} 内容块 ID 重复：${block.id}`);
          blockIds.add(block.id);
          if (typeof block.label !== 'string' || !block.label.trim()) {
            errors.push(`${blockPath}.label 必须是非空字符串`);
          }
          if (typeof block.content !== 'string' || !block.content.trim()) {
            errors.push(`${blockPath}.content 必须是非空字符串`);
          }
        }
      }
      if (Array.isArray(node.prdSectionIds)) {
        for (const prdSectionId of node.prdSectionIds) {
          if (!/^(需求|规则)-(?=.*\p{Script=Han})[^\s<>]+(?:-[^\s<>]+)*$/u.test(prdSectionId)) {
            errors.push(`${nodePath}.prdSectionIds 必须使用包含中文语义的“需求-”或“规则-”ID：${prdSectionId}`);
          }
        }
      }
    }
  }
  const pageById = new Map(pages.map(({ page }) => [page?.id, page]));
  for (const { page, path } of pages) {
    if (!page?.parentPageId) continue;
    if (page.parentPageId === page.id) {
      errors.push(`${path}.parentPageId 不能引用页面自身：${page.id}`);
    } else if (!pageById.has(page.parentPageId)) {
      errors.push(`${path}.parentPageId 引用了不存在的页面：${page.parentPageId}`);
    }
  }
  for (const { page, path } of pages) {
    const visited = new Set([page?.id]);
    let cursor = pageById.get(page?.parentPageId);
    while (cursor) {
      if (visited.has(cursor.id)) {
        errors.push(`${path}.parentPageId 形成页面导航循环：${page?.id}`);
        break;
      }
      visited.add(cursor.id);
      cursor = pageById.get(cursor.parentPageId);
    }
  }
  for (const node of flattenSpecNodes(bundle)) {
    for (const relation of node.relations || []) {
      if (relation?.targetId && !nodeIds.has(relation.targetId)) {
        errors.push(`${node.id} 关联了不存在的节点：${relation.targetId}`);
      }
    }
  }
  return errors;
}

export function createEmptySpecMap(productSpecId, targetSource) {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `urn:interactive-product-spec:map:${productSpecId}`,
    type: 'AnnotationCollection',
    schemaVersion: '0.1',
    productSpecId,
    targetSource,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

export function validateSpecMap(map, bundle, { allowMissingNodes = false } = {}) {
  const errors = validateSpecMapStructure(map);
  if (!isObject(map)) return errors;
  if (map.productSpecId && bundle?.product?.id && map.productSpecId !== bundle.product.id) {
    errors.push(`productSpecId 与 Spec bundle 不一致：${map.productSpecId}`);
  }
  const specNodes = flattenSpecNodes(bundle);
  const nodeIds = new Set(specNodes.map(node => node.id));
  const nodeById = new Map(specNodes.map(node => [node.id, node]));
  const annotationIds = new Set();
  const mappedNodeIds = new Set();
  for (const annotation of (map.items || [])) {
    if (annotationIds.has(annotation?.id)) errors.push(`映射 ID 重复：${annotation?.id}`);
    annotationIds.add(annotation?.id);
    if (mappedNodeIds.has(annotation?.body?.id)) errors.push(`Spec 节点被重复映射：${annotation?.body?.id}`);
    mappedNodeIds.add(annotation?.body?.id);
    if (!allowMissingNodes && annotation?.body?.id && !nodeIds.has(annotation.body.id)) {
      errors.push(`映射指向不存在的 Spec 节点：${annotation.body.id}`);
    }
    if (annotation?.body?.id && nodeById.has(annotation.body.id) && !MAPPABLE_NODE_TYPES.has(nodeById.get(annotation.body.id).type)) {
      errors.push(`不能把 ${nodeById.get(annotation.body.id).type} 节点直接映射到 DOM：${annotation.body.id}`);
    }
  }
  return errors;
}

export function createEmptyPrdMap({ productId, prdPath, prdRevision, targetSource }) {
  return {
    schemaVersion: '0.1',
    productId,
    prd: {
      path: prdPath,
      revision: prdRevision,
      profileVersion: '可映射PRD-v1',
    },
    targetSource,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

export function validatePrdMap(map, prdDocument, {
  allowMissingSections = false,
  allowProductMismatch = false,
} = {}) {
  const errors = validatePrdMapStructure(map);
  if (!isObject(map)) return errors;
  if (!allowProductMismatch && prdDocument?.productId && map.productId !== prdDocument.productId) {
    errors.push(`productId 与 PRD 不一致：${map.productId}`);
  }
  const sectionIds = new Set((prdDocument?.sections || []).map(section => section.id));
  const itemIds = new Set();
  const pageContexts = new Set();
  for (const item of map.items || []) {
    if (itemIds.has(item?.id)) errors.push(`PRD 页面映射 ID 重复：${item?.id}`);
    itemIds.add(item?.id);
    const context = item?.page?.context?.url;
    if (context && pageContexts.has(context)) errors.push(`同一页面上下文被重复映射：${context}`);
    if (context) pageContexts.add(context);
    for (const sectionId of item?.sectionIds || []) {
      if (!allowMissingSections && !sectionIds.has(sectionId)) {
        errors.push(`PRD 页面映射引用了不存在的章节：${sectionId}`);
      }
    }
  }
  return [...new Set(errors)];
}
