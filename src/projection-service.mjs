import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { validateSpecBundle } from './contracts.mjs';
import { projectIdFor } from './project-store.mjs';
import { validateSpecProjectionIntegrity } from './spec-projection-integrity.mjs';

const hashText = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

const publicJob = job => ({
  id: job.id,
  status: job.status,
  message: job.message,
  error: job.error || '',
  sourceSpecPath: job.sourceSpecPath,
  sourceSpecRevision: job.sourceSpecRevision,
  specPath: job.specPath || '',
  threadId: job.threadId || '',
  threadTitle: job.threadTitle || '',
  model: job.model || '',
  effort: job.effort || '',
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const normalizeBundle = value => JSON.parse(
  JSON.stringify(value, (_key, item) => item === null ? undefined : item),
);

const errorMessage = error => {
  const raw = error?.message || String(error);
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch {
    return raw;
  }
};

const assertFile = async (path, label, extensions) => {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} 不是文件`);
  if (extensions && !extensions.includes(extname(path).toLowerCase())) {
    throw new Error(`${label} 文件类型不受支持`);
  }
};

const readMarkdown = async path => {
  const source = await readFile(path, 'utf8');
  if (!source.trim()) throw new Error('原始 Spec 文档不能为空');
  return { source, revision: hashText(source) };
};

const readBundle = async path => {
  const source = await readFile(path, 'utf8');
  const bundle = JSON.parse(source);
  const errors = validateSpecBundle(bundle);
  if (errors.length) throw new Error(`Spec bundle 校验失败：\n- ${errors.join('\n- ')}`);
  return bundle;
};

export async function createProjectionService({
  statePath,
  outputSchema,
  generator,
  timeoutMs = 8 * 60_000,
  codexPath = '',
  skillPath = '',
}) {
  const jobs = new Map();
  const controllers = new Map();
  const persistQueues = new Map();
  const jobsDirectory = join(dirname(statePath), 'projection-jobs');
  await mkdir(jobsDirectory, { recursive: true });

  const persist = job => {
    const snapshot = JSON.stringify(job, null, 2);
    const previous = persistQueues.get(job.id) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const path = join(jobsDirectory, `${job.id}.json`);
      const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${snapshot}\n`, 'utf8');
      await rename(temporaryPath, path);
    });
    persistQueues.set(job.id, current);
    return current.finally(() => {
      if (persistQueues.get(job.id) === current) persistQueues.delete(job.id);
    });
  };

  for (const name of await readdir(jobsDirectory)) {
    if (!name.endsWith('.json')) continue;
    try {
      const job = JSON.parse(await readFile(join(jobsDirectory, name), 'utf8'));
      if (!job?.id) continue;
      if (['queued', 'running'].includes(job.status)) {
        job.status = 'failed';
        job.message = '投影任务因本地服务重启而中断';
        job.error = job.threadId
          ? '可打开已创建的 Codex 对话查看结果，或在项目中心重新生成工作台视图'
          : '请在项目中心重新生成工作台视图';
        job.updatedAt = new Date().toISOString();
        await persist(job);
      }
      jobs.set(job.id, job);
    } catch {
      // 损坏的单条历史任务不会阻断工作台启动。
    }
  }

  const start = async input => {
    const projectPath = resolve(String(input.projectPath || '').trim());
    const projectInfo = await stat(projectPath);
    if (!projectInfo.isDirectory()) throw new Error('项目路径不是目录');

    const sourceSpecPath = resolve(String(input.sourceSpecPath || '').trim());
    if (!inside(projectPath, sourceSpecPath)) {
      throw new Error('原始 Spec 文档必须位于当前项目目录');
    }
    await assertFile(sourceSpecPath, '原始 Spec 文档', ['.md', '.markdown']);
    const { source, revision: sourceSpecRevision } = await readMarkdown(sourceSpecPath);
    const model = String(input.model || '').trim();
    const effort = String(input.effort || '').trim();
    if (model && !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) {
      throw new Error('Codex 模型标识无效');
    }
    if (effort && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) {
      throw new Error('Codex 推理强度无效');
    }

    let htmlPath = '';
    if (input.sourceType !== 'dev' && String(input.htmlPath || '').trim()) {
      htmlPath = resolve(String(input.htmlPath).trim());
      if (!inside(projectPath, htmlPath)) {
        throw new Error('HTML 页面证据必须位于当前项目目录');
      }
      await assertFile(htmlPath, 'HTML 入口', ['.html', '.htm']);
    }

    const projectId = projectIdFor({
      projectPath,
      sourceType: input.sourceType,
      htmlPath,
      devUrl: input.devUrl || '',
    });
    const projectionDirectory = join(dirname(statePath), 'projections', projectId);
    const specPath = join(projectionDirectory, 'product.spec.json');
    const metadataPath = join(projectionDirectory, 'projection.json');
    const key = `${sourceSpecPath}\n${sourceSpecRevision}\n${htmlPath}\n${model}\n${effort}`;

    const running = [...jobs.values()].find(job =>
      job.key === key && ['queued', 'running'].includes(job.status));
    if (running) return { statusCode: 202, job: publicJob(running) };

    if (input.force !== true) {
      try {
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        if (
          metadata.sourceSpecPath === sourceSpecPath
          && metadata.sourceSpecRevision === sourceSpecRevision
          && metadata.htmlPath === htmlPath
          && metadata.model === model
          && metadata.effort === effort
          && metadata.conversationMode === 'visible-app-server'
        ) {
          const bundle = await readBundle(specPath);
          const integrityErrors = validateSpecProjectionIntegrity(source, bundle);
          if (integrityErrors.length) throw new Error(integrityErrors.join('\n'));
          const now = new Date().toISOString();
          const cached = {
            id: randomUUID(),
            key,
            status: 'completed',
            message: '已复用与当前 Markdown 一致的工作台视图',
            error: '',
            sourceSpecPath,
            sourceSpecRevision,
            specPath,
            threadId: metadata.threadId || '',
            threadTitle: metadata.threadTitle || '',
            model: metadata.model || '',
            effort: metadata.effort || '',
            createdAt: now,
            updatedAt: now,
            bundleId: bundle.product.id,
          };
          jobs.set(cached.id, cached);
          await persist(cached);
          return { statusCode: 200, job: publicJob(cached) };
        }
      } catch {
        // 缓存缺失、损坏或已不符合当前契约时重新生成。
      }
    }

    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      key,
      status: 'queued',
      message: '正在创建可在 Codex 中查看的对话',
      error: '',
      sourceSpecPath,
      sourceSpecRevision,
      specPath: '',
      threadId: '',
      threadTitle: '',
      model,
      effort,
      createdAt: now,
      updatedAt: now,
    };
    const controller = new AbortController();
    jobs.set(job.id, job);
    controllers.set(job.id, controller);
    await persist(job);

    queueMicrotask(async () => {
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        job.status = 'running';
        job.message = 'Codex 正在创建可见对话';
        job.updatedAt = new Date().toISOString();
        await persist(job);
        const generated = await generator({
          projectPath,
          sourceSpecPath,
          htmlPath,
          outputSchema,
          model,
          effort,
          signal: controller.signal,
          codexPath,
          skillPath,
          onThreadCreated: thread => {
            job.threadId = thread.threadId || '';
            job.threadTitle = thread.threadTitle || '';
            job.model = thread.model || model;
            job.effort = thread.effort || effort;
            job.message = 'Codex 对话已创建，正在生成临时工作台视图';
            job.updatedAt = new Date().toISOString();
            void persist(job);
          },
        });
        const bundle = normalizeBundle(generated.bundle);
        const errors = validateSpecBundle(bundle);
        if (errors.length) {
          throw new Error(`Codex 生成的工作台视图未通过契约校验：\n- ${errors.join('\n- ')}`);
        }
        const currentSource = await readMarkdown(sourceSpecPath);
        if (currentSource.revision !== sourceSpecRevision) {
          throw new Error('生成期间原始 Markdown Spec 已发生变化，请重新生成');
        }
        const integrityErrors = validateSpecProjectionIntegrity(currentSource.source, bundle);
        if (integrityErrors.length) {
          throw new Error(`工作台投影与原始 Spec 不一致：\n- ${integrityErrors.join('\n- ')}`);
        }
        await mkdir(projectionDirectory, { recursive: true });
        const temporarySpecPath = `${specPath}.${process.pid}.${job.id}.tmp`;
        const temporaryMetadataPath = `${metadataPath}.${process.pid}.${job.id}.tmp`;
        await writeFile(temporarySpecPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
        await writeFile(temporaryMetadataPath, `${JSON.stringify({
          schemaVersion: 1,
          sourceSpecPath,
          sourceSpecRevision,
          htmlPath,
          conversationMode: 'visible-app-server',
          threadId: generated.threadId || '',
          threadTitle: generated.threadTitle || job.threadTitle || '',
          model: generated.model || job.model || model,
          effort: generated.effort || job.effort || effort,
          generatedAt: new Date().toISOString(),
        }, null, 2)}\n`, 'utf8');
        await rename(temporarySpecPath, specPath);
        await rename(temporaryMetadataPath, metadataPath);
        job.status = 'completed';
        job.message = '工作台视图已生成并通过校验';
        job.specPath = specPath;
        job.threadId = generated.threadId || '';
        job.threadTitle = generated.threadTitle || job.threadTitle || '';
        job.model = generated.model || job.model || model;
        job.effort = generated.effort || job.effort || effort;
        job.updatedAt = new Date().toISOString();
      } catch (error) {
        if (controller.signal.aborted) {
          job.status = 'cancelled';
          job.message = '已取消生成工作台视图';
        } else {
          job.status = 'failed';
          job.message = '工作台视图生成失败';
          job.error = errorMessage(error);
        }
        job.updatedAt = new Date().toISOString();
      } finally {
        clearTimeout(timer);
        controllers.delete(job.id);
        await persist(job);
      }
    });

    return { statusCode: 202, job: publicJob(job) };
  };

  const get = id => jobs.has(id) ? publicJob(jobs.get(id)) : null;

  const cancel = async id => {
    const job = jobs.get(id);
    if (!job) return null;
    if (['queued', 'running'].includes(job.status)) {
      controllers.get(id)?.abort();
      job.status = 'cancelled';
      job.message = '已取消生成工作台视图';
      job.updatedAt = new Date().toISOString();
      await persist(job);
    }
    return publicJob(job);
  };

  const shutdown = () => {
    for (const controller of controllers.values()) controller.abort();
  };

  return { start, get, cancel, shutdown, isBusy: () => [...jobs.values()].some(job => ['queued', 'running'].includes(job.status)) };
}
