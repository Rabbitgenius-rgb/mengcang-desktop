import React,{useEffect,useMemo,useRef,useState} from 'react';
import {normalizeFeeds,publicSourceUrl,feedRecords,pendingFeedRecords,parseWebClip,bookmarkInstallerHtml,MAX_CLIP_BYTES} from './sourceFeeds.js';
import {dedupeImports} from '../discoveryModel.js';
import {requestWorkspaceDownload} from './workspaceDownload.js';
import './sourceFeeds.css';
const selectionKey=record=>record.sourceLocation||record.fingerprint;

export default function SourceFeeds({api,feeds=[],onFeedsChange,onImport,existingCards=[],onClose}){
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState(null),[selected,setSelected]=useState([]),[remove,setRemove]=useState('');
  const mounted=useRef(true),generation=useRef(0),fileRef=useRef(null),sources=normalizeFeeds(feeds);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const candidates=useMemo(()=>preview?preview.kind==='feed'?pendingFeedRecords(preview.records,existingCards):dedupeImports(preview.records,existingCards):{items:[],duplicates:0},[preview,existingCards]);
  const chosen=candidates.items.filter(item=>selected.includes(selectionKey(item)));
  async function loadFeed(value){
    if(busy)return;setError('');setMessage('');setPreview(null);setSelected([]);const run=++generation.current;setBusy(true);
    try{
      const source=publicSourceUrl(value),bridge=api?.captureFeed?api:globalThis.window?.mengcang;if(!bridge?.captureFeed)throw Error('读取公开订阅需要梦藏桌面版；当前环境仍可导入网页剪藏文件。');
      const response=await bridge.captureFeed(source);if(!mounted.current||generation.current!==run)return;
      if(!response?.ok)throw Error(response?.error?.message||'读取订阅失败，请重试。');
      const feed=response.data,records=feedRecords(feed),current=pendingFeedRecords(records,existingCards);
      setPreview({kind:'feed',title:feed.title,feed,records,source});setSelected(current.items.map(selectionKey));setUrl(source);
      if(sources.some(entry=>entry.url===source))await onFeedsChange(sources.map(entry=>entry.url===source?{...entry,title:feed.title,lastChecked:feed.fetchedAt,itemCount:records.length}:entry));
    }catch(e){if(mounted.current&&generation.current===run)setError(e.message||'读取订阅失败。');}finally{if(mounted.current&&generation.current===run)setBusy(false);}
  }
  async function saveSource(){
    if(!preview||busy)return;setBusy(true);setError('');try{
      if(sources.length>=100&&!sources.some(feed=>feed.url===preview.source))throw Error('最多保存 100 个来源，请先移除不再需要的订阅。');
      await onFeedsChange(normalizeFeeds([...sources.filter(feed=>feed.url!==preview.source),{url:preview.source,title:preview.feed.title,lastChecked:preview.feed.fetchedAt,itemCount:preview.records.length}]));
      if(mounted.current)setMessage('订阅来源已保存。需要更新时点击“刷新”，核对后再导入。');
    }catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}
  }
  async function importChosen(){if(!chosen.length||busy)return;setBusy(true);setError('');try{await onImport(chosen);if(mounted.current){setMessage(`已保存 ${chosen.length} 条内容。`);setPreview(null);setSelected([]);}}catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}}
  async function openFile(event){
    const file=event.target.files?.[0];event.target.value='';if(!file||busy)return;const run=++generation.current;setBusy(true);setError('');setMessage('');
    try{if(file.size>MAX_CLIP_BYTES)throw Error('剪藏文件不能超过 512 KiB。');const records=parseWebClip(await file.text());if(!mounted.current||run!==generation.current)return;setPreview({kind:'clip',title:'网页剪藏预览',records});setSelected(dedupeImports(records,existingCards).items.map(selectionKey));}catch(e){if(mounted.current&&run===generation.current)setError(e.message);}finally{if(mounted.current&&run===generation.current)setBusy(false);}
  }
  return <section className="sf-panel" aria-label="来源订阅与剪藏">
    <header><div><h1>来源订阅与剪藏</h1><p>保存公开 RSS / Atom 来源，手动更新文章与播客条目。</p></div>{onClose&&<button className="se-secondary" onClick={onClose} disabled={busy}>返回资料库</button>}</header>
    <form className="sf-add" onSubmit={event=>{event.preventDefault();return loadFeed(url);}}><label htmlFor="sf-url">公开订阅地址</label><div><input id="sf-url" type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://example.com/feed.xml" disabled={busy} required/><button className="sw-primary" disabled={busy||!url.trim()}>{busy?'正在处理…':'读取并预览'}</button></div></form>
    {error&&<p className="sf-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <div className="sf-sources" aria-label="已保存的订阅">{!sources.length?<p className="sw-muted">还没有订阅。先读取地址，核对内容后保存来源。</p>:sources.map(feed=><article key={feed.url}><div><strong>{feed.title}</strong><small>{feed.url}</small><small>{feed.lastChecked?`上次读取：${new Date(feed.lastChecked).toLocaleString('zh-CN')} · ${feed.itemCount} 条`: '尚未读取'}</small></div><button className="se-secondary" disabled={busy} onClick={()=>loadFeed(feed.url)}>刷新</button>{remove===feed.url?<><button className="se-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await onFeedsChange(sources.filter(value=>value.url!==feed.url));setRemove('');setMessage('来源已移除，已保存的卡片继续保留。');}catch(e){setError(e.message);}finally{if(mounted.current)setBusy(false);}}}>确认移除来源</button><button className="se-secondary" onClick={()=>setRemove('')}>取消</button></>:<button className="se-secondary" disabled={busy} onClick={()=>setRemove(feed.url)}>移除</button>}</article>)}</div>
    <aside className="sf-clip"><h2>网页剪藏</h2><p>用浏览器书签保存选中文字或文章正文，检查后下载，再导入梦藏。</p><div><button className="se-secondary" disabled={busy} onClick={()=>{try{requestWorkspaceDownload(bookmarkInstallerHtml(),'梦藏-网页剪藏安装.html','text/html');setMessage('已请求下载剪藏安装页。用浏览器打开文件，将按钮拖入书签栏。');}catch(e){setError(e.message);}}}>下载剪藏书签安装页</button><button className="se-secondary" disabled={busy} onClick={()=>fileRef.current?.click()}>导入剪藏文件</button><input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={openFile}/></div></aside>
    {preview&&<section className="sf-preview" aria-label="待保存内容"><header><div><h2>{preview.title}</h2><p>{candidates.items.length} 条可导入 · {candidates.duplicates} 条已存在</p></div>{preview.kind==='feed'&&<button className="se-secondary" disabled={busy} onClick={saveSource}>{sources.some(feed=>feed.url===preview.source)?'更新来源信息':'保存订阅来源'}</button>}</header>{preview.feed?.warnings?.map(warning=><p className="sw-muted" key={warning}>{warning}</p>)}{preview.records.some(record=>record.type==='audio'||record.type==='video')&&<p className="sw-muted">音视频条目保存简介与公开原文件链接。此处不自动下载媒体或生成转录。</p>}<div className="sf-select"><button className="se-secondary" disabled={busy||!candidates.items.length} onClick={()=>setSelected(candidates.items.map(selectionKey))}>全选</button><button className="se-secondary" disabled={busy} onClick={()=>setSelected([])}>取消全选</button></div><div className="sf-preview-list">{candidates.items.map(record=><label key={selectionKey(record)} className="sf-preview-item"><input type="checkbox" disabled={busy} checked={selected.includes(selectionKey(record))} onChange={event=>setSelected(value=>event.target.checked?[...value,selectionKey(record)]:value.filter(item=>item!==selectionKey(record)))}/><span><strong>{record.title}</strong><small>{record.date?new Date(record.date).toLocaleDateString('zh-CN')+' · ':''}{record.type==='audio'?'播客或音频':record.type==='video'?'视频':'文章或摘录'}</small><p>{record.body.slice(0,1200)}{record.body.length>1200?'…':''}</p><small>{record.sourceUrl}</small></span></label>)}</div><footer><button className="se-secondary" disabled={busy} onClick={()=>setPreview(null)}>关闭预览</button><button className="sw-primary" disabled={busy||!chosen.length} onClick={importChosen}>{busy?'正在保存…':`保存选中 ${chosen.length} 条`}</button></footer></section>}
  </section>;
}
