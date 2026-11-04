'use strict';
const {relative,fail}=require('./security.cjs');
function externalUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function registerSourceActions({handle,gateway,shell}){
 handle('openOriginal',async value=>{const original=await gateway.original(relative(value));if(original.kind==='url'){const href=externalUrl(original.url);if(!href)fail('来源链接无效');await shell.openExternal(href);}else{const error=await shell.openPath(original.path);if(error)fail('原文件未能打开');}return {opened:true};});
}
module.exports={externalUrl,registerSourceActions};
