import test from 'node:test';
import assert from 'node:assert/strict';
import {rankLocalMaterials} from '../src/sublime/intelligenceHelpers.js';
import {createVaultSearchVersion, imageResultSource, localSearchThumbnail, relatedCardSource} from '../src/sublime/localMaterialSearch.js';
import {createWorkspaceState} from '../src/sublime/workspaceModel.js';
import {selectWorkspaceCards} from '../src/sublime/workspaceView.js';

const vector=(id, values=[1,0])=>({id, vector:values, language:'zh',model:'test-local'});
const card=(id, title, type='image')=>({id,title,type,origin:'local'});

test('an unmodified phrase searches only the selected, saved, visible image cards; text-only candidates can rank images', async()=>{
  const cards=[card('query','概念关系'),card('other','墨水'),card('trash','概念关系'),card('outside','概念关系'),card('draft','概念关系'),card('article','概念关系','article')];
  const state={...createWorkspaceState(),savedIds:cards.filter(c=>c.id!=='draft').map(c=>c.id),hiddenIds:['trash'],collections:[{id:'c',title:'图像',cardIds:cards.filter(c=>c.id!=='outside').map(c=>c.id)}]};
  const filters={media:'Images',inLibrary:true},route={page:'collection',id:'c'};
  const phrase='  早期互联网那张用线连起来的示意图  ';
  assert.equal(selectWorkspaceCards(cards,state,{route,filters:{...filters,query:phrase}}).length,0);
  const scope=selectWorkspaceCards(cards,state,{route,filters});
  const requests=[];
  const result=await rankLocalMaterials({cards:scope,query:phrase,embed:async texts=>{
    requests.push(texts);return {embeddings:texts.map(({id,text})=>vector(id,text==='墨水'?[0,1]:[1,0]))};
  }});
  assert.deepEqual(requests[0].map(i=>i.id).sort(),['other','query']);
  assert.equal(requests[1][0].text,phrase);
  assert.deepEqual(result.ranked.map(r=>r.id),['query','other']);
});

test('returns a long Vault ID after using bounded native IDs; a missing query vector produces no false result', async()=>{
  const id='目录/'.repeat(1000)+'资料.md';
  const result=await rankLocalMaterials({cards:[card(id,'图片')],query:'描述',embed:async texts=>{
    assert.ok(texts.every(e=>e.id.length<=2048));return {embeddings:texts.map(e=>vector(e.id))};
  }});
  assert.equal(result.ranked[0].id,id);
  const missing=await rankLocalMaterials({cards:[card('a','已有')],query:'描述',embed:async texts=>({embeddings:texts.filter(t=>t.text!=='描述').map(t=>vector(t.id))})});
  assert.deepEqual(missing.ranked,[]);
});

test('changing the view cancels a long search before the next batch or query is sent', async()=>{
  const controller=new AbortController(),cards=Array.from({length:150},(_,i)=>card(String(i),'资料'));
  let calls=0;
  await assert.rejects(rankLocalMaterials({cards,query:'原话',signal:controller.signal,embed:async texts=>{
    calls++;controller.abort();assert.equal(texts.length,128);return {embeddings:texts.map(t=>vector(t.id))};
  }}),{name:'AbortError'});
  assert.equal(calls,1);
});

test('image results link the exact saved article; ambiguous URLs or missing parents keep the recorded provenance',()=>{
  const a={id:'a',type:'article',title:'提案',sourceUrl:'https://example.org/proposal'};
  const b={...a,id:'b',title:'另一个存档'};
  const figure={type:'image',sourceTitle:'提案原文',sourceCardId:'a',sourceUrl:a.sourceUrl+'#fig2',articleFigure:{blockId:'fig2'}};
  assert.deepEqual(imageResultSource(figure,[b,a]),{label:'来源文章',title:'提案',cardId:'a'});
  assert.deepEqual(imageResultSource(figure,[b]),{label:'来源文章',title:'提案原文',url:figure.sourceUrl});
  const legacy={...figure,sourceCardId:undefined,articleFigure:undefined};
  assert.equal(imageResultSource(legacy,[a]).cardId,'a');
  assert.equal(imageResultSource(legacy,[a,b]).url,figure.sourceUrl);
  assert.equal(imageResultSource({sourceUrl:'javascript:alert(1)'},[]),null);
});

test('shows the saved thumbnail or original image locally without requesting preview URLs from the web',()=>{
  const gif='data:image/gif;base64,R0lGODlh';
  assert.equal(localSearchThumbnail({image:'https://example.org/preview.gif',attachment:{dataUrl:gif}}),gif);
  assert.equal(localSearchThumbnail({image:'mengcang-asset://vault/?path=original.png'}),'mengcang-asset://vault/?path=original.png');
  assert.equal(localSearchThumbnail({image:'https://example.org/preview.gif'}),'');
});

test('rereading or reordering identical Vault records keeps the search; actual material edits invalidate it',()=>{
  const version=createVaultSearchVersion();
  const first=[card('a','图'),{...card('b','提案','article'),documentIndex:{text:'旧正文'}}];
  const old=version(first);
  assert.equal(version(structuredClone(first).reverse()),old);
  const revision=version([first[0],{...first[1],documentIndex:{text:'新正文'}}]);
  assert.notEqual(revision,old);
  assert.notEqual(version([first[0]]),revision);
});


test('related citations resolve by article identity or unique page and never guess from a matching title',()=>{
  const url='https://www.w3.org/History/1989/proposal.html';
  const article={id:'proposal',type:'article',title:'万维网的最初提案',sourceUrl:url};
  const figure={id:'diagram',type:'image',title:'概念图',sourceTitle:article.title,sourceUrl:url+'#diagram',sourceCardId:article.id,articleFigure:{blockId:'fig1'}};
  assert.deepEqual(relatedCardSource(figure,[article,figure]),{label:'来源文章',title:article.title,cardId:article.id});
  assert.deepEqual(relatedCardSource(article,[article,figure]),{label:'来源',title:article.title,url});
  const wrong={...article,sourceUrl:'https://other.test/proposal'};
  assert.equal(relatedCardSource(figure,[wrong]).url,figure.sourceUrl);
  assert.equal(relatedCardSource({...figure,sourceCardId:undefined},[wrong]).url,figure.sourceUrl);
  assert.equal(relatedCardSource({...figure,sourceCardId:undefined},[article,{...article,id:'copy'}]).url,figure.sourceUrl);
  assert.equal(relatedCardSource({...figure,sourceCardId:undefined,sourceUrl:'file:///article.pdf'},[article]),null);
});

test('related highlight citations preserve web text fragments and explicit offline file parents',()=>{
  const sourceUrl='https://example.org/p',excerpt={type:'highlight',id:'clip',sourceUrl,webAnchor:{version:1,exact:'a sentence',prefix:'',suffix:''}};
  assert.match(relatedCardSource(excerpt,[]).url,/#:~:text=a%20sentence$/);
  const book={type:'book',id:'book',title:'资料原文'};
  assert.deepEqual(relatedCardSource({id:'p1',sourceCardId:book.id},[book]),{label:'来源资料',title:book.title,cardId:book.id});
});
