'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {atomicPrivate,jsonValue}=require('./security.cjs');
const {createIntelligenceService}=require('./intelligence.cjs');

function defaultTranscriptionRuntimeDir(){
 if(process.resourcesPath&&!process.defaultApp)return path.join(process.resourcesPath,'local-transcription');
 const desktop=path.basename(__dirname)==='app'&&path.basename(path.dirname(__dirname))==='build'?path.resolve(__dirname,'../..'):__dirname;
 return path.join(desktop,'local-transcription');
}
async function registerIntelligence({handle,userData,safeStorage,dialog,getWindow,writes,serviceFactory=createIntelligenceService,localTranscriptionRuntimeDir=defaultTranscriptionRuntimeDir()}){
 const settingsFile=path.join(userData,'intelligence-settings.json'),keyFile=path.join(userData,'intelligence-key.json');
 const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const initialSettings=await read(settingsFile,{});
 let service,configurationSaving=false;
 const requireStableConfiguration=()=>{if(configurationSaving)throw Object.assign(Error('AI 连接设置仍在保存，请稍后重试；未开始新的调用或密钥保存。'),{code:'INTELLIGENCE_BUSY'});};
 const encrypted=()=>{if(!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，密钥未保存；请使用 CLI 或恢复系统钥匙串后重试。');};
 service=serviceFactory({initialSettings,localTranscriptionRuntimeDir,
  getApiKey:async()=>{const value=await writes.read(keyFile,()=>read(keyFile,null));if(!value)return '';encrypted();if(value.endpoint!==service.status().settings.endpoint)throw Error('API 地址已改变，请为当前地址重新保存密钥。');return safeStorage.decryptString(Buffer.from(value.ciphertext,'base64'));},
  confirmRequest:async info=>{const window=getWindow();if(!window||window.isDestroyed())return false;
   if(info.provider==='local'&&info.action==='transcribe'){
    const result=await dialog.showMessageBox(window,{type:'question',title:'确认本机音频转录',message:'仅在本机处理，完成后退出并释放模型内存',detail:`模型：${info.model}\n音频：${info.filename||'所选文件'} · ${(Number(info.bytes||0)/1024/1024).toFixed(2)} MiB\n\n不上传音频、不调用云端、不消耗 API 额度。\n确认后临时启动音频转换与转录进程；成功或失败后都会退出并清理临时文件。\n本次处理完整音频，上限 64 MiB、两小时，最长等待 30 分钟。`,buttons:['取消','开始本机转录'],defaultId:0,cancelId:0,noLink:true});
    return result.response===1;
   }
   const target=info.provider==='cli'?`CLI：${info.cliProgram}`:`API：${info.endpoint}`;const content=info.action==='transcribe'?`音频：${info.filename||'所选文件'} · ${(Number(info.bytes||0)/1024/1024).toFixed(2)} MiB`:`内容：${Number(info.characters)||0} 个字符`;const image=info.image?`\n图片：${info.image.name} · ${info.image.type} · ${(Number(info.image.bytes||0)/1024/1024).toFixed(2)} MiB\n确认后将上传这张图片和所选文字。`:'';const result=await dialog.showMessageBox(window,{type:'question',title:'确认本次 AI 调用',message:'本次调用可能消耗所选服务的额度',detail:`${target}\n模型：${info.model||'CLI 默认模型'}\n${content}${image}\n操作：${info.action==='classify'?'分类建议':info.action==='transcribe'?'音频转录':'生成解读'}\n\n仅在确认后发送这次所选内容。取消不会调用。`,buttons:['取消','确认并调用'],defaultId:0,cancelId:0,noLink:true});return result.response===1;}
 });
 handle('intelligenceStatus',async()=>{const value=await writes.read(keyFile,()=>read(keyFile,null));return {...service.status(),hasApiKey:!!value?.ciphertext&&value.endpoint===service.status().settings.endpoint};});
 handle('intelligenceConfigure',patch=>{
  requireStableConfiguration();
  const before=service.status().settings,result=service.configure(patch),next=service.status().settings,serialized=jsonValue(next);
  configurationSaving=true;
  return writes.run(settingsFile,async()=>{
   configurationSaving=true;
   try{await atomicPrivate(settingsFile,serialized);service.configure(next);}
   catch(e){if(JSON.stringify(service.status().settings)===JSON.stringify(next))service.configure(before);throw e;}
   finally{configurationSaving=false;}
   return result;
  }).finally(()=>{configurationSaving=false;});
 });
 handle('intelligenceSetKey',key=>{requireStableConfiguration();if(typeof key!=='string'||key.length>4096||/[\x00-\x20\x7f]/.test(key))throw Error('密钥格式不正确');let serialized;if(key){encrypted();const ciphertext=safeStorage.encryptString(key).toString('base64');serialized=jsonValue({endpoint:service.status().settings.endpoint,ciphertext});}return writes.run(keyFile,async()=>{if(!key){await fs.rm(keyFile,{force:true});return {saved:false};}await atomicPrivate(keyFile,serialized);return {saved:true};});});
 handle('intelligenceRequest',input=>{requireStableConfiguration();return service.request(input);});
 return service;
}
module.exports={registerIntelligence,defaultTranscriptionRuntimeDir};
