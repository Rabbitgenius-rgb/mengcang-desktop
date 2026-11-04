import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {workspaceReducer,createWorkspaceState,serializeWorkspace,parseWorkspaceBackup,mergeWorkspaceBackup} from '../src/sublime/workspaceModel.js';
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

test('two store connections atomically read and update current IndexedDB data, retaining both new cards',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture);const one=createWorkspaceSession(a,{sessionId:'a'}),two=createWorkspaceSession(b,{sessionId:'b'});
 await Promise.all([one.load(),two.load()]);await Promise.all([one.commit(add('window-a')),two.commit(add('window-b'))]);
 const result=await a.load();assert.deepEqual(result.cards.map(value=>value.id),['window-a','window-b']);assert.deepEqual(result.savedIds,['window-a','window-b']);
 assert.equal(fixture.trace.filter(value=>value.mode==='readwrite'&&value.kind==='get').length,2);assert.equal(fixture.trace.filter(value=>value.kind==='put').length,2);
});
test('legacy whole-snapshot saves reject stale data instead of overwriting a newer window',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture);const [one,two]=await Promise.all([a.load(),b.load()]);await a.save(add('a').reduce(workspaceReducer,one));
 await assert.rejects(b.save(add('b').reduce(workspaceReducer,two)),{code:'WORKSPACE_CONFLICT'});assert.deepEqual((await b.load()).cards.map(value=>value.id),['a']);
});
test('transaction updater failure or asynchronous callback cannot partly save changes',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture);await store.update(value=>add('before').reduce(workspaceReducer,value));
 await assert.rejects(store.update(()=>{throw Error('invalid update');}),/invalid update/);await assert.rejects(store.update(async value=>value),/同步/);
 assert.deepEqual((await store.load()).cards.map(value=>value.id),['before']);assert.equal(fixture.data.get('isolated').revision,1);
});
test('identity-scoped notifications refresh other open sessions without reading another library',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),[c]=stores(fixture,'separate');const one=createWorkspaceSession(a),two=createWorkspaceSession(b),other=createWorkspaceSession(c);await Promise.all([one.load(),two.load(),other.load()]);
 let received=0,foreign=0;const dispose=two.subscribe((state,meta)=>{if(meta.external&&state.cards.some(card=>card.id==='visible'))received++;}),disposeOther=other.subscribe(()=>foreign++);
 await one.commit(add('visible'));for(let i=0;i<5&&!received;i++)await tick();assert.ok(received);assert.equal(two.state.cards[0].id,'visible');assert.equal(foreign,0);dispose();disposeOther();
});
test('each window keeps its new-card draft and full backups retain both copies',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),one=createWorkspaceSession(a,{sessionId:'a'}),two=createWorkspaceSession(b,{sessionId:'b'});await Promise.all([one.load(),two.load()]);
 await Promise.all([one.commit(draft('A input')),two.commit(draft('B input'))]);await Promise.all([one.load(),two.load()]);assert.equal(one.drafts()['new:text'].body,'A input');assert.equal(two.drafts()['new:text'].body,'B input');
 const backup=parseWorkspaceBackup(serializeWorkspace(await one.settled())),values=Object.values(backup.drafts).map(value=>value.value?.body).filter(Boolean);assert.deepEqual(values.sort(),['A input','B input']);
 await one.commit({type:'draft.set',key:'new:text',value:null});assert.equal(two.drafts()['new:text'].body,'B input');assert.equal(Object.values((await a.load()).drafts).length,1);
});
test('same-card stale editor rejects overwrite even after receiving an external refresh; rejected input survives reload',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),one=createWorkspaceSession(a,{sessionId:'a'}),two=createWorkspaceSession(b,{sessionId:'b'});await one.commit(add('same'));await two.load();
 one.beginEdit('edit:same',{type:'card',id:'same'});two.beginEdit('edit:same',{type:'card',id:'same'});await one.commit(draft('A old input','edit:same'));await two.commit(draft('B new input','edit:same'));
 await two.commit([{type:'card.upsert',card:{id:'same',body:'B saved'}},{type:'draft.set',key:'edit:same',value:null}],{editKey:'edit:same'});await one.load();assert.equal(one.state.cards[0].body,'B saved');
 await assert.rejects(one.commit([{type:'card.upsert',card:{id:'same',body:'A rejected'}},{type:'draft.set',key:'edit:same',value:null}],{editKey:'edit:same'}),{code:'WORKSPACE_CONFLICT'});
 assert.equal(one.drafts()['edit:same'].body,'A old input');assert.equal((await a.load()).cards[0].body,'B saved');await assert.rejects(one.settled(),{code:'WORKSPACE_CONFLICT'});
 const fresh=createWorkspaceSession(a,{sessionId:'reloaded'});await fresh.load();assert.equal(fresh.drafts()['edit:same'].body,'A old input');const recovered=fresh.recoverableDrafts().find(value=>value.key==='edit:same');assert.equal(recovered.conflict,true);assert.equal((await fresh.resumeDraft(recovered.id)).value.body,'A old input');
 await assert.rejects(fresh.commit({type:'card.upsert',card:{id:'same',body:'A retry'}},{editKey:'edit:same'}),{code:'WORKSPACE_CONFLICT'});
});
test('legacy unscoped drafts reopen intact and explicit successful clear removes the legacy copy',async()=>{
 const legacy=workspaceReducer(createWorkspaceState(),draft('legacy body','edit:legacy')),fixture=indexedFixture(new Map([['isolated',legacy]])),[store]=stores(fixture),session=createWorkspaceSession(store,{sessionId:'new'});await session.load();
 assert.equal(session.drafts()['edit:legacy'].body,'legacy body');await session.commit(draft('continued','edit:legacy'));assert.equal(session.drafts()['edit:legacy'].body,'continued');await session.commit({type:'draft.set',key:'edit:legacy',value:null});assert.equal(session.drafts()['edit:legacy'],undefined);assert.deepEqual((await store.load()).drafts,{});
});
test('submitted adopted drafts do not reappear after refresh or another reload, while their history remains recoverable',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),old=createWorkspaceSession(store,{sessionId:'old'});await old.commit(draft('resumed input'));
 const resumed=createWorkspaceSession(store,{sessionId:'resumed'});await resumed.load();assert.equal(resumed.drafts()['new:text'].body,'resumed input');await resumed.commit(draft('continued input'));
 await resumed.commit([...add('submitted'),{type:'draft.set',key:'new:text',value:null}]);await resumed.load();assert.equal(resumed.drafts()['new:text'],undefined);
 const fresh=createWorkspaceSession(store,{sessionId:'next-reload'});await fresh.load();assert.equal(fresh.drafts()['new:text'],undefined);assert.ok(fresh.recoverableDrafts().some(value=>value.value.body==='resumed input'&&value.recoveryOnly));
});
test('refresh never adopts another active window draft over the current input; newer source input is not consumed by an older resume',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),one=createWorkspaceSession(a,{sessionId:'a'});await one.commit(draft('original input'));
 const two=createWorkspaceSession(b,{sessionId:'b'});await two.load();await two.commit(draft('local continuation'));await one.commit(draft('other window later input'));await two.load();assert.equal(two.drafts()['new:text'].body,'local continuation');
 await two.commit([...add('from-b'),{type:'draft.set',key:'new:text',value:null}]);await two.load();assert.equal(two.drafts()['new:text'],undefined);const reloaded=createWorkspaceSession(b,{sessionId:'c'});await reloaded.load();assert.equal(reloaded.drafts()['new:text'].body,'other window later input');
});
test('imported recovery-only stale input stays manual and cannot overwrite the current card without a comparable baseline',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture);await store.update(state=>workspaceReducer(add('existing').reduce(workspaceReducer,state),{type:'draft.set',key:'window-draft:imported:edit-existing',value:{key:'edit:existing',value:{body:'old backup'},base:null,updatedAt:'2025',conflict:true,recoveryOnly:true,imported:true}}));
 const session=createWorkspaceSession(store,{sessionId:'current'});await session.load();assert.equal(session.drafts()['edit:existing'],undefined);const record=session.recoverableDrafts()[0];await session.resumeDraft(record.id);session.beginEdit('edit:existing',{type:'card',id:'existing'});
 await assert.rejects(session.commit({type:'card.upsert',card:{id:'existing',body:'old backup'}},{editKey:'edit:existing'}),{code:'WORKSPACE_CONFLICT'});assert.equal((await store.load()).cards[0].body,'existing');
});
test('focus refresh works without BroadcastChannel and unsubscribing removes window listeners',async()=>{
 const fixture=indexedFixture(),handlers=new Map(),eventTarget={addEventListener(name,handler){handlers.set(name,handler);},removeEventListener(name,handler){if(handlers.get(name)===handler)handlers.delete(name);}};
 const a=createWorkspaceStore('isolated',{openDatabase:async()=>fixture.db,createChannel:()=>null,eventTarget}),b=createWorkspaceStore('isolated',{openDatabase:async()=>fixture.db,createChannel:()=>null,eventTarget:null}),session=createWorkspaceSession(a);await session.load();let refreshed=false;const off=session.subscribe((state,meta)=>{if(meta.external&&state.cards.length)refreshed=true;});
 // Simulate a separate realm that does not share module-local notifications.
 fixture.data.set('isolated',{...createWorkspaceState(),cards:[{id:'external',title:'external'}]});handlers.get('focus')();for(let i=0;i<5&&!refreshed;i++)await tick();assert.ok(refreshed);off();assert.equal(handlers.size,0);a.close();b.close();
});
test('canvas own writes advance the baseline and every retry after a foreign update remains a conflict',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),one=createWorkspaceSession(a,{sessionId:'a'}),two=createWorkspaceSession(b,{sessionId:'b'}),board={id:'canvas',title:'Canvas',nodes:[],edges:[]};
 await one.commit({type:'board.upsert',board});await two.load();one.beginEdit('board:canvas',{type:'board',id:'canvas'});two.beginEdit('board:canvas',{type:'board',id:'canvas'});
 await one.commit({type:'board.upsert',board:{...board,title:'First movement'}});await one.commit({type:'board.upsert',board:{...board,title:'Second movement'}});
 await assert.rejects(two.commit({type:'board.upsert',board:{...board,title:'Rejected movement'}}),{code:'WORKSPACE_CONFLICT'});await assert.rejects(two.commit({type:'board.upsert',board:{...board,title:'Repeated rejected movement'}}),{code:'WORKSPACE_CONFLICT'});
 assert.equal((await a.load()).boards[0].title,'Second movement');assert.equal(two.recoverableDrafts().find(value=>value.key==='board:canvas').value.title,'Repeated rejected movement');assert.equal(two.drafts()['board:canvas'].title,'Repeated rejected movement');
});
test('note modal baseline survives refresh and conflicting annotation text remains a recoverable local note',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),one=createWorkspaceSession(a,{sessionId:'a'}),two=createWorkspaceSession(b,{sessionId:'b'});await one.commit(add('note-card'));await two.load();one.beginEdit('note:note-card',{type:'note',id:'note-card'});two.beginEdit('note:note-card',{type:'note',id:'note-card'});
 await one.commit({type:'draft.set',key:'note:note-card',value:{note:'Local note'}});await two.commit({type:'card.note',id:'note-card',note:'Other saved note'});await one.load();await assert.rejects(one.commit([{type:'card.note',id:'note-card',note:'Local note'},{type:'draft.set',key:'note:note-card',value:null}]),{code:'WORKSPACE_CONFLICT'});
 assert.equal(one.drafts()['note:note-card'].note,'Local note');assert.equal((await a.load()).annotations['note-card'].note,'Other saved note');assert.ok(one.recoverableDrafts().some(value=>value.key==='note:note-card'&&value.conflict));
});
test('an adopted source removed or consumed in another window disappears from automatic editor drafts',async()=>{
 const fixture=indexedFixture(),[a,b]=stores(fixture),original=createWorkspaceSession(a,{sessionId:'source'});await original.commit(draft('adopted source'));
 const resumed=createWorkspaceSession(b,{sessionId:'resume'});await resumed.load();assert.equal(resumed.drafts()['new:text'].body,'adopted source');await original.commit({type:'draft.set',key:'new:text',value:null});await resumed.load();assert.equal(resumed.drafts()['new:text'],undefined);
});
test('resuming the current conflict keeps its warning and clearing it cannot consume itself into a live draft again',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),session=createWorkspaceSession(store,{sessionId:'current'});await session.commit(add('card'));
 await store.update(value=>workspaceReducer(value,{type:'draft.set',key:'window-draft:current:edit%3Acard',value:{key:'edit:card',value:{body:'rejected'},base:{entity:'card:card',version:-1},updatedAt:'2025',conflict:true}}));await session.load();
 const record=session.recoverableDrafts()[0];await session.resumeDraft(record.id);assert.ok(session.recoverableDrafts().some(value=>value.id===record.id&&value.conflict));
 await session.commit({type:'draft.set',key:'edit:card',value:null});await session.load();assert.equal(session.drafts()['edit:card'],undefined);assert.equal(Object.hasOwn((await store.load()).drafts,record.id),false);
});

test('failed canvas autosave survives navigation and an unrelated write, and backup retries its memory-only draft',async()=>{
 const fixture=indexedFixture(),[base]=stores(fixture);let failures=0;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(failures){failures--;throw Error('synthetic disk failure');}return next;})};
 const session=createWorkspaceSession(store,{sessionId:'canvas-window'}),board={id:'canvas',title:'Original',nodes:[{id:'node',itemPath:'card',x:10,y:20}],edges:[]};
 await session.commit({type:'board.upsert',board});
 const changed={...board,title:'Unsaved movement',nodes:[{...board.nodes[0],x:90}]};
 failures=2;await assert.rejects(session.commit({type:'board.upsert',board:changed}),/synthetic disk failure/);
 assert.equal(session.drafts()['board:canvas'].nodes[0].x,90);
 const recovery=session.recoverableDrafts().find(value=>value.key==='board:canvas');assert.equal(recovery.memoryOnly,true);
 assert.equal((await session.readDraft(recovery.id)).value.title,'Unsaved movement');
 // Leaving the component does not own or dispose this workspace session.
 await session.commit({type:'card.favorite',id:'unrelated',value:true});
 assert.equal((await base.load()).boards[0].nodes[0].x,10);
 assert.equal(session.drafts()['board:canvas'].nodes[0].x,90);
 const backup=parseWorkspaceBackup(serializeWorkspace(await session.settled()));
 assert.equal(backup.boards[0].nodes[0].x,10);
 assert.ok(Object.values(backup.drafts).some(value=>value.key==='board:canvas'&&value.value.nodes[0].x===90));
 const reopened=createWorkspaceSession(store,{sessionId:'reopened'});await reopened.load();assert.equal(reopened.drafts()['board:canvas'].nodes[0].x,90);
 await reopened.commit({type:'board.upsert',board:reopened.drafts()['board:canvas']});
 assert.equal((await base.load()).boards[0].nodes[0].x,90);assert.equal(reopened.drafts()['board:canvas'],undefined);
 const latest=await reopened.settled();assert.ok(Object.values(latest.drafts).every(value=>value.key!=='board:canvas'||value.recoveryOnly));
});

test('canvas exit settlement rejects while both autosave and recovery storage still fail',async()=>{
 const fixture=indexedFixture(),[base]=stores(fixture);let fail=false;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(fail)throw Error('disk unavailable');return next;})};
 const session=createWorkspaceSession(store),board={id:'canvas',title:'Original',nodes:[],edges:[]};await session.commit({type:'board.upsert',board});
 fail=true;await assert.rejects(session.commit({type:'board.upsert',board:{...board,title:'Retain me'}}),/disk unavailable/);
 await assert.rejects(session.settled(),/disk unavailable/);assert.equal(session.drafts()['board:canvas'].title,'Retain me');
 await assert.rejects(session.settled(),/disk unavailable/);assert.equal(session.recoverableDrafts()[0].value.title,'Retain me');
 fail=false;await session.settled();assert.equal(session.drafts()['board:canvas'].title,'Retain me');
});

test('older canvas completion never clears newer queued input and a successful retry clears the recovery draft atomically',async()=>{
 const fixture=indexedFixture(),[base]=stores(fixture);let rejectSecond=false;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(rejectSecond&&next.boards[0]?.title==='Second'){rejectSecond=false;throw Error('second save failed');}return next;})};
 const session=createWorkspaceSession(store),board={id:'canvas',title:'Original',nodes:[],edges:[]};await session.commit({type:'board.upsert',board});
 rejectSecond=true;const first=session.commit({type:'board.upsert',board:{...board,title:'First'}}),second=session.commit({type:'board.upsert',board:{...board,title:'Second'}});
 const secondRejected=assert.rejects(second,/second save failed/);
 assert.equal(session.drafts()['board:canvas'].title,'Second');await first;assert.equal(session.drafts()['board:canvas'].title,'Second');session.beginEdit('board:canvas',{type:'board',id:'canvas'});await secondRejected;
 assert.equal((await base.load()).boards[0].title,'First');assert.equal(session.drafts()['board:canvas'].title,'Second');
 await session.commit({type:'board.upsert',board:session.drafts()['board:canvas']});
 const snapshot=await base.load();assert.equal(snapshot.boards[0].title,'Second');assert.equal(session.drafts()['board:canvas'],undefined);assert.deepEqual(snapshot.drafts,{});
});

test('a memory-only conflicted canvas retains its stale baseline when the editor is reopened',async()=>{
 const fixture=indexedFixture(),[base,other]=stores(fixture);let failRecovery=false;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(failRecovery)throw Error('recovery disk unavailable');return next;})};
 const session=createWorkspaceSession(store),foreign=createWorkspaceSession(other),board={id:'canvas',title:'Original',nodes:[],edges:[]};
 await session.commit({type:'board.upsert',board});await foreign.load();session.beginEdit('board:canvas',{type:'board',id:'canvas'});
 await foreign.commit({type:'board.upsert',board:{...board,title:'Other window'}});failRecovery=true;
 await assert.rejects(session.commit({type:'board.upsert',board:{...board,title:'Stale local input'}}),{code:'WORKSPACE_CONFLICT'});
 assert.equal(session.recoverableDrafts()[0].memoryOnly,true);session.beginEdit('board:canvas',{type:'board',id:'canvas'});failRecovery=false;
 await assert.rejects(session.commit({type:'board.upsert',board:session.drafts()['board:canvas']}),{code:'WORKSPACE_CONFLICT'});
 assert.equal((await base.load()).boards[0].title,'Other window');assert.equal(session.drafts()['board:canvas'].title,'Stale local input');
});


test('missing updater results never replace the library or advance its revision',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),session=createWorkspaceSession(store);
 await session.commit(add('keep'));const before=structuredClone(fixture.data.get('isolated'));
 for(const value of [undefined,null]){
  await assert.rejects(store.update(()=>value),/未返回资料库状态/);assert.deepEqual(fixture.data.get('isolated'),before);
  await assert.rejects(session.commit(()=>value),/未返回资料库状态/);assert.deepEqual(fixture.data.get('isolated'),before);
 }
 await session.commit(add('after'));assert.deepEqual((await store.load()).cards.map(card=>card.id),['keep','after']);assert.equal(fixture.data.get('isolated').revision,before.revision+1);
});


test('legal JSON IDs with isolated UTF16 units keep distinct recoverable window drafts',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),session=createWorkspaceSession(store,{sessionId:'unicode'});
 const ids=['plain','中文','😀','\ud800','\ud801','\udfff','\ufffd','%ud800','%uD800','%ED%A0%80'];
 for(const [index,id] of ids.entries())await session.commit({type:'draft.set',key:'note:'+id,value:{note:'Note '+index}});
 const snapshot=await store.load(),keys=Object.keys(snapshot.drafts);assert.equal(keys.length,ids.length);assert.equal(new Set(keys).size,ids.length);
 for(const id of ids.filter(id=>!/[\ud800-\udfff]/u.test(id)))assert.ok(Object.hasOwn(snapshot.drafts,'window-draft:unicode:'+encodeURIComponent('note:'+id)),'well-formed legacy storage keys must stay unchanged');
 const reopened=createWorkspaceSession(store,{sessionId:'reopened'});await reopened.load();assert.equal(reopened.recoverableDrafts().length,ids.length);
 for(const [index,id] of ids.entries())assert.equal(reopened.drafts()['note:'+id].note,'Note '+index);
 assert.deepEqual(parseWorkspaceBackup(serializeWorkspace(snapshot)),snapshot);
});

test('imported note recovery with an isolated UTF16 source ID remains visible and can be copied',async()=>{
 const fixture=indexedFixture(),[store]=stores(fixture),id='native-\ud800',note='完整的备份备注';
 const backup=workspaceReducer(createWorkspaceState(),{type:'card.note',id,note,private:true});
 await store.update(current=>mergeWorkspaceBackup(current,backup,{knownCardIds:[id]}));
 const session=createWorkspaceSession(store,{sessionId:'receiver'});await session.load();const record=session.recoverableDrafts()[0];assert.ok(record);assert.equal(record.value.note,note);assert.equal(session.drafts()['note:'+id],undefined);
 await session.copyDraft(record.id,'new:text',value=>({body:value.note,private:value.private}));
 assert.equal(session.drafts()['new:text'].body,note);assert.equal(session.drafts()['new:text'].private,true);assert.ok((await store.load()).drafts[record.id]);
});
