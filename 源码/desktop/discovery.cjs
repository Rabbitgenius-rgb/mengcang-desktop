'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
function validateRequest(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw Error('分析请求无效');
  if(Buffer.byteLength(JSON.stringify(input))>32*1024*1024)throw Error('分析请求超过32MB');
  if(Object.keys(input).some(key=>!['command','texts','images','kind','base64'].includes(key)))throw Error('不支持此分析字段');
  if(!['analyze','extract','capabilities'].includes(input.command || 'analyze'))throw Error('不支持此分析请求');
  if((input.command || 'analyze')==='analyze'){
    if(input.texts!==undefined && (!Array.isArray(input.texts)||input.texts.length>512||input.texts.some(entry=>!entry||typeof entry.id!=='string'||entry.id.length>2048||typeof entry.text!=='string'||entry.text.length>20000)))throw Error('文字分析格式无效，一次最多512份文字');
    if(input.images!==undefined && (!Array.isArray(input.images)||input.images.length>32||input.images.some(entry=>!entry||typeof entry.id!=='string'||entry.id.length>2048||typeof entry.base64!=='string'||entry.base64.length>12*1024*1024)))throw Error('图片分析格式无效，一次最多32张图片');
  }
  if(input.command==='extract' && (!['image','pdf'].includes(input.kind)||typeof input.base64!=='string'))throw Error('文件提取格式无效');
  return input;
}
function analyze(input,{helper=path.join(__dirname.endsWith('app.asar')?__dirname+'.unpacked':__dirname,'discovery-helper'),timeout=120000,spawnImpl=spawn}={}) {
  validateRequest(input);
  const serialized=JSON.stringify(input);
  if(!fs.existsSync(helper))return Promise.reject(Error('本地分析组件尚未构建，请使用完整候选版本'));
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(helper,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='',size=0,settled=false,terminalError,timer;
    const onParentExit=()=>{try{child.kill('SIGKILL');}catch{}};
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);process.removeListener('exit',onParentExit);error?reject(error):resolve(value);};
    const stop=error=>{
      if(settled||terminalError)return;
      terminalError=error;
      // Keep the caller busy until close confirms that native analysis stopped.
      try{child.kill('SIGKILL');}catch{}
    };
    process.once('exit',onParentExit);
    timer=setTimeout(()=>stop(Error('分析超时，请减少文件大小或素材数量')),timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{if(settled||terminalError)return;size+=Buffer.byteLength(chunk);if(size>32*1024*1024)stop(Error('分析结果过大'));else output+=chunk;});
    child.stderr.resume();
    child.on('error',error=>{if(!child.pid)finish(terminalError||error);else stop(error);});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{if(settled)return;if(terminalError){finish(terminalError);return;}try{const result=JSON.parse(output);if(code!==0 || result.error)finish(Error(result.error || '本地分析失败'));else finish(null,result);}catch{finish(Error('本地分析没有返回可用结果'));}});
    child.stdin.end(serialized);
  });
}
module.exports={analyze,validateRequest};
