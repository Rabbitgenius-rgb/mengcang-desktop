import {compactAiSource} from './intelligenceDrafts.js';
import {MAX_TRANSCRIPT_BYTES,parseTimedTranscript} from './podcastClips.js';

export const PODCAST_TRANSCRIPTION_PREFIX='podcast-transcription:';
export const podcastTranscriptionKey=id=>`${PODCAST_TRANSCRIPTION_PREFIX}${id}`;
const cleanString=(value,max)=>typeof value==='string'&&value.length<=max&&!value.includes('\0')?value:'';
const audioStamp=draft=>[draft?.sourceId||'',draft?.attachment?.name||'',draft?.attachment?.type||'',draft?.attachment?.size||0,draft?.attachment?.dataUrl||''];
export function samePodcastAudio(a,b){return JSON.stringify(audioStamp(a))===JSON.stringify(audioStamp(b));}
export function normalizePodcastTranscription(record){
 if(!record||!/^[-a-f0-9]{36}$/i.test(record.id)||!['pending','complete','failed'].includes(record.phase)||!['local','api'].includes(record.provider))throw Error('转录结果草稿格式无效，原内容已保留。');
 const result={id:record.id,phase:record.phase,provider:record.provider,sourceId:cleanString(record.sourceId,4096),sourceSnapshot:compactAiSource(record.sourceSnapshot),createdAt:cleanString(record.createdAt,100),updatedAt:cleanString(record.updatedAt,100),baseTranscript:cleanString(record.baseTranscript,MAX_TRANSCRIPT_BYTES),baseTranscriptName:cleanString(record.baseTranscriptName,1000),transcript:'',engine:cleanString(record.engine,200),error:cleanString(record.error,10000)};
 if(!Number.isFinite(Date.parse(result.createdAt))||!Number.isFinite(Date.parse(result.updatedAt)))throw Error('转录草稿时间无效。');
 if(record.phase==='complete'){if(typeof record.transcript!=='string'||record.transcript.length>MAX_TRANSCRIPT_BYTES)throw Error('转录字幕超过草稿保存上限，请保留原结果。');parseTimedTranscript(record.transcript);result.transcript=record.transcript;}
 return result;
}
export function listPodcastTranscriptions(drafts={}){
 return Object.entries(drafts).filter(([key])=>key.startsWith(PODCAST_TRANSCRIPTION_PREFIX)).flatMap(([key,value])=>{try{const record=normalizePodcastTranscription(value);return key===podcastTranscriptionKey(record.id)?[record]:[];}catch{return [];}}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function beginPodcastTranscriptionActions(existing,record,snapshot){
 const current=existing.drafts.podcastClip;
 if(current&&(!samePodcastAudio(current,snapshot)||(current.transcript||'')!==(snapshot.transcript||'')||(current.transcriptName||'')!==(snapshot.transcriptName||'')))throw Error('播客草稿已在其他窗口变化，请重新打开后转录。');
 return [{type:'draft.set',key:podcastTranscriptionKey(record.id),value:normalizePodcastTranscription(record)},{type:'draft.set',key:'podcastClip',value:{...(current||snapshot),transcriptionRequestId:record.id,transcriptionPhase:'pending'}}];
}
export function finishPodcastTranscriptionActions(existing,raw,{allowApply=true}={}){
 const record=normalizePodcastTranscription(raw),current=existing.drafts.podcastClip;
 const actions=[{type:'draft.set',key:podcastTranscriptionKey(record.id),value:record}];
 const matches=current?.transcriptionRequestId===record.id&&(current.sourceId||'')===record.sourceId&&(current.transcript||'')===record.baseTranscript&&(current.transcriptName||'')===record.baseTranscriptName;
 const applied=matches&&allowApply&&record.phase==='complete';
 if(matches&&(record.phase!=='complete'||applied))actions.push({type:'draft.set',key:'podcastClip',value:{...current,transcriptionPhase:record.phase,...(applied?{transcript:record.transcript,transcriptName:record.provider==='local'?'本机转录':'API 转录'}:{})}});
 return {actions,applied,draft:applied?actions[1].value:null};
}
export function recoverPodcastTranscriptionActions(existing,record,snapshot){
 const current=existing.drafts.podcastClip;
 if(current&&(!samePodcastAudio(current,snapshot)||(current.transcript||'')!==(snapshot.transcript||'')))throw Error('播客草稿已变化，未覆盖当前字幕。转录结果仍保留。');
 const normalized=normalizePodcastTranscription(record);if(normalized.phase!=='complete')throw Error('这次转录尚未完成，未自动重试。');
 const value={...(current||snapshot),transcript:normalized.transcript,transcriptName:normalized.provider==='local'?'本机转录':'API 转录',transcriptionRequestId:normalized.id,transcriptionPhase:'complete'};
 return {actions:[{type:'draft.set',key:podcastTranscriptionKey(normalized.id),value:normalized},{type:'draft.set',key:'podcastClip',value}],draft:value};
}

export async function settleWorkspaceBeforeQuit({jobs,requests,sessions,hasVolatile,timeoutMs=5000}){
 const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
 // The model IPC may resolve before its renderer continuation starts.
 await pause();
 while(jobs.size)await Promise.allSettled([...jobs]);
 const deadline=Date.now()+timeoutMs;
 while(requests.size){if(Date.now()>=deadline)throw Error('AI 结果仍在保存，请稍后再退出。');await pause();}
 await Promise.all([...sessions.values()].map(session=>session.settled()));
 if(hasVolatile())throw Error('仍有结果未写入磁盘，请复制或保存后再退出。');
}
