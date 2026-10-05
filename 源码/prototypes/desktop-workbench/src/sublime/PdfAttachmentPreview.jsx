import React,{useEffect,useMemo,useRef,useState} from 'react';
import {GlobalWorkerOptions,getDocument,TextLayer} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {attachmentBytes} from './attachmentPreview.js';
import {pdfDocumentOptions,fitPdfViewport} from './pdfPreview.js';
import {indexPdfDocument,documentMatches,pdfPageText,pdfSearchParts,selectionInPage} from './documentText.js';
GlobalWorkerOptions.workerSrc=workerUrl;
const assetBase=import.meta.env.BASE_URL+'pdf-assets/';
function selectionBoundary(selection,layer,text){
 if(!selection||selection.isCollapsed||!selection.rangeCount||selection.toString()!==text)return null;
 const range=selection.getRangeAt(0);
 if(!layer?.contains(range.startContainer)||!layer.contains(range.endContainer))return null;
 return {start:range.startContainer,end:range.endContainer,startOffset:range.startOffset,endOffset:range.endOffset};
}

export default function PdfAttachmentPreview({attachment,index:storedIndex,onIndex,onExcerpt,highlights=[],onHighlight,onRemoveHighlight,onCopy,initialPage=1}){
 const container=useRef(null),canvas=useRef(null),layer=useRef(null),sheet=useRef(null),documentRef=useRef(null),pageText=useRef(null),run=useRef(0),unlock=useRef(null),callbacks=useRef({}),selectionVersion=useRef(0);callbacks.current={onIndex,onExcerpt,onHighlight,onRemoveHighlight,onCopy};
 const [pages,setPages]=useState(0),[page,setPage]=useState(1),[width,setWidth]=useState(580),[status,setStatus]=useState('loading'),[error,setError]=useState(''),[password,setPassword]=useState(''),[needsPassword,setNeedsPassword]=useState(false),[paint,setPaint]=useState(0),[zoom,setZoom]=useState(1),[selection,setSelection]=useState(null),[selectionError,setSelectionError]=useState(''),[index,setIndex]=useState(storedIndex||null),[indexing,setIndexing]=useState(false),[progress,setProgress]=useState(''),[query,setQuery]=useState(''),[match,setMatch]=useState(0),[notice,setNotice]=useState('');
 const matches=useMemo(()=>documentMatches(index?.pages||[],query),[index,query]);
 const [renderedText,setRenderedText]=useState(null);
 const indexedPage=index?.pages?.find(item=>item.page===page);
 const indexNeedsUpdate=!!index&&!index.truncated&&renderedText?.page===page&&indexedPage&&indexedPage.text!==renderedText.text;
 useEffect(()=>{const element=container.current;if(!element)return;const observer=new ResizeObserver(entries=>setWidth(Math.floor(entries[0].contentRect.width)));observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const request=++run.current;let task,timer;documentRef.current=null;pageText.current=null;setPages(0);setPage(1);setStatus('loading');setError('');setNeedsPassword(false);setPassword('');selectionVersion.current++;setSelection(null);setSelectionError('');setIndex(storedIndex||null);setIndexing(false);setQuery('');setZoom(1);setNotice('');
  try{
   task=getDocument(pdfDocumentOptions(attachmentBytes(attachment),assetBase));
   task.onPassword=(update,reason)=>{if(request!==run.current)return;clearTimeout(timer);unlock.current=update;setNeedsPassword(true);setStatus('password');setError(reason===2?'密码不正确，请重试。':'');};
   timer=setTimeout(()=>{if(request===run.current){setError('PDF 加载超时，原文件仍保留。');setStatus('error');void task.destroy();}},20000);
   task.promise.then(pdf=>{clearTimeout(timer);if(request!==run.current){void pdf.destroy();return;}documentRef.current=pdf;unlock.current=null;setNeedsPassword(false);setPassword('');setPages(pdf.numPages);setPage(Math.max(1,Math.min(pdf.numPages,Number(initialPage)||1)));setPaint(value=>value+1);}).catch(problem=>{clearTimeout(timer);if(request===run.current){setError(problem.message||'PDF 无法读取，原文件仍保留。');setStatus('error');}});
  }catch(problem){setError(problem.message);setStatus('error');}
  return()=>{run.current++;clearTimeout(timer);unlock.current=null;documentRef.current=null;void task?.destroy();};
 },[attachment.dataUrl,initialPage]);
 useEffect(()=>{
  const pdf=documentRef.current;if(!pdf||!canvas.current||!layer.current||!width)return;let cancelled=false,render,textLayer;
  const target=canvas.current,textContainer=layer.current;pageText.current=null;setStatus('rendering');setError('');selectionVersion.current++;setSelection(null);setSelectionError('');textContainer.replaceChildren();
  pdf.getPage(page).then(async pdfPage=>{
   if(cancelled)return;const fit=fitPdfViewport(pdfPage,width,window.devicePixelRatio||1,zoom);target.width=fit.width;target.height=fit.height;target.style.width=fit.viewport.width+'px';target.style.height=fit.viewport.height+'px';sheet.current.style.width=fit.viewport.width+'px';sheet.current.style.height=fit.viewport.height+'px';textContainer.style.setProperty('--total-scale-factor',String(fit.viewport.scale*(fit.viewport.userUnit||1)));
   render=pdfPage.render({canvasContext:target.getContext('2d'),viewport:fit.viewport,transform:fit.transform,background:'rgb(255,255,255)'});await render.promise;if(cancelled)return;
   const content=await pdfPage.getTextContent();if(cancelled)return;textLayer=new TextLayer({textContentSource:content,container:textContainer,viewport:fit.viewport});await textLayer.render();if(!cancelled){pageText.current={content,divs:textLayer.textDivs};setRenderedText({page,text:pdfPageText(content)});setStatus('ready');setPainted(value=>value+1);}
  }).catch(problem=>{if(!cancelled&&problem.name!=='RenderingCancelledException'){setError(problem.message||'这一页无法预览。');setStatus('error');}});
  return()=>{cancelled=true;render?.cancel();textLayer?.cancel();};
 },[page,width,paint,zoom]);
 const [painted,setPainted]=useState(0);
 useEffect(()=>{
  const rendered=pageText.current;if(!rendered)return;
  const parts=pdfSearchParts(rendered.content,query);
  rendered.divs.forEach((div,i)=>div.replaceChildren(...(parts[i]||[]).map(part=>{
   if(!part.matched)return document.createTextNode(part.text);
   const mark=document.createElement('mark');mark.className='is-search-match';mark.textContent=part.text;return mark;
  })));
 },[query,painted]);
 function captureSelection(){
  selectionVersion.current++;setSelection(null);setSelectionError('');
  try{setSelection(selectionInPage(window.getSelection(),layer.current,page));}catch(problem){setSelectionError(problem.message);}
 }
 async function buildIndex(){const request=run.current,pdf=documentRef.current;if(!pdf||indexing)return;setIndexing(true);setError('');setProgress('');try{const value=await indexPdfDocument(pdf,{cancelled:()=>request!==run.current,onProgress:(done,total)=>{if(request===run.current)setProgress(`${done} / ${total}`);}});if(request!==run.current)return;await callbacks.current.onIndex?.(value);if(request!==run.current)return;setIndex(value);setNotice(value.truncated?'已建立部分索引；达到页数、文字量或时间上限，原文件完整保留。':value.text.trim()?callbacks.current.onIndex?'全文索引已保存到本机，资料库关键词搜索可以找到附件正文。':'全文已在当前预览读取。':'没有可提取的文字；扫描件的 OCR 保持暂停。');}catch(problem){if(request===run.current)setError(problem.message);}finally{if(request===run.current)setIndexing(false);}}
 async function selectedAction(action){
  if(!selection)return;
  const request=run.current,version=selectionVersion.current,originLayer=layer.current,boundary=selectionBoundary(window.getSelection(),originLayer,selection.text);
  const current=()=>request===run.current&&version===selectionVersion.current;
  try{
   await callbacks.current[action]?.(selection);
   if(action==='onHighlight'&&current()){
    const active=window.getSelection(),latest=selectionBoundary(active,originLayer,selection.text);
    // A different page, new selection or another component owns its own range.
    // Clear the browser selection only if its exact original boundaries remain.
    if(boundary&&latest&&Object.keys(boundary).every(key=>boundary[key]===latest[key]))active.removeAllRanges();
    selectionVersion.current++;setSelection(null);setNotice('高亮已保存在本机。');
   }
  }catch(problem){if(current())setError(problem.message);}
 }
 function nextMatch(direction){if(!matches.length)return;const next=(match+direction+matches.length)%matches.length;setMatch(next);setPage(matches[next].page);}
 return <div className="se-pdf-reader" ref={container} aria-label={`PDF 预览：${attachment.name}`}>
  {pages>0&&<><div className="se-pdf-toolbar"><button type="button" className="se-secondary" aria-label="PDF 上一页" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><label>第 <input type="number" min={1} max={pages} aria-label="PDF 页码" value={page} onChange={event=>{const value=Number(event.target.value);if(Number.isInteger(value)&&value>=1&&value<=pages)setPage(value);}}/> / {pages} 页</label><button type="button" className="se-secondary" aria-label="PDF 下一页" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>下一页</button><label>缩放 <select aria-label="PDF 缩放" value={zoom} onChange={event=>setZoom(Number(event.target.value))}>{[[0.5,'50%'],[1,'适合宽度'],[1.5,'150%'],[2,'200%'],[3,'300%']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
  <div className="se-document-tools"><button type="button" className="se-secondary" disabled={indexing} onClick={buildIndex}>{indexing?`正在索引 ${progress}`:index?'更新全文索引':'建立全文索引'}</button><input type="search" aria-label="搜索 PDF 正文" placeholder="搜索 PDF 正文" value={query} onChange={event=>{const value=event.target.value;setQuery(value);setMatch(0);const first=documentMatches(index?.pages||[],value)[0];if(first)setPage(first.page);}}/>{query&&<><span role="status">{index?matches.length?`${match+1} / ${matches.length} 处`:'没有匹配':'请先建立全文索引'}</span><button type="button" className="se-secondary" aria-label="PDF 上一处匹配" disabled={!matches.length} onClick={()=>nextMatch(-1)}>↑</button><button type="button" className="se-secondary" aria-label="PDF 下一处匹配" disabled={!matches.length} onClick={()=>nextMatch(1)}>↓</button></>}</div></>}
  {needsPassword&&<form className="se-pdf-password" onSubmit={event=>{event.preventDefault();if(!password)return;setError('');setStatus('loading');unlock.current?.(password);setPassword('');}}><label>PDF 密码<input type="password" aria-label="PDF 密码" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="off"/></label><button type="submit" className="se-secondary">解锁本机预览</button></form>}
  {(status==='loading'||status==='rendering')&&<p role="status">正在读取 PDF…</p>}
  {selectionError&&<p role="alert" className="se-attachment-error">{selectionError}</p>}
  {error&&<p role="alert" className="se-attachment-error">{error}</p>}
  {indexNeedsUpdate&&<p role="status" className="se-attachment-notice">请点「更新全文索引」以检索完整正文。原文件与已保存高亮仍保留。</p>}
  <div className="se-pdf-page" hidden={!pages}><div className="se-pdf-sheet" ref={sheet}><canvas ref={canvas} role="img" aria-label={`PDF 第 ${page} 页，共 ${pages} 页`}/><div className="se-pdf-highlights" aria-hidden="true">{highlights.filter(item=>item.page===page).flatMap(item=>item.rects.map((rect,i)=><i key={`${item.id}-${i}`} style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`}}/>))}</div><div className="se-pdf-textLayer" ref={layer} onPointerUp={captureSelection} onKeyUp={captureSelection}/></div></div>
  {selection&&<div className="se-document-tools se-selection-tools" role="group" aria-label="PDF 选文操作"><small>已选 {selection.text.length} 字 · 第 {selection.page} 页</small>{onCopy&&<button type="button" className="se-secondary" onMouseDown={event=>event.preventDefault()} onClick={()=>callbacks.current.onCopy(selection.text)}>复制选文</button>}{onHighlight&&<button type="button" className="se-secondary" onMouseDown={event=>event.preventDefault()} onClick={()=>selectedAction('onHighlight')}>高亮选文</button>}{onExcerpt&&<button type="button" className="se-secondary" onMouseDown={event=>event.preventDefault()} onClick={()=>selectedAction('onExcerpt')}>摘录为卡片</button>}</div>}
  {highlights.length>0&&<details className="se-saved-highlights"><summary>已保存高亮 · {highlights.length}</summary>{highlights.map(item=><div key={item.id}><button type="button" className="se-secondary" onClick={()=>setPage(item.page)}>第 {item.page} 页</button><p>{item.text}</p>{onExcerpt&&<button type="button" className="se-secondary" onClick={()=>callbacks.current.onExcerpt(item)}>摘录为卡片</button>}{onRemoveHighlight&&<button type="button" className="se-secondary" onClick={()=>callbacks.current.onRemoveHighlight(item.id)}>移除高亮</button>}</div>)}</details>}
  {notice&&<p role="status" className="se-attachment-notice">{notice}</p>}
  <p className="se-attachment-notice">拖动选择文字，可复制、高亮或摘录。文字提取在本机完成，不调用 AI。</p>
 </div>;
}
