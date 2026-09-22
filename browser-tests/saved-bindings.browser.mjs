// Read-only acceptance check against an explicitly supplied running workbench.
import assert from 'node:assert/strict';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
const url = process.argv[2];
assert.ok(url, '请显式提供待验收工作台 URL');
const config = await (await fetch(new URL('/api/config', url))).json();
const map = config.specMap;
assert.ok(map?.items?.length, '当前工作台没有可检查的绑定');
const nodes = config.productSpec.modules.flatMap(module => module.nodes);
const browser = await launchHeadlessBrowser();
try {
  for (const annotation of map.items) {
    if (process.argv[3] && !process.argv[3].split(',').includes(annotation.body.id)) continue;
    const node = nodes.find(item => item.id === annotation.body.id);
    const page = await browser.newPage({viewport:{width:1625,height:870}});
    await page.goto(url, {waitUntil:'networkidle'});
    const frame = page.frameLocator('iframe[title="功能页面"]');
    const before = await frame.locator('body').evaluate(body => body.ownerDocument.location.href);
    const group = page.getByTestId(`spec-page-group-${node.pageId}`);
    await group.getByRole('button').first().click();
    await page.waitForTimeout(2800);
    await page.getByTestId(`spec-card-${node.id}`).click();
    await page.waitForTimeout(2800);
    const result = await frame.locator('html').evaluate((root, binding) => {
      const matches = [...root.querySelectorAll(binding.target.selector.value)];
      const target = matches.length === 1 ? matches[0] : null;
      const rect = target?.getBoundingClientRect();
      const markers = [...root.querySelector('#ips-overlay-host').shadowRoot.querySelectorAll('button.marker')];
      return {url:root.ownerDocument.location.href, heading:root.querySelector('h1')?.textContent,
        located:markers.some(marker=>marker.dataset.specNodeId===binding.body.id),
        target:target?.innerText || target?.getAttribute('aria-label') || target?.getAttribute('placeholder'),
        visible: Boolean(rect?.width && rect?.height), matches:matches.length};
    }, annotation);
    console.log(JSON.stringify({node:node.title,...result,unchanged:result.url===before}));
    if (!result.located) {
      const probe = await browser.newPage();
      await probe.goto(new URL(annotation.target.context.url, url).href, {waitUntil:'networkidle'});
      console.log(JSON.stringify({node:node.title,coldStart:await probe.locator('body').evaluate((body, selector) => ({
        url:body.ownerDocument.location.href, text:body.innerText.slice(0,700),
        matches:[...body.querySelectorAll(selector)].map(item=>({text:item.innerText,aria:item.getAttribute('aria-label')})),
      }), annotation.target.selector.value)}));
      await probe.close();
    }
    await page.close();
  }
  const after = await (await fetch(new URL('/api/config', url))).json();
  assert.deepEqual(after.specMap, map, '验收不得改写绑定');
} finally { await browser.close(); }
