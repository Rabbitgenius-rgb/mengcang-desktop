'use strict';
const {captureClipperImage}=require('./clipper-image.cjs');
const MAX_ARTICLE_IMAGE_BYTES=20*1024*1024;

// Download only the images explicitly present in the captured inert article.
// Never fetch HTML, cookies, authenticated resources, SVG or iframe contents.
async function prepareArticleImages(article,{captureImage=captureClipperImage,now=Date.now,deadlineMs=55000,maxBytes=MAX_ARTICLE_IMAGE_BYTES}={}){
 const blocks=article.blocks.map(block=>({...block})),cache=new Map();
 let storedBytes=blocks.reduce((sum,block)=>sum+(block.type==='image'&&block.attachment?block.attachment.size:0),0);
 if(storedBytes>maxBytes)throw Object.assign(new Error('文章内嵌图片文件超过保存上限，请分开导入原图片。'),{code:'ARTICLE_IMAGE_TOO_LARGE'});
 const deadline=now()+deadlineMs;
 const missing=(block,message)=>{delete block.attachment;block.imageError=message;};
 // Sequential batches keep network work bounded. A single download already
 // has a 20-second deadline, DNS pinning, redirect validation and byte limits.
 for(let offset=0;offset<blocks.length;){
  const batch=[];
  while(offset<blocks.length&&batch.length<3){const block=blocks[offset++];if(block.type==='image')batch.push(block);}
  await Promise.all(batch.map(async block=>{
   if(block.attachment)return;
   if(!block.src){if(!block.imageError)block.imageError='此图片没有可直接下载的公开地址。';return;}
   if(now()>=deadline){missing(block,'本篇图片下载已达到等待时间，可在原网页单独保存这张图片。');return;}
   if(storedBytes>=maxBytes){missing(block,'本篇图片文件达到保存上限，可在原网页单独保存这张图片。');return;}
   try{
    if(!cache.has(block.src))cache.set(block.src,Promise.resolve().then(()=>captureImage(block.src)));
    const attachment=await cache.get(block.src);
    if(storedBytes+attachment.size>maxBytes){missing(block,'本篇图片文件达到保存上限，可在原网页单独保存这张图片。');return;}
    storedBytes+=attachment.size;block.attachment=attachment;delete block.imageError;
   }catch{missing(block,'原图片暂未取得，可能需要登录或网络不可用；可在原网页下载后导入。');}
  }));
 }
 return {version:1,blocks};
}
module.exports={prepareArticleImages,MAX_ARTICLE_IMAGE_BYTES};
