import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { startStudio } from '../src/server.mjs';
import { source as prdFixture } from '../tests/fixtures/prd-review.mjs';

const root = resolve(import.meta.dirname, '..');
const [pcDir, appDir] = process.argv.slice(2);
if (!pcDir || !appDir) throw new Error('用法：node browser-tests/ant-design-html.browser.mjs <已构建PC夹具目录> <已构建APP夹具目录>');
const output = join(root, 'output/playwright/ant-design-html');
await mkdir(output, { recursive: true });
const browser = await launchHeadlessBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  const externalRequests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(join(pcDir, 'dist/index.html')).href);
  await page.getByRole('button', { name: '新建事项' }).click();
  await page.getByRole('button', { name: /添\s*加/ }).click();
  await page.getByText('请输入事项名称', { exact: true }).waitFor();
  await page.getByLabel('事项名称').fill('验证新增的中文事项');
  await page.getByRole('button', { name: /添\s*加/ }).click();
  await page.getByRole('row').filter({ hasText: '验证新增的中文事项' }).waitFor();
  await page.getByRole('row').filter({ hasText: '验证新增的中文事项' }).getByRole('button', { name: '标记完成' }).click();
  await page.getByRole('menuitem', { name: '已完成' }).click();
  await page.getByRole('row').filter({ hasText: '验证新增的中文事项' }).waitFor();
  await page.getByRole('menuitem', { name: '待办事项' }).click();
  await page.getByLabel('搜索事项').fill('不会命中');
  await page.getByText('暂无事项', { exact: true }).waitFor();
  await page.getByLabel('搜索事项').fill('');
  await page.screenshot({ path: join(output, 'pc.png'), fullPage: true });
  await page.setViewportSize({ width: 900, height: 760 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'PC 较窄窗口不能整页溢出');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(join(appDir, 'dist/index.html')).href);
  await page.getByText('整理本周工作安排').click();
  await page.getByRole('heading', { name: '整理本周工作安排' }).waitFor();
  await page.getByRole('button', { name: '标记完成' }).click();
  await page.getByRole('button', { name: '恢复待办' }).waitFor();
  await page.getByText('返回', { exact: true }).click();
  await page.getByText('已完成', { exact: true }).click();
  await page.getByText('整理本周工作安排').waitFor();
  await page.getByText('待办', { exact: true }).click();
  await page.getByRole('button', { name: '新建事项' }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByText('请输入事项名称', { exact: true }).waitFor();
  await page.getByPlaceholder('请输入事项名称').fill('移动端新增事项与长中文说明验证');
  await page.screenshot({ path: join(output, 'app-popup.png'), fullPage: true });
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByText('移动端新增事项与长中文说明验证').waitFor();
  await page.screenshot({ path: join(output, 'app.png'), fullPage: true });
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '手机视口不能整页溢出');
  }
  assert.deepEqual(externalRequests, [], '默认最终 HTML 不应发起 CDN 或其他网络请求');
  await page.context().setOffline(false);

  for (const [target, projectPath] of [['pc', pcDir], ['app', appDir]]) {
    const prdPath = join(projectPath, '测试产品需求文档.md');
    await writeFile(prdPath, prdFixture);
    const studio = await startStudio({ appRoot: root, statePath: join(projectPath, 'tool-state/projects.json'), host: '127.0.0.1', port: 0 });
    try {
      const response = await fetch(studio.url + 'api/project/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        name: 'Ant HTML 示例', projectPath, sourceType: 'html', htmlPath: join(projectPath, 'dist/index.html'), prdPath,
        mapPolicy: 'tool', confirmPrdMapCreate: true, mode: 'map'
      }) });
      assert.equal(response.status, 200, await response.text());
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(studio.url);
      const frame = page.frameLocator('iframe[title="功能页面"]');
      await frame.getByRole('button', { name: '新建事项' }).waitFor();
      await frame.getByRole('button', { name: '新建事项' }).click();
      await frame.getByRole('button', { name: /添\s*加/ }).waitFor();
      await frame.getByRole('button', { name: /取\s*消/ }).click();
      await frame.getByRole('button', { name: /添\s*加/ }).waitFor({ state: 'hidden' });
      await page.screenshot({ path: join(output, target + '-workbench-page.png'), fullPage: true, animations: 'disabled' });
      await page.getByTestId('related-prd').click();
      await page.getByRole('heading', { name: '示例产品需求文档' }).first().waitFor();
      await page.screenshot({ path: join(output, target + '-workbench.png'), fullPage: true, animations: 'disabled' });
    } finally { await studio.stop(); }
  }
  assert.deepEqual(errors, [], '示例和工作台不应有页面脚本错误');
  console.log('Ant HTML 验证通过：PC／APP 离线单文件、输入校验、状态切换、列表详情返回、窄屏和原工作台加载。');
} finally { await browser.close(); }
