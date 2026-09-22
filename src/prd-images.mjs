import { open, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 100;
const TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.bmp', 'image/bmp'],
]);
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
const validSignature = (bytes, type) => {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/gif') return /^(GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return type === 'image/bmp' && bytes.subarray(0, 2).toString('ascii') === 'BM';
};

// Parse the same Markdown image forms used by the reader, excluding code and links.
function analyzeImages(source) {
  const tree = fromMarkdown(source);
  const definitions = new Map();
  const images = [];
  const walk = node => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === 'image' || node.type === 'imageReference') images.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return { images, definitions };
}

export function prdImageSources(source) {
  const { images, definitions } = analyzeImages(source);
  return [...new Set(images.map(node => node.url ?? definitions.get(node.identifier)?.url).filter(Boolean))];
}

// Definitions have no visible prose. Keep only image definitions so filtered sections
// can still render reference-style images declared elsewhere in the original PRD.
export function prdImageDefinitions(source) {
  const { images, definitions } = analyzeImages(source);
  return [...new Set(images.filter(node => node.type === 'imageReference').map(node => node.identifier))]
    .map(id => definitions.get(id))
    .filter(Boolean)
    .map(node => source.slice(node.position.start.offset, node.position.end.offset))
    .join('\n\n');
}

export async function loadPrdImages(document, projectPath) {
  const images = Object.create(null);
  const sources = prdImageSources(document.source);
  if (!sources.length) return images;
  let root;
  let documentPath;
  try {
    root = await realpath(projectPath || dirname(document.path));
    documentPath = await realpath(document.path);
    if (!inside(root, documentPath)) throw new Error('outside project');
  } catch {
    for (const source of sources) images[source] = { error: 'PRD 不在所选项目内，无法读取图片。' };
    return images;
  }
  let totalBytes = 0;
  for (const [index, source] of sources.entries()) {
    let handle;
    try {
      if (index >= MAX_IMAGES) throw new Error('图片数量超过单文档 100 张上限。');
      if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(source)) throw new Error('仅支持所选项目内的相对路径图片，不自动读取外部地址。');
      const decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]);
      if (!decoded || /[\x00-\x1f\\]/.test(decoded) || isAbsolute(decoded) || /^[a-z]:/i.test(decoded)) throw new Error('图片路径不受支持。');
      const candidate = resolve(dirname(documentPath), decoded);
      if (!inside(root, candidate)) throw new Error('图片超出所选项目，已拒绝读取。');
      const path = await realpath(candidate);
      if (!inside(root, path)) throw new Error('图片超出所选项目，已拒绝读取。');
      if (!TYPES.has(extname(path).toLowerCase())) throw new Error('当前支持 PNG、JPEG、GIF、WebP 和 BMP 图片。');
      handle = await open(path, 'r');
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('图片来源不是文件。');
      if (!info.size || info.size > MAX_IMAGE_BYTES) throw new Error('图片为空或超过单张 8 MiB 上限。');
      if (totalBytes + info.size > MAX_DOCUMENT_BYTES) throw new Error('图片总大小超过单文档 24 MiB 上限。');
      // Bounded reads also prevent a concurrently growing file from exhausting memory.
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw new Error('图片读取期间发生变化，请重新打开来源。');
        offset += read.bytesRead;
      }
      // Some source screenshots have a .png name but JPEG bytes. Trust only a
      // supported raster signature for the MIME type, never the extension alone.
      const mime = [...new Set(TYPES.values())].find(type => validSignature(bytes, type));
      if (!mime) throw new Error('文件不是受支持的位图，未加载。');
      totalBytes += bytes.length;
      images[source] = { src: `data:${mime};base64,${bytes.toString('base64')}` };
    } catch (error) {
      images[source] = { error: error.code ? '图片不存在或无法读取，请检查 PRD 引用路径。' : error.message };
    } finally {
      await handle?.close();
    }
  }
  return images;
}
