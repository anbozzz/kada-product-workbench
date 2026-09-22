import { useLayoutEffect, useMemo, useRef } from "react"
import { Popover } from "radix-ui"
import { ArrowUp, X } from "lucide-react"
import type { PrdReviewAnnotation } from "@/types"

function quoteTextNodes(root: HTMLElement | null, anchor: NonNullable<PrdReviewAnnotation["anchor"]>) {
  if (!root) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number; end: number }[] = []
  let text = "", node: Node | null
  while ((node = walker.nextNode())) {
    const block = node.parentElement?.closest<HTMLElement>("[data-prd-start]")
    if (!block || Number(block.dataset.prdStart) < anchor.startLine || Number(block.dataset.prdEnd) > anchor.endLine) continue
    nodes.push({ node: node as Text, start: text.length, end: text.length + (node.textContent || "").length })
    text += node.textContent || ""
  }
  return { nodes, text }
}

/** Recover only the selected occurrence, never the surrounding paragraph. */
export function findPrdQuoteRange(root: HTMLElement | null, anchor: NonNullable<PrdReviewAnnotation["anchor"]>) {
  const collected = quoteTextNodes(root, anchor)
  if (!collected) return null
  const { nodes, text } = collected
  // Rendered block boundaries may contribute extra whitespace to Selection.toString().
  const normalized = (value: string) => value.replace(/\s+/g, "")
  const quote = normalized(anchor.quote), flat = normalized(text)
  if (!quote) return null
  const matches: number[] = []
  for (let offset = flat.indexOf(quote); offset >= 0; offset = flat.indexOf(quote, offset + 1)) matches.push(offset)
  const start = anchor.quoteOccurrence === undefined ? (matches.length === 1 ? matches[0] : undefined) : matches[anchor.quoteOccurrence]
  if (start === undefined) return null
  const offsets: number[] = []
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) offsets.push(i)
  const from = offsets[start], to = offsets[start + quote.length - 1] + 1
  const first = nodes.find(item => from >= item.start && from < item.end)
  const last = nodes.find(item => to > item.start && to <= item.end)
  if (!first || !last) return null
  const range = document.createRange()
  range.setStart(first.node, from - first.start)
  range.setEnd(last.node, to - last.start)
  return range
}

/** Persist the selected occurrence when identical text repeats within a source span. */
export function prdQuoteOccurrence(root: HTMLElement, anchor: NonNullable<PrdReviewAnnotation["anchor"]>, range: Range) {
  const collected = quoteTextNodes(root, anchor)
  if (!collected) return undefined
  let prefix = ""
  for (const { node } of collected.nodes) {
    const probe = document.createRange()
    probe.selectNodeContents(node)
    if (range.compareBoundaryPoints(Range.START_TO_START, probe) <= 0) break
    if (range.startContainer === node) { prefix += node.data.slice(0, range.startOffset); break }
    prefix += node.data
  }
  const flat = collected.text.replace(/\s+/g, ""), quote = anchor.quote.replace(/\s+/g, "")
  const target = prefix.replace(/\s+/g, "").length
  if (!quote) return undefined
  let occurrence = 0
  for (let offset = flat.indexOf(quote); offset >= 0; offset = flat.indexOf(quote, offset + 1), occurrence++) {
    if (offset === target) return occurrence
  }
  return undefined
}

export function PrdSelectionPopover({ range, comment, onCommentChange, onAdd, onDismiss, onCancel }: {
  range: Range
  comment: string
  onCommentChange: (value: string) => void
  onAdd: () => void
  onDismiss: () => void
  onCancel: () => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement
  const viewport = element?.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => range.getBoundingClientRect() } }), [range])
  useLayoutEffect(() => {
    const textarea = input.current
    if (!textarea) return
    textarea.style.height = "0px"
    textarea.style.height = `${Math.min(128, Math.max(40, textarea.scrollHeight))}px`
  }, [comment])
  useLayoutEffect(() => {
    if (typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.set("prd-active-selection", new Highlight(range))
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopImmediatePropagation()
      dismiss.current()
    }
    const onScroll = () => {
      const rect = range.getBoundingClientRect(), bounds = viewport?.getBoundingClientRect()
      if (bounds && (rect.bottom < bounds.top || rect.top > bounds.bottom)) dismiss.current()
    }
    window.addEventListener("keydown", escape, true)
    viewport?.addEventListener("scroll", onScroll)
    return () => {
      if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete("prd-active-selection")
      window.removeEventListener("keydown", escape, true)
      viewport?.removeEventListener("scroll", onScroll)
    }
  }, [range, viewport])
  return <Popover.Root open modal={false} onOpenChange={open => { if (!open) onDismiss() }}>
    <Popover.Anchor virtualRef={anchor} />
    <Popover.Portal>
      <Popover.Content aria-label="评价选中内容" data-testid="prd-selection-popover" side="top" align="start" sideOffset={8}
        collisionBoundary={viewport} collisionPadding={8} updatePositionStrategy="always" sticky="always"
        onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus({ preventScroll: true }) }}
        onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => {
          if ((event.target as Element)?.closest('[data-testid="prd-drawer-resize-handle"]')) event.preventDefault()
        }}
        className="z-[75] w-[min(340px,var(--radix-popover-content-available-width))] max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-[#303133] p-2 text-foreground shadow-2xl outline-none">
        <div className="flex items-start gap-1">
          <textarea ref={input} rows={1} maxLength={4000} value={comment} aria-label="选区评价" placeholder="写下修改建议…"
            className="min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-5 outline-none placeholder:text-muted-foreground"
            onChange={event => onCommentChange(event.target.value)} onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault()
                if (comment.trim()) onAdd()
              }
            }} />
          <button type="button" aria-label="取消这条评价" title="取消这条评价" onClick={onCancel} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground focus-visible:outline-2"><X className="size-3.5" /></button>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" aria-label="添加评价到待发列表" title="添加评价（Enter）；换行（Shift + Enter）" disabled={!comment.trim()} onClick={onAdd}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-blue-500 px-2.5 text-xs text-white enabled:hover:bg-blue-400 disabled:opacity-40 focus-visible:outline-2">添加<ArrowUp className="size-3.5" /></button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
