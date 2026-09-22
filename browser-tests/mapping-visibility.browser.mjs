import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { createEmptySpecMap } from '../src/contracts.mjs';
import { startWorkbench } from '../src/server.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'ips-mapping-visibility-'));
const htmlPath = join(temp, 'layers.html');
const specPath = join(temp, 'product.spec.json');
const mapPath = join(temp, 'spec-map.json');
await writeFile(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>分层页面</title>
<style>
body{margin:0;font:16px sans-serif}button{padding:12px}main{margin-top:64px;padding:16px 40px;height:1600px}
.layer{position:fixed;inset:64px 0 0;background:white;border:1px solid #ccc;padding:40px;z-index:5;animation:reveal .15s linear}
@keyframes reveal{from{opacity:0}to{opacity:1}}
.grandchild{z-index:10}.shared{position:fixed;top:8px;left:40px;z-index:20}
.clip{position:absolute;top:260px;left:40px;width:240px;height:40px;overflow:hidden}
.clip button{position:absolute;top:70px}.partial{position:fixed;right:-70px;top:220px;width:160px}
[hidden]{display:none}
</style></head><body>
<button id="shared" class="shared">公共操作</button>
<main id="surface" role="region" aria-label="上层区域"><button id="parent">上层操作</button><button id="open-child">进入子页面</button>
<button id="offscreen" style="position:absolute;top:1400px">屏幕外操作</button>
<div class="clip"><button id="clipped">裁剪外操作</button></div>
<div style="opacity:0"><button id="transparent">透明祖先操作</button></div>
<button id="partial" class="partial">部分可见操作</button>
<section id="child-layer" class="layer" role="dialog" aria-label="子页面" hidden>
<button id="child">子页操作</button><button id="open-grandchild">进入孙页面</button><button id="back-parent">返回上层</button>
<section id="grandchild-layer" class="layer grandchild" role="dialog" aria-label="孙页面" hidden>
<button id="grandchild">孙页操作</button><button id="back-child">返回子页</button>
</section></section></main>
<script>
const child=document.querySelector('#child-layer'),grandchild=document.querySelector('#grandchild-layer');
document.querySelector('#open-child').onclick=()=>child.hidden=false;
document.querySelector('#open-grandchild').onclick=()=>grandchild.hidden=false;
document.querySelector('#back-parent').onclick=()=>child.hidden=true;
document.querySelector('#back-child').onclick=()=>grandchild.hidden=true;
</script></body></html>`);
const targets = { parent: '上层操作', child: '子页操作', grandchild: '孙页操作', shared: '公共操作', offscreen: '屏幕外操作', clipped: '裁剪外操作', transparent: '透明祖先操作', partial: '部分可见操作', surface: '上层区域' };
const productSpec = JSON.parse(await readFile(resolve(root, 'examples/task-board/product.spec.json'), 'utf8'));
productSpec.pages = [];
productSpec.modules = [{ id: 'LAYERS', title: '分层页面', purpose: '验证可见性', scope: '测试', journeys: [], nodes: Object.entries(targets).map(([id, title]) => ({
  id: `LAYER-ACTION-${id.toUpperCase()}`, type: id === 'surface' ? 'SURFACE' : 'ACTION', title, status: 'confirmed', sourceKind: 'observed-ui', statement: title,
  anchorHints: [title], contentBlocks: [{ id: 'definition', label: '定义', content: title }], relations: [],
})) }];
const map = createEmptySpecMap(productSpec.product.id, htmlPath);
map.items = Object.entries(targets).map(([id, text]) => ({
  id: `annotation-${id}`, type: 'Annotation', motivation: 'linking', body: { id: `LAYER-ACTION-${id.toUpperCase()}`, type: 'Text' },
  target: { source: htmlPath, context: { url: '/target/layers.html' }, selector: { type: 'CssSelector', value: `#${id}` }, fingerprint: id === 'surface' ? {tag:'main',role:'region',text:'',ariaLabel:text} : { tag: 'button', role: '', text, ariaLabel: '' } },
  status: 'confirmed', confirmedAt: new Date().toISOString(),
}));
await writeFile(specPath, JSON.stringify(productSpec));
await writeFile(mapPath, JSON.stringify(map));
const savedMap = await readFile(mapPath, 'utf8');
const studio = await startWorkbench({ appRoot: root, mode: 'map', htmlPath, specPath, mapPath, host: '127.0.0.1', port: 0 });
const browser = await launchHeadlessBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1625, height: 870 } });
  await page.goto(studio.url, { waitUntil: 'networkidle' });
  const frame = page.frameLocator('iframe[title="功能页面"]');
  const expectMarkers = async ids => {
    await page.waitForFunction(expected => {
      const doc = document.querySelector('iframe[title="功能页面"]')?.contentDocument;
      const actual = [...doc?.querySelector('#ips-overlay-host')?.shadowRoot?.querySelectorAll('button.marker') || []].map(x => x.dataset.specNodeId).sort();
      return JSON.stringify(actual) === JSON.stringify(expected.map(x => `LAYER-ACTION-${x.toUpperCase()}`).sort());
    }, ids, { timeout: 5000 }).catch(async error => {
      const actual = await frame.locator('body').evaluate(body => ({
        viewport: [body.ownerDocument.defaultView.innerWidth, body.ownerDocument.defaultView.innerHeight],
        markers: [...body.ownerDocument.querySelector('#ips-overlay-host')?.shadowRoot?.querySelectorAll('button.marker') || []].map(x => x.dataset.specNodeId),
      }));
      throw new Error(`expected ${ids}; actual ${JSON.stringify(actual)}`, { cause: error });
    });
  };
  await expectMarkers(['parent', 'shared', 'partial', 'surface']);
  await frame.getByRole('button', { name: '进入子页面', exact: true }).click();
  await expectMarkers(['child', 'shared']);
  await frame.getByRole('button', { name: '进入孙页面', exact: true }).click();
  await expectMarkers(['grandchild', 'shared']);
  await frame.getByRole('button', { name: '返回子页', exact: true }).click();
  await expectMarkers(['child', 'shared']);
  await frame.getByRole('button', { name: '返回上层', exact: true }).click();
  await expectMarkers(['parent', 'shared', 'partial', 'surface']);
  // Existing marker hosts must not occlude their own targets on later refreshes.
  await frame.locator('body').evaluate(body => { body.dataset.refresh = '1'; });
  await expectMarkers(['parent', 'shared', 'partial', 'surface']);
  await page.getByRole('tab', { name: '评审模式' }).click();
  await frame.getByRole('button', { name: '进入子页面', exact: true }).click();
  await expectMarkers(['child', 'shared']);
  await frame.getByRole('button', { name: '进入孙页面', exact: true }).click();
  await expectMarkers(['grandchild', 'shared']);
  assert.equal(await readFile(mapPath, 'utf8'), savedMap, '仅隐藏或恢复圆点，不能修改绑定记录');
  console.log('分层标记浏览器旅程通过：两层遮挡、返回恢复、公共目标、屏幕外/裁剪/透明祖先及只读模式');
} finally {
  await browser.close();
  await new Promise(resolveClose => studio.server.close(resolveClose));
}
