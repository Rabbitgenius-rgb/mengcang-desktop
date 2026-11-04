'use strict';
const http=require('node:http'),https=require('node:https'),dns=require('node:dns').promises,zlib=require('node:zlib');
const {validatePublicUrl,resolvePublic}=require('./web-capture.cjs');
const {publicDnsLookup}=require('./public-dns.cjs');
const {normalizeWorkspaceAttachment}=require('./attachment-validation.cjs');
const MAX_IMAGE_BYTES=10*1024*1024;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const types={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif'};

function requestImage(url,addresses,{signal,maxBytes=MAX_IMAGE_BYTES}){
 return new Promise((resolve,reject)=>{
  let settled=false;const done=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};
  const request=(url.protocol==='https:'?https:http).request(url,{method:'GET',agent:false,signal,maxHeaderSize:16384,
   headers:{Accept:Object.keys(types).join(', '),'Accept-Encoding':'gzip, deflate, br','User-Agent':'Mengcang-Clipper/1.0'},
   lookup(_host,options,callback){const address=addresses[0];options.all?callback(null,[address]):callback(null,address.address,address.family);}
  },response=>{
   const status=response.statusCode||0;
   if([301,302,303,307,308].includes(status)){const location=response.headers.location;response.destroy();done(null,{status,location});return;}
   const contentType=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
   if(status<200||status>=300){response.destroy();done(fail('IMAGE_HTTP_STATUS',`图片返回 HTTP ${status}，请下载原图后在梦藏导入。`));return;}
   if(!types[contentType]){response.destroy();done(fail('IMAGE_TYPE','支持 PNG、JPEG、GIF、WebP 和 AVIF 原图；该地址没有返回受支持的图片。'));return;}
   if(Number(response.headers['content-length'])>maxBytes){response.destroy();done(fail('IMAGE_TOO_LARGE','图片超过 10 MiB，请下载原图后在梦藏导入。'));return;}
   const encoding=String(response.headers['content-encoding']||'identity').toLowerCase();
   const decoder=encoding==='gzip'?zlib.createGunzip():encoding==='deflate'?zlib.createInflate():encoding==='br'?zlib.createBrotliDecompress():null;
   if(!decoder&&encoding!=='identity'){response.destroy();done(fail('IMAGE_ENCODING','图片压缩格式不支持。'));return;}
   let bytes=0,wire=0;const chunks=[];
   const stop=error=>{decoder?.destroy();response.destroy();request.destroy();done(error);};
   response.on('data',chunk=>{wire+=chunk.length;if(wire>maxBytes)stop(fail('IMAGE_TOO_LARGE','图片传输超过 10 MiB。'));});
   const input=decoder?response.pipe(decoder):response;
   input.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)stop(fail('IMAGE_TOO_LARGE','图片解压后超过 10 MiB。'));else chunks.push(chunk);});
   input.on('error',()=>stop(fail('IMAGE_INCOMPLETE','图片传输不完整，请重试。')));
   response.on('aborted',()=>stop(fail('IMAGE_INCOMPLETE','图片传输中断，请重试。')));
   response.on('error',()=>stop(fail('IMAGE_INCOMPLETE','图片传输不完整，请重试。')));
   input.on('end',()=>done(null,{status,contentType,bytes:Buffer.concat(chunks)}));
  });
  request.on('error',()=>done(signal.aborted?signal.reason:fail('IMAGE_NETWORK','图片下载失败。需要登录或防盗链的图片，请下载后在梦藏导入。')));request.end();
 });
}

function createImageCapture({lookup=dns.lookup.bind(dns),trustedLookup=publicDnsLookup,request=requestImage,timeoutMs=20000}={}){
 return async input=>{
  let url=validatePublicUrl(input);const controller=new AbortController(),{signal}=controller;
  const timer=setTimeout(()=>controller.abort(fail('IMAGE_TIMEOUT','图片下载超时，请重试。')),timeoutMs);
  try{
   for(let hop=0;hop<5;hop++){
    const addresses=await resolvePublic(url,lookup,signal,trustedLookup),result=await request(url,addresses,{signal,maxBytes:MAX_IMAGE_BYTES});
    if([301,302,303,307,308].includes(result.status)){
     if(!result.location||hop===4)throw fail('IMAGE_REDIRECT','图片重定向次数过多。');
     url=validatePublicUrl(new URL(result.location,url).href);continue;
    }
    if(!types[result.contentType]||!Buffer.isBuffer(result.bytes)||!result.bytes.length||result.bytes.length>MAX_IMAGE_BYTES)throw fail('IMAGE_INVALID','图片格式或大小无效。');
    let name;try{name=decodeURIComponent(url.pathname.split('/').pop()||'image');}catch{name='image';}
    name=name.replace(/\.[^.]*$/,'').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,100).replace(/[\uD800-\uDBFF]$/,'')||'image';
    return normalizeWorkspaceAttachment({name:name+types[result.contentType],type:result.contentType,size:result.bytes.length,dataUrl:`data:${result.contentType};base64,${result.bytes.toString('base64')}`});
   }
  }finally{clearTimeout(timer);}
 };
}
module.exports={captureClipperImage:createImageCapture(),createImageCapture,requestImage,MAX_IMAGE_BYTES};
