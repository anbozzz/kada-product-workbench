import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { PrdReviewAnnotation } from "@/types"
import { findPrdQuoteRange } from "./prd-selection-popover"

/** Paint ranges without inserting elements into React's Markdown or search results. */
export function PrdAnnotationHighlights({ root, annotations, enabled }: {
  root: HTMLElement | null
  annotations: PrdReviewAnnotation[]
  enabled: boolean
}) {
  const [hover, setHover] = useState<{ comments: string[]; x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keepOpen = () => clearTimeout(hideTimer.current)
  const hideSoon = () => { keepOpen(); hideTimer.current = setTimeout(() => setHover(null), 160) }
  useEffect(() => {
    if (!root || !enabled || typeof Highlight === "undefined" || !CSS.highlights) return
    let ranges: { range: Range; comment: string }[] = []
    const clearHover = () => { clearTimeout(hideTimer.current); setHover(null) }
    const leave = () => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(clearHover, 160) }
    const rebuild = () => {
      clearHover()
      ranges = annotations.flatMap(item => {
        const range = item.anchor && findPrdQuoteRange(root, item.anchor)
        return range ? [{ range, comment: item.comment }] : []
      })
      CSS.highlights.set("prd-annotations", new Highlight(...ranges.map(item => item.range)))
    }
    rebuild()
    const observer = new MutationObserver(rebuild)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    const move = (event: MouseEvent) => {
      if (window.getSelection()?.toString()) { clearHover(); return }
      const comments = ranges.filter(({ range }) => [...range.getClientRects()].some(rect =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
      )).map(item => item.comment)
      if (!comments.length) { leave(); return }
      clearTimeout(hideTimer.current)
      setHover({ comments, x: Math.min(event.clientX + 12, Math.max(8, window.innerWidth - 336)), y: Math.min(event.clientY + 16, Math.max(8, window.innerHeight - 180)) })
    }
    root.addEventListener("mousemove", move)
    root.addEventListener("mouseleave", leave)
    root.addEventListener("mousedown", clearHover)
    window.addEventListener("scroll", clearHover, true)
    window.addEventListener("resize", clearHover)
    return () => {
      observer.disconnect()
      CSS.highlights.delete("prd-annotations")
      root.removeEventListener("mousemove", move)
      root.removeEventListener("mouseleave", leave)
      root.removeEventListener("mousedown", clearHover)
      window.removeEventListener("scroll", clearHover, true)
      window.removeEventListener("resize", clearHover)
      clearHover()
    }
  }, [root, annotations, enabled])
  return enabled && hover ? createPortal(
    <div role="tooltip" data-testid="prd-annotation-tooltip" onMouseEnter={keepOpen} onMouseLeave={hideSoon} className="pointer-events-auto fixed z-[90] max-h-40 w-80 max-w-[calc(100vw-16px)] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/15 bg-popover p-3 text-sm text-popover-foreground shadow-xl" style={{ left: hover.x, top: hover.y }}>
      {hover.comments.map((comment, index) => <p key={index} className="not-first:mt-2">{comment}</p>)}
    </div>, document.body,
  ) : null
}
