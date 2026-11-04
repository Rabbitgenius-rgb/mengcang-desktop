'use strict';
// Read-only compatibility for registered projects, explicitly approved documents,
// and previously known original books.
// External originals are native-open capabilities, never generic attachment reads.
const fs=require('node:fs');
const path=require('node:path');
const {hash,ConnectorError}=require('../src/desktop-connector/notes.js');
const {readBoundedFile}=require('./bounded-read.cjs');
const REGISTRY='_meta/projects.json',PROJECT_ROOT='03_projects/',BOOK_ROOT='01_sources/books/';
const CACHE_LIMIT=32*1024*1024,REGISTRY_LIMIT=1024*1024;
// These seven existing documents were separately approved for the library. They
// are documents, not new project registrations; source lifecycle stays intact.
const APPROVED_PROJECT_DOCUMENTS=Object.freeze({
 '03_projects/honglou-cloud-moon-plan-2026-09-13.md':'plan',
 '03_projects/index.md':'',
 '03_projects/koryao-pro-visual-controller-optimization-backlog-2026-08-04.md':'project-task-register',
 '03_projects/qingshen-future-roadmap-2026-09-13.md':'plan',
 '03_projects/qingshen-p0-public-calibration-2026-09-13.md':'plan',
 '03_projects/rabbitpet-project-brief-2026-07-07.md':'project',
 '03_projects/rabbitpet-project-brief-2026-07-13.md':'project',
});
const isApprovedProjectDocumentPath=value=>typeof value==='string'&&Object.hasOwn(APPROVED_PROJECT_DOCUMENTS,value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw new ConnectorError(code,message);};
const unwrapped=value=>typeof value==='string'?value.trim().replace(/^!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/,'$1'):'';
const relative=value=>typeof value==='string'&&!!value&&!path.isAbsolute(value)&&!/[\\\x00-\x1f\x7f]/.test(value)&&!value.split('/').some(bit=>!bit||bit==='.'||bit==='..'||bit.startsWith('.'));
const isProjectPath=value=>relative(value)&&value.startsWith(PROJECT_ROOT)&&value.endsWith('.md')&&!value.startsWith(PROJECT_ROOT+'_schedule/');
const isBookPath=value=>relative(value)&&value.startsWith(BOOK_ROOT)&&value.endsWith('.md');
const projectId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f\x7f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);

// Reject all links in an external path, including links that happen to resolve
// within the same folder. Only metadata is read; PDF bytes are never inspected.
function regularExternalPdf(value,vaultPath){
 if(typeof value!=='string'||!path.isAbsolute(value)||path.resolve(value)!==value||/[\\\x00-\x1f\x7f]/.test(value)||!/^\.pdf$/i.test(path.extname(value))||value.startsWith(vaultPath+path.sep))return null;
 try{
  const parts=value.slice(path.parse(value).root.length).split(path.sep);let current=path.parse(value).root;
  for(let i=0;i<parts.length;i++){
   current=path.join(current,parts[i]);const stat=fs.lstatSync(current);
   if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))return null;
  }
  return fs.realpathSync(value)===value?value:null;
 }catch{return null;}
}

function createLegacyLibrary({vaultPath,cachePath,locate}){
 const externalBooks=new Map();
 // Capture only the old cache's verified book mapping at process start. The
 // renderer cannot supply or amend this allowlist, and no credentials are read.
 try{
  const stat=fs.lstatSync(cachePath);
  if(!stat.isSymbolicLink()&&stat.isFile()&&stat.size<CACHE_LIMIT){
   const cache=JSON.parse(fs.readFileSync(cachePath,'utf8')),snapshot=cache.snapshot;
   if(cache.version===1&&snapshot?.identity?.path===vaultPath&&/^[\w-]{8,200}$/.test(snapshot.identity.id||'')&&Array.isArray(snapshot.books))for(const note of snapshot.books){
    if(!object(note)||!isBookPath(note.path)||note.fields?.type!=='book'||typeof note.markdown!=='string'||!/^[a-f0-9]{64}$/.test(note.hash||'')||hash(note.markdown)!==note.hash)continue;
    const original=unwrapped(note.originalPath),source=unwrapped(note.fields.source_file||note.fields.pdf);
    if(!original||original!==source||!regularExternalPdf(original,vaultPath)||externalBooks.has(note.path))continue;
    externalBooks.set(note.path,Object.freeze({original,noteHash:note.hash}));
   }
  }
 }catch{/* Missing or invalid old cache never grants access to an external file. */}

 async function registrations(){
  let file;
  try{
   if(!locate(REGISTRY,true,true))return [];
   file=await fs.promises.open(path.join(vaultPath,REGISTRY),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   const bytes=await readBoundedFile(file,{maxBytes:REGISTRY_LIMIT,code:'PROJECT_REGISTRY_INVALID',message:'旧项目注册表过大，请保留原文件并核对'});
   locate(REGISTRY,false,true);
   let registry;try{registry=JSON.parse(bytes.toString('utf8'));}catch{fail('PROJECT_REGISTRY_INVALID','旧项目注册表格式无法读取，请保留原文件并核对');}
   if(!object(registry)||!Array.isArray(registry.projects))fail('PROJECT_REGISTRY_INVALID','旧项目注册表格式无法读取，请保留原文件并核对');
   const seen=new Set();return registry.projects.flatMap(project=>{
    if(!object(project)||!projectId(project.id))return [];
    const notePath=project.vault_brief||project.path;
    if(!isProjectPath(notePath)||seen.has(notePath))return [];
    seen.add(notePath);return [{id:project.id,path:notePath}];
   });
  }finally{await file?.close();}
 }
 async function project(relative){
  if(!isProjectPath(relative))fail('PATH_FORBIDDEN','此项目不在已注册的只读范围内');
  const found=(await registrations()).find(item=>item.path===relative);
  if(!found)fail('PATH_FORBIDDEN','此项目不在已注册的只读范围内');
  locate(relative,false,true);return found;
 }
 function document(relative,missing=false){
  if(!isApprovedProjectDocumentPath(relative))fail('PATH_FORBIDDEN','此文档不在已批准的只读范围内');
  return locate(relative,missing,true)?{path:relative}:null;
 }
 function documentNote(note){
  if(!isApprovedProjectDocumentPath(note.path))fail('PATH_FORBIDDEN','此文档不在已批准的只读范围内');
  const expectedType=APPROVED_PROJECT_DOCUMENTS[note.path];
  if((note.fields.type||'')!==expectedType)fail('PROJECT_DOCUMENT_INVALID','已批准文档的类型不匹配，请保留原文件并核对');
  const heading=note.body.match(/^ {0,3}#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/m)?.[1];
  const title=typeof note.fields.title==='string'&&note.fields.title.trim()?note.fields.title:heading||note.title;
  return {...note,id:note.path,title,kind:'project-document',readOnly:true,legacyProjectDocument:true,sourceStatus:String(note.fields.status||''),
   searchText:[title,note.searchText].join(' ').toLocaleLowerCase('zh-CN'),
   originalPath:'',originalAvailable:true,originalKind:'project-document',originalName:path.basename(note.path),originalMime:'text/markdown'};
 }
 function externalBook(note){
  const known=externalBooks.get(note.path);
  if(!known||note.kind!=='book'||note.fields?.type!=='book'||note.hash!==known.noteHash||unwrapped(note.fields.source_file||note.fields.pdf)!==known.original)return null;
  return regularExternalPdf(known.original,vaultPath);
 }
 function projectNote(note,registration){
  if(note.fields.type!=='project')fail('PROJECT_RECORD_INVALID','已注册项目笔记的类型不匹配，请保留原文件并核对');
  return {...note,id:note.path,kind:'project',readOnly:true,legacyProjectId:registration.id,
   originalAvailable:true,originalKind:'project-note',originalName:path.basename(note.path)};
 }
 return {registrations,project,isProjectPath,document,documentNote,isApprovedProjectDocumentPath,
  documentPaths:Object.freeze(Object.keys(APPROVED_PROJECT_DOCUMENTS)),externalBook,projectNote};
}
module.exports={createLegacyLibrary,isProjectPath,isApprovedProjectDocumentPath,regularExternalPdf};
