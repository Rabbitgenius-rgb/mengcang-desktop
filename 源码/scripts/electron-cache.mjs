import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function electronCache(version){
 const root=path.join(os.homedir(),'Library/Caches/electron'),name=`electron-v${version}-darwin-arm64.zip`;
 for(const folder of [root,...(await fs.readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>path.join(root,entry.name))]){
  try{await fs.access(path.join(folder,name));return folder;}catch{}
 }
 throw Error(`缺少 Electron ${version} 的本机缓存`);
}
