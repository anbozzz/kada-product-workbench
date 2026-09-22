import { SpecMarkdown } from "./spec-markdown"
import { createPortal } from "react-dom"
import { useEffect, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  FilePenLine,
  LoaderCircle,
  PencilLine,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { contentBlocksForNode } from "@/lib/spec-mapping"
import type { FlatSpecNode, SpecNode, PrdDocumentView } from "@/types"

export type SpecNodePatch = Pick<
  SpecNode,
  | "title"
  | "status"
  | "sourceKind"
  | "statement"
  | "anchorHints"
  | "contentBlocks"
  | "fields"
>

type ContentBlockDraft = {
  id: string
  label: string
  content: string
}

type DefinitionDraft = {
  title: string
  status: SpecNode["status"]
  sourceKind: SpecNode["sourceKind"]
  statement: string
  anchorHints: string
  contentBlocks: ContentBlockDraft[]
}

const STATUS_OPTIONS: Array<{ value: SpecNode["status"]; label: string }> = [
  { value: "draft", label: "草稿" },
  { value: "reviewing", label: "修订中" },
  { value: "confirmed", label: "已确认" },
  { value: "superseded", label: "已废止" },
]

const SOURCE_OPTIONS = [
  { value: "observed-ui", label: "页面事实" },
  { value: "product-decision", label: "产品决定" },
  { value: "candidate", label: "候选" },
  { value: "formal-source", label: "正式来源" },
  { value: "simulation", label: "仿真" },
  { value: "tbd", label: "待确认" },
]

const draftFromNode = (node: FlatSpecNode): DefinitionDraft => ({
  title: node.title,
  status: node.status,
  sourceKind: node.sourceKind,
  statement: node.statement ?? "",
  anchorHints: node.anchorHints.join("\n"),
  contentBlocks: contentBlocksForNode(node),
})

const patchFromDraft = (draft: DefinitionDraft): SpecNodePatch => {
  return {
    title: draft.title.trim(),
    status: draft.status,
    sourceKind: draft.sourceKind,
    statement: draft.statement.trim() || undefined,
    anchorHints: draft.anchorHints
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    contentBlocks: draft.contentBlocks
      .map((block) => ({
        id: block.id,
        label: block.label.trim(),
        content: block.content.trim(),
      }))
      .filter((block) => block.content),
    fields: undefined,
  }
}

const nextBlockId = (blocks: ContentBlockDraft[]) => {
  let index = blocks.length + 1
  while (blocks.some((block) => block.id === `content-${index}`)) index += 1
  return `content-${index}`
}

const inlineBlockKind = (node: FlatSpecNode, block: ContentBlockDraft) => {
  if (block.id === "status" || block.label === "状态") return "status"
  if (block.id === "source" || block.label === "来源") return "source"
  if (block.id === "anchor-hints" || block.label === "页面匹配提示") return "anchor-hints"
  if (
    node.statement !== undefined
    && (
      ["statement", "definition"].includes(block.id)
      || ["定义", "概括性定义"].includes(block.label)
    )
    && node.statement.trim() === block.content.trim()
  ) return "statement"
  return "content"
}

const structuredValueFromContent = (content: string) =>
  content.trim().match(/^`?([a-z-]+)`?/)?.[1] ?? ""

const anchorHintsFromContent = (content: string) =>
  content
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)

export function SpecDefinitionPanel({
  node,
  referenceNames,
  images,
  editHost,
  canEdit,
  editMode,
  specPath,
  onSave,
  onEditingChange,
}: {
  node: FlatSpecNode
  images?: PrdDocumentView["images"]
  referenceNames?: ReadonlyMap<string, string>
  editHost?: HTMLElement | null
  canEdit: boolean
  editMode: "direct-source" | "codex-gate" | "readonly"
  specPath: string
  onEditingChange?: (editing: boolean) => void
  onSave: (patch: SpecNodePatch) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [inlineEditingBlockId, setInlineEditingBlockId] = useState<string | null>(null)
  const [inlineDraft, setInlineDraft] = useState<ContentBlockDraft | null>(null)
  const [inlineSaving, setInlineSaving] = useState(false)
  const [inlineError, setInlineError] = useState("")
  const [newBlockLabel, setNewBlockLabel] = useState("")
  const [draft, setDraft] = useState<DefinitionDraft>(() => draftFromNode(node))
  const contentBlocks = contentBlocksForNode(node).filter((block) => block.content.trim())
  const readableContentBlocks = contentBlocks.filter(
    (block) => inlineBlockKind(node, block) !== "anchor-hints" && !["来源", "关联", "关联 PRD"].includes(block.label),
  )

  useEffect(() => {
    if (!canEdit) {
      setEditing(false)
      setInlineEditingBlockId(null)
      setInlineDraft(null)
    }
  }, [canEdit])

  useEffect(() => {
    onEditingChange?.(editing || Boolean(inlineEditingBlockId) || saving || inlineSaving)
    return () => onEditingChange?.(false)
  }, [editing, inlineEditingBlockId, saving, inlineSaving, onEditingChange])

  const beginEditing = () => {
    setDraft(draftFromNode(node))
    setNewBlockLabel("")
    setError("")
    setInlineEditingBlockId(null)
    setInlineDraft(null)
    setEditing(true)
  }

  const beginInlineEditing = (block: ContentBlockDraft) => {
    if (!canEdit || saving || inlineSaving) return
    setInlineEditingBlockId(block.id)
    setInlineDraft({ ...block })
    setInlineError("")
  }

  const cancelInlineEditing = () => {
    if (inlineSaving) return
    setInlineEditingBlockId(null)
    setInlineDraft(null)
    setInlineError("")
  }

  const saveInlineBlock = async () => {
    if (!canEdit || !inlineEditingBlockId || !inlineDraft) return
    if (!inlineDraft.label.trim()) {
      setInlineError("字段名称不能为空")
      return
    }
    if (!inlineDraft.content.trim()) {
      setInlineError("单条内容不能为空；如需删除请使用完整节点编辑")
      return
    }
    const currentDraft = draftFromNode(node)
    const currentBlock = currentDraft.contentBlocks.find((block) => block.id === inlineEditingBlockId)
    if (!currentBlock) {
      setInlineError("当前内容块已经变化，请重新载入后再试")
      return
    }
    const blockKind = inlineBlockKind(node, currentBlock)
    const structuredValue = structuredValueFromContent(inlineDraft.content)
    if (blockKind === "status" && !STATUS_OPTIONS.some((option) => option.value === structuredValue)) {
      setInlineError(`状态仅支持：${STATUS_OPTIONS.map((option) => option.value).join("、")}`)
      return
    }
    if (blockKind === "source" && !SOURCE_OPTIONS.some((option) => option.value === structuredValue)) {
      setInlineError(`事实来源仅支持：${SOURCE_OPTIONS.map((option) => option.value).join("、")}`)
      return
    }
    const nextDraft: DefinitionDraft = {
      ...currentDraft,
      status: blockKind === "status" ? structuredValue as SpecNode["status"] : currentDraft.status,
      sourceKind: blockKind === "source" ? structuredValue as SpecNode["sourceKind"] : currentDraft.sourceKind,
      statement: blockKind === "statement" ? inlineDraft.content.trim() : currentDraft.statement,
      anchorHints: blockKind === "anchor-hints"
        ? anchorHintsFromContent(inlineDraft.content).join("\n")
        : currentDraft.anchorHints,
      contentBlocks: currentDraft.contentBlocks.map((block) =>
        block.id === inlineEditingBlockId
          ? {
              ...block,
              label: inlineDraft.label.trim(),
              content: inlineDraft.content.trim(),
            }
          : block,
      ),
    }
    setInlineSaving(true)
    setInlineError("")
    try {
      await onSave(patchFromDraft(nextDraft))
      setInlineEditingBlockId(null)
      setInlineDraft(null)
    } catch (saveError) {
      setInlineError(saveError instanceof Error ? saveError.message : "当前内容保存失败")
    } finally {
      setInlineSaving(false)
    }
  }

  const save = async () => {
    if (!canEdit) {
      setError("当前会话没有可写入的本地 Spec 原文件")
      return
    }
    if (!draft.title.trim()) {
      setError("节点标题不能为空")
      return
    }
    if (draft.contentBlocks.some((block) => block.content.trim() && !block.label.trim())) {
      setError("有内容的字段必须填写字段名称")
      return
    }
    setSaving(true)
    setError("")
    try {
      await onSave(patchFromDraft(draft))
      setEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "草稿保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="min-w-0 space-y-3 overflow-x-hidden">
        {canEdit && editHost ? createPortal(
          <Button size="sm" variant="outline" className="w-full rounded-xl" onClick={beginEditing}
            title={`编辑当前节点的全部字段与内容块 · ${specPath}`}>
            <FilePenLine />{editMode === "codex-gate" ? "编辑完整草稿" : "编辑完整节点"}
          </Button>, editHost) : null}

        {node.statement ? (
          <div className="min-w-0 whitespace-pre-wrap rounded-r-xl border-l-3 border-emerald-400 bg-emerald-400/[0.055] px-3.5 py-3 text-sm leading-6 break-words text-emerald-100 [overflow-wrap:anywhere]">
            <SpecMarkdown images={images} source={node.statement} title={node.title} referenceNames={referenceNames} />
          </div>
        ) : null}
        <dl className="space-y-2">
          {readableContentBlocks.length ? (
            readableContentBlocks.map((block) => {
              const inlineEditing = inlineEditingBlockId === block.id && inlineDraft
              return (
                <Card
                  key={block.id}
                  className="group/block min-w-0 rounded-xl bg-muted/35 py-0 shadow-none transition-colors hover:border-emerald-400/25 hover:bg-muted/50"
                  data-testid={`content-block-${block.id}`}
                  data-inline-editing={Boolean(inlineEditing)}
                  onDoubleClick={() => beginInlineEditing(block)}
                >
                  <CardContent className="min-w-0 px-3 py-3">
                    {inlineEditing ? (
                      <div className="space-y-2.5" onDoubleClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-300">
                          <PencilLine className="size-3.5" />
                          仅编辑当前一条
                        </div>
                        <Input
                          autoFocus
                          value={inlineDraft.label}
                          aria-label="当前内容块字段名称"
                          onChange={(event) => setInlineDraft((current) => current ? { ...current, label: event.target.value } : current)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault()
                              cancelInlineEditing()
                            }
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                              event.preventDefault()
                              void saveInlineBlock()
                            }
                          }}
                          className="h-8 rounded-lg text-xs font-semibold"
                        />
                        <Textarea
                          value={inlineDraft.content}
                          aria-label={`${inlineDraft.label || "当前内容块"}内容`}
                          onChange={(event) => setInlineDraft((current) => current ? { ...current, content: event.target.value } : current)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault()
                              cancelInlineEditing()
                            }
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                              event.preventDefault()
                              void saveInlineBlock()
                            }
                          }}
                          className="min-h-28 resize-y text-sm leading-6"
                        />
                        {inlineBlockKind(node, inlineDraft) === "status" ? (
                          <p className="text-[10px] leading-4 text-muted-foreground">
                            可用状态：{STATUS_OPTIONS.map((option) => option.value).join("、")}
                          </p>
                        ) : inlineBlockKind(node, inlineDraft) === "source" ? (
                          <p className="text-[10px] leading-4 text-muted-foreground">
                            行首事实来源需为：{SOURCE_OPTIONS.map((option) => option.value).join("、")}
                          </p>
                        ) : null}
                        {inlineError ? (
                          <p role="alert" className="rounded-lg bg-destructive/10 px-2.5 py-2 text-xs leading-5 text-destructive">
                            {inlineError}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground">⌘/Ctrl + Enter 保存 · Esc 取消</span>
                          <span className="flex items-center gap-1.5">
                            <Button size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" disabled={inlineSaving} onClick={cancelInlineEditing}>
                              <Undo2 />取消
                            </Button>
                            <Button size="sm" className="h-8 rounded-lg px-2.5 text-xs" disabled={inlineSaving} onClick={() => void saveInlineBlock()}>
                              {inlineSaving ? <LoaderCircle className="animate-spin" /> : <Check />}
                              {inlineSaving ? "保存中" : "保存此项"}
                            </Button>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <dt className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">{block.label}</dt>
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="size-7 shrink-0 rounded-lg text-muted-foreground opacity-0 transition-opacity group-hover/block:opacity-100 focus-visible:opacity-100"
                              aria-label={`编辑${block.label}`}
                              title="双击内容或点击此处，只编辑这一条"
                              onClick={(event) => {
                                event.stopPropagation()
                                beginInlineEditing(block)
                              }}
                            ><PencilLine /></Button>
                          ) : null}
                        </div>
                        <dd
                          className="mt-1.5 min-w-0 text-sm leading-6 break-words [overflow-wrap:anywhere]"
                          title={canEdit ? "双击只编辑当前一条" : undefined}
                        >
                          <SpecMarkdown images={images} source={block.label === "状态" ? (STATUS_OPTIONS.find(option => option.value === structuredValueFromContent(block.content))?.label || block.content) : block.content} title={block.label} referenceNames={referenceNames} />
                        </dd>
                      </>
                    )}
                  </CardContent>
                </Card>
              )
            })
          ) : (
            <p className="text-sm text-muted-foreground">尚未补充详细字段。</p>
          )}
        </dl>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={editMode === "codex-gate"
        ? "rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs leading-5 text-amber-100"
        : "rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-xs leading-5 text-emerald-100"}
      >
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-3.5" />
          {editMode === "codex-gate" ? "Codex 修订草稿" : "本地原文件编辑"}
        </div>
        <p className="mt-1.5 opacity-70">
          {editMode === "codex-gate"
            ? "此处只保存会话草稿。点击顶部“提交 Codex”后，由发起本次会话的 Codex 修订原始 Spec；节点 ID、类型和关系保持只读。"
            : "保存后直接写入下方本地 Spec 原文件，并同步工作台视图；这项手工编辑不要求先连接 Codex。节点 ID、类型和关系保持只读。"}
        </p>
        <p className="mt-1.5 truncate font-mono text-[10px]" title={specPath}>{specPath}</p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted-foreground">节点标题</span>
        <Input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          className="h-9 rounded-xl text-sm"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">状态</span>
          <Select value={draft.status} onValueChange={(value) => setDraft((current) => ({ ...current, status: value as SpecNode["status"] }))}>
            <SelectTrigger className="w-full rounded-xl text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">事实来源</span>
          <Select value={draft.sourceKind} onValueChange={(value) => setDraft((current) => ({
            ...current,
            sourceKind: value as SpecNode["sourceKind"],
          }))}>
            <SelectTrigger className="w-full rounded-xl text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      </div>

      {node.statement !== undefined ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">概括性定义（旧版兼容）</span>
          <Textarea
            value={draft.statement}
            onChange={(event) => setDraft((current) => ({ ...current, statement: event.target.value }))}
            className="min-h-24 resize-y text-sm leading-6"
          />
        </label>
      ) : null}

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground">原文内容块</span>
          <span className="text-[11px] text-muted-foreground">按当前顺序回传；空内容不保存</span>
        </div>
        {draft.contentBlocks.map((block, index) => (
          <div key={block.id} className="block space-y-2 rounded-xl border bg-muted/25 p-2.5">
            <div className="flex items-center gap-1.5">
              <Input
                value={block.label}
                aria-label={`第 ${index + 1} 个字段名称`}
                placeholder="字段名称"
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  contentBlocks: current.contentBlocks.map((item) =>
                    item.id === block.id ? { ...item, label: event.target.value } : item,
                  ),
                }))}
                className="h-8 min-w-0 flex-1 rounded-lg text-xs font-semibold"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 rounded-lg text-muted-foreground"
                aria-label={`上移${block.label || `第 ${index + 1} 个字段`}`}
                disabled={index === 0}
                onClick={() => setDraft((current) => {
                  const contentBlocks = [...current.contentBlocks]
                  ;[contentBlocks[index - 1], contentBlocks[index]] = [contentBlocks[index], contentBlocks[index - 1]]
                  return { ...current, contentBlocks }
                })}
              ><ArrowUp /></Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 rounded-lg text-muted-foreground"
                aria-label={`下移${block.label || `第 ${index + 1} 个字段`}`}
                disabled={index === draft.contentBlocks.length - 1}
                onClick={() => setDraft((current) => {
                  const contentBlocks = [...current.contentBlocks]
                  ;[contentBlocks[index], contentBlocks[index + 1]] = [contentBlocks[index + 1], contentBlocks[index]]
                  return { ...current, contentBlocks }
                })}
              ><ArrowDown /></Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 rounded-lg text-muted-foreground hover:text-destructive"
                aria-label={`删除${block.label || `第 ${index + 1} 个字段`}`}
                onClick={() => setDraft((current) => ({
                  ...current,
                  contentBlocks: current.contentBlocks.filter((item) => item.id !== block.id),
                }))}
              ><Trash2 /></Button>
            </div>
            <Textarea
              value={block.content}
              aria-label={`${block.label || `第 ${index + 1} 个字段`}内容`}
              onChange={(event) => setDraft((current) => ({
                ...current,
                contentBlocks: current.contentBlocks.map((item) =>
                  item.id === block.id ? { ...item, content: event.target.value } : item,
                ),
              }))}
              className="min-h-20 resize-y text-sm leading-6"
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={newBlockLabel}
            onChange={(event) => setNewBlockLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !newBlockLabel.trim()) return
              event.preventDefault()
              setDraft((current) => ({
                ...current,
                contentBlocks: [
                  ...current.contentBlocks,
                  { id: nextBlockId(current.contentBlocks), label: newBlockLabel.trim(), content: "" },
                ],
              }))
              setNewBlockLabel("")
            }}
            className="min-w-0 flex-1 rounded-xl text-xs"
            placeholder="输入任意原文字段名称"
            aria-label="新内容块字段名称"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-xl"
            aria-label="添加内容块"
            disabled={!newBlockLabel.trim()}
            onClick={() => {
              if (!newBlockLabel.trim()) return
              setDraft((current) => ({
                ...current,
                contentBlocks: [
                  ...current.contentBlocks,
                  { id: nextBlockId(current.contentBlocks), label: newBlockLabel.trim(), content: "" },
                ],
              }))
              setNewBlockLabel("")
            }}
          ><Plus /></Button>
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-muted-foreground">页面匹配提示（每行一项）</span>
        <Textarea
          value={draft.anchorHints}
          onChange={(event) => setDraft((current) => ({ ...current, anchorHints: event.target.value }))}
          className="min-h-20 resize-y font-mono text-xs leading-5"
        />
      </label>

      {error ? <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{error}</p> : null}

      <div className="grid grid-cols-2 gap-2 pb-1">
        <Button variant="outline" className="rounded-xl" disabled={saving} onClick={() => setEditing(false)}>
          <Undo2 />取消
        </Button>
        <Button className="rounded-xl" disabled={saving || !draft.title.trim()} onClick={() => void save()}>
          {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
          {saving ? "保存中" : editMode === "codex-gate" ? "保存修订草稿" : "保存到原文件"}
        </Button>
      </div>
    </div>
  )
}
