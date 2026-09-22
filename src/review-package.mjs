import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, open, readFile, readdir, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const PAGE_RUNTIME_EXTENSIONS = new Set([
  '.avif', '.bmp', '.css', '.csv', '.eot', '.gif', '.htm', '.html', '.ico',
  '.jpeg', '.jpg', '.js', '.json', '.mjs', '.mp3', '.mp4', '.ogg', '.otf',
  '.pdf', '.png', '.svg', '.ttf', '.txt', '.wasm', '.wav', '.webm', '.webmanifest',
  '.webp', '.woff', '.woff2', '.xml',
]);
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', '.turbo', '.vite', 'coverage', 'node_modules',
]);
const EXCLUDED_PAGE_FILENAMES = new Set([
  'prd-map.json', 'product.spec.json', 'spec-map.json',
]);
const MAX_ZIP_VALUE = 0xffffffff;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = buffer => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const dosTimestamp = date => {
  const safeYear = Math.max(1980, date.getFullYear());
  return {
    date: ((safeYear - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
};

const normalizeArchivePath = value => {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`评审包条目路径不合法：${value}`);
  }
  return normalized;
};

class ZipWriter {
  constructor(handle) {
    this.handle = handle;
    this.offset = 0;
    this.entries = [];
  }

  async write(buffer) {
    await this.handle.write(buffer, 0, buffer.length, this.offset);
    this.offset += buffer.length;
  }

  async addBuffer(name, source, { mode = 0o100644, modifiedAt = new Date() } = {}) {
    const archivePath = normalizeArchivePath(name);
    const nameBuffer = Buffer.from(archivePath, 'utf8');
    const content = Buffer.isBuffer(source) ? source : Buffer.from(source);
    const compressed = deflateRawSync(content, { level: 9 });
    const useDeflate = compressed.length < content.length;
    const body = useDeflate ? compressed : content;
    if (content.length > MAX_ZIP_VALUE || body.length > MAX_ZIP_VALUE || this.offset > MAX_ZIP_VALUE) {
      throw new Error('评审包超过 ZIP v1 的 4GB 边界，请缩小页面包后重试');
    }
    const checksum = crc32(content);
    const timestamp = dosTimestamp(modifiedAt);
    const localOffset = this.offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(timestamp.time, 10);
    header.writeUInt16LE(timestamp.date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    await this.write(header);
    await this.write(nameBuffer);
    await this.write(body);
    this.entries.push({
      nameBuffer,
      checksum,
      compressedSize: body.length,
      size: content.length,
      method: useDeflate ? 8 : 0,
      timestamp,
      localOffset,
      mode,
    });
    return {
      path: archivePath,
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  async addFile(name, path) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`评审包来源不是文件：${path}`);
    return await this.addBuffer(name, await readFile(path), {
      mode: info.mode,
      modifiedAt: info.mtime,
    });
  }

  async close() {
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(0x0314, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.timestamp.time, 12);
      header.writeUInt16LE(entry.timestamp.date, 14);
      header.writeUInt32LE(entry.checksum, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.nameBuffer.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE((entry.mode & 0xffff) * 0x10000, 38);
      header.writeUInt32LE(entry.localOffset, 42);
      await this.write(header);
      await this.write(entry.nameBuffer);
    }
    const centralSize = this.offset - centralOffset;
    if (this.entries.length > 0xffff || centralOffset > MAX_ZIP_VALUE || centralSize > MAX_ZIP_VALUE) {
      throw new Error('评审包目录超过 ZIP v1 边界，请缩小页面包后重试');
    }
    const footer = Buffer.alloc(22);
    footer.writeUInt32LE(0x06054b50, 0);
    footer.writeUInt16LE(0, 4);
    footer.writeUInt16LE(0, 6);
    footer.writeUInt16LE(this.entries.length, 8);
    footer.writeUInt16LE(this.entries.length, 10);
    footer.writeUInt32LE(centralSize, 12);
    footer.writeUInt32LE(centralOffset, 16);
    footer.writeUInt16LE(0, 20);
    await this.write(footer);
    await this.handle.close();
  }
}

const safeFilenamePart = value => String(value || 'product')
  .normalize('NFKC')
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 80) || 'product';

const listFiles = async (root, { pageRuntimeOnly = false, excludeRoots = [] } = {}) => {
  const files = [];
  const visit = async directory => {
    if (excludeRoots.some(excluded => directory === excluded || directory.startsWith(excluded + sep))) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        await visit(path);
        continue;
      }
      if (!entry.isFile() || entry.name === '.DS_Store') continue;
      if (pageRuntimeOnly) {
        const lowerName = entry.name.toLowerCase();
        if (!PAGE_RUNTIME_EXTENSIONS.has(extname(lowerName))) continue;
        if (EXCLUDED_PAGE_FILENAMES.has(lowerName) || lowerName.endsWith('.spec.json')) continue;
      }
      files.push(path);
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
};

const relativeArchivePath = (prefix, root, path) => {
  const value = relative(root, path);
  if (!value || value.startsWith(`..${sep}`) || value === '..') {
    throw new Error(`评审包来源越界：${path}`);
  }
  return `${prefix}/${value.replaceAll(sep, '/')}`;
};

const sanitizeSourcePath = value => {
  const source = String(value || '').trim();
  if (!source) return source;
  if (source.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(source)) return basename(source);
  return source;
};

export const makeReadOnlyReviewConfig = (config, entryName, generatedAt) => {
  const targetSource = `pages/${entryName}`;
  const productSpec = structuredClone(config.productSpec);
  if (Array.isArray(productSpec.product?.sourceRefs)) {
    productSpec.product.sourceRefs = productSpec.product.sourceRefs.map(sanitizeSourcePath);
  }
  if (productSpec.product?.prdSource?.path) {
    productSpec.product.prdSource.path = sanitizeSourcePath(productSpec.product.prdSource.path);
  }
  const specMap = structuredClone(config.specMap);
  specMap.targetSource = targetSource;
  specMap.items = specMap.items.map(item => ({
    ...item,
    target: { ...item.target, source: targetSource },
  }));
  const prd = config.prd ? { ...structuredClone(config.prd), path: '' } : null;
  const prdMap = config.prdMap ? structuredClone(config.prdMap) : null;
  if (prdMap) {
    prdMap.targetSource = targetSource;
    prdMap.prd.path = sanitizeSourcePath(prdMap.prd.path);
  }
  const reviewBaseline = config.reviewBaseline
    ? {
        ...structuredClone(config.reviewBaseline),
        mode: 'review',
        target: {
          ...structuredClone(config.reviewBaseline.target),
          type: 'file',
          source: targetSource,
          identityRevision: createHash('sha256').update(`file\n${targetSource}`).digest('hex'),
        },
      }
    : undefined;
  const capabilities = config.capabilities
    ? Object.fromEntries(Object.keys(config.capabilities).map(key => [key, false]))
    : undefined;
  return {
    ...structuredClone(config),
    mode: 'review',
    documentUpdates: false,
    productSpec,
    specMap,
    reviewBaseline,
    capabilities,
    targetUrl: `/target/${encodeURIComponent(entryName)}` + (config.targetUrl.match(/[?#].*$/)?.[0] || ''),
    canSave: false,
    canSaveSpecMap: false,
    canSaveSpec: false,
    canSubmitToCodex: false,
    specEditMode: 'readonly',
    specDocument: config.specDocument ? { ...structuredClone(config.specDocument), path: '' } : null,
    sourceSpecPath: '',
    bundlePath: '',
    specPath: '',
    draftChangeCount: 0,
    prd,
    prdReview: null,
    prdMap,
    canSavePrdMap: false,
    canReturnToProjects: false,
    project: null,
    reviewPackage: {
      portable: true,
      generatedAt,
      canExport: false,
      blockReason: '当前已经是只读评审包',
    },
  };
};

const REVIEW_SERVER_SOURCE = String.raw`import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(root, 'web');
const pageRoot = resolve(root, 'pages');
const config = JSON.parse(await readFile(resolve(root, 'data/config.json'), 'utf8'));
const MIME = { '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm','.pdf':'application/pdf' };
const safePath = (base, value) => { const decoded = decodeURIComponent(value).replace(/^\/+/, ''); const candidate = resolve(base, decoded || 'index.html'); return candidate === base || candidate.startsWith(base + sep) ? candidate : null; };
const sendJson = (response, statusCode, value) => { response.writeHead(statusCode, { 'content-type':'application/json; charset=utf-8','cache-control':'no-store' }); response.end(JSON.stringify(value)); };
const sendFile = async (response, path) => { const info = await stat(path); const finalPath = info.isDirectory() ? resolve(path, 'index.html') : path; const content = await readFile(finalPath); response.writeHead(200, { 'content-type':MIME[extname(finalPath).toLowerCase()] || 'application/octet-stream','cache-control':'no-store' }); response.end(content); };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/config' && request.method === 'GET') return sendJson(response, 200, config);
    if (url.pathname.startsWith('/api/')) return sendJson(response, 403, { code:'READ_ONLY_PACKAGE', error:'当前是只读评审包，不提供写入、项目管理、文件浏览或 Codex 接口' });
    if (url.pathname === '/') return await sendFile(response, resolve(webRoot, 'index.html'));
    if (url.pathname.startsWith('/studio-assets/')) { const path = safePath(webRoot, url.pathname.replace(/^\/studio-assets\/?/, '')); if (!path) return sendJson(response, 403, { error:'资源路径越界' }); return await sendFile(response, path); }
    if (url.pathname.startsWith('/target/')) { const path = safePath(pageRoot, url.pathname.replace(/^\/target\/?/, '')); if (!path) return sendJson(response, 403, { error:'页面路径越界' }); return await sendFile(response, path); }
    const path = safePath(pageRoot, url.pathname);
    if (!path) return sendJson(response, 403, { error:'页面路径越界' });
    return await sendFile(response, path);
  } catch (error) {
    if (error?.code === 'ENOENT') return sendJson(response, 404, { error:'资源不存在' });
    return sendJson(response, 400, { error:error instanceof Error ? error.message : String(error) });
  }
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const url = 'http://127.0.0.1:' + port + '/';
process.stdout.write('只读评审包已启动：' + url + '\n关闭此窗口即可停止。\n');
const command = process.platform === 'darwin' ? ['open',[url]] : process.platform === 'win32' ? ['cmd',['/c','start','',url]] : ['xdg-open',[url]];
if (!process.argv.includes('--no-open')) { try { const child = spawn(command[0], command[1], { detached:true, stdio:'ignore' }); child.on('error', () => {}); child.unref(); } catch {} }
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
`;

const MAC_STARTER = String.raw`#!/bin/zsh
cd -- "$(dirname "$0")"
exec node open-review.mjs
`;

const WINDOWS_STARTER = String.raw`@echo off
cd /d "%~dp0"
if exist "打开评审.exe" (
  "打开评审.exe"
  exit /b %errorlevel%
)
node open-review.mjs
pause
`;

const README_SOURCE = `Interactive Product Spec 只读评审包

打开方式
1. 先完整解压 ZIP，不要在压缩软件预览窗口中运行。
2. Windows 10/11 x64：双击“打开评审.exe”，无需安装 Node.js。
3. macOS：需要 Node.js 20 或更高版本，双击“打开评审.command”。
4. 技术兜底：安装 Node.js 20 后运行“打开评审.bat”或 node open-review.mjs。

Windows 提示
- 当前 EXE 未附带企业代码签名，首次打开可能显示“未知发布者”。正式跨组织分发前建议由发布方使用可信证书签名。
- EXE 只读取解压目录内的冻结文件，不安装服务、不写入项目，也不向局域网或公网开放。

边界
- 查看器只监听本机 127.0.0.1 的随机端口，不向局域网或公网开放。
- 页面滚动、点击、缩放、Spec 标记/查找和 PRD 阅读可用。
- Spec、页面映射、PRD 关系、项目文件和 Codex 均不可修改。
- 页面若依赖真实后端、登录态、WebSocket 或外部接口，对应能力不会被离线包伪造。
`;

export async function createReviewPackage({ appRoot, active, config, now = new Date() }) {
  if (!active || active.target?.type !== 'file') {
    throw new Error('本地开发地址不能直接导出。请先构建或选择可独立读取的 HTML 页面包');
  }
  const webRoot = resolve(appRoot, 'web');
  const windowsLauncherPath = resolve(appRoot, 'runtime/windows-x64/open-review.exe');
  const pageRoot = resolve(active.target.root);
  const entryPath = resolve(active.target.htmlPath);
  if (entryPath !== pageRoot && !entryPath.startsWith(`${pageRoot}${sep}`)) {
    throw new Error('HTML 入口不在页面包目录内，无法安全导出');
  }
  const entryName = relative(pageRoot, entryPath).replaceAll(sep, '/');
  const generatedAt = now.toISOString();
  const outputDirectory = await mkdtemp(join(tmpdir(), 'ips-readonly-review-'));
  const filename = `${safeFilenamePart(config.productSpec.product.title)}-${safeFilenamePart(config.productSpec.product.version)}-只读评审包.zip`;
  const archivePath = resolve(outputDirectory, filename);
  const handle = await open(archivePath, 'w');
  const archive = new ZipWriter(handle);
  const manifestFiles = [];
  try {
    const snapshot = await collectReviewSnapshot({ appRoot, active, config, now });
    for (const entry of snapshot.entries) manifestFiles.push(await archive.addBuffer(entry.path, entry.content));
    manifestFiles.push(await archive.addBuffer('open-review.mjs', REVIEW_SERVER_SOURCE));
    manifestFiles.push(await archive.addFile('打开评审.exe', windowsLauncherPath));
    manifestFiles.push(await archive.addBuffer('打开评审.command', MAC_STARTER, { mode: 0o100755 }));
    manifestFiles.push(await archive.addBuffer('打开评审.bat', WINDOWS_STARTER));
    manifestFiles.push(await archive.addBuffer('README.txt', README_SOURCE));
    const manifest = {
      schemaVersion: '0.1',
      kind: 'interactive-product-spec-readonly-review',
      generatedAt,
      product: {
        id: config.productSpec.product.id,
        title: config.productSpec.product.title,
        version: config.productSpec.product.version,
        status: config.productSpec.product.status,
      },
      entry: `pages/${entryName}`,
      specRevision: config.specRevision || '',
      sourceSpecRevision: config.sourceSpecRevision || '',
      mapRevision: config.mapRevision || '',
      prdRevision: config.prd?.revision || '',
      prdMapRevision: config.prdMapRevision || '',
      fileCount: manifestFiles.length + 1,
      uncompressedBytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0),
      files: manifestFiles,
    };
    await archive.addBuffer('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await archive.close();
    return {
      archivePath,
      filename,
      cleanup: async () => await rm(outputDirectory, { recursive: true, force: true }),
      manifest,
    };
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

// Shared by ZIP delivery and authenticated local publication. Read each source twice
// so an in-flight source edit cannot silently become a mixed snapshot.
export async function collectReviewSnapshot({ appRoot, active, config, now = new Date(), excludeRoots = [] }) {
  if (active?.target?.type !== 'file') throw new Error('请先选择可独立读取的 HTML 页面包');
  const webRoot = await realpath(resolve(appRoot, 'web'));
  const pageRoot = await realpath(active.target.root);
  const entryPath = await realpath(active.target.htmlPath);
  excludeRoots = await Promise.all(excludeRoots.map(path => realpath(path)));
  const entries = [], sources = [];
  for (const [prefix, root, runtime] of [['web', webRoot, false], ['pages', pageRoot, true]]) {
    for (const file of await listFiles(root, { pageRuntimeOnly: runtime, excludeRoots })) {
      const actual = await realpath(file);
      if (!actual.startsWith(root + sep)) throw new Error('评审资源路径越界');
      const content = await readFile(actual);
      entries.push({ path: relativeArchivePath(prefix, root, actual), content });
      sources.push({ path: actual, hash: createHash('sha256').update(content).digest('hex') });
    }
  }
  const entryName = relative(pageRoot, entryPath).replaceAll(sep, '/');
  if (!entries.some(entry => entry.path === `pages/${entryName}`)) throw new Error('HTML 入口没有进入评审快照');
  for (const source of sources) {
    if (createHash('sha256').update(await readFile(source.path)).digest('hex') !== source.hash) throw new Error('来源在生成时发生变化，请重新读取后发布');
  }
  const generatedAt = now.toISOString();
  const readOnlyConfig = makeReadOnlyReviewConfig(config, entryName, generatedAt);
  for (const [name, document] of [['PRD.md', readOnlyConfig.prd], ['Spec.md', readOnlyConfig.specDocument]]) {
    if (typeof document?.source === 'string') entries.push({ path: `documents/${name}`, content: Buffer.from(document.source, 'utf8') });
  }
  entries.push({ path: 'data/config.json', content: Buffer.from(JSON.stringify(readOnlyConfig)) });
  return { entries, generatedAt, config: readOnlyConfig, entryName };
}
