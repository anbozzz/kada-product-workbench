#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { sha256, verifyRelease } from '../src/plugin-release.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
try {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output', '--skills-root'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('用法：npm run package:release -- --output <新目录> [--skills-root <显式兼容输入>]');
    options[args[i]] = resolve(args[i + 1]);
  }
  if (!options['--output']) throw new Error('必须提供 --output');
  const output = options['--output'];
  try { await lstat(output); throw new Error('发布输出目录已存在，拒绝覆盖；请使用新的目录'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('无效的发布版本');
  await exec('tar', ['--version']);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const name = `interactive-product-spec-${version}`;
  const bundle = join(output, name);
  await exec(process.execPath, [join(root, 'scripts/build-plugin-bundle.mjs'), '--output', bundle,
    ...(options['--skills-root'] ? ['--skills-root', options['--skills-root']] : [])], { maxBuffer: 4 * 1024 * 1024 });
  await verifyRelease(bundle);
  const archive = `${name}.tar.gz`;
  await exec('tar', ['-czf', join(output, archive), '-C', output, name], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await writeFile(join(output, 'SHA256SUMS'), `${sha256(await readFile(join(output, archive)))}  ${archive}\n`, { flag: 'wx' });
  process.stdout.write(`发布包：${join(output, archive)}\n校验文件：${join(output, 'SHA256SUMS')}\n未上传、未公开发布。请保留同版本 Skill 来源，按 RELEASE.md 完成发布门禁。\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
