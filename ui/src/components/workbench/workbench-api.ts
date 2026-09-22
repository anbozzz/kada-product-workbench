import { ApiError, postJson, requestJson } from "@/lib/api-client"
import type {
  LauncherData,
  PrdMap,
  ProductSpecBundle,
  ReviewBaseline,
  SpecMap,
  WorkbenchConfig,
} from "@/types"

export const loadLauncherData = () =>
  requestJson<LauncherData>("/api/launcher", undefined, "无法读取项目中心")

export async function loadWorkbenchConfig(): Promise<WorkbenchConfig | null> {
  try {
    return await requestJson<WorkbenchConfig>("/api/config", undefined, "无法读取工作台配置")
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === "PROJECT_REQUIRED") {
      return null
    }
    throw error
  }
}

export const saveSpecDraft = (body: {
  nodeId: string
  productSpec: ProductSpecBundle
  baseRevision: string
}) => postJson<{
  productSpec: ProductSpecBundle
  specRevision: string
  sourceSpecRevision?: string
  specDocument?: WorkbenchConfig["specDocument"]
  changeCount: number
  saveTarget: "codex-gate-draft" | "source-spec-markdown" | "spec-json"
  reviewBaseline: ReviewBaseline
}>("/api/spec", body, "修订草稿保存失败")

export const saveSpecPageMap = (body: { baseRevision: string; specMap: SpecMap }) =>
  postJson<{
    updatedAt: string
    mapRevision: string
    reviewBaseline: ReviewBaseline
  }>("/api/map", body, "映射保存失败")

export const savePrdPageMap = (body: { baseRevision: string; prdMap: PrdMap }) =>
  postJson<{
    updatedAt: string
    prdMapRevision: string
    reviewBaseline: ReviewBaseline
  }>("/api/prd-map", body, "PRD 页面关联保存失败")

export const submitReviewToCodex = () =>
  requestJson<{ ok: true }>(
    "/api/review/submit",
    { method: "POST" },
    "无法提交给 Codex",
  )

export const prepareReviewPackage = () =>
  requestJson<{
    id: string
    filename: string
    bytes: number
    fileCount: number
    expiresAt: string
  }>(
    "/api/review-package/prepare",
    { method: "POST" },
    "只读评审包生成失败",
  )

export const closeCurrentProject = () =>
  requestJson<{ ok: true }>(
    "/api/project/close",
    { method: "POST" },
    "无法返回项目中心",
  )

export type DocumentUpdateStatus = { changed: boolean; documents: string[]; baseline?: string; error?: string }
export const checkDocuments = () => requestJson<DocumentUpdateStatus>("/api/document-updates", undefined, "无法检查文档更新")
export const reloadDocuments = (baseline: string) => postJson<{ config: WorkbenchConfig; warnings: string[] }>("/api/document-updates", { baseline }, "加载失败，当前仍为旧版")
