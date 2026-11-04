import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClipperParams,clipperPayloadIdentity,normalizeClipperQuery,clipperPageKey} from '../src/clipper/contract.mjs';
import {normalizeWebAnchor,findQuoteAnchor,textFragmentUrl} from '../src/clipper/anchors.mjs';
import {normalizeArticleModel,articlePlainText} from '../src/clipper/article.mjs';
import {anchorFromSelection,rangeForAnchor} from '../src/clipper/anchors.mjs';
import {domFixture} from '../browser-extension/tests/dom-fixture.mjs';
const request=extra=>({version:1,requestId:'a1234567-1234-4234-8234-123456789abc',kind:'article',sourceUrl:'https://example.com/story',title:'Story',body:'Heading\n\nRead this link.',...extra});
const tree=()=>({version:1,blocks:[{id:'h',type:'heading',level:2,runs:[{text:'Heading'}]},{id:'p',type:'paragraph',runs:[{text:'Read this '},{text:'link.',href:'https://example.com/reference',strong:true}]},{id:'i',type:'image',src:'https://example.com/photo.png',alt:'原图',caption:'图注'}]});
test('article tree accepts only inert structured elements and safe ordinary links',()=>{
 const article=normalizeArticleModel(tree());assert.equal(articlePlainText(article),'Heading\n\nRead this link.');
 for(const href of ['javascript:alert(1)','data:text/html,test','https://name:password@example.com/','https://example.com/?access_token=secret']){
  const raw=tree();raw.blocks[1].runs[1].href=href;assert.throws(()=>normalizeArticleModel(raw));
 }
 for(const mutate of [raw=>raw.blocks.push({...raw.blocks[0]}),raw=>raw.blocks[0].onclick='bad',raw=>raw.blocks[0].level=7,raw=>raw.blocks[1].runs[0].html='<script>bad</script>']){
  const raw=tree();mutate(raw);assert.throws(()=>normalizeArticleModel(raw));
 }
});
const tableTree=()=>({version:1,blocks:[{id:'list',type:'list-item',marker:'3.',depth:1,runs:[{text:'编号项'}]},{id:'table',type:'table',rows:[{cells:[{runs:[],header:false},{runs:[{text:'列二',href:'https://example.com/reference',strong:true}],header:true,colspan:2,rowspan:2}]}],imagesAfter:true}]});
test('additive tables and list markers normalize and export without changing legacy list text',()=>{
 const raw=tableTree(),safe=normalizeArticleModel(raw);
 assert.deepEqual(safe,raw);assert.equal(articlePlainText(safe),'3. 编号项\n\n\t列二');
 const legacy={version:1,blocks:[{id:'old',type:'list-item',runs:[{text:'旧项目'}]}]};
 assert.deepEqual(normalizeArticleModel(legacy),legacy);assert.equal(articlePlainText(legacy),'旧项目');
 const noImages=tableTree();noImages.blocks[1].imagesAfter=false;assert.equal(Object.hasOwn(normalizeArticleModel(noImages).blocks[1],'imagesAfter'),false);
 const input=request({article:raw,body:articlePlainText(raw)}),changed=structuredClone(input);changed.article.blocks[0].marker='4.';
 assert.notDeepEqual(clipperPayloadIdentity(input),clipperPayloadIdentity(changed));
 const changedCell=structuredClone(input);changedCell.article.blocks[1].rows[0].cells[1].runs[0].text='另一列';assert.notDeepEqual(clipperPayloadIdentity(input),clipperPayloadIdentity(changedCell));
});
test('table and list additions keep strict shapes, safe runs and shared article budgets',()=>{
 for(const mutate of [
  raw=>raw.blocks[0].marker='bad\nmarker',raw=>raw.blocks[0].depth=21,raw=>raw.blocks[0].rows=[],
  raw=>raw.blocks[1].runs=[{text:'错误字段'}],raw=>raw.blocks[1].imagesAfter='yes',
  raw=>raw.blocks[1].rows[0].onclick='bad',raw=>raw.blocks[1].rows[0].cells[0].header=1,
  raw=>raw.blocks[1].rows[0].cells[0].colspan=0,raw=>raw.blocks[1].rows[0].cells[0].rowspan=101,
  raw=>raw.blocks[1].rows[0].cells[1].runs[0].href='javascript:alert(1)',
  raw=>raw.blocks[1].rows[0].cells[1].html='<script>bad</script>',
  raw=>raw.blocks[1].rows=Array.from({length:201},()=>({cells:[{runs:[],header:false}]})),
  raw=>raw.blocks[1].rows[0].cells=Array.from({length:101},()=>({runs:[],header:false})),
  raw=>raw.blocks[1].rows=Array.from({length:21},()=>({cells:Array.from({length:100},()=>({runs:[],header:false}))})),
  raw=>raw.blocks[1].rows[0].cells=Array.from({length:3},()=>({runs:[],header:false,colspan:100})),
  raw=>raw.blocks[1].rows[0].cells[0].runs=Array.from({length:513},()=>({text:'x'})),
  raw=>raw.blocks[1].rows=Array.from({length:20},()=>({cells:Array.from({length:100},()=>({runs:Array.from({length:6},()=>({text:'x'})),header:false}))})),
  raw=>raw.blocks[1].rows[0].cells[0].runs=Array.from({length:3},()=>({text:'x'.repeat(50000)})),
 ]) {const raw=tableTree();mutate(raw);assert.throws(()=>normalizeArticleModel(raw),{code:'INVALID_ARTICLE'});}
});
test('derived download failures and bytes do not change a rich capture retry identity',()=>{
 const raw=request({article:tree(),note:'备注',favorite:true,collectionIds:[]});
 const derived=structuredClone(raw);derived.article.blocks[2].imageError='network unavailable';
 assert.deepEqual(clipperPayloadIdentity(raw),clipperPayloadIdentity(derived));
 assert.throws(()=>normalizeClipperParams(raw,{requireImageAttachment:true}),{code:'IMAGE_NOT_DOWNLOADED'});
 assert.doesNotThrow(()=>normalizeClipperParams(derived,{requireImageAttachment:true}));
 assert.notDeepEqual(clipperPayloadIdentity(raw),clipperPayloadIdentity({...raw,note:'其他备注'}));
});
test('article inline originals bind their bytes and metadata because there is no derived URL',()=>{
 const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 const attachment={name:'one.png',type:'image/png',size:Buffer.from(encoded,'base64').length,dataUrl:'data:image/png;base64,'+encoded};
 const raw=request({article:{version:1,blocks:[{id:'inline',type:'image',attachment}]}}),changed=structuredClone(raw);
 changed.article.blocks[0].attachment.name='different.png';
 assert.notDeepEqual(clipperPayloadIdentity(raw),clipperPayloadIdentity(changed));
});
test('highlight body must match its normalized selector and position length',()=>{
 const anchor={version:1,exact:'一段 原文',prefix:'前文',suffix:'后文',start:3,end:8};
 assert.equal(normalizeClipperParams(request({kind:'highlight',body:'一段\n 原文',anchor})).anchor.exact,'一段 原文');
 assert.throws(()=>normalizeClipperParams(request({kind:'highlight',body:'另一段原文',anchor})));
 assert.throws(()=>normalizeWebAnchor({...anchor,end:7}));
 assert.equal(findQuoteAnchor('前文 一段 原文 后文',anchor)?.start,3);
 assert.equal(findQuoteAnchor('same repeated same repeated',{version:1,exact:'same',prefix:'',suffix:''}),null);
 assert.equal(findQuoteAnchor('x same a y same b',{version:1,exact:'same',prefix:'y',suffix:'b'}).start,11);
});
test('text fragments encode delimiters and keep long selected passages practical',()=>{
 const href=textFragmentUrl('https://example.com/story#old',{version:1,exact:'文字-逗号,符号&x',prefix:'前文',suffix:'后文'});
 assert.match(href,/#:~:text=/);assert.ok(href.includes('%2D'));assert.ok(href.includes('%2C'));assert.ok(href.includes('%26'));
 const long=textFragmentUrl('https://example.com/story',{version:1,exact:'长'.repeat(50000),prefix:'前',suffix:'后'});assert.ok(long.length<2000);
 assert.throws(()=>textFragmentUrl('javascript:alert(1)',{version:1,exact:'text'}));
});
test('native text fragments use block-local contexts without discarding the full quote context',()=>{
 const anchor={version:1,exact:'第一段 选文 第二段',prefix:'前面标题 正文前文',suffix:'正文后文 后面标题',textFragment:{start:'第一段',end:'第二段',prefix:'正文前文',suffix:'正文后文'}};
 const url=textFragmentUrl('https://example.com/story',anchor);
 assert.ok(url.includes(encodeURIComponent('正文前文')+'-,'));assert.ok(!url.includes(encodeURIComponent('前面标题')));
 assert.ok(url.endsWith(',-'+encodeURIComponent('正文后文')));
 assert.throws(()=>normalizeWebAnchor({...anchor,textFragment:{...anchor.textFragment,start:'无关文字'}}));
});
test('non-display control characters cannot inflate a page quote beyond the native frame budget',()=>{
 assert.throws(()=>normalizeWebAnchor({version:1,exact:'\u0001'.repeat(50000)}));
 assert.equal(normalizeWebAnchor({version:1,exact:'正常\t选文\n末尾'}).exact,'正常 选文 末尾');
});
test('native hints never collapse distinct repeated paragraphs into the same wrong location',()=>{
 const {document,element}=domFixture();
 const one=element('p',{},'同一句话。'),two=element('p',{},'同一句话。');
 const root=element('article',{},element('h2',{},'第一节'),one,element('h2',{},'第二节'),two);document.body=element('body',{},root);
 const select=paragraph=>{
  const node=paragraph.childNodes[0],range={startContainer:node,startOffset:0,endContainer:node,endOffset:node.nodeValue.length,intersectsNode:value=>value===node,isPointInRange:(value,offset)=>value===node&&offset>=0&&offset<=node.nodeValue.length};
  return anchorFromSelection(root,{rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=>node.nodeValue});
 };
 const first=select(one),second=select(two);
 assert.notDeepEqual(first.prefix,second.prefix);assert.ok(rangeForAnchor(root,first));assert.ok(rangeForAnchor(root,second));
 assert.equal(first.textFragment,null);assert.equal(second.textFragment,null);
 assert.throws(()=>textFragmentUrl('https://example.com/page',second),{code:'AMBIGUOUS_TEXT_FRAGMENT'});
});
test('native hint uniqueness also checks case-insensitive browser matches',()=>{
 const {document,element}=domFixture(),one=element('p',{},'Hello world.'),two=element('p',{},'hello world.');
 const root=element('article',{},element('h2',{},'First'),one,element('h2',{},'Second'),two);document.body=element('body',{},root);
 const node=two.childNodes[0],range={startContainer:node,startOffset:0,endContainer:node,endOffset:node.nodeValue.length,intersectsNode:value=>value===node,isPointInRange:(value,offset)=>value===node&&offset>=0&&offset<=node.nodeValue.length};
 const anchor=anchorFromSelection(root,{rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=>node.nodeValue});
 assert.equal(anchor.textFragment,null);assert.ok(rangeForAnchor(root,anchor));
});
test('query bounds and page matching keep fragments distinct from query identity',()=>{
 assert.equal(clipperPageKey('https://example.com/story?q=one#here'),'https://example.com/story?q=one');
 assert.notEqual(clipperPageKey('https://example.com/story?q=one'),clipperPageKey('https://example.com/story?q=two'));
 assert.throws(()=>normalizeClipperQuery('highlights',{sourceUrl:'https://example.com/',limit:51}));
 assert.throws(()=>normalizeClipperQuery('collections',{sourceUrl:'https://example.com/'}));
});
