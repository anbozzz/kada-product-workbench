import { acquirePublicationLock } from './publication-lock.mjs';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, realpath, readdir } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, digest } from './publication-store.mjs';
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const idOK = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
async function body(req) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 65536) throw fail('请求过大', 413); } return text ? JSON.parse(text) : {}; }
const ips = () => [...new Set(Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address))];
const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
const styles = 'body{margin:0;background:#090c10;color:#e7ecf3;font:15px system-ui}main{max-width:360px;margin:16vh auto;padding:32px;border:1px solid #29333f;border-radius:20px}h1{font-size:23px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:9px;margin-top:12px;border:1px solid #405064}input{background:#111821;color:white;font-size:24px;letter-spacing:12px}button{background:#6ee7b7;color:#07120e;font-size:15px;cursor:pointer}p{color:#a5b2c3;line-height:1.7}';
function loginPage(id) { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>访问发布内容</title><style>${styles}</style><main><h1>访问发布内容</h1><p>请输入发布者提供的四位密码。</p><form><input aria-label="四位访问密码" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" required><button>进入</button></form><p role="alert" id="error"></p></main><script>const f=document.querySelector('form');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;try{const r=await fetch('/p/${id}/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:f.querySelector('input').value})});const v=await r.json();if(!r.ok)throw Error(v.error);location.assign(v.url)}catch(e){document.querySelector('#error').textContent=e.message}finally{b.disabled=false}};</script></html>`; }
function bridge(id, snapshotId, prefix) {
  return `<script>window.__publicationPrefix=${JSON.stringify(prefix)};(()=>{let shown=false;const show=(message,auth=false)=>{if(shown)return;shown=true;const bar=document.createElement('div');bar.style.cssText='position:fixed;z-index:2147483647;top:0;left:0;right:0;background:#123a30;color:white;padding:12px 20px;font:14px system-ui;display:flex;gap:16px;align-items:center';const span=document.createElement('span');span.textContent=message;const b=document.createElement('button');b.textContent=auth?'重新验证':'加载新版';b.style.cssText='background:#6ee7b7;color:#061710;border:0;border-radius:6px;padding:7px 12px;cursor:pointer';b.onclick=async()=>{if(auth){location.assign('/p/${id}/');return}if(!confirm('加载新版会重新初始化页面，未保存的演示输入将丢失。'))return;try{const r=await fetch('/p/${id}/session/version',{method:'POST'});const v=await r.json();if(!r.ok)throw Error(v.error);location.assign(v.url)}catch(e){span.textContent=e.message}};bar.append(span,b);document.body.append(bar)};window.addEventListener('publication-error',e=>show(e.detail===401?'访问权限已失效，请重新验证':'内容已更新，请加载新版',e.detail===401));setInterval(async()=>{if(document.hidden)return;try{const r=await fetch('/p/${id}/version');if(r.status===401){show('访问权限已失效，请重新验证',true);return}if(!r.ok){show('内容不可访问，请联系发布者',true);return}const v=await r.json();if(v.snapshotId!==${JSON.stringify(snapshotId)})show('有新发布版本')}catch{}},10000)})();</script>`;
}
export async function startPublicationDaemon(root, { listenHost = '0.0.0.0', controlToken = randomUUID() } = {}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  root = await realpath(root);
  const stateFile = join(root, 'registry.json');
  let state = await readJson(stateFile, { schemaVersion: 1, revision: 0, port: 0, records: [], operations: {} });
  if (state.schemaVersion !== 1) throw fail('发布数据版本不兼容，请使用原版本管理');
  let visibleState = state;
  let publicServer = null, queue = Promise.resolve();
  let serviceError = "";
  const sessions = new Map(), responses = new Map();
  const save = () => writeJson(stateFile, state);
  const summary = () => ({ running: Boolean(publicServer?.listening), port: publicServer?.address()?.port || null, addresses: ips(), revision: state.revision,
    serviceError, cleanupPending: (state.cleanupPending || []).length, records: state.records.map(({ password, passwordHash, salt, ...record }) => ({ ...record, available: Boolean(publicServer?.listening && record.enabled && !record.error) })) });
  const invalidate = id => { for (const [key, session] of sessions) if (session.id === id) sessions.delete(key); for (const res of responses.get(id) || []) res.destroy(); };
  async function stop() { const current = publicServer; publicServer = null; sessions.clear(); if (current) { current.closeAllConnections(); await new Promise(resolve => current.close(resolve)); } }
  async function verifySnapshot(snapshotId) {
    if (!idOK(snapshotId)) throw fail('快照身份不合法');
    const directory = join(root, 'snapshots', snapshotId);
    const manifest = await readJson(join(directory, 'manifest.json'));
    for (const file of manifest.files) {
      const path = await realpath(resolve(directory, file.path));
      if (!path.startsWith(directory + sep) || digest(await readFile(path)) !== file.sha256) throw fail('快照资源不完整，请重新发布');
    }
    return await readJson(join(directory, 'data/config.json'));
  }
  async function start() {
    if (publicServer?.listening || !state.records.some(r => r.enabled)) return;
    for (const r of state.records.filter(r => r.enabled)) {
      try { await verifySnapshot(r.snapshotId); r.error = ''; } catch { r.error = '快照损坏，请恢复来源后更新发布'; }
    }
    if (!state.records.some(r => r.enabled && !r.error)) throw fail('没有可用发布快照');
    const server = createServer(publicRequest);
    const listen = port => new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, listenHost, () => { server.removeListener('error', reject); resolveListen(); }); });
    try { await listen(state.port || 0); } catch (error) { if (error.code !== 'EADDRINUSE') throw error; await listen(0); }
    publicServer = server; state.port = server.address().port;
  }
  async function publicRequest(req, res) {
    try {
      const url = new URL(req.url, 'http://publication.local');
      const parts = url.pathname.split('/');
      const id = parts[2];
      if (parts[1] !== 'p' || !idOK(id)) return json(res, 404, { error: '内容不可访问，请联系发布者' });
      const record = visibleState.records.find(r => r.id === id && r.enabled && !r.error);
      if (!record) return json(res, 404, { error: '内容不可访问，请联系发布者' });
      const route = '/' + parts.slice(3).join('/');
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) return json(res, 403, { error: '只读发布不提供写入接口' });
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: '请求来源不匹配' });
      if ((route === '/' || route === '') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(loginPage(id));
      }
      if (route === '/auth' && req.method === 'POST') {
        const input = await body(req);
        if (!/^[0-9]{4}$/.test(input.password || '') || !equal(digest(record.salt + input.password), record.passwordHash)) return json(res, 401, { error: '密码不正确，请重新输入' });
        const token = randomUUID(); sessions.set(token, { id, epoch: record.authEpoch, snapshotId: record.snapshotId });
        res.setHeader('set-cookie', `ips_${id}=${token}; HttpOnly; SameSite=Strict; Path=/p/${id}/`);
        return json(res, 200, { url: `/p/${id}/s/${record.snapshotId}/` });
      }
      const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`ips_${id}=`))?.split('=')[1];
      const session = sessions.get(cookie);
      if (!session || session.id !== id || session.epoch !== record.authEpoch) return json(res, 401, { error: '访问权限已失效，请重新验证' });
      if (route === '/version' && req.method === 'GET') return json(res, 200, { snapshotId: record.snapshotId, generatedAt: record.generatedAt });
      if (route === '/session/version' && req.method === 'POST') { session.snapshotId = record.snapshotId; return json(res, 200, { url: `/p/${id}/s/${record.snapshotId}/` }); }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 403, { error: '只读发布不提供写入接口' });
      if (parts[3] !== 's' || !idOK(parts[4])) return json(res, 404, { error: '资源不存在' });
      if (parts[4] !== record.snapshotId || session.snapshotId !== record.snapshotId) return json(res, 409, { code: 'SNAPSHOT_CHANGED', error: '内容已更新，请加载新版' });
      const snapshotRoot = join(root, 'snapshots', record.snapshotId);
      const prefix = `/p/${id}/s/${record.snapshotId}`;
      const suffix = '/' + parts.slice(5).join('/');
      if (!responses.has(id)) responses.set(id, new Set()); responses.get(id).add(res); res.once('close', () => responses.get(id)?.delete(res));
      if (suffix === '/api/config') {
        const config = await readJson(join(snapshotRoot, 'data/config.json'));
        config.targetUrl = prefix + config.targetUrl;
        return json(res, 200, config);
      }
      if (suffix.startsWith('/api/')) return json(res, 403, { error: '只读发布不提供此接口' });
      let relativePath;
      if (suffix === '/') relativePath = 'web/index.html';
      else if (suffix.startsWith('/studio-assets/')) relativePath = 'web/' + suffix.slice('/studio-assets/'.length);
      else if (suffix.startsWith('/target/')) relativePath = 'pages/' + suffix.slice('/target/'.length);
      else return json(res, 404, { error: '资源不存在' });
      const path = await realpath(resolve(snapshotRoot, decodeURIComponent(relativePath)));
      const allowed = join(snapshotRoot, relativePath.startsWith('web/') ? 'web' : 'pages');
      if (!path.startsWith(allowed + sep)) return json(res, 403, { error: '资源路径越界' });
      let content = await readFile(path);
      const ext = extname(path).toLowerCase();
      if (relativePath.startsWith('web/') && ['.html', '.js', '.css'].includes(ext)) content = Buffer.from(content.toString().replaceAll('/studio-assets/', prefix + '/studio-assets/'));
      if (relativePath === 'web/index.html') content = Buffer.from(content.toString().replace('</body>', bridge(id, record.snapshotId, prefix) + '</body>'));
      if (relativePath.startsWith('pages/') && ['.html', '.htm', '.css'].includes(ext)) {
        const base = prefix + '/target';
        content = Buffer.from(content.toString().replace(/((?:src|href|poster|action)=["'])\/(?!\/)/g, `$1${base}/`).replace(/(url\(["']?)\/(?!\/)/g, `$1${base}/`));
      }
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : error.statusCode || 400, { error: error.code === 'ENOENT' ? '资源不存在' : error.message }); else res.destroy(); }
  }
  async function command(input) {
    if (!idOK(input.operationId)) throw fail('缺少有效操作身份');
    const fingerprint = input.requestFingerprint || digest(JSON.stringify(input));
    const previous = state.operations[input.operationId];
    if (previous) { if (previous.fingerprint !== fingerprint) throw fail('操作身份已被其他请求使用', 409); return { ...summary(), operationId: input.operationId }; }
    if (input.expectedRevision !== state.revision) throw fail('发布状态已变化，请刷新后再操作', 409);
    serviceError = '';
    const record = state.records.find(r => r.id === input.id);
    const oldSnapshotId = record?.snapshotId;
    if (['pause', 'resume', 'password', 'delete', 'update'].includes(input.action) && !record) throw fail('发布记录不存在', 404);
    switch (input.action) {
      case 'cleanup': break;
      case 'start': break;
      case 'stop': break;
      case 'publish': {
        if (!input.projectKey || state.records.some(r => r.projectKey === input.projectKey)) throw fail('项目已发布，请刷新后更新', 409);
        if (!/^[0-9]{4}$/.test(input.password || '')) throw fail('密码必须是四位数字');
        await verifySnapshot(input.snapshotId);
        const salt = randomUUID();
        state.records.push({ id: randomUUID(), projectKey: input.projectKey, project: input.project, name: input.name, snapshotId: input.snapshotId, generatedAt: input.generatedAt, enabled: true, password: input.password, salt, passwordHash: digest(salt + input.password), authEpoch: 1, error: '' });
        break;
      }
      case 'update': { await verifySnapshot(input.snapshotId); record.snapshotId = input.snapshotId; record.generatedAt = input.generatedAt; record.error = ''; break; }
      case 'pause': record.enabled = false; record.authEpoch++; break;
      case 'resume': await verifySnapshot(record.snapshotId); record.enabled = true; record.error = ''; break;
      case 'password': if (!/^[0-9]{4}$/.test(input.password || '')) throw fail('密码必须是四位数字'); record.password = input.password; record.passwordHash = digest(record.salt + input.password); record.authEpoch++; break;
      case 'delete': state.records = state.records.filter(r => r.id !== record.id); break;
      default: throw fail('不支持的发布操作');
    }
    if (oldSnapshotId && ['delete', 'update'].includes(input.action)) state.cleanupPending = [...new Set([...(state.cleanupPending || []), oldSnapshotId])];
    state.revision++;
    state.operations[input.operationId] = { fingerprint, completedAt: Date.now() };
    await save();
    visibleState = state;
    if (record && ['pause', 'password', 'delete'].includes(input.action)) invalidate(record.id);
    if (input.action === 'stop' || (['pause', 'delete'].includes(input.action) && !state.records.some(r => r.enabled))) await stop();
    if (['start', 'publish', 'resume'].includes(input.action)) {
      const wasRunning = Boolean(publicServer?.listening);
      try { await start(); await save(); }
      catch (error) { if (!wasRunning) await stop(); serviceError = `内容和设置已保存，服务未能开启：${error.message}`; }
    }
    if (state.cleanupPending?.length) {
      const remaining = [];
      for (const snapshotId of state.cleanupPending) {
        try {
          if (!idOK(snapshotId) || state.records.some(r => r.snapshotId === snapshotId)) throw fail('副本仍在使用，不能清理');
          await rm(join(root, 'snapshots', snapshotId), { recursive: true, force: true });
        } catch { remaining.push(snapshotId); }
      }
      state.cleanupPending = remaining;
      await save().catch(() => {}); // Repeating deletion of an already absent old snapshot is safe.
      if (remaining.length) serviceError = '发布已生效，旧副本清理未完成，请在项目中心重试清理';
    }
    return { ...summary(), operationId: input.operationId };
  }
  const control = createServer(async (req, res) => {
    if (!equal(req.headers.authorization, `Bearer ${controlToken}`)) return json(res, 403, { error: '本机管理凭据无效' });
    try {
      const input = await body(req);
      if (req.url !== '/command') await queue;
      if (req.url === '/status') return json(res, 200, summary());
      if (req.url === '/secret') { const record = state.records.find(r => r.id === input.id); if (!record) throw fail('发布不存在', 404); return json(res, 200, { password: record.password }); }
      if (req.url === '/operation') return json(res, 200, { completed: Boolean(state.operations[input.operationId]), fingerprint: state.operations[input.operationId]?.fingerprint, ...summary() });
      if (req.url !== '/command') throw fail('接口不存在', 404);
      const run = queue.then(async () => {
        const before = state;
        state = structuredClone(state);
        try { return await command(input); } catch (error) { state = before; throw error; }
      }); queue = run.catch(() => {});
      return json(res, 200, await run);
    } catch (error) { json(res, error.statusCode || 400, { error: error.message }); }
  });
  await new Promise((resolveListen, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', resolveListen); });
  await writeJson(join(root, 'daemon.json'), { port: control.address().port, token: controlToken, pid: process.pid });
  return { control, status: summary, stop, close: async () => { await stop(); control.closeAllConnections(); await new Promise(resolveClose => control.close(resolveClose)); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2]);
  const lock = await acquirePublicationLock(root);
  if (!lock) process.exit(0);
  try {
    const daemon = await startPublicationDaemon(root);
    const close = async () => { await daemon.close(); await lock.release(); process.exit(0); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  } catch (error) { await lock.release(); console.error(error.message); process.exit(1); }
}
