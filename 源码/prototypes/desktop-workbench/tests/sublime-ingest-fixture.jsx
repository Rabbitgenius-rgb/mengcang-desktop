// Browser fixture only: no native bridge, credentials, or real Vault access.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import SublimeWorkspace from '../src/sublime/SublimeWorkspace.jsx';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {workspaceReducer} from '../src/sublime/workspaceModel.js';
import fixtureUrl from '../../../tests/fixtures/discovery-excerpt.pdf?url';
const identity={id:'synthetic-reading-ingest-20261003',name:'合成验收仓库'};
const bytes=new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
const attachment={name:'合成入库验收.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+btoa(String.fromCharCode(...bytes))};
const store=createWorkspaceStore(identity.id),prior=await store.load();
if(!prior.cards.some(card=>card.id==='synthetic-file'))await store.save(workspaceReducer(workspaceReducer(prior,{type:'card.upsert',card:{id:'synthetic-file',title:'合成原文件',body:'仅用于接口界面验收，不写入真实仓库。',attachment}}),{type:'card.save',id:'synthetic-file',saved:true}));
function Fixture(){const [old,setOld]=useState(false),[receipt,setReceipt]=useState('尚未提交');const api={captureAvailable:true,captureAttachmentAvailable:!old,capture:async input=>{setReceipt(`合成接口收到：${input.attachment?.name||'仅文字'} · ${input.attachment?.size||0} bytes`);return {note:{path:'01_sources/cards/text/synthetic.md'}};}};return <><SublimeWorkspace identity={identity} api={api} connected demo={false}/><div style={{position:'fixed',zIndex:300,left:8,bottom:85,padding:8,font:'12px system-ui',background:'#673c23',color:'#fff',borderRadius:6}}><strong>合成验收 · 不写真实仓库</strong><label style={{display:'block'}}><input type="checkbox" aria-label="模拟旧连接器" checked={old} onChange={event=>setOld(event.target.checked)}/>模拟旧连接器</label><span role="status" aria-label="Synthetic capture receipt">{receipt}</span></div></>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
