import { mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

// Lifetime ownership belongs to the OS, not a PID or a recoverable lock file.
// On BSD/Linux the helper locks fd 3, which refers to the same open file
// description held by this Node process. A crash releases it automatically.
export async function acquirePublicationLock(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  if (process.platform === 'win32') {
    const name = `\\\\.\\pipe\\ips-publication-${createHash('sha256').update(root.toLowerCase()).digest('hex')}`;
    const server = createServer(socket => socket.destroy());
    try { await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(name, resolveListen); }); }
    catch (error) { if (error.code === 'EADDRINUSE') return null; throw error; }
    return { release: () => new Promise(resolveClose => server.close(resolveClose)) };
  }
  const handle = await open(join(root, 'publication.lock'), 'a+', 0o600);
  const bsd = process.platform === 'darwin' || process.platform === 'freebsd';
  const result = spawnSync(bsd ? '/usr/bin/lockf' : 'flock', bsd ? ['-s', '-t', '0', '3'] : ['-n', '3'], { stdio: ['ignore', 'ignore', 'pipe', handle.fd] });
  if (result.error || result.status !== 0) {
    await handle.close();
    if (result.status === (bsd ? 75 : 1)) return null;
    throw new Error(`无法取得本机发布锁：${result.error?.message || result.stderr?.toString() || result.status}`);
  }
  return { release: () => handle.close() };
}
