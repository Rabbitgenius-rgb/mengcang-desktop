import {normalizeWorkspaceState,serializeWorkspace,createWorkspaceState} from './workspaceModel.js';
const DB='mengcang-sublime-workspace-v1', FORMAT='workspace-storage-v2';
let opening;
const localChanges=new Map();
function database(){
 if(!opening)opening=new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspaces');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>{opening=null;reject(request.error||Error('本机资料库无法打开'));};
  request.onblocked=()=>{opening=null;reject(Error('本机资料库被其他窗口占用，请关闭旧预览后重试。'));};
 });return opening;
}
function snapshot(raw){
 if(raw?.format===FORMAT){
  if(!Number.isSafeInteger(raw.revision)||raw.revision<0||!raw.entityVersions||typeof raw.entityVersions!=='object')throw Error('资料库存储版本无效，请保留原数据。');
  return {state:normalizeWorkspaceState(raw.state),revision:raw.revision,entityVersions:{...raw.entityVersions}};
 }
 return {state:raw===undefined?createWorkspaceState():normalizeWorkspaceState(raw),revision:0,entityVersions:{}};
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function entities(state){
 const result=new Map();
 for(const [field,type] of [['cards','card'],['collections','collection'],['boards','board']])for(const item of state[field])result.set(`${type}:${item.id}`,item);
 for(const [id,value] of Object.entries(state.annotations))result.set(`note:${id}`,value);
 for(const [key,value] of Object.entries(state.drafts))result.set(`draft:${key}`,value);
 return result;
}
export function workspaceConflict(message,current){const error=Error(message||'另一个窗口已修改此内容，当前草稿保留，请核对最新内容后另存副本。');error.code='WORKSPACE_CONFLICT';error.snapshot=current;return error;}

// Read, compare and put share one IndexedDB readwrite transaction. Its lock is
// shared by all windows; the updater must stay synchronous to retain that lock.
export function createWorkspaceStore(identity='browser-preview',{openDatabase=database,createChannel=name=>typeof BroadcastChannel==='function'?new BroadcastChannel(name):null,eventTarget=typeof window==='object'?window:null}={}){
 const key=String(identity),listeners=new Set();let queue=Promise.resolve(),lastSnapshot,channel=null,disposed=false;
 async function loadSnapshot(){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('workspaces','readonly'),request=tx.objectStore('workspaces').get(key);let value;request.onsuccess=()=>{try{value=snapshot(request.result);}catch(error){reject(error);}};request.onerror=()=>reject(request.error);tx.oncomplete=()=>{if(value){lastSnapshot=value;resolve(value);}};tx.onerror=()=>reject(tx.error||Error('本机资料库读取失败'));tx.onabort=()=>reject(tx.error||Error('本机资料库读取中断'));});}
 function changed(){for(const listener of listeners)listener();}
 function focus(){changed();}
 function connect(){
  if(channel||disposed)return;
  try{channel=createChannel(DB);if(channel)channel.onmessage=event=>{if(event.data?.key===key)changed();};}catch{channel=null;}
  if(!localChanges.has(key))localChanges.set(key,new Set());localChanges.get(key).add(changed);
  eventTarget?.addEventListener?.('focus',focus);eventTarget?.addEventListener?.('pageshow',focus);
 }
 function disconnect(){channel?.close?.();channel=null;localChanges.get(key)?.delete(changed);if(!localChanges.get(key)?.size)localChanges.delete(key);eventTarget?.removeEventListener?.('focus',focus);eventTarget?.removeEventListener?.('pageshow',focus);}
 function publish(){for(const listener of localChanges.get(key)||[])listener();let sender=channel;try{if(!sender)sender=createChannel(DB);sender?.postMessage({key});}catch{/* Focus refresh works when a channel is unavailable. */}finally{if(sender&&sender!==channel)sender.close?.();}}
 function update(updater){
  const next=queue.catch(()=>{}).then(async()=>{
   const db=await openDatabase();
   const result=await new Promise((resolve,reject)=>{
    const tx=db.transaction('workspaces','readwrite'),objectStore=tx.objectStore('workspaces'),request=objectStore.get(key);let failure,result;
    request.onsuccess=()=>{try{
     const current=snapshot(request.result),changedState=updater(current.state,current);
     if(changedState&&typeof changedState.then==='function')throw Error('资料库事务更新必须同步完成。');
     const safe=JSON.parse(serializeWorkspace(changedState)),state=normalizeWorkspaceState(safe),revision=current.revision+1,entityVersions={...current.entityVersions},before=entities(current.state),after=entities(state);
     for(const name of new Set([...before.keys(),...after.keys()]))if(!equal(before.get(name),after.get(name)))entityVersions[name]=revision;
     result={state,revision,entityVersions};objectStore.put({format:FORMAT,...result},key);
    }catch(error){failure=error;tx.abort();}};
    request.onerror=()=>{failure=request.error;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error||Error('本机保存失败，草稿仍留在页面中。'));tx.onabort=()=>reject(failure||tx.error||Error('本机保存中断，草稿仍留在页面中。'));
   });
   lastSnapshot=result;publish();return result;
  });queue=next;return next;
 }
 return {
  loadSnapshot,load:async()=>(await loadSnapshot()).state,update,
  save(value){const expected=lastSnapshot?.revision;return update((current,meta)=>{if(expected===undefined?meta.revision!==0:meta.revision!==expected)throw workspaceConflict('其他窗口已更新资料库，旧快照未覆盖。请读取最新内容后重试。',meta);return value;}).then(()=>({saved:true}));},
  subscribe(listener){listeners.add(listener);connect();return()=>{listeners.delete(listener);if(!listeners.size)disconnect();};},
  close(){disposed=true;listeners.clear();disconnect();},
 };
}
