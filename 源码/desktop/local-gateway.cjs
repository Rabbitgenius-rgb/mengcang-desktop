'use strict';
// Standalone desktop storage. No Obsidian runtime, plugins, credentials or HTTP API.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const {readBoundedFile}=require('./bounded-read.cjs');
const { toNote } = require('../src/desktop-connector/note-dto.js');
const { hash, frontmatterOf, ConnectorError } = require('../src/desktop-connector/notes.js');
const { ATTACHMENT_TYPES, capturePaths, validateCaptureInput, assertCaptureLocation, hasCaptureOperation, createCapture } = require('../src/desktop-connector/capture.js');
const MIME={...ATTACHMENT_TYPES,jpeg:'image/jpeg',jpe:'image/jpeg',tif:'image/tiff'};
const ROOTS = ['01_sources/cards/images/', '01_sources/cards/text/', '01_sources/cards/web/', '01_sources/books/'];
const fail = (code,message) => { throw new ConnectorError(code,message); };
const safeRelative = value => {
  if(typeof value!=='string'||!value||value.startsWith('/')||/[\\\x00-\x1f]/.test(value)||value.split('/').some(bit=>!bit||bit==='.'||bit==='..'))fail('PATH_FORBIDDEN','文件路径无效');
  return value;
};
const unwrapped = value => typeof value==='string'?value.trim().replace(/^!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/,'$1'):'';

class LocalVaultGateway extends EventEmitter {
  constructor({vaultPath,cachePath}) {
    super();this.vaultPath=path.resolve(vaultPath);this.queue=Promise.resolve();this.disposed=false;
    // Keep the old workspace key, when present, without opening encrypted pairing
    // files or plugin settings. The existing Electron profile and origin stay intact.
    let id='unpaired';
    try {
      if(fs.statSync(cachePath).size<32*1024*1024){const identity=JSON.parse(fs.readFileSync(cachePath,'utf8')).snapshot?.identity;
        if(identity?.path===this.vaultPath&&/^[\w-]{8,200}$/.test(identity.id||''))id=identity.id;}
    }catch{/* New installations use the existing unpaired local workspace. */}
    this.identity={id,name:path.basename(this.vaultPath),path:this.vaultPath,storage:'local-files',protocolVersion:1};
  }
  checkRoot(){
    const stat=fs.lstatSync(this.vaultPath);
    if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(this.vaultPath)!==this.vaultPath)fail('PATH_FORBIDDEN','资料库位置发生变化，请核对本地目录');
    if(this.disposed)fail('DISPOSED','软件正在退出');
  }
  status(){
    try{this.checkRoot();return {connected:true,paired:true,identity:this.identity,code:'LOCAL_FILES',message:'本机资料库 · 无需 Obsidian 插件'};}
    catch{return {connected:false,paired:false,identity:this.identity,code:'VAULT_UNAVAILABLE',message:'本地资料目录暂不可用；卡片与草稿仍可在本机使用'};}
  }
  async connect(){const status=this.status();this.emit('status',status);return status;}
  dispose(){this.disposed=true;}
  locate(relative,missing=false,binary=false){this.checkRoot();safeRelative(relative);return assertCaptureLocation(this.vaultPath,relative,missing,binary);}
  async readFile(relative){
    this.locate(relative,false,true);
    const file=await fs.promises.open(path.join(this.vaultPath,relative),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{const note=relative.endsWith('.md'),value=await readBoundedFile(file,{maxBytes:note?4*1024*1024:64*1024*1024,code:note?'NOTE_TOO_LARGE':'ATTACHMENT_TOO_LARGE',message:note?'笔记过大，请打开原文件阅读':'单个附件预览上限为 64 MiB，可打开原文件阅读'});this.locate(relative,false,true);return value;}
    finally{await file.close();}
  }
  notePath(value){safeRelative(value);if(!value.endsWith('.md')||!ROOTS.some(root=>value.startsWith(root)))fail('PATH_FORBIDDEN','此笔记不在资料范围内');return value;}
  attachmentPath(value,sourcePath){
    let raw=unwrapped(value);if(!raw)return '';
    if(path.isAbsolute(raw)){if(!raw.startsWith(this.vaultPath+path.sep))return '';raw=path.relative(this.vaultPath,raw);}
    for(const candidate of [raw,path.posix.join(path.posix.dirname(sourcePath),raw)]){
      try{safeRelative(candidate);if(!candidate.startsWith('01_sources/'))continue;if(this.locate(candidate,false,true))return candidate;}catch{/* Never follow aliases or paths outside the material directory. */}
    }return '';
  }
  toNote(relative,markdown){
    const result=toNote.call(this,{path:relative,basename:path.basename(relative,'.md')},markdown);
    const original=this.attachmentPath(result.originalPath||result.fields.original_file||result.fields.source_file||result.fields.pdf,relative);
    const extension=path.extname(original).slice(1).toLowerCase();
    result.originalPath='';
    if(original&&MIME[extension]){result.originalPath=original;result.originalMime=MIME[extension];result.originalName=String(result.fields.original_name||path.basename(original));}
    return result;
  }
  async readNote(relative){this.notePath(relative);const bytes=await this.readFile(relative);if(bytes.length>4*1024*1024)fail('NOTE_TOO_LARGE','笔记过大，请打开原文件阅读');return this.toNote(relative,bytes.toString('utf8'));}
  async snapshot(){
    const entries=[],materials=[],books=[],errors=[];
    if(!this.status().connected)return {identity:this.identity,entries,materials,books,projects:[],errors:[],capabilities:{capture:false,captureAttachment:false}};
    const files=[];
    const walk=async relative=>{
      if(!this.locate(relative,true))return;
      for(const entry of await fs.promises.readdir(path.join(this.vaultPath,relative),{withFileTypes:true})){
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
        const child=relative+'/'+entry.name;
        if(entry.isDirectory())await walk(child);else if(entry.isFile()&&entry.name.endsWith('.md'))files.push(child);
      }
    };
    for(const root of ROOTS){try{await walk(root.slice(0,-1));}catch(error){errors.push({path:root,message:error.message});}}
    for(const relative of files){
      try{const note=await this.readNote(relative);if(note.fields.type!=='material'&&note.fields.type!=='book'&&note.fields.record_type!=='inspiration')continue;
        (note.kind==='book'?books:note.kind==='entry'?entries:materials).push(note);
      }catch(error){errors.push({path:relative,message:error.message});}
    }
    return {identity:this.identity,entries,materials,books,projects:[],errors,capabilities:{capture:true,captureAttachment:true},revision:Date.now()};
  }
  async attachment(relative){
    safeRelative(relative);if(!relative.startsWith('01_sources/'))fail('PATH_FORBIDDEN','附件不在资料范围内');
    const type=MIME[path.extname(relative).slice(1).toLowerCase()];if(!type)fail('PATH_FORBIDDEN','此附件类型不可读取');
    this.locate(relative,false,true);if(fs.statSync(path.join(this.vaultPath,relative)).size>64*1024*1024)fail('ATTACHMENT_TOO_LARGE','单个附件预览上限为 64 MiB，可打开原文件阅读');
    return {data:await this.readFile(relative),contentType:type};
  }
  async readAttachment(notePath){const note=await this.readNote(notePath);if(!note.originalPath)fail('ORIGINAL_MISSING','笔记没有可读取的本地原文件');const original=await this.attachment(note.originalPath);return {name:note.originalName,type:original.contentType,size:original.data.length,dataUrl:`data:${original.contentType};base64,${original.data.toString('base64')}`};}
  async original(relative){const note=await this.readNote(relative);if(note.originalPath){this.locate(note.originalPath,false,true);return {kind:'file',path:path.join(this.vaultPath,note.originalPath)};}if(note.url)return {kind:'url',url:note.url};fail('ORIGINAL_MISSING','没有可用的原文件或来源链接');}
  async related(){return {candidates:[],confirmed:[]};}
  async ensureFolder(relative){
    safeRelative(relative);let parent='';
    for(const bit of relative.split('/')){parent=parent?parent+'/'+bit:bit;this.locate(parent,true);try{await fs.promises.mkdir(path.join(this.vaultPath,parent),{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}this.locate(parent);}
  }
  async exclusiveFile(relative,bytes){
    this.locate(relative,true,true);
    const target=path.join(this.vaultPath,relative),temp=path.join(path.dirname(target),`.mengcang-${randomUUID()}.tmp`);
    try{
      const file=await fs.promises.open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
      this.locate(path.posix.dirname(relative));await fs.promises.link(temp,target);this.locate(relative,false,true);
    }finally{await fs.promises.unlink(temp).catch(()=>{});}
  }
  async captureOriginal(input,create=false){
    const original=input.attachment;if(!original)return;
    const folder=path.posix.dirname(original.path),name=path.posix.basename(original.path);
    if(create)await this.ensureFolder(folder);else this.locate(folder);
    if((await fs.promises.readdir(path.join(this.vaultPath,folder))).some(item=>item!==name&&!item.startsWith('.mengcang-')))fail('OPERATION_REUSED','此操作已保存了不同的原文件，请保留当前草稿');
    if(!this.locate(original.path,true,true)){
      if(!create)fail('ORIGINAL_MISSING','已保存的原文件被移动或删除');
      try{await this.exclusiveFile(original.path,original.bytes);}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    const actual=await this.readFile(original.path);if(actual.length!==original.size||hash(actual)!==original.sha256)fail('ORIGINAL_CONFLICT','原文件内容已经改变，请保留草稿');
  }
  capture(raw){
    const input=validateCaptureInput(raw);if(input.sourcePath)this.notePath(input.sourcePath);
    const task=this.queue.catch(()=>{}).then(async()=>{
      this.checkRoot();
      for(const relative of capturePaths(input.operationId))if(this.locate(relative,true)){
        const markdown=(await this.readFile(relative)).toString('utf8');hasCaptureOperation(markdown,input);
        if(input.attachment&&frontmatterOf(markdown).original_file!==input.attachment.path)fail('ORIGINAL_CONFLICT','笔记关联的原文件发生变化');
        await this.captureOriginal(input);return {note:this.toNote(relative,markdown),operationId:input.operationId,replayed:true};
      }
      const checkSource=async()=>{if(input.sourcePath&&(await this.readNote(input.sourcePath)).hash!==input.expectedSourceHash)fail('CONFLICT','来源笔记已修改，请保留摘录草稿');};
      await checkSource();await this.ensureFolder(path.posix.dirname(input.path));await this.captureOriginal(input,true);await checkSource();
      for(const relative of capturePaths(input.operationId))if(this.locate(relative,true))fail('CAPTURE_PATH_OCCUPIED','采集目标已被占用，请保留草稿');
      const markdown=createCapture(input);try{await this.exclusiveFile(input.path,markdown);}catch(error){if(error.code==='EEXIST')fail('CAPTURE_PATH_OCCUPIED','已有同名笔记，未覆盖任何内容');throw error;}
      this.emit('change',{});return {note:this.toNote(input.path,markdown),operationId:input.operationId,replayed:false};
    });this.queue=task;return task;
  }
}
module.exports={LocalVaultGateway};
