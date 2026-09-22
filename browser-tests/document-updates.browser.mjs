import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { documentFixture, prdText, specText } from '../tests/fixtures/document-updates.mjs';
import { startStudio } from '../src/server.mjs';
import { launchHeadlessBrowser } from './browser-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const f = await documentFixture();
// 从复制出的最终静态包启动，避免只验证开发服务。
const appRoot = join(f.directory, 'app');
await mkdir(appRoot);
await cp(join(root, 'web'), join(appRoot, 'web'), { recursive: true });
await cp(join(root, 'schemas'), join(appRoot, 'schemas'), { recursive: true });
const studio = await startStudio({ appRoot, host: '127.0.0.1', port: 0, statePath: join(f.directory, 'state/projects.json') });
const browser = await launchHeadlessBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(studio.url);
  await page.getByRole('button', { name: /继续 SPEC 绑定/ }).count();
  const confirmed = await fetch(`${studio.url}api/project/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.project) });
  assert.equal(confirmed.status, 200);
  await page.reload();
  await page.getByTestId('work-mode-switch').waitFor();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('textbox', { name: '保留画布输入' }).fill('不能丢失的画布状态');
  await page.getByRole('button', { name: /任务板 页面/ }).click();
  await page.getByText('保存任务', { exact: true }).first().click();
  await page.getByRole('tab', { name: '操作定义' }).click();
  await page.getByRole('button', { name: '编辑完整节点' }).click();
  await page.getByLabel('节点标题', { exact: true }).fill('尚未保存的标题');

  await writeFile(f.sourceSpecPath, specText.replace('可以重试', '手动重试且保持页面'));
  await page.getByTestId('document-update-banner').waitFor();
  assert.equal(await page.getByRole('button', { name: '加载新版', exact: true }).isDisabled(), true);
  assert.match(await page.getByTestId('document-update-banner').innerText(), /保存或取消节点编辑/);
  assert.equal(await page.getByLabel('节点标题', { exact: true }).inputValue(), '尚未保存的标题');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '加载新版', exact: true }).click();
  await page.getByText('失败时保留输入，手动重试且保持页面。', { exact: true }).waitFor();
  assert.equal(await frame.getByRole('textbox', { name: '保留画布输入' }).inputValue(), '不能丢失的画布状态');
  await page.getByTestId('related-prd').click();
  await page.getByText('标题必填。', { exact: true }).waitFor();
  await writeFile(f.prdPath, prdText.replace('标题必填', '标题与描述必填，新版规则'));
  await page.getByRole('button', { name: '加载新版', exact: true }).waitFor();
  await page.getByRole('button', { name: '加载新版', exact: true }).click();
  await page.getByText('标题与描述必填，新版规则。', { exact: true }).waitFor();
  assert.equal(await frame.getByRole('textbox', { name: '保留画布输入' }).inputValue(), '不能丢失的画布状态');
  await writeFile(f.prdPath, '# 未完成写入');
  await page.getByRole('button', { name: '加载新版', exact: true }).waitFor();
  await page.getByRole('button', { name: '加载新版', exact: true }).click();
  await page.getByRole('button', { name: '重试加载', exact: true }).waitFor();
  assert.equal(await page.getByText('标题与描述必填，新版规则。', { exact: true }).count(), 1);
  await writeFile(f.prdPath, prdText);
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await page.getByText('标题必填。', { exact: true }).waitFor();
  assert.equal((await readFile(f.mapPath, 'utf8')).includes('TASK-SAVE'), false);
  await page.setViewportSize({ width: 420, height: 850 });
  await writeFile(f.prdPath, prdText.replace('标题必填', '窄屏新版要求'));
  await page.getByRole('button', { name: '加载新版', exact: true }).waitFor();
  await page.getByRole('button', { name: '加载新版', exact: true }).click();
  await page.getByText('窄屏新版要求。', { exact: true }).waitFor();
  // 正文重排为统一 Spec：公共约束不在 MODULE 内，页面路由只在总表登记。
  const organizedSpec = specText.replace('## MODULE `TASK`：任务', `## 2. 页面与模块依赖总览
| 页面 ID | 职责/场景 | 当前评审地址 | 父页面或上下文 |
|---|---|---|---|
| \`PAGE-TASK\` | 任务板 | \`#task-new\` | 当前任务 |
## 3. 公共约束与未决项
#### PERMISSION \`TASK-PERMISSION\`：保存权限
- 状态：\`draft\`
- 来源：\`product-decision\`
- 拒绝与恢复：保留输入，权限恢复后重试。
## 4. 页面、区域与操作说明
## MODULE \`TASK\`：任务`).replace('- 页面路由提示：`#task`', '- 页面身份与路由：见 2') + '\n- 关联：`TASK-PERMISSION`\n';
  await writeFile(f.sourceSpecPath, organizedSpec);
  await page.getByRole('button', { name: '加载新版', exact: true }).waitFor();
  await page.getByRole('button', { name: '加载新版', exact: true }).click();
  await page.getByTestId('document-update-banner').waitFor({ state: 'hidden' });
  const updated = await (await fetch(`${studio.url}api/config`)).json();
  assert.deepEqual(updated.productSpec.modules.flatMap(module => module.nodes.map(node => node.id)), ['TASK-PERMISSION', 'TASK-SAVE']);
  assert.deepEqual(updated.productSpec.pages[0].routeHints, ['#task-new']);
  assert.equal(await frame.getByRole('textbox', { name: '保留画布输入' }).inputValue(), '不能丢失的画布状态');
  assert.deepEqual(errors, []);
  console.log('文档更新浏览器旅程通过：自动检测、编辑保护、原位加载、画布保留、格式失败与修复重试');
} finally {
  await browser.close();
  await studio.stop();
  await rm(f.directory, { recursive: true, force: true });
}
