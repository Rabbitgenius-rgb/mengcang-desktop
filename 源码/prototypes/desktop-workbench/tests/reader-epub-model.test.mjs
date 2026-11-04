import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {epubFixture} from './reader-epub-fixture.mjs';
import {normalizeWorkspaceAttachment} from '../src/sublime/workspaceModel.js';
import {EPUB_LIMITS,epubChapterIndex,epubProgress,inspectEpubZip,openEpub,rasterDimensions,rasterMime,readEpubSource,resolveEpubHref,safeArchivePath,sanitizeEpubChapter,searchEpub} from '../src/reader/epubReaderModel.js';

class StrictParser{parseFromString(text,type){const errors=[];const parsed=new DOMParser({errorHandler:{warning:error=>errors.push(error),error:error=>errors.push(error),fatalError:error=>errors.push(error)}}).parseFromString(text,type);if(errors.length)throw Error('XML 格式损坏。');return parsed;}}
const options={DOMParserClass:StrictParser};
test('EPUB fixtures pass the real attachment import boundary with their first mimetype member uncompressed',async()=>{
 for(const version of ['2','3']){
  const bytes=await epubFixture({version,malicious:true,doctype:true}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(8,true),0);assert.equal(view.getUint32(18,true),20);assert.equal(new TextDecoder().decode(bytes.subarray(30,38)),'mimetype');assert.equal(new TextDecoder().decode(bytes.subarray(38,58)),'application/epub+zip');
  const attachment={name:`reader-fixture-${version}.epub`,type:'application/epub+zip',size:bytes.length,dataUrl:'data:application/epub+zip;base64,'+Buffer.from(bytes).toString('base64')};assert.deepEqual(normalizeWorkspaceAttachment(attachment),attachment);
 }
});
test('EPUB 3 reads Chinese spine, nested navigation, relative image and internal anchors',async()=>{
 const bytes=await epubFixture(),before=Uint8Array.from(bytes),book=await openEpub(bytes,options);
 assert.equal(book.chapters.length,2);assert.equal(book.title,'梦藏 EPUB 中文验收');assert.equal(book.author,'本机合成样本');assert.equal(book.chapters[0].title,'第一章 春日');assert.match(book.chapters[0].text,/春日的花朵/);assert.equal(book.outline[0].title,'开篇 春日');assert.equal(book.outline[0].children[0].chapter,1);assert.deepEqual(book.resolveHref('OPS/text/two.xhtml#note'),{chapter:1,fragment:'note'});assert.equal(book.resolveHref('OPS/unknown.xhtml'),null);assert.deepEqual(book.chapters[0].images,['OPS/images/test.png']);assert.equal((await book.image('OPS/images/test.png')).type,'image/png');assert.deepEqual(bytes,before);
});
test('EPUB 2 reads NCX outline and removes a standard external XHTML doctype without resolving it',async()=>{
 const book=await openEpub(await epubFixture({version:'2',doctype:true}),options);assert.equal(book.outline[0].title,'第一章 NCX');assert.equal(book.outline[1].href,'OPS/text/two.xhtml#note');assert.match(book.chapters[0].text,/中文摘录/);
});
test('EPUB rendering tree excludes scripts, event handlers, styles, SVG, frames and remote images and links',async()=>{
 const book=await openEpub(await epubFixture({malicious:true}),options),tree=JSON.stringify(book.chapters[0].tree);
 for(const forbidden of ['EPUB_ATTACK','background','evil()','<script','javascript:','https://','unsafe','onclick','imagePath":"secret'])assert.equal(tree.includes(forbidden),false,forbidden);
 assert.match(book.chapters[0].text,/远程链接/);assert.match(book.chapters[0].text,/安全正文/);assert.deepEqual(book.chapters[0].images,['OPS/images/test.png']);
});
test('EPUB path resolution handles safe parent-relative paths and denies escaping, schemes, encoded separators and control characters',()=>{
 assert.deepEqual(resolveEpubHref('OPS/text/one.xhtml','../images/test.png'),{path:'OPS/images/test.png',fragment:'',href:'OPS/images/test.png'});
 assert.deepEqual(resolveEpubHref('OPS/text/one.xhtml','#中文'),{path:'OPS/text/one.xhtml',fragment:'中文',href:'OPS/text/one.xhtml#中文'});
 for(const value of ['../../../secret','https://evil.test/','//evil.test/pixel','file:///secret','javascript:bad()','%2fsecret','..%5csecret','%00secret','../a?remote=1','bad#%00'])assert.equal(resolveEpubHref('OPS/text/one.xhtml',value),null,value);
 for(const value of ['../a','/a','a\\b','a/../b','a//b','a\u0000b','a/./b','http:x'])assert.equal(safeArchivePath(value),null,value);
 assert.equal(safeArchivePath('OPS/中国/'), 'OPS/中国/');
});
test('zip directory checks reject traversal before JSZip can silently sanitize it',async()=>{
 const bytes=await epubFixture({extra:{'../outside.xhtml':'<html/>'}});assert.throws(()=>inspectEpubZip(bytes),/不安全/);await assert.rejects(openEpub(bytes,options),/不安全/);
});
test('zip directory caps, corruption, encryption and huge expansion are rejected before decompression',async()=>{
 const bytes=await epubFixture();assert.throws(()=>inspectEpubZip(bytes,{...EPUB_LIMITS,files:1}),/数量/);assert.throws(()=>inspectEpubZip(bytes.slice(0,bytes.length-12)),/目录/);
 const bomb=await epubFixture({extra:{'OPS/large.txt':'a'.repeat(2*1024*1024)}});assert.throws(()=>inspectEpubZip(bomb),/解压体积/);
 const encrypted=bytes.slice(),view=new DataView(encrypted.buffer);for(let i=0;i<encrypted.length-4;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint16(i+8,view.getUint16(i+8,true)|1,true);break;}assert.throws(()=>inspectEpubZip(encrypted),/加密/);
});
test('DRM resources, DTD entity expansion, malformed XML and missing spine fail clearly',async()=>{
 await assert.rejects(openEpub(await epubFixture({extra:{'META-INF/encryption.xml':'<encryption/>'}}),options),/加密资源/);
 for(const xml of ['<!DOCTYPE html [<!ENTITY x "boom">]><html><body>&x;</body></html>','<html><body><p>broken</body></html>'])assert.throws(()=>sanitizeEpubChapter(xml,{path:'OPS/a.xhtml',...options}),/实体|格式损坏/);
 const zip=await JSZip.loadAsync(await epubFixture());zip.file('OPS/package.opf','<package><manifest/></package>');await assert.rejects(openEpub(await zip.generateAsync({type:'uint8array'}),options),/章节/);
});
test('search returns exact original-text offsets across chapters and treats punctuation literally',async()=>{
 const book=await openEpub(await epubFixture({chapter2Text:'第二章 中文摘录。a.b 与 😀 中文摘录。'}),options),hits=searchEpub(book,'中文摘录');assert.equal(hits.length,3);for(const hit of hits)assert.equal(book.chapters[hit.chapter].text.slice(hit.start,hit.end),'中文摘录');assert.equal(searchEpub(book,'a.b').length,1);assert.equal(searchEpub(book,'[bad]').length,0);assert.equal(searchEpub(book,'中文摘录',{limit:1}).length,1);assert.deepEqual(searchEpub(book,''),[]);
});
test('selection offset inputs clamp without manufacturing a different chapter or progress',()=>{assert.equal(epubChapterIndex(-10,4),0);assert.equal(epubChapterIndex(100,4),3);assert.equal(epubChapterIndex(NaN,4),0);assert.equal(epubProgress(Infinity),0);assert.equal(epubProgress(2),1);});
test('raster decoding only permits supported magic bytes, never SVG disguised by filename',()=>{assert.equal(rasterMime(new TextEncoder().encode('<svg><script>bad()</script></svg>')),null);assert.equal(rasterMime(Uint8Array.of(255,216,255)),'image/jpeg');});
test('EPUB source never fetches external or credentialed URLs; local source bytes are unchanged',async()=>{
 let calls=0;const bytes=await epubFixture(),fetcher=async()=>{calls++;return new Response(bytes,{headers:{'content-type':'application/epub+zip'}});};
 for(const url of ['https://evil.test/book.epub','file:///etc/passwd','http://evil.test/book.epub','ftp://localhost/file','http://user:pass@localhost/book.epub'])await assert.rejects(readEpubSource({url},{fetcher}),/本机文件/);
 assert.equal(calls,0);const loaded=await readEpubSource({url:'mengcang-reader://source/book-token'},{fetcher});assert.equal(calls,1);assert.deepEqual(loaded,bytes);
 const dataUrl='data:application/epub+zip;base64,'+Buffer.from(bytes).toString('base64');assert.deepEqual(await readEpubSource({dataUrl}),bytes);
 await assert.rejects(readEpubSource({dataUrl:'data:text/html;base64,PHNjcmlwdD4='}),/无效/);
});
test('raster dimensions reject tiny compressed files declaring enormous decoded images',async()=>{
 const bytes=await epubFixture(),zip=await JSZip.loadAsync(bytes),image=await zip.file('OPS/images/test.png').async('uint8array');
 assert.deepEqual(rasterDimensions(image),{width:1,height:1});const forged=image.slice(),view=new DataView(forged.buffer);view.setUint32(16,65535);view.setUint32(20,65535);zip.file('OPS/images/test.png',forged);const book=await openEpub(await zip.generateAsync({type:'uint8array'}),options);assert.equal(await book.image('OPS/images/test.png'),null);
});
test('cancelled EPUB loading aborts without requesting any resource or cloud service',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(openEpub(await epubFixture(),{...options,signal:controller.signal}),error=>error.name==='AbortError');});
