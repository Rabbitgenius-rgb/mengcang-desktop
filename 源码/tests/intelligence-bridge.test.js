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
test('native image confirmation describes the upload without receiving image bytes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mengcang-image-confirm-'));let opts,box,response=0;
 try{await registerIntelligence({handle:()=>{},userData:root,safeStorage:{isEncryptionAvailable:()=>true},dialog:{showMessageBox:async(_window,value)=>{box=value;return {response};}},getWindow:()=>({isDestroyed:()=>false}),writes:createPrivateWriteQueue(),serviceFactory:o=>{opts=o;return {status:()=>({settings:{endpoint:'https://api.deepseek.com/v1'}})};}});
  const info={provider:'api',endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash',characters:12,action:'insight',image:{name:'测试图片.png',type:'image/png',bytes:1048576}};
  assert.equal(await opts.confirmRequest(info),false);
  assert.match(box.detail,/测试图片\.png · image\/png · 1\.00 MiB/);
  assert.match(box.detail,/确认后将上传这张图片和所选文字/);
  assert.match(box.detail,/12 个字符/);assert.equal(box.defaultId,0);assert.equal(box.cancelId,0);
  assert.equal(JSON.stringify(box).includes('base64'),false);assert.equal(JSON.stringify(box).includes('dataUrl'),false);
  response=1;assert.equal(await opts.confirmRequest(info),true);
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
