#!/usr/bin/env node
import { resolve } from 'node:path';
import { validatePluginRoot } from '../src/plugin-readiness.mjs';

const root = resolve(process.argv[2] || '.');
const result = await validatePluginRoot(root);
if (!result.ok) {
  for (const failure of result.failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}
process.stdout.write('插件 HTML 完成上报、MCP 与 Skill 路由已就绪\n');
