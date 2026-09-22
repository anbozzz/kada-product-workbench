import type {
  CandidateTarget,
  DisplayMapStatus,
  ElementFingerprint,
  FlatSpecNode,
  MappingIssue,
  PageMatch,
  ProductSpecBundle,
  SpecAnnotation,
  SpecContentBlock,
  SpecMap,
  SpecModule,
  SpecNode,
  SpecPage,
} from "@/types"

export const MAPPABLE_TYPES = new Set(["SURFACE", "ACTION"])

const LEGACY_FIELD_LABELS: Record<string, string> = {
  userGoal: "用户目标",
  preconditions: "前置条件",
  trigger: "触发",
  frontendBehavior: "前端行为",
  backendOutcome: "后端结果",
  stateChange: "状态变化",
  success: "成功结果",
  failure: "异常与失败",
  permissions: "权限",
  audit: "审计",
  acceptance: "验收条件",
}

const legacyFieldContent = (value: string | string[]) =>
  Array.isArray(value) ? value.join("\n") : value

export const contentBlocksForNode = (
  node: Pick<SpecNode, "contentBlocks" | "fields">,
): SpecContentBlock[] => {
  if (Array.isArray(node.contentBlocks)) {
    return node.contentBlocks.map((block) => ({ ...block }))
  }
  return Object.entries(node.fields ?? {}).flatMap(([key, value], index) => {
    if (value == null) return []
    return [{
      id: `legacy-${index + 1}`,
      label: LEGACY_FIELD_LABELS[key] ?? key,
      content: legacyFieldContent(value),
    }]
  })
}

const SUMMARY_LABELS = [
  "产品结果", "规则", "定义", "依赖结果", "App 行为", "前端行为", "后端结果", "成功结果", "验收条件",
]
const SUMMARY_METADATA = new Set([
  "状态", "来源", "关联 PRD", "关联PRD", "关联页面", "页面", "页面匹配提示", "匹配提示", "直接关联", "关联",
])
const comparableSummary = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "")

export const summarizeNode = (node: SpecNode) => {
  const isUseful = (text: string) => Boolean(text.trim()) && comparableSummary(text) !== comparableSummary(node.title)
  const blocks = contentBlocksForNode(node).filter((block) => !SUMMARY_METADATA.has(block.label.trim()) && isUseful(block.content))
  const preferred = SUMMARY_LABELS.flatMap((label) => blocks.filter((block) => block.label.trim() === label))[0]
  return (node.statement && isUseful(node.statement) ? node.statement : "") || preferred?.content || blocks[0]?.content || ""
}

export const searchableNodeText = (node: SpecNode) =>
  [
    node.title,
    node.id,
    node.statement,
    ...contentBlocksForNode(node).flatMap((block) => [block.label, block.content]),
  ]
    .filter(Boolean)
    .join(" ")

export const STATUS_LABELS: Record<DisplayMapStatus, string> = {
  confirmed: "已关联",
  invalid: "关联目标不兼容",
  ambiguous: "关联定位不唯一",
  drifted: "关联内容已变化",
  "out-of-context": "已关联 · 需手动进入",
  unmapped: "待映射",
}

export const TYPE_LABELS: Record<string, string> = {
  SURFACE: "页面区域",
  ACTION: "用户操作",
  RULE: "产品规则",
  STATE: "状态",
  EVENT: "事件",
  PERMISSION: "权限",
  EXTERNAL: "外部依赖",
  AC: "验收条件",
  TBD: "待确认",
}

export const INTERACTIVE_ROLES = [
  "button",
  "link",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "combobox",
  "listbox",
  "searchbox",
  "textbox",
  "slider",
  "spinbutton",
  "scrollbar",
  "treeitem",
  "gridcell",
] as const

export const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "area[href]",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "summary",
  "label",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false" i])',
  '[tabindex]:not([tabindex^="-"])',
  '[draggable="true"]',
  "[aria-controls]",
  "[aria-expanded]",
  "[aria-haspopup]",
  "[aria-pressed]",
  "[aria-checked]",
  ...INTERACTIVE_ROLES.map((role) => `[role~="${role}"]`),
  "[onclick]",
].join(", ")

export const EXPLICIT_SURFACE_SELECTOR = [
  "[data-spec-anchor]",
  "[data-spec-id]",
  "[data-testid]",
  '[role="region"]',
  '[role="group"]',
  '[role="dialog"]',
  '[role="tabpanel"]',
  '[role="list"]',
  '[role="table"]',
  '[role="main"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="form"]',
  '[role="search"]',
].join(", ")

const SEMANTIC_SURFACE_SELECTOR = [
  "form",
  "main",
  "section",
  "article",
  "nav",
  "aside",
].join(", ")

export const SURFACE_SELECTOR = [
  EXPLICIT_SURFACE_SELECTOR,
  SEMANTIC_SURFACE_SELECTOR,
].join(", ")

export const normalize = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()

export const truncate = (value: unknown, length = 90) =>
  normalize(value).slice(0, length)

const ACTION_INTENT_GROUPS = [
  { token: /(?:^|[-_\s])(plus|add|create|new)(?:$|[-_\s])/, terms: ["新增", "新建", "添加", "创建", "plus", "add", "create", "new"] },
  { token: /(?:^|[-_\s])(search|find|magnify)(?:$|[-_\s])/, terms: ["搜索", "查找", "search", "find"] },
  { token: /(?:^|[-_\s])(back|arrow-left)(?:$|[-_\s])/, terms: ["返回", "back"] },
  { token: /(?:^|[-_\s])(more|menu|ellipsis)(?:$|[-_\s])/, terms: ["更多", "菜单", "more", "menu"] },
] as const

export const semanticActionTerms = (element: HTMLElement) => {
  const semanticTokens = normalize([
    element.id,
    element.className,
    element.getAttribute("data-icon"),
    ...[...element.querySelectorAll<HTMLElement>("[class]")]
      .slice(0, 6)
      .map((child) => child.getAttribute("class")),
  ].filter(Boolean).join(" ")).toLowerCase()
  return ACTION_INTENT_GROUPS.flatMap((group) =>
    group.token.test(semanticTokens) ? [...group.terms] : [],
  )
}

export const specPages = (bundle: ProductSpecBundle): SpecPage[] =>
  bundle.pages?.length
    ? bundle.pages
    : bundle.modules.flatMap((module) => module.pages ?? [])

export const pagesForModule = (
  bundle: ProductSpecBundle,
  module: SpecModule,
): SpecPage[] => {
  if (!bundle.pages?.length) return module.pages ?? []
  const referenced = new Set(
    module.nodes.map((node) => node.pageId).filter(Boolean),
  )
  return bundle.pages.filter((page) => referenced.has(page.id))
}

export const pageForNode = (
  bundle: ProductSpecBundle,
  node: Pick<FlatSpecNode, "moduleId" | "pageId">,
) => {
  if (!node.pageId) return undefined
  return bundle.pages?.find((page) => page.id === node.pageId)
    ?? bundle.modules
      .find((module) => module.id === node.moduleId)
      ?.pages?.find((page) => page.id === node.pageId)
}

export const flattenNodes = (bundle: ProductSpecBundle): FlatSpecNode[] =>
  bundle.modules.flatMap((module) =>
    module.nodes.map((node) => {
      const page = pageForNode(bundle, { ...node, moduleId: module.id })
      return {
        ...node,
        moduleId: module.id,
        moduleTitle: module.title,
        pageTitle: page?.title,
      }
    }),
  )

const pageEvidenceText = (doc: Document) => {
  const semanticLabels = [...doc.querySelectorAll<HTMLElement>(
    "[aria-label], [title], [data-spec-anchor], [data-spec-id], [data-testid]",
  )].flatMap((element) => [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-spec-anchor"),
    element.getAttribute("data-spec-id"),
    element.getAttribute("data-testid"),
  ])
  return normalize([doc.body?.innerText, ...semanticLabels].filter(Boolean).join(" "))
    .toLowerCase()
}

const pageEvidenceScore = (
  title: string,
  routeHints: readonly string[],
  anchorHints: readonly string[],
  visibleText: string,
  contextUrl: string,
  headings: readonly string[],
) => {
  let score = 0
  const normalizedRoute = normalize(contextUrl).toLowerCase()
  const routes = routeHints.map((hint) => normalize(hint).toLowerCase()).filter(Boolean)
  for (const route of routes) {
    if (normalizedRoute === route) score = Math.max(score, 0.99)
    else if (normalizedRoute.includes(route)) score = Math.max(score, 0.94)
  }

  const explicitAnchors = anchorHints
    .map((hint) => normalize(hint).toLowerCase())
    .filter(Boolean)
  const matchedAnchors = explicitAnchors.filter((hint) => visibleText.includes(hint))
  const minimumAnchorMatches = explicitAnchors.length > 1
    ? Math.floor(explicitAnchors.length / 2) + 1
    : 1
  if (matchedAnchors.length >= minimumAnchorMatches) {
    score = Math.max(
      score,
      0.82 + 0.15 * (matchedAnchors.length / explicitAnchors.length),
    )
  }
  const normalizedTitle = normalize(title).toLowerCase()
  if (normalizedTitle && visibleText.includes(normalizedTitle)) {
    score = Math.max(score, 0.86)
  }
  // A page's actual heading is stronger evidence than a link naming another
  // page elsewhere in the body (e.g. the patient-record entry in a chat).
  if (headings.length) return headings.includes(normalizedTitle) ? 0.99 : Math.min(score, 0.90)
  return Math.min(score, 0.99)
}

const uniqueRouteHintsByPage = (pages: readonly SpecPage[]) => {
  const pageIdsByRoute = new Map<string, Set<string>>()
  for (const page of pages) {
    for (const hint of page.routeHints ?? []) {
      const route = normalize(hint).toLowerCase()
      if (!route) continue
      const pageIds = pageIdsByRoute.get(route) ?? new Set<string>()
      pageIds.add(page.id)
      pageIdsByRoute.set(route, pageIds)
    }
  }
  return new Map(
    pages.map((page) => [
      page.id,
      (page.routeHints ?? []).filter((hint) =>
        pageIdsByRoute.get(normalize(hint).toLowerCase())?.size === 1,
      ),
    ]),
  )
}

/**
 * Resolve at most one current logical page per module. Global pages are
 * filtered by each module's explicit pageId references; legacy module pages
 * remain supported without inferring cross-module membership.
 */
export const matchCurrentPages = (
  bundle: ProductSpecBundle,
  doc: Document,
  contextUrl: string,
): Map<string, PageMatch> => {
  const matches = new Map<string, PageMatch>()
  // Page identity often lives in accessible labels or stable anchor metadata,
  // not in visible text. Treat those as page evidence without turning them
  // into confirmed element mappings.
  const visibleText = pageEvidenceText(doc)
  const headings = querySelectorSafe(doc, 'h1, [role="heading"][aria-level="1"]')
    .filter(isVisible).map((heading) => normalize(heading.innerText).toLowerCase())
    .filter((heading) => specPages(bundle).some((page) => normalize(page.title).toLowerCase() === heading))
  if (bundle.pages?.length) {
    const referencedPageIds = new Set(
      bundle.modules.flatMap((module) => module.nodes)
        .filter((node) => MAPPABLE_TYPES.has(node.type))
        .map((node) => node.pageId)
        .filter(Boolean),
    )
    const candidatePages = bundle.pages
      .filter((page) => referencedPageIds.has(page.id))
    const uniqueRouteHints = uniqueRouteHintsByPage(candidatePages)
    const ranked = candidatePages
      .map((page) => ({
        pageId: page.id,
        pageTitle: page.title,
        confidence: pageEvidenceScore(
          page.title,
          uniqueRouteHints.get(page.id) ?? [],
          page.anchorHints,
          visibleText,
          contextUrl,
          headings,
        ),
      }))
      .sort((left, right) => right.confidence - left.confidence)
    const [best, second] = ranked
    if (
      best?.confidence >= 0.82 &&
      (!second || best.confidence - second.confidence >= 0.06)
    ) {
      for (const module of bundle.modules) {
        if (module.nodes.some((node) => node.pageId === best.pageId)) {
          matches.set(module.id, { ...best, moduleId: module.id })
        }
      }
    }
    return matches
  }
  const candidatePages = bundle.modules
    .flatMap((module) => pagesForModule(bundle, module))
  const uniqueRouteHints = uniqueRouteHintsByPage(candidatePages)
  const ranked = bundle.modules
    .flatMap((module) => pagesForModule(bundle, module).map((page) => ({
        moduleId: module.id,
        pageId: page.id,
        pageTitle: page.title,
        confidence: pageEvidenceScore(
          page.title,
          uniqueRouteHints.get(page.id) ?? [],
          page.anchorHints,
          visibleText,
          contextUrl,
          headings,
        ),
      })))
    .sort((left, right) => right.confidence - left.confidence)
  const [best] = ranked
  const secondPage = ranked.find((candidate) => candidate.pageId !== best?.pageId)
  if (
    best?.confidence >= 0.82 &&
    (!secondPage || best.confidence - secondPage.confidence >= 0.06)
  ) {
    // Legacy module.pages are flattened into one page competition. A single
    // DOM cannot expose a different current page per module; modules that reuse
    // the winning page id may share that one logical page.
    for (const candidate of ranked.filter((item) => item.pageId === best.pageId)) {
      matches.set(candidate.moduleId, candidate)
    }
  }
  return matches
}

export const annotationFor = (map: SpecMap, nodeId: string) =>
  map.items.find((item) => item.body.id === nodeId) ?? null

export const mappingStatus = (
  map: SpecMap,
  nodeId: string,
): DisplayMapStatus => annotationFor(map, nodeId)?.status ?? "unmapped"

export const querySelectorSafe = (doc: Document, selector: string) => {
  try {
    return [...doc.querySelectorAll<HTMLElement>(selector)]
  } catch {
    return []
  }
}

const htmlElement = (element: Element | null): HTMLElement | null =>
  element?.namespaceURI === "http://www.w3.org/1999/xhtml"
    ? (element as HTMLElement)
    : null

const hasPointerAffordance = (element: HTMLElement) => {
  const view = element.ownerDocument.defaultView
  if (!view || element === element.ownerDocument.body) return false
  const style = view.getComputedStyle(element)
  return style.pointerEvents !== "none" && style.cursor === "pointer"
}

const pointerInteractionRoot = (raw: Element) => {
  let cursor: HTMLElement | null = htmlElement(raw)
  if (!cursor) cursor = htmlElement(raw.parentElement)
  let target: HTMLElement | null = null
  while (
    cursor &&
    cursor !== cursor.ownerDocument.body &&
    cursor !== cursor.ownerDocument.documentElement
  ) {
    if (hasPointerAffordance(cursor)) {
      target = cursor
    } else if (target) {
      break
    }
    cursor = cursor.parentElement
  }
  return target
}

const surfaceHints = (node: SpecNode | undefined) =>
  node
    ? [node.title, ...node.anchorHints]
        .map((value) => normalize(value).toLowerCase())
        .filter(Boolean)
    : []

const surfaceTextScore = (
  element: HTMLElement,
  node: SpecNode | undefined,
) => {
  const haystack = normalize(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.innerText,
    ]
      .filter(Boolean)
      .join(" "),
  ).toLowerCase()
  if (!haystack) return 0
  let score = 0
  for (const hint of surfaceHints(node)) {
    if (haystack === hint) score = Math.max(score, 52)
    else if (haystack.includes(hint)) score = Math.max(score, 44)
    else {
      const tokens = hint
        .split(/[\s\-_/]+/)
        .filter((token) => token.length > 1)
      const matched = tokens.filter((token) => haystack.includes(token)).length
      if (tokens.length) score = Math.max(score, 30 * (matched / tokens.length))
    }
  }
  return score
}

const numericStyle = (value: string) => Number.parseFloat(value) || 0

/**
 * Compatibility fallback for div-based component libraries. A container is a
 * surface only when its rendered box creates a visible grouping boundary; a
 * plain wrapper is not promoted just because it exists in the DOM.
 */
export const isVisualSurface = (element: HTMLElement) => {
  const doc = element.ownerDocument
  const view = doc.defaultView
  const parent = element.parentElement
  if (
    !view ||
    !parent ||
    element === doc.body ||
    element === doc.documentElement ||
    element.closest("#ips-overlay-host")
  ) {
    return false
  }
  const rect = element.getBoundingClientRect()
  if (rect.width < 80 || rect.height < 36 || element.children.length === 0) {
    return false
  }
  const style = view.getComputedStyle(element)
  const parentStyle = view.getComputedStyle(parent)
  const borderWidth =
    numericStyle(style.borderTopWidth) +
    numericStyle(style.borderRightWidth) +
    numericStyle(style.borderBottomWidth) +
    numericStyle(style.borderLeftWidth)
  const padding =
    numericStyle(style.paddingTop) +
    numericStyle(style.paddingRight) +
    numericStyle(style.paddingBottom) +
    numericStyle(style.paddingLeft)
  const paintedBoundary =
    borderWidth > 0 ||
    style.boxShadow !== "none" ||
    (style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      style.backgroundColor !== "transparent" &&
      style.backgroundColor !== parentStyle.backgroundColor)
  const namedBoundary = Boolean(
    element.getAttribute("aria-label") ||
      element.getAttribute("aria-labelledby") ||
      element.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role='heading']"),
  )
  return paintedBoundary || (namedBoundary && padding >= 12)
}

const inferredSurfaceFor = (raw: Element | null) => {
  let cursor = htmlElement(raw)
  while (
    cursor &&
    cursor !== cursor.ownerDocument.body &&
    cursor !== cursor.ownerDocument.documentElement
  ) {
    if (isVisualSurface(cursor)) return cursor
    cursor = cursor.parentElement
  }
  return null
}

const collectVisualSurfaceTargets = (doc: Document) => {
  const results: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  const seeds = querySelectorSafe(
    doc,
    "h1, h2, h3, h4, h5, h6, [role='heading'], [aria-label], [aria-labelledby]",
  )
  for (const seed of seeds) {
    const target = inferredSurfaceFor(seed.parentElement)
    if (target && !target.matches(INTERACTIVE_SELECTOR) && !seen.has(target)) {
      seen.add(target)
      results.push(target)
    }
  }
  return results
}

export const surfaceTargetScore = (
  element: HTMLElement,
  node: SpecNode | undefined,
) => {
  let score = surfaceTextScore(element, node)
  if (element.matches(EXPLICIT_SURFACE_SELECTOR)) score += 38
  else if (element.matches(SEMANTIC_SURFACE_SELECTOR)) score += 22
  else if (isVisualSurface(element)) score += 14
  const view = element.ownerDocument.defaultView
  const rect = element.getBoundingClientRect()
  if (view && rect.width * rect.height >= view.innerWidth * view.innerHeight * 0.82) {
    score -= 28
  }
  return score
}

/**
 * Resolve the page element that owns a user interaction. Native controls,
 * common ARIA widgets and keyboard-focusable elements take precedence. A
 * cursor:pointer boundary is a final compatibility fallback for framework
 * components that expose a clear visual affordance but omit semantic markup.
 */
export const resolveInteractiveTarget = (
  raw: Element | null,
): HTMLElement | null => {
  if (!raw || raw.nodeType !== 1 || raw.closest("#ips-overlay-host")) return null
  const semanticTarget = htmlElement(raw.closest(INTERACTIVE_SELECTOR))
  return semanticTarget ?? pointerInteractionRoot(raw)
}

export const collectInteractiveTargets = (doc: Document) => {
  const results = querySelectorSafe(doc, INTERACTIVE_SELECTOR)
  const seen = new Set(results)
  for (const element of doc.querySelectorAll<HTMLElement>("body *")) {
    if (element.closest("#ips-overlay-host") || !hasPointerAffordance(element)) {
      continue
    }
    const parent = element.parentElement
    if (parent && hasPointerAffordance(parent)) continue
    const target = resolveInteractiveTarget(element)
    if (target && !seen.has(target)) {
      results.push(target)
      seen.add(target)
    }
  }
  return results
}

export const collectBindableTargets = (doc: Document, nodeType: string) => {
  if (nodeType === "ACTION") return collectInteractiveTargets(doc)
  const results = querySelectorSafe(doc, SURFACE_SELECTOR)
  const seen = new Set(results)
  for (const element of collectVisualSurfaceTargets(doc)) {
    if (!seen.has(element)) {
      results.push(element)
      seen.add(element)
    }
  }
  return results
}

export const elementFingerprint = (
  element: HTMLElement,
): ElementFingerprint => ({
  tag: element.tagName.toLowerCase(),
  role: element.getAttribute("role") ?? "",
  text: truncate(
    element.innerText ||
      element.getAttribute("placeholder") ||
      ("value" in element ? String(element.value ?? "") : "") ||
      element.textContent,
    120,
  ),
  ariaLabel: normalize(element.getAttribute("aria-label")),
})

export const fingerprintMatches = (
  saved: ElementFingerprint,
  current: ElementFingerprint,
) => {
  if (saved.tag && saved.tag !== current.tag) return false
  if (saved.role && saved.role !== current.role) return false
  if (saved.ariaLabel) {
    return Boolean(current.ariaLabel) && saved.ariaLabel === current.ariaLabel
  }
  if (saved.text && saved.text !== current.text) return false
  return true
}

export const resolveMappedTarget = (
  annotation: SpecAnnotation,
  doc: Document,
  node: FlatSpecNode | undefined,
): HTMLElement | null => {
  const matches = querySelectorSafe(doc, annotation.target.selector.value)
  if (matches.length !== 1) return null
  const target = matches[0]
  if (!isVisible(target) || !targetCompatible(node, target) ||
    !fingerprintMatches(annotation.target.fingerprint, elementFingerprint(target))) return null
  // A human may bind an entry on its parent page. Spec grouping and route
  // hints must never override the actual confirmed selector and fingerprint.
  return target
}

const escapeSelector = (value: string) => {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return value.replace(/["\\]/g, "\\$&")
}

export const uniqueSelector = (element: HTMLElement) => {
  const doc = element.ownerDocument
  for (const attribute of [
    "data-spec-anchor",
    "data-spec-id",
    "data-testid",
  ]) {
    const value = element.getAttribute(attribute)
    if (value) {
      const selector = `[${attribute}="${escapeSelector(value)}"]`
      if (querySelectorSafe(doc, selector).length === 1) return selector
    }
  }
  if (element.id) {
    const selector = `#${escapeSelector(element.id)}`
    if (querySelectorSafe(doc, selector).length === 1) return selector
  }
  const ariaLabel = element.getAttribute("aria-label")
  if (ariaLabel) {
    const selector = `${element.tagName.toLowerCase()}[aria-label="${escapeSelector(ariaLabel)}"]`
    if (querySelectorSafe(doc, selector).length === 1) return selector
  }
  const parts: string[] = []
  let cursor: HTMLElement | null = element
  while (cursor && cursor !== doc.documentElement) {
    const tag = cursor.tagName.toLowerCase()
    const siblings = cursor.parentElement
      ? [...cursor.parentElement.children].filter(
          (sibling) => sibling.tagName === cursor?.tagName,
        )
      : []
    const part =
      siblings.length > 1
        ? `${tag}:nth-of-type(${siblings.indexOf(cursor) + 1})`
        : tag
    parts.unshift(part)
    const selector = parts.join(" > ")
    if (parts.length >= 2 && querySelectorSafe(doc, selector).length === 1) {
      return selector
    }
    cursor = cursor.parentElement
  }
  return parts.join(" > ")
}

export const meaningfulTarget = (
  raw: Element | null,
  node: SpecNode | undefined,
): HTMLElement | null => {
  if (!raw || raw.nodeType !== 1 || raw.closest("#ips-overlay-host")) {
    return null
  }
  if (node?.type === "ACTION") return resolveInteractiveTarget(raw)
  const candidates: HTMLElement[] = []
  let cursor = htmlElement(raw)
  while (
    cursor &&
    cursor !== cursor.ownerDocument.body &&
    cursor !== cursor.ownerDocument.documentElement
  ) {
    if (cursor.matches(SURFACE_SELECTOR) || isVisualSurface(cursor)) {
      candidates.push(cursor)
    }
    cursor = cursor.parentElement
  }
  if (!candidates.length) return inferredSurfaceFor(raw)
  const ranked = candidates
    .map((element, distance) => ({
      element,
      score: surfaceTargetScore(element, node) - distance * 1.5,
    }))
    .sort((left, right) => right.score - left.score)
  return ranked[0]?.element ?? null
}

export const targetCompatible = (node: SpecNode | undefined, element: Element) =>
  node?.type !== "ACTION" || resolveInteractiveTarget(element) === element

export const targetLabel = (element: HTMLElement | null) =>
  truncate(
    element?.getAttribute("aria-label") ||
      element?.getAttribute("placeholder") ||
      element?.innerText ||
      element?.textContent ||
      (element ? semanticActionTerms(element)[0] : "") ||
      element?.tagName ||
      "页面功能",
    36,
  )

export const isVisible = (element: HTMLElement) => {
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  )
}

const cjkBigrams = (value: string) => {
  const result = new Set<string>()
  for (const run of value.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      result.add(run.slice(index, index + 2))
    }
  }
  return [...result]
}

const partialTextConfidence = (hint: string, haystack: string) => {
  let confidence = 0
  const tokens = hint
    .split(/[\s\-_/]+/)
    .filter((token) => token.length > 1 && !/[\u3400-\u9fff]/.test(token))
  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length
  if (matchedTokens) {
    confidence = Math.max(confidence, 0.18 + 0.42 * (matchedTokens / tokens.length))
  }
  const bigrams = cjkBigrams(hint)
  const matchedBigrams = bigrams.filter((bigram) => haystack.includes(bigram)).length
  if (matchedBigrams) {
    confidence = Math.max(confidence, 0.18 + 0.42 * (matchedBigrams / bigrams.length))
  }
  return confidence
}

export const computeSuggestion = (
  doc: Document,
  node: FlatSpecNode,
  mapped: boolean,
  availableTargets?: readonly HTMLElement[],
  options: { minimumConfidence?: number } = {},
): CandidateTarget | null => {
  if (mapped) return null
  const minimumConfidence = options.minimumConfidence ?? 0.58
  const hints = [node.title, ...node.anchorHints]
    .map((value) => normalize(value).toLowerCase())
    .filter(Boolean)
  const normalizedNodeId = normalize(node.id).toLowerCase()
  let best: CandidateTarget | null = null
  let runnerUpConfidence = 0
  const targets = availableTargets ?? collectBindableTargets(doc, node.type)
  for (const element of targets) {
    if (element.closest("#ips-overlay-host") || !isVisible(element)) continue
    const fingerprint = elementFingerprint(element)
    const semanticTerms = semanticActionTerms(element)
    const referenceValues = [
      element.id,
      element.getAttribute("data-spec-id"),
      element.getAttribute("data-spec-anchor"),
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
    ]
      .map((value) => normalize(value).toLowerCase())
      .filter(Boolean)
    const haystack = normalize(
      [
        fingerprint.text,
        fingerprint.ariaLabel,
        element.getAttribute("title"),
        ...semanticTerms,
        ...referenceValues,
      ]
        .filter(Boolean)
        .join(" "),
    ).toLowerCase()
    if (!haystack) continue
    let score = referenceValues.includes(normalizedNodeId) ? 0.99 : 0
    for (const hint of hints) {
      if (referenceValues.includes(hint)) score = Math.max(score, 0.96)
      else if (haystack === hint) score = Math.max(score, 0.96)
      else if (haystack.includes(hint)) score = Math.max(score, 0.84)
      else if (semanticTerms.some((term) => hint.includes(term))) {
        score = Math.max(score, 0.84)
      }
      else {
        score = Math.max(score, partialTextConfidence(hint, haystack))
      }
    }
    if (
      score > 0 &&
      (
        element.hasAttribute("data-spec-anchor") ||
        element.hasAttribute("data-testid")
      )
    ) {
      score += 0.04
    }
    if (!best || score > best.confidence) {
      runnerUpConfidence = best
        ? Math.max(runnerUpConfidence, best.confidence)
        : runnerUpConfidence
      best = {
        element,
        confidence: Math.min(score, 0.99),
        selector: uniqueSelector(element),
        fingerprint,
      }
    } else {
      runnerUpConfidence = Math.max(runnerUpConfidence, Math.min(score, 0.99))
    }
  }
  if (!best || best.confidence < minimumConfidence) return null
  if (
    runnerUpConfidence >= minimumConfidence &&
    best.confidence - runnerUpConfidence < 0.08
  ) {
    return { ...best, confidence: Math.min(best.confidence, 0.79) }
  }
  return best
}

export const frameLocation = (frame: HTMLIFrameElement | null) => {
  try {
    const location = frame?.contentWindow?.location
    return location
      ? `${location.pathname}${location.search}${location.hash}`
      : ""
  } catch {
    return ""
  }
}

export const createAnnotation = (
  nodeId: string,
  element: HTMLElement,
  map: SpecMap,
  contextUrl: string,
): SpecAnnotation => {
  const selector = uniqueSelector(element)
  if (!selector) throw new Error("无法为该元素生成稳定选择器")
  return {
    id: `urn:interactive-product-spec:annotation:${nodeId}`,
    type: "Annotation",
    motivation: "linking",
    body: { id: nodeId, type: "Text" },
    target: {
      source: map.targetSource,
      context: { url: contextUrl },
      selector: { type: "CssSelector", value: selector },
      fingerprint: elementFingerprint(element),
    },
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
  }
}

export const validateMappingsInPage = (
  map: SpecMap,
  doc: Document | null,
  nodeById: Map<string, FlatSpecNode>,
  contextUrl: string,
  bundle?: ProductSpecBundle,
  currentPages: Map<string, PageMatch> = new Map(),
) => {
  const issues = new Map<string, MappingIssue>()
  if (!doc) return { map, issues }
  const items = map.items.map((annotation) => {
    const context = annotation.target.context?.url
    const node = nodeById.get(annotation.body.id)
    const matches = querySelectorSafe(doc, annotation.target.selector.value)
    if (matches.length === 0) {
      // A different saved workbench URL can still be opened automatically, so
      // this remains a normal confirmed association. Manual entry is only
      // required after automatic navigation is unavailable or already exhausted.
      if (
        context &&
        context !== contextUrl &&
        /^\/target(?:-dev)?\//.test(context)
      ) {
        return { ...annotation, status: "confirmed" as const }
      }
      // A missing element at the saved context only proves that the current
      // prototype scene does not expose the target. Low-fidelity HTML often
      // keeps transient state in memory, so the association remains valid.
      return { ...annotation, status: "out-of-context" as const }
    }
    if (matches.length > 1) {
      return { ...annotation, status: "ambiguous" as const }
    }
    const target = matches[0]
    const compatible = targetCompatible(node, target)
    const fingerprintMatched = fingerprintMatches(
      annotation.target.fingerprint,
      elementFingerprint(target),
    )

    if (resolveMappedTarget(annotation, doc, node)) {
      return { ...annotation, status: "confirmed" as const }
    }
    if (compatible && fingerprintMatched) {
      return { ...annotation, status: "out-of-context" as const }
    }

    const contextChanged = Boolean(context && context !== contextUrl)
    const currentPage = bundle && node?.pageId
      ? currentPages.get(node.moduleId)
      : undefined
    const pageChanged = Boolean(
      currentPage && node?.pageId && currentPage.pageId !== node.pageId,
    )
    if (contextChanged || pageChanged) {
      return { ...annotation, status: "out-of-context" as const }
    }
    if (!compatible) {
      issues.set(annotation.body.id, "semantic-target")
      return { ...annotation, status: "invalid" as const }
    }
    return { ...annotation, status: "drifted" as const }
  })
  return { map: { ...map, items }, issues }
}

export const collectRelated = (
  node: FlatSpecNode,
  nodes: FlatSpecNode[],
  nodeById: Map<string, FlatSpecNode>,
) => {
  const results: Array<{ relationType: string; node: FlatSpecNode }> = []
  const seen = new Set<string>()
  for (const relation of node.relations ?? []) {
    const target = nodeById.get(relation.targetId)
    if (target && !seen.has(target.id)) {
      results.push({ relationType: relation.type, node: target })
      seen.add(target.id)
    }
  }
  for (const candidate of nodes) {
    const reverse = (candidate.relations ?? []).find(
      (relation) => relation.targetId === node.id,
    )
    if (reverse && !seen.has(candidate.id)) {
      results.push({ relationType: `被${reverse.type}`, node: candidate })
      seen.add(candidate.id)
    }
  }
  return results
}

export const collectConstraintSections = (
  node: FlatSpecNode,
  nodes: FlatSpecNode[],
  nodeById: Map<string, FlatSpecNode>,
) => {
  const direct = collectRelated(node, nodes, nodeById).filter(
    ({ node: relatedNode }) => !MAPPABLE_TYPES.has(relatedNode.type),
  )
  const directIds = new Set(direct.map(({ node: relatedNode }) => relatedNode.id))
  const module = nodes
    .filter((candidate) =>
      candidate.moduleId === node.moduleId &&
      !MAPPABLE_TYPES.has(candidate.type) &&
      !directIds.has(candidate.id),
    )
    .map((candidate) => ({ relationType: "同模块未直接关联", node: candidate }))
  return { direct, module }
}

export const explainMappingStatus = (
  status: DisplayMapStatus,
  issue?: MappingIssue,
) => {
  if (issue === "semantic-target") {
    return "该操作指向了页面容器，而不是可识别的交互目标；请重新映射到原生控件、ARIA 控件或有明确交互提示的元素。"
  }
  return {
    confirmed: "关联有效；当前页面已找到组件时直接定位，否则会按保存地址自动打开。",
    invalid: "当前命中的元素已经不再是该 Spec 可关联的目标，需要重新选择。",
    ambiguous: "当前选择器命中多个元素，需要重新选择唯一目标。",
    drifted: "对应元素仍存在，但文字或语义已经发生变化，需要复核。",
    "out-of-context": "关联仍然有效；当前演示场景尚未显示该组件。请在页面中手动进入对应场景，组件出现后会自动定位。",
    unmapped: "尚未建立页面映射。",
  }[status]
}
