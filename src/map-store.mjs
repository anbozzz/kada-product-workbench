import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEmptySpecMap, validateSpecMap } from './contracts.mjs';

const saveQueues = new Map();

const hashText = value => createHash('sha256').update(value).digest('hex');
const serializeMap = map => `${JSON.stringify(map, null, 2)}\n`;
const confirmedAssociations = map => ({
  ...structuredClone(map),
  items: (map.items || []).map(annotation => ({
    ...annotation,
    status: 'confirmed',
  })),
});

const writeAtomic = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
};

const withSaveLock = (mapPath, operation) => {
  const previous = saveQueues.get(mapPath) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  saveQueues.set(mapPath, current);
  return current.finally(() => {
    if (saveQueues.get(mapPath) === current) saveQueues.delete(mapPath);
  });
};

export class MapRevisionConflictError extends Error {
  constructor(message = '页面映射已在其他窗口或工作台外发生变化，请重新载入后再保存') {
    super(message);
    this.name = 'MapRevisionConflictError';
    this.code = 'MAP_CHANGED';
  }
}

export async function readSpecMap({ mapPath, bundle, targetSource, createOnDisk }) {
  let source = '';
  let map;
  try {
    source = await readFile(mapPath, 'utf8');
    map = JSON.parse(source);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    map = createEmptySpecMap(bundle.product.id, targetSource);
    source = serializeMap(map);
    if (createOnDisk) await writeAtomic(mapPath, source);
  }
  const errors = validateSpecMap(map, bundle, { allowMissingNodes: true });
  if (errors.length) throw new Error(`Spec map 校验失败：\n- ${errors.join('\n- ')}`);
  return { map: confirmedAssociations(map), revision: hashText(source) };
}

export async function saveSpecMap({ mapPath, bundle, nextMap, baseRevision }) {
  return withSaveLock(mapPath, async () => {
    if (!baseRevision) throw new MapRevisionConflictError('保存请求缺少映射基线版本，请重新载入工作台');
    let currentSource;
    try {
      currentSource = await readFile(mapPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new MapRevisionConflictError('映射文件已被移除，请重新载入工作台');
      throw error;
    }
    if (hashText(currentSource) !== baseRevision) throw new MapRevisionConflictError();

    const savedMap = confirmedAssociations(nextMap);
    savedMap.updatedAt = new Date().toISOString();
    const errors = validateSpecMap(savedMap, bundle, { allowMissingNodes: true });
    if (errors.length) return { ok: false, errors };

    const source = serializeMap(savedMap);
    await writeAtomic(mapPath, source);
    return {
      ok: true,
      map: savedMap,
      revision: hashText(source),
    };
  });
}
