import { SpecMarkdown } from "./spec-markdown"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { contentBlocksForNode } from "@/lib/spec-mapping"
import type { FlatSpecNode, PrdDocumentView } from "@/types"

const metadata = new Set(["状态", "来源", "关联", "关联 PRD", "页面", "页面匹配提示"])
const normalize = (value: string) => value.trim()

export function SpecReadingContext({ node, constraints, prd, nodeById, onLocatePrd, referenceNames, images }: {
  images?: PrdDocumentView["images"]
  referenceNames?: ReadonlyMap<string, string>
  onLocatePrd?: (id: string) => void
  node: FlatSpecNode
  constraints: { relationType: string; node: FlatSpecNode }[]
  prd?: PrdDocumentView | null
  nodeById: Map<string, FlatSpecNode>
}) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const locateRule = (id: string) => {
    setHighlight(id)
    root.current?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  // 只去除元数据及逐字重复，不生成摘要，不替来源决定适用条件。
  const applicable = constraints.map(({ node: rule }) => {
    const seen = new Set<string>()
    const blocks = contentBlocksForNode(rule).filter(block => !metadata.has(block.label))
    if (rule.statement) blocks.unshift({ id: "original-statement", label: "说明", content: rule.statement })
    return { rule, blocks: blocks.filter(block => {
      const value = normalize(block.content)
      if (!value || value === normalize(rule.title) || seen.has(value)) return false
      seen.add(value)
      return true
    }) }
  })
  const prdIds = [...new Set([node, ...constraints.map(entry => entry.node)].flatMap(item => item.prdSectionIds || []))]
  const referencedIds = new Set([
    ...(node.relations || []).map(relation => relation.targetId),
    ...contentBlocksForNode(node).filter(block => block.label === "关联").flatMap(block => [...block.content.matchAll(/`([^`]+)`/g)].map(match => match[1])),
  ])
  const missing = [...referencedIds].filter(id => !nodeById.has(id))
  return <div ref={root} className="min-w-0 space-y-4 break-words [overflow-wrap:anywhere]" data-testid="spec-reading-context">
    {applicable.length ? <section className="space-y-4" data-testid="applicable-rules">
      <h3 className="text-sm font-semibold">适用规则</h3>
      {applicable.map(({ rule, blocks }) => <section key={rule.id} data-rule-id={rule.id} data-source-highlight={highlight === rule.id || undefined} className={`scroll-mt-4 space-y-2 border-l-2 border-emerald-400/30 pl-3 ${highlight === rule.id ? "rounded-lg bg-amber-300/10 ring-1 ring-amber-300/60" : ""}`} data-testid={`applicable-rule-${rule.id}`}>
        <h4 className="text-sm font-medium">{rule.title}</h4>
        {highlight === rule.id ? <Button size="sm" variant="ghost" onClick={() => setHighlight(null)}>隐藏高亮</Button> : null}
        {!blocks.length ? <p className="text-xs text-amber-300">此规则尚未补充行为条款，请核对来源。</p> : null}
        {blocks.map(block => <div key={block.id}>
          <p className="text-xs text-muted-foreground">{block.label}</p>
          <SpecMarkdown images={images} source={block.content} title={`${rule.title} · ${block.label}`} referenceNames={referenceNames} />
        </div>)}
      </section>)}
    </section> : null}
    {missing.map(id => <p key={id} className="text-xs text-amber-300">关联来源 {id} 已缺失，请核对文档。</p>)}
    <section className="space-y-2 border-t pt-3" data-testid="spec-sources">
      <h3 className="text-xs font-semibold text-muted-foreground">来源与原文</h3>
      {prdIds.map(id => {
        const section = prd?.sections.find(item => item.id === id)
        return <div key={id} data-testid={`source-prd-${id}`}>
          <Button variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left text-xs" disabled={!section || !onLocatePrd} onClick={() => onLocatePrd?.(id)}>PRD · {section?.title || id} ↗</Button>
          {!section ? <p className="text-xs text-amber-300">{prd ? "该章节已缺失，请核对来源。" : "当前工作台未载入对应 PRD，无法定位来源原文。"}</p> : null}
        </div>
      })}
      {constraints.map(({ node: rule }) => <Button key={rule.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left text-xs" data-testid={`source-rule-${rule.id}`} onClick={() => locateRule(rule.id)}>公共规则 · {rule.title} ↑</Button>)}
    </section>
  </div>
}
