import { buildRevisionDiff, type DiffRow } from "@/lib/prd-revision-diff"
import { setRuntimeDirty } from "@/components/runtime/runtime-state"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Check, X } from "lucide-react"
import { Dialog } from "radix-ui"
import { Button } from "@/components/ui/button"
import { PromptBar } from "@/components/beautiful-ui/prompt-bar"
import { PrdSelectionPopover } from "./prd-selection-popover"
import { PrdReviewQueue } from "./prd-review-queue"
import type { PrdReviewAnnotation, PrdReviewState } from "@/types"

export type PrdSelection = NonNullable<PrdReviewAnnotation["anchor"]> & { revision: string }
export interface PrdReviewControls {
  state: PrdReviewState
  busy: boolean
  error: string
  mutate: (action: string, extra?: Record<string, unknown>) => Promise<PrdReviewState | null>
}
type Draft = {
  revision: string
  comment: string
  kind: PrdReviewAnnotation["kind"]
  quotes: (PrdSelection & { id: string })[]
  annotations: PrdReviewAnnotation[]
  batchId: string
  inline?: { id: string; anchor: PrdSelection; comment: string; kind: PrdReviewAnnotation["kind"] } | null
}
const emptyDraft = (revision: string, annotations: PrdReviewAnnotation[] = []): Draft => ({ revision, comment: "", kind: "comment", quotes: [], annotations, batchId: crypto.randomUUID() })
// Older drafts retain their original intent; new passage feedback is always a free-text suggestion.
const kindLabel = (kind: PrdReviewAnnotation["kind"]) => ({ general: "全文建议", comment: "修改建议", replace: "历史建议：替换", delete: "历史建议：删除" })[kind]

export function PrdReviewPanel({ review, selection, onClearSelection, onLocate, resolveRange, preview, onPreviewChange: setPreview, onDraftChange }: {
  review: PrdReviewControls; selection: (PrdSelection & { range: Range }) | null; onClearSelection: () => void; onLocate: (line: number) => void
  resolveRange: (anchor: PrdSelection) => Range | null
  preview: string | null; onPreviewChange: (value: string | null) => void
  onDraftChange: (annotations: PrdReviewAnnotation[]) => void
}) {
  const { state, busy, error, mutate } = review
  const storageKey = `ips-prd-composer:${state.sessionId}`
  const [draft, setDraft] = useState<Draft>(() => {
    if (state.status !== "reviewing") return emptyDraft(state.revision)
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || sessionStorage.getItem(`${storageKey}:${state.revision}`) || "null") as Draft | null
      if (saved && typeof saved.comment === "string" && Array.isArray(saved.quotes) && Array.isArray(saved.annotations) && saved.batchId) return { ...saved, revision: saved.revision || state.revision }
    } catch { /* Recover from server if browser storage is unavailable. */ }
    return emptyDraft(state.draftRevision, state.annotations)
  })
  const [storageError, setStorageError] = useState(false)
  const [inlineRange, setInlineRange] = useState<Range | null>(null)
  const [anchorError, setAnchorError] = useState("")
  const [notice, setNotice] = useState("")
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)
  const latest = state.batches.findLast(batch => batch.status === "published")
  const hasDraft = Boolean(draft.comment || draft.quotes.length || draft.annotations.length || draft.inline)
  const staleDraft = hasDraft && draft.revision !== state.revision
  useEffect(() => { setRuntimeDirty('prd-review', hasDraft); return () => setRuntimeDirty('prd-review', false) }, [hasDraft])
  const hasOpenWork = hasDraft || state.batches.some(batch => ["queued", "processing", "stop_requested", "needs_review"].includes(batch.status))
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch, batchId: crypto.randomUUID() }))
  useEffect(() => {
    onDraftChange(staleDraft ? [] : [...draft.annotations, ...draft.quotes.map(item => ({ id: item.id, kind: draft.kind, comment: draft.comment, anchor: item }))])
  }, [draft, staleDraft, onDraftChange])
  useEffect(() => {
    if (!hasDraft && draft.revision !== state.revision) setDraft(emptyDraft(state.revision))
    if (staleDraft) { setInlineRange(null); window.getSelection()?.removeAllRanges() }
  }, [state.revision, draft.revision, hasDraft, staleDraft])
  useEffect(() => {
    try {
      if (state.status === "reviewing") sessionStorage.setItem(storageKey, JSON.stringify(draft))
      else sessionStorage.removeItem(storageKey)
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [draft, state.status, storageKey])
  useEffect(() => {
    if (!selection || state.status !== "reviewing" || busy) return
    if (staleDraft) { setNotice("旧版意见仍保留。请先核对并适配新版，再选择新的内容。"); onClearSelection(); return }
    const { range, ...anchor } = selection
    // A new text selection never takes the user to the bottom composer.
    // Preserve the previous typed evaluation locally when moving to another passage.
    setDraft(current => ({ ...current,
      annotations: current.inline?.comment.trim() ? [...current.annotations, { ...current.inline, comment: current.inline.comment.trim() }] : current.annotations,
      inline: { id: crypto.randomUUID(), anchor, kind: "comment", comment: "" }, batchId: crypto.randomUUID(),
    }))
    setInlineRange(range)
    setAnchorError("")
    onClearSelection()
  }, [selection, state.status, busy, staleDraft, onClearSelection])
  const dismissInline = () => {
    if (!draft.inline?.comment.trim()) update({ inline: null })
    setInlineRange(null)
    window.getSelection()?.removeAllRanges()
  }
  const cancelInline = () => { update({ inline: null }); setAnchorError(""); dismissInline() }
  const addInline = () => {
    if (!draft.inline?.comment.trim()) return
    update({ annotations: [...draft.annotations, { ...draft.inline, comment: draft.inline.comment.trim() }], inline: null })
    dismissInline()
  }
  const resumeInline = () => {
    if (!draft.inline) return
    if (staleDraft) { setAnchorError("原版选区暂不定位到新版；请先添加到待发列表，然后核对新版。"); return }
    const range = resolveRange(draft.inline.anchor)
    if (!range) { setAnchorError("原选区暂不可定位。意见仍已保留，可添加到待发列表或取消；不会重新绑定到别处。"); return }
    range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "auto" })
    setInlineRange(range)
    setAnchorError("")
  }
  const outgoing: PrdReviewAnnotation[] = [
    ...draft.annotations,
    ...(draft.comment.trim() ? draft.quotes.length
      ? draft.quotes.map(item => ({ id: item.id, kind: draft.kind, comment: draft.comment.trim(), anchor: item }))
      : [{ id: draft.batchId, kind: "general" as const, comment: draft.comment.trim(), anchor: null }] : []),
  ]
  const canSend = state.status === "reviewing" && !busy && !staleDraft && !draft.inline && outgoing.length > 0 && (!draft.quotes.length || Boolean(draft.comment.trim())) && outgoing.every(item => item.comment.trim())
  const send = async () => {
    if (!canSend || sending.current) return
    sending.current = true
    try {
      if (await mutate("submit", { annotations: outgoing, batchId: draft.batchId })) {
        setDraft(current => current.batchId === draft.batchId ? emptyDraft(state.revision) : current)
        setNotice("整批已保存到本机队列，可以继续编写下一批。")
        setPreview(null)
        onClearSelection()
      }
    } finally { sending.current = false }
  }
  const remove = (id: string) => update({ quotes: draft.quotes.filter(item => item.id !== id), annotations: draft.annotations.filter(item => item.id !== id) })
  const selectedQuote = draft.quotes.find(item => item.id === preview)
  const selectedAnnotation = draft.annotations.find(item => item.id === preview)
  const cards = [
    ...draft.annotations.map(item => ({ id: item.id, quote: item.anchor?.quote, line: item.anchor?.startLine, comment: item.comment })),
    ...draft.quotes.map(item => ({ id: item.id, quote: item.quote, line: item.startLine, comment: "" })),
  ]
  const restore = (batch: PrdReviewState["batches"][number]) => {
    if (hasDraft) { setNotice("已撤回并保留在批次历史；当前草稿不受影响，可稍后继续编辑该批。"); return }
    setDraft(emptyDraft(batch.baseRevision, batch.annotations))
    setNotice("已取回为待发草稿；编辑完成后请重新发送整批。")
  }
  return (
    <section className="shrink-0 border-t border-white/8 bg-background px-4 py-3 sm:px-6" aria-label="PRD 批注" data-testid="prd-review-panel">
      {error || storageError ? <p role="alert" className="mb-2 text-xs text-amber-200">{error || "浏览器无法暂存草稿，请勿刷新或关闭页面；发送后仍会保存到本机。"}</p> : null}
      <PrdReviewQueue state={state} busy={busy} hasDraft={hasDraft} onRestore={restore}
        onWithdraw={batch => void mutate("withdraw", { batchId: batch.id }).then(result => { if (result) restore(batch) })}
        onStop={batch => void mutate("stop", { batchId: batch.id })} />
      {notice ? <p role="status" className="mb-2 text-xs text-muted-foreground">{notice}</p> : null}
      {latest?.status === "published" ? <details className="mb-2 text-xs" data-testid="prd-revision-summary">
        <summary className="cursor-pointer text-emerald-300">新版已发布 · 查看修订说明与上批意见</summary>
        <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-muted/30 p-3">
          <p className="mb-2 whitespace-pre-wrap">{latest.summary}</p>
          {latest.annotations.map(item => <p key={item.id} className="my-1 text-muted-foreground">{item.anchor?.quote ? `“${item.anchor.quote}” — ` : "全文意见 — "}{item.comment}</p>)}
        </div>
      </details> : null}
      {state.status === "reviewing" ? <>
        {staleDraft ? <div role="status" className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/5 p-2 text-xs text-amber-200" data-testid="prd-stale-draft">
          <p>正文已更新，当前旧版草稿仍保留。核对后适配新版；冲突引用需要移除并重新选择。</p>
          <button type="button" disabled={busy || Boolean(draft.inline) || !outgoing.length} className="mt-1 min-h-7 rounded px-2 underline disabled:opacity-40" onClick={() => void mutate("rebase", { annotations: outgoing, baseRevision: draft.revision }).then(result => { if (result) { setDraft(emptyDraft(result.revision, result.annotations)); setNotice("引用已按唯一原文上下文适配；请预览核对后发送。") } })}>已核对，适配新版</button>
        </div> : null}
        {draft.inline && inlineRange && !busy ? <PrdSelectionPopover key={draft.inline.id} range={inlineRange} comment={draft.inline.comment}
          onCommentChange={comment => update({ inline: { ...draft.inline!, comment } })}
          onAdd={addInline} onDismiss={dismissInline} onCancel={cancelInline} /> : null}
        {draft.inline ? <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="prd-pending-evaluation">
          <span>{inlineRange ? "正在选区旁评价" : "有一条未完成的选区评价"}</span>
          {!inlineRange ? <button type="button" className="text-blue-300 hover:underline" onClick={resumeInline}>继续评价</button> : null}
          {!inlineRange && draft.inline.comment.trim() ? <button type="button" className="text-blue-300 hover:underline" onClick={addInline}>添加到待发列表</button> : null}
          <button type="button" className="hover:text-foreground" onClick={cancelInline}>取消这条评价</button>
          {anchorError ? <span role="alert" className="w-full text-amber-200">{anchorError}</span> : null}
        </div> : null}
        <PromptBar value={draft.comment} onValueChange={comment => update({ comment })} inputRef={textarea}
          onSend={() => void send()} canSend={canSend} busy={busy}
          placeholder={draft.quotes.length ? "继续填写旧版选区草稿的意见…" : "补充整批说明（可选）…"}
          references={cards.map(item => ({ id: item.id, label: item.quote || item.comment, description: item.quote ? item.comment : undefined, caption: item.line ? `L${item.line}` : undefined, onPreview: () => setPreview(item.id), onRemove: () => remove(item.id) }))}
          onPreview={() => setPreview("all")} canPreview={hasDraft}
          mode={<span className="px-1.5">{outgoing.length ? `${outgoing.length} 条 · 发送整批` : "选中文字就地评价"}</span>}
          actions={[
            { label: "再加一条意见", disabled: !draft.comment.trim(), onSelect: () => { update({ annotations: outgoing, quotes: [], comment: "" }); textarea.current?.focus() } },
            { label: "预览全部待发内容", disabled: !hasDraft, onSelect: () => setPreview("all") },
          ]}
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span role="status" data-testid="prd-receiver-status" data-connected={state.agentConnected} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${state.agentConnected ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300" : "border-amber-300/25 bg-amber-300/10 text-amber-300"}`}>
              <span className={`size-1.5 shrink-0 rounded-full ${state.agentConnected ? "bg-emerald-300" : "bg-amber-300"}`} />
              {state.agentConnected ? "接收已就绪" : "接收未就绪"}
            </span>
            <span>{state.agentConnected ? "正在等待批注" : "发送仅加入本机队列"}；对话结束后暂不能自动唤起</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <button className="rounded px-1 py-1 hover:text-foreground disabled:opacity-40" disabled={busy || hasOpenWork} onClick={() => void mutate("end", { annotations: [] })}>结束评审</button>
            <button className="rounded-md border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 font-medium text-emerald-200 hover:bg-emerald-300/15 disabled:opacity-40" disabled={busy || hasOpenWork} onClick={() => void mutate("confirm", { annotations: [] })}>确认当前版本</button>
          </span>
        </div>
      </> : state.status === "confirmation_requested" ? <div role="status" className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.04] p-4">
        <div className="flex items-center gap-2 text-sm"><span className="size-2 animate-pulse rounded-full bg-emerald-300" /><strong>已提交确认，等待 Codex 完成正式文档确认</strong></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">工作台不会直接改写或移动 PRD；原任务将按产品文档流程确认当前 revision，完成后这里会显示最终结果。</p>
      </div> : state.status === "confirmed" ? <div role="status" className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.04] p-4">
        <div className="flex items-center gap-2 text-sm"><Check className="size-4 text-emerald-300" /><strong>当前版本已确认</strong></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">正式 PRD 已由原任务完成状态与 revision 复核。{state.confirmedPath ? `确认文件：${state.confirmedPath}` : ""}</p>
      </div> : <div role="status" className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <div className="flex items-center gap-2 text-sm"><Check className="size-4 text-emerald-300" /><strong>本轮评审已结束</strong></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">可继续查看正文和差异；结束不代表确认或冻结 PRD。</p>
      </div>}
      <Dialog.Root open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setPreview(null) }} className="fixed top-1/2 left-1/2 z-[90] flex max-h-[80vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-white/15 bg-popover p-5 shadow-2xl" data-testid="prd-feedback-preview">
            <Dialog.Title className="pr-8 text-base font-semibold">{preview === "all" ? "发送内容预览" : "引用内容"}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs leading-5 text-muted-foreground">{preview === "all" ? "以下意见将交给原 Codex 对话，只用于修订当前 PRD。" : "核对选中的原文；关闭预览后可以继续输入或选择其他片段。"}</Dialog.Description>
            <Dialog.Close asChild><Button size="icon-sm" variant="ghost" className="absolute top-3 right-3" aria-label="关闭预览"><X /></Button></Dialog.Close>
            <div className="mt-4 min-h-0 space-y-4 overflow-y-auto">
              {preview === "all" ? <>
                {draft.inline ? <p className="text-sm text-amber-200">有一条选区评价尚未添加，请返回原选区完成或取消后再发送。</p> : null}
                {outgoing.map((item, index) => <div key={item.id} className="rounded-xl border border-white/10 p-3" data-testid="prd-outgoing-annotation">
                  <p className="mb-2 text-xs text-muted-foreground">{index + 1}. {kindLabel(item.kind)}{item.anchor ? ` · L${item.anchor.startLine}–${item.anchor.endLine}` : ""}</p>
                  {item.anchor ? <blockquote className="mb-3 whitespace-pre-wrap border-l-2 border-emerald-300/60 pl-3 text-sm text-muted-foreground">{item.anchor.quote}</blockquote> : null}
                  <p className="whitespace-pre-wrap text-sm leading-6">{item.comment}</p>
                </div>)}
                {draft.quotes.length && !draft.comment.trim() ? <p className="text-sm text-amber-200">已选择 {draft.quotes.length} 处内容，请返回输入框填写修改意见。</p> : null}
              </> : <>
                {selectedQuote || selectedAnnotation?.anchor ? <div>
                  <p className="mb-2 text-xs text-muted-foreground">原文 L{(selectedQuote || selectedAnnotation?.anchor)?.startLine}–{(selectedQuote || selectedAnnotation?.anchor)?.endLine}</p>
                  <blockquote className="whitespace-pre-wrap rounded-xl border border-white/10 bg-background/50 p-4 text-sm leading-7">{selectedQuote?.quote || selectedAnnotation?.anchor?.quote}</blockquote>
                </div> : null}
                {selectedAnnotation ? <label className="block space-y-2 text-xs text-muted-foreground">修改这条意见<textarea aria-label="编辑已有意见" rows={3} maxLength={4000} className="w-full rounded-lg border border-white/15 bg-background p-3 text-sm text-foreground outline-none focus:border-emerald-300" value={selectedAnnotation.comment} onChange={event => update({ annotations: draft.annotations.map(item => item.id === selectedAnnotation.id ? { ...item, comment: event.target.value } : item) })} /></label> : null}
              </>}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              {preview !== "all" && (selectedQuote || selectedAnnotation?.anchor) ? <Button variant="ghost" size="sm" className="mr-auto" onClick={() => { const line = (selectedQuote || selectedAnnotation?.anchor)!.startLine; setPreview(null); onLocate(line) }}>定位原文</Button> : null}
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>{preview === "all" ? "返回编辑" : "关闭预览"}</Button>
              {preview === "all" ? <Button size="sm" disabled={!canSend} onClick={() => void send()}><ArrowUp className="size-4" />发送给原 Codex 任务</Button> : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

function RevisionRows({ rows }: { rows: DiffRow[] }) {
  return <div className="font-mono text-xs leading-6">{rows.map((row, index) => <div key={index} data-diff-kind={row.kind} className="flex items-start gap-2 px-3">
    <span className="w-9 shrink-0 select-none text-right text-muted-foreground" aria-label="上一版行号">{row.oldLine ?? ""}</span>
    <span className="w-9 shrink-0 select-none text-right text-muted-foreground" aria-label="当前版行号">{row.newLine ?? ""}</span>
    <span className={`w-3 shrink-0 ${row.kind === "removed" ? "text-red-300" : row.kind === "added" ? "text-emerald-300" : "text-muted-foreground"}`}>{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : " "}</span>
    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{row.kind === "equal" ? row.text || " " : (row.parts ?? [{ text: row.text || " ", changed: true }]).map((part, partIndex) => part.changed
      ? <mark key={partIndex} className={row.kind === "removed" ? "bg-red-400/20 text-red-200" : "bg-emerald-400/20 text-emerald-200"}>{part.text}</mark>
      : <span key={partIndex}>{part.text}</span>)}</span>
  </div>)}</div>
}

export function PrdRevisionDiff({ before, after }: { before: string; after: string }) {
  const { sections, limited } = useMemo(() => buildRevisionDiff(before, after), [before, after])
  const count = sections.filter(section => section.kind === "change").length
  return <div data-testid="prd-revision-diff" className="space-y-3 p-5 text-xs">
    {limited ? <>
      <p role="status">本轮变化较大，暂未完成精确分块。以下保留两版原文供核对；可返回“正文”阅读当前版。</p>
      <details><summary className="cursor-pointer">上一版原文</summary><pre className="whitespace-pre-wrap break-words">{before}</pre></details>
      <details><summary className="cursor-pointer">当前版原文</summary><pre className="whitespace-pre-wrap break-words">{after}</pre></details>
    </> : count === 0 ? <p>本批未修改正文，请查看修订说明。</p> : <>
      <p className="leading-5 text-muted-foreground">共 {count} 个变化区段。红色 − 为删除，绿色 + 为新增；每处保留前后两行，未改内容可展开。行号依次为上一版、当前版。</p>
      {sections.map((section, index) => section.kind === "gap"
        ? <details key={index} data-testid="prd-diff-gap" className="rounded-lg border border-border/50 py-2">
          <summary className="cursor-pointer px-3 text-muted-foreground">未修改的 {section.rows.length} 行（展开／收起）</summary>
          <RevisionRows rows={section.rows} />
        </details>
        : <section key={index} data-testid="prd-diff-hunk" className="overflow-hidden rounded-lg border border-border/70 py-2">
          <h3 className="mb-2 border-b border-border/50 px-3 pb-2 font-medium">{section.heading}</h3>
          <RevisionRows rows={section.rows} />
        </section>)}
    </>}
  </div>
}
