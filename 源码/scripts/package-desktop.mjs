import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packager } from '@electron/packager';
import {electronCache} from './electron-cache.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// A local production bridge is packaged separately from candidate profile overrides.
try{await fs.copyFile(path.join(root,'desktop/production-config.json'),path.join(root,'desktop/build/app/candidate-config.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
const version=JSON.parse(await fs.readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version;
// Keep the speech model and CLI binaries outside ASAR. They are loaded only for
// a user-confirmed transcription and the child process exits after each job.
const localRuntime=await fs.realpath(path.join(root,'desktop/local-transcription'));
await fs.access(path.join(root,'desktop/build/app/discovery-helper'),constants.X_OK);
for(const file of ['whisper-cli','ffmpeg','model.bin','runtime-manifest.json'])await fs.access(path.join(localRuntime,file));
const result=await packager({dir:path.join(root,'desktop/build/app'),out:path.join(root,'desktop/build/packages'),name:'梦藏',platform:'darwin',arch:'arm64',electronVersion:version,electronZipDir:await electronCache(version),appBundleId:'com.rabbit.mengcang',appCopyright:'Rabbit',asar:{unpack:"{mengcang-mcp.cjs,mengcang-desktop-mcp.cjs,discovery-helper}"},extraResource:[localRuntime],overwrite:true,prune:false});
for(const dir of result){const bundle=path.join(dir,'梦藏.app');await fs.access(path.join(bundle,'Contents/Resources/app.asar.unpacked/discovery-helper'),constants.X_OK);const sign=spawnSync('/usr/bin/codesign',['--force','--deep','--sign','-',bundle],{stdio:'inherit'});if(sign.status!==0)process.exit(sign.status||1);const verify=spawnSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});if(verify.status!==0)process.exit(verify.status||1);console.log(bundle);}
