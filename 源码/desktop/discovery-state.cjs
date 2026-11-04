'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {draftName,jsonValue,atomicPrivate,fail}=require('./security.cjs');
function registerDiscoveryState({handle,gateway,userData,writes,save=atomicPrivate}){
 const fileFor=id=>{if(!id||id!==gateway.identity?.id)fail('工作区身份已变化，旧数据保持原样','VAULT_MISMATCH');return path.join(userData,'discovery',draftName(id));};
 handle('discoveryStateGet',id=>{const file=fileFor(id);return writes.read(file,async()=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}});});
 handle('discoveryStateSet',(value,id)=>{const file=fileFor(id);if(value?.schema!==1||!Array.isArray(value.collections)||!Array.isArray(value.boards))fail('收藏与画布格式无效');return writes.run(file,async()=>{await save(file,jsonValue(value));return {saved:true};});});
}
module.exports={registerDiscoveryState};
