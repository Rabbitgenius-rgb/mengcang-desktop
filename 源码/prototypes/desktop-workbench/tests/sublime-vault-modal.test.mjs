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
function workspace({cards=[structuredClone(card)],items=[],hash='#/library',openCapture=true}={}){
 let state=model.createWorkspaceState();state={...state,cards:structuredClone(cards),savedIds:cards.map(item=>item.id)};
 const slots=[],refs=[];let stateCursor=0,refCursor=0,tree,commits=0,captures=[],navigations=[];
 const identity={id:'test-vault-modal'};
 const react={Fragment:Symbol('fragment'),memo:value=>value,createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:()=>{},useLayoutEffect:()=>{},useMemo:factory=>factory(),useRef:initial=>{const index=refCursor++;return refs[index]??(refs[index]={current:index===4?identity.id:initial});},useState:initial=>{const index=stateCursor++;if(!slots[index])slots[index]={value:index===0?state:index===1?true:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
 const icons=new Proxy({},{get:(_,name)=>function Icon(){return react.createElement('svg',{'data-icon':String(name)});}});
 const session={writing:0,drafts:()=>state.drafts,recoverableDrafts:()=>[],commit:async action=>{commits++;state=typeof action==='function'?action(state):model.workspaceReducer(state,structuredClone(action));return state;}};
 const api={captureAvailable:true,captureAttachmentAvailable:true,capture:async payload=>{captures.push(structuredClone(payload));return {ok:true,data:{note:{path:'01_sources/cards/text/synthetic.md'}}};}};
 let props={items,identity,api,connected:true};
 const module={exports:{}};
 const history={state:{},replaceState(){},pushState(){}};
 const location={hash,href:'mengcang://app/'};
 const sameRealmModel={...model,workspaceReducer:(state,action)=>model.workspaceReducer(state,structuredClone(action)),selectCards:(cards,state,options)=>model.selectCards(structuredClone(cards),structuredClone(state),structuredClone(options))};
 const sameRealmView={...view,selectWorkspaceCards:(cards,state,options)=>view.selectWorkspaceCards(structuredClone(cards),structuredClone(state),structuredClone(options)),cardCapturePayload:(card,options)=>view.cardCapturePayload(structuredClone(card),structuredClone(options))};
 const context={module,exports:module.exports,Error,URL,URLSearchParams,Blob,crypto:globalThis.crypto,structuredClone,console,window:{history,location,matchMedia:()=>({matches:false})},history,location,setTimeout:()=>0,clearTimeout:()=>{},require:specifier=>specifier==='react'?react:specifier==='@tabler/icons-react'?icons:specifier==='./podcastTranscription.js'?podcastTranscription:specifier==='./workspaceModel.js'?sameRealmModel:specifier==='./workspaceView.js'?sameRealmView:specifier==='../discoveryModel.js'?discovery:specifier==='../desktopModel.js'?desktop:specifier==='./workspaceStore.js'?{createWorkspaceStore:()=>({})}:specifier==='./workspacePersistence.js'?{createWorkspaceSession:()=>session}:specifier==='./workspaceNavigation.js'?{createWorkspaceNavigation:()=>({open:(...args)=>navigations.push(structuredClone(args))})}:specifier==='./referenceCards.js'?{listeningCard:{id:'unused-reference'}}:specifier==='./SublimeEditors.jsx'?{CardEditor:()=>null,CollectionEditor:()=>null,CanvasEditor:()=>null,ImportEditor:()=>null,SafeRichBody:()=>null}:specifier==='./VaultAttachmentPreview.jsx'?{default:()=>null}:specifier==='./AttachmentPreview.jsx'?{default:()=>null}:['./IntelligencePanel.jsx','./SourceFeeds.jsx','./PodcastClips.jsx'].includes(specifier)?{default:()=>null,PodcastClipPlayback:()=>null}:specifier==='./intelligenceHelpers.js'?intelligence:specifier==='./intelligenceDrafts.js'?{...intelligenceDrafts,compactAiSource:value=>intelligenceDrafts.compactAiSource(structuredClone(value)),captureAiSource:value=>intelligenceDrafts.captureAiSource(structuredClone(value))}:['./externalContext.js','./publishableCollection.js'].includes(specifier)?{}:specifier==='./workspaceDownload.js'?{requestWorkspaceDownload:()=>{throw Error('Unexpected download');}}:specifier.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+specifier);})()};
 vm.runInNewContext(compiled,context);
 function render(patch={}){props={...props,...patch};stateCursor=0;refCursor=0;tree=module.exports.default(props);return tree;}
 const button=label=>find(tree,node=>node.type==='button'&&text(node)===label);
 render();
 if(openCapture){find(tree,node=>node.props?.label==='更多 '+card.title).props.onClick();render();
 button('存入梦藏仓库').props.onClick();render();}
 return {render,button,find:predicate=>find(tree,predicate),text:()=>text(tree),checkbox:()=>find(tree,node=>node.type==='input'&&node.props?.type==='checkbox'),api,state:()=>state,captures:()=>captures,commits:()=>commits,navigations:()=>navigations};
}

test('disconnect keeps the selected attachment and blocks both attachment and text-only submissions',async()=>{
 const form=workspace();form.render({connected:false,api:{...form.api,captureAvailable:false,captureAttachmentAvailable:false}});
 assert.equal(form.checkbox().props.checked,true);
 assert.ok(form.text().includes(offlineMessage));assert.ok(!form.text().includes(compatibilityMessage));
 assert.equal(form.button('确认保存新笔记').props.disabled,true);
 await form.button('确认保存新笔记').props.onClick();form.render();
 assert.equal(form.captures().length,0);assert.equal(form.commits(),0);
 form.checkbox().props.onChange({target:{checked:false}});form.render();
 assert.equal(form.button('确认保存新笔记').props.disabled,true);
 await form.button('确认保存新笔记').props.onClick();form.render();
 assert.equal(form.captures().length,0);assert.equal(form.commits(),0);
 assert.equal(form.state().cards[0].body,card.body);assert.deepEqual(form.state().cards[0].attachment,card.attachment);
});

test('connected older connector retains attachment compatibility guidance and can save text-only',async()=>{
 const form=workspace();form.render({api:{...form.api,captureAttachmentAvailable:false}});
 assert.ok(form.text().includes(compatibilityMessage));assert.ok(!form.text().includes(offlineMessage));
 assert.equal(form.button('确认保存新笔记').props.disabled,true);
 form.checkbox().props.onChange({target:{checked:false}});form.render();
 assert.equal(form.button('确认保存新笔记').props.disabled,false);
 await form.button('确认保存新笔记').props.onClick();form.render();
 assert.equal(form.captures().length,1);const payload=form.captures()[0];
 assert.equal(payload.attachment,undefined);assert.equal(payload.body,card.body);assert.equal(payload.caption,card.caption);assert.equal(payload.sourceUrl,card.sourceUrl);
 assert.equal(form.commits(),2);assert.deepEqual(form.state().cards[0].attachment,card.attachment);
});

test('reconnecting the same open modal enables capture without changing the attachment choice',async()=>{
 const form=workspace();form.render({connected:false,api:{...form.api,captureAvailable:false,captureAttachmentAvailable:false}});
 assert.equal(form.checkbox().props.checked,true);assert.equal(form.button('确认保存新笔记').props.disabled,true);
 form.render({connected:true,api:form.api});
 assert.equal(form.checkbox().props.checked,true);assert.equal(form.button('确认保存新笔记').props.disabled,false);
 assert.ok(!form.text().includes(offlineMessage));assert.ok(!form.text().includes(compatibilityMessage));
 await form.button('确认保存新笔记').props.onClick();form.render();
 assert.equal(form.captures().length,1);assert.deepEqual(form.captures()[0].attachment,card.attachment);assert.equal(form.captures()[0].body,card.body);
 const operationId=form.captures()[0].operationId;assert.equal(form.state().drafts[`vault:${card.id}`].operationId,operationId);
 assert.equal(form.state().drafts[`vault:${card.id}`].savedPath,'01_sources/cards/text/synthetic.md');
});


test('source links show only positive integer pages without rewriting saved metadata or navigation',()=>{
 for(const page of ['0','',undefined,'-1','1.5',2,'7']){
  const excerpt={id:'excerpt',path:'excerpt',origin:'local',type:'text',title:'OCR 副本',body:'识别文字',sourceCardId:card.id,page};
  const form=workspace({cards:[card,excerpt],hash:'#/card/excerpt',openCapture:false});
  const suffix=page===2?' · 第 2 页':page==='7'?' · 第 7 页':'';
  const link=form.button('查看来源文件'+suffix);assert.ok(link,`Unexpected source page label for ${String(page)}`);
  assert.equal(form.text().includes('第 0 页'),false);
  assert.equal(form.state().cards.find(item=>item.id==='excerpt').page,page);
  link.props.onClick();assert.equal(form.navigations()[0][0].sourcePage,page===undefined?1:page);
  assert.equal(form.commits(),0);
 }
});
test('image insight menus expose both vision actions with Chinese modal titles while text cards retain the five original actions',()=>{
 for(const type of ['text','image']){
  const material={...card,id:'menu-card',path:'menu-card',title:'菜单素材',type,attachment:null};
  const form=workspace({cards:[material],openCapture:false});form.find(node=>node.props?.label==='AI 解读 '+material.title).props.onClick();form.render();
  for(const label of ['核心概述','通俗解释','反向观点','类比说明','鲜明观点'])assert.ok(form.button(label));
  assert.equal(!!form.button('图片内容描述'),type==='image');assert.equal(!!form.button('构图与配色'),type==='image');
  if(type==='image'){
   form.button('构图与配色').props.onClick();form.render();
   assert.ok(form.find(node=>node.props?.title==='构图与配色'));assert.ok(form.find(node=>node.props?.mode==='Visual analysis'&&node.props?.card?.id===material.id));
  }
  assert.equal(form.commits(),0);assert.equal(form.captures().length,0);
 }
});
test('real classification save keeps the analyzed original when an attachment-less Vault cache already exists',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
 const attachment={name:'original.png',type:'image/png',size:png.length,dataUrl:`data:image/png;base64,${png.toString('base64')}`};
 const cached={id:'01_sources/cards/images/source.md',path:'01_sources/cards/images/source.md',origin:'vault',title:'缓存原图',type:'image',body:'旧缓存正文',updatedAt:'old',originalPath:'01_sources/cards/images/originals/source.png',originalMime:'image/png'};
 const form=workspace({cards:[cached],hash:'#/library',openCapture:false});form.find(node=>node.props?.label==='AI 解读 '+cached.title).props.onClick();form.render();form.button('分类建议').props.onClick();form.render();
 const panel=form.find(node=>node.props?.mode==='Classification'&&node.props?.onApplyClassification);
 form.api.readAttachment=async()=>({ok:true,data:attachment});
 const snapshot={...panel.props.card,body:cached.body,updatedAt:cached.updatedAt,attachment};
 await panel.props.onApplyClassification(snapshot,{tags:['分类建议'],collectionIds:[]});form.render();
 assert.equal(form.commits(),1);assert.equal(form.captures().length,0);
 const saved=form.state().cards.find(item=>item.origin==='local');assert.ok(saved);assert.notEqual(saved.id,cached.id);assert.equal(saved.sourceCardId,cached.id);assert.equal(saved.body,snapshot.body);assert.deepEqual(saved.attachment,attachment);assert.deepEqual(intelligence.visionImagePayload(saved.attachment),attachment);
 assert.equal(form.state().cards.find(item=>item.id===cached.id).attachment,null);assert.equal(form.state().cards.find(item=>item.id===cached.id).body,cached.body);
});
