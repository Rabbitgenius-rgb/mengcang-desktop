// Browser-only fixture. Recorded OCR result playback, no native/helper/model,
// credentials, real Vault access or product API endpoint is available here.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import SublimeWorkspace from '../src/sublime/SublimeWorkspace.jsx';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {workspaceReducer} from '../src/sublime/workspaceModel.js';
import recorded from './fixtures/ocr-chinese-corrected-playback.json';
import pdfUrl from './fixtures/ocr-chinese-scanned.pdf?url';

const identity={id:'ocr-pages-playback-20261015-c8552f1b-7dce-4d62-8337-f8d34ff32146',name:'OCR分页离线回放隔离仓库'};
const cardId='synthetic-ocr-scan';
const bytes=new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer());
let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
const base64=btoa(binary);
const attachment={name:'两页中文扫描 PDF（合成验收）.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${base64}`};
const store=createWorkspaceStore(identity.id),prior=await store.load();
if(!prior.cards.some(card=>card.id===cardId))await store.save([
 {type:'card.upsert',card:{id:cardId,path:cardId,title:'【离线回放验收】两页中文扫描 PDF',body:'合成验收原正文：保存 OCR 只增加识别文字和真实分页，原正文与原附件保持不变。',caption:'仅用于隔离浏览器验收，不写真实资料库。',type:'file',origin:'local',createdAt:'2026-10-15T08:00:00.000Z',attachment}},
 {type:'card.save',id:cardId,saved:true},
].reduce(workspaceReducer,prior));
if(!location.hash)history.replaceState(null,'',`${location.pathname}#/card/${cardId}`);
const countKey=`${identity.id}:replay-count`,blockedKey=`${identity.id}:blocked-count`;
let replayCount=Number(sessionStorage.getItem(countKey)||0),blockedCount=Number(sessionStorage.getItem(blockedKey)||0);
const settings={nativeEnabled:true,generationEnabled:false,provider:'api',endpoint:'https://offline-playback.invalid/v1',model:'recorded-result-only',transcriptionProvider:'local',localTranscriptionEnabled:false};

function Fixture(){
 const [counts,setCounts]=useState({replay:replayCount,blocked:blockedCount});
 const api={
  captureAvailable:false,captureAttachmentAvailable:false,
  intelligenceStatus:async()=>({ok:true,data:{settings,usage:{nativeRequests:0,localTranscriptionRequests:0,generationRequests:0,cloudRequests:0},localTranscription:{ready:false}}}),
  intelligenceRequest:async input=>{
   if(input?.action!=='extract'||input.kind!=='pdf'||input.base64!==base64){blockedCount++;sessionStorage.setItem(blockedKey,String(blockedCount));setCounts({replay:replayCount,blocked:blockedCount});throw Error('离线验收已拒绝该动作：只允许回放这份合成 PDF 的已录制识别结果，不能调用任何模型。');}
   replayCount++;sessionStorage.setItem(countKey,String(replayCount));setCounts({replay:replayCount,blocked:blockedCount});
   return {ok:true,data:{...structuredClone(recorded),local:true}};
  },
 };
 return <><style>{`.sublime-workspace{top:76px!important}.ocr-fixture-banner{position:fixed;inset:0 0 auto;z-index:10000;box-sizing:border-box;height:76px;padding:9px 20px;background:#fff3c4;border-bottom:2px solid #a87713;color:#422f08;font:14px/1.5 system-ui;pointer-events:none}.ocr-fixture-banner strong{font-size:17px}.ocr-fixture-banner span{margin-left:16px}`}</style><SublimeWorkspace identity={identity} api={api} connected demo={false}/><aside className="ocr-fixture-banner" aria-label="离线 OCR 验收边界"><strong>离线结果回放，不调用模型、不写真实资料库</strong><span>独立浏览器 IndexedDB · 原 PDF 与录制结果均为合成验收素材</span><div role="status" aria-label="离线回放计数">结果回放 {counts.replay} 次 · 真实本机识别 0 次 · 生成请求 0 次 · 云端请求 0 次 · 被拒绝动作 {counts.blocked} 次</div></aside></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
