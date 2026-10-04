import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {IconArrowUpRight,IconCheck,IconPencil,IconFileText,IconArrowBackUp} from '@tabler/icons-react';
import {Art} from './common.jsx';
import MarkdownContent from './MarkdownContent.jsx';
import {notePresentation,relatedMaterialPaths,relationPayload} from './notePresentation.js';
import {draftFields,noteDraftKey,mergeSavedDraft,rebaseDraft,patchFields,valueOf,readableError,isConflict} from './desktopModel.js';
import {draftStoreFor,draftStatus,hasDraftChanges} from './draftStatus.js';
const uuid=()=>crypto.randomUUID();
const actualNote=result=>{const value=valueOf(result);return value?.note || value;};
const shortDate=value=>value ? String(value).slice(0,10).replaceAll('-','/') : '';
const noteWorkspace=value=>({editing:Boolean(value?.editing),details:{sourceBody:Boolean(value?.details?.sourceBody),rawShare:Boolean(value?.details?.rawShare),conflictBody:Boolean(value?.details?.conflictBody)}});
export function DesktopNote({item,api,identity,connected,onSaved,onNavigate,compact=false,workspaceState,onWorkspaceState,onReady}) {
  const record=item.raw || item;
  const [draft,setDraft]=useState(null),[ready,setReady]=useState(false),[editing,setEditing]=useState(()=>Boolean(workspaceState?.editing)),[error,setError]=useState(''),[success,setSuccess]=useState(''),[saving,setSaving]=useState(false),[conflict,setConflict]=useState(false),[latest,setLatest]=useState(null);
  const [localState,setLocalState]=useState('idle'),[localError,setLocalError]=useState(''),[saveError,setSaveError]=useState(false),[discardConfirm,setDiscardConfirm]=useState(false),[discarding,setDiscarding]=useState(false);
  const [details,setDetails]=useState(()=>noteWorkspace(workspaceState).details);
  const workspaceRef=useRef(noteWorkspace(workspaceState)),incomingWorkspace=useRef(workspaceState),workspaceCallback=useRef(onWorkspaceState),readyCallback=useRef(onReady);
  incomingWorkspace.current=workspaceState;workspaceCallback.current=onWorkspaceState;readyCallback.current=onReady;
  const commitWorkspace=next=>{workspaceRef.current=next;workspaceCallback.current?.({editing:next.editing,details:{...next.details}});};
  const editProperties=value=>{if(workspaceRef.current.editing===value)return;setEditing(value);commitWorkspace({...workspaceRef.current,editing:value});};
  const toggleDetails=(name,value)=>{if(workspaceRef.current.details[name]===value)return;const next={...workspaceRef.current.details,[name]:value};setDetails(next);commitWorkspace({...workspaceRef.current,details:next});};
  const key=noteDraftKey(identity,record.path),store=draftStoreFor(api);
  const draftRef=useRef(null),sessionRef=useRef(null),keyRef=useRef(key),recordRef=useRef(record),explorationRef=useRef(null);
  keyRef.current=key;recordRef.current=record;
  const active=session=>Boolean(session?.active && sessionRef.current===session && keyRef.current===session.key);
  const showDraft=(value,session=sessionRef.current)=>{if(!active(session))return;draftRef.current=value;setDraft(value);};
  const persist=async(value,session=sessionRef.current)=>{
    if(!active(session))return false;
    const revision=++session.writeRevision;
    setLocalState('saving');
    try {
      const {localSaveError:ignored,...persistable}=value;
      await store.write(session.key,persistable);
      if(active(session) && revision===session.writeRevision){setLocalState('saved');setLocalError('');}
      return true;
    } catch(e) {
      if(active(session) && revision===session.writeRevision){setLocalState('error');setLocalError(`草稿尚未保存到本机：${readableError(e)}`);}
      return false;
    }
  };
  const replace=(value,shouldPersist=true,session=sessionRef.current)=>{
    if(!active(session))return Promise.resolve(false);
    showDraft(value,session);
    return shouldPersist?persist(value,session):Promise.resolve(true);
  };
  useEffect(()=>{
    const session={key,active:true,writeRevision:0,busy:false,observedHash:null};sessionRef.current=session;
    const restoredWorkspace=noteWorkspace(incomingWorkspace.current);workspaceRef.current=restoredWorkspace;setEditing(restoredWorkspace.editing);setDetails(restoredWorkspace.details);
    draftRef.current=null;setDraft(null);setReady(false);setError('');setSuccess('');setSaving(false);setConflict(false);setLatest(null);setLocalState('idle');setLocalError('');setSaveError(false);setDiscardConfirm(false);setDiscarding(false);
    store.read(key).then(saved=>{
      if(!active(session))return;
      const next=mergeSavedDraft(saved,recordRef.current);
      showDraft(next,session);
      if(saved?.localSaveError){setLocalState('error');setLocalError('草稿仍在当前应用中，但未能写入本机；请重试保存本机草稿。');}
      else setLocalState(hasDraftChanges(next)?'saved':'idle');
      setReady(true);
    }).catch(e=>{
      if(!active(session))return;
      showDraft(mergeSavedDraft(null,recordRef.current),session);setReady(true);setLocalState('error');setLocalError(`无法恢复本机草稿：${readableError(e)}`);
    });
    return()=>{session.active=false;};
  },[key,store]);
  useLayoutEffect(()=>{if(ready && active(sessionRef.current))readyCallback.current?.();},[ready,key]);
  useEffect(()=>{
    const current=draftRef.current,session=sessionRef.current;
    if(!active(session) || !ready || !current || session.busy || session.observedHash===record.hash)return;
    session.observedHash=record.hash;
    if(current.baseHash===record.hash)return;
    if(!hasDraftChanges(current)){replace(mergeSavedDraft(null,record));}
    else setConflict(true);
  },[record.hash,ready,saving,discarding]);
  const change=(field,value)=>{
    const current=draftRef.current;if(!current || sessionRef.current?.busy)return;
    setSuccess('');setSaveError(false);setDiscardConfirm(false);
    replace({...current,form:{...current.form,[field]:value},fieldOperationId:null});
  };
  const changeExplore=text=>{
    const current=draftRef.current;if(!current || sessionRef.current?.busy)return;
    setSuccess('');setSaveError(false);setDiscardConfirm(false);
    const changedAfterSend=current.submittedExploration && text.trim()!==current.submittedExploration;
    replace({...current,exploration:text,operationId:text ? (changedAfterSend?uuid():current.operationId || uuid()) : null,submittedExploration:changedAfterSend?null:current.submittedExploration});
  };
  const reloadCurrent=async()=>{
    const session=sessionRef.current;
    try{const current=actualNote(await api.readNote(record.path));if(!active(session))return;setLatest(current);setConflict(true);setError('请核对当前笔记。采用当前版本后，仍需你主动保存草稿。');}
    catch(e){if(active(session))setError(readableError(e));}
  };
  async function save(kind,extraFields) {
    const session=sessionRef.current;
    if(!active(session) || session.busy || !ready || !connected || conflict)return;
    const current=draftRef.current,fields=extraFields || patchFields(current.form,current.baseValues);
    if(kind==='fields' && !Object.keys(fields).length)return;
    if(kind==='exploration' && !current.exploration.trim())return;
    session.busy=true;setSaving(true);setError('');setSuccess('');setSaveError(false);setDiscardConfirm(false);
    const sameFields=JSON.stringify(current.submittedFields || {})===JSON.stringify(fields);
    const operationId=(kind==='exploration' ? current.operationId : sameFields?current.fieldOperationId:null) || uuid();
    const pending={...current,[kind==='exploration'?'operationId':'fieldOperationId']:operationId,...(kind==='exploration'?{submittedExploration:current.exploration.trim()}:{submittedFields:fields})};
    replace(pending,true,session);
    let accepted=false,confirmed=false;
    try {
      valueOf(await api.save({path:record.path,expectedHash:current.baseHash,operationId,kind,...(kind==='exploration'?{text:current.exploration.trim(),explorationKind:'补充'}:{fields})}));
      accepted=true;
      if(!active(session))return;
      const saved=actualNote(await api.readNote(record.path));
      if(!active(session))return;
      confirmed=true;
      const next={...pending,baseHash:saved.hash,baseValues:draftFields(saved),form:kind==='fields'?draftFields(saved):pending.form,...(kind==='exploration'?{exploration:'',operationId:null,submittedExploration:null}:{fieldOperationId:null,submittedFields:null})};
      replace(next,true,session);setConflict(false);setLatest(null);if(kind==='fields')editProperties(false);
      await onSaved?.();
      if(active(session))setSuccess(kind==='exploration'?'探索记录已保存到 Obsidian':extraFields?'整理说明已确认':'属性已保存到 Obsidian');
    } catch(e) {
      if(active(session)){
        setError(confirmed?'笔记已保存，但列表尚未刷新。请重新检查连接。':accepted?'保存请求已完成，但还未读回确认。草稿已保留，请重新核对笔记。':readableError(e));
        setSaveError(!confirmed);setConflict(!confirmed && (accepted || isConflict(e)));
      }
    } finally {session.busy=false;if(active(session))setSaving(false);}
  }
  async function discardDraft() {
    const session=sessionRef.current;
    if(!active(session) || session.busy || !discardConfirm)return;
    session.busy=true;setDiscarding(true);setError('');setSuccess('');
    const next=mergeSavedDraft(null,latest || recordRef.current);
    ++session.writeRevision;setLocalState('saving');
    try {
      await store.discard(session.key,draftRef.current);
      if(active(session)){showDraft(next,session);setLocalState('idle');setLocalError('');editProperties(false);setDiscardConfirm(false);setConflict(false);setLatest(null);setSaveError(false);setSuccess('已放弃本机草稿，正式笔记未改动。');}
    } catch(e) {
      if(active(session)){setLocalState('error');setLocalError(`未能放弃本机草稿，当前内容仍保留：${readableError(e)}`);}
    }
    session.busy=false;if(active(session))setDiscarding(false);
  }
  async function open(method) {const session=sessionRef.current;try{valueOf(await api[method](record.path));}catch(e){if(active(session))setError(readableError(e));}}
  const body=notePresentation(record),changed=Boolean(ready && draft && Object.keys(patchFields(draft.form,draft.baseValues)).length),hasChanges=ready && hasDraftChanges(draft),busy=saving || discarding;
  const status=draftStatus({ready,hasChanges,localState,localError,conflict,saving,saveError});
  const editButton=<button className="text-btn desktop-edit-properties" title="编辑用途、分类、标签与配文" aria-label="编辑属性" aria-expanded={editing} disabled={!ready || busy} onClick={()=>editProperties(!editing)}><IconPencil size={15}/>{editing?'收起属性':'编辑属性'}</button>;
  return <article className={`desktop-note ${compact?'desktop-note-compact':''}`} data-note-ready={ready?'true':'false'} aria-label={`${item.title}笔记`}>
    {!compact && <div className="inspiration-document-heading"><div><h2>{item.title}</h2>{record.category && <div className="inspiration-document-meta">{record.category}</div>}</div>{editButton}</div>}
    {compact && <>{item.type !== 'text' && <div className="desktop-material-hero"><Art real src={item.assetUrl} alt={item.title}/></div>}<div className="materials-detail-title"><div><span className="collections-detail-eyebrow">素材笔记</span><h2>{item.title}</h2></div>{editButton}</div></>}
    <div className="desktop-note-state desktop-draft-status" data-state={status.state}>
      <span className="desktop-note-state-label" role="status" aria-live="polite">{status.label}</span>
      <div className="desktop-note-state-actions">
        {hasChanges && !editing && <button className="text-btn" disabled={busy} onClick={()=>changed?editProperties(true):explorationRef.current?.focus()}>继续编辑草稿</button>}
        {ready && localError && <button className="text-btn" disabled={busy || localState==='saving'} onClick={()=>persist(draftRef.current)}>重试保存本机草稿</button>}
        {hasChanges && <button className="text-btn" disabled={busy} onClick={()=>setDiscardConfirm(!discardConfirm)}>放弃草稿</button>}
      </div>
      {localError && <p className="desktop-note-state-error" role="alert">{localError}</p>}
    </div>
    {discardConfirm && <section className="desktop-discard-confirmation" aria-label="确认放弃草稿"><p>放弃这份笔记的属性修改和未保存探索？正式笔记会保留。</p><div className="desktop-editor-actions"><button className="btn" disabled={busy} onClick={()=>setDiscardConfirm(false)}>继续保留</button><button className="btn btn-danger" disabled={busy} onClick={discardDraft}>{discarding?'正在放弃…':'确认放弃草稿'}</button></div></section>}
    {record.sourceChanged && <p className="desktop-inline-warning">来源有更新，当前整理内容仍保留。</p>}
    <div className="desktop-note-actions"><button className="text-btn" onClick={()=>open('openNote')}><IconFileText size={14}/>在 Obsidian 中编辑正文<IconArrowUpRight size={12}/></button>{record.kind !== 'web' && (record.attachmentPath || record.originalPath) && <button className="text-btn" onClick={()=>open('openOriginal')}>查看原图<IconArrowUpRight size={12}/></button>}{record.url && <button className="text-btn" onClick={()=>open('openSourceLink')}>查看原链接<IconArrowUpRight size={12}/></button>}</div>
    {(record.tags || []).length>0 && <div className="collections-tags">{record.tags.map(tag=><span className="chip" key={tag}>{tag}</span>)}</div>}
    {conflict && <p className="desktop-inline-warning" role="status">笔记在其他地方有新修改。请在下方核对冲突后再保存。</p>}
    {editing && ready ? <section className="desktop-note-editor" aria-label="编辑笔记属性"><p className="desktop-editor-help">在这里编辑用途、分类、标签和配文；正文请在 Obsidian 中编辑。</p><div className="desktop-form-row"><label>用途<select value={draft.form.role} disabled={busy} onChange={e=>change('role',e.target.value)}><option value="seed">起点灵感</option><option value="material">参考素材</option></select></label><label>分类<input value={draft.form.category} disabled={busy} onChange={e=>change('category',e.target.value)}/></label></div><label>标签<input value={draft.form.tags} disabled={busy} onChange={e=>change('tags',e.target.value)} placeholder="以逗号分隔"/></label><label>配文<textarea rows={4} value={draft.form.caption} disabled={busy} onChange={e=>change('caption',e.target.value)} placeholder="记录这份内容的含义，或收藏它的理由。"/></label><div className="desktop-editor-actions"><span>{changed?'属性修改尚未保存到 Obsidian':'属性与笔记一致'}</span><button className="btn" disabled={busy} onClick={()=>editProperties(false)}>收起编辑区</button><button className="btn btn-primary" disabled={!connected || busy || !changed || conflict} onClick={()=>save('fields')}>{saving?'保存中…':'保存到 Obsidian'}</button></div></section> : body.caption && <section className="desktop-caption"><p>{body.caption}</p></section>}
    {!compact ? <MarkdownContent text={body.body} onNavigate={onNavigate}/> : body.body && <details className="desktop-source-body" open={details.sourceBody} onToggle={event=>toggleDetails('sourceBody',event.currentTarget.open)}><summary>笔记正文</summary><MarkdownContent text={body.body} onNavigate={onNavigate}/></details>}
    {body.rawShare && <details className="materials-share" open={details.rawShare} onToggle={event=>toggleDetails('rawShare',event.currentTarget.open)}><summary>原始分享文字</summary><MarkdownContent text={body.rawShare}/></details>}
    {record.url && <section className="desktop-source-url"><span>出处</span><button className="text-btn" onClick={()=>open('openSourceLink')}>{record.url}<IconArrowUpRight size={12}/></button></section>}
    {(record.explorations || []).length>0 && <section className="inspiration-history"><h3>沿着这个念头</h3>{record.explorations.map((explore,index)=><article key={explore.id || index}><span>{shortDate(explore.createdAt || explore.date)}</span><p>{explore.text}</p></article>)}</section>}
    {ready && <section className="inspiration-explore"><label htmlFor={`explore-${item.id}`}>{compact?'补充探索记录':'继续探索这个灵感…'}</label><textarea ref={explorationRef} id={`explore-${item.id}`} rows={3} value={draft.exploration || ''} disabled={busy} onChange={e=>changeExplore(e.target.value)} placeholder="新的联想、问题，或一次小尝试…"/><div className="desktop-editor-actions"><span>{draft.exploration?.trim()?'探索尚未保存到 Obsidian':''}</span><button className="btn btn-primary" disabled={!connected || busy || !draft.exploration?.trim() || conflict} onClick={()=>save('exploration')}>{saving?'保存中…':'保存探索'}</button></div></section>}
    {!item.confirmed && <section className="inspiration-organize"><div><IconCheck size={17}/><span><strong>整理说明待确认</strong>{body.summary && <p className="desktop-summary-copy">{body.summary}</p>}<small>确认后收起说明，结果保留在笔记中。</small></span></div><button className="text-btn" disabled={!connected || busy || !ready || changed || conflict} title={changed?'请先保存配文修改':undefined} onClick={()=>save('fields',{summary_status:'confirmed'})}>确认整理</button></section>}
    {conflict && <section className="desktop-conflict" role="alert"><strong>笔记版本已变化，草稿尚未覆盖它</strong><p>先读取当前笔记，比较后选择是否保留你的修改。</p><button className="btn" disabled={!connected || busy} onClick={reloadCurrent}>查看当前笔记</button>{latest && <><dl><dt>当前分类</dt><dd>{latest.category || latest.fields?.category || '未分类'}</dd><dt>当前配文</dt><dd>{notePresentation(latest).caption || '未填写'}</dd><dt>当前标签</dt><dd>{(latest.tags || []).join('、') || '未填写'}</dd></dl><details open={details.conflictBody} onToggle={event=>toggleDetails('conflictBody',event.currentTarget.open)}><summary>当前正文</summary><MarkdownContent text={notePresentation(latest).body} onNavigate={onNavigate}/></details><button className="btn" disabled={busy} onClick={()=>{replace(rebaseDraft(draftRef.current,latest));setConflict(false);setLatest(null);setError('');setSaveError(false);setSuccess('已采用当前笔记版本，请再次核对草稿并主动保存。');}}>保留草稿，采用当前版本</button></>}</section>}
    {error && <p className="desktop-inline-error" role="alert">{error}</p>}{success && <p className="desktop-inline-success" role="status"><IconCheck size={14}/>{success}</p>}
  </article>;
}

export function DesktopRelations({item,api,identity,connected,revision,onSaved,onNavigate,materials=[]}) {
  const path=item.path;
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const operations=useRef(new Map());
  useEffect(()=>{let active=true;setError('');if(!connected)return()=>{active=false;};api.related(path).then(valueOf).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(readableError(e));});return()=>{active=false;};},[path,revision,connected]);
  async function action(candidate,type) {
    const targetPath=candidate.targetPath || candidate.peerPath || candidate.path;
    const operationKey=`${type}:${path}:${targetPath}`;
    if(busy)return;setBusy(operationKey);setError('');
    if(!operations.current.has(operationKey))operations.current.set(operationKey,uuid());
    try {
      const [source,target]=await Promise.all([api.readNote(path),api.readNote(targetPath)]);
      const sourceNote=actualNote(source),targetNote=actualNote(target);
      valueOf(await api.relation(relationPayload(candidate,type,{sourcePath:path,targetPath,sourceHash:sourceNote.hash,targetHash:targetNote.hash,explanation:candidate.explanation || candidate.reason || candidate.summary || '',operationId:operations.current.get(operationKey)})));
      operations.current.delete(operationKey);
      const next=valueOf(await api.related(path));setData(next);await onSaved?.();
    } catch(e){setError(readableError(e));}finally{setBusy('');}
  }
  const attachedPaths=relatedMaterialPaths(item.raw || item);
  const attached=materials.filter(m=>attachedPaths.includes(m.path));
  const confirmed=data?.confirmed || [],candidates=data?.candidates || [];
  return <div className="desktop-relations"><div className="inspiration-related-heading"><h3>相关素材 <span>({attached.length})</span></h3></div><div className="inspiration-related-list">{attached.map(material=><button className="inspiration-related-item" key={material.path} onClick={()=>onNavigate(material.path)}>{material.type==='text'?<span className="inspiration-related-text-icon"><IconFileText size={24} stroke={1.1}/></span>:<Art real src={material.assetUrl} alt=""/>}<span><strong>{material.title}</strong><small>{material.type==='image'?'图片':material.type==='web'?'网页':'文本'}</small></span></button>)}</div>
    <section className="inspiration-candidates"><h3>已确认关联 <span>({confirmed.length})</span></h3>{confirmed.map(relation=><article key={relation.relationId || relation.id || relation.peerPath} className="inspiration-candidate inspiration-candidate-confirmed"><button className="desktop-relation-title text-btn" onClick={()=>onNavigate(relation.peerPath || relation.targetPath)}>{relation.title || relation.peerTitle || relation.targetTitle || relation.peerPath}<IconArrowUpRight size={13}/></button><p>{relation.explanation || relation.summary}</p><button className="text-btn" disabled={!connected || !!busy} onClick={()=>action(relation,'revoke')}><IconArrowBackUp size={13}/>{busy?'处理中…':'撤回关联'}</button></article>)}</section>
    <section className="inspiration-candidates"><h3>待确认的关联 <span>({candidates.length})</span></h3><p className="inspiration-candidate-intro">根据已有标签与文字提供候选，由你确认。</p>{candidates.map(candidate=><article key={candidate.targetPath || candidate.path} className="inspiration-candidate"><button className="desktop-relation-title text-btn" onClick={()=>onNavigate(candidate.targetPath || candidate.path)}>{candidate.title || candidate.targetTitle}<IconArrowUpRight size={13}/></button><p>{candidate.explanation || candidate.reason || candidate.summary || '现有内容关联候选'}</p><button className="text-btn" disabled={!connected || !!busy} onClick={()=>action(candidate,'confirm')}><IconCheck size={13}/>{busy?'处理中…':'确认关联'}</button></article>)}{data && !candidates.length && <p className="desktop-draft-status">目前没有新的关联候选。</p>}</section>
    {Boolean(data?.repair?.length || data?.repair?.status || data?.repair===true) && <p className="desktop-inline-warning">部分关系等待修复，请在 Obsidian 梦藏中检查修复记录。</p>}{error && <p className="desktop-inline-error" role="alert">{error}</p>}
  </div>;
}
