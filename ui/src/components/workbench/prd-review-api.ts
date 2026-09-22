import { postJson, requestJson } from "@/lib/api-client"
import type { PrdDocumentView, PrdReviewState } from "@/types"

export interface PrdReviewResponse { review: PrdReviewState; document: PrdDocumentView }
export const loadPrdReview = (version: number) => requestJson<PrdReviewResponse | { agentConnected: boolean }>(`/api/prd-review?version=${version}`, undefined, "无法连接 PRD 评审服务")
export const changePrdReview = (body: Record<string, unknown>) => postJson<PrdReviewResponse>("/api/prd-review", body, "PRD 批注操作失败")
