import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const PLUGIN_NAME = 'interactive-product-spec';
export const MARKETPLACE_NAME = 'interactive-product-spec-local';
export const PLUGIN_PREFIX = `plugins/${PLUGIN_NAME}/`;
export const sha256 = data => createHash('sha256').update(data).digest('hex');

// No symlinks, absolute paths, traversal, or machine-specific path separators in releases.
export async function inventory(root, prefix = '') {
  const files = {};
  for (const entry of (await readdir(join(root, prefix))).sort()) {
    if (entry.includes('\\') || entry.includes('\n') || entry.includes('\r')) throw new Error(`不安全的文件名：${entry}`);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink()) throw new Error(`发布包不允许符号链接：${relative}`);
    if (info.isDirectory()) Object.assign(files, await inventory(root, relative));
    else if (info.isFile()) {
      if (relative !== 'release.json') files[relative] = sha256(await readFile(join(root, relative)));
    } else throw new Error(`发布包不允许特殊文件：${relative}`);
  }
  return files;
}

export async function verifyRelease(root) {
  if (!(await lstat(join(root, 'release.json'))).isFile()) throw new Error('release.json 必须是普通文件');
  const release = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
  if (release.schemaVersion !== 1 || release.plugin !== PLUGIN_NAME || release.marketplace !== MARKETPLACE_NAME
    || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(release.version || '')
    || !release.files || typeof release.files !== 'object' || Array.isArray(release.files)) {
    throw new Error('发布清单格式不受支持');
  }
  for (const [path, digest] of Object.entries(release.files)) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')
      || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`发布清单路径或校验值无效：${path}`);
  }
  const actual = await inventory(root);
  const paths = [...new Set([...Object.keys(actual), ...Object.keys(release.files)])].sort();
  for (const path of paths) {
    if (actual[path] !== release.files[path]) throw new Error(`发布包校验失败：${path}`);
  }
  const manifest = JSON.parse(await readFile(join(root, PLUGIN_PREFIX, '.codex-plugin/plugin.json'), 'utf8'));
  const market = JSON.parse(await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
  if (manifest.name !== release.plugin || manifest.version !== release.version
    || market.name !== release.marketplace || market.plugins?.length !== 1
    || market.plugins[0].name !== release.plugin || market.plugins[0].source?.source !== 'local'
    || market.plugins[0].source?.path !== `./plugins/${PLUGIN_NAME}`) throw new Error('发布清单与插件或来源不一致');
  for (const required of ['install.mjs', 'INSTALL.md', `${PLUGIN_PREFIX}cli.mjs`, `${PLUGIN_PREFIX}web/index.html`]) {
    if (!release.files[required]) throw new Error(`发布包缺少必要文件：${required}`);
  }
  return release;
}
