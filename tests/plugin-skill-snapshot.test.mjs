import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readSkillSnapshot, validateSkillReferences, verifySkillSnapshot } from '../src/plugin-skill-snapshot.mjs';
import { verifyRelease } from '../src/plugin-release.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test('真实共享 Skill 快照独立于 Workspace，缺失引用与内容漂移失败关闭', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-skill-snapshot-'));
  const skills = join(temp, 'skills');
  await cp(join(root, 'plugin-skills'), skills, { recursive: true });
  await verifySkillSnapshot(skills);
  const method = join(skills, 'product-documentation/references/product-spec.md');
  await rename(method, `${method}.missing`);
  await assert.rejects(validateSkillReferences(skills, await readSkillSnapshot(skills)), /引用不在发行快照/);
  await rename(`${method}.missing`, method);
  await writeFile(method, `${await readFile(method, 'utf8')}\n变更未同步\n`);
  await assert.rejects(verifySkillSnapshot(skills), /快照已变化/);
});

test('默认出包内置真实规则，移动后包内文档入口无需共享源', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'ips-portable-skills-'));
  const output = join(temp, 'bundle');
  await exec(process.execPath, [join(root, 'scripts/build-plugin-bundle.mjs'), '--output', output], { cwd: temp });
  const moved = join(temp, '客户 下载包');
  await rename(output, moved);
  await verifyRelease(moved);
  const plugin = join(moved, 'plugins/interactive-product-spec');
  const snapshot = await readSkillSnapshot(join(root, 'plugin-skills'));
  const packaged = await readSkillSnapshot(join(plugin, 'skills'));
  for (const [path, digest] of Object.entries(snapshot)) assert.equal(packaged[path], digest, path);
  await validateSkillReferences(join(plugin, 'skills'), packaged);
  const { stdout } = await exec(process.execPath, [join(plugin, 'skills/product-documentation/scripts/cli.mjs'), '--help'], { cwd: temp });
  assert.match(stdout, /derive-spec/);
  const hook = exec(process.execPath, [join(plugin, 'src/html-delivery-session.mjs')], { cwd: temp, timeout: 10_000 });
  hook.child.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart' }));
  const { stdout: protocol } = await hook;
  assert.match(protocol, /\$product-documentation/);
  assert.doesNotMatch(protocol, /\$interactive-product-spec/);
});
