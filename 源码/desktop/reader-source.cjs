'use strict';
// Opaque, read-only capabilities for local book bytes. No renderer paths, HTTP
// endpoints, extraction, model calls, or generic filesystem access are exposed.
const fs=require('node:fs');
const {randomBytes,createHash}=require('node:crypto');
const MAX_SOURCES=64,MAX_AGE=12*60*60*1000,CHUNK_BYTES=256*1024;
const origin='mengcang://app';
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileVersion=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs??stat.mtimeMs,stat.ctimeNs??stat.ctimeMs].map(String);
const sameFile=(stat,source)=>stat.isFile()&&fingerprint(fileVersion(stat))===source.fileVersion;
function rangeOf(value,size){
 if(value===null||value===undefined||value==='')return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!match||(!match[1]&&!match[2]))return null;
 const number=value=>value.length<=16&&Number.isSafeInteger(Number(value))?Number(value):NaN;
 let start=match[1]?number(match[1]):0,end=match[2]?number(match[2]):size-1;
 if(!match[1]){if(!Number.isSafeInteger(end)||end<=0)return null;start=Math.max(0,size-end);end=size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
 return {start,end:Math.min(end,size-1),partial:true};
}
function denied(){const error=new Error('图书原件已更改或暂不可用，请返回资料卡重新打开');error.code='READER_SOURCE_UNAVAILABLE';throw error;}
function createReaderSources({gateway,isVisible=async()=>true,now=Date.now}){
 const sources=new Map(),active=new Set();let disposed=false;
 async function current(noteId){
  try{
   if(disposed)denied();
   const value=await gateway.readingFile(noteId);
   if(!await isVisible(value.note))denied();
   return value;
  }catch(error){if(['READER_FORMAT_UNSUPPORTED','READER_SOURCE_UNAVAILABLE'].includes(error.code))throw error;denied();}
 }
 async function issue(noteId){
  const source=await current(noteId);
  // A stale renderer load can finish after a newer load of this same book.
  // Keep independently issued tokens valid; otherwise that ignored late reply
  // could revoke the token currently being used by the visible reader.
  for(const [token,entry] of sources)if(now()-entry.createdAt>MAX_AGE)sources.delete(token);
  while(sources.size>=MAX_SOURCES)sources.delete(sources.keys().next().value);
  const token=randomBytes(32).toString('hex');sources.set(token,{noteId,sourceKey:source.sourceKey,noteVersion:source.noteVersion,createdAt:now()});
  return {url:`mengcang-reader://source/${token}`,name:source.name,type:source.type,size:source.size,sourceKey:source.sourceKey};
 }
 async function handle(request){
  let file;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':origin,'Access-Control-Expose-Headers':'Accept-Ranges, Content-Length, Content-Range, ETag','Cross-Origin-Resource-Policy':'cross-origin','Accept-Ranges':'bytes'};
  const errorResponse=(status=404,extra={})=>new Response(null,{status,headers:{...headers,...extra}});
  try{
   const url=new URL(request.url),requestOrigin=request.headers?.get?.('Origin');
   if(url.protocol!=='mengcang-reader:'||url.hostname!=='source'||url.port||url.username||url.password||url.search||url.hash||!/^\/[a-f0-9]{64}$/.test(url.pathname)||requestOrigin&&requestOrigin!==origin)return errorResponse();
   if(!['GET','HEAD'].includes(request.method))return errorResponse(405,{Allow:'GET, HEAD'});
   const token=url.pathname.slice(1),entry=sources.get(token);
   if(!entry||now()-entry.createdAt>MAX_AGE){sources.delete(token);return errorResponse();}
   const source=await current(entry.noteId);
   if(source.sourceKey!==entry.sourceKey||source.noteVersion!==entry.noteVersion){sources.delete(token);return errorResponse(409);}
   file=await fs.promises.open(source.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   if(!sameFile(await file.stat({bigint:true}),source))denied();
   // Resolve again after opening: no pathname or source-note substitution may
   // turn a previously issued token into access to different content.
   const confirmed=await current(entry.noteId);
   if(confirmed.sourceKey!==source.sourceKey||confirmed.noteVersion!==source.noteVersion)denied();
   const etag=`"${source.sourceKey}"`,ifRange=request.headers?.get?.('If-Range');
   const range=rangeOf(ifRange&&ifRange!==etag?null:request.headers?.get?.('Range'),source.size);
   if(!range){await file.close();file=null;return errorResponse(416,{'Content-Range':`bytes */${source.size}`});}
   const length=range.end-range.start+1;
   Object.assign(headers,{'Content-Type':source.type,'Content-Length':String(length),ETag:etag,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(source.name.replace(/[\x00-\x1f\x7f]/g,''))}`});
   if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${source.size}`;
   if(request.method==='HEAD'){await file.close();file=null;return new Response(null,{status:range.partial?206:200,headers});}
   const opened=file;file=null;let position=range.start,closed=false;
   const close=async()=>{if(closed)return;closed=true;active.delete(close);request.signal?.removeEventListener('abort',abort);await opened.close().catch(()=>{});};
   const abort=()=>{void close();};request.signal?.addEventListener('abort',abort,{once:true});
   active.add(close);
   const body=new ReadableStream({
    async pull(controller){
     try{
      if(disposed||closed||request.signal?.aborted){await close();controller.error(new Error('图书读取已取消'));return;}
      if(!sameFile(await opened.stat({bigint:true}),source))denied();
      const buffer=Buffer.allocUnsafe(Math.min(CHUNK_BYTES,range.end-position+1));
      const {bytesRead}=await opened.read(buffer,0,buffer.length,position);
      if(!bytesRead||!sameFile(await opened.stat({bigint:true}),source))denied();position+=bytesRead;controller.enqueue(new Uint8Array(buffer.buffer,buffer.byteOffset,bytesRead));
      if(position>range.end){await close();controller.close();}
     }catch(error){await close();controller.error(new Error('图书原件在读取时发生变化，请重新打开'));}
    },
    cancel:close,
   });
   return new Response(body,{status:range.partial?206:200,headers});
  }catch{return errorResponse();}finally{await file?.close().catch(()=>{});}
 }
 return {issue,handle,dispose(){disposed=true;sources.clear();for(const close of active)void close();}};
}
module.exports={createReaderSources,fileVersion,fingerprint,rangeOf};
