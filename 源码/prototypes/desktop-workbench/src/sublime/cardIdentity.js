import {isLinkedNote} from './linkedNotes.js';

// Read-only labels derived from persisted card fields. No drafts, indexing or IO.
const hasText=value=>typeof value==='string'&&value.trim().length>0;
const cardKind=card=>card.origin==='vault'?'original':card.origin==='reference'?'reference':Array.isArray(card.tags)&&card.tags.includes('AI 解读')?'insight':card.type==='highlight'?'excerpt':hasText(card.sourceAudioSha256)?'audio-clip':isLinkedNote(card)?'linked-note':hasText(card.sourceCardId)?'copy':'local';
const savedTimeFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

// generatedInsightCard records createdAt from insightSaveActions' first savedAt.
// Other dates may be imported/source dates; never substitute them for save time.
function insightSavedTime(card){
 if(!card.id.startsWith('ai-insight:')||typeof card.createdAt!=='string')return '';
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(card.createdAt);
 if(!match)return '';
 const [,year,month,day,hour,minute,second,zone]=match;
 const values=[year,month,day,hour,minute,second].map(Number);
 const [y,m,d,h,min,s]=values;
 if(y<1000||m<1||m>12||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate()||h>23||min>59||s>59)return '';
 if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4,6))>59))return '';
 const timestamp=Date.parse(card.createdAt);
 if(!Number.isFinite(timestamp))return '';
 const parts=Object.fromEntries(savedTimeFormat.formatToParts(timestamp).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Build once from the complete visible library, before query/media filtering. */
export function createCardIdentityContext(cards=[]){
 const groups=new Map(),seen=new Set();
 for(const card of Array.isArray(cards)?cards:[]){
  if(!card||cardKind(card)!=='insight'||!hasText(card.id)||seen.has(card.id)||!hasText(card.title))continue;
  seen.add(card.id);
  const key=JSON.stringify([card.type||'text',card.title.trim()]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(card);
 }
 const insightDuplicates=new Map();
 for(const group of groups.values()){
  if(group.length<2)continue;
  const maxLength=Math.max(...group.map(card=>card.id.length));
  for(const card of group){
   let length=8;
   while(length<maxLength&&group.some(other=>other.id!==card.id&&other.id.slice(-length)===card.id.slice(-length)))length=Math.min(length+2,maxLength);
   const shortId=card.id.slice(-length),savedTime=insightSavedTime(card);
   const savedTimeLabel=savedTime?`保存 ${savedTime}（北京时间）`:'保存时间未记录';
   insightDuplicates.set(card.id,{shortId,savedTimeLabel,duplicateLabel:`${savedTimeLabel} · #${shortId}`});
  }
 }
 return {insightDuplicates};
}

export function cardIdentityMetadata(card={},context){
 const kind=cardKind(card);
 const originLabel={original:'原始资料',reference:'参考卡片',copy:'本机副本','linked-note':'关联笔记',local:'本机卡片',insight:'解读笔记',excerpt:'本机摘录','audio-clip':'音频片段'}[kind];
 const index=card.documentIndex;
 const ocrIndex=index?.source==='ocr';
 const pages=ocrIndex&&Array.isArray(index.pages)?index.pages:[];
 const hasRecognition=hasText(card.ocrText)||(ocrIndex&&(hasText(index.text)||pages.some(page=>hasText(page?.text))));
 const isPdf=typeof card.attachment?.type==='string'&&card.attachment.type.trim().toLowerCase()==='application/pdf';
 const totalPageCount=Number.isSafeInteger(index?.pageCount)&&index.pageCount>=0?index.pageCount:null;
 const pageNumbers=new Set(pages.filter(page=>hasText(page?.text)).map(page=>page?.page).filter(page=>Number.isSafeInteger(page)&&page>0&&(totalPageCount===null||page<=totalPageCount)));
 const recognizedPageCount=hasRecognition&&isPdf?pageNumbers.size:0;
 const partial=recognizedPageCount>0&&totalPageCount!==null&&totalPageCount>recognizedPageCount;
 const recognitionLabel=!hasRecognition?'':recognizedPageCount?`已识别 ${recognizedPageCount}${partial?` / ${index.pageCount}`:''} 页`:'已识别文字';
 const duplicate=kind==='insight'?context?.insightDuplicates?.get(card.id):null;
 return {kind,originLabel,recognitionLabel,recognizedPageCount,partial,shortId:duplicate?.shortId||'',savedTimeLabel:duplicate?.savedTimeLabel||'',duplicateLabel:duplicate?.duplicateLabel||'',accessibleLabel:[originLabel,recognitionLabel,duplicate?.duplicateLabel].filter(Boolean).join(' · ')};
}
