/**
 * Adapted from Beautiful UI Prompt Bar, Copyright (c) 2026 Shane Levine, MIT.
 * Source: https://www.beautifului.dev/#prompt-bar (Copy code, 2026-09-02).
 * See LICENSE and README.md in this directory for provenance and adaptations.
 */
import { useLayoutEffect, type ReactNode, type RefObject } from "react"
import { DropdownMenu } from "radix-ui"
import { LoaderCircle } from "lucide-react"

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

export interface PromptReference {
  id: string
  label: string
  caption?: string
  description?: string
  onPreview: () => void
  onRemove: () => void
}
export interface PromptAction { label: string; disabled?: boolean; onSelect: () => void }

/** Controlled product adapter: the host owns draft, delivery and error recovery. */
export function PromptBar({ value, onValueChange, onSend, inputRef, references = [], actions = [], mode, onPreview, canPreview, canSend, busy, placeholder }: {
  value: string
  onValueChange: (value: string) => void
  onSend: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  references?: PromptReference[]
  actions?: PromptAction[]
  mode?: ReactNode
  onPreview: () => void
  canPreview: boolean
  canSend: boolean
  busy: boolean
  placeholder: string
}) {
  // Upstream's compact auto-height textarea, with resize observation for a docked drawer.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const resize = () => {
      input.style.height = "0px"
      const contentHeight = input.scrollHeight
      input.style.height = `${Math.min(Math.max(contentHeight, 68), 160)}px`
      input.style.overflowY = contentHeight > 160 ? "auto" : "hidden"
    }
    resize()
    const observer = new ResizeObserver(resize)
    if (input.parentElement) observer.observe(input.parentElement)
    return () => observer.disconnect()
  }, [value, inputRef])

  return <div data-promptbar data-component-source="beautiful-ui/prompt-bar" className="w-full">
    <div className="relative">
      <div className="relative isolate flex flex-col gap-2.5 overflow-hidden rounded-[22px] border border-white/15 bg-[#202123] p-3.5 shadow-sm transition-[border-color,border-radius] duration-150 focus-within:border-white/35" data-testid="prd-composer">
        {references.length > 0 ? <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-0.5 pt-0.5" aria-label="已选内容">
          {references.map((reference, index) => <span key={reference.id} className="flex min-w-0 max-w-full items-center gap-1 rounded-[7px] bg-white/[0.045] py-1 pr-1 pl-1.5 text-[11.5px] text-foreground/80 ring-1 ring-white/10" data-testid="prd-reference-card">
            <button type="button" disabled={busy} onClick={reference.onPreview} aria-label={`预览引用 ${index + 1}`} className="flex min-w-0 items-center gap-1.5 rounded px-1 text-left hover:text-foreground focus-visible:outline-2">
              <Icon size={12}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></Icon>
              <span className="min-w-0 max-w-56"><span className="block truncate">{reference.label}</span>{reference.description ? <span className="block truncate text-muted-foreground">{reference.description}</span> : null}</span>
              {reference.caption ? <span className="shrink-0 text-muted-foreground">{reference.caption}</span> : null}
            </button>
            <button type="button" disabled={busy} aria-label={`移除引用 ${index + 1}`} onClick={reference.onRemove} className="-my-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors duration-100 hover:bg-white/10 hover:text-foreground focus-visible:outline-2">
              <Icon size={10} strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12" /></Icon>
            </button>
          </span>)}
        </div> : null}
        <div className="grid grid-cols-[28px_auto_minmax(0,1fr)_28px_28px] items-end gap-x-1 gap-y-1.5">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button type="button" disabled={busy} aria-label="添加批注意见" title="添加批注意见" className="col-start-1 row-start-2 flex size-7 shrink-0 items-center justify-center justify-self-start rounded-[8px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-white/10 hover:text-foreground active:scale-[0.94] focus-visible:outline-2">
              <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
            </button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content side="top" align="start" sideOffset={12} className="z-[75] min-w-48 rounded-[10px] border border-white/10 bg-popover p-1 text-xs shadow-xl">
              {actions.map(action => <DropdownMenu.Item key={action.label} disabled={action.disabled} onSelect={action.onSelect} className="cursor-pointer rounded-[6px] px-3 py-2.5 outline-none data-disabled:opacity-40 data-highlighted:bg-white/10">{action.label}</DropdownMenu.Item>)}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
          <textarea ref={inputRef} rows={1} value={value} disabled={busy} maxLength={4000} onChange={event => onValueChange(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault()
              if (canSend && !busy) onSend()
            }
          }} placeholder={placeholder} aria-label="PRD 修改意见"
            className="col-span-full col-start-1 row-start-1 min-h-[68px] w-full min-w-0 resize-none bg-transparent px-2 py-2 text-[14px] leading-5 text-foreground outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground/70" />
          <div className="col-start-2 row-start-2 flex h-7 items-center justify-self-start text-[12px] font-medium text-muted-foreground">{mode}</div>
          <button type="button" aria-label="预览发送内容" title="预览发送内容" disabled={!canPreview || busy} onClick={onPreview} className="col-start-4 row-start-2 flex size-7 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-[background-color,color,transform] duration-150 enabled:hover:bg-white/10 enabled:hover:text-foreground enabled:active:scale-[0.94] disabled:opacity-35 focus-visible:outline-2">
            <Icon size={15}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Icon>
          </button>
          <button type="button" aria-label="发送给原 Codex 任务" title="发送整批（⌘ / Ctrl + Enter）；Enter 换行" disabled={!canSend || busy} onClick={onSend}
            className="col-start-5 row-start-2 flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-background transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] disabled:bg-white/20 disabled:text-foreground/50 focus-visible:outline-2">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>}
          </button>
        </div>
      </div>
    </div>
  </div>
}
