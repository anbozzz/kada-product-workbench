import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(resolve(root, 'page.config.json'), 'utf8'));
const result = await build({
  absWorkingDir: root, entryPoints: ['src/main.jsx'], outfile: 'app.js',
  bundle: true, minify: true, write: false, format: 'iife', target: ['es2020'],
  legalComments: 'inline', define: { 'process.env.NODE_ENV': '"production"' }
});
const js = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = (result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '').replace(/<\/style/gi, '<\\/style');
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/index.html'), '<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' + escape(config.title) + '</title><style>' + css + '</style></head><body><div id="root"></div><script>' + js + '</script></body></html>\n');
console.log('已构建 dist/index.html：CSS／JS 内嵌，可双击打开；请验证本批实际交互。');
