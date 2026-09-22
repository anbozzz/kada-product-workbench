import type {
  ElementFingerprint,
  ProductSpecBundle,
  SpecAnnotation,
  SpecMap,
  SpecNode,
  PrdMap,
  PrdReviewState,
} from "./generated/contract-types"

export type {
  ElementFingerprint,
  ProductSpecBundle,
  SpecAnnotation,
  SpecContentBlock,
  SpecMap,
  SpecModule,
  SpecNode,
  SpecPage,
  PrdMap,
  PrdPageAnnotation,
  PrdReviewState,
  PrdReviewAnnotation,
} from "./generated/contract-types"

export type SpecNodeType = SpecNode["type"]
export type MapStatus = SpecAnnotation["status"]

export type DisplayMapStatus = MapStatus | "unmapped"
export type WorkMode = "map" | "review"
export type MappingIssue = "semantic-target"

export type SpecRelation = NonNullable<SpecNode["relations"]>[number]

export interface FlatSpecNode extends SpecNode {
  moduleId: string
  moduleTitle: string
  pageTitle?: string
}

export interface PageMatch {
  moduleId: string
  pageId: string
  pageTitle: string
  confidence: number
}

export interface ReviewBaseline {
  schemaVersion: "0.1"
  sessionId: string
  mode: "map" | "review"
  projectId: string
  target: {
    type: "file" | "dev" | "document"
    source: string
    identityRevision: string
  }
  artifacts: {
    prdRevision: string
    prdMapRevision: string
    sourceSpecRevision: string
    projectionRevision: string
    specMapRevision: string
  }
}

export interface WorkbenchConfig {
  documentUpdates?: boolean
  prdReview?: PrdReviewState | null
  mode: "map" | "review"
  productSpec: ProductSpecBundle
  specMap: SpecMap
  mapRevision: string
  targetUrl: string
  reviewBaseline: ReviewBaseline
  capabilities: {
    saveSpecMap: boolean
    saveSpec: boolean
    submitToCodex: boolean
    savePrdMap: boolean
    returnToProjects: boolean
    exportReviewPackage: boolean
  }
  canSave: boolean
  canSaveSpecMap: boolean
  canSaveSpec: boolean
  canSubmitToCodex: boolean
  specEditMode: "direct-source" | "codex-gate" | "readonly"
  sourceSpecPath: string
  sourceSpecRevision: string
  specDocument?: { source: string; revision: string; images?: PrdDocumentView["images"]; pendingDraft?: boolean } | null
  bundlePath: string
  specPath: string
  specRevision: string
  draftChangeCount: number
  prd: PrdDocumentView | null
  prdMap: PrdMap | null
  prdMapRevision: string
  canSavePrdMap: boolean
  prdMapStale: boolean
  missingPrdSectionIds: string[]
  canReturnToProjects?: boolean
  reviewPackage?: {
    portable: boolean
    canExport: boolean
    blockReason: string
    generatedAt?: string
  }
  project?: {
    id: string
    name: string
    projectPath: string
    sourceType: ProjectSourceType
    mapPolicy: MapStoragePolicy
  } | null
}

export type ProjectSourceType = "directory" | "html" | "dev"
export type MapStoragePolicy = "tool" | "existing" | "project"

export interface ProjectDraft {
  id?: string
  name: string
  projectPath: string
  sourceType: ProjectSourceType
  htmlPath: string
  devUrl: string
  specPath: string
  sourceSpecPath: string
  prdPath: string
  prdMapPath: string
  mapPath: string
  mapPolicy: MapStoragePolicy
  mode: "map" | "review"
  initialRoute: string
  confirmMapCreate?: boolean
  confirmPrdMapCreate?: boolean
  confirmTargetWrite?: boolean
  updatedAt?: string
  lastOpenedAt?: string
}

export interface DiscoveryCandidate {
  path: string
  relativePath: string
  score: number
  valid: boolean
  errors: string[]
  productTitle?: string
}

export interface ProjectDiscovery {
  projectPath: string
  scannedFiles: number
  truncated: boolean
  html: DiscoveryCandidate[]
  spec: DiscoveryCandidate[]
  specSource: DiscoveryCandidate[]
  map: DiscoveryCandidate[]
  prd: DiscoveryCandidate[]
  prdMap: DiscoveryCandidate[]
  recommended: {
    htmlPath: string
    specPath: string
    sourceSpecPath: string
    mapPath: string
    prdPath: string
    prdMapPath: string
  }
  devCheck?: {
    url: string
    reachable: boolean
    status: number
    contentType: string
    error: string
  } | null
}

export interface PrdSectionView {
  id: string
  kind: "function" | "global-rule"
  title: string
  domainTitle: string
  headingPath: string[]
  startLine: number
  endLine: number
  markdown: string
  blocks: Record<string, string>
}

export interface PrdDocumentView {
  images?: Record<string, { src?: string; error?: string }>
  imageDefinitions?: string
  profileVersion: string
  productId: string
  title: string
  version: string
  status: string
  path: string
  revision: string
  source: string
  sections: PrdSectionView[]
}


export type ProjectionJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export interface ProjectionJob {
  id: string
  status: ProjectionJobStatus
  message: string
  error: string
  sourceSpecPath: string
  sourceSpecRevision: string
  specPath: string
  threadId: string
  threadTitle: string
  model: string
  effort: string
  createdAt: string
  updatedAt: string
}

export interface PrdDraftJob {
  id: string
  status: ProjectionJobStatus
  message: string
  error: string
  sourcePrdPath: string
  sourcePrdRevision: string
  draftPath: string
  draftRevision: string
  threadId: string
  threadTitle: string
  model: string
  effort: string
  createdAt: string
  updatedAt: string
}

export interface CodexModelOption {
  id: string
  displayName: string
  description: string
  supportedReasoningEfforts: {
    id: string
    description: string
  }[]
  defaultReasoningEffort: string
  isDefault: boolean
}

export interface LauncherData {
  recentProjects: ProjectDraft[]
  lastProject: ProjectDraft | null
  gateSession?: boolean
  bootstrap?: {
    reason: "ambiguous" | "missing-spec" | "missing-target" | "missing-map" | "stale-map" | "target-unreachable"
    step: 1 | 2
    draft: ProjectDraft
    discovery: ProjectDiscovery
    notice: string
  } | null
  warning: string
  defaults: {
    projectPath: string
    sourceType: ProjectSourceType
    mapPolicy: MapStoragePolicy
    mode: "map" | "review"
  }
}

export interface LocalPathListing {
  current: string
  parent: string | null
  items: {
    name: string
    path: string
    type: "directory" | "file"
  }[]
}

export interface CandidateTarget {
  element: HTMLElement
  confidence: number
  selector: string
  fingerprint: ElementFingerprint
}

export interface ViewportPreset {
  id: string
  label: string
  shortLabel: string
  width: number
  height: number
  frame: "browser" | "device"
}
