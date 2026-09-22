import { postJson, requestJson } from "@/lib/api-client"
import type {
  CodexModelOption,
  ProjectDiscovery,
  ProjectDraft,
  PrdDraftJob,
  ProjectionJob,
  WorkbenchConfig,
  LocalPathListing,
} from "@/types"

export type ProjectRemovalPreview = {
  id: string
  name: string
  projectPath: string
  mapPolicy: ProjectDraft["mapPolicy"]
  deleteToolMaps: boolean
  mappingFileCount: number
  mappingCount: number
}

export const reopenProject = (id: string) =>
  postJson<WorkbenchConfig>("/api/project/reopen", { id }, "无法恢复 Spec 绑定工作台")

export const previewProjectRemoval = (id: string) =>
  postJson<ProjectRemovalPreview>("/api/project/remove-preview", { id }, "无法检查项目删除范围")

export const removeProject = (id: string) =>
  postJson<{
    recentProjects: ProjectDraft[]
    lastProject: ProjectDraft | null
    deletedToolMaps: number
    deletedMappings: number
  }>("/api/project/remove", { id, confirm: true }, "项目移除失败")

export const scanProject = (draft: ProjectDraft) =>
  postJson<ProjectDiscovery>("/api/project/scan", {
    projectPath: draft.projectPath,
    sourceType: draft.sourceType,
    devUrl: draft.devUrl,
    specPath: draft.specPath,
    sourceSpecPath: draft.sourceSpecPath,
  }, "项目扫描失败")

export const saveProjectDraft = (draft: ProjectDraft) =>
  postJson<{ project: ProjectDraft }>("/api/project/save-draft", draft, "配置保存失败")

export const confirmProject = (draft: ProjectDraft) =>
  postJson<WorkbenchConfig>("/api/project/confirm", draft, "项目来源确认失败")

export const dismissProjectBootstrap = () =>
  requestJson<{ ok: true }>(
    "/api/project/bootstrap/dismiss",
    { method: "POST" },
    "无法关闭启动提示",
  )

export const listLocalPath = (path: string, kind: string) => {
  const search = new URLSearchParams({ path, kind })
  return requestJson<LocalPathListing>(
    `/api/fs/list?${search.toString()}`,
    undefined,
    "无法读取本地路径",
  )
}

export const loadCodexModels = () =>
  requestJson<{ models: CodexModelOption[] }>(
    "/api/codex/models",
    undefined,
    "无法读取 Codex 模型",
  )

export const startProjectionJob = (body: {
  projectPath: string
  sourceType: ProjectDraft["sourceType"]
  htmlPath: string
  devUrl: string
  sourceSpecPath: string
  model: string
  effort: string
  force: boolean
}) => postJson<ProjectionJob>("/api/project/projection", body, "工作台视图生成任务启动失败")

export const readProjectionJob = (jobId: string) =>
  requestJson<ProjectionJob>(
    `/api/project/projection/${encodeURIComponent(jobId)}`,
    undefined,
    "无法读取工作台视图生成状态",
  )

export const cancelProjectionJob = (jobId: string) =>
  requestJson<ProjectionJob>(
    `/api/project/projection/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
    "取消失败",
  )

export const startPrdDraftJob = (body: {
  projectPath: string
  sourcePrdPath: string
  model: string
  effort: string
}) => postJson<PrdDraftJob>("/api/project/prd-draft", body, "PRD 草稿任务启动失败")

export const readPrdDraftJob = (jobId: string) =>
  requestJson<PrdDraftJob>(
    `/api/project/prd-draft/${encodeURIComponent(jobId)}`,
    undefined,
    "无法读取 PRD 草稿生成状态",
  )

export const cancelPrdDraftJob = (jobId: string) =>
  requestJson<PrdDraftJob>(
    `/api/project/prd-draft/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
    "取消失败",
  )
