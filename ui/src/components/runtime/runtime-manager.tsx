import { createPortal } from "react-dom"
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { runtimeDirty } from './runtime-state'

type Instance = { id: string; url: string; name: string; state: string; kind: string; closing?: string; blockReason?: string }
type Health = Instance & { token: string; protocol: number }
const labels: Record<string, string> = { starting: '启动中', ready: '已就绪', waiting: '等待来源确认', unreachable: '已断开', closed: '已关闭', checking: '检查中' }
export function RuntimeManager() {
  const [health, setHealth] = useState<Health | null>(null)
  const healthRef = useRef<Health | null>(null)
  const [connection, setConnection] = useState('checking')
  const [open, setOpen] = useState(false)
  const [instances, setInstances] = useState<Instance[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const closed = useRef(false)
  const clientId = useRef(crypto.randomUUID())
  const request = async (path: string, input?: object) => {
    const response = await fetch('/api/runtime' + path, { method: input ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-runtime-token': healthRef.current?.token || '' }, body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(3500) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '工作台未响应')
    return value
  }
  useEffect(() => {
    let disposed = false, running = false, frozen = false, unsupported = false, ack = ''
    const block = (event: Event) => { if (frozen && !(event.target as Element)?.closest?.('[data-runtime-manager]')) { event.preventDefault(); event.stopImmediatePropagation() } }
    for (const name of ['click','keydown','beforeinput','pointerdown']) document.addEventListener(name, block, true)
    const tick = async () => {
      if (running || disposed || closed.current || unsupported) return
      running = true
      try {
        if (!healthRef.current) {
          const response = await fetch('/api/runtime', { signal: AbortSignal.timeout(3000) })
          if (!response.ok) { unsupported = true; return } // Frozen packages have no instance management.
          const value = await response.json()
          if (value.protocol !== 1 || !value.token) { unsupported = true; return }
          healthRef.current = value
        }
        const value = await request('/client', { clientId: clientId.current, dirty: runtimeDirty(), ack })
        frozen = Boolean(value.closing); ack = value.closing || ''
        if (!disposed) { const next = { ...healthRef.current, ...value }; healthRef.current = next; setHealth(next); setConnection(value.state) }
      } catch { /* Keep a pending close frozen until the server explicitly cancels it. */ if (!disposed) setConnection(closed.current ? 'closed' : 'unreachable') }
      finally { running = false }
    }
    void tick(); const timer = setInterval(() => void tick(), 1000)
    const leave = (departed = false) => { if (healthRef.current) void fetch('/api/runtime/client', { method: 'POST', keepalive: true, headers: { 'content-type':'application/json','x-runtime-token':healthRef.current.token }, body: JSON.stringify({clientId:clientId.current,dirty:departed ? false : runtimeDirty(),departed:true}) }).catch(() => {}) }
    const beforeUnload = (event: BeforeUnloadEvent) => { if (runtimeDirty()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    const pageHide = (event: PageTransitionEvent) => { if (!event.persisted) leave(true) }
    window.addEventListener('pagehide', pageHide)
    return () => { disposed = true; clearInterval(timer); leave(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', pageHide); for (const name of ['click','keydown','beforeinput','pointerdown']) document.removeEventListener(name, block, true) }
  }, [])
  const refresh = async () => { try { const value = await request('/list'); setInstances(value.instances); setError('') } catch (e) { setError((e as Error).message) } }
  useEffect(() => { if (!open) return; void refresh(); const timer = setInterval(() => { if (!busy) void refresh() }, 4000); return () => clearInterval(timer) }, [open, busy])
  const stop = async (instance: Instance) => {
    if (!confirm(`关闭“${instance.name}”工作台？${instance.kind === 'gate' ? '本次 Codex 等待会话将取消。' : ''}同事访问的发布服务不受影响。`)) return
    setBusy(true); setError('')
    let challenge = ''
    try {
      const prepare = await request('/manage', { id: instance.id, action: 'prepare' }); challenge = prepare.target.closing
      await new Promise(resolve => setTimeout(resolve, 2600))
      await request('/manage', { id: instance.id, action: 'commit', challenge })
      setInstances(items => items.map(item => item.id === instance.id ? { ...item, state: 'closed' } : item))
      if (instance.id === healthRef.current?.id) { closed.current = true; setConnection('closed') }
    } catch (e) { setError((e as Error).message); if (challenge) await request('/manage', { id: instance.id, action: 'cancel', challenge }).catch(() => {}) }
    finally { setBusy(false) }
  }
  if (!health) return null
  const slot = document.getElementById("runtime-status-slot")
  const statusButton = <Button data-runtime-manager data-testid="runtime-status"
      title={`工作台 · ${labels[connection] || connection}；点击管理工作台`}
      aria-label={`工作台 · ${labels[connection] || connection}，管理工作台`}
      className={`h-6 shrink-0 gap-1.5 rounded-md px-1.5 text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground ${slot ? '' : 'fixed bottom-3 left-3 z-[60] bg-background/95'}`}
      size="sm" variant="ghost" onClick={() => setOpen(true)}>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${connection === 'ready' ? 'bg-emerald-400' : connection === 'unreachable' ? 'bg-red-400' : connection === 'closed' ? 'bg-muted-foreground' : 'bg-amber-400'}`} />
      <span><span className="sr-only">工作台 · </span>{labels[connection] || connection}</span>
    </Button>
  return <div data-runtime-manager>
    {slot ? createPortal(statusButton, slot) : statusButton}
    {health.closing && connection !== 'closed' && <div className="fixed inset-x-0 top-0 z-[90] bg-amber-950 p-2 text-center text-sm text-white">正在检查关闭工作台，暂时暂停操作；有未保存内容时会保留。</div>}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent data-runtime-manager className="overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>工作台运行管理</SheetTitle><SheetDescription>查看本机所有已登记实例。关闭工作台不会停止在线发布。</SheetDescription></SheetHeader>
      <div className="space-y-4 p-5"><p className="text-sm">当前：{health.name} · {labels[connection]}</p>
      <Button variant="outline" onClick={() => { if (connection === 'closed') window.location.reload(); else void refresh() }}>刷新检查</Button>
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      {!instances.length && <p className="text-sm text-muted-foreground">正在读取工作台列表…</p>}
      {instances.map(item => <div key={item.id} className="space-y-2 rounded-lg border p-3"><div className="flex justify-between gap-2"><strong className="text-sm">{item.name}{item.id === health.id ? '（当前）' : ''}</strong><span className="text-xs">{labels[item.state]}</span></div><p className="text-xs text-muted-foreground">{item.kind === 'gate' ? 'Codex 提交会话（独立）' : item.kind === 'prd-review' ? 'PRD 批注会话（独立）' : '普通工作台'}</p><p className="break-all text-xs text-muted-foreground">{item.url}</p>{item.blockReason && <p className="text-xs text-amber-300">{item.blockReason}</p>}<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => window.open(item.url, '_blank', 'noopener')}>打开</Button>{item.state !== 'unreachable' && item.state !== 'closed' ? <Button size="sm" variant="outline" disabled={busy || connection === 'closed'} onClick={() => void stop(item)}>关闭工作台</Button> : <Button size="sm" variant="ghost" disabled={busy || connection === 'closed'} onClick={async () => { try { await request('/manage', {id:item.id,action:'forget'}); await refresh() } catch(e) {setError((e as Error).message)} }}>移除失效记录</Button>}</div></div>)}
      <p className="text-xs text-muted-foreground">只有经过检查的实例才显示已就绪。旧版本启动的实例需重新启动后才能纳入此列表。</p></div>
    </SheetContent></Sheet>
  </div>
}
