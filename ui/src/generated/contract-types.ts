// This file is generated from schemas/*.schema.json.
// Run `npm run generate:contracts` after changing a schema.

export interface ProductSpecBundle {
  schemaVersion: "0.1"
  product: {
    id: string
    title: string
    version: string
    status: "draft" | "reviewing" | "confirmed" | "superseded"
    description?: string
    sourceRefs?: string[]
    prdSource?: PrdSourceReference
    [k: string]: unknown
  }
  pages?: SpecPage[]
  /**
   * @minItems 1
   */
  modules: SpecModule[]
}
export interface PrdSourceReference {
  path: string
  version: string
  revision: string
}
export interface SpecPage {
  id: string
  title: string
  responsibility?: string
  parentPageId?: string | null
  routeHints?: string[]
  anchorHints: string[]
}
export interface SpecModule {
  id: string
  title: string
  purpose: string
  scope?: string
  journeys?: string[]
  /**
   * @minItems 1
   */
  pages?: SpecPage[]
  /**
   * @minItems 1
   */
  nodes: SpecNode[]
  [k: string]: unknown
}
export interface SpecNode {
  id: string
  type: "SURFACE" | "ACTION" | "RULE" | "STATE" | "EVENT" | "PERMISSION" | "EXTERNAL" | "AC" | "TBD"
  title: string
  pageId?: string | null
  status: "draft" | "reviewing" | "confirmed" | "superseded"
  sourceKind:
    "observed-ui" | "product-decision" | "candidate" | "formal-source" | "simulation" | "tbd"
  surface?: string
  statement?: string
  anchorHints: string[]
  /**
   * @minItems 1
   */
  prdSectionIds?: string[]
  contentBlocks?: SpecContentBlock[]
  /**
   * @deprecated
   */
  fields?: {
    [k: string]: string | string[]
  }
  relations?: {
    type: string
    targetId: string
  }[]
  [k: string]: unknown
}
export interface SpecContentBlock {
  id: string
  label: string
  content: string
}
export interface SpecMap {
  "@context": "http://www.w3.org/ns/anno.jsonld"
  id: string
  type: "AnnotationCollection"
  schemaVersion: "0.1"
  productSpecId: string
  targetSource: string
  updatedAt: string
  items: SpecAnnotation[]
  [k: string]: unknown
}
export interface SpecAnnotation {
  id: string
  type: "Annotation"
  motivation: "linking"
  body: SpecAnnotationBody
  target: SpecAnnotationTarget
  status: "confirmed" | "invalid" | "ambiguous" | "drifted" | "out-of-context"
  confirmedAt?: string
  [k: string]: unknown
}
export interface SpecAnnotationBody {
  id: string
  type: "Text"
  [k: string]: unknown
}
export interface SpecAnnotationTarget {
  source: string
  context?: SpecAnnotationContext
  selector: SpecCssSelector
  fingerprint: ElementFingerprint
  [k: string]: unknown
}
export interface SpecAnnotationContext {
  url: string
  [k: string]: unknown
}
export interface SpecCssSelector {
  type: "CssSelector"
  value: string
  [k: string]: unknown
}
export interface ElementFingerprint {
  tag: string
  role?: string
  text: string
  ariaLabel?: string
  [k: string]: unknown
}
export interface PrdMap {
  schemaVersion: "0.1"
  productId: string
  prd: PrdMapDocument
  targetSource: string
  updatedAt: string
  items: PrdPageAnnotation[]
}
export interface PrdMapDocument {
  path: string
  revision: string
  profileVersion: "可映射PRD-v1"
}
export interface PrdPageAnnotation {
  id: string
  page: PrdPageTarget
  /**
   * @minItems 1
   */
  sectionIds: string[]
  confirmedAt: string
  updatedAt: string
}
export interface PrdPageTarget {
  pageId?: string | null
  title: string
  context: {
    url: string
  }
}
export interface PrdReviewState {
  sessionId: string
  token: string
  version: number
  status: "reviewing" | "confirmation_requested" | "confirmed" | "ended"
  revision: string
  draftRevision: string
  agentConnected: boolean
  previousSource: string | null
  confirmationRequestedAt?: string
  confirmationRevision?: string
  confirmedAt?: string
  confirmedPath?: string
  confirmationSummary?: string
  /**
   * @maxItems 50
   */
  annotations: PrdReviewAnnotation[]
  batches: {
    id: string
    baseRevision: string
    revision?: string
    status:
      | "queued"
      | "processing"
      | "needs_review"
      | "withdrawn"
      | "stop_requested"
      | "stopped"
      | "published"
    submittedAt: string
    startedAt?: string
    withdrawnAt?: string
    stopRequestedAt?: string
    stoppedAt?: string
    publishedAt?: string
    summary?: string
    /**
     * @minItems 1
     * @maxItems 50
     */
    annotations: PrdReviewAnnotation[]
  }[]
}
export interface PrdReviewAnnotation {
  id: string
  kind: "comment" | "replace" | "delete" | "general"
  comment: string
  anchor: null | {
    quote: string
    startLine: number
    endLine: number
    quoteOccurrence?: number
    sectionId?: string | null
    context?: string
  }
}
