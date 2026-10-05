// Only an explicit selection reaches this export. No live-library or file access.
import {MAX_OCR_TEXT} from './workspaceModel.js';
export const EXTERNAL_CONTEXT_FORMAT = 'mengcang-selected-context';
export const MAX_EXTERNAL_CONTEXT_BYTES = 8 * 1024 * 1024;
const string = (value, limit, label) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw Error(`${label}过长或格式无效，请缩小导出范围。`);
  return value;
};
const publicUrl = value => {
  try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';} catch {return '';}
};

/** Returns a JSON string, suitable for download and the read-only stdio server. */
export function buildExternalContextExport(cards,{title='已选资料',includeNotes=false,createdAt=new Date().toISOString()}={}) {
  if(!Array.isArray(cards)||cards.length<1||cards.length>2000)throw Error('请选择 1 至 2000 张卡片。');
  let bytes=0;
  const output={format:EXTERNAL_CONTEXT_FORMAT,version:1,title:string(title,1000,'资料包标题'),createdAt:string(createdAt,100,'导出时间'),access:'read-only',cards:cards.map((card,index)=>{const exported={
    // Export-local identifiers intentionally exclude original Vault paths and IDs.
    id:`card-${index+1}`,title:string(card.title,1000,'卡片标题'),body:string(card.body,100000,'卡片正文'),
    ...(includeNotes?{note:string(card.caption,50000,'我的备注')}:{}),
    sourceTitle:string(card.sourceTitle,1000,'来源标题'),sourceUrl:publicUrl(card.sourceUrl),author:string(card.author,1000,'作者'),
    type:string(card.type,100,'素材类型'),page:string(card.page==null?'':String(card.page),1000,'页码'),sourceLocation:string(card.sourceLocation,1000,'来源位置'),
    tags:Array.isArray(card.tags)?card.tags.slice(0,100).map(tag=>string(tag,120,'标签')):[],ocrText:string(card.ocrText,MAX_OCR_TEXT,'识别文字'),
  };bytes+=new TextEncoder().encode(JSON.stringify(exported)).length;if(bytes>MAX_EXTERNAL_CONTEXT_BYTES)throw Error('资料包超过 8 MiB，请分批选择卡片导出。');return exported;})};
  const json=JSON.stringify(output,null,2);
  if(new TextEncoder().encode(json).length>MAX_EXTERNAL_CONTEXT_BYTES)throw Error('资料包超过 8 MiB，请分批选择卡片导出。');
  return json;
}
