import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  Check,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  MoveUp,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { LocalPathListing } from "@/types"
import { listLocalPath } from "./project-center-api"

type PickerKind = "directory" | "html" | "markdown" | "json"

interface PathPickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: PickerKind
  initialPath: string
  title: string
  description: string
  onSelect: (path: string) => void
}

const iconFor = (kind: PickerKind, type: "directory" | "file") => {
  if (type === "directory") return <Folder className="size-4 text-amber-600" />
  if (kind === "html") return <FileCode2 className="size-4 text-sky-700" />
  if (kind === "markdown") return <FileText className="size-4 text-emerald-700" />
  return <FileJson2 className="size-4 text-violet-700" />
}

export function PathPickerSheet({
  open,
  onOpenChange,
  kind,
  initialPath,
  title,
  description,
  onSelect,
}: PathPickerSheetProps) {
  const [listing, setListing] = useState<LocalPathListing | null>(null)
  const [location, setLocation] = useState(initialPath)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(
    async (path: string) => {
      setLoading(true)
      setError("")
      try {
        const result = await listLocalPath(path, kind)
        setListing(result)
        setLocation(result.current)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "无法读取本地路径")
      } finally {
        setLoading(false)
      }
    },
    [kind],
  )

  useEffect(() => {
    if (!open) return
    setLocation(initialPath)
    void load(initialPath)
  }, [initialPath, load, open])

  const choose = (path: string) => {
    onSelect(path)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(560px,96vw)] sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <FolderOpen className="size-5 text-emerald-300" />
            {title}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={!listing?.parent || loading}
              onClick={() => listing?.parent && void load(listing.parent)}
              title="返回上级目录"
            >
              <MoveUp />
            </Button>
            <Input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(location)
              }}
              aria-label="当前本地路径"
              className="h-9 font-mono text-xs"
            />
            <Button
              variant="secondary"
              disabled={!location.trim() || loading}
              onClick={() => void load(location)}
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <ArrowLeft />}
              前往
            </Button>
          </div>

          {error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <ScrollArea className="min-h-0 flex-1 rounded-2xl border bg-muted/20">
            <div className="space-y-1 p-2">
              {loading && !listing ? (
                <div className="grid min-h-56 place-content-center gap-2 text-center text-sm text-muted-foreground">
                  <LoaderCircle className="mx-auto size-5 animate-spin" />
                  正在读取目录…
                </div>
              ) : null}
              {!loading && listing?.items.length === 0 ? (
                <div className="grid min-h-56 place-content-center text-sm text-muted-foreground">
                  当前目录没有可选内容
                </div>
              ) : null}
              {listing?.items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    if (item.type === "directory") void load(item.path)
                    else choose(item.path)
                  }}
                >
                  {iconFor(kind, item.type)}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.type === "directory" ? (
                    <span className="text-xs text-muted-foreground">打开</span>
                  ) : (
                    <Check className="size-4 text-emerald-300" />
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <SheetFooter className="border-t">
          {kind === "directory" ? (
            <Button
              disabled={!listing?.current}
              onClick={() => listing?.current && choose(listing.current)}
            >
              <Check />
              选择当前目录
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
