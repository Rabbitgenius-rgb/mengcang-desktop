import {MAX_ATTACHMENT_BYTES, WORKSPACE_FILE_TYPES,normalizeWorkspaceAttachment} from './workspaceModel.js';

export const MAX_WORD_PREVIEW_BYTES=64*1024*1024;
export const MAX_WORD_PREVIEW_CHARACTERS=200000;

export function fileTypeFor(file) {
  const declared=String(file?.type || '').toLowerCase(),name=String(file?.name || '').toLowerCase();
  const byMime=WORKSPACE_FILE_TYPES.find(entry=>entry.mime===declared);
  if(byMime)return {...byMime,type:declared};
  // Browsers often omit Office/HEIC MIME information. Only a known extension is inferred.
  if(declared&&declared!=='application/octet-stream')return null;
  const inferred=WORKSPACE_FILE_TYPES.find(entry=>entry.extensions.some(extension=>name.endsWith(extension)));
  return inferred?{...inferred,type:inferred.mime}:null;
}

export function attachmentKind(attachment) {return fileTypeFor(attachment)?.kind || 'unsupported';}
export const attachmentAccept=()=>[...new Set(WORKSPACE_FILE_TYPES.flatMap(entry=>[entry.mime,...entry.extensions]))].join(',');

export function attachmentBytes(attachment) {
  normalizeWorkspaceAttachment(attachment);
  const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(String(attachment?.dataUrl || ''));
  if(!match||!match[2]||match[2].length%4)throw new Error('无法读取原附件。');
  const count=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
  if(count<1||count>MAX_ATTACHMENT_BYTES||count!==attachment.size)throw new Error('附件大小与原始内容不匹配。');
  const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

// Bound decompression before handing a DOCX to Mammoth. A large file can still be
// retained and downloaded even when its text preview is too large to render.
export function inspectDocxPreviewArchive(arrayBuffer) {
  const bytes=new Uint8Array(arrayBuffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let directory=-1;
  for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--){if(view.getUint32(offset,true)===0x06054b50){directory=offset;break;}}
  if(directory<0)throw new Error('此 DOCX 文件无效或不受支持。');
  const count=view.getUint16(directory+10,true),length=view.getUint32(directory+12,true),start=view.getUint32(directory+16,true);
  if(count>4096||start+length>directory||view.getUint16(directory+4,true)||view.getUint16(directory+6,true))throw new Error('此 DOCX 文件过大，或使用了不支持的压缩格式。');
  const names=new Set();let offset=start,expanded=0;
  for(let index=0;index<count;index++){
    if(offset+46>start+length||view.getUint32(offset,true)!==0x02014b50)throw new Error('此 DOCX 文件不完整。');
    const flags=view.getUint16(offset+8,true),size=view.getUint32(offset+24,true),nameSize=view.getUint16(offset+28,true),extraSize=view.getUint16(offset+30,true),commentSize=view.getUint16(offset+32,true);
    if(flags&1)throw new Error('暂不支持预览有密码保护的 DOCX 文件。');
    if(offset+46+nameSize+extraSize+commentSize>start+length)throw new Error('此 DOCX 文件不完整。');
    const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameSize));names.add(name);expanded+=size;
    if(expanded>MAX_WORD_PREVIEW_BYTES||(name==='word/document.xml'&&size>16*1024*1024))throw new Error('文档过大，无法显示文字预览，原文件仍保留。');
    offset+=46+nameSize+extraSize+commentSize;
  }
  if(!names.has('word/document.xml')||!names.has('[Content_Types].xml'))throw new Error('此文件不包含可读取的 Word 文档。');
  return {entries:count,expandedBytes:expanded};
}

export async function extractDocxPlainText(arrayBuffer) {
  inspectDocxPreviewArchive(arrayBuffer);
  const imported=await import('mammoth/mammoth.browser.js'),mammoth=imported.default || imported;
  // extractRawText produces plain text; it never generates or inserts document HTML.
  const result=await mammoth.extractRawText({arrayBuffer});
  const original=String(result.value || '');
  return {text:original.slice(0,MAX_WORD_PREVIEW_CHARACTERS),truncated:original.length>MAX_WORD_PREVIEW_CHARACTERS,warnings:(result.messages || []).map(message=>String(message.message || '')).filter(Boolean).slice(0,5)};
}
