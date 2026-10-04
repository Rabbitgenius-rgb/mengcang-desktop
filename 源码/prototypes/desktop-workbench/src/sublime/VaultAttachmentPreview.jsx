import React,{useEffect,useState} from 'react';
import AttachmentPreview from './AttachmentPreview.jsx';
import {valueOf} from '../desktopModel.js';
export default function VaultAttachmentPreview({card,api}){
 const [attachment,setAttachment]=useState(null),[issue,setIssue]=useState('');
 useEffect(()=>{let active=true;setAttachment(null);setIssue('');api.readAttachment(card.path).then(value=>{if(active)setAttachment(valueOf(value));}).catch(error=>{if(active)setIssue(error.message);});return()=>{active=false;};},[api,card.path]);
 if(issue)return <p className="sw-muted" role="status">{issue}<button onClick={()=>api.openOriginal(card.path)}>打开原文件</button></p>;
 if(!attachment)return <p className="sw-muted" role="status">正在读取原文件…</p>;
 return <AttachmentPreview attachment={attachment}/>;
}
