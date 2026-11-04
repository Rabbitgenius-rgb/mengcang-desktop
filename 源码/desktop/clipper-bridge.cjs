'use strict';
const {startPrivateServer}=require('../shared/private-rpc.cjs');
const {createRecallDispatcher}=require('./recall-bridge.cjs');
const {captureClipperImage}=require('./clipper-image.cjs');
const {prepareArticleImages}=require('./clipper-article.cjs');

async function startClipperBridge({directory,ipcMain,getWindow,getWorkspaceId,isQuitting,track=task=>task,startServer=startPrivateServer,captureImage=captureClipperImage}){
 const {normalizeClipperParams,normalizeClipperQuery}=await import('../src/clipper/contract.mjs');
 const dispatcher=createRecallDispatcher({getWindow,getWorkspaceId,isQuitting,eventType:'clipperRequest',timeoutMs:15000});
 const wrap=fn=>async(event,value)=>{try{return {ok:true,data:await fn(event,value)};}catch(error){return {ok:false,error:{code:error.code||'CLIPPER_FAILED',message:error.message}};}};
 ipcMain.handle('mengcang:clipperReady',wrap(dispatcher.ready));
 ipcMain.handle('mengcang:clipperResult',wrap(dispatcher.result));
 let server;
 try{
  server=await startServer({directory,service:'browser-clipper',socketTimeoutMs:125000,handlers:{
   status:async raw=>{if(raw&&Object.keys(raw).length)throw Error('连接状态请求无需参数');return dispatcher.status();},
   collections:async raw=>dispatcher.call('collections',normalizeClipperQuery('collections',raw)),
   highlights:async raw=>dispatcher.call('highlights',normalizeClipperQuery('highlights',raw)),
   related:async raw=>dispatcher.call('related',normalizeClipperQuery('related',raw)),
   openRelated:async raw=>{
     const result=await dispatcher.call('openRelated',normalizeClipperQuery('openRelated',raw));
     const win=getWindow();if(win&&!win.isDestroyed?.()){if(win.isMinimized?.())win.restore();win.show?.();win.focus?.();}
     return result;
   },
   capture:raw=>track((async()=>{
    let params=normalizeClipperParams(raw);
    if(!dispatcher.status().ready)throw Object.assign(Error('请先打开梦藏，并等待资料库加载完成。'),{code:'LIBRARY_NOT_READY'});
    // Only this narrow main-process download may fetch the explicitly selected
    // public image. The extension has no credentials or library file access.
    if((params.kind==='image'&&!params.attachment)||(params.kind==='article'&&params.article)){
     const prior=await dispatcher.call('lookup',params);
     if(prior.found)return prior;
    }
    if(params.kind==='image'&&!params.attachment){
     params={...params,attachment:await captureImage(params.imageUrl)};
    }
    if(params.kind==='article'&&params.article)params={...params,article:await prepareArticleImages(params.article,{captureImage})};
    params=normalizeClipperParams(params,{requireImageAttachment:true});
    return dispatcher.call('capture',params);
   })())
  }});
 }catch(error){dispatcher.close();ipcMain.removeHandler('mengcang:clipperReady');ipcMain.removeHandler('mengcang:clipperResult');throw error;}
 return {status:dispatcher.status,async close(){dispatcher.close();await server.close();ipcMain.removeHandler('mengcang:clipperReady');ipcMain.removeHandler('mengcang:clipperResult');}};
}
module.exports={startClipperBridge,captureClipperImage};
