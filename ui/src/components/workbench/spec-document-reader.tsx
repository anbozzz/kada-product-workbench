import { SourceDownload } from "./source-download"
import { useCallback, useState, type ReactNode } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PrdMarkdownPreview } from "./prd-browser"
import type { WorkbenchConfig } from "@/types"

const noRelatedSections = new Set<string>()

export function SpecDocumentReader({ open, onOpenChange, document, updateNotice }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: WorkbenchConfig["specDocument"]
  updateNotice?: ReactNode
}) {
  const [headings, setHeadings] = useState<HTMLElement[]>([])
  const readHeadings = useCallback((element: HTMLDivElement | null) => {
    setHeadings(element ? [...element.querySelectorAll<HTMLElement>("[data-prd-heading]")] : [])
  }, [document?.revision])

  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="!w-full !max-w-4xl gap-0" aria-label="完整 Spec 阅读器">
      <SheetHeader className="shrink-0 py-4 pr-16">
        <div className="flex items-center justify-between gap-3"><SheetTitle>完整 Spec</SheetTitle><SourceDownload source={document?.source} filename="Spec.md" /></div>
        <SheetDescription>{document?.pendingDraft
          ? "已载入原文；节点修订草稿尚未写回，全文暂未包含这些修改。"
          : "当前已载入的 Markdown 原文，只读。"}</SheetDescription>
        <label className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0">章节</span>
          <select aria-label="Spec 章节" defaultValue="" className="min-w-0 flex-1 rounded border bg-background p-2"
            onChange={event => headings[Number(event.target.value)]?.scrollIntoView({ block: "start" })}>
            <option value="" disabled>选择章节</option>
            {headings.map((heading, index) => <option key={heading.dataset.prdHeading} value={index}>{heading.textContent}</option>)}
          </select>
        </label>
      </SheetHeader>
      {updateNotice}
      <div ref={readHeadings} className="min-h-0 flex-1 overflow-y-auto px-6 pb-12 [overflow-wrap:anywhere]" data-testid="full-spec-body">
        <PrdMarkdownPreview source={document?.source || ""} query="" related={noRelatedSections} images={document?.images} />
      </div>
    </SheetContent>
  </Sheet>
}
