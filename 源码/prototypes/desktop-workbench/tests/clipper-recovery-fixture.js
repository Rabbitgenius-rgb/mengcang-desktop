import html from '../../../browser-extension/popup.html?raw';
import '../../../browser-extension/popup.css';

// The actual popup and background modules run against this explicitly synthetic
// Chrome adapter. No native connection, desktop library, or browser settings.
document.body.innerHTML=new DOMParser().parseFromString(html,'text/html').body.innerHTML;
const banner=document.createElement('aside');banner.style='position:fixed;left:420px;top:25px;width:350px;padding:20px;border:1px solid #ccd9c2;border-radius:12px;background:#f2f6ec;font:14px/1.8 system-ui';
banner.innerHTML='<strong>扩展恢复流程 · 隔离验收</strong><p>运行真实 popup / background 源码。收藏集、失效任务与连接均为合成数据，不连接梦藏正式资料库。</p><output aria-label="隔离任务统计"></output>';
document.body.append(banner);
const count=banner.querySelector('output'),extension='ebdbkhhcgifolblbcpkpgibjbighfhgi',handlers={},sourceUrl='https://example.com/qa-recovery';
const collections=Array.from({length:61},(_,i)=>({id:i===0?'browser-clips-v1':`qa-collection-${i}`,title:i===0?'浏览器剪藏':`合成收藏集 ${i}`,private:true}));
const storage={mengcangClipperPreferencesV2:{note:'',favorite:false,collectionIds:['qa-deleted','qa-collection-60'],sourceUrl},mengcangClipperJobsV1:Array.from({length:12},(_,i)=>({params:{version:1,kind:'link',sourceUrl,title:`合成失效任务 ${i+1}`,body:'合成内容',requestId:crypto.randomUUID()},createdAt:new Date(2026,10,1,0,i).toISOString(),status:'failed',error:'合成永久失效任务，仅供恢复流程验收'}))};
function stats(){const jobs=storage.mengcangClipperJobsV1||[];count.textContent=`未完成：${jobs.filter(j=>j.status!=='saved').length}，已保存：${jobs.filter(j=>j.status==='saved').length}`;}
const event=name=>({addListener:callback=>handlers[name]=callback});
const tab={id:7,url:sourceUrl,title:'合成恢复流程网页'};
globalThis.chrome={
 runtime:{id:extension,getURL:p=>`chrome-extension://${extension}/${p}`,onInstalled:event('installed'),onMessage:event('message'),sendMessage:message=>new Promise(resolve=>{if(!handlers.message(message,{id:extension,url:`chrome-extension://${extension}/popup.html`},resolve))resolve({ok:false,error:'合成适配器没有接受请求'});}),sendNativeMessage:async(_host,request)=>{
  if(request.method==='status')return {ok:true,data:{ready:true}};
  if(request.method==='collections'){const {offset=0,limit=50}=request.params;return {ok:true,data:{items:collections.slice(offset,offset+limit),total:collections.length,nextOffset:offset+limit<collections.length?offset+limit:null}};}
  if(request.method==='highlights')return {ok:true,data:{items:[],nextOffset:null,total:0}};
  if(request.method==='capture'){
   if(request.params.collectionIds.includes('qa-deleted'))return {ok:false,error:{code:'CLIPPER_COLLECTION_NOT_FOUND',message:'所选收藏集已不存在，请重新选择后保存'}};
   return {ok:true,data:{revision:10,item:{id:request.params.requestId}}};
  }
  return {ok:false,error:{message:'隔离适配器不支持此操作'}};
 }},
 storage:{local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async values=>{Object.assign(storage,structuredClone(values));stats();}}},
 action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
 tabs:{query:async()=>[structuredClone(tab)],get:async()=>structuredClone(tab),sendMessage:async()=>({ok:true,data:{matched:0,total:0,missing:0,items:[]}})},
 scripting:{executeScript:async request=>request.files?[]:[{result:{version:1,kind:request.args[0],sourceUrl,title:tab.title,body:'明确标注的合成正文'}}],insertCSS:async()=>{},getRegisteredContentScripts:async()=>[],registerContentScripts:async()=>{},unregisterContentScripts:async()=>{}},
 permissions:{contains:async()=>false,remove:async()=>true,request:async()=>false,onRemoved:event('permissionRemoved')},
 contextMenus:{onClicked:event('context'),removeAll:async()=>{},create:()=>{}},
};
await import('../../../browser-extension/background.js');
await import('../../../browser-extension/popup.js');stats();
