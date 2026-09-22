import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, parse, resolve, sep } from 'node:path';
import { readPrdDocument } from './prd-service.mjs';

const hashText = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

const publicJob = job => ({
  id: job.id,
  status: job.status,
  message: job.message,
  error: job.error || '',
  sourcePrdPath: job.sourcePrdPath,
  sourcePrdRevision: job.sourcePrdRevision,
  draftPath: job.draftPath || '',
  draftRevision: job.draftRevision || '',
  threadId: job.threadId || '',
  threadTitle: job.threadTitle || '',
  model: job.model || '',
  effort: job.effort || '',
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

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

const readSource = async path => {
  const source = await readFile(path, 'utf8');
  if (!source.trim()) throw new Error('原始 PRD 不能为空');
  return { source, revision: hashText(source) };
};

export const prdDraftPathFor = (projectPath, sourcePrdPath) => {
  const draftsDirectory = join(projectPath, 'drafts-documents');
  const sourceName = basename(sourcePrdPath);
  const defaultPath = join(draftsDirectory, sourceName);
  if (resolve(defaultPath) !== resolve(sourcePrdPath)) return defaultPath;
  const name = parse(sourceName);
  return join(draftsDirectory, `${name.name}-标准化草稿${name.ext || '.md'}`);
};

export async function createPrdDraftService({
  statePath,
  generator,
  timeoutMs = 12 * 60_000,
  codexPath = '',
  skillPath = '',
}) {
  const jobs = new Map();
  const controllers = new Map();
  const persistQueues = new Map();
  const jobsDirectory = join(dirname(statePath), 'prd-draft-jobs');
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
        job.message = 'PRD 草稿任务因本地服务重启而中断';
        job.error = job.threadId
          ? '可打开已创建的 Codex 对话查看结果，或在项目中心重新生成草稿'
          : '请在项目中心重新生成 PRD 草稿';
        job.updatedAt = new Date().toISOString();
        await persist(job);
      }
      jobs.set(job.id, job);
    } catch {
      // 损坏的单条历史任务不会阻断工作台启动。
    }
  }

  const start = async input => {
    const requestedProjectPath = String(input.projectPath || '').trim();
    const requestedSourcePrdPath = String(input.sourcePrdPath || '').trim();
    if (!requestedProjectPath) throw new Error('请选择当前项目目录');
    if (!requestedSourcePrdPath) throw new Error('请选择需要标准化的原始 PRD');
    const projectPath = await realpath(resolve(requestedProjectPath));
    const projectInfo = await stat(projectPath);
    if (!projectInfo.isDirectory()) throw new Error('项目路径不是目录');

    const sourcePrdPath = await realpath(resolve(requestedSourcePrdPath));
    if (!inside(projectPath, sourcePrdPath)) {
      throw new Error('原始 PRD 必须位于当前项目目录');
    }
    await assertFile(sourcePrdPath, '原始 PRD', ['.md', '.markdown']);
    const { revision: sourcePrdRevision } = await readSource(sourcePrdPath);
    const parsedSource = await readPrdDocument(sourcePrdPath, { requireValid: false });
    if (parsedSource.valid) throw new Error('当前 PRD 已符合可映射合同，无需生成标准化草稿');

    const model = String(input.model || '').trim();
    const effort = String(input.effort || '').trim();
    if (!model || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) {
      throw new Error('请选择有效的 Codex 模型');
    }
    if (!['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) {
      throw new Error('请选择有效的 Codex 推理强度');
    }

    const draftPath = prdDraftPathFor(projectPath, sourcePrdPath);
    const draftsDirectory = join(projectPath, 'drafts-documents');
    if (!inside(draftsDirectory, draftPath) || resolve(draftPath) === sourcePrdPath) {
      throw new Error('PRD 草稿目标必须是 drafts-documents/ 下的新文件');
    }
    await mkdir(draftsDirectory, { recursive: true });

    const key = `${sourcePrdPath}\n${sourcePrdRevision}\n${draftPath}\n${model}\n${effort}`;
    const running = [...jobs.values()].find(job =>
      job.key === key && ['queued', 'running'].includes(job.status));
    if (running) return { statusCode: 202, job: publicJob(running) };

    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      key,
      status: 'queued',
      message: '正在创建可在 Codex 中查看的 PRD 草稿任务',
      error: '',
      sourcePrdPath,
      sourcePrdRevision,
      draftPath,
      draftRevision: '',
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
        job.message = 'Codex 正在生成标准化 PRD 草稿';
        job.updatedAt = new Date().toISOString();
        await persist(job);
        const generated = await generator({
          projectPath,
          sourcePrdPath,
          draftPath,
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
            job.message = 'Codex 对话已创建，正在整理标准化 PRD 草稿';
            job.updatedAt = new Date().toISOString();
            void persist(job);
          },
        });
        const currentSource = await readSource(sourcePrdPath);
        if (currentSource.revision !== sourcePrdRevision) {
          throw new Error('生成期间原始 PRD 已发生变化，请重新检查后再生成');
        }
        const parsedDraft = await readPrdDocument(draftPath, { requireValid: true });
        job.status = 'completed';
        job.message = 'PRD 标准化草稿已生成并通过格式校验';
        job.draftRevision = parsedDraft.document.revision;
        job.threadId = generated.threadId || job.threadId || '';
        job.threadTitle = generated.threadTitle || job.threadTitle || '';
        job.model = generated.model || job.model || model;
        job.effort = generated.effort || job.effort || effort;
        job.updatedAt = new Date().toISOString();
      } catch (error) {
        if (controller.signal.aborted) {
          job.status = 'cancelled';
          job.message = '已取消生成 PRD 草稿';
        } else {
          job.status = 'failed';
          job.message = 'PRD 标准化草稿生成失败';
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
      job.message = '已取消生成 PRD 草稿';
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
