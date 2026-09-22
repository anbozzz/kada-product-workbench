import type { ViewportPreset } from "@/types"

export const AUTO_VIEWPORT_FALLBACK: ViewportPreset = {
  id: "auto",
  label: "自动检测",
  shortLabel: "自动",
  width: 1280,
  height: 800,
  frame: "browser",
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: "desktop", label: "桌面 1280 × 800", shortLabel: "桌面", width: 1280, height: 800, frame: "browser" },
  { id: "wide", label: "宽屏 1440 × 900", shortLabel: "宽屏", width: 1440, height: 900, frame: "browser" },
  { id: "tablet", label: "平板 768 × 1024", shortLabel: "平板", width: 768, height: 1024, frame: "device" },
  { id: "phone", label: "手机 390 × 844", shortLabel: "手机", width: 390, height: 844, frame: "device" },
]

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, Math.round(value)))

const elementDepth = (element: Element) => {
  let depth = 0
  let current: Element | null = element
  while (current?.parentElement) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

/**
 * Infer the page's intended review viewport from a same-origin iframe.
 *
 * Fixed-width prototypes commonly render a centered app shell inside a wide
 * browser viewport. We prefer that shell over the probe viewport, while a
 * normal responsive page keeps the current browser dimensions. Long document
 * content does not enlarge the viewport height.
 */
export const inferViewportFromDocument = (
  doc: Document | null,
  fallback: ViewportPreset = AUTO_VIEWPORT_FALLBACK,
): ViewportPreset => {
  const view = doc?.defaultView
  const body = doc?.body
  if (!view || !body) return fallback

  const viewportWidth = Math.max(1, view.innerWidth || fallback.width)
  const viewportHeight = Math.max(1, view.innerHeight || fallback.height)
  const candidates = Array.from(body.querySelectorAll<HTMLElement>("*"))
    .slice(0, 2000)
    .flatMap((element) => {
      if (element.id === "ips-overlay-host" || element.closest("#ips-overlay-host")) return []
      const style = view.getComputedStyle(element)
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return []
      const rect = element.getBoundingClientRect()
      if (
        rect.width < 280 ||
        rect.height < 480 ||
        rect.width > viewportWidth * 0.88 ||
        rect.top > 96 ||
        rect.bottom < 320
      ) {
        return []
      }
      const centerError = Math.abs((rect.left + rect.right) / 2 - viewportWidth / 2)
      if (centerError > Math.max(36, viewportWidth * 0.12)) return []
      const depth = elementDepth(element)
      const score = (rect.width * Math.min(rect.height, 1600)) / (1 + depth * 0.08)
      return [{ width: rect.width, height: rect.height, score }]
    })
    .sort((left, right) => right.score - left.score)

  const shell = candidates[0]
  const numericMetaWidth = doc
    .querySelector<HTMLMetaElement>('meta[name="viewport"]')
    ?.content.match(/(?:^|,)\s*width\s*=\s*(\d+)/i)?.[1]
  const width = shell?.width
    ?? (numericMetaWidth ? Number(numericMetaWidth) : viewportWidth)
  const height = shell?.height ?? viewportHeight
  const normalizedWidth = clamp(width, 280, 1920)
  const normalizedHeight = clamp(height, 480, 1440)
  const frame = normalizedWidth <= 600 ? "device" : "browser"

  return {
    id: "auto",
    label: `自动 ${normalizedWidth} × ${normalizedHeight}`,
    shortLabel: "自动",
    width: normalizedWidth,
    height: normalizedHeight,
    frame,
  }
}
