import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rename, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { installPlugin } from '../src/plugin-install.mjs';
import { verifyRelease, PLUGIN_NAME, MARKETPLACE_NAME } from '../src/plugin-release.mjs';
import { createSkillFixtures } from './helpers/plugin-fixture.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test('可移植安装包：完整性、无写预检、冲突、安装确认与幂等', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-install-'));
  const skillsRoot = await createSkillFixtures(temp);
  const original = join(temp, 'original');
  await exec(process.execPath, [join(root, 'scripts/build-plugin-bundle.mjs'), '--output', original, '--skills-root', skillsRoot]);
  const bundleRoot = join(temp, '移动后的 安装包');
  await rename(original, bundleRoot);
  const release = await verifyRelease(bundleRoot);
  const sourceRoot = join(bundleRoot, 'plugins', PLUGIN_NAME);
  const configHome = join(temp, 'isolated-config');
  const cache = join(configHome, 'plugins/cache', MARKETPLACE_NAME, PLUGIN_NAME, release.version);
  const plugin = { name: PLUGIN_NAME, pluginId: `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, marketplaceName: MARKETPLACE_NAME,
    version: release.version, installed: true, enabled: true };
  let installed = [];
  let marketplaces = [];
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (command === process.execPath) return (await exec(command, args)).stdout;
    if (args[0] === 'plugin' && args[1] === 'list') return JSON.stringify({ installed });
    if (args[1] === 'marketplace' && args[2] === 'list') return JSON.stringify({ marketplaces });
    if (args.includes('--help')) return 'supported';
    if (args[1] === 'marketplace' && args[2] === 'add') {
      marketplaces = [{ name: MARKETPLACE_NAME, root: bundleRoot }]; return '{}';
    }
    if (args[1] === 'add') {
      installed = [plugin];
      await cp(sourceRoot, cache, { recursive: true });
      return '{}';
    }
    throw new Error('意外命令');
  };
  const changingCalls = () => calls.filter(c => c.includes('add') && !c.includes('--help'));
  const reset = () => { calls.length = 0; installed = []; marketplaces = []; };

  await t.test('文档不含打包机路径且 wrapper 从包内定位，拒绝未知参数', async () => {
    const doc = await readFile(join(bundleRoot, 'INSTALL.md'), 'utf8');
    assert.ok(!doc.includes(original) && !doc.includes(root));
    assert.match(doc, /checked/);
    await exec(process.execPath, [join(bundleRoot, 'install.mjs'), '--help'], { cwd: temp });
    await assert.rejects(exec(process.execPath, [join(bundleRoot, 'install.mjs'), '--typo']), /未知参数/);
  });
  await t.test('默认预检无安装命令', async () => {
    reset();
    assert.equal((await installPlugin({ bundleRoot, configHome, run })).status, 'checked');
    assert.equal(changingCalls().length, 0);
  });
  await t.test('显式安装调用官方 CLI 并核对缓存', async () => {
    reset();
    const result = await installPlugin({ bundleRoot, configHome, run, apply: true });
    assert.equal(result.status, 'installed');
    assert.equal(result.sessionVerification, 'pending');
    assert.equal(changingCalls().length, 2);
    calls.length = 0;
    assert.equal((await installPlugin({ bundleRoot, configHome, run, apply: true })).status, 'already-installed');
    assert.equal(changingCalls().length, 0);
  });
  await t.test('同名外部来源、禁用、其他目录和版本变化不静默覆盖', async () => {
    for (const [record, market, message] of [
      [{ ...plugin, marketplaceName: 'personal' }, [], /其他来源/],
      [{ ...plugin, enabled: false }, [], /被禁用/],
      [null, [{ name: MARKETPLACE_NAME, root: temp }], /其他目录/],
      [{ ...plugin, version: '0.0.1' }, [], /版本变更/],
    ]) {
      reset(); installed = record ? [record] : []; marketplaces = market;
      await assert.rejects(installPlugin({ bundleRoot, configHome, run, apply: true }), message);
      assert.equal(changingCalls().length, 0);
    }
  });
  await t.test('包内损坏、额外文件、符号链接都在调用 Codex 前被拒绝', async () => {
    reset();
    const target = join(bundleRoot, 'INSTALL.md');
    const content = await readFile(target);
    await writeFile(target, 'changed');
    await assert.rejects(installPlugin({ bundleRoot, configHome, run, apply: true }), /校验失败/);
    await writeFile(target, content);
    const extra = join(bundleRoot, 'unexpected.txt');
    await writeFile(extra, 'extra');
    await assert.rejects(verifyRelease(bundleRoot), /校验失败/);
    await unlink(extra);
    const link = join(bundleRoot, 'external-link');
    await symlink(target, link);
    await assert.rejects(verifyRelease(bundleRoot), /符号链接/);
    await unlink(link);
    assert.equal(calls.length, 0);
  });
  await t.test('清单路径穿越被拒绝', async () => {
    const target = join(bundleRoot, 'release.json');
    const content = await readFile(target);
    const changed = JSON.parse(content);
    changed.files['../outside'] = '0'.repeat(64);
    await writeFile(target, JSON.stringify(changed));
    await assert.rejects(verifyRelease(bundleRoot), /路径或校验值无效/);
    await writeFile(target, content);
  });
  await t.test('已装副本被修改不能报告幂等成功', async () => {
    reset(); installed = [plugin];
    await writeFile(join(cache, 'cli.mjs'), '// damaged');
    await assert.rejects(installPlugin({ bundleRoot, configHome, run, apply: true }), /已安装副本与发布包不一致/);
    assert.equal(changingCalls().length, 0);
  });
  await t.test('CLI 能力或状态不支持时不安装', async () => {
    reset();
    await assert.rejects(installPlugin({ bundleRoot, configHome, run: async () => { throw new Error('unsupported'); }, apply: true }), /unsupported/);
    await assert.rejects(installPlugin({ bundleRoot, configHome, run: async () => '{}', apply: true }), /格式不受支持/);
  });
  await t.test('安装命令成功但状态不符不能报完成', async () => {
    reset();
    const staleRun = async (command, args) => args[1] === 'add' && !args.includes('--help') ? '{}' : run(command, args);
    await assert.rejects(installPlugin({ bundleRoot, configHome, run: staleRun, apply: true }), /未报告正确版本/);
  });
});

test('发布归档可重新解压且 SHA256SUMS 与实际归档一致', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-release-'));
  const output = join(temp, 'release');
  await exec(process.execPath, [join(root, 'scripts/build-plugin-release.mjs'), '--output', output]);
  const sums = (await readFile(join(output, 'SHA256SUMS'), 'utf8')).trim().split(/\s+/);
  const { sha256 } = await import('../src/plugin-release.mjs');
  assert.equal(sha256(await readFile(join(output, sums[1]))), sums[0]);
  await exec('tar', ['-xzf', join(output, sums[1]), '-C', temp]);
  await verifyRelease(join(temp, sums[1].replace(/\.tar\.gz$/, '')));
  await assert.rejects(exec(process.execPath, [join(root, 'scripts/build-plugin-release.mjs'), '--output', output]), /已存在/);
});
