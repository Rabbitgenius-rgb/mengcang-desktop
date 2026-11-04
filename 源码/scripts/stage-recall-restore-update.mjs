// Stage a new restore QA bundle without replacing a running bundle or profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {packager} from '@electron/packager';
import {electronCache} from './electron-cache.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidate=path.dirname(project);
const directory=path.join(candidate,'runtime/backup-restore-acceptance');
const source=path.join(project,'desktop/build/app');
const label=process.argv[2]||'paste';
if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(label))throw Error('Use a simple staging label');
const entry=path.join(directory,`app-${label}`);
const out=path.join(directory,`packages-${label}`);
const config=JSON.parse(await fs.readFile(path.join(directory,'app/candidate-config.json'),'utf8'));
const expected={name:'梦藏回看恢复验收',userDataPath:path.join(directory,'user-data'),vaultPath:path.join(directory,'vault'),recallBridgeDirectory:path.join(directory,'bridge')};
for(const [key,value] of Object.entries(expected))if(config[key]!==value)throw Error(`Unexpected isolated restore config: ${key}`);
await fs.access(path.join(source,'main.cjs'));
await fs.mkdir(entry,{mode:0o700}); // Refuse an existing staged update; never clear it.
for(const name of await fs.readdir(source))await fs.cp(path.join(source,name),path.join(entry,name),{recursive:true,dereference:false,errorOnExist:true,force:false});
await fs.writeFile(path.join(entry,'candidate-config.json'),JSON.stringify(expected,null,2),{mode:0o600});
const version=JSON.parse(await fs.readFile(path.join(project,'node_modules/electron/package.json'),'utf8')).version;
const result=await packager({dir:entry,out,name:expected.name,platform:'darwin',arch:'arm64',electronVersion:version,electronZipDir:await electronCache(version),appBundleId:'com.rabbit.mengcang.recall.restore-qa',appCopyright:'Rabbit',asar:{unpack:'{mengcang-mcp.cjs,mengcang-desktop-mcp.cjs,discovery-helper}'},overwrite:false,prune:false});
for(const directory of result){
 const bundle=path.join(directory,expected.name+'.app');
 for(const args of [['--force','--deep','--sign','-',bundle],['--verify','--deep','--strict',bundle]]){
  const signed=spawnSync('/usr/bin/codesign',args,{stdio:'inherit'});if(signed.status!==0)process.exit(signed.status||1);
 }
 console.log(JSON.stringify({bundle,entry,started:false,existingBundleReplaced:false,config:expected,beforeLaunch:'Quit the existing 梦藏回看恢复验收 normally before opening this bundle; both use the same isolated restore profile.'},null,2));
}
