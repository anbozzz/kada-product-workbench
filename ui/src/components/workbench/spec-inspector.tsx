import { useState } from "react"
import {
  ArrowLeft,
  CheckCircle2,
  MousePointer2,
  Pin,
  Sparkles,
  Unlink,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  SpecDefinitionPanel,
  type SpecNodePatch,
} from "@/components/workbench/spec-definition-panel"
import { SpecReadingContext } from "@/components/workbench/spec-reading-context"
import { cn } from "@/lib/utils"
import {
  collectConstraintSections,
  explainMappingStatus,
  STATUS_LABELS,
  TYPE_LABELS,
} from "@/lib/spec-mapping"
import type {
  CandidateTarget,
  DisplayMapStatus,
  FlatSpecNode,
  MappingIssue,
  PrdDocumentView,
  SpecAnnotation,
} from "@/types"

const sourceLabels: Record<string, string> = {
  "observed-ui": "页面事实",
  "product-decision": "产品决定",
  candidate: "候选",
  "formal-source": "正式来源",
  simulation: "仿真",
  tbd: "待确认",
}

export function EmptyInspector() {
  return (
    <div className="grid h-full place-content-center justify-items-center px-8 text-center">
      <div className="flex items-center gap-2 text-emerald-300" aria-hidden="true">
        <span className="grid size-10 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/8 text-sm font-bold">1</span>
        <span className="h-px w-7 bg-emerald-400/30" />
        <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/8 px-3 py-2 text-xs font-semibold">Spec</span>
      </div>
      <h2 className="mt-5 text-base font-semibold">选择一个功能节点</h2>
      <p className="mt-2 max-w-64 text-sm leading-6 text-muted-foreground">
        这里会按原 Spec 的字段名称与顺序展示节点内容。
      </p>
    </div>
  )
}

export function SpecInspector({
  node,
  nodes,
  nodeById,
  pages = [],
  images,
  prd,
  onLocatePrd,
  annotation,
  status,
  issue,
  candidate,
  canSave,
  canSaveSpec,
  specEditMode,
  specPath,
  tab,
  pinned,
  onTabChange,
  onClose,
  onTogglePin,
  onStartMapping,
  onAcceptCandidate,
  onUnmap,
  onSaveSpecNode,
  onEditingChange,
  reviewMode = false,
  showBackToList = false,
  onBackToList,
  persistent = false,
}: {
  node: FlatSpecNode | null
  nodes: FlatSpecNode[]
  images?: PrdDocumentView["images"]
  pages?: { id: string; title: string }[]
  nodeById: Map<string, FlatSpecNode>
  onLocatePrd?: (id: string) => void
  prd?: PrdDocumentView | null
  annotation: SpecAnnotation | null
  status: DisplayMapStatus
  issue?: MappingIssue
  candidate: CandidateTarget | null
  canSave: boolean
  canSaveSpec: boolean
  specEditMode: "direct-source" | "codex-gate" | "readonly"
  specPath: string
  tab: string
  pinned: boolean
  onTabChange: (value: string) => void
  onClose: () => void
  onTogglePin: () => void
  onStartMapping: () => void
  onAcceptCandidate: () => void
  onUnmap: () => void
  onEditingChange?: (editing: boolean) => void
  onSaveSpecNode: (patch: SpecNodePatch) => Promise<void>
  reviewMode?: boolean
  showBackToList?: boolean
  onBackToList: () => void
  persistent?: boolean
}) {
  const [editHost, setEditHost] = useState<HTMLDivElement | null>(null)
  if (!node) return <EmptyInspector />
  const referenceNames = new Map([...nodes, ...pages].map(item => [item.id, item.title]))
  const constraints = collectConstraintSections(node, nodes, nodeById)
  const activeTab = !reviewMode && tab === "mapping" ? "mapping" : "definition"
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col bg-background text-sm" aria-label="Spec 详情">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-4">
        {reviewMode && showBackToList ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBackToList}
            aria-label="返回 Spec 列表"
            className="shrink-0 xl:hidden"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="rounded-full bg-emerald-400/10 text-xs text-emerald-300 shadow-none hover:bg-emerald-400/15">
              {TYPE_LABELS[node.type] ?? node.type}
            </Badge>
            <Badge variant="secondary" className="rounded-full text-xs">
              {sourceLabels[node.sourceKind] ?? node.sourceKind}
            </Badge>
            {!reviewMode || status !== "confirmed" ? (
              <Badge
                variant="secondary"
                className={cn(
                  "rounded-full text-xs",
                  status === "confirmed" && "bg-emerald-400/10 text-emerald-300",
                  status === "out-of-context" && "bg-sky-400/10 text-sky-300",
                  ["invalid", "ambiguous", "drifted"].includes(status) && "bg-amber-400/10 text-amber-300",
                )}
                data-testid="inspector-mapping-status"
              >
                {STATUS_LABELS[status]}
              </Badge>
            ) : null}
          </div>
          <h2 className="mt-2 text-xl leading-tight font-semibold tracking-tight">{node.title}</h2>
          <code className="mt-1.5 block truncate text-xs text-muted-foreground">{node.id}</code>
        </div>
        {!persistent ? (
          <div className="flex items-center gap-1">
            <Button
              variant={pinned ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onTogglePin}
              aria-label={pinned ? "取消固定详情" : "固定详情"}
              aria-pressed={pinned}
              title={pinned ? "取消固定，详情恢复为浮层" : "固定详情，与页面并排查看"}
            >
              <Pin />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭详情">
              <X />
            </Button>
          </div>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="min-h-0 min-w-0 flex-1 gap-0">
        <div className="border-b px-3">
          <TabsList variant="line" className="h-10 w-full">
            <TabsTrigger value="definition" className="text-xs">操作定义</TabsTrigger>
            {!reviewMode ? <TabsTrigger value="mapping" className="text-xs">页面映射</TabsTrigger> : null}
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
          <TabsContent value="definition" className="m-0 min-w-0 max-w-full space-y-3 overflow-x-hidden p-4">
            <SpecDefinitionPanel
              key={`definition-${node.id}`}
              images={images}
              referenceNames={referenceNames}
              editHost={editHost}
              node={node}
              canEdit={canSaveSpec}
              editMode={specEditMode}
              specPath={specPath}
              onSave={onSaveSpecNode}
              onEditingChange={onEditingChange}
            />
            <SpecReadingContext images={images} referenceNames={referenceNames} key={`reading-${node.id}`}  node={node} onLocatePrd={onLocatePrd} constraints={constraints.direct} prd={prd} nodeById={nodeById} />
          </TabsContent>

          {!reviewMode ? <TabsContent value="mapping" className="m-0 min-w-0 max-w-full space-y-4 overflow-x-hidden p-4">
            {!annotation && candidate && (
              <Card className="rounded-xl border-emerald-400/15 bg-emerald-400/[0.055] py-0 shadow-none">
                <CardHeader className="gap-2 px-3.5 pt-3.5 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-lg bg-emerald-300 text-slate-950"><Sparkles className="size-3.5" /></span>
                    <div>
                      <Badge className="rounded-full bg-emerald-400/10 text-[10px] text-emerald-300 shadow-none hover:bg-emerald-400/15">
                        {candidate.confidence >= 0.82 ? "高置信" : "中置信"}
                      </Badge>
                      <CardTitle className="mt-1 text-sm">找到候选功能</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-3.5 pb-3.5">
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    候选“{candidate.fingerprint.ariaLabel || candidate.fingerprint.text || candidate.fingerprint.tag}”，匹配度 {Math.round(candidate.confidence * 100)}%。
                  </p>
                  <Button size="sm" className="w-full rounded-xl" disabled={!canSave} onClick={onAcceptCandidate}>
                    <CheckCircle2 />{canSave ? "确认映射" : "只读模式"}
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">定位信息</h3>
              <Badge
                variant="secondary"
                className={cn(
                  "rounded-full text-[11px]",
                  status === "confirmed" && "bg-emerald-400/10 text-emerald-300",
                  status === "out-of-context" && "bg-sky-400/10 text-sky-300",
                  ["invalid", "ambiguous", "drifted"].includes(status) && "bg-amber-400/10 text-amber-300",
                )}
              >
                {STATUS_LABELS[status]}
              </Badge>
            </div>
            <Separator />

            {annotation ? (
              <dl className="space-y-2">
                <Card className="rounded-xl bg-muted/35 py-0 shadow-none">
                  <CardContent className="px-3 py-3">
                    <dt className="text-xs font-semibold text-muted-foreground">选择器</dt>
                    <dd className="mt-1.5"><code className="block overflow-auto rounded-lg bg-muted px-2.5 py-2 text-xs break-all">{annotation.target.selector.value}</code></dd>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-muted/35 py-0 shadow-none">
                  <CardContent className="px-3 py-3">
                    <dt className="text-xs font-semibold text-muted-foreground">语义指纹</dt>
                    <dd className="mt-1.5 text-sm leading-6">
                      {[annotation.target.fingerprint.tag, annotation.target.fingerprint.role, annotation.target.fingerprint.ariaLabel || annotation.target.fingerprint.text].filter(Boolean).join(" · ")}
                    </dd>
                  </CardContent>
                </Card>
                <Card className="rounded-xl bg-muted/35 py-0 shadow-none">
                  <CardContent className="px-3 py-3">
                    <dt className="text-xs font-semibold text-muted-foreground">校验结果</dt>
                    <dd className="mt-1.5 text-sm leading-6">{explainMappingStatus(status, issue)}</dd>
                  </CardContent>
                </Card>
              </dl>
            ) : (
              <Card className="rounded-xl border-dashed py-0 shadow-none">
                <CardContent className="px-3.5 py-4 text-sm leading-6 text-muted-foreground">
                  {candidate
                    ? "上方是当前可见页面的自动候选，确认前不会写入正式映射。"
                    : "当前可见页面未找到自动候选。可先操作页面进入目标状态，或选择节点后手动点击目标。这里只保存选择器和语义指纹，不保存像素坐标。"}
                </CardContent>
              </Card>
            )}

            {canSave ? (
              <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={onStartMapping}>
                <MousePointer2 />{annotation ? "重新选择页面位置" : "在页面上选择位置"}
              </Button>
            ) : null}

            {annotation ? (
              <Button variant="ghost" size="sm" className="w-full rounded-xl text-destructive hover:text-destructive" disabled={!canSave || !annotation} onClick={onUnmap}>
                <Unlink />解除映射
              </Button>
            ) : null}
          </TabsContent> : null}
        </ScrollArea>
      </Tabs>
      <div ref={setEditHost} data-testid="spec-edit-toolbar" className="shrink-0 [&:not(:empty)]:border-t [&:not(:empty)]:p-3 [&:not(:empty)]:shadow-[0_-8px_24px_#0003]" />
    </aside>
  )
}
