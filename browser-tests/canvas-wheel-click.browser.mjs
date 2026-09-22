import assert from 'node:assert/strict';
import {writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {documentFixture} from '../tests/fixtures/document-updates.mjs';
import {startWorkbench} from '../src/server.mjs';
import {launchHeadlessBrowser} from './browser-runtime.mjs';
const root=resolve(import.meta.dirname,'..'),f=await documentFixture();
await writeFile(f.htmlPath,'<!doctype html><meta charset="utf-8"><style>body{width:499px;margin:0;min-height:1600px}button{position:fixed;top:80px;right:20px;width:40px;height:40px}</style><button aria-label="添加">+</button><output>0</output><script>let n=0;document.querySelector("button").onclick=()=>document.querySelector("output").textContent=++n;</script>');
const studio=await startWorkbench({appRoot:root,statePath:join(f.directory,'state.json'),htmlPath:f.htmlPath,specPath:f.specPath,mapPath:f.mapPath,mode:'map',host:'127.0.0.1',port:0});
const browser=await launchHeadlessBrowser();
try{
 const p=await browser.newPage({viewport:{width:1611,height:870}});await p.goto(studio.url,{waitUntil:'networkidle'});
 const frame=p.frameLocator('iframe[title="功能页面"]'),layer=p.getByTestId('frame-interaction-layer');
 let clicks=0;
 const click=async()=>{const r=await frame.getByRole('button',{name:'添加'}).boundingBox();await p.mouse.click(r.x+r.width/2,r.y+r.height/2);assert.equal(await frame.locator('output').innerText(),String(++clicks));};
 await click();
 for(const [dx,dy,delay] of [[0,80,0],[0,-80,1200],[60,0,0],[-60,0,1200]]){
   const r=await p.getByTestId('canvas-viewport').boundingBox();await p.mouse.move(r.x+30,r.y+150);await p.mouse.wheel(dx,dy);
   if(delay)await p.waitForTimeout(delay);
   assert.equal(await layer.evaluate(e=>getComputedStyle(e).pointerEvents),'none','滚轮平移不得启用拖动拦截');
   await click();
 }
 // Wheel inside the prototype is still native scrolling, then native clicking.
 const r=await p.locator('iframe[title="功能页面"]').boundingBox();
 await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.wheel(0,90);await click();
 // Ctrl+wheel zoom must not consume the next business click either.
 await p.keyboard.down('Control');await p.mouse.wheel(0,-60);await p.keyboard.up('Control');await p.waitForTimeout(300);await click();
 await p.getByTestId('canvas-pan-toggle').click();
 assert.equal(await layer.evaluate(e=>getComputedStyle(e).pointerEvents),'auto','显式拖动仍有拦截层');
 await p.getByTestId('canvas-pan-toggle').click();await click();
 console.log('PASS: 空白处横纵滚动、立即/延迟点击、页内滚动、Ctrl缩放后点击、显式拖动退出');
}finally{await browser.close();await studio.stop();await rm(f.directory,{recursive:true,force:true})}
