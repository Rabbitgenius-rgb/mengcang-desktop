export const INSIGHT_LABELS={'The Gist':'核心概述','Explain Like I’m 5':'通俗解释','Contrarian Take':'反向观点','Analogy':'类比说明','Hot Take':'鲜明观点','Image description':'图片内容描述','Visual analysis':'构图与配色'};
export const IMAGE_INSIGHT_MODES=Object.freeze(['Image description','Visual analysis']);
export const MAX_VISION_IMAGE_BYTES=8*1024*1024;
const VISION_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/gif','image/webp']);
export function isImageReference(card){return card?.type==='image'||/^image\//i.test(card?.attachment?.type||'')||(card?.origin==='vault'&&/^image\//i.test(card?.originalMime||''));}
export function visionImagePayload(attachment){
 if(!attachment||typeof attachment!=='object')throw Error('请先导入图片原文件，再使用图片解读。');
 const {name,type,size,dataUrl}=attachment;
 if(typeof name!=='string'||!name.trim()||name.length>1000||/[\x00-\x1f\x7f]/.test(name))throw Error('图片文件名称无效，请重新导入原文件。');
 if(!VISION_IMAGE_TYPES.has(type)||/\.(?:svg|html?|xml|[cm]?js|exe|app|sh|command)$/i.test(name.trim()))throw Error('图片解读只支持 JPEG、PNG、GIF、WebP 原文件，请先转换或导入支持的格式。');
 if(typeof dataUrl!=='string'||dataUrl.length>Math.ceil(MAX_VISION_IMAGE_BYTES/3)*4+100)throw Error('图片解读单张上限为 8 MiB，请选择较小的原文件。');
 const match=/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
 if(!match||!match[2]||match[2].length%4||match[1]!==type)throw Error('请使用本机图片原文件；远程图片地址、缩略图和格式不匹配的数据不会发送。');
 const base64=match[2],bytes=base64.length/4*3-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);
 if(!Number.isSafeInteger(size)||size!==bytes||bytes<1||bytes>MAX_VISION_IMAGE_BYTES)throw Error('图片大小与原文件不一致，或超过 8 MiB，请重新导入。');
 let header;try{header=atob(base64.slice(0,88));}catch{throw Error('图片数据格式无效，请重新导入原文件。');}
 const signature=type==='image/png'?header.startsWith('\x89PNG\r\n\x1a\n'):type==='image/jpeg'?header.startsWith('\xFF\xD8\xFF'):type==='image/gif'?/^GIF8[79]a/.test(header):header.startsWith('RIFF')&&header.slice(8,12)==='WEBP';
 if(!signature)throw Error('图片内容与文件类型不一致，请重新导入原文件。');
 return {name,type,size,dataUrl};
}
export function sameImageReference(a,b){return !!a&&!!b&&['id','path','origin','updatedAt','originalPath','originalMime','type'].every(key=>a[key]===b[key])&&['name','type','size','dataUrl'].every(key=>a.attachment?.[key]===b.attachment?.[key]);}
export function formatImageBytes(size){return size<1024*1024?`${(size/1024).toFixed(1)} KiB`:`${(size/1024/1024).toFixed(2)} MiB`;}
export function intelligenceText(card){return [card?.title,card?.body,card?.ocrText,card?.documentIndex?.text].filter(Boolean).join('\n\n').slice(0,20000);}
export function cosineSimilarity(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length||a.some(x=>!Number.isFinite(x))||b.some(x=>!Number.isFinite(x)))return null;
 let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):null;
}
export function rankEmbeddings(embeddings,anchorId,{exclude=[],limit=30}={}){
 const anchor=embeddings.find(x=>x.id===anchorId);if(!anchor)return [];
 const blocked=new Set([anchorId,...exclude]);return embeddings.filter(x=>!blocked.has(x.id)&&x.model===anchor.model&&x.language===anchor.language).map(x=>({id:x.id,score:cosineSimilarity(anchor.vector,x.vector)})).filter(x=>x.score!==null).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}
export function extractDataPayload(card){
 const data=card?.attachment?.dataUrl||card?.image||'';const match=/^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(data);
 if(!match)throw Error('请先把图片或 PDF 原文件导入本机，再识别文字。');
 return {kind:match[1]==='application/pdf'?'pdf':'image',base64:match[2]};
}
export function generatedInsightCard(source,mode,result,{id,now}){
 if(!source||!result?.text?.trim())throw Error('没有可保存的解读内容');
 return {id,path:id,origin:'local',type:'text',title:`${INSIGHT_LABELS[mode]||'AI 解读'} · ${source.title||'未命名素材'}`.slice(0,1000),body:result.text,caption:'AI 生成，请结合原文核对。',sourceCardId:source.id,sourceTitle:source.title||'',sourceUrl:source.sourceUrl||'',tags:['AI 解读'],createdAt:now,updatedAt:now};
}
