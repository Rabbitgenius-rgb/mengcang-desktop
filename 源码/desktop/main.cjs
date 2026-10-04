'use strict';
const {app,BrowserWindow,ipcMain,protocol,dialog,shell,Menu,powerMonitor,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {LocalVaultGateway}=require('./local-gateway.cjs');
const {rejectAiRequest}=require('./ai-policy.cjs');
const {trackWorkspaceDownloads}=require('./download-lifecycle.cjs');
const {createRendererQuitGate}=require('./renderer-quit.cjs');
const {PRODUCTION_VAULT,relative,bundleFile,trustedFrame,draftName,jsonValue,captureJson,atomicPrivate,createPrivateWriteQueue,fail}=require('./security.cjs');
// Candidate builds supply a fixed, isolated configuration. Production never reads credentials.
let config={};try{config=require('./candidate-config.json');}catch{}
app.setName(config.name||'梦藏');
protocol.registerSchemesAsPrivileged(['mengcang','mengcang-asset'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}})));
if(!app.requestSingleInstanceLock()){app.quit();}else{
let win,gateway,quitDrained=false,quitTask=null,ready=false;
const writes=createPrivateWriteQueue(),pending=new Set(),userData=app.getPath('userData');
const vaultPath=config.vaultPath||PRODUCTION_VAULT,bundleRoot=path.join(__dirname,'renderer');
const smokeTest=app.commandLine.hasSwitch('smoke-test');let smokeTimeout;
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' mengcang-asset: data: blob:; font-src 'self'; connect-src 'self' mengcang-asset:; media-src blob:; object-src blob:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-src 'none'";
const errorOf=error=>({code:error?.code||'REQUEST_FAILED',message:error?.message||'操作未完成，草稿已保留'});
const emit=(type,data)=>{if(win&&!win.isDestroyed())win.webContents.send('mengcang:event',{type,...(type==='status'?{status:data}:data)});};
const rendererQuit=createRendererQuitGate({send:quitId=>{if(!win||win.isDestroyed())return false;emit('prepareQuit',{quitId});return true;}});
const external=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
async function readPrivate(file,fallback){try{return JSON.parse(await fs.promises.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function handle(name,handler){ipcMain.handle(`mengcang:${name}`,async(event,...args)=>{
 if(!trustedFrame(event))return {ok:false,error:{code:'FORBIDDEN',message:'此页面无权调用梦藏接口'}};
 let task;try{task=Promise.resolve().then(()=>handler(...args));if(['capture','discoveryStateSet','draftSet','preferencesSet','intelligenceConfigure','intelligenceSetKey','intelligenceRequest'].includes(name))pending.add(task);return {ok:true,data:await task};}catch(error){return {ok:false,error:errorOf(error)};}finally{pending.delete(task);}
});}
function requestQuit(){
 if(quitTask)return quitTask;
 quitTask=(async()=>{
  await Promise.allSettled([...pending]);
  const rendererSaved=await rendererQuit.wait();
  if(!rendererSaved.ok){await dialog.showMessageBox(win,{type:'warning',title:'草稿尚未保存',message:'保存完成前保留梦藏窗口',detail:rendererSaved.message,buttons:['返回梦藏'],defaultId:0,cancelId:0});return;}
  await writes.drain();
  if(writes.failed){const result=await dialog.showMessageBox(win,{type:'warning',buttons:['返回梦藏','重试保存并退出'],defaultId:0,cancelId:0,title:'草稿尚未保存',message:'本机草稿未能完成保存',detail:'窗口和输入仍然保留，可以检查磁盘空间后重试。'});if(result.response!==1)return;await writes.retryFailures();if(writes.failed)return;}
  quitDrained=true;gateway?.dispose();app.quit();
 })().finally(()=>{quitTask=null;});return quitTask;
}
function reveal(window=win){if(!smokeTest&&window&&window===win&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}}
async function createWindow(){
 if(win&&!win.isDestroyed()){reveal();return;}
 win=new BrowserWindow({width:1440,height:940,minWidth:800,minHeight:600,title:'梦藏',backgroundColor:'#111111',show:false,titleBarStyle:'hiddenInset',trafficLightPosition:{x:17,y:14},webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
 const window=win;
 trackWorkspaceDownloads(window.webContents.session,window.webContents,emit,name=>dialog.showSaveDialogSync(window,{title:'保存文件',defaultPath:path.join(app.getPath('downloads'),path.basename(name||'梦藏导出文件')),buttonLabel:'保存'}));
 window.webContents.setWindowOpenHandler(({url})=>{const href=external(url);if(href)void shell.openExternal(href);return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('mengcang://app/')){event.preventDefault();const href=external(url);if(href)void shell.openExternal(href);}});
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));window.webContents.session.setPermissionCheckHandler(()=>false);
 window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{const url=new URL(details.url);allowed=['mengcang:','mengcang-asset:','devtools:'].includes(url.protocol)||(url.protocol==='blob:'&&url.pathname.startsWith('mengcang://app/'));}catch{}callback({cancel:!allowed});});
 window.on('close',event=>{if(!quitDrained){event.preventDefault();void requestQuit();}});window.on('closed',()=>{rendererQuit.cancel();if(win===window)win=null;});
 let initiallyRevealed=false;const revealInitial=()=>{if(initiallyRevealed||win!==window||window.isDestroyed())return;initiallyRevealed=true;reveal(window);};
 window.once('ready-to-show',revealInitial);await window.loadURL('mengcang://app/');revealInitial();
}
app.whenReady().then(async()=>{
 await fs.promises.mkdir(userData,{recursive:true,mode:0o700});gateway=new LocalVaultGateway({vaultPath,cachePath:path.join(userData,'vault-cache.json')});
 gateway.on('status',state=>emit('status',state));gateway.on('change',data=>emit('change',data));
 protocol.handle('mengcang',async request=>{try{const file=bundleFile(bundleRoot,request.url);return new Response(await fs.promises.readFile(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}});}catch{return new Response('页面不存在',{status:404});}});
 protocol.handle('mengcang-asset',async request=>{try{const url=new URL(request.url);if(url.hostname!=='vault')throw Error();const file=await gateway.attachment(relative(url.searchParams.get('path')));return new Response(file.data,{headers:{'Content-Type':file.contentType,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'mengcang://app'}});}catch{return new Response('附件不可用',{status:404});}});
 handle('status',()=>gateway.status());handle('snapshot',()=>gateway.snapshot());handle('readNote',value=>gateway.readNote(relative(value)));handle('readAttachment',value=>gateway.readAttachment(relative(value)));
 handle('capture',value=>{captureJson(value);return gateway.capture(value);});
 handle('discoveryAnalyze',()=>rejectAiRequest());
 handle('discoveryExtract',()=>rejectAiRequest());
 await require('./intelligence-bridge.cjs').registerIntelligence({handle,userData,safeStorage,dialog,getWindow:()=>win,writes});
 handle('rendererQuitReady',value=>rendererQuit.ack(value));
 handle('captureFeed',url=>require('./feed-capture.cjs').captureFeed(url));
 handle('webCapture',url=>require('./web-capture.cjs').captureWebPage(url));handle('nativeFilePreview',value=>require('./native-file-preview.cjs').previewNativeAttachment(value));
 const discoveryFile=id=>{if(id!==gateway.identity.id)fail('工作区身份已变化，旧数据保持原样','VAULT_MISMATCH');return path.join(userData,'discovery',draftName(id));};
 handle('discoveryStateGet',id=>{const file=discoveryFile(id);return writes.read(file,()=>readPrivate(file,null));});
 handle('discoveryStateSet',(value,id)=>{const file=discoveryFile(id);if(value?.schema!==1||!Array.isArray(value.collections)||!Array.isArray(value.boards))fail('收藏与画布格式无效');return writes.run(file,async()=>{await atomicPrivate(file,jsonValue(value));return {saved:true};});});
 handle('openOriginal',async value=>{const original=await gateway.original(relative(value));if(original.kind==='url'){const href=external(original.url);if(!href)fail('来源链接无效');await shell.openExternal(href);}else{const error=await shell.openPath(original.path);if(error)fail('原文件未能打开');}return {opened:true};});
 handle('draftGet',key=>{const file=path.join(userData,'drafts',draftName(key));return writes.read(file,()=>readPrivate(file,null));});
 handle('draftSet',(key,value)=>{const file=path.join(userData,'drafts',draftName(key));return writes.run(file,async()=>{if(value===null)await fs.promises.rm(file,{force:true});else await atomicPrivate(file,jsonValue(value));return {saved:true};});});
 const preferences=path.join(userData,'preferences.json');handle('preferencesGet',()=>writes.read(preferences,()=>readPrivate(preferences,{})));
 handle('preferencesSet',value=>writes.run(preferences,async()=>{const next=await readPrivate(preferences,{});if(typeof value?.reducedMotion==='boolean')next.reducedMotion=value.reducedMotion;await atomicPrivate(preferences,jsonValue(next));return next;}));
 handle('rendererReady',()=>{if(smokeTest){clearTimeout(smokeTimeout);console.log(JSON.stringify({smoke:'passed',renderer:'standalone-sublime',pluginRequired:false,ai:'paused'}));setTimeout(()=>app.quit(),100);}return true;});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'梦藏',submenu:[{role:'about',label:'关于梦藏'},{type:'separator'},{role:'hide',label:'隐藏梦藏'},{role:'hideOthers',label:'隐藏其他应用'},{role:'unhide',label:'显示全部'},{type:'separator'},{role:'quit',label:'退出梦藏'}]},{label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},{label:'窗口',submenu:[{role:'minimize',label:'最小化'},{role:'zoom',label:'缩放'},{role:'front',label:'全部置于最前'}]}]));
 powerMonitor.on('resume',()=>gateway.connect());if(smokeTest)smokeTimeout=setTimeout(()=>{console.error('Standalone workspace startup timed out');app.exit(1);},20000);
 ready=true;await createWindow();
}).catch(error=>{dialog.showErrorBox('梦藏未能启动',errorOf(error).message);quitDrained=true;gateway?.dispose();app.quit();});
app.on('second-instance',()=>{if(ready)void createWindow();});app.on('activate',()=>{if(ready&&!quitDrained)void createWindow();});app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(!quitDrained){event.preventDefault();void requestQuit();}});
}
