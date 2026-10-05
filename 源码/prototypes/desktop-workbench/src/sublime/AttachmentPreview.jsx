import React,{useEffect,useRef,useState} from 'react';
import {IconDownload,IconLoader2} from '@tabler/icons-react';
import {attachmentBytes,attachmentKind,inspectDocxPreviewArchive} from './attachmentPreview.js';
import {documentSelectionText} from './documentText.js';
import {previewNativeAttachment} from './nativeFilePreview.js';
import './sublimeEditors.css';
import PdfAttachmentPreview from './PdfAttachmentPreview.jsx';

export default function AttachmentPreview({attachment,className='',compact=false,onNativePreview=previewNativeAttachment,index,onIndex,onExcerpt,highlights,onHighlight,onRemoveHighlight,onCopy,initialPage}) {
  const [url,setUrl]=useState(''),[status,setStatus]=useState('loading'),[error,setError]=useState(''),[text,setText]=useState(''),[notice,setNotice]=useState(''),[nativeImage,setNativeImage]=useState('');
  const run=useRef(0),mounted=useRef(true),native=useRef(onNativePreview),word=useRef(null);native.current=onNativePreview;
  const [wordSelection,setWordSelection]=useState(''),[selectionError,setSelectionError]=useState(''),[indexSaving,setIndexSaving]=useState(false),[query,setQuery]=useState('');
  const kind=attachmentKind(attachment);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;run.current++;};},[]);
  useEffect(()=>{
    const request=++run.current;let objectUrl='',worker,timer;setUrl('');setText('');setWordSelection('');setSelectionError('');setIndexSaving(false);setQuery('');setNativeImage('');setNotice('');setError('');setStatus('loading');
    if(!attachment){setStatus('idle');return;}
    try{
      const bytes=attachmentBytes(attachment);objectUrl=URL.createObjectURL(new Blob([bytes],{type:attachment.type}));setUrl(objectUrl);
      if(kind==='word'&&attachment.type.toLowerCase().includes('openxmlformats')){
        inspectDocxPreviewArchive(bytes.buffer);
        worker=new Worker(new URL('./attachmentWord.worker.js',import.meta.url),{type:'module'});
        const finish=()=>{clearTimeout(timer);worker.terminate();};
        worker.onmessage=event=>{finish();if(!mounted.current||request!==run.current)return;if(!event.data.ok){setError(event.data.error);setStatus('error');return;}setText(event.data.value.text);setNotice([event.data.value.truncated?'文字预览显示前 200,000 字。':'',...event.data.value.warnings].filter(Boolean).join(' '));setStatus(event.data.value.text.trim()?'ready':'empty');};
        worker.onerror=()=>{finish();if(mounted.current&&request===run.current){setError('无法加载 Word 文字预览，原文件仍保留。');setStatus('error');}};
        timer=setTimeout(()=>{finish();if(mounted.current&&request===run.current){setError('Word 预览超时，原文件仍保留。');setStatus('error');}},15000);
        worker.postMessage(bytes.buffer,[bytes.buffer]);
      }else if(kind==='word'){setStatus('unsupported');setNotice('当前浏览器不支持旧版 DOC 文字预览，原始 Word 文件仍保留。');}
      else if(kind==='pdf'){setStatus('ready');}
      else if(kind==='unsupported'){setStatus('unsupported');setNotice('此文件类型暂不支持预览。');}
    }catch(problem){setError(problem instanceof Error?problem.message:String(problem));setStatus('error');}
    return()=>{clearTimeout(timer);worker?.terminate();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[attachment?.dataUrl,attachment?.type,attachment?.size,attachment?.name,kind]);
  async function nativePreview(){const request=++run.current;setStatus('loading');setError('');try{const result=await native.current(attachment);if(!mounted.current||request!==run.current)return;if(result?.kind==='text'&&typeof result.body==='string'){const body=result.body.slice(0,200000);setText(body);setStatus(body.trim()?'ready':'empty');setNotice(['已在本机提取纯文字预览，原附件保持不变。',result.truncated||result.body.length>200000?'文字预览已截取。':'',...(result.warnings || [])].filter(Boolean).join(' '));}else if(result?.kind==='image'&&typeof result.dataUrl==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(result.dataUrl)){setNativeImage(result.dataUrl);setStatus('loading');setNotice(['已在本机转换预览，原始 HEIC/HEIF 文件保持不变。',...(result.warnings || [])].join(' '));}else throw new Error('未能生成可读取的预览。');}catch(problem){if(mounted.current&&request===run.current){setError(problem instanceof Error?problem.message:String(problem));setStatus('error');}}}
  if(!attachment)return null;
  function selectWord(){
    setWordSelection('');setSelectionError('');
    const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;
    const range=selection.getRangeAt(0);if(!word.current?.contains(range.startContainer)||!word.current.contains(range.endContainer))return;
    try{setWordSelection(documentSelectionText(selection.toString()));}catch(problem){setSelectionError(problem.message);}
  }
  async function indexWord(){const request=run.current;setIndexSaving(true);try{await onIndex?.({text,pages:[],pageCount:0,truncated:(notice.includes('已截取')||notice.includes('truncated'))||notice.includes('200,000'),indexedAt:new Date().toISOString()});if(request===run.current)setNotice('文字索引已保存到本机，资料库关键词搜索可找到 Word 正文。'+((notice.includes('已截取')||notice.includes('truncated'))||notice.includes('200,000')?' 本文档仅索引前200,000字。':''));}catch(problem){if(request===run.current)setError(problem.message);}finally{if(request===run.current)setIndexSaving(false);}}
  const term=query.trim(),parts=term?text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi')):[text];
  const image=kind==='image'||kind==='heic'||nativeImage;
  return <section className={`se-attachment-preview ${compact?'is-compact':''} ${className}`} aria-label={`附件预览：${attachment.name}`}>
    {url&&image&&<img className={`se-attachment-image ${status==='ready'?'is-ready':''}`} src={nativeImage||url} alt={attachment.name} onLoad={()=>{setStatus('ready');setError('');}} onError={()=>{setStatus('unsupported');setError(kind==='heic'?'当前浏览器无法预览此 HEIC/HEIF 图片，仍可保存和下载原文件。':'无法预览此图片，原文件仍保留。');}}/>}
    {kind==='pdf'&&<PdfAttachmentPreview attachment={attachment} initialPage={initialPage} index={index} onIndex={onIndex} onExcerpt={onExcerpt} highlights={highlights} onHighlight={onHighlight} onRemoveHighlight={onRemoveHighlight} onCopy={onCopy}/>}
    {url&&(kind==='video'||kind==='audio')&&(kind==='video'?<video className="se-attachment-video" src={url} controls preload="metadata" onLoadedMetadata={()=>{setStatus('ready');setError('');}} onError={()=>{setStatus('unsupported');setError('当前浏览器不支持此视频编码，原视频仍保留。');}}/>:<audio className="se-attachment-audio" src={url} controls preload="metadata" onLoadedMetadata={()=>{setStatus('ready');setError('');}} onError={()=>{setStatus('unsupported');setError('当前浏览器不支持此音频编码，原音频仍保留。');}}/>)}
    {text&&<><div className="se-document-tools">{onIndex&&<button type="button" className="se-secondary" disabled={indexSaving} onClick={indexWord}>{indexSaving?'正在保存索引…':index?'更新全文索引':'建立全文索引'}</button>}<input type="search" aria-label="搜索 Word 正文" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索 Word 正文"/>{term&&<span role="status">{Math.floor(parts.length/2)} 处匹配</span>}</div><pre className="se-attachment-word se-word-selection" ref={word} aria-label="Word 文字预览" onPointerUp={selectWord} onKeyUp={selectWord}>{parts.map((part,i)=>i%2?<mark key={i}>{part}</mark>:part)}</pre>{wordSelection&&<div className="se-document-tools">{onCopy&&<button type="button" className="se-secondary" onMouseDown={event=>event.preventDefault()} onClick={()=>onCopy(wordSelection)}>复制选文</button>}{onExcerpt&&<button type="button" className="se-secondary" onMouseDown={event=>event.preventDefault()} onClick={()=>onExcerpt({text:wordSelection,page:null,rects:[]})}>摘录为卡片</button>}</div>}</>}
    {status==='loading'&&<p className="se-attachment-status" role="status"><IconLoader2 className="se-spin" size={18}/>正在加载预览…</p>}
    {status==='empty'&&<p className="se-attachment-status">未找到可读取的文字，原文件仍保留。</p>}
    {selectionError&&<p className="se-attachment-error" role="alert">{selectionError}</p>}
    {notice&&<p className="se-attachment-notice">{notice}</p>}
    {error&&<p className="se-attachment-error" role="alert">{error}</p>}
    {((kind==='word'&&!attachment.type.toLowerCase().includes('openxmlformats')&&!text)||(kind==='heic'&&['unsupported','error'].includes(status)))&&typeof onNativePreview==='function'&&<button type="button" className="se-secondary" disabled={status==='loading'} onClick={nativePreview}>在本机预览</button>}
    {url&&<div className="se-attachment-download"><span>{attachment.name} · {(attachment.size/1024/1024).toFixed(2)} MB</span><a href={url} download={attachment.name}><IconDownload size={17}/>下载原文件</a></div>}
  </section>;
}
