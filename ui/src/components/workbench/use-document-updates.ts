import { useEffect, useRef, useState } from "react"
import type { WorkbenchConfig } from "@/types"
import { checkDocuments, reloadDocuments, type DocumentUpdateStatus } from "./workbench-api"

export function useDocumentUpdates(config: WorkbenchConfig | null, blocked: string, accept: (config: WorkbenchConfig, warnings: string[]) => void) {
  const [status, setStatus] = useState<DocumentUpdateStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const current = useRef({ config, blocked, accept })
  current.current = { config, blocked, accept }
  const sessionId = config?.reviewBaseline?.sessionId
  const enabled = Boolean(config?.documentUpdates && !config.prdReview && !config.reviewPackage?.portable)
  const busy = useRef(false)
  const sequence = useRef(0)
  useEffect(() => {
    setStatus(null)
    setError("")
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const request = sequence.current
      if (!document.hidden && !busy.current) {
        try {
          const next = await checkDocuments()
          if (!cancelled && !busy.current && request === sequence.current) setStatus(next)
        } catch {
          if (!cancelled) setStatus({ changed: true, documents: [], error: "暂时无法检查文档更新，当前仍为已载入版本" })
        }
      }
      if (!cancelled) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, sessionId])
  const reload = async () => {
    if (busy.current || current.current.blocked) return
    sequence.current += 1
    busy.current = true
    setLoading(true)
    setError("")
    const started = current.current.config
    try {
      // 最新检查同时取得会话基线，避免把旧标签页的内容覆盖到新会话。
      const checked = await checkDocuments()
      if (started?.reviewBaseline?.sessionId !== current.current.config?.reviewBaseline?.sessionId) return
      if (current.current.blocked) throw new Error(current.current.blocked)
      if (!checked.baseline) throw new Error(checked.error || "无法取得文档版本，请重试")
      const result = await reloadDocuments(checked.baseline)
      if (started?.reviewBaseline?.sessionId !== current.current.config?.reviewBaseline?.sessionId) return
      current.current.accept(result.config, result.warnings)
      setStatus(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败，当前仍为旧版；可以重试")
    } finally {
      busy.current = false
      setLoading(false)
    }
  }
  return { status, loading, error, reload }
}
