import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createProjectionService } from '../src/projection-service.mjs';

const root = resolve(import.meta.dirname, '..');

test('服务重启后仍可恢复投影任务与可见 Codex 对话入口', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-projection-recovery-'));
  const statePath = join(temp, 'tool-state', 'projects.json');
  const jobsDirectory = join(dirname(statePath), 'projection-jobs');
  const id = 'job-restart-test';
  const now = new Date().toISOString();
  await mkdir(jobsDirectory, { recursive: true });
  await writeFile(join(jobsDirectory, `${id}.json`), `${JSON.stringify({
    id,
    key: 'source\nrevision\nhtml\nmodel\neffort',
    status: 'running',
    message: 'Codex 对话已创建，正在生成临时工作台视图',
    error: '',
    sourceSpecPath: join(temp, 'product.spec.md'),
    sourceSpecRevision: 'revision',
    specPath: '',
    threadId: 'thread-visible-001',
    threadTitle: 'Interactive Product Spec · recovery',
    model: 'gpt-test',
    effort: 'medium',
    createdAt: now,
    updatedAt: now,
  }, null, 2)}\n`, 'utf8');

  const outputSchema = JSON.parse(await readFile(
    resolve(root, 'schemas/product-spec-projection-output.schema.json'),
    'utf8',
  ));
  const service = await createProjectionService({
    statePath,
    outputSchema,
    generator: async () => {
      throw new Error('恢复历史任务时不应重新调用生成器');
    },
  });

  const recovered = service.get(id);
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.threadId, 'thread-visible-001');
  assert.match(recovered.message, /服务重启/);
  assert.match(recovered.error, /打开已创建的 Codex 对话/);

  const persisted = JSON.parse(await readFile(join(jobsDirectory, `${id}.json`), 'utf8'));
  assert.equal(persisted.status, 'failed');
  assert.equal(persisted.threadId, 'thread-visible-001');
});

test('漏掉普通操作的投影失败且不覆盖有效结果，损坏缓存不能被复用', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-projection-completeness-'));
  const sourceSpecPath = join(temp, 'product.spec.md');
  const source = '# Spec\n## MODULE `TASK`：任务\n### 编辑页\n#### ACTION `SAVE`：保存\n- 产品结果：保存修改。\n#### ACTION `CANCEL`：取消\n- 产品结果：丢弃修改。\n';
  await writeFile(sourceSpecPath, source);
  const complete = {
    schemaVersion: '0.1', product: { id: 'TASK', title: '任务', version: '1', status: 'draft' },
    modules: [{ id: 'TASK-MODULE', title: '任务', purpose: '任务编辑', nodes: ['SAVE', 'CANCEL'].map(id => ({
      id, type: 'ACTION', title: id, status: 'draft', sourceKind: 'formal-source', anchorHints: [],
    })) }],
  };
  let omitCancel = false;
  let calls = 0;
  const service = await createProjectionService({
    statePath: join(temp, 'tool-state', 'projects.json'), outputSchema: {},
    generator: async () => {
      calls++;
      const bundle = structuredClone(complete);
      if (omitCancel) bundle.modules[0].nodes.pop();
      return { bundle, threadId: 'test-projection' };
    },
  });
  t.after(() => service.shutdown());
  const input = { projectPath: temp, sourceSpecPath, sourceType: 'html' };
  const finish = async result => {
    let job = result.job;
    for (let i = 0; i < 100 && ['queued', 'running'].includes(job.status); i++) {
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
      job = service.get(job.id);
    }
    return job;
  };
  const valid = await finish(await service.start(input));
  assert.equal(valid.status, 'completed', valid.error);
  const goodSource = await readFile(valid.specPath, 'utf8');
  omitCancel = true;
  const failed = await finish(await service.start({ ...input, force: true }));
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /遗漏原始节点：CANCEL/);
  assert.equal(await readFile(valid.specPath, 'utf8'), goodSource);
  assert.equal(await readFile(sourceSpecPath, 'utf8'), source);

  const damaged = structuredClone(complete);
  damaged.modules[0].nodes.pop();
  await writeFile(valid.specPath, JSON.stringify(damaged));
  omitCancel = false;
  const regenerated = await service.start(input);
  assert.equal(regenerated.statusCode, 202);
  assert.equal((await finish(regenerated)).status, 'completed');
  assert.equal(calls, 3);
  assert.deepEqual(JSON.parse(await readFile(valid.specPath, 'utf8')), complete);
  assert.equal((await service.start(input)).statusCode, 200);
  assert.equal(calls, 3);
});
