import { setRuntimeDirty } from "@/components/runtime/runtime-state"
import { PublicationManager } from "@/components/publication/publication-manager"
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { DragDropProvider, DragOverlay } from "@dnd-kit/react"
import { usePanelRef } from "react-resizable-panels"
import {
  Archive,
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CircleDotDashed,
  CloudUpload,
  Download,
  FileCheck2,
  BookOpen,
  FolderOpen,
  Link2,
  LoaderCircle,
  LogOut,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toaster } from "@/components/ui/sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CanvasWorkbench } from "@/components/workbench/canvas-workbench"
import {
  SpecSidebar,
  type SpecFilter,
} from "@/components/workbench/spec-sidebar"
import { SpecOverviewFloat } from "@/components/workbench/spec-overview-float"
import { SpecInspector } from "@/components/workbench/spec-inspector"
import { PrdBrowser, RelatedPrdButton } from "@/components/workbench/prd-browser"
import { SpecDocumentReader } from "@/components/workbench/spec-document-reader"
import { useDocumentUpdates } from "@/components/workbench/use-document-updates"
import { usePrdReview } from "@/components/workbench/use-prd-review"
import type { SpecNodePatch } from "@/components/workbench/spec-definition-panel"
import { useMapPersistence } from "@/components/workbench/use-map-persistence"
import {
  closeCurrentProject,
  loadLauncherData,
  loadWorkbenchConfig,
  prepareReviewPackage,
  savePrdPageMap,
  saveSpecDraft,
  submitReviewToCodex,
} from "@/components/workbench/workbench-api"
import {
  annotationAtMarkerPoint,
  nodeIdsAtMarker,
  clearDropFeedback,
  clearMappingTargetPreview,
  removeFrameOverlay,
  renderDropFeedback,
  renderFrameOverlay,
  renderMappingTargetPreview,
  setFrameMarkerHover,
} from "@/lib/frame-overlay"
import {
  navigateToPage,
  pageDestination,
  resolveMappedDestination,
} from "@/lib/candidate-discovery"
import {
  annotationFor,
  collectBindableTargets,
  computeSuggestion,
  createAnnotation,
  flattenNodes,
  frameLocation,
  MAPPABLE_TYPES,
  matchCurrentPages,
  mappingStatus,
  pageForNode,
  specPages,
  meaningfulTarget,
  resolveMappedTarget,
  resolveInteractiveTarget,
  validateMappingsInPage,
} from "@/lib/spec-mapping"
import type {
  CandidateTarget,
  LauncherData,
  PrdMap,
  SpecMap,
  WorkbenchConfig,
  WorkMode,
} from "@/types"

const pointFromEvent = (event: Event | undefined) => {
  if (!event || !("clientX" in event) || !("clientY" in event)) return null
  const pointer = event as Event & { clientX: number; clientY: number }
  return { x: pointer.clientX, y: pointer.clientY }
}

const ProjectCenter = lazy(async () => {
  const module = await import("@/components/project-center/project-center")
  return { default: module.ProjectCenter }
})

function App() {
  const [config, setConfig] = useState<WorkbenchConfig | null>(null)
  const prdReviewControls = usePrdReview(config, setConfig)
  const [launcher, setLauncher] = useState<LauncherData | null>(null)
  const [markerChoices, setMarkerChoices] = useState<string[]>([])
  const [specMap, setSpecMap] = useState<SpecMap | null>(null)
  const [prdMap, setPrdMap] = useState<PrdMap | null>(null)
  const [loadingError, setLoadingError] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mappingTargetId, setMappingTargetId] = useState<string | null>(null)
  const [workMode, setWorkModeState] = useState<WorkMode>("map")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SpecFilter>("all")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [exitPanelOpen, setExitPanelOpen] = useState(false)
  const [exportPanelOpen, setExportPanelOpen] = useState(() => { const open = sessionStorage.getItem("ips-open-publication") === "1"; sessionStorage.removeItem("ips-open-publication"); return open })
  const [exporting, setExporting] = useState(false)
  useEffect(() => { if (config && sessionStorage.getItem("ips-open-publication") === "1") { sessionStorage.removeItem("ips-open-publication"); setExportPanelOpen(true) } }, [config])
  const [specBrowserOpen, setSpecBrowserOpen] = useState(false)
  const [specOverviewCollapsed, setSpecOverviewCollapsed] = useState(false)
  const [prdRelatedOnly, setPrdRelatedOnly] = useState(true)
  const [prdSourceTarget, setPrdSourceTarget] = useState<{ id: string; request: number } | null>(null)
  const [prdBrowserOpen, setPrdBrowserOpen] = useState(false)
  const [fullSpecOpen, setFullSpecOpen] = useState(false)
  const [prdDockWidth, setPrdDockWidth] = useState(0)
  const [savingPrdMap, setSavingPrdMap] = useState(false)
  const [editingSpec, setEditingSpec] = useState(false)
  const [editingPrdMap, setEditingPrdMap] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorPinned, setInspectorPinned] = useState(false)
  const [inspectorTab, setInspectorTab] = useState("definition")
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)
  const [frameContext, setFrameContext] = useState("")
  const [frameRevision, setFrameRevision] = useState(0)
  const [locateRequest, setLocateRequest] = useState(0)
  const [locatedCandidate, setLocatedCandidate] = useState<{
    nodeId: string
    candidate: CandidateTarget
  } | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const navigatorPanelRef = usePanelRef()
  const inspectorPanelRef = usePanelRef()
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const workModeRef = useRef<WorkMode>("map")
  const mappingTargetIdRef = useRef<string | null>(null)
  const navigationRequestRef = useRef(0)
  const candidateDiscoveryAbortRef = useRef<AbortController | null>(null)
  const mapNodeToElementRef = useRef<
    (nodeId: string, rawElement: Element | null) => boolean
  >(() => false)

  const cancelCandidateDiscovery = useCallback(() => {
    navigationRequestRef.current += 1
    candidateDiscoveryAbortRef.current?.abort()
    candidateDiscoveryAbortRef.current = null
    setLocatedCandidate(null)
  }, [])

  const nodes = useMemo(
    () => (config ? flattenNodes(config.productSpec) : []),
    [config],
  )
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const mappableNodes = useMemo(
    () => nodes.filter((node) => MAPPABLE_TYPES.has(node.type)),
    [nodes],
  )
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null
  const currentPrdItem = useMemo(() =>
    prdMap?.items.find((item) => item.page.context.url === frameContext) ?? null,
  [frameContext, prdMap])
  const relatedPrdSectionIds = useMemo(
    () => currentPrdItem?.sectionIds ?? [],
    [currentPrdItem],
  )

  const currentPages = useMemo(() => {
    void frameRevision
    if (!config || !frameDocument) return new Map()
    return matchCurrentPages(config.productSpec, frameDocument, frameContext)
  }, [config, frameContext, frameDocument, frameRevision])
  const validated = useMemo(() => {
    // frameRevision is an explicit invalidation token for iframe DOM mutations.
    void frameRevision
    if (!specMap) return null
    return validateMappingsInPage(
      specMap,
      frameDocument,
      nodeById,
      frameContext,
      config?.productSpec,
      currentPages,
    )
  }, [config?.productSpec, currentPages, frameContext, frameDocument, frameRevision, nodeById, specMap])
  const visibleMap = validated?.map ?? specMap
  const {
    activeSaveRef,
    dirty,
    dirtyRef,
    markDirty: markMapDirty,
    resetPersistence,
    saveError,
    saveMap,
    saving,
  } = useMapPersistence({ config, setConfig, setSpecMap, specMap })

  const updateBlocked = editingSpec ? "请先保存或取消节点编辑"
    : editingPrdMap ? "请先保存或取消 PRD 章节选择"
    : dirty || saving || savingPrdMap || draggingId || mappingTargetId ? "请先完成当前映射操作或保存"
    : config?.draftChangeCount ? "请先处理当前 Spec 修订草稿"
    : ""
  const documentUpdates = useDocumentUpdates(config, updateBlocked, (next, warnings) => {
    const scrollPositions = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]')).map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }))
    const removed = selectedId && !flattenNodes(next.productSpec).some(node => node.id === selectedId)
    setConfig(next)
    setSpecMap(next.specMap)
    setPrdMap(next.prdMap)
    resetPersistence(next)
    if (removed) { setSelectedId(null); toast.info("当前节点已从新版删除，原映射仍保留") }
    requestAnimationFrame(() => scrollPositions.forEach(({ element, top, left }) => element.scrollTo({ top, left, behavior: "instant" })))
    toast.success("已加载本地最新文档")
    if (warnings.length) toast.warning(`${warnings.length} 项关联需核对：${warnings.slice(0, 2).join("；")}`, { duration: 12000 })
  })

  const documentUpdateBanner = (documentUpdates.status?.changed || documentUpdates.error || documentUpdates.loading) && <div role="status" data-testid="document-update-banner" className="flex flex-wrap items-center gap-2 border-b border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs text-amber-100">
              <CircleAlert className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{documentUpdates.error || documentUpdates.status?.error || `${documentUpdates.status?.documents.join(" / ") || "文档"} 已更新，当前仍在阅读旧版`}{updateBlocked ? ` · ${updateBlocked}` : ""}</span>
              <Button size="sm" variant="outline" disabled={Boolean(updateBlocked) || documentUpdates.loading} onClick={() => void documentUpdates.reload()}>{documentUpdates.loading ? "正在加载…" : documentUpdates.error || documentUpdates.status?.error ? "重试加载" : "加载新版"}</Button>
            </div>

  const cancelTargetPicking = useCallback(() => {
    mappingTargetIdRef.current = null
    setMappingTargetId(null)
    const doc = frameRef.current?.contentDocument
    clearMappingTargetPreview(doc ?? null)
    clearDropFeedback(doc ?? null)
  }, [])

  const selectSpecPage = useCallback(async (pageId: string) => {
    if (!config) return
    cancelTargetPicking()
    cancelCandidateDiscovery()
    const request = navigationRequestRef.current
    setQuery("")
    setFilter("all")
    if (dirtyRef.current && !(await saveMap(false))) {
      toast.error("页面切换已取消，请先处理映射保存失败")
      return
    }
    if (request !== navigationRequestRef.current) return
    const page = specPages(config.productSpec).find((item) => item.id === pageId)
    const bindings = specMap?.items.filter((item) => nodeById.get(item.body.id)?.pageId === pageId) ?? []
    const binding = bindings.find((item) => item.body.id === selectedId) ?? bindings[0]
    const destination = pageDestination(config.targetUrl, page?.routeHints)
    const frame = frameRef.current
    if (!page || !frame || config.project?.sourceType === "dev") return
    // Page navigation belongs to the page, not an arbitrary child's binding.
    if (destination) {
      const controller = new AbortController()
      candidateDiscoveryAbortRef.current = controller
      try {
        if (!(await navigateToPage(frame, destination, controller.signal)) && !controller.signal.aborted) {
          toast.info("页面地址未能恢复目标场景，请检查页面路由；定义仍可阅读。")
        }
      } catch {
        if (!controller.signal.aborted) toast.info("页面未能打开，请重试或在中间页面手动进入。")
      } finally {
        if (candidateDiscoveryAbortRef.current === controller) candidateDiscoveryAbortRef.current = null
      }
      return
    }
    if (!binding?.target.context?.url) {
      toast.info("该页面没有明确的 hash/query 导航提示，已打开其绑定清单")
      return
    }
    const target = new URL(binding.target.context.url, window.location.href)
    if (binding && frame?.contentDocument) {
      const liveTarget = resolveMappedTarget(binding, frame.contentDocument, nodeById.get(binding.body.id))
      if (liveTarget) {
        liveTarget.scrollIntoView({ block: "center", inline: "center" })
        return
      }
    }
    const nextContext = `${target.pathname}${target.search}${target.hash}`
    if (frame?.contentWindow && (binding || frameLocation(frame) !== nextContext)) {
      const controller = new AbortController()
      candidateDiscoveryAbortRef.current = controller
      const originalContext = frameLocation(frame)
      const originalDocument = frame.contentDocument
      try {
        const destination = binding ? await resolveMappedDestination({
          frame, annotation: binding, node: nodeById.get(binding.body.id),
          targetUrl: config.targetUrl, routeHints: page.routeHints, signal: controller.signal,
        }) : nextContext
        if (controller.signal.aborted || frame.contentDocument !== originalDocument || frameLocation(frame) !== originalContext) return
        if (destination) frame.contentWindow.location.href = destination
        else toast.info("无法精准打开该页面，已保留当前画面。请在中间页面手动进入；绑定清单仍可查看。")
      } catch {
        if (!controller.signal.aborted) toast.info("无法精准打开该页面，已保留当前画面。请手动进入。")
      } finally {
        if (candidateDiscoveryAbortRef.current === controller) candidateDiscoveryAbortRef.current = null
      }
    }
  }, [cancelCandidateDiscovery, cancelTargetPicking, config, dirtyRef, nodeById, saveMap, selectedId, specMap])

  const discoverVisibleCandidates = useCallback(() => {
    const results = new Map<string, CandidateTarget>()
    // Re-score all suggestions when the embedded page changes without reloading.
    void frameRevision
    if (!config || !frameDocument || !visibleMap) return results
    const targetsByType = new Map([
      ["ACTION", collectBindableTargets(frameDocument, "ACTION")],
      ["SURFACE", collectBindableTargets(frameDocument, "SURFACE")],
    ])
    const provisional: Array<[string, CandidateTarget]> = []
    for (const node of mappableNodes) {
      if (
        node.pageId &&
        currentPages.get(node.moduleId)?.pageId !== node.pageId
      ) {
        continue
      }
      const suggestion = computeSuggestion(
        frameDocument,
        node,
        Boolean(annotationFor(visibleMap, node.id)),
        targetsByType.get(node.type),
      )
      if (suggestion) provisional.push([node.id, suggestion])
    }
    const selectorCounts = new Map<string, number>()
    for (const [, suggestion] of provisional) {
      selectorCounts.set(
        suggestion.selector,
        (selectorCounts.get(suggestion.selector) ?? 0) + 1,
      )
    }
    for (const [nodeId, suggestion] of provisional) {
      if (selectorCounts.get(suggestion.selector) === 1) {
        results.set(nodeId, suggestion)
      }
    }
    return results
  }, [config, currentPages, frameDocument, frameRevision, mappableNodes, visibleMap])
  const visibleCandidates = useMemo(discoverVisibleCandidates, [discoverVisibleCandidates])
  const eligibleBatchCandidates = (candidates: Map<string, CandidateTarget>) => {
    const context = frameLocation(frameRef.current)
    return [...candidates].filter(([id, candidate]) => {
      if (candidate.confidence < 0.82 || !candidate.element.isConnected || !specMap || annotationFor(specMap, id)) return false
      return !specMap.items.some(item => {
        if (item.target.context?.url && item.target.context.url !== context) return false
        try { return [...(frameDocument?.querySelectorAll(item.target.selector.value) || [])].includes(candidate.element) }
        catch { return true }
      })
    })
  }
  const batchCount = eligibleBatchCandidates(visibleCandidates).length
  const bindHighConfidence = () => {
    if (!config?.canSaveSpecMap || workMode !== "map" || !specMap || !frameDocument || updateBlocked) return
    try {
      const context = frameLocation(frameRef.current)
      if (context !== frameContext || frameRef.current?.contentDocument !== frameDocument) {
        toast.message("页面正在切换，请稍后再试")
        return
      }
      const candidates = eligibleBatchCandidates(discoverVisibleCandidates())
      if (!candidates.length) { toast.message("当前页面没有可自动绑定的高关联项"); return }
      const annotations = candidates.map(([id, candidate]) => createAnnotation(id, candidate.element, specMap, context))
      setSpecMap({ ...specMap, items: [...specMap.items, ...annotations] })
      markMapDirty()
      setFrameRevision(value => value + 1)
      toast.message(`已绑定 ${annotations.length} 项，正在自动保存`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "一键绑定失败，请重试")
    }
  }
  const selectedAnnotation = selectedId && visibleMap
    ? annotationFor(visibleMap, selectedId)
    : null
  const candidate = selectedId && !selectedAnnotation
    ? locatedCandidate?.nodeId === selectedId && locatedCandidate.candidate.element.isConnected
      ? locatedCandidate.candidate
      : workMode === "map" && !candidateDiscoveryAbortRef.current ? visibleCandidates.get(selectedId) ?? null : null
    : null
  const candidateElement = candidate?.element ?? null
  const selectedMappingSelector = selectedAnnotation?.status === "confirmed"
    ? selectedAnnotation?.target.selector.value ?? null
    : null
  const selectedMappedTarget = useMemo(() => {
    if (!frameDocument || !selectedId || !selectedMappingSelector || !selectedAnnotation) return null
    return resolveMappedTarget(selectedAnnotation, frameDocument, nodeById.get(selectedId))
  }, [currentPages, frameContext, frameDocument, nodeById, selectedAnnotation, selectedId, selectedMappingSelector])

  useLayoutEffect(() => {
    if (!config) return
    const sidePanels = [navigatorPanelRef.current, inspectorPanelRef.current]
    for (const panel of sidePanels) {
      if (workMode === "map") panel?.expand()
      else panel?.collapse()
    }
  }, [config?.targetUrl, inspectorPanelRef, navigatorPanelRef, workMode])

  const applyConfig = useCallback((nextConfig: WorkbenchConfig) => {
    cancelCandidateDiscovery()
    resetPersistence(nextConfig)
    setConfig(nextConfig)
    setLauncher(null)
    setSpecMap(nextConfig.specMap)
    setPrdMap(nextConfig.prdMap)
    setWorkModeState(nextConfig.canSaveSpecMap ? "map" : "review")
    setSelectedId(null)
    mappingTargetIdRef.current = null
    setMappingTargetId(null)
    setSubmitting(false)
    setSubmitted(false)
    setExiting(false)
    setExitPanelOpen(false)
    setExportPanelOpen(false)
    setExporting(false)
    setSpecBrowserOpen(!nextConfig.canSaveSpecMap)
    setSpecOverviewCollapsed(false)
    setPrdRelatedOnly(true)
    setFullSpecOpen(false)
    setPrdBrowserOpen(Boolean(nextConfig.prdReview))
    setInspectorOpen(false)
    setInspectorPinned(false)
    setFrameDocument(null)
    setFrameContext("")
    setFrameRevision((value) => value + 1)
  }, [cancelCandidateDiscovery, resetPersistence])

  const loadLauncher = useCallback(async () => {
    const result = await loadLauncherData()
    setLauncher(result)
    resetPersistence(null)
    setConfig(null)
    setSpecMap(null)
    setPrdMap(null)
    setSelectedId(null)
    mappingTargetIdRef.current = null
    setMappingTargetId(null)
    setSubmitting(false)
    setSubmitted(false)
    setExiting(false)
    setExitPanelOpen(false)
    setExportPanelOpen(false)
    setExporting(false)
    setSpecBrowserOpen(false)
    setFullSpecOpen(false)
    setPrdBrowserOpen(false)
    setInspectorOpen(false)
    setInspectorPinned(false)
    cancelCandidateDiscovery()
  }, [cancelCandidateDiscovery, resetPersistence])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await loadWorkbenchConfig()
        if (!result) {
          if (active) await loadLauncher()
          return
        }
        if (active) applyConfig(result)
      } catch (error) {
        if (active) {
          setLoadingError(error instanceof Error ? error.message : "无法读取工作台配置")
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [applyConfig, loadLauncher])

  const openNode = useCallback((nodeId: string, initialTab = "definition") => {
    setSelectedId(nodeId)
    setInspectorTab(initialTab)
    setInspectorOpen(true)
  }, [])

  const restoreMappedNode = useCallback(async (nodeId: string) => {
    const annotation = specMap ? annotationFor(specMap, nodeId) : null
    const frame = frameRef.current
    const targetUrl = annotation?.target.context?.url
    if (!annotation || !frame || !config) return

    const request = navigationRequestRef.current
    if (dirtyRef.current && !(await saveMap(false))) {
      if (request === navigationRequestRef.current) toast.error("页面切换已取消，请先处理映射保存失败")
      return
    }
    if (request !== navigationRequestRef.current) return
    const currentUrl = frameLocation(frame)
    const originalDocument = frame.contentDocument
    const node = nodeById.get(nodeId)
    const verifiedTarget = (doc: Document) => resolveMappedTarget(annotation, doc, node)
    const declaredPage = node ? pageForNode(config.productSpec, node) : null
    // A generic input may match in two conversations. Its saved page takes
    // precedence when explicit page routing exists; legacy dynamic pages keep
    // accepting a verified live target reached through another entry.
    if (frame.contentDocument && (!declaredPage?.routeHints?.length || !targetUrl || currentUrl === targetUrl)) {
      const target = verifiedTarget(frame.contentDocument)
      if (target) {
        target.focus({ preventScroll: true })
        setLocateRequest((value) => value + 1)
        return
      }
    }

    if (targetUrl && /^\/target\//.test(targetUrl)) {
      const controller = new AbortController()
      candidateDiscoveryAbortRef.current = controller
      try {
        const destination = await resolveMappedDestination({
          frame, annotation, node, targetUrl: config.targetUrl,
          routeHints: node ? pageForNode(config.productSpec, node)?.routeHints : [], signal: controller.signal,
        })
        if (controller.signal.aborted || frame.contentDocument !== originalDocument || frameLocation(frame) !== currentUrl) return
        if (destination) {
          frame.contentWindow!.location.href = destination
          return
        }
      } catch {
        if (controller.signal.aborted) return
      } finally {
        if (candidateDiscoveryAbortRef.current === controller) candidateDiscoveryAbortRef.current = null
      }
    }
    const destination = config.project?.sourceType !== "dev"
      ? pageDestination(config.targetUrl, node ? pageForNode(config.productSpec, node)?.routeHints : []) : null
    if (destination) {
      const controller = new AbortController()
      candidateDiscoveryAbortRef.current = controller
      try {
        const doc = await navigateToPage(frame, destination, controller.signal)
        if (controller.signal.aborted) return
        if (doc && verifiedTarget(doc)) setLocateRequest(value => value + 1)
        else toast.info(doc ? "已进入所属页面，原关联位置尚未找到或需要复核；已保留原映射。" : "页面地址未能恢复目标场景；已保留原映射。")
      } catch {
        if (!controller.signal.aborted) toast.info("页面未能打开；已保留原映射。")
      } finally {
        if (candidateDiscoveryAbortRef.current === controller) candidateDiscoveryAbortRef.current = null
      }
      return
    }
    toast.info(currentUrl === targetUrl
      ? "关联仍然有效。请在中间页面手动进入对应演示场景；组件出现后会自动定位，无需重新绑定。"
      : "无法精准定位，未跳转。关联仍然保留，请在中间页面手动进入对应场景。")
  }, [config, dirtyRef, nodeById, saveMap, specMap])

  const locateBestCandidate = useCallback(async (nodeId: string) => {
    const node = nodeById.get(nodeId)
    const frame = frameRef.current
    if (!config || !node || !frame || !MAPPABLE_TYPES.has(node.type)) return
    if (visibleMap && annotationFor(visibleMap, nodeId)) return
    const controller = new AbortController()
    candidateDiscoveryAbortRef.current = controller
    const destination = config.project?.sourceType !== "dev"
      ? pageDestination(config.targetUrl, pageForNode(config.productSpec, node)?.routeHints) : null
    try {
      if (dirtyRef.current && !(await saveMap(false))) {
        if (!controller.signal.aborted) toast.error("页面切换已取消，请先处理映射保存失败")
        return
      }
      if (controller.signal.aborted) return
      // Resolve the page before considering same-named controls in the live DOM.
      if (destination && !(await navigateToPage(frame, destination, controller.signal))) {
        if (!controller.signal.aborted) toast.info("页面地址未能恢复目标场景，请检查页面路由；定义仍可阅读。")
        return
      }
      if (controller.signal.aborted) return
      const liveDocument = frame.contentDocument
      if (!liveDocument) return
      const candidate = computeSuggestion(liveDocument, node, false,
        collectBindableTargets(liveDocument, node.type),
        { minimumConfidence: workMode === "review" ? 0.82 : destination ? 0.58 : 0.01 })
      setFrameDocument(liveDocument)
      setFrameContext(frameLocation(frame))
      setFrameRevision(value => value + 1)
      if (candidate) {
        setLocatedCandidate({ nodeId, candidate })
        setLocateRequest(value => value + 1)
      } else {
        toast.info(destination
          ? "已进入所属页面，暂未找到该区域或控件；请进入相应状态后继续查看。"
          : "当前页没有可靠候选，且未配置明确路由，未自动跨页检索。请在中间页面进入对应场景。")
      }
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "无法打开目标页面")
    } finally {
      if (candidateDiscoveryAbortRef.current === controller) candidateDiscoveryAbortRef.current = null
    }
  }, [config, dirtyRef, nodeById, saveMap, visibleMap, workMode])

  const selectSpecNode = useCallback(
    (nodeId: string) => {
      cancelTargetPicking()
      cancelCandidateDiscovery()
      const annotation = visibleMap ? annotationFor(visibleMap, nodeId) : null
      const status = visibleMap ? mappingStatus(visibleMap, nodeId) : "unmapped"
      const mappingNeedsAttention = !annotation || ["invalid", "ambiguous", "drifted"].includes(status)
      const selectingAnotherNode = selectedId !== nodeId
      if (selectingAnotherNode) {
        openNode(nodeId, workMode === "review" ? "definition" : mappingNeedsAttention ? "mapping" : "definition")
      } else {
        setSelectedId(nodeId)
        setInspectorOpen(true)
      }
      setLocateRequest((value) => value + 1)
      if (workMode === "map") setSpecBrowserOpen(false)
      if (annotation) void restoreMappedNode(nodeId)
      else void locateBestCandidate(nodeId)
    },
    [cancelCandidateDiscovery, cancelTargetPicking, locateBestCandidate, openNode, restoreMappedNode, selectedId, visibleMap, workMode],
  )

  useEffect(() => cancelCandidateDiscovery, [cancelCandidateDiscovery])

  useEffect(() => { setMarkerChoices([]) }, [frameDocument, frameContext, workMode])
  const selectMarkerNode = useCallback(
    (nodeId: string) => {
      mappingTargetIdRef.current = null
      setMappingTargetId(null)
      clearMappingTargetPreview(frameDocument)
      const ids = frameDocument && visibleMap ? nodeIdsAtMarker(frameDocument, visibleMap, nodeId) : []
      if (ids.length > 1) { setMarkerChoices(ids); return }
      openNode(nodeId)
    },
    [frameDocument, openNode, visibleMap],
  )

  const changeWorkMode = useCallback(
    (nextMode: WorkMode) => {
      if (nextMode === workMode) return
      if (nextMode === "map" && !config?.canSave) {
        toast.error("当前会话只能使用评审模式")
        return
      }
      cancelCandidateDiscovery()
      workModeRef.current = nextMode
      setWorkModeState(nextMode)
      mappingTargetIdRef.current = null
      setMappingTargetId(null)
      setSpecBrowserOpen(nextMode === "review")
      setSpecOverviewCollapsed(false)
      setInspectorOpen(false)
      setInspectorPinned(false)
      setInspectorTab("definition")
      clearDropFeedback(frameDocument)
      clearMappingTargetPreview(frameDocument)
    },
    [cancelCandidateDiscovery, config?.canSave, frameDocument, workMode],
  )

  const startMappingNode = useCallback(
    (nodeId: string) => {
      if (!config?.canSave) {
        toast.error("当前会话只能查看页面关联")
        return
      }
      const node = nodeById.get(nodeId)
      if (!node || !MAPPABLE_TYPES.has(node.type)) {
        toast.error("当前 Spec 节点不能直接关联页面元素")
        return
      }
      cancelCandidateDiscovery()
      workModeRef.current = "map"
      setWorkModeState("map")
      setSelectedId(nodeId)
      mappingTargetIdRef.current = nodeId
      setMappingTargetId(nodeId)
      setSpecBrowserOpen(false)
      setInspectorOpen(false)
      setInspectorPinned(false)
      clearDropFeedback(frameDocument)
      clearMappingTargetPreview(frameDocument)
      toast.message(`请在页面上选择「${node.title}」对应的功能，Esc 取消`)
    },
    [cancelCandidateDiscovery, config?.canSave, frameDocument, nodeById],
  )

  const mapNodeToElement = useCallback(
    (nodeId: string, rawElement: Element | null) => {
      if (!config?.canSave || !specMap) return false
      const node = nodeById.get(nodeId)
      const target = meaningfulTarget(rawElement, node)
      if (!target) {
        toast.error(
          node?.type === "ACTION"
            ? "这里不是可识别的交互目标，请选择原生控件、ARIA 控件或有明确交互提示的元素"
            : "这里不是有语义的页面区域，请选择 main、section 或 region",
        )
        return false
      }
      try {
        const contextUrl = frameLocation(frameRef.current)
        const annotation = createAnnotation(
          nodeId,
          target,
          specMap,
          contextUrl,
        )
        setSpecMap((current) =>
          current
            ? {
                ...current,
                items: [
                  ...current.items.filter((item) => item.body.id !== nodeId),
                  annotation,
                ],
              }
            : current,
        )
        markMapDirty()
        setLocatedCandidate(null)
        setSelectedId(nodeId)
        mappingTargetIdRef.current = null
        setMappingTargetId(null)
        clearMappingTargetPreview(frameDocument)
        setInspectorTab("definition")
        setSpecBrowserOpen(false)
        setInspectorOpen(true)
        setFrameRevision((value) => value + 1)
        toast.success(`已关联：${node?.title ?? nodeId}`)
        return true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "无法建立映射")
        return false
      }
    },
    [config?.canSave, config?.specRevision, frameDocument, markMapDirty, nodeById, specMap],
  )

  useEffect(() => {
    workModeRef.current = workMode
    mappingTargetIdRef.current = mappingTargetId
    mapNodeToElementRef.current = mapNodeToElement
  }, [mapNodeToElement, mappingTargetId, workMode])

  const handleFrameLoad = useCallback(() => {
    const frame = frameRef.current
    const doc = frame?.contentDocument ?? null
    const contextUrl = frameLocation(frame)
    setFrameDocument(doc)
    setFrameContext(contextUrl)
    setFrameRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    const doc = frameDocument
    if (!doc) return
    const view = doc.defaultView
    const scheduleRefresh = () => {
      setFrameContext(frameLocation(frameRef.current))
      setFrameRevision((value) => value + 1)
    }
    view?.addEventListener("scroll", scheduleRefresh, true)
    view?.addEventListener("resize", scheduleRefresh)
    view?.addEventListener("hashchange", scheduleRefresh)
    view?.addEventListener("popstate", scheduleRefresh)
    view?.addEventListener("ips-review-route-change", scheduleRefresh)
    doc.addEventListener("transitionend", scheduleRefresh, true)
    doc.addEventListener("animationend", scheduleRefresh, true)
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.every((mutation) =>
          (mutation.target as Element).closest?.("#ips-overlay-host"),
        )
      ) {
        return
      }
      scheduleRefresh()
    })
    if (doc.body) {
      observer.observe(doc.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      })
    }
    return () => {
      view?.removeEventListener("scroll", scheduleRefresh, true)
      view?.removeEventListener("resize", scheduleRefresh)
      view?.removeEventListener("hashchange", scheduleRefresh)
      view?.removeEventListener("popstate", scheduleRefresh)
      view?.removeEventListener("ips-review-route-change", scheduleRefresh)
      doc.removeEventListener("transitionend", scheduleRefresh, true)
      doc.removeEventListener("animationend", scheduleRefresh, true)
      observer.disconnect()
    }
  }, [frameDocument])

  useEffect(() => {
    if (!frameDocument || !visibleMap) return
    renderFrameOverlay({
      doc: frameDocument,
      map: visibleMap,
      nodeById,
      activeNodeId: selectedId,
      mappingTargetId,
      candidate,
      workMode,
      onSelect: selectMarkerNode,
    })
  }, [candidate, frameDocument, frameRevision, mappingTargetId, nodeById, selectMarkerNode, selectedId, visibleMap, workMode])

  useEffect(() => {
    const target = selectedMappedTarget ?? (candidateElement?.isConnected ? candidateElement : null)
    if (!target) return
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth"
    target.scrollIntoView({ behavior, block: "center", inline: "center" })
    const timeout = window.setTimeout(() => {
      setFrameContext(frameLocation(frameRef.current))
      setFrameRevision((value) => value + 1)
    }, behavior === "smooth" ? 220 : 0)
    return () => window.clearTimeout(timeout)
  }, [candidateElement, frameDocument, locateRequest, selectedMappedTarget])

  useEffect(() => () => removeFrameOverlay(frameDocument), [frameDocument])

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener("pointermove", handleMove, true)
    return () => window.removeEventListener("pointermove", handleMove, true)
  }, [])

  const pointInsideFrame = useCallback((point: { x: number; y: number } | null) => {
    const frame = frameRef.current
    if (!point || !frame) return null
    const rect = frame.getBoundingClientRect()
    if (
      point.x < rect.left ||
      point.x > rect.right ||
      point.y < rect.top ||
      point.y > rect.bottom ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      return null
    }
    return {
      x: (point.x - rect.left) * (frame.clientWidth / rect.width),
      y: (point.y - rect.top) * (frame.clientHeight / rect.height),
    }
  }, [])

  const frameElementAtPoint = useCallback(
    (point: { x: number; y: number } | null) => {
      if (!frameDocument || !point) return null
      const host = frameDocument.querySelector<HTMLElement>("#ips-overlay-host")
      const previousVisibility = host?.style.visibility
      if (host) host.style.visibility = "hidden"
      const element = frameDocument.elementFromPoint(point.x, point.y)
      if (host) host.style.visibility = previousVisibility ?? ""
      return element
    },
    [frameDocument],
  )

  const activateFrameElement = useCallback((rawElement: Element | null) => {
    const target = resolveInteractiveTarget(rawElement)
    if (!target) return false
    target.focus({ preventScroll: true })
    target.click()
    return true
  }, [])

  const handleFrameProxyClick = useCallback(
    (point: { x: number; y: number }) => {
      const innerPoint = pointInsideFrame(point)
      const rawElement = frameElementAtPoint(innerPoint)
      if (workMode === "map" && mappingTargetId) {
        if (rawElement) mapNodeToElement(mappingTargetId, rawElement)
        return
      }
      if (innerPoint && visibleMap && frameDocument) {
        const marker = annotationAtMarkerPoint(
          frameDocument,
          visibleMap,
          innerPoint,
        )
        if (marker) {
          selectMarkerNode(marker.body.id)
          return
        }
      }
      if (!rawElement) return
      activateFrameElement(rawElement)
    },
    [
      activateFrameElement,
      frameDocument,
      frameElementAtPoint,
      mapNodeToElement,
      mappingTargetId,
      pointInsideFrame,
      selectMarkerNode,
      visibleMap,
      workMode,
    ],
  )

  const handleFrameProxyPointerMove = useCallback(
    (point: { x: number; y: number }) => {
      const innerPoint = pointInsideFrame(point)
      if (
        innerPoint &&
        frameDocument &&
        workMode === "map" &&
        mappingTargetId
      ) {
        setFrameMarkerHover(frameDocument, null)
        renderMappingTargetPreview(
          frameDocument,
          nodeById.get(mappingTargetId),
          frameElementAtPoint(innerPoint),
        )
        return false
      }
      const marker = innerPoint && visibleMap && frameDocument
        ? annotationAtMarkerPoint(
            frameDocument,
            visibleMap,
            innerPoint,
          )
        : null
      setFrameMarkerHover(frameDocument, marker?.body.id ?? null)
      clearMappingTargetPreview(frameDocument)
      return Boolean(marker)
    },
    [
      frameDocument,
      frameElementAtPoint,
      mappingTargetId,
      nodeById,
      pointInsideFrame,
      visibleMap,
      workMode,
    ],
  )

  const renderDragFeedbackAt = useCallback(
    (point: { x: number; y: number } | null, nodeId: string | null) => {
      if (!frameDocument || !nodeId) return null
      clearMappingTargetPreview(frameDocument)
      const innerPoint = pointInsideFrame(point)
      if (!innerPoint) {
        clearDropFeedback(frameDocument)
        return null
      }
      return renderDropFeedback(
        frameDocument,
        nodeById.get(nodeId),
        innerPoint.x,
        innerPoint.y,
      )
    },
    [frameDocument, nodeById, pointInsideFrame],
  )

  const saveSpecNode = useCallback(async (nodeId: string, patch: SpecNodePatch) => {
    if (!config?.canSaveSpec) throw new Error("当前会话没有可写入的本地 Spec 原文件")
    let found = false
    const nextSpec = {
      ...config.productSpec,
      modules: config.productSpec.modules.map((module) => ({
        ...module,
        nodes: module.nodes.map((node) => {
          if (node.id !== nodeId) return node
          found = true
          return { ...node, ...patch }
        }),
      })),
    }
    if (!found) throw new Error("当前 Spec 节点不存在")

    const result = await saveSpecDraft({
      nodeId,
      productSpec: nextSpec,
      baseRevision: config.specRevision,
    })
    setConfig((current) => current ? {
      ...current,
      productSpec: result.productSpec,
      specRevision: result.specRevision,
      sourceSpecRevision: result.sourceSpecRevision ?? current.sourceSpecRevision,
      specDocument: result.specDocument !== undefined ? result.specDocument : current.specDocument ? { ...current.specDocument, pendingDraft: result.changeCount > 0 } : null,
      draftChangeCount: result.changeCount,
      reviewBaseline: result.reviewBaseline,
    } : current)
    setFrameRevision((value) => value + 1)
    toast.success(result.saveTarget === "codex-gate-draft"
      ? "修订草稿已保存，等待提交给 Codex"
      : "已保存到本地 Spec 原文件")
  }, [config])

  const savePrdRelations = useCallback(async (sectionIds: string[]) => {
    if (!config?.prd || !prdMap || !config.canSavePrdMap) {
      toast.error("当前项目没有可写入的 PRD 页面映射")
      return
    }
    const context = frameContext || config.targetUrl
    if (!/^\/target(?:-dev)?\//.test(context)) {
      toast.error("当前页面上下文尚未准备完成")
      return
    }
    const validIds = new Set(config.prd.sections.map((section) => section.id))
    const uniqueIds = [...new Set(sectionIds)].filter((id) => validIds.has(id))
    const nextMap = structuredClone(prdMap)
    const existingIndex = nextMap.items.findIndex((item) => item.page.context.url === context)
    if (uniqueIds.length === 0) {
      if (existingIndex >= 0) nextMap.items.splice(existingIndex, 1)
    } else {
      const pageTitle = frameDocument?.title?.trim() || config.productSpec.product.title
      const pageId = [...currentPages.values()][0]?.pageId ?? null
      const now = new Date().toISOString()
      if (existingIndex >= 0) {
        const existing = nextMap.items[existingIndex]
        nextMap.items[existingIndex] = {
          ...existing,
          page: { pageId, title: pageTitle, context: { url: context } },
          sectionIds: uniqueIds,
          updatedAt: now,
        }
      } else {
        const baseId = `页面关联-${pageTitle.replace(/\s+/g, "") || "当前页面"}`
        let id = baseId
        let suffix = 2
        while (nextMap.items.some((item) => item.id === id)) {
          id = `${baseId}-${suffix}`
          suffix += 1
        }
        nextMap.items.push({
          id,
          page: { pageId, title: pageTitle, context: { url: context } },
          sectionIds: uniqueIds,
          confirmedAt: now,
          updatedAt: now,
        })
      }
    }

    setSavingPrdMap(true)
    try {
      const result = await savePrdPageMap({
        baseRevision: config.prdMapRevision,
        prdMap: nextMap,
      })
      const savedMap = { ...nextMap, updatedAt: result.updatedAt }
      setPrdMap(savedMap)
      setConfig((current) => current ? {
        ...current,
        prdMap: savedMap,
        prdMapRevision: result.prdMapRevision,
        reviewBaseline: result.reviewBaseline,
        prdMapStale: false,
        missingPrdSectionIds: [],
      } : current)
      toast.success(uniqueIds.length ? "当前页面的 PRD 关联已保存" : "已解除当前页面的 PRD 关联")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PRD 页面关联保存失败")
    } finally {
      setSavingPrdMap(false)
    }
  }, [config, currentPages, frameContext, frameDocument, prdMap])

  const submitToCodex = useCallback(async () => {
    if (!config?.canSubmitToCodex || submitted) return
    setSubmitting(true)
    try {
      let attempts = 0
      while ((dirtyRef.current || activeSaveRef.current) && attempts < 3) {
        attempts += 1
        if (!(await saveMap())) return
      }
      if (dirtyRef.current || activeSaveRef.current) {
        throw new Error("仍有页面映射等待保存，请稍后重试")
      }
      await submitReviewToCodex()
      setSubmitted(true)
      toast.success("已提交给 Codex；Codex 将修订原始 Spec 文档")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法提交给 Codex")
    } finally {
      setSubmitting(false)
    }
  }, [config?.canSubmitToCodex, saveMap, submitted])

  const exportReviewPackage = useCallback(async () => {
    if (!config?.reviewPackage?.canExport || exporting) return
    setExporting(true)
    try {
      let attempts = 0
      while ((dirtyRef.current || activeSaveRef.current) && attempts < 3) {
        attempts += 1
        if (!(await saveMap())) return
      }
      if (dirtyRef.current || activeSaveRef.current) {
        throw new Error("仍有页面映射等待保存，请稍后重试")
      }
      const result = await prepareReviewPackage()
      const link = document.createElement("a")
      link.href = `/api/review-package/${encodeURIComponent(result.id)}`
      link.download = result.filename
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      setExportPanelOpen(false)
      toast.success(`只读评审包已生成 · ${result.fileCount} 个文件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "只读评审包生成失败")
    } finally {
      setExporting(false)
    }
  }, [config?.reviewPackage?.canExport, exporting, saveMap])

  const returnToProjects = useCallback(async () => {
    if (!config?.canReturnToProjects || exiting) return
    const hasUnsubmittedSpecDraft = Boolean(
      config.canSubmitToCodex && config.draftChangeCount > 0 && !submitted,
    )
    if (
      hasUnsubmittedSpecDraft &&
      !window.confirm(
        "退出后，尚未提交给 Codex 的 Spec 修订草稿将被放弃；页面映射会先尝试保存。是否退出当前工作台？",
      )
    ) return
    if (
      !hasUnsubmittedSpecDraft &&
      (dirtyRef.current || activeSaveRef.current) &&
      !window.confirm("退出前会先保存当前页面映射。是否退出当前工作台？")
    ) return
    setExiting(true)
    try {
      let attempts = 0
      while ((dirtyRef.current || activeSaveRef.current) && attempts < 3) {
        attempts += 1
        if (!(await saveMap())) return
      }
      if (dirtyRef.current || activeSaveRef.current) {
        toast.error("仍有映射等待保存，请稍后重试")
        return
      }
      removeFrameOverlay(frameDocument)
      await closeCurrentProject()
      setSelectedId(null)
      mappingTargetIdRef.current = null
      setMappingTargetId(null)
      setFrameDocument(null)
      setFrameContext("")
      setExitPanelOpen(false)
      await loadLauncher()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法返回项目中心")
    } finally {
      setExiting(false)
    }
  }, [config, exiting, frameDocument, loadLauncher, saveMap, submitted])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        mappingTargetIdRef.current &&
        !event.defaultPrevented
      ) {
        event.preventDefault()
        event.stopPropagation()
        mappingTargetIdRef.current = null
        setMappingTargetId(null)
        clearDropFeedback(frameDocument)
        clearMappingTargetPreview(frameDocument)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSpecBrowserOpen(true)
        setSpecOverviewCollapsed(false)
        return
      }
      if (event.key === "Escape" && specBrowserOpen && !event.defaultPrevented) {
        event.preventDefault()
        setSpecBrowserOpen(false)
        return
      }
      if (
        event.key === "Escape" &&
        inspectorOpen &&
        !inspectorPinned &&
        !event.defaultPrevented
      ) {
        event.preventDefault()
        setInspectorOpen(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void saveMap(true)
      }
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !saving) return
      event.preventDefault()
    }
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [dirty, frameDocument, inspectorOpen, inspectorPinned, saveMap, saving, specBrowserOpen])

  const inspector = (
    <SpecInspector
      node={selectedNode}
      nodes={nodes}
      nodeById={nodeById}
      pages={config?.productSpec.pages}
      images={config?.specDocument?.images}
      prd={config?.prd}
            onLocatePrd={id => { setPrdSourceTarget({ id, request: Date.now() }); setPrdBrowserOpen(true) }}
      annotation={selectedId && visibleMap ? annotationFor(visibleMap, selectedId) : null}
      status={selectedId && visibleMap ? mappingStatus(visibleMap, selectedId) : "unmapped"}
      issue={selectedId ? validated?.issues.get(selectedId) : undefined}
      candidate={candidate}
      canSave={Boolean(config?.canSave && workMode === "map")}
      canSaveSpec={Boolean(config?.canSaveSpec && workMode === "map")}
      specEditMode={config?.specEditMode ?? "readonly"}
      specPath={config?.sourceSpecPath || config?.specPath || ""}
      tab={inspectorTab}
      pinned={inspectorPinned}
      onTabChange={setInspectorTab}
      onClose={() => setInspectorOpen(false)}
      onTogglePin={() => setInspectorPinned((value) => !value)}
      reviewMode={workMode === "review"}
      showBackToList={workMode === "review" && specBrowserOpen}
      onBackToList={() => {
        setInspectorOpen(false)
        setInspectorPinned(false)
        setSpecBrowserOpen(true)
        setSpecOverviewCollapsed(false)
      }}
      onStartMapping={() => {
        if (selectedId) startMappingNode(selectedId)
      }}
      onAcceptCandidate={() => {
        if (selectedId && candidate) mapNodeToElement(selectedId, candidate.element)
      }}
      onUnmap={() => {
        if (!selectedId || !config?.canSave) return
        setSpecMap((current) =>
          current
            ? {
                ...current,
                items: current.items.filter((item) => item.body.id !== selectedId),
              }
            : current,
        )
        markMapDirty()
        setInspectorTab("mapping")
        setFrameRevision((value) => value + 1)
        toast.success("已解除页面映射")
      }}
      onEditingChange={setEditingSpec}
      onSaveSpecNode={(patch) => {
        if (!selectedId) return Promise.reject(new Error("请先选择 Spec 节点"))
        return saveSpecNode(selectedId, patch)
      }}
      persistent={workMode === "map"}
    />
  )

  useEffect(() => {
    setRuntimeDirty('workbench', Boolean(dirty || saving || savingPrdMap || editingSpec || editingPrdMap || submitting || exporting || mappingTargetId || draggingId || config?.draftChangeCount))
    return () => setRuntimeDirty('workbench', false)
  }, [dirty, saving, savingPrdMap, editingSpec, editingPrdMap, submitting, exporting, mappingTargetId, draggingId, config?.draftChangeCount])

  if (loadingError) {
    return (
      <div className="grid h-dvh place-content-center gap-3 bg-muted/40 px-6 text-center">
        <CircleDotDashed className="mx-auto size-8 text-destructive" />
        <h1 className="text-lg font-semibold">工作台无法载入</h1>
        <p className="text-sm text-muted-foreground">{loadingError}</p>
      </div>
    )
  }

  if (launcher) {
    return (
      <Suspense fallback={(
        <div className="grid h-dvh place-content-center justify-items-center gap-3 bg-muted/30 text-sm text-muted-foreground">
          <LoaderCircle className="size-6 animate-spin text-emerald-700" />
          正在载入项目中心…
        </div>
      )}>
        <ProjectCenter launcher={launcher} onEnter={applyConfig} />
      </Suspense>
    )
  }

  if (!config || !visibleMap) {
    return (
      <div className="grid h-dvh place-content-center justify-items-center gap-3 bg-muted/30 text-sm text-muted-foreground">
        <LoaderCircle className="size-6 animate-spin text-emerald-700" />
        正在载入咔哒产品工作台…
      </div>
    )
  }

  const mappedCount = mappableNodes.filter((node) =>
    visibleMap.items.some((item) => item.body.id === node.id),
  ).length
  const draggingNode = draggingId ? nodeById.get(draggingId) : null
  const mapSaveLabel = !config.canSaveSpecMap
    ? "只读模式"
    : saving
      ? "自动保存中"
      : saveError
        ? "保存失败 · 重试"
        : dirty
          ? "等待自动保存"
          : "已自动保存"
  const mapSaveTitle = !config.canSaveSpecMap
    ? "当前会话只查看页面关联，不会写入映射"
    : saveError
      ? `自动保存失败：${saveError}。点击重试`
      : dirty
        ? "映射将在短暂停顿后自动保存；点击可立即保存"
        : "spec-map.json 已自动保存"
  const specNavigator = (
    <SpecSidebar
      bundle={config.productSpec}
      map={visibleMap}
      selectedId={selectedId}
      mappingTargetId={mappingTargetId}
      query={query}
      filter={filter}
      workMode={workMode}
      canSave={config.canSave}
      candidates={visibleCandidates}
      onQueryChange={setQuery}
      onFilterChange={setFilter}
      onSelectPage={(pageId) => void selectSpecPage(pageId)}
      onCollapse={() => setSpecOverviewCollapsed(true)}
      onReadFull={config.specDocument ? () => setFullSpecOpen(true) : undefined}
      onSelect={selectSpecNode}
      onClose={() => setSpecBrowserOpen(false)}
      onPointerStart={(point) => {
        pointerRef.current = point
      }}
      persistent={workMode === "map"}
    />
  )
  const pageCanvas = (
    <CanvasWorkbench
      key={config.targetUrl}
      projectKey={config.project?.projectPath || config.sourceSpecPath || config.specPath || config.targetUrl.split(/[?#]/)[0]}
      batchBinding={workMode === "map" && config.canSaveSpecMap ? { count: batchCount, disabled: Boolean(updateBlocked), onBind: bindHighConfidence } : undefined}
      targetUrl={config.targetUrl}
      mappingActive={Boolean(mappingTargetId)}
      dragging={Boolean(draggingId)}
      frameRef={frameRef}
      onFrameLoad={handleFrameLoad}
      onFrameProxyClick={handleFrameProxyClick}
      onFrameProxyPointerMove={handleFrameProxyPointerMove}
      onFrameProxyPointerLeave={() => {
        setFrameMarkerHover(frameDocument, null)
        clearMappingTargetPreview(frameDocument)
      }}
    />
  )

  return (
    <TooltipProvider>
      <DragDropProvider
        onDragStart={(event) => {
          const nodeId = String(event.operation.source?.data.nodeId ?? event.operation.source?.id ?? "")
          if (!nodeById.has(nodeId)) return
          cancelCandidateDiscovery()
          const point = pointFromEvent(event.nativeEvent)
          if (point) pointerRef.current = point
          mappingTargetIdRef.current = null
          setMappingTargetId(null)
          setDraggingId(nodeId)
          setSelectedId(nodeId)
          setInspectorTab("mapping")
          setInspectorOpen(false)
          setInspectorPinned(false)
        }}
        onDragMove={(event) => {
          const point = pointFromEvent(event.nativeEvent)
          if (point) pointerRef.current = point
          const nodeId = String(event.operation.source?.data.nodeId ?? event.operation.source?.id ?? draggingId ?? "")
          renderDragFeedbackAt(pointerRef.current, nodeId)
        }}
        onDragEnd={(event) => {
          const nodeId = String(event.operation.source?.data.nodeId ?? event.operation.source?.id ?? draggingId ?? "")
          const point = pointFromEvent(event.nativeEvent) ?? pointerRef.current
          const innerPoint = pointInsideFrame(point)
          if (!event.canceled && frameDocument && innerPoint && nodeById.has(nodeId)) {
            mapNodeToElement(
              nodeId,
              frameDocument.elementFromPoint(innerPoint.x, innerPoint.y),
            )
          } else if (
            !event.canceled &&
            frameDocument &&
            event.operation.target?.id === "target-canvas" &&
            nodeById.has(nodeId)
          ) {
            const node = nodeById.get(nodeId)!
            const keyboardCandidate = computeSuggestion(
              frameDocument,
              node,
              Boolean(annotationFor(visibleMap, nodeId)),
            )
            if (keyboardCandidate) mapNodeToElement(nodeId, keyboardCandidate.element)
          }
          clearDropFeedback(frameDocument)
          setDraggingId(null)
        }}
      >
        <div className="grid h-dvh w-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[56px_auto_minmax(0,1fr)] overflow-hidden bg-background">
          <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-background/96 px-3.5 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark className="size-9" />
              {!config.reviewPackage?.portable && <div id="runtime-status-slot" className="shrink-0" />}
              <div className="min-w-0">
                <p className="hidden text-[10px] font-semibold text-emerald-300 sm:block">咔哒 · 产品工作台</p>
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="max-w-40 truncate text-sm font-semibold lg:max-w-64 2xl:max-w-88">{config.productSpec.product.title}</h1>
                  <Badge variant="secondary" className="hidden rounded-full text-[9px] md:inline-flex">v{config.productSpec.product.version}</Badge>
                </div>
              </div>
              {mappableNodes.length ? <Tabs
                value={workMode}
                onValueChange={(value) => changeWorkMode(value as WorkMode)}
                data-testid="work-mode-switch"
                className="ml-1 shrink-0"
              >
                <TabsList aria-label="工作模式" className="h-8 rounded-xl bg-muted/55 p-0.5">
                  <TabsTrigger
                    value="map"
                    disabled={!config.canSave}
                    className="rounded-lg px-2.5 text-[11px]"
                  >
                    <Link2 className="size-3.5" />
                    <span className="hidden xl:inline">绑定模式</span>
                  </TabsTrigger>
                  <TabsTrigger value="review" className="rounded-lg px-2.5 text-[11px]">
                    <FileCheck2 className="size-3.5" />
                    <span className="hidden xl:inline">评审模式</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs> : null}
            </div>

            <div className="flex shrink-0 items-center gap-2" aria-label="工作台操作">
              <div className="flex h-9 items-center gap-0.5 rounded-xl border border-white/8 bg-muted/25 p-1" aria-label="评审资料">
                {config.prd ? (
                  <RelatedPrdButton compact count={relatedPrdSectionIds.length} annotationReview={Boolean(config.prdReview)} onClick={() => setPrdBrowserOpen(true)} />
                ) : null}
                <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2.5"
                  aria-label="完整 Spec" disabled={!config.specDocument}
                  title={config.specDocument ? "阅读完整 Spec" : "未提供 Markdown Spec 来源"}
                  onClick={() => setFullSpecOpen(true)}>
                  <BookOpen /><span className="hidden xl:inline">完整 Spec</span>
                </Button>
                {mappableNodes.length && workMode === "review" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg bg-transparent px-2.5 hover:bg-white/6"
                    data-testid="spec-binding-status"
                    aria-expanded={specBrowserOpen}
                    onClick={() => { setSpecBrowserOpen(true); setSpecOverviewCollapsed(false) }}
                    title="查找并阅读 Spec（⌘K）"
                  >
                    <Search />
                    <span className="hidden xl:inline">查找 Spec</span>
                  </Button>
                ) : mappableNodes.length ? (
                  <Badge variant="secondary" className="h-7 rounded-lg border-0 bg-transparent px-2.5 text-[11px]" data-testid="spec-binding-status">
                    <Link2 className="size-3.5 text-emerald-300" />
                    <span className="hidden 2xl:inline">Spec 绑定</span>
                    {mappedCount}/{mappableNodes.length}
                  </Badge>
                ) : null}
              </div>

              <div className="flex h-9 items-center gap-0.5 rounded-xl border border-white/8 bg-muted/25 p-1" aria-label="交付与会话">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg bg-transparent px-2.5 hover:bg-white/6"
                  onClick={() => setExportPanelOpen(true)}
                  aria-label="导出与发布"
                  data-testid="open-review-export"
                  title={config.reviewPackage?.canExport
                    ? "导出 ZIP 或发布到本机局域网"
                    : config.reviewPackage?.blockReason || "当前来源不能导出"}
                >
                  <Archive />
                  <span className="hidden xl:inline">导出与发布</span>
                </Button>
              {config.canSubmitToCodex ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-lg bg-transparent px-2.5 hover:bg-white/6"
                  disabled={submitting || submitted}
                  onClick={() => void submitToCodex()}
                  title="提交节点级修改，由等待中的 Codex 修订原始 Markdown Spec"
                >
                  {submitting ? <LoaderCircle className="animate-spin" /> : <Send />}
                  <span className="hidden 2xl:inline">
                    {submitted
                      ? "已提交 Codex"
                      : `提交 Codex${config.draftChangeCount ? ` · ${config.draftChangeCount}` : ""}`}
                  </span>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-lg bg-transparent px-2.5 hover:bg-white/6"
                disabled={!config.canReturnToProjects || exiting}
                onClick={() => setExitPanelOpen(true)}
                aria-label="离开当前工作台"
                data-testid="leave-workbench"
                title={config.canReturnToProjects
                  ? config.canSubmitToCodex && config.draftChangeCount > 0 && !submitted
                    ? "离开前先确认尚未提交的 Spec 修订草稿"
                    : "离开当前工作台或切换项目与文件"
                  : "当前服务不提供项目或文件选择入口"}
              >
                {exiting ? <LoaderCircle className="animate-spin" /> : <LogOut />}
                <span className="hidden 2xl:inline">{exiting ? "离开中" : "离开"}</span>
              </Button>
              {workMode === "map" && config.canSaveSpecMap ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      className="size-7 rounded-lg"
                      variant={saveError ? "destructive" : "ghost"}
                      disabled={!config.canSaveSpecMap || saving}
                      onClick={() => void saveMap(true)}
                      title={mapSaveTitle}
                      aria-label={mapSaveLabel}
                      data-testid="map-save-status"
                    >
                      {saving ? (
                        <LoaderCircle className="animate-spin" />
                      ) : saveError ? (
                        <CircleAlert />
                      ) : dirty ? (
                        <CloudUpload />
                      ) : (
                        <CircleCheck className="text-emerald-300" />
                      )}
                      <span className="sr-only" aria-live="polite">{mapSaveLabel}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{mapSaveLabel}</TooltipContent>
                </Tooltip>
              ) : null}
              </div>
            </div>
          </header>
          <div>
            {!prdBrowserOpen && !fullSpecOpen && documentUpdateBanner}
          </div>

          <main inert={documentUpdates.loading} className="relative min-h-0 min-w-0 overflow-hidden bg-[#202123]" style={{ marginRight: config.reviewBaseline?.target.type !== "document" && config.prdReview && prdBrowserOpen ? prdDockWidth : undefined }}>
            {documentUpdates.loading && <div className="absolute inset-0 z-50 cursor-wait" aria-label="正在加载文档" />}
            <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 min-w-0">
              <ResizablePanel
                id="spec-binding-tree"
                panelRef={navigatorPanelRef}
                defaultSize="340px"
                minSize="320px"
                maxSize="460px"
                collapsedSize="0px"
                collapsible
                groupResizeBehavior="preserve-pixel-size"
                className="min-h-0 min-w-0 bg-background"
              >
                {workMode === "map" ? specNavigator : null}
              </ResizablePanel>
              <ResizableHandle
                withHandle={workMode === "map"}
                disabled={workMode === "review"}
                className={workMode === "map" ? "bg-white/8" : "pointer-events-none w-0 bg-transparent opacity-0 after:hidden"}
              />
              <ResizablePanel id="mapping-canvas" minSize="320px" className="min-h-0 min-w-0">
                <div className={workMode === "review" && inspectorOpen && selectedNode && inspectorPinned
                  ? "grid h-full min-h-0 min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]"
                  : "grid h-full min-h-0 min-w-0 grid-cols-1"}
                >
                  {config.reviewBaseline?.target.type === "document" ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                      <p>PRD 已准备好，可开始阅读与批注</p>
                      <Button onClick={() => setPrdBrowserOpen(true)}>打开 PRD</Button>
                    </div>
                  ) : pageCanvas}
                  {workMode === "review" && inspectorOpen && selectedNode && inspectorPinned ? (
                    <div className="hidden min-h-0 border-l border-white/8 xl:block">
                      {inspector}
                    </div>
                  ) : null}
                </div>
              </ResizablePanel>
              <ResizableHandle
                withHandle={workMode === "map"}
                disabled={workMode === "review"}
                className={workMode === "map" ? "bg-white/8" : "pointer-events-none w-0 bg-transparent opacity-0 after:hidden"}
              />
              <ResizablePanel
                id="mapping-inspector"
                panelRef={inspectorPanelRef}
                defaultSize="28%"
                minSize="280px"
                maxSize="460px"
                collapsedSize="0px"
                collapsible
                groupResizeBehavior="preserve-pixel-size"
                className="min-h-0 min-w-0 border-l border-white/8 bg-background"
              >
                {workMode === "map" ? inspector : null}
              </ResizablePanel>
            </ResizablePanelGroup>

            {workMode === "review" && mappableNodes.length > 0 && specBrowserOpen ? (
              <SpecOverviewFloat collapsed={specOverviewCollapsed} onExpand={() => setSpecOverviewCollapsed(false)}>
                {specNavigator}
              </SpecOverviewFloat>
            ) : null}

            {workMode === "review" && inspectorOpen && selectedNode ? (
              <div className={`${inspectorPinned ? "xl:hidden" : ""} absolute inset-y-3 right-3 z-40 w-[min(390px,calc(100%-24px))] overflow-hidden rounded-2xl border border-white/10 bg-background shadow-2xl ring-1 ring-black/20`}>
                {inspector}
              </div>
            ) : null}
          </main>
        </div>

        <Sheet open={exitPanelOpen} onOpenChange={setExitPanelOpen}>
          <SheetContent side="right" className="w-[min(420px,calc(100vw-24px))] sm:max-w-[420px]">
            <SheetHeader className="border-b border-white/8">
              <SheetTitle>离开当前工作台</SheetTitle>
              <SheetDescription>
                这里不会删除 Spec、页面映射或项目配置。你可以继续当前绑定，也可以切换到其他项目或文件。
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-300 text-slate-950">
                    <Link2 className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{config.productSpec.product.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Spec 绑定 {mappedCount}/{mappableNodes.length} · {mapSaveLabel}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                切换前会先保存等待中的页面映射；从项目中心点击“继续 Spec 绑定”即可直接回到这里，不需要重新扫描。
              </p>
            </div>

            <SheetFooter className="border-t border-white/8">
              <Button variant="outline" onClick={() => setExitPanelOpen(false)}>
                <ArrowLeft />
                继续 Spec 绑定
              </Button>
              <Button disabled={exiting} onClick={() => void returnToProjects()}>
                {exiting ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
                {exiting ? "正在切换" : "切换项目或文件"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={exportPanelOpen} onOpenChange={setExportPanelOpen}>
          <SheetContent side="right" className="w-[min(480px,calc(100vw-24px))] overflow-y-auto sm:max-w-[480px]">
            <SheetHeader className="border-b border-white/8">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-300 text-slate-950">
                  <Archive className="size-4.5" />
                </span>
                <div>
                  <SheetTitle>导出与发布</SheetTitle>
                  <SheetDescription className="mt-1">
                    冻结当前页面包、Spec、PRD 与已保存映射，供研发在其他电脑继续查看。
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-300" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">交互保留，写入关闭</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      页面滚动、点击、缩放、Spec 标记/查找和 PRD 阅读可用；项目扫描、文件浏览、Spec/Map 写入与 Codex 接口不会进入评审包。
                    </p>
                  </div>
                </div>
              </div>

              {exportPanelOpen && config.project && !config.reviewPackage?.portable && <PublicationManager projectPath={config.project.projectPath} canPublish={!!config.reviewPackage?.canExport} beforePublish={async () => {
                if (editingSpec || editingPrdMap) { toast.error("请先保存或取消正在编辑的内容"); return false }
                if (config.draftChangeCount) { toast.error("请先完成或放弃未提交的 Spec 草稿"); return false }
                for (let i = 0; (dirtyRef.current || activeSaveRef.current) && i < 3; i++) if (!(await saveMap())) return false
                if (dirtyRef.current || activeSaveRef.current) { toast.error("仍有映射等待保存，请稍后重试"); return false }
                return true
              }} />}

              <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-2xl border border-white/8 bg-muted/20 p-4 text-xs">
                <dt className="text-muted-foreground">产品</dt>
                <dd className="truncate font-medium">{config.productSpec.product.title}</dd>
                <dt className="text-muted-foreground">版本</dt>
                <dd>{config.productSpec.product.version}</dd>
                <dt className="text-muted-foreground">Spec 映射</dt>
                <dd>{mappedCount}/{mappableNodes.length}</dd>
                <dt className="text-muted-foreground">PRD</dt>
                <dd>{config.prd ? "包含完整只读正文" : "当前项目未绑定 PRD"}</dd>
              </dl>

              {config.reviewPackage?.canExport ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  导出前会先保存等待中的页面映射。Windows 10/11 x64 解压后可直接双击 EXE，无需安装 Node；ZIP 不包含项目源码、.git、node_modules、缓存或 source map。
                </p>
              ) : (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-xs leading-5 text-amber-200">
                  {config.reviewPackage?.blockReason || "当前来源不能导出只读评审包。"}
                </div>
              )}
            </div>

            <SheetFooter className="border-t border-white/8">
              <Button variant="outline" onClick={() => setExportPanelOpen(false)} disabled={exporting}>
                取消
              </Button>
              <Button
                onClick={() => void exportReviewPackage()}
                disabled={!config.reviewPackage?.canExport || exporting}
                data-testid="export-review-package"
              >
                {exporting ? <LoaderCircle className="animate-spin" /> : <Download />}
                {exporting ? "正在生成 ZIP" : "导出只读评审包"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <SpecDocumentReader open={fullSpecOpen} onOpenChange={setFullSpecOpen}
          document={config.specDocument} updateNotice={documentUpdateBanner} />

        {config.prd ? (
          <PrdBrowser
            fullWidth={config.reviewBaseline?.target.type === "document"}
            sourceTarget={prdSourceTarget}
          open={prdBrowserOpen}
            document={config.prd}
            relatedSectionIds={relatedPrdSectionIds}
            canBind={Boolean(config.canSavePrdMap && (mappableNodes.length === 0 || workMode === "map"))}
            relatedOnly={!config.prdReview && (workMode === "review" ? prdRelatedOnly : !config.canSavePrdMap)}
            onRelatedOnlyChange={!config.prdReview && workMode === "review" ? setPrdRelatedOnly : undefined}
            review={config.prdReview ? { state: config.prdReview, ...prdReviewControls } : undefined}
            saving={savingPrdMap}
            stale={config.prdMapStale}
            missingSectionIds={config.missingPrdSectionIds}
            onOpenChange={open => { setPrdBrowserOpen(open); if (!open) setPrdSourceTarget(null) }}
            onDockWidthChange={config.prdReview ? setPrdDockWidth : undefined}
            updateLoading={documentUpdates.loading}
            updateNotice={documentUpdateBanner}
            onDirtyChange={setEditingPrdMap}
            onSaveRelations={savePrdRelations}
          />
        ) : null}

        <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
          {draggingNode ? (
            <div className="flex max-w-72 items-center gap-2 rounded-xl border border-emerald-400/20 bg-background px-3 py-2 text-xs font-semibold text-foreground shadow-xl">
              <span className="grid size-7 place-items-center rounded-lg bg-emerald-300 text-[10px] text-slate-950">{draggingNode.type === "ACTION" ? "A" : "S"}</span>
              <span className="truncate">{draggingNode.title}</span>
            </div>
          ) : null}
        </DragOverlay>
        <Toaster position="bottom-center" richColors />
      </DragDropProvider>
      <Sheet open={markerChoices.length > 1} onOpenChange={open => { if (!open) setMarkerChoices([]) }}>
        <SheetContent>
          <SheetHeader><SheetTitle>此控件关联 {markerChoices.length} 个 Spec</SheetTitle><SheetDescription>选择要查看的操作定义</SheetDescription></SheetHeader>
          <div className="space-y-2 overflow-y-auto p-4">
            {markerChoices.map(id => <Button key={id} variant="outline" className="h-auto w-full flex-col items-start whitespace-normal p-3 text-left" onClick={() => { setMarkerChoices([]); openNode(id) }}>
              <span>{nodeById.get(id)?.title || id}</span><span className="text-xs text-muted-foreground">{id}</span>
            </Button>)}
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}

export default App
