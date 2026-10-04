import React, {useEffect, useMemo, useRef, useState} from 'react';
import {motion, useReducedMotion} from 'motion/react';
import {IconSearch, IconSparkles, IconPlus, IconArrowUpRight, IconFileText, IconPhoto, IconLayoutGrid, IconBookmarks, IconLayersIntersect, IconDownload, IconUpload, IconX, IconCheck, IconChevronRight, IconLink, IconZoomIn, IconZoomOut, IconFocusCentered, IconHandMove, IconAlertCircle, IconLoader2, IconQuote, IconArrowRight, IconTrash} from '@tabler/icons-react';
import {valueOf, readableError, identityKey, searchText} from './desktopModel.js';
import {emptyDiscoveryState, validateDiscoveryState, publicDiscoveryItem, parseImportText, dedupeImports, exportSelectedItems, searchDiscoveryItems, cosineSimilarity} from './discoveryModel.js';
import './discovery.css';
import './sublimeFocus.css';

const idFor = () => globalThis.crypto?.randomUUID?.() || `mc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pathFor = item => String(item?.path || item?.id || '');
const textFor = item => String(item?.body ?? item?.content ?? item?.summary ?? item?.caption ?? '');
const contentFor = item => textFor(item).trim() ? textFor(item) : [item?.caption, item?.title, ...(item?.tags || [])].filter(Boolean).join('\n');
const hashFor = text => {let hash=2166136261;for(const c of String(text))hash=Math.imul(hash ^ c.charCodeAt(0),16777619);return (hash>>>0).toString(36);};
const blankCapture = () => ({title:'',original:'',body:'',caption:'',sourceUrl:'',sourceTitle:'',author:'',page:'',sourcePath:'',expectedSourceHash:'',localFilename:'',tags:'',pages:[],imageData:'',operationId:idFor()});
const safeUrl = url => /^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : '';
const tagsFor = item => Array.isArray(item?.tags) ? item.tags : [];
const dateFor = item => String(item?.date || item?.createdAt || '').slice(0,10).replaceAll('-','/');
const imageFor = item => item?.imageData || item?.assetUrl || item?.dataUrl || '';
function readFile(file, data=false) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result || ''));reader.onerror=()=>reject(new Error('文件未能读取，请重试。'));data?reader.readAsDataURL(file):reader.readAsText(file);});}
function downloadText(text, name, type) {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function DiscoveryDialog({className='',label,onClose,children}) {
  const dialog=useRef(null);
  useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();},[]);
  function close() {if(dialog.current?.open)dialog.current.close();else onClose();}
  return <dialog ref={dialog} className={`discovery-dialog ${className}`} aria-label={label} onCancel={event=>{event.preventDefault();close();}} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget)close();}}>{children}</dialog>;
}

function MaterialCard({item, selected, checked, onSelect, onCheck, score, animate=false, index=0}) {
  const image=imageFor(item);
  const kind=item.kind==='book' || item.type==='book'?'藏书':item.type==='web'?'网页':image?'影像':safeUrl(item.sourceUrl)?'网页':'文字';
  return <motion.article initial={animate?{opacity:0,y:20,scale:.9}:false} animate={{opacity:1,y:0,scale:1}} transition={animate?{type:'spring',stiffness:40,damping:14,delay:Math.min(index,8)*.15}:{duration:0}} whileHover={animate?{y:-3,scale:1.012}:undefined} className={`discovery-card ${selected?'is-selected':''}`}>
    <button className="discovery-card-main" onClick={onSelect} aria-label={`查看 ${item.title || '未命名素材'}`} aria-pressed={selected}>
      {image ? <div className="discovery-card-image"><img src={image} alt={item.title || ''} loading="lazy"/></div> : <div className="discovery-card-text"><IconQuote size={22} stroke={1.2}/><p>{textFor(item) || item.title || '打开素材查看原文'}</p></div>}
      <div className="discovery-card-copy"><span className="discovery-card-type">{kind}{item.page?` · 第 ${item.page} 页`:''}</span><h3>{item.title || '未命名素材'}</h3><span className="discovery-card-source">{item.sourceTitle || item.author || item.category || '我的素材'}{dateFor(item)?` · ${dateFor(item)}`:''}</span>{Number.isFinite(score) && <small className="discovery-score">相似度 {score.toFixed(2)} · cosine</small>}</div>
    </button>
    <label className="discovery-card-check" title="选择导出或加入白板"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`选择 ${item.title || '素材'}`}/><span><IconCheck size={12}/></span></label>
  </motion.article>;
}

function FocusCard({item, label, reference=false, position='', onSelect, checked, onCheck, animate, index=0}) {
  const image=imageFor(item);
  return <motion.article className={`sublime-focus-card ${reference?'is-reference':''} ${String(item.assetUrl || '').includes('inspiration-audio-')||item.type==='audio'?'is-record':''} ${position}`} initial={animate?{opacity:0,y:20,scale:.9}:false} animate={{opacity:1,y:0,scale:1}} transition={animate?{type:'spring',stiffness:40,damping:14,delay:.2+index*.15}:{duration:0}}>
    <button className="sublime-focus-card-main" onClick={onSelect} aria-label={`查看 ${item.title || '未命名素材'}`}>
      {image?<img src={image} alt={item.title || ''}/>:<div className="sublime-focus-text"><span>{item.title || '未命名素材'}</span><p>{textFor(item) || item.caption || '打开素材查看原文'}</p></div>}
      <span className="sublime-focus-badge">{label}</span>
    </button>
    <label className="discovery-card-check" title="选择导出或加入白板"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`选择 ${item.title || '素材'}`}/><span><IconCheck size={12}/></span></label>
  </motion.article>;
}

function FocusConstellation({reference, cards, relatedPaths, onSelect, exportPaths, onCheck, onBrowse, onCapture, animate, demo}) {
  return <section className="sublime-focus" aria-label="参考卡片与周围想法">
    <FocusCard item={reference} label="reference" reference onSelect={()=>onSelect(pathFor(reference))} checked={exportPaths.includes(pathFor(reference))} onCheck={()=>onCheck(pathFor(reference))} animate={animate}/>
    <motion.div className="sublime-focus-copy" initial={animate?{opacity:0,y:30}:false} animate={{opacity:1,y:0}} transition={{duration:animate?1:0,ease:'easeOut'}}>
      <h2>save one idea,<br/>discover 100 more</h2>
      <p>保存一个想法，<br/>让文字与画面之间的<br/>连接慢慢浮现。</p>
      <button className="sublime-focus-cta" onClick={onCapture}>save an idea</button>
    </motion.div>
    <div className="sublime-focus-orbit">{cards.map((item,index)=><FocusCard key={pathFor(item)} item={item} label={demo||relatedPaths.has(pathFor(item))?'related':'explore'} position={`orbit-${index}`} onSelect={()=>onSelect(pathFor(item))} checked={exportPaths.includes(pathFor(item))} onCheck={()=>onCheck(pathFor(item))} animate={animate} index={index+1}/>)}</div>
    <div className="sublime-focus-footer"><p>{demo?'原站公开视觉参考 · 卡片为隔离预览示例':'related 为同标签或本机语义候选；explore 为其他已有素材'}</p><button className="discovery-text-button" onClick={onBrowse}>浏览全部素材 <IconArrowRight size={14}/></button></div>
  </section>;
}

function CanvasBoard({board, items, onChange}) {
  const container=useRef(null),gesture=useRef(null);
  const [view,setView]=useState({x:0,y:0,scale:1}),[selected,setSelected]=useState(null),[linking,setLinking]=useState(false),[linkFrom,setLinkFrom]=useState(null),[addPath,setAddPath]=useState('');
  useEffect(()=>{setView({x:0,y:0,scale:1});setSelected(null);setLinkFrom(null);},[board.id]);
  const byPath=useMemo(()=>new Map(items.map(item=>[pathFor(item),item])),[items]);
  const nodes=board.nodes || [],edges=board.edges || [];
  function moveNode(id,x,y) {onChange({...board,nodes:nodes.map(node=>node.id===id?{...node,x,y}:node)});}
  function start(e,node) {
    if(e.button!==0 || e.target.closest('button,input,select,a'))return;
    if(linking && node)return;
    e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current={id:node?.id,startX:e.clientX,startY:e.clientY,x:node?.x ?? view.x,y:node?.y ?? view.y,scale:view.scale};
    if(node)setSelected(node.id);
  }
  function move(e) {const g=gesture.current;if(!g)return;const dx=e.clientX-g.startX,dy=e.clientY-g.startY;if(g.id)moveNode(g.id,g.x+dx/g.scale,g.y+dy/g.scale);else setView(v=>({...v,x:g.x+dx,y:g.y+dy}));}
  function end() {gesture.current=null;}
  function select(node) {
    setSelected(node.id);
    if(!linking)return;
    if(!linkFrom){setLinkFrom(node.id);return;}
    if(linkFrom!==node.id && !edges.some(edge=>edge.from===linkFrom&&edge.to===node.id))onChange({...board,edges:[...edges,{id:idFor(),from:linkFrom,to:node.id}]});
    setLinkFrom(null);
  }
  function keyboard(e,node) {if(e.key==='Enter'||e.key===' '){e.preventDefault();select(node);return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?40:10;moveNode(node.id,node.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),node.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));}
  function add() {if(!addPath)return;onChange({...board,nodes:[...nodes,{id:idFor(),itemPath:addPath,x:70+nodes.length%3*270,y:65+Math.floor(nodes.length/3)*215}]});setAddPath('');}
  function wheel(e) {if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();setView(v=>({...v,scale:Math.max(.35,Math.min(2,v.scale+(e.deltaY<0?.08:-.08)))}));}
  const selectedNode=nodes.find(node=>node.id===selected);
  return <div className="discovery-canvas-space">
    <div className="discovery-board-tools"><div><span className="discovery-board-name">{board.title}</span><small>{nodes.length} 张卡片 · {edges.length} 条连线</small></div><div className="discovery-board-add"><select aria-label="添加到白板的素材" value={addPath} onChange={e=>setAddPath(e.target.value)}><option value="">选择素材加入白板</option>{items.map(item=><option key={pathFor(item)} value={pathFor(item)}>{item.title || '未命名素材'}</option>)}</select><button className="discovery-button" disabled={!addPath} onClick={add}><IconPlus size={15}/>添加</button></div></div>
    <div className={`discovery-board ${linking?'is-linking':''}`} ref={container} onPointerDown={e=>{if(e.target===container.current)start(e);}} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onWheel={wheel} tabIndex={0} aria-label="素材白板，可拖动空白处平移">
      <div className="discovery-board-world" style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.scale})`}}>
        <svg className="discovery-board-edges" aria-label="卡片关系连线"><defs><marker id={`arrow-${board.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#8aa08a"/></marker></defs>{edges.map(edge=>{const a=nodes.find(n=>n.id===edge.from),b=nodes.find(n=>n.id===edge.to);return a&&b?<line key={edge.id} x1={a.x+120} y1={a.y+78} x2={b.x+120} y2={b.y+78} markerEnd={`url(#arrow-${board.id})`}/>:null;})}</svg>
        {nodes.map(node=>{const item=byPath.get(node.itemPath);return <div key={node.id} className={`discovery-board-node ${selected===node.id?'is-selected':''} ${linkFrom===node.id?'is-link-start':''}`} style={{left:node.x,top:node.y}} tabIndex={0} role="group" aria-label={`${item?.title || '来源暂不可用'}，方向键移动，Shift 加速`} onPointerDown={e=>start(e,node)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={()=>select(node)} onFocus={()=>setSelected(node.id)} onKeyDown={e=>keyboard(e,node)}>{item&&imageFor(item)?<img src={imageFor(item)} alt="" draggable="false"/>:<IconQuote size={20} stroke={1.2}/>}<strong>{item?.title || '来源暂不可用'}</strong><p>{item?textFor(item).slice(0,150):node.itemPath}</p><span>{item?.sourceTitle || item?.author || '素材卡片'}</span></div>;})}
      </div>
      {!nodes.length && <div className="discovery-board-empty"><IconLayersIntersect size={37} stroke={1}/><h3>把想法铺开</h3><p>从上方加入素材，在这里重新排列它们。</p></div>}
      <div className="discovery-canvas-controls"><button aria-label="缩小白板" onClick={()=>setView(v=>({...v,scale:Math.max(.35,v.scale-.15)}))}><IconZoomOut size={18}/></button><span>{Math.round(view.scale*100)}%</span><button aria-label="放大白板" onClick={()=>setView(v=>({...v,scale:Math.min(2,v.scale+.15)}))}><IconZoomIn size={18}/></button><button aria-label="重置白板视图" onClick={()=>setView({x:0,y:0,scale:1})}><IconFocusCentered size={18}/></button><i/><button className={linking?'is-active':''} aria-pressed={linking} aria-label="连接两张卡片" onClick={()=>{setLinking(v=>!v);setLinkFrom(null);}}><IconLink size={18}/></button><button aria-label="移除选中白板卡片" disabled={!selectedNode} onClick={()=>{onChange({...board,nodes:nodes.filter(n=>n.id!==selected),edges:edges.filter(edge=>edge.from!==selected&&edge.to!==selected)});setSelected(null);}}><IconTrash size={17}/></button></div>
      <div className="discovery-canvas-hint">{linking?(linkFrom?'再选择一张卡片完成连线':'依次选择两张卡片连线'):<><IconHandMove size={13}/>拖动空白处平移 · 卡片聚焦后可用方向键移动</>}</div>
    </div>
    {!!edges.length && <details className="discovery-edge-list"><summary>管理连线（{edges.length}）</summary>{edges.map(edge=><div key={edge.id}><span>{byPath.get(nodes.find(n=>n.id===edge.from)?.itemPath)?.title || '素材'} → {byPath.get(nodes.find(n=>n.id===edge.to)?.itemPath)?.title || '素材'}</span><button className="discovery-text-button" onClick={()=>onChange({...board,edges:edges.filter(e=>e.id!==edge.id)})}>移除连线</button></div>)}</details>}
  </div>;
}

export default function DiscoveryView({items=[],api,identity,connected=false,onOpen,onRefresh,demo=false}) {
  const [browseAll,setBrowseAll]=useState(false);
  const [tab,setTab]=useState('discover'),[query,setQuery]=useState(''),[mode,setMode]=useState('keyword'),[selectedPath,setSelectedPath]=useState(demo?'preview/expression':''),[exportPaths,setExportPaths]=useState([]);
  const [state,setState]=useState(emptyDiscoveryState),[ready,setReady]=useState(false),[persistence,setPersistence]=useState('loading'),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [collectionId,setCollectionId]=useState('all'),[newTitle,setNewTitle]=useState(''),[boardId,setBoardId]=useState(''),[analysis,setAnalysis]=useState({}),[ocr,setOcr]=useState({}),[queryEmbedding,setQueryEmbedding]=useState(null),[busy,setBusy]=useState('');
  const [draft,setDraft]=useState(blankCapture),[selectedText,setSelectedText]=useState(''),[captureStatus,setCaptureStatus]=useState(''),[importPreview,setImportPreview]=useState(null),[importPaths,setImportPaths]=useState([]),[importPending,setImportPending]=useState([]),[hidden,setHidden]=useState(document.hidden),[shellReduced,setShellReduced]=useState(false);
  const [detailOpen,setDetailOpen]=useState(false),[exportPreview,setExportPreview]=useState(null),[copyStatus,setCopyStatus]=useState(''),[pasteImportText,setPasteImportText]=useState(''),[pasteImportFormat,setPasteImportFormat]=useState('auto'),[analysisFailures,setAnalysisFailures]=useState([]);
  const root=useRef(null),fileInput=useRef(null),importInput=useRef(null),originalRef=useRef(null),loadedKey=useRef(''),stateRevision=useRef(0),saveQueue=useRef(Promise.resolve()),mounted=useRef(true),toastTimer=useRef(null),queryRef=useRef(query),skipInitialSave=useRef(true),analysisRun=useRef(0);
  queryRef.current=query;
  const reducedMotion=useReducedMotion() || shellReduced;
  const key=identityKey(identity),stateKey=`mengcang-discovery-state:${demo?'browser':key}`,draftKey=`mengcang-discovery-capture:${demo?'browser':key}`;
  const canCapture=api?.captureAvailable===true && (connected || demo) && typeof api?.capture==='function';
  const canAnalyze=typeof api?.discoveryAnalyze==='function';
  const allItems=useMemo(()=>items.filter(item=>pathFor(item)).map(item=>({...item,...publicDiscoveryItem(item)})),[items]);
  const byPath=useMemo(()=>new Map(allItems.map(item=>[pathFor(item),item])),[allItems]);
  const selected=byPath.get(selectedPath) || allItems[0];
  const collection=state.collections.find(c=>c.id===collectionId);
  const board=state.boards.find(b=>b.id===boardId) || state.boards[0];
  const scope=collectionId==='all'?allItems:allItems.filter(item=>(collection?.itemPaths || []).includes(pathFor(item)));
  const validEmbeddings=useMemo(()=>Object.fromEntries(allItems.flatMap(item=>{const record=analysis[pathFor(item)];return record?.textHash===hashFor(contentFor(item))?[[pathFor(item),record]]:[];})),[allItems,analysis]);
  const searchable=useMemo(()=>allItems.map(item=>ocr[pathFor(item)]?{...item,ocrText:ocr[pathFor(item)]}:item),[allItems,ocr]);
  const resultItems=useMemo(()=>{const visible=searchable.filter(item=>scope.some(s=>pathFor(s)===pathFor(item)));if(mode==='semantic' && query.trim() && !queryEmbedding)return [];return searchDiscoveryItems(visible,query,{mode:mode==='semantic' && query.trim()?'semantic':'keyword',queryEmbedding,embeddings:validEmbeddings});},[searchable,scope,query,mode,queryEmbedding,validEmbeddings]);
  const compatibleCount=queryEmbedding?Object.values(validEmbeddings).filter(entry=>[entry,...(entry.alternates || [])].some(vector=>vector.model===queryEmbedding.model&&vector.language===queryEmbedding.language)).length:0;
  const related=useMemo(()=>{if(!selected)return [];const base=validEmbeddings[pathFor(selected)];if(base)return allItems.filter(item=>pathFor(item)!==pathFor(selected)).flatMap(item=>{const target=validEmbeddings[pathFor(item)];if(!target || target.model!==base.model || target.language!==base.language)return [];const score=cosineSimilarity(base.vector,target.vector);return Number.isFinite(score)?[{item,score}]:[];}).sort((a,b)=>b.score-a.score).slice(0,5);const tags=tagsFor(selected);return allItems.filter(item=>pathFor(item)!==pathFor(selected)&&tagsFor(item).some(tag=>tags.includes(tag))).slice(0,5).map(item=>({item}));},[selected,validEmbeddings,allItems]);
  const focusMode=tab==='discover' && !query.trim() && !browseAll && allItems.length>0;
  const focusCards=useMemo(()=>{
    if(!selected)return [];
    const candidates=demo?allItems.filter(item=>String(item.assetUrl || '').startsWith('/assets/inspiration-')):[...related.map(({item})=>item),...allItems];
    const seen=new Set([pathFor(selected)]);
    return candidates.filter(item=>{const path=pathFor(item);if(seen.has(path))return false;seen.add(path);return true;}).slice(0,5);
  },[selected,related,allItems,demo]);
  function notice(text) {setMessage(text);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setMessage(''),5000);}
  useEffect(()=>{mounted.current=true;const panel=root.current?.closest('.view-panel'),app=root.current?.closest('.desktop-app');const listener=()=>{setHidden(document.hidden || Boolean(panel?.hidden));setShellReduced(Boolean(app?.classList.contains('reduce-motion')));};listener();const observer=new MutationObserver(listener);if(panel)observer.observe(panel,{attributes:true,attributeFilter:['hidden']});if(app)observer.observe(app,{attributes:true,attributeFilter:['class']});document.addEventListener('visibilitychange',listener);return()=>{mounted.current=false;observer.disconnect();clearTimeout(toastTimer.current);document.removeEventListener('visibilitychange',listener);};},[]);
  useEffect(()=>{
    let cancelled=false;analysisRun.current++;setBusy('');setAnalysisFailures([]);setReady(false);setPersistence('loading');loadedKey.current='';skipInitialSave.current=true;setError('');setAnalysis({});setOcr({});setQueryEmbedding(null);
    (async()=>{try {const saved=typeof api?.discoveryStateGet==='function'?valueOf(await api.discoveryStateGet()):JSON.parse(localStorage.getItem(stateKey) || 'null');if(cancelled)return;const check=saved==null?{ok:true,state:emptyDiscoveryState()}:validateDiscoveryState(saved);if(!check.ok)throw new Error(check.errors.join('；'));setState(check.state);setPersistence(typeof api?.discoveryStateGet==='function'?'saved':'local');}catch(e){if(cancelled)return;setError(`收藏集和白板读取失败：${readableError(e)}。没有覆盖已有状态。`);setPersistence('error');return;}finally{if(!cancelled){loadedKey.current=stateKey;setReady(true);}}})();
    try {const savedDraft=JSON.parse(localStorage.getItem(draftKey) || 'null');setDraft(savedDraft?{...blankCapture(),...savedDraft}:blankCapture());}catch{setCaptureStatus('本机采集草稿未能读取，请保留原文后重试。');}
    return()=>{cancelled=true;};
  },[api,stateKey,draftKey]);
  useEffect(()=>{if(!ready || persistence==='error' || loadedKey.current!==stateKey)return;if(skipInitialSave.current){skipInitialSave.current=false;return;}const revision=++stateRevision.current;setPersistence('saving');const timer=setTimeout(()=>{const value=state;saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{try{if(typeof api?.discoveryStateSet==='function')valueOf(await api.discoveryStateSet(value));else localStorage.setItem(stateKey,JSON.stringify(value));if(mounted.current&&loadedKey.current===stateKey&&stateRevision.current===revision)setPersistence(typeof api?.discoveryStateSet==='function'?'saved':'local');}catch(e){if(mounted.current&&loadedKey.current===stateKey){setPersistence('error');setError(`状态未保存：${readableError(e)}。当前内容保留在窗口中，请导出备份。`);}}});},180);return()=>clearTimeout(timer);},[state,ready,stateKey,api]);
  useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(draftKey,JSON.stringify(draft));}catch{setCaptureStatus('本机草稿保存失败，请先复制或导出内容。');}},250);return()=>clearTimeout(timer);},[draft,draftKey]);
  useEffect(()=>{if(hidden){setDetailOpen(false);setExportPreview(null);}if(tab!=='discover'&&tab!=='collections')setDetailOpen(false);},[hidden,tab]);
  function closeDetail() {root.current?.querySelector('.discovery-detail-dialog')?.close();setDetailOpen(false);}
  function closeExport() {root.current?.querySelector('.discovery-export-dialog')?.close();setExportPreview(null);}
  function openDetail(path) {setSelectedPath(path);if(focusMode || window.matchMedia('(max-width:850px)').matches || (tab==='collections'&&window.matchMedia('(max-width:1150px)').matches))setDetailOpen(true);}
  function changeDraft(field,value) {setDraft(d=>({...d,[field]:value,operationId:idFor()}));setCaptureStatus('');}
  function changeQuery(value) {queryRef.current=value;setQuery(value);setQueryEmbedding(null);}
  function togglePath(path) {setExportPaths(paths=>paths.includes(path)?paths.filter(p=>p!==path):[...paths,path]);}
  function createCollection() {if(!ready || persistence==='error' || !newTitle.trim())return;const id=idFor();setState(s=>({...s,collections:[...s.collections,{id,title:newTitle.trim(),itemPaths:[]}]}));setCollectionId(id);setNewTitle('');setTab('collections');notice('收藏集已创建；内容仍保留原始来源。');}
  function addToCollection(id,paths) {if(!ready || !paths.length || !id || persistence==='error')return;setState(s=>({...s,collections:s.collections.map(c=>c.id===id?{...c,itemPaths:[...new Set([...c.itemPaths,...paths])]}:c),boards:s.boards.map(b=>{if(b.collectionId!==id)return b;const missing=paths.filter(path=>!b.nodes.some(node=>node.itemPath===path));return {...b,nodes:[...b.nodes,...missing.map((itemPath,i)=>({id:idFor(),itemPath,x:60+(b.nodes.length+i)%3*270,y:60+Math.floor((b.nodes.length+i)/3)*215}))]};})}));notice('已加入收藏集，关联白板同步增加卡片。');}
  function createBoard(fromCollection=false) {if(!ready || persistence==='error')return;const paths=fromCollection?collection?.itemPaths || []:exportPaths.filter(path=>byPath.has(path));const id=idFor();const next={id,title:fromCollection?`${collection.title} · 白板`:`想法白板 ${state.boards.length+1}`,collectionId:fromCollection?collection.id:'',nodes:paths.map((itemPath,i)=>({id:idFor(),itemPath,x:60+i%3*270,y:60+Math.floor(i/3)*215})),edges:[]};setState(s=>({...s,boards:[...s.boards,next]}));setBoardId(id);setTab('canvas');notice(paths.length?`白板已建立，带入 ${paths.length} 张卡片。`:'空白板已建立，可以逐张加入素材。');}
  async function assetBase64(item) {
    const src=imageFor(item),localPreview=demo&&/^\/assets\//.test(src);
    if(!src || (!localPreview&&!/^(data:image\/|blob:|mengcang-asset:)/i.test(src)))throw new Error('图片地址不属于可读取的本机素材。');
    if(src.startsWith('data:'))return src.split(',')[1] || '';
    const response=await fetch(src);if(!response.ok)throw new Error('图片未能读取。');
    const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('单张图片超过 8 MB，已跳过图片文字索引。');
    return (await readFile(blob,true)).split(',')[1] || '';
  }
  async function analyze(build=false) {
    if(!canAnalyze || busy || !ready || loadedKey.current!==stateKey)return;
    const run=++analysisRun.current,runKey=stateKey,analyzedQuery=query.trim();
    const active=()=>mounted.current&&loadedKey.current===runKey&&analysisRun.current===run;
    const indexText=text=>String(text || '').slice(0,20000).replace(/[\uD800-\uDBFF]$/,'');
    const corpus=build?allItems.map(item=>({id:pathFor(item),text:indexText(contentFor(item)),item})):[];
    const imageItems=build?allItems.filter(item=>imageFor(item)):[];
    const mainVectors=new Map(),queryVectors=new Map(),ocrTexts=new Map(),ocrVectors=new Map(),failures=[];
    const labelFor=task=>task.id==='__query__'?'查询':`${task.item?.title || byPath.get(task.id)?.title || '未命名素材'}（${task.id}）`;
    const isVector=entry=>Array.isArray(entry?.vector)&&entry.vector.length>0&&entry.vector.every(Number.isFinite)&&entry.model&&entry.language;
    setBusy('analysis');setError('');setAnalysisFailures([]);
    async function embedBatches(tasks,target,kind) {
      for(let offset=0;offset<tasks.length;offset+=128){
        if(!active())return false;
        const batch=tasks.slice(offset,offset+128);
        try {
          const result=valueOf(await api.discoveryAnalyze({texts:batch.map(({id,text})=>({id,text})),images:[]}));
          if(!active())return false;
          const returned=new Map((result.embeddings || []).filter(entry=>batch.some(task=>task.id===entry.id)).map(entry=>[entry.id,entry]));
          for(const task of batch){const entry=returned.get(task.id);if(isVector(entry))target.set(task.id,entry);else failures.push(`${kind} · ${labelFor(task)}：${entry?.error || entry?.reason || '没有返回可用的同语种语义向量。'}`);}
        }catch(e){if(!active())return false;for(const task of batch)failures.push(`${kind} · ${labelFor(task)}：${readableError(e)}`);}
      }
      return active();
    }
    try {
      if(analyzedQuery&&!await embedBatches([{id:'__query__',text:indexText(analyzedQuery)}],queryVectors,'查询分析'))return;
      if(!await embedBatches(corpus,mainVectors,'原文索引'))return;
      for(const item of imageItems){
        if(!active())return;
        const id=pathFor(item);
        try {
          const base64=await assetBase64(item);if(!active())return;
          const bytes=Math.floor(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);
          if(!base64)throw new Error('图片没有可读取的内容。');
          if(bytes>8*1024*1024)throw new Error('单张图片超过 8 MB，已跳过图片文字索引。');
          const result=valueOf(await api.discoveryAnalyze({texts:[],images:[{id,base64}]}));if(!active())return;
          const entry=(result.ocr || []).find(value=>value.id===id&&typeof value.text==='string'&&value.text.trim());
          if(!entry)throw new Error('没有识别出图片文字，原图仍保留。');
          ocrTexts.set(id,entry.text);
          setOcr(old=>active()?{...old,[id]:entry.text}:old);
        }catch(e){if(!active())return;failures.push(`图片文字 · ${labelFor({id,item})}：${readableError(e)}`);}
      }
      if(!await embedBatches([...ocrTexts].map(([id,text])=>({id,text:indexText(text)})),ocrVectors,'OCR 语义索引'))return;
      if(!active())return;
      setAnalysis(old=>{
        if(!active())return old;
        const next={...old};
        for(const item of (build?allItems:[])){
          const id=pathFor(item),textHash=hashFor(contentFor(item)),main=mainVectors.get(id),previous=old[id]?.textHash===textHash?old[id]:null;
          if(!main&&!previous&&!ocrVectors.has(id))continue;
          const base={...(previous || {}),...(main || {}),id,textHash};
          if(ocrTexts.has(id))base.alternates=ocrVectors.has(id)?[ocrVectors.get(id)]:[];
          next[id]=base;
        }
        return next;
      });
      const queryResult=queryVectors.get('__query__');
      if(queryRef.current.trim()===analyzedQuery)setQueryEmbedding(queryResult || null);
      const generated=mainVectors.size+ocrVectors.size+queryVectors.size;
      setMode(generated?'semantic':'keyword');setAnalysisFailures(failures);
      if(failures.length)setError(`本次索引有 ${failures.length} 项未完成；成功结果已保留，其余条目已继续分析。展开下方查看逐项原因。`);
      const limitation='索引最多取每张原文与图片文字各自前 20000 字符，原始素材没有改变。';
      const counts=build?`本次生成 ${mainVectors.size}/${corpus.length} 条原文向量，识别 ${ocrTexts.size}/${imageItems.length} 张图片文字，生成 ${ocrVectors.size}/${ocrTexts.size} 条 OCR 向量。`:queryResult?'查询已完成本机语义分析。':'查询没有可用向量，仍可使用关键词。';
      notice(`${counts}${failures.length?` ${failures.length} 项未完成，请查看原因。`:''}${queryRef.current.trim()!==analyzedQuery?' 查询已改变，请重新点击语义搜索。':''} ${limitation}`);
    }catch(e){if(active()){setAnalysisFailures(failures);setError(`本次索引未完成：${readableError(e)}。已有素材没有改变。`);}}
    finally{if(mounted.current&&analysisRun.current===run)setBusy('');}
  }
  function prepareExport(text,name,type,title,description='') {setCopyStatus('');setExportPreview({text,name,type,title,description});}
  function exportContent(format) {const paths=exportPaths.length?exportPaths:tab==='collections'&&collection?collection.itemPaths:selected?[pathFor(selected)]:[];if(!paths.length){notice('先选择要导出的卡片或收藏集。');return;}try{const text=exportSelectedItems(searchable,paths,format);prepareExport(text,`梦藏-${collection?.title || '选定素材'}.${format==='markdown'?'md':format}`,format==='json'?'application/json':format==='csv'?'text/csv;charset=utf-8':'text/markdown;charset=utf-8',format==='markdown'?'AI 上下文 · Markdown':format.toUpperCase(),`${paths.filter(path=>byPath.has(path)).length} 张卡片。请核对原文、来源与页码后复制或保存文件。`);}catch(e){setError(readableError(e));}}
  function exportWorkspace() {prepareExport(JSON.stringify(state,null,2),'梦藏-收藏集与白板.json','application/json','收藏集与白板状态','包含收藏集、卡片位置和连线；素材原文请从卡片另行导出。');}
  async function copyExport() {try{if(!navigator.clipboard?.writeText)throw new Error('当前环境不支持直接复制，可在预览中全选后复制。');await navigator.clipboard.writeText(exportPreview.text);setCopyStatus('内容已复制。');}catch(e){setCopyStatus(readableError(e));}}
  function saveExport() {try{downloadText(exportPreview.text,exportPreview.name,exportPreview.type);setCopyStatus('已请求浏览器保存文件。请在下载记录中确认实际文件。');}catch(e){setCopyStatus(`保存请求未完成：${readableError(e)}`);}}
  async function uploadSource(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;setBusy('extract');setError('');
    try {
      if(file.size>25*1024*1024)throw new Error('请使用 25 MB 以内的文件。');
      const isPdf=file.type==='application/pdf' || /\.pdf$/i.test(file.name),isImage=/^image\//.test(file.type);
      if(!isPdf&&!isImage){const text=await readFile(file);setDraft(d=>({...d,title:d.title || file.name,sourceTitle:file.name,sourcePath:'',expectedSourceHash:'',localFilename:file.name,original:text,body:'',pages:[],imageData:'',operationId:idFor()}));notice('原文已读取，选择片段后可保存摘录。');return;}
      const dataUrl=await readFile(file,true);
      if(typeof api?.discoveryExtract!=='function'){if(isImage&&demo){setDraft(d=>({...d,title:d.title || file.name,sourceTitle:file.name,sourcePath:'',expectedSourceHash:'',localFilename:file.name,imageData:dataUrl,original:'',body:'',pages:[],operationId:idFor()}));notice('图片已作为浏览器隔离草稿载入；OCR 尚未接入。');return;}throw new Error(isPdf?'当前连接器尚未提供 PDF 原文提取。':'当前连接器尚未提供图片 OCR。');}
      const result=valueOf(await api.discoveryExtract({base64:dataUrl.split(',')[1],kind:isPdf?'pdf':'image'}));
      const pages=(result.pages || []).filter(page=>Number.isFinite(Number(page.page))&&typeof page.text==='string');
      setDraft(d=>({...d,title:d.title || file.name,sourceTitle:file.name,sourcePath:'',expectedSourceHash:'',localFilename:file.name,original:pages[0]?.text || result.text || '',body:'',page:pages[0]?.page || '',pages,imageData:isImage&&demo?dataUrl:'',operationId:idFor()}));
      notice(result.text || pages.some(p=>p.text)?isPdf?`已提取 ${pages.length} 页原文，页码随摘录保留。`:'图片文字已由本机 OCR 提取。':'没有识别出文字，请核对文件；尚未生成摘录。');
    }catch(e){setError(readableError(e));}finally{setBusy('');}
  }
  function normalizePaste() {
    const source=draft.original;
    if(/^https?:\/\/\S+$/i.test(source.trim())){changeDraft('sourceUrl',source.trim());notice('已记录来源 URL。尚未抓取网页正文，可粘贴原文再摘录。');return;}
    if(/<\/?(?:html|body|p|div|article|section|h[1-6])\b/i.test(source)){const doc=new DOMParser().parseFromString(source,'text/html');doc.querySelectorAll('script,style,noscript').forEach(node=>node.remove());const body=doc.body.innerText || doc.body.textContent || '';setDraft(d=>({...d,original:body,title:d.title || doc.title,sourceTitle:d.sourceTitle || doc.title,sourceUrl:d.sourceUrl || safeUrl(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')),body:'',pages:[],operationId:idFor()}));notice('HTML 已转为原文；脚本未执行。');return;}
    notice('当前是纯文本，可以选取原文片段。');
  }
  function takeSelection() {if(!selectedText)return;setDraft(d=>({...d,body:selectedText,operationId:idFor()}));setSelectedText('');setCaptureStatus('已逐字提取所选原文。');}
  async function submitCapture() {
    const body=draft.body || draft.original;
    if(!draft.title.trim() || (!body.trim()&&!safeUrl(draft.sourceUrl)&&!(demo&&draft.imageData))){setError('填写标题，并添加原文、来源链接或图片。');return;}
    if(draft.sourceUrl && !safeUrl(draft.sourceUrl)){setError('来源网址须使用 http 或 https。');return;}
    if(!canCapture){try{localStorage.setItem(draftKey,JSON.stringify(draft));setCaptureStatus('采集草稿已留在本机，尚未写入 Obsidian。');}catch{setError('本机草稿未能保存，请先复制原文。');}return;}
    setBusy('capture');setError('');
    try {valueOf(await api.capture({operationId:draft.operationId,title:draft.title.trim(),body,caption:draft.caption,sourceUrl:safeUrl(draft.sourceUrl),sourceTitle:draft.sourceTitle,author:draft.author,page:/^[1-9]\d*$/.test(String(draft.page))?Number(draft.page):undefined,sourceLocation:/^[1-9]\d*$/.test(String(draft.page))?'':String(draft.page || ''),sourcePath:draft.sourcePath,expectedSourceHash:draft.expectedSourceHash,tags:draft.tags.split(/[,，\s]+/).filter(Boolean),...(demo&&draft.imageData?{imageData:draft.imageData}:{})}));setCaptureStatus(demo?'已保存到浏览器隔离素材库，未连接 Vault。':'采集已由连接器确认写入 Obsidian。');setDraft(blankCapture());notice(demo?'新卡片已加入浏览器素材库。':'新卡片已写入 Obsidian。');try{await onRefresh?.();}catch(e){setError(`卡片已保存，但列表刷新失败：${readableError(e)}`);}}
    catch(e){setError(`采集未完成：${readableError(e)}。草稿和重试标识已保留。`);}finally{setBusy('');}
  }
  function buildImportPreview(text,format,filename) {if(new Blob([text]).size>10*1024*1024)throw new Error('请使用 10 MB 以内的文本导入内容。');const parsed=parseImportText(text,format,{filename});const result=dedupeImports(parsed,allItems);const records=result.items.map(record=>({...record,operationId:idFor()}));setImportPreview({filename,items:records,duplicates:result.duplicates?.length ?? result.duplicates ?? 0});setImportPaths(records.map(record=>record.operationId));setImportPending([]);if(!records.length)notice('没有可新增的条目；请核对内容或重复条目。');}
  async function previewImport(event) {const file=event.target.files?.[0];event.target.value='';if(!file)return;setError('');setBusy('import-preview');try{if(file.size>10*1024*1024)throw new Error('请使用 10 MB 以内的文本导入文件。');buildImportPreview(await readFile(file),'auto',file.name);}catch(e){setError(`导入文件没有提交：${readableError(e)}`);}finally{setBusy('');}}
  function previewPastedImport() {setError('');try{if(!pasteImportText.trim())throw new Error('先粘贴要导入的内容。');const names={auto:'粘贴的导入内容',csv:'粘贴导入.csv',json:'粘贴导入.json',markdown:'粘贴导入.md',kindle:'粘贴的 Kindle 摘录.txt'};buildImportPreview(pasteImportText,pasteImportFormat,names[pasteImportFormat]);}catch(e){setError(`粘贴内容没有提交：${readableError(e)}`);}}
  async function commitImport() {
    if(!canCapture){setError('当前没有正式采集能力，预览已保留，尚未提交。');return;}
    const records=(importPreview?.items || []).filter(record=>importPaths.includes(record.operationId));if(!records.length)return;
    setBusy('import');setError('');let saved=0;const failed=[];
    for(const record of records){try{const numericPage=/^[1-9]\d*$/.test(String(record.page || ''))?Number(record.page):undefined;valueOf(await api.capture({operationId:record.operationId,title:record.title,body:record.body,caption:record.caption || '',sourceUrl:record.sourceUrl || '',sourceTitle:record.sourceTitle || '',author:record.author || '',page:numericPage,sourceLocation:numericPage===undefined?String(record.page || ''):'',importFingerprint:record.fingerprint,tags:['导入']}));saved++;}catch(e){failed.push(record);}}
    setImportPending(failed);setImportPreview(preview=>preview?{...preview,items:failed.length?failed:[],duplicates:preview.duplicates}:preview);setImportPaths(failed.map(record=>record.operationId));setBusy('');
    try{await onRefresh?.();}catch(e){setError(`已提交条目保持保存；列表刷新失败：${readableError(e)}`);}notice(`已保存 ${saved} 条${demo?'到浏览器隔离素材库':'到 Obsidian'}${failed.length?`，${failed.length} 条未完成，重试标识已保留`:''}。`);if(failed.length)setError('部分导入没有完成。仅重试下方未完成的条目，不会重新提交已成功条目。');
  }
  function renderInspector(drawer=false) {return <aside className={`discovery-inspector ${drawer?'discovery-inspector-drawer':''}`}><div className="discovery-detail-heading"><span className="discovery-section-eyebrow">这一张卡片</span>{drawer&&<button className="discovery-text-button" autoFocus onClick={closeDetail}><IconX size={16}/>返回素材</button>}</div>{imageFor(selected)&&<img className="discovery-inspector-image" src={imageFor(selected)} alt={selected.title || ''}/>}<h2>{selected.title || '未命名素材'}</h2><p className="discovery-inspector-body">{textFor(selected) || '这份素材保留在原笔记中。'}</p><div className="discovery-source-meta">{selected.author&&<span>{selected.author}</span>}{selected.sourceTitle&&<span>{selected.sourceTitle}</span>}{selected.page&&<span>{/^[1-9]\d*$/.test(selected.page)?`第 ${selected.page} 页`:`位置 ${selected.page}`}</span>}{selected.sourceLocation&&String(selected.sourceLocation)!==String(selected.page || '')&&<span>位置 {selected.sourceLocation}</span>}{safeUrl(selected.sourceUrl || selected.source)&&<a href={safeUrl(selected.sourceUrl || selected.source)} target="_blank" rel="noreferrer">查看来源<IconArrowUpRight size={12}/></a>}</div>{onOpen&&<button className="discovery-button" onClick={()=>{closeDetail();onOpen(pathFor(selected));}}><IconFileText size={14}/>{demo?'打开卡片':'打开原笔记'}<IconArrowUpRight size={14}/></button>}
        {textFor(selected)&&<button className="discovery-text-button" onClick={()=>{setDraft({...blankCapture(),title:selected.title || '',original:textFor(selected),sourceTitle:selected.sourceTitle || selected.title || '',sourceUrl:safeUrl(selected.sourceUrl),author:selected.author || '',page:selected.page || selected.sourceLocation || '',sourcePath:!demo&&/^[a-f0-9]{64}$/.test(selected.hash || '')?selected.path:'',expectedSourceHash:!demo&&/^[a-f0-9]{64}$/.test(selected.hash || '')?selected.hash:''});setTab('capture');setCaptureStatus('选择原文片段后，再明确保存摘录。');closeDetail();}}><IconQuote size={14}/>从这张卡片摘录</button>}
        {selected.caption&&<div className="discovery-inspector-caption"><span>我的配文</span><p>{selected.caption}</p></div>}
        <label className="discovery-add-collection">生长在收藏集中<select aria-label="将当前素材加入收藏集" value="" disabled={persistence==='error' || !ready} onChange={e=>addToCollection(e.target.value,[pathFor(selected)])}><option value="">加入收藏集…</option>{state.collections.map(c=><option key={c.id} value={c.id}>{c.title}{c.itemPaths.includes(pathFor(selected))?' · 已加入':''}</option>)}</select></label><div className="discovery-card-memberships">{state.collections.filter(c=>c.itemPaths.includes(pathFor(selected))).map(c=><span key={c.id}>{c.title}<button aria-label={`从${c.title}移除此卡片`} disabled={!ready || persistence==='error'} onClick={()=>setState(s=>({...s,collections:s.collections.map(v=>v.id===c.id?{...v,itemPaths:v.itemPaths.filter(path=>path!==pathFor(selected))}:v)}))}><IconX size={11}/></button></span>)}</div>
        {ocr[pathFor(selected)]&&<details className="discovery-ocr-text"><summary>已识别的图片文字</summary><p>{ocr[pathFor(selected)]}</p></details>}
        <div className="discovery-related-title"><h3>{validEmbeddings[pathFor(selected)]?'语义上相邻的想法':'同标签的素材'}</h3><IconSparkles size={16} stroke={1.3}/></div><p className="discovery-related-caption">{validEmbeddings[pathFor(selected)]?'由本机向量检索得到，尚未确认关系。':'语义索引尚未建立；这里只按实际标签匹配。'}</p><div className="discovery-related-list">{related.map(({item,score})=><button key={pathFor(item)} onClick={()=>openDetail(pathFor(item))}>{imageFor(item)?<img src={imageFor(item)} alt=""/>:<IconQuote size={21} stroke={1.1}/>}<span><strong>{item.title || '未命名素材'}</strong><small>{Number.isFinite(score)?`相似度 ${score.toFixed(2)} · cosine`:item.category || '同标签'}</small></span><IconChevronRight size={14}/></button>)}</div>{!related.length&&<p className="discovery-related-empty">{validEmbeddings[pathFor(selected)]?'当前没有其他兼容语义向量。':'暂未找到同标签素材。可以主动建立语义索引。'}</p>}{canAnalyze&&<button className="discovery-text-button" onClick={()=>analyze(true)} disabled={!!busy}><IconSparkles size={14}/>{busy==='analysis'?'本机分析中…':'建立 / 更新语义索引'}</button>}
      </aside>;}
  const exportCount=exportPaths.length || (tab==='collections'&&collection?collection.itemPaths.length:selected?1:0);
  return <div ref={root} className={`discovery-view ${hidden?'is-hidden':''} ${focusMode?'has-sublime-focus':''}`}> 
    <header className="discovery-header"><form className="discovery-search" onSubmit={e=>{e.preventDefault();if(mode==='semantic')analyze(!Object.keys(validEmbeddings).length);}}><IconSearch size={20} stroke={1.4}/><input aria-label="搜索素材" placeholder={mode==='semantic'?'描述你记得的画面、感受或想法…':'搜索素材、原文和来源…'} value={query} onChange={e=>changeQuery(e.target.value)}/>{query&&<button type="button" aria-label="清空搜索" onClick={()=>changeQuery('')}><IconX size={16}/></button>}<kbd>素材</kbd></form><button className="discovery-button primary" onClick={()=>setTab('capture')}><IconPlus size={16}/>保存一束想法</button></header>
    <div className="discovery-subnav"><nav aria-label="素材工作台">{[['discover','发现',IconSparkles],['collections','收藏集',IconBookmarks],['canvas','白板',IconLayersIntersect],['capture','采集',IconPlus]].map(([id,label,Icon])=><button key={id} className={tab===id?'is-active':''} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);if(id==='discover'){setCollectionId('all');setBrowseAll(false);}}}><Icon size={16} stroke={1.5}/>{label}{id==='collections'&&state.collections.length>0&&<small>{state.collections.length}</small>}</button>)}</nav><span className="discovery-location">{demo?'浏览器隔离 · 未连接 Vault':connected?'Personal AI OS · 本机连接':'未连接 · 保留本机草稿'}</span></div>
    {error&&<div className="discovery-error" role="alert"><IconAlertCircle size={16}/><span>{error}{error.startsWith('本次索引')&&analysisFailures.length>0&&<details><summary>未完成条目与原因（{analysisFailures.length}）</summary><ul style={{maxHeight:180,overflow:'auto',paddingLeft:18}}>{analysisFailures.map((failure,index)=><li key={index}>{failure}</li>)}</ul></details>}</span><button onClick={()=>setError('')} aria-label="收起错误"><IconX size={15}/></button></div>}
    {message&&<div className="discovery-notice" role="status"><IconCheck size={14}/>{message}</div>}
    {tab==='discover'||tab==='collections'?<div className={`discovery-library ${tab==='collections'?'has-collections':''} ${focusMode?'is-focus-layout':''}`}>
      {tab==='collections'&&<aside className="discovery-collection-sidebar"><div className="discovery-section-eyebrow">让同一张卡片，生长在不同想法里</div><button className={`discovery-collection-link ${collectionId==='all'?'is-active':''}`} onClick={()=>setCollectionId('all')}><IconLayoutGrid size={16}/>全部素材<small>{allItems.length}</small></button>{state.collections.map(c=><button key={c.id} className={`discovery-collection-link ${collectionId===c.id?'is-active':''}`} onClick={()=>setCollectionId(c.id)}><IconBookmarks size={16}/><span>{c.title}</span><small>{c.itemPaths.filter(path=>byPath.has(path)).length}</small></button>)}<form className="discovery-new-collection" onSubmit={e=>{e.preventDefault();createCollection();}}><input value={newTitle} aria-label="新收藏集名称" placeholder="一个想探索的主题…" onChange={e=>setNewTitle(e.target.value)}/><button className="discovery-text-button" disabled={!ready || persistence==='error' || !newTitle.trim()}><IconPlus size={14}/>创建收藏集</button></form><p>卡片可以属于多个收藏集。<br/>公开分享与云端协作尚未接入。</p>{collection&&<button className="discovery-button" disabled={persistence==='error'} onClick={()=>createBoard(true)}><IconLayersIntersect size={15}/>在白板上展开</button>}</aside>}
      <main className="discovery-library-main">{!focusMode&&<div className="discovery-library-heading"><div><span className="discovery-section-eyebrow">{tab==='collections'?'COLLECTIONS':'COLLECT · CONNECT · CREATE'}</span><h2>{collectionId!=='all'&&collection?collection.title:tab==='collections'?'我的收藏':'从一个想法，走向下一个'}</h2><p>{tab==='collections'?'保留来处，也给它一个新的位置。':'保存触动你的文字与画面，让连接慢慢浮现。'}</p></div><span className="discovery-item-count">{resultItems.length} 张卡片</span></div>}
        <div className="discovery-filter-bar"><div className="discovery-search-modes"><button className={mode==='keyword'?'is-active':''} onClick={()=>{setMode('keyword');setQueryEmbedding(null);}}>关键词</button><button className={mode==='semantic'?'is-active':''} onClick={()=>canAnalyze?analyze(!Object.keys(validEmbeddings).length):notice('当前连接器尚未提供语义分析，只使用关键词检索。')} disabled={busy==='analysis'}><IconSparkles size={13}/>{busy==='analysis'?'本机分析中…':'语义搜索'}</button></div><span className="discovery-analysis-status">{mode==='semantic'?query.trim()&&!queryEmbedding?'输入后点击语义搜索':queryEmbedding?`${compatibleCount} 条同语种可检索`:`${Object.keys(validEmbeddings).length} 条已分析`:'按原文匹配'}{Object.keys(ocr).length?` · ${Object.keys(ocr).length} 张 OCR`:''}{Object.keys(validEmbeddings).length>0&&' · 每项索引前 2 万字符'}</span><details className="discovery-export-menu"><summary><IconDownload size={14}/>导出 {exportCount?`(${exportCount})`:''}</summary><div>{[['markdown','AI 上下文 · Markdown'],['csv','CSV'],['json','JSON']].map(([format,label])=><button key={format} onClick={()=>exportContent(format)}>{label}</button>)}</div></details></div>
        {!!exportPaths.length&&<div className="discovery-selection-bar"><span>已选择 {exportPaths.length} 张卡片</span>{state.collections.length>0&&<select aria-label="将所选卡片加入收藏集" disabled={!ready || persistence==='error'} value="" onChange={e=>addToCollection(e.target.value,exportPaths)}><option value="">加入收藏集…</option>{state.collections.map(c=><option value={c.id} key={c.id}>{c.title}</option>)}</select>}<button className="discovery-text-button" disabled={persistence==='error'} onClick={()=>createBoard()}><IconLayersIntersect size={14}/>创建白板</button><button className="discovery-text-button" onClick={()=>setExportPaths([])}>取消选择</button></div>}
        {focusMode?<FocusConstellation reference={selected} cards={focusCards} relatedPaths={new Set(related.map(({item})=>pathFor(item)))} onSelect={path=>{setSelectedPath(path);setDetailOpen(true);}} exportPaths={exportPaths} onCheck={togglePath} onBrowse={()=>setBrowseAll(true)} onCapture={()=>setTab('capture')} animate={!hidden&&!reducedMotion} demo={demo}/>:<div className="discovery-grid">{resultItems.map(({item,score},index)=><MaterialCard index={index} animate={!hidden&&!reducedMotion} key={`${hidden?'hidden':'visible'}:${pathFor(item)}`} item={item} score={score} selected={pathFor(selected)===pathFor(item)} checked={exportPaths.includes(pathFor(item))} onSelect={()=>openDetail(pathFor(item))} onCheck={()=>togglePath(pathFor(item))}/>)}</div>}
        {!resultItems.length&&<div className="discovery-empty"><IconSparkles size={32} stroke={1}/><h3>{busy==='analysis'?'本机正在寻找连接…':query.trim()?mode==='semantic'&&!queryEmbedding?'让本机理解这句描述':'没有找到匹配素材':collectionId!=='all'?'这个收藏集还有很多可能':'先保存触动你的东西'}</h3><p>{busy==='analysis'?'本机分析原文和图片文字，完成后显示检索结果。':query.trim()?mode==='semantic'&&!queryEmbedding?'点击“语义搜索”生成真实查询向量。':mode==='semantic'&&!compatibleCount?'当前没有与查询语种兼容的向量，请使用素材原文语种或关键词检索。':'试试其他表达，或回到关键词检索。':collectionId!=='all'?'在全部素材中选卡片，再加入这个收藏集。':'从一句原文、一张图片或一个链接开始。'}</p><button className="discovery-button" onClick={()=>query.trim()?changeQuery(''):(setTab(collectionId!=='all'?'discover':'capture'),setCollectionId('all'))}>{query.trim()?'清空搜索':collectionId!=='all'?'查看全部素材':'采集素材'}</button></div>}
      </main>
      {selected&&!focusMode&&renderInspector()}
    </div>:tab==='canvas'?<div className="discovery-canvas-layout"><aside className="discovery-collection-sidebar"><span className="discovery-section-eyebrow">想法需要一点空间</span><h2>我的白板</h2>{state.boards.map(b=><button className={`discovery-collection-link ${board?.id===b.id?'is-active':''}`} key={b.id} onClick={()=>setBoardId(b.id)}><IconLayersIntersect size={16}/><span>{b.title}</span><small>{b.nodes.length}</small></button>)}<button className="discovery-button" disabled={!ready || persistence==='error'} onClick={()=>createBoard()}><IconPlus size={15}/>新建空白板</button><p>拖动与连线会保存实际位置。<br/>连线仅代表你在白板上的整理。</p><button className="discovery-text-button" onClick={exportWorkspace}><IconDownload size={14}/>导出白板与收藏集</button></aside>{board?<CanvasBoard board={board} items={allItems} onChange={next=>{if(ready&&persistence!=='error')setState(s=>({...s,boards:s.boards.map(b=>b.id===next.id?next:b)}));}}/>:<div className="discovery-empty"><IconLayersIntersect size={42} stroke={1}/><h3>留一点空间，给新的连接</h3><p>建立一张空白板，或在收藏集中把素材一起展开。</p><button className="discovery-button primary" disabled={!ready||persistence==='error'} onClick={()=>createBoard()}>建立白板<IconPlus size={15}/></button></div>}</div>:<div className="discovery-capture-layout">
      <main className="discovery-capture-main"><div className="discovery-library-heading"><div><span className="discovery-section-eyebrow">SAVE THE MOMENT</span><h2>把这一刻，留下来</h2><p>粘贴原文，选择一段触动你的话。来处也一起保留。</p></div><button className="discovery-button" onClick={()=>fileInput.current?.click()} disabled={!!busy}><IconUpload size={15}/>读取 PDF / 图片</button></div><input ref={fileInput} hidden type="file" accept="application/pdf,image/*,.txt,.md,.html" onChange={uploadSource}/><input ref={importInput} hidden type="file" accept=".csv,.json,.md,.txt,text/csv,application/json,text/plain" onChange={previewImport}/>
        <div className="discovery-capture-note"><IconLink size={16}/><span>{demo?'内容保存在当前浏览器隔离库，不连接 Personal AI OS。':canCapture?'只有点击保存，才由本机连接器写入 Obsidian。':'当前采集能力尚未接入。内容保留为本机草稿。'}</span></div>
        <label className="discovery-field">卡片标题<input value={draft.title} onChange={e=>changeDraft('title',e.target.value)} placeholder="这段内容，让你想到了什么？"/></label>
        <div className="discovery-original-heading"><label htmlFor="discovery-original">原文 / URL / HTML</label><div>{draft.pages.length>0&&<select aria-label="PDF 原文页码" value={draft.page} onChange={e=>{const page=draft.pages.find(p=>String(p.page)===e.target.value);setDraft(d=>({...d,page:page.page,original:page.text,body:'',operationId:idFor()}));setSelectedText('');}}>{draft.pages.map(page=><option key={page.page} value={page.page}>第 {page.page} 页</option>)}</select>}<button className="discovery-text-button" onClick={normalizePaste}>整理粘贴内容</button></div></div>
        <textarea id="discovery-original" ref={originalRef} className="discovery-original" value={draft.original} onChange={e=>{changeDraft('original',e.target.value);setSelectedText('');}} onSelect={e=>setSelectedText(e.target.value.slice(e.target.selectionStart,e.target.selectionEnd))} rows={8} placeholder="在这里粘贴原文，选取要保存的片段。链接不会自动变成已抓取全文。"/>
        <div className="discovery-excerpt-action"><span>{selectedText?`已选择 ${selectedText.length} 个字符`:draft.pages.length?'选取当前页原文，页码随摘录保留':'在原文中选择一个片段'}</span><button className="discovery-button" disabled={!selectedText} onClick={takeSelection}><IconQuote size={14}/>保存这段摘录</button></div>
        {draft.imageData&&<img className="discovery-upload-preview" src={draft.imageData} alt="待保存的原始图片"/>}
        <label className="discovery-field">卡片内容<textarea value={draft.body} onChange={e=>changeDraft('body',e.target.value)} rows={4} placeholder="所选原文会出现在这里；留空时保存上方原文。"/></label>{draft.body&&draft.original&&!draft.original.includes(draft.body)&&<p className="discovery-field-warning">内容已修改，不再是原文的逐字摘录。</p>}
        <label className="discovery-field">我的配文 / 注释<textarea value={draft.caption} onChange={e=>changeDraft('caption',e.target.value)} rows={2} placeholder="自己的思考与原文分开保存。"/></label>
        {draft.localFilename&&<p className="discovery-file-boundary">当前本机文件名：{draft.localFilename}。原文件尚未归档，尚无原文件的持久链接。{!demo?'图片仅提取文字，原图尚未上传。':''}</p>}
        <div className="discovery-fields-grid"><label className="discovery-field">来源标题<input value={draft.sourceTitle} onChange={e=>changeDraft('sourceTitle',e.target.value)} placeholder="文章、书籍或文件名"/></label><label className="discovery-field">作者<input value={draft.author} onChange={e=>changeDraft('author',e.target.value)} placeholder="保留原作者"/></label><label className="discovery-field wide">来源链接<input value={draft.sourceUrl} onChange={e=>changeDraft('sourceUrl',e.target.value)} placeholder="https://…"/></label><label className="discovery-field">页码 / 位置<input inputMode="numeric" value={draft.page} onChange={e=>changeDraft('page',e.target.value)} placeholder="PDF / 书籍摘录"/></label><label className="discovery-field">标签<input value={draft.tags} onChange={e=>changeDraft('tags',e.target.value)} placeholder="用逗号分隔"/></label></div>
        <div className="discovery-capture-footer"><span>{captureStatus || (draft.original || draft.body || draft.title?'本机采集草稿 · 尚未提交':'保留原文与来源，慢慢整理')}</span><button className="discovery-button primary" disabled={!!busy} onClick={submitCapture}>{busy==='capture'?<IconLoader2 className="discovery-spin" size={15}/>:<IconCheck size={15}/>} {busy==='capture'?'保存中…':canCapture?demo?'保存到浏览器素材库':'保存到 Obsidian':'保留本机草稿'}</button></div>
      </main><aside className="discovery-capture-aside"><IconBookmarks size={28} stroke={1.1}/><h3>把已有收藏带过来</h3><p>读取 CSV、JSON、Markdown 或 Kindle 文本。先核对预览，再提交所选条目。</p><button className="discovery-button" onClick={()=>importInput.current?.click()} disabled={!!busy}><IconUpload size={15}/>选择导入文件</button><p className="discovery-import-boundary">这里是文件导入。Kindle、Readwise、X、Instagram 账号连接尚未接入。</p>
        <details className="discovery-paste-import"><summary>粘贴导入内容</summary><p>可以直接粘贴导出的 CSV、JSON、Markdown 或 Kindle 摘录。预览与文件导入使用相同的去重和保存流程。</p><label className="discovery-field">内容格式<select aria-label="粘贴导入格式" value={pasteImportFormat} onChange={e=>setPasteImportFormat(e.target.value)} disabled={!!busy}><option value="auto">自动识别</option><option value="csv">CSV</option><option value="json">JSON</option><option value="markdown">Markdown</option><option value="kindle">Kindle 文本</option></select></label><label className="discovery-field">导入原文<textarea aria-label="粘贴导入内容" value={pasteImportText} onChange={e=>setPasteImportText(e.target.value)} rows={7} placeholder="粘贴已有收藏的导出内容…" disabled={!!busy}/></label><button className="discovery-button" disabled={!!busy || !pasteImportText.trim()} onClick={previewPastedImport}><IconFileText size={15}/>预览粘贴导入</button></details>
        {importPreview&&<section className="discovery-import-preview"><div><h4>{importPreview.filename}</h4><button className="discovery-text-button" disabled={busy==='import'} onClick={()=>{setImportPreview(null);setImportPending([]);}} aria-label="关闭导入预览"><IconX size={14}/></button></div><p>{importPreview.items.length} 条待提交 · {importPreview.duplicates} 条重复已跳过</p><div className="discovery-import-list">{importPreview.items.map(record=><label key={record.operationId}><input type="checkbox" checked={importPaths.includes(record.operationId)} onChange={()=>setImportPaths(paths=>paths.includes(record.operationId)?paths.filter(p=>p!==record.operationId):[...paths,record.operationId])}/><span><strong>{record.title}</strong><small>{record.body?.slice(0,170)}</small><em>{record.sourceTitle || record.sourceUrl || ''}{record.page?` · 第 ${record.page} 页`:''}</em></span></label>)}</div><button className="discovery-button primary" disabled={!!busy || !importPaths.length || !canCapture} onClick={commitImport}>{busy==='import'?'正在逐条提交…':importPending.length?`重试 ${importPending.length} 条未完成项`:`确认导入 ${importPaths.length} 条`}</button>{!canCapture&&<small>采集能力尚未接入，预览不会写入 Obsidian。</small>}</section>}
        <div className="discovery-capture-tip"><IconQuote size={19} stroke={1}/><p>一小段值得重读的文字，<br/>比一个忘记打开的链接更有用。</p></div><details className="discovery-export-backup"><summary>保留采集草稿副本</summary><button className="discovery-text-button" onClick={()=>prepareExport(JSON.stringify(draft,null,2),'梦藏-未提交采集草稿.json','application/json','未提交采集草稿','当前内容尚未写入 Obsidian。保存副本前请核对内容。')}>预览草稿 JSON<IconDownload size={13}/></button></details>
      </aside>
    </div>}
    {detailOpen&&selected&&<DiscoveryDialog className="discovery-detail-dialog" label="素材卡片详情" onClose={()=>setDetailOpen(false)}>{renderInspector(true)}</DiscoveryDialog>}
    {exportPreview&&<DiscoveryDialog className="discovery-export-dialog" label="导出内容预览" onClose={()=>setExportPreview(null)}><div className="discovery-dialog-heading"><div><span className="discovery-section-eyebrow">导出内容预览</span><h2>{exportPreview.title}</h2></div><button className="discovery-text-button" autoFocus aria-label="关闭导出预览" onClick={closeExport}><IconX size={18}/></button></div><p>{exportPreview.description}</p><label className="discovery-field">{exportPreview.name}<textarea aria-label="导出内容" className="discovery-export-content" readOnly value={exportPreview.text} rows={15}/></label><div className="discovery-dialog-actions"><span role="status">{copyStatus || '预览内容尚未保存为文件。'}</span><button className="discovery-button" onClick={copyExport}>复制内容</button><button className="discovery-button primary" onClick={saveExport}><IconDownload size={15}/>保存文件</button></div></DiscoveryDialog>}
    <footer className="discovery-workspace-status"><span>{demo?'浏览器隔离素材库':'本机素材工作台'} · {allItems.length} 张素材</span>{persistence==='error'&&<button className="discovery-text-button" onClick={exportWorkspace}>导出窗口状态</button>}<span>{persistence==='loading'?'正在读取状态…':persistence==='saving'?'收藏集 / 白板保存中…':persistence==='error'?'状态保存存在问题':persistence==='local'?'收藏集 / 白板在本机浏览器':'收藏集 / 白板已保存'}</span></footer>
  </div>;
}
