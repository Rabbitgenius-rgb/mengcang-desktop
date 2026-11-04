const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {registerIntelligence}=require('../desktop/intelligence-bridge.cjs');
const {createPrivateWriteQueue}=require('../desktop/security.cjs');

test('invalid AI settings and key input cannot become unretryable pending disk writes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-ai-validation-review-')),handlers=new Map(),writes=createPrivateWriteQueue();let encryptionAvailable=true;
 try{
  await registerIntelligence({handle:(name,handler)=>handlers.set(name,handler),userData:root,writes,safeStorage:{isEncryptionAvailable:()=>encryptionAvailable,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},dialog:{showMessageBox:()=>{throw Error('Unexpected confirmation');}},getWindow:()=>null});
  await assert.rejects(async()=>handlers.get('intelligenceSetKey')('synthetic invalid key'));await writes.drain();assert.equal(writes.failed,0,'Validation failures must not block quitting as failed disk writes');
  await assert.rejects(async()=>handlers.get('intelligenceConfigure')({provider:'shell'}));await writes.drain();assert.equal(writes.failed,0,'Invalid configuration must not be queued for retries');
  encryptionAvailable=false;await assert.rejects(async()=>handlers.get('intelligenceSetKey')('synthetic-valid-key'));await writes.drain();assert.equal(writes.failed,0,'Unavailable encryption must not enqueue a plaintext save');
  assert.deepEqual(await fs.readdir(root),[]);assert.equal((await handlers.get('intelligenceStatus')()).usage.cloudRequests,0);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('pending settings writes cannot race another configuration, key destination or model request',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-configuration-gate-')),handlers=new Map(),queue=createPrivateWriteQueue();let release,requests=0,encryptions=0,settings={endpoint:'https://original.example.com/v1'};
 const gate=new Promise(resolve=>release=resolve),writes={...queue,run:(file,task)=>queue.run(file,async()=>{await gate;return task();})};let first;
 try{
  await registerIntelligence({handle:(name,handler)=>handlers.set(name,handler),userData:root,writes,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>{encryptions++;return Buffer.from(value);}},dialog:{},getWindow:()=>null,serviceFactory:()=>({status:()=>({settings}),configure:patch=>{settings={...settings,...patch};return {settings};},request:async()=>{requests++;return {};}})});
  first=handlers.get('intelligenceConfigure')({endpoint:'https://next.example.com/v1'});
  assert.throws(()=>handlers.get('intelligenceConfigure')({endpoint:'https://third.example.com/v1'}),{code:'INTELLIGENCE_BUSY'});assert.throws(()=>handlers.get('intelligenceSetKey')('synthetic-key'),{code:'INTELLIGENCE_BUSY'});assert.throws(()=>handlers.get('intelligenceRequest')({action:'insight'}),{code:'INTELLIGENCE_BUSY'});assert.equal(requests,0);assert.equal(encryptions,0);
  release();await first;assert.equal((await handlers.get('intelligenceStatus')()).settings.endpoint,'https://next.example.com/v1');
  await handlers.get('intelligenceRequest')({action:'insight'});assert.equal(requests,1);
 }finally{release();await first?.catch(()=>{});await queue.drain();await fs.rm(root,{recursive:true,force:true});}
});
test('failed settings persistence restores previous configuration and releases the gate',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-configuration-failure-')),handlers=new Map(),writes=createPrivateWriteQueue();
 try{await registerIntelligence({handle:(name,handler)=>handlers.set(name,handler),userData:root,writes,safeStorage:{},dialog:{},getWindow:()=>null});const before=(await handlers.get('intelligenceStatus')()).settings,destination=path.join(root,'intelligence-settings.json');await fs.mkdir(destination);await assert.rejects(handlers.get('intelligenceConfigure')({endpoint:'https://next.example.com/v1'}));assert.deepEqual((await handlers.get('intelligenceStatus')()).settings,before);await fs.rm(destination,{recursive:true});await handlers.get('intelligenceConfigure')({endpoint:'https://recovered.example.com/v1'});assert.equal((await handlers.get('intelligenceStatus')()).settings.endpoint,'https://recovered.example.com/v1');assert.equal(writes.failed,0);}finally{await writes.drain();await fs.rm(root,{recursive:true,force:true});}
});
test('successful settings replay restores live state if another failed write keeps the app open',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-configuration-retry-')),handlers=new Map(),writes=createPrivateWriteQueue();
 try{await registerIntelligence({handle:(name,handler)=>handlers.set(name,handler),userData:root,writes,safeStorage:{},dialog:{},getWindow:()=>null});const before=(await handlers.get('intelligenceStatus')()).settings,destination=path.join(root,'intelligence-settings.json');await fs.mkdir(destination);await assert.rejects(handlers.get('intelligenceConfigure')({endpoint:'https://retry.example.com/v1'}));assert.deepEqual((await handlers.get('intelligenceStatus')()).settings,before);await writes.run(path.join(root,'other-draft.json'),async()=>{throw Error('Synthetic write failure');}).catch(()=>{});await fs.rm(destination,{recursive:true});await writes.retryFailures();assert.equal(writes.failed,1);const persisted=JSON.parse(await fs.readFile(destination,'utf8'));assert.equal(persisted.endpoint,'https://retry.example.com/v1');assert.deepEqual((await handlers.get('intelligenceStatus')()).settings,persisted);}finally{await writes.drain();await fs.rm(root,{recursive:true,force:true});}
});
