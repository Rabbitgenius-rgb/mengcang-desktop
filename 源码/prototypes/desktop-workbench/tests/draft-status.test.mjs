import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore,draftStatus,hasDraftChanges} from '../src/draftStatus.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a pending write cannot overtake a later edit or discard, including after remount',async()=>{
  const first=deferred(),calls=[];let disk;
  const store=createDraftStore({draftGet:async()=>disk,draftSet:async(key,value)=>{calls.push(value);if(value==='old edit')await first.promise;disk=value;return {saved:true};}});
  const old=store.write('note','old edit');
  const newer=store.write('note','new edit');
  const discard=store.write('note','original fields');
  let restored=false;const read=store.read('note').then(value=>{restored=true;return value;});
  await tick();assert.deepEqual(calls,['old edit']);assert.equal(restored,false);
  first.resolve();await Promise.all([old,newer,discard]);
  assert.deepEqual(calls,['old edit','new edit','original fields']);assert.equal(await read,'original fields');
});

test('failed local persistence is reported and does not block a later retry',async()=>{
  let attempt=0,disk;
  const store=createDraftStore({draftGet:async()=>disk,draftSet:async(key,value)=>{if(++attempt===1)return {ok:false,error:{code:'ENOSPC',message:'磁盘已满'}};disk=value;return {saved:true};}});
  await assert.rejects(store.write('note','draft'),error=>error.code==='ENOSPC');
  assert.equal(disk,undefined);
  await store.write('note','retry');assert.equal(await store.read('note'),'retry');
});

test('failed discard restores the bridge memory cache before another component reads',async()=>{
  const retained={caption:'未保存的草稿'};let memory=retained;
  const store=createDraftStore({draftGet:async()=>memory,draftSet:async(key,value)=>{memory=value;if(value===null)throw new Error('cannot remove draft');return {saved:true};}});
  const discard=store.discard('note',retained),read=store.read('note');
  await assert.rejects(discard,/cannot remove draft/);
  assert.deepEqual(await read,retained);
});

test('confirmed discard removes only its local draft without a note-save API',async()=>{
  const values=new Map([['one',{caption:'draft'}],['two',{caption:'other'}]]);
  const store=createDraftStore({draftGet:async key=>values.get(key),draftSet:async(key,value)=>{if(value===null)values.delete(key);else values.set(key,value);}});
  await store.discard('one',values.get('one'));
  assert.equal(await store.read('one'),undefined);assert.deepEqual(await store.read('two'),{caption:'other'});
});

test('one note with slow storage does not block another note',async()=>{
  const slow=deferred(),values=new Map();
  const store=createDraftStore({draftGet:async key=>values.get(key),draftSet:async(key,value)=>{if(key==='slow')await slow.promise;values.set(key,value);}});
  const first=store.write('slow','one');await store.write('other','two');
  assert.equal(await store.read('other'),'two');assert.equal(values.has('slow'),false);
  slow.resolve();await first;
});

test('local durability and Obsidian confirmation remain distinct in every draft status',()=>{
  const base={ready:true,hasChanges:true,localState:'saved'};
  assert.equal(draftStatus({...base,ready:false}).state,'restoring');
  assert.equal(draftStatus({...base,localState:'saving'}).state,'saving-local');
  assert.equal(draftStatus(base).label,'本机草稿 · 尚未保存到 Obsidian');
  assert.equal(draftStatus({...base,hasChanges:false}).state,'saved');
  assert.equal(draftStatus({...base,conflict:true}).state,'conflict');
  assert.equal(draftStatus({...base,localError:'write failed',localState:'saving'}).state,'error');
  assert.equal(draftStatus({...base,hasChanges:false,localError:'cleanup failed'}).state,'error');
  assert.equal(draftStatus({...base,saveError:true}).state,'error');
});

test('draft presence includes exploration and actual attribute changes, not tag punctuation',()=>{
  const base={role:'seed',category:'',caption:'原文',tags:'月亮，网页'};
  assert.equal(hasDraftChanges({form:{...base,tags:'月亮,网页'},baseValues:base,exploration:'  '}),false);
  assert.equal(hasDraftChanges({form:base,baseValues:base,exploration:'新的探索'}),true);
  assert.equal(hasDraftChanges({form:{...base,caption:''},baseValues:base}),true);
});
