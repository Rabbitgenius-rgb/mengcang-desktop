'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {runClaude,createIntelligenceService}=require('../desktop/intelligence.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
// Inert child-process doubles only: these tests never start a CLI or contact a model.
function childFixture(){
 const spawned=gate(),killed=gate(),child=new EventEmitter(),signals=[];let directory;
 Object.assign(child,{pid:12345,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(signal){signals.push(signal);killed.resolve();return true;}});
 const spawnImpl=(_program,_args,options)=>{directory=options.cwd;spawned.resolve();return child;};
 return {child,signals,spawned,killed,spawnImpl,get directory(){return directory;}};
}
function request(fixture,extra={}){return runClaude({instructions:'Synthetic only',content:{text:'test'},model:'',timeoutMs:20,executable:'/synthetic/never-executed',spawnImpl:fixture.spawnImpl,...extra});}
for(const cause of ['timeout','output-limit'])test(`CLI ${cause} waits for close before releasing its working directory`,async()=>{
 const fixture=childFixture(),before=new Set(process.listeners('exit'));let settled=false;
 const job=request(fixture,{timeoutMs:cause==='timeout'?20:1000});job.then(()=>{settled=true;},()=>{settled=true;});await fixture.spawned.promise;
 if(cause==='output-limit')fixture.child.stdout.write('x'.repeat(2*1024*1024+1));
 await fixture.killed.promise;await Promise.race([job.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,50))]);assert.equal(settled,false,'sending a kill signal is not process completion');assert.equal(fs.existsSync(fixture.directory),true);assert.deepEqual(fixture.signals,['SIGKILL']);
 fixture.child.emit('close',null,'SIGKILL');await assert.rejects(job,{code:cause==='timeout'?'MODEL_TIMEOUT':'INVALID_RESPONSE'});assert.equal(fs.existsSync(fixture.directory),false);assert.deepEqual(process.listeners('exit').filter(listener=>!before.has(listener)),[]);
});

test('CLI output-limit termination keeps service busy until the child really closes',async()=>{
 const fixture=childFixture(),service=createIntelligenceService({initialSettings:{provider:'cli',generationEnabled:true},cliExecutable:'/synthetic/never-executed',confirmRequest:async()=>true,spawnImpl:fixture.spawnImpl});
 const input={action:'insight',mode:'The Gist',title:'Test',text:'Synthetic'},job=service.request(input);job.catch(()=>{});await fixture.spawned.promise;fixture.child.stdout.write('x'.repeat(2*1024*1024+1));await fixture.killed.promise;await Promise.race([job.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,50))]);
 assert.equal(service.status().busy,true);await assert.rejects(service.request(input),{code:'INTELLIGENCE_BUSY'});fixture.child.emit('close',null,'SIGKILL');await assert.rejects(job,{code:'INVALID_RESPONSE'});assert.equal(service.status().busy,false);
});

test('running CLI errors keep teardown pending, whereas failed spawn has no child to await',async()=>{
 const fixture=childFixture(),job=request(fixture,{timeoutMs:1000});job.catch(()=>{});await fixture.spawned.promise;fixture.child.emit('error',Error('synthetic child error'));await fixture.killed.promise;
 let settled=false;job.catch(()=>{settled=true;});await tick();assert.equal(settled,false);assert.equal(fs.existsSync(fixture.directory),true);fixture.child.emit('close',1);await assert.rejects(job,{code:'CLI_UNAVAILABLE'});assert.equal(fs.existsSync(fixture.directory),false);
 const missing=childFixture();delete missing.child.pid;const failed=request(missing,{timeoutMs:1000});failed.catch(()=>{});await missing.spawned.promise;missing.child.emit('error',Error('synthetic missing executable'));await assert.rejects(failed,{code:'CLI_UNAVAILABLE'});assert.equal(fs.existsSync(missing.directory),false);assert.deepEqual(missing.signals,[]);
});

test('active CLI has an exit cleanup listener which is removed after close',async()=>{
 const before=new Set(process.listeners('exit')),fixture=childFixture(),job=request(fixture,{timeoutMs:1000});job.catch(()=>{});await fixture.spawned.promise;await tick();
 const owned=process.listeners('exit').filter(listener=>!before.has(listener));assert.equal(owned.length,1);owned[0]();assert.deepEqual(fixture.signals,['SIGKILL']);
 fixture.child.emit('close',1);await assert.rejects(job,{code:'CLI_FAILED'});assert.deepEqual(process.listeners('exit').filter(listener=>!before.has(listener)),[]);assert.equal(fs.existsSync(fixture.directory),false);
});

test('unserializable CLI input is rejected before any process or listener is created',async()=>{
 const content={};content.self=content;const before=new Set(process.listeners('exit'));let spawned=false;
 await assert.rejects(runClaude({instructions:'Synthetic',content,model:'',timeoutMs:20,executable:'/synthetic/never-executed',spawnImpl:()=>{spawned=true;throw Error('must not spawn');}}),/circular/i);
 assert.equal(spawned,false);assert.deepEqual(process.listeners('exit').filter(listener=>!before.has(listener)),[]);
});
