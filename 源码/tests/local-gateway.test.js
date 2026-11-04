'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {LocalVaultGateway}=require('../desktop/local-gateway.cjs');
const {splitNote,frontmatterOf,hash}=require('../src/desktop-connector/notes.js');
const {rejectAiRequest}=require('../desktop/ai-policy.cjs');
function harness(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-standalone-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,gateway:new LocalVaultGateway({vaultPath:root,cachePath:path.join(root,'cache.json')}),write(relative,body){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);return file;}};}
const request=extra=>({operationId:randomUUID(),title:'独立软件测试',body:' 原文\r\n第二行 café 🧪  ',caption:'本机笔记',tags:['test'],...extra});
const attachment={name:'pixel.png',type:'image/png',size:79,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAFklEQVR4nGL4z8DAAAQBAQAA//8DAAEHAQD6RQNLAAAAAElFTkSuQmCC'};
attachment.size=Buffer.from(attachment.dataUrl.split(',')[1],'base64').length;

test('standalone filesystem read needs no plugin/config/account and scans nested notes',async t=>{
 const h=harness(t);h.write('01_sources/cards/text/nested/source.md','---\ntype: material\ntitle: 真实格式\ncaption: 笔记\n---\n正文');h.write('01_sources/books/book.md','---\ntype: book\ntitle: 图书\n---\n原文');
 const before=hash(fs.readFileSync(path.join(h.root,'01_sources/cards/text/nested/source.md')));const result=await h.gateway.snapshot();
 assert.equal(h.gateway.status().connected,true);assert.equal(result.materials.length,1);assert.equal(result.books.length,1);assert.equal(result.errors.length,0);assert.equal(result.materials[0].title,'真实格式');assert.equal(hash(fs.readFileSync(path.join(h.root,'01_sources/cards/text/nested/source.md'))),before);assert.equal(fs.existsSync(path.join(h.root,'.obsidian')),false);
});
test('missing material directory leaves local workspace usable with capture disabled',async t=>{const h=harness(t);const g=new LocalVaultGateway({vaultPath:path.join(h.root,'missing'),cachePath:path.join(h.root,'cache')});assert.equal(g.status().connected,false);assert.equal(g.status().identity.id,'unpaired');assert.equal((await g.snapshot()).capabilities.capture,false);});
test('uses matching previous workspace identity without opening plugin credentials',t=>{const h=harness(t);h.write('cache.json',JSON.stringify({snapshot:{identity:{id:'previous-workspace-uuid',path:h.root}}}));assert.equal(new LocalVaultGateway({vaultPath:h.root,cachePath:path.join(h.root,'cache.json')}).identity.id,'previous-workspace-uuid');h.write('cache.json',JSON.stringify({snapshot:{identity:{id:'foreign-workspace-uuid',path:'/different'}}}));assert.equal(new LocalVaultGateway({vaultPath:h.root,cachePath:path.join(h.root,'cache.json')}).identity.id,'unpaired');});
test('capture preserves exact body and note; retry creates one immutable record',async t=>{const h=harness(t),input=request();const first=await h.gateway.capture(input),again=await h.gateway.capture(input);assert.equal(first.replayed,false);assert.equal(again.replayed,true);const raw=fs.readFileSync(path.join(h.root,first.note.path),'utf8');assert.equal(splitNote(raw).body,input.body);assert.equal(frontmatterOf(raw).caption,input.caption);assert.equal((await h.gateway.snapshot()).materials.length,1);await assert.rejects(h.gateway.capture({...input,sourceUrl:'https://example.test',body:'changed'}),{code:'OPERATION_REUSED'});assert.equal((await h.gateway.snapshot()).materials.length,1);});
test('attachment bytes, hashes and lazy native preview survive repeated save',async t=>{const h=harness(t),input=request({attachment});const result=await h.gateway.capture(input);await h.gateway.capture(input);const file=frontmatterOf(fs.readFileSync(path.join(h.root,result.note.path),'utf8')).original_file;const bytes=Buffer.from(attachment.dataUrl.split(',')[1],'base64');assert.deepEqual(fs.readFileSync(path.join(h.root,file)),bytes);assert.equal((await h.gateway.readAttachment(result.note.path)).dataUrl,attachment.dataUrl);assert.equal((await h.gateway.snapshot()).materials.length,1);});
test('existing note is never overwritten, including a preoccupied operation path',async t=>{const h=harness(t),input=request(),relative=`01_sources/cards/text/capture-${input.operationId}.md`;h.write(relative,'Existing user text');await assert.rejects(h.gateway.capture(input),{code:'CAPTURE_PATH_OCCUPIED'});assert.equal(fs.readFileSync(path.join(h.root,relative),'utf8'),'Existing user text');});
test('rejects symlink directories/files and path traversal for reads and writes',async t=>{const h=harness(t);h.write('outside.md','private');h.write('01_sources/cards/text/good.md','---\ntype: material\n---\nbody');fs.symlinkSync(path.join(h.root,'outside.md'),path.join(h.root,'01_sources/cards/text/link.md'));await assert.rejects(h.gateway.readNote('01_sources/cards/text/link.md'),{code:'PATH_FORBIDDEN'});await assert.rejects(h.gateway.readNote('../outside.md'),{code:'PATH_FORBIDDEN'});fs.symlinkSync(path.join(h.root,'01_sources/cards/text'),path.join(h.root,'01_sources/cards/web'));await assert.rejects(h.gateway.capture(request({sourceUrl:'https://example.test'})),{code:'PATH_FORBIDDEN'});});
test('source version conflict retains source and creates no target',async t=>{const h=harness(t);h.write('01_sources/cards/text/source.md','---\ntype: material\n---\nupdated');await assert.rejects(h.gateway.capture(request({sourcePath:'01_sources/cards/text/source.md',expectedSourceHash:hash('old')})),{code:'CONFLICT'});assert.equal((await h.gateway.snapshot()).materials.length,1);});
test('partial original save resumes same operation and blocks changed payload',async t=>{const h=harness(t),input=request({attachment}),original=h.gateway.exclusiveFile.bind(h.gateway);let fail=true;h.gateway.exclusiveFile=async(relative,bytes)=>{if(relative.endsWith('.md')&&fail){fail=false;throw Error('synthetic interrupted save');}return original(relative,bytes);};await assert.rejects(h.gateway.capture(input),/interrupted/);await assert.rejects(h.gateway.capture({...input,caption:'changed'}),{code:'OPERATION_REUSED'});const result=await h.gateway.capture(input);assert.equal(result.replayed,false);assert.equal((await h.gateway.snapshot()).materials.length,1);});
test('concurrent same operation returns one record and changed original is detected',async t=>{const h=harness(t),input=request({attachment});const [a,b]=await Promise.all([h.gateway.capture(input),h.gateway.capture(input)]);assert.equal(a.note.path,b.note.path);assert.equal(b.replayed,true);const relative=frontmatterOf(fs.readFileSync(path.join(h.root,a.note.path),'utf8')).original_file;fs.writeFileSync(path.join(h.root,relative),'changed');await assert.rejects(h.gateway.capture(input),{code:'ORIGINAL_CONFLICT'});});
test('AI policy still rejects instead of consuming calls',()=>{assert.throws(()=>rejectAiRequest(),{code:'AI_DISABLED'});});

test('existing JPEG extension remains readable without renaming original files',async t=>{const h=harness(t);h.write('01_sources/_originals/photo.jpeg',Buffer.from(attachment.dataUrl.split(',')[1],'base64'));assert.equal((await h.gateway.attachment('01_sources/_originals/photo.jpeg')).contentType,'image/jpeg');});

test('oversized sparse notes reject before body loading while other notes remain available',async t=>{
 const h=harness(t),large=h.write('01_sources/cards/text/large.md','');fs.truncateSync(large,4*1024*1024+1);h.write('01_sources/cards/text/good.md','---\ntype: material\ntitle: Good\n---\nbody');
 await assert.rejects(h.gateway.readNote('01_sources/cards/text/large.md'),{code:'NOTE_TOO_LARGE'});const snapshot=await h.gateway.snapshot();assert.equal(snapshot.materials.length,1);assert.equal(snapshot.materials[0].title,'Good');assert.equal(snapshot.errors.length,1);
});

test('traditional Chinese colour archive is excluded from listing, direct reads and native opens without deleting sources',async t=>{
 const h=harness(t),paths=['01_sources/cards/images/patterns/色韵/001-海天霞.md','01_sources/cards/images/patterns/atlases/色韵色卡图鉴.md','01_sources/cards/images/relocated-colour.md'];
 const sources=paths.map(relative=>h.write(relative,'---\ntype: material\ncollection_kind: color-palette\npattern_family: 色韵\n---\n原文保留'));
 const hashes=sources.map(file=>hash(fs.readFileSync(file)));let noteReads=0;const read=h.gateway.readFile.bind(h.gateway);h.gateway.readFile=async relative=>{if(relative.startsWith('01_sources/cards/images/patterns/色韵/'))noteReads++;return read(relative);};
 let snapshot=await h.gateway.snapshot();assert.equal(snapshot.materials.length,0);assert.equal(snapshot.errors.length,0);assert.equal(noteReads,0);
 for(const relative of paths){await assert.rejects(h.gateway.readNote(relative),{code:'SOURCE_EXCLUDED'});await assert.rejects(h.gateway.original(relative),{code:'SOURCE_EXCLUDED'});}
 h.write('01_sources/cards/images/patterns/色韵/new-colour.md','---\ntype: material\n---\n新增色卡');snapshot=await h.gateway.snapshot();assert.equal(snapshot.materials.length,0);assert.equal(snapshot.errors.length,0);
 sources.forEach((file,index)=>assert.equal(hash(fs.readFileSync(file)),hashes[index]));
});

test('colour exclusion preserves design, ordinary palettes, colour-related inspirations, books and approved documents',async t=>{
 const h=harness(t);h.write('01_sources/cards/images/design.md','---\ntype: material\ntitle: 孟菲斯美学\n---\n颜色参与结构阅读');
 h.write('01_sources/cards/images/other-palette.md','---\ntype: material\ncollection_kind: color-palette\npattern_family: 其他配色\nsource_url: https://example.com\n---\n其他配色');
 h.write('01_sources/cards/text/idea.md','---\nrecord_type: inspiration\ntitle: 用色彩与花朵表达灵感时间\n---\n颜色灵感');
 h.write('01_sources/cards/web/site.md','---\ntype: material\nsource_url: https://cncolor.art/news\n---\n非色卡的网页');
 h.write('01_sources/books/book.md','---\ntype: book\n---\n图书');h.write('03_projects/index.md','# Projects Index');
 const snapshot=await h.gateway.snapshot();assert.equal(snapshot.materials.length,3);assert.equal(snapshot.entries.length,1);assert.equal(snapshot.books.length,1);assert.equal(snapshot.documents.length,1);assert.equal(snapshot.errors.length,0);
 const input=request({body:'保留普通新素材'});await h.gateway.capture(input);assert.equal((await h.gateway.snapshot()).materials.length,4);
});

test('relocated cncolor palette metadata is excluded while source-reference captures fail before writing',async t=>{
 const h=harness(t),id='01_sources/cards/text/relocated.md';const source=h.write(id,'---\ntype: material\ncollection_kind: color-palette\nsource_url: https://cncolor.art/colors\n---\n来源色卡');
 assert.equal((await h.gateway.snapshot()).materials.length,0);assert.equal((await h.gateway.snapshot()).errors.length,0);
 const input=request({sourcePath:id,expectedSourceHash:hash(fs.readFileSync(source))});await assert.rejects(h.gateway.capture(input),{code:'SOURCE_EXCLUDED'});
 assert.equal(fs.existsSync(path.join(h.root,`01_sources/cards/text/capture-${input.operationId}.md`)),false);assert.match(fs.readFileSync(source,'utf8'),/来源色卡/);
});
