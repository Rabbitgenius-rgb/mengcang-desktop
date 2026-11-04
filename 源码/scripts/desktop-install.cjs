#!/usr/bin/env node
'use strict';
/**
 * Local connector installation, without activation or reload.
 *
 * Commands (replace paths; actual running version must be independently verified):
 *   node scripts/desktop-install.cjs plan --vault VAULT --plugin-source ROOT \
 *     --rest-source REST_5_2_0 --runtime-version 1.13.7 --out PRIVATE_BUNDLE
 *   node scripts/desktop-install.cjs apply --vault VAULT --bundle PRIVATE_BUNDLE --runtime-version 1.13.7
 *   node scripts/desktop-install.cjs verify --vault VAULT --bundle PRIVATE_BUNDLE
 *   node scripts/desktop-install.cjs restore --vault VAULT --bundle PRIVATE_BUNDLE
 *   node scripts/desktop-install.cjs self-test
 *
 * Run plan and the independent test-Vault acceptance before production apply.
 * Keep PRIVATE_BUNDLE outside the source repository and Vault; it includes exact
 * copies of existing data.json (possibly containing credentials), mode 0600.
 * It must survive installation and be retained at a private durable location.
 * The app package is installed separately. This script does not open applications,
 * alter community-plugins.json, enable plugins, reload Obsidian, or run source files.
 * Restore refuses newer code, data, or configuration rather than overwriting it.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VAULT = '/Users/rabbit/Documents/ChatGPT/个人AiOS系统/personal-ai-os-vault';
const SCHEMA = 'mengcang.desktop-install.v1';
const MENGCANG = 'mengcang-dashboard';
const REST = 'obsidian-local-rest-api';
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hashFile = file => fs.existsSync(file) ? HASH(fs.readFileSync(file)) : null;
const failure = (code, message) => Object.assign(new Error(message), {code});
function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(value)) throw failure('RUNTIME_VERSION_INVALID', 'Provide the independently verified running Obsidian version, such as 1.13.7.');
  return value.split('+')[0].split('.').map(Number);
}
function requireVersion(actual, minimum) {
  const a = versionParts(actual), b = versionParts(minimum);
  for (let i=0;i<3;i++) {if(a[i]>b[i])return;if(a[i]<b[i])throw failure('OBSIDIAN_TOO_OLD', `Running Obsidian ${minimum} or newer is required.`);}
}
function localPath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[\\\x00-\x1f]/.test(relative) || relative.split('/').some(p=>!p || p==='.' || p==='..')) throw failure('UNSAFE_PATH','Invalid relative install path.');
  const absolute=path.resolve(root,relative);let cursor=absolute;
  while(cursor!==path.resolve(root)) {if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw failure('SYMLINK_PATH','Installer will not traverse symbolic links.');cursor=path.dirname(cursor);}
  return absolute;
}
function checkVault(value, testOptions={}) {
  const actual=fs.realpathSync(value);const expected=fs.realpathSync(testOptions.expectedVault || VAULT);
  if(actual!==expected)throw failure('WRONG_VAULT','Only the approved Personal AI OS Vault may be installed.');return actual;
}
function listAssets(root, relative) {
  const absolute=localPath(root,relative);if(!fs.existsSync(absolute))return [];
  const result=[];
  for(const item of fs.readdirSync(absolute,{withFileTypes:true})) {
    const target=`${relative}/${item.name}`;
    if(item.isSymbolicLink())throw failure('SYMLINK_ASSET','Existing plugin assets contain a symbolic link; review before installation.');
    if(item.isDirectory())result.push(...listAssets(root,target));
    else if(item.isFile())result.push({path:target,hash:hashFile(localPath(root,target)),bytes:fs.statSync(localPath(root,target)).size});
  }
  return result;
}
function atomic(file, content, expectedHash) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${crypto.randomUUID()}.tmp`;
  try {fs.writeFileSync(temp,content,{flag:'wx',mode:0o600});if(hashFile(file)!==expectedHash)throw failure('CONCURRENT_CHANGE','A target changed immediately before installation.');fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function loadPlan(bundle) {
  const plan=readJSON(path.join(bundle,'plan.json'));const {planHash,...body}=plan;
  if(plan.schema!==SCHEMA||HASH(json(body))!==planHash)throw failure('PLAN_CHANGED','Installation plan changed after review.');return plan;
}
function planInstall(options,testOptions={}) {
  const vault=checkVault(options.vault,testOptions);const bundle=path.resolve(options.out);
  requireVersion(options.runtimeVersion,'1.13.1');
  if(bundle===vault||bundle.startsWith(vault+path.sep)||fs.existsSync(bundle))throw failure('UNSAFE_BUNDLE','Use a new private backup bundle outside the Vault.');
  const sources=[{id:MENGCANG,root:fs.realpathSync(options.pluginSource),files:['manifest.json','main.js','styles.css']},{id:REST,root:fs.realpathSync(options.restSource),files:['manifest.json','main.js']}];
  if(fs.existsSync(path.join(sources[1].root,'styles.css')))sources[1].files.push('styles.css');
  for(const source of sources)if(bundle===source.root||bundle.startsWith(source.root+path.sep))throw failure('UNSAFE_BUNDLE','Do not place private backups inside plugin source directories.');
  fs.mkdirSync(path.join(bundle,'payloads'),{recursive:true,mode:0o700});
  const operations=[],inputs=[],protectedFiles=[],plugins=[];
  for(const source of sources) {
    const manifest=readJSON(localPath(source.root,'manifest.json'));
    if(manifest.id!==source.id)throw failure('PLUGIN_ID_MISMATCH','Unexpected plugin manifest identity.');
    if(source.id===REST && manifest.version!=='5.2.0')throw failure('REST_VERSION_MISMATCH','Only Local REST API 5.2.0 is approved for this installer.');
    if(typeof manifest.minAppVersion!=='string')throw failure('MIN_VERSION_MISSING','Plugin manifest must declare its minimum Obsidian version.');
    requireVersion(options.runtimeVersion,manifest.minAppVersion);
    const targetRoot=`.obsidian/plugins/${source.id}`;
    const currentManifest=localPath(vault,`${targetRoot}/manifest.json`);
    const previous=fs.existsSync(currentManifest)?readJSON(currentManifest):null;
    if(previous&&previous.id!==source.id)throw failure('INSTALLED_PLUGIN_ID_MISMATCH','Installed plugin folder has a conflicting identity.');
    plugins.push({id:source.id,version:manifest.version,minimum:manifest.minAppVersion,previousVersion:previous?.version||null});
    for(const name of source.files) {
      const file=localPath(source.root,name);if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw failure('SOURCE_MISSING',`Required candidate file is missing: ${source.id}/${name}`);
      const bytes=fs.readFileSync(file),afterHash=HASH(bytes);inputs.push({path:file,hash:afterHash});
      const relative=`${targetRoot}/${name}`,target=localPath(vault,relative),beforeHash=hashFile(target);
      fs.writeFileSync(path.join(bundle,'payloads',afterHash),bytes,{mode:0o600});
      operations.push({path:relative,beforeHash,afterHash,payload:`payloads/${afterHash}`,action:beforeHash===afterHash?'reuse':beforeHash?'update':'create'});
    }
    const dataPath=`${targetRoot}/data.json`;
    protectedFiles.push({path:dataPath,hash:hashFile(localPath(vault,dataPath)),kind:'runtime-data'});
    const existingStyles=`${targetRoot}/styles.css`;
    if(!source.files.includes('styles.css') && fs.existsSync(localPath(vault,existingStyles)))protectedFiles.push({path:existingStyles,hash:hashFile(localPath(vault,existingStyles)),kind:'unchanged-code'});
  }
  protectedFiles.push({path:'.obsidian/community-plugins.json',hash:hashFile(localPath(vault,'.obsidian/community-plugins.json')),kind:'activation-settings'});
  let enabled=[];
  const enabledPath=localPath(vault,'.obsidian/community-plugins.json');
  if(fs.existsSync(enabledPath)) {const value=readJSON(enabledPath);if(!Array.isArray(value))throw failure('INVALID_PLUGIN_SETTINGS','Community plugin settings are not an array.');enabled=value;}
  const assets=sources.flatMap(source=>listAssets(vault,`.obsidian/plugins/${source.id}/assets`));
  const plan={schema:SCHEMA,createdAt:new Date().toISOString(),vault,runtimeVersion:options.runtimeVersion,runtimeEvidence:'Caller verified actual running version before planning; not inferred from an installer or update package.',plugins:plugins.map(p=>({...p,currentlyEnabled:enabled.includes(p.id)})),inputs,operations,protectedFiles,assets,activation:'No enable, reload or settings changes performed by this installer.'};
  plan.planHash=HASH(json(plan));fs.writeFileSync(path.join(bundle,'plan.json'),json(plan),{mode:0o600});
  fs.writeFileSync(path.join(bundle,'README.md'),`# 梦藏连接器安装备份\n\n计划哈希：${plan.planHash}\n\n运行版本由调用方实际核实：${options.runtimeVersion}。\n\n仅安装下列代码文件，不启用、不重新加载插件，不修改配置或资料。\n\n${operations.map(o=>`- ${o.action}: ${o.path}`).join('\n')}\n\n保护备份：${protectedFiles.map(f=>f.path).join('、')}。data.json 可能含本机凭据，此目录仅限本机保存。\n\n已有 assets 仅记录哈希，共 ${assets.length} 项；没有重复复制。\n\napply 前核对计划；verify 检查安装文件；restore 在任何代码、配置或资料发生新变化时拒绝覆盖。激活插件后配置可能更新，届时需要先审查新状态再另行安排回滚。\n`,{mode:0o600});
  return plan;
}
function locked(bundle,task) {
  const lock=path.join(bundle,'install.lock');let descriptor;
  try{descriptor=fs.openSync(lock,'wx',0o600);fs.writeFileSync(descriptor,String(process.pid));}catch(e){if(e.code==='EEXIST')throw failure('INSTALL_BUSY','An installation or restoration already holds this bundle.');throw e;}
  try{return task();}finally{fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
function checkProtected(plan,vault) {
  for(const record of [...plan.protectedFiles,...plan.assets])if(hashFile(localPath(vault,record.path))!==record.hash)throw failure('PROTECTED_STATE_CHANGED',`Preserving newer protected state: ${record.path}`);
}
function applyInstall(options,testOptions={}) {
  const bundle=path.resolve(options.bundle);return locked(bundle,()=>{
    const plan=loadPlan(bundle),vault=checkVault(options.vault,testOptions);
    if(plan.vault!==vault)throw failure('WRONG_VAULT','This plan was reviewed for another Vault.');
    requireVersion(options.runtimeVersion,'1.13.1');for(const plugin of plan.plugins)requireVersion(options.runtimeVersion,plugin.minimum);
    for(const input of plan.inputs)if(hashFile(input.path)!==input.hash)throw failure('SOURCE_CHANGED','Candidate code changed after planning. Generate a new plan.');
    checkProtected(plan,vault);
    for(const operation of plan.operations) {
      const current=hashFile(localPath(vault,operation.path));
      if(current!==operation.beforeHash && current!==operation.afterHash)throw failure('TARGET_CHANGED',`Installed file changed after review: ${operation.path}`);
      if(hashFile(localPath(bundle,operation.payload))!==operation.afterHash)throw failure('PAYLOAD_CHANGED','A candidate payload no longer matches its reviewed hash.');
    }
    const backupDir=path.join(bundle,'backup');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const backupPath=path.join(backupDir,'manifest.json');
    let backup=fs.existsSync(backupPath)?readJSON(backupPath):{schema:SCHEMA,planHash:plan.planHash,vault,status:'prepared',files:[],protectedFiles:plan.protectedFiles,assets:plan.assets};
    if(backup.planHash!==plan.planHash||backup.vault!==vault||backup.status==='restored')throw failure('BACKUP_MISMATCH','Backup does not belong to this active installation plan.');
    for(const operation of plan.operations.filter(o=>o.action!=='reuse'))if(!backup.files.some(f=>f.path===operation.path)) {
      const target=localPath(vault,operation.path);if(hashFile(target)!==operation.beforeHash)throw failure('BACKUP_MISSING','A target changed without a recorded backup.');
      if(operation.beforeHash)fs.writeFileSync(path.join(backupDir,operation.beforeHash),fs.readFileSync(target),{mode:0o600});
      backup.files.push({path:operation.path,beforeHash:operation.beforeHash,afterHash:operation.afterHash});
    }
    for(const record of backup.files) {
      const operation=plan.operations.find(o=>o.path===record.path&&o.action!=='reuse');
      if(!operation||record.beforeHash!==operation.beforeHash||record.afterHash!==operation.afterHash)throw failure('BACKUP_MISMATCH','Code backup does not match the reviewed plan.');
      if(record.beforeHash&&hashFile(path.join(backupDir,record.beforeHash))!==record.beforeHash)throw failure('BACKUP_DAMAGED','Code backup verification failed before installation.');
    }
    for(const protectedFile of plan.protectedFiles)if(protectedFile.hash) {
      const target=path.join(backupDir,protectedFile.hash);
      if(!fs.existsSync(target))fs.writeFileSync(target,fs.readFileSync(localPath(vault,protectedFile.path)),{mode:0o600});
      if(hashFile(target)!==protectedFile.hash)throw failure('BACKUP_DAMAGED','Protected configuration backup verification failed.');
    }
    atomic(backupPath,json(backup),hashFile(backupPath));
    let writes=0;
    for(const operation of plan.operations.filter(o=>o.action!=='reuse')) {
      const target=localPath(vault,operation.path);if(hashFile(target)===operation.afterHash)continue;
      checkProtected(plan,vault);atomic(target,fs.readFileSync(localPath(bundle,operation.payload)),operation.beforeHash);writes++;
      if(testOptions.failAfter && writes>=testOptions.failAfter)throw failure('INJECTED_FAILURE','Simulated installation interruption.');
    }
    const verification=verifyInstall({bundle,vault},testOptions);if(!verification.ok)throw failure('VERIFY_FAILED','Installed-file verification failed.');
    backup.status='installed';backup.installedAt=new Date().toISOString();atomic(backupPath,json(backup),hashFile(backupPath));
    return {ok:true,writes,verification,backupManifest:backupPath,activation:'unchanged'};
  });
}
function verifyInstall(options,testOptions={}) {
  const plan=loadPlan(options.bundle),vault=checkVault(options.vault,testOptions);if(plan.vault!==vault)throw failure('WRONG_VAULT','Wrong verification Vault.');
  const changed=plan.operations.filter(o=>hashFile(localPath(vault,o.path))!==o.afterHash).map(o=>o.path);
  const protectedChanged=plan.protectedFiles.filter(o=>hashFile(localPath(vault,o.path))!==o.hash).map(o=>o.path);
  const assetsChanged=plan.assets.filter(o=>hashFile(localPath(vault,o.path))!==o.hash).map(o=>o.path);
  return {ok:!changed.length&&!protectedChanged.length&&!assetsChanged.length,checkedFiles:plan.operations.length,changed,protectedChanged,assetsChanged};
}
function restoreInstall(options,testOptions={}) {
  const bundle=path.resolve(options.bundle);return locked(bundle,()=>{
    const plan=loadPlan(bundle),vault=checkVault(options.vault,testOptions);if(vault!==plan.vault)throw failure('WRONG_VAULT','Wrong restore Vault.');
    const backupDir=path.join(bundle,'backup'),manifest=path.join(backupDir,'manifest.json'),backup=readJSON(manifest);
    if(backup.planHash!==plan.planHash||backup.vault!==vault)throw failure('BACKUP_MISMATCH','Unrelated backup.');
    const expectedFiles=plan.operations.filter(o=>o.action!=='reuse');
    if(backup.files.length!==expectedFiles.length||new Set(backup.files.map(f=>f.path)).size!==expectedFiles.length)throw failure('BACKUP_MISMATCH','Code backup inventory does not match the reviewed plan.');
    checkProtected(plan,vault);
    for(const record of backup.files) {
      const expected=expectedFiles.find(o=>o.path===record.path);
      if(!expected||record.beforeHash!==expected.beforeHash||record.afterHash!==expected.afterHash)throw failure('BACKUP_MISMATCH','Code backup does not match the reviewed plan.');
      const current=hashFile(localPath(vault,record.path));if(current!==record.beforeHash&&current!==record.afterHash)throw failure('RESTORE_CONFLICT',`Preserving newer plugin code: ${record.path}`);
      if(record.beforeHash&&hashFile(path.join(backupDir,record.beforeHash))!==record.beforeHash)throw failure('BACKUP_DAMAGED','Code backup verification failed.');
    }
    for(const record of backup.protectedFiles)if(record.hash&&hashFile(path.join(backupDir,record.hash))!==record.hash)throw failure('BACKUP_DAMAGED','Protected configuration backup verification failed.');
    let restored=0;
    for(const record of [...backup.files].reverse()) {
      const target=localPath(vault,record.path);if(hashFile(target)===record.beforeHash)continue;
      if(record.beforeHash)atomic(target,fs.readFileSync(path.join(backupDir,record.beforeHash)),record.afterHash);
      else {if(hashFile(target)!==record.afterHash)throw failure('RESTORE_CONFLICT','Target changed before removal.');fs.unlinkSync(target);}
      restored++;
    }
    const ok=backup.files.every(record=>hashFile(localPath(vault,record.path))===record.beforeHash);checkProtected(plan,vault);
    if(!ok)throw failure('RESTORE_VERIFY_FAILED','Restored hashes do not match the backups.');
    backup.status='restored';backup.restoredAt=new Date().toISOString();atomic(manifest,json(backup),hashFile(manifest));return{ok:true,restored,protectedFilesUntouched:true,activation:'unchanged'};
  });
}
function selfTest() {
  const assert=require('node:assert/strict'),os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-install-test-'));let assertions=0;
  try {
    const vault=path.join(root,'test-vault'),source=path.join(root,'candidate'),rest=path.join(root,'rest');fs.mkdirSync(vault);fs.mkdirSync(source);fs.mkdirSync(rest);
    const write=(base,relative,value)=>{const file=path.join(base,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
    for(const [base,id,version,minimum] of [[source,MENGCANG,'0.5.0','1.10.0'],[rest,REST,'5.2.0','1.13.1']]){write(base,'manifest.json',json({id,version,minAppVersion:minimum}));write(base,'main.js',`// ${id} code`);}
    write(source,'styles.css','/* style */');write(vault,`.obsidian/plugins/${MENGCANG}/main.js`,'old code');write(vault,`.obsidian/plugins/${MENGCANG}/data.json`,'{"keep":"private runtime state"}');write(vault,`.obsidian/plugins/${MENGCANG}/assets/existing.png`,'existing asset');write(vault,'.obsidian/community-plugins.json',json([MENGCANG]));
    const opts={vault,pluginSource:source,restSource:rest,runtimeVersion:'1.13.7',out:path.join(root,'bundle')},testOptions={expectedVault:vault};
    assert.throws(()=>planInstall({...opts,runtimeVersion:'1.12.0'},testOptions),{code:'OBSIDIAN_TOO_OLD'});assertions++;
    const plan=planInstall(opts,testOptions);assert.equal(plan.assets.length,1);assertions++;
    assert.throws(()=>applyInstall({vault,bundle:opts.out,runtimeVersion:'1.13.0'},testOptions),{code:'OBSIDIAN_TOO_OLD'});assertions++;
    assert.throws(()=>applyInstall({vault,bundle:opts.out,runtimeVersion:'1.13.7'},{...testOptions,failAfter:2}),{code:'INJECTED_FAILURE'});assertions++;
    assert.equal(applyInstall({vault,bundle:opts.out,runtimeVersion:'1.13.7'},testOptions).ok,true);assertions++;
    assert.equal(applyInstall({vault,bundle:opts.out,runtimeVersion:'1.13.7'},testOptions).writes,0);assertions++;
    assert.equal(verifyInstall({vault,bundle:opts.out},testOptions).ok,true);assertions++;
    const data=path.join(vault,`.obsidian/plugins/${MENGCANG}/data.json`),prior=fs.readFileSync(data);fs.writeFileSync(data,'{"new":"work"}');
    assert.throws(()=>restoreInstall({vault,bundle:opts.out},testOptions),{code:'PROTECTED_STATE_CHANGED'});assertions++;fs.writeFileSync(data,prior);
    assert.equal(restoreInstall({vault,bundle:opts.out},testOptions).ok,true);assertions++;
    assert.equal(fs.readFileSync(path.join(vault,`.obsidian/plugins/${MENGCANG}/main.js`),'utf8'),'old code');assertions++;
    assert.equal(fs.existsSync(path.join(vault,`.obsidian/plugins/${REST}/main.js`)),false);assertions++;
    assert.deepEqual(fs.readFileSync(data),prior);assertions++;
    const wrong=path.join(root,'wrong-vault');fs.mkdirSync(wrong);assert.throws(()=>planInstall({...opts,vault:wrong,out:path.join(root,'wrong-bundle')},testOptions),{code:'WRONG_VAULT'});assertions++;
    const fresh={...opts,out:path.join(root,'changed-bundle')};planInstall(fresh,testOptions);write(source,'main.js','changed candidate');assert.throws(()=>applyInstall({vault,bundle:fresh.out,runtimeVersion:'1.13.7'},testOptions),{code:'SOURCE_CHANGED'});assertions++;
    return {ok:true,assertions,actualVaultTouched:false};
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module) {
  try {
    const [command,...args]=process.argv.slice(2),options={};
    if(command==='help'||!command) {console.log('plan --vault VAULT --plugin-source ROOT --rest-source REST_5_2_0 --runtime-version VERIFIED_RUNNING_VERSION --out PRIVATE_BUNDLE\napply --vault VAULT --bundle PRIVATE_BUNDLE --runtime-version VERIFIED_RUNNING_VERSION\nverify/restore --vault VAULT --bundle PRIVATE_BUNDLE\nself-test\nNo command enables or reloads plugins. Read the header for backup requirements.');process.exit(0);}
    for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw failure('INVALID_ARGUMENTS','Arguments require --name value.');options[args[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args[i+1];}
    const result=command==='plan'?planInstall(options):command==='apply'?applyInstall(options):command==='verify'?verifyInstall(options):command==='restore'?restoreInstall(options):command==='self-test'?selfTest():null;
    if(!result)throw failure('INVALID_COMMAND','Unknown command; run help.');
    console.log(JSON.stringify(command==='plan'?{ok:true,plan:path.join(path.resolve(options.out),'plan.json'),plugins:result.plugins,operations:result.operations.map(o=>({path:o.path,action:o.action})),protectedFiles:result.protectedFiles.map(f=>({path:f.path,exists:!!f.hash})),assetsIndexed:result.assets.length,activation:result.activation}:result,null,2));
    if(result.ok===false)process.exitCode=1;
  }catch(error){console.error(JSON.stringify({ok:false,code:error.code||'INSTALL_ERROR',message:error.message},null,2));process.exitCode=1;}
}
module.exports={VAULT,SCHEMA,planInstall,applyInstall,verifyInstall,restoreInstall,selfTest,requireVersion};
