import { realpath, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectReviewSnapshot } from './review-package.mjs';
import { createWorkbenchConfig } from './review-session.mjs';
import { publicationRoot, writeSnapshot, digest, readJson, writeJson } from './publication-store.mjs';
import { publicationRequest } from './publication-client.mjs';
export function createPublicationService({ statePath, appRoot }) {
  const token = randomUUID();
  const inFlight = new Map();
  return { token, async handle({ request, response, url, active, port }) {
    if (!url.pathname.startsWith('/api/publications')) return false;
    const send = (code, value) => { response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const host = request.headers.host;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) { send(403, { error: '发布管理仅限本机' }); return true; }
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || (request.headers.origin && request.headers.origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') { send(403, { error: '发布管理只接受本机工作台请求' }); return true; }
      if (url.pathname === '/api/publications' && request.method === 'GET') { send(200, { ...await publicationRequest(statePath, 'status', {}, { start: false }), token }); return true; }
      if (request.headers['x-publication-token'] !== token) { send(403, { error: '请刷新本机发布管理后重试' }); return true; }
      let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 65536) throw new Error('请求过大'); }
      const input = text ? JSON.parse(text) : {};
      if (url.pathname === '/api/publications/secret') { send(200, await publicationRequest(statePath, 'secret', { id: input.id })); return true; }
      if (url.pathname === '/api/publications/operation') {
        if (!/^[a-f0-9-]{36}$/.test(input.operationId || '')) throw new Error('操作身份无效');
        const saved = await readJson(join(publicationRoot(statePath), 'requests', input.operationId + '.json'), null);
        let result = await publicationRequest(statePath, 'operation', { operationId: input.operationId });
        let otherProcess = false;
        if (saved?.ownerPid && saved.ownerPid !== process.pid && saved.status === 'preparing') { try { process.kill(saved.ownerPid, 0); otherProcess = true; } catch {} }
        if (!result.completed && !inFlight.has(input.operationId) && !otherProcess && saved?.command) {
          try { await publicationRequest(statePath, 'command', saved.command); result = await publicationRequest(statePath, 'operation', { operationId: input.operationId }); }
          catch (error) { if (!error.statusCode || error.statusCode >= 500) throw Object.assign(error, { statusCode: 504 }); saved.error = error.message; }
        }
        send(200, { ...result, pending: inFlight.has(input.operationId) || otherProcess, retryable: !result.completed && !inFlight.has(input.operationId) && !otherProcess, error: saved?.error }); return true;
      }
      if (url.pathname !== '/api/publications/commands' || request.method !== 'POST') { send(404, { error: '发布接口不存在' }); return true; }
      if (!/^[a-f0-9-]{36}$/.test(input.operationId || '')) throw new Error('操作身份无效');
      const requestFingerprint = digest(JSON.stringify(input));
      const requestPath = join(publicationRoot(statePath), 'requests', input.operationId + '.json');
      const previous = await readJson(requestPath, null);
      if (previous && previous.requestFingerprint !== requestFingerprint) throw Object.assign(new Error('操作身份已被其他请求使用'), { statusCode: 409 });
      const done = await publicationRequest(statePath, 'operation', { operationId: input.operationId });
      if (done.completed) {
        if (done.fingerprint !== requestFingerprint) throw Object.assign(new Error('操作身份已被其他请求使用'), { statusCode: 409 });
        send(200, done); return true;
      }
      if (inFlight.has(input.operationId)) { send(202, { pending: true, operationId: input.operationId }); return true; }
      inFlight.set(input.operationId, true);
      const command = previous?.command || { action: input.action, id: input.id, operationId: input.operationId, expectedRevision: input.expectedRevision, requestFingerprint };
      if (['publish', 'password'].includes(command.action)) command.password = input.password;
      let staged, dispatched = false;
      try {
        await writeJson(requestPath, { requestFingerprint, ownerPid: process.pid, status: 'preparing', command: previous?.command });
        if (!previous?.command && ['publish', 'update'].includes(command.action)) {
          if (!active?.project?.projectPath || active.target?.type !== 'file') throw new Error('请先从项目中心确认 Project 和 HTML 页面包');
          const config = createWorkbenchConfig(active, false);
          if (config.draftChangeCount) throw new Error('请先完成或放弃未提交的 Spec 草稿');
          const projectKey = await realpath(active.project.projectPath);
          const current = await publicationRequest(statePath, 'status');
          if (current.revision !== input.expectedRevision) throw Object.assign(new Error('发布状态已变化，请刷新后重试'), { statusCode: 409 });
          if (command.action === 'update' && !current.records.some(r => r.id === command.id && r.projectKey === projectKey)) throw new Error('发布记录不属于当前项目');
          const files = [active.sourceSpecPath, active.specPath, active.mapPath, active.prdDocument?.path, active.prdMapPath].filter(Boolean);
          const before = await Promise.all(files.map(async path => digest(await readFile(path))));
          for (const [path, revision] of [[active.sourceSpecPath, config.sourceSpecRevision], [active.prdDocument?.path, config.prd?.revision], [active.mapPath, config.mapRevision], [active.prdMapPath, config.prdMapRevision]]) {
            if (path && revision && digest(await readFile(path)) !== revision) throw new Error('文档已变化，请在工作台加载新版后再发布');
          }
          const snapshot = await collectReviewSnapshot({ appRoot, active, config, excludeRoots: [dirname(statePath)] });
          const after = await Promise.all(files.map(async path => digest(await readFile(path))));
          if (before.some((hash, i) => hash !== after[i])) throw new Error('来源在生成时发生变化，请重新读取后发布');
          staged = await writeSnapshot(publicationRoot(statePath), snapshot);
          Object.assign(command, { snapshotId: staged, generatedAt: snapshot.generatedAt, projectKey, project: active.project, name: active.project.name || config.productSpec.product.title });
        }
        await writeJson(requestPath, { requestFingerprint, ownerPid: process.pid, status: 'prepared', command });
        dispatched = true;
        const result = await publicationRequest(statePath, 'command', command);
        await writeJson(requestPath, { requestFingerprint, status: 'completed' });
        send(200, result);
      } catch (error) {
        // Do not discard a snapshot on an uncertain transport result.
        if (staged && error.statusCode) await rm(join(publicationRoot(statePath), 'snapshots', staged), { recursive: true, force: true });
        if (!dispatched && !error.statusCode) error.statusCode = 400;
        if (error.statusCode && error.statusCode < 500) await writeJson(requestPath, { requestFingerprint, status: 'failed', error: error.message });
        else error.statusCode = 504;
        throw error;
      } finally { inFlight.delete(input.operationId); }
    } catch (error) { send(error.statusCode || 400, { error: error.message, code: error.statusCode === 504 ? 'OPERATION_UNKNOWN' : undefined }); }
    return true;
  } };
}
