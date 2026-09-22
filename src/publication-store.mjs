import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
export const publicationRoot = statePath => join(dirname(statePath), 'publications');
export const digest = data => createHash('sha256').update(data).digest('hex');
export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
}
export async function writeSnapshot(root, snapshot) {
  const id = randomUUID();
  const directory = join(root, 'snapshots', id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = [];
  for (const entry of snapshot.entries) {
    const path = join(directory, entry.path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, entry.content, { mode: 0o600 });
    files.push({ path: entry.path, sha256: digest(entry.content), bytes: entry.content.length });
  }
  await writeJson(join(directory, 'manifest.json'), { schemaVersion: 1, id, generatedAt: snapshot.generatedAt, files });
  return id;
}
