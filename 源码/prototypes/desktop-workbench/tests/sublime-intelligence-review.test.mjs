import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as helpers from '../src/sublime/intelligenceHelpers.js';
import * as deepseekSettings from '../src/sublime/deepseekSettings.js';
import * as draftHelpers from '../src/sublime/intelligenceDrafts.js';
import {valueOf} from '../src/desktopModel.js';

const compiled=(await transform(await readFile(new URL('../src/sublime/IntelligencePanel.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const source={id:'source',path:'source',title:'原题',body:'请求时的原文',updatedAt:'2026-10-04T00:00:00Z',tags:['原标签'],origin:'local',type:'text'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
const attachment={name:'synthetic.png',type:'image/png',size:png.length,dataUrl:`data:image/png;base64,${png.toString('base64')}`};
const imageSource={...source,type:'image',attachment,image:'https://thumbnail.example/never-send.png'};
const status={settings:{nativeEnabled:false,generationEnabled:false,provider:'api',endpoint:'https://api.example.com/v1',model:''},usage:{nativeRequests:0,generationRequests:0,cloudRequests:0}};
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);return Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function find(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return null;}return predicate(node)?node:find(node.props?.children,predicate);}
function panel(props){
 const slots=[],effects=[];let cursor=0,tree,mounted=true;const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:(fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}},useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{assert.equal(mounted,true,'state changed after unmount');slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
 const sameRealmDrafts={...draftHelpers,captureAiSource:source=>draftHelpers.captureAiSource(structuredClone(source)),normalizeAiRecord:record=>draftHelpers.normalizeAiRecord(structuredClone(record))};
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,Error,URL,crypto:globalThis.crypto,require:specifier=>specifier==='react'?react:specifier==='./intelligenceHelpers.js'?helpers:specifier==='./deepseekSettings.js'?deepseekSettings:specifier==='./intelligenceDrafts.js'?sameRealmDrafts:specifier==='../desktopModel.js'?{valueOf}:specifier.endsWith('.css')?{}:(()=>{throw Error(specifier);})()});
 function render(next={}){props={...props,...next};cursor=0;return tree=module.exports.default(props);}render();return {render,ready:async()=>{for(let cycle=0;cycle<4;cycle++){for(const effect of effects.splice(0))effect();await new Promise(resolve=>setImmediate(resolve));render();}},unmount:()=>{for(const slot of slots)slot?.cleanup?.();mounted=false;},find:predicate=>find(tree,predicate),button:label=>find(tree,node=>node.type==='button'&&text(node)===label),text:()=>text(tree)};
}
test('OCR saves the exact analyzed source snapshot after another window refreshes the current card',async()=>{
 const ocrSource={...source,attachment};let received,calls=0;const form=panel({mode:'OCR',card:ocrSource,cards:[ocrSource],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{calls++;return {ok:true,data:{text:'识别结果',local:true}};}},onSaveOcr:async(card)=>{received=card;}});
 assert.equal(calls,0);await form.button('在本机识别').props.onClick();form.render({cards:[{...source,body:'另一窗口的新正文',updatedAt:'2026-10-04T01:00:00Z'}]});
 await form.button('保存识别文字').props.onClick();assert.equal(received.body,source.body);assert.equal(received.updatedAt,source.updatedAt);assert.equal(calls,1);
});
test('classification application retains source version and does not substitute refreshed tags',async()=>{
 let received;const form=panel({mode:'Classification',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>({ok:true,data:{tags:['建议标签'],collectionIds:[],reason:'合成结果'}})},onApplyClassification:async(card,result)=>{received={card,result};}});
 await form.button('准备调用并确认').props.onClick();form.render({cards:[{...source,tags:['另一窗口的新标签'],updatedAt:'2026-10-04T01:00:00Z'}]});
 await form.button('采用所选建议').props.onClick();assert.deepEqual(received.card.tags,source.tags);assert.equal(received.card.updatedAt,source.updatedAt);assert.deepEqual([...received.result.tags],['建议标签']);
});
test('a reference outside the saved library is analyzed as an anchor without importing it',async()=>{
 const inputs=[],neighbor={id:'neighbor',title:'相关素材',body:'库中正文'};const form=panel({mode:'Related',card:source,cards:[neighbor],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async input=>{inputs.push(input);return {ok:true,data:{embeddings:input.texts.map(item=>({id:item.id,model:'synthetic',language:'zh',vector:[1,0]})),missingIds:[]}};}},onOpen:()=>{}});
 await form.button('在本机查找').props.onClick();form.render();const ids=inputs.flatMap(input=>input.texts.map(item=>item.id));assert.ok(ids.includes(source.id));assert.ok(ids.includes(neighbor.id));assert.ok(form.find(node=>node.props?.className==='si-match'));assert.equal(inputs.every(input=>input.action==='embed'),true);
});
test('DeepSeek preset preserves switches and pending key, and only saves after explicit submission without generation',async()=>{
 let current={...status.settings},configured=0,keySaved='',modelCalls=0;
 const form=panel({mode:'Settings',api:{intelligenceStatus:async()=>({ok:true,data:{...status,settings:current}}),intelligenceConfigure:async settings=>{configured++;current={...settings};return {ok:true,data:{saved:true}};},intelligenceSetKey:async key=>{keySaved=key;return {ok:true,data:{saved:true}};},intelligenceRequest:async()=>{modelCalls++;throw Error('must not execute');}}});
 await form.ready();
 form.find(node=>node.props?.['aria-label']==='API 密钥').props.onChange({target:{value:'synthetic-pending-key'}});
 form.button('填入 DeepSeek 配置').props.onClick();form.render();
 assert.equal(configured,0);assert.equal(modelCalls,0);
 assert.equal(form.find(node=>node.props?.['aria-label']==='API 地址').props.value,'https://api.deepseek.com/v1');
 assert.equal(form.find(node=>node.props?.['aria-label']==='模型名称').props.value,'deepseek-flash');
 assert.equal(form.find(node=>node.props?.['aria-label']==='API 密钥').props.value,'synthetic-pending-key');
 assert.equal(form.find(node=>node.props?.['aria-label']==='音频转录模型'),null);
 assert.ok(form.text().includes('当前连接不提供音频转录'));
 await form.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});form.render();
 assert.equal(configured,1);assert.equal(current.nativeEnabled,false);assert.equal(current.generationEnabled,false);
 assert.equal(current.apiKey,undefined);assert.equal(keySaved,'synthetic-pending-key');assert.equal(modelCalls,0);
});
test('DeepSeek recognition rejects lookalike hosts and non-HTTPS endpoints',()=>{
 for(const url of ['https://api.deepseek.com/v1','https://API.DEEPSEEK.COM./v1'])assert.equal(deepseekSettings.isDeepSeekEndpoint(url),true);
 for(const url of ['https://api.deepseek.com.evil.example/v1','https://deepseek.example/v1','http://api.deepseek.com/v1','not a URL'])assert.equal(deepseekSettings.isDeepSeekEndpoint(url),false);
});
test('local transcription settings are independent from disabled generation and preserve the existing DeepSeek connection without loading a model',async()=>{
 let current={...status.settings,endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash',transcriptionProvider:'local',localTranscriptionEnabled:false},calls=0;
 const localStatus={...status,localTranscription:{ready:true,model:'large-v3-turbo',onDemand:true,lifecycle:'on-demand'},usage:{...status.usage,localTranscriptionRequests:0}};
 const form=panel({mode:'Settings',api:{intelligenceStatus:async()=>({ok:true,data:{...localStatus,settings:current}}),intelligenceConfigure:async settings=>{current={...settings};return {ok:true,data:{saved:true}};},intelligenceRequest:async()=>{calls++;throw Error('must not run');}}});
 await form.ready();assert.equal(form.find(node=>node.props?.['aria-label']==='转录方式').props.value,'local');assert.ok(form.text().includes('large-v3-turbo'));assert.ok(form.text().includes('任务完成或取消后退出并释放内存'));assert.equal(form.find(node=>node.props?.['aria-label']==='音频转录模型'),null);
 form.find(node=>node.props?.['aria-label']==='启用本机音频转录').props.onChange({target:{checked:true}});form.render();await form.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(current.localTranscriptionEnabled,true);assert.equal(current.generationEnabled,false);assert.equal(current.endpoint,'https://api.deepseek.com/v1');assert.equal(current.model,'deepseek-flash');assert.equal(calls,0);
});
test('local image preview sends the exact original for both vision modes and saves only text with the analyzed source snapshot',async()=>{
 const inputs=[];let saved;
 const form=panel({mode:'Image description',card:imageSource,cards:[imageSource],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async input=>{inputs.push(input);return {ok:true,data:{text:'合成图片解读',engine:'stub'}};}},onSaveInsight:async(source,mode,result)=>{saved={source,mode,note:helpers.generatedInsightCard(source,mode,result,{id:'new',now:'2026-10-04'})};}});
 await form.ready();assert.equal(inputs.length,0);
 assert.equal(form.find(node=>node.type==='img').props.src,attachment.dataUrl);assert.ok(form.text().includes('预览仅在本机准备'));
 await form.button('准备调用并确认').props.onClick();form.render();assert.equal(inputs[0].mode,'Image description');assert.deepEqual(inputs[0].image,attachment);
 form.find(node=>node.props?.['aria-label']==='解读方式').props.onChange({target:{value:'Visual analysis'}});form.render();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果'),null);assert.equal(form.find(node=>node.type==='img'),null);
 await form.ready();await form.button('准备调用并确认').props.onClick();form.render();assert.equal(inputs[1].mode,'Visual analysis');assert.deepEqual(inputs[1].image,attachment);
 form.render({cards:[{...imageSource,title:'另一窗口新题',body:'另一窗口新正文',updatedAt:'later'}]});await form.button('另存为解读笔记').props.onClick();
 assert.equal(saved.source.body,source.body);assert.equal(saved.mode,'Visual analysis');assert.equal(saved.note.sourceCardId,source.id);assert.equal(saved.note.image,undefined);assert.equal(saved.note.attachment,undefined);assert.equal(JSON.stringify(saved.note).includes('base64'),false);
});
test('Vault preview reads note-linked original files and ignores a stale asynchronous image after selecting another card',async()=>{
 const first={...source,id:'vault-first',path:'01_sources/cards/images/first.md',origin:'vault',type:'image',originalPath:'01_sources/cards/images/originals/first.png',originalMime:'image/png',image:'mengcang-asset://thumbnail/first'};
 const second={...first,id:'vault-second',path:'01_sources/cards/images/second.md',title:'第二张图',body:'第二张图的文字',originalPath:'01_sources/cards/images/originals/second.png'};
 const reads=[],pending=[],inputs=[];const api={intelligenceStatus:async()=>({ok:true,data:status}),readAttachment:path=>{reads.push(path);return new Promise(resolve=>pending.push(resolve));},intelligenceRequest:async input=>{inputs.push(input);return {ok:true,data:{text:'合成结果'}};}};
 const form=panel({mode:'Visual analysis',card:first,cards:[first,second],api});await form.ready();assert.deepEqual(reads,[first.path]);assert.equal(form.button('准备调用并确认').props.disabled,true);
 form.find(node=>node.props?.['aria-label']==='参考素材').props.onChange({target:{value:second.id}});form.render();await form.ready();assert.deepEqual(reads,[first.path,second.path]);
 pending[0]({ok:true,data:{...attachment,name:'stale-first.png'}});await form.ready();assert.equal(form.find(node=>node.type==='img'),null);assert.equal(inputs.length,0);
 const secondAttachment={...attachment,name:'current-second.png'};pending[1]({ok:true,data:secondAttachment});await form.ready();assert.ok(form.text().includes(secondAttachment.name));assert.equal(form.text().includes('stale-first.png'),false);
 await form.button('准备调用并确认').props.onClick();form.render();assert.deepEqual(inputs[0].image,secondAttachment);assert.equal(inputs[0].text,helpers.intelligenceText(second));assert.equal(inputs[0].text.includes('mengcang-asset'),false);
});
test('image metadata updates replace the pending preview while the request uses current text and classification retains its original source',async()=>{
 let input,applied;const form=panel({mode:'Classification',card:imageSource,cards:[imageSource],collections:[{id:'collection',title:'测试收藏集'}],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async value=>{input=value;return {ok:true,data:{tags:['图片建议'],collectionIds:['collection'],reason:'合成建议'}};}},onApplyClassification:async(source,result)=>{applied={source,result};}});
 await form.ready();const updated={...imageSource,body:'当前正文',attachment:{...attachment,name:'renamed.png'}};form.render({cards:[updated]});assert.equal(form.find(node=>node.type==='img'),null);await form.ready();assert.ok(form.text().includes('renamed.png'));
 await form.button('准备调用并确认').props.onClick();form.render();assert.equal(input.action,'classify');assert.equal(input.image.name,'renamed.png');assert.equal(input.text,helpers.intelligenceText(updated));
 form.render({cards:[{...updated,body:'之后的正文',tags:['之后标签'],updatedAt:'later'}]});await form.button('采用所选建议').props.onClick();assert.equal(applied.source.body,'当前正文');assert.deepEqual([...applied.result.tags],['图片建议']);assert.deepEqual([...applied.result.collectionIds],['collection']);
});
test('applying Vault image classification preserves the exact analyzed original for the local copy and later image requests',async()=>{
 const vaultSource={...source,id:'vault-classify',path:'01_sources/cards/images/classify.md',origin:'vault',type:'image',originalPath:'01_sources/cards/images/originals/classify.png',originalMime:'image/png'};
 let requestInput,savedSource,localCopy;const form=panel({mode:'Classification',card:vaultSource,cards:[vaultSource],api:{intelligenceStatus:async()=>({ok:true,data:status}),readAttachment:async path=>{assert.equal(path,vaultSource.path);return {ok:true,data:attachment};},intelligenceRequest:async input=>{requestInput=input;return {ok:true,data:{tags:['图片建议'],collectionIds:[],reason:'合成建议'}};}},onApplyClassification:async(source,result)=>{savedSource=source;localCopy={...source,id:'local-copy',path:'local-copy',origin:'local',tags:result.tags};}});
 await form.ready();await form.button('准备调用并确认').props.onClick();form.render();await form.button('采用所选建议').props.onClick();
 assert.deepEqual(savedSource.attachment,requestInput.image);assert.deepEqual(localCopy.attachment,attachment);assert.equal(vaultSource.attachment,undefined);
 const subsequent=[];const localForm=panel({mode:'Image description',card:localCopy,cards:[localCopy],api:{intelligenceStatus:async()=>({ok:true,data:status}),readAttachment:async()=>{throw Error('local copy must use its stored original');},intelligenceRequest:async input=>{subsequent.push(input);return {ok:true,data:{text:'再次解读'}};}}});
 await localForm.ready();await localForm.button('准备调用并确认').props.onClick();assert.deepEqual(subsequent[0].image,attachment);
 const note=helpers.generatedInsightCard(savedSource,'Visual analysis',{text:'纯文字解读'},{id:'note',now:'2026-10-04'});assert.equal(note.attachment,undefined);assert.equal(note.image,undefined);assert.equal(JSON.stringify(note).includes('base64'),false);
});
test('vision modes reject missing or remote originals and incompatible providers without a request',async()=>{
 for(const testCase of [{card:source,status},{card:{...source,type:'image',image:'https://example.test/remote.png'},status},{card:imageSource,status:{...status,settings:{...status.settings,provider:'cli'}}},{card:imageSource,status:{...status,settings:{...status.settings,endpoint:'https://api.deepseek.com/v1',model:'deepseek-v4-pro'}}}]){
  let calls=0;const form=panel({mode:'Visual analysis',card:testCase.card,cards:[testCase.card],api:{intelligenceStatus:async()=>({ok:true,data:testCase.status}),intelligenceRequest:async()=>{calls++;throw Error('unexpected request');}}});await form.ready();assert.equal(form.button('准备调用并确认').props.disabled,true);await form.button('准备调用并确认').props.onClick();form.render();assert.equal(calls,0);assert.ok(form.find(node=>node.props?.role==='alert'));
 }
 for(const model of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp']){
  const form=panel({mode:'Visual analysis',card:imageSource,cards:[imageSource],api:{intelligenceStatus:async()=>({ok:true,data:{...status,settings:{...status.settings,endpoint:'https://api.deepseek.com/v1',model}}})}});await form.ready();assert.equal(form.button('准备调用并确认').props.disabled,false);
 }
});
test('busy guard prevents repeated generation before a rerender and text modes keep text-only requests',async()=>{
 let calls=0,finish;const form=panel({mode:'The Gist',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:input=>{assert.equal(input.image,undefined);calls++;return new Promise(resolve=>finish=()=>resolve({ok:true,data:{text:'合成结果'}}));}}});
 await form.ready();const click=form.button('准备调用并确认').props.onClick,first=click();await click();await form.ready();assert.equal(calls,1);finish();await first;form.render();
 for(const mode of ['Explain Like I’m 5','Contrarian Take','Analogy','Hot Take']){form.find(node=>node.props?.['aria-label']==='解读方式').props.onChange({target:{value:mode}});form.render();const operation=form.button('准备调用并确认').props.onClick();await form.ready();finish();await operation;form.render();}assert.equal(calls,5);
});
function completeRecord({mode='The Gist',result={text:'历史解读'},sourceSnapshot=source,createdAt='2026-10-04T01:00:00Z',...options}={}){
 return draftHelpers.normalizeAiRecord({id:crypto.randomUUID(),mode,phase:'complete',sourceSnapshot,result,createdAt,updatedAt:createdAt,savedCardId:'',error:'',...options});
}
test('pending persists before sending and an unmounted image request still records its completed text and hash without binary',async()=>{
 const records=[],inFlight=new Set();let permitPending,finishModel,calls=0,pendingSaved;
 const pendingReady=new Promise(resolve=>pendingSaved=resolve);
 const api={intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{calls++;return new Promise(resolve=>finishModel=()=>resolve({ok:true,data:{mode:'Image description',text:'卸载后返回的合成解读'}}));}};
 const form=panel({mode:'Image description',card:imageSource,cards:[imageSource],api,onResultDraft:async record=>{records.push(structuredClone(record));if(record.phase==='pending'){pendingSaved();await new Promise(resolve=>permitPending=resolve);}},requestIsActive:id=>inFlight.has(id),registerRequest:(id,active)=>active?inFlight.add(id):inFlight.delete(id)});
 await form.ready();const operation=form.button('准备调用并确认').props.onClick();await pendingReady;await form.ready();assert.equal(calls,0);assert.equal(records[0].phase,'pending');assert.ok(records[0].sourceSnapshot.attachmentMeta.sha256);assert.equal(JSON.stringify(records[0]).includes('base64'),false);
 permitPending();await form.ready();assert.equal(calls,1);assert.equal(inFlight.size,1);form.unmount();finishModel();await operation;
 assert.equal(records.length,2);assert.equal(records[1].id,records[0].id);assert.equal(records[1].phase,'complete');assert.equal(records[1].result.text,'卸载后返回的合成解读');assert.equal(JSON.stringify(records[1]).includes('base64'),false);assert.equal(inFlight.size,0);
});
test('reopening restores the latest result, switching modes restores its history, and selecting older drafts never calls a model',async()=>{
 const old=completeRecord({result:{text:'旧解读'},createdAt:'2026-10-04T01:00:00Z'}),recent=completeRecord({result:{text:'新解读'},createdAt:'2026-10-04T02:00:00Z'}),analogy=completeRecord({mode:'Analogy',result:{text:'历史类比'}});let calls=0;
 const form=panel({mode:'The Gist',card:source,cards:[source],resultDrafts:[old,recent,analogy],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{calls++;throw Error('must not call');}}});await form.ready();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,'新解读');
 form.find(node=>node.props?.['aria-label']==='本机结果草稿').props.onChange({target:{value:old.id}});form.render();await form.ready();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,'旧解读');
 form.find(node=>node.props?.['aria-label']==='解读方式').props.onChange({target:{value:'Analogy'}});form.render();await form.ready();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,'历史类比');
 form.find(node=>node.props?.['aria-label']==='解读方式').props.onChange({target:{value:'The Gist'}});form.render();await form.ready();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,'新解读');assert.equal(calls,0);
});
test('saving one recovered insight twice invokes the callback once, persists its receipt and opens the saved note',async()=>{
 const record=completeRecord();let saves=0,opened='',savedId='',receipt;
 const form=panel({mode:'The Gist',card:source,cards:[source],resultDrafts:[record],api:{intelligenceStatus:async()=>({ok:true,data:status})},onResultDraft:async next=>{receipt=next;},onSaveInsight:async(source,mode,result,input)=>{saves++;assert.equal(input.id,record.id);savedId=`ai-insight:${input.id}`;return savedId;},onOpen:id=>{opened=id;}});await form.ready();
 const save=form.button('另存为解读笔记').props.onClick;await save();await save();form.render();assert.equal(saves,1);assert.equal(receipt.savedCardId,savedId);assert.ok(form.button('查看已保存笔记'));form.button('查看已保存笔记').props.onClick();assert.equal(opened,savedId);
});
test('a failed save keeps the text available and can retry without another generation',async()=>{
 const record=completeRecord();let saves=0,calls=0;
 const form=panel({mode:'The Gist',card:source,cards:[source],resultDrafts:[record],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{calls++;throw Error('unexpected');}},onSaveInsight:async()=>{saves++;if(saves===1)throw Error('合成磁盘保存失败');return `ai-insight:${record.id}`;}});await form.ready();await form.button('另存为解读笔记').props.onClick();form.render();assert.ok(form.text().includes('合成磁盘保存失败'));assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,record.result.text);
 await form.button('另存为解读笔记').props.onClick();form.render();assert.equal(saves,2);assert.equal(calls,0);assert.ok(form.button('查看已保存笔记'));
});
test('restart pending records are honest and never retry automatically, while a still-active request disables repeated sending',async()=>{
 const record=completeRecord({phase:'pending',result:null});let calls=0;
 const api={intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{calls++;throw Error('unexpected request');}};
 const restart=panel({mode:'The Gist',card:source,cards:[source],resultDrafts:[record],api,requestIsActive:()=>false});await restart.ready();assert.ok(restart.text().includes('上次调用未完成，未自动重试'));assert.equal(restart.find(node=>node.props?.['aria-label']==='智能工具结果'),null);assert.equal(calls,0);
 const active=panel({mode:'The Gist',card:source,cards:[source],resultDrafts:[record],api,requestIsActive:id=>id===record.id});await active.ready();assert.equal(active.button('正在处理…').props.disabled,true);await active.button('正在处理…').props.onClick();assert.equal(calls,0);
});
test('native cancellation and cancelled bridge results persist failed records instead of empty successes',async()=>{
 for(const response of ['throw','cancelled']){
  const records=[];const form=panel({mode:'The Gist',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{if(response==='throw')return {ok:false,error:{code:'AI_CONFIRMATION_REQUIRED',message:'未获确认'}};return {ok:true,data:{cancelled:true}};}},onResultDraft:async record=>{records.push(record);}});await form.ready();await form.button('准备调用并确认').props.onClick();form.render();assert.equal(records[1].phase,'failed');assert.ok(records[1].error.includes('已取消'));assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果'),null);
 }
});
test('completed persistence failure keeps returned text for manual saving and does not claim it is stored',async()=>{
 const form=panel({mode:'The Gist',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>({ok:true,data:{mode:'The Gist',text:'不可丢失的合成结果'}})},onResultDraft:async record=>{if(record.phase==='complete')throw Error('合成持久化失败');}});await form.ready();await form.button('准备调用并确认').props.onClick();form.render();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,'不可丢失的合成结果');assert.ok(form.text().includes('请先另存笔记'));assert.equal(form.text().includes('结果已保存在本机草稿'),false);
});

test('a returned prose data URL is saved exactly instead of losing a successful response',async()=>{
 const content='编码示例：data:image/png;base64,eA==',records=[];
 const form=panel({mode:'The Gist',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>({ok:true,data:{mode:'The Gist',text:content}})},onResultDraft:async record=>records.push(record)});
 await form.ready();await form.button('准备调用并确认').props.onClick();form.render();
 assert.equal(records.at(-1).phase,'complete');assert.equal(records.at(-1).result.text,content);
 assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,content);
});

test('normalization failure terminates pending and preserves returned text for copying',async()=>{
 const content='需核对的返回内容\0完整原文',records=[];
 const form=panel({mode:'The Gist',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>({ok:true,data:{mode:'The Gist',text:content}})},onResultDraft:async record=>records.push(record)});
 await form.ready();await form.button('准备调用并确认').props.onClick();form.render();
 assert.equal(records.at(-1).phase,'failed');assert.equal(records.at(-1).recoveryText,content);
 assert.equal(form.find(node=>node.props?.['aria-label']==='待核对的返回原文').props.value,content);
 assert.equal(form.button('另存为解读笔记'),null);
});
test('a historical result whose source is absent can still be selected and saved as text without sending a missing material',async()=>{
 const record=completeRecord({sourceSnapshot:{...source,id:'removed-source',title:'已移除原素材'}});let calls=0,savedSource;
 const form=panel({mode:'The Gist',cards:[],resultDrafts:[record],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>{calls++;throw Error('unexpected');}},onSaveInsight:async(source)=>{savedSource=source;return `ai-insight:${record.id}`;}});await form.ready();form.find(node=>node.props?.['aria-label']==='本机结果草稿').props.onChange({target:{value:record.id}});form.render();await form.ready();assert.equal(form.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,record.result.text);await form.button('另存为解读笔记').props.onClick();assert.equal(savedSource.id,'removed-source');assert.equal(calls,0);
});
test('volatile recovered results do not claim disk persistence and a mismatched response mode is not accepted as success',async()=>{
 const record=completeRecord(),volatile=panel({mode:'The Gist',card:source,cards:[source],resultDrafts:[record],onResultDraft:async()=>{},isResultDurable:()=>false,api:{intelligenceStatus:async()=>({ok:true,data:status})}});await volatile.ready();assert.equal(volatile.find(node=>node.props?.['aria-label']==='智能工具结果').props.value,record.result.text);assert.equal(volatile.text().includes('结果已保存在本机草稿'),false);assert.ok(volatile.text().includes('尚未保存到磁盘，请复制或另存笔记'));
 const records=[];const mismatch=panel({mode:'The Gist',card:source,cards:[source],api:{intelligenceStatus:async()=>({ok:true,data:status}),intelligenceRequest:async()=>({ok:true,data:{mode:'Hot Take',text:'错误方式的结果'}})},onResultDraft:async record=>records.push(record)});await mismatch.ready();await mismatch.button('准备调用并确认').props.onClick();mismatch.render();assert.equal(records[1].phase,'failed');assert.ok(records[1].error.includes('解读方式与本次请求不一致'));assert.equal(mismatch.find(node=>node.props?.['aria-label']==='智能工具结果'),null);
});
