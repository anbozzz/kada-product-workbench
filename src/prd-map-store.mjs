import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEmptyPrdMap, validatePrdMap } from './contracts.mjs';

const saveQueues = new Map();
const hashText = value => createHash('sha256').update(value).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

const writeAtomic = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, path);
};

const withSaveLock = (path, operation) => {
  const previous = saveQueues.get(path) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  saveQueues.set(path, current);
  return current.finally(() => {
    if (saveQueues.get(path) === current) saveQueues.delete(path);
  });
};

export class PrdMapRevisionConflictError extends Error {
  constructor(message = 'PRD 页面映射已在其他窗口发生变化，请重新载入后再保存') {
    super(message);
    this.name = 'PrdMapRevisionConflictError';
    this.code = 'PRD_MAP_CHANGED';
  }
}

export async function readPrdMap({ mapPath, prdDocument, targetSource, createOnDisk }) {
  let source = '';
  let map;
  try {
    source = await readFile(mapPath, 'utf8');
    map = JSON.parse(source);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    map = createEmptyPrdMap({
      productId: prdDocument.productId,
      prdPath: prdDocument.path,
      prdRevision: prdDocument.revision,
      targetSource,
    });
    source = serialize(map);
    if (createOnDisk) await writeAtomic(mapPath, source);
  }
  const errors = validatePrdMap(map, prdDocument, {
    allowMissingSections: true,
    allowProductMismatch: true,
  });
  if (map.targetSource !== targetSource) {
    errors.push(`targetSource 与当前页面来源不一致：${map.targetSource}`);
  }
  if (errors.length) throw new Error(`PRD map 校验失败：\n- ${errors.join('\n- ')}`);
  const stale = map.prd.revision !== prdDocument.revision;
  const missingSectionIds = [...new Set((map.items || []).flatMap(item => item.sectionIds || []))]
    .filter(id => !prdDocument.sections.some(section => section.id === id));
  return { map, revision: hashText(source), stale, missingSectionIds };
}

export async function savePrdMap({ mapPath, prdDocument, nextMap, baseRevision }) {
  return withSaveLock(mapPath, async () => {
    if (!baseRevision) throw new PrdMapRevisionConflictError('保存请求缺少 PRD 映射基线版本，请重新载入工作台');
    let currentSource;
    try {
      currentSource = await readFile(mapPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new PrdMapRevisionConflictError('PRD 映射文件已被移除，请重新载入工作台');
      throw error;
    }
    if (hashText(currentSource) !== baseRevision) throw new PrdMapRevisionConflictError();

    const currentMap = JSON.parse(currentSource);
    const savedMap = structuredClone(nextMap);
    savedMap.productId = prdDocument.productId;
    savedMap.targetSource = currentMap.targetSource;
    savedMap.updatedAt = new Date().toISOString();
    savedMap.prd = {
      path: prdDocument.path,
      revision: prdDocument.revision,
      profileVersion: prdDocument.profileVersion,
    };
    const errors = validatePrdMap(savedMap, prdDocument);
    if (errors.length) return { ok: false, errors };
    const source = serialize(savedMap);
    await writeAtomic(mapPath, source);
    return { ok: true, map: savedMap, revision: hashText(source) };
  });
}
