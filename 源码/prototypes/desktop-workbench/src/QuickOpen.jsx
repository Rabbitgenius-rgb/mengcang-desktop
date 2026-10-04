import React,{useEffect,useMemo,useRef,useState} from 'react';
import {IconSearch,IconX} from '@tabler/icons-react';
import {quickResults} from './workspaceHistory.js';
const labels={inspiration:'灵感',materials:'素材',books:'藏书',projects:'项目',schedule:'日程'};
export default function QuickOpen({groups,onOpen,onClose}) {
  const ref=useRef(null),input=useRef(null),[query,setQuery]=useState(''),[active,setActive]=useState(0);
  const results=useMemo(()=>quickResults(groups,query),[groups,query]);
  useEffect(()=>{const previous=document.activeElement;ref.current.showModal();input.current.focus();return()=>{ref.current?.close();previous?.isConnected&&previous.focus();};},[]);
  useEffect(()=>{setActive(0);},[query]);
  const selected=Math.min(active,Math.max(0,results.length-1));
  useEffect(()=>{ref.current?.querySelector(`[data-result="${selected}"]`)?.scrollIntoView({block:'nearest'});},[selected]);
  return <dialog ref={ref} className="root-dialog desktop-quick-dialog" aria-label="搜索整个梦藏" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="desktop-quick-open"><header><IconSearch size={18}/><input ref={input} aria-label="全库搜索" placeholder="搜索灵感、素材、藏书、项目和日程…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing || e.keyCode===229)return;if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(i+1,results.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}else if(e.key==='Enter'&&results[selected]){e.preventDefault();onOpen(results[selected].path);}}}/><button className="icon-btn" aria-label="关闭全库搜索" onClick={onClose}><IconX size={18}/></button></header>
    <div className="desktop-quick-results" aria-label="搜索结果">{results.map(({item,path,view},index)=><button key={path} data-result={index} className={index===selected?'is-active':''} onClick={()=>onOpen(path)}><span className="desktop-quick-kind">{labels[view]}</span><span><strong>{item.title || item.name}</strong><small>{(item.caption || item.summary || item.description || item.goal || item.progressNote || item.waitingReason || item.notes || item.author || '').slice(0,100)}</small></span></button>)}{!results.length&&<p>{query.trim()?'没有匹配的内容，试试配文、标签或正文中的关键词。':'输入关键词，直接打开已有内容。'}</p>}</div><footer>↑ ↓ 选择 · Enter 打开 · Esc 返回<span>{results.length===40?'最多显示前 40 项':query.trim()?`${results.length} 项结果`:''}</span></footer></section>
  </dialog>;
}
