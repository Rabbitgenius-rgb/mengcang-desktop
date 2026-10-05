'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {analyze}=require('../desktop/discovery.cjs');
const {createIntelligenceService}=require('../desktop/intelligence.cjs');
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-native-lifecycle-test-')),helper=path.join(directory,'inert-helper.fixture'),child=new EventEmitter(),killed=gate(),signals=[];
 // Not executable. Only the injected fake spawn is ever called.
 fs.writeFileSync(helper,'inert test fixture',{mode:0o600});
 Object.assign(child,{pid:123456,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(signal){signals.push(signal);killed.resolve();return true;}});
 const spawnImpl=()=>child;let calls=0;
 const nativeAnalyze=input=>{calls++;return analyze(input,{helper,timeout:20,spawnImpl});};
 t.after(()=>{child.emit('close',1);fs.rmSync(directory,{recursive:true,force:true});});
 return {helper,child,killed,signals,spawnImpl,nativeAnalyze,get calls(){return calls;}};
}
for(const cause of ['timeout','output-limit'])test(`native analysis ${cause} cannot report idle before close`,async t=>{
 const f=fixture(t),before=new Set(process.listeners('exit')),service=createIntelligenceService({initialSettings:{nativeEnabled:true},nativeAnalyze:f.nativeAnalyze});
 const job=service.request({action:'capabilities'});job.catch(()=>{});
 if(cause==='output-limit')f.child.stdout.emit('data','x'.repeat(32*1024*1024+1));
 await f.killed.promise;await Promise.race([job.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,30))]);
 assert.equal(service.status().busy,true);await assert.rejects(service.request({action:'capabilities'}),{code:'INTELLIGENCE_BUSY'});assert.equal(f.calls,1);assert.deepEqual(f.signals,['SIGKILL']);
 f.child.emit('error',Error('later synthetic error'));f.child.emit('close',null,'SIGKILL');await assert.rejects(job,{code:'LOCAL_SERVICE_ERROR'});assert.equal(service.status().busy,false);assert.deepEqual(process.listeners('exit').filter(listener=>!before.has(listener)),[]);
});

test('native analysis retains its first terminal error and cleans up failed spawn',async t=>{
 const f=fixture(t),job=analyze({command:'capabilities'},{helper:f.helper,timeout:10,spawnImpl:f.spawnImpl});job.catch(()=>{});await f.killed.promise;f.child.emit('error',Error('later failure'));f.child.emit('close',1);await assert.rejects(job,/分析超时/);
 const missing=fixture(t);delete missing.child.pid;const failed=analyze({command:'capabilities'},{helper:missing.helper,spawnImpl:missing.spawnImpl});failed.catch(()=>{});missing.child.emit('error',Error('synthetic missing helper'));await assert.rejects(failed,/synthetic missing helper/);assert.deepEqual(missing.signals,[]);
});

test('native analysis success and explicit parent-exit cleanup remove owned listeners',async t=>{
 const before=new Set(process.listeners('exit')),f=fixture(t),job=analyze({command:'capabilities'},{helper:f.helper,timeout:1000,spawnImpl:f.spawnImpl});
 const owned=process.listeners('exit').filter(listener=>!before.has(listener));assert.equal(owned.length,1);owned[0]();assert.deepEqual(f.signals,['SIGKILL']);
 f.child.stdout.end(JSON.stringify({synthetic:true}));f.child.emit('close',0);assert.deepEqual(await job,{synthetic:true});assert.deepEqual(process.listeners('exit').filter(listener=>!before.has(listener)),[]);
});
