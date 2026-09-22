import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireUi = createRequire(new URL('../ui/package.json', import.meta.url));
const ts = requireUi('typescript');
const source = await readFile(new URL('../ui/src/lib/prd-revision-diff.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from "([^"]+)"/g, (_, name) => `from ${JSON.stringify(pathToFileURL(requireUi.resolve(name)).href)}`);
const { buildRevisionDiff } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const lines = text => text === '' ? [] : text.split(/\r?\n/);
function assertComplete(before, after) {
  const result = buildRevisionDiff(before, after);
  assert.equal(result.limited, false);
  const rows = result.sections.flatMap(section => section.rows);
  if (before.replace(/\r\n/g, '\n') === after.replace(/\r\n/g, '\n')) { assert.equal(result.sections.length, 0); return result; }
  for (const [kind, text, lineKey] of [['added', before, 'oldLine'], ['removed', after, 'newLine']]) {
    const side = rows.filter(row => row.kind !== kind);
    assert.deepEqual(side.map(row => row.text), lines(text));
    assert.deepEqual(side.map(row => row[lineKey]), side.map((_, i) => i + 1));
  }
  for (const row of rows) if (row.parts) assert.equal(row.parts.map(p => p.text).join(''), row.text);
  for (const section of result.sections.filter(s => s.kind === 'gap')) assert.ok(section.rows.every(row => row.kind === 'equal'));
  return result;
}
test('distant edits split into separate hunks without marking intervening text changed', () => {
  const before = ['# PRD', 'version 1', ...Array.from({ length: 40 }, (_, i) => `unchanged ${i}`), '## 规则', '允许单人创建'].join('\n');
  const result = assertComplete(before, before.replace('version 1', 'version 2').replace('单人', '多人'));
  const hunks = result.sections.filter(s => s.kind === 'change');
  assert.equal(hunks.length, 2);
  assert.equal(hunks[1].heading, '规则');
  assert.ok(!hunks.flatMap(h => h.rows).some(row => row.text === 'unchanged 20'));
  const added = hunks[1].rows.find(row => row.kind === 'added');
  assert.deepEqual(added.parts.filter(p => p.changed).map(p => p.text), ['多']);
});
test('adjacent changes merge; additions, deletions, repeated lines and boundary edits retain both versions', () => {
  for (const [before, after] of [
    ['', '新增'], ['删除', ''], ['', ''], ['相同', '相同'],
    ['a\nb\nc\nd\ne', 'A\nb\nc\nD\ne'],
    ['a\n\na\n\nb', 'a\n\na\n\nc\nb'],
    ['a\nb\nc', 'c\na\nb'], ['a\n', 'a'],
    ['# 章\n甲😀乙', '# 章\n甲😃乙'], ['a\r\nb', 'a\nb'],
  ]) assertComplete(before, after);
  assert.equal(buildRevisionDiff('a\nb\nc\nd\ne', 'A\nb\nc\nD\ne').sections.filter(s => s.kind === 'change').length, 1);
});
test('large sparse PRDs stay local; budget exhaustion is explicit rather than an inaccurate diff', () => {
  const before = Array.from({ length: 12000 }, (_, i) => `第${i}行`).join('\n');
  const after = before.replace('第1行\n', '第一行\n').replace('第11998行', '末尾修订');
  const result = assertComplete(before, after);
  assert.equal(result.sections.filter(s => s.kind === 'change').length, 2);
  assert.deepEqual(buildRevisionDiff('a\nb', 'c\nd', 0), { sections: [], limited: true });
});
test('random insertions and deletions never omit changes or corrupt line numbers', () => {
  let seed = 17;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 100; i++) {
    const before = Array.from({ length: 30 }, () => String(random(5)));
    const after = [...before];
    for (let j = 0; j < 6; j++) after.splice(random(after.length + 1), random(3), `新${random(5)}`);
    assertComplete(before.join('\n'), after.join('\n'));
  }
});
