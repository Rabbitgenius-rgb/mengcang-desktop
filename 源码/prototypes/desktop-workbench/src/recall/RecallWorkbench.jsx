import React,{useEffect,useRef,useState} from 'react';
import {AnimatePresence} from 'motion/react';
import {RecallMotionRow,RecallMotionReader} from './RecallMotion.jsx';
import {IconPalette,IconArrowUpRight,IconCheck,IconLayoutGrid,IconMessageCircle,IconSearch,IconSettings,IconX,IconBook2,IconBookmark,IconTrash} from '@tabler/icons-react';
import {normalizeWorkbench,unread,groupTopics,filterRecall,recallDisplayText} from './recallModel.js';
import {SafeRichBody} from '../sublime/SublimeEditors.jsx';
import './recallWorkbench.css';
import './recallWorkspace.css';
import './recallMotion.css';
import FloatStyleLibrary from './FloatStyleLibrary.jsx';
import {valueOf} from '../desktopModel.js';

const icons={review:IconBookmark,styles:IconPalette};
const names={review:'回看',styles:'风格库'};
function IconButton({label,onClick,children,disabled}){return <button className="rw-icon" type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;}
function Dot(){return <span className="rw-dot" aria-label="未读"/>;}
function date(value){return value?new Date(value).toLocaleDateString('zh-CN',{month:'long',day:'numeric'}):'日期未记录';}
const sourceName=c=>c.externalSource?.sessionTitle||c.sourceTitle||'未命名线程';

export default function RecallWorkbench({cards,model:rawModel,onUpdate,onDelete,onRestore,api,demo=false,onLibrary,onSettings}){
 const model=normalizeWorkbench(rawModel),[page,setPage]=useState('review'),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[topic,setTopic]=useState(''),[selected,setSelected]=useState(null),[issue,setIssue]=useState('');
 const [titles,setTitles]=useState({}),[deleting,setDeleting]=useState(null),[deleteBusy,setDeleteBusy]=useState(false),[deleted,setDeleted]=useState(null);
 const deleteLock=useRef(false);
 const reader=useRef(null),opener=useRef(null);
 const count=cards.filter(c=>unread(c,model)).length,topics=groupTopics(cards),visible=filterRecall(cards,model,{query,filter,topic,titles}),chosen=cards.find(c=>c.id===selected),currentThread=topics.find(t=>t.id===topic),scopedCards=currentThread?.cards||cards,scopedUnread=scopedCards.filter(c=>unread(c,model)).length;
 const chosenText=chosen?recallDisplayText(chosen,titles):null,titleIds=JSON.stringify(cards.map(c=>c.id));
 useEffect(()=>{let live=true,revision=0;async function refresh(){const request=++revision;try{const result=valueOf(await api.recallTitles({ids:JSON.parse(titleIds)}));if(live&&request===revision)setTitles(result?.titles||{});}catch{/* Keep the last local titles if the companion cache is temporarily unavailable. */}}if(!api?.recallTitles)return;void refresh();const stop=api.subscribe?.(event=>{if(event.type==='recallTitlesChanged')void refresh();});window.addEventListener('focus',refresh);return()=>{live=false;stop?.();window.removeEventListener('focus',refresh);};},[api,titleIds]);
 async function update(producer){try{setIssue('');return await onUpdate(producer);}catch(e){setIssue(e.message||'保存失败，请重试。');throw e;}}
 function save(producer){void update(producer).catch(()=>{});}
 async function open(card){opener.current=document.activeElement;setSelected(card.id);reader.current?.scrollTo({top:0});if(unread(card,model))await update(current=>({...current,read:{...current.read,[card.id]:new Date().toISOString()}}));}
 function closeReader(){setSelected(null);requestAnimationFrame(()=>{const target=opener.current;if(target?.isConnected&&!target.closest('[inert]'))target.focus({preventScroll:true});else document.querySelector('[aria-label="回看筛选"] button[aria-pressed="true"]')?.focus({preventScroll:true});});}
 function requestDelete(card){setIssue('');setDeleting(card);}
 async function deleteNote(){if(!deleting||deleteLock.current)return;deleteLock.current=true;setDeleteBusy(true);setIssue('');try{await onDelete(deleting.id);setDeleted({id:deleting.id,title:recallDisplayText(deleting,titles).title});if(selected===deleting.id)setSelected(null);if(topic&&!topics.find(t=>t.id===topic)?.cards.some(c=>c.id!==deleting.id))setTopic('');setDeleting(null);}catch(e){setIssue(e.message||'删除失败，请重试。');}finally{deleteLock.current=false;setDeleteBusy(false);}}
 async function restoreNote(){if(!deleted||deleteLock.current)return;deleteLock.current=true;setDeleteBusy(true);setIssue('');try{await onRestore(deleted.id);setDeleted(null);}catch(e){setIssue(e.message||'恢复失败，请重试。');}finally{deleteLock.current=false;setDeleteBusy(false);}}
 useEffect(()=>{if(selected&&page==='review')reader.current?.focus({preventScroll:true});},[selected,page]);

 return <div className={`recall-workbench rw-workspace rw-density-${model.density} ${chosen&&page==='review'?'is-reading':''}`}>
  <aside className="rw-sidebar">
   <button className="rw-brand" onClick={()=>setPage('review')} aria-label="梦藏首页"><span className="rw-brand-mark" aria-hidden="true"><span/><span/><span/></span><span>梦藏<small>MENGCANG</small></span></button>
   <div className="rw-space-label">工作区</div>
   <nav aria-label="回看工作区导航">{Object.entries(names).map(([id,label])=>{const Icon=icons[id];return <button key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={18} stroke={1.7}/><span>{label}</span>{id==='review'&&count>0&&<span className="rw-nav-unread"><Dot/>{count}</span>}</button>;})}</nav>
   {page==='review'&&<><div className="rw-sidebar-line"/>
   <div className="rw-sidebar-topics rw-thread-list" aria-label="来源线程">
    <button className={`rw-all-threads ${!topic?'selected':''}`} aria-pressed={!topic} onClick={()=>{setTopic('');setSelected(null);setQuery('');setFilter('all');}}><IconLayoutGrid size={15}/><span>全部线程</span><span className="rw-thread-meta"><small>{cards.length}</small></span></button>
    {topics.map(t=><button key={t.id} className={topic===t.id?'selected':''} aria-pressed={topic===t.id} title={t.title} aria-label={`线程：${t.title}，${t.cards.length} 条摘录`} onClick={()=>{setTopic(t.id);setSelected(null);setQuery('');setFilter('all');}}><IconMessageCircle size={15}/><span>{t.title}</span><span className="rw-thread-meta"><small>{t.cards.length}</small>{t.cards.some(c=>unread(c,model))&&<Dot/>}</span></button>)}
    {!topics.length&&<p>标注的摘录会按来源线程显示在这里。</p>}
   </div></>}
   <div className="rw-sidebar-bottom"><button onClick={onLibrary}><IconBook2 size={17}/><span>打开资料库</span><IconArrowUpRight size={14}/></button><button onClick={onSettings}><IconSettings size={17}/><span>AI 连接设置</span></button><div className="rw-local-note"><span/>{demo?'本地预览 · 示例数据':'内容保存在本机'}</div></div>
  </aside>
  <div className="rw-main">
   {issue&&!deleting&&<div className="rw-error" role="alert"><span>{issue}</span><button onClick={()=>setIssue('')} aria-label="关闭错误提示"><IconX size={16}/></button></div>}
   {page==='review'&&<main className="rw-review">
    <header className="rw-page-header"><div className="rw-title-group"><IconBookmark size={21} stroke={1.6}/><h1>回看</h1><span className="rw-header-count">{count>0?<><Dot/>{count} 条未读</>:<><IconCheck size={14}/>全部已读</>}</span></div><button className="rw-secondary" onClick={()=>setPage('styles')}><IconPalette size={15}/>浮窗风格</button></header>
    <div className={`rw-review-grid ${chosen?'has-reader':''}`}>
     <section className="rw-feed" aria-label="摘录列表">
      <div className="rw-feed-title"><h2>{currentThread?.title||'全部摘录'}<small>{scopedCards.length}</small></h2><label className="rw-search"><IconSearch size={16}/><input type="search" placeholder={currentThread?'搜索当前线程':'搜索摘录或线程'} aria-label="搜索回看内容" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
      <div className="rw-filters" role="group" aria-label="回看筛选">{[['all','全部',scopedCards.length],['unread','未读',scopedUnread],['read','已读',scopedCards.length-scopedUnread]].map(([id,label,n])=><button key={id} className={filter===id?'active':''} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}<small>{n}</small></button>)}</div>
      <div className="rw-card-list"><AnimatePresence initial={false} mode="popLayout">{visible.map(card=>{const text=recallDisplayText(card,titles);return <RecallMotionRow key={card.id} className={`rw-recall-card ${unread(card,model)?'is-unread':'is-read'} ${chosen?.id===card.id?'selected':''}`}><button className="rw-card-open" aria-label={`打开笔记：${text.title}`} onClick={()=>void open(card).catch(()=>{})}>
       <span className="rw-card-status">{unread(card,model)?<Dot/>:<span className="rw-read-mark" aria-label="已读"/>}</span>
       <div className="rw-card-content"><div className="rw-card-meta"><span><IconMessageCircle size={13}/><span>{sourceName(card)}</span></span><time dateTime={card.recallReceipt.savedAt}>{date(card.recallReceipt.savedAt)} · 第 {card.externalSource.turn||1} 轮</time></div><h3>{text.title}</h3>{text.body&&<p>{text.body}</p>}</div>
      </button>{onDelete&&<button className="rw-card-delete rw-icon" type="button" title="删除笔记" aria-label={`删除笔记：${text.title}`} onClick={()=>requestDelete(card)}><IconTrash size={16}/></button>}</RecallMotionRow>;})}</AnimatePresence>{!visible.length&&<div className="rw-empty"><IconBookmark size={28} stroke={1.2}/><h3>{cards.length?'没有匹配的摘录':'值得重读的内容，会留在这里'}</h3><p>{cards.length?'试试其他关键词或筛选条件。':'在对话里标注“添加回看”，就能回来接着想。'}</p>{(query||filter!=='all')&&<button className="rw-secondary" onClick={()=>{setQuery('');setFilter('all');}}>清除筛选</button>}</div>}</div>
     </section>
     <AnimatePresence initial={false}>{chosen&&<RecallMotionReader key="reader" className="rw-reading-column" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeReader();}}}><article className="rw-reader" ref={reader} tabIndex={-1} aria-label="摘录原文"><div className="rw-section-heading"><span className="rw-reader-label"><IconBookmark size={14}/>摘录原文</span><div className="rw-reader-tools">{onDelete&&<IconButton label="删除当前笔记" onClick={()=>requestDelete(chosen)}><IconTrash size={16}/></IconButton>}<IconButton label="关闭摘录" onClick={closeReader}><IconX size={17}/></IconButton></div></div><h2>{chosenText.title}</h2><div className="rw-reader-source"><IconMessageCircle size={14}/>{sourceName(chosen)}<small>第 {chosen.externalSource.turn||1} 轮 · {date(chosen.recallReceipt.savedAt)}</small></div><SafeRichBody text={chosenText.body} className="rw-rich-body"/></article></RecallMotionReader>}</AnimatePresence>
    </div>
   </main>}
   {page==='styles'&&<FloatStyleLibrary api={api} demo={demo}/>}
  </div>
  {deleted&&<div className="rw-delete-toast" role="status"><span>已删除「{deleted.title}」</span><button type="button" disabled={deleteBusy} onClick={()=>void restoreNote()}>撤销</button><IconButton label="关闭删除提示" disabled={deleteBusy} onClick={()=>setDeleted(null)}><IconX size={15}/></IconButton></div>}
  {deleting&&<ComponentDialog title="删除笔记" closeLabel="取消删除笔记" closeDisabled={deleteBusy} onClose={()=>{if(!deleteLock.current)setDeleting(null);}} fallbackFocus='[aria-label="回看筛选"] button[aria-pressed="true"]'><div className="rw-delete-confirm"><p>删除「{recallDisplayText(deleting,titles).title}」？</p><small>可从「资料库 → 已归档卡片」恢复。</small>{issue&&<p className="rw-delete-error" role="alert">{issue}</p>}<div className="rw-delete-actions"><button type="button" className="rw-secondary" data-initial-focus disabled={deleteBusy} onClick={()=>setDeleting(null)}>取消</button><button type="button" className="rw-danger" disabled={deleteBusy} onClick={()=>void deleteNote()}>{deleteBusy?'正在删除…':'删除'}</button></div></div></ComponentDialog>}

 </div>;
}

function ComponentDialog({title,onClose,children,closeLabel='关闭创建组件',closeDisabled=false,fallbackFocus}){const ref=useRef(null);useEffect(()=>{const focus=document.activeElement,dialog=ref.current;dialog.showModal();dialog.querySelector('[data-initial-focus],form input,form select,form textarea')?.focus();return()=>{dialog.close();if(focus?.isConnected&&!focus.closest('[inert]'))focus.focus?.();else if(fallbackFocus)document.querySelector(fallbackFocus)?.focus();};},[]);return <dialog ref={ref} className="rw-modal" aria-label={title} onCancel={e=>{e.preventDefault();if(!closeDisabled)onClose();}}><header><h2>{title}</h2><IconButton label={closeLabel} onClick={onClose} disabled={closeDisabled}><IconX size={18}/></IconButton></header>{children}</dialog>;}

