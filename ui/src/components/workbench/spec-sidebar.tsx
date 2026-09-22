import { useDraggable } from "@dnd-kit/react"
import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDashed,
  FileText,
  Filter,
  GripVertical,
  MousePointer2,
  LocateFixed,
  Search,
  Sparkles,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  MAPPABLE_TYPES,
  mappingStatus,
  searchableNodeText,
  specPages,
  STATUS_LABELS,
  summarizeNode,
} from "@/lib/spec-mapping"
import type {
  CandidateTarget,
  DisplayMapStatus,
  ProductSpecBundle,
  SpecMap,
  SpecNode,
  SpecPage,
  WorkMode,
} from "@/types"

export type SpecFilter = "all" | "unmapped" | "problem"

const REVIEW_STATUSES = new Set<DisplayMapStatus>(["invalid", "ambiguous", "drifted"])

const statusIcon = (status: DisplayMapStatus) => {
  if (["confirmed", "out-of-context"].includes(status)) return <Check className="size-3" />
  if (REVIEW_STATUSES.has(status)) return <AlertTriangle className="size-3" />
  return <CircleDashed className="size-3" />
}

interface SidebarNodeRecord {
  node: SpecNode
  moduleId: string
  moduleTitle: string
}

interface PageTreeRecord {
  page: SpecPage
  children: PageTreeRecord[]
}

function DraggableSpecCard({
  node,
  status,
  selected,
  mappingActive,
  candidate,
  moduleTitle,
  disabled,
  reviewMode,
  onSelect,
  onPointerStart,
}: {
  node: SpecNode
  status: DisplayMapStatus
  selected: boolean
  mappingActive: boolean
  candidate?: CandidateTarget
  moduleTitle: string
  disabled: boolean
  reviewMode: boolean
  onSelect: () => void
  onPointerStart: (point: { x: number; y: number }) => void
}) {
  const { ref, isDragging } = useDraggable({
    id: node.id,
    data: { nodeId: node.id },
    disabled,
  })
  const hint = summarizeNode(node) || "选择查看完整定义"
  const mappingActionLabel = status === "unmapped" ? "选择页面位置" : "重新选择页面位置"

  return (
    <Card
      ref={disabled ? undefined : ref}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.title}，${STATUS_LABELS[status]}，所属模块 ${moduleTitle}${!reviewMode && candidate ? `，当前页自动候选 ${Math.round(candidate.confidence * 100)}%` : ""}`}
      aria-description={
        mappingActive
          ? `正在等待${mappingActionLabel}，按 Escape 退出定位`
          : disabled
            ? "点击查看定义"
            : "点击定位页面并查看定义，或按住整张卡片拖到页面功能"
      }
      data-testid={`spec-card-${node.id}`}
      data-drag-enabled={!disabled}
      data-mapping-active={mappingActive}
      className={cn(
        "group/spec relative flex-row items-start gap-2 rounded-xl border-border/55 bg-background/65 p-3 shadow-none transition-all hover:border-border hover:bg-muted/55 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
        disabled ? "cursor-pointer" : "cursor-grab touch-none select-none active:cursor-grabbing",
        selected && "border-primary/35 bg-primary/[0.055] ring-1 ring-primary/15",
        mappingActive && "border-emerald-400/45 bg-emerald-400/[0.075] ring-1 ring-emerald-400/25",
        isDragging && "opacity-35",
      )}
      onClick={onSelect}
      onPointerDown={(event) => {
        if (!disabled) onPointerStart({ x: event.clientX, y: event.clientY })
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onSelect()
      }}
    >
      <span
        className={cn(
          "-ml-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors",
          !disabled && "group-hover/spec:bg-background group-hover/spec:text-foreground",
          disabled && "opacity-35",
        )}
        aria-hidden="true"
      >
        {reviewMode ? <FileText className="size-4" /> : <GripVertical className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold",
              node.type === "ACTION"
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-sky-400/10 text-sky-300",
            )}
            aria-hidden="true"
          >
            {node.type === "ACTION" ? "A" : "S"}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-semibold leading-5">{node.title}</strong>
            <small
              className={cn(
                "mt-1 block text-xs leading-5 text-muted-foreground",
                selected ? "line-clamp-2" : "line-clamp-1",
              )}
            >
              {hint}
            </small>
          </span>
        </span>
        <span className="mt-3 flex min-h-6 items-center gap-2 pl-11">
          {!reviewMode && candidate && status === "unmapped" && !mappingActive ? (
            <Badge
              variant="outline"
              className="h-6 rounded-full border-sky-400/25 bg-sky-400/[0.07] px-2 text-[10px] text-sky-300"
              title="当前可见页面的自动匹配候选；选中后仍需确认"
            >
              <Sparkles className="size-3" />
              候选 {Math.round(candidate.confidence * 100)}%
            </Badge>
          ) : !reviewMode || status !== "confirmed" ? (
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[10px]",
                status === "confirmed" && "bg-emerald-400/10 text-emerald-300",
                status === "out-of-context" && "bg-sky-400/10 text-sky-300",
                REVIEW_STATUSES.has(status) && "bg-amber-400/10 text-amber-300",
                status === "unmapped" && "bg-muted text-muted-foreground",
              )}
              title={mappingActive ? `${mappingActionLabel}，Esc 退出` : STATUS_LABELS[status]}
            >
              {mappingActive ? <MousePointer2 className="size-3" /> : statusIcon(status)}
              {mappingActive ? mappingActionLabel : STATUS_LABELS[status]}
            </span>
          ) : null}
          <span
            className="ml-auto max-w-24 truncate text-[10px] text-muted-foreground/75"
            title={`所属模块：${moduleTitle}`}
          >
            {moduleTitle}
          </span>
        </span>
      </span>
    </Card>
  )
}

function PageBranch({
  item,
  depth,
  visiblePageIds,
  visibleByPage,
  scopedRecords,
  descendantPageIds,
  activePageId,
  explicitBrowse,
  map,
  selectedId,
  mappingTargetId,
  candidates,
  dragEnabled,
  reviewMode,
  onActivatePage,
  onLocatePage,
  onSelect,
  onPointerStart,
}: {
  item: PageTreeRecord
  depth: number
  visiblePageIds: ReadonlySet<string>
  visibleByPage: ReadonlyMap<string, SidebarNodeRecord[]>
  scopedRecords: readonly SidebarNodeRecord[]
  descendantPageIds: ReadonlyMap<string, ReadonlySet<string>>
  activePageId: string | null
  explicitBrowse: boolean
  map: SpecMap
  selectedId: string | null
  mappingTargetId: string | null
  candidates: ReadonlyMap<string, CandidateTarget>
  dragEnabled: boolean
  reviewMode: boolean
  onActivatePage: (pageId: string) => void
  onLocatePage: (pageId: string) => void
  onSelect: (nodeId: string) => void
  onPointerStart: (point: { x: number; y: number }) => void
}) {
  const branchPageIds = descendantPageIds.get(item.page.id) ?? new Set([item.page.id])
  const branchRecords = scopedRecords.filter((record) =>
    Boolean(record.node.pageId && branchPageIds.has(record.node.pageId)),
  )
  const mappedCount = branchRecords.filter((record) =>
    map.items.some((annotation) => annotation.body.id === record.node.id),
  ).length
  const visibleChildren = item.children.filter((child) => visiblePageIds.has(child.page.id))
  const directRecords = visibleByPage.get(item.page.id) ?? []
  const showNodes = activePageId === item.page.id || explicitBrowse

  return (
    <section
      className={cn("relative", depth > 0 && "ml-4 border-l border-border/60 pl-4")}
      data-testid={`spec-page-group-${item.page.id}`}
      data-hierarchy-level="page"
      data-page-depth={depth}
    >
      <div className="group/page relative">
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-2 rounded-xl bg-muted/25 px-2.5 py-2 pr-11 text-left transition-colors hover:bg-muted/45"
        aria-expanded={showNodes}
        aria-label={reviewMode ? `${item.page.title} 页面` : `${item.page.title} 页面，${mappedCount}/${branchRecords.length}`}
        onClick={() => onActivatePage(item.page.id)}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            showNodes && "rotate-90",
            !directRecords.length && "opacity-25",
          )}
        />
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/70">
          <FileText className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[13px] font-semibold leading-5">{item.page.title}</strong>
          <small className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.page.id}</small>
        </span>
        {!reviewMode ? <span className="shrink-0 text-[11px] text-muted-foreground">{mappedCount}/{branchRecords.length}</span> : null}
      </button>
      {reviewMode ? <Button variant="ghost" size="icon-sm" className="absolute top-2 right-1.5 size-8 rounded-lg bg-background/90 text-emerald-300 opacity-0 shadow-sm ring-1 ring-white/10 transition-opacity group-hover/page:opacity-100 group-focus-within/page:opacity-100 [@media(hover:none)]:opacity-100" aria-label={`定位到${item.page.title}`} title={`定位到${item.page.title}`} onClick={() => onLocatePage(item.page.id)}><LocateFixed className="size-4" /></Button> : null}
      </div>

      <div className="mt-2 space-y-2.5">
        {showNodes ? (
          <div className="space-y-2.5">
            {directRecords.map((record) => (
              <div
                key={record.node.id}
                className="relative ml-4 border-l border-border/50 pl-4 before:absolute before:top-7 before:-left-px before:w-4 before:border-t before:border-border/50"
                data-hierarchy-level="node"
              >
                <DraggableSpecCard
                  node={record.node}
                  status={mappingStatus(map, record.node.id)}
                  selected={selectedId === record.node.id}
                  mappingActive={mappingTargetId === record.node.id}
                  candidate={candidates.get(record.node.id)}
                  moduleTitle={record.moduleTitle}
                  disabled={!dragEnabled}
                  reviewMode={reviewMode}
                  onSelect={() => onSelect(record.node.id)}
                  onPointerStart={onPointerStart}
                />
              </div>
            ))}
          </div>
        ) : null}
        {visibleChildren.map((child) => (
          <PageBranch
            key={child.page.id}
            item={child}
            depth={depth + 1}
            visiblePageIds={visiblePageIds}
            visibleByPage={visibleByPage}
            scopedRecords={scopedRecords}
            descendantPageIds={descendantPageIds}
            activePageId={activePageId}
            explicitBrowse={explicitBrowse}
            map={map}
            selectedId={selectedId}
            mappingTargetId={mappingTargetId}
            candidates={candidates}
            dragEnabled={dragEnabled}
            reviewMode={reviewMode}
            onActivatePage={onActivatePage}
            onLocatePage={onLocatePage}
            onSelect={onSelect}
            onPointerStart={onPointerStart}
          />
        ))}
      </div>
    </section>
  )
}

export function SpecSidebar({
  bundle,
  map,
  selectedId,
  mappingTargetId,
  query,
  filter,
  workMode,
  canSave,
  candidates,
  onQueryChange,
  onFilterChange,
  onSelectPage,
  onSelect,
  onClose,
  onPointerStart,
  persistent = false,
  onCollapse,
  onReadFull,
}: {
  bundle: ProductSpecBundle
  map: SpecMap
  selectedId: string | null
  mappingTargetId: string | null
  query: string
  filter: SpecFilter
  workMode: WorkMode
  canSave: boolean
  candidates: ReadonlyMap<string, CandidateTarget>
  onQueryChange: (value: string) => void
  onFilterChange: (value: SpecFilter) => void
  onSelectPage: (pageId: string) => void
  onSelect: (nodeId: string) => void
  onClose: () => void
  onPointerStart: (point: { x: number; y: number }) => void
  persistent?: boolean
  onCollapse?: () => void
  onReadFull?: () => void
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const dragEnabled = canSave && workMode === "map"
  const reviewMode = workMode === "review"
  const effectiveFilter = reviewMode ? "all" : filter
  const [moduleFilter, setModuleFilter] = useState("all")
  const pages = useMemo(() => specPages(bundle), [bundle])
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages])
  const allRecords = useMemo<SidebarNodeRecord[]>(
    () => bundle.modules.flatMap((module) =>
      module.nodes
        .filter((node) => MAPPABLE_TYPES.has(node.type))
        .map((node) => ({ node, moduleId: module.id, moduleTitle: module.title })),
    ),
    [bundle.modules],
  )
  const selectedPageId = selectedId
    ? allRecords.find((record) => record.node.id === selectedId)?.node.pageId ?? null
    : null
  const [activePageId, setActivePageId] = useState<string | null>(selectedPageId)
  const scopedRecords = useMemo(
    () => moduleFilter === "all"
      ? allRecords
      : allRecords.filter((record) => record.moduleId === moduleFilter),
    [allRecords, moduleFilter],
  )
  const problemCount = useMemo(
    () => scopedRecords.filter((record) => REVIEW_STATUSES.has(mappingStatus(map, record.node.id))).length,
    [map, scopedRecords],
  )

  useEffect(() => {
    if (moduleFilter !== "all" && !bundle.modules.some((module) => module.id === moduleFilter)) {
      setModuleFilter("all")
    }
  }, [bundle.modules, moduleFilter])

  useEffect(() => {
    if (selectedPageId) setActivePageId(selectedPageId)
  }, [selectedId, selectedPageId])

  useEffect(() => {
    if (filter === "problem" && problemCount === 0) onFilterChange("all")
  }, [filter, onFilterChange, problemCount])

  const visibleRecords = useMemo(
    () => scopedRecords.filter((record) => {
      const page = record.node.pageId ? pageById.get(record.node.pageId) : undefined
      const text = `${record.moduleTitle} ${record.moduleId} ${page?.title ?? ""} ${page?.id ?? ""} ${(page?.anchorHints ?? []).join(" ")} ${searchableNodeText(record.node)}`.toLowerCase()
      if (normalizedQuery && !text.includes(normalizedQuery)) return false
      const status = mappingStatus(map, record.node.id)
      if (effectiveFilter === "unmapped") return status === "unmapped"
      if (effectiveFilter === "problem") return REVIEW_STATUSES.has(status)
      return true
    }),
    [effectiveFilter, map, normalizedQuery, pageById, scopedRecords],
  )

  const visibleByPage = useMemo(() => {
    const grouped = new Map<string, SidebarNodeRecord[]>()
    for (const record of visibleRecords) {
      if (!record.node.pageId || !pageById.has(record.node.pageId)) continue
      const current = grouped.get(record.node.pageId) ?? []
      current.push(record)
      grouped.set(record.node.pageId, current)
    }
    return grouped
  }, [pageById, visibleRecords])

  const pageTree = useMemo(() => {
    const itemById = new Map<string, PageTreeRecord>(
      pages.map((page) => [page.id, { page, children: [] }]),
    )
    const roots: PageTreeRecord[] = []
    for (const page of pages) {
      const item = itemById.get(page.id)!
      const parent = page.parentPageId ? itemById.get(page.parentPageId) : undefined
      if (parent && parent !== item) parent.children.push(item)
      else roots.push(item)
    }
    return roots
  }, [pages])

  const descendantPageIds = useMemo(() => {
    const childrenById = new Map<string, string[]>()
    for (const page of pages) {
      if (!page.parentPageId || !pageById.has(page.parentPageId)) continue
      const current = childrenById.get(page.parentPageId) ?? []
      current.push(page.id)
      childrenById.set(page.parentPageId, current)
    }
    const memo = new Map<string, ReadonlySet<string>>()
    const collect = (pageId: string, path = new Set<string>()): ReadonlySet<string> => {
      if (memo.has(pageId)) return memo.get(pageId)!
      if (path.has(pageId)) return new Set([pageId])
      const nextPath = new Set(path).add(pageId)
      const result = new Set([pageId])
      for (const childId of childrenById.get(pageId) ?? []) {
        for (const descendant of collect(childId, nextPath)) result.add(descendant)
      }
      memo.set(pageId, result)
      return result
    }
    for (const page of pages) collect(page.id)
    return memo
  }, [pageById, pages])

  const visiblePageIds = useMemo(() => {
    const result = new Set<string>()
    for (const pageId of visibleByPage.keys()) {
      let cursor = pageById.get(pageId)
      const visited = new Set<string>()
      while (cursor && !visited.has(cursor.id)) {
        result.add(cursor.id)
        visited.add(cursor.id)
        cursor = cursor.parentPageId ? pageById.get(cursor.parentPageId) : undefined
      }
    }
    return result
  }, [pageById, visibleByPage])

  const unassigned = visibleRecords.filter((record) =>
    !record.node.pageId || !pageById.has(record.node.pageId),
  )
  const hasVisible = visibleRecords.length > 0
  const explicitBrowse = Boolean(normalizedQuery || effectiveFilter !== "all" || moduleFilter !== "all")
  const activatePage = (pageId: string) => {
    const opening = activePageId !== pageId
    setActivePageId(opening ? pageId : null)
    if (opening && !reviewMode) onSelectPage(pageId)
  }

  const renderUnassigned = (record: SidebarNodeRecord) => (
    <DraggableSpecCard
      key={record.node.id}
      node={record.node}
      status={mappingStatus(map, record.node.id)}
      selected={selectedId === record.node.id}
      mappingActive={mappingTargetId === record.node.id}
      candidate={candidates.get(record.node.id)}
      moduleTitle={record.moduleTitle}
      disabled={!dragEnabled}
      reviewMode={reviewMode}
      onSelect={() => onSelect(record.node.id)}
      onPointerStart={onPointerStart}
    />
  )

  return (
    <aside className="flex h-full min-h-0 flex-col bg-background text-sm" aria-label="Spec 节点">
      <div className="space-y-3 border-b px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-emerald-300 uppercase">
              {dragEnabled ? "Spec 绑定" : "Spec 总览"}
            </p>
            <h2 className="mt-1 text-base font-semibold">
              {dragEnabled ? "按页面定位并建立映射" : "按页面结构定位"}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="rounded-full text-xs">v{bundle.product.version}</Badge>
            {reviewMode ? <Button variant="ghost" size="sm" onClick={onCollapse} aria-label="收起 Spec 总览">收起</Button> : null}
            {!persistent ? (
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭 Spec 查找">
                <X />
              </Button>
            ) : null}
          </div>
        </div>

        {reviewMode ? <div className="flex items-center justify-between gap-2">

          <Button variant="ghost" size="sm" disabled={!onReadFull} onClick={onReadFull}>阅读全文</Button>
        </div> : null}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-9 rounded-xl bg-muted/60 pl-8 text-sm"
            placeholder="搜索页面、操作或模块"
            aria-label="搜索 Spec"
          />
        </div>

        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="h-9 w-full rounded-xl bg-muted/45" aria-label="按模块筛选">
            <Filter className="size-3.5 text-muted-foreground" />
            <SelectValue placeholder="全部模块" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模块</SelectItem>
            {bundle.modules.map((module) => (
              <SelectItem key={module.id} value={module.id}>{module.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!reviewMode ? <Tabs value={filter} onValueChange={(value) => onFilterChange(value as SpecFilter)}>
          <TabsList className="h-8 w-full rounded-xl">
            <TabsTrigger value="all" className="text-xs">全部</TabsTrigger>
            <TabsTrigger value="unmapped" className="text-xs">待映射</TabsTrigger>
            {problemCount ? (
              <TabsTrigger value="problem" className="text-xs">需复核 {problemCount}</TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs> : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-4" data-testid="spec-page-tree">
          {pageTree
            .filter((item) => visiblePageIds.has(item.page.id))
            .map((item) => (
              <PageBranch
                key={item.page.id}
                item={item}
                depth={0}
                visiblePageIds={visiblePageIds}
                visibleByPage={visibleByPage}
                scopedRecords={scopedRecords}
                descendantPageIds={descendantPageIds}
                activePageId={activePageId}
                explicitBrowse={explicitBrowse}
                map={map}
                selectedId={selectedId}
                mappingTargetId={mappingTargetId}
                candidates={candidates}
                dragEnabled={dragEnabled}
                reviewMode={reviewMode}
                onActivatePage={activatePage}
                onLocatePage={onSelectPage}
                onSelect={onSelect}
                onPointerStart={onPointerStart}
              />
            ))}
          {unassigned.length ? (
            <section className="space-y-2.5 rounded-xl border border-dashed border-border/60 p-2.5" data-testid="spec-unassigned-nodes">
              <p className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                页面上下文待确认
              </p>
              {unassigned.map(renderUnassigned)}
            </section>
          ) : null}
          {!hasVisible ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              没有符合条件的页面或可映射节点
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}
