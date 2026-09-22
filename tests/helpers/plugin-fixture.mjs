import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { REQUIRED_SKILL_RESOURCES } from '../../src/plugin-readiness.mjs';

// Packaging tests exercise the file contract, not the external skills' product semantics.
export async function createSkillFixtures(parent) {
  const root = join(parent, 'skill-input');
  for (const name of ['product-documentation', 'software-architecture-design', 'prd-concise-cn']) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: 安装包测试夹具\n---\n\n# 测试技能\n\n只用于安装测试，不用于产品工作。\n`);
  }
  for (const resource of REQUIRED_SKILL_RESOURCES.filter(path => path.startsWith('product-documentation/'))) {
    const path = join(root, resource);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '# 测试方法资源\n仅验证随包文件存在。\n');
  }
  return root;
}
