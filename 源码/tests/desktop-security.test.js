const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {relative,bundleFile,trustedFrame,draftName,jsonValue,atomicPrivate,createPrivateWriteQueue}=require('../desktop/security.cjs');
test('desktop paths reject traversal, absolute paths and control characters',()=>{for(const input of ['../secret','/etc/passwd','x/../secret','x\\y','x\0y',''])assert.throws(()=>relative(input));assert.equal(relative('01_sources/cards/text/构图.md'),'01_sources/cards/text/构图.md');});
test('only application main frame can invoke note operations',()=>{const frame={url:'mengcang://app/'};assert.equal(trustedFrame({senderFrame:frame,sender:{mainFrame:frame}}),true);assert.equal(trustedFrame({senderFrame:{url:'https://example.com/'},sender:{mainFrame:frame}}),false);assert.equal(trustedFrame({senderFrame:{url:'mengcang://app/'},sender:{mainFrame:frame}}),false);});
test('bundle reads prevent symlink escape and non-app origins',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-bundle-'));try{fs.writeFileSync(path.join(dir,'index.html'),'ok');fs.symlinkSync('/etc/passwd',path.join(dir,'leak'));assert.equal(bundleFile(dir,'mengcang://app/'),path.join(fs.realpathSync(dir),'index.html'));assert.throws(()=>bundleFile(dir,'mengcang://app/leak'));assert.throws(()=>bundleFile(dir,'https://app/'));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('draft names are scoped and payloads bounded',()=>{assert.notEqual(draftName('vault-a::same.md'),draftName('vault-b::same.md'));assert.match(draftName('../secret'),/^[a-f0-9]{64}\.json$/);assert.throws(()=>jsonValue('x'.repeat(100),32));});
test('private atomic saves retain restrictive permissions',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-private-'));try{const file=path.join(dir,'nested/value.json');await atomicPrivate(file,'{"ok":true}');assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.readFileSync(file,'utf8'),'{"ok":true}');}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('30 rapid draft saves are serialized and the last submitted content is restored exactly',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-draft-queue-'));
 try{
  const file=path.join(dir,'draft.json'),queue=createPrivateWriteQueue(),submitted=Array.from({length:30},(_,i)=>JSON.stringify({sequence:i,text:'草稿'.repeat(200+i)}));
  const operations=submitted.map(value=>queue.run(file,()=>atomicPrivate(file,value)));
  const results=await Promise.allSettled(operations);
  assert.equal(results.filter(r=>r.status==='rejected').length,0);
  const restored=await queue.run(file,()=>fs.promises.readFile(file,'utf8'));
  assert.equal(restored,submitted.at(-1));assert.equal(JSON.parse(restored).sequence,29);
  assert.equal(queue.size,0);assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.deepEqual(fs.readdirSync(dir),['draft.json']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('draft deletion shares the write queue and cannot be resurrected by an earlier save',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-draft-delete-'));
 try{
  const file=path.join(dir,'draft.json'),queue=createPrivateWriteQueue();
  const writes=Array.from({length:30},(_,i)=>queue.run(file,()=>atomicPrivate(file,JSON.stringify({sequence:i}))));
  const deletion=queue.run(file,()=>fs.promises.rm(file,{force:true}));
  await Promise.all([...writes,deletion]);assert.equal(fs.existsSync(file),false);
  await queue.run(file,()=>atomicPrivate(file,'{"newDraft":true}'));
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).newDraft,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('quit drain waits for in-flight work and newly queued writes; one failure does not poison later drafts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc-draft-drain-'));
 try{
  const file=path.join(dir,'draft.json'),other=path.join(dir,'other.json'),queue=createPrivateWriteQueue();
  let release;const gate=new Promise(resolve=>{release=resolve;});let finished=false;
  const first=queue.run(file,async()=>{await gate;await atomicPrivate(file,'{"sequence":1}');});
  const drain=queue.drain().then(()=>{finished=true;});
  await Promise.resolve();assert.equal(finished,false);
  const failure=queue.run(file,async()=>{throw Object.assign(new Error('disk unavailable'),{code:'ENOSPC'});});
  const failureCheck=assert.rejects(failure,{code:'ENOSPC'});
  const last=queue.run(file,()=>atomicPrivate(file,'{"sequence":2}'));
  const independent=queue.run(other,()=>atomicPrivate(other,'{"independent":true}'));
  await independent;assert.equal(finished,false);release();
  await Promise.all([first,failureCheck,last,drain]);
  assert.equal(finished,true);assert.equal(queue.size,0);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).sequence,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('failed latest draft remains an exit blocker after reads until retry succeeds',async()=>{
 const queue=createPrivateWriteQueue();let writable=false;let stored='old';
 const task=async()=>{if(!writable)throw new Error('disk full');stored='latest';};
 await assert.rejects(queue.run('/tmp/mc-exit-draft',task));await queue.drain();assert.equal(queue.failed,1);
 assert.equal(await queue.read('/tmp/mc-exit-draft',()=>stored),'old');assert.equal(queue.failed,1);
 writable=true;await queue.retryFailures();assert.equal(queue.failed,0);assert.equal(stored,'latest');
});

test('only original-file captures can use the larger JSON envelope, with identical file validation',()=>{
 const {captureJson,jsonValue}=require('../desktop/security.cjs');const bytes=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(2*1024*1024,32)]),attachment={name:'fixture.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')};
 const value={title:'Synthetic',body:'',attachment};assert.deepEqual(JSON.parse(captureJson(value)).attachment,attachment);assert.throws(()=>jsonValue(value));assert.throws(()=>captureJson({...value,attachment:{...attachment,size:1}}));assert.throws(()=>captureJson({body:'x'.repeat(2*1024*1024)}));
});
