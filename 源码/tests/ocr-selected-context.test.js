'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeContext,callTool}=require('../scripts/mengcang-mcp.cjs');
const base={format:'mengcang-selected-context',version:1,access:'read-only',title:'OCR 隔离验收',cards:[]};
const card={id:'card-1',title:'扫描附件',body:'原始说明',note:'',ocrText:'第一页\n\n第二页',type:'file',tags:[]};
const index={source:'ocr',engine:'PDFKit + Apple Vision',pageCount:2,pages:[{page:1,text:'第一页 https://example.com/ocr-test',engine:'Apple Vision'},{page:2,text:'第二页 98.50 元',engine:'Apple Vision'}],text:'第一页 https://example.com/ocr-test\n\n第二页 98.50 元',truncated:false,indexedAt:'2026-10-15T00:00:00.000Z'};
const json=result=>JSON.parse(result.content[0].text);
test('selected OCR export keeps page numbers and engines after JSON readback without leaking attachments',()=>{
 const snapshot=normalizeContext(JSON.parse(JSON.stringify({...base,cards:[{...card,documentIndex:{...index,command:'never retained',pages:index.pages.map(page=>({...page,path:'/private/never-retained'}))},attachment:{dataUrl:'never retained'}}]})));
 assert.deepEqual(snapshot.cards[0].documentIndex,index);
 const listed=json(callTool(snapshot,'list_cards'));assert.equal(listed.cards[0].documentIndex.pageCount,2);assert.equal(listed.cards[0].documentIndex.source,'ocr');
 const read=json(callTool(snapshot,'read_card',{id:'card-1'}));assert.match(read.content,/第 1 页 · Apple Vision/);assert.match(read.content,/第 2 页 · Apple Vision/);assert.match(read.content,/98.50 元/);assert.doesNotMatch(JSON.stringify(snapshot),/never retained|never-retained/);
 assert.equal(json(callTool(snapshot,'search_cards',{query:'98.50'})).total,1);
 assert.equal(card.body,'原始说明');
});
test('legacy OCR-only exports stay readable without invented pages',()=>{
 const snapshot=normalizeContext({...base,cards:[card]});assert.equal(snapshot.cards[0].documentIndex,undefined);
 const read=json(callTool(snapshot,'read_card',{id:'card-1'}));assert.match(read.content,/图片识别文字/);assert.doesNotMatch(read.content,/第 1 页/);
});
test('selected document indexes reject invalid page provenance and oversized metadata before reads',()=>{
 for(const documentIndex of [{...index,pages:[index.pages[0],index.pages[0]]},{...index,pages:[{page:3,text:'越界'}]},{...index,source:'/private/arbitrary'},{...index,engine:'x'.repeat(201)},{...index,pages:[{page:1,text:'x\0'}]},{...index,pages:[{page:1,text:'x'.repeat(1000001)}]}])assert.throws(()=>normalizeContext({...base,cards:[{...card,documentIndex}]}),/文档/);
});
test('legacy partial indexes preserve known page numbers even when the full PDF exceeds the indexed-page limit',()=>{
 const documentIndex={...index,pageCount:2000,pages:[index.pages[1],index.pages[0]],truncated:true};
 const snapshot=normalizeContext({...base,cards:[{...card,documentIndex}]});assert.deepEqual(snapshot.cards[0].documentIndex,documentIndex);
});
