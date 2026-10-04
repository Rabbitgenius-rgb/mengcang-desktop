import WorkspaceSearch from './WorkspaceSearch.jsx';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {IconArchive,IconArrowBackUp,IconArrowUpRight,IconCalendar,IconCheck,IconChevronLeft,IconChevronRight,IconClock,IconFileText,IconPlus,IconSearch,IconX} from '@tabler/icons-react';
import {identityKey,isConflict,readableError,valueOf} from './desktopModel.js';
import {draftStatus,draftStoreFor} from './draftStatus.js';
import {useWorkspaceNavigation} from './useWorkspaceNavigation.js';
import {useScheduleMotion} from './useScheduleMotion.js';
import {addCalendarDays,clockLabel,dayBounds,draftFromItem,filterSchedules,itemFromDraft,layoutDay,localDateKey,localDateTime,localTimeZone,placeScheduleForm,rebaseScheduleDraft,restoreScheduleDraft,scheduleColor,scheduleDraftKey,scheduleHasChanges,scheduleIndexKey,uniqueSchedules,validateScheduleDraft} from './scheduleModel.js';
import {restoreScheduleWorkspace} from './scheduleDraftRecovery.js';
import WorkOverview from './WorkOverview.jsx';
import {focusPatch,moveFocusPatch,statusPatch} from './workOverviewModel.js';
import {LEGACY_SCHEDULE_FIELDS,WORK_FIELDS} from './scheduleModel.js';
import './ScheduleView.css';

const uuid=()=>crypto.randomUUID();
const noop=()=>{};
const titleOf=item=>item.title?.trim() || '未命名事项';
const timeSummary=item=>item.plannedStart && item.plannedEnd?`${localDateTime(item.plannedStart,item.timeZone).replace('T',' ')} — ${localDateTime(item.plannedEnd,item.timeZone).replace('T',' ')}`:'待安排时间';
const formTime=form=>form.plannedStart && form.plannedEnd?`${form.plannedStart.replace('T',' ')} — ${form.plannedEnd.replace('T',' ')}`:'待安排时间';

// Conflict review lists the current note and marks each field where the
// user's edit differs from it; rebasing keeps exactly those fields.
function conflictRows(draft,item,projects,sources) {
  const current=draftFromItem(item).form,mine=draft.form;
  const kept=keys=>keys.some(key=>mine[key]!==draft.baseValues[key] && mine[key]!==current[key]);
  const project=id=>{if(!id)return '暂不关联';const found=projects.find(project=>project.id===id);return found?.title || found?.name || id;};
  const source=path=>path?sources.find(source=>source.path===path)?.title || path:'直接记录';
  const rows=[
    {label:'事项名称',keys:['title'],show:form=>form.title?.trim() || '未命名事项'},
    {label:'时间',keys:['plannedStart','plannedEnd','timeZone'],show:formTime},
    {label:'备注',keys:['notes'],show:form=>form.notes || '未填写'},
    {label:'工作状态',keys:['workState'],show:form=>({idle:'稍后',doing:'正在执行',waiting:'等我决定'})[form.workState]},
    {label:'今天关注',keys:['focusDate','focusOrder'],show:form=>form.focusDate?`${form.focusDate} · 顺序 ${form.focusOrder}`:'未关注'},
    {label:'最新进展',keys:['progressNote'],show:form=>form.progressNote || '未填写'},
    {label:'等待问题',keys:['waitingReason'],show:form=>form.waitingReason || '未填写'},
    {label:'截止时间',keys:['dueAt'],show:form=>form.dueAt?.replace('T',' ') || '未设置'},
    {label:'状态',keys:['status'],show:form=>({todo:'待办',done:'已完成',archived:'已归档'})[form.status]},
    {label:'关联项目',keys:['projectId'],show:form=>project(form.projectId),optional:true},
    {label:'来自',keys:['sourcePath'],show:form=>source(form.sourcePath),optional:true},
  ];
  return rows.map(row=>({label:row.label,current:row.show(current),mine:row.show(mine),kept:kept(row.keys),optional:row.optional && !row.keys.some(key=>current[key] || mine[key])})).filter(row=>!row.optional);
}

function LeavePrompt({onCancel,onLeave}) {
  const ref=useRef(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  return <dialog ref={ref} className="root-dialog" aria-label="未保存的事项" onCancel={event=>{event.preventDefault();onCancel();}}><section className="modal work-leave-dialog"><h2>事项尚未保存</h2><p>修改仍是本机草稿。可以继续编辑，或保留草稿后离开；返回时再主动保存。</p><div className="modal-actions"><button className="btn" autoFocus onClick={onCancel}>继续编辑</button><button className="btn btn-primary" onClick={onLeave}>保留草稿并离开</button></div></section></dialog>;
}
export default function ScheduleView({items=[],projects=[],sources=[],api,identity,connected=false,enabled=false,onSaved,onPreview,notify=noop,reducedMotion=false,desktop,mode='schedule',workEnabled=false,projectsContent=null,activeView=true}) {
  const [projectTab,setProjectTab]=useState('overview'),[projectFilter,setProjectFilter]=useState(''),[leaveAction,setLeaveAction]=useState(null);
  const overview=mode==='projects' && projectTab==='overview';
  const timeZone=localTimeZone(),vaultKey=identityKey(identity),store=draftStoreFor(api);
  const [day,setDay]=useState(()=>localDateKey()),[query,setQuery]=useState(''),[tab,setTab]=useState('pending'),[selected,setSelected]=useState(null),[drafts,setDrafts]=useState({}),[ready,setReady]=useState(false),[states,setStates]=useState({}),[globalError,setGlobalError]=useState(''),[recoveryAttempt,setRecoveryAttempt]=useState(0),[discardConfirm,setDiscardConfirm]=useState(false),[showCurrent,setShowCurrent]=useState(false),[clock,setClock]=useState(Date.now()),[dragging,setDragging]=useState(false);
  const refs=useRef({drafts:{},items:[],states:{},localIds:[],session:null,acknowledged:new Map()});
  const rootRef=useRef(null),timelineRef=useRef(null),listRef=useRef(null),detailRef=useRef(null),initialScroll=useRef(false),restoreScroll=useRef(null);
  const captureMotion=useScheduleMotion(rootRef,reducedMotion);
  refs.current.items=items;refs.current.states=states;
  const unique=useMemo(()=>uniqueSchedules(items),[items]);
  const latestById=useMemo(()=>new Map(unique.items.map(item=>[item.id,item])),[unique]);
  const active=session=>Boolean(session?.active && refs.current.session===session);
  const changeState=(id,patch,session=refs.current.session)=>{if(active(session)){const next={...refs.current.states,[id]:{...refs.current.states[id],...patch}};refs.current.states=next;setStates(next);}};
  const showDraft=(draft,session=refs.current.session)=>{
    if(!active(session))return;
    captureMotion();refs.current.drafts={...refs.current.drafts,[draft.id]:draft};setDrafts(refs.current.drafts);
  };
  async function persist(draft,session=refs.current.session) {
    if(!active(session))return false;
    const revision=(session.revisions[draft.id] || 0)+1;session.revisions[draft.id]=revision;
    changeState(draft.id,{localState:'saving'},session);
    try {
      await store.write(scheduleDraftKey(identity,draft.id),draft);
      if(!active(session))return false;
      refs.current.localIds=scheduleHasChanges(draft)?[...new Set([...refs.current.localIds,draft.id])]:refs.current.localIds.filter(id=>id!==draft.id);
      await store.write(scheduleIndexKey(identity),{version:1,ids:[...refs.current.localIds]});
      if(active(session) && session.revisions[draft.id]===revision)changeState(draft.id,{localState:'saved',localError:''},session);
      return true;
    } catch(error) {
      if(active(session) && session.revisions[draft.id]===revision)changeState(draft.id,{localState:'error',localError:`本机草稿未能保存：${readableError(error)}`},session);
      return false;
    }
  }
  function replace(draft,shouldPersist=true) {showDraft(draft);if(shouldPersist)void persist(draft);}

  useEffect(()=>{
    const session={active:true,revisions:{},busy:new Set()};refs.current.session=session;refs.current.drafts={};refs.current.localIds=[];refs.current.acknowledged=new Map();
    setDrafts({});setStates({});setReady(false);setGlobalError('');setSelected(null);initialScroll.current=false;
    (async()=>{
      try {
        const recovered=await restoreScheduleWorkspace(store,identity,refs.current.items);
        if(!active(session))return;
        refs.current.localIds=recovered.ids;refs.current.drafts=recovered.drafts;refs.current.states=recovered.states;
        setDrafts(recovered.drafts);setStates(recovered.states);setReady(true);
      }catch(error){if(active(session))setGlobalError(`未能恢复本机草稿，编辑暂不可用：${readableError(error)}`);}

    })();
    return()=>{session.active=false;};
  },[vaultKey,store,recoveryAttempt]);

  useEffect(()=>{
    if(!ready)return;
    let next=refs.current.drafts,changed=false;
    for(const item of unique.items){
      const current=next[item.id],ack=refs.current.acknowledged.get(item.id);
      if(refs.current.session?.busy.has(item.id))continue;
      if(ack && item.hash===ack.previousHash)continue;
      if(ack)refs.current.acknowledged.delete(item.id);
      if(refs.current.states[item.id]?.missingOriginal)changeState(item.id,{missingOriginal:false,conflict:true});
      if(!current){next={...next,[item.id]:draftFromItem(item)};changed=true;}
      else if(current.baseHash!==item.hash){
        if(scheduleHasChanges(current))changeState(item.id,{conflict:true});
        else {next={...next,[item.id]:draftFromItem(item)};changed=true;}
      }
    }
    for(const draft of Object.values(next))if(!draft.isNew && !unique.items.some(item=>item.id===draft.id) && !refs.current.acknowledged.has(draft.id)){
      if(scheduleHasChanges(draft)){if(!refs.current.states[draft.id]?.missingOriginal)changeState(draft.id,{missingOriginal:true});}
      else {if(!changed)next={...next};delete next[draft.id];changed=true;if(selected===draft.id)setSelected(null);}
    }
    if(changed){refs.current.drafts=next;setDrafts(next);}
  },[unique,ready]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setDiscardConfirm(false);setShowCurrent(false);},[selected]);

  const displayed=useMemo(()=>{
    const merged=new Map(unique.items.map(item=>[item.id,item]));
    for(const draft of Object.values(drafts))merged.set(draft.id,{...itemFromDraft(draft,merged.get(draft.id)),missingOriginal:Boolean(states[draft.id]?.missingOriginal)});
    return [...merged.values()];
  },[unique,drafts,states]);
  const filtered=useMemo(()=>filterSchedules(displayed,query,{projects,sources}),[displayed,query,projects,sources]);
  const pending=filtered.filter(item=>item.missingOriginal || (item.status==='todo' && (!item.plannedStart || !item.plannedEnd || item.invalidTime)));
  const archived=filtered.filter(item=>item.status==='archived' && !item.missingOriginal);
  const currentBounds=dayBounds(day,timeZone);
  const done=filtered.filter(item=>item.status==='done' && !item.missingOriginal && (!item.plannedStart || (Date.parse(item.plannedStart)<currentBounds.end && Date.parse(item.plannedEnd)>currentBounds.start)));
  const layout=useMemo(()=>layoutDay(filtered,day,timeZone),[filtered,day,timeZone]);
  const selectedDraft=selected?drafts[selected]:null,selectedItem=selected?displayed.find(item=>item.id===selected):null,currentItem=selected?latestById.get(selected):null;
  const selectedState=states[selected] || {},hasChanges=scheduleHasChanges(selectedDraft),busy=Boolean(selectedState.saving || selectedState.discarding),conflict=Boolean(selectedState.conflict),validation=selectedDraft?validateScheduleDraft(selectedDraft):{errors:{},valid:false};
  const status=selectedState.missingOriginal?{state:'conflict',label:'原笔记暂未读取 · 草稿已保留'}:draftStatus({ready,hasChanges,localState:selectedState.localState,localError:selectedState.localError,conflict,saving:selectedState.saving,saveError:selectedState.saveError});
  const listItems=tab==='archive'?archived:pending;
  const today=localDateKey(clock,timeZone),nowMinute=(clock-layout.bounds.start)/60000;

  function requestLeave(proceed){
    const current=refs.current.drafts[selected];
    if(current && scheduleHasChanges(current)){setLeaveAction(()=>proceed);return false;}
    proceed();return true;
  }
  useEffect(()=>{
    const guard=event=>{if(!activeView)return;const current=refs.current.drafts[selected];if(current && scheduleHasChanges(current)){event.preventDefault();setLeaveAction(()=>event.detail.proceed);}};
    const unload=event=>{if(Object.values(refs.current.drafts).some(scheduleHasChanges)){event.preventDefault();event.returnValue='';}};
    window.addEventListener('mengcang-before-leave',guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener('mengcang-before-leave',guard);window.removeEventListener('beforeunload',unload);};
  },[selected,activeView]);
  function choose(id,history=true){if(id===selected)return;requestLeave(()=>selectNow(id,history));}
  function selectNow(id,history=true){if(id===selected)return;if(history)desktop?.onBeforeSelect?.();captureMotion();setSelected(id);}
  function changeDay(next){if(!next || next===day)return;desktop?.onBeforeSelect?.();captureMotion();setDay(next);}
  const capture=()=>({projectQuery:desktop?.projectQuery || '',projectTab,projectFilter,day,query,tab,selected,scroll:{timeline:timelineRef.current?.scrollTop || 0,list:listRef.current?.scrollTop || 0,detail:detailRef.current?.scrollTop || 0}});
  const navigationHandlers={
    capture,
    restore(value){desktop?.setProjectQuery?.(value?.projectQuery || '');setProjectTab(value?.projectTab || 'overview');setProjectFilter(value?.projectFilter || '');if(value?.day)setDay(value.day);setQuery(value?.query || '');setTab(value?.tab==='archive'?'archive':'pending');setSelected(value?.selected || null);restoreScroll.current=value?.scroll || {};},
    open(path){if(projects.some(project=>(project.path || project.notePath)===path)){setProjectTab('all');return;}setProjectTab('overview');const item=refs.current.items.find(item=>item.path===path);if(!item)return;setSelected(item.id);setQuery('');setTab(item.status==='archived'?'archive':'pending');if(item.plannedStart)setDay(localDateKey(item.plannedStart,timeZone));},
  };
  useWorkspaceNavigation(desktop,'schedule',navigationHandlers);
  useWorkspaceNavigation(desktop,'projects',navigationHandlers);
  useLayoutEffect(()=>{
    if(!ready)return;
    const target=restoreScroll.current;
    if(target){if(timelineRef.current)timelineRef.current.scrollTop=target.timeline || 0;if(listRef.current)listRef.current.scrollTop=target.list || 0;if(detailRef.current)detailRef.current.scrollTop=target.detail || 0;restoreScroll.current=null;initialScroll.current=true;}
    else if(!initialScroll.current && timelineRef.current){timelineRef.current.scrollTop=7*64;initialScroll.current=true;}
  },[ready,selected,day,query,tab]);
  function createItem(minute=null){requestLeave(()=>createNow(minute));}
  function createNow(minute=null){
    if(!ready || !enabled)return;
    desktop?.onBeforeSelect?.();const id=uuid(),draft=draftFromItem({id,timeZone});
    if(minute!==null)draft.form=placeScheduleForm(draft.form,day,minute,timeZone);
    refs.current.localIds=[...refs.current.localIds,id];replace(draft);setSelected(id);setTab('pending');setQuery('');
  }
  function changeFields(patch,id=selected){
    const current=refs.current.drafts[id];if(!current || refs.current.session?.busy.has(id))return null;
    const draft={...current,form:{...current.form,...patch},operationId:null,submittedFields:null};
    changeState(id,{saveError:false,error:'',success:''});replace(draft);setDiscardConfirm(false);return draft;
  }
  function arrange(id,minute=9*60){
    const current=refs.current.drafts[id];if(!current || refs.current.session?.busy.has(id))return;
    choose(id);changeFields(placeScheduleForm(current.form,day,minute,timeZone),id);notify('时间已排入本机草稿，核对后保存到 Obsidian。');
  }
  async function saveDraft(id=selected,override=null){
    const session=refs.current.session,current=override || refs.current.drafts[id];
    if(!ready || !active(session) || !current || session.busy.has(id) || !enabled || !connected || refs.current.states[id]?.conflict || refs.current.states[id]?.missingOriginal || unique.duplicates.includes(id))return;
    const result=validateScheduleDraft(current);
    if(!result.valid){changeState(id,{error:Object.values(result.errors)[0]});return;}
    if(!scheduleHasChanges(current))return;
    const changedWork=WORK_FIELDS.some(key=>current.form[key]!==current.baseValues?.[key]);
    if(!workEnabled && (changedWork || latestById.get(id)?.schemaVersion===2)){changeState(id,{error:'当前连接器不支持工作总览字段，请更新后保存；草稿仍保留。'});return;}
    const fields=workEnabled?result.fields:Object.fromEntries(LEGACY_SCHEDULE_FIELDS.map(key=>[key,result.fields[key]]));
    const same=JSON.stringify(current.submittedFields)===JSON.stringify(fields),operationId=same && current.operationId?current.operationId:uuid();
    const pending={...current,operationId,submittedFields:fields};
    session.busy.add(id);changeState(id,{saving:true,error:'',success:'',saveError:false});showDraft(pending);
    let confirmed=false;
    try {
      if(!await persist(pending,session))return;
      const response=valueOf(await api.scheduleSave({action:current.isNew?'create':'update',id,operationId,...(!current.isNew?{expectedHash:current.baseHash}:{}),...(workEnabled?{schemaVersion:2}:{}),fields}));
      if(!response?.item || response.item.id!==id || !response.item.hash)throw new Error('尚未收到有效的日程保存回执，草稿已保留。');
      confirmed=true;if(!active(session))return;
      const saved=response.item;refs.current.acknowledged.set(id,{hash:saved.hash,previousHash:current.baseHash});
      const clean=draftFromItem(saved);showDraft(clean);await persist(clean,session);
      changeState(id,{conflict:false,success:'已保存到 Obsidian。',saveError:false},session);
      await onSaved?.();
    } catch(error) {
      if(active(session)){changeState(id,{error:confirmed?'事项已保存，列表暂未刷新。请重新检查连接。':readableError(error),saveError:!confirmed,...(isConflict(error)?{conflict:true}:{})},session);if(isConflict(error))Promise.resolve(onSaved?.()).catch(()=>{});}
    } finally {session.busy.delete(id);changeState(id,{saving:false},session);}
  }
  function setStatus(next){
    const hadChanges=scheduleHasChanges(refs.current.drafts[selected]);
    const draft=changeFields(workEnabled?statusPatch(next):{status:next});if(!draft)return;
    if(hadChanges){notify('状态已写入草稿，请核对其他修改后保存。');return;}
    if(conflict)notify('状态已保留在本机草稿，请先核对当前版本再保存。');
    else if(selectedState.missingOriginal)notify('状态已保留在本机草稿，原笔记恢复读取后再保存。');
    else if(connected)void saveDraft(selected,draft);
    else notify('状态已保留在本机草稿，连接后请主动保存。');
  }
  async function workAction(id,patch){
    if(!workEnabled || !ready)return;
    const current=refs.current.drafts[id];if(!current)return;
    if(current.form.status!=='todo'){notify('请先恢复为待办，再修改工作状态。');return;}
    const hadChanges=scheduleHasChanges(current),draft=changeFields(patch,id);if(!draft)return;
    if(hadChanges){notify('修改已保留在草稿，请打开详情核对并保存。');return;}
    if(connected){await saveDraft(id,draft);if(refs.current.states[id]?.error)notify(refs.current.states[id].error);}else notify('修改已保留在本机草稿，连接后请主动保存。');
  }
  function toggleFocus(id=selected){const item=displayed.find(item=>item.id===id);if(item)void workAction(id,focusPatch(item,displayed,today));}
  function moveFocus(id,direction){try{const patch=moveFocusPatch(displayed,id,direction,today);if(patch)void workAction(id,patch);}catch(error){notify(readableError(error));}}
  async function discard(){
    const session=refs.current.session,current=refs.current.drafts[selected],id=selected;if(!current || !discardConfirm || session.busy.has(id))return;
    session.busy.add(id);changeState(id,{discarding:true});
    try {
      const remaining=refs.current.localIds.filter(value=>value!==id),previousIds=[...refs.current.localIds];
      // Only replace the in-memory draft after both disk records succeed.
      // A failed index cleanup restores the draft and its recovery index.
      await store.discard(scheduleDraftKey(identity,id),current);
      try{await store.write(scheduleIndexKey(identity),{version:1,ids:remaining});}
      catch(error){await store.write(scheduleDraftKey(identity,id),current).catch(()=>{});await store.write(scheduleIndexKey(identity),{version:1,ids:previousIds}).catch(()=>{});throw error;}
      if(!active(session))return;refs.current.localIds=remaining;captureMotion();
      if(current.isNew || !currentItem){
        const next={...refs.current.drafts};delete next[id];refs.current.drafts=next;setDrafts(next);setSelected(null);
      }else showDraft(draftFromItem(currentItem));
      changeState(id,{localState:'idle',localError:'',saveError:false,conflict:false,error:'',success:''});setDiscardConfirm(false);
    }catch(error){changeState(id,{localError:`未能完整放弃草稿，当前内容仍保留：${readableError(error)}`});}
    finally{session.busy.delete(id);changeState(id,{discarding:false});}
  }
  async function refreshConflict(){try{await onSaved?.();setShowCurrent(true);}catch(error){changeState(selected,{error:readableError(error)});}}
  async function openNote(){try{valueOf(await api.openNote(selectedItem.path));}catch(error){changeState(selected,{error:readableError(error)});}}
  function drop(event){
    event.preventDefault();setDragging(false);let id;try{id=event.dataTransfer.getData('application/x-mengcang-schedule');}catch{return;}
    if(!refs.current.drafts[id] || !enabled)return;
    const canvas=event.currentTarget,minute=(event.clientY-canvas.getBoundingClientRect().top)/64*60;arrange(id,minute);
  }
  function card(item,location,extraStyle){
    const isSelected=item.id===selected;
    return <button key={item.id} type="button" className={`schedule-card schedule-color-${scheduleColor(item.id)} ${isSelected?'is-selected':''} ${item.isLocal?'is-local':''} ${location==='done'?'is-done':''}`} style={extraStyle} data-schedule-id={item.id} data-schedule-location={location} aria-pressed={isSelected} title={`${titleOf(item)} · ${timeSummary(item)}`} aria-label={`${titleOf(item)}，${item.isLocal?'本机草稿，':''}${timeSummary(item)}`} draggable={ready && enabled && item.status==='todo' && !states[item.id]?.saving} onDragStart={event=>{event.dataTransfer.setData('application/x-mengcang-schedule',item.id);event.dataTransfer.effectAllowed='move';setDragging(true);}} onDragEnd={()=>setDragging(false)} onClick={()=>choose(item.id)}><span className="schedule-card-title">{location==='done' && <IconCheck size={14}/>}<strong>{titleOf(item)}</strong></span><span className="schedule-card-meta">{location==='timeline'?`${clockLabel(item.plannedStart,timeZone)} – ${clockLabel(item.plannedEnd,timeZone)}`:item.missingOriginal?'原笔记暂未读取':projects.find(project=>project.id===item.projectId)?.title || projects.find(project=>project.id===item.projectId)?.name || (item.plannedStart?'已有时间':'待安排')}{item.isLocal && <i title="本机草稿">草稿</i>}</span>{item.notes && location!=='timeline' && <span className="schedule-card-notes">{item.notes}</span>}</button>;
  }
  const fullDayLabel=new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'long',day:'numeric',weekday:'long'}).format(new Date(`${day}T12:00:00Z`));
  if(!enabled && mode!=='projects')return <section className="schedule-unavailable"><IconCalendar size={40} stroke={1.2}/><h1>日程</h1><p>需要更新并连接支持日程的 Obsidian 连接器，才能读取和安排事项。</p><span>连接器尚未提供日程能力，当前列表状态未知。</span></section>;
  return <div ref={rootRef} className={`schedule-view ${mode==='projects'?'work-mode':''} ${selectedDraft?'has-detail':''} ${reducedMotion?'schedule-reduced-motion':''}`}>
    {mode==='projects' && <div className="project-work-tabs" aria-label="项目视图"><button className={projectTab==='overview'?'active':''} aria-pressed={projectTab==='overview'} onClick={()=>requestLeave(()=>setProjectTab('overview'))}>工作总览</button><button className={projectTab==='all'?'active':''} aria-pressed={projectTab==='all'} onClick={()=>requestLeave(()=>setProjectTab('all'))}>全部项目</button></div>}
    {mode==='projects' && projectTab==='all'?projectsContent:<>
    <header className="schedule-header workspace-search-header"><WorkspaceSearch label={overview?'搜索工作事项':'搜索日程'} placeholder={overview?'搜索行动、进展或等待问题…':'搜索事项、项目或来源…'} value={query} onChange={setQuery}/>{!overview && <div className="schedule-date-controls"><button className="icon-btn" aria-label="前一天" onClick={()=>changeDay(addCalendarDays(day,-1))}><IconChevronLeft size={18}/></button><label className="schedule-date-label"><span>{fullDayLabel}</span><input type="date" aria-label="选择日程日期" value={day} onChange={event=>changeDay(event.target.value)}/><IconCalendar size={16}/></label><button className="icon-btn" aria-label="后一天" onClick={()=>changeDay(addCalendarDays(day,1))}><IconChevronRight size={18}/></button><button className="btn schedule-today" onClick={()=>changeDay(today)}>今天</button></div>}<button className="btn btn-primary" disabled={!ready || !enabled} onClick={()=>createItem()}><IconPlus size={16}/>新建事项</button></header>
    {overview && !workEnabled && <p className="schedule-global-warning" role="status">{enabled?'连接器尚未提供工作总览能力。已有事项可查看，原有日程仍可使用；加入今天、工作状态和进展编辑需更新连接器后重新检查。':'连接器尚未提供日程数据，事项状态未知；全部项目仍可浏览。'}</p>}
    {globalError && <p className="schedule-global-warning" role="alert">{globalError}<button className="text-btn" onClick={()=>setRecoveryAttempt(value=>value+1)}>重新读取草稿</button></p>}
    {unique.duplicates.length>0 && <p className="schedule-global-warning" role="alert">发现重复的日程标识。相关事项已停止保存，请在 Obsidian 中核对原笔记。</p>}
    {!connected && <p className="schedule-global-warning" role="status">当前未连接。可以继续编辑，本机草稿需要在连接后由你主动保存。</p>}
    <div className="schedule-workspace">
      {overview?<WorkOverview items={filtered} allItems={displayed} projects={projects} day={today} timeZone={timeZone} projectFilter={projectFilter} setProjectFilter={setProjectFilter} selected={selected} onSelect={choose} onFocus={toggleFocus} onMove={moveFocus} canWrite={workEnabled && ready && connected} busyIds={Object.entries(states).filter(([,state])=>state.saving).map(([id])=>id)}/>:<>
      <aside className="schedule-backlog"><header><div className="schedule-list-tabs" aria-label="事项清单"><button className={tab==='pending'?'active':''} aria-pressed={tab==='pending'} onClick={()=>setTab('pending')}>待安排 <span>{pending.length}</span></button><button className={tab==='archive'?'active':''} aria-pressed={tab==='archive'} onClick={()=>setTab('archive')}><IconArchive size={14}/>归档 <span>{archived.length}</span></button></div></header><div className="schedule-list-scroll" ref={listRef} data-scroll-key="schedule-list">{!ready?<p className="schedule-list-empty">{globalError?'草稿读取失败，请重试。':'正在恢复本机草稿…'}</p>:listItems.length?listItems.map(item=>card(item,tab==='archive'?'archive':'pending')):<div className="schedule-list-empty"><span>{query?'没有匹配的事项':tab==='archive'?'归档的事项会留在这里':'还没有待安排的事'}</span>{tab==='pending' && !query && <button className="text-btn" onClick={()=>createItem()}><IconPlus size={14}/>记下一件事</button>}</div>}</div><footer>{tab==='archive'?'归档保留原笔记，可随时恢复。':'将事项拖到时间轴，或打开详情安排。'}</footer></aside>
      <main className="schedule-day"><header className="schedule-day-heading"><div><span>{day===today?'今日时间轴':'当日时间轴'}</span><small>{layout.segments.length} 件已安排{query?' · 搜索结果':''}</small></div><small>{timeZone}</small></header><div className="schedule-timeline-scroll" ref={timelineRef} data-scroll-key="schedule-timeline"><div className={`schedule-timeline ${dragging?'is-drop-target':''}`} style={{height:layout.bounds.minutes/60*64}} onDragOver={event=>{if(event.dataTransfer.types.includes('application/x-mengcang-schedule')){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={drop} aria-label={`${day} 的时间轴`}>
        {Array.from({length:Math.ceil(layout.bounds.minutes/60)},(_,hour)=><div key={hour} className="schedule-hour" style={{top:hour*64}}><span>{clockLabel(layout.bounds.start+hour*3600000,timeZone)}</span><button tabIndex={-1} aria-label={`在 ${clockLabel(layout.bounds.start+hour*3600000,timeZone)} 新建事项`} onDoubleClick={()=>createItem(hour*60)}/></div>)}
        {!layout.segments.length && <div className="schedule-timeline-empty"><IconClock size={25} stroke={1.2}/><strong>{query?'这个日期没有匹配的安排':'这一天，时间还很宽裕'}</strong><p>{query?'试试其他关键词或日期。':'从左侧挑一件事，给它留一段时间。'}</p>{!query && <button className="btn" disabled={!ready} onClick={()=>createItem(9*60)}><IconPlus size={14}/>安排第一件事</button>}</div>}
        <div className="schedule-events" style={{minWidth:Math.max(0,...layout.segments.map(segment=>segment.columns))*110}}>{layout.segments.map(segment=>card(segment.item,'timeline',{top:segment.top/60*64,height:Math.max(1,segment.duration/60*64-3),padding:segment.duration<30?'0 8px':undefined,left:`calc(${segment.column/segment.columns*100}% + 3px)`,width:`calc(${100/segment.columns}% - 7px)`}))}</div>
        {day===today && nowMinute>=0 && nowMinute<layout.bounds.minutes && <div className="schedule-now" style={{top:nowMinute/60*64}}><span>{clockLabel(clock,timeZone)}</span><i/></div>}
      </div></div><section className="schedule-completed"><header><IconCheck size={15}/><span>已完成</span><small>{done.length}</small></header><div className="schedule-completed-items">{done.length?done.map(item=>card(item,'done')):<p>完成的事项会收在这里。</p>}</div></section></main>
      </>}
      {selectedDraft && <aside className="schedule-inspector" data-schedule-id={selected} data-schedule-location="detail" data-note-ready={ready?'true':'false'}><header><span>{selectedDraft.isNew?'新建事项':'事项详情'}</span><button className="icon-btn" aria-label="关闭事项详情" disabled={busy} onClick={()=>requestLeave(()=>setSelected(null))}><IconX size={18}/></button></header><div className="schedule-detail-scroll" ref={detailRef} data-scroll-key="schedule-detail"><div className={`schedule-detail-title schedule-color-${scheduleColor(selected)}`}><span className="eyebrow">{selectedDraft.form.status==='archived'?'已归档':selectedDraft.form.status==='done'?'已完成':'慢慢安排，有序前行'}</span><h2>{titleOf(selectedItem)}</h2></div><div className="desktop-note-state schedule-draft-state" data-state={status.state}><span role="status" aria-live="polite">{status.label}</span>{selectedState.localError && <><p role="alert">{selectedState.localError}</p><button type="button" className="text-btn" disabled={busy} onClick={()=>persist(selectedDraft)}>重试保存本机草稿</button></>}</div>
        {conflict && <section className="desktop-conflict" role="alert"><strong>日程已有其他修改，草稿仍保留</strong><p>读取并核对当前版本，再决定是否保存你的修改。</p><button type="button" className="btn" disabled={!connected || busy} onClick={refreshConflict}>核对当前版本</button>{showCurrent && currentItem && <><dl className="schedule-conflict-compare">{conflictRows(selectedDraft,currentItem,projects,sources).map(row=><React.Fragment key={row.label}><dt>{row.label}{row.kept && <em>保留你的修改</em>}</dt><dd>{row.current}</dd>{row.kept && <dd className="schedule-conflict-mine">你的草稿：{row.mine}</dd>}</React.Fragment>)}</dl><p>采用当前版本后，标出的字段保留你的修改，其余字段更新为当前版本。</p><button type="button" className="btn" disabled={busy} onClick={()=>{replace(rebaseScheduleDraft(selectedDraft,currentItem));changeState(selected,{conflict:false,error:'',saveError:false,success:'已采用当前版本作为基础，请核对草稿并主动保存。'});setShowCurrent(false);}}>保留草稿，采用当前版本</button></>}</section>}
        {selectedState.missingOriginal && <section className="desktop-conflict" role="alert"><strong>当前未读取到日程原笔记</strong><p>可能已移动、暂时无法读取或不再被识别为日程。本机草稿仍保留；请在 Obsidian 中核对，恢复读取后再核对版本。</p><button type="button" className="btn" disabled={!connected || busy} onClick={refreshConflict}>重新读取日程</button></section>}
        <form className="schedule-form" onSubmit={event=>{event.preventDefault();void saveDraft();}}>
          <label>事项名称<input value={selectedDraft.form.title} maxLength={300} onChange={event=>changeFields({title:event.target.value})} disabled={busy} autoFocus={selectedDraft.isNew} placeholder="想留时间做什么？" aria-invalid={Boolean(validation.errors.title && selectedState.error)}/></label>
          <label>备注<textarea rows={4} value={selectedDraft.form.notes} maxLength={50000} onChange={event=>changeFields({notes:event.target.value})} disabled={busy} placeholder="写下要点，或留一句提醒给自己。"/></label>
          <fieldset className="work-fieldset" disabled={!workEnabled || busy}><legend>推进与关注</legend>
            <label>工作状态<select aria-label="工作状态" value={selectedDraft.form.workState} onChange={event=>changeFields({workState:event.target.value})} disabled={selectedDraft.form.status!=='todo'}><option value="idle">稍后</option><option value="doing">正在执行</option><option value="waiting">等我决定</option></select></label>
            <button type="button" className="btn work-focus-action" disabled={selectedDraft.form.status!=='todo'} onClick={()=>{const patch=focusPatch(selectedItem,displayed,today);changeFields(patch);}}>{selectedDraft.form.focusDate===today?'移出今天关注':'加入今天关注'}</button>
            {selectedDraft.form.focusDate && selectedDraft.form.focusDate!==today && <p className="schedule-inline-hint">曾关注于 {selectedDraft.form.focusDate}；今天不会自动延续。</p>}
            <label>{selectedDraft.form.workState==='waiting' && selectedDraft.form.status==='todo'?'需要我决定或补资料的问题':'等待说明（保留历史）'}<textarea aria-label="等待问题" rows={3} value={selectedDraft.form.waitingReason} maxLength={10000} onChange={event=>changeFields({waitingReason:event.target.value})} placeholder="需要判断什么，或还缺哪些资料？"/></label>
            {validation.errors.waitingReason && <p className="schedule-field-error" role="alert">{validation.errors.waitingReason}</p>}
            <label>最近人工进展<textarea aria-label="最近人工进展" rows={3} value={selectedDraft.form.progressNote} maxLength={10000} onChange={event=>changeFields({progressNote:event.target.value})} placeholder="写下实际推进到哪一步。"/></label>
            {selectedDraft.form.progressUpdatedAt && <p className="schedule-inline-hint">进展更新于 {localDateTime(selectedDraft.form.progressUpdatedAt,selectedDraft.form.timeZone).replace('T',' ')}。改标题不会更新此时间。</p>}
            <label>截止时间（可选）<input aria-label="截止时间" type="datetime-local" value={selectedDraft.form.dueAt} onChange={event=>changeFields({dueAt:event.target.value})}/></label>
            {validation.errors.dueAt && <p className="schedule-field-error" role="alert">{validation.errors.dueAt}</p>}
            <p className="schedule-inline-hint">截止时间独立于下方安排时间。关注日期按本机 {timeZone} 的今天判断。</p>
          </fieldset>
          {!workEnabled && <p className="schedule-timezone">当前连接器不支持工作总览字段，请更新连接器后再编辑推进与关注。</p>}
          <div className="schedule-form-section-heading"><span><IconClock size={15}/>安排时间</span>{selectedDraft.form.plannedStart || selectedDraft.form.plannedEnd?<button type="button" className="text-btn" disabled={busy} onClick={()=>changeFields({plannedStart:'',plannedEnd:''})}>移回待安排</button>:<button type="button" className="text-btn" disabled={busy} onClick={()=>arrange(selected)}>排到 {day===today?'今天':day.slice(5)}</button>}</div>
          <label>开始<input type="datetime-local" step="60" value={selectedDraft.form.plannedStart} onChange={event=>changeFields({plannedStart:event.target.value})} disabled={busy} aria-invalid={Boolean(validation.errors.plannedStart)}/></label>
          <label>结束<input type="datetime-local" step="60" value={selectedDraft.form.plannedEnd} onChange={event=>changeFields({plannedEnd:event.target.value})} disabled={busy} aria-invalid={Boolean(validation.errors.plannedEnd)}/></label>
          {(validation.errors.plannedStart || validation.errors.plannedEnd) && <p className="schedule-field-error" role="alert">{validation.errors.plannedStart || validation.errors.plannedEnd}</p>}<p className="schedule-timezone">时间按 {selectedDraft.form.timeZone} 保存；时间轴使用本机时区。</p>
          <label>关联项目<select value={selectedDraft.form.projectId} onChange={event=>changeFields({projectId:event.target.value})} disabled={busy}><option value="">暂不关联</option>{selectedDraft.form.projectId && !projects.some(project=>project.id===selectedDraft.form.projectId) && <option value={selectedDraft.form.projectId}>原关联项目（当前未读取）</option>}{projects.map(project=><option key={project.id} value={project.id}>{project.title || project.name || project.id}</option>)}</select></label>
          {selectedDraft.form.projectId && !projects.some(project=>project.id===selectedDraft.form.projectId) && <p className="schedule-field-error">关联项目当前未读取，保留原关联；不会自动删除。</p>}
          <label>来自<select value={selectedDraft.form.sourcePath} onChange={event=>changeFields({sourcePath:event.target.value})} disabled={busy}><option value="">直接记录</option>{selectedDraft.form.sourcePath && !sources.some(source=>source.path===selectedDraft.form.sourcePath) && <option value={selectedDraft.form.sourcePath}>原关联来源（当前未读取）</option>}{sources.map(source=><option key={source.path} value={source.path}>{source.title || source.path}</option>)}</select></label>{selectedDraft.form.sourcePath && !sources.some(source=>source.path===selectedDraft.form.sourcePath) && <p className="schedule-field-error">关联来源当前未读取或已移动，保留原路径；不会自动改关联。</p>}{selectedDraft.form.sourcePath && <button type="button" className="text-btn schedule-source-preview" onClick={()=>onPreview?.(selectedDraft.form.sourcePath)}>预览关联来源<IconArrowUpRight size={13}/></button>}
          {selectedState.error && <p className="desktop-inline-error" role="alert">{selectedState.error}</p>}{selectedState.success && <p className="desktop-inline-success" role="status"><IconCheck size={14}/>{selectedState.success}</p>}
          {validation.errors.notes && <p className="schedule-field-error" role="alert">{validation.errors.notes}</p>}
          <div className="schedule-save-row"><button type="button" className="text-btn" disabled={!hasChanges || busy} onClick={()=>setDiscardConfirm(!discardConfirm)}>放弃草稿</button><button type="submit" className="btn btn-primary" disabled={!connected || !ready || busy || !hasChanges || conflict || selectedState.missingOriginal || !validation.valid || unique.duplicates.includes(selected) || (!workEnabled && (currentItem?.schemaVersion===2 || WORK_FIELDS.some(key=>selectedDraft.form[key]!==selectedDraft.baseValues?.[key])))}>{selectedState.saving?'正在保存…':'保存到 Obsidian'}</button></div>
          {discardConfirm && <div className="desktop-discard-confirmation"><p>{selectedDraft.isNew?'放弃这份尚未保存的新建事项？':'仅移除本机草稿，不修改任何原笔记。'}</p><button type="button" className="btn" disabled={busy} onClick={()=>setDiscardConfirm(false)}>继续保留</button><button type="button" className="btn btn-danger" disabled={busy} onClick={discard}>确认放弃草稿</button></div>}
        </form>
        <div className="schedule-item-actions">{selectedDraft.form.status==='archived'?<button className="btn" disabled={busy} onClick={()=>setStatus('todo')}><IconArrowBackUp size={15}/>恢复事项</button>:<><button className="btn" disabled={busy} onClick={()=>setStatus(selectedDraft.form.status==='done'?'todo':'done')}>{selectedDraft.form.status==='done'?<IconArrowBackUp size={15}/>:<IconCheck size={15}/>} {selectedDraft.form.status==='done'?'恢复待办':'标记完成'}</button><button className="text-btn" disabled={busy} onClick={()=>setStatus('archived')}><IconArchive size={15}/>归档</button></>}{selectedItem.path && <button className="text-btn" onClick={openNote}><IconFileText size={14}/>打开日程原笔记<IconArrowUpRight size={12}/></button>}</div>
      </div></aside>}
    </div>
    </>}
    {leaveAction && <LeavePrompt onCancel={()=>setLeaveAction(null)} onLeave={()=>{const action=leaveAction;setLeaveAction(null);action();}}/>}
  </div>;
}
