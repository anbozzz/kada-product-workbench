#!/usr/bin/env node
import { cp, lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = '用法：node create-project.mjs --target pc|app --output <空目录> [--title "产品名称"]';
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
  } else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--target', '--output', '--title'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]] !== undefined) throw new Error(usage);
      options[args[i]] = args[i + 1];
    }
    const target = options['--target'];
    if (!['pc', 'app'].includes(target) || !options['--output']) throw new Error(usage);
    const output = resolve(options['--output']);
    try {
      const info = await lstat(output);
      if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(output)).length) throw new Error('输出目录必须不存在或为空；已有工程请沿原源码修改。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(resolve(output, 'src'), { recursive: true });
    const copy = (from, to) => cp(resolve(skillRoot, 'assets', from), resolve(output, to), { force: false, errorOnExist: true });
    const write = (name, body) => writeFile(resolve(output, name), body, { flag: 'wx' });
    await copy('shared/main.jsx', 'src/main.jsx');
    await copy('shared/build.mjs', 'build.mjs');
    await copy(target + '/App.jsx', 'src/App.jsx');
    await copy(target + '/style.css', 'src/style.css');
    await write('page.config.json', JSON.stringify({ title: options['--title'] || '待办事项', target }, null, 2) + '\n');
    await write('package.json', JSON.stringify({
      name: 'product-html-' + target, version: '0.1.0', private: true, type: 'module',
      scripts: { build: 'node build.mjs' }, engines: { node: '>=20.11.0' },
      dependencies: { react: '18.3.1', 'react-dom': '18.3.1', [target === 'pc' ? 'antd' : 'antd-mobile']: target === 'pc' ? '5.27.5' : '5.42.3' },
      devDependencies: { esbuild: '0.25.12' }
    }, null, 2) + '\n');
    await write('.gitignore', 'node_modules/\ndist/\n');
    console.log(JSON.stringify({ target, output, next: ['按项目工具链安装依赖并保存 lockfile', '依据 PRD／Spec 修改 src/App.jsx 与 src/style.css', 'npm run build', '双击 dist/index.html 验证'], fixture: '起步待办是仿真数据，尚未实现用户产品需求' }, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
