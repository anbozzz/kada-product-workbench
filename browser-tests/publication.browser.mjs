import assert from 'node:assert/strict';
import { readFile, rm, mkdir, cp, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { documentFixture, prdText, specText } from '../tests/fixtures/document-updates.mjs';
import { startStudio } from '../src/server.mjs';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
const root = resolve(import.meta.dirname, '..');
const a = await documentFixture(), b = await documentFixture();
a.project.name = '局域网发布 A'; b.project.name = '局域网发布 B';
const statePath = join(a.directory, 'state/projects.json');
const appRoot = join(a.directory, 'runtime-app');
await mkdir(appRoot); await cp(join(root, 'web'), join(appRoot, 'web'), { recursive: true }); await cp(join(root, 'schemas'), join(appRoot, 'schemas'), { recursive: true }); await cp(join(root, 'runtime'), join(appRoot, 'runtime'), { recursive: true });
let studio = await startStudio({ appRoot, host: '127.0.0.1', port: 0, statePath });
const browser = await launchHeadlessBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
try {
  await page.goto(studio.url);
  await page.getByTestId('publication-center').waitFor();
  for (const [fixture, password] of [[a, '0386'], [b, '1256']]) {
    const response = await fetch(`${studio.url}api/project/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixture.project) });
    assert.equal(response.status, 200, await response.text());
    await page.reload(); await page.getByTestId('work-mode-switch').waitFor();
    await page.getByTestId('open-review-export').click();
    await page.getByTestId('project-publication').waitFor();
    await page.getByLabel('四位访问密码', { exact: true }).fill(password);
    // Commit upstream but leave the response hanging: the UI must time out,
    // retain the operation identity, and recover without a duplicate publish.
    if (fixture === a) await page.route('**/api/publications/commands', async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
    }, { times: 1 });
    await page.getByRole('button', { name: /^(开启服务并发布|发布到本机)$/ }).click();
    if (fixture === a) { await page.getByRole('button', { name: '核实原操作', exact: true }).waitFor(); await page.getByRole('button', { name: '核实原操作', exact: true }).click({ timeout: 45000 }); await page.getByRole('button', { name: '核实原操作', exact: true }).waitFor({ state: 'hidden' }); }
    await page.getByRole('button', { name: '更新发布内容', exact: true }).waitFor({ timeout: 45000 });
    await page.getByTestId('export-review-package').waitFor();
    if (fixture === a) {
      const download = page.waitForEvent('download');
      await page.getByTestId('export-review-package').click();
      assert.match((await download).suggestedFilename(), /zip$/);
    }
  }
  await page.screenshot({ path: join(root, 'output/playwright/publication-panel.png'), fullPage: true });
  let state = await (await fetch(studio.url + 'api/publications')).json();
  assert.equal(state.records.length, 2);
  const pa = state.records.find(r => r.name === a.project.name), pb = state.records.find(r => r.name === b.project.name);
  const visit = await browser.newContext();
  const viewer = await visit.newPage(); viewer.setDefaultTimeout(15000);
  viewer.on('pageerror', error => errors.push(error.message));
  viewer.on('dialog', dialog => dialog.accept());
  const publicBase = `http://127.0.0.1:${state.port}`;
  await viewer.goto(`${publicBase}/p/${pa.id}/`);
  await viewer.getByLabel('四位访问密码').fill('0000'); await viewer.getByRole('button', { name: '进入', exact: true }).click();
  await viewer.getByText('密码不正确，请重新输入').waitFor();
  await viewer.getByLabel('四位访问密码').fill('0386'); await viewer.getByRole('button', { name: '进入', exact: true }).click();
  await viewer.frameLocator('iframe').getByRole('textbox', { name: '保留画布输入' }).fill('访客输入');
  assert.equal(await viewer.frameLocator('iframe').getByRole('textbox', { name: '保留画布输入' }).inputValue(), '访客输入');
  assert.equal(await viewer.getByTestId('export-review-package').count(), 0);
  // Downloads use the complete frozen source even with zero related sections.
  await viewer.getByTestId('related-prd').click();
  let downloadPromise = viewer.waitForEvent('download');
  await viewer.getByRole('button', { name: '下载 PRD.md 源文件', exact: true }).click();
  let sourceDownload = await downloadPromise;
  assert.equal(await readFile(await sourceDownload.path(), 'utf8'), prdText);
  await viewer.screenshot({ path: join(root, 'output/playwright/source-download-prd.png'), fullPage: true });
  await viewer.getByRole('button', { name: '关闭', exact: true }).click();
  await viewer.getByRole('button', { name: '完整 Spec', exact: true }).click();
  downloadPromise = viewer.waitForEvent('download');
  await viewer.getByRole('button', { name: '下载 Spec.md 源文件', exact: true }).click();
  sourceDownload = await downloadPromise;
  assert.equal(await readFile(await sourceDownload.path(), 'utf8'), specText);
  await viewer.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await viewer.screenshot({ path: join(root, 'output/playwright/publication-viewer.png'), fullPage: true });
  // A session cannot read B, even when it knows B's identifier.
  const denied = await viewer.request.get(`${publicBase}/p/${pb.id}/s/${pb.snapshotId}/api/config`); assert.equal(denied.status(), 401);
  // Closing the author server leaves the independent publication process alive.
  await studio.stop();
  await viewer.reload(); await viewer.frameLocator('iframe').getByRole('textbox', { name: '保留画布输入' }).waitFor();
  studio = await startStudio({ appRoot, host: '127.0.0.1', port: 0, statePath });
  await page.goto(studio.url); await page.getByTestId('publication-center').waitFor();
  await page.screenshot({ path: join(root, 'output/playwright/publication-center.png'), fullPage: true });
  await page.getByRole('button', { name: '管理', exact: true }).first().click();
  await page.getByTestId('project-publication').waitFor();
  await page.getByRole('button', { name: '更新发布内容', exact: true }).waitFor();
  await fetch(studio.url + 'api/project/close', { method: 'POST' }); await page.reload();
  await rename(a.htmlPath, a.htmlPath + '.bak');
  await page.getByRole('button', { name: '管理', exact: true }).first().click();
  await page.getByRole('heading', { name: '项目发布管理', exact: true }).waitFor();
  await page.getByRole('button', { name: '暂停发布', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await rename(a.htmlPath + '.bak', a.htmlPath);
  await page.getByRole('button', { name: '关闭本机服务', exact: true }).click();
  await page.getByRole('button', { name: '开启本机服务', exact: true }).waitFor();
  state = await (await fetch(studio.url + 'api/publications')).json();
  assert.equal(state.running, false); assert.equal(state.records.filter(r => r.enabled).length, 2);
  await page.getByRole('button', { name: '开启本机服务', exact: true }).click();
  await page.getByRole('button', { name: '关闭本机服务', exact: true }).waitFor();
  state = await (await fetch(studio.url + 'api/publications')).json(); assert.equal(state.records.filter(r => r.available).length, 2);
  assert.deepEqual(errors, []);
  console.log('发布浏览器旅程通过：原入口、双项目、四位密码、只读视图、跨项目隔离、ZIP、独立后台及全局启停');
  await visit.close();
} catch (error) {
  await page.screenshot({ path: join(root, 'output/playwright/publication-failure.png'), fullPage: true }).catch(() => {});
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close(); await studio.stop();
  try { const info = JSON.parse(await readFile(join(a.directory, 'state/publications/daemon.json'), 'utf8')); process.kill(info.pid, 'SIGTERM'); } catch {}
  await rm(a.directory, { recursive: true, force: true }); await rm(b.directory, { recursive: true, force: true });
}
