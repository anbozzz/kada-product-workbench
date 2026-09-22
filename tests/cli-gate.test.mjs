import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const example = name => resolve(root, 'examples/task-board', name);

test('CLI 统一 gate 在同一地址确认来源、等待修订，并在提交后只向 stdout 输出 JSON', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-cli-gate-'));
  const mapPath = join(temp, 'spec-map.json');
  await writeFile(mapPath, await readFile(example('spec-map.json'), 'utf8'));

  const child = spawn(process.execPath, [
    resolve(root, 'cli.mjs'),
    'start',
    '--html', example('index.html'),
    '--spec', example('product.spec.json'),
    '--source-spec', example('task-board.spec.md'),
    '--map', mapPath,
    '--project', root,
    '--state', join(temp, 'tool-state', 'projects.json'),
    '--port', '0',
    '--gate',
    '--json',
    '--no-open',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });

  let stderr = '';
  const url = await new Promise((resolveUrl, reject) => {
    const onData = chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) resolveUrl(match[0]);
    };
    child.stderr.on('data', onData);
    child.once('error', reject);
    child.once('exit', code => {
      if (!stderr.match(/http:\/\/127\.0\.0\.1:\d+\//)) {
        reject(new Error(`CLI 在工作台启动前退出：${code}\n${stderr}`));
      }
    });
  });

  const initialConfig = await fetch(`${url}api/config`);
  assert.equal(initialConfig.status, 409);
  const launcher = await (await fetch(`${url}api/launcher`)).json();
  assert.equal(launcher.gateSession, true);
  const confirmed = await fetch(`${url}api/project/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(launcher.bootstrap.draft),
  });
  assert.equal(confirmed.status, 200);
  const config = await confirmed.json();
  assert.equal(config.canSubmitToCodex, true);
  assert.equal(config.canSaveSpec, true);
  assert.equal(config.canReturnToProjects, true);
  const submit = await fetch(`${url}api/review/submit`, { method: 'POST' });
  assert.equal(submit.status, 200);

  let stdout = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  assert.equal(exitCode, 0);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.type, 'interactive-product-spec-review');
  assert.equal(result.sourceSpec.path, example('task-board.spec.md'));
  assert.deepEqual(result.changes, []);
  assert.match(stderr, /Codex 正在等待来源确认与修订提交/);
});
