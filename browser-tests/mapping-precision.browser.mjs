import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { createEmptySpecMap } from '../src/contracts.mjs';
import { startWorkbench } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'ips-mapping-precision-'));
const htmlPath = join(temp, 'scenes.html');
const specPath = join(temp, 'product.spec.json');
const mapPath = join(temp, 'spec-map.json');
await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>同构页面</title>
<style>body{font:16px sans-serif;padding:24px}button,input{display:block;padding:12px;margin:12px}#empty{width:120px;height:40px}</style></head>
<body><main id="scene-root"></main><script>
let scene='group';
const render=()=>{
  if(location.hash==='#exact') document.querySelector('main').innerHTML='<h1>精确场景</h1><button id="exact">精确操作</button>';
  else document.querySelector('main').innerHTML='<h1>'+(scene==='personal'?'个人会话':scene==='record'?'患者病历':'群聊')+'</h1><div><input placeholder="'+(scene==='personal'?'输入消息':'搜索消息')+'"></div><section><button>'+(scene==='record'?'清空本次录入':'患者病历 仅查看')+'</button></section><button id="empty"></button><button id="personal">手动进入个人会话</button><button id="record">手动进入患者病历</button>';
  document.querySelector('#personal')?.addEventListener('click',()=>{scene='personal';render()});
  document.querySelector('#record')?.addEventListener('click',()=>{scene='record';render()});
  document.querySelector('#exact')?.addEventListener('click',()=>localStorage.setItem('invoked','1'));
};
window.addEventListener('hashchange',render);render();
</script></body></html>`);
const spec = JSON.parse(await readFile(resolve(root, 'examples/task-board/product.spec.json'), 'utf8'));
const cases = [
  { id: 'PERSONAL', title: '个人会话', route: '#shared', selector: '#scene-root > div > input', tag: 'input', text: '输入消息' },
  { id: 'RECORD', title: '患者病历', route: '#shared', selector: 'section > button', tag: 'button', text: '清空本次录入' },
  { id: 'EMPTY', title: '文字改变', route: '#shared', selector: '#empty', tag: 'button', text: '保存患者' },
  { id: 'EXACT', title: '详情页操作', route: '#exact', selector: 'main > button:nth-of-type(1)', tag: 'button', text: '精确操作' },
];
// Same selector, different fingerprint: no circle on a similar component.
// EXACT is deliberately grouped under a different page and has a stale hint;
// its manually confirmed entry still must work without a stable DOM id.
spec.pages = cases.map(({ id, title, route }) => ({ id: `PAGE-${id}`, title, responsibility: title, routeHints: [route], anchorHints: [title] }));
spec.pages.find(page => page.id === 'PAGE-EXACT').routeHints = ['#wrong-page'];
spec.pages.push({ id: 'PAGE-GROUP', title: '群聊', responsibility: '群聊', routeHints: ['#shared'], anchorHints: ['群聊'] });
spec.modules = [{ id: 'PRECISION', title: '精确定位', purpose: '测试', scope: '测试', journeys: [], nodes: cases.map(({ id, title }) => ({
  id: `ACTION-${id}`, type: 'ACTION', title, pageId: `PAGE-${id}`, status: 'confirmed', sourceKind: 'observed-ui', statement: title, anchorHints: [title],
  contentBlocks: [{ id: 'definition', label: '定义', content: title }], relations: [],
})) }];
const map = createEmptySpecMap(spec.product.id, htmlPath);
map.items = cases.map(({ id, route, selector, tag, text }) => ({
  id: `annotation-${id}`, type: 'Annotation', motivation: 'linking', body: { id: `ACTION-${id}`, type: 'Text' }, status: 'confirmed',
  target: { source: htmlPath, context: { url: `/target/scenes.html${route}` }, selector: { type: 'CssSelector', value: selector }, fingerprint: { tag, text, role: '', ariaLabel: '' } },
}));
await writeFile(specPath, JSON.stringify(spec));
await writeFile(mapPath, JSON.stringify(map));
const savedMap = await readFile(mapPath, 'utf8');
const studio = await startWorkbench({ appRoot: root, mode: 'map', htmlPath, specPath, mapPath, host: '127.0.0.1', port: 0 });
const browser = await launchHeadlessBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1625, height: 870 } });
  await page.goto(studio.url, { waitUntil: 'networkidle' });
  const frame = page.frameLocator('iframe[title="功能页面"]');
  const context = () => frame.locator('body').evaluate(body => body.ownerDocument.location.href);
  const markers = () => frame.locator('#ips-overlay-host').evaluate(host => [...host.shadowRoot.querySelectorAll('button.marker')].map(item => item.dataset.specNodeId));
  await frame.getByRole('heading', { name: '群聊', exact: true }).waitFor();
  assert.deepEqual(await markers(), [], '通用输入框、同构按钮与空文字按钮都不能获得错误圆点');
  for (const id of ['PERSONAL', 'RECORD']) {
    await page.getByTestId(`spec-page-group-PAGE-${id}`).getByRole('button').first().click();
    await page.waitForFunction(() => document.querySelector('iframe[title="功能页面"]').contentDocument.location.hash === '#shared');
    assert.ok((await context()).endsWith('#shared'), '页面明确地址独立于组件恢复能力');
    await page.getByTestId(`spec-card-ACTION-${id}`).click();
    await page.getByRole('complementary', { name: 'Spec 详情' }).getByText(`ACTION-${id}`, { exact: true }).waitFor();
    // Consecutive selections can leave two identical Sonner notices visible.
    await page.locator('[data-sonner-toast]').last().getByText('已进入所属页面，原关联位置尚未找到或需要复核；已保留原映射。', { exact: true }).waitFor();
    assert.ok((await context()).endsWith('#shared'));
    assert.deepEqual(await markers(), []);
  }
  // A verifiable route remains usable and locating it does not execute it.
  await page.getByTestId('spec-page-group-PAGE-EXACT').getByRole('button').first().click();
  await page.waitForFunction(() => document.querySelector('iframe[title="功能页面"]').contentDocument.location.hash === '#wrong-page');
  await page.getByTestId('spec-card-ACTION-EXACT').click();
  await frame.getByRole('button', { name: '精确操作', exact: true }).waitFor();
  assert.equal(await frame.locator('body').evaluate(body => body.ownerDocument.defaultView.localStorage.getItem('invoked')), null);
  // Exercise node navigation independently of page-row navigation.
  await frame.locator('body').evaluate(body => { body.ownerDocument.location.hash = 'shared'; });
  await frame.getByRole('heading', { name: '群聊', exact: true }).waitFor();
  await page.getByTestId('spec-card-ACTION-EXACT').click();
  await frame.getByRole('button', { name: '精确操作', exact: true }).waitFor();
  await frame.locator('body').evaluate(body => { body.ownerDocument.location.hash = 'shared'; });
  await frame.getByRole('button', { name: '手动进入个人会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('iframe[title="功能页面"]').contentDocument.querySelector('#ips-overlay-host').shadowRoot.querySelector('[data-spec-node-id="ACTION-PERSONAL"]'), null, {timeout: 5000}).catch(async error => {
    console.error(await frame.locator('body').evaluate(body => ({url: body.ownerDocument.location.href, text: body.innerText, input: body.querySelector('input')?.outerHTML})), await markers());
    throw error;
  });
  assert.deepEqual(await markers(), ['ACTION-PERSONAL'], '手动进入可识别的目标页面后恢复，不需要重新绑定');
  await page.getByRole('tab', { name: '评审模式' }).click();
  await page.getByRole('button', { name: '收起 Spec 总览' }).click();
  await frame.getByRole('button', { name: '手动进入患者病历', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('iframe[title="功能页面"]').contentDocument.querySelector('#ips-overlay-host').shadowRoot.querySelector('[data-spec-node-id="ACTION-RECORD"]'));
  assert.deepEqual(await markers(), ['ACTION-RECORD'], '只读模式也不能遗留个人会话圆点');
  assert.equal(await readFile(mapPath, 'utf8'), savedMap, '定位、手动浏览和模式切换都不能改写已确认绑定');
  console.log('精确定位浏览器旅程通过：同构页面不误跳、不误标，精确路由可跳转，手动进入可恢复且不改写映射');
} finally {
  await browser.close();
  await studio.stop();
}
