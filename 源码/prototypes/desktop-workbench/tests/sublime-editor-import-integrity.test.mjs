import {currentWorkspaceModule} from './fixtures/workspace-dependencies.mjs';
import * as starHomeView from '../src/sublime/starHomeView.js';
import * as recallLibrary from '../src/sublime/recallLibrary.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {workspaceReducer} from '../src/sublime/workspaceModel.js';
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
async function setup(){const fixture=indexedFixture(),[store,otherStore]=stores(fixture),one=createWorkspaceSession(store,{sessionId:'one'}),two=createWorkspaceSession(otherStore,{sessionId:'two'});await one.commit([...add('card'),{type:'collection.upsert',collection:{id:'group',title:'Group',cardIds:[]}}]);await two.load();return {fixture,store,otherStore,one,two};}

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
import * as navigationModel from '../src/sublime/workspaceNavigation.js';
import * as readerModel from '../src/reader/readerState.js';
import {epubFixture} from './reader-epub-fixture.mjs';
const compiled=(await transform(await readFile(new URL('../src/sublime/SublimeWorkspace.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
function findNode(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const node of tree){const match=findNode(node,predicate);if(match)return match;}return null;}return predicate(tree)?tree:findNode(tree.props?.children,predicate);}
function workspaceUI(session,{hash='#/add/edit:card',items=[],realNavigation=false,captureSource=intelligenceDrafts.captureAiSource,api={}}={}){
 const identity={id:'synthetic-editor'},states=[],refs=[],memos=[],layouts=[],begins=[],ends=[],submissions=[];let stateIndex=0,refIndex=0,memoIndex=0,layoutIndex=0,tree,scheduled=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={Fragment:Symbol(),createElement:(type,props,...children)=>({type,props:{...props,...(props?.onClick?{onClick:(event={currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:40,right:100,bottom:40}),focus(){}},preventDefault(){},stopPropagation(){}})=>props.onClick(event)}:{}),children}}),useEffect:()=>{},useMemo:(factory,deps)=>{const index=memoIndex++;if(!memos[index]||!same(deps,memos[index].deps))memos[index]={deps,value:factory()};return memos[index].value;},useRef:initial=>{const index=refIndex++;return refs[index]??(refs[index]={current:index===4?identity.id:initial});},useState:initial=>{const index=stateIndex++;if(!states[index])states[index]={value:index===0?{...session.state,drafts:session.drafts()}:index===1?true:typeof initial==='function'?initial():initial};return [states[index].value,next=>{states[index].value=typeof next==='function'?next(states[index].value):next;}];},useLayoutEffect:(effect,deps)=>{const index=layoutIndex++;if(!layouts[index]||!same(deps,layouts[index].deps))scheduled.push(()=>{layouts[index]?.cleanup?.();layouts[index]={deps,cleanup:effect()};});}};
 const CardEditor=()=>null,ImportEditor=()=>null,CollectionEditor=()=>null,empty=()=>null,icons=new Proxy({},{get:()=>empty});
 const observedSession={...session,get state(){return session.state;},get writing(){return session.writing;},beginEdit:(...args)=>{begins.push(args[0]);return session.beginEdit(...args);},endEdit:(...args)=>{ends.push(args[0]);return session.endEdit(...args);},commit:(actions,options)=>{submissions.push({actions,options});return session.commit(actions,options);}};
 let navigation;const location={hash,href:'https://example.test/'},entries=[{state:{},hash}],history={
 get state(){return entries[this.index].state;},index:0,
 replaceState(value,title,nextHash){entries[this.index].state=structuredClone(value);if(nextHash){entries[this.index].hash=nextHash;location.hash=nextHash;}},
 pushState(value,title,nextHash){entries.splice(this.index+1);entries.push({state:structuredClone(value),hash:nextHash});this.index++;location.hash=nextHash;},
 back(){if(this.index>0){this.index--;location.hash=entries[this.index].hash;navigation.restoreCurrent();}}
 };

 const require=specifier=>{
  if(specifier==='react')return react;if(specifier==='@tabler/icons-react')return icons;
  if(specifier==='./workspaceModel.js')return model;if(specifier==='./workspaceView.js')return view;if(specifier==='../discoveryModel.js')return discovery;if(specifier==='../desktopModel.js')return desktop;
  if(specifier==='./workspaceStoreV3.js')return {createWorkspaceStoreV3:()=>({})};if(specifier==='./recallLibrary.js')return recallLibrary;if(specifier==='./StarHome.jsx')return {default:empty};if(specifier==='./starHomeView.js')return starHomeView;if(specifier==='./workspacePersistence.js')return {createWorkspaceSession:()=>observedSession};
  if(specifier==='./workspaceNavigation.js')return {createWorkspaceNavigation:options=>(navigation=realNavigation?navigationModel.createWorkspaceNavigation(options):{restoreCurrent(){},record(){},open:(route)=>options.restore({route,filters:{query:'',media:'All',sort:'newest',inLibrary:false,favorite:false}})})};
  if(specifier==='./SublimeEditors.jsx')return {CardEditor,CollectionEditor,CanvasEditor:empty,ImportEditor,SafeRichBody:empty};
  if(specifier==='./referenceCards.js')return {listeningCard:{id:'unused-reference'}};if(specifier==='./intelligenceHelpers.js')return intelligence;if(specifier==='./intelligenceDrafts.js')return {...intelligenceDrafts,captureAiSource:captureSource};if(specifier==='./podcastTranscription.js')return podcastTranscription;
  if(specifier==='../reader/readerState.js')return readerModel;
  if(specifier==='../reader/BookReader.jsx')return {default:empty};
  if(specifier==='./workspaceDownload.js')return {requestWorkspaceDownload:()=>{throw Error('Unexpected download');}};
  if(specifier==='./BookCoverEditor.jsx')return {default:empty};if(specifier==='./bookCover.js')return {applyBookCover:(current,expected,image)=>({...current,image})};
  if(specifier==='./rendererQuit.js')return {}; // No native quit callback in this fixture.
  if(['./AttachmentPreview.jsx','./VaultAttachmentPreview.jsx','./IntelligencePanel.jsx','./SourceFeeds.jsx','./PodcastClips.jsx','./externalContext.js','./publishableCollection.js'].includes(specifier))return {default:empty,PodcastClipPlayback:empty};
  if(specifier.endsWith('.css'))return {};return currentWorkspaceModule(specifier);
 };
 const module={exports:{}};vm.compileFunction('const innerWidth=1440,innerHeight=900;'+compiled,['module','exports','require','window','history','location','setTimeout','clearTimeout'])(module,module.exports,require,{history,location,matchMedia:()=>({matches:false})},history,location,()=>0,()=>{});
 function render(patch={}){if(Object.hasOwn(patch,'items'))items=patch.items;stateIndex=refIndex=memoIndex=layoutIndex=0;scheduled=[];tree=module.exports.default({identity,items,api});for(const run of scheduled)run();return tree;}
 function refresh(){states[0].value={...session.state,drafts:session.drafts()};refs[2].current=session.state;return render();}
 render();return {render,refresh,history,location,recordHistory:()=>navigation.record(),begins,ends,submissions,find:predicate=>findNode(tree,predicate),editor:()=>findNode(tree,node=>node.type===CardEditor)?.props,importer:()=>findNode(tree,node=>node.type===ImportEditor)?.props,collector:()=>findNode(tree,node=>node.type===CollectionEditor)?.props,navigate:(page,id='')=>{navigation.open({page,id,sourcePage:1});render();}};
}

import * as attachments from '../src/sublime/attachmentPreview.js';
const source=await readFile(new URL('../src/sublime/SublimeEditors.jsx',import.meta.url),'utf8');
const editorCompiled=(await transform(source,{loader:'jsx',format:'cjs',jsx:'transform'})).code;

// Exercise the real editor event handlers with persistent hook slots. No browser,
// IndexedDB, network or Vault adapter is used by this regression harness.
function editor(name,props,services={}){
  const slots=[],effects=[];let cursor=0,effectCursor=0,tree,scheduled=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={Fragment:Symbol('fragment'),memo:value=>value,createElement:(type,props,...children)=>({type,props:{...props,...(props?.onClick?{onClick:(event={currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:40,right:100,bottom:40}),focus(){}},preventDefault(){},stopPropagation(){}})=>props.onClick(event)}:{}),children}}),isValidElement:value=>Boolean(value&&value.props),useEffect:(effect,deps)=>{const index=effectCursor++;if(!effects[index]||!same(deps,effects[index].deps))scheduled.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:effect()};});},useMemo:factory=>factory(),useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
  const icons=new Proxy({},{get:(_,name)=>function Icon(){return react.createElement('svg',{'data-icon':String(name)});}});
  const module={exports:{}};
  const context={module,exports:module.exports,FileReader:services.FileReader,Blob,URL,Error,crypto:globalThis.crypto,console,setTimeout,clearTimeout,require:path=>path==='react'?react:path==='@tabler/icons-react'?icons:path==='../discoveryModel.js'?discovery:path==='./workspaceModel.js'?model:path==='./attachmentPreview.js'?attachments:path==='./webCapture.js'?{captureWebPage:services.captureWebPage||(()=>{throw Error('Unexpected web request');})}:path==='./bookCover.js'?{defaultBookCover:async()=>''}:path==='./BookCoverEditor.jsx'?{default:()=>null}:path==='./BookCoverEditor.jsx'?{default:()=>null}:path==='./bookCover.js'?{defaultBookCover:async()=>''}:path==='./AttachmentPreview.jsx'?{default:()=>null}:path.endsWith('.css')?{}:currentWorkspaceModule(path)};
  vm.compileFunction(editorCompiled,Object.keys(context))(...Object.values(context));
  function render(){cursor=effectCursor=0;scheduled=[];tree=module.exports[name](props);for(const run of scheduled)run();return tree;}
  render();
  return {render,unmount:()=>effects.forEach(effect=>effect?.cleanup?.()),find:predicate=>find(tree,predicate)};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}if(predicate(tree))return tree;return find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree.props?.children);}
const control=(render,label)=>render.find(node=>node.props?.['aria-label']===label);
const button=(render,label)=>render.find(node=>node.type==='button'&&text(node)===label);


test('pending card import preserves a newer import draft from another window',async()=>{
 const {store:base,one:unused,two}=await setup();let pause=false,release,started;
 const began=new Promise(resolve=>started=resolve);
 const one=createWorkspaceSession({...base,update:async updater=>{if(pause){pause=false;started();await new Promise(resolve=>release=resolve);}return base.update(updater);}}, {sessionId:'importing'});
 await one.load();
 const original={text:'Original import text',format:'json',filename:'first.json',selected:['one'],previewed:true};
 await one.commit({type:'draft.set',key:'importLibrary',value:original});
 const ui=workspaceUI(one,{hash:'#/import'});pause=true;
 const save=ui.importer().onImport([{title:'First item',body:'Original imported body'}],{draftSnapshot:original});await began;
 const newer={text:'UNIMPORTED NEW DRAFT IN OTHER WINDOW',format:'markdown',filename:'',selected:[],previewed:false};
 await two.commit({type:'draft.set',key:'importLibrary',value:newer});
 assert.equal((await base.load()).drafts.importLibrary.text,newer.text);
 release();await save;
 const after=await base.load();assert.deepEqual(after.drafts.importLibrary,newer);
 assert.equal(Object.values(after.drafts).some(d=>JSON.stringify(d).includes(newer.text)),true);
});

test('editing an existing podcast clip keeps its audio type and source fingerprint',async()=>{
 const card={id:'clip',type:'audio',title:'Synthetic clip',body:'Spoken words',sourceCardId:'source-audio',sourceLocation:'音频片段 00:01 – 00:02',sourceAudioSha256:'a'.repeat(64),attachment:null};
 let payload;
 const form=editor('CardEditor',{kind:'file',card,onSave:async value=>{payload=value;}});
 await button(form,'保存').props.onClick();
 assert.equal(payload.type,'audio');assert.equal(payload.sourceCardId,'source-audio');assert.equal(payload.sourceAudioSha256,card.sourceAudioSha256);
 const {store,one}=await setup();await one.commit({type:'card.upsert',card});
 const ui=workspaceUI(one,{hash:'#/add/edit:clip'});assert.equal(ui.editor().kind,'file');
 await ui.editor().onSave(payload);
 const saved=(await store.load()).cards.find(c=>c.id==='clip');
 assert.equal(saved.type,'audio');assert.equal(saved.sourceCardId,'source-audio');
});

test('editing a Harness recall title and body saves through the real editor transaction while retaining source receipt and reviewed state',async()=>{
 const {store,one}=await setup(),library=recallLibrary.createRecallLibrary({session:one,workspaceId:'isolated'}),capture={requestId:crypto.randomUUID(),title:'原回看标题',text:'中文选区 🧪',externalSource:{version:1,provider:'deepseek-harness',instanceId:'test-instance',sessionId:'test-session',messageId:'test-message',eventSeq:4,turn:1,sessionTitle:'人工测试'}};
 capture.externalSource.selection={text:capture.text,start:6,end:6+capture.text.length,prefix:'上文',suffix:'下文'};
 const saved=await library.call('capture',capture);await library.call('setReview',{id:saved.item.id,due:false});const original=structuredClone(one.state.cards.find(card=>card.id===saved.item.id));
 const ui=workspaceUI(one,{hash:'#/add/edit:'+saved.item.id}),form=editor('CardEditor',ui.editor());
 assert.equal(control(form,'回看标题').props.value,original.title);control(form,'回看标题').props.onChange({target:{value:'编辑后的回看标题 🧪'}});form.render();
 form.find(node=>node.props?.label==='卡片正文').props.onChange('用户编辑后的正文');form.render();await button(form,'保存').props.onClick();
 const actual=(await store.load()).cards.find(card=>card.id===original.id);assert.equal(actual.title,'编辑后的回看标题 🧪');assert.equal(actual.body,'用户编辑后的正文');assert.deepEqual(actual.externalSource,original.externalSource);assert.deepEqual(actual.recallReceipt,original.recallReceipt);assert.equal(actual.recallDue,false);
 const reopened=recallLibrary.createRecallLibrary({session:createWorkspaceSession(store),workspaceId:'isolated'}),replay=await reopened.call('capture',capture);assert.equal(replay.duplicate,true);assert.equal(replay.item.title,actual.title);assert.equal(replay.item.text,actual.body);assert.equal(replay.item.due,false);
 const backup=model.parseWorkspaceBackup(model.serializeWorkspace(await store.load())),backedUp=backup.cards.find(card=>card.id===original.id);assert.deepEqual(backedUp.externalSource,original.externalSource);assert.deepEqual(backedUp.recallReceipt,original.recallReceipt);assert.equal(backedUp.recallDue,false);
});

test('ordinary text cards and new text drafts retain their editor layout without the recall title field',()=>{
 for(const card of [null,{id:'ordinary',type:'text',title:'普通标题',body:'普通正文'}]){
  const form=editor('CardEditor',{kind:'text',card});assert.equal(control(form,'回看标题'),null);assert.ok(form.find(node=>node.props?.label==='卡片正文'));
 }
});

test('editing a Vault file saves a navigable source relation without copying a local path',async()=>{
 const item={id:'vault-note',path:'assets/note.md',title:'Synthetic PDF note',body:'Source note body',type:'file',originalPath:'assets/originals/synthetic.pdf',originalMime:'application/pdf'};
 const {store,one}=await setup(),ui=workspaceUI(one,{hash:'#/add/edit:assets/note.md',items:[item]});
 assert.equal(ui.editor().card.origin,'vault');assert.equal(ui.editor().card.originalPath,item.originalPath);
 let payload;const form=editor('CardEditor',{...ui.editor(),onSave:async value=>payload=value});
 const body=form.find(node=>node.props?.label==='卡片正文');body.props.onChange('Edited source note body');form.render();await button(form,'保存').props.onClick();
 await ui.editor().onSave(payload);
 const saved=(await store.load()).cards.find(c=>c.body==='Edited source note body');
 assert.ok(saved);assert.equal(saved.origin,'local');assert.equal(saved.attachment,null);assert.equal(saved.sourceCardId,item.path);assert.equal(saved.originalPath,undefined);
 ui.refresh();const sourceButton=ui.find(node=>node.type==='button'&&text(node).startsWith('查看来源文件'));assert.ok(sourceButton);sourceButton.props.onClick();ui.refresh();assert.equal(ui.find(node=>node.type?.name==='CardIdentity').props.card.origin,'vault');
});

test('SourceFeeds import does not consume unrelated ImportEditor input',async()=>{
 const {store,one}=await setup();
 const unrelated={text:'UNRELATED UNIMPORTED KINDLE NOTES',format:'kindle',filename:'My Clippings.txt',selected:[],previewed:false};
 await one.commit({type:'draft.set',key:'importLibrary',value:unrelated});
 const ui=workspaceUI(one,{hash:'#/library'});
 ui.find(node=>node.props?.label==='本机工具').props.onClick();ui.render();
 button(ui,'来源订阅与网页剪藏').props.onClick();ui.render();
 const panel=ui.find(node=>typeof node.props?.onImport==='function'&&Array.isArray(node.props.existingCards));assert.ok(panel);
 await panel.props.onImport([{title:'Synthetic feed record',body:'A distinct source item',sourceUrl:'https://example.test/article'}]);
 const after=await store.load();assert.deepEqual(after.drafts.importLibrary,unrelated);assert.equal(Object.values(after.drafts).some(d=>JSON.stringify(d).includes(unrelated.text)),true);
});

test('recovering an audio clip draft as a copy preserves its media type and playback source',async()=>{
 const card={id:'clip',type:'audio',title:'Synthetic clip',body:'Spoken words',sourceCardId:'source-audio',sourceLocation:'音频片段 00:01 – 00:02',sourceAudioSha256:'a'.repeat(64),attachment:null};
 let emitted;
 const edit=editor('CardEditor',{kind:'file',card,onDraftChange:value=>emitted=value,onSave:async()=>{}});
 edit.find(node=>node.props?.label==='卡片正文').props.onChange('Unfinished edited words');
 assert.equal(emitted.type,'audio');assert.equal(emitted.sourceCardId,card.sourceCardId);assert.equal(emitted.sourceAudioSha256,card.sourceAudioSha256);
 const {store,one:old}=await setup();await old.commit({type:'draft.set',key:'edit:clip',value:emitted});
 const current=createWorkspaceSession(store,{sessionId:'recovered'});await current.load();
 const ui=workspaceUI(current,{hash:'#/library'});ui.find(node=>node.props?.label==='本机工具').props.onClick();ui.render();
 ui.find(node=>node.type==='button'&&text(node).startsWith('恢复草稿 · ')).props.onClick();ui.render();
 const copy=ui.find(node=>node.type==='button'&&text(node)==='另存副本');assert.ok(copy);await copy.props.onClick();ui.refresh();
 assert.equal(ui.editor().kind,'text');let payload;
 const form=editor('CardEditor',{...ui.editor(),onSave:async value=>payload=value});await button(form,'保存').props.onClick();await ui.editor().onSave(payload);
 const saved=(await store.load()).cards.find(c=>c.body==='Unfinished edited words');
 assert.equal(saved.type,'audio');assert.equal(saved.sourceCardId,card.sourceCardId);assert.equal(saved.sourceAudioSha256,card.sourceAudioSha256);
});


function importDraft(body='Synthetic body'){
 const text=JSON.stringify([{title:'Synthetic title',body}]);
 const records=discovery.dedupeImports(discovery.parseImportText(text,'json')).items;
 return {text,format:'json',filename:'synthetic.json',selected:records.map(record=>record.fingerprint),previewed:true};
}

test('real ImportEditor submits its exact snapshot and consumes it in the card transaction',async()=>{
 const {fixture,store,one}=await setup(),draft=importDraft();await one.commit({type:'draft.set',key:'importLibrary',value:draft});
 const ui=workspaceUI(one,{hash:'#/import'}),before=fixture.trace.filter(entry=>entry.kind==='put').length;
 const form=editor('ImportEditor',ui.importer());await button(form,' 导入 1 项').props.onClick();
 const after=await store.load();assert.equal(after.drafts.importLibrary,undefined);assert.ok(after.cards.some(card=>card.body==='Synthetic body'));
 assert.equal(fixture.trace.filter(entry=>entry.kind==='put').length-before,1,'cards and exact draft consumption share one transaction');
});

test('failed import transaction retains all card data and its submitted draft',async()=>{
 const {store:base}=await setup();let fail=false;
 const one=createWorkspaceSession({...base,update:updater=>base.update((state,meta)=>{const result=updater(state,meta);if(fail)throw Error('synthetic import failure');return result;})});await one.load();
 const draft=importDraft();await one.commit({type:'draft.set',key:'importLibrary',value:draft});const before=await base.load(),ui=workspaceUI(one,{hash:'#/import'});fail=true;
 await assert.rejects(ui.importer().onImport([{title:'Synthetic title',body:'Synthetic body'}],{draftSnapshot:draft}),/synthetic import failure/);
 assert.deepEqual(await base.load(),before);assert.deepEqual(one.drafts().importLibrary,draft);
});

test('an import completing after navigation leaves a reopened importer and its newer input active',async()=>{
 const {store:base}=await setup();let pause=false,release,started;const began=new Promise(resolve=>started=resolve);
 const one=createWorkspaceSession({...base,update:async updater=>{if(pause){pause=false;started();await new Promise(resolve=>release=resolve);}return base.update(updater);}});await one.load();
 const draft=importDraft('First import body');await one.commit({type:'draft.set',key:'importLibrary',value:draft});const ui=workspaceUI(one,{hash:'#/import'});pause=true;
 const pending=ui.importer().onImport([{title:'First',body:'First import body'}],{draftSnapshot:draft});await began;
 ui.navigate('library');ui.navigate('import');const newer=importDraft('New unfinished body');ui.importer().onDraftChange(newer);ui.render();
 release();await pending;await one.settled();ui.refresh();
 assert.ok(ui.importer(),'the old request must not close a newer editor');assert.deepEqual(ui.importer().draft,newer);assert.deepEqual((await base.load()).drafts.importLibrary,newer);
});

const smallAudio={name:'synthetic.mp3',type:'audio/mpeg',size:6,dataUrl:'data:audio/mpeg;base64,SUQzYWJj'};
test('normal edits preserve the original audio attachment bytes',async()=>{
 let saved;const card={id:'source',title:'Audio source',body:'Source words',type:'audio',attachment:smallAudio};
 const form=editor('CardEditor',{kind:'file',card,onSave:async value=>saved=value});await button(form,'保存').props.onClick();
 assert.equal(saved.type,'audio');assert.deepEqual(JSON.parse(JSON.stringify(saved.attachment)),smallAudio);
});

test('an explicitly replaced attachment updates the media type and preserves the selected bytes',async()=>{
 const selected={name:'synthetic.pdf',type:'application/pdf',size:9,dataUrl:'data:application/pdf;base64,JVBERi0xLjcK'};let saved;
 class FileReader {readAsDataURL(file){queueMicrotask(()=>{this.result=file.dataUrl;this.onload();});}}
 const form=editor('CardEditor',{kind:'file',card:{id:'source',title:'Original audio',body:'Source words',type:'audio',attachment:smallAudio},onSave:async value=>saved=value},{FileReader});
 await form.find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[selected],value:'synthetic.pdf'}});form.render();assert.ok(!form.find(node=>node.props?.error));await button(form,'保存').props.onClick();
 assert.equal(saved.type,'file');assert.deepEqual(JSON.parse(JSON.stringify(saved.attachment)),selected);
});

for(const name of ['CardEditor','ImportEditor'])test(`${name} ignores a late FileReader result after leaving the editor`,async()=>{
 let reader,calls=0;
 class FileReader {constructor(){reader=this;}readAsDataURL(){}readAsText(){}}
 const form=editor(name,{kind:'file',onDraftChange:()=>calls++},{FileReader});
 const input=form.find(node=>node.type==='input'&&node.props.type==='file');
 const pending=input.props.onChange({target:{files:[name==='CardEditor'?smallAudio:{name:'synthetic.json',size:2}],value:'synthetic'}});
 form.unmount();reader.result=name==='CardEditor'?smallAudio.dataUrl:'[]';reader.onload();await pending;
 assert.equal(calls,0);
});

test('real navigation snapshots exclude modal payloads and their attachment bytes',async()=>{
 const {one}=await setup();await one.commit({type:'card.upsert',card:{id:'card',attachment:smallAudio}});
 const ui=workspaceUI(one,{hash:'#/library',realNavigation:true});ui.find(node=>node.props?.label==='分享：card').props.onClick();ui.render();
 assert.ok(ui.find(node=>node.props?.title==='分享离线卡片'));
 const entry=ui.recordHistory();assert.equal(Object.hasOwn(entry,'modal'),false);assert.equal(JSON.stringify(ui.history.state).includes(smallAudio.dataUrl),false);
});

test('collection list pinning uses the latest entity without a stale editor baseline',async()=>{
 const {store,one,two}=await setup();one.beginEdit('collection:group',{type:'collection',id:'group'});await one.commit([{type:'collection.upsert',collection:{id:'group',description:'Earlier own edit'}},{type:'draft.set',key:'collection:group',value:null}]);
 await two.load();await two.commit({type:'collection.upsert',collection:{id:'group',title:'Current remote title',cardIds:['card']}});await one.load();const ui=workspaceUI(one,{hash:'#/collections'});ui.find(node=>node.props?.label==='置顶 Current remote title').props.onClick();await one.load();ui.refresh();
 const saved=(await store.load()).collections[0];assert.equal(saved.pinned,true);assert.equal(saved.title,'Current remote title');assert.equal(saved.description,'Earlier own edit');assert.deepEqual(saved.cardIds,['card']);assert.equal(ui.find(node=>node.props?.role==='alert'),null);
});

test('a narrow collection pin never blesses an unfinished full editor or recreates a deleted collection',async()=>{
 const {store,one,two}=await setup();one.beginEdit('collection:group');const old=structuredClone(one.state.collections[0]);await one.commit({type:'draft.set',key:'collection:group',value:{...old,title:'Unfinished old edit'}});await two.commit({type:'collection.upsert',collection:{id:'group',description:'New remote description'}});await one.load();const ui=workspaceUI(one,{hash:'#/collections'});ui.find(node=>node.props?.label==='置顶 Group').props.onClick();await one.load();
 await assert.rejects(one.commit({type:'collection.upsert',collection:{...old,title:'Unfinished old edit'}}),{code:'WORKSPACE_CONFLICT'});assert.equal((await store.load()).collections[0].description,'New remote description');assert.equal((await store.load()).collections[0].pinned,true);
 const deleting=createWorkspaceSession(store);await deleting.load();await deleting.commit({type:'collection.delete',id:'group'});ui.find(node=>node.props?.label==='置顶 Group').props.onClick();await one.load();assert.deepEqual((await store.load()).collections,[]);
});

const backupFile=(name,read)=>({target:{files:[{name,size:1000,text:read}],value:name}});
const backupText=id=>model.serializeWorkspace(model.workspaceReducer(model.createWorkspaceState(),{type:'card.upsert',card:{id,title:id,body:'Backup body '+id}}));
const backupPicker=ui=>ui.find(node=>node.type==='input'&&node.props.type==='file'&&node.props.accept?.includes('application/json'));
const restoreModal=ui=>ui.find(node=>node.props?.title==='导入备份');
const pasteInput=ui=>ui.find(node=>node.type==='textarea'&&node.props['aria-label']==='备份 JSON 内容');
function openPaste(ui){ui.find(node=>node.props?.label==='本机工具').props.onClick();ui.render();button(ui,'粘贴备份内容').props.onClick();ui.render();}
function changePaste(ui,value){pasteInput(ui).props.onChange({target:{value}});ui.render();}
function previewPaste(ui){ui.find(node=>node.type==='form'&&findNode(node,child=>child.type==='textarea'&&child.props['aria-label']==='备份 JSON 内容')).props.onSubmit({preventDefault(){}});ui.render();}

test('pasted backup preview and cancellation do not write; explicit merge preserves recall source and receipt through replay',async()=>{
 const incomingFixture=indexedFixture(),[incomingStore]=stores(incomingFixture),incomingSession=createWorkspaceSession(incomingStore),input={requestId:crypto.randomUUID(),title:'完整选区 🧪',text:'中文 🧪 <script>不会执行</script>',externalSource:{version:1,provider:'deepseek-harness',instanceId:'test-instance',sessionId:'test-session',messageId:'test-message',eventSeq:4,turn:1,sessionTitle:'人工测试'}};
 input.externalSource.selection={text:input.text,start:0,end:input.text.length,prefix:'',suffix:'后文'};
 const incomingLibrary=recallLibrary.createRecallLibrary({session:incomingSession,workspaceId:'isolated'}),saved=await incomingLibrary.call('capture',input),incoming=model.serializeWorkspace(incomingSession.state);
 const {store,one}=await setup(),before=await store.load(),ui=workspaceUI(one,{hash:'#/library'});
 openPaste(ui);changePaste(ui,incoming);assert.equal(pasteInput(ui).props.value,incoming);assert.equal(pasteInput(ui).props.dangerouslySetInnerHTML,undefined);assert.deepEqual(await store.load(),before);
 button(ui,'取消').props.onClick();ui.render();assert.equal(pasteInput(ui),null);assert.deepEqual(await store.load(),before);
 openPaste(ui);changePaste(ui,incoming);previewPaste(ui);assert.match(text(restoreModal(ui)),/粘贴的备份/);assert.deepEqual(await store.load(),before);
 restoreModal(ui).props.onClose();ui.render();assert.deepEqual(await store.load(),before);
 openPaste(ui);changePaste(ui,incoming);previewPaste(ui);await button(ui,'合并备份').props.onClick();ui.refresh();
 const imported=(await store.load()).cards.find(card=>card.id===saved.item.id),original=incomingSession.state.cards[0];assert.deepEqual(imported.externalSource,original.externalSource);assert.deepEqual(imported.recallReceipt,original.recallReceipt);assert.equal(imported.body,input.text);assert.equal(imported.recallDue,true);
 const library=recallLibrary.createRecallLibrary({session:one,workspaceId:'isolated'});await one.commit({type:'card.upsert',card:{id:imported.id,title:'用户编辑',body:'保留新内容'}});await library.call('setReview',{id:imported.id,due:false});ui.refresh();
 openPaste(ui);changePaste(ui,incoming);previewPaste(ui);await button(ui,'合并备份').props.onClick();
 const replay=await library.call('capture',input);assert.equal(replay.duplicate,true);assert.equal(replay.item.title,'用户编辑');assert.equal(replay.item.text,'保留新内容');assert.equal(replay.item.due,false);assert.equal((await store.load()).cards.filter(card=>card.id===imported.id).length,1);
});

test('pasted backup rejects empty invalid version and oversized Unicode without saving or truncating earlier text',async()=>{
 const {store,one}=await setup(),before=await store.load(),ui=workspaceUI(one,{hash:'#/library'});openPaste(ui);
 previewPaste(ui);assert.match(text(ui.find(node=>node.props?.title==='粘贴备份内容')),/请先粘贴完整备份/);
 changePaste(ui,'{not json');previewPaste(ui);assert.match(text(ui.find(node=>node.props?.title==='粘贴备份内容')),/不是有效的 JSON/);assert.equal(restoreModal(ui),null);
 changePaste(ui,'{"schemaVersion":999}');previewPaste(ui);assert.match(text(ui.find(node=>node.props?.title==='粘贴备份内容')),/受支持的工作区版本/);
 const previous=pasteInput(ui).props.value;changePaste(ui,'a'.repeat(4*1024*1024+1));assert.equal(pasteInput(ui).props.value,previous);assert.match(text(ui.find(node=>node.props?.title==='粘贴备份内容')),/超过 4MiB/);
 changePaste(ui,'中'.repeat(2*1024*1024));assert.equal(pasteInput(ui).props.value,previous);assert.match(text(ui.find(node=>node.props?.title==='粘贴备份内容')),/超过 4MiB/);assert.deepEqual(await store.load(),before);
});

test('opening pasted backup supersedes a pending file read and only the pasted preview can merge',async()=>{
 const {store,one}=await setup(),ui=workspaceUI(one,{hash:'#/library'});let release;
 const pending=backupPicker(ui).props.onChange(backupFile('old-file.json',()=>new Promise(resolve=>release=resolve)));
 openPaste(ui);changePaste(ui,backupText('pasted'));previewPaste(ui);release(backupText('old-file'));await pending;ui.render();
 assert.match(text(restoreModal(ui)),/粘贴的备份/);assert.doesNotMatch(text(restoreModal(ui)),/old-file/);await button(ui,'合并备份').props.onClick();
 const restored=await store.load();assert.ok(restored.cards.some(card=>card.id==='pasted'));assert.ok(!restored.cards.some(card=>card.id==='old-file'));
});

test('a later selected backup wins when an earlier file read finishes last',async()=>{
 const {store,one}=await setup(),ui=workspaceUI(one,{hash:'#/library'});let release;
 const first=backupPicker(ui).props.onChange(backupFile('first.json',()=>new Promise(resolve=>release=resolve)));
 await backupPicker(ui).props.onChange(backupFile('second.json',async()=>backupText('second')));ui.render();
 assert.match(text(restoreModal(ui)),/second\.json/);
 release(backupText('first'));await first;ui.render();
 assert.match(text(restoreModal(ui)),/second\.json/);assert.doesNotMatch(text(restoreModal(ui)),/first\.json/);
 await button(ui,'合并备份').props.onClick();
 assert.ok((await store.load()).cards.some(card=>card.id==='second'));assert.ok(!(await store.load()).cards.some(card=>card.id==='first'));
});

test('a superseded backup failure cannot replace the new preview or show an old error',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/library'});let reject;
 const first=backupPicker(ui).props.onChange(backupFile('broken.json',()=>new Promise((_,fail)=>reject=fail)));
 await backupPicker(ui).props.onChange(backupFile('chosen.json',async()=>backupText('chosen')));ui.render();reject(Error('OLD FILE READ FAILED'));await first;ui.render();
 assert.match(text(restoreModal(ui)),/chosen\.json/);assert.equal(ui.find(node=>node.props?.className==='sw-error'),null);
});

for(const destination of ['route','modal'])test(`a backup read completing after a new ${destination} does not reopen restore`,async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/library'});let release;
 const pending=backupPicker(ui).props.onChange(backupFile('pending.json',()=>new Promise(resolve=>release=resolve)));
 if(destination==='route')ui.navigate('import');else{ui.find(node=>node.props?.label==='分享：card').props.onClick();ui.render();}
 release(backupText('late'));await pending;ui.render();assert.equal(restoreModal(ui),null);
 if(destination==='route')assert.ok(ui.importer());else assert.ok(ui.find(node=>node.props?.title==='分享离线卡片'));
});

test('an invalid latest backup keeps the current library and names its file in the error',async()=>{
 const {store,one}=await setup(),before=await store.load(),ui=workspaceUI(one,{hash:'#/library'});
 await backupPicker(ui).props.onChange(backupFile('invalid.json',async()=>'{invalid'));ui.render();
 assert.equal(restoreModal(ui),null);assert.match(text(ui.find(node=>node.props?.className==='sw-error')),/invalid\.json/);assert.deepEqual(await store.load(),before);
});

test('a pending merge commits its chosen backup but leaves a newer modal open',async()=>{
 const {store:base}=await setup();let pause=false,release,started;const began=new Promise(resolve=>started=resolve);
 const one=createWorkspaceSession({...base,update:async updater=>{if(pause){pause=false;started();await new Promise(resolve=>release=resolve);}return base.update(updater);}});await one.load();const ui=workspaceUI(one,{hash:'#/library'});
 await backupPicker(ui).props.onChange(backupFile('chosen.json',async()=>backupText('chosen')));ui.render();pause=true;const pending=button(ui,'合并备份').props.onClick();await began;
 restoreModal(ui).props.onClose();ui.render();ui.find(node=>node.props?.label==='分享：card').props.onClick();ui.render();release();await pending;ui.refresh();
 assert.ok((await base.load()).cards.some(card=>card.id==='chosen'));assert.ok(ui.find(node=>node.props?.title==='分享离线卡片'));
});

for(const sourceId of ['card','missing-original'])test(`a recovered private note for ${sourceId} is copied in full without changing the current note`,async()=>{
 const {store,one}=await setup(),note='旧备份中的完整私密备注\n'+('中文😀\n'.repeat(4000)),key='window-draft:backup-note:note-'+sourceId;
 await one.commit([{type:'card.note',id:sourceId,note:'CURRENT NOTE',private:false},{type:'draft.set',key,value:{key:'note:'+sourceId,value:{note,private:true},base:null,adoptedFrom:null,imported:true,recoveryOnly:true,conflict:true}}]);
 const ui=workspaceUI(one,{hash:'#/library'});ui.find(node=>node.props?.label==='本机工具').props.onClick();ui.render();ui.find(node=>node.type==='button'&&text(node).startsWith('恢复草稿 · ')).props.onClick();ui.render();
 assert.equal(button(ui,'恢复编辑'),null);await button(ui,'另存副本').props.onClick();ui.refresh();assert.equal(ui.editor().draft.body,note);assert.equal(ui.editor().draft.private,true);
 let payload;const form=editor('CardEditor',{...ui.editor(),onSave:async value=>payload=value});await button(form,'保存').props.onClick();await ui.editor().onSave(payload);
 const current=await store.load(),copied=current.cards.find(card=>card.body===note);assert.ok(copied);assert.equal(current.annotations[copied.id].private,true);assert.equal(current.annotations[sourceId].note,'CURRENT NOTE');assert.equal(current.annotations[sourceId].private,false);assert.equal(current.drafts[key].value.note,note);
});

test('opening and closing another modal invalidates a pending backup read even when modal returns to null',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/library'});let release;
 const pending=backupPicker(ui).props.onChange(backupFile('old.json',()=>new Promise(resolve=>release=resolve)));
 ui.find(node=>node.props?.label==='分享：card').props.onClick();ui.render();ui.find(node=>node.props?.title==='分享离线卡片').props.onClose();ui.render();
 release(backupText('old'));await pending;ui.render();assert.equal(restoreModal(ui),null);
});

test('backup preview and merge expose preserved old notes through the actual manual recovery flow',async()=>{
 const {store,one}=await setup(),ui=workspaceUI(one,{hash:'#/library'}),note='来自备份的备注原文';
 const incoming=model.normalizeWorkspaceState({...model.createWorkspaceState(),cards:[{id:'card',body:'Old backup body'}],annotations:{card:{note,private:true}},favoriteIds:['card'],hiddenIds:['card']});
 await backupPicker(ui).props.onChange(backupFile('notes-backup.json',async()=>model.serializeWorkspace(incoming)));ui.render();assert.match(text(restoreModal(ui)),/1 份不同的备份备注/);await button(ui,'合并备份').props.onClick();ui.refresh();
 const merged=await store.load();assert.equal(merged.cards.find(card=>card.id==='card').body,'card');assert.equal(merged.annotations.card?.note??null,null);assert.deepEqual(merged.favoriteIds,[]);assert.deepEqual(merged.hiddenIds,[]);
 ui.find(node=>node.props?.label==='本机工具').props.onClick();ui.render();ui.find(node=>node.type==='button'&&text(node).startsWith('恢复草稿 · ')).props.onClick();ui.render();assert.equal(button(ui,'恢复编辑'),null);await button(ui,'另存副本').props.onClick();ui.refresh();
 let payload;const form=editor('CardEditor',{...ui.editor(),onSave:async value=>payload=value});await button(form,'保存').props.onClick();await ui.editor().onSave(payload);
 const restored=await store.load(),copy=restored.cards.find(card=>card.body===note);assert.ok(copy);assert.equal(restored.annotations[copy.id].private,true);assert.equal(restored.cards.find(card=>card.id==='card').body,'card');assert.equal(restored.annotations.card?.note??null,null);
});


const documentAttachment=name=>{const bytes=Buffer.from('%PDF-1.7 '+name);return {name,type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')};};
const sourceButton=ui=>ui.find(node=>node.type==='button'&&text(node).startsWith('查看来源文件'));
async function documentSource(){const state=await setup(),first=documentAttachment('first.pdf'),second=documentAttachment('second.pdf');await state.one.commit({type:'card.upsert',card:{id:'source',title:'Source document',attachment:first}});await state.two.load();return {...state,first,second};}

test('new document excerpts persist the exact source fingerprint and open only that source version',async()=>{
 const {store,one,first}=await documentSource(),ui=workspaceUI(one,{hash:'#/card/source'}),expected=await intelligenceDrafts.captureAiSource(one.state.cards.find(card=>card.id==='source'));
 await ui.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'Quoted source text',page:7,rects:[]});ui.refresh();
 const excerpt=one.state.cards.find(card=>card.body==='Quoted source text');assert.equal(excerpt.sourceAttachmentSha256,expected.attachmentMeta.sha256);assert.equal(model.parseWorkspaceBackup(model.serializeWorkspace(one.state)).cards.find(card=>card.id===excerpt.id).sourceAttachmentSha256,excerpt.sourceAttachmentSha256);
 await sourceButton(ui).props.onClick();ui.refresh();const preview=ui.find(node=>typeof node.props?.onExcerpt==='function');assert.equal(preview.props.attachment.dataUrl,first.dataUrl);assert.equal(String(preview.props.initialPage),'7');assert.equal((await store.load()).cards.find(card=>card.id===excerpt.id).body,'Quoted source text');
});

test('replacing an excerpt source prevents its link from silently opening the new file at an old page',async()=>{
 const {one,two,second}=await documentSource(),ui=workspaceUI(one,{hash:'#/card/source'});
 await ui.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'FIRST DOCUMENT QUOTE',page:7,rects:[]});ui.refresh();const excerpt=one.state.cards.find(card=>card.body==='FIRST DOCUMENT QUOTE');
 await two.commit({type:'card.upsert',card:{id:'source',attachment:second}});await one.load();ui.refresh();await sourceButton(ui).props.onClick();ui.render();
 assert.ok(sourceButton(ui),'remain on the excerpt instead of navigating to the replaced document');assert.match(text(ui.find(node=>node.props?.className==='sw-error')),/来源.*(?:版本|变化)|原文件.*(?:版本|变化)/);assert.equal(one.state.cards.find(card=>card.id===excerpt.id).body,'FIRST DOCUMENT QUOTE');
});

test('legacy document excerpts keep manual source navigation with an unverified-version warning',async()=>{
 const {one}=await documentSource();await one.commit({type:'card.upsert',card:{id:'legacy-excerpt',title:'Legacy excerpt',body:'Legacy quotation',type:'highlight',sourceCardId:'source',sourceLocation:'first.pdf',page:7}});
 const ui=workspaceUI(one,{hash:'#/card/legacy-excerpt'});assert.ok(ui.find(node=>node.type==='p'&&/来源版本.*(?:未记录|未核验)/.test(text(node))));assert.equal(Object.hasOwn(one.state.cards.find(card=>card.id==='legacy-excerpt'),'sourceAttachmentSha256'),false);
 await sourceButton(ui).props.onClick();ui.refresh();assert.ok(ui.find(node=>typeof node.props?.onExcerpt==='function'));
});

test('document provenance survives editing and a recovered new-card draft without embedding source bytes',async()=>{
 const hash='a'.repeat(64),card={id:'quote',title:'Quote',body:'Old quote',type:'highlight',sourceCardId:'source',sourceLocation:'first.pdf',sourceAttachmentSha256:hash};let emitted,payload;
 const form=editor('CardEditor',{kind:'text',card,onDraftChange:value=>emitted=value,onSave:async value=>payload=value});form.find(node=>node.props?.label==='卡片正文').props.onChange('Edited quote');form.render();await button(form,'保存').props.onClick();assert.equal(emitted.sourceAttachmentSha256,hash);assert.equal(payload.sourceAttachmentSha256,hash);
 const copy=editor('CardEditor',{kind:'text',draft:emitted,onSave:async value=>payload=value});await button(copy,'保存').props.onClick();assert.equal(payload.sourceAttachmentSha256,hash);assert.equal(payload.sourceCardId,'source');assert.equal(payload.attachment,null);
 const stored=model.workspaceReducer(model.createWorkspaceState(),{type:'card.upsert',card:{...payload,id:'copy'}});assert.equal(stored.cards[0].sourceAttachmentSha256,hash);
 assert.throws(()=>model.workspaceReducer(stored,{type:'card.upsert',card:{id:'copy',sourceAttachmentSha256:'not-a-hash'}}),/指纹/);
});

for(const replace of [false,true])test(`source verification ${replace?'rejects a replaced file':'preserves later navigation'} while its digest is pending`,async()=>{
 const {one,two,second}=await documentSource();let delay=false,started,release;const began=new Promise(resolve=>started=resolve);
 const ui=workspaceUI(one,{hash:'#/card/source',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);if(delay){delay=false;started();await new Promise(resolve=>release=resolve);}return value;}});
 await ui.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'Deferred source quote',page:7,rects:[]});ui.refresh();delay=true;const opening=sourceButton(ui).props.onClick();await began;
 if(replace){await two.commit({type:'card.upsert',card:{id:'source',attachment:second}});await one.load();ui.refresh();}else ui.navigate('import');
 release();await opening;ui.render();
 if(replace){assert.ok(sourceButton(ui));assert.match(text(ui.find(node=>node.props?.className==='sw-error')),/来源附件版本已变化/);}else{assert.ok(ui.importer());assert.equal(ui.find(node=>node.props?.className==='sw-error'),null);}
});

test('an excerpt save records its original bytes and does not close a later editor while hashing',async()=>{
 const {one,two,first,second}=await documentSource();let started,release;const began=new Promise(resolve=>started=resolve),expected=await intelligenceDrafts.captureAiSource(one.state.cards.find(card=>card.id==='source'));
 const ui=workspaceUI(one,{hash:'#/card/source',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);started();await new Promise(resolve=>release=resolve);return value;}});
 const saving=ui.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'Retain original quotation',page:7,rects:[]});await began;await two.commit({type:'card.upsert',card:{id:'source',attachment:second}});await one.load();ui.refresh();ui.navigate('import');release();await saving;ui.refresh();
 const excerpt=one.state.cards.find(card=>card.body==='Retain original quotation');assert.ok(excerpt);assert.equal(excerpt.sourceAttachmentSha256,expected.attachmentMeta.sha256);assert.equal(excerpt.sourceLocation,first.name);assert.ok(ui.importer());assert.equal(one.state.cards.find(card=>card.id==='source').attachment.dataUrl,second.dataUrl);
});


test('read-only native identities above the persisted saved-ID limit remain viewable without changing stored state',async()=>{
 const {store,one}=await setup(),before=await store.load(),ui=workspaceUI(one,{hash:'#/library'});
 ui.find(node=>node.props?.['aria-label']==='搜索资料库').props.onChange({target:{value:'UNIQUE-LARGE-LIBRARY'}});ui.render();
 const items=Array.from({length:20001},(_,index)=>({path:'native/source-'+index+'.md',title:index===20000?'UNIQUE-LARGE-LIBRARY':'Native source '+index,body:'Read-only body'}));
 ui.render({items});assert.ok(ui.find(node=>node.props?.card?.title==='UNIQUE-LARGE-LIBRARY'&&typeof node.props?.onOpen==='function'));assert.ok(ui.find(node=>node.props?.['aria-label']==='整理：UNIQUE-LARGE-LIBRARY'));assert.deepEqual(await store.load(),before);
});

test('native membership updates when distinct source ID arrays have the same joined text',async()=>{
 const {one}=await setup(),items=ids=>ids.map(path=>({path,title:path,body:'Native source body'})),ui=workspaceUI(one,{hash:'#/library',items:items(['a|b','c'])});
 assert.ok(ui.find(node=>node.props?.['aria-label']==='整理：a|b'));
 ui.render({items:items(['a','b|c'])});assert.ok(ui.find(node=>node.props?.['aria-label']==='整理：a'));assert.ok(ui.find(node=>node.props?.['aria-label']==='整理：b|c'));assert.equal(ui.find(node=>node.props?.card?.id==='a|b'&&typeof node.props?.onOpen==='function'),null);
});

test('memoized native membership reflects saved hidden and favorite array replacements',async()=>{
 const {one}=await setup(),item={path:'native',title:'Native title',body:'Native body'},ui=workspaceUI(one,{hash:'#/library',items:[item]});assert.ok(ui.find(node=>node.props?.['aria-label']==='整理：Native title'));
 await one.commit([{type:'card.favorite',id:'native',value:true},{type:'card.hide',id:'native',hidden:true}]);ui.refresh();assert.equal(ui.find(node=>node.props?.card?.title==='Native title'&&typeof node.props?.onOpen==='function'),null);
 ui.navigate('trash');assert.ok(ui.find(node=>node.props?.card?.title==='Native title'&&typeof node.props?.onOpen==='function'));assert.ok(ui.find(node=>node.props?.className==='sw-favorite-mark'));
 await one.commit({type:'card.hide',id:'native',hidden:false});ui.refresh();ui.navigate('library');assert.ok(ui.find(node=>node.props?.['aria-label']==='整理：Native title'));
 await one.commit({type:'card.favorite',id:'native',value:false});ui.refresh();assert.equal(ui.find(node=>node.props?.className==='sw-favorite-mark'),null);
});

for(const nextView of ['share','share-closed','note'])test(`pending source verification preserves a later ${nextView} context`,async()=>{
 const {one}=await documentSource();let delay=false,started,release;const began=new Promise(resolve=>started=resolve);
 const ui=workspaceUI(one,{hash:'#/card/source',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);if(delay){delay=false;started();await new Promise(resolve=>release=resolve);}return value;}});
 await ui.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'SOURCE MODAL QUOTE',page:3,rects:[]});ui.refresh();delay=true;const opening=sourceButton(ui).props.onClick();await began;
 if(nextView.startsWith('share')){ui.find(node=>node.props?.label==='分享').props.onClick();ui.render();if(nextView==='share-closed'){ui.find(node=>node.props?.title==='分享离线卡片').props.onClose();ui.render();}}
 else{ui.find(node=>node.props?.label==='更多').props.onClick();ui.render();button(ui,'添加备注').props.onClick();ui.render();ui.find(node=>node.props?.['aria-label']==='我的备注').props.onChange({target:{value:'NEW NOTE INPUT'}});await one.settled();ui.refresh();}
 release();await opening;ui.render();assert.ok(sourceButton(ui),'do not navigate away from the quote after a newer context');
 if(nextView==='share')assert.ok(ui.find(node=>node.props?.title==='分享离线卡片'));
 if(nextView==='share-closed')assert.equal(ui.find(node=>node.props?.title==='分享离线卡片'),null);
 if(nextView==='note')assert.equal(ui.find(node=>node.props?.['aria-label']==='我的备注').props.value,'NEW NOTE INPUT');
});

test('an excerpt save completing after a share modal opens preserves the newer visible context',async()=>{
 const {one}=await documentSource();let started,release;const began=new Promise(resolve=>started=resolve);
 const ui=workspaceUI(one,{hash:'#/card/source',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);started();await new Promise(resolve=>release=resolve);return value;}});
 const saving=ui.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'SAVED WITHOUT CLOSING SHARE',page:3,rects:[]});await began;
 ui.find(node=>node.props?.label==='分享').props.onClick();ui.render();release();await saving;ui.refresh();
 assert.ok(ui.find(node=>node.props?.title==='分享离线卡片'));assert.ok(one.state.cards.some(card=>card.body==='SAVED WITHOUT CLOSING SHARE'));
});

test('ordinary exports with only OCR or captions reach the real import transaction without deduplicating distinct text',async()=>{
 const originals=model.normalizeWorkspaceState({cards:[
  {id:'ocr-one',title:'OCR one',type:'image',body:'',caption:'Caption one',ocrText:'OCR first'},
  {id:'ocr-two',title:'OCR two',type:'image',body:'',caption:'Caption two',ocrText:'OCR second'},
  {id:'caption-only',title:'Caption only',type:'image',body:'',caption:'No OCR, still content'},
 ]}).cards;
 for(const format of ['json','csv','markdown']){
  const records=discovery.parseImportText(model.exportCards(originals,format),format),{store,one}=await setup();
  const ui=workspaceUI(one,{hash:'#/import'});await ui.importer().onImport(records);
  const saved=(await store.load()).cards.filter(card=>card.title.startsWith('OCR ')||card.title==='Caption only');
  assert.equal(saved.length,3,format);
  for(const original of originals){const actual=saved.find(card=>card.title===original.title);for(const field of ['body','caption','ocrText','sourceTitle','type'])assert.equal(actual[field],original[field],`${format} ${field}`);assert.equal(actual.importFingerprint,discovery.importFingerprint(original));}
  await assert.rejects(ui.importer().onImport(records),/无需重复导入/);
  assert.equal((await store.load()).cards.length,4);
 }
});

test('same-title insights retain separate exact-card actions through filtering and detail navigation without writes',async()=>{
 const {store,one}=await setup(),title='合成同名解读';
 const cards=[
  {id:'ai-insight:11111111-1111-4111-8111-111111111111',origin:'local',type:'text',title,tags:['AI 解读'],body:'仅第一份匹配',createdAt:'2026-10-18T01:02:03Z'},
  {id:'ai-insight:22222222-2222-4222-8222-222222222222',origin:'local',type:'text',title,tags:['AI 解读'],body:'仅第二份匹配',createdAt:'2026-10-18T02:03:04Z'},
 ];
 await one.commit(cards.flatMap(card=>[{type:'card.upsert',card},{type:'card.save',id:card.id,saved:true}]));
 const before=JSON.stringify(await store.load()),ui=workspaceUI(one,{hash:'#/library',realNavigation:true});
 const open=card=>ui.find(node=>node.props?.card?.id===card.id&&typeof node.props?.onOpen==='function');
 assert.ok(open(cards[0]));assert.ok(open(cards[1]));
 assert.notEqual(open(cards[0]).props.card.id,open(cards[1]).props.card.id);
 assert.equal(open(cards[0]).props.card.body,cards[0].body);
 assert.equal(open(cards[1]).props.card.body,cards[1].body);
 ui.find(node=>node.props?.['aria-label']==='搜索资料库').props.onChange({target:{value:'仅第一份匹配'}});ui.render();
 assert.ok(open(cards[0]));assert.equal(open(cards[1]),null);
 open(cards[0]).props.onOpen(cards[0].id);ui.render();
 const detail=ui.find(node=>node.type?.name==='CardIdentity');
 assert.ok(detail);assert.equal(detail.props.card.id,cards[0].id);
 assert.equal(detail.props.card.createdAt,cards[0].createdAt);
 assert.equal(JSON.stringify(await store.load()),before);
});



test('legacy external book uses a note-based original action, keeps body visible and never fetches PDF bytes',async()=>{
 const {store,one}=await setup(),calls=[],path='01_sources/books/legacy.md';
 const source={id:path,path,kind:'book',type:'text',title:'合成旧书',body:'旧书笔记正文',originalPath:'',originalAvailable:true,originalName:'合成原书.pdf',originalMime:'application/pdf',fields:{},tags:[]};
 const before=JSON.stringify(await store.load()),ui=workspaceUI(one,{hash:'#/card/'+path,items:[source],api:{openOriginal:async id=>{calls.push(id);return {ok:true,data:{opened:true}};},readAttachment:()=>assert.fail('Must not fetch external PDF')}});
 const open=button(ui,'打开原书 · 合成原书.pdf');assert.ok(open);
 const reader=ui.find(node=>node.type?.name==='NoteReadingBody');assert.equal(reader.props.card.body,source.body);
 await open.props.onClick();assert.deepEqual(calls,[path]);assert.equal(JSON.stringify(await store.load()),before);
 const more=ui.find(node=>node.props?.label==='更多');more.props.onClick();ui.render();
 const original=ui.find(node=>node.props?.role==='menuitem'&&text(node)==='打开原文件');assert.ok(original);await original.props.onClick();assert.deepEqual(calls,[path,path]);
});


test('legacy project notes use the original-file label and stable path without fetching attachments or editing the source',async()=>{
 const {store,one}=await setup(),calls=[],path='03_projects/legacy.md';
 const source={id:path,path,kind:'project',type:'text',title:'合成旧项目',body:'项目正文',originalAvailable:true,originalPath:'',originalName:'legacy.md',fields:{},tags:[]};
 const before=JSON.stringify(await store.load()),ui=workspaceUI(one,{hash:'#/card/'+path,items:[source],api:{openOriginal:async id=>{calls.push(id);return {ok:true,data:{opened:true}};},readAttachment:()=>assert.fail('Project is not a binary attachment')}});
 const open=button(ui,'打开原文件 · legacy.md');assert.ok(open);assert.equal(button(ui,'打开原书 · legacy.md'),null);
 await open.props.onClick();assert.deepEqual(calls,[path]);assert.equal(JSON.stringify(await store.load()),before);
});

test('reader progress, bookmarks and notes use the existing atomic workspace and reopen without changing cards',async()=>{
 const {one,otherStore}=await setup(),ui=workspaceUI(one,{hash:'#/reader/card'}),reader=ui.find(node=>typeof node.props?.onUpdate==='function'&&typeof node.props?.registerFlush==='function').props;
 const before=structuredClone(one.state.cards),source={sourceKey:'fixture-book-version',name:'fixture.pdf',type:'application/pdf'};
 await reader.onUpdate(source,{type:'location',location:{page:17}});await reader.onUpdate(source,{type:'note',note:'中文阅读笔记\n原文保留'});await reader.onUpdate(source,{type:'bookmark.add',bookmark:{id:'bookmark-one',label:'第17页',locator:{page:17}}});
 const reopened=createWorkspaceSession(otherStore,{sessionId:'reopened-reader'});await reopened.load();const saved=reopened.state.drafts[readerModel.readerStateKey('card',source.sourceKey)];
 assert.equal(saved.location.page,17);assert.equal(saved.note,'中文阅读笔记\n原文保留');assert.equal(saved.bookmarks.length,1);assert.deepEqual(one.state.cards,before);
 const imported=model.parseWorkspaceBackup(model.serializeWorkspace(reopened.state));assert.equal(imported.drafts[readerModel.readerStateKey('card',source.sourceKey)].note,saved.note);
});

test('reader excerpt saves selected text and a source-version locator, without navigating away or copying original bytes',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/reader/card'}),reader=ui.find(node=>typeof node.props?.onUpdate==='function'&&typeof node.props?.registerFlush==='function').props;
 const value={text:'这一段来自原书。',format:'epub',sourceKey:'exact-book-version',sourceName:'原书.epub',label:'第2章',locator:{chapter:1,start:5,end:15,progress:.4}};
 await reader.onExcerpt(value);const excerpt=one.state.cards.find(card=>card.id!=='card');assert.equal(excerpt.body,value.text);assert.equal(excerpt.sourceCardId,'card');assert.equal(excerpt.attachment,null);assert.equal(one.state.drafts['reader-excerpt:'+excerpt.id].sourceKey,value.sourceKey);assert.equal(one.state.drafts['reader-excerpt:'+excerpt.id].locator.chapter,1);assert.equal(ui.history.state?.mengcangSublimeNavigation?.route?.page,undefined);
});


test('reader back consumes its entry so detail back returns to the library instead of a reader loop',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/library',realNavigation:true});
 ui.navigate('card','card');ui.navigate('reader','card');
 const reader=ui.find(node=>typeof node.props?.onUpdate==='function'&&typeof node.props?.registerFlush==='function').props;
 await reader.onExit();ui.render();assert.equal(ui.location.hash,'#/card/card');
 const back=ui.find(node=>node.props?.label==='返回');assert.ok(back);back.props.onClick();ui.render();
 assert.equal(ui.location.hash,'#/library');assert.equal(ui.history.index,0);
});

test('a directly opened reader exits to the library without creating a new back loop',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/reader/card',realNavigation:true});
 const reader=ui.find(node=>typeof node.props?.onUpdate==='function'&&typeof node.props?.registerFlush==='function').props;
 await reader.onExit();ui.render();assert.equal(ui.location.hash,'#/library');assert.equal(ui.history.index,0);
});

test('reader library exit offers an explicit route back to the main library',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/reader/card',realNavigation:true});
 const reader=ui.find(node=>typeof node.props?.onUpdate==='function'&&typeof node.props?.registerFlush==='function').props;
 await reader.onLibrary();ui.render();assert.equal(ui.location.hash,'#/library');
});

test('reader excerpt retries preserve its note and use one stable card without overwriting later edits',async()=>{
 const {one}=await setup(),ui=workspaceUI(one,{hash:'#/reader/card'}),reader=ui.find(node=>typeof node.props?.onUpdate==='function'&&typeof node.props?.registerFlush==='function').props;
 const value={operationId:'same-save',note:'选文附带的中文批注',text:'仅保存一次的选文。',format:'pdf',sourceKey:'book-version',sourceName:'book.pdf',label:'第2页',locator:{page:2}};
 await reader.onExcerpt(value);await reader.onExcerpt(value);assert.equal(one.state.cards.length,2);
 const card=one.state.cards.find(item=>item.id==='reader-excerpt-same-save');assert.equal(card.caption,value.note);assert.equal(card.body,value.text);
 await one.commit({type:'card.upsert',card:{...card,caption:'保存后手动编辑的批注'}});
 await assert.rejects(reader.onExcerpt(value),/发生变化/);assert.equal(one.state.cards.find(item=>item.id===card.id).caption,'保存后手动编辑的批注');
});

const bookFlag=form=>form.find(node=>node.props?.label==='收录到图书'&&typeof node.props?.onChange==='function');
function toggleBook(form){const flag=bookFlag(form);assert.ok(flag,'PDF / EPUB must expose the existing FlagButton book classification control');const toggle=flag.type(flag.props);assert.equal(toggle.props.role,'switch');toggle.props.onClick();form.render();}
class ImmediateFileReader{readAsDataURL(file){queueMicrotask(()=>{this.result=file.dataUrl;this.onload();});}}
async function selectEditorFile(form,file){const input=form.find(node=>node.type==='input'&&node.props.type==='file');assert.ok(input);await input.props.onChange({target:{files:[file],value:file.name}});form.render();}

test('an existing PDF file can be explicitly collected as a book without changing attachment, notes or source',async()=>{
 const attachment=documentAttachment('四千周.pdf'),card={id:'pdf-file',type:'file',title:'四千周',body:'保留正文',caption:'保留备注',sourceUrl:'https://example.test/original#part',sourceTitle:'保留来源',author:'原作者',page:'17',sourceLocation:'原有位置',sourceCardId:'source',attachment,favorite:true,private:true,collectionIds:['group']};let saved;
 const form=editor('CardEditor',{kind:'file',card,onSave:async value=>saved=value});toggleBook(form);await button(form,'保存').props.onClick();
 assert.equal(saved.type,'book');for(const field of ['title','body','caption','sourceUrl','sourceTitle','author','page','sourceLocation','sourceCardId','favorite','private'])assert.equal(saved[field],card[field],field);assert.deepEqual(saved.collectionIds,card.collectionIds);assert.deepEqual(saved.attachment,attachment);
 const state=[{type:'card.upsert',card:saved},{type:'card.save',id:saved.id,saved:true}].reduce(model.workspaceReducer,model.createWorkspaceState());assert.equal(view.selectWorkspaceCards(state.cards,state,{route:{page:'library'},filters:{media:'Books'}}).some(item=>item.id===saved.id),true);
});

test('the dedicated book entry imports PDF while ordinary file import remains file',async()=>{
 const pdf=documentAttachment('图书入口.pdf');
 for(const [kind,expected] of [['book','book'],['file','file']]){let saved;const form=editor('CardEditor',{kind,onSave:async value=>saved=value},{FileReader:ImmediateFileReader});await selectEditorFile(form,pdf);await button(form,'保存').props.onClick();assert.equal(saved.type,expected);assert.deepEqual(saved.attachment,pdf);}
});

test('book entry requires a PDF or EPUB attachment and rejects other formats without replacing selected bytes',async()=>{
 let saves=0;const empty=editor('CardEditor',{kind:'book',draft:{body:'只有笔记也不能冒充原书'},onSave:async()=>saves++});await button(empty,'保存').props.onClick();empty.render();assert.equal(saves,0);assert.match(empty.find(node=>node.props?.error)?.props.error||'',/PDF.*EPUB/);
 const pdf=documentAttachment('保留原书.pdf'),pngBytes=Buffer.from('\x89PNG\r\n\x1a\nfixture','binary'),png={name:'not-book.png',type:'image/png',size:pngBytes.length,dataUrl:'data:image/png;base64,'+pngBytes.toString('base64')};let saved;
 const form=editor('CardEditor',{kind:'book',draft:{type:'book',attachment:pdf},onSave:async value=>saved=value},{FileReader:ImmediateFileReader});await selectEditorFile(form,png);assert.match(form.find(node=>node.props?.error)?.props.error||'',/PDF.*EPUB/);await button(form,'保存').props.onClick();assert.deepEqual(saved.attachment,pdf);assert.equal(saved.type,'book');
});

test('book classification survives a recovered draft, and legacy drafts without type retain attachment inference',async()=>{
 const attachment=documentAttachment('草稿原书.pdf');let emitted,saved;
 const first=editor('CardEditor',{kind:'file',card:{id:'file-before',type:'file',body:'内容',attachment},onDraftChange:value=>emitted=value,onSave:async()=>{}});toggleBook(first);assert.equal(emitted.type,'book');
 const resumed=editor('CardEditor',{kind:'text',draft:emitted,onSave:async value=>saved=value});await button(resumed,'保存').props.onClick();assert.equal(saved.type,'book');assert.deepEqual(saved.attachment,attachment);
 const legacy=editor('CardEditor',{kind:'file',draft:{body:'旧版无分类草稿',attachment},onSave:async value=>saved=value});await button(legacy,'保存').props.onClick();assert.equal(saved.type,'file');
 const legacyImage=editor('CardEditor',{kind:'file',draft:{body:'旧版无分类图片草稿',image:'https://example.test/image.png'},onSave:async value=>saved=value});await button(legacyImage,'保存').props.onClick();assert.equal(saved.type,'image');
});

test('replacing a book PDF retains book classification, but replacing it with an image uses the image type',async()=>{
 const original=documentAttachment('旧原书.pdf'),replacement=documentAttachment('新原书.pdf'),bytes=Buffer.from('\x89PNG\r\n\x1a\nfixture','binary'),image={name:'picture.png',type:'image/png',size:bytes.length,dataUrl:'data:image/png;base64,'+bytes.toString('base64')};
 for(const [file,expected] of [[replacement,'book'],[image,'image']]){let saved;const form=editor('CardEditor',{kind:'file',card:{id:'existing-book',type:'book',body:'原笔记',caption:'保留备注',attachment:original},onSave:async value=>saved=value},{FileReader:ImmediateFileReader});await selectEditorFile(form,file);await button(form,'保存').props.onClick();assert.equal(saved.type,expected);assert.equal(saved.caption,'保留备注');assert.deepEqual(saved.attachment,file);}
});

test('a new PDF classification switch is preserved both when enabled and later disabled',async()=>{
 let saved;const form=editor('CardEditor',{kind:'file',onSave:async value=>saved=value},{FileReader:ImmediateFileReader});await selectEditorFile(form,documentAttachment('切换分类.pdf'));toggleBook(form);await button(form,'保存').props.onClick();assert.equal(saved.type,'book');form.render();toggleBook(form);await button(form,'保存').props.onClick();assert.equal(saved.type,'file');
});

test('new EPUB imports still default to book and an explicit file choice is not overridden on save',async()=>{
 const bytes=await epubFixture(),attachment={name:'合成原书.epub',type:'application/epub+zip',size:bytes.length,dataUrl:'data:application/epub+zip;base64,'+Buffer.from(bytes).toString('base64')};let saved;
 const form=editor('CardEditor',{kind:'file',onSave:async value=>saved=value},{FileReader:ImmediateFileReader});await selectEditorFile(form,attachment);await button(form,'保存').props.onClick();assert.equal(saved.type,'book');assert.deepEqual(saved.attachment,attachment);form.render();toggleBook(form);await button(form,'保存').props.onClick();assert.equal(saved.type,'file');
 const legacy=editor('CardEditor',{kind:'file',draft:{body:'无 type 的旧 EPUB 草稿',attachment},onSave:async value=>saved=value});await button(legacy,'保存').props.onClick();assert.equal(saved.type,'book');
});

test('the real local PDF menu moves one card into Books and back while preserving notes, collection, reader draft and reopened bytes',async()=>{
 const {one,store,otherStore}=await setup(),id='local-book-file',attachment=documentAttachment('四千周.pdf'),readerKey=readerModel.readerStateKey(id,'source-version'),readerDraft=readerModel.readerReducer({}, {type:'note',note:'既有阅读笔记'});
 await one.commit([{type:'card.upsert',card:{id,type:'file',title:'本机四千周',body:'完整原笔记',caption:'卡片备注',sourceUrl:'https://example.test/book',attachment}},{type:'card.save',id,saved:true},{type:'card.favorite',id,value:true},{type:'card.note',id,note:'独立私人备注',private:true},{type:'collection.toggleCard',id:'group',cardId:id,selected:true},{type:'draft.set',key:readerKey,value:readerDraft}]);
 const before=await store.load(),ui=workspaceUI(one,{hash:'#/card/'+id});ui.find(node=>node.props?.label==='更多').props.onClick();ui.render();const move=ui.find(node=>node.props?.role==='menuitem'&&text(node)==='移到图书');assert.ok(move);await move.props.onClick();ui.refresh();
 const reopened=createWorkspaceSession(otherStore,{sessionId:'classification-reopen'});await reopened.load();const after=reopened.state,actual=after.cards.find(card=>card.id===id),original=before.cards.find(card=>card.id===id);assert.equal(actual.type,'book');for(const field of Object.keys(original).filter(field=>!['type','updatedAt'].includes(field)))assert.deepEqual(actual[field],original[field],field);for(const field of ['savedIds','favoriteIds','notes','collections','drafts'])assert.deepEqual(after[field],before[field],field);
 const books=view.selectWorkspaceCards(after.cards,after,{route:{page:'library'},filters:{media:'Books'}});assert.equal(books.length,1);assert.equal(books[0].id,id);
 ui.find(node=>node.props?.label==='更多').props.onClick();ui.render();const undo=ui.find(node=>node.props?.role==='menuitem'&&text(node)==='移到文件');assert.ok(undo);await undo.props.onClick();const restored=await store.load();assert.equal(restored.cards.find(card=>card.id===id).type,'file');assert.deepEqual(restored.drafts[readerKey],readerDraft);assert.deepEqual(restored.cards.find(card=>card.id===id).attachment,attachment);
});

test('read-only Vault records expose neither move-to-book nor move-to-file actions',async()=>{
 const {one,store}=await setup(),path='01_sources/books/read-only.md',source={id:path,path,type:'file',title:'只读原始 PDF',body:'原始笔记',attachment:documentAttachment('只读原书.pdf'),originalMime:'application/pdf',fields:{},tags:[]},before=await store.load(),ui=workspaceUI(one,{hash:'#/card/'+path,items:[source]});
 ui.find(node=>node.props?.label==='更多').props.onClick();ui.render();assert.equal(ui.find(node=>node.props?.role==='menuitem'&&['移到图书','移到文件'].includes(text(node))),null);assert.deepEqual(await store.load(),before);
});

test('the real add menu opens the dedicated book editor and persists a selected PDF as Books',async()=>{
 const {one,store}=await setup(),ui=workspaceUI(one,{hash:'#/library'});ui.find(node=>node.props?.label==='添加卡片').props.onClick();ui.render();const entry=ui.find(node=>node.props?.role==='menuitem'&&text(node)==='导入图书');assert.ok(entry);entry.props.onClick();ui.render();assert.equal(ui.editor().kind,'book');
 const form=editor('CardEditor',ui.editor(),{FileReader:ImmediateFileReader});await selectEditorFile(form,documentAttachment('从图书入口导入.pdf'));
 // onDraftChange is controlled by the real workspace; reopen the editor with
 // that current draft before submitting the actual save transaction.
 ui.render();const current=editor('CardEditor',ui.editor());await button(current,'保存').props.onClick();ui.refresh();const after=await store.load(),saved=after.cards.find(card=>card.attachment?.name==='从图书入口导入.pdf');assert.ok(saved);assert.equal(saved.type,'book');assert.equal(view.selectWorkspaceCards(after.cards,after,{route:{page:'library'},filters:{media:'Books'}}).some(card=>card.id===saved.id),true);
});

function bookRecoveryMenu(session){
 const ui=workspaceUI(session,{hash:'#/library'});ui.find(node=>node.props?.label==='本机工具').props.onClick();ui.render();ui.find(node=>node.type==='button'&&text(node).startsWith('恢复草稿 · ')).props.onClick();ui.render();
 const record=ui.find(node=>node.type==='article'&&node.props?.className==='sw-recovery-draft'&&find(node,child=>child.type==='strong'&&text(child)==='new:book'));assert.ok(record,'the book draft is reachable through the actual recovery menu');return {ui,record};
}

test('recovering an unfinished book entry keeps the PDF or EPUB attachment requirement before saving',async()=>{
 const {store,one:old}=await setup(),draft={body:'尚未选书的图书草稿，不能变成普通笔记'};await old.commit({type:'draft.set',key:'new:book',value:draft});
 const current=createWorkspaceSession(store,{sessionId:'recover-empty-book'});await current.load();const {ui,record}=bookRecoveryMenu(current),resume=find(record,node=>node.type==='button'&&text(node)==='恢复编辑');assert.ok(resume);await resume.props.onClick();ui.refresh();assert.equal(ui.editor().kind,'book');assert.equal(ui.editor().draft.body,draft.body);
 const before=structuredClone(current.state.cards);let submissions=0;const form=editor('CardEditor',{...ui.editor(),onSave:async()=>submissions++});await button(form,'保存').props.onClick();form.render();assert.equal(submissions,0);assert.match(form.find(node=>node.props?.error)?.props.error||'',/PDF.*EPUB/);assert.deepEqual((await store.load()).cards,before);assert.equal(current.drafts()['new:book'].body,draft.body);
});

test('resuming and saving a book PDF consumes its new:book draft while preserving an unrelated new:file draft',async()=>{
 const {store,one:old}=await setup(),attachment=documentAttachment('恢复的图书.pdf'),draft={title:'恢复的图书',body:'原图书草稿正文',attachment},unrelated={body:'无关文件草稿'};await old.commit([{type:'draft.set',key:'new:book',value:draft},{type:'draft.set',key:'new:file',value:unrelated}]);
 const current=createWorkspaceSession(store,{sessionId:'recover-pdf-book'});await current.load();const {ui,record}=bookRecoveryMenu(current),resume=find(record,node=>node.type==='button'&&text(node)==='恢复编辑');assert.ok(resume);await resume.props.onClick();ui.refresh();assert.equal(ui.editor().kind,'book');
 const form=editor('CardEditor',ui.editor());await button(form,'保存').props.onClick();ui.refresh();const saved=(await store.load()).cards.find(card=>card.title===draft.title);assert.ok(saved);assert.equal(saved.type,'book');assert.deepEqual(saved.attachment,attachment);assert.equal(current.drafts()['new:book'],undefined);assert.deepEqual(current.drafts()['new:file'],unrelated);
 const reopened=createWorkspaceSession(store,{sessionId:'reopened-book-recovery'});await reopened.load();assert.equal(reopened.drafts()['new:book'],undefined);assert.deepEqual(reopened.drafts()['new:file'],unrelated);
});

test('copying a historical new:book recovery targets the book editor and preserves the original history record',async()=>{
 const {store,one}=await setup(),historyKey='window-draft:backup-book:historical',attachment=documentAttachment('历史图书.pdf'),draft={title:'历史图书副本',body:'历史图书草稿正文',attachment,collectionIds:['group']},unrelated={body:'文件草稿继续保留'};
 await one.commit([{type:'draft.set',key:historyKey,value:{key:'new:book',value:draft,base:null,imported:true,recoveryOnly:true,conflict:true,copyOnly:true}},{type:'draft.set',key:'new:file',value:unrelated}]);const {ui,record}=bookRecoveryMenu(one);assert.equal(find(record,node=>node.type==='button'&&text(node)==='恢复编辑'),null);const copy=find(record,node=>node.type==='button'&&text(node)==='另存副本');assert.ok(copy);await copy.props.onClick();ui.refresh();assert.equal(ui.editor().kind,'book');assert.deepEqual(ui.editor().draft.attachment,attachment);assert.deepEqual(ui.editor().draft.collectionIds,[]);assert.deepEqual(one.drafts()['new:file'],unrelated);
 const form=editor('CardEditor',ui.editor());await button(form,'保存').props.onClick();ui.refresh();const after=await store.load(),saved=after.cards.find(card=>card.title===draft.title);assert.ok(saved);assert.equal(saved.type,'book');assert.deepEqual(saved.attachment,attachment);assert.equal(one.drafts()['new:book'],undefined);assert.deepEqual(after.drafts[historyKey].value,draft);assert.deepEqual(one.drafts()['new:file'],unrelated);
});
