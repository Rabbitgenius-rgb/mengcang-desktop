import {createWorkspaceState,normalizeWorkspaceState,workspaceReducer} from './workspaceModel.js';
import {workspaceConflict} from './workspaceStore.js';
const PREFIX='window-draft:';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const editorKey=key=>/^(?:edit:|new:|collection:|note:|board:)/.test(key);
const entityForKey=key=>key.startsWith('edit:')?`card:${key.slice(5)}`:key.startsWith('collection:')&&key!=='collection:new'?key:/^(?:note:|board:)/.test(key)?key:'';
function records(state){return Object.entries(state.drafts).filter(([id,value])=>id.startsWith(PREFIX)&&value&&typeof value==='object'&&typeof value.key==='string'&&editorKey(value.key)&&own(value,'value')).map(([id,value])=>({id,...value}));}
function createSessionId(){
 const provider=globalThis.crypto;
 return (provider&&typeof provider.randomUUID==='function'?provider.randomUUID():'')||`${Date.now()}-${Math.random()}`;
}

// Each live page receives a fresh owner. Reloaded/closed-window drafts remain in
// the backup and are automatically offered again by their logical editor key.
export function createWorkspaceSession(store,{sessionId=createSessionId()}={}) {
 let state=createWorkspaceState(),storageMeta={revision:0,entityVersions:{}},loaded=false,opening,tail=Promise.resolve(),revision=0,lastError=null,writing=0,refreshing=null;
 const atomic=typeof store.update==='function',pending=new Map(),listeners=new Set(),editBases=new Map(),adopted=new Map();let unsubscribeStore;
 const scoped=key=>`${PREFIX}${sessionId}:${encodeURIComponent(key)}`;
 function localDraft(key){const entry=state.drafts[scoped(key)]||adopted.get(key);return entry&&own(entry,'value')?entry.value:state.drafts[key];}
 function drafts(){
  const result=Object.fromEntries(Object.entries(state.drafts).filter(([key])=>!key.startsWith(PREFIX)));
  for(const key of new Set([...records(state).map(value=>value.key),...adopted.keys()])){const value=localDraft(key);if(value!==undefined)result[key]=value;}
  for(const [key,entry] of pending){if(entry.value===null)delete result[key];else result[key]=entry.value;}return result;
 }
 function recoverableDrafts(){return records(state).filter(value=>value.id!==scoped(value.key)||value.conflict).map(value=>({...value,value:structuredClone(value.value)})).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));}
 function adoptDrafts(){for(const entry of records(state).filter(value=>!value.recoveryOnly).reverse().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))))if(!state.drafts[scoped(entry.key)]&&!pending.has(entry.key)&&!adopted.has(entry.key))adopted.set(entry.key,{...entry,storageVersion:storageMeta.entityVersions[`draft:${entry.id}`]||0});}
 function emit(external=false,error=null){const meta={external,error,conflicts:records(state).filter(value=>value.conflict),recoverableDrafts:recoverableDrafts()};for(const listener of listeners)listener(state,meta);}
 function accept(snapshot){if(snapshot.revision<storageMeta.revision)return;state=normalizeWorkspaceState(snapshot.state);storageMeta=snapshot;}
 function pruneAdopted(){for(const [key,entry] of adopted)if(!state.drafts[entry.id]||state.drafts[entry.id].recoveryOnly)adopted.delete(key);}
 async function initialize(){
  if(loaded)return state;
  if(!opening)opening=(atomic&&store.loadSnapshot?store.loadSnapshot():store.load().then(value=>({state:value,revision:0,entityVersions:{}}))).then(value=>{accept(value);loaded=true;adoptDrafts();return state;}).catch(error=>{opening=null;throw error;});
  return opening;
 }
 async function refresh(){
  if(!loaded||!atomic||!store.loadSnapshot)return;
  if(!refreshing)refreshing=store.loadSnapshot().then(value=>{accept(value);pruneAdopted();emit(true);}).catch(error=>emit(true,error)).finally(()=>{refreshing=null;});
  return refreshing;
 }
 function beginEdit(key,{type,id}={}){
  const entry=state.drafts[scoped(key)]||adopted.get(key),entity=type&&id?`${type}:${id}`:entityForKey(key);
  if(entity)editBases.set(entity,entry?.base?.entity===entity?entry.base.version:entry?.conflict?-1:(storageMeta.entityVersions[entity]||0));
  return drafts()[key];
 }
 async function readDraft(id){
  await load();const entry=records(state).find(value=>value.id===id);if(!entry)throw Error('此草稿已不存在，请刷新恢复列表。');
  return {key:entry.key,value:structuredClone(entry.value),conflict:!!entry.conflict};
 }
 async function restoreDraft(id,{targetKey,transform,copy=false}={}){
  const source=await readDraft(id),key=targetKey||source.key;
  if(!editorKey(key))throw Error('此草稿不能恢复到当前编辑器。');
  const localBefore=structuredClone(drafts()[key]),pendingVersion=pending.get(key)?.version,adoptedBefore=adopted.get(key);let result,base;
  await commit((current,meta)=>{
   const entry=records(current).find(value=>value.id===id);if(!entry)throw Error('此草稿已不存在，请刷新恢复列表。');
   const value=structuredClone(transform?transform(structuredClone(entry.value)):entry.value),prior=current.drafts[scoped(key)]||(adoptedBefore&&current.drafts[adoptedBefore.id]),fallback=prior?prior.value:current.drafts[key],preserved=[];
   let next=current;
   // Explicit recovery must not discard a different draft already in this
   // editor, including input retained in memory after a failed disk write.
   for(const previous of [fallback,localBefore])if(previous!==undefined&&previous!==null&&JSON.stringify(previous)!==JSON.stringify(value)&&!preserved.some(item=>JSON.stringify(item)===JSON.stringify(previous))){
    preserved.push(previous);next=workspaceReducer(next,{type:'draft.set',key:`${PREFIX}${sessionId}:recovery:${createSessionId()}`,value:{key,value:structuredClone(previous),base:prior?.base||null,updatedAt:new Date().toISOString(),conflict:!!prior?.conflict,recoveryOnly:true}});
   }
   const entity=entityForKey(key);base=copy?(entity?{entity,version:meta.entityVersions?.[entity]||0}:null):entry.base||(entity?{entity,version:entry.conflict?-1:meta.entityVersions?.[entity]||0}:null);
   next=workspaceReducer(next,{type:'draft.set',key:scoped(key),value:{key,value,base,adoptedFrom:!copy&&id!==scoped(key)?{id,version:meta.entityVersions?.[`draft:${id}`]||0}:null,updatedAt:new Date().toISOString(),conflict:copy?false:!!entry.conflict}});
   result={key,value:structuredClone(value),conflict:copy?false:!!entry.conflict};return next;
  });
  if(pending.get(key)?.version===pendingVersion)pending.delete(key);
  adopted.delete(key);if(base?.entity)editBases.set(base.entity,base.version);emit();return result;
 }
 const resumeDraft=id=>restoreDraft(id);
 const copyDraft=(id,key,transform)=>restoreDraft(id,{targetKey:key,transform,copy:true});

 function commit(actions){
  writing++;
  const captured=new Map(),previousDrafts=new Map(),requested=typeof actions==='function'?actions:structuredClone(Array.isArray(actions)?actions:[actions]);
  if(typeof requested!=='function')for(const action of requested)if(action.type==='draft.set'){
   previousDrafts.set(action.key,drafts()[action.key]);
   const entry={version:++revision,value:structuredClone(action.value)};pending.set(action.key,entry);captured.set(action.key,entry.version);
   const entity=entityForKey(action.key);if(entity&&!editBases.has(entity))beginEdit(action.key);
  }
  const job=tail.catch(()=>{}).then(async()=>{
   await initialize();
   const apply=(current,meta)=>{
    if(typeof requested==='function')return normalizeWorkspaceState(requested(current,meta));
    const versions=meta.entityVersions||{},checks=new Map();
    for(const action of requested){let entity;
     if(action.type==='card.upsert')entity=`card:${action.card.id}`;
     else if(action.type==='collection.upsert')entity=`collection:${action.collection.id}`;
     else if(action.type==='collection.delete')entity=`collection:${action.id}`;
     else if(action.type==='board.upsert')entity=`board:${action.board.id}`;
     else if(action.type==='board.delete')entity=`board:${action.id}`;
     else if(action.type==='card.note')entity=`note:${action.id}`;
     if(entity){const expected=editBases.get(entity)??storageMeta.entityVersions[entity]??0;checks.set(entity,expected);if(atomic&&!editBases.has(entity))editBases.set(entity,expected);}
    }
    if(atomic)for(const [entity,expected] of checks)if((versions[entity]||0)!==expected)throw workspaceConflict('另一个窗口已修改此内容。最新版本未覆盖，当前草稿已保留；请核对后另存副本。',meta);
    const prepared=requested.flatMap(action=>{
     if(!atomic||action.type!=='draft.set'||!editorKey(action.key))return action;
     const entity=entityForKey(action.key),base=entity?{entity,version:editBases.get(entity)??storageMeta.entityVersions[entity]??0}:null,source=adopted.get(action.key),prior=state.drafts[scoped(action.key)],adoptedFrom=prior?.adoptedFrom?.id!==scoped(action.key)&&prior?.adoptedFrom?prior.adoptedFrom:source?.id&&source.id!==scoped(action.key)?{id:source.id,version:source.storageVersion||0}:null;
     const consumed=action.value===null&&adoptedFrom&&current.drafts[adoptedFrom.id]&&(versions[`draft:${adoptedFrom.id}`]||0)===adoptedFrom.version?[{type:'draft.set',key:adoptedFrom.id,value:{...current.drafts[adoptedFrom.id],recoveryOnly:true}}]:[];
     return [{...action,key:scoped(action.key),value:action.value===null?null:{key:action.key,value:action.value,base,adoptedFrom,updatedAt:new Date().toISOString(),conflict:!!(prior?.conflict||source?.conflict)}},...(action.value===null&&own(current.drafts,action.key)?[{type:'draft.set',key:action.key,value:null}]:[]),...consumed];
    });
    return prepared.reduce(workspaceReducer,current);
   };
   const next=atomic?await store.update(apply):{state:apply(state,storageMeta),revision:storageMeta.revision,entityVersions:{}};
   if(!atomic)await store.save(next.state);accept(next);lastError=null;
   for(const [key,version] of captured)if(pending.get(key)?.version===version){pending.delete(key);if(requested.some(action=>action.type==='draft.set'&&action.key===key&&action.value===null)){adopted.delete(key);}}
   for(const action of typeof requested==='function'?[]:requested){const entity=action.type==='card.upsert'?`card:${action.card.id}`:action.type==='collection.upsert'?`collection:${action.collection.id}`:action.type==='board.upsert'?`board:${action.board.id}`:action.type==='card.note'?`note:${action.id}`:null;if(entity)editBases.set(entity,next.entityVersions[entity]||0);}
   emit();return state;
  }).catch(async error=>{
   lastError=error;
   for(const [key,version] of captured)if(pending.get(key)?.version===version&&pending.get(key).value===null){const previous=previousDrafts.get(key);if(previous!==undefined)pending.set(key,{version,value:previous});else pending.delete(key);}
   if(error.code==='WORKSPACE_CONFLICT'&&atomic){
    if(error.snapshot)accept(error.snapshot);
    // Save the rejected input under this window, never replace the other
    // window's editor. Even a rejected save remains recoverable after reload.
    const editAction=typeof requested==='function'?null:requested.find(action=>['card.upsert','board.upsert','collection.upsert','card.note'].includes(action.type)),key=editAction?.type==='card.upsert'?`edit:${editAction.card.id}`:editAction?.type==='board.upsert'?`board:${editAction.board.id}`:editAction?.type==='collection.upsert'?`collection:${editAction.collection.id}`:editAction?.type==='card.note'?`note:${editAction.id}`:[...captured.keys()].find(editorKey);
    const fallback=editAction?.card||editAction?.board||editAction?.collection||(editAction?.type==='card.note'?{note:editAction.note||''}:undefined),value=key?(pending.get(key)?.value??previousDrafts.get(key)??fallback):undefined;
    if(key&&value!==undefined&&value!==null)try{const next=await store.update(current=>workspaceReducer(current,{type:'draft.set',key:scoped(key),value:{key,value,base:{entity:entityForKey(key),version:editBases.get(entityForKey(key))??0},updatedAt:new Date().toISOString(),conflict:true}}));accept(next);}catch(preserveError){error.message+=' 本机恢复副本暂未落盘，当前输入仍保留在此窗口：'+preserveError.message;}
   }
   emit(false,error);throw error;
  }).finally(()=>{writing--;});
  tail=job;return job;
 }
 async function wait(){let observed;do{observed=tail;await observed.catch(()=>{});}while(observed!==tail);}
 async function load(){await initialize();await wait();await refresh();return state;}
 async function settled(){await initialize();await wait();if(lastError||pending.size)throw lastError||Error('草稿尚未保存，请重试后再导出完整备份。');await refresh();return state;}
 function subscribe(listener){listeners.add(listener);if(!unsubscribeStore&&store.subscribe)unsubscribeStore=store.subscribe(()=>{void refresh();});return()=>{listeners.delete(listener);if(!listeners.size){unsubscribeStore?.();unsubscribeStore=null;}};}
 return {load,commit,settled,drafts,beginEdit,recoverableDrafts,readDraft,resumeDraft,copyDraft,subscribe,get state(){return state;},get writing(){return writing;}};
}
