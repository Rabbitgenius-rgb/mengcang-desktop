import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {epubChapterIndex,epubProgress,openEpub,readEpubSource,searchEpub} from './epubReaderModel.js';
import './epubBookReader.css';

const message=error=>String(error?.message||error||'EPUB 读取失败。').slice(0,400);
const progressOf=element=>element.scrollHeight>element.clientHeight?epubProgress(element.scrollTop/(element.scrollHeight-element.clientHeight)):0;
const safeNumber=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
function readyImage(url){return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src=url;});}

function chapterMarks(annotations,chapter,length){return (annotations||[]).filter(item=>item.type!=='bookmark'&&item.locator?.chapter===chapter&&Number.isFinite(item.locator?.start)&&Number.isFinite(item.locator?.end)).map(item=>({id:item.id,start:Math.max(0,item.locator.start),end:Math.min(length,item.locator.end)})).filter(item=>item.end>item.start);}

function renderChapter(tree,images,marks,activateLink){
  let offset=0,serial=0;
  function render(node){
    if(typeof node==='string'){
      const start=offset;offset+=node.length;const intersect=marks.filter(mark=>mark.start<offset&&mark.end>start);
      if(!intersect.length)return node;
      const boundaries=[...new Set([start,offset,...intersect.flatMap(mark=>[Math.max(start,mark.start),Math.min(offset,mark.end)])])].sort((a,b)=>a-b);
      return boundaries.slice(0,-1).map((position,index)=>{const end=boundaries[index+1],match=intersect.find(mark=>mark.start<end&&mark.end>position),text=node.slice(position-start,end-start);return match?<mark key={'m'+serial++} data-reader-highlight={match.id||'saved'}>{text}</mark>:text;});
    }
    const {tag,attrs={},children=[]}=node,props={key:'n'+serial++};
    if(attrs.anchor)props['data-epub-anchor']=attrs.anchor;if(attrs.lang)props.lang=attrs.lang;
    // Placeholder labels remain accessible and visible through CSS, but are
    // absent from the book's DOM text. They must not shift saved text offsets.
    if(tag==='img')return images[attrs.imagePath]?<img {...props} src={images[attrs.imagePath]} alt={attrs.alt||''} loading="lazy" decoding="async"/>:<span {...props} className="mc-epub-image-placeholder" role="img" aria-label={attrs.alt||'图片暂不可用'}/>;
    if(tag==='a'){props.href='#';props.onClick=event=>{event.preventDefault();activateLink(attrs.href);};}
    if(attrs.colspan)props.colSpan=attrs.colspan;if(attrs.rowspan)props.rowSpan=attrs.rowspan;
    if(['br','hr'].includes(tag))return React.createElement(tag,props);
    return React.createElement(tag,props,children.map(render));
  }
  return tree.map(render);
}

export default function EpubBookReader({source,location={},settings={},annotations=[],navigateTo,onLocation,onReady,onSelection,onError}){
  const [book,setBook]=useState(null),[chapter,setChapter]=useState(0),[images,setImages]=useState({}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[activeHit,setActiveHit]=useState(-1),[imageWarning,setImageWarning]=useState('');
  const article=useRef(null),viewport=useRef(null),restore=useRef(null),restoring=useRef(true),callbacks=useRef({}),sourceLocation=useRef(location),navigation=useRef(null),frame=useRef(0),scrollFrame=useRef(0),loadSequence=useRef(0),lastPosition=useRef(null);
  callbacks.current={onLocation,onReady,onSelection,onError};sourceLocation.current=location;
  const sourceIdentity=source?.sourceKey||source?.url||source?.dataUrl;
  const hits=useMemo(()=>book?searchEpub(book,search):[],[book,search]);
  const selected=book?.chapters[chapter];
  const emitLocation=useCallback(()=>{const element=viewport.current;if(element&&book&&!restoring.current){const value={chapter,progress:progressOf(element),totalChapters:book.chapters.length};lastPosition.current=value;callbacks.current.onLocation?.(value);}},[book,chapter]);

  useEffect(()=>{
    const controller=new AbortController(),sequence=++loadSequence.current;let alive=true;
    setBook(null);setLoading(true);setError('');setQuery('');setSearch('');setActiveHit(-1);restoring.current=true;navigation.current=null;
    (async()=>{
      try{
        const bytes=await readEpubSource(source,{signal:controller.signal});if(!alive)return;
        const next=await openEpub(bytes,{signal:controller.signal});if(!alive||sequence!==loadSequence.current)return;
        const initial=sourceLocation.current||{},target=epubChapterIndex(initial.chapter,next.chapters.length);
        restore.current={chapter:target,progress:epubProgress(initial.progress)};lastPosition.current=restore.current;setChapter(target);setBook(next);setLoading(false);
        callbacks.current.onReady?.({totalChapters:next.chapters.length,outline:next.outline,title:next.title,author:next.author});
      }catch(reason){if(!alive||reason?.name==='AbortError')return;const text=message(reason);setError(text);setLoading(false);callbacks.current.onError?.(text);}
    })();
    return()=>{alive=false;controller.abort();cancelAnimationFrame(frame.current);cancelAnimationFrame(scrollFrame.current);};
  },[sourceIdentity]);

  const go=useCallback(target=>{
    if(!book)return;const locator=target?.locator||target||{},next=epubChapterIndex(locator.chapter,book.chapters.length);
    restoring.current=true;restore.current={...locator,chapter:next,progress:epubProgress(locator.progress)};
    if(next===chapter){setChapter(next);setActiveHit(previous=>previous);applyLocation();}else setChapter(next);
  // applyLocation is read at event time after its declaration.
  },[book,chapter]);

  function applyLocation(){
    cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{
      frame.current=0;
      const target=restore.current,scroller=viewport.current,content=article.current;if(!target||!scroller||!content||target.chapter!==chapter)return;
      scroller.scrollTop=target.progress*Math.max(0,scroller.scrollHeight-scroller.clientHeight);
      if(target.fragment){const anchor=Array.from(content.querySelectorAll('[data-epub-anchor]')).find(node=>node.dataset.epubAnchor===target.fragment);if(anchor)scroller.scrollTop+=anchor.getBoundingClientRect().top-scroller.getBoundingClientRect().top-25;}
      else if(Number.isFinite(target.start)){
        const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);let remaining=Math.max(0,target.start),node;while((node=walker.nextNode())){if(remaining<=node.textContent.length){const range=document.createRange();range.setStart(node,remaining);range.setEnd(node,Math.min(node.textContent.length,remaining+1));const rect=range.getBoundingClientRect();if(rect.height)scroller.scrollTop+=rect.top-scroller.getBoundingClientRect().top-55;break;}remaining-=node.textContent.length;}
      }
      restore.current=null;restoring.current=false;emitLocation();
    });
  }

  useEffect(()=>{
    if(!book||!selected)return;let alive=true;const urls=[];setImages({});setImageWarning('');restoring.current=true;
    (async()=>{
      const next={};let unavailable=0;
      for(const path of selected.images){if(!alive)return;try{const blob=await book.image(path);if(!alive)return;if(blob){const url=URL.createObjectURL(blob);urls.push(url);if(await readyImage(url))next[path]=url;else unavailable++;}else unavailable++;}catch{unavailable++;}}
      if(!alive)return;setImages(next);if(unavailable)setImageWarning(`${unavailable} 张图片格式不支持或资源缺失；正文仍可阅读。`);
      if(!restore.current)restore.current={chapter,progress:0};applyLocation();
    })();
    return()=>{alive=false;for(const url of urls)URL.revokeObjectURL(url);};
  },[book,chapter]);

  useEffect(()=>{if(!book||!navigateTo)return;const token=navigateTo.nonce??navigateTo;if(navigation.current===token)return;navigation.current=token;go(navigateTo);},[book,navigateTo?.nonce,navigateTo?.chapter,navigateTo?.progress,navigateTo?.locator]);
  useEffect(()=>{if(!selected||restoring.current)return;const value=lastPosition.current?.chapter===chapter?lastPosition.current.progress:progressOf(viewport.current);restore.current={chapter,progress:value};restoring.current=true;applyLocation();},[settings.fontSize,settings.lineHeight,settings.fontFamily]);

  function selectionChanged(){
    if(!book||!article.current)return;const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return;
    const range=selection.getRangeAt(0);if(!article.current.contains(range.startContainer)||!article.current.contains(range.endContainer))return;
    const selectedText=selection.toString();if(!selectedText.trim()||selectedText.length>12000)return;
    const before=document.createRange();before.selectNodeContents(article.current);before.setEnd(range.startContainer,range.startOffset);const start=before.toString().length;
    const through=document.createRange();through.selectNodeContents(article.current);through.setEnd(range.endContainer,range.endOffset);const end=through.toString().length;
    callbacks.current.onSelection?.({text:selectedText,locator:{chapter,start,end,progress:progressOf(viewport.current)},label:`${selected.title} · ${Math.round(progressOf(viewport.current)*100)}%`});
  }
  function activateLink(href){const target=book.resolveHref(href);if(target)go({...target,progress:0});}
  function showHit(index){if(!hits.length)return;const next=(index+hits.length)%hits.length;setActiveHit(next);go({...hits[next],progress:0});}
  function onKeyDown(event){
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,select,textarea,button')||window.getSelection()?.toString())return;
    if(event.key==='ArrowLeft'&&chapter>0){event.preventDefault();go({chapter:chapter-1,progress:0});}
    if(event.key==='ArrowRight'&&chapter+1<book.chapters.length){event.preventDefault();go({chapter:chapter+1,progress:0});}
  }
  const marks=selected?chapterMarks(annotations,chapter,selected.text.length):[];
  const visibleMarks=activeHit>=0&&hits[activeHit]?.chapter===chapter?[...marks,{...hits[activeHit],id:'search-result'}]:marks;
  const rendered=useMemo(()=>selected?renderChapter(selected.tree,images,visibleMarks,activateLink):null,[selected,images,annotations,activeHit,hits]);

  if(loading)return <div className="mc-epub-state" role="status">正在读取 EPUB…</div>;
  if(error)return <div className="mc-epub-state mc-epub-error" role="alert">{error}</div>;
  if(!book||!selected)return null;
  return <section className={`mc-epub-reader mc-epub-theme-${['light','sepia','dark'].includes(settings.theme)?settings.theme:'light'}`} aria-label="EPUB 阅读器" onKeyDown={onKeyDown}>
    <div className="mc-epub-controls">
      <div className="mc-epub-chapters"><button type="button" disabled={!chapter} onClick={()=>go({chapter:chapter-1,progress:0})}>上一章</button><label>章节<select aria-label="EPUB 章节" value={chapter} onChange={event=>go({chapter:Number(event.target.value),progress:0})}>{book.chapters.map((entry,index)=><option key={entry.path} value={index}>{index+1}. {entry.title}</option>)}</select></label><button type="button" disabled={chapter===book.chapters.length-1} onClick={()=>go({chapter:chapter+1,progress:0})}>下一章</button></div>
      <form className="mc-epub-search" onSubmit={event=>{event.preventDefault();setSearch(query.trim());setActiveHit(-1);}}><input aria-label="搜索 EPUB 全文" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索全书文字" maxLength={300}/><button type="submit" disabled={!query.trim()}>查找</button>{search&&<><span role="status">{hits.length?(hits.length>=200?'显示前 200 处（已达显示上限）':`${hits.length} 处`):'未找到'}</span><button type="button" disabled={!hits.length} onClick={()=>showHit(activeHit-1)} aria-label="上一处搜索结果">↑</button><button type="button" disabled={!hits.length} onClick={()=>showHit(activeHit+1)} aria-label="下一处搜索结果">↓</button><button type="button" onClick={()=>{setSearch('');setQuery('');setActiveHit(-1);}} aria-label="清除 EPUB 搜索">×</button></>}</form>
    </div>
    {search&&hits.length>0&&<details className="mc-epub-results" open><summary>全书搜索结果{activeHit>=0?` · 第 ${activeHit+1} 处`:''}</summary><ol>{hits.map((hit,index)=><li key={`${hit.chapter}-${hit.start}`}><button type="button" aria-current={activeHit===index?'location':undefined} onClick={()=>showHit(index)}><strong>{hit.title}</strong><span>{hit.excerpt}</span></button></li>)}</ol></details>}
    {imageWarning&&<p className="mc-epub-warning" role="status">{imageWarning}</p>}
    <div className="mc-epub-scroll" ref={viewport} onScroll={()=>{cancelAnimationFrame(scrollFrame.current);scrollFrame.current=requestAnimationFrame(()=>{scrollFrame.current=0;emitLocation();});}}>
      <article className="mc-epub-content" ref={article} tabIndex={0} aria-label={`EPUB 正文：${selected.title}`} style={{fontSize:safeNumber(settings.fontSize,18,12,36),lineHeight:safeNumber(settings.lineHeight,1.8,1.3,2.5),fontFamily:settings.fontFamily==='sans'?'system-ui, -apple-system, "PingFang SC", sans-serif':'Georgia, "Songti SC", "Noto Serif CJK SC", serif'}} onMouseUp={selectionChanged} onKeyUp={event=>{if(event.key==='Shift'||event.shiftKey)selectionChanged();}}>{rendered}</article>
    </div>
    <div className="mc-epub-footer"><span>第 {chapter+1} / {book.chapters.length} 章</span><span>← → 切换章节 · 选中文字可摘录</span></div>
  </section>;
}
