import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJson } from './publication-store.mjs';
import { acquirePublicationLock } from './publication-lock.mjs';

const rootFor = statePath => join(dirname(statePath), 'workbench-instances');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const validRecord = record => record?.protocol === 1 && /^[a-f0-9-]{36}$/.test(record.id) && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(record.url);
export async function runtimeRecords(statePath) {
  const root = rootFor(statePath);
  const names = await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return (await Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(async name => {
    try { const record = JSON.parse(await readFile(join(root, name), 'utf8')); return validRecord(record) ? record : null; } catch { return null; }
  }))).filter(Boolean);
}
export async function callRuntime(record, action = 'health', input) {
  const response = await fetch(record.url + 'api/runtime/' + action, { method: input ? 'POST' : 'GET', headers: { 'x-runtime-token': record.token, 'content-type': 'application/json' }, body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(3000) });
  const value = await response.json();
  if (!response.ok) throw fail(value.error || '工作台请求失败', response.status);
  if (value.id !== record.id || value.protocol !== 1) throw fail('工作台身份已变化，请刷新');
  return value;
}
export async function listRuntimes(statePath) {
  return await Promise.all((await runtimeRecords(statePath)).map(async record => {
    try { return { ...await callRuntime(record), url: record.url }; }
    catch { return { id: record.id, protocol: 1, url: record.url, name: record.name, state: 'unreachable', kind: record.kind }; }
  }));
}
export async function startManagedWorkbench(options, start) {
  if (!options.managedLaunch || options.gate) return await start();
  let lock;
  for (let i = 0; i < 100 && !lock; i++) { lock = await acquirePublicationLock(join(rootFor(options.statePath), 'launch')); if (!lock) await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!lock) throw fail('另一个工作台正在启动，请稍后重试');
  try {
    if (options.runtimeKey) {
      for (const record of await runtimeRecords(options.statePath)) {
        try {
          const value = await callRuntime(record);
          if ((value.key === options.runtimeKey || options.runtimeKey === '["center"]') && value.kind === 'normal' && !value.closing) return { url: record.url, reused: true, stop: async () => {}, statePath: options.statePath };
        } catch { /* An unreachable instance must never be reused. */ }
      }
    }
    return await start();
  } finally { await lock.release(); }
}
export async function createWorkbenchRuntime({ statePath, url, key, kind, describe, close }) {
  const id = randomUUID(), token = randomUUID(), clients = new Map();
  const file = join(rootFor(statePath), id + '.json');
  let closing = null, stopped = false;
  const health = () => ({ protocol: 1, id, key: describe().key ?? key, kind, ...describe(), closing: closing?.id || null });
  await writeJson(file, { protocol: 1, id, token, url, kind, name: describe().name });
  const dispose = async () => { stopped = true; await rm(file, { force: true }); };
  const handle = async (request, response, path) => {
    if (!path.startsWith('/api/runtime')) return false;
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const host = new URL(url).host;
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || request.headers.host !== host || request.headers.origin && request.headers.origin !== `http://${host}` || request.headers['sec-fetch-site'] === 'cross-site') throw fail('工作台管理仅接受本机原入口请求', 403);
      if (path === '/api/runtime' && request.method === 'GET') { send(200, { ...health(), token }); return true; }
      if (request.headers['x-runtime-token'] !== token) throw fail('请刷新工作台管理后重试', 403);
      let input = {};
      if (request.method === 'POST') { let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 8192) throw fail('请求过大', 413); } input = JSON.parse(text || '{}'); }
      if (closing && Date.now() - closing.at > 10000) closing = null;
      if (path === '/api/runtime/health' && request.method === 'GET') send(200, health());
      else if (path === '/api/runtime/list' && request.method === 'GET') send(200, { ...health(), instances: await listRuntimes(statePath) });
      else if (path === '/api/runtime/client' && request.method === 'POST') {
        if (!/^[a-f0-9-]{36}$/.test(input.clientId || '')) throw fail('标签页身份无效', 400);
        if (input.departed && !input.dirty) clients.delete(input.clientId);
        else clients.set(input.clientId, { dirty: input.dirty !== false, ack: input.ack, at: Date.now() });
        send(200, health());
      } else if (path === '/api/runtime/manage' && request.method === 'POST') {
        if (!['prepare','commit','cancel','forget'].includes(input.action)) throw fail('未知管理动作',400);
        const record = (await runtimeRecords(statePath)).find(item => item.id === input.id);
        if (!record) throw fail('实例已关闭，请刷新');
        if (input.action === 'forget') {
          let alive = false; try { await callRuntime(record); alive = true; } catch {}
          if (alive) throw fail('运行中的实例不能移除记录');
          await rm(join(rootFor(statePath), record.id + '.json'), { force: true }); send(200, health());
        } else { const result = await callRuntime(record, input.action, { challenge: input.challenge }); send(200, { ...health(), target: result }); }
      } else if (path === '/api/runtime/prepare' && request.method === 'POST') {
        if (closing) throw fail('已有关闭检查正在进行，请稍后重试');
        if (describe().blockReason) throw fail(describe().blockReason);
        closing = { id: randomUUID(), at: Date.now() }; send(200, health());
      } else if (path === '/api/runtime/cancel' && request.method === 'POST') {
        if (closing?.id === input.challenge) closing = null; send(200, health());
      } else if (path === '/api/runtime/commit' && request.method === 'POST') {
        if (!closing || closing.id !== input.challenge) throw fail('关闭检查已过期，请重试');
        const reason = describe().blockReason || ([...clients.values()].some(client => client.dirty) ? '存在未保存内容，请打开该工作台保存或取消编辑后重试' : [...clients.values()].some(client => client.ack !== closing.id || Date.now() - client.at > 4000) ? '有标签页尚未确认，请打开该工作台后重试' : '');
        if (reason) { closing = null; throw fail(reason); }
        send(200, { ...health(), state: 'closed' });
        setTimeout(() => { if (!stopped) void close(); }, 150);
      } else throw fail('管理接口不存在',404);
    } catch (error) { send(error.status || 400, { error: error.message }); }
    return true;
  };
  return { handle, dispose, id, token, get closing() { return Boolean(closing && Date.now() - closing.at <= 10000); } };
}
