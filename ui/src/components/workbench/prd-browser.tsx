import { SourceDownload } from "./source-download"
import { isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { BookOpenText, Check, ChevronDown, ChevronUp, Ellipsis, FileText, Maximize2, Minus, Plus, RotateCcw, Search, TriangleAlert, X } from "lucide-react"
import { markit } from "@markitjs/core"
import { Dialog as DialogPrimitive, DropdownMenu } from "radix-ui"
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { PrdDocumentView, PrdReviewAnnotation } from "@/types"
import { cn } from "@/lib/utils"
import { PrdImage } from "./prd-image"
import { PrdReviewPanel, PrdRevisionDiff, type PrdReviewControls, type PrdSelection } from "./prd-review-panel"
import { PrdAnnotationHighlights } from "./prd-annotation-highlights"
import { findPrdQuoteRange, prdQuoteOccurrence } from "./prd-selection-popover"

type PrdBrowserProps = {
  fullWidth?: boolean
  sourceTarget?: { id: string; request: number } | null
  review?: PrdReviewControls
  open: boolean
  document: PrdDocumentView
  relatedSectionIds: string[]
  canBind: boolean
  relatedOnly: boolean
  onRelatedOnlyChange?: (value: boolean) => void
  saving: boolean
  stale: boolean
  missingSectionIds: string[]
  onOpenChange: (open: boolean) => void
  onDockWidthChange?: (width: number) => void
  updateLoading?: boolean
  updateNotice?: ReactNode
  onDirtyChange?: (dirty: boolean) => void
  onSaveRelations: (sectionIds: string[]) => Promise<void>
}

type PrdOutlineEntry = {
  id: string
  level: number
  title: string
}

const plainHeading = (value: string) => value.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim()

const drawerWidthBounds = (docked = false) => {
  const max = Math.max(320, window.innerWidth - (docked ? 360 : 16))
  const desiredMin = window.innerWidth >= 1536 ? 760 : 480
  return { min: Math.min(desiredMin, max), max }
}

const initialDrawerWidth = (docked = false) => {
  const { min, max } = drawerWidthBounds(docked)
  return Math.min(max, Math.min(1120, Math.max(min, docked ? window.innerWidth * 0.58 : window.innerWidth - 320)))
}

let mermaidInitialized = false

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId()
  const diagramId = useMemo(() => `prd-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [reactId])
  const [rendered, setRendered] = useState({ source: "", svg: "", error: "" })
  const [expandedRendered, setExpandedRendered] = useState({ source: "", svg: "", error: "" })
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let cancelled = false
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "dark",
            fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
            flowchart: { curve: "basis", htmlLabels: true },
          })
          mermaidInitialized = true
        }
        const rendered = await mermaid.render(diagramId, source)
        if (!cancelled) setRendered({ source, svg: rendered.svg, error: "" })
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setRendered({ source, svg: "", error: caught instanceof Error ? caught.message : "未知 Mermaid 解析错误" })
      })
    return () => {
      cancelled = true
    }
  }, [diagramId, source])

  useEffect(() => {
    if (!expanded || expandedRendered.source === source) return
    let cancelled = false
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        const result = await mermaid.render(`${diagramId}-expanded`, source)
        if (!cancelled) setExpandedRendered({ source, svg: result.svg, error: "" })
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setExpandedRendered({ source, svg: "", error: caught instanceof Error ? caught.message : "未知 Mermaid 解析错误" })
      })
    return () => {
      cancelled = true
    }
  }, [diagramId, expanded, expandedRendered.source, source])

  const svg = rendered.source === source ? rendered.svg : ""
  const error = rendered.source === source ? rendered.error : ""
  const expandedSvg = expandedRendered.source === source ? expandedRendered.svg : ""
  const expandedError = expandedRendered.source === source ? expandedRendered.error : ""

  if (error) {
    return (
      <div className="my-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-amber-200"><TriangleAlert className="size-4" />流程图暂时无法渲染</div>
        <p className="mt-2 text-xs leading-5 text-amber-100/65">{error}</p>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">查看 Mermaid 原始代码</summary>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-black/25 p-3"><code>{source}</code></pre>
        </details>
      </div>
    )
  }

  if (!svg) {
    return <div className="my-6 flex min-h-40 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.025] text-xs text-muted-foreground">正在绘制流程图…</div>
  }

  return (
    <DialogPrimitive.Root
      open={expanded}
      onOpenChange={(nextOpen) => {
        setExpanded(nextOpen)
        if (!nextOpen) setZoom(1)
      }}
    >
      <figure className="prd-mermaid group relative my-7 overflow-x-auto rounded-2xl border border-white/10 bg-[#0b1118] p-5" data-testid="prd-mermaid">
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            className="absolute top-3 right-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-black/55 px-2.5 text-[11px] font-medium text-white/78 opacity-80 backdrop-blur transition hover:bg-black/75 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="放大查看流程图"
            title="放大查看流程图"
          >
            <Maximize2 className="size-3.5" />
            放大查看
          </button>
        </DialogPrimitive.Trigger>
        <div className="mx-auto min-w-[520px] [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" data-testid="prd-mermaid-inline-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        <figcaption className="mt-3 text-center text-[10px] tracking-wide text-muted-foreground">Mermaid 流程图 · 点击放大查看</figcaption>
      </figure>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/72 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-5 z-[71] flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0b1118] shadow-2xl outline-none sm:inset-8"
          data-testid="prd-mermaid-dialog"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-semibold text-foreground">流程图放大查看</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-[11px] text-muted-foreground">使用缩放按钮查看细节，图表保持矢量清晰度。</DialogPrimitive.Description>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1" aria-label="流程图缩放控制">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="缩小流程图" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
                <Minus />
              </Button>
              <span className="w-12 text-center font-mono text-[11px] text-muted-foreground" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="放大流程图" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
                <Plus />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="重置流程图缩放" disabled={zoom === 1} onClick={() => setZoom(1)}>
                <RotateCcw />
              </Button>
            </div>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭流程图放大查看">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-6" data-testid="prd-mermaid-zoom-viewport">
            <div className="grid min-h-full min-w-full place-items-center">
              {expandedError ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm text-amber-200">{expandedError}</div>
              ) : expandedSvg ? (
                <div
                  className="[&_svg]:!h-auto [&_svg]:!w-full [&_svg]:!max-w-none"
                  style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 720}px` }}
                  data-testid="prd-mermaid-zoom-svg"
                  dangerouslySetInnerHTML={{ __html: expandedSvg }}
                />
              ) : (
                <span className="text-xs text-muted-foreground">正在准备放大流程图…</span>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

type MarkdownHeadingProps = HTMLAttributes<HTMLHeadingElement> & ExtraProps


export function PrdMarkdownPreview({ source, query, related, images, highlightId, compact = false, referenceNames }: {
  compact?: boolean
  referenceNames?: ReadonlyMap<string, string>
  highlightId?: string | null
  source: string
  query: string
  related: Set<string>
  images: PrdDocumentView["images"]
}) {
  const sectionByLine = useMemo(() => {
    const lines = source.split(/\r?\n/)
    const sections = new Map<number, string>()
    for (let index = 0; index < lines.length; index += 1) {
      const id = lines[index + 1]?.match(/^<!--\s*prd-section-id:\s*(.+?)\s*-->$/)?.[1]
      if (id) sections.set(index + 1, id)
    }
    return sections
  }, [source])

  const highlightRange = useMemo(() => {
    const lines = source.split(/\r?\n/)
    const start = [...sectionByLine].find(([, id]) => id === highlightId)?.[0]
    if (!start) return null
    const level = lines[start - 1].match(/^#+/)?.[0].length || 6
    let end = lines.length + 1
    for (let index = start; index < lines.length; index++) {
      const next = lines[index].match(/^(#{1,6})\s/)
      if (next && next[1].length <= level) { end = index + 1; break }
    }
    return { start, end }
  }, [source, sectionByLine, highlightId])
  const sourceLines = useCallback((node: ExtraProps["node"]) => {
    const start = node?.position?.start.line
    const highlighted = Boolean(start && highlightRange && start >= highlightRange.start && start < highlightRange.end)
    return { "data-prd-start": start, "data-prd-end": node?.position?.end.line,
      "data-source-text-highlight": highlighted || undefined,
      style: highlighted ? { backgroundColor: "#fcd34d18" } : undefined }
  }, [highlightRange])

  const heading = useCallback((level: number, { node, children, ...props }: MarkdownHeadingProps) => {
    const line = node?.position?.start.line || 1
    const id = sectionByLine.get(line) || `prd-line-${line}`
    const isRelated = related.has(id)
    const HeadingTag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
    const headingClasses = level === 1
      ? "mt-2 text-3xl font-semibold tracking-tight text-foreground first:mt-0"
      : level === 2
        ? "mt-12 border-b border-white/10 pb-3 text-2xl font-semibold tracking-tight text-foreground"
        : level === 3
          ? "mt-9 text-xl font-semibold tracking-tight text-foreground"
          : level === 4
            ? "mt-8 text-lg font-semibold text-foreground"
            : "mt-7 text-sm font-semibold tracking-wide text-emerald-300"
    return (
      <section
        id={`prd-${id}`}
        data-source-highlight={highlightId === id || undefined}
        style={highlightId === id ? { background: "#fcd34d22", outline: "2px solid #fcd34d", borderRadius: 8 } : undefined}
        data-prd-heading={id}
        data-prd-outline={level >= 2 && level <= 4 ? "true" : undefined}
        className={isRelated ? "-mx-5 scroll-mt-6 rounded-2xl bg-emerald-400/[0.07] px-5 py-3 ring-1 ring-emerald-400/15" : "scroll-mt-6"}
      >
        {isRelated ? <span className="mb-2 inline-flex rounded-full bg-emerald-400/12 px-2 py-0.5 text-[10px] font-medium text-emerald-300">当前页面相关</span> : null}
        <HeadingTag {...props} {...sourceLines(node)} className={headingClasses}>{children}</HeadingTag>
      </section>
    )
  }, [related, sectionByLine, highlightId, sourceLines])

  const imageFor = useCallback((src: string) => {
    if (images?.[src]) return images[src]
    // Markdown's HTML renderer URL-encodes Unicode/space characters.
    return Object.entries(images || {}).find(([path]) => {
      try { return decodeURI(path) === decodeURI(src) } catch { return false }
    })?.[1]
  }, [images])

  const components = useMemo<Components>(() => ({
    h1: (props) => heading(1, props),
    h2: (props) => heading(2, props),
    h3: (props) => heading(3, props),
    h4: (props) => heading(4, props),
    h5: (props) => heading(5, props),
    h6: (props) => heading(6, props),
    p: ({ node, ...props }) => <p {...props} {...sourceLines(node)} className="my-3 text-[15px] leading-8 text-foreground/82" />,
    ul: ({ node: _node, ...props }) => <ul {...props} className="my-4 ml-6 list-disc space-y-2 text-[15px] leading-7 text-foreground/82 marker:text-emerald-300/70" />,
    ol: ({ node: _node, ...props }) => <ol {...props} className="my-4 ml-6 list-decimal space-y-2 text-[15px] leading-7 text-foreground/82 marker:text-emerald-300/70" />,
    li: ({ node, ...props }) => <li {...props} {...sourceLines(node)} className="pl-1" />,
    strong: ({ node: _node, ...props }) => <strong {...props} className="font-semibold text-foreground" />,
    em: ({ node: _node, ...props }) => <em {...props} className="text-foreground/90" />,
    blockquote: ({ node: _node, ...props }) => <blockquote {...props} className="my-4 rounded-r-xl border-l-2 border-emerald-400/45 bg-emerald-400/[0.045] py-1 pr-4 pl-4 text-sm text-foreground/72 [&>p]:my-2 [&>p]:leading-6" />,
    a: ({ node: _node, href, children, ...props }) => {
      const name = href?.startsWith("#") ? referenceNames?.get(href.slice(1)) : undefined
      return name ? <span title={href?.slice(1)} className="font-medium text-emerald-200">{name}</span> : <a {...props} href={href} target="_blank" rel="noreferrer" className="font-medium text-emerald-300 underline decoration-emerald-300/35 underline-offset-4 hover:decoration-emerald-300">{children}</a>
    },
    img: ({ node, alt }) => <PrdImage alt={alt || ""} image={imageFor(String(node?.properties.src || ""))} />,
    hr: ({ node: _node, ...props }) => <hr {...props} className="my-9 border-white/10" />,
    table: ({ node: _node, ...props }) => <div className="my-6 overflow-x-auto rounded-xl border border-white/10"><table {...props} className="w-full min-w-[560px] border-collapse text-left text-sm leading-6" /></div>,
    thead: ({ node: _node, ...props }) => <thead {...props} className="bg-white/[0.045] text-foreground" />,
    th: ({ node, ...props }) => <th {...props} {...sourceLines(node)} className="border-b border-white/10 px-4 py-3 font-semibold" />,
    tr: ({ node: _node, ...props }) => <tr {...props} className="border-b border-white/[0.06] last:border-b-0" />,
    td: ({ node, ...props }) => <td {...props} {...sourceLines(node)} className="px-4 py-3 align-top text-foreground/75" />,
    pre: ({ node, children, ...props }) => {
      if (isValidElement(children)) {
        const codeProps = children.props as { className?: string; children?: ReactNode }
        if (/\blanguage-mermaid\b/.test(codeProps.className || "")) {
          return <MermaidDiagram source={String(codeProps.children || "").replace(/\n$/, "")} />
        }
      }
      return <pre {...props} {...sourceLines(node)} className="my-5 overflow-x-auto rounded-xl border border-white/8 bg-black/25 p-4 text-[13px] leading-6 text-foreground/78">{children}</pre>
    },
    code: ({ node: _node, className, children, ...props }) => {
      const name = !className ? referenceNames?.get(String(children)) : undefined
      return name ? <span title={String(children)} className="font-medium text-emerald-200">{name}</span> : <code {...props} className={`${className || ""} rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-emerald-100`}>{children}</code>
    },
  }), [heading, imageFor, sourceLines, referenceNames])

  return (
    <div className={compact ? "min-w-0 break-words [overflow-wrap:anywhere] [&_p]:my-2 [&_p]:text-sm [&_p]:leading-6 [&_ul]:my-2 [&_ul]:text-sm [&_ol]:my-2 [&_ol]:text-sm [&_table]:my-0 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-sm [&_section]:mt-3" : "pb-24"} data-markdown-renderer="react-markdown" data-search-query={query || undefined}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{source}</ReactMarkdown>
    </div>
  )
}

export function PrdBrowser({
  fullWidth = false,
  sourceTarget,
  review,
  open,
  document,
  relatedSectionIds,
  canBind,
  relatedOnly,
  onRelatedOnlyChange,
  saving,
  stale,
  missingSectionIds,
  onOpenChange,
  onDockWidthChange,
  onSaveRelations,
  onDirtyChange,
  updateNotice,
  updateLoading,
}: PrdBrowserProps) {
  const [sourceHighlight, setSourceHighlight] = useState<string | null>(null)
  const [selection, setSelection] = useState<(PrdSelection & { range: Range }) | null>(null)
  const clearSelection = useCallback(() => setSelection(null), [])
  const [feedbackPreview, setFeedbackPreview] = useState<string | null>(null)
  // Own the topmost preview before Radix moves focus from the canvas/menus.
  // Escape during that hand-off must neither leak to the drawer nor do nothing.
  useLayoutEffect(() => {
    if (feedbackPreview === null) return
    const closePreview = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setFeedbackPreview(null)
    }
    window.addEventListener("keydown", closePreview, true)
    return () => window.removeEventListener("keydown", closePreview, true)
  }, [feedbackPreview])
  const [draftAnnotations, setDraftAnnotations] = useState<{ revision: string; annotations: PrdReviewAnnotation[] } | null>(null)
  const updateDraftAnnotations = useCallback((annotations: PrdReviewAnnotation[]) => setDraftAnnotations({ revision: document.revision, annotations }), [document.revision])
  const [showDiff, setShowDiff] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>(relatedSectionIds)
  useEffect(() => {
    onDirtyChange?.(canBind && JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...relatedSectionIds].sort()))
    return () => onDirtyChange?.(false)
  }, [canBind, selectedIds, relatedSectionIds, onDirtyChange])
  const relatedIds = useMemo(() => new Set(relatedSectionIds), [relatedSectionIds])
  const displayedSections = useMemo(
    () => relatedOnly
      ? document.sections.filter((section) => relatedIds.has(section.id) || section.id === sourceTarget?.id)
      : document.sections,
    [document.sections, relatedIds, relatedOnly, sourceTarget?.id],
  )
  const displayedSource = useMemo(
    () => relatedOnly
      ? displayedSections.map((section) => section.markdown).join("\n\n") + "\n\n" + (document.imageDefinitions || "")
      : document.source,
    [displayedSections, document.source, document.imageDefinitions, relatedOnly],
  )
  const [activeSectionId, setActiveSectionId] = useState(displayedSections[0]?.id || "")
  const outline = useMemo<PrdOutlineEntry[]>(() => {
    const lines = displayedSource.split(/\r?\n/)
    return lines.flatMap((line, index) => {
      const heading = line.match(/^(#{2,4})\s+(.+)$/)
      if (!heading) return []
      const sectionId = lines[index + 1]?.match(/^<!--\s*prd-section-id:\s*(.+?)\s*-->$/)?.[1]
      return [{
        id: sectionId || `prd-line-${index + 1}`,
        level: heading[1].length,
        title: heading[2].replace(/[*_`]/g, "").trim(),
      }]
    })
  }, [displayedSource])
  const sectionForHeading = useCallback((headings: HTMLElement[], headingId: string) => {
    let sectionId = ""
    let sectionLevel = 7
    for (const heading of headings) {
      const id = heading.dataset.prdHeading || ""
      const level = Number(heading.querySelector("h2,h3,h4")?.tagName.slice(1) || 7)
      if (displayedSections.some(section => section.id === id)) {
        sectionId = id
        sectionLevel = level
      } else if (level <= sectionLevel) {
        sectionId = ""
        sectionLevel = 7
      }
      if (id === headingId) return sectionId
    }
    return ""
  }, [displayedSections])
  const [activeHeadingId, setActiveHeadingId] = useState(outline[0]?.id || "")
  const navigationPosition = useRef<{ id: string; top: number } | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)
  const directoryRef = useRef<HTMLElement | null>(null)
  const [articleElement, setArticleElement] = useState<HTMLElement | null>(null)
  const attachArticle = useCallback((element: HTMLElement | null) => {
    articleRef.current = element
    setArticleElement(element)
  }, [])
  const searchMatchesRef = useRef<HTMLElement[]>([])
  const normalizedQuery = query.trim()
  const [searchResult, setSearchResult] = useState({ query: "", count: 0, index: -1 })
  const [drawerWidth, setDrawerWidth] = useState(() => initialDrawerWidth(Boolean(review)))
  useEffect(() => { onDockWidthChange?.(open ? drawerWidth : 0) }, [drawerWidth, open, onDockWidthChange])
  const visibleAnnotations = useMemo(() => {
    if (!review) return []
    const draft = draftAnnotations?.revision === document.revision ? draftAnnotations.annotations
      : review.state.draftRevision === document.revision ? review.state.annotations : []
    const sent = review.state.batches.filter(batch => batch.baseRevision === document.revision &&
      ["queued", "processing", "stop_requested", "published"].includes(batch.status)).flatMap(batch => batch.annotations)
    return [...new Map([...sent, ...draft].map(item => [item.id, item])).values()]
  }, [review?.state, draftAnnotations, document.revision])
  const drawerResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const effectiveSearchResult = searchResult.query === normalizedQuery
    ? searchResult
    : { query: normalizedQuery, count: 0, index: -1 }
  useEffect(() => {
    setSelectedIds(relatedSectionIds)
    setActiveSectionId(displayedSections[0]?.id || "")
    setActiveHeadingId(displayedSections[0]?.id || outline[0]?.id || "")
  }, [open, relatedSectionIds, displayedSections, outline])
  useEffect(() => {
    const clampToViewport = () => {
      const { min, max } = drawerWidthBounds(Boolean(review))
      setDrawerWidth((current) => Math.min(max, Math.max(min, current)))
    }
    window.addEventListener("resize", clampToViewport)
    return () => window.removeEventListener("resize", clampToViewport)
  }, [Boolean(review)])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const visibleSections = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return displayedSections
    return displayedSections.filter((section) =>
      [section.title, section.domainTitle, section.id, section.markdown]
        .join("\n")
        .toLocaleLowerCase()
        .includes(needle),
    )
  }, [displayedSections, query])
  const groupedSections = useMemo(() => {
    const groups = new Map<string, typeof visibleSections>()
    for (const section of visibleSections) {
      const group = section.kind === "global-rule" ? "全局产品规则" : plainHeading(section.domainTitle) || "详细功能"
      groups.set(group, [...(groups.get(group) || []), section])
    }
    return [...groups.entries()]
  }, [visibleSections])
  const focusSearchMatch = useCallback((requestedIndex: number) => {
    const matches = searchMatchesRef.current.filter((match) => match.isConnected)
    if (!matches.length || !normalizedQuery) return
    const index = (requestedIndex + matches.length) % matches.length
    for (const match of matches) {
      match.classList.remove("prd-search-match-current")
      match.removeAttribute("data-current-search-match")
    }
    const target = matches[index]
    target.classList.add("prd-search-match-current")
    target.setAttribute("data-current-search-match", "true")
    const viewport = target
      .closest('[data-slot="scroll-area"]')
      ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport) {
      const targetTop = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      viewport.scrollTo({ top: Math.max(0, targetTop - viewport.clientHeight * 0.35), behavior: "auto" })
    } else {
      target.scrollIntoView({ behavior: "auto", block: "center" })
    }
    setSearchResult({ query: normalizedQuery, count: matches.length, index })
  }, [normalizedQuery])

  useEffect(() => {
    const root = articleRef.current
    searchMatchesRef.current = []
    if (!open || !root || !normalizedQuery) return
    let cancelled = false
    const highlighter = markit(root)
    highlighter.mark(normalizedQuery, {
      renderer: "dom",
      element: "mark",
      className: "prd-search-match",
      accuracy: "partially",
      separateWordSearch: false,
      exclude: [".prd-mermaid", ".prd-image", "svg", "script", "style"],
      done: () => {
        if (cancelled) return
        searchMatchesRef.current = [...root.querySelectorAll<HTMLElement>("mark.prd-search-match")]
        searchMatchesRef.current.sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
        const count = searchMatchesRef.current.length
        setSearchResult({ query: normalizedQuery, count, index: count ? 0 : -1 })
        if (count) focusSearchMatch(0)
      },
    })
    return () => {
      cancelled = true
      highlighter.destroy()
      searchMatchesRef.current = []
    }
  }, [displayedSource, focusSearchMatch, normalizedQuery, open])

  useEffect(() => {
    navigationPosition.current = null
    if (!open) return
    const viewport = articleElement?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    let frame = 0
    const updateActiveHeading = () => {
      const headings = [...viewport.querySelectorAll<HTMLElement>('[data-prd-outline="true"]')]
      if (!headings.length) { setActiveSectionId(""); return }
      const bounds = viewport.getBoundingClientRect()
      const navigation = navigationPosition.current
      const target = navigation && headings.find(heading => heading.dataset.prdHeading === navigation.id)
      if (navigation && target && Math.abs(viewport.scrollTop - navigation.top) < 1
        && target.getBoundingClientRect().top >= bounds.top && target.getBoundingClientRect().top < bounds.bottom) {
        setActiveHeadingId(navigation.id)
        setActiveSectionId(sectionForHeading(headings, navigation.id))
        return
      }
      navigationPosition.current = null
      const readingLine = bounds.top + 72
      let active = headings[0]
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > readingLine) break
        active = heading
      }
      const headingId = active.dataset.prdHeading
      if (headingId) setActiveHeadingId(headingId)
      setActiveSectionId(sectionForHeading(headings, headingId || ""))
    }
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateActiveHeading)
    }
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true })
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    if (articleRef.current) resizeObserver.observe(articleRef.current)
    scheduleUpdate()
    return () => {
      window.cancelAnimationFrame(frame)
      viewport.removeEventListener("scroll", scheduleUpdate)
      resizeObserver.disconnect()
    }
  }, [open, displayedSource, sectionForHeading, showDiff, articleElement])

  useEffect(() => {
    const directory = directoryRef.current
    const item = directory?.querySelector<HTMLElement>('[aria-current="location"]')
    const viewport = directory?.closest('[data-slot="scroll-area"]')?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!item || !viewport) return
    const row = item.getBoundingClientRect(), bounds = viewport.getBoundingClientRect()
    if (row.top < bounds.top) viewport.scrollTop += row.top - bounds.top - 8
    else if (row.bottom > bounds.bottom) viewport.scrollTop += row.bottom - bounds.bottom + 8
  }, [activeSectionId, open, visibleSections])

  const navigateToHeading = (headingId: string) => {
    setActiveHeadingId(headingId)
    setActiveSectionId(sectionForHeading([...articleRef.current?.querySelectorAll<HTMLElement>('[data-prd-outline="true"]') || []], headingId))
    const target = window.document.getElementById(`prd-${headingId}`)
    const viewport = target
      ?.closest('[data-slot="scroll-area"]')
      ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (target && viewport) {
      const targetTop = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      viewport.scrollTo({ top: Math.max(0, targetTop - 24), behavior: "auto" })
      navigationPosition.current = { id: headingId, top: viewport.scrollTop }
    } else {
      target?.scrollIntoView({ behavior: "auto", block: "start" })
    }
  }
  useEffect(() => {
    if (!open || !sourceTarget) return
    setQuery("")
    setShowDiff(false)
    setSourceHighlight(sourceTarget.id)
    const frame = requestAnimationFrame(() => navigateToHeading(sourceTarget.id))
    return () => cancelAnimationFrame(frame)
  }, [open, sourceTarget, displayedSource])
  const navigateToSection = (sectionId: string) => {
    setActiveSectionId(sectionId)
    navigateToHeading(sectionId)
  }
  const resizeDrawerTo = (width: number) => {
    const { min, max } = drawerWidthBounds(Boolean(review))
    setDrawerWidth(Math.min(max, Math.max(min, width)))
  }
  const startDrawerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    drawerResizeRef.current = { startX: event.clientX, startWidth: drawerWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const continueDrawerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drawerResizeRef.current
    if (!start) return
    resizeDrawerTo(start.startWidth + start.startX - event.clientX)
  }
  const stopDrawerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    drawerResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const resizeDrawerWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    resizeDrawerTo(drawerWidth + (event.key === 'ArrowLeft' ? 24 : -24))
  }

  const captureSelection = () => {
    if (!review || review.state.status !== "reviewing" || selection) return
    const selectedText = window.getSelection()
    if (!selectedText || selectedText.isCollapsed || !selectedText.rangeCount) return
    const range = selectedText.getRangeAt(0)
    if (!articleRef.current?.contains(range.startContainer) || !articleRef.current.contains(range.endContainer)) return
    const blockFor = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-prd-start]")
    const first = blockFor(range.startContainer), last = blockFor(range.endContainer)
    if (!first || !last || !selectedText.toString().trim()) return
    const anchor = { quote: selectedText.toString(), startLine: Number(first.dataset.prdStart), endLine: Number(last.dataset.prdEnd) }
    setSelection({ ...anchor, quoteOccurrence: prdQuoteOccurrence(articleRef.current, anchor, range), revision: document.revision, range: range.cloneRange() })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent inert={updateLoading} side="right" showOverlay={false} showCloseButton={!review} className="gap-0 p-0 ring-1 ring-black/25" style={{ width: fullWidth ? "100vw" : `${drawerWidth}px`, maxWidth: "none" }} onInteractOutside={event => { if (review) event.preventDefault() }} onEscapeKeyDown={event => {
        if (feedbackPreview !== null) { event.preventDefault(); setFeedbackPreview(null) }
      }}>
        {!fullWidth && <div
          role="separator"
          aria-label="调整 PRD 预览抽屉宽度"
          aria-orientation="vertical"
          aria-valuemin={drawerWidthBounds(Boolean(review)).min}
          aria-valuemax={drawerWidthBounds(Boolean(review)).max}
          aria-valuenow={Math.round(drawerWidth)}
          tabIndex={0}
          className="group absolute inset-y-0 left-0 z-40 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
          data-testid="prd-drawer-resize-handle"
          onPointerDown={startDrawerResize}
          onPointerMove={continueDrawerResize}
          onPointerUp={stopDrawerResize}
          onPointerCancel={stopDrawerResize}
          onKeyDown={resizeDrawerWithKeyboard}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 transition group-hover:bg-emerald-300/60 group-focus-visible:bg-emerald-300/60" />
          <span className="absolute top-1/2 left-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/18 shadow-sm transition group-hover:bg-emerald-300/75 group-focus-visible:bg-emerald-300/75" />
        </div>}
        {review ? <SheetHeader className="h-12 shrink-0 flex-row items-center gap-1 border-b border-white/8 px-3 py-0" data-testid="prd-review-toolbar">
          <SheetTitle className="sr-only">{document.title}</SheetTitle>
          <SheetDescription className="sr-only">阅读完整 PRD，选中正文就地评价，整批提交后可继续编辑下一批。</SheetDescription>
          <span className="min-w-0 flex-1 truncate pr-2 text-xs" title={`${document.title} · ${document.status} · ${document.version}`}>
            <span className="font-medium">PRD</span><span className="ml-2 text-muted-foreground">{document.status} · {document.version}</span>
          </span>
          <SourceDownload source={document.source} filename="PRD.md" />
          <Button size="sm" className="h-7 px-2" aria-label="新版全文" title="新版全文" aria-pressed={!showDiff} variant={!showDiff ? "secondary" : "ghost"} onClick={() => setShowDiff(false)}>正文</Button>
          <Button size="sm" className="h-7 px-2" aria-label="上轮修订差异" title="上轮修订差异" aria-pressed={showDiff} variant={showDiff ? "secondary" : "ghost"} disabled={review.state.previousSource === null} onClick={() => setShowDiff(true)}>差异</Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><Button size="icon-sm" className="size-7" variant="ghost" aria-label="PRD 更多操作" title="更多操作"><Ellipsis /></Button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="z-[75] w-64 rounded-xl border border-white/10 bg-popover p-1.5 text-xs shadow-xl">
              <DropdownMenu.Item disabled={review.busy || review.state.status === "ended" || review.state.batches.some(batch => ["processing", "stop_requested"].includes(batch.status))}
                onSelect={() => void review.mutate("reload").then(ok => { if (ok) clearSelection() })}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 outline-none data-disabled:opacity-40 data-highlighted:bg-white/10"><RotateCcw className="size-3.5" />重新读取本地 PRD</DropdownMenu.Item>
              <p className="px-2 py-1.5 leading-5 text-muted-foreground">用于本地文件已修改、尚未发布到工作台时。保留当前草稿，不会发送意见或回滚文件；修订进行中不可用。</p>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
          <SheetClose asChild><Button size="icon-sm" className="size-7" variant="ghost" aria-label="关闭 PRD" title="关闭 PRD"><X /></Button></SheetClose>
        </SheetHeader> : <SheetHeader className="gap-2 border-b border-white/8 px-7 py-5 pr-16">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full">{document.status}</Badge>
            <Badge variant="outline" className="rounded-full">{document.version}</Badge>
            <Badge variant="outline" className="rounded-full">{`当前页面相关 ${relatedSectionIds.length}`}</Badge>
            {stale ? <Badge variant="outline" className="rounded-full border-amber-400/30 text-amber-300">PRD 已更新 · 需复核</Badge> : null}
            <div className="ml-auto"><SourceDownload source={document.source} filename="PRD.md" /></div>
          </div>
          {onRelatedOnlyChange ? <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label="仅看当前页面关联内容" checked={relatedOnly} onChange={(event) => onRelatedOnlyChange(event.target.checked)} className="relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-muted-foreground/40 transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:transition-transform checked:bg-emerald-600 checked:before:translate-x-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400" />仅看当前页面关联内容</label> : null}
          {sourceHighlight ? <Button size="sm" variant="outline" onClick={() => setSourceHighlight(null)}>隐藏高亮</Button> : null}
          <SheetTitle className="text-xl font-semibold tracking-tight">{document.title}</SheetTitle>
          <SheetDescription>
            {relatedOnly
              ? "评审模式只展示当前页面已经绑定的 PRD 内容。"
              : "显示完整产品文档；绿色章节表示当前页面相关内容。"}
          </SheetDescription>
          {missingSectionIds.length ? (
            <p className="text-[11px] leading-5 text-amber-300">
              已删除或改写的章节 ID：{missingSectionIds.join("、")}。保存当前页面关联前请重新选择对应章节。
            </p>
          ) : null}
        </SheetHeader>}
        {updateNotice}

        {showDiff && review?.state.previousSource !== null && review ? <ScrollArea className="min-h-0 flex-1"><PrdRevisionDiff before={review.state.previousSource || ""} after={document.source} /></ScrollArea> : <div className="grid min-h-0 flex-1 grid-cols-[clamp(160px,18vw,260px)_minmax(0,1fr)] overflow-hidden bg-background/35 2xl:grid-cols-[240px_minmax(0,1fr)_190px]">
          <aside className="flex min-h-0 flex-col border-r border-white/8 bg-popover/55">
            <div className="border-b border-white/[0.06] p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !effectiveSearchResult.count) return
                    event.preventDefault()
                    focusSearchMatch(effectiveSearchResult.index + (event.shiftKey ? -1 : 1))
                  }}
                  placeholder="搜索章节和正文"
                  className="pr-8 pl-8"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                    onClick={() => setQuery("")}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex min-h-6 items-center gap-2">
                <p className="min-w-0 flex-1 text-[10px] text-muted-foreground">
                  {visibleSections.length} 个{relatedOnly ? "相关" : ""}章节{normalizedQuery ? " · 正文全文匹配" : " · 点击标题定位正文"}
                </p>
                {normalizedQuery ? (
                  <div className="flex shrink-0 items-center gap-0.5" aria-label="正文搜索结果导航">
                    <span className="min-w-9 text-center font-mono text-[10px] text-muted-foreground" role="status" aria-live="polite">
                      {effectiveSearchResult.count ? `${effectiveSearchResult.index + 1}/${effectiveSearchResult.count}` : "0/0"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-6"
                      disabled={!effectiveSearchResult.count}
                      aria-label="上一个正文匹配"
                      title="上一个（Shift + Enter）"
                      onClick={() => focusSearchMatch(effectiveSearchResult.index - 1)}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-6"
                      disabled={!effectiveSearchResult.count}
                      aria-label="下一个正文匹配"
                      title="下一个（Enter）"
                      onClick={() => focusSearchMatch(effectiveSearchResult.index + 1)}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <nav ref={directoryRef} className="space-y-5 p-3 pr-4" aria-label="PRD 目录">
                {groupedSections.map(([group, sections]) => (
                  <section key={group}>
                    <h3 className="mb-1.5 px-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{group}</h3>
                    <div className="space-y-1">
                      {sections.map((section) => {
                        const isSelected = selected.has(section.id)
                        const isActive = activeSectionId === section.id
                        return (
                          <div key={section.id} className={`group flex items-start gap-2 rounded-xl border px-2 py-2 transition ${isActive ? "border-white/12 bg-white/[0.055]" : "border-transparent hover:bg-white/[0.035]"}`}>
                            {canBind ? (
                              <input
                                aria-label={`关联 ${plainHeading(section.title)}`}
                                type="checkbox"
                                className="mt-1 size-3.5 shrink-0 accent-emerald-400"
                                checked={isSelected}
                                onChange={(event) => setSelectedIds((current) => event.target.checked
                                  ? [...current, section.id]
                                  : current.filter((id) => id !== section.id))}
                              />
                            ) : null}
                            <button type="button" aria-current={isActive ? "location" : undefined} className="min-w-0 flex-1 text-left" onClick={() => navigateToSection(section.id)}>
                              <span className={`block text-xs font-medium leading-5 ${isSelected ? "text-emerald-200" : "text-foreground/85"}`}>{plainHeading(section.title)}</span>
                              <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">{section.id}</span>
                              {isSelected ? <span className="mt-1 inline-flex text-[9px] font-medium text-emerald-300">本页关联</span> : null}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
                {!groupedSections.length ? (
                  <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                    {relatedOnly && !normalizedQuery ? "当前页面未绑定 PRD 内容" : "没有匹配的章节"}
                  </p>
                ) : null}
              </nav>
            </ScrollArea>
          </aside>
          <ScrollArea className="min-h-0 bg-background/60" data-testid="prd-document-scroll">
            <div className="sticky top-0 z-20 border-b border-white/8 bg-background/92 px-5 py-2 backdrop-blur 2xl:hidden">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="shrink-0 font-medium">正文导航</span>
                <select
                  aria-label="正文导航"
                  value={activeHeadingId}
                  onChange={(event) => navigateToHeading(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-muted/55 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-emerald-400/35"
                >
                  {outline.map((entry) => <option key={entry.id} value={entry.id}>{`${entry.level === 3 ? "  " : entry.level === 4 ? "    " : ""}${entry.title}`}</option>)}
                </select>
              </label>
            </div>
            <article ref={attachArticle} onMouseUp={captureSelection} onKeyUp={event => { if (!event.shiftKey) captureSelection() }} className="mx-auto w-full max-w-[720px] px-8 py-10 xl:px-10" data-testid="prd-document">
              {displayedSections.length ? (
                <PrdMarkdownPreview highlightId={sourceHighlight} source={displayedSource} query={query} related={selected} images={document.images} />
              ) : (
                <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center" data-testid="prd-related-empty">
                  <div>
                    <FileText className="mx-auto size-7 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium text-foreground/80">当前页面未绑定 PRD 内容</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{onRelatedOnlyChange ? "关闭上方开关可阅读完整 PRD；页面关联仍需在绑定模式中设置。" : "请返回绑定模式，为当前页面选择需要评审的 PRD 章节。"}</p>
                  </div>
                </div>
              )}
            </article>
            <PrdAnnotationHighlights root={articleElement} annotations={visibleAnnotations} enabled={Boolean(review && open && !showDiff)} />
          </ScrollArea>
          <aside className="hidden min-h-0 flex-col border-l border-white/8 bg-popover/35 2xl:flex" data-testid="prd-outline">
            <div className="border-b border-white/[0.06] px-4 py-3">
              <h3 className="text-xs font-semibold text-foreground/88">正文导航</h3>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">定位章节，不参与页面关联</p>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <nav className="relative py-3 pr-2 pl-3" aria-label="PRD 正文导航">
                <span className="absolute top-3 bottom-3 left-[18px] w-px bg-white/[0.07]" />
                {outline.map((entry) => {
                  const isActive = activeHeadingId === entry.id
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-current={isActive ? "location" : undefined}
                      onClick={() => navigateToHeading(entry.id)}
                      className={`relative block w-full rounded-lg py-1.5 pr-2 text-left text-[11px] leading-4 transition ${entry.level === 2 ? "pl-5 font-semibold" : entry.level === 3 ? "pl-8 text-foreground/72" : "pl-11 text-foreground/58"} ${isActive ? "bg-emerald-400/[0.08] text-emerald-200" : "hover:bg-white/[0.035] hover:text-foreground/90"}`}
                    >
                      <span className={`absolute top-[11px] left-[2px] size-1.5 rounded-full ring-2 ring-background ${isActive ? "bg-emerald-300" : "bg-white/20"}`} />
                      {entry.title}
                    </button>
                  )
                })}
              </nav>
            </ScrollArea>
          </aside>
        </div>}

        {review ? <PrdReviewPanel key={review.state.sessionId} review={review} preview={feedbackPreview} onPreviewChange={setFeedbackPreview} onDraftChange={updateDraftAnnotations} selection={selection?.revision === document.revision ? selection : null} onClearSelection={clearSelection} resolveRange={anchor => findPrdQuoteRange(articleRef.current, anchor)} onLocate={line => {
          setShowDiff(false)
          window.requestAnimationFrame(() => articleRef.current?.querySelector<HTMLElement>(`[data-prd-start="${line}"]`)?.scrollIntoView({ block: "center", behavior: "auto" }))
        }} /> : <SheetFooter className="mt-0 flex-row items-center gap-3 border-t border-white/8 px-6 py-4">
          <p className="mr-auto text-[11px] text-muted-foreground">
            {canBind ? "保存只更新同目录 prd-map.json，不修改 PRD 正文。" : "当前为只读模式。"}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          {canBind ? (
            <Button disabled={saving} onClick={() => void onSaveRelations(selectedIds)}>
              {saving ? null : <Check />}
              {saving ? "保存中…" : "保存当前页面关联"}
            </Button>
          ) : null}
        </SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}

export function RelatedPrdButton({
  annotationReview = false,
  count,
  onClick,
  compact = false,
}: {
  annotationReview?: boolean
  count: number
  onClick: () => void
  compact?: boolean
}) {
  return (
    <Button
      variant={compact ? "ghost" : "outline"}
      size="sm"
      className={cn("rounded-lg px-2.5", compact && "h-7 bg-transparent hover:bg-white/6")}
      onClick={onClick}
      data-testid="related-prd"
      title={annotationReview ? "打开完整 PRD 与批注" : `打开相关 PRD，当前页面关联 ${count} 个章节`}
    >
      <BookOpenText />
      <span className={compact && !annotationReview ? "hidden 2xl:inline" : ""}>{annotationReview ? "PRD 批注" : `相关 PRD（${count}）`}</span>
      {compact && !annotationReview ? <span className="text-[10px] text-muted-foreground 2xl:hidden">{count}</span> : null}
    </Button>
  )
}
