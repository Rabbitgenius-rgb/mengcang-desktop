'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const YAML=require('yaml');
const {LocalVaultGateway}=require('../desktop/local-gateway.cjs');
const {frontmatterOf,hash}=require('../src/desktop-connector/notes.js');
const {registerSourceActions}=require('../desktop/source-actions.cjs');
const {isApprovedProjectDocumentPath}=require('../desktop/legacy-library.cjs');

const approvedDocuments=[
 ['03_projects/honglou-cloud-moon-plan-2026-09-13.md','plan','proposed'],
 ['03_projects/index.md','',''],
 ['03_projects/koryao-pro-visual-controller-optimization-backlog-2026-08-04.md','project-task-register','active'],
 ['03_projects/qingshen-future-roadmap-2026-09-13.md','plan','proposed'],
 ['03_projects/qingshen-p0-public-calibration-2026-09-13.md','plan','in_progress'],
 ['03_projects/rabbitpet-project-brief-2026-07-07.md','project','archived'],
 ['03_projects/rabbitpet-project-brief-2026-07-13.md','project','archived'],
];

function harness(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-legacy-'))),vault=path.join(root,'vault');fs.mkdirSync(vault);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const h={root,vault,cache:path.join(root,'old-cache.json'),write(relative,value){const target=path.join(vault,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);return target;},
  note(relative,fields,body='旧正文'){return h.write(relative,`---\n${YAML.stringify(fields)}---\n${body}`);},
  registry(projects){h.write('_meta/projects.json',JSON.stringify({schema:1,projects}));},
  gateway(){return new LocalVaultGateway({vaultPath:vault,cachePath:h.cache});},
  external(name='known book.pdf'){const target=path.join(root,'old-books',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'%PDF-1.4\nsynthetic fixture');return target;},
  book(relative='01_sources/books/book.md',original=h.external()){
   const target=h.note(relative,{type:'book',id:'old-book-id',title:'旧书',source_file:original});const markdown=fs.readFileSync(target,'utf8');
   const note={id:'old-book-id',path:relative,kind:'book',title:'旧书',fields:frontmatterOf(markdown),markdown,hash:hash(markdown),originalPath:original};
   return {target,relative,original,note};
  },
  saveCache(books,extra={}){fs.writeFileSync(h.cache,JSON.stringify({version:1,snapshot:{identity:{id:'previous-vault-id',path:vault},books},...extra}));},
 };return h;
}

test('registered projects are read-only complete notes with stable path ids; unknown directories are not scanned',async t=>{
 const h=harness(t),registered='03_projects/registered.md',unregistered='03_projects/unregistered.md';
 const source=h.note(registered,{type:'project',id:'note-yaml-id',title:'真实旧项目'},'项目正文');h.note(unregistered,{type:'project',title:'未注册'},'不要自动收录');h.note('02_wiki/private.md',{type:'material'},'不要扫描');h.note('01_sources/cards/text/source.md',{type:'material'},'已支持素材');
 h.registry([{id:'registry-project-id',vault_brief:registered},{id:'duplicate-registry-id',vault_brief:registered}]);const before=fs.readFileSync(source),g=h.gateway(),snapshot=await g.snapshot();
 assert.equal(snapshot.materials.length,1);assert.equal(snapshot.projects.length,1);const project=snapshot.projects[0];
 assert.equal(project.id,registered);assert.equal(project.kind,'project');assert.equal(project.readOnly,true);assert.equal(project.legacyProjectId,'registry-project-id');assert.equal(project.body,'项目正文');assert.equal(project.originalAvailable,true);assert.equal(project.originalPath,'');assert.equal(project.originalName,'registered.md');assert.equal(project.originalKind,'project-note');
 assert.deepEqual(await g.original(registered),{kind:'file',path:source});await assert.rejects(g.readNote(unregistered),{code:'PATH_FORBIDDEN'});await assert.rejects(g.readNote('02_wiki/private.md'),{code:'PATH_FORBIDDEN'});assert.deepEqual(fs.readFileSync(source),before);
});

test('only the seven approved project documents enter a separate read-only document list, preserving source lifecycle and bytes',async t=>{
 const h=harness(t),originals=new Map();
 for(const [relative,type,status] of approvedDocuments){
  const body=`# ${type?'文档正文':'Projects Index'}\n\n中文内容、[原始链接](https://example.test/source) 与 [[相关旧项目]]。\n`;
  const target=type?h.note(relative,{type,status,id:'source-id-'+relative,title:'文档 '+relative,project_id:'old-project',superseded_by:status==='archived'?'new-brief.md':undefined},body):h.write(relative,body);
  originals.set(relative,{target,bytes:fs.readFileSync(target)});
 }
 h.note('03_projects/unapproved-plan.md',{type:'plan'},'不能扩大扫描');
 const registered='03_projects/registered.md';h.note(registered,{type:'project'},'仍是注册项目');h.registry([{id:'registered',path:registered}]);
 const g=h.gateway(),snapshot=await g.snapshot();assert.equal(snapshot.errors.length,0);assert.equal(snapshot.projects.length,1);assert.equal(snapshot.projects[0].path,registered);assert.equal(snapshot.documents.length,7);
 assert.deepEqual(snapshot.documents.map(note=>note.path),approvedDocuments.map(([relative])=>relative));
 for(const [relative,type,status] of approvedDocuments){
  const record=snapshot.documents.find(note=>note.path===relative),original=originals.get(relative);
  assert.equal(record.id,relative);assert.equal(record.kind,'project-document');assert.equal(record.readOnly,true);assert.equal(record.legacyProjectDocument,true);assert.equal(record.sourceStatus,status);
  assert.equal(record.fields.type||'',type);assert.equal(record.fields.status||'',status);assert.equal(record.markdown,original.bytes.toString('utf8'));assert.equal(record.hash,hash(original.bytes));
  assert.equal(record.originalPath,'');assert.equal(record.originalAvailable,true);assert.equal(record.originalKind,'project-document');assert.equal(record.originalMime,'text/markdown');assert.equal(record.originalName,path.basename(relative));
  assert.equal(record.title,type?'文档 '+relative:'Projects Index');assert.deepEqual(await g.original(relative),{kind:'file',path:original.target});assert.equal((await g.readNote(relative)).markdown,record.markdown);assert.deepEqual(fs.readFileSync(original.target),original.bytes);
  await assert.rejects(g.readAttachment(relative),{code:'ORIGINAL_MISSING'});
 }
 await assert.rejects(g.readNote('03_projects/unapproved-plan.md'),{code:'PATH_FORBIDDEN'});
 const handlers={},opened=[];registerSourceActions({handle:(name,fn)=>handlers[name]=fn,gateway:g,shell:{openPath:async file=>{opened.push(file);return '';},openExternal:async()=>assert.fail('No external URL expected')}});
 await handlers.openOriginal(approvedDocuments[0][0]);assert.deepEqual(opened,[originals.get(approvedDocuments[0][0]).target]);
});

test('approved document paths are exact and missing documents do not create snapshot errors or registry entries',async t=>{
 const h=harness(t),g=h.gateway(),snapshot=await g.snapshot();assert.deepEqual(snapshot.documents,[]);assert.deepEqual(snapshot.errors,[]);assert.equal(fs.existsSync(path.join(h.vault,'_meta/projects.json')),false);
 for(const [relative] of approvedDocuments){assert.equal(isApprovedProjectDocumentPath(relative),true);assert.equal(g.isApprovedProjectDocumentPath(relative),true);await assert.rejects(g.readNote(relative),{code:'NOT_FOUND'});}
 for(const relative of ['__proto__','constructor','03_projects/index.md/../secret.md','03_projects/./index.md','03_projects/INDEX.md','03_projects/index.md.bak','03_projects/other-plan.md','/03_projects/index.md',null])assert.equal(isApprovedProjectDocumentPath(relative),false);
});

test('approved document symlinks and unexpected source types fail closed without blocking legitimate records',async t=>{
 const h=harness(t),linked=approvedDocuments[0][0],wrong=approvedDocuments[2][0],outside=path.join(h.root,'outside.md');fs.writeFileSync(outside,'secret');h.write('03_projects/placeholder.md','');fs.symlinkSync(outside,path.join(h.vault,linked));h.note(wrong,{type:'material'},'not the approved document type');h.write('03_projects/index.md','# Projects Index\n\nSafe');h.note('01_sources/cards/text/good.md',{type:'material'},'material');
 const g=h.gateway();await assert.rejects(g.readNote(linked),{code:'PATH_FORBIDDEN'});await assert.rejects(g.original(linked),{code:'PATH_FORBIDDEN'});await assert.rejects(g.readNote(wrong),{code:'PROJECT_DOCUMENT_INVALID'});await assert.rejects(g.original(wrong),{code:'PROJECT_DOCUMENT_INVALID'});
 const snapshot=await g.snapshot();assert.equal(snapshot.materials.length,1);assert.deepEqual(snapshot.documents.map(note=>note.path),['03_projects/index.md']);assert.equal(snapshot.errors.length,2);
 fs.unlinkSync(path.join(h.vault,linked));fs.unlinkSync(path.join(h.vault,'03_projects/index.md'));fs.unlinkSync(path.join(h.vault,wrong));fs.unlinkSync(path.join(h.vault,'03_projects/placeholder.md'));fs.rmdirSync(path.join(h.vault,'03_projects'));fs.symlinkSync(h.root,path.join(h.vault,'03_projects'));await assert.rejects(g.readNote('03_projects/index.md'),{code:'PATH_FORBIDDEN'});
});

test('an approved document excerpt creates a capture card without editing the source or project registry',async t=>{
 const h=harness(t),relative=approvedDocuments[3][0],source=h.note(relative,{type:'plan',status:'proposed'},'旧规划正文'),before=fs.readFileSync(source),g=h.gateway();
 const result=await g.capture({operationId:randomUUID(),title:'规划摘录',body:'摘录',sourcePath:relative,expectedSourceHash:hash(before)});
 assert.match(result.note.path,/^01_sources\/cards\/text\/capture-[0-9a-f-]+\.md$/);assert.deepEqual(fs.readFileSync(source),before);assert.equal(fs.existsSync(path.join(h.vault,'_meta/projects.json')),false);assert.equal((await g.snapshot()).documents.length,1);
});

test('project registrations are reread and revoked paths cannot remain readable',async t=>{
 const h=harness(t),relative='03_projects/old.md';h.note(relative,{type:'project'},'source');h.registry([{id:'old',path:relative}]);const g=h.gateway();assert.equal((await g.snapshot()).projects.length,1);
 h.registry([]);await assert.rejects(g.readNote(relative),{code:'PATH_FORBIDDEN'});await assert.rejects(g.original(relative),{code:'PATH_FORBIDDEN'});assert.equal((await g.snapshot()).projects.length,0);
});

test('project traversal, absolute, hidden, schedule and unregistered paths never become readable',async t=>{
 const h=harness(t);h.note('03_projects/good.md',{type:'project'});h.registry([
  {id:'good',vault_brief:'03_projects/good.md'},{id:'traversal',vault_brief:'03_projects/../02_wiki/secret.md'},
  {id:'absolute',vault_brief:path.join(h.vault,'03_projects/good.md')},{id:'hidden',vault_brief:'03_projects/.private/secret.md'},
  {id:'schedule',vault_brief:'03_projects/_schedule/not-a-project.md'},{id:'outside',vault_brief:'02_wiki/secret.md'},
 ]);const g=h.gateway();assert.deepEqual((await g.snapshot()).projects.map(x=>x.path),['03_projects/good.md']);
 for(const relative of ['03_projects/../02_wiki/secret.md','03_projects/.private/secret.md','03_projects/_schedule/not-a-project.md','02_wiki/secret.md'])await assert.rejects(g.readNote(relative),{code:'PATH_FORBIDDEN'});
});

test('registered symlink and non-project notes are rejected while legitimate material scans remain usable',async t=>{
 const h=harness(t),outside=path.join(h.root,'outside.md');fs.writeFileSync(outside,'private');h.write('03_projects/parent.txt','parent');fs.symlinkSync(outside,path.join(h.vault,'03_projects/link.md'));h.note('03_projects/wrong.md',{type:'material'},'not a project');h.note('01_sources/cards/text/good.md',{type:'material'},'material');h.registry([{id:'link',path:'03_projects/link.md'},{id:'wrong',path:'03_projects/wrong.md'}]);const g=h.gateway();
 await assert.rejects(g.readNote('03_projects/link.md'),{code:'PATH_FORBIDDEN'});await assert.rejects(g.readNote('03_projects/wrong.md'),{code:'PROJECT_RECORD_INVALID'});const snapshot=await g.snapshot();assert.equal(snapshot.projects.length,0);assert.equal(snapshot.errors.length,2);assert.equal(snapshot.materials.length,1);
});

test('a symlinked registry cannot grant project access',async t=>{
 const h=harness(t),outside=path.join(h.root,'registry.json');h.note('03_projects/p.md',{type:'project'});fs.writeFileSync(outside,JSON.stringify({projects:[{id:'p',path:'03_projects/p.md'}]}));fs.mkdirSync(path.join(h.vault,'_meta'));fs.symlinkSync(outside,path.join(h.vault,'_meta/projects.json'));const g=h.gateway();await assert.rejects(g.readNote('03_projects/p.md'),{code:'PATH_FORBIDDEN'});assert.equal((await g.snapshot()).projects.length,0);
});

test('oversized and malformed registries fail closed without blocking existing materials',async t=>{
 const h=harness(t);h.note('01_sources/cards/text/good.md',{type:'material'});const registry=h.write('_meta/projects.json','bad JSON');const g=h.gateway();let snapshot=await g.snapshot();assert.equal(snapshot.materials.length,1);assert.equal(snapshot.errors.length,1);
 fs.truncateSync(registry,1024*1024+1);snapshot=await g.snapshot();assert.equal(snapshot.materials.length,1);assert.equal(snapshot.errors.length,1);assert.equal(snapshot.projects.length,0);
});

test('project excerpts may be saved only as fixed capture cards without changing original projects',async t=>{
 const h=harness(t),relative='03_projects/source.md',source=h.note(relative,{type:'project'},'旧项目正文');h.registry([{id:'source',path:relative}]);const before=fs.readFileSync(source),g=h.gateway();const result=await g.capture({operationId:randomUUID(),title:'项目摘录',body:'摘录',sourcePath:relative,expectedSourceHash:hash(before)});
 assert.match(result.note.path,/^01_sources\/cards\/text\/capture-[0-9a-f-]+\.md$/);assert.deepEqual(fs.readFileSync(source),before);assert.equal((await g.snapshot()).projects.length,1);
 assert.throws(()=>g.capture({operationId:randomUUID(),title:'不能改项目',body:'new',path:relative}),{code:'INVALID_CAPTURE'});
});

test('known old external PDFs gain native-open metadata only, without external byte-read capabilities',async t=>{
 const h=harness(t),b=h.book();h.saveCache([b.note]);const g=h.gateway(),record=await g.readNote(b.relative);
 assert.equal(record.originalPath,'');assert.equal(record.originalAvailable,true);assert.equal(record.originalName,'known book.pdf');assert.equal(record.originalMime,'application/pdf');assert.equal(record.originalKind,'legacy-external-pdf');assert.deepEqual(await g.original(b.relative),{kind:'file',path:b.original});
 await assert.rejects(g.readAttachment(b.relative),{code:'ORIGINAL_MISSING'});await assert.rejects(g.attachment(b.original),{code:'PATH_FORBIDDEN'});await assert.rejects(g.original(b.original),{code:'PATH_FORBIDDEN'});assert.equal((await g.snapshot()).books.length,1);
 const handlers={},opened=[];registerSourceActions({handle:(name,fn)=>handlers[name]=fn,gateway:g,shell:{openPath:async p=>{opened.push(p);return '';},openExternal:async()=>assert.fail('No URL open expected')}});await handlers.openOriginal(b.relative);assert.deepEqual(opened,[b.original]);await assert.rejects(handlers.openOriginal(b.original));assert.deepEqual(opened,[b.original]);
});

test('external originals do not read PDF bytes during metadata listing or native-open descriptor creation',async t=>{
 const h=harness(t),b=h.book();h.saveCache([b.note]);const prior=fs.readFileSync;let pdfReads=0;
 fs.readFileSync=function(file,...args){if(file===b.original){pdfReads++;throw Error('PDF body read forbidden');}return prior.call(this,file,...args);};t.after(()=>fs.readFileSync=prior);
 const g=h.gateway();assert.equal((await g.snapshot()).books[0].originalAvailable,true);assert.deepEqual(await g.original(b.relative),{kind:'file',path:b.original});assert.equal(pdfReads,0);
});

test('new book paths and uncached books cannot grant native external access',async t=>{
 const h=harness(t),b=h.book(),g=h.gateway();assert.equal((await g.readNote(b.relative)).originalAvailable,false);await assert.rejects(g.original(b.relative),{code:'ORIGINAL_MISSING'});
 h.saveCache([b.note]);h.book('01_sources/books/uncached.md',b.original);const cached=h.gateway();await assert.rejects(cached.original('01_sources/books/uncached.md'),{code:'ORIGINAL_MISSING'});
});

test('changing current book metadata or body revokes an old-cache external grant',async t=>{
 const h=harness(t),b=h.book();h.saveCache([b.note]);const g=h.gateway();assert.equal((await g.readNote(b.relative)).originalAvailable,true);
 h.note(b.relative,{type:'book',id:'old-book-id',source_file:h.external('different.pdf')});await assert.rejects(g.original(b.relative),{code:'ORIGINAL_MISSING'});
 fs.writeFileSync(b.target,b.note.markdown+'\nlegitimate new edit');await assert.rejects(g.original(b.relative),{code:'ORIGINAL_MISSING'});assert.equal((await g.readNote(b.relative)).originalAvailable,false);
});

test('tampered cache note hash and mismatched legacy source paths never grant access',async t=>{
 const h=harness(t),b=h.book();h.saveCache([{...b.note,hash:'0'.repeat(64)}]);await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
 h.saveCache([{...b.note,originalPath:h.external('mismatch.pdf')}]);await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
 h.saveCache([b.note],{version:2});await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
 h.saveCache([b.note],{snapshot:{identity:{path:'/different-vault'},books:[b.note]}});await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
});

test('symlinked old cache cannot grant external original access',async t=>{
 const h=harness(t),b=h.book();h.saveCache([b.note]);const target=h.cache+'.original';fs.renameSync(h.cache,target);fs.symlinkSync(target,h.cache);await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
});

test('replacing a known external file with a symlink revokes its native-open capability',async t=>{
 const h=harness(t),b=h.book();h.saveCache([b.note]);const g=h.gateway();assert.equal((await g.readNote(b.relative)).originalAvailable,true);fs.unlinkSync(b.original);fs.symlinkSync(h.external('replacement.pdf'),b.original);assert.equal((await g.readNote(b.relative)).originalAvailable,false);await assert.rejects(g.original(b.relative),{code:'ORIGINAL_MISSING'});
});

test('external parent symlinks, traversal and non-PDF paths fail closed',async t=>{
 const h=harness(t);const real=path.join(h.root,'real');fs.mkdirSync(real);fs.writeFileSync(path.join(real,'book.pdf'),'%PDF-fixture');fs.symlinkSync(real,path.join(h.root,'linked'));let b=h.book('01_sources/books/link.md',path.join(h.root,'linked/book.pdf'));h.saveCache([b.note]);await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
 b=h.book('01_sources/books/traversal.md',h.root+'/real/../real/book.pdf');h.saveCache([b.note]);await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
 b=h.book('01_sources/books/plain.md',h.external('not-a-book.txt'));h.saveCache([b.note]);await assert.rejects(h.gateway().original(b.relative),{code:'ORIGINAL_MISSING'});
});

test('external uppercase PDF files remain legitimate; an unavailable file is not advertised',async t=>{
 const h=harness(t),b=h.book('01_sources/books/uppercase.md',h.external('known.PDF'));h.saveCache([b.note]);const g=h.gateway();assert.equal((await g.readNote(b.relative)).originalAvailable,true);fs.unlinkSync(b.original);assert.equal((await g.readNote(b.relative)).originalAvailable,false);await assert.rejects(g.original(b.relative),{code:'ORIGINAL_MISSING'});
});

test('local Vault original attachments retain their existing bytes and native-open behavior',async t=>{
 const h=harness(t),original=h.write('01_sources/_originals/book.pdf','%PDF-local-fixture'),b=h.book('01_sources/books/local.md',original),g=h.gateway(),record=await g.readNote(b.relative);
 assert.equal(record.originalPath,'01_sources/_originals/book.pdf');assert.equal(record.originalAvailable,true);assert.equal(record.originalKind,'vault-file');assert.deepEqual(await g.original(b.relative),{kind:'file',path:original});assert.equal((await g.readAttachment(b.relative)).type,'application/pdf');
});
