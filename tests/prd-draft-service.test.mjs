import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPrdDraftService, prdDraftPathFor } from '../src/prd-draft-service.mjs';

const validPrd = `# 测试产品需求文档

<!-- prd-profile: 可映射PRD-v1 -->

> 文档状态：草稿
> 适用版本：v0.1

## 4. 详细功能说明

### 4.1 任务管理

#### 4.1.1 新建任务
<!-- prd-section-id: 需求-任务管理-新建任务 -->

##### 功能说明
创建任务。

##### 入口与页面
从任务页进入。

##### 用户操作与产品结果
用户提交后看到新任务。

##### 必要规则
标题不能为空。

## 5. 全局产品规则

### 5.1 当前任务
<!-- prd-section-id: 规则-任务上下文-当前任务 -->

操作作用于当前任务。
`;

const waitForJob = async (service, id) => {
  for (let count = 0; count < 100; count += 1) {
    const job = service.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolveWait => setTimeout(resolveWait, 5));
  }
  throw new Error('等待 PRD 草稿任务超时');
};

test('PRD 草稿任务保留原件、写入固定 Draft 路径并在完成前重新校验', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-prd-draft-'));
  const statePath = join(temp, '.tool-state', 'projects.json');
  const sourcePrdPath = join(temp, '测试产品需求文档.md');
  const original = '# 测试产品需求文档\n\n## 4. 详细功能说明\n';
  await writeFile(sourcePrdPath, original, 'utf8');
  let generatorInput;
  const service = await createPrdDraftService({
    statePath,
    generator: async input => {
      generatorInput = input;
      input.onThreadCreated({
        threadId: 'thread-prd-draft',
        threadTitle: 'PRD 标准化草稿 · 测试产品需求文档',
        model: input.model,
        effort: input.effort,
      });
      await writeFile(input.draftPath, validPrd, 'utf8');
      return {
        threadId: 'thread-prd-draft',
        threadTitle: 'PRD 标准化草稿 · 测试产品需求文档',
        model: input.model,
        effort: input.effort,
      };
    },
  });
  const started = await service.start({
    projectPath: temp,
    sourcePrdPath,
    model: 'gpt-5.6-terra',
    effort: 'high',
  });
  const completed = await waitForJob(service, started.job.id);
  const canonicalTemp = await realpath(temp);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.threadId, 'thread-prd-draft');
  assert.equal(completed.draftPath, join(canonicalTemp, 'drafts-documents', '测试产品需求文档.md'));
  assert.ok(completed.draftRevision);
  assert.equal(generatorInput.draftPath, completed.draftPath);
  assert.equal(await readFile(sourcePrdPath, 'utf8'), original);
  assert.equal(await readFile(completed.draftPath, 'utf8'), validPrd);
});

test('原件已在 drafts-documents 时使用独立标准化草稿路径', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-prd-draft-path-'));
  const sourcePrdPath = join(temp, 'drafts-documents', '测试产品需求文档.md');
  await mkdir(dirname(sourcePrdPath), { recursive: true });
  await writeFile(sourcePrdPath, '# 原始文档\n', 'utf8');

  assert.equal(
    prdDraftPathFor(temp, sourcePrdPath),
    join(temp, 'drafts-documents', '测试产品需求文档-标准化草稿.md'),
  );
});

test('Codex 未生成合格 PRD 时任务失败且原件不变', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-prd-draft-invalid-'));
  const statePath = join(temp, '.tool-state', 'projects.json');
  const sourcePrdPath = join(temp, '测试产品需求文档.md');
  const original = '# 测试产品需求文档\n';
  await writeFile(sourcePrdPath, original, 'utf8');
  const service = await createPrdDraftService({
    statePath,
    generator: async input => {
      await writeFile(input.draftPath, '# 仍然不合格\n', 'utf8');
      return {};
    },
  });
  const started = await service.start({
    projectPath: temp,
    sourcePrdPath,
    model: 'gpt-5.6-terra',
    effort: 'medium',
  });
  const failed = await waitForJob(service, started.job.id);

  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /PRD 格式不符合可映射合同/);
  assert.equal(await readFile(sourcePrdPath, 'utf8'), original);
});

test('服务重启后保留 PRD 草稿任务的可见 Codex 对话入口', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-prd-draft-recovery-'));
  const statePath = join(temp, '.tool-state', 'projects.json');
  const jobsDirectory = join(dirname(statePath), 'prd-draft-jobs');
  const id = 'prd-draft-restart-test';
  const now = new Date().toISOString();
  await mkdir(jobsDirectory, { recursive: true });
  await writeFile(join(jobsDirectory, `${id}.json`), `${JSON.stringify({
    id,
    key: 'source\nrevision\ndraft\nmodel\neffort',
    status: 'running',
    message: 'Codex 对话已创建，正在整理标准化 PRD 草稿',
    error: '',
    sourcePrdPath: join(temp, '产品需求文档.md'),
    sourcePrdRevision: 'revision',
    draftPath: join(temp, 'drafts-documents', '产品需求文档.md'),
    draftRevision: '',
    threadId: 'thread-prd-visible-001',
    threadTitle: 'PRD 标准化草稿 · 产品需求文档',
    model: 'gpt-test',
    effort: 'high',
    createdAt: now,
    updatedAt: now,
  }, null, 2)}\n`, 'utf8');

  const service = await createPrdDraftService({
    statePath,
    generator: async () => {
      throw new Error('恢复历史任务时不应重新调用生成器');
    },
  });
  const recovered = service.get(id);

  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.threadId, 'thread-prd-visible-001');
  assert.match(recovered.message, /服务重启/);
  assert.match(recovered.error, /打开已创建的 Codex 对话/);
});
