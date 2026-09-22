import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import { toast } from "sonner"

import type {
  CodexModelOption,
  ProjectDraft,
  ProjectionJob,
} from "@/types"
import {
  cancelProjectionJob,
  loadCodexModels as loadCodexModelOptions,
  readProjectionJob,
  startProjectionJob,
} from "./project-center-api"

type UseProjectionConversationOptions = {
  draft: ProjectDraft
  setDraft: Dispatch<SetStateAction<ProjectDraft>>
  setNotice: Dispatch<SetStateAction<string>>
  setStep: Dispatch<SetStateAction<1 | 2 | 3>>
  step: 1 | 2 | 3
  codexRequired: boolean
  targetReady: boolean
  mapReady: boolean
}

export function useProjectionConversation({
  draft,
  setDraft,
  setNotice,
  setStep,
  step,
  codexRequired,
  targetReady,
  mapReady,
}: UseProjectionConversationOptions) {
  const [projectionStarting, setProjectionStarting] = useState(false)
  const [projectionJob, setProjectionJob] = useState<ProjectionJob | null>(null)
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>([])
  const [codexModelsLoading, setCodexModelsLoading] = useState(false)
  const [codexModelsError, setCodexModelsError] = useState("")
  const [codexModel, setCodexModel] = useState("")
  const [codexEffort, setCodexEffort] = useState("")

  const resetProjection = useCallback(() => setProjectionJob(null), [])

  const loadCodexModels = useCallback(async () => {
    setCodexModelsLoading(true)
    setCodexModelsError("")
    try {
      const result = await loadCodexModelOptions()
      const models = result.models || []
      if (!models.length) throw new Error("当前 Codex 账号没有可用模型")
      const fallback = models.find((model) => model.isDefault) || models[0]
      setCodexModels(models)
      setCodexModel(fallback.id)
      setCodexEffort(fallback.defaultReasoningEffort)
    } catch (caught) {
      setCodexModelsError(caught instanceof Error ? caught.message : "无法读取 Codex 模型")
    } finally {
      setCodexModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (
      step !== 2 ||
      !codexRequired ||
      codexModels.length ||
      codexModelsLoading ||
      codexModelsError
    ) return
    void loadCodexModels()
  }, [
    codexModels.length,
    codexModelsError,
    codexModelsLoading,
    loadCodexModels,
    codexRequired,
    step,
  ])

  const projectionBusy =
    projectionStarting ||
    projectionJob?.status === "queued" ||
    projectionJob?.status === "running"

  const selectedCodexModel = useMemo(
    () => codexModels.find((model) => model.id === codexModel) || null,
    [codexModel, codexModels],
  )

  const selectCodexModel = useCallback((modelId: string) => {
    const model = codexModels.find((item) => item.id === modelId)
    setCodexModel(modelId)
    if (model) setCodexEffort(model.defaultReasoningEffort)
  }, [codexModels])

  const applyCompletedProjection = useCallback((job: ProjectionJob) => {
    setProjectionJob(job)
    setDraft((current) => ({ ...current, specPath: job.specPath }))
    setNotice("Codex 已生成并校验工作台视图。")
    toast.success("工作台视图已准备完成")
    if (targetReady && mapReady) setStep(3)
  }, [mapReady, setDraft, setNotice, setStep, targetReady])

  const startProjection = useCallback(async (force = false) => {
    if (!draft.projectPath.trim() || !draft.sourceSpecPath.trim()) {
      toast.error("请先选择原始 Markdown Spec")
      return
    }
    if (!codexModel || !codexEffort) {
      toast.error("请先选择 Codex 模型和推理强度")
      return
    }
    if (projectionBusy) return
    setProjectionStarting(true)
    setProjectionJob(null)
    setNotice("正在创建可在 Codex 左侧任务列表中查看的对话…")
    try {
      const job = await startProjectionJob({
        projectPath: draft.projectPath,
        sourceType: draft.sourceType,
        htmlPath: draft.htmlPath,
        devUrl: draft.devUrl,
        sourceSpecPath: draft.sourceSpecPath,
        model: codexModel,
        effort: codexEffort,
        force,
      })
      if (job.status === "completed") applyCompletedProjection(job)
      else setProjectionJob(job)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "工作台视图生成任务启动失败"
      const now = new Date().toISOString()
      setProjectionJob({
        id: "",
        status: "failed",
        message: "工作台视图生成失败",
        error: message,
        sourceSpecPath: draft.sourceSpecPath,
        sourceSpecRevision: "",
        specPath: "",
        threadId: "",
        threadTitle: "",
        model: codexModel,
        effort: codexEffort,
        createdAt: now,
        updatedAt: now,
      })
      setNotice(message)
      toast.error(message)
    } finally {
      setProjectionStarting(false)
    }
  }, [
    applyCompletedProjection,
    codexEffort,
    codexModel,
    draft.devUrl,
    draft.htmlPath,
    draft.projectPath,
    draft.sourceSpecPath,
    draft.sourceType,
    projectionBusy,
    setNotice,
  ])

  useEffect(() => {
    const jobId = projectionJob?.id
    if (!jobId || !["queued", "running"].includes(projectionJob.status)) return
    let disposed = false
    let timer = 0
    let delay = 700
    const poll = async () => {
      try {
        const job = await readProjectionJob(jobId)
        if (disposed) return
        if (job.status === "completed") {
          applyCompletedProjection(job)
          return
        }
        setProjectionJob(job)
        if (job.status === "failed") {
          setNotice(job.error || job.message)
          toast.error(job.error || job.message)
          return
        }
        if (job.status === "cancelled") {
          setNotice(job.message)
          return
        }
        delay = Math.min(3_000, Math.round(delay * 1.35))
        timer = window.setTimeout(() => void poll(), delay)
      } catch (caught) {
        if (disposed) return
        const message = caught instanceof Error ? caught.message : "无法读取工作台视图生成状态"
        setNotice(message)
        toast.error(message)
      }
    }
    void poll()
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [applyCompletedProjection, projectionJob?.id, setNotice])

  const cancelProjection = useCallback(async () => {
    if (!projectionJob?.id) return
    try {
      const result = await cancelProjectionJob(projectionJob.id)
      setProjectionJob(result)
      setNotice(result.message)
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "取消失败")
    }
  }, [projectionJob?.id, setNotice])

  return {
    cancelProjection,
    codexEffort,
    codexModel,
    codexModels,
    codexModelsError,
    codexModelsLoading,
    loadCodexModels,
    projectionBusy,
    projectionJob,
    resetProjection,
    selectCodexModel,
    selectedCodexModel,
    setCodexEffort,
    startProjection,
  }
}
