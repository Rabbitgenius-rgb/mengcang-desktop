import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundled=path.resolve(root,'../应用/梦藏.app/Contents/Resources/local-transcription');
const target=path.join(root,'desktop/local-transcription');
for(const name of ['model.bin','ffmpeg','whisper-cli','runtime-manifest.json'])await fs.access(path.join(bundled,name));
await fs.cp(bundled,target,{recursive:true,force:false,errorOnExist:false});
console.log('已复制 ZIP 中的本机转录资源；未下载、启动模型或调用 API。');
