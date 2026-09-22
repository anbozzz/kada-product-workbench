import { useCallback, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react"
import { useDroppable } from "@dnd-kit/react"
import {
  Expand,
  WandSparkles,
  Hand,
  Laptop,
  LoaderCircle,
  Minus,
  Plus,
  ScanSearch,
  Smartphone,
  Tablet,
  X,
} from "lucide-react"
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  AUTO_VIEWPORT_FALLBACK,
  inferViewportFromDocument,
  VIEWPORT_PRESETS,
} from "@/lib/viewports"
import {
  acceleratedWheelZoomTarget,
  normalizedWheelZoomDelta,
  wheelZoomSmoothingAlpha,
} from "@/lib/zoom-motion"

const MIN_ZOOM = 0.25
const MAX_ZOOM = 1.6
const ZOOM_STEP = 0.01
const FLOATING_CONTROLS_SAFE_INSET = 56
const hintKey = (project: string, kind: string) => `ips.canvas-hint.v2:${encodeURIComponent(project)}:${kind}`
const hintVisible = (project: string, kind: string) => {
  try { return localStorage.getItem(hintKey(project, kind)) !== "1" } catch { return true }
}

const isTextEntryTarget = (target: EventTarget | null) => {
  if (!target || typeof (target as Element).closest !== "function") return false
  return Boolean(
    (target as Element).closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"),
  )
}

const isSpaceKey = (event: KeyboardEvent) => event.code === "Space" || event.key === " "

export function CanvasWorkbench({
  targetUrl,
  projectKey,
  batchBinding,
  mappingActive,
  dragging,
  frameRef,
  onFrameLoad,
  onFrameProxyClick,
  onFrameProxyPointerMove,
  onFrameProxyPointerLeave,
}: {
  targetUrl: string
  projectKey: string
  batchBinding?: { count: number; disabled: boolean; onBind: () => void }
  mappingActive: boolean
  dragging: boolean
  frameRef: React.RefObject<HTMLIFrameElement | null>
  onFrameLoad: () => void
  onFrameProxyClick: (point: { x: number; y: number }) => void
  onFrameProxyPointerMove: (point: { x: number; y: number }) => boolean
  onFrameProxyPointerLeave: () => void
}) {
  const hasBatchBinding = Boolean(batchBinding)
  const [presetId, setPresetId] = useState("auto")
  const [detectedViewport, setDetectedViewport] = useState(AUTO_VIEWPORT_FALLBACK)
  const [zoom, setZoom] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [frameLoadRevision, setFrameLoadRevision] = useState(0)
  const [address, setAddress] = useState("本地页面")
  const [autoFit, setAutoFit] = useState(true)
  const [buttonPanMode, setButtonPanMode] = useState(false)
  const [spacePanActive, setSpacePanActive] = useState(false)
  const [panning, setPanning] = useState(false)
  const [markerHovered, setMarkerHovered] = useState(false)
  const [showCanvasHint, setShowCanvasHint] = useState(() => hintVisible(projectKey, "controls"))
  const [showModeHint, setShowModeHint] = useState(() => hintVisible(projectKey, "mode"))
  useEffect(() => {
    setShowCanvasHint(hintVisible(projectKey, "controls"))
    setShowModeHint(hintVisible(projectKey, "mode"))
  }, [projectKey])
  const dismissHint = (kind: "controls" | "mode") => {
    if (kind === "controls") setShowCanvasHint(false)
    else setShowModeHint(false)
    try { localStorage.setItem(hintKey(projectKey, kind), "1") } catch { /* 当前页面仍可关闭。 */ }
  }
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pointerInsideCanvasRef = useRef(false)
  const spacePanActiveRef = useRef(false)
  const suppressClickUntilRef = useRef(0)
  const wheelZoomMotionRef = useRef({
    frame: 0,
    targetScale: 1,
    focalX: 0,
    focalY: 0,
    contentX: 0,
    contentY: 0,
    lastEventAt: 0,
    lastFrameAt: 0,
    direction: 0,
    streak: 0,
  })
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: "target-canvas",
    data: { type: "target-canvas" },
  })
  const viewportOptions = [detectedViewport, ...VIEWPORT_PRESETS]
  const preset = presetId === "auto"
    ? detectedViewport
    : VIEWPORT_PRESETS.find((item) => item.id === presetId) ?? detectedViewport
  const isDevice = preset.frame === "device"
  const isPhone = isDevice && preset.width <= 600
  const deviceInset = isDevice ? (isPhone ? 8 : 6) : 0
  const chromeHeight = isDevice ? 0 : 36
  const canvasWidth = preset.width + deviceInset * 2
  const canvasHeight = preset.height + deviceInset * 2 + chromeHeight
  const panMode = buttonPanMode || spacePanActive
  const currentModeCopy = mappingActive
    ? { title: "映射定位", detail: "点击页面目标建立映射，按 Esc 退出并继续操作页面" }
    : panMode
      ? spacePanActive && !buttonPanMode
        ? { title: "拖动画布", detail: "空格按住期间拖动页面，松开空格恢复页面操作" }
        : { title: "拖动画布", detail: "持续拖动模式已开启，再次点击底部按钮退出" }
      : { title: "可操作页面", detail: "点击页面上的 Spec 标记直接查看定义" }

  const stopWheelZoomAnimation = useCallback(() => {
    const motion = wheelZoomMotionRef.current
    if (motion.frame) window.cancelAnimationFrame(motion.frame)
    motion.frame = 0
    motion.lastFrameAt = 0
    motion.lastEventAt = 0
    motion.direction = 0
    motion.streak = 0
    motion.targetScale = transformRef.current?.state.scale ?? 1
  }, [])

  const fitCanvas = useCallback((animate = true) => {
    stopWheelZoomAnimation()
    const viewport = viewportRef.current
    const transform = transformRef.current
    if (!viewport || !transform) return
    const availableWidth = Math.max(1, viewport.clientWidth - 48)
    const availableHeight = Math.max(
      1,
      viewport.clientHeight - 48 - FLOATING_CONTROLS_SAFE_INSET - (hasBatchBinding ? 40 : 0),
    )
    const scale = Math.max(
      0.25,
      Math.min(1, availableWidth / canvasWidth, availableHeight / canvasHeight),
    )
    transform.centerView(scale, animate ? 180 : 0, "easeOut")
    setZoom(scale)
  }, [canvasHeight, canvasWidth, stopWheelZoomAnimation, hasBatchBinding])

  const zoomByStep = useCallback((direction: 1 | -1) => {
    stopWheelZoomAnimation()
    setAutoFit(false)
    const transform = transformRef.current
    const viewport = viewportRef.current
    if (!transform || !viewport) return
    const { scale, positionX, positionY } = transform.state
    const currentPercent = Math.round(scale * 100)
    const targetScale = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, (currentPercent + direction * ZOOM_STEP * 100) / 100),
    )
    if (targetScale === scale) return
    const centerX = viewport.clientWidth / 2
    const centerY = viewport.clientHeight / 2
    const contentCenterX = (centerX - positionX) / scale
    const contentCenterY = (centerY - positionY) / scale
    transform.setTransform(
      centerX - contentCenterX * targetScale,
      centerY - contentCenterY * targetScale,
      targetScale,
      70,
      "easeOut",
    )
    setZoom(targetScale)
  }, [stopWheelZoomAnimation])

  const runWheelZoomFrame = useCallback(() => {
    const motion = wheelZoomMotionRef.current
    const transform = transformRef.current
    if (!transform) {
      motion.frame = 0
      return
    }
    const now = performance.now()
    const elapsed = motion.lastFrameAt ? now - motion.lastFrameAt : 16
    motion.lastFrameAt = now
    const currentScale = transform.state.scale
    const difference = motion.targetScale - currentScale
    if (Math.abs(difference) < 0.0004 && now - motion.lastEventAt > 42) {
      transform.setTransform(
        motion.focalX - motion.contentX * motion.targetScale,
        motion.focalY - motion.contentY * motion.targetScale,
        motion.targetScale,
        0,
      )
      setZoom(motion.targetScale)
      motion.frame = 0
      motion.lastFrameAt = 0
      return
    }
    const nextScale = currentScale + difference * wheelZoomSmoothingAlpha(elapsed)
    transform.setTransform(
      motion.focalX - motion.contentX * nextScale,
      motion.focalY - motion.contentY * nextScale,
      nextScale,
      0,
    )
    setZoom(nextScale)
    motion.frame = window.requestAnimationFrame(runWheelZoomFrame)
  }, [])

  const queueWheelZoom = useCallback((event: {
    clientX: number
    clientY: number
    deltaMode: number
    deltaY: number
  }) => {
    setAutoFit(false)
    const transform = transformRef.current
    const viewport = viewportRef.current
    if (!transform || !viewport) return
    const delta = normalizedWheelZoomDelta(event)
    if (!delta) return
    const { scale, positionX, positionY } = transform.state
    const viewportRect = viewport.getBoundingClientRect()
    const focalX = event.clientX - viewportRect.left
    const focalY = event.clientY - viewportRect.top
    const contentX = (focalX - positionX) / scale
    const contentY = (focalY - positionY) / scale
    const now = performance.now()
    const motion = wheelZoomMotionRef.current
    const next = acceleratedWheelZoomTarget({
      currentScale: scale,
      pendingTargetScale: motion.frame ? motion.targetScale : scale,
      delta,
      previousDirection: motion.direction,
      previousStreak: motion.streak,
      lastEventAt: motion.lastEventAt,
      now,
      minScale: MIN_ZOOM,
      maxScale: MAX_ZOOM,
    })
    if (next.targetScale === scale && !motion.frame) return
    motion.targetScale = next.targetScale
    motion.focalX = focalX
    motion.focalY = focalY
    motion.contentX = contentX
    motion.contentY = contentY
    motion.lastEventAt = now
    motion.direction = next.direction
    motion.streak = next.streak
    if (!motion.frame) {
      motion.lastFrameAt = now
      motion.frame = window.requestAnimationFrame(runWheelZoomFrame)
    }
  }, [runWheelZoomFrame])

  const handleCanvasWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    queueWheelZoom(event)
  }, [queueWheelZoom])

  const releaseExternalControlFocus = useCallback(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (viewportRef.current?.contains(active)) return
    active.blur()
  }, [])

  const setTemporarySpacePan = useCallback((active: boolean) => {
    spacePanActiveRef.current = active
    setSpacePanActive(active)
    if (!active) setPanning(false)
  }, [])

  const handleSpaceKeyDown = useCallback((event: KeyboardEvent, fromFrame: boolean) => {
    if (!isSpaceKey(event)) return false
    if (mappingActive || dragging || isTextEntryTarget(event.target)) return false
    if (!fromFrame && !pointerInsideCanvasRef.current) return false
    event.preventDefault()
    event.stopPropagation()
    if (!spacePanActiveRef.current) {
      setTemporarySpacePan(true)
      setMarkerHovered(false)
      onFrameProxyPointerLeave()
    }
    return true
  }, [dragging, mappingActive, onFrameProxyPointerLeave, setTemporarySpacePan])

  const handleSpaceKeyUp = useCallback((event: KeyboardEvent) => {
    if (!isSpaceKey(event) || !spacePanActiveRef.current) return false
    event.preventDefault()
    event.stopPropagation()
    setTemporarySpacePan(false)
    return true
  }, [setTemporarySpacePan])

  useEffect(() => {
    const frame = frameRef.current
    const frameWindow = frame?.contentWindow
    if (!frame || !frameWindow) return
    const handleFrameWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const frameRect = frame.getBoundingClientRect()
      const transformScale = transformRef.current?.state.scale ?? 1
      queueWheelZoom({
        clientX: frameRect.left + event.clientX * transformScale,
        clientY: frameRect.top + event.clientY * transformScale,
        deltaMode: event.deltaMode,
        deltaY: event.deltaY,
      })
    }
    frameWindow.addEventListener("wheel", handleFrameWheel, {
      capture: true,
      passive: false,
    })
    return () => frameWindow.removeEventListener("wheel", handleFrameWheel, true)
  }, [frameLoadRevision, frameRef, queueWheelZoom])

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    const frameDocument = frameRef.current?.contentDocument
    if (!frameWindow || !frameDocument) return
    const handleFrameKeyDown = (event: KeyboardEvent) => {
      handleSpaceKeyDown(event, true)
    }
    const handleFrameKeyUp = (event: KeyboardEvent) => {
      handleSpaceKeyUp(event)
    }
    const handleFramePointerDown = (event: PointerEvent) => {
      if (!isTextEntryTarget(event.target)) releaseExternalControlFocus()
    }
    frameWindow.addEventListener("keydown", handleFrameKeyDown, true)
    frameWindow.addEventListener("keyup", handleFrameKeyUp, true)
    frameDocument.addEventListener("pointerdown", handleFramePointerDown, true)
    return () => {
      frameWindow.removeEventListener("keydown", handleFrameKeyDown, true)
      frameWindow.removeEventListener("keyup", handleFrameKeyUp, true)
      frameDocument.removeEventListener("pointerdown", handleFramePointerDown, true)
    }
  }, [frameLoadRevision, frameRef, handleSpaceKeyDown, handleSpaceKeyUp, releaseExternalControlFocus])

  useEffect(() => stopWheelZoomAnimation, [stopWheelZoomAnimation])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (autoFit) fitCanvas(false)
      })
    })
    observer.observe(viewport)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [autoFit, fitCanvas])

  useEffect(() => {
    const timer = window.setTimeout(() => fitCanvas(true), 40)
    return () => window.clearTimeout(timer)
  }, [fitCanvas, presetId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (handleSpaceKeyDown(event, false)) return
      if (!event.metaKey && !event.ctrlKey) return
      if (["+", "="].includes(event.key)) {
        event.preventDefault()
        setAutoFit(false)
        zoomByStep(1)
      } else if (event.key === "-") {
        event.preventDefault()
        setAutoFit(false)
        zoomByStep(-1)
      } else if (event.key === "0") {
        event.preventDefault()
        setAutoFit(true)
        fitCanvas(true)
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      handleSpaceKeyUp(event)
    }
    const handleBlur = () => {
      setTemporarySpacePan(false)
      setPanning(false)
    }
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
      window.removeEventListener("blur", handleBlur)
    }
  }, [fitCanvas, handleSpaceKeyDown, handleSpaceKeyUp, setTemporarySpacePan, zoomByStep])

  useEffect(() => {
    if (!mappingActive && !dragging) return
    setButtonPanMode(false)
    setTemporarySpacePan(false)
    setPanning(false)
  }, [dragging, mappingActive, setTemporarySpacePan])

  const handleLoad = () => {
    setLoaded(true)
    setFrameLoadRevision((value) => value + 1)
    setDetectedViewport(inferViewportFromDocument(frameRef.current?.contentDocument ?? null))
    try {
      const location = frameRef.current?.contentWindow?.location
      if (location) setAddress(`${location.pathname}${location.search}${location.hash}`)
    } catch {
      setAddress("本地页面")
    }
    onFrameLoad()
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col bg-[#252525]" aria-label="页面画布">
      <div
        ref={viewportRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-[#2c2c2c]",
          panMode && !panning && "cursor-grab",
          panning && "cursor-grabbing",
        )}
        data-testid="canvas-viewport"
        data-zoom={zoom.toFixed(4)}
        onWheelCapture={handleCanvasWheel}
        onPointerDownCapture={releaseExternalControlFocus}
        onPointerEnter={() => {
          pointerInsideCanvasRef.current = true
        }}
        onPointerLeave={() => {
          pointerInsideCanvasRef.current = false
          setTemporarySpacePan(false)
          setPanning(false)
        }}
      >
        {showModeHint && <div data-testid="canvas-mode-hint" className="pointer-events-none absolute top-3 left-3 z-30 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-xl bg-background/92 px-2.5 py-1.5 shadow-sm ring-1 ring-foreground/8 backdrop-blur-sm">
          <Badge
            variant="secondary"
            className={cn(
              "rounded-full text-[11px]",
              mappingActive && "bg-emerald-400/10 text-emerald-300",
            )}
          >
            {currentModeCopy.title}
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground">
            {currentModeCopy.detail}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" className="pointer-events-auto size-6 shrink-0"
            aria-label="关闭画布模式提示" onClick={() => dismissHint("mode")}><X /></Button>
        </div>}

        <TransformWrapper
          ref={transformRef}
          minScale={MIN_ZOOM}
          maxScale={MAX_ZOOM}
          centerOnInit
          centerZoomedOut
          limitToBounds={false}
          smooth
          wheel={{ disabled: true }}
          trackPadPanning={{
            disabled: false,
            velocityDisabled: false,
          }}
          panning={{
            disabled: !panMode || mappingActive || dragging,
            allowLeftClickPan: panMode && !mappingActive && !dragging,
            excluded: mappingActive || dragging ? ['[data-testid="frame-interaction-layer"]'] : [],
          }}
          doubleClick={{ disabled: true }}
          onInit={() => window.setTimeout(() => fitCanvas(false), 0)}
          onTransform={(_, state) => setZoom(state.scale)}
          onPanningStart={(_, event) => {
            // Wheel panning shares this callback but has no reliable stop callback.
            // It must never acquire the drag interaction shield.
            if (event.type !== "wheel") setPanning(true)
          }}
          onPanningStop={(_, event) => {
            if (event.type === "wheel") return
            setPanning(false)
            suppressClickUntilRef.current = performance.now() + 160
          }}
        >
          <TransformComponent
            infinite
            wrapperClass="ips-transform-wrapper"
            contentClass="ips-transform-content"
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{ width: canvasWidth, height: canvasHeight }}
            wrapperProps={{
              role: "region",
              "aria-label": "可缩放页面画布，按住空格可临时平移，也可通过底部按钮持续平移",
            }}
          >
            <div
              ref={dropRef}
              className={cn(
                "relative grid overflow-hidden border bg-white shadow-[0_24px_60px_rgba(25,35,30,0.16)] transition-shadow",
                isDevice
                  ? isPhone
                    ? "rounded-[38px] border-black/55 bg-[#151815]"
                    : "rounded-[28px] border-black/45 bg-[#191c19]"
                  : "rounded-2xl border-black/15",
                isDropTarget && dragging && "ring-4 ring-emerald-500/25",
              )}
              style={{
                width: canvasWidth,
                height: canvasHeight,
                padding: deviceInset,
                gridTemplateRows: isDevice ? "1fr" : "36px 1fr",
              }}
              data-testid="target-canvas"
            >
              {!isDevice && (
                <div className="flex items-center gap-2 border-b bg-[#f7f6f3] px-3" aria-hidden="true">
                  <span className="size-2.5 rounded-full bg-rose-400" />
                  <span className="size-2.5 rounded-full bg-amber-400" />
                  <span className="size-2.5 rounded-full bg-emerald-500" />
                  <div className="ml-2 max-w-[56%] truncate rounded-lg bg-black/5 px-3 py-1 text-[10px] text-black/45">{address}</div>
                  <div className="ml-auto flex items-center gap-1 text-[9px] text-black/35"><Hand className="size-3" />空格按住 / 底栏切换</div>
                </div>
              )}
              {!loaded && (
                <div
                  className="absolute z-10 grid place-content-center justify-items-center gap-2 rounded-[inherit] bg-background text-xs text-muted-foreground"
                  style={{ left: deviceInset, right: deviceInset, top: isDevice ? deviceInset : 36, bottom: deviceInset }}
                >
                  <LoaderCircle className="size-5 animate-spin text-emerald-300" />
                  正在载入页面…
                </div>
              )}
              <iframe
                ref={frameRef}
                src={targetUrl}
                title="功能页面"
                className={cn("h-full w-full border-0 bg-white", isDevice && "rounded-[30px]")}
                onLoad={handleLoad}
              />
              <div
                className={cn(
                  "absolute z-20",
                  panMode
                    ? panning ? "cursor-grabbing" : "cursor-grab"
                    : markerHovered ? "cursor-pointer"
                      : mappingActive ? "cursor-crosshair"
                      : "cursor-default",
                  dragging && "bg-emerald-500/[0.025]",
                )}
                data-testid="frame-interaction-layer"
                data-mapping-active={mappingActive}
                aria-hidden="true"
                style={{
                  left: deviceInset,
                  right: deviceInset,
                  top: isDevice ? deviceInset : 36,
                  bottom: deviceInset,
                  pointerEvents:
                    mappingActive || dragging || panMode
                      ? "auto"
                      : "none",
                }}
                onClick={(event) => {
                  if (
                    dragging ||
                    panMode ||
                    panning ||
                    performance.now() < suppressClickUntilRef.current
                  ) return
                  onFrameProxyClick({ x: event.clientX, y: event.clientY })
                }}
                onPointerMove={(event) => {
                  if (panMode || panning) {
                    setMarkerHovered(false)
                    onFrameProxyPointerLeave()
                    return
                  }
                  setMarkerHovered(onFrameProxyPointerMove({ x: event.clientX, y: event.clientY }))
                }}
                onPointerLeave={() => {
                  setMarkerHovered(false)
                  onFrameProxyPointerLeave()
                }}
              />
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      <div
        className={cn(
          "pointer-events-none absolute inset-x-3 bottom-3 z-40 flex items-end justify-between gap-3",
        )}
        data-testid="canvas-controls"
        data-layout="floating"
      >
        {showCanvasHint ? (
          <div
            className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background/80 px-2 py-1 text-[10px] text-muted-foreground"
            data-testid="canvas-controls-hint"
          >
            <span className="truncate">
              Ctrl/⌘ + 滚轮：连续加速缩放 · 空格按住拖动 · 按钮持续拖动
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="pointer-events-auto size-6 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label="关闭画布操作提示"
              title="关闭后不再显示"
              onClick={() => dismissHint("controls")}
            ><X /></Button>
          </div>
        ) : null}
          {batchBinding ? <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" className="pointer-events-auto absolute right-0 bottom-full mb-2 shrink-0 rounded-xl bg-background/95 text-xs shadow-lg" data-testid="one-click-bind"
                disabled={batchBinding.disabled || !batchBinding.count || mappingActive || dragging}
                onClick={batchBinding.onBind}>
                <WandSparkles />一键绑定 · {batchBinding.count} 项
              </Button>
            </TooltipTrigger>
            <TooltipContent>仅绑定当前页面高关联且唯一的未绑定项；已有绑定与冲突项保持不变</TooltipContent>
          </Tooltip> : null}
        <div className="pointer-events-auto ml-auto flex shrink-0 max-w-full items-center gap-1.5 rounded-2xl bg-background/94 p-1.5 shadow-lg ring-1 ring-foreground/10">

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "rounded-xl bg-muted/55",
                  panMode && "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/35",
                )}
                data-testid="canvas-pan-toggle"
                aria-label="持续拖动画布"
                aria-pressed={panMode}
                disabled={mappingActive || dragging}
                onClick={() => {
                  setButtonPanMode((value) => !value)
                  setTemporarySpacePan(false)
                  setPanning(false)
                }}
              ><Hand /></Button>
            </TooltipTrigger>
            <TooltipContent>{buttonPanMode ? "退出持续拖动画布" : "持续拖动画布"}</TooltipContent>
          </Tooltip>

          <Select value={presetId} onValueChange={(value) => {
            setPresetId(value)
            setAutoFit(true)
          }}>
            <SelectTrigger size="sm" className="max-w-37 rounded-xl border-0 bg-muted/55 text-[10px] shadow-none">
              {presetId === "auto" ? (
                <ScanSearch className="size-3.5 text-muted-foreground" />
              ) : preset.id === "phone" ? (
                <Smartphone className="size-3.5 text-muted-foreground" />
              ) : preset.id === "tablet" ? (
                <Tablet className="size-3.5 text-muted-foreground" />
              ) : (
                <Laptop className="size-3.5 text-muted-foreground" />
              )}
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="center">
              {viewportOptions.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-xs">{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex h-7 items-center rounded-xl bg-muted/55">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-r-none"
                  aria-label="缩小画布"
                  onClick={() => {
                    setAutoFit(false)
                    zoomByStep(-1)
                  }}
                ><Minus /></Button>
              </TooltipTrigger>
              <TooltipContent>缩小（⌘−）</TooltipContent>
            </Tooltip>
            <output className="min-w-11 border-x border-foreground/8 px-1 text-center text-[10px] font-semibold" aria-live="polite">
              {Math.round(zoom * 100)}%
            </output>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-l-none"
                  aria-label="放大画布"
                  onClick={() => {
                    setAutoFit(false)
                    zoomByStep(1)
                  }}
                ><Plus /></Button>
              </TooltipTrigger>
              <TooltipContent>放大（⌘+）</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-xl bg-muted/55"
                aria-label="适应画布"
                onClick={() => {
                  setAutoFit(true)
                  fitCanvas(true)
                }}
              ><Expand /></Button>
            </TooltipTrigger>
            <TooltipContent>适应画布（⌘0）</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </section>
  )
}
