import test from 'node:test';
import assert from 'node:assert/strict';
import {relatedResults,relatedCardPreview,relatedSourceKey,normalizeRelatedView} from '../src/sublime/relatedBrowser.js';
import {nativeRelated,personalRelations} from '../src/sublime/personalRelated.js';
import {relatedSemanticText,centeredRelatedEmbeddings,supportedRelatedIds} from '../src/sublime/relatedEmbeddings.js';
import {rankEmbeddings} from '../src/sublime/intelligenceHelpers.js';

function fixture(){
 const source={id:'anchor',type:'article',title:'Knowledge architecture',body:'A unique reference about connections.',sourceUrl:'https://example.org/reference'};
 const same=Array.from({length:9},(_,i)=>({id:'same-'+i,type:i%2?'image':'highlight',title:'Source item '+i,body:'Different excerpt '+i,sourceUrl:source.sourceUrl+'#figure-'+i}));
 const other=Array.from({length:14},(_,i)=>({id:'other-'+i,type:i%2?'image':'text',title:'Different material '+i,body:'Independent idea '+i,sourceUrl:'https://example.org/other-'+i}));
 const library=[source,...same,...other],exact=personalRelations(source,library,[]);
 const semantic=other.map((card,i)=>({id:card.id,score:.9-i*.01,reason:'文字意思相近 · 本机匹配'}));
 return {source,library,exact,semantic};
}
test('same-page items do not fill recommendations, later pages stay diverse and only own visible IDs are accepted',()=>{
 const f=fixture(),before=structuredClone(f.library);
 const result=relatedResults(f.source,f.library,f.exact,[...f.semantic,{id:'hidden-or-foreign',score:1}]);
 assert.equal(result.items.length,6);assert.equal(result.total,15);assert.equal(result.sourceCount,9);
 assert.equal(new Set(result.items.map(x=>x.group)).size,6);assert(result.items.some(x=>!x.sameSource));
 const more=relatedResults(f.source,f.library,f.exact,f.semantic,{limit:12});
 assert.deepEqual(more.items.slice(0,6),result.items);assert.equal(more.items.length,12);
 assert(more.items.filter(x=>x.sameSource).length<=1);assert(!more.items.some(x=>x.id==='hidden-or-foreign'));
 assert.equal(relatedResults(f.source,f.library,f.exact,f.semantic,{limit:18}).items.filter(x=>x.sameSource).length,1);
 assert.deepEqual(f.library,before);
});
test('type and source filters compose before pagination, reset is valid and distinct excerpts are retained',()=>{
 const f=fixture();
 const same=relatedResults(f.source,f.library,f.exact,f.semantic,{scope:'source',limit:12});
 assert.equal(same.total,9);assert(same.items.every(x=>x.sameSource));
 const images=relatedResults(f.source,f.library,f.exact,f.semantic,{scope:'source',type:'image',limit:12});
 assert.equal(images.total,4);assert(images.items.every(x=>x.card.type==='image'));
 const content=relatedResults(f.source,f.library,f.exact,f.semantic,{scope:'content'});
 assert.equal(content.total,14);assert(content.items.every(x=>!x.sameSource));
 assert.equal(relatedResults(f.source,f.library,f.exact,f.semantic,{type:'audio'}).total,0);
 assert.deepEqual(normalizeRelatedView({type:'bad',scope:'bad',limit:-8}),{type:'all',scope:'all',sort:'relevance',limit:6,filtersOpen:false});
});
test('parent figures share the source group; different articles on one website stay distinct',()=>{
 const parent={id:'p',sourceUrl:'https://example.org/article'},a={id:'a',sourceCardId:'p'},b={id:'b',sourceCardId:'p'},other={id:'o',sourceUrl:'https://example.org/another'};
 const byId=new Map([parent,a,b,other].map(c=>[c.id,c]));
 assert.equal(relatedSourceKey(a,byId),relatedSourceKey(b,byId));assert.notEqual(relatedSourceKey(a,byId),relatedSourceKey(other,byId));
 const c={id:'c',sourceCardId:'d'},d={id:'d',sourceCardId:'c'},loop=new Map([[c.id,c],[d.id,d]]);
 assert.equal(relatedSourceKey(c,loop),relatedSourceKey(d,loop));
});
test('same-title originals and excerpts are not deleted; remote covers are not requested for previews',()=>{
 const f=fixture(),sameTitle={id:'diff',title:f.source.title,body:'A distinct excerpt to preserve.',sourceUrl:'https://other.example/a'};
 const r=relatedResults(f.source,[...f.library,sameTitle],[],[{id:sameTitle.id,score:.8,reason:'相近'}]);
 assert.equal(r.items[0].id,'diff');
 const original={title:'Title',body:'# Title\n\n## A real paragraph\n\n[More details](https://example.org)\n![[private-file.png]]',image:'https://remote.example/tracking.png',sourceUrl:'https://example.org/a'};
 const before=structuredClone(original),preview=relatedCardPreview(original);
 assert.equal(preview.image,'');assert.match(preview.text,/A real paragraph/);assert.doesNotMatch(preview.text,/private-file|https:|^#/);
 assert.equal(preview.origin,'example.org');assert.deepEqual(original,before);
});
test('semantic results can exceed the old eight-result limit without new network or persistence APIs',async()=>{
 const library=Array.from({length:16},(_,i)=>({id:'c'+i,title:'Original '+i,body:'Idea '+i})),cache=new Map();
 let calls=0;
 const embed=async batch=>{calls++;return {embeddings:batch.map(c=>({id:c.id,vector:[1,.2],model:'fixture',language:'zh'}))};};
 const results=await nativeRelated(library[0],library,cache,embed,()=>true,{limit:library.length});
 assert.equal(results.length,15);assert(results.every(x=>x.score>=.55));
 await nativeRelated(library[0],library,cache,embed,()=>true,{limit:library.length});assert.equal(calls,1);
});
test('recommendations discard import bookkeeping and filename-only images without changing originals',()=>{
 const card={title:'IMG_4458.png',body:'# IMG_4458.png\n\n## 资料\n![[01_sources/picture.png]]\n\n## 出处\n[[notes/source|原始记录]] · 原位置 1044'};
 const before=structuredClone(card);assert.equal(relatedSemanticText(card),'');assert.deepEqual(card,before);
 assert.equal(relatedSemanticText({...card,ocrText:'Information management and connected documents'}),'Information management and connected documents');
 assert.match(relatedSemanticText({title:'节点网络',body:'## 原始灵感\n节点让不同资料相连。\n## 整理状态\n当前状态：待整理'}),/节点让不同资料相连/);
 assert.doesNotMatch(relatedSemanticText({title:'节点网络',body:'## 整理状态\n当前状态：待整理'}),/待整理/);
});
test('a shared native embedding background cannot fill recommendations with weak or identical matches',()=>{
 const vectors=[[10,1,0],[10,1,.1],[10,-1,0],[10,0,3]].map((vector,i)=>({id:String(i),vector,model:'local',language:'zh'}));
 const before=structuredClone(vectors),centered=centeredRelatedEmbeddings(vectors);
 assert.deepEqual(rankEmbeddings(centered,'0').filter(x=>x.score>=.55).map(x=>x.id),['1']);assert.deepEqual(vectors,before);
 const identical=vectors.map(x=>({...x,vector:[1,.25]}));assert.deepEqual(rankEmbeddings(centeredRelatedEmbeddings(identical),'0'),[]);
 const mixed=[...vectors,{id:'en',model:'local',language:'en',vector:[10,1,0]}];assert(!rankEmbeddings(centeredRelatedEmbeddings(mixed),'0').some(x=>x.id==='en'));
});
test('passive native recommendations require distinctive content evidence beyond a high embedding score',()=>{
 const candidates=[{id:'s',text:'万维网的最初提案 网页截图'},{id:'a',text:'互联网和万维网的历史'},{id:'b',text:'好的坏的动画人物形象'},{id:'c',text:'图片 来源 资料 我们 这个'}];
 assert.deepEqual([...supportedRelatedIds(candidates,'s')],['a']);
 assert.deepEqual([...supportedRelatedIds(candidates,'missing')],[]);
});

test('date order follows relevance-based source diversity; invalid dates sort last in both directions',()=>{
 const source={id:'s',title:'source',sourceUrl:'https://a.test/source'};
 const rows=[
  {id:'strong',title:'High relevance representative',body:'One original excerpt',sourceUrl:'https://a.test/group',createdAt:'2024-01-01',updatedAt:'2025-01-01'},
  {id:'weak',title:'Newer low relevance sibling',body:'Another original excerpt',sourceUrl:'https://a.test/group',createdAt:'2026-01-01',updatedAt:'2026-01-01'},
  {id:'other',title:'Independent',body:'Independent text',sourceUrl:'https://b.test',createdAt:'2025-01-01',updatedAt:'2024-01-01'},
  {id:'missing',title:'Missing date',body:'No date text',sourceUrl:'https://c.test'},
  {id:'invalid',title:'Bad date',body:'Invalid date text',sourceUrl:'https://d.test',createdAt:'not-a-date',updatedAt:'bad'},
 ];
 const library=[source,...rows],exact=rows.map((card,i)=>({id:card.id,score:100-i*10}));
 for(const [sort,expected] of [['created-desc',['other','strong','missing','invalid']],['created-asc',['strong','other','missing','invalid']],['updated-desc',['strong','other','missing','invalid']],['updated-asc',['other','strong','missing','invalid']]]){
  const result=relatedResults(source,library,exact,[],{sort});
  assert.deepEqual(result.items.map(x=>x.id),expected);assert(!result.items.some(x=>x.id==='weak'));
 }
 assert.equal(normalizeRelatedView({sort:'fake'}).sort,'relevance');
});
test('exact duplicates among recommendations are hidden without collapsing distinct same-title excerpts',()=>{
 const source={id:'s',title:'source',sourceUrl:'https://a.test/source'};
 const a={id:'a',title:'Shared title',body:'Shared unchanged body',sourceUrl:'https://a.test/source'};
 const b={...a,id:'b'},c={...a,id:'c',body:'Distinct excerpt'};
 const results=relatedResults(source,[source,a,b,c],[{id:'a',score:90},{id:'b',score:80},{id:'c',score:70}],[],{scope:'source'});
 assert.deepEqual(results.items.map(x=>x.id),['a','c']);
});
test('stored view restores applied type, scope, sort and expanded pagination without changing input',()=>{
 const value={type:'image',scope:'source',sort:'created-asc',limit:18,filtersOpen:false};
 assert.deepEqual(normalizeRelatedView(structuredClone(value)),value);
 const f=fixture(),before=structuredClone(f.library);
 const a=relatedResults(f.source,f.library,f.exact,f.semantic,value),b=relatedResults(f.source,f.library,f.exact,f.semantic,normalizeRelatedView(value));
 assert.deepEqual(a,b);assert.deepEqual(f.library,before);
});

test('shared preview preserves a PDF book cover and safe local thumbnail fallbacks',()=>{
 const cover='data:image/png;base64,cGljdHVyZQ==';
 assert.equal(relatedCardPreview({type:'book',image:cover,attachment:{dataUrl:'data:application/pdf;base64,cGRm'}}).image,cover);
 assert.equal(relatedCardPreview({previewImage:cover}).image,cover);
 assert.equal(relatedCardPreview({image:'https://tracking.test/image.png',previewImage:cover}).image,cover);
 assert.equal(relatedCardPreview({image:'https://tracking.test/image.png'}).image,'');
});

test('a highlight whose title repeats the quote still previews the actual quote before its note',()=>{
 const quote='See <a> in the proposal at https://example.org/history.';
 const card={type:'highlight',title:quote,body:quote,caption:'My note',webAnchor:{exact:quote}};
 assert.equal(relatedCardPreview(card).text,quote);
 assert.equal(relatedCardPreview({...card,body:''}).text,quote);
});

test('same-source callout counts exactly what opens after applying the active type, before pagination',()=>{
 const {source,library,exact,semantic}=fixture();
 for(const type of ['all','image','highlight','file']){
  const first=relatedResults(source,library,exact,semantic,{type,sort:'updated-asc'});
  const opened=relatedResults(source,library,exact,semantic,{type,sort:'updated-asc',scope:'source'});
  assert.equal(first.sourceCount,opened.total);assert.equal(first.webSource,true);
 }
 const file={id:'f',originalPath:'personal/reference.md'},child={id:'q',sourceCardId:'f',type:'highlight',body:'distinct quotation'};
 const result=relatedResults(file,[file,child],[{id:'q',score:60}]);assert.equal(result.webSource,false);assert.equal(result.sourceCount,1);
});

test('filtering to an image retains that image if an otherwise identical note ranked higher',()=>{
 const source={id:'current',type:'article',sourceUrl:'https://example.org/a'},same={title:'图的说明',body:'共享的说明文字',sourceUrl:source.sourceUrl};
 const note={...same,id:'note',type:'text'},image={...same,id:'image',type:'image'},lib=[source,note,image],rank=[{id:'note',score:100},{id:'image',score:95}];
 const all=relatedResults(source,lib,rank),pics=relatedResults(source,lib,rank,[],{type:'image',scope:'source'});
 assert.equal(all.total,1);assert.equal(pics.allCount,1);assert.equal(pics.sourceCount,1);assert.equal(pics.items[0].id,'image');
});
