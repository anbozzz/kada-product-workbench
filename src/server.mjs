import { createWorkbenchRuntime, startManagedWorkbench } from './workbench-runtime.mjs';
import { createPublicationService } from './publication-service.mjs';
import { checkDocumentUpdates, reloadDocuments } from './document-update-service.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { saveSpecMap } from './map-store.mjs';
import {
  PrdMapRevisionConflictError,
  savePrdMap,
} from './prd-map-store.mjs';
import {
  listLocalPath,
  scanProjectDirectory,
} from './project-discovery.mjs';
import {
  defaultStatePath,
  loadProjectState,
  previewRecentProjectRemoval,
  projectIdFor,
  rememberProject,
  removeRecentProject,
} from './project-store.mjs';
import { enrichDiscoveryMaps, resolveSmartLaunch } from './smart-launch.mjs';
import { generateProjectionWithCodex } from './codex-projection.mjs';
import { generatePrdDraftWithCodex } from './codex-prd-draft.mjs';
import { listCodexModels } from './codex-app-server.mjs';
import { createProjectionService } from './projection-service.mjs';
import { createPrdDraftService } from './prd-draft-service.mjs';
import {
  prepareReviewSubmission,
  saveSpecNode,
} from './spec-service.mjs';
import { createReviewPackage } from './review-package.mjs';
import { createPrdReviewService, resolvePrdReviewSources } from './prd-review-service.mjs';
import {
  createReviewBaseline,
  createWorkbenchConfig,
  normalizeStoredProject,
  prepareDirectWorkbench,
  prepareStudioProject,
} from './review-session.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

const json = (response, statusCode, value) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
};

const readBody = request => new Promise((resolveBody, reject) => {
  let value = '';
  request.setEncoding('utf8');
  request.on('data', chunk => {
    value += chunk;
    if (value.length > 2_000_000) reject(new Error('请求内容超过 2MB'));
  });
  request.on('end', () => resolveBody(value));
  request.on('error', reject);
});

const readRawBody = request => new Promise((resolveBody, reject) => {
  const chunks = [];
  let size = 0;
  request.on('data', chunk => {
    size += chunk.length;
    if (size > 10_000_000) reject(new Error('代理请求内容超过 10MB'));
    else chunks.push(chunk);
  });
  request.on('end', () => resolveBody(Buffer.concat(chunks)));
  request.on('error', reject);
});

const safePath = (root, pathname, prefix = '') => {
  const raw = prefix ? pathname.replace(prefix, '') : pathname.replace(/^\//, '');
  const decoded = decodeURIComponent(raw);
  const candidate = resolve(root, decoded || 'index.html');
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
};


const serveFile = async (response, path) => {
  const info = await stat(path);
  const finalPath = info.isDirectory() ? resolve(path, 'index.html') : path;
  const content = await readFile(finalPath);
  response.writeHead(200, {
    'content-type': MIME[extname(finalPath).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  response.end(content);
};

const runtimeKeyFor = (active, bootstrap) => JSON.stringify(active ? [active.project?.projectPath || active.target?.root || '', active.target?.htmlPath || '', active.sourceSpecPath || active.specPath || '', active.mode || 'map', active.mapPath || '', active.prdDocument?.path || '', active.prdMapPath || '', active.initialRoute || ''] : bootstrap?.draft ? [bootstrap.draft.projectPath, bootstrap.draft.htmlPath, bootstrap.draft.sourceSpecPath, bootstrap.draft.mode, bootstrap.draft.initialRoute] : ['center']);
const startServer = async (options, initialActive, studio, launcherBootstrap = null) => {
  const managed = { ...options, statePath: resolve(options.statePath || defaultStatePath()), runtimeKey: runtimeKeyFor(initialActive, launcherBootstrap) };
  return startManagedWorkbench(managed, () => startServerInstance(managed, initialActive, studio, launcherBootstrap));
};
const startServerInstance = async (options, initialActive, studio, launcherBootstrap = null) => {
  const appRoot = resolve(options.appRoot);
  const editorRoot = resolve(appRoot, 'web');
  const statePath = resolve(options.statePath || defaultStatePath());
  const projectionSchema = JSON.parse(
    await readFile(resolve(appRoot, 'schemas/product-spec-projection-output.schema.json'), 'utf8'),
  );
  const projectionService = await createProjectionService({
    statePath,
    outputSchema: projectionSchema,
    generator: options.projectionGenerator || generateProjectionWithCodex,
    timeoutMs: options.projectionTimeoutMs || 8 * 60_000,
    codexPath: options.codexPath || '',
    skillPath: options.productDocumentationSkillPath || '',
  });
  const prdDraftService = await createPrdDraftService({
    statePath,
    generator: options.prdDraftGenerator || generatePrdDraftWithCodex,
    timeoutMs: options.prdDraftTimeoutMs || 12 * 60_000,
    codexPath: options.codexPath || '',
    skillPath: options.productDocumentationSkillPath || '',
  });
  const publications = createPublicationService({ statePath, appRoot });
  const codexModelLister = options.codexModelLister || listCodexModels;
  let codexModelsCache = null;
  let active = initialActive;
  let pendingLauncherBootstrap = launcherBootstrap;
  const preparedReviewPackages = new Map();
  let decisionSettled = false;
  let settleDecision;
  const decision = new Promise(resolveDecision => {
    settleDecision = resolveDecision;
  });
  const finishDecision = value => {
    if (decisionSettled) return false;
    decisionSettled = true;
    settleDecision(value);
    return true;
  };

  let runtime, readinessChecked = false;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);

      if (runtime && await runtime.handle(request, response, url.pathname)) return;
      if (runtime?.closing && request.method !== 'GET') return json(response, 409, { error: '正在检查关闭工作台，请稍后重试；未保存内容保留' });
      if (await publications.handle({ request, response, url, active, port: server.address().port })) return;

      if (active?.prdReview) {
        const expectedHost = `127.0.0.1:${server.address().port}`;
        if (request.headers.host !== expectedHost || (request.headers.origin && request.headers.origin !== `http://${expectedHost}`)) {
          return json(response, 403, { error: 'PRD 评审仅接受当前本机工作台来源' });
        }
      }

      if (url.pathname === '/api/prd-review' && active?.prdReview) {
        if (request.method === 'GET') {
          const review = active.prdReview.view();
          if (url.searchParams.get('version') === String(review.version)) return json(response, 200, { agentConnected: review.agentConnected });
          return json(response, 200, { review, document: active.prdDocument });
        }
        if (request.method === 'POST') {
          if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '需要 JSON 请求' });
          const input = JSON.parse(await readBody(request));
          if (!active.prdReview.checkToken(input.token)) return json(response, 403, { error: '评审令牌不匹配，请重新打开原工作台' });
          const review = await active.prdReview.mutate(input);
          return json(response, 200, { review, document: active.prdDocument });
        }
      }

      if (url.pathname === '/api/document-updates' && active) {
        if (request.method === 'GET') return json(response, 200, await checkDocumentUpdates(active));
        if (request.method === 'POST') {
          const expectedHost = `127.0.0.1:${server.address().port}`;
          if (request.headers.host !== expectedHost || (request.headers.origin && request.headers.origin !== `http://${expectedHost}`)) return json(response, 403, { error: '只接受当前本机工作台来源' });
          if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '需要 JSON 请求' });
          const input = JSON.parse(await readBody(request));
          const current = active;
          const result = await reloadDocuments(current, input.baseline, () => current === active);
          return json(response, 200, { ...result, config: createWorkbenchConfig(current, studio) });
        }
      }
      if (active?.documentLoading && request.method === 'POST' && ['/api/spec', '/api/map', '/api/prd-map', '/api/review/submit'].includes(url.pathname)) {
        return json(response, 409, { error: '文档正在加载，请稍后重试保存；编辑内容保留' });
      }

      if (url.pathname === '/api/config' && request.method === 'GET') {
        if (!active) {
          return json(response, 409, {
            code: 'PROJECT_REQUIRED',
            error: '请先在项目中心确认页面、Product Spec 与映射文件来源',
          });
        }
        return json(response, 200, createWorkbenchConfig(active, studio));
      }

      if (url.pathname === '/api/launcher' && request.method === 'GET') {
        if (!studio) return json(response, 404, { error: '当前由 CLI 直接启动，不提供项目中心' });
        const state = await loadProjectState(statePath);
        const lastProject = state.projects.find(project => project.id === state.lastProjectId) || null;
        const bootstrap = pendingLauncherBootstrap;
        return json(response, 200, {
          recentProjects: state.projects,
          lastProject,
          bootstrap,
          gateSession: Boolean(options.gate),
          warning: state.warning || '',
          defaults: {
            projectPath: process.cwd(),
            sourceType: 'directory',
            mapPolicy: 'tool',
            mode: 'map',
          },
        });
      }

      if (url.pathname === '/api/fs/list' && request.method === 'GET') {
        if (!studio) return json(response, 404, { error: '当前模式不提供路径选择器' });
        const listing = await listLocalPath(url.searchParams.get('path') || '', url.searchParams.get('kind') || 'directory');
        return json(response, 200, listing);
      }

      if (url.pathname === '/api/codex/models' && request.method === 'GET') {
        if (!studio) return json(response, 404, { error: '当前模式不提供 Codex 模型选择' });
        const now = Date.now();
        if (!codexModelsCache || now - codexModelsCache.loadedAt > 60_000) {
          const models = await codexModelLister({ codexPath: options.codexPath || '' });
          codexModelsCache = { loadedAt: now, models };
        }
        return json(response, 200, { models: codexModelsCache.models });
      }

      if (url.pathname === '/api/project/scan' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供项目扫描' });
        const body = JSON.parse(await readBody(request));
        if (body.sourceType === 'dev' || body.devUrl) return json(response, 400, { error: '开发地址接入已移除，请选择本地 HTML 页面包' });
        let discovery = await scanProjectDirectory(body.projectPath);
        const selectedSpecPath = String(body.specPath || '').trim()
          || (discovery.spec.length === 1 && discovery.spec[0].valid ? discovery.spec[0].path : '');
        discovery = await enrichDiscoveryMaps(discovery, selectedSpecPath);
        return json(response, 200, discovery);
      }

      if (url.pathname === '/api/project/save-draft' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不保存项目配置' });
        const body = JSON.parse(await readBody(request));
        if (!body.projectPath) return json(response, 400, { error: '请先填写项目路径' });
        const projectPath = resolve(body.projectPath);
        const projectInfo = await stat(projectPath);
        if (!projectInfo.isDirectory()) return json(response, 400, { error: '项目路径不是目录' });
        const project = normalizeStoredProject({
          ...body,
          id: projectIdFor({ ...body, projectPath }),
          name: String(body.name || '').trim() || basename(projectPath),
          projectPath,
          confirmTargetWrite: false,
        });
        const remembered = await rememberProject(statePath, project, { opened: false });
        return json(response, 200, { ok: true, project: remembered.project });
      }

      if (url.pathname === '/api/project/bootstrap/dismiss' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供项目启动上下文' });
        pendingLauncherBootstrap = null;
        return json(response, 200, { ok: true });
      }

      if (url.pathname === '/api/project/remove-preview' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供最近项目管理' });
        const body = JSON.parse(await readBody(request));
        const projectId = String(body.id || '').trim();
        if (!projectId) return json(response, 400, { error: '请选择要移除的最近项目' });
        if (active?.project?.id === projectId) {
          return json(response, 409, { error: '当前项目正在使用，请先离开工作台' });
        }
        const preview = await previewRecentProjectRemoval(statePath, projectId);
        return json(response, 200, {
          id: preview.project.id,
          name: preview.project.name,
          projectPath: preview.project.projectPath,
          mapPolicy: preview.project.mapPolicy,
          deleteToolMaps: preview.deleteToolMaps,
          mappingFileCount: preview.mappingFileCount,
          mappingCount: preview.mappingCount,
        });
      }

      if (url.pathname === '/api/project/remove' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供最近项目管理' });
        const body = JSON.parse(await readBody(request));
        const projectId = String(body.id || '').trim();
        if (!projectId) return json(response, 400, { error: '请选择要移除的最近项目' });
        if (active?.project?.id === projectId) {
          return json(response, 409, { error: '当前项目正在使用，请先离开工作台' });
        }
        const removed = await removeRecentProject(statePath, projectId, {
          confirmed: body.confirm === true,
        });
        return json(response, 200, {
          ok: true,
          id: projectId,
          deletedToolMaps: removed.mappingFileCount,
          deletedMappings: removed.mappingCount,
          recentProjects: removed.state.projects,
          lastProject: removed.nextLastProject,
        });
      }

      if (url.pathname === '/api/project/projection' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供工作台投影生成' });
        const body = JSON.parse(await readBody(request));
        const started = await projectionService.start(body);
        return json(response, started.statusCode, started.job);
      }

      if (url.pathname.startsWith('/api/project/projection/') && request.method === 'GET') {
        if (!studio) return json(response, 404, { error: '当前模式不提供工作台投影生成' });
        const jobId = decodeURIComponent(url.pathname.replace('/api/project/projection/', ''));
        const job = projectionService.get(jobId);
        if (!job) return json(response, 404, { error: '投影生成任务不存在' });
        return json(response, 200, job);
      }

      if (url.pathname.startsWith('/api/project/projection/') && request.method === 'DELETE') {
        if (!studio) return json(response, 404, { error: '当前模式不提供工作台投影生成' });
        const jobId = decodeURIComponent(url.pathname.replace('/api/project/projection/', ''));
        const job = await projectionService.cancel(jobId);
        if (!job) return json(response, 404, { error: '投影生成任务不存在' });
        return json(response, 200, job);
      }

      if (url.pathname === '/api/project/prd-draft' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供 PRD 草稿生成' });
        const body = JSON.parse(await readBody(request));
        const started = await prdDraftService.start(body);
        return json(response, started.statusCode, started.job);
      }

      if (url.pathname.startsWith('/api/project/prd-draft/') && request.method === 'GET') {
        if (!studio) return json(response, 404, { error: '当前模式不提供 PRD 草稿生成' });
        const jobId = decodeURIComponent(url.pathname.replace('/api/project/prd-draft/', ''));
        const job = prdDraftService.get(jobId);
        if (!job) return json(response, 404, { error: 'PRD 草稿任务不存在' });
        return json(response, 200, job);
      }

      if (url.pathname.startsWith('/api/project/prd-draft/') && request.method === 'DELETE') {
        if (!studio) return json(response, 404, { error: '当前模式不提供 PRD 草稿生成' });
        const jobId = decodeURIComponent(url.pathname.replace('/api/project/prd-draft/', ''));
        const job = await prdDraftService.cancel(jobId);
        if (!job) return json(response, 404, { error: 'PRD 草稿任务不存在' });
        return json(response, 200, job);
      }

      if (url.pathname === '/api/project/confirm' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供项目确认' });
        const body = JSON.parse(await readBody(request));
        const prepared = await prepareStudioProject(body, statePath);
        if (options.gate) {
          if (prepared.mode !== 'map') {
            return json(response, 400, { error: 'Codex 修订会话只支持可编辑映射模式' });
          }
          if (!prepared.sourceSpecPath) {
            return json(response, 400, { error: 'Codex 修订会话必须确认原始 Markdown Spec' });
          }
          prepared.gate = true;
        }
        active = prepared;
        pendingLauncherBootstrap = null;
        return json(response, 200, createWorkbenchConfig(active, true));
      }

      if (url.pathname === '/api/project/reopen' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供项目恢复' });
        const body = JSON.parse(await readBody(request));
        const projectId = String(body.id || '').trim();
        const state = await loadProjectState(statePath);
        const remembered = state.projects.find(project => project.id === projectId);
        if (!remembered) {
          return json(response, 404, { error: '最近项目配置不存在，请重新选择来源' });
        }
        const prepared = await prepareStudioProject({
          ...remembered,
          // “项目内创建”在首次进入时已经由用户确认。恢复只允许使用工具侧
          // 保存的同一条配置，不接受客户端提供新的写入路径。
          confirmTargetWrite: remembered.mapPolicy === 'project',
        }, statePath);
        if (options.gate) {
          if (prepared.mode !== 'map') {
            return json(response, 400, { error: 'Codex 修订会话只支持可编辑映射模式' });
          }
          if (!prepared.sourceSpecPath) {
            return json(response, 400, { error: 'Codex 修订会话必须确认原始 Markdown Spec' });
          }
          prepared.gate = true;
        }
        active = prepared;
        pendingLauncherBootstrap = null;
        return json(response, 200, createWorkbenchConfig(active, true));
      }

      if (url.pathname === '/api/project/close' && request.method === 'POST') {
        if (!studio) return json(response, 404, { error: '当前模式不提供项目中心' });
        active = null;
        return json(response, 200, { ok: true });
      }

      if (url.pathname === '/api/spec' && request.method === 'POST') {
        if (!active) return json(response, 409, { error: '请先确认项目来源' });
        const body = JSON.parse(await readBody(request));
        const result = await saveSpecNode(active, body);
        if (result.statusCode === 200) result.body.reviewBaseline = createReviewBaseline(active);
        return json(response, result.statusCode, result.body);
      }

      if (url.pathname === '/api/review/submit' && request.method === 'POST') {
        if (!active) return json(response, 409, { error: '请先确认项目来源' });
        if (decisionSettled) {
          return json(response, 409, { ok: false, error: '本次修订已经提交' });
        }
        const result = await prepareReviewSubmission(active);
        json(response, result.statusCode, result.body);
        if (result.statusCode === 200) {
          queueMicrotask(() => finishDecision(result.body.submission));
        }
        return;
      }

      if (url.pathname === '/api/review-package/prepare' && request.method === 'POST') {
        if (!active) return json(response, 409, { error: '请先确认项目来源' });
        if (active.target.type !== 'file') {
          return json(response, 409, {
            code: 'HTML_PACKAGE_REQUIRED',
            error: '本地开发地址不能直接导出。请先构建或选择可独立读取的 HTML 页面包',
          });
        }
        const exported = await createReviewPackage({
          appRoot,
          active,
          config: createWorkbenchConfig(active, false),
        });
        const id = randomUUID();
        const archiveInfo = await stat(exported.archivePath);
        const expiresAt = Date.now() + 10 * 60_000;
        const timeout = setTimeout(() => {
          preparedReviewPackages.delete(id);
          void exported.cleanup();
        }, 10 * 60_000);
        timeout.unref?.();
        preparedReviewPackages.set(id, { ...exported, archiveInfo, expiresAt, timeout });
        return json(response, 200, {
          id,
          filename: exported.filename,
          bytes: archiveInfo.size,
          fileCount: exported.manifest.fileCount,
          expiresAt: new Date(expiresAt).toISOString(),
        });
      }

      if (url.pathname.startsWith('/api/review-package/') && request.method === 'GET') {
        const id = decodeURIComponent(url.pathname.replace('/api/review-package/', ''));
        const exported = preparedReviewPackages.get(id);
        if (!exported || exported.expiresAt <= Date.now()) {
          if (exported) {
            clearTimeout(exported.timeout);
            preparedReviewPackages.delete(id);
            await exported.cleanup();
          }
          return json(response, 404, { error: '导出包不存在或已过期，请重新生成' });
        }
        clearTimeout(exported.timeout);
        preparedReviewPackages.delete(id);
        const fallbackName = 'interactive-product-spec-readonly-review.zip';
        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': exported.archiveInfo.size,
          'content-disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(exported.filename)}`,
          'cache-control': 'no-store',
          'x-review-filename': encodeURIComponent(exported.filename),
        });
        const stream = createReadStream(exported.archivePath);
        let cleaned = false;
        const cleanup = async () => {
          if (cleaned) return;
          cleaned = true;
          await exported.cleanup().catch(() => {});
        };
        stream.once('error', error => {
          response.destroy(error);
          void cleanup();
        });
        response.once('finish', () => void cleanup());
        response.once('close', () => void cleanup());
        stream.pipe(response);
        return;
      }

      if (url.pathname === '/api/map' && request.method === 'POST') {
        if (!active) return json(response, 409, { error: '请先确认项目来源' });
        if (active.mode !== 'map') return json(response, 403, { ok: false, error: '只读查看模式不能保存映射' });
        if (!active.mapPath) return json(response, 409, { ok: false, error: '当前项目没有 Spec，不存在可保存的 spec-map.json' });
        const body = JSON.parse(await readBody(request));
        try {
          const saved = await saveSpecMap({
            mapPath: active.mapPath,
            bundle: active.bundle,
            nextMap: body.specMap,
            baseRevision: body.baseRevision,
          });
          if (!saved.ok) return json(response, 400, { ok: false, errors: saved.errors });
          active.map = saved.map;
          active.mapRevision = saved.revision;
          return json(response, 200, {
            ok: true,
            updatedAt: saved.map.updatedAt,
            mapRevision: saved.revision,
            reviewBaseline: createReviewBaseline(active),
          });
        } catch (error) {
          if (error.code === 'MAP_CHANGED') {
            return json(response, 409, { ok: false, code: error.code, error: error.message });
          }
          throw error;
        }
      }

      if (url.pathname === '/api/prd-map' && request.method === 'POST') {
        if (!active) return json(response, 409, { error: '请先确认项目来源' });
        if (active.mode !== 'map') return json(response, 403, { ok: false, error: '只读查看模式不能保存 PRD 页面关联' });
        if (!active.prdDocument || !active.prdMapPath) {
          return json(response, 409, { ok: false, error: '当前项目没有可映射 PRD' });
        }
        const body = JSON.parse(await readBody(request));
        try {
          const saved = await savePrdMap({
            mapPath: active.prdMapPath,
            prdDocument: active.prdDocument,
            nextMap: body.prdMap,
            baseRevision: body.baseRevision,
          });
          if (!saved.ok) return json(response, 400, { ok: false, errors: saved.errors });
          active.prdMap = saved.map;
          active.prdMapRevision = saved.revision;
          active.prdMapStale = false;
          active.missingPrdSectionIds = [];
          return json(response, 200, {
            ok: true,
            updatedAt: saved.map.updatedAt,
            prdMapRevision: saved.revision,
            reviewBaseline: createReviewBaseline(active),
          });
        } catch (error) {
          if (error instanceof PrdMapRevisionConflictError || error.code === 'PRD_MAP_CHANGED') {
            return json(response, 409, { ok: false, code: error.code, error: error.message });
          }
          throw error;
        }
      }

      if (url.pathname.startsWith('/target/')) {
        if (!active || active.target.type !== 'file') return json(response, 404, { error: '当前项目没有本地 HTML 目标' });
        const path = safePath(active.target.root, url.pathname, /^\/target\/?/);
        if (!path) return json(response, 403, { error: '目标路径越界' });
        return await serveFile(response, path);
      }

      if (url.pathname.startsWith('/target-dev/')) return json(response, 410, { error: '开发地址接入已移除' });

      if (url.pathname === '/') {
        return await serveFile(response, resolve(editorRoot, 'index.html'));
      }

      if (url.pathname.startsWith('/studio-assets/')) {
        const path = safePath(editorRoot, url.pathname, /^\/studio-assets\/?/);
        if (!path) return json(response, 403, { error: '资源路径越界' });
        return await serveFile(response, path);
      }

      if (active?.target.type === 'file') {
        const path = safePath(active.target.root, url.pathname);
        if (!path) return json(response, 403, { error: '目标路径越界' });
        return await serveFile(response, path);
      }

      return json(response, 404, { error: '资源不存在' });
    } catch (error) {
      if (error.code === 'ENOENT') return json(response, 404, { error: '资源不存在' });
      if (error instanceof SyntaxError) return json(response, 400, { error: `JSON 格式错误：${error.message}` });
      return json(response, error.status || 400, { error: error.message });
    }
  });
  server.once('close', () => {
    void runtime?.dispose();
    initialActive?.prdReview?.close();
    projectionService.shutdown();
    prdDraftService.shutdown();
    for (const exported of preparedReviewPackages.values()) {
      clearTimeout(exported.timeout);
      void exported.cleanup();
    }
    preparedReviewPackages.clear();
  });

  const listen = port => new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, options.host, resolveListen);
  });
  let usedFallbackPort = false;
  try {
    await listen(options.port);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || options.fallbackToAvailablePort !== true) throw error;
    usedFallbackPort = true;
    await listen(0);
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const url = `http://${options.host}:${port}/`;
  try { runtime = await createWorkbenchRuntime({ statePath, url, key: options.runtimeKey,
    kind: options.gate ? 'gate' : initialActive?.prdReview ? 'prd-review' : 'normal',
    describe: () => ({ key: runtimeKeyFor(active, pendingLauncherBootstrap), name: active?.project?.name || active?.bundle?.product?.title || pendingLauncherBootstrap?.draft?.projectPath?.split('/').pop() || '项目中心', state: !readinessChecked ? 'starting' : active ? 'ready' : 'waiting', blockReason: projectionService.isBusy() || prdDraftService.isBusy() ? '文档生成任务正在运行，请完成或取消后再关闭' : active && createWorkbenchConfig(active, studio).draftChangeCount ? '存在未提交的 Spec 草稿，请在原工作台提交或放弃后再关闭' : active?.prdReview && active.prdReview.view().status !== 'ended' ? '请先在原工作台结束 PRD 评审，再关闭实例' : active?.documentLoading ? '文档正在加载，请稍后重试' : '' }),
    close: async () => { finishDecision({ cancelled: true, changes: [] }); server.close(); server.closeAllConnections(); },
  }); } catch (error) { server.close(); server.closeAllConnections(); throw error; }
  try {
    const check = await fetch(url + 'api/runtime', { signal: AbortSignal.timeout(3000) });
    if (!check.ok || (await check.json()).id !== runtime.id) throw new Error('工作台启动检查失败');
    const html = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!html.ok) throw new Error('工作台页面未能载入，请重新构建后启动');
    await html.arrayBuffer();
    readinessChecked = true;
  } catch (error) { server.close(); server.closeAllConnections(); await runtime.dispose(); throw error; }
  return {
    server,
    url,
    statePath,
    usedFallbackPort,
    bundle: active?.bundle,
    mapPath: active?.mapPath,
    waitForDecision: () => decision,
    stop: () => new Promise((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
    }),
  };
};

export async function startWorkbench(options) {
  const active = await prepareDirectWorkbench(options);
  // Direct map/review sessions still expose the launcher so the user can
  // leave the current workbench and choose another project or file.
  return await startServer(options, active, true);
}

export async function startPrdReviewWorkbench(options) {
  const sources = await resolvePrdReviewSources(options);
  const statePath = resolve(options.statePath || defaultStatePath());
  const active = await prepareStudioProject({ ...sources, sourceType: 'html', mode: 'review' }, statePath, { annotationReview: true });
  const prdReview = await createPrdReviewService({ active, statePath, resumeSessionId: options.resumeSessionId });
  active.prdReview = prdReview;
  const workbench = await startServer({ ...options, statePath, host: '127.0.0.1', port: options.port || 0 }, active, false);
  return { ...workbench, prdReview };
}

export async function startStudio(options) {
  return await startServer(options, null, true);
}

export async function startGateStudio(options) {
  const statePath = resolve(options.statePath || defaultStatePath());
  const resolution = await resolveSmartLaunch({
    projectPath: options.projectPath || process.cwd(),
    htmlPath: options.htmlPath || '',
    devUrl: options.devUrl || '',
    initialRoute: options.initialRoute || '',
    mode: 'map',
  });
  const draft = {
    ...resolution.draft,
    projectPath: resolve(options.projectPath || resolution.draft.projectPath),
    sourceType: options.devUrl ? 'dev' : options.htmlPath ? 'html' : resolution.draft.sourceType,
    htmlPath: options.htmlPath ? resolve(options.htmlPath) : resolution.draft.htmlPath,
    devUrl: options.devUrl || resolution.draft.devUrl,
    specPath: options.specPath ? resolve(options.specPath) : resolution.draft.specPath,
    sourceSpecPath: options.sourceSpecPath ? resolve(options.sourceSpecPath) : resolution.draft.sourceSpecPath,
    mapPath: options.mapPath ? resolve(options.mapPath) : resolution.draft.mapPath,
    mapPolicy: options.mapPath ? 'existing' : resolution.draft.mapPolicy,
    mode: 'map',
    initialRoute: options.initialRoute || resolution.draft.initialRoute,
  };
  const bootstrap = {
    reason: resolution.reason === 'ready' ? 'ambiguous' : resolution.reason,
    step: draft.projectPath ? 2 : 1,
    draft,
    discovery: resolution.discovery,
    notice: resolution.reason === 'ready'
      ? 'Codex 修订会话已就绪。请在进入前确认本次 HTML、Markdown Spec、工作台视图和映射文件。'
      : resolution.bootstrap?.notice || '请先确认本次页面与 Spec 来源。',
  };
  const result = await startServer(
    { ...options, statePath, gate: true, fallbackToAvailablePort: true },
    null,
    true,
    bootstrap,
  );
  return { ...result, launch: { ...resolution, kind: 'confirm', draft, bootstrap } };
}

export async function startSmartStudio(options) {
  const statePath = resolve(options.statePath || defaultStatePath());
  const resolution = await resolveSmartLaunch({
    projectPath: options.projectPath || process.cwd(),
    htmlPath: options.htmlPath || '',
    devUrl: options.devUrl || '',
    initialRoute: options.initialRoute || '',
    mode: options.mode || 'map',
  });
  const active = resolution.kind === 'direct'
    ? await prepareStudioProject(resolution.draft, statePath)
    : null;
  const result = await startServer(
    { ...options, statePath, fallbackToAvailablePort: true },
    active,
    true,
    resolution.bootstrap || null,
  );
  return { ...result, launch: resolution };
}
