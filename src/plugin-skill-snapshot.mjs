import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { SHARED_PLUGIN_SKILLS } from './plugin-readiness.mjs';

// Only the three shared methods are synchronized; unrelated personal skills never enter a release.
export async function readSkillSnapshot(root) {
  const files = {};
  async function visit(path) {
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) throw new Error(`Skill 不允许符号链接：${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) {
        if (['.DS_Store', '__pycache__', '.git'].includes(name) || name.endsWith('.pyc')) continue;
        if (/[\\\r\n]/.test(name)) throw new Error(`Skill 文件名不安全：${name}`);
        await visit(`${path}/${name}`);
      }
    } else if (info.isFile()) {
      files[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
    } else throw new Error(`Skill 不是普通文件：${path}`);
  }
  for (const name of SHARED_PLUGIN_SKILLS) {
    if (!(await lstat(join(root, name, 'SKILL.md'))).isFile()) throw new Error(`缺少 Skill 入口：${name}`);
    await visit(name);
  }
  return files;
}

export function snapshotDifferences(expected, actual) {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(path => expected[path] !== actual[path]).sort();
}

export async function validateSkillReferences(root, files) {
  const allowed = new Set(Object.keys(files));
  for (const path of allowed) {
    if (!path.endsWith('.md')) continue;
    const tree = fromMarkdown(await readFile(join(root, path), 'utf8'));
    function visit(node) {
      if (['link', 'image', 'definition'].includes(node.type)) {
        const url = node.url;
        if (url && !url.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(url)) {
          const target = decodeURIComponent(url.split('#')[0]);
          const resolved = relative(resolve(root), resolve(root, dirname(path), target)).split(sep).join('/');
          if (!allowed.has(resolved)) throw new Error(`Skill 引用不在发行快照中：${path} → ${url}`);
        }
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  }
}

export async function verifySkillSnapshot(root) {
  const manifest = JSON.parse(await readFile(join(root, 'shared-snapshot.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object') throw new Error('Skill 快照清单格式不受支持');
  const actual = await readSkillSnapshot(root);
  const differences = snapshotDifferences(manifest.files, actual);
  if (differences.length) throw new Error(`Skill 快照已变化，请从维护源重新同步：${differences.join('、')}`);
  await validateSkillReferences(root, actual);
}
