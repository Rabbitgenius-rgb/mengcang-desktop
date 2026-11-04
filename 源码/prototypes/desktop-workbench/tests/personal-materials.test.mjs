import test from 'node:test';
import assert from 'node:assert/strict';
import {articleFigureCollection,saveArticleFigure} from '../src/sublime/articleFigures.js';
import {personalRelations,nativeRelated} from '../src/sublime/personalRelated.js';
import {createWorkspaceState,workspaceReducer,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
import {noteLinkPresentation} from '../src/sublime/workspaceView.js';

const base64='R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const attachment={name:'map.gif',type:'image/gif',size:Buffer.from(base64,'base64').length,dataUrl:'data:image/gif;base64,'+base64};
function fixture(remote=false){
 const block={type:'image',id:'b3',src:'https://example.org/map.gif',caption:'街道分区图',alt:'旧城路线',...(remote?{imageError:'先前未下载'}:{attachment})};
 const source={id:'article-1',type:'article',title:'城市里的街道',author:'作者',sourceUrl:'https://example.org/article',article:{version:1,blocks:[block]}};
 const session={state:[{type:'card.upsert',card:source},{type:'card.save',id:source.id,saved:true}].reduce(workspaceReducer,createWorkspaceState()),async commit(f){this.state=f(this.state);}};
 let sequence=0;
 const args={session,source,block,newId:()=>`image-${++sequence}`,now:()=>'2026-11-01T12:00:00Z',isCurrent:()=>true};
 return {args,session,block};
}
test('a figure stays independent, offline, attributable and unique across repeat clicks and a backup round trip',async()=>{
 const {args,session,block}=fixture();let downloads=0;args.fetchImage=()=>{downloads++;throw Error('unexpected network');};
 const before=structuredClone(session.state.cards[0]);
 const [a,b]=await Promise.all([saveArticleFigure(args),saveArticleFigure(args)]);assert.equal(a,b);assert.equal(downloads,0);
 const persisted=parseWorkspaceBackup(serializeWorkspace(session.state)),card=persisted.cards.find(c=>c.id===a);
 assert.deepEqual(persisted.cards[0],before);assert.equal(card.title,'街道分区图');assert.equal(card.author,'作者');assert.equal(card.sourceCardId,before.id);assert.deepEqual(card.attachment,attachment);
 assert.equal(card.articleFigure.blockId,block.id);assert.deepEqual(noteLinkPresentation(card).map(l=>l.target),[before.sourceUrl,block.src]);assert.equal(persisted.collections.length,0);
 session.state=workspaceReducer(session.state,{type:'card.hide',id:a,hidden:true});
 await assert.rejects(saveArticleFigure(args),/已移出/);assert.equal(session.state.cards.length,2);assert.ok(session.state.hiddenIds.includes(a));
});
test('missing image downloads on explicit save; a changed article or workspace during download cannot receive the result',async()=>{
 for(const changed of ['none','archive','workspace','wrong-bytes','download-failed']){
  const {args,session}=fixture(true);let current=true;
  args.isCurrent=()=>current;
  args.fetchImage=async url=>{
   assert.equal(url,args.block.src);
   if(changed==='archive')session.state=workspaceReducer(session.state,{type:'card.hide',id:args.source.id,hidden:true});
   if(changed==='workspace')current=false;
   if(changed==='wrong-bytes')return {...attachment,type:'image/png'};
   if(changed==='download-failed')throw Error('网络不可用');
   return attachment;
  };
  if(changed==='none'){await saveArticleFigure(args);assert.equal(session.state.cards.length,2);assert.equal(session.state.cards[0].article.blocks[0].attachment,undefined);}
  else {await assert.rejects(saveArticleFigure(args));assert.equal(session.state.cards.length,1);}
 }
});
test('relations prioritize the saved figure, explain provenance, skip unrelated cards in system collections and never write',()=>{
 const source={id:'a',title:'First record',sourceUrl:'https://example.org/report',type:'article'},picture={id:'i',title:'Diagram',type:'image',sourceCardId:'a',articleFigure:{blockId:'x'}},web={id:'w',title:'Web bookmark',sourceUrl:source.sourceUrl},unrelated={id:'z',title:'Quartz'};
 const lib=[source,web,picture,unrelated],unchanged=structuredClone(lib),groups=[{id:'browser-clips-v1',cardIds:['a','i','w','z']}];
 assert.deepEqual(personalRelations(source,lib,groups).map(x=>[x.id,x.reason]),[['i','从本文收藏的配图'],['w','来自同一网页']]);
 assert.equal(personalRelations(picture,lib,groups)[0].id,'a');assert.deepEqual(personalRelations(source,[source,unrelated],groups),[]);assert.deepEqual(lib,unchanged);
});
test('native fallback reuses unchanged local inputs and evicts removed cards; incomplete or foreign language vectors are not results',async()=>{
 const lib=['a','b','c','d'].map(id=>({id,title:id+' title'})),cache=new Map(),batches=[];
 const embed=async texts=>{batches.push(texts.map(t=>t.id));return {embeddings:texts.filter(t=>t.id!=='d').map(t=>({id:t.id,vector:[1,.3],model:'test',language:t.id==='c'?'zh':'en'}))};};
 const run=cards=>nativeRelated(cards[0],cards,cache,embed,()=>true);
 assert.deepEqual((await run(lib)).map(x=>x.id),['b']);await run(lib);
 const next=[lib[0],{...lib[1],title:'changed'},lib[3]];await run(next);assert.deepEqual(batches,[['a','b','c','d'],['b']]);assert.equal(cache.has('c'),false);
});

test('the article footer resolves old browser images only by a unique image address, preferring a saved figure for that position',async()=>{
 const {args,block,session}=fixture();
 const id=await saveArticleFigure(args),explicit=session.state.cards.find(card=>card.id===id);
 const legacy={id:'legacy',type:'image',sourceUrl:args.source.sourceUrl+'#intro',sourceLocation:'浏览器图片',body:'图注\n\n图片原址：'+block.src,attachment};
 const shots={...legacy,id:'shot',sourceLocation:'网页截图 · 选区'};
 const elsewhere={...legacy,id:'other',sourceUrl:'https://example.org/article?q=2'};
 const otherParent={...explicit,id:'other-parent',sourceCardId:'another'};
 const moved={...explicit,id:'moved',articleFigure:{...explicit.articleFigure,imageUrl:'https://example.org/replaced.gif'}};
 const listed=cards=>articleFigureCollection(args.source,cards);
 assert.deepEqual(listed([legacy,shots,elsewhere,otherParent]).items,[{blockId:block.id,card:legacy}]);
 for(const cards of [[legacy,explicit],[explicit,legacy]])assert.deepEqual(listed(cards).items,[{blockId:block.id,card:explicit}]);
 assert.deepEqual(listed([moved]).items,[{card:moved}]);assert.equal(listed([moved]).byBlock.size,0);
 const repeated={...args.source,article:{version:1,blocks:[block,{...block,id:'b4'}]}};
 assert.deepEqual(articleFigureCollection(repeated,[legacy]).items,[]);
});
