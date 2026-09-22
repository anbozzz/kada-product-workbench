import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { validateSpecBundle } from './contracts.mjs';
import { parsePrdMarkdown } from './prd-service.mjs';

const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', 'node_modules', 'coverage', '.cache', '.next', '.nuxt',
]);
const MAX_FILES = 3_000;
const MAX_DEPTH = 5;

const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

const htmlScore = (path, root) => {
  const name = basename(path).toLowerCase();
  const rel = relative(root, path).toLowerCase();
  let score = name === 'index.html' ? 70 : 30;
  if (!rel.includes(sep)) score += 18;
  if (/(^|[\\/])(dist|build|public|preview)([\\/]|$)/.test(rel)) score += 24;
  if (/(test|fixture|coverage|report)/.test(rel)) score -= 30;
  return score;
};

const specScore = (path, valid) => {
  const name = basename(path).toLowerCase();
  let score = name === 'product.spec.json' ? 100 : name.endsWith('.spec.json') ? 65 : 20;
  if (valid) score += 35;
  return score;
};

const isSpecMarkdown = path => {
  const name = basename(path).toLowerCase();
  if (!['.md', '.markdown'].includes(extname(name))) return false;
  if (/(^|[._ -])(prd|requirements?)([._ -]|$)|产品需求|需求文档/.test(name)) return false;
  return name === 'spec.md'
    || /\.spec\.(md|markdown)$/.test(name)
    || /product[._ -]?spec/.test(name)
    || /产品.*spec|产品规格/.test(name);
};

const isPrdMarkdown = path => {
  const name = basename(path).toLowerCase();
  if (!['.md', '.markdown'].includes(extname(name))) return false;
  return /(^|[._ -])(prd|requirements?)([._ -]|$)|产品需求|需求文档/.test(name);
};

const prdScore = (path, valid) => {
  const name = basename(path).toLowerCase();
  let score = /产品需求文档/.test(name) ? 100 : /prd/.test(name) ? 75 : 45;
  if (valid) score += 35;
  return score;
};

const prdMapScore = path => {
  const name = basename(path).toLowerCase();
  return name === 'prd-map.json' ? 100 : name.includes('prd-map') ? 65 : 20;
};

const specSourceScore = (path, source) => {
  const name = basename(path).toLowerCase();
  let score = name === 'product.spec.md' ? 100 : /\.spec\.(md|markdown)$/.test(name) ? 75 : 55;
  if (/\b(SURFACE|ACTION|RULE|STATE|EVENT|PERMISSION|EXTERNAL|AC|TBD)\b/.test(source)) score += 20;
  if (/\b[A-Z0-9][A-Z0-9._-]{3,}\b/.test(source)) score += 10;
  return score;
};

const mapScore = path => {
  const name = basename(path).toLowerCase();
  return name === 'spec-map.json' ? 100 : name.includes('spec-map') ? 65 : 20;
};

const readJsonCandidate = async path => {
  try {
    return { value: JSON.parse(await readFile(path, 'utf8')), errors: [] };
  } catch (error) {
    return { value: null, errors: [`JSON 无法读取：${error.message}`] };
  }
};

export async function scanProjectDirectory(inputPath) {
  const root = resolve(inputPath);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error('项目路径不是目录');
  const files = [];
  let truncated = false;

  const visit = async (directory, depth) => {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const path = resolve(directory, entry.name);
      if (!inside(root, path)) continue;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !IGNORED_DIRECTORIES.has(entry.name)) await visit(path, depth + 1);
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (['.html', '.htm', '.json', '.md', '.markdown'].includes(extension)) files.push(path);
      }
    }
  };
  await visit(root, 0);

  const html = files
    .filter(path => ['.html', '.htm'].includes(extname(path).toLowerCase()))
    .map(path => ({ path, relativePath: relative(root, path), score: htmlScore(path, root), valid: true, errors: [] }))
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));

  const spec = [];
  const specSource = [];
  const map = [];
  const prd = [];
  const prdMap = [];
  for (const path of files.filter(path => extname(path).toLowerCase() === '.json')) {
    const name = basename(path).toLowerCase();
    if (name === 'product.spec.json' || name.endsWith('.spec.json')) {
      const parsed = await readJsonCandidate(path);
      const errors = parsed.value ? validateSpecBundle(parsed.value) : parsed.errors;
      spec.push({
        path,
        relativePath: relative(root, path),
        score: specScore(path, errors.length === 0),
        valid: errors.length === 0,
        errors: errors.slice(0, 4),
        productTitle: errors.length === 0 ? parsed.value.product.title : undefined,
      });
    }
    if (name === 'spec-map.json' || name.includes('spec-map')) {
      const parsed = await readJsonCandidate(path);
      const shapeErrors = [];
      if (parsed.value && parsed.value.type !== 'AnnotationCollection') shapeErrors.push('type 不是 AnnotationCollection');
      if (parsed.value && !parsed.value.productSpecId) shapeErrors.push('缺少 productSpecId');
      map.push({
        path,
        relativePath: relative(root, path),
        score: mapScore(path) + (parsed.errors.length || shapeErrors.length ? 0 : 25),
        valid: parsed.errors.length === 0 && shapeErrors.length === 0,
        errors: [...parsed.errors, ...shapeErrors].slice(0, 4),
      });
    }
    if (name === 'prd-map.json' || name.includes('prd-map')) {
      const parsed = await readJsonCandidate(path);
      const shapeErrors = [];
      if (parsed.value && parsed.value.schemaVersion !== '0.1') shapeErrors.push('schemaVersion 不是 0.1');
      if (parsed.value && !parsed.value.productId) shapeErrors.push('缺少 productId');
      if (parsed.value && !parsed.value.prd?.revision) shapeErrors.push('缺少 prd.revision');
      if (parsed.value && !Array.isArray(parsed.value.items)) shapeErrors.push('缺少 items 数组');
      prdMap.push({
        path,
        relativePath: relative(root, path),
        score: prdMapScore(path) + (parsed.errors.length || shapeErrors.length ? 0 : 25),
        valid: parsed.errors.length === 0 && shapeErrors.length === 0,
        errors: [...parsed.errors, ...shapeErrors].slice(0, 4),
      });
    }
  }
  for (const path of files.filter(isSpecMarkdown)) {
    try {
      const source = await readFile(path, 'utf8');
      const heading = source.match(/^#\s+(.+)$/m)?.[1]?.trim();
      specSource.push({
        path,
        relativePath: relative(root, path),
        score: specSourceScore(path, source),
        valid: Boolean(source.trim()),
        errors: source.trim() ? [] : ['Spec 文档为空'],
        productTitle: heading,
      });
    } catch (error) {
      specSource.push({
        path,
        relativePath: relative(root, path),
        score: 0,
        valid: false,
        errors: [`Markdown 无法读取：${error.message}`],
      });
    }
  }
  for (const path of files.filter(isPrdMarkdown)) {
    try {
      const source = await readFile(path, 'utf8');
      const parsed = parsePrdMarkdown(source, { path });
      prd.push({
        path,
        relativePath: relative(root, path),
        score: prdScore(path, parsed.valid),
        valid: parsed.valid,
        errors: parsed.errors.slice(0, 8),
        productTitle: parsed.document.title,
      });
    } catch (error) {
      prd.push({
        path,
        relativePath: relative(root, path),
        score: 0,
        valid: false,
        errors: [`PRD 无法读取：${error.message}`],
      });
    }
  }
  spec.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
  specSource.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
  map.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
  prd.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
  prdMap.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));

  return {
    projectPath: root,
    scannedFiles: files.length,
    truncated,
    html,
    spec,
    specSource,
    map,
    prd,
    prdMap,
    recommended: {
      htmlPath: html[0]?.path || '',
      specPath: spec.find(item => item.valid)?.path || spec[0]?.path || '',
      sourceSpecPath: specSource.find(item => item.valid)?.path || specSource[0]?.path || '',
      mapPath: map.find(item => item.valid)?.path || map[0]?.path || '',
      prdPath: prd.find(item => item.valid)?.path || prd[0]?.path || '',
      prdMapPath: prdMap.find(item => item.valid)?.path || prdMap[0]?.path || '',
    },
  };
}

export async function listLocalPath(inputPath, kind = 'directory') {
  const current = resolve(inputPath || homedir());
  const info = await stat(current);
  const directory = info.isDirectory() ? current : dirname(current);
  const entries = await readdir(directory, { withFileTypes: true });
  const extensions = kind === 'html'
    ? new Set(['.html', '.htm'])
    : kind === 'json'
      ? new Set(['.json'])
      : kind === 'markdown'
        ? new Set(['.md', '.markdown'])
        : null;
  const items = entries
    .filter(entry => !entry.name.startsWith('.'))
    .filter(entry => entry.isDirectory() || (kind !== 'directory' && entry.isFile() && extensions?.has(extname(entry.name).toLowerCase())))
    .map(entry => ({
      name: entry.name,
      path: resolve(directory, entry.name),
      type: entry.isDirectory() ? 'directory' : 'file',
    }))
    .sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'directory' ? -1 : 1);
  const parent = dirname(directory);
  return { current: directory, parent: parent === directory ? null : parent, items };
}

export function parseLocalDevUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('本地开发地址格式不正确');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('本地开发地址只支持 http 或 https');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    throw new Error('第一阶段只允许连接 localhost、127.0.0.1 或 ::1');
  }
  if (url.username || url.password) throw new Error('本地开发地址不能包含账号密码');
  if (hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  return url;
}

export async function checkLocalDevUrl(value) {
  let url = parseLocalDevUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    let response;
    for (let count = 0; count < 6; count += 1) {
      response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      url = parseLocalDevUrl(new URL(location, url).href);
    }
    if (!response || [301, 302, 303, 307, 308].includes(response.status)) {
      throw new Error('本地开发地址重定向次数过多');
    }
    return {
      url: url.href,
      reachable: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      error: response.ok ? '' : `开发地址返回 HTTP ${response.status}`,
    };
  } catch (error) {
    return { url: url.href, reachable: false, status: 0, contentType: '', error: error.name === 'AbortError' ? '连接超时' : error.message };
  } finally {
    clearTimeout(timer);
  }
}
