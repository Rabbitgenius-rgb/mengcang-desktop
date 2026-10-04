import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import SublimeWorkspace from './sublime/SublimeWorkspace.jsx';
import {valueOf,normalizeRecord} from './desktopModel.js';
import './standalone.css';

export default function StandaloneApp(){
 const api=window.mengcang;
 const [data,setData]=useState(null),[issue,setIssue]=useState('');
 const epoch=useRef(0);
 const refresh=useCallback(async()=>{
  const run=++epoch.current;
  try{
   const status=valueOf(await api.status()),snapshot=valueOf(await api.snapshot());
   if(run!==epoch.current)return;
   setData({status,snapshot});
   setIssue(snapshot.errors?.length?`${snapshot.errors.length} 份原资料暂无法读取，其他卡片和本机草稿仍可使用。`:status.connected?'':status.message);
  }catch(error){if(run===epoch.current){setIssue(error.message);setData(previous=>previous||{status:{connected:false,identity:{id:'unpaired'}},snapshot:{materials:[],entries:[],books:[],capabilities:{}}});}}
 },[api]);
 useEffect(()=>{document.title='梦藏';void refresh();const stop=api.subscribe(event=>{if(event.type==='change'||event.type==='status')void refresh();});return()=>{epoch.current++;stop();};},[api,refresh]);
 const identity=data?.snapshot.identity||data?.status.identity;
 const workspaceApi=useMemo(()=>({...api,
  captureAvailable:data?.snapshot.capabilities?.capture===true,
  captureAttachmentAvailable:data?.snapshot.capabilities?.captureAttachment===true,
  discoveryStateGet:()=>api.discoveryStateGet(identity?.id||'unpaired'),
  discoveryStateSet:value=>api.discoveryStateSet(value,identity?.id||'unpaired'),
 }),[api,data?.snapshot.capabilities?.capture,data?.snapshot.capabilities?.captureAttachment,identity?.id]);
 const items=useMemo(()=>[...(data?.snapshot.entries||[]),...(data?.snapshot.materials||[]),...(data?.snapshot.books||[])].map(note=>normalizeRecord(note,api)),[data?.snapshot,api]);
 const ready=useCallback(()=>{void api.rendererReady();},[api]);
 if(!data)return <main className="standalone-loading" role="status">正在打开梦藏资料库…</main>;
 return <><SublimeWorkspace standalone items={items} api={workspaceApi} identity={identity} connected={data.status.connected} onRefresh={refresh} onReady={ready}/><div className="standalone-drag" aria-hidden="true"/>{issue&&<div className="standalone-status" role="status">{issue}<button onClick={refresh}>重新读取</button><button aria-label="关闭资料提示" onClick={()=>setIssue('')}>×</button></div>}</>;
}
