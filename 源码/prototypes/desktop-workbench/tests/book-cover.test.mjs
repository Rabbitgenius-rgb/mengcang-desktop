import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {coverSize,applyBookCover} from '../src/sublime/bookCover.js';
import {openEpub} from '../src/reader/epubReaderModel.js';
import {epubFixture} from './reader-epub-fixture.mjs';
import {workspaceReducer,createWorkspaceState,normalizeWorkspaceState,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';

test('cover thumbnail keeps aspect ratio and bounds pixel decoding',()=>{
 assert.deepEqual(coverSize(1200,2000),{width:540,height:900});assert.deepEqual(coverSize(1200,600),{width:600,height:300});assert.deepEqual(coverSize(20,30),{width:20,height:30});
 for(const [width,height]of [[0,20],[NaN,20],[Infinity,20],[20000,1],[8000,8000]])assert.throws(()=>coverSize(width,height),/尺寸/);
});
for(const version of ['2','3'])test(`EPUB ${version} embedded cover resolves through its safe manifest without changing bytes`,async()=>{
 const zip=await JSZip.loadAsync(await epubFixture({version}));let opf=await zip.file('OPS/package.opf').async('string');
 opf=version==='2'?opf.replace('</metadata>','<meta name="cover" content="image"/></metadata>'):opf.replace('id="image"','properties="cover-image" id="image"');zip.file('OPS/package.opf',opf);
 const bytes=await zip.generateAsync({type:'uint8array'}),original=bytes.slice(),book=await openEpub(bytes,{DOMParserClass:DOMParser});
 assert.equal(book.coverPath,'OPS/images/test.png');assert.equal((await book.image(book.coverPath)).type,'image/png');assert.deepEqual(bytes,original);
});
test('missing, remote and non-raster EPUB cover declarations do not fabricate covers or fetch URLs',async()=>{
 const plain=await openEpub(await epubFixture(),{DOMParserClass:DOMParser});assert.equal(plain.coverPath,null);
 for(const item of ['<item id="cover" href="https://example.com/a.png" properties="cover-image" media-type="image/png"/>','<item id="cover" href="images/test.png" properties="cover-image" media-type="image/svg+xml"/>']){
  const zip=await JSZip.loadAsync(await epubFixture());zip.file('OPS/package.opf',(await zip.file('OPS/package.opf').async('string')).replace('</manifest>',item+'</manifest>'));assert.equal((await openEpub(await zip.generateAsync({type:'uint8array'}),{DOMParserClass:DOMParser})).coverPath,null);
 }
});
test('saving a cover merges latest notes, original bytes, membership and reading state; backup readback keeps the image',()=>{
 const attachment={name:'book.pdf',type:'application/pdf',size:9,dataUrl:'data:application/pdf;base64,JVBERi0xLjQK'},expected={id:'cover-book',type:'book',title:'原书',attachment,image:''},image='data:image/jpeg;base64,/9j/';
 const latest={...expected,caption:'另一窗口更新的备注',body:'原正文',tags:['保留']},updated=applyBookCover(latest,expected,image);assert.equal(updated.caption,latest.caption);assert.strictEqual(updated.attachment,attachment);assert.equal(updated.type,'book');
 let state=createWorkspaceState();for(const action of [{type:'card.upsert',card:updated},{type:'card.save',id:updated.id,saved:true},{type:'collection.upsert',collection:{id:'group',title:'收藏',cardIds:[updated.id]}},{type:'draft.set',key:'reader:example',value:{page:7}}])state=workspaceReducer(state,action);
 const reopened=normalizeWorkspaceState(JSON.parse(serializeWorkspace(state)));assert.equal(reopened.cards[0].image,image);assert.deepEqual(reopened.cards[0].attachment,attachment);assert.deepEqual(reopened.collections[0].cardIds,[updated.id]);assert.equal(reopened.drafts['reader:example'].page,7);
});
test('a stale cover modal refuses changed originals, removed books and another window cover',()=>{
 const expected={id:'cover-book',type:'book',attachment:{name:'one.pdf',type:'application/pdf',size:9,dataUrl:'original'},image:''};
 for(const current of [null,{...expected,type:'file'},{...expected,origin:'vault'},{...expected,image:'new-cover'},{...expected,attachment:{...expected.attachment,dataUrl:'different'}}])assert.throws(()=>applyBookCover(current,expected,'data:image/jpeg;base64,/9j/'),/已变化/);
 assert.throws(()=>applyBookCover(expected,expected,'https://example.com/cover.jpg'),/无效/);
});
