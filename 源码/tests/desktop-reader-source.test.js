'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const YAML=require('yaml');
const {LocalVaultGateway}=require('../desktop/local-gateway.cjs');
const {createReaderSources,rangeOf}=require('../desktop/reader-source.cjs');
const {frontmatterOf,hash}=require('../src/desktop-connector/notes.js');
const {normalizeWorkspaceAttachment}=require('../desktop/attachment-validation.cjs');
const {validateCaptureInput}=require('../src/desktop-connector/capture.js');
function zip(entries){
 const local=[],directory=[];let offset=0;
 for(const [name,value] of entries){const data=Buffer.from(value),filename=Buffer.from(name),header=Buffer.alloc(30),central=Buffer.alloc(46);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);const record=Buffer.concat([header,filename,data]);local.push(record);directory.push(central,filename);offset+=record.length;}
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,central,end]);
}
const epub=()=>zip([['mimetype','application/epub+zip'],['META-INF/container.xml','<container/>'],['OPS/book.opf','<package/>'],['OPS/chapter.xhtml','<html><body>中文图书</body></html>']]);
function attachment(bytes,name='book.epub',type='application/epub+zip'){return {name,type,size:bytes.length,dataUrl:`data:${type};base64,${bytes.toString('base64')}`};}
function fixture(t,{external=false,large=false,type='application/pdf'}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-reader-'))),vault=path.join(root,'vault'),cache=path.join(root,'cache.json'),notePath='01_sources/books/book.md';fs.mkdirSync(path.join(vault,'01_sources/books'),{recursive:true});fs.mkdirSync(path.join(vault,'01_sources/_originals'),{recursive:true});
 const file=external?path.join(root,'outside.pdf'):path.join(vault,'01_sources/_originals',type==='application/pdf'?'book.pdf':'book.epub');fs.writeFileSync(file,type==='application/pdf'?'%PDF-1.7\n0123456789\n%%EOF':epub());if(large)fs.truncateSync(file,65*1024*1024+19);
 const noteFile=path.join(vault,notePath),fields={type:'book',title:'中文图书',id:'book-source',source_file:file,status:'reading'};
 const writeNote=()=>{const markdown=`---\n${YAML.stringify(fields)}---\n本地图书正文`;fs.writeFileSync(noteFile,markdown);return markdown;};
 const markdown=writeNote();if(external)fs.writeFileSync(cache,JSON.stringify({version:1,snapshot:{identity:{id:'previous-vault-id',path:vault},books:[{path:notePath,kind:'book',fields:frontmatterOf(markdown),markdown,hash:hash(markdown),originalPath:file}]}}));
 const gateway=new LocalVaultGateway({vaultPath:vault,cachePath:cache}),sources=createReaderSources({gateway});
 t.after(()=>{sources.dispose();gateway.dispose();fs.rmSync(root,{recursive:true,force:true});});
 return {root,vault,cache,file,fields,notePath,noteFile,writeNote,gateway,sources};
}
const request=(url,headers={},method='GET')=>new Request(url,{method,headers});

test('reader capability streams local originals with byte ranges, suffixes, HEAD, ETag and no path disclosure',async t=>{
 const f=fixture(t),source=await f.sources.issue(f.notePath),original=fs.readFileSync(f.file);
 assert.deepEqual(Object.keys(source).sort(),['name','size','sourceKey','type','url']);assert.equal(source.type,'application/pdf');assert.equal(source.size,original.length);assert.match(source.url,/^mengcang-reader:\/\/source\/[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(source),new RegExp(f.root));
 let response=await f.sources.handle(request(source.url));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),'mengcang://app');
 response=await f.sources.handle(request(source.url,{Range:'bytes=2-8'}));assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 2-8/${original.length}`);assert.equal(response.headers.get('content-length'),'7');assert.deepEqual(Buffer.from(await response.arrayBuffer()),original.subarray(2,9));
 response=await f.sources.handle(request(source.url,{Range:'bytes=-5'}));assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original.subarray(-5));
 response=await f.sources.handle(request(source.url,{},'HEAD'));assert.equal(response.status,200);assert.equal(response.body,null);assert.equal(response.headers.get('content-length'),String(original.length));
 const etag=response.headers.get('etag');response=await f.sources.handle(request(source.url,{Range:'bytes=0-3','If-Range':etag}));assert.equal(response.status,206);await response.arrayBuffer();response=await f.sources.handle(request(source.url,{Range:'bytes=0-3','If-Range':'"old"'}));assert.equal(response.status,200);await response.arrayBuffer();
 for(const Range of ['bytes=9999-','bytes=10-2','bytes=-0','bytes=0-1,3-5','bananas','bytes=99999999999999999999999-']){response=await f.sources.handle(request(source.url,{Range}));assert.equal(response.status,416,Range);assert.equal(response.headers.get('content-range'),`bytes */${original.length}`);}
});

test('registered external PDFs above 64 MiB use bounded range reads while generic attachment reads stay forbidden',async t=>{
 const f=fixture(t,{external:true,large:true});await assert.rejects(f.gateway.readAttachment(f.notePath),{code:'ORIGINAL_MISSING'});await assert.rejects(f.gateway.attachment(f.file),{code:'PATH_FORBIDDEN'});const source=await f.sources.issue(f.notePath);assert.ok(source.size>64*1024*1024);
 const first=await f.sources.handle(request(source.url,{Range:'bytes=0-7'}));assert.equal(first.status,206);assert.equal(await first.text(),'%PDF-1.7');const last=await f.sources.handle(request(source.url,{Range:'bytes=-19'}));assert.equal(last.status,206);assert.equal((await last.arrayBuffer()).byteLength,19);
});

test('independent same-book loads cannot revoke a newer visible source when an older load finishes late',async t=>{
 const f=fixture(t),first=await f.sources.issue(f.notePath),second=await f.sources.issue(f.notePath);assert.notEqual(first.url,second.url);assert.equal(first.sourceKey,second.sourceKey);
 for(const item of [second,first,second]){const response=await f.sources.handle(request(item.url,{Range:'bytes=0-4'}));assert.equal(response.status,206);assert.equal(await response.text(),'%PDF-');}
 f.fields.title='源记录已改变';f.writeNote();assert.equal((await f.sources.handle(request(first.url))).status,409);assert.equal((await f.sources.handle(request(second.url))).status,409);
});

test('reader source is note-only and rejects links, arbitrary paths, URLs, foreign origins and unsupported methods',async t=>{
 const f=fixture(t),source=await f.sources.issue(f.notePath);
 for(const value of [f.file,'../secret','https://example.test',{},'01_sources/_originals/book.pdf'])await assert.rejects(f.sources.issue(value));
 for(const url of [source.url+'?path=/etc/passwd',source.url+'#fragment',source.url.replace('source/','other/'),'mengcang-reader://source/etc/passwd','file:///etc/passwd'])assert.equal((await f.sources.handle(request(url))).status,404);
 assert.equal((await f.sources.handle(request(source.url,{Origin:'https://evil.test'}))).status,404);assert.equal((await f.sources.handle(request(source.url,{},'POST'))).status,405);
 fs.unlinkSync(f.file);fs.symlinkSync(path.join(f.root,'unrelated.pdf'),f.file);await assert.rejects(f.sources.issue(f.notePath));assert.equal((await f.sources.handle(request(source.url))).status,404);
});

test('source note edits revoke existing tokens without changing the progress identity of an unchanged local book',async t=>{
 const f=fixture(t),before=await f.sources.issue(f.notePath);f.fields.title='只修改笔记标题';f.writeNote();assert.equal((await f.sources.handle(request(before.url))).status,409);const after=await f.sources.issue(f.notePath);assert.equal(before.sourceKey,after.sourceKey);assert.notEqual(before.url,after.url);
 fs.appendFileSync(f.file,'\nchanged');assert.equal((await f.sources.handle(request(after.url))).status,409);assert.notEqual((await f.sources.issue(f.notePath)).sourceKey,before.sourceKey);
});

test('changing a previously known external book mapping or archive state revokes access',async t=>{
 const external=fixture(t,{external:true}),source=await external.sources.issue(external.notePath);external.fields.source_file=path.join(external.root,'different.pdf');fs.writeFileSync(external.fields.source_file,'%PDF-1.7\nother');external.writeNote();await assert.rejects(external.sources.issue(external.notePath));assert.equal((await external.sources.handle(request(source.url))).status,404);
 const local=fixture(t),current=await local.sources.issue(local.notePath);local.fields.status='archived';local.writeNote();await assert.rejects(local.sources.issue(local.notePath),{code:'READER_SOURCE_UNAVAILABLE'});assert.equal((await local.sources.handle(request(current.url))).status,404);
});

test('current workspace hiding and gateway shutdown fail closed even for issued source capabilities',async t=>{
 const f=fixture(t);let visible=true;const sources=createReaderSources({gateway:f.gateway,isVisible:async()=>visible}),source=await sources.issue(f.notePath);visible=false;assert.equal((await sources.handle(request(source.url))).status,404);await assert.rejects(sources.issue(f.notePath),{code:'READER_SOURCE_UNAVAILABLE'});visible=true;f.gateway.dispose();assert.equal((await sources.handle(request(source.url))).status,404);sources.dispose();
});

test('source handles close for HEAD, complete reads, rejected ranges, and cancelled streaming bodies',async t=>{
 const f=fixture(t,{large:true}),source=await f.sources.issue(f.notePath),originalOpen=fs.promises.open;let opens=0,closes=0;
 fs.promises.open=async function(...args){const handle=await originalOpen.apply(this,args),close=handle.close.bind(handle);opens++;let closed=false;handle.close=async()=>{if(!closed){closed=true;closes++;}return close();};return handle;};t.after(()=>{fs.promises.open=originalOpen;});
 await f.sources.handle(request(source.url,{},'HEAD'));assert.equal(opens,closes);
 const small=await f.sources.handle(request(source.url,{Range:'bytes=0-31'}));await small.arrayBuffer();assert.equal(opens,closes);
 await f.sources.handle(request(source.url,{Range:'bytes=999999999-'}));assert.equal(opens,closes);
 const response=await f.sources.handle(request(source.url)),reader=response.body.getReader();await reader.read();await reader.cancel();await new Promise(resolve=>setImmediate(resolve));assert.equal(opens,closes);
});

test('EPUB imports require real EPUB container structure and are saved with an EPUB original',async t=>{
 const bytes=epub(),value=attachment(bytes);assert.equal(normalizeWorkspaceAttachment(value).type,'application/epub+zip');const captured=validateCaptureInput({operationId:'9a64f37d-e2a6-4a18-a011-a68b321c3450',title:'图书 EPUB',body:'',attachment:value});assert.match(captured.attachment.path,/\.epub$/);assert.equal(captured.attachment.type,'application/epub+zip');
 for(const invalid of [attachment(Buffer.from('not a ZIP')),attachment(zip([['example.txt','text']])),attachment(zip([['mimetype','application/epub+zip'],['META-INF/container.xml','x'],['OPS/book.opf','x'],['../escape','bad']])),attachment(bytes,'renamed.pdf')])assert.throws(()=>normalizeWorkspaceAttachment(invalid));
 const f=fixture(t,{type:'application/epub+zip'}),source=await f.sources.issue(f.notePath);assert.equal(source.type,'application/epub+zip');assert.deepEqual(Buffer.from(await (await f.sources.handle(request(source.url))).arrayBuffer()),bytes);
});

test('single-range parser accepts valid open and suffix bounds and clamps the last byte',()=>{assert.deepEqual(rangeOf('bytes=2-',10),{start:2,end:9,partial:true});assert.deepEqual(rangeOf('bytes=0-100',10),{start:0,end:9,partial:true});assert.deepEqual(rangeOf('bytes=-99',10),{start:0,end:9,partial:true});assert.equal(rangeOf('bytes=10-',10),null);});
