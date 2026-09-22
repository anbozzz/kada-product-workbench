import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { documentFixture } from './fixtures/document-updates.mjs';
import { startStudio } from '../src/server.mjs';
test('本机发布API端到端去重，重复提交不重新发布或构建快照，管理来源受限', async t => {
  const f = await documentFixture(), statePath = join(f.directory, 'state/projects.json');
  const studio = await startStudio({ appRoot: resolve(import.meta.dirname, '..'), host: '127.0.0.1', port: 0, statePath });
  t.after(async () => { await studio.stop(); try { const d = JSON.parse(await readFile(join(f.directory, 'state/publications/daemon.json'), 'utf8')); process.kill(d.pid, 'SIGTERM'); } catch {} await rm(f.directory, { recursive: true, force: true }); });
  await fetch(studio.url + 'api/project/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.project) });
  const status = await (await fetch(studio.url + 'api/publications')).json();
  const input = { operationId: randomUUID(), action: 'publish', password: '0386', expectedRevision: status.revision };
  const command = body => fetch(studio.url + 'api/publications/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-publication-token': status.token }, body: JSON.stringify(body) });
  const first = await command(input); assert.equal(first.status, 200, await first.clone().text()); const a = await first.json();
  const second = await command(input); assert.equal(second.status, 200); const b = await second.json();
  assert.equal(a.records[0].snapshotId, b.records[0].snapshotId); assert.equal(b.records.length, 1); assert.equal(a.revision, b.revision);
  const probe = await fetch(studio.url + 'api/publications/operation', { method: 'POST', headers: { 'x-publication-token': status.token }, body: JSON.stringify({ operationId: input.operationId }) }); assert.equal((await probe.json()).completed, true);
  assert.equal((await command({ ...input, password: '1256' })).status, 409);
  assert.equal((await fetch(studio.url + 'api/publications', { headers: { origin: 'http://example.invalid' } })).status, 403);
  assert.equal((await fetch(studio.url + 'api/publications/secret', { method: 'POST', body: '{}' })).status, 403);
  const manifest = JSON.parse(await readFile(join(f.directory, 'state/publications/snapshots', a.records[0].snapshotId, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.some(file => file.path.startsWith('pages/state/')), false);
  for (const [name, original] of [['PRD.md', f.prdPath], ['Spec.md', f.sourceSpecPath]]) {
    assert.equal(await readFile(join(f.directory, 'state/publications/snapshots', a.records[0].snapshotId, 'documents', name), 'utf8'), await readFile(original, 'utf8'));
  }

});
