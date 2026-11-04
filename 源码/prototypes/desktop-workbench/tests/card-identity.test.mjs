import test from 'node:test';
import assert from 'node:assert/strict';
import {cardIdentityMetadata,createCardIdentityContext} from '../src/sublime/cardIdentity.js';
import {generatedInsightCard} from '../src/sublime/intelligenceHelpers.js';

test('card origin distinguishes originals, sourced copies, standalone local cards and references',()=>{
 assert.equal(cardIdentityMetadata({origin:'vault'}).originLabel,'原始资料');
 assert.equal(cardIdentityMetadata({origin:'local',sourceCardId:'original-id'}).originLabel,'本机副本');
 assert.equal(cardIdentityMetadata({origin:'local',sourceUrl:'https://example.com'}).originLabel,'本机卡片');
 assert.equal(cardIdentityMetadata({origin:'local',sourceCardId:'  '}).originLabel,'本机卡片');
 assert.equal(cardIdentityMetadata({origin:'reference'}).originLabel,'参考卡片');
});

test('persisted derivative markers distinguish insights, excerpts and audio clips from copies',()=>{
 const local={origin:'local',sourceCardId:'original-id'};
 assert.equal(cardIdentityMetadata({...local,tags:['AI 解读']}).originLabel,'解读笔记');
 assert.equal(cardIdentityMetadata({...local,type:'highlight'}).originLabel,'本机摘录');
 assert.equal(cardIdentityMetadata({...local,type:'audio',sourceAudioSha256:'a'.repeat(64)}).originLabel,'音频片段');
 assert.equal(cardIdentityMetadata({...local,origin:'vault',tags:['AI 解读']}).originLabel,'原始资料');
});

test('only persisted OCR text labels recognition, with actual PDF saved page count',()=>{
 const card={origin:'local',sourceCardId:'original-id',attachment:{type:'application/pdf'},ocrText:'第一页\n\n第二页',documentIndex:{source:'ocr',text:'第一页\n\n第二页',pageCount:2,pages:[{page:1,text:'第一页'},{page:2,text:'第二页'}]}};
 const original=JSON.stringify(card);
 assert.equal(cardIdentityMetadata(card).accessibleLabel,'本机副本 · 已识别 2 页');
 assert.equal(JSON.stringify(card),original);
 assert.equal(cardIdentityMetadata({...card,ocrText:'',documentIndex:null,drafts:{ocrText:'尚未保存'}}).recognitionLabel,'');
 assert.equal(cardIdentityMetadata({...card,ocrText:'',documentIndex:{source:'pdf-text-layer',text:'文本层',pages:[{page:1,text:'文本层'}],pageCount:1}}).recognitionLabel,'');
});

test('images and old unpaged OCR show text status without inventing pages',()=>{
 const image={attachment:{type:'image/png'},ocrText:'中文图片',documentIndex:{source:'ocr',text:'中文图片',pages:[],pageCount:0}};
 assert.equal(cardIdentityMetadata(image).recognitionLabel,'已识别文字');
 assert.equal(cardIdentityMetadata({...image,documentIndex:{...image.documentIndex,pages:[{page:1,text:'中文图片'}],pageCount:1}}).recognitionLabel,'已识别文字');
 assert.equal(cardIdentityMetadata({ocrText:'旧版已保存识别文字'}).recognitionLabel,'已识别文字');
});

test('partial saved OCR does not claim the whole PDF was recognized',()=>{
 const card={attachment:{type:'application/pdf'},ocrText:'第二页',documentIndex:{source:'ocr',text:'第二页',pages:[{page:2,text:'第二页'}],pageCount:2,truncated:true}};
 assert.equal(cardIdentityMetadata(card).recognitionLabel,'已识别 1 / 2 页');
 assert.equal(cardIdentityMetadata(card).partial,true);
 assert.equal(cardIdentityMetadata({...card,ocrText:'',documentIndex:{...card.documentIndex,text:'',pages:[{page:2,text:''}]}}).recognitionLabel,'');
});

test('only nonempty valid saved pages count, including partial records without a truncated flag',()=>{
 const card={attachment:{type:'application/pdf'},ocrText:'第一页',documentIndex:{source:'ocr',text:'第一页',pages:[{page:1,text:'第一页'},{page:2,text:'  '},{page:0,text:'无效页号'},{page:3,text:'超出总页数'},{page:1,text:'重复页号'}],pageCount:2,truncated:false}};
 assert.equal(cardIdentityMetadata(card).recognitionLabel,'已识别 1 / 2 页');
 assert.equal(cardIdentityMetadata(card).recognizedPageCount,1);
 assert.equal(cardIdentityMetadata(card).partial,true);
});

const insight=(id,extra={})=>({id,origin:'local',type:'text',title:'核心概述 · 同名素材',tags:['AI 解读'],...extra});

test('same-kind same-title insights receive shared display and accessible disambiguation without mutation',()=>{
 const cards=[insight('ai-insight:aabbccdd-1111-2222-3333-111111111111',{createdAt:'2026-10-18T06:30:12.000Z'}),insight('ai-insight:aabbccdd-1111-2222-3333-222222222222',{createdAt:'2026-10-18T06:30:13.000Z'})];
 const before=JSON.stringify(cards),context=createCardIdentityContext(cards);
 const first=cardIdentityMetadata(cards[0],context),second=cardIdentityMetadata(cards[1],context);
 assert.equal(first.duplicateLabel,'保存 2026-10-18 14:30:12（北京时间） · #11111111');
 assert.equal(second.duplicateLabel,'保存 2026-10-18 14:30:13（北京时间） · #22222222');
 assert.equal(first.accessibleLabel,`解读笔记 · ${first.duplicateLabel}`);
 assert.notEqual(first.shortId,second.shortId);
 assert.deepEqual(cardIdentityMetadata(cards[0],context),first); // Reuse the full context after a query selects one card.
 assert.equal(JSON.stringify(cards),before);
 assert.equal(cardIdentityMetadata(cards[0]).duplicateLabel,'');
});

test('single insights, other types, other titles and duplicate IDs do not trigger extra metadata',()=>{
 const one=insight('ai-insight:11111111');
 for(const others of [[],[one],[{...one,title:'其他标题',id:'other'}],[{...one,type:'highlight',id:'excerpt'}],[{...one,origin:'vault',id:'original'}],[{...one,tags:[],id:'plain'}]]){
  assert.equal(cardIdentityMetadata(one,createCardIdentityContext([one,...others])).duplicateLabel,'');
 }
});

test('colliding suffixes expand deterministically within the group and duplicate IDs count once',()=>{
 const cards=[insight('ai-insight:first-12345678'),insight('ai-insight:other-12345678'),insight('ai-insight:first-12345678')];
 const forward=createCardIdentityContext(cards),reverse=createCardIdentityContext([...cards].reverse());
 const labels=cards.slice(0,2).map(card=>cardIdentityMetadata(card,forward));
 assert.equal(forward.insightDuplicates.size,2);
 assert.notEqual(labels[0].shortId,labels[1].shortId);
 for(const card of cards)assert.deepEqual(cardIdentityMetadata(card,forward),cardIdentityMetadata(card,reverse));
 const suffixPair=[insight('abcdefgh'),insight('long-abcdefgh')];
 const suffixContext=createCardIdentityContext(suffixPair);
 assert.notEqual(...suffixPair.map(card=>cardIdentityMetadata(card,suffixContext).shortId));
});

test('save timestamp comes from the generated insight save, never source, capture or later update time',()=>{
 const source={id:'original',title:'同名素材',createdAt:'2019-01-01T00:00:00Z',updatedAt:'2020-01-01T00:00:00Z',capturedAt:'2021-01-01T00:00:00Z',date:'2022-01-01'};
 const cards=['one','two'].map(id=>generatedInsightCard(source,'The Gist',{text:'合成测试解读'},{id:`ai-insight:${id}`,now:'2026-10-17T23:30:12.000Z'}));
 cards[0].updatedAt='2030-01-01T00:00:00Z';
 const value=cardIdentityMetadata(cards[0],createCardIdentityContext(cards));
 assert.equal(value.savedTimeLabel,'保存 2026-10-18 07:30:12（北京时间）');
 assert.ok(!value.duplicateLabel.includes('2019')&&!value.duplicateLabel.includes('2030'));
});

test('missing, invalid, date-only or unproven timestamps stay unknown instead of using current or source dates',()=>{
 for(const createdAt of [undefined,'','2026-10-18','2026-02-30T00:00:00Z','2026-10-18T06:30:12','2026-10-18T25:30:12Z','2026-10-18T06:30:12+24:00']){
  const cards=[insight('ai-insight:unknown-one',{createdAt,updatedAt:'2026-10-18T06:30:12Z',capturedAt:'2026-10-18T06:30:12Z',date:'2026-10-18'}),insight('ai-insight:unknown-two')];
  assert.equal(cardIdentityMetadata(cards[0],createCardIdentityContext(cards)).savedTimeLabel,'保存时间未记录');
 }
 const imported=[insight('external-one',{createdAt:'2026-10-18T06:30:12Z'}),insight('external-two',{createdAt:'2026-10-18T06:30:12Z'})];
 assert.equal(cardIdentityMetadata(imported[0],createCardIdentityContext(imported)).savedTimeLabel,'保存时间未记录');
 const offsetCards=[insight('ai-insight:offset-one',{createdAt:'2026-10-18T14:30:12+08:00'}),insight('ai-insight:offset-two')];
 assert.equal(cardIdentityMetadata(offsetCards[0],createCardIdentityContext(offsetCards)).savedTimeLabel,'保存 2026-10-18 14:30:12（北京时间）');
});

test('the two previously inspected real insight IDs are distinguishable without inventing missing timestamps',()=>{
 const cards=[insight('ai-insight:5b6020dd-bc37-466a-8ff0-c73efcd5659a'),insight('ai-insight:142477f3-3d3f-4be4-b16d-c6bc648d7357')];
 const context=createCardIdentityContext(cards);
 assert.equal(cardIdentityMetadata(cards[0],context).duplicateLabel,'保存时间未记录 · #fcd5659a');
 assert.equal(cardIdentityMetadata(cards[1],context).duplicateLabel,'保存时间未记录 · #648d7357');
});
