import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { WorkbenchConfig } from "@/types"
import { changePrdReview, loadPrdReview, type PrdReviewResponse } from "./prd-review-api"

export function usePrdReview(config: WorkbenchConfig | null, setConfig: Dispatch<SetStateAction<WorkbenchConfig | null>>) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  const versionRef = useRef(-1)
  versionRef.current = config?.prdReview?.version ?? -1
  const sessionId = config?.prdReview?.sessionId
  const accept = (result: PrdReviewResponse) => setConfig(current => {
    if (current?.prdReview?.sessionId !== result.review.sessionId || current.prdReview.version > result.review.version) return current
    return { ...current, prd: result.document, prdReview: result.review }
  })
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const request = sequence.current
      try {
        const result = await loadPrdReview(versionRef.current)
        if (!cancelled && request === sequence.current) {
          setConfig(current => {
            if (current?.prdReview?.sessionId !== sessionId) return current
            if (!("review" in result)) return current.prdReview.agentConnected === result.agentConnected ? current : { ...current, prdReview: { ...current.prdReview, agentConnected: result.agentConnected } }
            return current.prdReview.version <= result.review.version ? { ...current, prd: result.document, prdReview: result.review } : current
          })
        }
      } catch (caught) {
        if (!cancelled && request === sequence.current) {
          setError(caught instanceof Error ? caught.message : "连接中断；批注保留在本机，请回原任务恢复会话。")
          setConfig(current => current?.prdReview?.sessionId === sessionId
            ? { ...current, prdReview: { ...current.prdReview, agentConnected: false } } : current)
        }
      }
      if (!cancelled) timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId, setConfig])
  const mutate = async (action: string, extra: Record<string, unknown> = {}) => {
    const review = config?.prdReview
    if (!review || busy) return null
    sequence.current += 1
    setBusy(true)
    setError("")
    try {
      const result = await changePrdReview({ action, token: review.token, version: review.version, revision: review.revision, ...extra })
      accept(result)
      return result.review
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，意见未丢失")
      // A claim can win a race with withdrawal. Refresh immediately to show the actual state.
      try {
        const latest = await loadPrdReview(-1)
        if ("review" in latest) {
          accept(latest)
          const batch = latest.review.batches.find(item => item.id === extra.batchId)
          if (batch && (action === "submit" || (action === "withdraw" && batch.status === "withdrawn") || (action === "stop" && ["stop_requested", "stopped"].includes(batch.status)))) {
            setError("")
            return latest.review
          }
        }
      } catch { /* Retain the action error. */ }
      return null
    } finally { setBusy(false) }
  }
  return { error, busy, mutate }
}
