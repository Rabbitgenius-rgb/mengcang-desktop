// Prepare a disposable native app entry. This script never starts Electron.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidate=path.dirname(project);
const directory=path.join(candidate,'runtime/backup-restore-acceptance');
if(process.argv.includes('--help')){
  console.log('node mengcang/scripts/prepare-recall-restore.mjs\nCreates runtime/backup-restore-acceptance only when absent; does not start an app.');
  process.exit(0);
}
const source=path.join(project,'desktop/build/app');
await fs.access(path.join(source,'main.cjs'));
await fs.mkdir(directory,{mode:0o700}); // Refuse an existing run; never reset its data.
for(const name of ['user-data','vault','bridge'])await fs.mkdir(path.join(directory,name),{mode:0o700});
const entry=path.join(directory,'app');
await fs.cp(source,entry,{recursive:true,dereference:false,errorOnExist:true,force:false});
const config={name:'梦藏回看恢复验收',userDataPath:path.join(directory,'user-data'),vaultPath:path.join(directory,'vault'),recallBridgeDirectory:path.join(directory,'bridge')};
await fs.writeFile(path.join(entry,'candidate-config.json'),JSON.stringify(config,null,2),{mode:0o600});
const electron=createRequire(path.join(project,'package.json'))('electron');
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
console.log(JSON.stringify({prepared:true,started:false,entry,config,launch:`env -u ELECTRON_RUN_AS_NODE ${quote(electron)} ${quote(entry)}`},null,2));
