import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveSmartLaunch } from '../src/smart-launch.mjs';
import { startSmartStudio } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = name => resolve(root, 'examples/task-board', name);

const copyBaseProject = async ({ includeMap = false, extraHtml = false } = {}) => {
  const project = await mkdtemp(join(tmpdir(), 'ips-smart-project-'));
  await writeFile(join(project, 'index.html'), await readFile(fixture('index.html')));
  await writeFile(join(project, 'product.spec.json'), await readFile(fixture('product.spec.json')));
  if (includeMap) await writeFile(join(project, 'spec-map.json'), await readFile(fixture('spec-map.json')));
  if (extraHtml) await writeFile(join(project, 'preview.html'), '<!doctype html><title>另一个页面</title>');
  return project;
};

test('唯一有效来源缺少 Map 时要求确认创建工具侧映射', async () => {
  const project = await copyBaseProject();
  const result = await resolveSmartLaunch({ projectPath: project });
  assert.equal(result.kind, 'confirm');
  assert.equal(result.reason, 'missing-map');
  assert.equal(result.draft.htmlPath, join(project, 'index.html'));
  assert.equal(result.draft.specPath, join(project, 'product.spec.json'));
  assert.equal(result.draft.mapPolicy, 'tool');
  assert.equal(result.draft.confirmMapCreate, false);
  await assert.rejects(readFile(join(project, 'spec-map.json'), 'utf8'), { code: 'ENOENT' });
});

test('唯一有效的已有 Map 自动选中并直达工作台', async () => {
  const project = await copyBaseProject({ includeMap: true });
  const result = await resolveSmartLaunch({ projectPath: project });
  assert.equal(result.kind, 'direct');
  assert.equal(result.draft.mapPolicy, 'existing');
  assert.equal(result.draft.mapPath, join(project, 'spec-map.json'));
});

test('多个 HTML 只进入预填的来源确认，显式 --html 可消除页面歧义', async () => {
  const project = await copyBaseProject({ extraHtml: true });
  const ambiguous = await resolveSmartLaunch({ projectPath: project });
  assert.equal(ambiguous.kind, 'confirm');
  assert.equal(ambiguous.reason, 'ambiguous');
  assert.equal(ambiguous.bootstrap.step, 2);
  assert.equal(ambiguous.draft.htmlPath, '');
  assert.equal(ambiguous.draft.specPath, join(project, 'product.spec.json'));

  const explicit = await resolveSmartLaunch({
    projectPath: project,
    htmlPath: join(project, 'preview.html'),
  });
  assert.equal(explicit.kind, 'confirm');
  assert.equal(explicit.reason, 'missing-map');
  assert.equal(explicit.draft.sourceType, 'html');
  assert.equal(explicit.draft.htmlPath, join(project, 'preview.html'));
});

test('缺少 Product Spec 与完全缺少 HTML 分别进入正确兜底', async () => {
  const missingSpec = await mkdtemp(join(tmpdir(), 'ips-smart-missing-spec-'));
  await writeFile(join(missingSpec, 'index.html'), '<!doctype html><title>只有页面</title>');
  const specResult = await resolveSmartLaunch({ projectPath: missingSpec });
  assert.equal(specResult.kind, 'confirm');
  assert.equal(specResult.reason, 'missing-spec');
  assert.equal(specResult.bootstrap.step, 2);
  assert.equal(specResult.draft.specPath, '');
  assert.equal(specResult.draft.sourceSpecPath, '');

  const missingTarget = await mkdtemp(join(tmpdir(), 'ips-smart-missing-target-'));
  await writeFile(join(missingTarget, 'product.spec.json'), await readFile(fixture('product.spec.json')));
  const targetResult = await resolveSmartLaunch({ projectPath: missingTarget });
  assert.equal(targetResult.kind, 'project-center');
  assert.equal(targetResult.reason, 'missing-target');
  assert.equal(targetResult.bootstrap.step, 1);
});

test('已有初版 Markdown Spec 会被保留为正文来源，并等待 Codex 生成临时视图', async () => {
  const project = await mkdtemp(join(tmpdir(), 'ips-smart-markdown-spec-'));
  await writeFile(join(project, 'index.html'), '<!doctype html><title>已有初版 Spec</title>');
  await writeFile(join(project, 'consultation.spec.md'), '# 会诊 Spec\n\n### ACTION `CONSULT-ACTION-START`：发起会诊');
  const result = await resolveSmartLaunch({ projectPath: project });
  assert.equal(result.kind, 'confirm');
  assert.equal(result.reason, 'missing-spec');
  assert.equal(result.draft.sourceSpecPath, join(project, 'consultation.spec.md'));
  assert.equal(result.draft.specPath, '');
});

test('与 Product Spec 冲突的旧 Map 被保留并转为新建工具侧映射确认', async () => {
  const project = await copyBaseProject({ includeMap: true });
  const path = join(project, 'spec-map.json');
  const map = JSON.parse(await readFile(path, 'utf8'));
  map.productSpecId = 'OTHER-PRODUCT';
  await writeFile(path, JSON.stringify(map));
  const result = await resolveSmartLaunch({ projectPath: project });
  assert.equal(result.kind, 'confirm');
  assert.equal(result.reason, 'stale-map');
  assert.equal(result.draft.mapPolicy, 'tool');
  assert.equal(result.draft.mapPath, '');
  assert.equal(result.draft.confirmMapCreate, false);
  assert.equal(result.discovery.map[0].valid, false);
  assert.match(result.discovery.map[0].errors.join('；'), /productSpecId/);
});

test('显式 --url 已移除，拒绝旧输入且不访问地址', async t => {
  const project = await mkdtemp(join(tmpdir(), 'ips-smart-dev-'));
  await writeFile(join(project, 'product.spec.json'), await readFile(fixture('product.spec.json')));
  let requests = 0;
  const dev = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>本地开发页</title>');
  });
  await new Promise((resolveListen, reject) => {
    dev.once('error', reject);
    dev.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise(resolveClose => dev.close(resolveClose)));
  const address = dev.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await assert.rejects(resolveSmartLaunch({
    projectPath: project,
    devUrl: `http://127.0.0.1:${port}`,
  }), /开发地址接入已移除/);
  assert.equal(requests, 0);

});

test('智能服务不会自动创建缺失的工具侧 Map', async t => {
  const project = await copyBaseProject();
  const stateRoot = await mkdtemp(join(tmpdir(), 'ips-smart-state-'));
  const statePath = join(stateRoot, 'projects.json');
  const result = await startSmartStudio({
    appRoot: root,
    projectPath: project,
    statePath,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));
  assert.equal(result.launch.kind, 'confirm');
  assert.equal(result.launch.reason, 'missing-map');
  assert.equal((await fetch(`${result.url}api/config`)).status, 409);
  assert.equal(result.mapPath, undefined);
  await assert.rejects(readFile(join(project, 'spec-map.json'), 'utf8'), { code: 'ENOENT' });
});

test('智能服务持续保留启动上下文直到用户明确返回项目中心', async t => {
  const project = await copyBaseProject({ extraHtml: true });
  const stateRoot = await mkdtemp(join(tmpdir(), 'ips-smart-bootstrap-'));
  const result = await startSmartStudio({
    appRoot: root,
    projectPath: project,
    statePath: join(stateRoot, 'projects.json'),
    host: '127.0.0.1',
    port: 0,
  });
  t.after(() => new Promise(resolveClose => result.server.close(resolveClose)));
  assert.equal((await fetch(`${result.url}api/config`)).status, 409);
  const first = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(first.bootstrap.reason, 'ambiguous');
  assert.equal(first.bootstrap.step, 2);
  const second = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(second.bootstrap.reason, 'ambiguous');
  const dismissed = await fetch(`${result.url}api/project/bootstrap/dismiss`, { method: 'POST' });
  assert.equal(dismissed.status, 200);
  const third = await (await fetch(`${result.url}api/launcher`)).json();
  assert.equal(third.bootstrap, null);
});
