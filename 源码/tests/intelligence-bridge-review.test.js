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
