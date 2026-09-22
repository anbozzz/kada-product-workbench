import { LoaderCircle, Square, Undo2 } from "lucide-react"
import type { PrdReviewState } from "@/types"

type Batch = PrdReviewState["batches"][number]
const labels: Record<Batch["status"], string> = {
  queued: "等待中 · 已存本机", processing: "处理中 · 原任务已领取", needs_review: "等待核对 · 不会自动执行",
  stop_requested: "正在请求停止 · 尚未确认", stopped: "已停止 · 已写内容不回滚", withdrawn: "已撤回 · 可继续编辑", published: "已完成 · 新版已发布",
}
export function PrdReviewQueue({ state, busy, hasDraft, onWithdraw, onStop, onRestore }: {
  state: PrdReviewState; busy: boolean; hasDraft: boolean
  onWithdraw: (batch: Batch) => void; onStop: (batch: Batch) => void; onRestore: (batch: Batch) => void
}) {
  const pending = state.batches.filter(batch => ["queued", "processing", "stop_requested", "needs_review"].includes(batch.status))
  const history = state.batches.filter(batch => !pending.includes(batch)).slice().reverse()
  const card = (batch: Batch) => <details key={batch.id} className="rounded-lg border border-white/10 bg-muted/20 px-2.5 py-2 text-xs" data-testid="prd-queue-batch" data-batch-id={batch.id} data-status={batch.status}>
    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded focus-visible:outline-2">
      <span className="flex min-w-0 items-center gap-1.5">
        {["processing", "stop_requested"].includes(batch.status) ? <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" /> : null}
        <span>第 {state.batches.indexOf(batch) + 1} 批 · {batch.annotations.length} 条</span>
        <span className={batch.status === "needs_review" || batch.status === "stop_requested" ? "text-amber-200" : "text-muted-foreground"}>{labels[batch.status]}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {["queued", "needs_review"].includes(batch.status) ? <button type="button" disabled={busy} className="flex min-h-7 items-center gap-1 rounded px-2 hover:bg-white/10 disabled:opacity-40" onClick={event => { event.preventDefault(); onWithdraw(batch) }}><Undo2 className="size-3" />撤回编辑</button> : null}
        {batch.status === "processing" ? <button type="button" disabled={busy} className="flex min-h-7 items-center gap-1 rounded px-2 hover:bg-white/10 disabled:opacity-40" onClick={event => { event.preventDefault(); onStop(batch) }}><Square className="size-3" />停止</button> : null}
        {batch.status === "withdrawn" && state.status !== "ended" ? <button type="button" disabled={busy || hasDraft} title={hasDraft ? "先发送或清空当前草稿，不会覆盖它" : "取回为新的待发草稿"} className="min-h-7 rounded px-2 hover:bg-white/10 disabled:opacity-40" onClick={event => { event.preventDefault(); onRestore(batch) }}>继续编辑</button> : null}
        <span className="text-muted-foreground">查看</span>
      </span>
    </summary>
    <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
      {batch.summary ? <p className="whitespace-pre-wrap text-muted-foreground">{batch.summary}</p> : null}
      {batch.status === "stop_requested" ? <p className="text-amber-200">等待原任务检查并确认停止；不会回滚已写内容。需要立即中断时，请在 Codex 中停止任务。</p> : null}
      {batch.annotations.map(item => <div key={item.id}>{item.anchor ? <blockquote className="mb-1 whitespace-pre-wrap border-l border-white/20 pl-2 text-muted-foreground">{item.anchor.quote}</blockquote> : null}<p className="whitespace-pre-wrap">{item.comment}</p></div>)}
    </div>
  </details>
  return state.batches.length ? <div aria-label="批次队列" data-testid="prd-review-queue" className="mb-2 space-y-2">
    {pending.length ? <div className="max-h-40 space-y-1.5 overflow-y-auto">{pending.map(card)}</div> : null}
    {history.length ? <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">批次历史 · {history.length}</summary><div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto">{history.map(card)}</div></details> : null}
  </div> : null
}
