import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEmptySpecMap } from '../src/contracts.mjs';
import { startWorkbench } from '../src/server.mjs';
import { launchHeadlessBrowser } from './browser-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'ips-page-navigation-'));
const appRoot = join(temp, 'app');
await mkdir(appRoot);
await cp(join(root, 'web'), join(appRoot, 'web'), { recursive: true });
await cp(join(root, 'schemas'), join(appRoot, 'schemas'), { recursive: true });
const htmlPath = join(temp, 'chat.html');
const specPath = join(temp, 'product.spec.json');
const mapPath = join(temp, 'spec-map.json');
await writeFile(htmlPath, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>会话导航回归</title>
<style>body{font:16px sans-serif;padding:24px}input,button{display:block;padding:12px;margin:20px}</style>
<main id="root"></main><script>
const params=new URLSearchParams(location.search),chat=params.get('chat');
const root=document.querySelector('#root');
const render=()=>{
  if(location.hash!=='#chat'){root.innerHTML='<h1>消息首页</h1><button id="home-input">输入消息</button>';return}
  const group=chat==='group',id=group?'GROUP':'PERSONAL';
  root.innerHTML='<h1>'+(group?'中心业务群':'个人对话')+'</h1><section aria-label="消息区"><input aria-label="输入消息" data-spec-id="'+id+'-INPUT"><button data-legacy="send">发送</button><button data-legacy="send">发送</button></section><a href="#home">返回首页</a>';
  root.querySelectorAll('button').forEach(b=>b.onclick=()=>localStorage.setItem('business-invoked','yes'));
};
// One page deliberately renders later to exercise cancellation and DOM readiness.
if(params.get('delay')) setTimeout(render,250);else render();
addEventListener('hashchange',render);
</script></html>`);
const node = (id, title, pageId, anchorHints) => ({
  id, title, pageId, anchorHints, type: 'ACTION', status: 'reviewing',
  sourceKind: 'observed-ui', statement: title,
  contentBlocks: [{ id: 'definition', label: '定义', content: title }], relations: [],
});
const bundle = {
  schemaVersion: '0.1',
  product: { id: 'PAGE-FIRST', title: '页面定位回归', version: '1', status: 'reviewing', description: '验证明确路由与页内定位。', sourceRefs: [htmlPath] },
  pages: [
    { id: 'GROUP', title: '中心业务群', responsibility: '中心会话', routeHints: ['?chat=group#chat'], anchorHints: ['中心业务群'] },
    { id: 'PERSONAL', title: '个人对话', responsibility: '个人会话', routeHints: ['?chat=personal#chat'], anchorHints: ['个人对话'] },
    { id: 'SLOW', title: '延迟会话', responsibility: '异步渲染', routeHints: ['?chat=group&delay=1#chat'], anchorHints: ['中心业务群'] },
    { id: 'HOME', title: '消息首页', responsibility: '首页', routeHints: ['#home'], anchorHints: ['消息首页'] },
  ],
  modules: [{ id: 'CHAT', title: '消息', purpose: '会话定位', scope: '仿真', journeys: ['从首页定位会话'], nodes: [
    node('GROUP-INPUT', '输入中心群消息', 'GROUP', ['输入消息']),
    node('PERSONAL-INPUT', '输入个人消息', 'PERSONAL', ['输入消息']),
    node('GROUP-LEGACY', '旧发送按钮', 'GROUP', ['发送']),
    node('GROUP-HIDDEN', '尚未显示的弹层操作', 'GROUP', ['唯一弹层操作']),
    node('SLOW-INPUT', '延迟输入操作', 'SLOW', ['输入消息']),
    node('HOME-INPUT', '首页入口', 'HOME', ['输入消息']),
  ] }],
};
await writeFile(specPath, JSON.stringify(bundle));
const map = createEmptySpecMap(bundle.product.id, htmlPath);
map.items.push({
  id: 'urn:interactive-product-spec:annotation:GROUP-LEGACY', type: 'Annotation', motivation: 'linking',
  body: { id: 'GROUP-LEGACY', type: 'Text' },
  target: { source: htmlPath, context: { url: '/target/chat.html?chat=group#chat' }, selector: { type: 'CssSelector', value: '[data-legacy="send"]' }, fingerprint: { tag: 'button', role: '', text: '发送', ariaLabel: '' } },
  status: 'confirmed', confirmedAt: '2026-09-05T00:00:00Z',
});
await writeFile(mapPath, JSON.stringify(map));
const mapBefore = await readFile(mapPath, 'utf8');
const studio = await startWorkbench({ appRoot, htmlPath, specPath, mapPath, statePath: join(temp, 'projects.json'), mode: 'map', host: '127.0.0.1', port: 0 });
const browser = await launchHeadlessBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto(studio.url, { waitUntil: 'networkidle' });
  const tree = page.locator('#spec-binding-tree');
  const frame = page.frameLocator('iframe[title="功能页面"]');
  const search = tree.getByLabel('搜索 Spec');
  const select = async (title, id) => { await search.fill(title); await tree.getByTestId(`spec-card-${id}`).click(); };
  const check = async (chat, anchor, label = '候选定位') => {
    await page.waitForFunction(({ chat, anchor, label }) => {
      const d = document.querySelector('iframe[title="功能页面"]')?.contentDocument;
      return d?.location.hash === '#chat' && new URLSearchParams(d.location.search).get('chat') === chat &&
        d.querySelector(`[data-spec-id="${anchor}"]`) &&
        d.querySelector('#ips-overlay-host')?.shadowRoot?.querySelector('.suggestion-label')?.textContent?.includes(label);
    }, { chat, anchor, label });
  };
  // An ambiguous old child mapping must not prevent opening its parent page.
  await tree.getByTestId('spec-page-group-GROUP').getByRole('button').first().click();
  await frame.getByRole('heading', { name: '中心业务群' }).waitFor();
  console.log('通过：页面独立导航');
  assert.equal(await frame.locator('[data-legacy="send"]').count(), 2);
  // The same label exists on both pages; the target page must win.
  await select('输入个人消息', 'PERSONAL-INPUT');
  await check('personal', 'PERSONAL-INPUT');
  await select('输入中心群消息', 'GROUP-INPUT');
  await check('group', 'GROUP-INPUT');
  console.log('通过：两个会话输入框');
  // Missing components do not roll the page back or silently create a binding.
  await select('输入个人消息', 'PERSONAL-INPUT');
  await check('personal', 'PERSONAL-INPUT');
  await select('尚未显示的弹层操作', 'GROUP-HIDDEN');
  await frame.getByRole('heading', { name: '中心业务群' }).waitFor();
  await page.getByText('已进入所属页面，暂未找到该区域或控件；请进入相应状态后继续查看。').waitFor();
  // Abandoning manual target picking must not leave the prototype covered.
  await page.getByRole('button', { name: '在页面上选择位置', exact: true }).click();
  assert.equal(await page.getByTestId('frame-interaction-layer').getAttribute('data-mapping-active'), 'true');
  await select('输入个人消息', 'PERSONAL-INPUT');
  await check('personal', 'PERSONAL-INPUT');
  assert.equal(await page.getByTestId('frame-interaction-layer').getAttribute('data-mapping-active'), 'false', '选择其他 Spec 必须退出旧定位拦截');
  await frame.getByRole('link', { name: '返回首页' }).click();
  await frame.getByRole('heading', { name: '消息首页' }).waitFor();
  await select('尚未显示的弹层操作', 'GROUP-HIDDEN');
  await page.getByRole('button', { name: '在页面上选择位置', exact: true }).click();
  // Hash-only destinations must not inherit the previous chat query.
  await search.fill('');
  await tree.getByTestId('spec-page-group-HOME').getByRole('button').first().click();
  await frame.getByRole('heading', { name: '消息首页' }).waitFor();
  assert.equal(await page.getByTestId('frame-interaction-layer').getAttribute('data-mapping-active'), 'false', '切换页面必须退出旧定位拦截');
  assert.equal(await frame.locator('body').evaluate(el => el.ownerDocument.location.search), '');
  await select('延迟输入操作', 'SLOW-INPUT');
  await select('输入个人消息', 'PERSONAL-INPUT');
  await check('personal', 'PERSONAL-INPUT');
  await page.reload({ waitUntil: 'networkidle' });
  await select('输入个人消息', 'PERSONAL-INPUT');
  await check('personal', 'PERSONAL-INPUT');
  console.log('通过：缺失目标、快速选择与刷新');
  await page.getByRole('tab', { name: '评审模式', exact: true }).click();
  await page.getByRole('button', { name: '收起 Spec 总览' }).waitFor();
  await page.getByRole('button', { name: '收起 Spec 总览' }).click();
  await page.getByRole('button', { name: '展开 Spec 总览' }).click();
  const floating = page.getByTestId('spec-overview-float');
  const edge = page.getByRole('separator', { name: '调整 Spec 总览宽度' });
  const edgeBox = await edge.boundingBox();
  await page.mouse.move(edgeBox.x + 4, edgeBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(edgeBox.x - 300, edgeBox.y + 80, { steps: 10 });
  await page.mouse.up();
  assert.equal(Math.round((await floating.boundingBox()).width), 320);
  await page.getByRole('button', { name: '收起 Spec 总览' }).click();
  await page.getByRole('button', { name: '展开 Spec 总览' }).click();
  assert.equal(Math.round((await floating.boundingBox()).width), 320);
  await edge.press('End');
  assert.equal(Math.round((await floating.boundingBox()).width), 480);
  await edge.press('ArrowRight');
  assert.equal(Math.round((await floating.boundingBox()).width), 480);
  const handle = page.getByRole('button', { name: '拖动 Spec 总览' });
  const initial = await floating.boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + 16);
  await page.mouse.down();
  await page.mouse.move(grip.x + 200, grip.y + 36, { steps: 10 });
  await page.mouse.up();
  const moved = await floating.boundingBox();
  assert.ok(moved.x > initial.x + 100, '拖动应移动浮层');
  await page.getByRole('button', { name: '收起 Spec 总览' }).click();
  await page.getByRole('button', { name: '展开 Spec 总览' }).click();
  assert.equal(Math.round((await floating.boundingBox()).x), Math.round(moved.x));
  await page.getByLabel('搜索 Spec').fill('');
  const locationBefore = await frame.locator('body').evaluate(el => el.ownerDocument.location.href);
  const homeRow = page.getByTestId('spec-page-group-HOME');
  await homeRow.getByRole('button').first().click();
  assert.equal(await frame.locator('body').evaluate(el => el.ownerDocument.location.href), locationBefore);
  await homeRow.getByRole('button').first().click();
  assert.equal(await frame.locator('body').evaluate(el => el.ownerDocument.location.href), locationBefore);
  await homeRow.hover();
  await homeRow.getByRole('button', { name: /定位到/ }).click();
  await frame.getByRole('heading', { name: '消息首页' }).waitFor();
  await page.getByRole('button', { name: /查找 Spec/ }).click();
  const reviewTree = page;
  await reviewTree.getByLabel('搜索 Spec').fill('输入中心群消息');
  await reviewTree.getByTestId('spec-card-GROUP-INPUT').click();
  await check('group', 'GROUP-INPUT', '位置预览');
  assert.equal(await page.getByRole('tab', { name: '页面映射', exact: true }).count(), 0);
  assert.equal(await frame.locator('body').evaluate(el => el.ownerDocument.defaultView.localStorage.getItem('business-invoked')), null);
  assert.equal(await readFile(mapPath, 'utf8'), mapBefore, '导航、位置预览及复核不能改写人工 Map');
  console.log('页面导航通过：独立构建、完整地址、旧组件歧义不阻断整页、同名控件不串页、缺失提示、快速选择、刷新、只读预览与原 Map 保留。');
} finally { await browser.close(); await studio.stop(); }
