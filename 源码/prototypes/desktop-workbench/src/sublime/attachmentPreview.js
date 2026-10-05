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
function inspectDocxArchive(arrayBuffer) {
  const bytes=new Uint8Array(arrayBuffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let directory=-1;
  for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--){if(view.getUint32(offset,true)===0x06054b50){directory=offset;break;}}
  if(directory<0)throw new Error('此 DOCX 文件无效或不受支持。');
  const count=view.getUint16(directory+10,true),length=view.getUint32(directory+12,true),start=view.getUint32(directory+16,true);
  if(count>4096||start+length!==directory||directory+22+view.getUint16(directory+20,true)!==bytes.length||view.getUint16(directory+8,true)!==count||view.getUint16(directory+4,true)||view.getUint16(directory+6,true))throw new Error('此 DOCX 文件过大，或使用了不支持的压缩格式。');
  const names=new Set(),files=[];let offset=start,expanded=0;
  for(let index=0;index<count;index++){
    if(offset+46>start+length||view.getUint32(offset,true)!==0x02014b50)throw new Error('此 DOCX 文件不完整。');
    const flags=view.getUint16(offset+8,true),size=view.getUint32(offset+24,true),nameSize=view.getUint16(offset+28,true),extraSize=view.getUint16(offset+30,true),commentSize=view.getUint16(offset+32,true);
    if(flags&1)throw new Error('暂不支持预览有密码保护的 DOCX 文件。');
    if(offset+46+nameSize+extraSize+commentSize>start+length)throw new Error('此 DOCX 文件不完整。');
    const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameSize));names.add(name);expanded+=size;
    files.push({name,size,compressedSize:view.getUint32(offset+20,true),method:view.getUint16(offset+10,true),localOffset:view.getUint32(offset+42,true)});
    // The 16 MiB check is only a legacy guard for this literal directory name.
    // Main-part aliases/relationships remain a separate limit-hardening task.
    if(expanded>MAX_WORD_PREVIEW_BYTES||(name==='word/document.xml'&&size>16*1024*1024))throw new Error('文档过大，无法显示文字预览，原文件仍保留。');
    offset+=46+nameSize+extraSize+commentSize;
  }
  if(offset!==start+length)throw Error('此 DOCX 文件目录项数量不一致，已停止预览。');
  if(!names.has('word/document.xml')||!names.has('[Content_Types].xml'))throw new Error('此文件不包含可读取的 Word 文档。');
  return {entries:count,expandedBytes:expanded,files,directoryStart:start};
}

export function inspectDocxPreviewArchive(arrayBuffer) {
  const {entries,expandedBytes}=inspectDocxArchive(arrayBuffer);
  return {entries,expandedBytes};
}

// ZIP directory lengths are attacker-controlled. Count actual output before
// giving the archive to a parser that otherwise buffers each inflated XML file.
export async function validateDocxPreviewExpansion(arrayBuffer) {
  const archive=inspectDocxArchive(arrayBuffer),bytes=new Uint8Array(arrayBuffer),view=new DataView(arrayBuffer);
  for(const file of archive.files){
    const offset=file.localOffset;
    if(offset+30>archive.directoryStart||view.getUint32(offset,true)!==0x04034b50)throw Error('此 DOCX 文件的压缩数据不完整。');
    const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true),end=start+file.compressedSize;
    if(flags&1||method!==file.method||end>archive.directoryStart||![0,8].includes(method))throw Error('此 DOCX 文件使用了不支持的压缩格式，原文件仍保留。');
    if(method===0){if(file.compressedSize!==file.size)throw Error('DOCX 实际解压大小与声明不一致，已停止预览。');continue;}
    let inflater;
    try{inflater=new DecompressionStream('deflate-raw');}
    catch{throw Error('当前环境不支持安全解压此 DOCX，原文件仍可下载。');}
    let position=start,actual=0,complete=false;
    // Small input chunks plus stream backpressure avoid submitting an entire
    // highly compressed member to the inflater before checking its output.
    const compressed=new ReadableStream({pull(controller){
      if(position>=end){controller.close();return;}
      const next=Math.min(position+1024,end);controller.enqueue(bytes.subarray(position,next));position=next;
    }});
    const reader=compressed.pipeThrough(inflater).getReader();
    try{
      while(true){const {value,done}=await reader.read();if(done){complete=true;break;}actual+=value.byteLength;if(actual>file.size)throw Error('DOCX 实际解压大小超过声明，已停止预览；原文件仍保留。');}
      if(actual!==file.size)throw Error('DOCX 实际解压大小与声明不一致，已停止预览。');
    }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  return {entries:archive.entries,expandedBytes:archive.expandedBytes};
}

export async function extractDocxPlainText(arrayBuffer) {
  await validateDocxPreviewExpansion(arrayBuffer);
  const imported=await import('mammoth/mammoth.browser.js'),mammoth=imported.default || imported;
  // extractRawText produces plain text; it never generates or inserts document HTML.
  const result=await mammoth.extractRawText({arrayBuffer});
  const original=String(result.value || '');
  return {text:original.slice(0,MAX_WORD_PREVIEW_CHARACTERS),truncated:original.length>MAX_WORD_PREVIEW_CHARACTERS,warnings:(result.messages || []).map(message=>String(message.message || '')).filter(Boolean).slice(0,5)};
}
