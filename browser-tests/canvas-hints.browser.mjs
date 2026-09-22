import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';
import { documentFixture } from '../tests/fixtures/document-updates.mjs';
import { startStudio } from '../src/server.mjs';
import { launchHeadlessBrowser } from './browser-runtime.mjs';
const root=resolve(import.meta.dirname,'..'), f=await documentFixture();
const studio=await startStudio({appRoot:root,statePath:join(f.directory,'state/projects.json'),host:'127.0.0.1',port:0});
await fetch(studio.url+'api/project/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.project)});
const browser=await launchHeadlessBrowser();
try {
 const p=await browser.newPage({viewport:{width:1611,height:870}});
 await p.goto(studio.url,{waitUntil:'networkidle'});
 const upper=p.getByTestId('canvas-mode-hint'), lower=p.getByTestId('canvas-controls-hint');
 await upper.waitFor();await lower.waitFor();
 // Put a native target behind each hint: only the close button may intercept input.
 for(const hint of [upper,lower]){
   const point=await hint.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+8,y:r.y+r.height/2}});
   const marker=await p.evaluate(({x,y})=>{const b=document.createElement('button');b.id='click-probe';b.style.cssText=`position:fixed;left:${x-3}px;top:${y-3}px;width:6px;height:6px;z-index:25`;b.onclick=()=>b.dataset.clicked='yes';document.body.append(b);return b.id},point);
   await p.mouse.click(point.x,point.y);
   assert.equal(await p.locator('#'+marker).getAttribute('data-clicked'),'yes','提示文字不得拦截下层点击');
   await p.locator('#'+marker).evaluate(e=>e.remove());
 }
 await p.waitForTimeout(300); // Let initial auto-fit finish before comparing geometry.
 const iframeBefore=await p.locator('iframe').boundingBox();
 const zoomBefore=await p.getByTestId('canvas-viewport').getAttribute('data-zoom');
 const before=await p.getByTestId('canvas-viewport').boundingBox();
 await p.getByRole('button',{name:'关闭画布模式提示'}).click();
 assert.equal(await lower.count(),1,'关闭上方提示不影响下方提示');
 await p.getByRole('button',{name:'关闭画布操作提示'}).click();
 await p.waitForTimeout(300);
 assert.deepEqual(await p.getByTestId('canvas-viewport').boundingBox(),before);
 assert.deepEqual(await p.locator('iframe').boundingBox(),iframeBefore);
 assert.equal(await p.getByTestId('canvas-viewport').getAttribute('data-zoom'),zoomBefore);
 await p.reload({waitUntil:'networkidle'});assert.equal(await upper.count(),0);assert.equal(await lower.count(),0);
 // Simulate switching to a different project at the same workbench origin.
 await p.route('**/api/config',async route=>{const response=await route.fetch();const data=await response.json();data.project={...data.project,projectPath:'/different-project'};await route.fulfill({response,json:data})});
 await p.reload({waitUntil:'networkidle'});await upper.waitFor();await lower.waitFor();
 await p.unroute('**/api/config');await p.reload({waitUntil:'networkidle'});
 assert.equal(await upper.count(),0);assert.equal(await lower.count(),0);
 console.log('PASS: 上下提示独立关闭、刷新记忆、项目隔离、穿透点击、画布尺寸稳定');
}finally{await browser.close();await studio.stop();await rm(f.directory,{recursive:true,force:true})}
