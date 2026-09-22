#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SHARED_PLUGIN_SKILLS } from '../src/plugin-readiness.mjs';
import { readSkillSnapshot, snapshotDifferences, validateSkillReferences, verifySkillSnapshot } from '../src/plugin-skill-snapshot.mjs';

const destination = resolve(import.meta.dirname, '../plugin-skills');
try {
  const args = process.argv.slice(2);
  let source;
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--source' && args[i + 1] && !args[i + 1].startsWith('--')) source = resolve(args[++i]);
    else throw new Error('用法：npm run sync:skills -- --source <共享Skill目录> [--check]');
  }
  if (!source || source === destination) throw new Error('请显式提供不同于发行快照的共享 Skill 来源目录');
  const files = await readSkillSnapshot(source);
  await validateSkillReferences(source, files);
  if (check) {
    await verifySkillSnapshot(destination);
    const differences = snapshotDifferences(files, await readSkillSnapshot(destination));
    if (differences.length) throw new Error(`共享 Skill 尚未同步：${differences.join('、')}`);
    console.log('共享 Skill 与咔哒发行快照一致');
  } else {
    // Only replace managed files from the previous snapshot, preserving unrelated bundled skills.
    let previous = {};
    try { previous = JSON.parse(await readFile(join(destination, 'shared-snapshot.json'), 'utf8')).files; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const path of Object.keys(previous)) {
      if (!SHARED_PLUGIN_SKILLS.includes(path.split('/')[0]) || path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\')) throw new Error('旧快照包含不安全路径');
    }
    for (const path of Object.keys(files)) {
      await mkdir(dirname(join(destination, path)), { recursive: true });
      await copyFile(join(source, path), join(destination, path));
    }
    for (const path of Object.keys(previous)) {
      if (!files[path]) await rm(join(destination, path));
    }
    const differences = snapshotDifferences(files, await readSkillSnapshot(destination));
    if (differences.length) throw new Error(`同步后仍有差异，请核对：${differences.join('、')}`);
    await writeFile(join(destination, 'shared-snapshot.json'), `${JSON.stringify({
      schemaVersion: 1,
      source: '维护者显式提供的共享 Skill；相对路径从 skills 根开始，内容由 SHA-256 固定。',
      files,
    }, null, 2)}\n`);
    console.log(`已同步 ${SHARED_PLUGIN_SKILLS.length} 项 Skill、${Object.keys(files).length} 个文件；请评审差异并随新版本发布。`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
