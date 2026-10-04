import test from 'node:test';
import assert from 'node:assert/strict';
import {valueOf,draftFields,patchFields,mergeSavedDraft,noteDraftKey,normalizeRecord,rebaseDraft,connectionErrorMessage,searchText} from '../src/desktopModel.js';

test('conflict code survives IPC envelope for draft recovery',()=>{
 assert.throws(()=>valueOf({ok:false,error:{code:'CONFLICT',message:'changed'}}),e=>e.code==='CONFLICT');
 assert.deepEqual(valueOf({ok:true,data:{revision:2}}),{revision:2});
});
test('offline refresh preserves the specific pairing or gateway failure',()=>{
 const noCache={code:'OFFLINE_NO_CACHE',message:'尚未连接，也没有此仓库的离线缓存'};
 const tls={code:'TLS_ERROR',message:'本机证书验证失败，请核对配对证书',connected:false};
 const persist={code:'ENOSPC',message:'本机配对保存失败'};
 assert.equal(connectionErrorMessage(noCache,tls,null),tls.message);
 assert.equal(connectionErrorMessage(noCache,tls,persist),persist.message);
 assert.equal(connectionErrorMessage(noCache,{code:'UNPAIRED',message:'尚未连接 Obsidian'},null),noCache.message);
 const malformed={code:'INVALID_RESPONSE',message:'仓库返回的数据不完整'};
 assert.equal(connectionErrorMessage(malformed,tls,persist),malformed.message);
});
test('drafts are isolated by actual Vault identity and note path',()=>{
 assert.notEqual(noteDraftKey({id:'A'},'same.md'),noteDraftKey({id:'B'},'same.md'));
 assert.notEqual(noteDraftKey({id:'A'},'one.md'),noteDraftKey({id:'A'},'two.md'));
});
test('restored draft retains original hash and edits after external update',()=>{
 const note={path:'inspiration.md',hash:'new',role:'seed',description:'server',tags:['a'],fields:{}};
 const saved={path:note.path,baseHash:'old',baseValues:{role:'seed',category:'',caption:'old',tags:'a'},form:{role:'material',category:'画面',caption:'my edit',tags:'a，b'},exploration:'unsaved exploration',operationId:'retry-id'};
 const result=mergeSavedDraft(saved,note);
 assert.equal(result.baseHash,'old');assert.equal(result.form.caption,'my edit');assert.equal(result.operationId,'retry-id');
 assert.equal(result.exploration,'unsaved exploration');
});
test('field patch changes only edited fields and explicitly confirms changed role',()=>{
 const base={role:'seed',category:'旧',caption:'原配文',tags:'自然，月亮'};
 assert.deepEqual(patchFields({...base},base),{});
 assert.deepEqual(patchFields({...base,caption:'新配文'},base),{caption:'新配文'});
 assert.deepEqual(patchFields({...base,role:'material',tags:'自然,月亮'},base),{role:'material',role_status:'confirmed'});
});
test('real records never choose demo art or invent reading state',()=>{
 const record={id:'x',path:'book.md',title:'真实书籍',kind:'book',fields:{},hash:'a',body:'正文'};
 const actual=normalizeRecord(record,{assetUrl:path=>`asset:${path}`});
 assert.equal(actual.real,true);assert.equal(actual.art,undefined);assert.equal(actual.assetUrl,'');assert.equal(actual.status,'unknown');
 assert.equal(actual.totalPages,0);
 const image=normalizeRecord({...record,kind:'image',attachmentPath:'assets/moon.png'},{assetUrl:path=>`asset:${path}`});
 assert.equal(image.assetUrl,'asset:assets/moon.png');assert.equal(image.type,'image');
});
test('draft restoration does not borrow edits from a different record',()=>{
 const note={path:'new.md',hash:'current',description:'current caption',fields:{},tags:[]};
 const actual=mergeSavedDraft({path:'other.md',baseHash:'old',form:{caption:'wrong'}},note);
 assert.equal(actual.form.caption,'current caption');assert.equal(actual.baseHash,'current');
 assert.deepEqual(draftFields(note),{role:'seed',category:'',tags:'',caption:'current caption'});
});

test('conflict review preserves server changes to fields the user did not edit',()=>{
 const draft={baseHash:'old',baseValues:{role:'seed',category:'old category',caption:'old caption',tags:'a'},form:{role:'seed',category:'old category',caption:'my caption',tags:'a'},exploration:'my draft',operationId:'op-old'};
 const current={hash:'new',role:'material',category:'server category',description:'server caption',tags:['server'],fields:{}};
 const rebased=rebaseDraft(draft,current);
 assert.equal(rebased.form.caption,'my caption');assert.equal(rebased.form.category,'server category');assert.equal(rebased.form.role,'material');assert.equal(rebased.form.tags,'server');
 assert.deepEqual(patchFields(rebased.form,rebased.baseValues),{caption:'my caption'});assert.equal(rebased.exploration,'my draft');assert.equal(rebased.operationId,'op-old');
});

test('uncertain exploration retry retains its stable ID across conflict review',()=>{
 const base={role:'seed',category:'',caption:'',tags:''};
 const draft={baseValues:base,form:base,exploration:'my text',operationId:'stable-operation'};
 const current={hash:'new',fields:{},tags:[],explorations:[]};
 assert.equal(rebaseDraft(draft,current).operationId,'stable-operation');
 const acknowledged=rebaseDraft(draft,{...current,explorations:[{id:'stable-operation',text:'my text'}]});
 assert.equal(acknowledged.exploration,'');assert.equal(acknowledged.operationId,null);
});

test('list summary is independent of explicitly empty caption',()=>{
 const record={id:'x',path:'01_sources/cards/text/x.md',kind:'entry',title:'记录',description:'',fields:{caption:'',summary:'已整理的列表摘要'},tags:[]};
 const normalized=normalizeRecord(record,{assetUrl:()=>''});
 assert.equal(normalized.summary,'已整理的列表摘要');assert.equal(draftFields(record).caption,'');
});

test('search finds independent captions and display fields across raw and normalized records',()=>{
 const record={kind:'entry',title:'An Evening',description:'list description',body:'正文片段',tags:['纸张纹理'],fields:{summary:'整理摘要',caption:'独立配文关键词',category:'影像与叙事',url:'https://source.example/quiet',author:'作者甲'}};
 const normalized=normalizeRecord(record,{assetUrl:()=>''});
 for(const item of [record,normalized]) {
  const searchable=searchText(item);
  for(const keyword of ['an evening','list description','正文片段','纸张纹理','整理摘要','独立配文关键词','影像与叙事','source.example/quiet','作者甲']) assert.ok(searchable.includes(keyword),keyword);
 }
 const demo={title:'预览记录',summary:'示例摘要',caption:'示例配文',source:'来源文字',author:'示例作者',category:'示例分类'};
 for(const value of Object.values(demo)) assert.ok(searchText(demo).includes(value));
});

test('search omits internal metadata and relation payloads while retaining reader content',()=>{
 const record={title:'书架',id:'private-id',path:'private-path.md',hash:'private-hash',body:'正文\n\n<!-- mengcang-relations:start -->\nprivate-relation-id\n<!-- mengcang-relations:end -->\n\n<!-- mengcang:private-comment -->',fields:{operation_id:'private-operation',project_ids:['private-project'],author:{secret:'private-object'},caption:'配文'},explorations:[{id:'private-exploration-id',text:'继续思考'}]};
 const searchable=searchText(record);
 assert.ok(searchable.includes('正文'));assert.ok(searchable.includes('配文'));assert.ok(searchable.includes('继续思考'));
 assert.equal(searchable.includes('private-'),false);assert.equal(searchable.includes('[object object]'),false);
});


test('inspiration date keeps source creation ahead of capture date',()=>{
 const record={kind:'entry',fields:{created_at:'2026-08-10T11:00:00Z',captured_at:'2026-09-16T07:56:16Z'}};
 const actual=normalizeRecord(record,{assetUrl:()=>''});
 assert.equal(actual.date,'2026-08-10T11:00:00Z');assert.equal(actual.dateLabel,'');
});
test('undated fragments do not borrow capture or source modification dates',()=>{
 const record={kind:'entry',fields:{provenance:'fragment',created_at:null,captured_at:'2026-09-16T07:56:16Z',source_updated:'2026-09-12T16:32:24Z'}};
 const before=JSON.stringify(record);const actual=normalizeRecord(record,{assetUrl:()=>''});
 assert.equal(actual.date,'');assert.equal(actual.dateLabel,'日期待考');assert.equal(JSON.stringify(record),before);
 assert.equal(normalizeRecord({kind:'image',fields:record.fields},{assetUrl:()=>''}).date,record.fields.captured_at);
});
test('cover image is used instead of a pattern JSON source',()=>{
 const seen=[];const api={assetUrl:path=>{seen.push(path);return `asset:${path}`;}};
 const actual=normalizeRecord({kind:'pattern',attachmentPath:'01_sources/_originals/pattern.json',fields:{cover:'[[01_sources/cards/images/pattern.PNG|图案]]'}},api);
 assert.equal(actual.assetUrl,'asset:01_sources/cards/images/pattern.PNG');assert.deepEqual(seen,['01_sources/cards/images/pattern.PNG']);
 const resolved=normalizeRecord({kind:'book',coverPath:'01_sources/books/covers/resolved.jpg',fields:{cover:'[[unresolved.jpg]]'}},api);
 assert.equal(resolved.assetUrl,'asset:01_sources/books/covers/resolved.jpg');
});
test('missing cover can fall back to an actual image attachment',()=>{
 const actual=normalizeRecord({kind:'image',attachmentPath:'01_sources/_originals/photo.webp',fields:{cover:'invalid.json'}},{assetUrl:path=>`asset:${path}`});
 assert.equal(actual.assetUrl,'asset:01_sources/_originals/photo.webp');
});
test('thumbnail selection rejects JSON, PDF, external, and unsafe image paths',()=>{
 for(const attachmentPath of ['source.json','book.pdf','https://example.com/a.png','file:///a.png','../a.png','images/../a.png','/a.png','images//a.png','images/./a.png','images\\a.png','images/\u0000a.png']) {
  const actual=normalizeRecord({kind:'pattern',attachmentPath,fields:{cover:attachmentPath}},{assetUrl:()=>assert.fail('Unsafe or non-image path requested')});
  assert.equal(actual.assetUrl,'');
 }
});
