import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {workspaceReducer,createWorkspaceState,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Isolated IndexedDB interface fixture: transactions serialize across every
// connection, get/put dispatch request events, and abort discards all writes.
// Production createWorkspaceStore uses these transactions directly, not a
// replacement session/store implementation. No browser profile is touched.
function indexedFixture(initial=new Map()){
 const data=new Map([...initial].map(([key,value])=>[key,structuredClone(value)])),trace=[];let tail=Promise.resolve();
 const db={transaction(name,mode){
  assert.equal(name,'workspaces');const done={};done.promise=new Promise(resolve=>done.resolve=resolve);const previous=tail;tail=done.promise;
  const operations=[],writes=[];let ended=false,error;
  const tx={error:null,objectStore(storeName){assert.equal(storeName,name);return {
   get(key){const request={};operations.push(()=>{trace.push({mode,kind:'get',key});request.result=structuredClone(data.get(key));request.onsuccess?.();});return request;},
   put(value,key){assert.equal(mode,'readwrite');writes.push([key,structuredClone(value)]);trace.push({mode,kind:'put',key});return {};},
  };},abort(){if(ended)return;ended=true;queueMicrotask(()=>{tx.onabort?.();done.resolve();});}};
  previous.then(async()=>{await tick();if(ended)return;for(const operation of operations){if(ended)break;try{operation();}catch(value){error=value;tx.error=value;tx.abort();}}
   await tick();if(ended)return;ended=true;if(error){tx.onerror?.();}else{for(const [key,value] of writes)data.set(key,value);tx.oncomplete?.();}done.resolve();
  });return tx;
 }};return {data,trace,db};
}
function stores(fixture,identity='isolated'){
 const options={openDatabase:async()=>fixture.db,createChannel:()=>null,eventTarget:null};return [createWorkspaceStore(identity,options),createWorkspaceStore(identity,options)];
}
const add=id=>[{type:'card.upsert',card:{id,title:id,body:id}},{type:'card.save',id,saved:true}];
const draft=(body,key='new:text')=>({type:'draft.set',key,value:{body}});

test('copying history leaves source and current edits intact and preserves an occupied destination',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),old=createWorkspaceSession(store,{sessionId:'old'});
 await old.commit(draft('older input','edit:card'));
 const current=createWorkspaceSession(store,{sessionId:'current'});await current.load();
 await current.commit(draft('current card input','edit:card'));await current.commit(draft('unsaved new card','new:text'));
 const source=current.recoverableDrafts().find(value=>value.key==='edit:card'),before=structuredClone((await store.load()).drafts[source.id]);
 const restored=await current.copyDraft(source.id,'new:text',value=>({...value,collectionIds:[]}));
 assert.equal(restored.value.body,'older input');assert.equal(current.drafts()['edit:card'].body,'current card input');assert.equal(current.drafts()['new:text'].body,'older input');
 assert.deepEqual((await store.load()).drafts[source.id],before);
 const kept=current.recoverableDrafts().find(value=>value.key==='new:text'&&value.value.body==='unsaved new card');assert.equal(kept.recoveryOnly,true);
 const backup=parseWorkspaceBackup(serializeWorkspace(await current.settled()));assert.ok(Object.values(backup.drafts).some(value=>value.value?.body==='unsaved new card'));
});

test('ordinary resume retains the replaced editor input as a visible restorable history entry',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),old=createWorkspaceSession(store,{sessionId:'old'});await old.commit(draft('older note','note:card'));
 const current=createWorkspaceSession(store,{sessionId:'current'});await current.load();await current.commit(draft('current note','note:card'));
 const source=current.recoverableDrafts()[0];await current.resumeDraft(source.id);
 assert.equal(current.drafts()['note:card'].body,'older note');
 const kept=current.recoverableDrafts().find(value=>value.value.body==='current note');assert.ok(kept);assert.equal(kept.recoveryOnly,true);
 await current.resumeDraft(kept.id);assert.equal(current.drafts()['note:card'].body,'current note');
 const fresh=createWorkspaceSession(store,{sessionId:'fresh'});await fresh.load();assert.equal(fresh.drafts()['note:card'].body,'current note');
});

test('copy recovery transaction failure preserves both drafts and a retry archives the prior target atomically',async()=>{
 const fixture=indexedFixture(),[base]=stores(fixture);let fail=false;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(fail){fail=false;throw Error('synthetic disk failure');}return next;})};
 const old=createWorkspaceSession(store,{sessionId:'old'});await old.commit(draft('source','edit:card'));
 const current=createWorkspaceSession(store,{sessionId:'current'});await current.load();await current.commit(draft('destination','new:text'));
 const source=current.recoverableDrafts()[0],before=await base.load();fail=true;
 await assert.rejects(current.copyDraft(source.id,'new:text'),/synthetic disk failure/);
 assert.deepEqual(await base.load(),before);assert.equal(current.drafts()['new:text'].body,'destination');
 await current.copyDraft(source.id,'new:text');assert.equal(current.drafts()['new:text'].body,'source');assert.ok(current.recoverableDrafts().some(value=>value.value.body==='destination'));
});

test('memory input after failed autosave survives failed recovery and is archived by a successful retry',async()=>{
 const fixture=indexedFixture(),[base]=stores(fixture);let fail=false;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(fail){fail=false;throw Error('synthetic disk failure');}return next;})};
 const old=createWorkspaceSession(store,{sessionId:'old'});await old.commit(draft('source','edit:card'));
 const current=createWorkspaceSession(store,{sessionId:'current'});await current.load();await current.commit(draft('durable destination','new:text'));
 const source=current.recoverableDrafts()[0];fail=true;await assert.rejects(current.commit(draft('memory-only input','new:text')),/synthetic disk failure/);
 fail=true;await assert.rejects(current.copyDraft(source.id,'new:text'),/synthetic disk failure/);assert.equal(current.drafts()['new:text'].body,'memory-only input');
 await current.copyDraft(source.id,'new:text');assert.equal(current.drafts()['new:text'].body,'source');
 const kept=current.recoverableDrafts().map(value=>value.value.body);assert.ok(kept.includes('memory-only input'));assert.ok(kept.includes('durable destination'));await current.settled();
});

test('a later queued edit stays current while recovery completes and is not removed with older pending input',async()=>{
 const fixture=indexedFixture(),[base]=stores(fixture);let pause=false,release,began;
 const started=new Promise(resolve=>began=resolve),store={...base,update:async updater=>{if(pause){pause=false;began();await new Promise(resolve=>release=resolve);}return base.update(updater);}};
 const old=createWorkspaceSession(store,{sessionId:'old'});await old.commit(draft('source','edit:card'));
 const current=createWorkspaceSession(store,{sessionId:'current'});await current.load();await current.commit(draft('destination','new:text'));
 const source=current.recoverableDrafts()[0];pause=true;const recovering=current.copyDraft(source.id,'new:text');await started;
 const later=current.commit(draft('later typing','new:text'));release();await recovering;assert.equal(current.drafts()['new:text'].body,'later typing');
 await later;assert.equal(current.drafts()['new:text'].body,'later typing');assert.ok(current.recoverableDrafts().some(value=>value.value.body==='destination'));await current.settled();
});

test('equal-content recovery creates no redundant archive and conflicting source stays conflicted only in normal resume',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture);
 await store.update(state=>workspaceReducer(state,{type:'draft.set',key:'window-draft:old:edit%3Acard',value:{key:'edit:card',value:{body:'source'},base:{entity:'card:card',version:-1},conflict:true,recoveryOnly:true}}));
 const current=createWorkspaceSession(store,{sessionId:'current'});await current.load();const source=current.recoverableDrafts()[0];
 await current.resumeDraft(source.id);await current.resumeDraft(source.id);assert.equal(current.recoverableDrafts().length,2);
 await assert.rejects(current.commit({type:'card.upsert',card:{id:'card',body:'must not overwrite'}}),{code:'WORKSPACE_CONFLICT'});
 await current.copyDraft(source.id,'new:text');const target=(await store.load()).drafts['window-draft:current:new%3Atext'];assert.equal(target.conflict,false);assert.equal(target.base,null);assert.equal(target.adoptedFrom,null);
});
