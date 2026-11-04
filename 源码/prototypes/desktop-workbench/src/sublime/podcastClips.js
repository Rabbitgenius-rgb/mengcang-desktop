import {normalizeWorkspaceAttachment,safeSourceUrl} from './workspaceModel.js';
import {fileTypeFor} from './attachmentPreview.js';
import {fingerprintWorkspaceAttachment} from './attachmentFingerprint.js';

export const MAX_TRANSCRIPT_BYTES=2*1024*1024;
export const MAX_TRANSCRIPT_CUES=20000;
export function parseClipTime(value) {
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:NaN;
  const text=String(value??'').trim().replace(',','.');
  if(/^\d+(?:\.\d{1,3})?$/.test(text))return Number(text);
  const match=/^(?:(\d{1,4}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text);
  if(!match||Number(match[3])>=60||(match[1]&&Number(match[2])>=60))return NaN;
  return Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3])+Number(`0.${match[4]||0}`);
}
export function formatClipTime(value) {
  if(!Number.isFinite(value)||value<0)return '00:00';
  const millis=Math.round(value*1000),seconds=Math.floor(millis/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return `${h?`${String(h).padStart(2,'0')}:`:''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${millis%1000?`.${String(millis%1000).padStart(3,'0')}`:''}`;
}
export function validateClipRange(start,end,duration) {
  const from=parseClipTime(start),to=parseClipTime(end);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw Error('结束时间必须晚于开始时间，可填写秒数或 00:12.500。');
  if(to>7*24*3600)throw Error('片段时间超出支持范围。');
  if(Number.isFinite(duration)&&duration>0&&to>duration+0.05)throw Error('片段结束时间超出音频时长。');
  return {start:from,end:to};
}
export function parsePodcastLocation(value) {
  const match=/^音频片段 ([\d:.]+)–([\d:.]+)$/.exec(String(value||''));
  if(!match)return null;
  try{return validateClipRange(match[1],match[2]);}catch{return null;}
}
function decodeSubtitleEntities(text) {
  const named={amp:'&',AMP:'&',lt:'<',LT:'<',gt:'>',GT:'>',quot:'"',QUOT:'"',apos:"'",nbsp:'\u00a0',lrm:'\u200e',rlm:'\u200f'};
  return text.replace(/&(#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z]+);/g,(entity,name)=>{
    if(name[0]!=='#')return Object.prototype.hasOwnProperty.call(named,name)?named[name]:entity;
    const hex=/^#[xX]/.test(name),point=Number.parseInt(name.slice(hex?2:1),hex?16:10);
    return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):entity;
  });
}
export function parseTimedTranscript(input) {
  if(typeof input!=='string'||new TextEncoder().encode(input).length>MAX_TRANSCRIPT_BYTES)throw Error('字幕文件不能超过 2 MiB。');
  const normalized=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!normalized)throw Error('字幕文件为空。');
  const blocks=normalized.split(/\n[\t ]*\n/),cues=[];
  for(const block of blocks){
    const lines=block.split('\n');
    if(/^(WEBVTT|NOTE(?: |$)|STYLE(?: |$)|REGION(?: |$))/.test(lines[0]))continue;
    const timingIndex=lines.findIndex(line=>line.includes('-->'));
    if(timingIndex<0)continue;
    const match=/^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[timingIndex]);
    if(!match)throw Error('字幕时间格式无效，请使用 SRT 或 WebVTT 文件。');
    const range=validateClipRange(match[1],match[2]);
    // Strip real markup first, then decode once so escaped literal tags remain text.
    const text=decodeSubtitleEntities(lines.slice(timingIndex+1).join('\n').replace(/<[^>]*>/g,'')).trim();
    if(text)cues.push({...range,text});
    if(cues.length>MAX_TRANSCRIPT_CUES)throw Error('字幕条目超过 20000 条，请分段导入。');
  }
  if(!cues.length)throw Error('没有读到带时间的字幕，请选择 SRT 或 WebVTT 文件。');
  return cues.sort((a,b)=>a.start-b.start||a.end-b.end);
}
export function transcriptForRange(cues,start,end) {
  const range=validateClipRange(start,end);
  return cues.filter(cue=>cue.start<range.end&&cue.end>range.start).map(cue=>cue.text).join('\n');
}
// Reuse the byte-based digest used by transcription. Names, dates and card IDs
// are not audio versions, and the digest never embeds a second copy of a file.
export async function podcastAudioSha256(attachment) {
  if(!attachment||fileTypeFor(attachment)?.kind!=='audio')throw Error('请先选择可核验的音频附件。');
  return (await fingerprintWorkspaceAttachment(attachment)).sha256;
}
export function buildPodcastClip({title='',note='',sourceCard,attachment,start,end,duration,cues=[],sourceUrl='',sourceAudioSha256=''}={}) {
  const file=attachment||sourceCard?.attachment;
  if(!file||fileTypeFor(file)?.kind!=='audio')throw Error('请先选择本机音频或资料库中的音频附件。');
  normalizeWorkspaceAttachment(file);
  const range=validateClipRange(start,end,duration),location=`${formatClipTime(range.start)}–${formatClipTime(range.end)}`;
  const transcript=transcriptForRange(cues,range.start,range.end);
  if(transcript.length>99000)throw Error('所选字幕过长，请缩短片段。');
  if(typeof note!=='string'||note.length>50000)throw Error('片段备注不能超过 50000 字。');
  if(sourceUrl&&!safeSourceUrl(sourceUrl))throw Error('来源链接应为有效的 http 或 https 地址。');
  if(sourceAudioSha256&&!/^[a-f\d]{64}$/i.test(sourceAudioSha256))throw Error('音频来源指纹无效，请重新核对原文件。');
  const sourceTitle=sourceCard?.title||file.name;
  const suffix=` · ${location}`,truncate=(text,limit)=>text.slice(0,limit).replace(/[\uD800-\uDBFF]$/,'');
  return {title:truncate(String(title).trim(),1000)||`${truncate(sourceTitle,1000-suffix.length)}${suffix}`,type:'audio',body:transcript||`音频片段 · ${location}`,caption:note,
    sourceTitle,sourceUrl:safeSourceUrl(sourceUrl||sourceCard?.sourceUrl||''),sourceLocation:`音频片段 ${location}`,
    ...(sourceCard?.id?{sourceCardId:sourceCard.id}:{attachment:file}),
    ...(sourceAudioSha256?{sourceAudioSha256:sourceAudioSha256.toLowerCase()}:{}),
    tags:['播客片段'],collectionIds:[],favorite:false,private:false};
}
