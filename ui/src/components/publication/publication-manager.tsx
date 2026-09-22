import { ApiError } from "@/lib/api-client"
import { useCallback, useEffect, useState } from 'react'
import { Globe, LoaderCircle, RefreshCw, Copy, Power, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { loadPublications, publicationCommand, publicationSecret, publicationOperation, type PublicationStatus, type Publication } from './publication-api'

type Props = { projectPath?: string; canPublish?: boolean; beforePublish?: () => Promise<boolean>; onManage?: (record: Publication) => Promise<void> }
export function PublicationManager({ projectPath, canPublish = false, beforePublish, onManage }: Props) {
  const [status, setStatus] = useState<PublicationStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [address, setAddress] = useState('')
  const [message, setMessage] = useState('')
  const pendingKey = 'ips-publication-operation:' + (projectPath || 'all')
  const [pendingId, setPendingId] = useState(() => sessionStorage.getItem(pendingKey) || '')
  const setPending = (id: string) => { setPendingId(id); if (id) sessionStorage.setItem(pendingKey, id); else sessionStorage.removeItem(pendingKey) }
  const reconcile = async () => {
    if (!status || !pendingId) return
    setBusy(true)
    try {
      const result = await publicationOperation(status, pendingId)
      if (result.completed || result.retryable) { setPending(''); setMessage(result.completed ? '原操作已完成，已读取实际状态' : result.error || '原操作未生效，可重新操作') }
      else setMessage('原操作仍在处理中，请稍后继续核实')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : '无法核实原操作') }
    finally { setBusy(false) }
  }
  const refresh = useCallback(async () => {
    try { const value = await loadPublications(); setStatus(value); setError(''); setAddress(old => value.addresses.includes(old) ? old : value.addresses[0] || '') }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取发布状态') }
  }, [])
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden && !busy) void refresh() }, 5000); return () => clearInterval(timer) }, [refresh, busy])
  const current = projectPath ? status?.records.find(r => (r.projectKey === projectPath || r.project.projectPath === projectPath)) : status?.records.find(r => r.id === selected)
  const action = async (kind: string, record?: Publication) => {
    if (!status || busy || pendingId) return
    if (['publish', 'password'].includes(kind) && !/^[0-9]{4}$/.test(password)) { setError('请输入四位数字密码，允许以 0 开头'); return }
    if (kind === 'stop' && !confirm(`将使 ${status.records.filter(r => r.available).length} 个正在发布的项目无法访问。关闭本机服务？`)) return
    if (kind === 'delete' && !confirm(`删除“${record?.name}”的发布？链接将失效，项目源文件保留。`)) return
    if ((kind === 'start' || ['publish', 'resume'].includes(kind) && !status.running)) {
      const others = status.records.filter(r => r.enabled && r.id !== record?.id)
      if (others.length && !confirm(`开启服务将同时恢复 ${others.length} 个项目：${others.map(r => r.name).join('、')}。继续？`)) return
    }
    setBusy(true); setError(''); setMessage('')
    let operationId = ''
    try {
      if (['publish', 'update'].includes(kind) && beforePublish && !(await beforePublish())) return
      operationId = crypto.randomUUID(); setPending(operationId)
      const result = await publicationCommand(status, kind, { id: record?.id, password }, operationId)
      if (result.pending) { setMessage('原操作仍在处理中，请核实结果'); return }
      setPending('')
      if (result.serviceError) throw new Error(result.serviceError)
      setPassword(''); setVisible(false); setMessage(kind === 'stop' ? '本机服务已关闭，项目设置已保留' : '操作已完成')
      await refresh()
    } catch (e) { if (!operationId || (e instanceof ApiError && e.code !== 'OPERATION_UNKNOWN' && e.status < 500)) setPending(''); await refresh(); setError(e instanceof Error ? e.message : '发布操作失败') }
    finally { setBusy(false) }
  }
  const link = (record: Publication) => address && status?.port ? `http://${address}:${status.port}/p/${record.id}/` : ''
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setMessage('已复制') } catch { setMessage(`请手动复制：${text}`) } }
  const secret = async (record: Publication, copyOnly = false) => {
    if (!status) return
    try { const result = await publicationSecret(status, record.id); if (copyOnly) await copy(result.password); else { setPassword(result.password); setVisible(true) } }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取密码') }
  }
  const detail = (record?: Publication) => <div className="space-y-4" data-testid="publication-detail">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{record?.name || '发布当前项目'}</h3><p className="mt-1 text-xs text-muted-foreground">{record ? record.error || (record.available ? '● 发布中' : record.enabled ? '已发布 · 服务已关闭' : '已暂停') : '将当前导出内容冻结后分享给局域网同事'}</p></div>{busy && <LoaderCircle className="size-4 animate-spin" />}</div>
    {record && <p className="break-all text-xs text-muted-foreground">已发布：{new Date(record.generatedAt).toLocaleString()} · {record.snapshotId.slice(0, 8)}</p>}
    {record && <div className="space-y-2"><label className="text-xs text-muted-foreground" htmlFor={`address-${record.id}`}>分享地址（选择同事所在网络）</label><select id={`address-${record.id}`} className="w-full rounded-md border border-white/15 bg-[#111821] p-2 text-xs" value={address} onChange={e => setAddress(e.target.value)}>{status?.addresses.length ? status.addresses.map(ip => <option key={ip} value={ip}>{ip}</option>) : <option value="">没有可用局域网地址</option>}</select><p className="select-all break-all rounded-md bg-muted/40 p-2 text-xs">{link(record) || '服务开启后显示访问地址'}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!link(record)} onClick={() => void copy(link(record))}><Copy />复制链接</Button><Button size="sm" variant="outline" disabled={!record.available || !link(record)} onClick={() => window.open(link(record), '_blank', 'noopener')}>预览</Button><Button size="sm" variant="outline" onClick={() => void secret(record, true)}>复制密码</Button></div></div>}
    <div><label className="text-xs text-muted-foreground" htmlFor={`password-${record?.id || 'new'}`}>{record ? '修改四位访问密码' : '四位访问密码'}</label><div className="mt-2 flex gap-2"><Input id={`password-${record?.id || 'new'}`} aria-label="四位访问密码" type={visible ? 'text' : 'password'} inputMode="numeric" maxLength={4} autoComplete="off" value={password} onChange={e => setPassword(e.target.value.replace(/\D/g, ''))} placeholder="例如 0386" /><Button size="icon" variant="outline" aria-label={visible ? '隐藏密码' : '查看密码'} onClick={() => { if (visible) setVisible(false); else if (record && !password) void secret(record); else setVisible(true) }}>{visible ? <EyeOff /> : <Eye />}</Button><Button variant="outline" onClick={() => { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); setPassword(String(bytes[0] % 10000).padStart(4, '0')); setVisible(true) }}>随机</Button></div></div>
    <div className="flex flex-wrap gap-2">{record ? <><Button size="sm" disabled={busy || !!pendingId} onClick={() => void action(record.enabled ? 'pause' : 'resume', record)}><Power />{record.enabled ? '暂停发布' : '开启发布'}</Button>{canPublish && <Button size="sm" variant="outline" disabled={busy || !!pendingId} onClick={() => void action('update', record)}>更新发布内容</Button>}<Button size="sm" variant="outline" disabled={busy || !!pendingId || !/^[0-9]{4}$/.test(password)} onClick={() => void action('password', record)}>保存新密码</Button><Button size="sm" variant="ghost" disabled={busy || !!pendingId} onClick={() => void action('delete', record)}>删除发布</Button></> : <Button disabled={busy || !!pendingId || !canPublish || !/^[0-9]{4}$/.test(password)} onClick={() => void action('publish')}>{busy ? '正在发布…' : status?.running ? '发布到本机' : '开启服务并发布'}</Button>}</div>
    {!canPublish && <p className="text-xs text-muted-foreground">更新内容需从该项目工作台打开此面板。</p>}
    <p className="text-xs leading-5 text-muted-foreground">仅同一局域网访问。关闭浏览器或 Codex 后仍可访问；主机关机或睡眠时不可访问。暂停不能收回已加载或保存的内容。</p>
  </div>
  const feedback = <>{pendingId && <div className="rounded-lg border border-amber-400/30 p-3 text-xs">原操作结果待核实，暂不能重复提交。<Button size="sm" variant="outline" disabled={busy} onClick={() => void reconcile()}>核实原操作</Button></div>}{error && <p role="alert" className="break-words rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{error} <button className="underline" onClick={() => void refresh()}>刷新状态</button></p>}{message && <p role="status" className="select-all break-all text-xs text-emerald-300">{message}</p>}</>
  return <section className="space-y-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4" data-testid={projectPath ? 'project-publication' : 'publication-center'}>
    <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Globe className="size-4 text-emerald-300" />{projectPath ? '局域网发布' : '本机发布服务'}</h2><Button size="icon" variant="ghost" aria-label="刷新发布状态" onClick={() => void refresh()}><RefreshCw className="size-4" /></Button></div>
    {!status ? <p className="text-xs text-muted-foreground">正在读取发布状态…</p> : projectPath ? detail(current) : <><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{status.running ? '● 运行中' : '服务已关闭'} · 当前可访问 {status.records.filter(r => r.available).length} 个项目</p><Button size="sm" variant="outline" disabled={busy || !!pendingId || !status.records.some(r => r.enabled)} onClick={() => void action(status.running ? 'stop' : 'start')}>{status.running ? '关闭本机服务' : '开启本机服务'}</Button></div>{!status.records.length && <p className="text-xs leading-6 text-muted-foreground">暂无发布项目。进入项目工作台，在“导出与发布”中发布内容。</p>}{status.records.map(record => <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3"><div className="min-w-0"><p className="text-sm font-medium">{record.name}</p><p className="text-xs text-muted-foreground">{record.error || (record.available ? '发布中' : record.enabled ? '已发布 · 服务已关闭' : '已暂停')} · {new Date(record.generatedAt).toLocaleString()}</p></div><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!link(record)} onClick={() => void copy(link(record))}>复制链接</Button><Button size="sm" variant="ghost" disabled={busy || !!pendingId} onClick={() => void action(record.enabled ? 'pause' : 'resume', record)}>{record.enabled ? '暂停' : '开启发布'}</Button><Button size="sm" variant="outline" onClick={async () => { setPassword(''); setMessage(''); setVisible(false); if (onManage) { try { await onManage(record); return } catch { setMessage('来源暂不可用，仍可管理已发布快照') } } setSelected(record.id) }}>管理</Button></div></div>)}</>}
    {!!status?.cleanupPending && <Button size="sm" variant="outline" disabled={busy || !!pendingId} onClick={() => void action("cleanup")}>重试清理 {status.cleanupPending} 个旧副本</Button>}
    {feedback}
    {!projectPath && <Sheet open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); setPassword(''); setVisible(false) } }}><SheetContent className="overflow-y-auto sm:max-w-[480px]"><SheetHeader><SheetTitle>项目发布管理</SheetTitle><SheetDescription>管理已保存的发布快照，项目来源文件保持不变。</SheetDescription></SheetHeader><div className="space-y-4 p-6">{current ? detail(current) : <p>发布记录已删除。</p>}{feedback}</div></SheetContent></Sheet>}
  </section>
}
