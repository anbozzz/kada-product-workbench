import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const requireUi = createRequire(new URL('../ui/package.json', import.meta.url));
const ts = requireUi('typescript');
const source = await readFile(new URL('../ui/src/lib/markdown-structure.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from "([^"]+)"/g, (_, name) => `from ${JSON.stringify(pathToFileURL(requireUi.resolve(name)).href)}`);
const { hasMarkdownStructure } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('Markdown block syntax receives expanded reading, including alternate heading and image syntax', () => {
  for (const source of [
    '标题\n===', '# 标题', '> 引用', '1. 步骤', '- 条目',
    '| 字段 | 说明 |\n| --- | --- |\n| 名称 | 中文 |',
    '```text\n代码\n```', '    缩进代码',
    '![图](image.png)', '![图][asset]\n\n[asset]: image.png',
  ]) assert.equal(hasMarkdownStructure(source), true, source);
});

test('Plain paragraphs, inline formatting and literal Markdown-like text remain unexpanded', () => {
  for (const source of ['', '纯文本\n继续说明', '另一段\n\n普通正文', '**强调** 和 `字段`',
    '\\# 字面标题', '甲 | 乙', '[来源](#rule)']) {
    assert.equal(hasMarkdownStructure(source), false, source);
  }
});
