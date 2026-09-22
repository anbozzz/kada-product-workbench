import type { PrdDocumentView } from "@/types"
import { hasMarkdownStructure } from "@/lib/markdown-structure"
import { useMemo, useState } from "react"
import { Dialog } from "radix-ui"
import { Maximize2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PrdMarkdownPreview } from "./prd-browser"

const noRelated = new Set<string>()

export function SpecMarkdown({ source, title, referenceNames, images }: {
  source: string
  images?: PrdDocumentView["images"]
  title: string
  referenceNames?: ReadonlyMap<string, string>
}) {
  const [open, setOpen] = useState(false)
  const expandable = useMemo(() => hasMarkdownStructure(source), [source])
  const render = () => <PrdMarkdownPreview source={source} query="" related={noRelated} images={images} compact referenceNames={referenceNames} />
  return <div className="min-w-0" onDoubleClick={event => { if (open) event.stopPropagation() }}>
    {render()}
    {expandable ? <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><Button variant="ghost" size="sm" className="mt-1 text-xs text-muted-foreground" aria-label={`放大查看${title}`} onClick={event => event.stopPropagation()}><Maximize2 />放大查看</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] flex max-h-[90vh] w-[94vw] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-background shadow-2xl" onDoubleClick={event => event.stopPropagation()}>
          <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
            <div><Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title><Dialog.Description className="text-xs text-muted-foreground">只读内容，关闭后返回原位置。</Dialog.Description></div>
            <Dialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="关闭放大查看"><X /></Button></Dialog.Close>
          </div>
          <div className="min-h-0 overflow-auto px-6 py-4">{render()}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root> : null}
  </div>
}
