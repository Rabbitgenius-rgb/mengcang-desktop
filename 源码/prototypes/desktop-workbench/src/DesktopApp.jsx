import WorkspaceSearch from './WorkspaceSearch.jsx';
import React,{useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {IconBulb,IconPhoto,IconBook2,IconFolder,IconSettings,IconLeaf,IconX,IconRefresh,IconAlertCircle,IconCheck,IconArrowUpRight,IconArrowLeft,IconArrowRight,IconSearch,IconCalendarEvent} from '@tabler/icons-react';
import {ErrorBoundary} from './ErrorBoundary.jsx';
import Inspiration from './Inspiration.jsx';
import {MaterialsView,BooksView} from './Collections.jsx';
import {DesktopNote,DesktopRelations} from './DesktopNote.jsx';
import {VIEWS,identityKey,normalizeRecord,valueOf,readableError,connectionErrorMessage} from './desktopModel.js';
import ScheduleView from './ScheduleView.jsx';
import {projectWorkSummary} from './workOverviewModel.js';
import {localDateKey,localTimeZone} from './scheduleModel.js';
import QuickOpen from './QuickOpen.jsx';
import RelatedPreview from './RelatedPreview.jsx';
import SublimeWorkspace from './sublime/SublimeWorkspace.jsx';
import {emptyHistory,remember,travel,captureScroll,restoreScroll} from './workspaceHistory.js';
import './desktop.css';

const api=window.mengcang;
function Settings({onClose,status,onPair,onRefresh,busy,reduced,setReduced,error}) {
  const ref=useRef(null);
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  const identity=status?.identity;
  return <dialog ref={ref} className="root-dialog" aria-label="梦藏设置" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal settings-modal"><header className="modal-heading"><h2>设置</h2><button className="icon-btn" autoFocus aria-label="关闭设置" onClick={onClose}><IconX size={20}/></button></header><section className="settings-section"><h3>Obsidian 连接 <span className="status-chip">{status?.connected?'已连接':'未连接'}</span></h3><p>梦藏连接 Personal AI OS。正式笔记和附件保存在你的 Obsidian 仓库中。</p>{identity && <dl className="desktop-identity"><dt>仓库</dt><dd>{identity.name || identity.vaultName || 'Personal AI OS'}</dd><dt>位置</dt><dd>{identity.path || identity.vaultPath || '已核对本机仓库'}</dd></dl>}<div className="desktop-settings-buttons"><button className="btn btn-primary" disabled={busy} onClick={onPair}>{busy?'正在连接…':status?.paired?'重新配对':'连接 Personal AI OS'}</button><button className="btn" disabled={busy} onClick={onRefresh}><IconRefresh size={15}/>重新检查</button></div>{error && <p className="desktop-inline-error" role="alert">{error}</p>}{status?.message && <p>{status.message}</p>}</section><section className="setting-toggle"><div><h3>减少动态效果</h3><p>关闭页面过渡，隐藏窗口时暂停动画。</p></div><button className={`toggle ${reduced?'on':''}`} role="switch" aria-label="减少动态效果" aria-checked={reduced} onClick={()=>setReduced(!reduced)}><span/></button></section><section className="settings-section"><h3>此版本</h3><p>浏览与整理真实灵感、素材、藏书和日程。书籍使用已有原书打开；备忘录自动同步、网页自动快照与内置 PDF 阅读器将在后续版本接入。</p><p>搜索快捷键：⌘ K</p></section></section></dialog>;
}
function readableStatus(status) {return status?.connected===true || ['connected','ready'].includes(status?.state || status?.status);}
export default function DesktopApp() {
  const [view,setView]=useState('inspiration'),[snapshot,setSnapshot]=useState(null),[status,setStatus]=useState({connected:false}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[settings,setSettings]=useState(false),[pairing,setPairing]=useState(false),[reduced,setReduced]=useState(matchMedia('(prefers-reduced-motion: reduce)').matches),[hidden,setHidden]=useState(document.hidden),[history,setHistory]=useState(emptyHistory),[restoreRequest,setRestoreRequest]=useState(null),[peekPaths,setPeekPaths]=useState([]),[peekFuture,setPeekFuture]=useState([]),[quick,setQuick]=useState(false),[toast,setToast]=useState('');
  const navigation=useRef({}),panels=useRef(null),restoreSequence=useRef(0),peekOrigin=useRef(null),noteWorkspace=useRef({}),pendingScroll=useRef(null);
  const registerNavigation=useCallback((id,controller)=>{navigation.current[id]=controller;return()=>{if(navigation.current[id]===controller)delete navigation.current[id];};},[]);
  const mounted=useRef(true),refreshTask=useRef(null),refreshAgain=useRef(false),refreshTimer=useRef(null),toastTimer=useRef(null),preferencesReady=useRef(false),snapshotRef=useRef(null),pairingFailure=useRef(null);
  const notify=useCallback(text=>{setToast(text);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4200);},[]);
  const refresh=useCallback(async()=>{
    if(refreshTask.current){refreshAgain.current=true;return refreshTask.current;}
    refreshTask.current=(async()=>{
      let state;
      try {
        state=valueOf(await api.status());
        if(mounted.current)setStatus({...state,connected:readableStatus(state)});
        const data=valueOf(await api.snapshot());
        if(!data || !Array.isArray(data.entries) || !Array.isArray(data.materials) || !Array.isArray(data.books))throw new Error('仓库返回的数据不完整，请重新检查连接。');
        if(mounted.current){snapshotRef.current=data;setSnapshot(data);setError(pairingFailure.current?readableError(pairingFailure.current):'');if(data.identity)setStatus(current=>({...current,identity:data.identity}));}
        return data;
      } catch(e){if(mounted.current){setError(connectionErrorMessage(e,state,pairingFailure.current));setStatus(current=>({...current,connected:false}));}throw e;}
      finally {if(mounted.current)setLoading(false);refreshTask.current=null;if(refreshAgain.current){refreshAgain.current=false;clearTimeout(refreshTimer.current);refreshTimer.current=setTimeout(()=>refresh().catch(()=>{}),100);}}
    })();
    return refreshTask.current;
  },[]);
  useEffect(()=>{
    mounted.current=true;
    api.rendererReady?.();
    api.preferencesGet().then(valueOf).then(p=>{if(!mounted.current)return;if(VIEWS.includes(p?.view))setView(p.view);if(typeof p?.reducedMotion==='boolean')setReduced(p.reducedMotion);preferencesReady.current=true;}).catch(()=>{preferencesReady.current=true;});
    refresh().catch(()=>{});
    const unsubscribe=api.subscribe(event=>{
      if(event?.type==='status' && event.status)setStatus(current=>({...current,...event.status,connected:readableStatus(event.status)}));
      clearTimeout(refreshTimer.current);refreshTimer.current=setTimeout(()=>refresh().catch(()=>{}),150);
    });
    const visible=()=>{setHidden(document.hidden);if(!document.hidden)refresh().catch(()=>{});};
    document.addEventListener('visibilitychange',visible);
    return()=>{mounted.current=false;unsubscribe?.();clearTimeout(refreshTimer.current);clearTimeout(toastTimer.current);document.removeEventListener('visibilitychange',visible);};
  },[refresh]);
  useEffect(()=>{if(preferencesReady.current)api.preferencesSet({view,reducedMotion:reduced}).then(valueOf).catch(e=>notify(`界面偏好未能保存：${readableError(e)}`));},[view,reduced]);
  const [discoveryOpen,setDiscoveryOpen]=useState(false);
  const discoveryIdentityId=snapshot?.identity?.id || status.identity?.id;
  const discoveryApi=useMemo(()=>({...api,captureAvailable:snapshot?.capabilities?.capture===true && status.connected===true,captureAttachmentAvailable:snapshot?.capabilities?.captureAttachment===true && status.connected===true,discoveryStateGet:()=>api.discoveryStateGet(discoveryIdentityId),discoveryStateSet:value=>api.discoveryStateSet(value,discoveryIdentityId)}),[snapshot?.capabilities?.capture,snapshot?.capabilities?.captureAttachment,status.connected,discoveryIdentityId]);
  const projects=snapshot?.projects || [];
  const [projectQuery,setProjectQuery]=useState('');
  const visibleProjects=projects.filter(project=>[project.title,project.name,project.goal].filter(Boolean).join(' ').toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()));

  const entries=useMemo(()=>(snapshot?.entries || []).map(n=>normalizeRecord(n,api,projects)),[snapshot]);
  const materials=useMemo(()=>(snapshot?.materials || []).map(n=>normalizeRecord(n,api,projects)),[snapshot]);
  const books=useMemo(()=>(snapshot?.books || []).map(n=>normalizeRecord(n,api,projects)),[snapshot]);
  const schedules=snapshot?.schedules || [];
  const scheduleEnabled=snapshot?.capabilities?.schedule===true && Array.isArray(snapshot?.schedules) && typeof api.scheduleSave==='function';
  const workEnabled=scheduleEnabled && snapshot?.capabilities?.workOverview===true && snapshot?.capabilities?.scheduleSchemaVersion===2;
  const scheduleSources=useMemo(()=>[...entries,...materials,...books].map(item=>({path:item.path,title:item.title,kind:item.kind})),[entries,materials,books]);
  const connected=status.connected===true;
  useEffect(()=>{if(connected)window.dispatchEvent(new Event('mengcang-assets-refresh'));},[connected]);
  const identity=snapshot?.identity || status.identity;
  const invoke=async(method,path)=>{try{valueOf(await api[method](path));}catch(e){notify(readableError(e));}};
  function capture() {
    const panel=panels.current?.querySelector(`[data-workspace="${view}"]`);
    const scroll=captureScroll(panel).map(position=>{const node=panel?.querySelector(position.selector);return peekPaths.length&&peekOrigin.current?.view===view&&!node?.getClientRects().length?peekOrigin.current.scroll.find(p=>p.selector===position.selector)||position:position;});
    return {view,ui:navigation.current[view]?.capture() || {},scroll,peek:[...peekPaths]};
  }
  function closePeek() {setPeekPaths([]);setPeekFuture([]);}
  function beforeSelect() {pendingScroll.current=null;setHistory(h=>remember(h,capture()));closePeek();}
  function requestLeave(proceed){const event=new CustomEvent('mengcang-before-leave',{cancelable:true,detail:{proceed}});if(window.dispatchEvent(event))proceed();}
  function switchView(next) {if(next===view)return;requestLeave(()=>{beforeSelect();setView(next);});}
  function preview(path) {if(path){if(!peekPaths.length)peekOrigin.current=capture();if(peekPaths.at(-1)!==path)setPeekFuture([]);setPeekPaths(paths=>paths.at(-1)===path?paths:[...paths,path]);}}
  // Inside a preview stack, back and forward step through previews first; the
  // workspace history records the open stack so returning reopens it.
  function peekBack() {if(peekPaths.length<2)return;setPeekFuture(future=>[...future,peekPaths.at(-1)]);setPeekPaths(paths=>paths.slice(0,-1));}
  function peekForward() {const next=peekFuture.at(-1);if(!next)return;setPeekFuture(future=>future.slice(0,-1));setPeekPaths(paths=>[...paths,next]);}
  function back() {if(peekPaths.length>1)peekBack();else move('back');}
  function forward() {if(peekPaths.length&&peekFuture.length)peekForward();else move('forward');}
  function navigate(path) {requestLeave(()=>navigateNow(path));}
  function navigateNow(path) {
    const next=entries.some(n=>n.path===path)?'inspiration':materials.some(n=>n.path===path)?'materials':books.some(n=>n.path===path)?'books':schedules.some(n=>n.path===path)?'schedule':projects.some(p=>(p.path || p.notePath)===path)?'projects':null;
    setQuick(false);
    if(!next){invoke('openNote',path);return;}
    beforeSelect();setView(next);
    navigation.current[next]?.open?.(path);
    if(next==='projects')setProjectQuery('');
    if(next==='projects')requestAnimationFrame(()=>{Array.from(panels.current?.querySelectorAll('[data-project-path]') || []).find(el=>el.dataset.projectPath===path)?.scrollIntoView({block:'nearest'});});
  }
  function move(direction) {requestLeave(()=>moveNow(direction));}
  function moveNow(direction) {
    const result=travel(history,capture(),direction);if(!result)return;
    const peek=result.target.peek || [];
    peekOrigin.current=peek.length?result.target:null;
    setHistory(result.history);setPeekPaths(peek);setPeekFuture([]);setView(result.target.view);
    setRestoreRequest({...result.target,key:++restoreSequence.current});
  }
  const restoreWhenReady=useCallback(()=>{
    const request=pendingScroll.current;if(!request)return;
    const panel=panels.current?.querySelector(`[data-workspace="${request.view}"]`);
    if(!panel || panel.hidden || Array.from(panel.querySelectorAll('[data-note-ready]')).some(note=>note.dataset.noteReady!=='true'))return;
    requestAnimationFrame(()=>{if(pendingScroll.current!==request)return;restoreScroll(panel,request.scroll);pendingScroll.current=null;});
  },[]);
  useLayoutEffect(()=>{
    if(!restoreRequest)return;
    navigation.current[restoreRequest.view]?.restore(restoreRequest.ui);
    pendingScroll.current=restoreRequest;
    const frame=requestAnimationFrame(restoreWhenReady);
    return()=>cancelAnimationFrame(frame);
  },[restoreRequest,restoreWhenReady]);
  useEffect(()=>{
    const key=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!settings)setQuick(true);return;}
      if(quick||settings)return;
      if((e.metaKey||e.ctrlKey)&&['[',']'].includes(e.key)){e.preventDefault();if(e.key==='[')back();else forward();}
      if(e.key==='Escape'&&peekPaths.length){e.preventDefault();closePeek();}
    };
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[history,view,peekPaths,peekFuture,quick,settings]);
  async function pair() {setPairing(true);pairingFailure.current=null;setError('');try{const state=valueOf(await api.pair());setStatus({...state,connected:readableStatus(state)});await refresh();notify('已连接 Personal AI OS');}catch(e){pairingFailure.current=e;setError(readableError(e));}finally{setPairing(false);}}
  const detail=(item,compact=false)=><DesktopNote key={`note:${identityKey(identity)}:${item.path}`} item={item} api={api} identity={identity} connected={connected} onSaved={refresh} onNavigate={preview} compact={compact} workspaceState={noteWorkspace.current[item.path]} onWorkspaceState={state=>{noteWorkspace.current[item.path]=state;}} onReady={restoreWhenReady}/>;
  const related=item=><DesktopRelations key={`relations:${identityKey(identity)}:${item.path}`} item={item} api={api} identity={identity} connected={connected} revision={snapshot?.revision} onSaved={refresh} onNavigate={preview} materials={materials}/>;
  const nav=[['inspiration','灵感',IconBulb],['materials','素材',IconPhoto],['books','藏书',IconBook2],['projects','项目',IconFolder],['schedule','日程',IconCalendarEvent]];
  const sharedNavigation={registerNavigation,onBeforeSelect:beforeSelect,projectQuery,setProjectQuery};
  const groups=[['inspiration',entries],['materials',materials],['books',books],['projects',projects],['schedule',schedules.filter(item=>item.status!=='archived')]];
  return <div className={`desktop-app connected-desktop ${reduced?'reduce-motion':''} ${view==='materials'&&discoveryOpen?'is-sublime-discovery':''} ${hidden?'window-hidden':''} ${peekPaths.length?'has-peek':''}`}><aside className="app-nav" inert={view==='materials'&&discoveryOpen}><div className="desktop-drag-region" aria-hidden="true"/><button className="brand" onClick={()=>switchView('inspiration')} aria-label="梦藏首页"><IconLeaf size={25} stroke={1.4}/><span>梦藏</span></button><nav>{nav.map(([id,title,Icon])=><button key={id} className={`nav-link ${view===id?'active':''}`} aria-current={view===id?'page':undefined} onClick={()=>switchView(id)}><Icon size={20} stroke={1.45}/><span>{title}</span></button>)}</nav><div className="nav-bottom"><button className={`sync-status ${connected?'synced':'error'}`} onClick={()=>setSettings(true)} title={connected?'已连接 Personal AI OS':'检查 Obsidian 连接'}>{connected?'已连接':'未连接'}</button><button className="nav-link" onClick={()=>setSettings(true)}><IconSettings size={20} stroke={1.4}/><span>设置</span></button></div></aside><div className="desktop-main"><div className="desktop-connection-bar" hidden={connected && !error}><span><IconAlertCircle size={15}/>{loading?'正在读取 Personal AI OS…':error || status.message || 'Obsidian 尚未连接，请保持 Personal AI OS 仓库打开。'}{snapshot && !connected?' 当前保留已读取内容，修改留在本机草稿中。':''}</span><button className="text-btn" onClick={()=>setSettings(true)}>连接设置</button></div>{Boolean(snapshot?.errors?.length) && <details className="desktop-read-errors"><summary>{snapshot.errors.length} 份内容未能完整读取</summary>{snapshot.errors.map((entry,index)=><p key={index}>{entry.path || entry.title || ''}：{entry.message || entry.error || String(entry)}</p>)}</details>}
    <div className="desktop-workspace-toolbar"><div className="desktop-history-actions"><button className="icon-btn" aria-label="返回上一处" title="返回上一处（⌘ [）" disabled={!history.past.length&&peekPaths.length<2} onClick={back}><IconArrowLeft size={18}/></button><button className="icon-btn" aria-label="前进到下一处" title="前进到下一处（⌘ ]）" disabled={!history.future.length&&!(peekPaths.length&&peekFuture.length)} onClick={forward}><IconArrowRight size={18}/></button></div><button className="desktop-global-search" disabled={!snapshot} onClick={()=>setQuick(true)}><IconSearch size={15}/><span>搜索整个梦藏</span><kbd>⌘ K</kbd></button></div>
    <div className="desktop-workspace-body"><div className="view-content" ref={panels}>{snapshot ? <>
      <section className="view-panel" data-workspace="inspiration" hidden={view!=='inspiration'}><ErrorBoundary><Inspiration entries={entries} materials={materials} notify={notify} desktop={{...sharedNavigation,renderDetail:item=>detail(item),renderRelated:related}}/></ErrorBoundary></section>
      <section className="view-panel" data-workspace="materials" hidden={view!=='materials'}><ErrorBoundary><div className="discovery-entry-bar" hidden={discoveryOpen}><button className="text-btn" onClick={()=>setDiscoveryOpen(!discoveryOpen)}>{discoveryOpen?'查看原素材网格':'打开素材发现'}</button></div>{discoveryOpen&&view==='materials'?<SublimeWorkspace items={[...entries,...materials,...books]} api={discoveryApi} identity={identity} connected={connected} onOpen={preview} onRefresh={refresh} onExit={()=>setDiscoveryOpen(false)}/>:<MaterialsView materials={materials} notify={notify} desktop={{...sharedNavigation,projects,renderDetail:item=>detail(item,true),renderRelated:related}}/>}</ErrorBoundary></section>
      <section className="view-panel" data-workspace="books" hidden={view!=='books'}><ErrorBoundary><BooksView books={books} onRead={book=>invoke('openOriginal',book.path)} notify={notify} desktop={{...sharedNavigation,openNote:path=>invoke('openNote',path)}}/></ErrorBoundary></section>
      <section className="view-panel" data-workspace={view==='projects'?'projects':'schedule'} hidden={!['projects','schedule'].includes(view)}><ErrorBoundary><ScheduleView items={schedules} projects={projects} sources={scheduleSources} api={api} identity={identity} connected={connected} enabled={scheduleEnabled} workEnabled={workEnabled} mode={view==='projects'?'projects':'schedule'} activeView={['projects','schedule'].includes(view)} projectsContent={<div className="projects-view"><header className="page-heading workspace-search-header"><WorkspaceSearch label="搜索项目" placeholder="搜索项目名称或目标…" value={projectQuery} onChange={setProjectQuery}/></header><main className="projects-main"><div className="projects-grid">{visibleProjects.map(project=><article className="project-card" data-project-path={project.path || project.notePath} key={project.id || project.path}><IconFolder size={27} stroke={1.2}/><h2>{project.title || project.name}</h2><p>{project.goal || '目标还可以慢慢明确。'}</p><div className="project-work-summary">{(()=>{const summary=projectWorkSummary(schedules,project.id,localDateKey(new Date(),localTimeZone()));return <><small>最近进展</small><span>{summary.progress?.progressNote || '暂无人工进展'}</span>{summary.priority && <button onClick={()=>navigate(summary.priority.path)}>优先行动 · {summary.priority.title}</button>}<small>等我决定 · {summary.waitingCount} 项</small></>;})()}</div>{(project.sourcePaths || project.sources || []).map((source,index)=>{const path=typeof source==='string'?source:source.path;return <button className="project-source text-btn" key={path || index} onClick={()=>preview(path)}>{typeof source==='string' ? entries.find(e=>e.path===path)?.title || path : source.title || path}<IconArrowUpRight size={12}/></button>;})}<button className="text-btn" disabled={!project.path && !project.notePath} onClick={()=>invoke('openNote',project.path || project.notePath)}>打开项目笔记<IconArrowUpRight size={15}/></button>{!project.path && !project.notePath && <p className="desktop-inline-warning">项目笔记尚未关联</p>}</article>)}</div>{!visibleProjects.length && <p className="desktop-empty-hint" role="status">{projectQuery.trim()?"没有匹配的项目，试试其他关键词。":"仓库中暂未读取到项目入口。"}</p>}</main></div>} onSaved={refresh} onPreview={preview} notify={notify} reducedMotion={reduced || hidden || !['projects','schedule'].includes(view)} desktop={sharedNavigation}/></ErrorBoundary></section>
    </> : <div className="desktop-connect-empty"><IconLeaf size={42} stroke={1.2}/><h1>{loading?'正在打开梦藏':'连接你的 Obsidian 仓库'}</h1><p>{loading?'正在核对 Personal AI OS 并读取真实内容。':'保持 Personal AI OS 在 Obsidian 中打开，然后完成一次本机配对。'}</p>{!loading && <button className="btn btn-primary" disabled={pairing} onClick={pair}>{pairing?'正在连接…':'连接 Personal AI OS'}</button>}</div>}</div>
    {peekPaths.length>0&&<RelatedPreview key={identityKey(identity)} path={peekPaths.at(-1)} records={[...entries,...materials,...books]} api={api} connected={connected} onClose={closePeek} onOpen={navigate} onPreview={preview} canBack={peekPaths.length>1} onBack={peekBack}/>}</div>
  </div>{quick&&<QuickOpen groups={groups} onOpen={navigate} onClose={()=>setQuick(false)}/ >}{toast && <div className="toast" role="status"><IconCheck size={16}/>{toast}</div>}{settings && <Settings onClose={()=>setSettings(false)} status={{...status,identity}} onPair={pair} onRefresh={()=>refresh().catch(()=>{})} busy={pairing} reduced={reduced} setReduced={setReduced} error={error}/>}</div>;
}
