import {
  frameLocation,
  resolveMappedTarget,
} from "@/lib/spec-mapping"
import type {
  FlatSpecNode,
  SpecAnnotation,
} from "@/types"

export const AUTO_ROUTE_CHECK_BUDGET_MS = 2400

const waitForFrameLoad = (
  frame: HTMLIFrameElement,
  action: () => void,
  signal?: AbortSignal,
  timeoutMs = 1600,
) => new Promise<void>((resolve, reject) => {
  let timeout = 0
  const cleanup = () => {
    window.clearTimeout(timeout)
    frame.removeEventListener("load", loaded)
    signal?.removeEventListener("abort", aborted)
  }
  const loaded = () => {
    cleanup()
    window.setTimeout(resolve, 70)
  }
  const aborted = () => {
    cleanup()
    reject(new DOMException("候选定位已取消", "AbortError"))
  }
  frame.addEventListener("load", loaded, { once: true })
  signal?.addEventListener("abort", aborted, { once: true })
  timeout = window.setTimeout(() => {
    cleanup()
    resolve()
  }, timeoutMs)
  action()
})

const navigateFrame = async (
  frame: HTMLIFrameElement,
  targetUrl: string,
  signal?: AbortSignal,
  timeoutMs?: number,
) => {
  await waitForFrameLoad(frame, () => {
    frame.src = targetUrl
  }, signal, timeoutMs)
  if (!frame.contentDocument) throw new Error("无法读取候选页面")
}

/** Verify a saved destination without changing the user's live prototype. */
export const verifyMappedDestination = async (
  targetUrl: string,
  verify: (doc: Document) => boolean,
  signal?: AbortSignal,
  size = { width: 499, height: 900 },
): Promise<boolean> => {
  if (!/^\/target\//.test(targetUrl) || signal?.aborted) return false
  const probe = document.createElement("iframe")
  probe.title = "关联目标校验"
  probe.setAttribute("aria-hidden", "true")
  Object.assign(probe.style, {
    position: "fixed", left: "-12000px", top: "0",
    width: `${size.width}px`, height: `${size.height}px`,
    opacity: "0", pointerEvents: "none",
  })
  document.body.append(probe)
  try {
    const startedAt = performance.now()
    await navigateFrame(probe, targetUrl, signal)
    // Include asynchronously rendered screens; a timeout never authorizes a jump.
    while (!signal?.aborted && performance.now() - startedAt < AUTO_ROUTE_CHECK_BUDGET_MS) {
      const doc = probe.contentDocument
      const location = doc?.location
      if (doc && location && `${location.pathname}${location.search}${location.hash}` === targetUrl && verify(doc)) return true
      await new Promise((resolve) => window.setTimeout(resolve, 80))
    }
    return false
  } finally {
    probe.remove()
  }
}

// Treat a hint as a complete relative address; never put its hash in URL.search.
export const directRouteUrl = (targetUrl: string, routeHint: string) => {
  const hint = routeHint.trim()
  if (!hint.startsWith("#") && !hint.startsWith("?")) return null
  try {
    const base = new URL(targetUrl, window.location.href)
    if (base.origin !== window.location.origin || !base.pathname.startsWith("/target/")) return null
    base.search = ""
    base.hash = ""
    return new URL(hint, base).href
  } catch {
    return null
  }
}

export const pageDestination = (targetUrl: string, routeHints: readonly string[] = []) => {
  for (const hint of routeHints) {
    const destination = directRouteUrl(targetUrl, hint)
    if (destination) {
      const url = new URL(destination)
      return `${url.pathname}${url.search}${url.hash}`
    }
  }
  return null
}

const arrivedAtPage = (doc: Document, destination: string) => {
  const expected = new URL(destination, window.location.href)
  const actual = new URL(doc.location.href)
  return actual.pathname === expected.pathname && actual.hash === expected.hash &&
    [...expected.searchParams].every(([key, value]) => actual.searchParams.get(key) === value)
}

/** Open an explicitly declared page without requiring any component to exist. */
export const navigateToPage = async (
  frame: HTMLIFrameElement,
  destination: string,
  signal?: AbortSignal,
): Promise<Document | null> => {
  if (signal?.aborted) return null
  if (frameLocation(frame) !== destination) await navigateFrame(frame, destination, signal)
  const startedAt = performance.now()
  while (!signal?.aborted && performance.now() - startedAt < AUTO_ROUTE_CHECK_BUDGET_MS) {
    const doc = frame.contentDocument
    const route = (doc?.defaultView as (Window & { __IPS_REVIEW_ROUTE__?: { ready: boolean } }) | null)?.__IPS_REVIEW_ROUTE__
    if (doc && arrivedAtPage(doc, destination) && route?.ready !== false) return doc
    await new Promise(resolve => window.setTimeout(resolve, 60))
  }
  return null
}

export const resolveMappedDestination = async ({ frame, annotation, node, targetUrl, routeHints = [], signal }: {
  frame: HTMLIFrameElement
  annotation: SpecAnnotation
  node: FlatSpecNode | undefined
  targetUrl: string
  routeHints?: readonly string[]
  signal?: AbortSignal
}): Promise<string | null> => {
  const destinations = [annotation.target.context?.url, ...routeHints.map(hint => {
    const value = directRouteUrl(targetUrl, hint)
    if (!value) return null
    const url = new URL(value)
    return `${url.pathname}${url.search}${url.hash}`
  })].filter((value): value is string => Boolean(value))
  for (const destination of new Set(destinations)) {
    if (signal?.aborted) return null
    if (destination === frameLocation(frame)) continue
    if (await verifyMappedDestination(destination,
      doc => Boolean(resolveMappedTarget(annotation, doc, node)), signal,
      {width: frame.clientWidth, height: frame.clientHeight})) return destination
  }
  return null
}
