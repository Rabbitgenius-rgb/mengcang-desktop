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
const compiled=(await transform(await readFile(new URL('../src/sublime/SublimeWorkspace.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
function findNode(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const node of tree){const match=findNode(node,predicate);if(match)return match;}return null;}return predicate(tree)?tree:findNode(tree.props?.children,predicate);}
function workspaceUI(session,{hash='#/add/edit:card',items=[],realNavigation=false,captureSource=intelligenceDrafts.captureAiSource}={}){
 const identity={id:'synthetic-editor'},states=[],refs=[],memos=[],layouts=[],begins=[],ends=[],submissions=[];let stateIndex=0,refIndex=0,memoIndex=0,layoutIndex=0,tree,scheduled=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={Fragment:Symbol(),createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:()=>{},useMemo:(factory,deps)=>{const index=memoIndex++;if(!memos[index]||!same(deps,memos[index].deps))memos[index]={deps,value:factory()};return memos[index].value;},useRef:initial=>{const index=refIndex++;return refs[index]??(refs[index]={current:index===4?identity.id:initial});},useState:initial=>{const index=stateIndex++;if(!states[index])states[index]={value:index===0?{...session.state,drafts:session.drafts()}:index===1?true:typeof initial==='function'?initial():initial};return [states[index].value,next=>{states[index].value=typeof next==='function'?next(states[index].value):next;}];},useLayoutEffect:(effect,deps)=>{const index=layoutIndex++;if(!layouts[index]||!same(deps,layouts[index].deps))scheduled.push(()=>{layouts[index]?.cleanup?.();layouts[index]={deps,cleanup:effect()};});}};
 const CardEditor=()=>null,ImportEditor=()=>null,CollectionEditor=()=>null,empty=()=>null,icons=new Proxy({},{get:()=>empty});
 const observedSession={...session,get state(){return session.state;},get writing(){return session.writing;},beginEdit:(...args)=>{begins.push(args[0]);return session.beginEdit(...args);},endEdit:(...args)=>{ends.push(args[0]);return session.endEdit(...args);},commit:(actions,options)=>{submissions.push({actions,options});return session.commit(actions,options);}};
 let navigation;const location={hash,href:'https://example.test/'},history={state:{},replaceState(value,title,nextHash){this.state=structuredClone(value);if(nextHash)location.hash=nextHash;},pushState(value,title,nextHash){this.state=structuredClone(value);if(nextHash)location.hash=nextHash;}};
 const require=specifier=>{
  if(specifier==='react')return react;if(specifier==='@tabler/icons-react')return icons;
  if(specifier==='./workspaceModel.js')return model;if(specifier==='./workspaceView.js')return view;if(specifier==='../discoveryModel.js')return discovery;if(specifier==='../desktopModel.js')return desktop;
  if(specifier==='./workspaceStore.js')return {createWorkspaceStore:()=>({})};if(specifier==='./workspacePersistence.js')return {createWorkspaceSession:()=>observedSession};
  if(specifier==='./workspaceNavigation.js')return {createWorkspaceNavigation:options=>(navigation=realNavigation?navigationModel.createWorkspaceNavigation(options):{restoreCurrent(){},record(){},open:(route)=>options.restore({route,filters:{query:'',media:'All',sort:'newest',inLibrary:false,favorite:false}})})};
  if(specifier==='./SublimeEditors.jsx')return {CardEditor,CollectionEditor,CanvasEditor:empty,ImportEditor,SafeRichBody:empty};
  if(specifier==='./referenceCards.js')return {listeningCard:{id:'unused-reference'}};if(specifier==='./intelligenceHelpers.js')return intelligence;if(specifier==='./intelligenceDrafts.js')return {...intelligenceDrafts,captureAiSource:captureSource};if(specifier==='./podcastTranscription.js')return podcastTranscription;
  if(specifier==='./workspaceDownload.js')return {requestWorkspaceDownload:()=>{throw Error('Unexpected download');}};
  if(specifier==='./rendererQuit.js')return {}; // No native quit callback in this fixture.
  if(['./AttachmentPreview.jsx','./VaultAttachmentPreview.jsx','./IntelligencePanel.jsx','./SourceFeeds.jsx','./PodcastClips.jsx','./externalContext.js','./publishableCollection.js'].includes(specifier))return {default:empty,PodcastClipPlayback:empty};
  if(specifier.endsWith('.css'))return {};throw Error('Unexpected module '+specifier);
 };
 const module={exports:{}};vm.compileFunction(compiled,['module','exports','require','window','history','location','setTimeout','clearTimeout'])(module,module.exports,require,{history,location,matchMedia:()=>({matches:false})},history,location,()=>0,()=>{});
 function render(patch={}){if(Object.hasOwn(patch,'items'))items=patch.items;stateIndex=refIndex=memoIndex=layoutIndex=0;scheduled=[];tree=module.exports.default({identity,items});for(const run of scheduled)run();return tree;}
 function refresh(){states[0].value={...session.state,drafts:session.drafts()};refs[2].current=session.state;return render();}
 render();return {render,refresh,history,recordHistory:()=>navigation.record(),begins,ends,submissions,find:predicate=>findNode(tree,predicate),editor:()=>findNode(tree,node=>node.type===CardEditor)?.props,importer:()=>findNode(tree,node=>node.type===ImportEditor)?.props,collector:()=>findNode(tree,node=>node.type===CollectionEditor)?.props,navigate:(page,id='')=>{navigation.open({page,id,sourcePage:1});render();}};
}

import * as attachments from '../src/sublime/attachmentPreview.js';
const source=await readFile(new URL('../src/sublime/SublimeEditors.jsx',import.meta.url),'utf8');
const editorCompiled=(await transform(source,{loader:'jsx',format:'cjs',jsx:'transform'})).code;

// Exercise the real editor event handlers with persistent hook slots. No browser,
// IndexedDB, network or Vault adapter is used by this regression harness.
function editor(name,props,services={}){
  const slots=[],effects=[];let cursor=0,effectCursor=0,tree,scheduled=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={Fragment:Symbol('fragment'),memo:value=>value,createElement:(type,props,...children)=>({type,props:{...props,children}}),isValidElement:value=>Boolean(value&&value.props),useEffect:(effect,deps)=>{const index=effectCursor++;if(!effects[index]||!same(deps,effects[index].deps))scheduled.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:effect()};});},useMemo:factory=>factory(),useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
  const icons=new Proxy({},{get:(_,name)=>function Icon(){return react.createElement('svg',{'data-icon':String(name)});}});
  const module={exports:{}};
  const context={module,exports:module.exports,FileReader:services.FileReader,Blob,URL,Error,crypto:globalThis.crypto,console,setTimeout,clearTimeout,require:path=>path==='react'?react:path==='@tabler/icons-react'?icons:path==='../discoveryModel.js'?discovery:path==='./workspaceModel.js'?model:path==='./attachmentPreview.js'?attachments:path==='./webCapture.js'?{captureWebPage:services.captureWebPage||(()=>{throw Error('Unexpected web request');})}:path==='./AttachmentPreview.jsx'?{default:()=>null}:path.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+path);})()};
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

test('editing a Vault file saves a navigable source relation without copying a local path',async()=>{
 const item={id:'vault-note',path:'assets/note.md',title:'Synthetic PDF note',body:'Source note body',type:'file',originalPath:'assets/originals/synthetic.pdf',originalMime:'application/pdf'};
 const {store,one}=await setup(),ui=workspaceUI(one,{hash:'#/add/edit:assets/note.md',items:[item]});
 assert.equal(ui.editor().card.origin,'vault');assert.equal(ui.editor().card.originalPath,item.originalPath);
 let payload;const form=editor('CardEditor',{...ui.editor(),onSave:async value=>payload=value});
 const body=form.find(node=>node.props?.label==='卡片正文');body.props.onChange('Edited source note body');form.render();await button(form,'保存').props.onClick();
 await ui.editor().onSave(payload);
 const saved=(await store.load()).cards.find(c=>c.body==='Edited source note body');
 assert.ok(saved);assert.equal(saved.origin,'local');assert.equal(saved.attachment,null);assert.equal(saved.sourceCardId,item.path);assert.equal(saved.originalPath,undefined);
 ui.refresh();const sourceButton=ui.find(node=>node.type==='button'&&text(node).startsWith('查看来源文件'));assert.ok(sourceButton);sourceButton.props.onClick();ui.refresh();assert.equal(text(ui.find(node=>node.props?.className==='sw-addedby sw-origin')),'梦藏资料');
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
 const ui=workspaceUI(one,{hash:'#/library',realNavigation:true});ui.find(node=>node.props?.label==='分享 card').props.onClick();ui.render();
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
const backupPicker=ui=>ui.find(node=>node.type==='input'&&node.props.type==='file'&&node.props.accept==='.json,application/json');
const restoreModal=ui=>ui.find(node=>node.props?.title==='导入备份');

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
 if(destination==='route')ui.navigate('import');else{ui.find(node=>node.props?.label==='分享 card').props.onClick();ui.render();}
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
 restoreModal(ui).props.onClose();ui.render();ui.find(node=>node.props?.label==='分享 card').props.onClick();ui.render();release();await pending;ui.refresh();
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
 ui.find(node=>node.props?.label==='分享 card').props.onClick();ui.render();ui.find(node=>node.props?.title==='分享离线卡片').props.onClose();ui.render();
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
 ui.render({items});assert.ok(ui.find(node=>node.props?.['aria-label']==='打开 UNIQUE-LARGE-LIBRARY'));assert.ok(ui.find(node=>node.props?.['aria-label']==='已保存 UNIQUE-LARGE-LIBRARY'));assert.deepEqual(await store.load(),before);
});

test('native membership updates when distinct source ID arrays have the same joined text',async()=>{
 const {one}=await setup(),items=ids=>ids.map(path=>({path,title:path,body:'Native source body'})),ui=workspaceUI(one,{hash:'#/library',items:items(['a|b','c'])});
 assert.ok(ui.find(node=>node.props?.['aria-label']==='已保存 a|b'));
 ui.render({items:items(['a','b|c'])});assert.ok(ui.find(node=>node.props?.['aria-label']==='已保存 a'));assert.ok(ui.find(node=>node.props?.['aria-label']==='已保存 b|c'));assert.equal(ui.find(node=>node.props?.['aria-label']==='打开 a|b'),null);
});

test('memoized native membership reflects saved hidden and favorite array replacements',async()=>{
 const {one}=await setup(),item={path:'native',title:'Native title',body:'Native body'},ui=workspaceUI(one,{hash:'#/library',items:[item]});assert.ok(ui.find(node=>node.props?.['aria-label']==='已保存 Native title'));
 await one.commit([{type:'card.favorite',id:'native',value:true},{type:'card.hide',id:'native',hidden:true}]);ui.refresh();assert.equal(ui.find(node=>node.props?.['aria-label']==='打开 Native title'),null);
 ui.navigate('trash');assert.ok(ui.find(node=>node.props?.['aria-label']==='打开 Native title'));assert.ok(ui.find(node=>node.props?.className==='sw-favorite-mark'));
 await one.commit({type:'card.hide',id:'native',hidden:false});ui.refresh();ui.navigate('library');assert.ok(ui.find(node=>node.props?.['aria-label']==='已保存 Native title'));
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
