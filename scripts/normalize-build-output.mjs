import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..', 'web');
await copyFile(
  resolve(import.meta.dirname, '..', 'ui/src/components/beautiful-ui/LICENSE'),
  resolve(webRoot, 'LICENSE.beautiful-ui.txt'),
);
const files = [resolve(webRoot, 'index.html')];
for (const name of await readdir(resolve(webRoot, 'assets'))) {
  if (/\.(?:css|js)$/.test(name)) files.push(resolve(webRoot, 'assets', name));
}

for (const path of files) {
  const source = await readFile(path, 'utf8');
  const normalized = source.replace(/[ \t]+(?=\r?\n)/g, '');
  if (normalized !== source) await writeFile(path, normalized, 'utf8');
}
