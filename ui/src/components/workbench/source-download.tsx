import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SourceDownload({ source, filename }: { source?: string; filename: string }) {
  return <Button size="sm" variant="outline" disabled={source === undefined} aria-label={`下载 ${filename} 源文件`} onClick={() => {
    if (source === undefined) return
    const url = URL.createObjectURL(new Blob([source], { type: "text/markdown;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url; link.download = filename
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }}><Download />下载源文件</Button>
}
