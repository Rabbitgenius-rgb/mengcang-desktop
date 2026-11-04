// Package only the main Dream candidate into a new output location.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {packager} from '@electron/packager';
import {root,prepareCandidate} from '../../scripts/prepare-candidate.mjs';
import {electronCache} from './electron-cache.mjs';

const label=process.argv[2]||'paste';
if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(label))throw Error('Use a simple staging label');
const config=await prepareCandidate();
const name='梦藏回看验收';
const media=path.join(root,'packages/runtime-assets/local-transcription');
await fs.access(path.join(media,'runtime-manifest.json'));
const version=JSON.parse(await fs.readFile(path.join(root,'mengcang/node_modules/electron/package.json'),'utf8')).version;
const output=path.join(root,label==='paste'?'packages/mengcang-paste-update':`packages-${label}`);
const result=await packager({dir:path.join(root,'mengcang/desktop/build/app'),out:output,name,appBundleId:'com.rabbit.mengcang.recall.candidate',platform:'darwin',arch:'arm64',electronVersion:version,electronZipDir:await electronCache(version),extraResource:[media],asar:{unpack:'{mengcang-mcp.cjs,mengcang-desktop-mcp.cjs,discovery-helper}'},overwrite:false,prune:false});
for(const directory of result){
 const bundle=path.join(directory,name+'.app');
 for(const args of [['--force','--deep','--sign','-',bundle],['--verify','--deep','--strict',bundle]]){
  const signed=spawnSync('/usr/bin/codesign',args,{stdio:'inherit'});if(signed.status!==0)process.exit(signed.status||1);
 }
 console.log(JSON.stringify({bundle,started:false,existingBundleReplaced:false,config,beforeLaunch:'Quit the existing 梦藏回看验收 normally before opening this bundle; the candidate data remains in runtime/.'},null,2));
}
