#!/usr/bin/env node
// The release builder copies this launcher to the marketplace root as install.mjs.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || major === 20 && minor < 11) throw new Error('需要 Node.js 20.11 或更高版本；请先获得用户授权再安装运行环境。');
  const { main } = await import('./plugins/interactive-product-spec/src/plugin-install.mjs');
  await main(dirname(fileURLToPath(import.meta.url)));
} catch (error) {
  process.stderr.write(`安装未完成：${error.message}\n`);
  process.exitCode = 1;
}
