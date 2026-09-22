import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { documentFixture } from '../tests/fixtures/document-updates.mjs';
import { startStudio } from '../src/server.mjs';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
import { callRuntime, runtimeRecords } from '../src/workbench-runtime.mjs';
const root=resolve(import.meta.dirname,'..'), f=await documentFixture();
const options={appRoot:root,statePath:join(f.directory,'state/projects.json'),host:'127.0.0.1',port:0};
const a=await startStudio(options), b=await startStudio(options);
const browser=await launchHeadlessBrowser();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('dialog',dialog=>dialog.accept());
  await page.goto(a.url);await page.getByTestId('runtime-status').getByText('工作台 · 等待来源确认').waitFor();
  const result=await fetch(a.url+'api/project/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.project)});assert.equal(result.status,200);
  await page.reload();await page.getByTestId('work-mode-switch').waitFor();await page.getByTestId('runtime-status').getByText('工作台 · 已就绪').waitFor();
  await page.getByTestId('runtime-status').click();await page.getByRole('heading',{name:'工作台运行管理'}).waitFor();
  await page.getByRole('button',{name:'关闭工作台',exact:true}).nth(1).waitFor();
  await page.screenshot({path:join(root,'output/playwright/workbench-runtime.png'),fullPage:true});
  // Close the idle other instance from the original workbench.
  const [recordB]=(await runtimeRecords(options.statePath)).filter(record=>record.url===b.url);
  const card=page.locator('div.rounded-lg').filter({has:page.getByText(b.url,{exact:true})});
  const committed=page.waitForResponse(response=>response.url().endsWith('/api/runtime/manage') && response.request().postDataJSON()?.action==='commit');
  await card.getByRole('button',{name:'关闭工作台',exact:true}).click();
  const receipt=await committed;assert.equal(receipt.status(),200,await receipt.text());
  await new Promise(resolve=>setTimeout(resolve,300));await assert.rejects(fetch(b.url));
  assert.equal((await fetch(a.url+'api/config')).status,200);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  // An acknowledged close stays frozen even if the next heartbeat loses the network.
  const [recordA]=(await runtimeRecords(options.statePath)).filter(record=>record.url===a.url);
  const prepared=await callRuntime(recordA,'prepare',{});
  await page.getByText('正在检查关闭工作台，暂时暂停操作；有未保存内容时会保留。').waitFor();
  let ackSeen=false, resolveLost;
  const lost=new Promise(resolve=>{resolveLost=resolve});
  await page.route('**/api/runtime/client',async route=>{
    if(ackSeen){await route.abort();resolveLost();return;}
    if(route.request().postDataJSON().ack===prepared.closing)ackSeen=true;
    await route.continue();
  });
  await lost;
  await page.getByTestId('open-review-export').click({force:true});
  assert.equal(await page.getByTestId('project-publication').count(),0,'网络失败不能解除关闭冻结后继续编辑');
  await callRuntime(recordA,'commit',{challenge:prepared.closing});
  await page.unroute('**/api/runtime/client');
  // Unexpected service loss is surfaced without reloading away the current page.
await page.getByTestId('runtime-status').getByText('工作台 · 已断开').waitFor();
  assert.ok(recordB.id);console.log('工作台运行管理通过：原入口、来源确认、双实例列表、跨实例关闭及断连可见');
}catch(error){console.error(await browser.contexts()[0]?.pages()[0]?.locator('body').innerText());throw error;}finally{await browser.close();await a.stop().catch(()=>{});await b.stop().catch(()=>{});await rm(f.directory,{recursive:true,force:true});}
