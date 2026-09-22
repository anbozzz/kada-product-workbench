import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { GripHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SpecOverviewFloat({ collapsed, onExpand, children }: {
  collapsed: boolean
  onExpand: () => void
  children: ReactNode
}) {
  const element = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const resize = useRef<{ id: number; x: number; width: number } | null>(null)
  const [preferredWidth, setPreferredWidth] = useState(360)
  const [dragging, setDragging] = useState(false)
  const width = collapsed ? 190 : Math.min(preferredWidth, Math.max(0, bounds.width - 24))
  const height = collapsed ? 40 : Math.max(0, bounds.height - 24)
  const clamp = (left: number, top: number) => ({
    left: Math.max(12, Math.min(left, bounds.width - width - 12)),
    top: Math.max(12, Math.min(top, bounds.height - height - 12)),
  })
  useLayoutEffect(() => {
    const parent = element.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => setBounds({ width: parent.clientWidth, height: parent.clientHeight }))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (bounds.width) setPosition(previous => clamp(previous.left, previous.top))
  }, [bounds.width, bounds.height, collapsed, width])
  return <div ref={element} data-testid="spec-overview-float"
    className={`absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-2xl ring-1 ring-black/20`}
    style={{ ...position, width, height, visibility: bounds.width ? undefined : "hidden" }}>
    <div className="flex shrink-0 items-center border-b border-white/5">
      <button type="button" aria-label="拖动 Spec 总览" title="拖动调整位置；方向键微调"
        className={`${dragging ? "cursor-grabbing" : "cursor-grab"} flex h-9 min-w-9 touch-none items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground ${collapsed ? "px-2" : "w-full"}`}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...position }
          setDragging(true)
        }}
        onPointerMove={event => {
          const start = drag.current
          if (start?.id !== event.pointerId) return
          setPosition(clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y))
        }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key]
          if (!delta) return
          event.preventDefault()
          setPosition(clamp(position.left + delta[0], position.top + delta[1]))
        }}>
        <GripHorizontal className="size-4" />{collapsed ? null : "拖动调整位置"}
      </button>
      {collapsed ? <Button variant="ghost" size="sm" onClick={onExpand}>展开 Spec 总览</Button> : null}
    </div>
    {!collapsed ? <div role="separator" tabIndex={0} aria-label="调整 Spec 总览宽度" aria-orientation="vertical" aria-valuemin={Math.min(320, width)} aria-valuemax={Math.min(480, Math.max(0, bounds.width - 24))} aria-valuenow={Math.round(width)} title="拖动调整宽度（320–480px）"
      className="absolute inset-y-3 right-0 z-10 w-2 cursor-col-resize touch-none rounded-full transition-colors hover:bg-emerald-400/40 focus-visible:bg-emerald-400/40 focus-visible:outline-none"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        resize.current = { id: event.pointerId, x: event.clientX, width }
      }}
      onPointerMove={event => {
        const start = resize.current
        if (start?.id !== event.pointerId) return
        setPreferredWidth(Math.max(320, Math.min(480, start.width + event.clientX - start.x)))
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onLostPointerCapture={() => { resize.current = null }}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        setPreferredWidth(event.key === "Home" ? 320 : event.key === "End" ? 480 : Math.max(320, Math.min(480, width + (event.key === "ArrowLeft" ? -20 : 20))))
      }} /> : null}
    <div className={collapsed ? "hidden" : "min-h-0 flex-1"}>{children}</div>
  </div>
}
