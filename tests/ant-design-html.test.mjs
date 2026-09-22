import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rename, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const source = resolve(import.meta.dirname, '../plugin-skills/ant-design-html');

test('从移动后的 Skill 在空项目生成 PC 和 APP 源码，不依赖原工作目录且拒绝覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ips-ant-skill-'));
  const skill = join(root, '安装副本 中文');
  await cp(source, skill, { recursive: true });
  const script = join(skill, 'scripts/create-project.mjs');
  for (const [target, library] of [['pc', 'antd'], ['app', 'antd-mobile']]) {
    const output = join(root, '项目 ' + target);
    const title = '用户标题 </script> & <界面>';
    await exec(process.execPath, [script, '--target', target, '--output', output, '--title', title], { cwd: root });
    const pkg = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies[library]);
    assert.equal(pkg.dependencies[target === 'pc' ? 'antd-mobile' : 'antd'], undefined);
    assert.equal(JSON.parse(await readFile(join(output, 'page.config.json'), 'utf8')).title, title);
    const original = await readFile(join(output, 'src/App.jsx'));
    await writeFile(join(output, '用户资料.md'), '必须保留');
    await assert.rejects(exec(process.execPath, [script, '--target', target, '--output', output]), /已有工程/);
    assert.deepEqual(await readFile(join(output, 'src/App.jsx')), original);
    assert.equal(await readFile(join(output, '用户资料.md'), 'utf8'), '必须保留');
  }
  for (const args of [[], ['--target', 'ios', '--output', join(root, 'bad')], ['--target', 'pc', '--output', join(root, 'bad'), '--typo', 'x']]) {
    await assert.rejects(exec(process.execPath, [script, ...args]), /用法/);
  }
});
