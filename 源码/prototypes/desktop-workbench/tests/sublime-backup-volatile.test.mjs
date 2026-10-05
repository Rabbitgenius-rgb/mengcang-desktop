import * as podcast from '../src/sublime/podcastClips.js';
import * as attachmentPreview from '../src/sublime/attachmentPreview.js';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import * as deepseekSettings from '../src/sublime/deepseekSettings.js';
import * as rendererQuit from '../src/sublime/rendererQuit.js';
import * as podcastTranscription from '../src/sublime/podcastTranscription.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as model from '../src/sublime/workspaceModel.js';
import * as view from '../src/sublime/workspaceView.js';
import * as discovery from '../src/discoveryModel.js';
import * as desktop from '../src/desktopModel.js';
import * as intelligence from '../src/sublime/intelligenceHelpers.js';
import * as intelligenceDrafts from '../src/sublime/intelligenceDrafts.js';

const compiledPanel=(await transform(await readFile(new URL('../src/sublime/IntelligencePanel.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const compiledPodcast=(await transform(await readFile(new URL('../src/sublime/PodcastClips.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const status={settings:{nativeEnabled:false,generationEnabled:false,provider:'api',endpoint:'https://example.invalid/v1',model:''},usage:{nativeRequests:0,generationRequests:0,cloudRequests:0}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Isolated IndexedDB interface fixture: transactions serialize across every
// connection, get/put dispatch request events, and abort discards all writes.
// Production createWorkspaceStore uses these transactions directly, not a
// replacement session/store implementation. No browser profile is touched.
function indexedFixture(initial=new Map()){
 const data=new Map([...initial].map(([key,value])=>[key,structuredClone(value)])),trace=[];let tail=Promise.resolve(),failPut=false,holdNext=null;
 const db={transaction(name,mode){
  assert.equal(name,'workspaces');const hold=holdNext?.mode===mode?holdNext:null;if(hold)holdNext=null;const done={};done.promise=new Promise(resolve=>done.resolve=resolve);const previous=tail;tail=done.promise;
  const operations=[],writes=[];let ended=false,error;
  const tx={error:null,objectStore(storeName){assert.equal(storeName,name);return {
   get(key){const request={};operations.push(()=>{trace.push({mode,kind:'get',key});request.result=structuredClone(data.get(key));request.onsuccess?.();});return request;},
   put(value,key){assert.equal(mode,'readwrite');if(failPut){failPut=false;throw Error('合成磁盘写入失败');}writes.push([key,structuredClone(value)]);trace.push({mode,kind:'put',key});return {};},
  };},abort(){if(ended)return;ended=true;queueMicrotask(()=>{tx.onabort?.();done.resolve();});}};
  previous.then(async()=>{await tick();if(ended)return;for(const operation of operations){if(ended)break;try{operation();}catch(value){error=value;tx.error=value;tx.abort();}}
   if(!ended&&hold){hold.entered();await hold.wait;}
   await tick();if(ended)return;ended=true;if(error){tx.onerror?.();}else{for(const [key,value] of writes)data.set(key,value);tx.oncomplete?.();}done.resolve();
  });return tx;
 }};return {data,trace,db,failNextPut:()=>{failPut=true;},holdNextTransaction(mode){assert.equal(holdNext,null);let entered,release;const reached=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);holdNext={mode,entered,wait};return {reached,release};}};
}

const compiled=(await transform(await readFile(new URL('../src/sublime/SublimeWorkspace.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const wav=Buffer.from('RIFF\0\0\0\0WAVEsynthetic');
const card={id:'local-audio',path:'local-audio',origin:'local',title:'原音频',body:' 原文\r\n第二行 café 🧪 ',caption:'本机笔记',sourceUrl:'https://example.test/listening',sourceTitle:'出处',type:'audio',attachment:{name:'sound.wav',type:'audio/wav',size:wav.length,dataUrl:`data:audio/wav;base64,${wav.toString('base64')}`}};

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
const imageCard={...card,type:'image',attachment:{name:'synthetic.png',type:'image/png',size:png.length,dataUrl:`data:image/png;base64,${png.toString('base64')}`}};

function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}

// Compile the real Workspace and IntelligencePanel and invoke their UI handlers.
// The real session, store, reducers, validators and serializer run unchanged over
// isolated transactions; only React effects, IPC and download dispatch are fixtures.
// No browser profile, native process, network service or user data is touched.
async function workspace({cards=[structuredClone(card)],items=[],hash='#/library',identityId='test-vault-modal',initialState,captureSource=intelligenceDrafts.captureAiSource}={}){
 let state=initialState?structuredClone(initialState):{...model.createWorkspaceState(),cards:structuredClone(cards),savedIds:cards.map(item=>item.id)};
 const slots=[],refs=[],effects=[];let stateCursor=0,refCursor=0,tree;
 const identity={id:identityId};
 const fixture=indexedFixture(new Map([[identity.id,state]])),realSessions=new Map(),storeIdentity=new WeakMap(),downloads=[];
 const createStore=id=>{const store=createWorkspaceStore(id,{openDatabase:async()=>fixture.db,createChannel:()=>null,eventTarget:null});storeIdentity.set(store,id);return store;};
 const createSession=store=>{const id=storeIdentity.get(store);if(!realSessions.has(id))realSessions.set(id,createWorkspaceSession(store,{sessionId:'audit-'+id}));return realSessions.get(id);};
 const session=createSession(createStore(identity.id));state=await session.load();

 const react={Fragment:Symbol('fragment'),memo:value=>value,createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:fn=>effects.push(fn),useLayoutEffect:()=>{},useMemo:factory=>factory(),useRef:initial=>{const index=refCursor++;return refs[index]??(refs[index]={current:index===4?identity.id:initial});},useState:initial=>{const index=stateCursor++;if(!slots[index])slots[index]={value:index===0?state:index===1?true:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
 const icons=new Proxy({},{get:(_,name)=>function Icon(){return react.createElement('svg',{'data-icon':String(name)});}});

 const api={};
 let props={items,identity,api,connected:true};
 const module={exports:{}};
 const history={state:{},replaceState(){},pushState(){}};
 const location={hash,href:'mengcang://app/'};
 const sameRealmModel={...model,previewWorkspaceBackupMerge:(state,backup,context)=>model.previewWorkspaceBackupMerge(structuredClone(state),structuredClone(backup),structuredClone(context)),mergeWorkspaceBackup:(state,backup,context)=>model.mergeWorkspaceBackup(structuredClone(state),structuredClone(backup),structuredClone(context)),workspaceReducer:(state,action)=>model.workspaceReducer(state,structuredClone(action)),selectCards:(cards,state,options,readOnlySavedIds)=>model.selectCards(structuredClone(cards),structuredClone(state),structuredClone(options),structuredClone(readOnlySavedIds))};
 const sameRealmView={...view,selectWorkspaceCards:(cards,state,options)=>view.selectWorkspaceCards(structuredClone(cards),structuredClone(state),structuredClone(options)),cardCapturePayload:(card,options)=>view.cardCapturePayload(structuredClone(card),structuredClone(options))};
 const context={module,exports:module.exports,Error,URL,URLSearchParams,Blob,crypto:globalThis.crypto,structuredClone,console,window:{history,location,matchMedia:()=>({matches:false})},history,location,setTimeout:()=>0,clearTimeout:()=>{},require:specifier=>specifier==='./rendererQuit.js'?rendererQuit:specifier==='react'?react:specifier==='@tabler/icons-react'?icons:specifier==='./podcastTranscription.js'?podcastTranscription:specifier==='./workspaceModel.js'?sameRealmModel:specifier==='./workspaceView.js'?sameRealmView:specifier==='../discoveryModel.js'?discovery:specifier==='../desktopModel.js'?desktop:specifier==='./workspaceStore.js'?{createWorkspaceStore:createStore}:specifier==='./workspacePersistence.js'?{createWorkspaceSession:createSession}:specifier==='./workspaceNavigation.js'?{createWorkspaceNavigation:()=>({open:()=>{}})}:specifier==='./referenceCards.js'?{listeningCard:{id:'unused-reference'}}:specifier==='./SublimeEditors.jsx'?{CardEditor:()=>null,CollectionEditor:()=>null,CanvasEditor:()=>null,ImportEditor:()=>null,SafeRichBody:()=>null}:specifier==='./VaultAttachmentPreview.jsx'?{default:()=>null}:specifier==='./AttachmentPreview.jsx'?{default:()=>null}:['./IntelligencePanel.jsx','./SourceFeeds.jsx','./PodcastClips.jsx'].includes(specifier)?{default:()=>null,PodcastClipPlayback:()=>null}:specifier==='./intelligenceHelpers.js'?intelligence:specifier==='./intelligenceDrafts.js'?{...intelligenceDrafts,compactAiSource:value=>intelligenceDrafts.compactAiSource(structuredClone(value)),captureAiSource:value=>captureSource(structuredClone(value)),normalizeAiRecord:value=>intelligenceDrafts.normalizeAiRecord(structuredClone(value)),insightSaveActions:(state,record,options)=>intelligenceDrafts.insightSaveActions(structuredClone(state),structuredClone(record),structuredClone(options)),listAiRecords:value=>intelligenceDrafts.listAiRecords(structuredClone(value))}:['./externalContext.js','./publishableCollection.js'].includes(specifier)?{}:specifier==='./workspaceDownload.js'?{requestWorkspaceDownload:(text,name)=>{downloads.push({text,name});return {requested:true};}}:specifier.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+specifier);})()};
 vm.runInNewContext(compiled,context);
 function render(patch={}){props={...props,...patch};stateCursor=0;refCursor=0;tree=module.exports.default(props);return tree;}
 const button=label=>find(tree,node=>node.type==='button'&&text(node)===label);
 render();
 return {
  mountQuitGate:()=>effects.find(fn=>fn.toString().includes('prepareQuit'))(),
  failNextWrite:()=>fixture.failNextPut(),holdNextTransaction:mode=>fixture.holdNextTransaction(mode),
  render,button,find:predicate=>find(tree,predicate),text:()=>text(tree),api,
  state:()=>realSessions.get(props.identity.id).state,session:()=>realSessions.get(props.identity.id),downloads:()=>downloads,
  volatile:()=>({ai:[...refs[10].current],podcast:[...refs[12].current]}),active:()=>({ai:[...refs[9].current],podcast:[...refs[11].current]}),
  // Model the completed identity-load effect while preserving window-level refs.
  switchIdentity:async id=>{refs[3].current++;render({identity:{id}});const next=await realSessions.get(id).load();refs[4].current=id;refs[2].current=next;slots[0].value=next;render();},
 };
}


function closeModal(form){form.find(node=>node.props?.title&&node.props?.onClose)?.props.onClose();form.render();}
function openAi(form,mode='The Gist'){form.find(node=>node.props?.label==='AI 解读 '+card.title).props.onClick();form.render();form.button(mode==='OCR'?'图片 / PDF 文字识别':mode==='Classification'?'分类建议':intelligence.INSIGHT_LABELS[mode]).props.onClick();form.render();return form.find(node=>node.props?.mode===mode&&node.props?.onResultDraft).props;}
function openPodcast(form){form.find(node=>node.props?.label==='添加卡片').props.onClick();form.render();form.button('播客片段与字幕').props.onClick();form.render();return form.find(node=>node.props?.transcriptionDrafts&&node.props?.onRecoverTranscription).props;}
const transcript='WEBVTT\n\n00:01.000 --> 00:02.000\n本机合成转录结果';
const podcastSnapshot={sourceId:card.id,attachment:null,title:'测试片段',note:'原备注',sourceUrl:'',start:'00:01',end:'00:02',transcript:'',transcriptName:''};
async function podcastWorkspace({transcriptionError,identityId}={}){
 let release,started;const began=new Promise(resolve=>started=resolve);
 const form=await workspace({identityId,initialState:{...model.createWorkspaceState(),cards:[card],savedIds:[card.id],drafts:{podcastClip:podcastSnapshot}}});
 form.api.intelligenceRequest=async input=>{assert.equal(input.action,'transcribe');assert.deepEqual(input.attachment,card.attachment);started();return new Promise(resolve=>release=()=>resolve(transcriptionError?{ok:false,error:{code:'SYNTHETIC_FAILURE',message:transcriptionError}}:{ok:true,data:{text:transcript,local:true,engine:'synthetic-local'}}));};
 form.render();const props=openPodcast(form),running=props.transcribeAudio(card.attachment,{requestId:crypto.randomUUID(),provider:'local',formSnapshot:podcastSnapshot});await began;
 return {form,props,running,release};
}

function panel(props){
 const slots=[],effects=[];let cursor=0,tree,mounted=true;const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:(fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}},useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{assert.equal(mounted,true,'state changed after unmount');slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
 const sameRealmDrafts={...intelligenceDrafts,captureAiSource:source=>intelligenceDrafts.captureAiSource(structuredClone(source)),normalizeAiRecord:record=>intelligenceDrafts.normalizeAiRecord(structuredClone(record))};
 const module={exports:{}};vm.runInNewContext(compiledPanel,{module,exports:module.exports,Error,URL,crypto:globalThis.crypto,require:specifier=>specifier==='react'?react:specifier==='./intelligenceHelpers.js'?intelligence:specifier==='./deepseekSettings.js'?deepseekSettings:specifier==='./intelligenceDrafts.js'?sameRealmDrafts:specifier==='../desktopModel.js'?{valueOf:desktop.valueOf}:specifier.endsWith('.css')?{}:(()=>{throw Error(specifier);})()});
 function render(next={}){props={...props,...next};cursor=0;return tree=module.exports.default(props);}render();return {render,ready:async()=>{for(let cycle=0;cycle<4;cycle++){for(const effect of effects.splice(0))effect();await new Promise(resolve=>setImmediate(resolve));render();}},unmount:()=>{for(const slot of slots)slot?.cleanup?.();mounted=false;},find:predicate=>find(tree,predicate),button:label=>find(tree,node=>node.type==='button'&&text(node)===label),text:()=>text(tree)};
}
function toolsMenu(form){form.find(node=>node.props?.label==='本机工具').props.onClick();form.render();}
async function backupUi(form){toolsMenu(form);const before=form.downloads().length;await form.button('导出完整备份').props.onClick();form.render();return form.downloads().length>before?model.parseWorkspaceBackup(form.downloads().at(-1).text):null;}
async function unrelatedWrite(form){toolsMenu(form);form.find(node=>node.props?.['aria-label']==='主题').props.onChange({target:{value:'light'}});await form.session().settled();form.render();}
async function quitUi(form){let eventHandler,done;const promise=new Promise(resolve=>done=resolve);form.api.subscribe=handler=>{eventHandler=handler;return()=>{};};form.api.rendererQuitReady=async value=>{done(value);return {ok:true,data:{accepted:true}};};form.render();const dispose=form.mountQuitGate();eventHandler({type:'prepareQuit',quitId:'audit-quit'});const result=await promise;dispose();return result;}
async function generateAi(form,{fail=false,hold=false}={}){
 let release,began;const started=new Promise(resolve=>began=resolve);form.api.intelligenceStatus=async()=>({ok:true,data:status});form.api.intelligenceRequest=async input=>{assert.equal(input.action,'insight');assert.equal(input.mode,'The Gist');began();return new Promise(resolve=>{release=()=>{if(fail)form.failNextWrite();resolve({ok:true,data:{mode:'The Gist',text:'只在内存的合成AI结果'}});};if(!hold)release();});};
 const props=openAi(form),ui=panel(props);await ui.ready();const running=ui.button('准备调用并确认').props.onClick();await started;return {running,release,ui,props};
}

function podcastEditor(props,{component='default',helpers={}}={}){
 const slots=[],blobs=[],revoked=[];let cursor=0,pending=[],changed=false,tree,latestHash;
 const checkedHelpers={...podcast,...helpers,podcastAudioSha256:file=>{latestHash=(helpers.podcastAudioSha256||podcast.podcastAudioSha256)(file);return latestHash;}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:fn=>fn(),
  useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},
  useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(value!==slots[index].value){slots[index].value=value;changed=true;}}];},
  useEffect:(effect,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((item,index)=>item!==previous.deps?.[index])){slots[index]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}}
 };
 const module={exports:{}};
 vm.runInNewContext(compiledPodcast,{module,exports:module.exports,Error,TextEncoder,Number,Blob,crypto:globalThis.crypto,URL:{createObjectURL:blob=>{const url=`blob:synthetic-${blobs.length}`;blobs.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},require:name=>name==='react'?react:name==='./podcastClips.js'?checkedHelpers:name==='./podcastTranscription.js'?podcastTranscription:name==='./workspaceModel.js'?model:name==='./attachmentPreview.js'?attachmentPreview:name==='@tabler/icons-react'?new Proxy({},{get:()=>()=>null}):name.endsWith('.css')?{}:(()=>{throw Error(`Unexpected import ${name}`);})()});
 function render(){let count=0;do{assert.ok(++count<10,'effects settle');changed=false;cursor=0;tree=module.exports[component](props);const effects=pending;pending=[];for(const effect of effects)effect();}while(changed);return tree;}
 return {render,props,blobs,revoked,get tree(){return tree;},ready:async()=>{render();for(;;){const request=latestHash;await request?.catch(()=>{});render();if(latestHash===request)return;}},label:name=>find(tree,node=>node.props?.['aria-label']===name),button:name=>find(tree,node=>node.type==='button'&&text(node)===name),dispose(){for(const slot of slots)slot?.cleanup?.();}};
}


const backupBlocked=/仍有 AI\/转录结果只保留在此窗口，完整备份尚未生成/;
function assertBackupBlocked(form){
 assert.equal(form.downloads().length,0);assert.match(form.text(),backupBlocked);
 assert.equal(form.find(node=>node.props?.title==='导出完整备份'&&node.props?.onClose),null);
 assert.equal(form.find(node=>node.props?.className==='sw-toast'),null);
}

test('AI disk failure blocks a full backup even after unrelated success, and saving its existing result enables backup',async()=>{
 const form=await workspace(),{running,ui}=await generateAi(form,{fail:true});await running;form.render();ui.render();
 const [[,record]]=form.volatile().ai,key=intelligenceDrafts.aiResultKey(record.id);
 assert.equal(record.phase,'complete');assert.equal(form.state().drafts[key].phase,'pending');assert.equal(form.active().ai.length,0);assert.match(ui.text(),/AI 已返回/);
 await assert.rejects(form.session().settled(),/合成磁盘写入失败/);assert.equal(await backupUi(form),null);
 await unrelatedWrite(form);assert.equal(form.find(node=>node.props?.className==='sw-error'),null);
 assert.equal(await backupUi(form),null);assertBackupBlocked(form);
 assert.equal(openAi(form).resultDrafts[0].result.text,record.result.text);assert.equal(form.volatile().ai.length,1);
 const blockedQuit=await quitUi(form);assert.equal(blockedQuit.ok,false);assert.match(blockedQuit.message,/仍有结果未写入磁盘/);
 // Use the real panel save button; this must retain the already-returned text
 // rather than execute generation again merely to recover its failed receipt.
 form.api.intelligenceRequest=async()=>{throw Error('不得重新调用模型');};
 const retry=panel(openAi(form));await retry.ready();await retry.button('另存为解读笔记').props.onClick();form.render();
 assert.equal(form.volatile().ai.length,0);const exported=await backupUi(form);
 assert.equal(exported.drafts[key].phase,'complete');assert.equal(exported.drafts[key].result.text,record.result.text);
 assert.equal(exported.cards.find(value=>value.id===exported.drafts[key].savedCardId).body,record.result.text);
 assert.equal((await quitUi(form)).ok,true);
});

test('transcription disk failure blocks a full backup after unrelated success, and retrying persistence enables backup',async()=>{
 const {form,running,release}=await podcastWorkspace();form.failNextWrite();release();await assert.rejects(running,/合成磁盘写入失败/);form.render();
 const [[,record]]=form.volatile().podcast,key=podcastTranscription.podcastTranscriptionKey(record.id);
 assert.equal(record.phase,'complete');assert.equal(form.state().drafts[key].phase,'pending');assert.equal(form.active().podcast.length,0);
 assert.equal(await backupUi(form),null);await unrelatedWrite(form);assert.equal(await backupUi(form),null);assertBackupBlocked(form);
 closeModal(form);const restored=openPodcast(form);assert.equal(restored.transcriptionDrafts[0].transcript,transcript);assert.equal(restored.isTranscriptionDurable(record),false);
 const podcast=podcastEditor(restored);await podcast.ready();const history=podcast.label('已保留的转录结果');assert.equal(history.props.value,record.id);history.props.onChange({target:{value:record.id}});await podcast.ready();
 assert.equal(podcast.label('转录结果字幕').props.value,transcript);assert.equal(podcast.label('转录结果字幕').props.readOnly,true);assert.ok(podcast.button('重新保存结果草稿'));
 const blockedQuit=await quitUi(form);assert.equal(blockedQuit.ok,false);assert.match(blockedQuit.message,/仍有结果未写入磁盘/);
 form.api.intelligenceRequest=async()=>{throw Error('不得重新转录');};await podcast.button('重新保存结果草稿').props.onClick();form.render();podcast.dispose();
 assert.equal(form.volatile().podcast.length,0);const exported=await backupUi(form);
 assert.equal(exported.drafts[key].phase,'complete');assert.equal(exported.drafts[key].transcript,transcript);assert.equal((await quitUi(form)).ok,true);
});

for(const kind of ['ai','podcast'])test(`${kind} volatile results in another identity do not block this identity backup, but still prevent global quit`,async()=>{
 let form;
 if(kind==='ai'){form=await workspace({identityId:'test-vault-modal:separate'});const {running}=await generateAi(form,{fail:true});await running;}
 else{const job=await podcastWorkspace();form=job.form;form.failNextWrite();job.release();await assert.rejects(job.running,/合成磁盘写入失败/);}
 form.render();await unrelatedWrite(form);assert.equal(form.volatile()[kind].length,1);
 await form.switchIdentity(kind==='ai'?'test-vault-modal':'other-library');const result=await backupUi(form);
 assert.ok(result);assert.deepEqual(result.cards,[]);assert.deepEqual(result.drafts,{});assert.equal(form.volatile()[kind].length,1);
 const quit=await quitUi(form);assert.equal(quit.ok,false);assert.match(quit.message,/仍有结果未写入磁盘/);
});

test('a still-running AI request permits a pending point-in-time backup without waiting for future results',async()=>{
 const form=await workspace(),{running,release}=await generateAi(form,{hold:true});form.render();assert.equal(form.active().ai.length,1);assert.equal(form.volatile().ai.length,0);
 const result=await backupUi(form),records=intelligenceDrafts.listAiRecords(result.drafts);
 assert.equal(records.length,1);assert.equal(records[0].phase,'pending');assert.equal(form.active().ai.length,1);assert.match(form.text(),/备份已生成/);
 release();await running;form.render();const final=await backupUi(form);assert.equal(intelligenceDrafts.listAiRecords(final.drafts)[0].phase,'complete');assert.equal(form.volatile().ai.length,0);
});

test('a still-running transcription permits a pending point-in-time backup without waiting for future results',async()=>{
 const {form,running,release}=await podcastWorkspace();form.render();assert.equal(form.active().podcast.length,1);assert.equal(form.volatile().podcast.length,0);
 const result=await backupUi(form),records=podcastTranscription.listPodcastTranscriptions(result.drafts);
 assert.equal(records.length,1);assert.equal(records[0].phase,'pending');assert.equal(form.active().podcast.length,1);assert.match(form.text(),/备份已生成/);
 release();await running;form.render();const final=await backupUi(form);assert.equal(podcastTranscription.listPodcastTranscriptions(final.drafts)[0].phase,'complete');assert.equal(form.volatile().podcast.length,0);
});

test('backup waits for an already queued successful AI result write, then includes the completed result',async()=>{
 const form=await workspace(),{running,release}=await generateAi(form,{hold:true});
 const writing=form.holdNextTransaction('readwrite');release();await writing.reached;assert.equal(form.volatile().ai.length,1);
 let finished=false;const backup=backupUi(form).then(value=>{finished=true;return value;});await tick();assert.equal(finished,false);assert.equal(form.downloads().length,0);
 writing.release();await running;const result=await backup;
 assert.equal(intelligenceDrafts.listAiRecords(result.drafts)[0].result.text,'只在内存的合成AI结果');assert.equal(form.volatile().ai.length,0);
});

for(const kind of ['ai','podcast'])test(`backup rechecks ${kind} volatile results that arrive while settled is refreshing the snapshot`,async()=>{
 let form,running,release;
 if(kind==='ai'){form=await workspace();({running,release}=await generateAi(form,{hold:true}));}
 else({form,running,release}=await podcastWorkspace());
 const reading=form.holdNextTransaction('readonly'),backup=backupUi(form);await reading.reached;
 assert.equal(form.volatile()[kind].length,0);form.failNextWrite();release();
 // AI stores its result before its final commit, and transcription stores it
 // before its own settled() call. Both arrive while the old snapshot is held.
 for(let i=0;i<20&&!form.volatile()[kind].length;i++)await tick();
 assert.equal(form.volatile()[kind].length,1);reading.release();
 assert.equal(await backup,null);assertBackupBlocked(form);
 if(kind==='podcast')await assert.rejects(running,/合成磁盘写入失败/);else await running;
 assert.equal(form.volatile()[kind].length,1);assert.equal(form.downloads().length,0);
});

async function aiReceipt(form,mode,changes={}){
 const result=mode==='Classification'?{tags:['合成建议'],collectionIds:[],reason:'完整的合成分类理由'}:{text:`完整的 ${mode} 合成结果`};
 return intelligenceDrafts.normalizeAiRecord({id:crypto.randomUUID(),mode,phase:'complete',sourceSnapshot:await intelligenceDrafts.captureAiSource(form.state().cards[0]),result,createdAt:'2026-10-04T12:00:00Z',updatedAt:'2026-10-04T12:00:01Z',savedCardId:'',error:'',...changes});
}
async function retryPanel(form,mode){closeModal(form);const restored=panel(openAi(form,mode));await restored.ready();return restored;}
function rejectNewRequests(form){let calls=0;form.api.intelligenceStatus=async()=>({ok:true,data:status});form.api.intelligenceRequest=async()=>{calls++;throw Error('不得重新执行 AI');};return ()=>calls;}

for(const mode of [...Object.keys(intelligence.INSIGHT_LABELS),'OCR','Classification'])test(`${mode} exposes the returned result and retries its receipt without invoking a model or adopting it`,async()=>{
 const form=await workspace({cards:[imageCard]}),props=openAi(form,mode),record=await aiReceipt(form,mode),count=rejectNewRequests(form);
 await props.onResultDraft({...record,phase:'pending',result:null});form.failNextWrite();await assert.rejects(props.onResultDraft(record),/合成磁盘写入失败/);form.render();
 const cardsBefore=structuredClone(form.state().cards),restored=await retryPanel(form,mode);
 if(mode==='Classification'){assert.match(restored.text(),/完整的合成分类理由/);assert.match(restored.text(),/合成建议/);}
 else{const field=restored.find(node=>node.props?.['aria-label']==='智能工具结果');assert.equal(field.props.value,record.result.text);assert.equal(field.props.readOnly,true);}
 const button=restored.button('重新保存结果草稿');assert.ok(button,'the volatile result needs an explicit persistence retry');assert.equal(button.props.disabled,false);
 // A second failed write must leave the complete content and retry control
 // available; copying/selecting text does not clear the unsaved receipt.
 form.failNextWrite();await button.props.onClick();form.render();restored.render(openAi(form,mode));await restored.ready();
 assert.equal(form.volatile().ai.length,1);assert.match(restored.text(),/合成磁盘写入失败/);assert.ok(restored.button('重新保存结果草稿'));
 await restored.button('重新保存结果草稿').props.onClick();form.render();restored.render(openAi(form,mode));await restored.ready();
 assert.equal(count(),0);assert.deepEqual(form.state().cards,cardsBefore);assert.equal(form.volatile().ai.length,0);assert.equal(restored.button('重新保存结果草稿'),null);
 const exported=await backupUi(form);assert.deepEqual(exported.drafts[intelligenceDrafts.aiResultKey(record.id)].result,record.result);assert.equal(form.find(node=>node.props?.className==='sw-error'),null,'successful backup clears the obsolete failure message');
});

for(const mode of ['OCR','Classification'])test(`${mode} can persist its original receipt after adopting the result changed the source card`,async()=>{
 const form=await workspace({cards:[imageCard]}),props=openAi(form,mode),record=await aiReceipt(form,mode),count=rejectNewRequests(form);
 await props.onResultDraft({...record,phase:'pending',result:null});form.failNextWrite();await assert.rejects(props.onResultDraft(record),/合成磁盘写入失败/);form.render();
 const restored=await retryPanel(form,mode);await restored.button(mode==='OCR'?'保存识别文字':'采用所选建议').props.onClick();form.render();
 assert.equal(form.volatile().ai.length,1);assert.equal(form.state().drafts[intelligenceDrafts.aiResultKey(record.id)].phase,'pending');
 const changed=form.state().cards[0];if(mode==='OCR')assert.equal(changed.ocrText,record.result.text);else assert.deepEqual(changed.tags,record.result.tags);
 restored.render(openAi(form,mode));await restored.ready();assert.ok(restored.button('重新保存结果草稿'));
 await restored.button('重新保存结果草稿').props.onClick();form.render();
 assert.equal(form.volatile().ai.length,0);assert.equal(count(),0);const exported=await backupUi(form);assert.deepEqual(exported.drafts[intelligenceDrafts.aiResultKey(record.id)].sourceSnapshot,record.sourceSnapshot);
});

test('a failed response retains copyable recovery text and can retry only persistence before backup',async()=>{
 const form=await workspace(),props=openAi(form),record=await aiReceipt(form,'The Gist',{phase:'failed',result:null,error:'返回内容需核对',recoveryText:'返回原文\0保留全部内容'}),count=rejectNewRequests(form);
 const {recoveryText,...pending}=record;await props.onResultDraft({...pending,phase:'pending',error:''});form.failNextWrite();await assert.rejects(props.onResultDraft(record),/合成磁盘写入失败/);form.render();
 const restored=await retryPanel(form,'The Gist'),field=restored.find(node=>node.props?.['aria-label']==='待核对的返回原文');
 assert.equal(field.props.value,record.recoveryText);assert.equal(field.props.readOnly,true);assert.equal(restored.button('另存为解读笔记'),null);
 assert.ok(restored.button('重新保存结果草稿'));await restored.button('重新保存结果草稿').props.onClick();form.render();
 assert.equal(count(),0);assert.equal(form.volatile().ai.length,0);const exported=await backupUi(form);assert.equal(exported.drafts[intelligenceDrafts.aiResultKey(record.id)].recoveryText,record.recoveryText);
});

test('a failed newer receipt with the same complete phase is not reported durable and still exposes persistence retry',async()=>{
 const form=await workspace(),props=openAi(form),prior=await aiReceipt(form,'The Gist'),count=rejectNewRequests(form);await props.onResultDraft(prior);
 const newer={...prior,result:{text:'较新的完整结果'},updatedAt:'2026-10-04T12:00:02Z'};form.failNextWrite();await assert.rejects(props.onResultDraft(newer),/合成磁盘写入失败/);form.render();
 const reopened=openAi(form);assert.equal(reopened.isResultDurable(prior.id,'complete'),false);
 const restored=panel(reopened);await restored.ready();assert.equal(restored.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,newer.result.text);
 assert.equal(restored.text().includes('结果已保存在本机草稿'),false);assert.ok(restored.button('重新保存结果草稿'));
 await restored.button('重新保存结果草稿').props.onClick();form.render();assert.equal(form.volatile().ai.length,0);assert.equal(count(),0);
 const exported=await backupUi(form);assert.equal(exported.drafts[intelligenceDrafts.aiResultKey(prior.id)].result.text,newer.result.text);
});

test('an initial pending receipt that failed before any request can be preserved without starting a request',async()=>{
 const form=await workspace(),props=openAi(form),record=await aiReceipt(form,'The Gist',{phase:'pending',result:null}),count=rejectNewRequests(form);
 form.failNextWrite();await assert.rejects(props.onResultDraft(record),/合成磁盘写入失败/);form.render();
 const restored=await retryPanel(form,'The Gist');assert.ok(restored.button('重新保存结果草稿'));
 await restored.button('重新保存结果草稿').props.onClick();form.render();assert.equal(form.volatile().ai.length,0);assert.equal(count(),0);
 assert.equal((await backupUi(form)).drafts[intelligenceDrafts.aiResultKey(record.id)].phase,'pending');
});


for(const kind of ['ai','podcast'])test(`${kind} result lists use exact identity ownership before offering a persistence retry`,async()=>{
 // Exercise the component's arbitrary identity contract; default native IDs
 // normally do not contain this delimiter. No user library is involved.
 const original='test-vault-modal:separate',other='test-vault-modal';let form,record;
 if(kind==='ai'){form=await workspace({identityId:original});const {running}=await generateAi(form,{fail:true});await running;record=form.volatile().ai[0][1];}
 else{const job=await podcastWorkspace({identityId:original});form=job.form;form.failNextWrite();job.release();await assert.rejects(job.running,/合成磁盘写入失败/);record=form.volatile().podcast[0][1];}
 form.render();await unrelatedWrite(form);closeModal(form);await form.switchIdentity(other);
 if(kind==='ai'){
  toolsMenu(form);form.button('AI 连接与用量').props.onClick();form.render();const props=form.find(node=>node.props?.mode==='Settings'&&node.props?.onResultDraft).props;assert.deepEqual(props.resultDrafts,[]);
  const ui=panel(props);await ui.ready();await ui.button('核心概述').props.onClick();await ui.ready();assert.equal(ui.button('重新保存结果草稿'),null);ui.unmount();
 }else assert.deepEqual(openPodcast(form).transcriptionDrafts,[]);
 assert.deepEqual((await backupUi(form)).drafts,{});assert.equal(form.volatile()[kind].length,1);assert.equal((await quitUi(form)).ok,false);
 closeModal(form);await form.switchIdentity(original);const records=kind==='ai'?openAi(form).resultDrafts:openPodcast(form).transcriptionDrafts;assert.ok(records.some(value=>value.id===record.id));
});

for(const rejectRead of [false,true])test(`backup file ${rejectRead?'failure':'completion'} after an identity change cannot enter the new workspace`,async()=>{
 const form=await workspace();let release,reject;
 const input=form.find(node=>node.type==='input'&&node.props.type==='file'&&node.props.accept==='.json,application/json');
 const pending=input.props.onChange({target:{value:'old-library.json',files:[{name:'old-library.json',size:1000,text:()=>new Promise((resolve,fail)=>{release=resolve;reject=fail;})}]}});
 await form.switchIdentity('new-empty-library');
 if(rejectRead)reject(Error('OLD LIBRARY FILE FAILED'));else release(model.serializeWorkspace({...model.createWorkspaceState(),cards:[{id:'old-import',title:'Old import',body:'OLD CONTENT'}]}));
 await pending;form.render();assert.equal(form.find(node=>node.props?.title==='导入备份'),null);assert.equal(form.find(node=>node.props?.className==='sw-error'),null);assert.deepEqual(form.state().cards,[]);
});

test('a backup merge completed in the old identity does not report its switch notice as a new-library error',async()=>{
 const form=await workspace(),input=form.find(node=>node.type==='input'&&node.props.type==='file'&&node.props.accept==='.json,application/json');
 const backup=model.serializeWorkspace({...model.createWorkspaceState(),cards:[{id:'old-import',title:'Old import',body:'OLD CONTENT'}]});
 await input.props.onChange({target:{value:'old-library.json',files:[{name:'old-library.json',size:backup.length,text:async()=>backup}]}});form.render();
 const original=form.session(),hold=form.holdNextTransaction('readwrite'),saving=form.button('合并备份').props.onClick();await hold.reached;
 const switching=form.switchIdentity('new-empty-library');hold.release();await saving;await switching;form.render();
 assert.ok(original.state.cards.some(card=>card.id==='old-import'));assert.deepEqual(form.state().cards,[]);assert.equal(form.find(node=>node.props?.className==='sw-error'),null);
});


test('an excerpt hashing across a library switch never writes old quotation data into the new identity',async()=>{
 const pdfBytes=Buffer.from('%PDF-1.7 synthetic'),source={id:'source-document',title:'Source',type:'file',attachment:{name:'first.pdf',type:'application/pdf',size:pdfBytes.length,dataUrl:'data:application/pdf;base64,'+pdfBytes.toString('base64')}};
 let started,release;const began=new Promise(resolve=>started=resolve);
 const form=await workspace({cards:[source],hash:'#/card/source-document',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);started();await new Promise(resolve=>release=resolve);return value;}}),original=form.session();
 const saving=form.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'ORIGINAL LIBRARY QUOTE',page:2,rects:[]});const rejected=assert.rejects(saving,/资料库已切换/);await began;await form.switchIdentity('new-empty-library');release();await rejected;form.render();
 assert.deepEqual(form.state().cards,[]);assert.equal(original.state.cards.some(card=>card.body==='ORIGINAL LIBRARY QUOTE'),false);assert.equal(form.find(node=>node.props?.className==='sw-error'),null);
});

for(const failHash of [false,true])test(`quit waits for an excerpt digest and ${failHash?'reports its failure':'its resulting card transaction'}`,async()=>{
 const bytes=Buffer.from('%PDF-1.7 synthetic'),source={id:'source-document',title:'Source',type:'file',attachment:{name:'first.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')}};
 let started,release,ack;const began=new Promise(resolve=>started=resolve);
 const form=await workspace({cards:[source],hash:'#/card/source-document',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);started();await new Promise(resolve=>release=resolve);if(failHash)throw Error('SYNTHETIC DIGEST FAILED');return value;}});
 const saving=form.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'QUIT MUST WAIT FOR THIS QUOTE',page:2,rects:[]});const finished=failHash?assert.rejects(saving,/SYNTHETIC DIGEST FAILED/):saving;await began;
 const quitting=quitUi(form).then(value=>{ack=value;return value;});
 try{await new Promise(resolve=>setTimeout(resolve,30));assert.equal(ack,undefined,'do not acknowledge quit while the requested excerpt has not reached storage');}finally{release();}
 await finished;const result=await quitting;assert.equal(result.ok,!failHash);assert.equal(form.state().cards.some(card=>card.body==='QUIT MUST WAIT FOR THIS QUOTE'),!failHash);if(failHash)assert.match(result.message,/SYNTHETIC DIGEST FAILED/);
});

for(const switchLibrary of [false,true])test(`complete backup ${switchLibrary?'does not wait for another library excerpt':'waits for its own excerpt save before serializing'}`,async()=>{
 const bytes=Buffer.from('%PDF-1.7 synthetic'),source={id:'source-document',title:'Source',type:'file',attachment:{name:'first.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')}};
 let started,release,exported;const began=new Promise(resolve=>started=resolve);
 const form=await workspace({cards:[source],hash:'#/card/source-document',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);started();await new Promise(resolve=>release=resolve);return value;}});
 const saving=form.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt({text:'EXCERPT IN COMPLETE BACKUP',page:2,rects:[]});const finished=switchLibrary?assert.rejects(saving,/资料库已切换/):saving;await began;
 if(switchLibrary)await form.switchIdentity('separate-backup-library');
 const backup=backupUi(form).then(value=>{exported=value;return value;});
 try{await new Promise(resolve=>setTimeout(resolve,20));if(switchLibrary){assert.ok(exported);assert.deepEqual(exported.cards,[]);}else assert.equal(exported,undefined);}finally{release();}
 await finished;const snapshot=await backup;if(!switchLibrary)assert.ok(snapshot.cards.some(card=>card.body==='EXCERPT IN COMPLETE BACKUP'&&card.sourceAttachmentSha256));
});

test('backup retains the failure of a later excerpt even after an earlier excerpt succeeds',async()=>{
 const bytes=Buffer.from('%PDF-1.7 synthetic'),source={id:'source-document',title:'Source',type:'file',attachment:{name:'first.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')}};
 let calls=0,started,release;const began=new Promise(resolve=>started=resolve);
 const form=await workspace({cards:[source],hash:'#/card/source-document',captureSource:async source=>{const value=await intelligenceDrafts.captureAiSource(source);if(++calls===1){started();await new Promise(resolve=>release=resolve);return value;}throw Error('LATER EXCERPT FAILED');}});
 const save=form.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt,first=save({text:'FIRST EXCERPT SAVED',page:1,rects:[]});await began;const exporting=backupUi(form);await tick();
 try{await assert.rejects(save({text:'LATER EXCERPT NOT SAVED',page:2,rects:[]}),/LATER EXCERPT FAILED/);}finally{release();}
 await first;assert.equal(await exporting,null);form.render();assert.ok(form.state().cards.some(card=>card.body==='FIRST EXCERPT SAVED'));assert.equal(form.state().cards.some(card=>card.body==='LATER EXCERPT NOT SAVED'),false);assert.match(form.text(),/LATER EXCERPT FAILED/);
});

test('backup also observes excerpt failures that begin during its final storage snapshot',async()=>{
 const bytes=Buffer.from('%PDF-1.7 synthetic'),source={id:'source-document',title:'Source',type:'file',attachment:{name:'first.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')}};
 const form=await workspace({cards:[source],hash:'#/card/source-document',captureSource:async()=>{throw Error('SNAPSHOT STAGE EXCERPT FAILED');}}),save=form.find(node=>typeof node.props?.onExcerpt==='function').props.onExcerpt;
 const hold=form.holdNextTransaction('readonly'),exporting=backupUi(form);await hold.reached;
 try{await assert.rejects(save({text:'NOT IN SNAPSHOT',page:2,rects:[]}),/SNAPSHOT STAGE EXCERPT FAILED/);}finally{hold.release();}
 assert.equal(await exporting,null);form.render();assert.match(form.text(),/SNAPSHOT STAGE EXCERPT FAILED/);assert.equal(form.state().cards.some(card=>card.body==='NOT IN SNAPSHOT'),false);
});
