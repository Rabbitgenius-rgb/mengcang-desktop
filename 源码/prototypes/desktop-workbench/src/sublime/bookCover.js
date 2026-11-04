import {attachmentBytes,fileTypeFor} from './attachmentPreview.js';
import {openEpub,rasterDimensions,rasterMime} from '../reader/epubReaderModel.js';
import {pdfDocumentOptions} from './pdfPreview.js';

export function coverSize(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>16000||height>16000||width*height>40000000)throw Error('封面图片尺寸无效或过大。');
 const scale=Math.min(1,600/width,900/height);
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export async function imageBookCover(blob){
 if(blob.size<1||blob.size>8*1024*1024)throw Error('请选择不超过 8 MB 的封面图片。');
 const bytes=new Uint8Array(await blob.arrayBuffer()),type=rasterMime(bytes),size=type&&rasterDimensions(bytes,type);
 if(!size)throw Error('封面支持 PNG、JPEG、WebP 或 GIF 图片。');
 const dimensions=coverSize(size.width,size.height);let image;
 try{image=await createImageBitmap(new Blob([bytes],{type}));}catch{throw Error('无法解码封面图片，请换一张图片；原书仍保留。');}
 try{const canvas=document.createElement('canvas');Object.assign(canvas,dimensions);const context=canvas.getContext('2d');if(!context)throw Error('无法生成封面预览。');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.86);}finally{image.close();}
}
export async function openBookCover(attachment,{signal}={}){
 const kind=fileTypeFor(attachment)?.kind,bytes=attachmentBytes(attachment);
 if(signal?.aborted)throw new DOMException('已取消。','AbortError');
 if(kind==='epub'){
  const book=await openEpub(bytes,{signal});
  return {pages:0,async render(){const blob=book.coverPath?await book.image(book.coverPath):null;return blob?imageBookCover(blob):'';},close(){}};
 }
 if(kind!=='pdf')throw Error('仅 PDF 和 EPUB 可以提取图书封面。');
 const [{getDocument,GlobalWorkerOptions},{default:workerUrl}]=await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
 GlobalWorkerOptions.workerSrc=workerUrl;
 const task=getDocument(pdfDocumentOptions(bytes,import.meta.env.BASE_URL+'pdf-assets/')),renders=new Set();let closed=false;
 const close=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',close);for(const render of renders)render.cancel();void task.destroy().catch(()=>{});};
 signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();
 try{const pdf=await task.promise;return {pages:pdf.numPages,close,async render(number=1){
  if(closed)throw new DOMException('已取消。','AbortError');
  if(!Number.isInteger(number)||number<1||number>pdf.numPages)throw Error(`请选择 1–${pdf.numPages} 页。`);
  const page=await pdf.getPage(number);if(closed)throw new DOMException('已取消。','AbortError');
  const base=page.getViewport({scale:1}),size=coverSize(base.width,base.height),viewport=page.getViewport({scale:Math.min(size.width/base.width,size.height/base.height)}),canvas=document.createElement('canvas');Object.assign(canvas,size);
  const render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#fff'});renders.add(render);
  try{await render.promise;if(closed)throw new DOMException('已取消。','AbortError');return canvas.toDataURL('image/jpeg',.86);}finally{renders.delete(render);page.cleanup();}
 }};}catch(error){close();throw error;}
}
export async function defaultBookCover(attachment,options){const book=await openBookCover(attachment,options);try{return await book.render(1);}finally{book.close();}}

// Merge into the latest saved card, never an old modal snapshot. A replaced
// original or another window's changed cover must not be overwritten.
export function applyBookCover(current,expected,image){
 if(!current||current.origin==='vault'||current.type!=='book'||current.attachment?.dataUrl!==expected.attachment?.dataUrl||current.attachment?.name!==expected.attachment?.name||current.attachment?.type!==expected.attachment?.type||current.attachment?.size!==expected.attachment?.size||String(current.image||'')!==String(expected.image||''))throw Error('图书或封面已变化，请重新打开后设置封面。');
 if(image&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image))throw Error('封面图片无效。');
 return {...current,image,updatedAt:new Date().toISOString()};
}
