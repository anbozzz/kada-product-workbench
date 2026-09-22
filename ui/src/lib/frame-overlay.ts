import {
  collectBindableTargets,
  elementFingerprint,
  EXPLICIT_SURFACE_SELECTOR,
  INTERACTIVE_SELECTOR,
  fingerprintMatches,
  isVisible,
  meaningfulTarget,
  querySelectorSafe,
  surfaceTargetScore,
  targetLabel,
} from "@/lib/spec-mapping"
import type {
  CandidateTarget,
  FlatSpecNode,
  SpecAnnotation,
  SpecMap,
  WorkMode,
} from "@/types"

const HOST_ID = "ips-overlay-host"
const MARKER_HIT_RADIUS = 12

const OVERLAY_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  #outlines { position: relative; z-index: 10; }
  #markers { position: relative; z-index: 20; }
  .marker {
    position: fixed; z-index: 20; width: 24px; height: 24px; display: grid;
    place-items: center; border: 0; border-radius: 999px;
    color: white; background: transparent; box-shadow: none;
    padding: 0; appearance: none; pointer-events: auto; cursor: pointer;
    font: 800 10px/1 Inter,-apple-system,sans-serif; isolation: isolate; overflow: visible;
    transform: translate(-50%,-50%) scale(1); transform-origin: center;
    transition: transform .16s ease,filter .16s ease;
  }
  .marker-dot {
    position: relative; z-index: 1; width: 13px; height: 13px; border: 2px solid white;
    border-radius: 999px; background: #0d6b50; box-shadow: 0 2px 8px rgba(0,0,0,.3);
    pointer-events: none; transition: transform .16s ease,box-shadow .16s ease;
  }
  .marker-count { position:absolute; top:-3px; right:-5px; z-index:3; min-width:15px; height:15px; padding:0 3px; display:grid; place-items:center; border-radius:9px; background:#0d6b50; color:white; border:1px solid white; pointer-events:none; font:700 10px/1 sans-serif; }
  .marker-hint {
    position: absolute; right: calc(100% + 8px); top: 50%; z-index: 2;
    max-width: 190px; padding: 6px 9px; border: 1px solid rgba(255,255,255,.16);
    border-radius: 7px; color: #fff; background: rgba(24,24,27,.96);
    box-shadow: 0 6px 18px rgba(0,0,0,.28); opacity: 0; pointer-events: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font: 650 11px/1.2 Inter,-apple-system,sans-serif;
    transform: translate(4px,-50%) scale(.96); transform-origin: right center;
    transition: opacity .14s ease,transform .14s ease;
  }
  .marker:hover,.marker:focus-visible,.marker.proxy-hover {
    outline: none; filter: brightness(1.08);
    transform: translate(-50%,-50%) scale(1);
  }
  .marker:hover .marker-dot,.marker:focus-visible .marker-dot,.marker.proxy-hover .marker-dot {
    transform: scale(1.18); box-shadow: 0 0 0 5px rgba(13,107,80,.2),0 4px 12px rgba(0,0,0,.3);
  }
  .marker:hover .marker-hint,.marker:focus-visible .marker-hint,.marker.proxy-hover .marker-hint {
    opacity: 1; transform: translate(0,-50%) scale(1);
  }
  .marker:active { transform: translate(-50%,-50%) scale(1); }
  .marker.drifted .marker-dot,.marker.invalid .marker-dot,.marker.ambiguous .marker-dot { background: #b56628; }
  .marker.active .marker-dot { transform: scale(1.08); box-shadow: 0 0 0 5px rgba(13,107,80,.22),0 3px 12px rgba(0,0,0,.28); }
  .marker.active:hover .marker-dot,.marker.active:focus-visible .marker-dot,.marker.active.proxy-hover .marker-dot { transform: scale(1.22); }
  .outline { position: fixed; z-index: 10; border: 2px solid #0d6b50; border-radius: 7px; background: rgba(13,107,80,.06); pointer-events: none; }
  .outline.eligible-target { border: 1px dashed rgba(22,163,116,.7); background: rgba(22,163,116,.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,.32); }
  .outline.suggestion { border-width: 3px; border-style: solid; border-color: #38a7e0; background: rgba(56,167,224,.12); box-shadow: 0 0 0 4px rgba(56,167,224,.18),0 7px 24px rgba(0,0,0,.18); animation: suggestion-pulse 1.35s ease-in-out infinite alternate; }
  .suggestion-label {
    position: fixed; z-index: 12; max-width: calc(100% - 16px); padding: 6px 9px;
    border: 1px solid rgba(255,255,255,.2); border-radius: 999px;
    color: white; background: rgba(24,111,158,.96); box-shadow: 0 5px 18px rgba(0,0,0,.24);
    pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font: 750 11px/1.2 Inter,-apple-system,sans-serif;
  }
  .outline.mapping-hover { border-width: 3px; border-color: #12a874; background: rgba(18,168,116,.14); box-shadow: 0 0 0 3px rgba(18,168,116,.2),0 5px 18px rgba(0,0,0,.16); }
  .mapping-hover-label {
    position: fixed; z-index: 3; max-width: calc(100% - 16px); padding: 6px 9px;
    border: 1px solid rgba(255,255,255,.18); border-radius: 999px;
    color: white; background: rgba(7,91,66,.96); box-shadow: 0 5px 18px rgba(0,0,0,.24);
    pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font: 750 11px/1.2 Inter,-apple-system,sans-serif;
  }
  .outline.drop-target { border-width: 3px; background: rgba(13,107,80,.13); box-shadow: 0 0 0 3px rgba(255,255,255,.78); }
  .drop-zone { position: fixed; z-index: 40; inset: 10px; display: none; align-items: flex-start; justify-content: center; padding-top: 14px; border: 2px dashed #0d6b50; border-radius: 12px; background: rgba(13,107,80,.055); pointer-events: none; }
  .drop-zone.visible { display: flex; }
  .drop-zone.invalid { border-color: #b33e38; background: rgba(179,62,56,.055); }
  .drop-label { max-width: calc(100% - 28px); padding: 8px 12px; border-radius: 999px; color: white; background: rgba(7,76,56,.94); box-shadow: 0 5px 20px rgba(0,0,0,.2); font: 750 12px/1.25 Inter,-apple-system,sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drop-zone.invalid .drop-label { background: rgba(160,50,45,.94); }
  @keyframes suggestion-pulse { from { box-shadow: 0 0 0 3px rgba(56,167,224,.14),0 7px 24px rgba(0,0,0,.16); } to { box-shadow: 0 0 0 7px rgba(56,167,224,.24),0 9px 28px rgba(0,0,0,.2); } }
  @media (prefers-reduced-motion: reduce) {
    .marker,.marker-dot,.marker-hint { transition: none; }
    .outline.suggestion { animation: none; }
  }
`

export const ensureOverlay = (doc: Document) => {
  let host = doc.querySelector<HTMLElement>(`#${HOST_ID}`)
  if (host?.shadowRoot) return host.shadowRoot
  host = doc.createElement("div")
  host.id = HOST_ID
  Object.assign(host.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  })
  doc.documentElement.append(host)
  const shadow = host.attachShadow({ mode: "open" })
  shadow.innerHTML = `
    <style>${OVERLAY_STYLES}</style>
    <div id="drop-zone" class="drop-zone"><div id="drop-label" class="drop-label">松开以建立映射</div></div>
    <div id="outlines"></div>
    <div id="markers"></div>
  `
  return shadow
}

const addOutline = (
  doc: Document,
  root: Element,
  element: HTMLElement,
  className = "outline",
) => {
  const rect = element.getBoundingClientRect()
  const outline = doc.createElement("div")
  outline.className = className
  Object.assign(outline.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
  root.append(outline)
  return outline
}

const visibleBindableTargets = (
  doc: Document,
  node: FlatSpecNode | undefined,
) => {
  if (!node || (node.type !== "ACTION" && node.type !== "SURFACE")) return []
  const viewWidth = doc.defaultView?.innerWidth ?? 0
  const viewHeight = doc.defaultView?.innerHeight ?? 0
  const seenBounds = new Set<string>()
  const visibleTargets = collectBindableTargets(doc, node.type)
    .filter((element) => {
      if (!exposedTargetRect(element) || element.closest(`#${HOST_ID}`)) return false
      const rect = element.getBoundingClientRect()
      if (
        rect.width < 12 ||
        rect.height < 12 ||
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        (viewWidth > 0 && rect.left >= viewWidth) ||
        (viewHeight > 0 && rect.top >= viewHeight)
      ) {
        return false
      }
      const boundsKey = [rect.left, rect.top, rect.width, rect.height]
        .map((value) => Math.round(value))
        .join(":")
      if (seenBounds.has(boundsKey)) return false
      seenBounds.add(boundsKey)
      return true
    })
  if (node.type === "ACTION") return visibleTargets.slice(0, 40)

  const area = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return rect.width * rect.height
  }
  const overlapRatio = (left: HTMLElement, right: HTMLElement) => {
    const a = left.getBoundingClientRect()
    const b = right.getBoundingClientRect()
    const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    const minimumArea = Math.min(a.width * a.height, b.width * b.height)
    return minimumArea > 0 ? (overlapWidth * overlapHeight) / minimumArea : 0
  }
  const ranked = visibleTargets
    .map((element) => ({
      element,
      score:
        surfaceTargetScore(element, node) +
        (element.matches(EXPLICIT_SURFACE_SELECTOR) ? 12 : 0),
      area: area(element),
    }))
    .sort((left, right) => right.score - left.score || left.area - right.area)
  const strong = ranked.filter((candidate) => candidate.score >= 36)
  const previewPool = strong.length ? strong : ranked
  const previewLimit = strong.length ? 5 : 3
  const selected: HTMLElement[] = []
  for (const candidate of previewPool) {
    if (selected.some((element) => overlapRatio(element, candidate.element) >= 0.82)) {
      continue
    }
    selected.push(candidate.element)
    if (selected.length >= previewLimit) break
  }
  return selected
}

export const clearMappingTargetPreview = (doc: Document | null) => {
  const shadow = doc?.querySelector<HTMLElement>(`#${HOST_ID}`)?.shadowRoot
  shadow?.querySelector(".mapping-hover")?.remove()
  shadow?.querySelector(".mapping-hover-label")?.remove()
}

export const renderMappingTargetPreview = (
  doc: Document,
  node: FlatSpecNode | undefined,
  rawTarget: Element | null,
) => {
  const shadow = ensureOverlay(doc)
  const outlineRoot = shadow.querySelector("#outlines")
  if (!outlineRoot) return null
  clearMappingTargetPreview(doc)
  const target = meaningfulTarget(rawTarget, node)
  if (!target || !exposedTargetRect(target)) return null

  const rect = target.getBoundingClientRect()
  addOutline(doc, outlineRoot, target, "outline mapping-hover")
  const label = doc.createElement("div")
  label.className = "mapping-hover-label"
  label.textContent = `可绑定 · ${targetLabel(target)}`
  const viewWidth = doc.defaultView?.innerWidth ?? rect.right + 8
  Object.assign(label.style, {
    left: `${Math.max(8, Math.min(rect.left, viewWidth - 132))}px`,
    top: `${rect.top >= 34 ? rect.top - 30 : Math.min(rect.bottom + 6, (doc.defaultView?.innerHeight ?? rect.bottom + 36) - 28)}px`,
  })
  outlineRoot.append(label)
  return target
}

interface MarkerPlacement {
  annotation: SpecAnnotation
  element: HTMLElement
  left: number
  top: number
  clipPath: string
}

// DOM existence and layout size do not prove that the current screen exposes a
// target. Keep this viewport-only check separate from mapping validity and from
// candidate discovery, which must still be able to locate offscreen elements.
const exposedTargetRect = (element: HTMLElement) => {
  if (!element.isConnected || !isVisible(element)) return null
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view) return null
  const rect = element.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let right = Math.min(view.innerWidth, rect.right)
  let top = Math.max(0, rect.top)
  let bottom = Math.min(view.innerHeight, rect.bottom)
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor)
    if (ancestor.hidden || ancestor.inert || Number(style.opacity) === 0) return null
    if (ancestor === element) continue
    const bounds = ancestor.getBoundingClientRect()
    if (/^(hidden|clip|scroll|auto|overlay)$/.test(style.overflowX)) {
      left = Math.max(left, bounds.left)
      right = Math.min(right, bounds.right)
    }
    if (/^(hidden|clip|scroll|auto|overlay)$/.test(style.overflowY)) {
      top = Math.max(top, bounds.top)
      bottom = Math.min(bottom, bounds.bottom)
    }
  }
  if (right <= left || bottom <= top) return null
  const ownsPoint = (x: number, y: number) => {
    const hit = doc.elementsFromPoint(x, y).find(target => !target.closest(`#${HOST_ID}`))
    if (!hit || (hit !== element && !element.contains(hit))) return false
    // A nested dialog belongs to its own foreground screen, not to a mapped
    // region that happens to contain it in the DOM.
    const foreground = hit.closest('dialog[open], [role="dialog"], [aria-modal="true"]')
    return !foreground || foreground.contains(element)
  }
  const markerLeft = Math.min(Math.max(right, 14), view.innerWidth - 14)
  const markerTop = Math.min(Math.max(top, 14), view.innerHeight - 14)
  if (ownsPoint(right - Math.min(6, (right - left) / 4), top + Math.min(6, (bottom - top) / 4))) {
    return { left, right, top, bottom, markerLeft, markerTop }
  }
  for (const xRatio of [0.5, 0.1, 0.9]) {
    for (const yRatio of [0.5, 0.1, 0.9]) {
      const x = left + (right - left) * xRatio
      const y = top + (bottom - top) * yRatio
      if (ownsPoint(x, y)) {
        return { left, right, top, bottom, markerLeft: x, markerTop: y }
      }
    }
  }
  return null
}

// Keep marker hit areas outside native controls, including adjacent controls.
// If a dense layout has no free 24px square, clip only the obstructing portions.
const markerGeometry = (doc: Document, rect: NonNullable<ReturnType<typeof exposedTargetRect>>) => {
  const radius = MARKER_HIT_RADIUS
  const width = doc.defaultView?.innerWidth ?? 0, height = doc.defaultView?.innerHeight ?? 0
  const controls = [...doc.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)]
    .filter(e => !e.closest(`#${HOST_ID}`) && isVisible(e))
    .map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
  const clamp = (x: number, y: number) => ({
    left: Math.max(radius + 2, Math.min(width - radius - 2, x)),
    top: Math.max(radius + 2, Math.min(height - radius - 2, y)),
  })
  const positions = [
    clamp(rect.right + radius + 2, rect.top - radius - 2),
    clamp(rect.left - radius - 2, rect.top - radius - 2),
    clamp(rect.right + radius + 2, rect.bottom + radius + 2),
    clamp(rect.left - radius - 2, rect.bottom + radius + 2),
    clamp(rect.markerLeft, rect.markerTop),
  ]
  const overlaps = (p: {left: number; top: number}) => controls.filter(r =>
    r.left < p.left + radius && r.right > p.left - radius &&
    r.top < p.top + radius && r.bottom > p.top - radius)
  const position = positions.find(p => overlaps(p).length === 0) ?? positions[positions.length - 1]
  const blocked = overlaps(position)
  if (!blocked.length) return { ...position, clipPath: "" }
  const x0 = position.left - radius, y0 = position.top - radius, size = radius * 2
  const xs = [...new Set([0, size, ...blocked.flatMap(r => [Math.max(0,r.left-x0), Math.min(size,r.right-x0)])])].sort((a,b)=>a-b)
  const ys = [...new Set([0, size, ...blocked.flatMap(r => [Math.max(0,r.top-y0), Math.min(size,r.bottom-y0)])])].sort((a,b)=>a-b)
  const cells: string[] = []
  for (let x=0;x<xs.length-1;x++) for(let y=0;y<ys.length-1;y++) {
    const cx=x0+(xs[x]+xs[x+1])/2, cy=y0+(ys[y]+ys[y+1])/2
    if (!blocked.some(r => cx>=r.left && cx<=r.right && cy>=r.top && cy<=r.bottom))
      cells.push(`M${xs[x]} ${ys[y]}H${xs[x+1]}V${ys[y+1]}H${xs[x]}Z`)
  }
  return { ...position, clipPath: `path("${cells.join(" ") || "M0 0Z"}")` }
}

const markerPlacements = (doc: Document, map: SpecMap): MarkerPlacement[] => {
  const placements: MarkerPlacement[] = []
  map.items.forEach((annotation) => {
    if (annotation.status !== "confirmed") return
    const matches = querySelectorSafe(doc, annotation.target.selector.value)
    if (matches.length !== 1) return
    const element = matches[0] as HTMLElement
    if (!fingerprintMatches(annotation.target.fingerprint, elementFingerprint(element))) return
    const rect = exposedTargetRect(element)
    if (!rect) return
    placements.push({
      annotation,
      element,
      ...markerGeometry(doc, rect),
    })
  })
  return placements
}

export const nodeIdsAtMarker = (doc: Document, map: SpecMap, nodeId: string) => {
  const placements = markerPlacements(doc, map)
  const target = placements.find(item => item.annotation.body.id === nodeId)?.element
  return [...new Set(placements.filter(item => item.element === target).map(item => item.annotation.body.id))]
}

export const annotationAtMarkerPoint = (
  doc: Document,
  map: SpecMap,
  point: { x: number; y: number },
) =>
  markerPlacements(doc, map)
    .map((placement) => ({
      annotation: placement.annotation,
      distance: Math.hypot(point.x - placement.left, point.y - placement.top),
    }))
    .filter((candidate) => {
      if (candidate.distance > MARKER_HIT_RADIUS) return false
      const hit = doc.elementsFromPoint(point.x, point.y).find(e => !e.closest(`#${HOST_ID}`))
      return !hit?.closest(INTERACTIVE_SELECTOR)
    })
    .sort((left, right) => left.distance - right.distance)[0]?.annotation ?? null

export const setFrameMarkerHover = (doc: Document | null, nodeId: string | null) => {
  const shadow = doc?.querySelector<HTMLElement>(`#${HOST_ID}`)?.shadowRoot
  if (!shadow) return
  shadow.querySelectorAll<HTMLElement>("button.marker").forEach((marker) => {
    marker.classList.toggle("proxy-hover", Boolean(nodeId) && marker.dataset.specNodeId === nodeId)
  })
}

export const renderFrameOverlay = ({
  doc,
  map,
  nodeById,
  activeNodeId,
  mappingTargetId,
  candidate,
  workMode,
  onSelect,
}: {
  doc: Document
  map: SpecMap
  nodeById: Map<string, FlatSpecNode>
  activeNodeId: string | null
  mappingTargetId: string | null
  candidate: CandidateTarget | null
  workMode: WorkMode
  onSelect: (nodeId: string) => void
}) => {
  const shadow = ensureOverlay(doc)
  const markerRoot = shadow.querySelector("#markers")
  const outlineRoot = shadow.querySelector("#outlines")
  if (!markerRoot || !outlineRoot) return
  markerRoot.replaceChildren()
  outlineRoot.replaceChildren()
  const mappingNode = mappingTargetId ? nodeById.get(mappingTargetId) : undefined
  if (
    workMode === "map" &&
    mappingTargetId &&
    mappingTargetId === activeNodeId
  ) {
    visibleBindableTargets(doc, mappingNode).forEach((element) => {
      addOutline(doc, outlineRoot, element, "outline eligible-target")
    })
  }
  const placements = markerPlacements(doc, map)
  const rendered = new Set<HTMLElement>()
  placements.forEach(({ annotation, element, left, top, clipPath }) => {
    if (rendered.has(element)) return
    rendered.add(element)
    const ids = [...new Set(placements.filter(item => item.element === element).map(item => item.annotation.body.id))]
    const active = Boolean(activeNodeId && ids.includes(activeNodeId))
    const button = doc.createElement("button")
    button.type = "button"
    button.className = `marker ${annotation.status} ${active ? "active" : ""}`
    const nodeTitle = nodeById.get(annotation.body.id)?.title ?? annotation.body.id
    const dot = doc.createElement("span")
    dot.className = "marker-dot"
    const hint = doc.createElement("span")
    hint.className = "marker-hint"
    hint.textContent = `查看 Spec · ${nodeTitle}`
    button.append(dot, hint)
    if (ids.length > 1) {
      const count = doc.createElement("span")
      count.className = "marker-count"
      count.textContent = String(ids.length)
      button.append(count)
      hint.textContent = `查看 ${ids.length} 个 Spec`
    }
    button.title = `查看 Spec：${nodeTitle}`
    button.setAttribute("aria-label", ids.length > 1 ? `查看 ${ids.length} 个 Spec` : `查看 Spec：${nodeTitle}`)
    button.setAttribute("aria-pressed", active ? "true" : "false")
    button.dataset.specNodeId = annotation.body.id
    button.style.left = `${left}px`
    button.style.top = `${top}px`
    if (clipPath) button.style.clipPath = clipPath
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      onSelect(annotation.body.id)
    })
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      event.stopPropagation()
      onSelect(annotation.body.id)
    })
    markerRoot.append(button)
    if (active) {
      addOutline(doc, outlineRoot, element)
    }
  })
  if (
    activeNodeId &&
    !map.items.some((item) => item.body.id === activeNodeId) &&
    candidate?.element.isConnected &&
    exposedTargetRect(candidate.element)
  ) {
    const rect = candidate.element.getBoundingClientRect()
    addOutline(doc, outlineRoot, candidate.element, "outline suggestion")
    const label = doc.createElement("div")
    label.className = "suggestion-label"
    label.textContent = `${workMode === "review" ? "位置预览" : "候选定位"} · ${targetLabel(candidate.element)}`
    const viewWidth = doc.defaultView?.innerWidth ?? rect.right + 8
    const viewHeight = doc.defaultView?.innerHeight ?? rect.bottom + 36
    Object.assign(label.style, {
      left: `${Math.max(8, Math.min(rect.left, viewWidth - 160))}px`,
      top: `${rect.top >= 34 ? rect.top - 30 : Math.min(rect.bottom + 6, viewHeight - 28)}px`,
    })
    outlineRoot.append(label)
  }
}

export const renderDropFeedback = (
  doc: Document,
  node: FlatSpecNode | undefined,
  clientX: number,
  clientY: number,
) => {
  const shadow = ensureOverlay(doc)
  clearMappingTargetPreview(doc)
  const dropZone = shadow.querySelector("#drop-zone")
  const label = shadow.querySelector("#drop-label")
  const outlineRoot = shadow.querySelector("#outlines")
  if (!dropZone || !label || !outlineRoot) return null
  outlineRoot.querySelector(".drop-target")?.remove()
  const host = doc.querySelector<HTMLElement>(`#${HOST_ID}`)
  const previousVisibility = host?.style.visibility
  if (host) host.style.visibility = "hidden"
  const rawTarget = doc.elementFromPoint(clientX, clientY)
  if (host) host.style.visibility = previousVisibility ?? ""
  const target = meaningfulTarget(rawTarget, node)
  dropZone.classList.add("visible")
  dropZone.classList.toggle("invalid", !target)
  label.textContent = target
    ? `松开绑定到「${targetLabel(target)}」`
    : node?.type === "ACTION"
      ? "请选择原生控件、ARIA 控件或有明确交互提示的元素"
      : "请选择有语义的页面区域"
  if (target) addOutline(doc, outlineRoot, target, "outline drop-target")
  return target
}

export const clearDropFeedback = (doc: Document | null) => {
  if (!doc) return
  const shadow = ensureOverlay(doc)
  shadow.querySelector("#drop-zone")?.classList.remove("visible", "invalid")
  shadow.querySelector(".drop-target")?.remove()
}

export const removeFrameOverlay = (doc: Document | null) => {
  doc?.querySelector(`#${HOST_ID}`)?.remove()
}
