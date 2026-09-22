import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Grip, ImageOff, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PrdImage({ alt, image }: { alt: string; image?: { src?: string; error?: string } }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLSpanElement>(null)
  const dragRef = useRef<{ x: number; y: number; width: number } | null>(null)
  const [width, setWidth] = useState(420)
  const [availableWidth, setAvailableWidth] = useState(420)
  const [natural, setNatural] = useState({ width: 720, height: 720 })
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const src = image?.src && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z\d+/=]+$/i.test(image.src) ? image.src : ""
  const label = alt || "PRD 参考图片"
  const minimum = Math.min(160, availableWidth)
  const clamp = (next: number) => Math.max(minimum, Math.min(availableWidth, next))

  useEffect(() => {
    setFailed(false)
    setWidth(420)
  }, [src])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { x: event.clientX, y: event.clientY, width: cardRef.current?.getBoundingClientRect().width || width }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic test pointers may not be active. */ }
  }
  const moveResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const start = dragRef.current
    if (!start) return
    event.preventDefault()
    const dx = event.clientX - start.x
    const dy = (event.clientY - start.y) * natural.width / natural.height
    setWidth(clamp(start.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy)))
  }
  const endResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const baseZoomWidth = Math.max(1, Math.min(natural.width, window.innerWidth - 96, (window.innerHeight - 180) * natural.width / natural.height))

  return (
    <span ref={containerRef} className="prd-image my-6 block w-full" data-testid="prd-image">
      {!src || failed ? (
        <span className="block rounded-xl border border-dashed border-amber-400/25 bg-amber-400/5 p-4 text-sm" role="status">
          <span className="flex items-center gap-2 text-amber-200"><ImageOff className="size-4" />{label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{image?.error || (failed ? "图片无法解码，请检查原文件。" : "当前配置未包含图片，请重新打开项目来源。")}</span>
        </span>
      ) : (
        <DialogPrimitive.Root open={expanded} onOpenChange={(open) => { setExpanded(open); if (!open) setZoom(1) }}>
          <span ref={cardRef} className="relative block max-w-full overflow-hidden rounded-xl border border-white/12 bg-[#0b1118]" style={{ width }} data-testid="prd-image-card">
            <span className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={label}>{label}</span>
              <DialogPrimitive.Trigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`放大查看图片：${label}`} title="放大查看图片"><Maximize2 /></Button>
              </DialogPrimitive.Trigger>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`重置图片大小：${label}`} title="重置图片大小" onClick={() => setWidth(clamp(420))}><RotateCcw /></Button>
            </span>
            <img src={src} alt={label} draggable={false} className="block h-auto w-full" onError={() => setFailed(true)} onLoad={(event) => {
              const img = event.currentTarget
              setNatural({ width: img.naturalWidth, height: img.naturalHeight })
            }} />
            <span className="block py-1.5 pr-9 pl-3 text-[10px] leading-5 text-muted-foreground">拖动右下角调整大小 · 保持图片比例</span>
            <span
              role="separator" tabIndex={0} aria-label={`调整图片大小：${label}`} aria-orientation="vertical"
              aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(availableWidth)} aria-valuenow={Math.round(Math.min(width, availableWidth))}
              className="absolute right-0 bottom-0 grid size-9 cursor-nwse-resize touch-none place-items-center rounded-tl-lg bg-emerald-400/10 text-emerald-300 outline-none hover:bg-emerald-400/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300"
              data-testid="prd-image-resize-handle"
              onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { dragRef.current = null }}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
                event.preventDefault()
                setWidth(clamp(Math.min(width, availableWidth) + (["ArrowRight", "ArrowDown"].includes(event.key) ? 24 : -24)))
              }}
            ><Grip className="size-4" /></span>
          </span>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/72 backdrop-blur-sm" />
            <DialogPrimitive.Content className="fixed inset-4 z-[71] flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0b1118] shadow-2xl outline-none sm:inset-8" data-testid="prd-image-dialog">
              <header className="flex shrink-0 items-center gap-2 border-b border-white/10 p-3">
                <span className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="truncate text-sm font-semibold">{label}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">图片等比例缩放，不修改原文件；放大后可滚动查看。</DialogPrimitive.Description>
                </span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="缩小图片" disabled={zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value - 0.25))}><Minus /></Button>
                <span className="w-12 text-center text-xs" aria-live="polite">{Math.round(zoom * 100)}%</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="放大图片" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.25))}><Plus /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="适应窗口" onClick={() => setZoom(1)}><RotateCcw /></Button>
                <DialogPrimitive.Close asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="关闭图片放大查看"><X /></Button></DialogPrimitive.Close>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <img src={src} alt={label} draggable={false} className="mx-auto block h-auto max-w-none" style={{ width: baseZoomWidth * zoom }} data-testid="prd-image-zoom" />
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </span>
  )
}
