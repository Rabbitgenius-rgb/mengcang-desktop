import React,{useEffect,useMemo,useRef,useState} from 'react';
import {IconArrowLeft,IconUpload,IconCheck} from '@tabler/icons-react';
import {attachmentBytes,fileTypeFor} from './attachmentPreview.js';
import {MAX_ATTACHMENT_BYTES,normalizeWorkspaceAttachment} from './workspaceModel.js';
import {buildPodcastClip,formatClipTime,MAX_TRANSCRIPT_BYTES,parseClipTime,parsePodcastLocation,parseTimedTranscript,transcriptForRange,validateClipRange} from './podcastClips.js';
import {samePodcastAudio} from './podcastTranscription.js';
import './podcastClips.css';

const readDataURL=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('音频读取失败，请重新选择文件。'));reader.readAsDataURL(file);});
const defaults={sourceId:'',attachment:null,title:'',note:'',sourceUrl:'',start:'00:00',end:'00:30',transcript:'',transcriptName:''};

function useAudioSource(attachment) {
  const [source,setSource]=useState({url:'',error:''});
  useEffect(()=>{
    let url='';setSource({url:'',error:''});
    if(!attachment)return;
    try{
      if(fileTypeFor(attachment)?.kind!=='audio')throw Error('请选择可播放的音频文件。');
      url=URL.createObjectURL(new Blob([attachmentBytes(attachment)],{type:attachment.type}));
      setSource({url,error:''});
    }catch(error){setSource({url:'',error:error.message||'无法读取原音频。'});}
    return()=>{if(url)URL.revokeObjectURL(url);};
  },[attachment?.dataUrl,attachment?.type,attachment?.size,attachment?.name]);
  return source;
}

/** The parent owns API confirmation; merely opening this editor never calls it. */
export default function PodcastClips({cards=[],draft,onDraftChange,onSave,onCancel,transcribeAudio,transcribeLocal,getTranscriptionStatus,transcriptionDrafts=[],onRecoverTranscription,onPersistTranscription,isTranscriptionDurable,transcriptionActive=false}) {
  const [form,setForm]=useState(()=>({...defaults,...draft})),[error,setError]=useState(''),[busy,setBusy]=useState(false),[duration,setDuration]=useState(null),[currentTime,setCurrentTime]=useState(0);
  const [transcriptionStatus,setTranscriptionStatus]=useState(null),[statusError,setStatusError]=useState(''),[message,setMessage]=useState(''),[historyId,setHistoryId]=useState('');
  const audio=useRef(null),mounted=useRef(true),loadRun=useRef(0),playRange=useRef(null),fileRef=useRef(null),subtitleRef=useRef(null);
  const formRef=useRef(form),operationLock=useRef(false),subtitleRead=useRef(0);formRef.current=form;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadRun.current++;audio.current?.pause();};},[]);
  useEffect(()=>{let cancelled=false;if(!getTranscriptionStatus)return;getTranscriptionStatus().then(status=>{if(!cancelled&&mounted.current)setTranscriptionStatus(status);}).catch(issue=>{if(!cancelled&&mounted.current)setStatusError(issue.message||'转录状态读取失败');});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(draft?.transcriptionPhase==='complete'&&samePodcastAudio(draft,formRef.current)){subtitleRead.current++;setForm(previous=>({...previous,transcript:draft.transcript,transcriptName:draft.transcriptName,transcriptionRequestId:draft.transcriptionRequestId,transcriptionPhase:'complete'}));}},[draft?.transcriptionRequestId,draft?.transcriptionPhase,draft?.transcript]);
  const sources=useMemo(()=>cards.filter(card=>fileTypeFor(card.attachment)?.kind==='audio'),[cards]);
  const sourceCard=sources.find(card=>card.id===form.sourceId),attachment=form.attachment||sourceCard?.attachment;
  const attachmentRef=useRef(attachment);attachmentRef.current=attachment;
  const audioSource=useAudioSource(attachment);
  const transcribeAdapter=transcribeAudio||transcribeLocal;
  const provider=transcriptionStatus?.settings?.transcriptionProvider||(transcribeAudio?'api':'local');
  const localStatus=transcriptionStatus?.localTranscription;
  const transcriptionIssue=getTranscriptionStatus&&!transcriptionStatus?statusError||'正在读取转录准备状态…':provider==='local'&&transcriptionStatus?(!transcriptionStatus.settings?.localTranscriptionEnabled?'请先在“AI 连接与用量”中启用本机音频转录。':!(localStatus?.ready||localStatus?.available)?localStatus?.message||'本机转录模型或组件尚未准备好。':''):provider==='api'&&transcriptionStatus&&(transcriptionStatus.settings?.provider!=='api'||/^(?:https:\/\/api\.deepseek\.com\.?(?:\/|$))/i.test(transcriptionStatus.settings?.endpoint||''))?'当前 AI 连接不提供音频转录，请选择本机转录。':'';
  const history=transcriptionDrafts.find(record=>record.id===historyId)||transcriptionDrafts[0];
  let cues=[],subtitleError='';try{if(form.transcript)cues=parseTimedTranscript(form.transcript);}catch(e){subtitleError=e.message;}
  let excerpt='';try{excerpt=transcriptForRange(cues,form.start,form.end);}catch{}
  function update(patch){if(Object.prototype.hasOwnProperty.call(patch,'transcript'))subtitleRead.current++;setForm(previous=>{const next={...previous,...patch};onDraftChange?.(next);return next;});setError('');}
  function changeAudio(patch,invalidate=true){if(invalidate)loadRun.current++;audio.current?.pause();playRange.current=null;setDuration(null);setCurrentTime(0);update({...patch,start:'00:00',end:'00:30',transcript:'',transcriptName:'',transcriptionRequestId:'',transcriptionPhase:''});}
  async function chooseAudio(file){if(!file)return;const run=++loadRun.current;setBusy(true);setError('');try{
    const kind=fileTypeFor(file);if(kind?.kind!=='audio')throw Error('请选择 MP3、M4A、WAV、AAC、FLAC 或 OGG 音频。');
    if(file.size<1||file.size>MAX_ATTACHMENT_BYTES)throw Error('音频文件应为 1 字节至 64 MiB。');
    const fileData=normalizeWorkspaceAttachment({name:file.name,type:kind.type,size:file.size,dataUrl:(await readDataURL(file)).replace(/^data:[^;,]*;base64,/,`data:${kind.type};base64,`)});
    if(mounted.current&&run===loadRun.current)changeAudio({attachment:fileData,sourceId:''},false);
  }catch(e){if(mounted.current&&run===loadRun.current)setError(e.message);}finally{if(mounted.current&&run===loadRun.current)setBusy(false);}}
  async function chooseTranscript(file){if(!file)return;const read=++subtitleRead.current,run=loadRun.current,snapshot={sourceId:formRef.current.sourceId,attachment:attachmentRef.current};const current=()=>mounted.current&&read===subtitleRead.current&&run===loadRun.current&&samePodcastAudio(snapshot,{sourceId:formRef.current.sourceId,attachment:attachmentRef.current});setError('');try{if(!/\.(?:srt|vtt)$/i.test(file.name||''))throw Error('请选择 .srt 或 .vtt 字幕文件。');if(file.size>MAX_TRANSCRIPT_BYTES)throw Error('字幕文件不能超过 2 MiB。');const text=await file.text();parseTimedTranscript(text);if(current())update({transcript:text,transcriptName:file.name,transcriptionRequestId:'',transcriptionPhase:''});}catch(e){if(current())setError(e.message);}}
  async function save(){setError('');setBusy(true);try{if(subtitleError)throw Error(subtitleError);await onSave(buildPodcastClip({...form,sourceCard,attachment:form.attachment,duration,cues}));}catch(e){if(mounted.current)setError(e.message||'片段保存失败，编辑内容已保留。');}finally{if(mounted.current)setBusy(false);}}
  async function preview(){setError('');try{const range=validateClipRange(form.start,form.end,duration);if(!audio.current)throw Error('请先选择音频。');playRange.current=range;audio.current.currentTime=range.start;await audio.current.play();}catch(e){setError(e.message||'暂时无法播放此音频。');}}
  async function transcribe(){if(operationLock.current||transcriptionActive)return;subtitleRead.current++;operationLock.current=true;setError('');setMessage('');setBusy(true);const snapshot=form,run=loadRun.current;try{if(transcriptionIssue)throw Error(transcriptionIssue);const result=await transcribeAdapter(attachment,{requestId:globalThis.crypto?.randomUUID?.(),provider,formSnapshot:snapshot}),transcript=typeof result==='string'?result:result?.text;if(typeof transcript!=='string')throw Error('转录器未返回 SRT 或 WebVTT 字幕。');parseTimedTranscript(transcript);if(mounted.current&&run===loadRun.current&&samePodcastAudio(snapshot,formRef.current)){if(result?.draftApplied===false)setMessage('转录结果已保留在下方的结果草稿，当前音频或字幕已变化，未覆盖。');else if(result?.draft)setForm(result.draft);else update({transcript,transcriptName:provider==='local'?'本机转录':'API 转录'});}}catch(e){if(mounted.current)setError(e.message||'转录未完成。');}finally{operationLock.current=false;if(mounted.current)setBusy(false);}}
  async function recoverTranscript(){if(!history||operationLock.current)return;subtitleRead.current++;operationLock.current=true;setBusy(true);setError('');try{const restored=await onRecoverTranscription(history,{formSnapshot:form,attachment});if(mounted.current)setForm(restored);}catch(issue){if(mounted.current)setError(issue.message||'字幕未恢复，当前草稿已保留。');}finally{operationLock.current=false;if(mounted.current)setBusy(false);}}
  async function persistTranscript(){if(!history||operationLock.current)return;operationLock.current=true;setBusy(true);setError('');try{await onPersistTranscription(history);if(mounted.current)setMessage('转录结果草稿已保存到本机。');}catch(issue){if(mounted.current)setError(issue.message||'结果草稿仍未写入磁盘，请保留此窗口并重试。');}finally{operationLock.current=false;if(mounted.current)setBusy(false);}}
  return <main className="sublime-editor se-podcast">
    <header className="se-heading"><h1>播客片段</h1><div><button type="button" className="se-icon-button" aria-label="返回资料库" disabled={busy} onClick={onCancel}><IconArrowLeft size={22}/></button><button type="button" className="se-save" disabled={busy||!attachment} onClick={save}>{busy?'正在处理…':'保存片段'}</button></div></header>
    <p className="se-podcast-hint">选择音频，标记片段并保留出处。字幕可从 SRT 或 WebVTT 文件导入。</p>
    <section className="se-podcast-panel" aria-label="音频来源">
      <label>资料库音频<select aria-label="资料库音频" value={form.sourceId} disabled={busy} onChange={event=>changeAudio({sourceId:event.target.value,attachment:null})}><option value="">选择已保存的音频</option>{sources.map(card=><option key={card.id} value={card.id}>{card.title||card.attachment.name}</option>)}</select></label>
      <input ref={fileRef} className="se-sr-only" type="file" aria-label="选择本机音频" accept="audio/*,.mp3,.m4a,.m4b,.wav,.aac,.flac,.ogg,.opus" disabled={busy} onChange={event=>{chooseAudio(event.target.files?.[0]);event.target.value='';}}/>
      <button type="button" className="se-secondary" disabled={busy} onClick={()=>fileRef.current?.click()}><IconUpload size={16}/>选择本机音频</button>
      {attachment&&<><p className="se-podcast-filename">{attachment.name}</p><audio ref={audio} src={audioSource.url||undefined} controls preload="metadata" aria-label="播客音频播放器" onLoadedMetadata={event=>{const value=event.currentTarget.duration;setDuration(Number.isFinite(value)?value:null);}} onTimeUpdate={event=>{const value=event.currentTarget.currentTime;setCurrentTime(value);if(playRange.current&&value>=playRange.current.end){event.currentTarget.pause();playRange.current=null;}}} onError={()=>setError('当前播放器无法解码此音频，可换用 MP3、M4A 或 WAV 文件。')}/></>}
    </section>
    <section className="se-podcast-panel" aria-label="片段范围">
      <div className="se-podcast-times"><label>开始时间<input aria-label="片段开始时间" value={form.start} disabled={busy} onChange={event=>update({start:event.target.value})}/></label><label>结束时间<input aria-label="片段结束时间" value={form.end} disabled={busy} onChange={event=>update({end:event.target.value})}/></label></div>
      <div className="se-podcast-actions"><button type="button" className="se-secondary" disabled={!attachment||busy} onClick={()=>update({start:formatClipTime(currentTime)})}>当前位置设为开始</button><button type="button" className="se-secondary" disabled={!attachment||busy} onClick={()=>update({end:formatClipTime(currentTime)})}>当前位置设为结束</button><button type="button" className="se-secondary" disabled={!audioSource.url||busy} onClick={preview}>试听片段</button></div>
      <p className="se-podcast-hint">当前 {formatClipTime(currentTime)}{duration!=null?` / ${formatClipTime(duration)}`:''} · 保存时间标记和原音频，不生成剪辑音频文件。</p>
    </section>
    <section className="se-podcast-panel" aria-label="字幕与摘录">
      <div className="se-podcast-actions"><input ref={subtitleRef} className="se-sr-only" type="file" aria-label="导入字幕文件" disabled={busy} onChange={event=>{chooseTranscript(event.target.files?.[0]);event.target.value='';}}/><button type="button" className="se-secondary" disabled={busy} onClick={()=>subtitleRef.current?.click()}><IconUpload size={16}/>导入字幕</button>{transcribeAdapter&&<button type="button" className="se-secondary" disabled={busy||transcriptionActive||!attachment||!!transcriptionIssue} onClick={transcribe}>{provider==='api'?'调用 API 转录（需确认）':getTranscriptionStatus?'使用本机转录（需确认）':'使用本机转录'}</button>}{form.transcript&&<button type="button" className="se-secondary" disabled={busy} onClick={()=>update({transcript:'',transcriptName:'',transcriptionRequestId:'',transcriptionPhase:''})}>移除字幕</button>}</div>
      {getTranscriptionStatus&&provider==='local'&&<p className="se-podcast-hint">本机模型：{localStatus?.model||'large-v3-turbo'}。仅本机读取音频，确认后按需启动，任务结束自动退出并释放内存，不消耗云端额度。</p>}
      {transcriptionIssue&&<p className="se-podcast-hint" role="status">{transcriptionIssue}</p>}{(busy||transcriptionActive)&&<p className="se-podcast-hint" role="status">正在处理；关闭弹窗后结果仍保存到原资料库草稿，不会自动重试。</p>}{message&&<p className="se-podcast-hint" role="status">{message}</p>}
      {form.transcriptName&&<p className="se-podcast-hint"><IconCheck size={14}/> {form.transcriptName} · {cues.length} 条字幕</p>}
      {!transcribeAdapter&&!form.transcript&&<p className="se-podcast-hint">可直接记录片段和备注。尚未配置语音转录服务，不会发送请求。</p>}
      {transcriptionDrafts.length>0&&<details><summary>已保留的转录结果</summary><label className="se-podcast-field">结果草稿<select aria-label="已保留的转录结果" value={history?.id||''} disabled={busy} onChange={event=>setHistoryId(event.target.value)}>{transcriptionDrafts.map(record=><option key={record.id} value={record.id}>{record.sourceSnapshot.title} · {record.phase==='complete'?'已完成':record.phase==='pending'?'未完成':'失败'}</option>)}</select></label>{history?.phase==='complete'?<><textarea aria-label="转录结果字幕" rows={7} value={history.transcript} readOnly/>{onRecoverTranscription&&<button type="button" className="se-secondary" disabled={busy||transcriptionActive||!attachment} onClick={recoverTranscript}>核对原音频并恢复字幕</button>}</>:<p className="se-podcast-hint">{history?.phase==='pending'?'上次转录未完成，未自动重试。':history?.error||'转录未完成，未自动重试。'}</p>}</details>}
      {history&&onPersistTranscription&&isTranscriptionDurable?.(history)===false&&<p className="se-podcast-hint" role="status">这份转录结果尚未写入磁盘，仍保留在此窗口。<button type="button" className="se-secondary" disabled={busy||transcriptionActive} onClick={persistTranscript}>重新保存结果草稿</button></p>}
      {subtitleError&&<p className="se-error" role="alert">{subtitleError}</p>}
      {cues.length>0&&<details><summary>查看字幕并选择时间</summary><div className="se-podcast-cues">{cues.slice(0,1000).map((cue,index)=><button key={index} type="button" disabled={busy} className={cue.start<parseClipTime(form.end)&&cue.end>parseClipTime(form.start)?'is-selected':''} onClick={()=>{update({start:formatClipTime(cue.start),end:formatClipTime(cue.end)});if(audio.current)audio.current.currentTime=cue.start;}}><time>{formatClipTime(cue.start)}</time><span>{cue.text}</span></button>)}{cues.length>1000&&<p className="se-podcast-hint">显示前 1000 条。输入时间可摘录完整字幕中的其他片段。</p>}</div></details>}
      {excerpt&&<blockquote className="se-podcast-excerpt">{excerpt}</blockquote>}
    </section>
    <label className="se-podcast-field">片段标题<input aria-label="片段标题" value={form.title} maxLength={1000} disabled={busy} placeholder="留空时使用音频标题与时间" onChange={event=>update({title:event.target.value})}/></label>
    <label className="se-podcast-field">来源链接<input aria-label="播客来源链接" type="url" value={form.sourceUrl} disabled={busy} placeholder={sourceCard?.sourceUrl||'https://'} onChange={event=>update({sourceUrl:event.target.value})}/></label>
    <label className="se-podcast-field">我的备注<textarea aria-label="片段备注" rows={4} value={form.note} maxLength={50000} disabled={busy} onChange={event=>update({note:event.target.value})}/></label>
    {(error||audioSource.error)&&<p className="se-error" role="alert">{error||audioSource.error}</p>}
  </main>;
}

export function PodcastClipPlayback({attachment,sourceLocation}) {
  const audio=useRef(null),playingRange=useRef(false),[error,setError]=useState('');
  const range=parsePodcastLocation(sourceLocation);
  const audioSource=useAudioSource(range?attachment:null);
  useEffect(()=>{playingRange.current=false;setError('');return()=>{audio.current?.pause();};},[attachment?.dataUrl,sourceLocation]);
  if(!range)return null;
  let valid=false;try{valid=Boolean(attachment&&fileTypeFor(attachment)?.kind==='audio'&&normalizeWorkspaceAttachment(attachment));}catch{}
  if(!valid)return <p className="se-podcast-hint">原音频未找到，时间标记和摘录已保留。</p>;
  async function play(){setError('');try{validateClipRange(range.start,range.end,audio.current?.duration);audio.current.currentTime=range.start;playingRange.current=true;await audio.current.play();}catch(e){playingRange.current=false;setError(e.message||'片段暂时无法播放。');}}
  return <section className="se-podcast-playback" aria-label="已保存的音频片段"><audio ref={audio} src={audioSource.url||undefined} controls preload="metadata" aria-label="片段音频播放器" onTimeUpdate={event=>{if(playingRange.current&&event.currentTarget.currentTime>=range.end){event.currentTarget.pause();playingRange.current=false;}}} onError={()=>setError('当前播放器无法解码原音频。')}/><div className="se-podcast-actions"><button type="button" className="se-secondary" disabled={!audioSource.url} onClick={play}>试听已保存片段</button><span className="se-podcast-hint">{formatClipTime(range.start)}–{formatClipTime(range.end)}</span></div>{(error||audioSource.error)&&<p className="se-error" role="alert">{error||audioSource.error}</p>}</section>;
}
