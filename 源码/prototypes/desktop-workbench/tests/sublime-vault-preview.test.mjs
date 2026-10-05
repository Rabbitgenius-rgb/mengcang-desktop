import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as desktop from '../src/desktopModel.js';
import {publicDiscoveryItem} from '../src/discoveryModel.js';

// Reviewed imports: desktopModel/notePresentation and discoveryModel are pure
// data helpers. Transform only these JSX source strings; never load app/build
// configuration, Electron, media renderers, real files, storage, or a network.
const compile=async path=>(await transform(await readFile(new URL(path,import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const previewCode=await compile('../src/sublime/VaultAttachmentPreview.jsx');
const standaloneCode=await compile('../src/StandaloneApp.jsx');
const workspaceSource=await readFile(new URL('../src/sublime/SublimeWorkspace.jsx',import.meta.url),'utf8');
const adapterSource=workspaceSource.match(/^function adaptItem\(item\)\{.*\}$/m)?.[0];
assert.ok(adapterSource,'Exercise the actual workspace adapter, not a copy');
const adaptItem=vm.runInNewContext(`(${adapterSource})`,{publicDiscoveryItem});
const AttachmentPreview=()=>null,Workspace=()=>null;
const note={path:'01_sources/cards/text/synthetic.md',kind:'text',title:'合成资料',body:'合成正文',fields:{type:'material'},originalPath:'01_sources/originals/first.pdf',originalMime:'application/pdf'};
const card=()=>adaptItem(desktop.normalizeRecord(note,{assetUrl:()=>''}));
const attachment=name=>({name,type:'application/pdf',size:1,dataUrl:'data:application/pdf;base64,QQ=='});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);return Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}

// Synthetic hook lifecycle: render is separate from passive effects. Hook state
// and useMemo identities persist; changed effects clean up before replacement.
// It intentionally does not mount AttachmentPreview or operate a browser.
function lifecycle(code,initialProps={},globals={}){
 const slots=[];let cursor=0,pending=[],dirty=false,tree,props=initialProps,writes=0;
 const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const useMemo=(factory,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!equal(previous.deps,deps))slots[index]={value:factory(),deps};return slots[index].value;};
 const react={Fragment:Symbol('fragment'),createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo,useCallback:(callback,deps)=>useMemo(()=>callback,deps),useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{writes++;const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},useEffect:(effect,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!equal(previous.deps,deps)){slots[index]={deps,cleanup:previous?.cleanup};pending.push({index,effect});}}};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Error,Promise,console,...globals,require:specifier=>{
  if(specifier==='react')return react;
  if(specifier==='../desktopModel.js'||specifier==='./desktopModel.js')return desktop;
  if(specifier==='./AttachmentPreview.jsx')return {__esModule:true,default:AttachmentPreview};
  if(specifier==='./sublime/SublimeWorkspace.jsx')return {__esModule:true,default:Workspace};
  if(specifier==='./standalone.css')return {};
  throw Error('Unexpected import '+specifier);
 }});
 function render(patch={}){props={...props,...patch};cursor=0;dirty=false;tree=module.exports.default(props);return tree;}
 function commit(){for(let pass=0;pass<20;pass++){const effects=pending;pending=[];for(const {index,effect} of effects){slots[index].cleanup?.();slots[index].cleanup=effect();}if(!dirty&&!pending.length)return;render();}throw Error('Synthetic lifecycle failed to settle');}
 async function flush(){for(let step=0;step<8;step++){await Promise.resolve();if(dirty)render();commit();}return tree;}
 function unmount(){for(const slot of slots)slot.cleanup?.();pending=[];}
 render();
 return {render,commit,flush,unmount,find:predicate=>find(tree,predicate),text:()=>text(tree),writes:()=>writes,attachment:()=>find(tree,node=>node.type===AttachmentPreview)?.props.attachment,button:()=>find(tree,node=>node.type==='button'&&text(node)==='打开原文件')};
}
function preview(api,source=card()){return lifecycle(previewCode,{card:source,api});}

test('actual Standalone refresh preserves API identity but reloads a changed original reference',async()=>{
 let snapshot={identity:{id:'synthetic-vault'},entries:[],materials:[note],books:[],capabilities:{capture:true,captureAttachment:true}},reads=0;
 const api={status:async()=>({ok:true,data:{connected:true,identity:snapshot.identity}}),snapshot:async()=>({ok:true,data:snapshot}),subscribe:()=>()=>{},assetUrl:()=>'',readAttachment:async()=>({ok:true,data:attachment(++reads===1?'old.pdf':'new.pdf')})};
 const app=lifecycle(standaloneCode,{}, {window:{mengcang:api},document:{}});app.commit();await app.flush();
 const first=app.find(node=>node.type===Workspace).props,source=adaptItem(first.items[0]);
 assert.equal(source.originalPath,note.originalPath);
 const view=preview(first.api,source);assert.equal(reads,0);view.commit();await view.flush();assert.equal(view.attachment().name,'old.pdf');
 snapshot={...snapshot,materials:[{...note,title:'新元数据',originalPath:'01_sources/originals/second.pdf'}]};
 await first.onRefresh();await app.flush();const next=app.find(node=>node.type===Workspace).props;
 assert.equal(next.api,first.api,'Real useMemo dependency list keeps this API stable');
 const refreshed=adaptItem(next.items[0]);assert.equal(refreshed.title,'新元数据');assert.equal(refreshed.originalPath,'01_sources/originals/second.pdf');
 view.render({card:refreshed,api:next.api});assert.equal(view.attachment(),undefined,'Old bytes must disappear in the first render, before passive effects');
 view.commit();await view.flush();assert.equal(reads,2);assert.equal(view.attachment().name,'new.pdf');view.unmount();app.unmount();
});

for(const [field,value] of [['originalPath','01_sources/originals/second.pdf'],['originalMime','audio/wav'],['updatedAt','2026-10-04T12:00:00Z'],['path','01_sources/cards/text/other.md']]){
 test(`changed ${field} reloads, unchanged card copies do not`,async()=>{
  let reads=0;const source=card(),api={readAttachment:async()=>attachment(`read-${++reads}`)},view=preview(api,source);view.commit();await view.flush();
  view.render({card:{...source,title:'仅显示标题变化'}});view.commit();await view.flush();assert.equal(reads,1);
  view.render({card:{...source,[field]:value}});assert.equal(view.attachment(),undefined);view.commit();await view.flush();assert.equal(reads,2);assert.equal(view.attachment().name,'read-2');view.unmount();
 });
}

test('same file bytes with no new source metadata remain outside this refresh contract',async()=>{
 let content=attachment('old.pdf'),reads=0;const source=card(),api={readAttachment:async()=>{reads++;return content;}},view=preview(api,source);view.commit();await view.flush();
 content=attachment('new-unversioned.pdf');view.render({card:{...source}});view.commit();await view.flush();assert.equal(reads,1);assert.equal(view.attachment().name,'old.pdf');view.unmount();
});

for(const failOld of [false,true]){
 test(`late old-source ${failOld?'failure':'success'} cannot overwrite a newer source`,async()=>{
  const old=deferred(),latest=deferred();let reads=0;const source=card(),view=preview({readAttachment:()=>++reads===1?old.promise:latest.promise},source);view.commit();
  view.render({card:{...source,originalPath:'01_sources/originals/new.pdf'}});view.commit();latest.resolve({ok:true,data:attachment('latest.pdf')});await view.flush();assert.equal(view.attachment()?.name,'latest.pdf');
  if(failOld)old.reject(Error('obsolete read failed'));else old.resolve(attachment('obsolete.pdf'));
  await view.flush();assert.equal(view.attachment().name,'latest.pdf');assert.equal(view.text().includes('obsolete'),false);view.unmount();
 });
}

test('API changes discard previous previews and late replies',async()=>{
 const old=deferred(),view=preview({readAttachment:()=>old.promise});view.commit();view.render({api:{readAttachment:async()=>attachment('new-api.pdf')}});assert.equal(view.attachment(),undefined);view.commit();await view.flush();old.resolve(attachment('old-api.pdf'));await view.flush();assert.equal(view.attachment().name,'new-api.pdf');view.unmount();
});

for(const [label,readAttachment,message] of [
 ['synchronous throw',()=>{throw Error('同步读取失败');},'同步读取失败'],
 ['promise rejection',()=>Promise.reject(Error('异步读取失败')),'异步读取失败'],
 ['IPC failure envelope',async()=>({ok:false,error:{message:'IPC 读取失败'}}),'IPC 读取失败'],
 ['empty error',()=>Promise.reject(Error('')),'原文件暂无法读取'],
 ['non-Error rejection',()=>Promise.reject(null),'原文件暂无法读取'],
 ['non-text error message',()=>Promise.reject({message:{unexpected:true}}),'原文件暂无法读取'],
 ]){
 test(`${label} safely displays a read failure`,async()=>{
  const view=preview({readAttachment,openOriginal:async()=>({ok:true,data:{opened:true}})});assert.doesNotThrow(()=>view.commit());await view.flush();assert.ok(view.text().includes(message));assert.equal(view.attachment(),undefined);assert.ok(view.button());view.unmount();
 });
}

for(const [label,openOriginal,message] of [
 ['synchronous throw',()=>{throw Error('同步打开失败');},'同步打开失败'],
 ['promise rejection',()=>Promise.reject(Error('异步打开失败')),'异步打开失败'],
 ['IPC failure envelope',async()=>({ok:false,error:{message:'IPC 打开失败'}}),'IPC 打开失败'],
 ]){
 test(`open-original ${label} is handled after an explicit click`,async()=>{
  let opens=0;const view=preview({readAttachment:async()=>({ok:false,error:{message:'读取失败'}}),openOriginal:(...args)=>{opens++;return openOriginal(...args);}});view.commit();await view.flush();assert.equal(opens,0);
  await assert.doesNotReject(async()=>view.button().props.onClick());await view.flush();assert.equal(opens,1);assert.ok(view.text().includes(message));view.unmount();
 });
}

test('late open-original failure cannot replace the new source preview',async()=>{
 const pending=deferred();let reads=0;const source=card(),view=preview({readAttachment:async()=>++reads===1?{ok:false,error:{message:'无法读取旧文件'}}:attachment('current.pdf'),openOriginal:()=>pending.promise},source);view.commit();await view.flush();const opening=Promise.resolve(view.button().props.onClick());
 view.render({card:{...source,originalPath:'01_sources/originals/current.pdf'}});view.commit();await view.flush();pending.resolve({ok:false,error:{message:'旧文件打开失败'}});await opening;await view.flush();assert.equal(view.attachment()?.name,'current.pdf');assert.equal(view.text().includes('旧文件打开失败'),false);view.unmount();
});

test('unmount ignores pending reads without setting component state',async()=>{
 const pending=deferred(),view=preview({readAttachment:()=>pending.promise});view.commit();view.unmount();const writes=view.writes();pending.resolve(attachment('unmounted.pdf'));await view.flush();assert.equal(view.writes(),writes);
});


test('a refreshed read failure immediately hides old bytes and cannot be replaced by an older reply',async()=>{
 const old=deferred(),source=card();let reads=0;
 const view=preview({readAttachment:()=>++reads===1?old.promise:Promise.resolve({ok:false,error:{message:'新原文件已移动'}})},source);view.commit();
 view.render({card:{...source,originalPath:'01_sources/originals/moved.pdf'}});view.commit();await view.flush();assert.ok(view.text().includes('新原文件已移动'));
 old.resolve(attachment('old.pdf'));await view.flush();assert.equal(view.attachment(),undefined);assert.ok(view.text().includes('新原文件已移动'));view.unmount();
});

test('API replacement hides an already-loaded preview before passive effects',async()=>{
 const view=preview({readAttachment:async()=>attachment('old-api.pdf')});view.commit();await view.flush();assert.equal(view.attachment().name,'old-api.pdf');
 view.render({api:{readAttachment:async()=>attachment('new-api.pdf')}});assert.equal(view.attachment(),undefined);view.commit();await view.flush();assert.equal(view.attachment().name,'new-api.pdf');view.unmount();
});

test('opening is user-triggered, uses the note path, and ignores failure after unmount',async()=>{
 const pending=deferred(),source=card(),opened=[];
 const view=preview({readAttachment:async()=>({ok:false,error:{message:'读取失败'}}),openOriginal:path=>{opened.push(path);return pending.promise;}},source);view.commit();await view.flush();assert.deepEqual(opened,[]);
 const opening=Promise.resolve(view.button().props.onClick());assert.deepEqual(opened,[source.path]);view.unmount();const writes=view.writes();pending.resolve({ok:false,error:{message:'打开失败'}});await opening;await view.flush();assert.equal(view.writes(),writes);
});

test('a missing open-original capability shows only the read error',async()=>{
 const view=preview({readAttachment:async()=>({ok:false,error:{message:'读取失败'}})});view.commit();await view.flush();assert.ok(view.text().includes('读取失败'));assert.equal(view.button(),null);view.unmount();
});

test('an open-original retry clears its old error, preserves the read error, and confirms only the request',async()=>{
 let reads=0,opens=0;const view=preview({readAttachment:async()=>{reads++;return {ok:false,error:{message:'原始读取失败'}};},openOriginal:async()=>++opens===1?{ok:false,error:{message:'第一次打开失败'}}:{ok:true,data:{opened:true}}});view.commit();await view.flush();
 await view.button().props.onClick();await view.flush();assert.ok(view.text().includes('第一次打开失败'));
 await view.button().props.onClick();await view.flush();assert.equal(reads,1);assert.equal(opens,2);assert.equal(view.text().includes('第一次打开失败'),false);assert.ok(view.text().includes('原始读取失败'));assert.ok(view.text().includes('已请求打开原文件'));view.unmount();
});

for(const latestFails of [false,true]){
 test(`overlapping open attempts keep the latest ${latestFails?'failure':'success'} when the older attempt returns last`,async()=>{
  const first=deferred(),second=deferred();let opens=0;
  const view=preview({readAttachment:async()=>({ok:false,error:{message:'原始读取失败'}}),openOriginal:()=>++opens===1?first.promise:second.promise});view.commit();await view.flush();
  // Reuse the handler to model rapid clicks before the next React render.
  const click=view.button().props.onClick,older=click(),newer=click();
  second.resolve(latestFails?{ok:false,error:{message:'最近打开失败'}}:{ok:true,data:{opened:true}});await newer;await view.flush();
  first.resolve(latestFails?{ok:true,data:{opened:true}}:{ok:false,error:{message:'过期打开失败'}});await older;await view.flush();
  assert.equal(opens,2);assert.equal(view.text().includes('过期打开失败'),false);
  assert.equal(view.text().includes('最近打开失败'),latestFails);assert.equal(view.text().includes('已请求打开原文件'),!latestFails);view.unmount();
 });
}

test('an old source open success cannot add a success notice to the new source error',async()=>{
 const pending=deferred(),source=card();let reads=0;
 const view=preview({readAttachment:async()=>({ok:false,error:{message:++reads===1?'旧来源读取失败':'新来源读取失败'}}),openOriginal:()=>pending.promise},source);view.commit();await view.flush();const opening=view.button().props.onClick();
 view.render({card:{...source,originalPath:'01_sources/originals/new-error.pdf'}});view.commit();await view.flush();pending.resolve({ok:true,data:{opened:true}});await opening;await view.flush();assert.ok(view.text().includes('新来源读取失败'));assert.equal(view.text().includes('已请求打开原文件'),false);view.unmount();
});

test('open success after unmount does not set state or show a success notice',async()=>{
 const pending=deferred(),view=preview({readAttachment:async()=>({ok:false,error:{message:'读取失败'}}),openOriginal:()=>pending.promise});view.commit();await view.flush();const opening=view.button().props.onClick();view.unmount();const writes=view.writes();pending.resolve({ok:true,data:{opened:true}});await opening;await view.flush();assert.equal(view.writes(),writes);assert.equal(view.text().includes('已请求打开原文件'),false);
});
