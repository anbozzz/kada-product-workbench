import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';

import { createEmptySpecMap } from '../src/contracts.mjs';
import { startWorkbench } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'ips-binding-reachability-'));
const htmlPath = join(temp, 'dynamic-prototype.html');
const specPath = join(temp, 'product.spec.json');
const sourceSpecPath = join(temp, 'product.spec.md');
const mapPath = join(temp, 'spec-map.json');
const statePath = join(temp, 'projects.json');

await writeFile(htmlPath, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>动态低保真页面</title>
<style>body{font-family:sans-serif;padding:32px}button{display:block;margin:16px 0;padding:12px}</style></head>
<body><main id="root"></main><script>
const root=document.querySelector('#root');
let sceneVisible=false;
const render=()=>{
  if(sceneVisible){
    root.innerHTML='<h1>会诊演示场景</h1><p>该场景只存在于当前页面内存，刷新后回到入口。</p><button id="dynamic-action" aria-label="结束本轮会诊">结束本轮会诊</button>';
    document.querySelector('#dynamic-action').onclick=()=>localStorage.setItem('dynamic-target-invoked','1');
  }else{
    root.innerHTML='<h1>会诊入口</h1><button id="open-scene" aria-label="进入会诊演示场景">进入会诊演示场景</button>';
    document.querySelector('#open-scene').onclick=()=>{sceneVisible=true;render()};
  }
};
render();
</script></body></html>`, 'utf8');

const productSpec = {
  schemaVersion: '0.1',
  product: {
    id: 'DYNAMIC-PROTOTYPE-DEMO',
    title: '动态低保真 Product Spec',
    version: '0.1.0',
    status: 'reviewing',
    description: '验证关联事实不依赖原型冷启动能力。',
    sourceRefs: [htmlPath],
  },
  pages: [{
    id: 'REVIEW-PAGE-MEETING',
    title: '会诊演示场景',
    responsibility: '演示结束本轮会诊。',
    anchorHints: ['会诊演示场景', '结束本轮会诊'],
  }],
  modules: [{
    id: 'REVIEW-MEETING',
    title: '会诊管理',
    purpose: '结束会诊演示。',
    scope: '仅在当前页面内存中出现的低保真场景。',
    journeys: ['从会诊入口手动进入演示场景'],
    nodes: [{
      id: 'REVIEW-ACTION-END',
      type: 'ACTION',
      title: '结束本轮会诊',
      pageId: 'REVIEW-PAGE-MEETING',
      status: 'confirmed',
      sourceKind: 'observed-ui',
      statement: '结束当前会诊演示。',
      anchorHints: ['结束本轮会诊'],
      contentBlocks: [{ id: 'definition', label: '定义', content: '结束当前会诊演示。' }],
      relations: [],
    }],
  }],
};
await writeFile(specPath, `${JSON.stringify(productSpec, null, 2)}\n`, 'utf8');
await writeFile(sourceSpecPath, '# 动态低保真 Product Spec\n\n### ACTION `REVIEW-ACTION-END`：结束本轮会诊\n', 'utf8');
await writeFile(
  mapPath,
  `${JSON.stringify(createEmptySpecMap(productSpec.product.id, htmlPath), null, 2)}\n`,
  'utf8',
);

const studio = await startWorkbench({
  appRoot: root,
  statePath,
  mode: 'map',
  htmlPath,
  specPath,
  sourceSpecPath,
  mapPath,
  host: '127.0.0.1',
  port: 0,
});
const browser = await launchHeadlessBrowser();

const expandPage = async page => {
  const tree = page.locator('#spec-binding-tree');
  const pageButton = tree
    .getByTestId('spec-page-group-REVIEW-PAGE-MEETING')
    .getByRole('button')
    .first();
  if (await pageButton.getAttribute('aria-expanded') !== 'true') await pageButton.click();
  const card = tree.getByTestId('spec-card-REVIEW-ACTION-END');
  return { tree, card };
};

const expandAndSelect = async page => {
  const { tree, card } = await expandPage(page);
  await card.click();
  return { tree, card };
};

const manuallyBindTarget = async page => {
  await page.getByRole('tab', { name: '页面映射' }).click();
  await page.getByRole('button', { name: '在页面上选择位置' }).click();
  const frame = page.locator('iframe[title="功能页面"]');
  const target = await frame.evaluate(frameElement => {
    const element = frameElement.contentDocument?.querySelector('#dynamic-action');
    if (!element) throw new Error('动态场景缺少待绑定按钮');
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      frameWidth: frameElement.clientWidth,
      frameHeight: frameElement.clientHeight,
    };
  });
  const frameBox = await frame.boundingBox();
  if (!frameBox) throw new Error('无法读取 iframe 位置');
  const point = {
    x: frameBox.x + target.x * (frameBox.width / target.frameWidth),
    y: frameBox.y + target.y * (frameBox.height / target.frameHeight),
  };
  await page.getByTestId('frame-interaction-layer').evaluate((layer, clickPoint) => {
    layer.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: clickPoint.x,
      clientY: clickPoint.y,
    }));
  }, point);
};

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 820 } });
  await page.goto(studio.url, { waitUntil: 'networkidle' });
  const frame = page.frameLocator('iframe[title="功能页面"]');

  await frame.getByRole('button', { name: '进入会诊演示场景' }).click();
  await frame.getByRole('button', { name: '结束本轮会诊', exact: true }).waitFor();
  await expandAndSelect(page);
  await manuallyBindTarget(page);
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="map-save-status"]')?.getAttribute('aria-label') !== '已自动保存');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="map-save-status"]')?.getAttribute('aria-label') === '已自动保存');

  const savedMap = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.equal(savedMap.items.length, 1);
  assert.equal(
    savedMap.items[0].target.context.url,
    '/target/dynamic-prototype.html',
    '没有精确场景路由时仍应保存用户确认的当前页面地址',
  );
  assert.equal(
    await frame.locator('body').evaluate(body => body.ownerDocument.defaultView?.localStorage.getItem('dynamic-target-invoked')),
    null,
    '人工绑定只能选择组件，不能执行被绑定动作',
  );

  await page.reload({ waitUntil: 'networkidle' });
  const refreshed = await expandAndSelect(page);
  await frame.getByRole('button', { name: '进入会诊演示场景' }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="spec-card-REVIEW-ACTION-END"]')
      ?.getAttribute('aria-label')?.includes('已关联 · 需手动进入'));
  assert.equal(
    await refreshed.tree.getByRole('tab', { name: /需复核/ }).count(),
    0,
    '动态场景尚未进入时不能把已确认关联计入需复核',
  );

  await frame.locator('body').evaluate(body => {
    body.ownerDocument.defaultView.location.hash = 'another-page';
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="spec-card-REVIEW-ACTION-END"]')
      ?.getAttribute('aria-label')?.includes('已关联，'));
  assert.equal(
    (await refreshed.card.getAttribute('aria-label')).includes('需手动进入'),
    false,
    '保存地址与当前页面不同时仍可自动导航，不应提前提示用户手动进入',
  );
  await refreshed.card.click();
  await page.getByText('无法精准定位，未跳转。关联仍然保留，请在中间页面手动进入对应场景。').waitFor();
  assert.equal(await frame.locator('body').evaluate(body => body.ownerDocument.location.hash), '#another-page',
    '保存地址无法恢复目标时，不得先跳回默认入口再要求用户手动进入');

  await frame.getByRole('button', { name: '进入会诊演示场景' }).click();
  await frame.getByRole('button', { name: '结束本轮会诊', exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="spec-card-REVIEW-ACTION-END"]')
      ?.getAttribute('aria-label')?.includes('已关联，'));
  await page.waitForFunction(() => document.querySelector('iframe[title="功能页面"]')?.contentDocument
    ?.querySelector('#ips-overlay-host')?.shadowRoot?.querySelector('button.marker[aria-pressed="true"]'));

  const unchangedMap = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.deepEqual(unchangedMap, savedMap, '手动进入场景后不应要求重绑或改写关联事实');
  assert.equal(
    await frame.locator('body').evaluate(body => body.ownerDocument.defaultView?.localStorage.getItem('dynamic-target-invoked')),
    null,
    '恢复定位和高亮不能执行被绑定动作',
  );

  await page.reload({ waitUntil: 'networkidle' });
  await frame.getByRole('button', { name: '进入会诊演示场景' }).click();
  await frame.getByRole('button', { name: '结束本轮会诊', exact: true }).waitFor();
  await frame.locator('body').evaluate(body => {
    body.ownerDocument.defaultView.location.hash = 'same-target-different-entry';
  });
  const reachedByAnotherPath = await expandPage(page);
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="spec-card-REVIEW-ACTION-END"]')
      ?.getAttribute('aria-label')?.includes('已关联，'));
  assert.equal(
    (await reachedByAnotherPath.card.getAttribute('aria-label')).includes('需手动进入'),
    false,
    '组件已经唯一命中且指纹一致时，旧页面地址不得继续覆盖真实关联状态',
  );
  await frame.locator('#ips-overlay-host').evaluate(host => {
    const marker = host.shadowRoot?.querySelector('button.marker');
    if (!marker) throw new Error('从不同页面地址进入同一组件后没有恢复关联标记');
  });

  console.log('动态低保真浏览器旅程通过：无精确路由仍可绑定；刷新后关联保留；组件真实出现时不受旧页面地址误判');
} finally {
  await browser.close();
  await studio.stop();
}
