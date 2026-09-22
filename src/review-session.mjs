import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { createEmptySpecMap, diffSpecBundles } from './contracts.mjs';
import { readSpecMap } from './map-store.mjs';
import { readPrdDocument } from './prd-service.mjs';
import { loadPrdImages, prdImageDefinitions } from './prd-images.mjs';
import { readPrdMap } from './prd-map-store.mjs';
import {
  projectIdFor,
  rememberProject,
  toolMapPathFor,
} from './project-store.mjs';
import { readMarkdownSource, readSpecSource } from './spec-service.mjs';

const hashIdentity = value => createHash('sha256').update(value).digest('hex');

const normalizeRoute = value => {
  const route = String(value || '').trim();
  if (route && !route.startsWith('#') && !route.startsWith('?')) {
    throw new Error('初始路由当前只支持 #hash 或 ?query');
  }
  return route;
};

const assertFile = async (path, label, extensions) => {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} 不是文件`);
  if (extensions && !extensions.includes(extname(path).toLowerCase())) {
    throw new Error(`${label} 文件类型不受支持`);
  }
};

const targetSourceFor = active => active.target.type === 'dev'
  ? active.target.url
  : active.target.type === 'document' ? active.prdDocument.path : active.target.htmlPath;

export const normalizeStoredProject = project => ({
  id: project.id,
  name: project.name,
  projectPath: project.projectPath,
  sourceType: project.sourceType,
  htmlPath: project.htmlPath || '',
  devUrl: project.devUrl || '',
  specPath: project.specPath || '',
  sourceSpecPath: project.sourceSpecPath || '',
  prdPath: project.prdPath || '',
  prdMapPath: project.prdMapPath || '',
  mapPath: project.mapPath || '',
  mapPolicy: project.mapPolicy,
  mode: project.mode,
  initialRoute: project.initialRoute || '',
});

export const createReviewBaseline = active => {
  const targetSource = targetSourceFor(active);
  return {
    schemaVersion: '0.1',
    sessionId: active.sessionId,
    mode: active.mode,
    projectId: active.project?.id || '',
    target: {
      type: active.target.type,
      source: targetSource,
      identityRevision: hashIdentity(`${active.target.type}\n${targetSource}`),
    },
    artifacts: {
      prdRevision: active.prdDocument?.revision || '',
      prdMapRevision: active.prdMapRevision || '',
      sourceSpecRevision: active.sourceSpecRevision || '',
      projectionRevision: active.specRevision || '',
      specMapRevision: active.mapRevision || '',
    },
  };
};

export const createWorkbenchConfig = (active, studio) => {
  const targetUrl = active.target.type === 'dev'
    ? `/target-dev/${active.initialRoute}`
    : active.target.type === 'document' ? 'about:blank'
    : `/target/${encodeURIComponent(basename(active.target.htmlPath))}${active.initialRoute}`;
  const capabilities = {
    saveSpecMap: active.mode === 'map' && Boolean(active.mapPath),
    saveSpec: active.mode === 'map' && Boolean(active.sourceSpecPath || active.specPath),
    submitToCodex: active.mode === 'map' && Boolean(active.gate && active.sourceSpecPath),
    savePrdMap: active.mode === 'map' && Boolean(active.prdMapPath && active.prdDocument),
    returnToProjects: studio,
    exportReviewPackage: active.target.type === 'file',
  };
  return {
    documentUpdates: !active.prdReview,
    mode: active.mode,
    productSpec: active.bundle,
    specMap: active.map,
    mapRevision: active.mapRevision,
    targetUrl,
    reviewBaseline: createReviewBaseline(active),
    capabilities,
    // Compatibility fields remain until consumers have migrated to capabilities.
    canSave: active.mode === 'map',
    canSaveSpecMap: capabilities.saveSpecMap,
    canSaveSpec: capabilities.saveSpec,
    canSubmitToCodex: capabilities.submitToCodex,
    specEditMode: active.mode !== 'map'
      ? 'readonly'
      : active.gate
        ? 'codex-gate'
        : 'direct-source',
    sourceSpecPath: active.sourceSpecPath || '',
    sourceSpecRevision: active.sourceSpecRevision || '',
    specDocument: active.specDocument ? { ...active.specDocument, pendingDraft: Boolean(active.gate && diffSpecBundles(active.baseBundle, active.bundle).length) } : null,
    bundlePath: active.specPath || '',
    specPath: active.specPath || '',
    specRevision: active.specRevision || '',
    draftChangeCount: diffSpecBundles(active.baseBundle, active.bundle).length,
    prd: active.prdDocument || null,
    prdReview: active.prdReview?.view() || null,
    prdMap: active.prdMap || null,
    prdMapRevision: active.prdMapRevision || '',
    canSavePrdMap: capabilities.savePrdMap,
    prdMapStale: Boolean(active.prdMapStale),
    missingPrdSectionIds: active.missingPrdSectionIds || [],
    canReturnToProjects: capabilities.returnToProjects,
    reviewPackage: {
      portable: false,
      canExport: capabilities.exportReviewPackage,
      blockReason: capabilities.exportReviewPackage
        ? ''
        : active.target.type === 'document' ? '当前仅评审 PRD，尚无 HTML 页面包可导出' : '本地开发地址不能直接导出，请先构建或选择 HTML 页面包',
    },
    project: active.project
      ? {
          id: active.project.id,
          name: active.project.name,
          projectPath: active.project.projectPath,
          sourceType: active.project.sourceType,
          mapPolicy: active.project.mapPolicy,
        }
      : null,
  };
};

export const prepareStudioProject = async (raw, statePath, { annotationReview = false } = {}) => {
  if (!raw || typeof raw !== 'object') throw new Error('项目配置不能为空');
  if (raw.sourceType === 'dev' || raw.devUrl) throw new Error('开发地址接入已移除，请重新选择本地 HTML 页面包');
  const projectPath = resolve(String(raw.projectPath || '').trim());
  const projectInfo = await stat(projectPath);
  if (!projectInfo.isDirectory()) throw new Error('项目路径不是目录');

  const sourceType = ['directory', 'html', 'dev'].includes(raw.sourceType)
    ? raw.sourceType
    : 'directory';
  const rawSpecPath = String(raw.specPath || '').trim();
  const specPath = rawSpecPath ? resolve(rawSpecPath) : '';
  let bundle = null;
  let specRevision = '';
  if (specPath) {
    await assertFile(specPath, '内部 Spec 视图模型', ['.json']);
    ({ bundle, revision: specRevision } = await readSpecSource(specPath));
  }
  const rawSourceSpecPath = String(raw.sourceSpecPath || '').trim();
  const sourceSpecPath = rawSourceSpecPath ? resolve(rawSourceSpecPath) : '';
  let sourceSpecRevision = '';
  let specDocument = null;
  if (sourceSpecPath) {
    await assertFile(sourceSpecPath, '原始 Spec 文档', ['.md', '.markdown']);
    specDocument = await readMarkdownSource(sourceSpecPath);
    sourceSpecRevision = specDocument.revision;
    specDocument.images = await loadPrdImages({ ...specDocument, path: sourceSpecPath }, projectPath);
  }
  const rawPrdPath = String(raw.prdPath || '').trim();
  const prdPath = rawPrdPath ? resolve(rawPrdPath) : '';
  let prdDocument = null;
  if (prdPath) {
    await assertFile(prdPath, '产品需求文档', ['.md', '.markdown']);
    ({ document: prdDocument } = await readPrdDocument(prdPath));
  }
  if (sourceSpecPath && !bundle) {
    throw new Error('已选择 Markdown Spec，但内部工作台投影尚未准备；请先恢复或生成投影，不能降级进入仅含 PRD 的工作台');
  }
  if (!bundle && !prdDocument) throw new Error('请选择符合格式的产品需求文档，或提供可用的 Markdown Spec');
  if (!bundle) {
    bundle = {
      schemaVersion: '0.1',
      product: {
        id: `PRD-ONLY-${prdDocument.revision.slice(0, 12).toUpperCase()}`,
        title: prdDocument.title,
        version: prdDocument.version,
        status: 'draft',
        description: '仅含 PRD 时使用的内部空投影，不写入项目。',
      },
      modules: [],
    };
  }
  const initialRoute = normalizeRoute(raw.initialRoute);
  const mode = raw.mode === 'review' ? 'review' : 'map';

  let target;
  let htmlPath = '';
  let devUrl = '';
  if (annotationReview && !raw.htmlPath && sourceType !== 'dev') {
    target = { type: 'document' };
  } else {
    htmlPath = resolve(String(raw.htmlPath || '').trim());
    await assertFile(htmlPath, 'HTML 入口', ['.html', '.htm']);
    target = { type: 'file', htmlPath, root: dirname(htmlPath) };
  }

  const baseProject = {
    name: String(raw.name || '').trim() || basename(projectPath),
    projectPath,
    sourceType,
    htmlPath,
    devUrl,
    specPath,
    sourceSpecPath,
    prdPath,
    prdMapPath: String(raw.prdMapPath || '').trim(),
    mapPath: String(raw.mapPath || '').trim(),
    mapPolicy: ['existing', 'project', 'tool'].includes(raw.mapPolicy)
      ? raw.mapPolicy
      : 'tool',
    mode,
    initialRoute,
  };
  const id = projectIdFor(baseProject);
  let mapPath = '';
  let createOnDisk = false;

  if (!specPath) {
    mapPath = '';
  } else if (baseProject.mapPolicy === 'tool') {
    const toolMapsRoot = resolve(dirname(statePath), 'maps');
    const rememberedMapPath = baseProject.mapPath ? resolve(baseProject.mapPath) : '';
    const rememberedToolMap = rememberedMapPath.startsWith(`${toolMapsRoot}${sep}`)
      ? rememberedMapPath
      : '';
    mapPath = rememberedToolMap || toolMapPathFor(statePath, id, bundle.product.id);
    let mapExists = true;
    try {
      await stat(mapPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      mapExists = false;
    }
    if (!mapExists && raw.confirmMapCreate !== true) {
      throw new Error('创建新的工具侧映射前需要明确确认');
    }
    createOnDisk = true;
  } else if (baseProject.mapPolicy === 'project') {
    mapPath = resolve(baseProject.mapPath || resolve(projectPath, 'spec-map.json'));
    if (mapPath !== projectPath && !mapPath.startsWith(`${projectPath}${sep}`)) {
      throw new Error('项目内映射文件必须位于当前项目目录');
    }
    if (raw.confirmTargetWrite !== true) {
      throw new Error('创建或写入项目内 spec-map.json 前需要明确确认');
    }
    createOnDisk = true;
  } else {
    if (!baseProject.mapPath) throw new Error('请选择现有 spec-map.json');
    mapPath = resolve(baseProject.mapPath);
    await assertFile(mapPath, 'Spec map', ['.json']);
  }

  const targetSource = target.type === 'dev' ? devUrl : htmlPath;
  const { map, revision: mapRevision } = mapPath
    ? await readSpecMap({ mapPath, bundle, targetSource, createOnDisk })
    : { map: createEmptySpecMap(bundle.product.id, targetSource), revision: '' };

  let prdMap = null;
  let prdMapRevision = '';
  let prdMapPath = '';
  let prdMapStale = false;
  let missingPrdSectionIds = [];
  if (prdDocument && !annotationReview) {
    prdMapPath = resolve(baseProject.prdMapPath || resolve(dirname(prdPath), 'prd-map.json'));
    if (dirname(prdMapPath) !== dirname(prdPath)) {
      throw new Error('prd-map.json 必须与产品需求文档位于同一目录');
    }
    let prdMapExists = true;
    try {
      await stat(prdMapPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      prdMapExists = false;
    }
    if (!prdMapExists && raw.confirmPrdMapCreate !== true) {
      throw new Error('创建产品文档目录中的 prd-map.json 前需要明确确认');
    }
    const loadedPrdMap = await readPrdMap({
      mapPath: prdMapPath,
      prdDocument,
      targetSource,
      createOnDisk: true,
    });
    prdMap = loadedPrdMap.map;
    prdMapRevision = loadedPrdMap.revision;
    prdMapStale = loadedPrdMap.stale;
    missingPrdSectionIds = loadedPrdMap.missingSectionIds;
  }
  const project = {
    ...baseProject,
    id,
    mapPath,
    prdMapPath,
  };
  const remembered = annotationReview ? { project } : await rememberProject(
    statePath,
    normalizeStoredProject(project),
    { opened: true },
  );

  return {
    mode,
    bundle,
    baseBundle: structuredClone(bundle),
    specPath,
    specRevision,
    sourceSpecPath,
    sourceSpecRevision,
    specDocument,
    prdDocument: prdDocument ? {
      ...prdDocument,
      images: await loadPrdImages(prdDocument, projectPath),
      imageDefinitions: prdImageDefinitions(prdDocument.source),
    } : null,
    prdMap,
    prdMapRevision,
    prdMapPath,
    prdMapStale,
    missingPrdSectionIds,
    gate: false,
    sessionId: randomUUID(),
    projectPath,
    map,
    mapRevision,
    mapPath,
    initialRoute,
    target,
    project: remembered.project,
  };
};

export const prepareDirectWorkbench = async options => {
  const htmlPath = resolve(options.htmlPath);
  const specPath = resolve(options.specPath);
  const mapPath = resolve(options.mapPath);
  const rawSourceSpecPath = String(options.sourceSpecPath || '').trim();
  const sourceSpecPath = rawSourceSpecPath ? resolve(rawSourceSpecPath) : '';
  await assertFile(htmlPath, 'HTML 入口', ['.html', '.htm']);
  await assertFile(specPath, '工作台 Spec 视图模型', ['.json']);
  if (options.gate && !sourceSpecPath) {
    throw new Error('--gate 需要 --source-spec 指向要由 Codex 修订的 Markdown Spec');
  }
  let sourceSpecRevision = '';
  let specDocument = null;
  if (sourceSpecPath) {
    await assertFile(sourceSpecPath, '原始 Spec 文档', ['.md', '.markdown']);
    specDocument = await readMarkdownSource(sourceSpecPath);
    sourceSpecRevision = specDocument.revision;
    specDocument.images = await loadPrdImages({ ...specDocument, path: sourceSpecPath }, options.projectPath || dirname(sourceSpecPath));
  }
  const { bundle, revision: specRevision } = await readSpecSource(specPath);
  const { map, revision: mapRevision } = await readSpecMap({
    mapPath,
    bundle,
    targetSource: htmlPath,
    createOnDisk: false,
  });
  return {
    mode: options.mode === 'review' ? 'review' : 'map',
    bundle,
    baseBundle: structuredClone(bundle),
    specPath,
    specRevision,
    sourceSpecPath,
    sourceSpecRevision,
    specDocument,
    gate: Boolean(options.gate),
    sessionId: randomUUID(),
    projectPath: options.projectPath
      ? resolve(options.projectPath)
      : sourceSpecPath
        ? dirname(sourceSpecPath)
        : dirname(htmlPath),
    map,
    mapRevision,
    mapPath,
    initialRoute: normalizeRoute(options.initialRoute),
    target: { type: 'file', htmlPath, root: dirname(htmlPath) },
    project: null,
  };
};
