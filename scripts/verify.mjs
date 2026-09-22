import { spawn } from 'node:child_process';
import { assertBrowserAutomationAllowed } from '../browser-tests/browser-runtime.mjs';

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => {
    if (code === 0) resolve();
    else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
  });
});

try {
  assertBrowserAutomationAllowed();
  await run('npm', ['test']);
  await run(process.execPath, ['browser-tests/workbench.browser.mjs']);
  await run(process.execPath, ['browser-tests/canvas-hints.browser.mjs']);
  await run(process.execPath, ['browser-tests/canvas-wheel-click.browser.mjs']);
  await run(process.execPath, ['browser-tests/marker-hit-area.browser.mjs']);
  await run(process.execPath, ['browser-tests/precise-route.browser.mjs']);
  await run(process.execPath, ['browser-tests/page-navigation.browser.mjs']);
  await run(process.execPath, ['browser-tests/mapping-precision.browser.mjs']);
  await run(process.execPath, ['browser-tests/mapping-visibility.browser.mjs']);
  await run(process.execPath, ['browser-tests/constraint-inspector.browser.mjs']);
  await run(process.execPath, ['browser-tests/one-click-bind.browser.mjs']);
  await run(process.execPath, ['browser-tests/document-updates.browser.mjs']);
  await run(process.execPath, ['browser-tests/full-spec-reading.browser.mjs']);
  await run(process.execPath, ['browser-tests/prd-browser.browser.mjs']);
  await run(process.execPath, ['browser-tests/prd-review.browser.mjs']);
  await run(process.execPath, ['browser-tests/prd-queue-continuation.browser.mjs']);
  await run(process.execPath, ['browser-tests/prd-exact-selection.browser.mjs']);
  await run(process.execPath, ['browser-tests/prd-review-entry.browser.mjs']);
  await run(process.execPath, ['browser-tests/publication.browser.mjs']);
  await run(process.execPath, ['browser-tests/workbench-runtime.browser.mjs']);
  await run('npm', ['run', 'check:diff']);
  console.log('verify 通过：构建、契约、Node 测试、PRD 阅读/绑定、动态场景关联、自动映射与关联约束浏览器旅程均已通过');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
