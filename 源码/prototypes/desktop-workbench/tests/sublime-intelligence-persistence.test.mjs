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

const compiled=(await transform(await readFile(new URL('../src/sublime/SublimeWorkspace.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const offlineMessage='连接已断开，重新连接后可再次保存；卡片、笔记和原文件仍在本机。';
const compatibilityMessage='当前连接器尚不支持原文件入库；需要更新连接器。';
const wav=Buffer.from('RIFF\0\0\0\0WAVEsynthetic');
const card={id:'local-audio',path:'local-audio',origin:'local',title:'原音频',body:' 原文\r\n第二行 café 🧪 ',caption:'本机笔记',sourceUrl:'https://example.test/listening',sourceTitle:'出处',type:'audio',attachment:{name:'sound.wav',type:'audio/wav',size:wav.length,dataUrl:`data:audio/wav;base64,${wav.toString('base64')}`}};

function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}

// Compile the real component and exercise its actual menu, checkbox and submit
// handlers. Hook state persists while connection props change. Storage and IPC
// are observed in-memory; no browser, IndexedDB, network or Vault is touched.
function workspace({cards=[structuredClone(card)],items=[],hash='#/library',openCapture=true,initialState}={}){
 let state=initialState?structuredClone(initialState):{...model.createWorkspaceState(),cards:structuredClone(cards),savedIds:cards.map(item=>item.id)};
 const slots=[],refs=[],effects=[];let stateCursor=0,refCursor=0,tree,commits=0,captures=[],navigations=[],failWrite=false;
 const identity={id:'test-vault-modal'};
 const react={Fragment:Symbol('fragment'),memo:value=>value,createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:fn=>effects.push(fn),useLayoutEffect:()=>{},useMemo:factory=>factory(),useRef:initial=>{const index=refCursor++;return refs[index]??(refs[index]={current:index===4?identity.id:initial});},useState:initial=>{const index=stateCursor++;if(!slots[index])slots[index]={value:index===0?state:index===1?true:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
 const icons=new Proxy({},{get:(_,name)=>function Icon(){return react.createElement('svg',{'data-icon':String(name)});}});
 const session={writing:0,drafts:()=>state.drafts,settled:async()=>state,recoverableDrafts:()=>[],commit:async action=>{commits++;if(failWrite){failWrite=false;throw Error('合成磁盘写入失败');}state=typeof action==='function'?action(state):model.workspaceReducer(state,structuredClone(action));return state;}};
 const api={captureAvailable:true,captureAttachmentAvailable:true,capture:async payload=>{captures.push(structuredClone(payload));return {ok:true,data:{note:{path:'01_sources/cards/text/synthetic.md'}}};}};
 let props={items,identity,api,connected:true};
 const module={exports:{}};
 const history={state:{},replaceState(){},pushState(){}};
 const location={hash,href:'mengcang://app/'};
 const sameRealmModel={...model,workspaceReducer:(state,action)=>model.workspaceReducer(state,structuredClone(action)),selectCards:(cards,state,options)=>model.selectCards(structuredClone(cards),structuredClone(state),structuredClone(options))};
 const sameRealmView={...view,selectWorkspaceCards:(cards,state,options)=>view.selectWorkspaceCards(structuredClone(cards),structuredClone(state),structuredClone(options)),cardCapturePayload:(card,options)=>view.cardCapturePayload(structuredClone(card),structuredClone(options))};
 const context={module,exports:module.exports,Error,URL,URLSearchParams,Blob,crypto:globalThis.crypto,structuredClone,console,window:{history,location,matchMedia:()=>({matches:false})},history,location,setTimeout:()=>0,clearTimeout:()=>{},require:specifier=>specifier==='react'?react:specifier==='@tabler/icons-react'?icons:specifier==='./podcastTranscription.js'?podcastTranscription:specifier==='./workspaceModel.js'?sameRealmModel:specifier==='./workspaceView.js'?sameRealmView:specifier==='../discoveryModel.js'?discovery:specifier==='../desktopModel.js'?desktop:specifier==='./workspaceStore.js'?{createWorkspaceStore:()=>({})}:specifier==='./workspacePersistence.js'?{createWorkspaceSession:()=>session}:specifier==='./workspaceNavigation.js'?{createWorkspaceNavigation:()=>({open:(...args)=>navigations.push(structuredClone(args))})}:specifier==='./referenceCards.js'?{listeningCard:{id:'unused-reference'}}:specifier==='./SublimeEditors.jsx'?{CardEditor:()=>null,CollectionEditor:()=>null,CanvasEditor:()=>null,ImportEditor:()=>null,SafeRichBody:()=>null}:specifier==='./VaultAttachmentPreview.jsx'?{default:()=>null}:specifier==='./AttachmentPreview.jsx'?{default:()=>null}:['./IntelligencePanel.jsx','./SourceFeeds.jsx','./PodcastClips.jsx'].includes(specifier)?{default:()=>null,PodcastClipPlayback:()=>null}:specifier==='./intelligenceHelpers.js'?intelligence:specifier==='./intelligenceDrafts.js'?{...intelligenceDrafts,compactAiSource:value=>intelligenceDrafts.compactAiSource(structuredClone(value)),captureAiSource:value=>intelligenceDrafts.captureAiSource(structuredClone(value)),normalizeAiRecord:value=>intelligenceDrafts.normalizeAiRecord(structuredClone(value)),insightSaveActions:(state,record,options)=>intelligenceDrafts.insightSaveActions(structuredClone(state),structuredClone(record),structuredClone(options)),listAiRecords:value=>intelligenceDrafts.listAiRecords(structuredClone(value))}:['./externalContext.js','./publishableCollection.js'].includes(specifier)?{}:specifier==='./workspaceDownload.js'?{requestWorkspaceDownload:()=>{throw Error('Unexpected download');}}:specifier.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+specifier);})()};
 vm.runInNewContext(compiled,context);
 function render(patch={}){props={...props,...patch};stateCursor=0;refCursor=0;tree=module.exports.default(props);return tree;}
 const button=label=>find(tree,node=>node.type==='button'&&text(node)===label);
 render();
 if(openCapture){find(tree,node=>node.props?.label==='更多 '+card.title).props.onClick();render();
 button('存入梦藏仓库').props.onClick();render();}
 return {mountQuitGate:()=>effects.find(fn=>fn.toString().includes('prepareQuit'))(),replaceDraft:value=>{state=model.workspaceReducer(state,{type:'draft.set',key:'podcastClip',value});refs[2].current=state;slots[0].value=state;},showOtherIdentity:()=>{refs[4].current='other-library';refs[3].current++;slots[0].value=model.createWorkspaceState();},visibleState:()=>slots[0].value,switchWorkspace:()=>{refs[3].current++;},updateCard:value=>{state=model.workspaceReducer(state,{type:"card.upsert",card:value});refs[2].current=state;slots[0].value=state;},failNextWrite:()=>{failWrite=true;},render,button,find:predicate=>find(tree,predicate),text:()=>text(tree),checkbox:()=>find(tree,node=>node.type==='input'&&node.props?.type==='checkbox'),api,state:()=>state,captures:()=>captures,commits:()=>commits,navigations:()=>navigations};
}


const aiRecord=(id='11111111-1111-4111-8111-111111111111')=>({id,mode:'The Gist',phase:'complete',sourceSnapshot:intelligenceDrafts.compactAiSource(card),result:{text:'本机模拟解读：原文保留。'},createdAt:'2026-10-04T12:00:00Z',updatedAt:'2026-10-04T12:00:01Z',savedCardId:'',error:''});
function openAi(form){form.find(node=>node.props?.label==='AI 解读 '+card.title).props.onClick();form.render();form.button('核心概述').props.onClick();form.render();return form.find(node=>node.props?.mode==='The Gist'&&node.props?.onResultDraft).props;}
function closeAi(form){form.find(node=>node.props?.title==='核心概述'&&node.props?.onClose).props.onClose();form.render();}
function openPodcast(form){form.find(node=>node.props?.label==='添加卡片').props.onClick();form.render();form.button('播客片段与字幕').props.onClick();form.render();return form.find(node=>node.props?.transcriptionDrafts&&node.props?.onRecoverTranscription).props;}
const transcript='WEBVTT\n\n00:01.000 --> 00:02.000\n本机合成转录结果';
const podcastSnapshot={sourceId:card.id,attachment:null,title:'测试片段',note:'原备注',sourceUrl:'',start:'00:01',end:'00:02',transcript:'',transcriptName:''};
async function podcastWorkspace({transcriptionError}={}){
 let release,started;const began=new Promise(resolve=>started=resolve);
 const form=workspace({openCapture:false,initialState:{...model.createWorkspaceState(),cards:[card],savedIds:[card.id],drafts:{podcastClip:podcastSnapshot}}});
 form.api.intelligenceRequest=async input=>{assert.equal(input.action,'transcribe');assert.deepEqual(input.attachment,card.attachment);started();return new Promise(resolve=>release=()=>resolve(transcriptionError?{ok:false,error:{code:'SYNTHETIC_FAILURE',message:transcriptionError}}:{ok:true,data:{text:transcript,local:true,engine:'synthetic-local'}}));};
 form.render();const props=openPodcast(form),running=props.transcribeAudio(card.attachment,{requestId:crypto.randomUUID(),provider:'local',formSnapshot:podcastSnapshot});await began;
 return {form,props,running,release};
}

test('a response finishing after dialog close is retained and restored after a new workspace mount',async()=>{
 const form=workspace({openCapture:false}),props=openAi(form),record=aiRecord();
 await props.onResultDraft({...record,phase:'pending',result:null});props.registerRequest(record.id,true);closeAi(form);
 assert.equal(form.find(node=>node.props?.onResultDraft),null);
 const reopened=openAi(form);assert.equal(reopened.requestIsActive(record.id),true);assert.equal(reopened.resultDrafts.length,1);closeAi(form);
 await props.onResultDraft(record);props.registerRequest(record.id,false);form.render();
 assert.equal(form.state().drafts[intelligenceDrafts.aiResultKey(record.id)].result.text,record.result.text);
 const restarted=workspace({openCapture:false,initialState:form.state()});const recovered=openAi(restarted);
 assert.equal(recovered.resultDrafts.length,1);assert.equal(recovered.resultDrafts[0].result.text,record.result.text);assert.equal(recovered.requestIsActive(record.id),false);
 assert.equal(restarted.captures().length,0);assert.equal(restarted.commits(),0);
});

test('the same saved result is one note and a stale receipt update cannot erase its saved identity',async()=>{
 const form=workspace({openCapture:false}),props=openAi(form),record=aiRecord();await props.onResultDraft(record);
 const first=await props.onSaveInsight(record.sourceSnapshot,record.mode,record.result,record);
 const second=await props.onSaveInsight(record.sourceSnapshot,record.mode,record.result,record);
 assert.equal(first,second);assert.equal(form.state().cards.filter(x=>x.id===first).length,1);
 await props.onResultDraft({...record,savedCardId:''});form.render();
 const stored=form.state().drafts[intelligenceDrafts.aiResultKey(record.id)];assert.equal(stored.savedCardId,first);
 assert.equal(openAi(form).resultDrafts.find(x=>x.id===record.id).savedCardId,first);
 assert.equal(form.captures().length,0);
});

test('late failure or pending writes cannot replace a durably completed response',async()=>{
 const form=workspace({openCapture:false}),props=openAi(form),record=aiRecord();await props.onResultDraft(record);
 await props.onResultDraft({...record,phase:'failed',result:null,error:'旧异步状态'});
 await props.onResultDraft({...record,phase:'pending',result:null});
 const stored=form.state().drafts[intelligenceDrafts.aiResultKey(record.id)];assert.equal(stored.phase,'complete');assert.equal(stored.result.text,record.result.text);assert.equal(stored.error,'');
});


test('a local persistence failure keeps the completed result in the live workspace and explicitly reports it',async()=>{
 const form=workspace({openCapture:false}),props=openAi(form),record=aiRecord();form.failNextWrite();
 await assert.rejects(props.onResultDraft(record),/合成磁盘写入失败/);form.render();
 assert.ok(form.text().includes('AI 结果暂未保存到磁盘'));
 closeAi(form);const restored=openAi(form);
 assert.equal(restored.resultDrafts.length,1);assert.equal(restored.resultDrafts[0].result.text,record.result.text);
 const id=await restored.onSaveInsight(record.sourceSnapshot,record.mode,record.result,record);form.render();
 assert.equal(form.state().cards.find(x=>x.id===id).body,record.result.text);
 assert.equal(form.state().drafts[intelligenceDrafts.aiResultKey(record.id)].savedCardId,id);
});

test('a live attachment replaced with identical metadata and timestamp rejects old classification while the insight remains savable as text',async()=>{
 const original={...structuredClone(card),updatedAt:'2026-10-04T12:00:00Z',tags:['原标签']};
 const form=workspace({cards:[original],openCapture:false}),props=openAi(form);
 const record={...aiRecord(),sourceSnapshot:await intelligenceDrafts.captureAiSource(original)};
 await props.onResultDraft(record);
 const changedBytes=Buffer.from(wav);changedBytes[changedBytes.length-1]^=1;
 const changedAttachment={...original.attachment,dataUrl:`data:audio/wav;base64,${changedBytes.toString('base64')}`};
 form.updateCard({id:original.id,attachment:changedAttachment});
 const before=structuredClone(form.state()),beforeCommits=form.commits();
 assert.equal(before.cards[0].updatedAt,original.updatedAt);
 assert.equal(before.cards[0].attachment.size,original.attachment.size);
 await assert.rejects(props.onApplyClassification(original,{tags:['不应采用的旧建议'],collectionIds:[]}),/原素材或附件已变化/);
 assert.equal(form.commits(),beforeCommits);assert.deepEqual(form.state(),before);
 const savedId=await props.onSaveInsight(record.sourceSnapshot,record.mode,record.result,record);
 const saved=form.state().cards.find(item=>item.id===savedId);
 assert.equal(saved.body,record.result.text);assert.equal(saved.sourceCardId,original.id);assert.equal(saved.attachment,null);assert.equal(saved.image,'');
 assert.deepEqual(form.state().cards.find(item=>item.id===original.id).attachment,changedAttachment);
 assert.deepEqual(form.state().cards.find(item=>item.id===original.id).tags,['原标签']);
});

test('an unchanged live attachment still passes source verification and applies selected classification locally',async()=>{
 const original={...structuredClone(card),updatedAt:'2026-10-04T12:00:00Z',tags:['原标签']};
 const form=workspace({cards:[original],openCapture:false}),props=openAi(form);
 await props.onApplyClassification(original,{tags:['新建议'],collectionIds:[]});
 assert.equal(form.commits(),1);assert.equal(form.state().cards.length,1);
 assert.deepEqual(form.state().cards[0].tags,['原标签','新建议']);assert.deepEqual(form.state().cards[0].attachment,original.attachment);
});

for(const operation of ['classification','OCR'])test(`switching workspace while restoring a Vault attachment rejects ${operation} before any adoption commit`,async()=>{
 const item={path:'01_sources/cards/audio/synthetic.md',title:card.title,body:card.body,type:'audio',originalPath:'01_sources/cards/audio/originals/synthetic.wav',originalMime:'audio/wav',updatedAt:'2026-10-04T12:00:00Z'};
 const form=workspace({cards:[],items:[item],openCapture:false}),props=openAi(form),material=props.cards.find(value=>value.id===item.path);
 assert.ok(material);const snapshot=await intelligenceDrafts.captureAiSource({...material,attachment:card.attachment});
 const record={...aiRecord(),sourceSnapshot:snapshot};await props.onResultDraft(record);
 let release,markRead;const readStarted=new Promise(resolve=>markRead=resolve);
 form.api.readAttachment=async path=>{assert.equal(path,item.path);markRead();return new Promise(resolve=>release=()=>resolve({ok:true,data:card.attachment}));};
 const before=structuredClone(form.state()),beforeCommits=form.commits();
 const pending=operation==='classification'?props.onApplyClassification(snapshot,{tags:['旧建议'],collectionIds:[]}):props.onSaveOcr(snapshot,{text:'旧识别结果'});
 await readStarted;form.switchWorkspace();release();
 await assert.rejects(pending,/工作区已切换，未采用旧结果/);
 assert.equal(form.commits(),beforeCommits);assert.deepEqual(form.state(),before);
 assert.equal(form.state().drafts[intelligenceDrafts.aiResultKey(record.id)].result.text,record.result.text);
 assert.equal(form.state().cards.length,0);assert.equal(form.captures().length,0);
});

test('local transcription finishing after closing the dialog persists captions and restores a binary-free history record',async()=>{
 const {form,props,running,release}=await podcastWorkspace();props.onCancel();form.render();release();const result=await running;
 assert.equal(result.draftApplied,true);assert.equal(form.state().drafts.podcastClip.transcript,transcript);assert.equal(form.state().drafts.podcastClip.note,'原备注');
 const records=podcastTranscription.listPodcastTranscriptions(form.state().drafts);assert.equal(records.length,1);assert.equal(records[0].phase,'complete');assert.ok(records[0].sourceSnapshot.attachmentMeta.sha256);assert.equal(JSON.stringify(records).includes('base64'),false);
 form.render();const restored=openPodcast(form);assert.equal(restored.transcriptionDrafts[0].transcript,transcript);assert.equal(restored.transcriptionActive,false);
});

for(const replacedSource of [false,true])test(`finishing transcription preserves ${replacedSource?'a same-ID source with replaced audio bytes':'a newly selected audio draft'}`,async()=>{
 const {form,running,release}=await podcastWorkspace();
 if(replacedSource){const changed=Buffer.from(wav);changed[changed.length-1]^=1;form.updateCard({id:card.id,attachment:{...card.attachment,dataUrl:`data:audio/wav;base64,${changed.toString('base64')}`}});}
 else form.replaceDraft({...podcastSnapshot,sourceId:'another-audio',note:'新的草稿',transcript:'WEBVTT\n\n00:01.000 --> 00:02.000\n新字幕'});
 const before=structuredClone(form.state().drafts.podcastClip);release();const result=await running;
 assert.equal(result.draftApplied,false);assert.deepEqual(form.state().drafts.podcastClip,before);
 assert.equal(podcastTranscription.listPodcastTranscriptions(form.state().drafts)[0].transcript,transcript);
});

test('a library switch during transcription persists the old session without replacing the new visible library',async()=>{
 const {form,running,release}=await podcastWorkspace();form.showOtherIdentity();release();await running;
 assert.equal(form.state().drafts.podcastClip.transcript,transcript);assert.equal(form.visibleState().drafts.podcastClip,undefined);
});

test('normal quit waits for the full transcription result commit before acknowledging',async()=>{
 const {form,running,release}=await podcastWorkspace();let eventHandler,ack;
 form.api.subscribe=handler=>{eventHandler=handler;return()=>{};};form.api.rendererQuitReady=async value=>{ack=value;};form.render();form.mountQuitGate();
 eventHandler({type:'prepareQuit',quitId:'test-quit'});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ack,undefined);
 release();await running;await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(ack.ok,true);assert.equal(ack.quitId,'test-quit');assert.equal(form.state().drafts.podcastClip.transcript,transcript);
});

test('normal quit retains the window when completed transcription could not be persisted',async()=>{
 const {form,running,release}=await podcastWorkspace();form.failNextWrite();release();await assert.rejects(running,/合成磁盘写入失败/);
 let eventHandler,ack;form.api.subscribe=handler=>{eventHandler=handler;return()=>{};};form.api.rendererQuitReady=async value=>{ack=value;};form.render();form.mountQuitGate();
 eventHandler({type:'prepareQuit',quitId:'failed-quit'});await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(ack.ok,false);assert.ok(ack.message.includes('未写入磁盘'));assert.equal(openPodcast(form).transcriptionDrafts[0].phase,'complete');
});

test('recovering a transcription after a transient disk failure persists its receipt and permits normal quit',async()=>{
 const {form,running,release}=await podcastWorkspace();form.failNextWrite();release();await assert.rejects(running,/合成磁盘写入失败/);form.render();
 const restored=openPodcast(form),record=restored.transcriptionDrafts[0];
 await restored.onRecoverTranscription(record,{formSnapshot:form.state().drafts.podcastClip,attachment:card.attachment});form.render();
 assert.equal(form.state().drafts.podcastClip.transcript,transcript);
 assert.equal(podcastTranscription.listPodcastTranscriptions(form.state().drafts)[0].phase,'complete');
 let eventHandler,ack;form.api.subscribe=handler=>{eventHandler=handler;return()=>{};};form.api.rendererQuitReady=async value=>{ack=value;};form.render();form.mountQuitGate();
 eventHandler({type:'prepareQuit',quitId:'recovered-quit'});await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(ack.ok,true);assert.equal(ack.quitId,'recovered-quit');
 const restarted=workspace({openCapture:false,initialState:form.state()});assert.equal(openPodcast(restarted).transcriptionDrafts[0].transcript,transcript);
});

for(const phase of ['complete','failed'])test(`retrying persistence of a ${phase} transcription clears only the saved volatile result and enables quit`,async()=>{
 const {form,running,release}=await podcastWorkspace({transcriptionError:phase==='failed'?'合成转录失败':undefined});form.failNextWrite();release();await assert.rejects(running,/合成磁盘写入失败/);form.render();
 const restored=openPodcast(form),record=restored.transcriptionDrafts[0];assert.equal(record.phase,phase);assert.equal(restored.isTranscriptionDurable(record),false);
 form.api.intelligenceRequest=async()=>{throw Error('持久化重试不得重新转录');};form.failNextWrite();
 await assert.rejects(restored.onPersistTranscription(record),/合成磁盘写入失败/);form.render();
 assert.equal(openPodcast(form).isTranscriptionDurable(record),false);
 let eventHandler,ack;form.api.subscribe=handler=>{eventHandler=handler;return()=>{};};form.api.rendererQuitReady=async value=>{ack=value;};form.render();form.mountQuitGate();
 eventHandler({type:'prepareQuit',quitId:'still-unsaved'});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ack.ok,false);
 await restored.onPersistTranscription(record);form.render();assert.equal(openPodcast(form).isTranscriptionDurable(record),true);
 assert.equal(podcastTranscription.listPodcastTranscriptions(form.state().drafts)[0].phase,phase);
 eventHandler({type:'prepareQuit',quitId:'retry-saved'});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ack.ok,true);
});
