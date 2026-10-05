import React,{useEffect,useRef,useState} from 'react';
import AttachmentPreview from './AttachmentPreview.jsx';
import {valueOf} from '../desktopModel.js';
export default function VaultAttachmentPreview({card,api}){
 const [preview,setPreview]=useState(null),run=useRef(0),openRun=useRef(0);
 // These are the source/version fields supplied by the workspace adapter. A
 // byte-only file change without new metadata requires reopening the preview.
 const sourceKey=JSON.stringify([card.path,card.originalPath||'',card.originalMime||'',card.updatedAt||'']);
 useEffect(()=>{
  const request=++run.current,source={api,sourceKey,request};
  setPreview({...source,attachment:null,issue:''});
  async function read(){
   try{const attachment=valueOf(await api.readAttachment(card.path));if(request===run.current)setPreview({...source,attachment,issue:''});}
   catch(error){if(request===run.current)setPreview({...source,attachment:null,issue:(typeof error?.message==='string'&&error.message)||'原文件暂无法读取，请重试。'});}
  }
  void read();
  return()=>{run.current++;openRun.current++;};
 },[api,sourceKey]);
 // Hide the previous source immediately, including the render before cleanup.
 const current=preview?.api===api&&preview.sourceKey===sourceKey?preview:null;
 async function openOriginal(){
  const request=current?.request;
  if(request!==run.current)return;
  const attempt=++openRun.current;
  const update=patch=>{if(request!==run.current||attempt!==openRun.current)return;setPreview(previous=>previous?.request===request&&request===run.current&&attempt===openRun.current?{...previous,...patch}:previous);};
  update({openIssue:'',openNotice:'正在请求打开原文件…'});
  try{valueOf(await api.openOriginal(card.path));update({openIssue:'',openNotice:'已请求打开原文件'});}
  catch(error){update({openIssue:(typeof error?.message==='string'&&error.message)||'原文件未能打开，请重试。',openNotice:''});}
 }
 if(current?.issue)return <p className="sw-muted" role="status">{current.openIssue||current.issue}{current.openNotice&&<span> {current.openNotice}</span>}{typeof api.openOriginal==='function'&&<button onClick={openOriginal}>打开原文件</button>}</p>;
 if(!current?.attachment)return <p className="sw-muted" role="status">正在读取原文件…</p>;
 return <AttachmentPreview attachment={current.attachment}/>;
}
