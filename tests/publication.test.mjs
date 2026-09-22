import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, rename, mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startPublicationDaemon } from '../src/publication-daemon.mjs';
import { acquirePublicationLock } from '../src/publication-lock.mjs';
import { writeSnapshot, writeJson } from '../src/publication-store.mjs';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ips-publication-test-'));
  const daemon = await startPublicationDaemon(root, { listenHost: '127.0.0.1', controlToken: 'test-token' });
  t.after(async () => { await daemon.close(); await rm(root, { recursive: true, force: true }); });
  const command = async (action, fields = {}, revision = daemon.status().revision) => {
    const response = await fetch(`http://127.0.0.1:${daemon.control.address().port}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ action, expectedRevision: revision, operationId: randomUUID(), ...fields }) });
    const value = await response.json(); return { response, value };
  };
  const snapshot = async text => writeSnapshot(root, { generatedAt: new Date().toISOString(), entries: [
    { path: 'web/index.html', content: Buffer.from('<html><head><script src="/studio-assets/app.js"></script></head><body>viewer</body></html>') },
    { path: 'web/app.js', content: Buffer.from('window.loaded = true') },
    { path: 'data/config.json', content: Buffer.from(JSON.stringify({ targetUrl: '/target/index.html', canSave: false })) },
    { path: 'pages/index.html', content: Buffer.from(text) },
    { path: 'pages/secret.txt', content: Buffer.from('protected') },
  ] });
  const publish = async (name, password = '0386') => {
    const snapshotId = await snapshot(name);
    const { response, value } = await command('publish', { projectKey: `/test/${name}`, name, project: { id: name }, snapshotId, password, generatedAt: new Date().toISOString() });
    assert.equal(response.status, 200, JSON.stringify(value));
    return value.records.find(r => r.name === name);
  };
  const base = () => `http://127.0.0.1:${daemon.status().port}`;
  const auth = async (record, password = '0386') => {
    const res = await fetch(`${base()}/p/${record.id}/auth`, { method: 'POST', body: JSON.stringify({ password }) });
    return { res, cookie: res.headers.get('set-cookie')?.split(';')[0], value: await res.json() };
  };
  return { root, daemon, command, snapshot, publish, base, auth };
}
test('多项目密码和资源隔离，暂停与改密只影响目标项目，错误密码不锁定', async t => {
  const f = await fixture(t); const a = await f.publish('A'); const b = await f.publish('B', '1234');
  assert.equal(f.daemon.status().records.some(r => 'password' in r), false);
  const asset = `/p/${a.id}/s/${a.snapshotId}/target/secret.txt`;
  assert.equal((await fetch(f.base() + asset)).status, 401);
  for (let n = 0; n < 8; n++) assert.equal((await f.auth(a, '0000')).res.status, 401);
  const aa = await f.auth(a); assert.equal(aa.res.status, 200);
  assert.equal(await (await fetch(f.base() + asset, { headers: { cookie: aa.cookie } })).text(), 'protected');
  assert.equal((await fetch(`${f.base()}/p/${b.id}/s/${b.snapshotId}/target/secret.txt`, { headers: { cookie: aa.cookie } })).status, 401);
  assert.equal((await fetch(`${f.base()}/api/publications`)).status, 404);
  assert.equal((await fetch(`${f.base()}/p/${a.id}/s/${a.snapshotId}/api/project/scan`, { method: 'POST', headers: { cookie: aa.cookie } })).status, 403);
  const bb = await f.auth(b, '1234');
  await f.command('password', { id: a.id, password: '0007' });
  assert.equal((await fetch(f.base() + asset, { headers: { cookie: aa.cookie } })).status, 401);
  assert.equal((await f.auth(a, '0386')).res.status, 401); assert.equal((await f.auth(a, '0007')).res.status, 200);
  await f.command('pause', { id: a.id });
  assert.equal((await f.auth(a, '0007')).res.status, 404);
  assert.equal((await fetch(`${f.base()}/p/${b.id}/version`, { headers: { cookie: bb.cookie } })).status, 200);
});
test('全局关启保留意愿；快照更新不混读；旧链接删除后失效', async t => {
  const f = await fixture(t); const a = await f.publish('A'); const b = await f.publish('B'); const aa = await f.auth(a);
  const next = await f.snapshot('A2'); await f.command('update', { id: a.id, snapshotId: next, generatedAt: new Date().toISOString() });
  assert.equal((await fetch(f.base() + aa.value.url + 'target/index.html', { headers: { cookie: aa.cookie } })).status, 409);
  const fresh = await f.auth(a); assert.match(fresh.value.url, new RegExp(next));
  assert.equal(await (await fetch(f.base() + fresh.value.url + 'target/index.html', { headers: { cookie: fresh.cookie } })).text(), 'A2');
  await f.command('pause', { id: b.id }); await f.command('stop'); assert.equal(f.daemon.status().running, false);
  assert.equal(f.daemon.status().records.find(r => r.id === a.id).enabled, true);
  await f.command('start'); assert.equal(f.daemon.status().records.find(r => r.id === a.id).available, true);
  assert.equal(f.daemon.status().records.find(r => r.id === b.id).available, false);
  await f.command('delete', { id: a.id }); assert.equal(f.daemon.status().running, false);
  assert.equal(f.daemon.status().records.length, 1);
});
test('过期状态与重复操作保护；快照损坏不替换旧版；重启默认不发布', async t => {
  const f = await fixture(t); const a = await f.publish('A');
  assert.equal((await f.command('pause', { id: a.id }, 0)).response.status, 409);
  const op = randomUUID(), revision = f.daemon.status().revision;
  assert.equal((await f.command('password', { id: a.id, password: '0123', operationId: op }, revision)).response.status, 200);
  assert.equal((await f.command('password', { id: a.id, password: '0123', operationId: op }, revision)).response.status, 200);
  assert.equal((await f.command('password', { id: a.id, password: '0124', operationId: op }, revision)).response.status, 409);
  assert.equal((await f.command('update', { id: a.id, snapshotId: randomUUID() })).response.status, 400);
  assert.equal(f.daemon.status().records[0].snapshotId, a.snapshotId);
  await f.daemon.stop();
  const root2 = await mkdtemp(join(tmpdir(), 'ips-publication-restart-'));
  // Re-open the same registry after shutting the original control listener.
  await f.daemon.close();
  const daemon2 = await startPublicationDaemon(f.root, { listenHost: '127.0.0.1' });
  assert.equal(daemon2.status().running, false); assert.equal(daemon2.status().records[0].enabled, true);
  await daemon2.close(); await rm(root2, { recursive: true });
  const state = JSON.parse(await readFile(join(f.root, 'registry.json'), 'utf8'));
  assert.equal(state.records[0].password, '0123');
});

test('注册表保存失败不能开启监听或改变项目密码', async t => {
  const f = await fixture(t); const a = await f.publish('A'); await f.command('stop');
  const file = join(f.root, 'registry.json'); await rename(file, file + '.backup'); await mkdir(file);
  assert.equal((await f.command('start')).response.status, 400);
  assert.equal(f.daemon.status().running, false);
  assert.equal((await f.command('password', { id: a.id, password: '7777' })).response.status, 400);
  await rm(file, { recursive: true }); await rename(file + '.backup', file);
  await f.command('start'); assert.equal((await f.auth(a, '0386')).res.status, 200);
});

test('遗留锁文件不代表占用，两个同时启动者只能取得一个操作系统锁', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ips-pub-lock-race-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'publication.lock'), 'stale PID 123');
  const results = await Promise.all([acquirePublicationLock(root), acquirePublicationLock(root)]);
  assert.equal(results.filter(Boolean).length, 1);
  await results.find(Boolean).release();
  const again = await acquirePublicationLock(root); assert.ok(again); await again.release();
});
test('锁持有进程异常退出后由操作系统释放，无需删除或回收磁盘锁', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ips-pub-lock-crash-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { spawnSync } = await import('node:child_process');
  const moduleUrl = new URL('../src/publication-lock.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {acquirePublicationLock} from ${JSON.stringify(moduleUrl)}; const held=await acquirePublicationLock(${JSON.stringify(root)}); if(!held)process.exit(2); process.exit(7);`]);
  assert.equal(child.status, 7);
  const recovered = await acquirePublicationLock(root); assert.ok(recovered); await recovered.release();
});
