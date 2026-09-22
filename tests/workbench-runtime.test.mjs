import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startStudio } from '../src/server.mjs';
import { runtimeRecords, callRuntime } from '../src/workbench-runtime.mjs';

test('实例启动核实、并发复用、关闭握手、未保存和跨站保护', async t => {
  const directory = await mkdtemp(join(tmpdir(),'ips-runtime-'));
  const options = { appRoot: resolve(import.meta.dirname,'..'), statePath: join(directory,'projects.json'), host:'127.0.0.1',port:0,managedLaunch:true };
  const [a,b] = await Promise.all([startStudio(options),startStudio(options)]);
  const owner = a.reused ? b : a;
  t.after(async () => { await owner.stop().catch(()=>{}); await rm(directory,{recursive:true,force:true}); });
  assert.equal(a.url,b.url); assert.equal(Boolean(a.reused) !== Boolean(b.reused),true);
  const [record] = await runtimeRecords(options.statePath);
  assert.equal((await callRuntime(record)).state,'waiting');
  const denied = await fetch(a.url+'api/runtime',{headers:{origin:'http://untrusted.invalid'}}); assert.equal(denied.status,403);
  const noToken = await fetch(a.url+'api/runtime/prepare',{method:'POST'}); assert.equal(noToken.status,403);
  const clientId = randomUUID();
  await callRuntime(record,'client',{clientId,dirty:true});
  let prepared = await callRuntime(record,'prepare',{});
  await callRuntime(record,'client',{clientId,dirty:true,ack:prepared.closing});
  await assert.rejects(callRuntime(record,'commit',{challenge:prepared.closing}),/未保存/);
  await callRuntime(record,'client',{clientId,dirty:false});
  prepared = await callRuntime(record,'prepare',{});
  await assert.rejects(callRuntime(record,'commit',{challenge:prepared.closing}),/标签页尚未确认/);
  prepared = await callRuntime(record,'prepare',{});
  await callRuntime(record,'client',{clientId,dirty:false,ack:prepared.closing});
  assert.equal((await callRuntime(record,'commit',{challenge:prepared.closing})).state,'closed');
  await new Promise(r=>setTimeout(r,250));
  await assert.rejects(fetch(a.url));
});

test('双击入口后台启动后核实，重复打开不增加实例', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const directory = await mkdtemp(join(tmpdir(),'ips-runtime-open-'));
  const statePath = join(directory,'projects.json');
  t.after(async () => { for (const record of await runtimeRecords(statePath)) { try { const p=await callRuntime(record,'prepare',{});await callRuntime(record,'commit',{challenge:p.closing}); } catch {} } await new Promise(r=>setTimeout(r,300)); await rm(directory,{recursive:true,force:true}); });
  const open = () => promisify(execFile)(process.execPath,[resolve(import.meta.dirname,'../cli.mjs'),'open','--state',statePath,'--port','0','--no-open'],{timeout:25000});
  assert.match((await open()).stdout,/项目中心已就绪/);
  const before=await runtimeRecords(statePath);assert.equal(before.length,1);
  assert.match((await open()).stdout,/项目中心已就绪/);
  const after=await runtimeRecords(statePath);assert.equal(after.length,1);assert.equal(after[0].id,before[0].id);
});

test('普通来源相同但显式页面路由不同，不能复用错误页面', async t => {
  const { documentFixture } = await import('./fixtures/document-updates.mjs');
  const { startWorkbench } = await import('../src/server.mjs');
  const f=await documentFixture();
  const options={...f.project,appRoot:resolve(import.meta.dirname,'..'),statePath:join(f.directory,'state/projects.json'),host:'127.0.0.1',port:0,managedLaunch:true};
  const a=await startWorkbench({...options,initialRoute:'#A'});
  const b=await startWorkbench({...options,initialRoute:'#B'});
  t.after(async()=>{await a.stop();await b.stop();await rm(f.directory,{recursive:true,force:true});});
  assert.notEqual(a.url,b.url);
  const again=await startWorkbench({...options,initialRoute:'#A'});assert.equal(again.reused,true);assert.equal(again.url,a.url);
});
