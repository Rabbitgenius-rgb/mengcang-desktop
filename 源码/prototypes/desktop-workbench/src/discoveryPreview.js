import {validateDiscoveryState} from './discoveryModel.js';
export const discoveryPreviewIdentity={id:'sublime-discovery-browser-preview',name:'隔离本地预览'};
export const discoverySeeds=[
 {id:'d-expression',path:'preview/expression',title:'表达的边界',type:'image',assetUrl:'/assets/inspiration-text-BCUMTc7F.avif',body:'关于语言、感受与表达的视觉参考。图片文字可由本机 OCR 读取。',caption:'Sublime 首页公开展示素材，作为复刻参考。',tags:['表达','文字'],sourceUrl:'https://sublime.app/',source:'https://sublime.app/'},
 {id:'d-nature',path:'preview/nature',title:'自然宣言',type:'image',assetUrl:'/assets/inspiration-article-DNTtDhJZ.avif',body:'The gardener nurtures flowers, waters seedlings, and tends the soil each morning.',caption:'用于语义检索验收的自建示例文字。图片为 Sublime 公开首页参考。',tags:['自然','植物'],sourceUrl:'https://sublime.app/',source:'https://sublime.app/'},
 {id:'d-screen',path:'preview/screen',title:'屏幕与影像',type:'image',assetUrl:'/assets/inspiration-image-DJx0yAgh.avif',body:'A visual installation arranges television sets and photographs into an intimate portrait.',caption:'图片拼贴与信息层次参考。',tags:['影像','装置'],sourceUrl:'https://sublime.app/',source:'https://sublime.app/'},
 {id:'d-conversation',path:'preview/conversation',title:'一次对话的可能',type:'web',assetUrl:'/assets/inspiration-website-DQCABkUC.avif',body:'An unhurried conversation leaves room for unexpected discoveries and new ideas.',caption:'网页卡片与阅读入口参考。',tags:['对话','阅读'],sourceUrl:'https://sublime.app/',source:'https://sublime.app/'},
 {id:'d-silence',path:'preview/silence',title:'沉默与留白',type:'image',assetUrl:'/assets/inspiration-highlight-CJ83Yr0g.avif',body:'留出安静的间隙，让思考与表达有发生的空间。',caption:'高亮摘录的视觉参考。',tags:['表达','安静'],sourceUrl:'https://sublime.app/',source:'https://sublime.app/'},
 {id:'d-sound',path:'preview/sound',title:'声音的形状',type:'image',assetUrl:'/assets/inspiration-audio-BQ4iBmk-.avif',body:'声音与图像共同构成感受，节奏可以成为空间的线索。',caption:'圆形封面参考；此卡不包含音频文件。',tags:['声音','影像'],sourceUrl:'https://sublime.app/',source:'https://sublime.app/'}
].map(item=>({...item,real:true,date:'2026-10-02',kind:item.type}));
const STATE_KEY='mengcang-sublime-discovery-preview-v1';
async function localAnalysis() { throw Object.assign(new Error('AI 暂未启用，不执行语义分析或 OCR。'),{code:'AI_DISABLED'}); }
export function makeDiscoveryPreview(getItems,setItems) {
 return {
  captureAvailable:true,
  async discoveryStateGet(){const raw=localStorage.getItem(STATE_KEY);return raw?JSON.parse(raw):null;},
  async discoveryStateSet(value){const check=validateDiscoveryState(value);if(!check.ok)throw Error(check.errors.join('\n'));localStorage.setItem(STATE_KEY,JSON.stringify(value));return {saved:true};},
  discoveryAnalyze:value=>localAnalysis({...value,command:'analyze'}),
  discoveryExtract:value=>localAnalysis({...value,command:'extract'}),
  async capture(value){
   if(!/^[a-f0-9-]{36}$/i.test(value.operationId || ''))throw Error('缺少稳定保存标识');
   if(typeof value.title!=='string'||!value.title.trim()||typeof value.body!=='string'||value.body.length>100000)throw Error('请填写标题和有效正文');
   if(value.sourceUrl){const url=new URL(value.sourceUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('出处链接无效');}
   const fingerprint=JSON.stringify(value),existing=getItems().find(item=>item.operationId===value.operationId);
   if(existing){if(existing.captureFingerprint!==fingerprint)throw Error('保存标识已用于不同内容，请核对草稿');return {note:existing,replayed:true,operationId:value.operationId};}
   const item={...value,id:`local-${value.operationId}`,path:`preview/capture-${value.operationId}`,type:value.imageData?'image':value.sourceUrl?'web':'text',assetUrl:value.imageData || '',real:true,date:new Date().toISOString().slice(0,10),source:value.sourceUrl || value.sourceTitle || '手动保存',captureFingerprint:fingerprint};
   const next=[item,...getItems()];
   // Write before acknowledging. Browser storage failures leave the capture draft intact.
   localStorage.setItem('mengcang-discovery-items-v1',JSON.stringify(next));setItems(next);
   return {note:item,operationId:value.operationId,replayed:false};
  }
 };
}
export function readDiscoveryItems(fallback=discoverySeeds){const raw=localStorage.getItem('mengcang-discovery-items-v1');if(!raw)return fallback;const items=JSON.parse(raw);if(!Array.isArray(items))throw Error('本机素材格式无效');return items;}
