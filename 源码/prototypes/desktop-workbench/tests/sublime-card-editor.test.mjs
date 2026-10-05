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


const editorValue=(session,id='card')=>{const state=session.state,card=state.cards.find(card=>card.id===id);return {...card,caption:state.annotations[id]?.note??card.caption,favorite:state.favoriteIds.includes(id),private:state.annotations[id]?.private||false,collectionIds:state.collections.filter(c=>c.cardIds.includes(id)).map(c=>c.id)};};
const saveActions=(session,value,{clear=true}={})=>[{type:'card.upsert',card:value},{type:'card.save',id:value.id,saved:true},{type:'card.hide',id:value.id,hidden:false},{type:'card.favorite',id:value.id,value:!!value.favorite},{type:'card.note',id:value.id,note:value.caption||'',private:!!value.private},...(clear?[{type:'draft.set',key:`edit:${value.id}`,value:null}]:[]),...session.state.collections.map(c=>({type:'collection.toggleCard',id:c.id,cardId:value.id,selected:value.collectionIds?.includes(c.id)||false}))];
const save=(session,value,options)=>session.commit(saveActions(session,value,options),{editKey:`edit:${value.id}`});
async function setup(){const fixture=indexedFixture(),[store,otherStore]=stores(fixture),one=createWorkspaceSession(store,{sessionId:'one'}),two=createWorkspaceSession(otherStore,{sessionId:'two'});await one.commit([...add('card'),{type:'collection.upsert',collection:{id:'group',title:'Group',cardIds:[]}}]);await two.load();return {fixture,store,otherStore,one,two};}

for(const [name,change] of [
 ['note',{type:'card.note',id:'card',note:'New remote note'}],['private',{type:'card.note',id:'card',private:true}],['favorite',{type:'card.favorite',id:'card',value:true}],['saved',{type:'card.save',id:'card',saved:false}],['hidden',{type:'card.hide',id:'card',hidden:true}],['membership without annotation',{type:'collection.toggleCard',id:'group',cardId:'card',selected:true}],['raw body',{type:'card.upsert',card:{id:'card',body:'Remote body'}}],
])test(`resumed full editor rejects a newer ${name} and retains both inputs`,async()=>{
 const {store,one,two}=await setup();one.beginEdit('edit:card',{type:'card',id:'card'});const local={...editorValue(one),body:'Unfinished edit'};await one.commit({type:'draft.set',key:'edit:card',value:local});await two.commit(change);const before=await store.load();
 const resumed=createWorkspaceSession(store,{sessionId:'resumed'});await resumed.load();resumed.beginEdit('edit:card',{type:'card',id:'card'});
 await assert.rejects(save(resumed,resumed.drafts()['edit:card']),{code:'WORKSPACE_CONFLICT'});const after=await store.load();assert.deepEqual({...after,drafts:{}},{...before,drafts:{}});assert.equal(resumed.drafts()['edit:card'].body,'Unfinished edit');
 const fresh=createWorkspaceSession(store);await fresh.load();assert.ok(fresh.recoverableDrafts().some(record=>record.key==='edit:card'&&record.value.body==='Unfinished edit'));
});

test('aggregate domain leaves raw revisions and other cards independent',async()=>{
 const {store,one,two}=await setup();const first=await store.loadSnapshot();one.beginEdit('edit:card');const value=editorValue(one);await two.commit([...add('other'),{type:'card.note',id:'other',note:'Other card'}]);await one.load();await save(one,{...value,body:'Allowed'});
 const second=await store.loadSnapshot();await one.commit({type:'card.favorite',id:'card',value:true});const third=await store.loadSnapshot();assert.equal(third.entityVersions['card:card'],second.entityVersions['card:card']);assert.ok(third.entityVersions['card-editor:card']>second.entityVersions['card-editor:card']);assert.ok(second.entityVersions['card:card']>first.entityVersions['card:card']);
 await one.commit({type:'card.upsert',card:{id:'card',body:'Narrow after favorite'}});one.beginEdit('edit:card');await save(one,{...editorValue(one),body:'Fresh editor'});assert.equal((await store.load()).cards.find(c=>c.id==='card').body,'Fresh editor');
});

test('ordinary same-window changes cannot bless an existing full editor draft',async()=>{
 const {store,one}=await setup();one.beginEdit('edit:card');const value=editorValue(one);await one.commit({type:'draft.set',key:'edit:card',value});await one.commit({type:'card.favorite',id:'card',value:true});await one.commit({type:'card.upsert',card:{id:'card',title:'Narrow title update'}});
 await assert.rejects(save(one,value),{code:'WORKSPACE_CONFLICT'});assert.equal((await store.load()).favoriteIds.includes('card'),true);
});

test('full editor does not use an independent stale note modal baseline',async()=>{
 const {store,one,two}=await setup();one.beginEdit('note:card');await one.commit({type:'draft.set',key:'note:card',value:{note:'Unfinished separate note'}});await two.commit({type:'card.note',id:'card',note:'Current note'});await one.load();one.beginEdit('edit:card');await save(one,{...editorValue(one),body:'Valid full edit'});
 assert.equal((await store.load()).annotations.card.note,'Current note');assert.equal(one.drafts()['note:card'].note,'Unfinished separate note');await assert.rejects(one.commit({type:'card.note',id:'card',note:'Unfinished separate note'}),{code:'WORKSPACE_CONFLICT'});
});

test('clear failures keep the frozen base after refresh and reopening',async()=>{
 const {fixture,store:base,otherStore,two}=await setup();let fail=false;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(fail)throw Error('synthetic disk failure');return next;})};const one=createWorkspaceSession(store);await one.load();one.beginEdit('edit:card');const value={...editorValue(one),body:'Memory input'};fail=true;await assert.rejects(one.commit({type:'draft.set',key:'edit:card',value}),/synthetic/);fail=false;
 await two.commit({type:'card.note',id:'card',note:'Remote newer note'});await one.load();await assert.rejects(save(one,value),{code:'WORKSPACE_CONFLICT'});one.endEdit('edit:card');one.beginEdit('edit:card');await assert.rejects(save(one,one.drafts()['edit:card']),{code:'WORKSPACE_CONFLICT'});assert.equal((await base.load()).annotations.card.note,'Remote newer note');
});

test('queued successful clear never clears later typing and rebases only its own descendants',async()=>{
 const {store,one}=await setup();one.beginEdit('edit:card');const first={...editorValue(one),body:'First'},later={...first,body:'Later'};await one.commit({type:'draft.set',key:'edit:card',value:first});
 const saved=save(one,first),typed=one.commit({type:'draft.set',key:'edit:card',value:later});await saved;assert.equal(one.drafts()['edit:card'].body,'Later');await typed;
 const resumed=createWorkspaceSession(store);await resumed.load();resumed.beginEdit('edit:card');await save(resumed,resumed.drafts()['edit:card']);assert.equal((await store.load()).cards[0].body,'Later');assert.equal(resumed.drafts()['edit:card'],undefined);
});

test('queued full editor submissions and repeated no-clear submissions advance their own baseline',async()=>{
 const {store,one}=await setup();one.beginEdit('edit:card');const first={...editorValue(one),body:'First'},second={...first,body:'Second'};await Promise.all([save(one,first),save(one,second)]);one.beginEdit('edit:card');await save(one,{...editorValue(one),body:'Third'},{clear:false});await save(one,{...editorValue(one),body:'Fourth'},{clear:false});assert.equal((await store.load()).cards[0].body,'Fourth');
});

for(const form of ['scoped-old','scoped-missing','unscoped'])test(`legacy ${form} remains visible, cannot overwrite, and can really save a new copy`,async()=>{
 const {fixture,store}=await setup();const raw=fixture.data.get('isolated');delete raw.entityVersions['card-editor:card'];const value={body:'Historical body',caption:'Historical note',favorite:false};const key=form==='unscoped'?'edit:card':'window-draft:legacy:edit%3Acard';raw.state=workspaceReducer(raw.state,{type:'draft.set',key,value:form==='unscoped'?value:{key:'edit:card',value,...(form==='scoped-old'?{base:{entity:'card:card',version:raw.entityVersions['card:card']}}:{})}});fixture.data.set('isolated',raw);
 const one=createWorkspaceSession(store,{sessionId:'upgrade'});await one.load();const record=one.recoverableDrafts().find(record=>record.id===key);assert.ok(record);assert.equal(record.copyOnly,true);assert.equal((await one.readDraft(key)).value.body,value.body);
 await one.resumeDraft(key);one.beginEdit('edit:card');await assert.rejects(save(one,{...editorValue(one),...value}),{code:'WORKSPACE_CONFLICT'});assert.equal((await store.load()).cards[0].body,'card');
 await one.copyDraft(key,'new:text');await one.commit([{type:'card.upsert',card:{...one.drafts()['new:text'],id:'new-copy'}},{type:'draft.set',key:'new:text',value:null}]);assert.equal((await store.load()).cards.find(card=>card.id==='new-copy').body,value.body);assert.ok((await store.load()).drafts[key]);
});

test('imported aggregate draft revisions cannot authorize overwriting a different local library',async()=>{
 const {store,one}=await setup();one.beginEdit('edit:card');await one.commit({type:'draft.set',key:'edit:card',value:{...editorValue(one),body:'Backup draft'}});const backup=parseWorkspaceBackup(serializeWorkspace(await one.settled()));
 const target=indexedFixture(),[targetStore]=stores(target),session=createWorkspaceSession(targetStore);await session.commit(add('card'));await session.commit(state=>mergeWorkspaceBackup(state,backup));const record=session.recoverableDrafts().find(record=>record.key==='edit:card');assert.equal(record.base,null);await session.resumeDraft(record.id);await assert.rejects(save(session,{...editorValue(session),...record.value}),{code:'WORKSPACE_CONFLICT'});
});

// Invoke the real workspace's layout and save handlers with real session/store
// persistence. Only React's host/hook plumbing is synthetic; no app is launched.
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as model from '../src/sublime/workspaceModel.js';
import * as view from '../src/sublime/workspaceView.js';
import * as discovery from '../src/discoveryModel.js';
import * as desktop from '../src/desktopModel.js';
import * as intelligence from '../src/sublime/intelligenceHelpers.js';
import * as intelligenceDrafts from '../src/sublime/intelligenceDrafts.js';
import * as podcastTranscription from '../src/sublime/podcastTranscription.js';
const compiled=(await transform(await readFile(new URL('../src/sublime/SublimeWorkspace.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
function findNode(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const node of tree){const match=findNode(node,predicate);if(match)return match;}return null;}return predicate(tree)?tree:findNode(tree.props?.children,predicate);}
function workspaceUI(session,{hash='#/add/edit:card',items=[]}={}){
 const identity={id:'synthetic-editor'},states=[],refs=[],memos=[],layouts=[],begins=[],ends=[],submissions=[];let stateIndex=0,refIndex=0,memoIndex=0,layoutIndex=0,tree,scheduled=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={Fragment:Symbol(),createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:()=>{},useMemo:(factory,deps)=>{const index=memoIndex++;if(!memos[index]||!same(deps,memos[index].deps))memos[index]={deps,value:factory()};return memos[index].value;},useRef:initial=>{const index=refIndex++;return refs[index]??(refs[index]={current:index===4?identity.id:initial});},useState:initial=>{const index=stateIndex++;if(!states[index])states[index]={value:index===0?{...session.state,drafts:session.drafts()}:index===1?true:typeof initial==='function'?initial():initial};return [states[index].value,next=>{states[index].value=typeof next==='function'?next(states[index].value):next;}];},useLayoutEffect:(effect,deps)=>{const index=layoutIndex++;if(!layouts[index]||!same(deps,layouts[index].deps))scheduled.push(()=>{layouts[index]?.cleanup?.();layouts[index]={deps,cleanup:effect()};});}};
 const CardEditor=()=>null,empty=()=>null,icons=new Proxy({},{get:()=>empty});
 const observedSession={...session,get state(){return session.state;},get writing(){return session.writing;},beginEdit:(...args)=>{begins.push(args[0]);return session.beginEdit(...args);},endEdit:(...args)=>{ends.push(args[0]);return session.endEdit(...args);},commit:(actions,options)=>{submissions.push({actions,options});return session.commit(actions,options);}};
 let navigation;const location={hash,href:'https://example.test/'},history={state:{},replaceState(){},pushState(){}};
 const require=specifier=>{
  if(specifier==='react')return react;if(specifier==='@tabler/icons-react')return icons;
  if(specifier==='./workspaceModel.js')return model;if(specifier==='./workspaceView.js')return view;if(specifier==='../discoveryModel.js')return discovery;if(specifier==='../desktopModel.js')return desktop;
  if(specifier==='./workspaceStore.js')return {createWorkspaceStore:()=>({})};if(specifier==='./workspacePersistence.js')return {createWorkspaceSession:()=>observedSession};
  if(specifier==='./workspaceNavigation.js')return {createWorkspaceNavigation:options=>(navigation={restoreCurrent(){},record(){},open:(route)=>options.restore({route,filters:{query:'',media:'All',sort:'newest',inLibrary:false,favorite:false}})})};
  if(specifier==='./SublimeEditors.jsx')return {CardEditor,CollectionEditor:empty,CanvasEditor:empty,ImportEditor:empty,SafeRichBody:empty};
  if(specifier==='./referenceCards.js')return {listeningCard:{id:'unused-reference'}};if(specifier==='./intelligenceHelpers.js')return intelligence;if(specifier==='./intelligenceDrafts.js')return intelligenceDrafts;if(specifier==='./podcastTranscription.js')return podcastTranscription;
  if(specifier==='./workspaceDownload.js')return {requestWorkspaceDownload:()=>{throw Error('Unexpected download');}};
  if(specifier==='./rendererQuit.js')return {}; // No native quit callback in this fixture.
  if(['./AttachmentPreview.jsx','./VaultAttachmentPreview.jsx','./IntelligencePanel.jsx','./SourceFeeds.jsx','./PodcastClips.jsx','./externalContext.js','./publishableCollection.js'].includes(specifier))return {default:empty,PodcastClipPlayback:empty};
  if(specifier.endsWith('.css'))return {};throw Error('Unexpected module '+specifier);
 };
 const module={exports:{}};vm.compileFunction(compiled,['module','exports','require','window','history','location','setTimeout','clearTimeout'])(module,module.exports,require,{history,location,matchMedia:()=>({matches:false})},history,location,()=>0,()=>{});
 function render(){stateIndex=refIndex=memoIndex=layoutIndex=0;scheduled=[];tree=module.exports.default({identity,items});for(const run of scheduled)run();return tree;}
 function refresh(){states[0].value={...session.state,drafts:session.drafts()};refs[2].current=session.state;return render();}
 render();return {render,refresh,begins,ends,submissions,find:predicate=>findNode(tree,predicate),editor:()=>findNode(tree,node=>node.type===CardEditor)?.props,navigate:(page,id='')=>{navigation.open({page,id,sourcePage:1});render();}};
}

test('real deep-link layout freezes a baseline before typing and refresh cannot bless stale visible input',async()=>{
 const {store,one,two}=await setup();const ui=workspaceUI(one),visible={...ui.editor().card,body:'Old visible text'};assert.deepEqual(ui.begins,['edit:card']);
 await two.commit({type:'card.note',id:'card',note:'Other window'});await one.load();ui.refresh();assert.deepEqual(ui.begins,['edit:card']);
 await assert.rejects(ui.editor().onSave(visible),{code:'WORKSPACE_CONFLICT'});assert.equal(ui.submissions.at(-1).options.editKey,'edit:card');assert.equal((await store.load()).annotations.card.note,'Other window');assert.equal(one.drafts()['edit:card'].body,'Old visible text');
});

test('real history entry and exit initialize and release the editor baseline, allowing a fresh save',async()=>{
 const {store,one,two}=await setup();const ui=workspaceUI(one,{hash:'#/library'});assert.deepEqual(ui.begins,[]);ui.navigate('add','edit:card');assert.deepEqual(ui.begins,['edit:card']);ui.navigate('library');assert.deepEqual(ui.ends,['edit:card']);
 await two.commit({type:'card.note',id:'card',note:'Current after leaving'});await one.load();ui.refresh();ui.navigate('add','edit:card');assert.deepEqual(ui.begins,['edit:card','edit:card']);await ui.editor().onSave({...ui.editor().card,body:'Valid reopened editor'});assert.equal((await store.load()).cards[0].body,'Valid reopened editor');assert.equal((await store.load()).annotations.card.note,'Current after leaving');
});

test('real restored editor save writes full metadata and keeps the newer remote favorite',async()=>{
 const {store,one,two}=await setup();const ui=workspaceUI(one);ui.editor().onDraftChange({...ui.editor().card,body:'Draft body'});await one.load();await two.commit({type:'card.favorite',id:'card',value:true});const reopened=createWorkspaceSession(store);await reopened.load();const restored=workspaceUI(reopened);await assert.rejects(restored.editor().onSave(restored.editor().draft),{code:'WORKSPACE_CONFLICT'});assert.equal((await store.load()).favoriteIds.includes('card'),true);
});

test('real new card and Vault copy saves never target the original editor domain',async()=>{
 const {store,one}=await setup();const newUI=workspaceUI(one,{hash:'#/add/text'});await newUI.editor().onSave({body:'New card',caption:'New note',collectionIds:[]});assert.equal(newUI.submissions.at(-1).options,undefined);
 const items=[{path:'native-note',kind:'inspiration',title:'Vault title',body:'Vault body'}],vaultUI=workspaceUI(one,{hash:'#/add/edit:native-note',items});await vaultUI.editor().onSave({...vaultUI.editor().card,body:'Local copy'});assert.equal(vaultUI.submissions.at(-1).options,undefined);const cards=(await store.load()).cards;assert.ok(cards.some(card=>card.body==='Local copy'&&card.id!=='native-note'));assert.equal(cards.some(card=>card.id==='native-note'),false);
});

test('a save with no prior typing survives primary and recovery disk failures and can be copied from memory',async()=>{
 const {store:base}=await setup();let fail=true;
 const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(fail)throw Error('synthetic unavailable disk');return next;})};const session=createWorkspaceSession(store);await session.load();session.beginEdit('edit:card');const value={...editorValue(session),body:'Visible input',caption:'Visible note',favorite:true};
 await assert.rejects(save(session,value),/synthetic unavailable disk/);const record=session.recoverableDrafts().find(record=>record.key==='edit:card');assert.equal(record.memoryOnly,true);assert.equal(record.value.caption,'Visible note');fail=false;await session.copyDraft(record.id,'new:text');assert.equal(session.drafts()['new:text'].body,'Visible input');assert.equal(session.drafts()['edit:card'].body,'Visible input');
});

test('three queued canvas autosaves retain their existing baseline behavior',async()=>{
 const {store,one}=await setup();await one.commit({type:'board.upsert',board:{id:'board',title:'Original',nodes:[],edges:[]}});await Promise.all(['One','Two','Three'].map(title=>one.commit({type:'board.upsert',board:{id:'board',title,nodes:[],edges:[]}})));assert.equal((await store.load()).boards[0].title,'Three');
});

for(const first of ['success','failure'])for(const second of ['success','failure'])test(`queued card ${first}/${second} preserves newest input through save/recovery`,async()=>{
 const {store:base}=await setup();let failures=[];const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(failures.shift())throw Error('synthetic queued disk failure');return next;})};const session=createWorkspaceSession(store);await session.load();session.beginEdit('edit:card');const older={...editorValue(session),body:'Older'},newer={...older,body:'Newest'};await session.commit({type:'draft.set',key:'edit:card',value:older});
 failures=[...(first==='failure'?[true,false]:[false]),...(second==='failure'?[true,false]:[false])];const oldSave=save(session,older);const newSave=save(session,newer);const results=await Promise.allSettled([oldSave,newSave]);assert.equal(results[0].status,first==='success'?'fulfilled':'rejected');assert.equal(results[1].status,second==='success'?'fulfilled':'rejected');
 if(second==='success')assert.equal((await base.load()).cards[0].body,'Newest');else assert.equal(session.drafts()['edit:card'].body,'Newest');
});

test('an ordinary raw upsert keeps its submitted snapshot even if a refresh arrives while queued',async()=>{
 const {store:base,two}=await setup();let pause=false,release,started;const began=new Promise(resolve=>started=resolve);const store={...base,update:async updater=>{if(pause){pause=false;started();await new Promise(resolve=>release=resolve);}return base.update(updater);}};const one=createWorkspaceSession(store);await one.load();let refreshed=false;const off=one.subscribe((state,meta)=>{if(meta.external&&state.cards[0]?.body==='Remote raw')refreshed=true;});pause=true;const saving=one.commit({type:'card.upsert',card:{id:'card',body:'Stale submitted'}}),rejected=assert.rejects(saving,{code:'WORKSPACE_CONFLICT'});await began;await two.commit({type:'card.upsert',card:{id:'card',body:'Remote raw'}});for(let i=0;i<10&&!refreshed;i++)await tick();assert.equal(refreshed,true);release();await rejected;off();assert.equal((await base.load()).cards[0].body,'Remote raw');
});

test('a completed old note modal never blocks ordinary note actions after a full editor save',async()=>{
 const {store,one}=await setup();one.beginEdit('note:card');await one.commit([{type:'card.note',id:'card',note:'Earlier modal note'},{type:'draft.set',key:'note:card',value:null}]);one.beginEdit('edit:card');await save(one,{...editorValue(one),caption:'Full editor note'});await one.commit({type:'card.note',id:'card',private:true});assert.equal((await store.load()).annotations.card.private,true);
});

test('explicit clearing of a resumed unscoped legacy draft cannot recreate a ghost wrapper',async()=>{
 const initial={...createWorkspaceState(),drafts:{'edit:card':{body:'Legacy input'}}},fixture=indexedFixture(new Map([['isolated',initial]])),[store]=stores(fixture),session=createWorkspaceSession(store,{sessionId:'current'});
 await session.load();await session.resumeDraft('edit:card');await session.commit({type:'draft.set',key:'edit:card',value:null});assert.deepEqual((await store.load()).drafts,{});
});
test('recovery records use their actual storage key rather than an ID claimed inside the payload',async()=>{
 const key='window-draft:old:edit%3Acard',initial={...createWorkspaceState(),drafts:{[key]:{id:'window-draft:impostor',key:'edit:card',value:{body:'Retain me'},base:null}}},fixture=indexedFixture(new Map([['isolated',initial]])),[store]=stores(fixture),session=createWorkspaceSession(store);
 await session.load();assert.equal(session.recoverableDrafts()[0].id,key);assert.equal((await session.readDraft(key)).value.body,'Retain me');
});

for(const foreignChange of [false,true])test(`a resumed draft keeps its source through recovery writes (${foreignChange?'newer source retained':'same source retired'})`,async()=>{
 const {store:base,one:original}=await setup();original.beginEdit('edit:card');await original.commit({type:'draft.set',key:'edit:card',value:{...editorValue(original),body:'Old source'}});
 let fail=false;const store={...base,update:updater=>base.update((state,meta)=>{const next=updater(state,meta);if(fail){fail=false;throw Error('synthetic one-off disk failure');}return next;})};
 const resumed=createWorkspaceSession(store,{sessionId:'resumed-lineage'});await resumed.load();const source=resumed.recoverableDrafts().find(record=>record.key==='edit:card');await resumed.resumeDraft(source.id);resumed.beginEdit('edit:card');const value={...resumed.drafts()['edit:card'],body:'New final content'};await resumed.commit({type:'draft.set',key:'edit:card',value});
 const ownKey='window-draft:resumed-lineage:edit%3Acard',lineage=structuredClone((await base.load()).drafts[ownKey].adoptedFrom);
 fail=true;await assert.rejects(save(resumed,value),/synthetic one-off/);assert.deepEqual((await base.load()).drafts[ownKey].adoptedFrom,lineage);
 if(foreignChange)await original.commit({type:'draft.set',key:'edit:card',value:{...editorValue(original),body:'Newer source input'}});
 await save(resumed,value);const reopened=createWorkspaceSession(base);await reopened.load();assert.equal(reopened.state.cards[0].body,'New final content');
 assert.equal(!!reopened.state.drafts[source.id].recoveryOnly,!foreignChange);
 if(foreignChange)assert.equal(reopened.drafts()['edit:card'].body,'Newer source input');else assert.equal(reopened.drafts()['edit:card'],undefined);
});

test('ordinary queued writes advance only their own raw card descendants',async()=>{
 const {store,one}=await setup();await Promise.all([
  one.commit({type:'card.upsert',card:{id:'card',title:'First title'}}),
  one.commit({type:'card.upsert',card:{id:'card',body:'Second body'}}),
  one.commit({type:'card.upsert',card:{id:'card',title:'Third title'}}),
 ]);const card=(await store.load()).cards[0];assert.equal(card.title,'Third title');assert.equal(card.body,'Second body');assert.equal(one.drafts()['edit:card'],undefined);
});

test('queued raw writes never rebase across a foreign update',async()=>{
 const {store:base,otherStore}=await setup();let afterFirst=false;
 const store={...base,update:async updater=>{const result=await base.update(updater);if(afterFirst){afterFirst=false;await otherStore.update(state=>workspaceReducer(state,{type:'card.upsert',card:{id:'card',body:'Foreign content'}}));}return result;}};
 const one=createWorkspaceSession(store);await one.load();afterFirst=true;
 const results=await Promise.allSettled([one.commit({type:'card.upsert',card:{id:'card',title:'First own title'}}),one.commit({type:'card.upsert',card:{id:'card',body:'Queued own content'}})]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.code,'WORKSPACE_CONFLICT');assert.equal((await base.load()).cards[0].body,'Foreign content');assert.equal(one.drafts()['edit:card'].body,'Queued own content');
});


test('queued raw descendants also follow own functional transactions without blessing full editors',async()=>{
 const {store,one}=await setup();one.beginEdit('edit:card');const stale=editorValue(one);await Promise.all([
  one.commit(current=>workspaceReducer(current,{type:'card.upsert',card:{id:'card',title:'Own functional update'}})),
  one.commit({type:'card.upsert',card:{id:'card',body:'Own queued body'}}),
 ]);const card=(await store.load()).cards[0];assert.equal(card.title,'Own functional update');assert.equal(card.body,'Own queued body');await assert.rejects(save(one,stale),{code:'WORKSPACE_CONFLICT'});
});


test('valid backups whose combined card count exceeds the limit keep the import dialog usable',async()=>{
 const {store,one}=await setup();const before=await one.commit(current=>model.normalizeWorkspaceState({...current,cards:Array.from({length:10000},(_,index)=>({id:`existing-${index}`}))}));
 const ui=workspaceUI(one,{hash:'#/collections'}),backup=JSON.stringify({...createWorkspaceState(),cards:Array.from({length:10001},(_,index)=>({id:`incoming-${index}`}))});
 const input=ui.find(node=>node.type==='input'&&node.props.type==='file'&&node.props.accept==='.json,application/json');assert.ok(input);
 await input.props.onChange({target:{files:[{size:Buffer.byteLength(backup),text:async()=>backup}],value:'synthetic.json'}});
 assert.doesNotThrow(()=>ui.render());const alert=ui.find(node=>node.props?.role==='alert');assert.ok(alert);assert.match(JSON.stringify(alert.props.children),/20000/);
 const modal=ui.find(node=>node.props?.title==='导入备份');assert.ok(modal);assert.equal(ui.find(node=>node.type==='button'&&node.props.children?.includes('合并备份')),null);
 modal.props.onClose();assert.doesNotThrow(()=>ui.render());assert.equal(ui.find(node=>node.props?.title==='导入备份'),null);assert.deepEqual(await store.load(),before);
});
