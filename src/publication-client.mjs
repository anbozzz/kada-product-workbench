import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile } from 'node:fs/promises';
import { publicationRoot, readJson } from './publication-store.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(root, action, input = {}) {
  const endpoint = await readJson(join(root, 'daemon.json'));
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/${action}`, {
    method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { statusCode: response.status });
  return result;
}
export async function publicationRequest(statePath, action, input = {}, { start = true } = {}) {
  const root = publicationRoot(statePath);
  try { return await connect(root, action, input); }
  catch (error) {
    if (error.statusCode) throw error;
    // A timed-out mutation may have committed. Never submit a second identity.
    if (error.name === 'TimeoutError') throw new Error('操作结果尚未核实，请刷新发布状态后重试');
    if (!start) {
      const saved = await readJson(join(root, 'registry.json'), { records: [], revision: 0 });
      const { networkInterfaces } = await import('node:os');
      const addresses = [...new Set(Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address))];
      return { running: false, records: saved.records.map(({ password, passwordHash, salt, ...record }) => ({ ...record, available: false })), addresses, port: null, revision: saved.revision, cleanupPending: (saved.cleanupPending || []).length };
    }
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const log = await open(join(root, 'daemon.log'), 'a', 0o600);
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'publication-daemon.mjs'), root], {
    detached: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env },
  });
  child.on('error', () => {}); child.unref(); await log.close();
  for (let attempt = 0; attempt < 50; attempt++) {
    await delay(100);
    try { return await connect(root, action, input); } catch (error) { if (error.statusCode) throw error; }
  }
  const logText = await readFile(join(root, 'daemon.log'), 'utf8').catch(() => '');
  throw new Error(`发布后台启动失败，请重新开启。${logText.includes('EPERM') ? '当前运行环境不允许启动后台进程。' : ''}`);
}
