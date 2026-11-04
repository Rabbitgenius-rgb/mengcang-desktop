const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {registerIntelligence}=require('../desktop/intelligence-bridge.cjs');
const {createPrivateWriteQueue}=require('../desktop/security.cjs');
test('API key is encrypted at rest, destination-bound and never returned by status',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-intelligence-'));const handlers=new Map();let opts,settings={endpoint:'https://api.example.com/v1'},response=0;
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s.split('').reverse().join('')),decryptString:b=>b.toString().split('').reverse().join('')};
 try{await registerIntelligence({handle:(n,h)=>handlers.set(n,h),userData:root,safeStorage,dialog:{showMessageBox:async()=>({response})},getWindow:()=>({isDestroyed:()=>false}),writes:createPrivateWriteQueue(),serviceFactory:o=>{opts=o;return {status:()=>({settings}),configure:p=>{settings={...settings,...p};return {settings};},request:()=>{throw Error('not used');}};}});
  await handlers.get('intelligenceSetKey')('synthetic-secret');const disk=await fs.readFile(path.join(root,'intelligence-key.json'),'utf8');assert.ok(!disk.includes('synthetic-secret'));assert.equal((await fs.stat(path.join(root,'intelligence-key.json'))).mode&0o777,0o600);assert.equal((await handlers.get('intelligenceStatus')()).hasApiKey,true);assert.ok(!JSON.stringify(await handlers.get('intelligenceStatus')()).includes('synthetic-secret'));assert.equal(await opts.getApiKey(),'synthetic-secret');
  assert.equal(await opts.confirmRequest({provider:'api',endpoint:settings.endpoint,characters:5}),false);response=1;assert.equal(await opts.confirmRequest({provider:'api',endpoint:settings.endpoint,characters:5}),true);
  await handlers.get('intelligenceConfigure')({endpoint:'https://different.example.com/v1'});assert.equal((await handlers.get('intelligenceStatus')()).hasApiKey,false);await assert.rejects(opts.getApiKey(),/地址已改变/);await handlers.get('intelligenceSetKey')('');assert.equal((await handlers.get('intelligenceStatus')()).hasApiKey,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('analysis click is authorized without a second dialog while probe still requires confirmation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-direct-analysis-'));let opts,dialogs=0,response=0,destroyed=false;
 try{await registerIntelligence({handle:()=>{},userData:root,safeStorage:{isEncryptionAvailable:()=>true},dialog:{showMessageBox:async()=>{dialogs++;return {response};}},getWindow:()=>({isDestroyed:()=>destroyed}),writes:createPrivateWriteQueue(),serviceFactory:o=>{opts=o;return {status:()=>({settings:{endpoint:'https://api.example.com/v1'}})};}});
  for(const provider of ['api','cli'])for(const action of ['insight','classify','grill'])assert.equal(await opts.confirmRequest({provider,action}),true);
  assert.equal(dialogs,0);assert.equal(opts.analysisRequiresConfirmation,false);
  assert.equal(await opts.confirmRequest({provider:'api',action:'probe'}),false);assert.equal(dialogs,1);
  destroyed=true;assert.equal(await opts.confirmRequest({provider:'api',action:'insight'}),false);assert.equal(dialogs,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('decrypted key is reused only for the current ciphertext and endpoint and is cleared on removal',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-key-cache-')),handlers=new Map();let opts,decryptions=0,settings={endpoint:'https://api.example.com/v1',generationEnabled:true};
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:key=>Buffer.from(key),decryptString:b=>{decryptions++;return b.toString();}};
 try{await registerIntelligence({handle:(n,h)=>handlers.set(n,h),userData:root,safeStorage,dialog:{},getWindow:()=>null,writes:createPrivateWriteQueue(),serviceFactory:o=>{opts=o;return {status:()=>({settings}),configure:p=>{settings={...settings,...p};return {settings};}};}});
  await handlers.get('intelligenceSetKey')('synthetic-first');assert.equal(decryptions,0);
  for(let i=0;i<3;i++)assert.equal(await opts.getApiKey(),'synthetic-first');assert.equal(decryptions,1);
  await handlers.get('intelligenceSetKey')('synthetic-second');assert.equal(await opts.getApiKey(),'synthetic-second');assert.equal(decryptions,2);
  await handlers.get('intelligenceConfigure')({endpoint:'https://changed.example.com/v1'});await assert.rejects(opts.getApiKey(),/地址已改变/);assert.equal(decryptions,2);
  await handlers.get('intelligenceSetKey')('');assert.equal(await opts.getApiKey(),'');
  assert.equal(JSON.stringify(await handlers.get('intelligenceStatus')()).includes('synthetic-'),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('native local transcription confirmation describes offline one-shot execution and keeps API settings separate',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-local-transcription-confirm-'));let opts,box,response=0;
 const runtime=path.join(root,'runtime');
 try{await registerIntelligence({handle:()=>{},userData:root,localTranscriptionRuntimeDir:runtime,safeStorage:{isEncryptionAvailable:()=>{throw Error('Local transcription must not access keys');}},dialog:{showMessageBox:async(_window,value)=>{box=value;return {response};}},getWindow:()=>({isDestroyed:()=>false}),writes:createPrivateWriteQueue(),serviceFactory:o=>{opts=o;return {status:()=>({settings:{endpoint:'https://api.deepseek.com/v1'}})};}});
  assert.equal(opts.localTranscriptionRuntimeDir,runtime);
  const info={action:'transcribe',provider:'local',model:'large-v3-turbo',filename:'完整访谈.wav',bytes:1048576,local:true,onDemand:true};
  assert.equal(await opts.confirmRequest(info),false);
  assert.equal(box.title,'确认本机音频转录');assert.match(box.message,/完成后退出并释放模型内存/);
  assert.match(box.detail,/不上传音频、不调用云端、不消耗 API 额度/);assert.match(box.detail,/完整访谈\.wav · 1\.00 MiB/);
  assert.equal(box.detail.includes('api.deepseek.com'),false);assert.equal(box.message.includes('消耗所选服务'),false);
  assert.equal(box.defaultId,0);assert.equal(box.cancelId,0);response=1;assert.equal(await opts.confirmRequest(info),true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('one explicit analysis request sends one mocked API call without a native confirmation or startup call',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-click-integration-')),handlers=new Map();let calls=0,decryptions=0;
 const {createIntelligenceService}=require('../desktop/intelligence.cjs');
 try{await registerIntelligence({handle:(n,h)=>handlers.set(n,h),userData:root,writes:createPrivateWriteQueue(),safeStorage:{isEncryptionAvailable:()=>true,encryptString:key=>Buffer.from(key),decryptString:b=>{decryptions++;return b.toString();}},dialog:{showMessageBox:async()=>{throw Error('Unexpected analysis confirmation');}},getWindow:()=>({isDestroyed:()=>false}),serviceFactory:opts=>createIntelligenceService({...opts,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'synthetic-result'},finish_reason:'stop'}]}));}})});
  await handlers.get('intelligenceConfigure')({generationEnabled:true,provider:'api',model:'synthetic',endpoint:'https://api.example.com/v1'});await handlers.get('intelligenceSetKey')('synthetic-key');
  const status=await handlers.get('intelligenceStatus')();assert.equal(status.requiresConfirmation,false);assert.equal(status.transcriptionRequiresConfirmation,true);assert.equal(calls,0);assert.equal(decryptions,0);
  for(let i=0;i<2;i++){const result=await handlers.get('intelligenceRequest')({action:'insight',mode:'The Gist',title:'Synthetic material',text:'Synthetic body'});assert.equal(result.text,'synthetic-result');assert.equal(calls,i+1);}
  assert.equal(decryptions,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('denied keychain access does not populate the cache and returns a useful local error without a model request',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-key-denied-')),handlers=new Map();let opts,allowed=false,decryptions=0;
 try{await registerIntelligence({handle:(n,h)=>handlers.set(n,h),userData:root,writes:createPrivateWriteQueue(),safeStorage:{isEncryptionAvailable:()=>true,encryptString:key=>Buffer.from(key),decryptString:b=>{decryptions++;if(!allowed)throw Error('synthetic OS denial');return b.toString();}},dialog:{},getWindow:()=>null,serviceFactory:o=>{opts=o;return {status:()=>({settings:{endpoint:'https://api.example.com/v1',generationEnabled:true}})};}});
  await handlers.get('intelligenceSetKey')('synthetic-key');await assert.rejects(opts.getApiKey(),{code:'API_KEY_UNLOCK_REQUIRED'});assert.equal(decryptions,1);allowed=true;assert.equal(await opts.getApiKey(),'synthetic-key');assert.equal(decryptions,2);assert.equal(await opts.getApiKey(),'synthetic-key');assert.equal(decryptions,2);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
