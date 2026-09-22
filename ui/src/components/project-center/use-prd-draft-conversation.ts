import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"

import type { PrdDraftJob, ProjectDraft } from "@/types"
import {
  cancelPrdDraftJob,
  readPrdDraftJob,
  startPrdDraftJob,
} from "./project-center-api"

type UsePrdDraftConversationOptions = {
  draft: ProjectDraft
  model: string
  effort: string
  setNotice: Dispatch<SetStateAction<string>>
  onCompleted: (job: PrdDraftJob) => Promise<void>
}

export function usePrdDraftConversation({
  draft,
  model,
  effort,
  setNotice,
  onCompleted,
}: UsePrdDraftConversationOptions) {
  const [starting, setStarting] = useState(false)
  const [job, setJob] = useState<PrdDraftJob | null>(null)

  const reset = useCallback(() => setJob(null), [])
  const busy = starting || job?.status === "queued" || job?.status === "running"

  const applyCompleted = useCallback(async (completed: PrdDraftJob) => {
    setJob(completed)
    await onCompleted(completed)
    toast.success("PRD 标准化草稿已准备完成")
  }, [onCompleted])

  const start = useCallback(async () => {
    if (!draft.projectPath.trim() || !draft.prdPath.trim()) {
      toast.error("请先选择需要标准化的原始 PRD")
      return
    }
    if (!model || !effort) {
      toast.error("请先选择 Codex 模型和推理强度")
      return
    }
    if (busy) return
    setStarting(true)
    setJob(null)
    setNotice("正在创建可在 Codex 左侧任务列表中查看的 PRD 草稿任务…")
    try {
      const started = await startPrdDraftJob({
        projectPath: draft.projectPath,
        sourcePrdPath: draft.prdPath,
        model,
        effort,
      })
      if (started.status === "completed") await applyCompleted(started)
      else setJob(started)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "PRD 草稿任务启动失败"
      const now = new Date().toISOString()
      setJob({
        id: "",
        status: "failed",
        message: "PRD 标准化草稿生成失败",
        error: message,
        sourcePrdPath: draft.prdPath,
        sourcePrdRevision: "",
        draftPath: "",
        draftRevision: "",
        threadId: "",
        threadTitle: "",
        model,
        effort,
        createdAt: now,
        updatedAt: now,
      })
      setNotice(message)
      toast.error(message)
    } finally {
      setStarting(false)
    }
  }, [applyCompleted, busy, draft.prdPath, draft.projectPath, effort, model, setNotice])

  useEffect(() => {
    const jobId = job?.id
    if (!jobId || !["queued", "running"].includes(job.status)) return
    let disposed = false
    let timer = 0
    let delay = 700
    const poll = async () => {
      try {
        const current = await readPrdDraftJob(jobId)
        if (disposed) return
        if (current.status === "completed") {
          await applyCompleted(current)
          return
        }
        setJob(current)
        if (current.status === "failed") {
          setNotice(current.error || current.message)
          toast.error(current.error || current.message)
          return
        }
        if (current.status === "cancelled") {
          setNotice(current.message)
          return
        }
        delay = Math.min(3_000, Math.round(delay * 1.35))
        timer = window.setTimeout(() => void poll(), delay)
      } catch (caught) {
        if (disposed) return
        const message = caught instanceof Error ? caught.message : "无法读取 PRD 草稿生成状态"
        setNotice(message)
        toast.error(message)
      }
    }
    void poll()
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [applyCompleted, job?.id, job?.status, setNotice])

  const cancel = useCallback(async () => {
    if (!job?.id) return
    try {
      const cancelled = await cancelPrdDraftJob(job.id)
      setJob(cancelled)
      setNotice(cancelled.message)
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "取消失败")
    }
  }, [job?.id, setNotice])

  return {
    busy,
    cancel,
    job,
    reset,
    start,
  }
}
