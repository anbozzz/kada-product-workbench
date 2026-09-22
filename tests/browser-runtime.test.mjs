import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertBrowserAutomationAllowed } from '../browser-tests/browser-runtime.mjs';

const root = resolve(import.meta.dirname, '..');

test('Codex seatbelt 环境在启动 Chromium 前给出明确升级运行提示', () => {
  assert.throws(
    () => assertBrowserAutomationAllowed({ CODEX_SANDBOX: 'seatbelt' }),
    /require_escalated.*npm run verify/,
  );
  assert.doesNotThrow(() => assertBrowserAutomationAllowed({}));
});

test('所有浏览器旅程共用 Playwright 匹配运行时且不启动系统 Chrome App', async () => {
  const directory = resolve(root, 'browser-tests');
  const files = (await readdir(directory)).filter(file => file.endsWith('.browser.mjs'));
  for (const file of files) {
    const source = await readFile(resolve(directory, file), 'utf8');
    assert.match(source, /launchHeadlessBrowser/);
    assert.doesNotMatch(source, /\/Applications\/(?:Google Chrome|Chromium|Microsoft Edge)\.app/);
    assert.doesNotMatch(source, /chromium\.launch/);
  }
});

test('统一验证在其他检查前阻止 seatbelt 内的浏览器启动', async () => {
  const source = await readFile(resolve(root, 'scripts/verify.mjs'), 'utf8');
  assert.match(source, /assertBrowserAutomationAllowed\(\);\s+await run\('npm', \['test'\]\)/);
});
