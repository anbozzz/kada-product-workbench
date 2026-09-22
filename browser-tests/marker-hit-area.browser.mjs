import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {documentFixture} from '../tests/fixtures/document-updates.mjs';
import {startWorkbench} from '../src/server.mjs';
import {launchHeadlessBrowser} from './browser-runtime.mjs';
const root=resolve(import.meta.dirname,'..'), f=await documentFixture();
await writeFile(f.htmlPath,`<!doctype html><meta charset="utf-8"><style>body{margin:0;width:499px;min-height:1080px}button{position:fixed;top:75px;width:24px;height:24px;padding:0}#save{right:18px}#search{right:58px}</style><button id="search" aria-label="搜索">⌕</button><button id="save" aria-label="保存任务">+</button><output id="count">0</output><script>let n=0;document.querySelector('#save').onclick=()=>document.querySelector('#count').textContent=++n;</script>`);
const map=JSON.parse(await readFile(f.mapPath,'utf8'));
map.items=[{id:'annotation-save',type:'Annotation',motivation:'linking',body:{id:'TASK-SAVE',type:'Text'},status:'confirmed',target:{source:f.htmlPath,context:{url:'/target/index.html'},selector:{type:'CssSelector',value:'#save'},fingerprint:{tag:'button',role:'',text:'+',ariaLabel:'保存任务'}}}];
await writeFile(f.mapPath,JSON.stringify(map));
const studio=await startWorkbench({appRoot:root,statePath:join(f.directory,'state.json'),htmlPath:f.htmlPath,specPath:f.specPath,sourceSpecPath:f.sourceSpecPath,mapPath:f.mapPath,mode:'map',host:'127.0.0.1',port:0});
const browser=await launchHeadlessBrowser();
try{
 const p=await browser.newPage({viewport:{width:1611,height:870}});
 await p.goto(studio.url,{waitUntil:'networkidle'});
 const frame=p.frameLocator('iframe[title="功能页面"]');
 const marker=frame.locator('#ips-overlay-host .marker');
 await marker.waitFor();let n=0;
 for(let zoom=0;zoom<2;zoom++){
  if(zoom)for(let i=0;i<6;i++)await p.getByRole('button',{name:'放大画布',exact:true}).click();
  await p.waitForTimeout(250);
  for(const x of [.2,.5,.8])for(const y of [.2,.5,.8]){
   const box=await frame.locator('#save').boundingBox();
   await p.mouse.click(box.x+box.width*x,box.y+box.height*y);
   await p.waitForFunction(expected=>document.querySelector('iframe').contentDocument.querySelector('#count').textContent===String(expected),++n);
  }
  await marker.click();
  await p.getByRole('tab',{name:'操作定义',exact:true}).waitFor();
  assert.equal(await frame.locator('#count').innerText(),String(n),'点Spec不能执行业务按钮');
 }
 // Surround the mapped button with ARIA/label controls where a marker would move.
 await frame.locator('body').evaluate(body=>{
   const r=body.querySelector('#save').getBoundingClientRect(),w=body.ownerDocument.defaultView.innerWidth;
   const right=Math.min(w-26,r.right+2),left=Math.max(2,r.left-26);
   for(const [tag,role,x,y] of [['div','switch',right,r.top-26],['label','',left,r.top-26],['div','tab',right,r.bottom+2],['div','checkbox',left,r.bottom+2]]){
     const left=x,top=y;
     const e=body.ownerDocument.createElement(tag);e.className='neighbor';if(role)e.setAttribute('role',role);
     e.style.cssText=`position:fixed;left:${left}px;top:${top}px;width:24px;height:24px;background:#ddd`;
     e.textContent='x';e.onclick=()=>e.dataset.clicked=String(Number(e.dataset.clicked||0)+1);body.append(e);
   }
 });
 await p.waitForTimeout(250);
 for(const neighbor of await frame.locator('.neighbor').all()){
   let clicks=0;
   for(const x of [.2,.5,.8])for(const y of [.2,.5,.8]){
     const r=await neighbor.boundingBox();await p.mouse.click(r.x+r.width*x,r.y+r.height*y);
     assert.equal(await neighbor.getAttribute('data-clicked'),String(++clicks));
   }
 }
 console.log('PASS: 24px按钮九点真实点击、两个缩放值、Spec标记独立点击');
}finally{await browser.close();await studio.stop();await rm(f.directory,{recursive:true,force:true})}
