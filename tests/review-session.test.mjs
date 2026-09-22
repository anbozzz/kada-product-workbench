import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createReviewBaseline, createWorkbenchConfig } from '../src/review-session.mjs';
import { readSpecSource, saveSpecNode } from '../src/spec-service.mjs';

const root = resolve(import.meta.dirname, '..');

const fixture = async (gate = false) => {
  const directory = await mkdtemp(join(tmpdir(), 'interactive-product-spec-session-'));
  const specPath = join(directory, 'product.spec.json');
  const source = await readFile(resolve(root, 'examples/task-board/product.spec.json'), 'utf8');
  await writeFile(specPath, source, 'utf8');
  const { bundle, revision } = await readSpecSource(specPath);
  const map = JSON.parse(await readFile(resolve(root, 'examples/task-board/spec-map.json'), 'utf8'));
  return {
    directory,
    active: {
      mode: 'map',
      bundle,
      baseBundle: structuredClone(bundle),
      specPath,
      specRevision: revision,
      sourceSpecPath: gate ? join(directory, 'product-spec.md') : '',
      sourceSpecRevision: gate ? 'source-revision' : '',
      prdDocument: null,
      prdMap: null,
      prdMapRevision: '',
      prdMapPath: '',
      gate,
      sessionId: 'session-one',
      projectPath: directory,
      map,
      mapRevision: 'map-revision',
      mapPath: join(directory, 'spec-map.json'),
      initialRoute: '',
      target: {
        type: 'file',
        htmlPath: resolve(root, 'examples/task-board/index.html'),
        root: resolve(root, 'examples/task-board'),
      },
      project: { id: 'project-one', name: '测试项目', projectPath: directory, sourceType: 'html', mapPolicy: 'tool' },
    },
  };
};

test('工作台配置提供显式评审基线和兼容能力字段', async t => {
  const { directory, active } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const baseline = createReviewBaseline(active);
  const config = createWorkbenchConfig(active, true);

  assert.equal(baseline.sessionId, 'session-one');
  assert.equal(baseline.projectId, 'project-one');
  assert.equal(baseline.artifacts.projectionRevision, active.specRevision);
  assert.equal(baseline.artifacts.specMapRevision, 'map-revision');
  assert.match(baseline.target.identityRevision, /^[a-f0-9]{64}$/);
  assert.deepEqual(config.reviewBaseline, baseline);
  assert.equal(config.capabilities.saveSpec, true);
  assert.equal(config.capabilities.saveSpecMap, true);
  assert.equal(config.canSaveSpec, config.capabilities.saveSpec);
  assert.equal(config.canReturnToProjects, config.capabilities.returnToProjects);
});

test('DirectSourceCommit 只提交一个节点并推进投影 revision', async t => {
  const { directory, active } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const nextBundle = structuredClone(active.bundle);
  nextBundle.modules[0].nodes[0].title = '新建一项任务';

  const result = await saveSpecNode(active, {
    nodeId: nextBundle.modules[0].nodes[0].id,
    productSpec: nextBundle,
    baseRevision: active.specRevision,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.saveTarget, 'spec-json');
  assert.equal(result.body.changeCount, 0);
  assert.equal(JSON.parse(await readFile(active.specPath, 'utf8')).modules[0].nodes[0].title, '新建一项任务');
  assert.equal(active.baseBundle.modules[0].nodes[0].title, '新建一项任务');
});

test('CodexGateCommit 只更新会话草稿并拒绝旧 revision', async t => {
  const { directory, active } = await fixture(true);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalFile = await readFile(active.specPath, 'utf8');
  const nextBundle = structuredClone(active.bundle);
  nextBundle.modules[0].nodes[0].title = '由 Codex 处理的修订';
  nextBundle.modules[1].nodes[0].title = '第二个会话草稿变化';
  const baseRevision = active.specRevision;

  const result = await saveSpecNode(active, {
    productSpec: nextBundle,
    baseRevision,
  });
  const conflict = await saveSpecNode(active, {
    productSpec: nextBundle,
    baseRevision,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.saveTarget, 'codex-gate-draft');
  assert.equal(result.body.changeCount, 2);
  assert.equal(await readFile(active.specPath, 'utf8'), originalFile);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, 'SPEC_DRAFT_CHANGED');
});
