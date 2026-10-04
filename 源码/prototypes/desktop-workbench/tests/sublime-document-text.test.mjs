import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {fileURLToPath} from 'node:url';
import {pdfDocumentOptions,fitPdfViewport} from '../src/sublime/pdfPreview.js';
import {pdfPageText,indexPdfDocument,documentMatches,pdfSearchParts,selectionInPage} from '../src/sublime/documentText.js';
import {workspaceReducer,createWorkspaceState,selectCards,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
import {cardCapturePayload} from '../src/sublime/workspaceView.js';
const fixture=new URL('../../../tests/fixtures/discovery-excerpt.pdf',import.meta.url);
const bytes=await fs.readFile(fixture),attachment={name:'原文件.pdf',type:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')};
test('real PDF text from multiple pages is indexed with exact page provenance and searchable locally',async()=>{
 const task=getDocument({...pdfDocumentOptions(new Uint8Array(bytes),fileURLToPath(new URL('../node_modules/pdfjs-dist/',import.meta.url))),useSystemFonts:false});
 try{const pdf=await task.promise,index=await indexPdfDocument(pdf);assert.equal(index.pages.length,pdf.numPages);assert.equal(index.truncated,false);for(const item of index.pages){const page=await pdf.getPage(item.page);assert.equal(item.text,pdfPageText(await page.getTextContent()));}assert.ok(index.text.includes('quiet'));assert.equal(documentMatches(index.pages,'quiet')[0].page,1);assert.equal(documentMatches(index.pages,'no such phrase').length,0);}finally{await task.destroy();}
});
test('cancelled extraction cannot publish stale results; bounded indexing reports incomplete text',async()=>{
 const fake={numPages:2,getPage:async()=>({getTextContent:async()=>({items:[{str:'First line',hasEOL:true},{str:'Second line'}]})})};
 assert.equal(pdfPageText(await (await fake.getPage()).getTextContent()),'First line\nSecond line');
 await assert.rejects(indexPdfDocument(fake,{cancelled:()=>true}),/取消/);
 const limited=await indexPdfDocument(fake,{deadline:0});assert.equal(limited.truncated,true);assert.equal(limited.pages.length,0);
});
test('PDF search highlights only literal matching text and retains exact source characters across runs',()=>{
 const content={items:[{str:'🙂 İ and ORIGIN, origin. <b>',hasEOL:true}]};
 const parts=pdfSearchParts(content,'origin')[0];
 assert.deepEqual(parts.filter(part=>part.matched).map(part=>part.text),['ORIGIN','origin']);
 assert.equal(parts.map(part=>part.text).join(''),content.items[0].str);
 assert.deepEqual(documentMatches([{page:2,text:pdfPageText(content)}],'origin').map(item=>item.offset),[9,17]);
 assert.deepEqual(pdfSearchParts(content,'<b>')[0].filter(part=>part.matched).map(part=>part.text),['<b>']);
 assert.deepEqual(pdfSearchParts({items:[{str:'literal [x].'}]},'[x].')[0].filter(part=>part.matched).map(part=>part.text),['[x].']);
 assert.deepEqual(pdfSearchParts(content,'')[0],[{text:content.items[0].str,matched:false}]);
 const split={items:[{type:'beginMarkedContent'},{str:'when its '},{str:''},{str:'ori'},{str:'gin is preserved.'},{type:'endMarkedContent'}]};
 const splitParts=pdfSearchParts(split,'its origin');
 assert.deepEqual(splitParts.map(parts=>parts.filter(part=>part.matched).map(part=>part.text).join('')),['its ','','ori','gin']);
 assert.deepEqual(splitParts.map(parts=>parts.map(part=>part.text).join('')),['when its ','','ori','gin is preserved.']);
 assert.equal(pdfPageText(split),'when its origin is preserved.');
 assert.equal(documentMatches([{page:2,text:pdfPageText(split)}],'origin').length,1);
 assert.equal(documentMatches([{page:2,text:pdfPageText(split)}],'its origin').length,1);
});
test('indexes and normalized highlights persist across backups, search attachment text, and reject stale attachment jobs',()=>{
 let state=workspaceReducer(createWorkspaceState(),{type:'card.upsert',card:{id:'file',title:'File title',body:'Independent caption',attachment}});state=workspaceReducer(state,{type:'card.save',id:'file',saved:true});
 const index={text:'The unique hidden keyword - 深处的文字',pages:[{page:2,text:'The unique hidden keyword - 深处的文字'}],pageCount:2,truncated:false,indexedAt:'2026-10-03'};
 state=workspaceReducer(state,{type:'card.documentIndex',id:'file',expectedDataUrl:attachment.dataUrl,index});
 const highlight={id:'hl1',page:2,text:'unique hidden keyword',rects:[{x:.1,y:.2,width:.3,height:.04}]};state=workspaceReducer(state,{type:'card.highlight',id:'file',expectedDataUrl:attachment.dataUrl,highlight});
 const backup=parseWorkspaceBackup(serializeWorkspace(state));assert.deepEqual(backup.cards[0].documentHighlights,[highlight]);assert.equal(backup.cards[0].body,'Independent caption');assert.equal(selectCards(backup.cards,backup,{query:'hidden 深处',inLibrary:true}).length,1);
 const different={...attachment,name:'other.pdf',dataUrl:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4\nAnother file').toString('base64'),size:Buffer.byteLength('%PDF-1.4\nAnother file')};
 state=workspaceReducer(state,{type:'card.upsert',card:{id:'file',attachment:different}});assert.equal(state.cards[0].documentIndex,null);assert.deepEqual(state.cards[0].documentHighlights,[]);assert.throws(()=>workspaceReducer(state,{type:'card.documentIndex',id:'file',expectedDataUrl:attachment.dataUrl,index}),/附件已更换/);
});
test('zoom changes CSS size while canvas allocation stays bounded, and selection must belong to the page',()=>{
 const page={getViewport:({scale})=>({width:600*scale,height:900*scale})};const fit=fitPdfViewport(page,600,2,1),large=fitPdfViewport(page,600,2,3);assert.equal(large.viewport.width,fit.viewport.width*3);assert.ok(large.width*large.height<=4000000);
 const container={},layer={contains:node=>node===container,getBoundingClientRect:()=>({left:10,top:20,width:100,height:200})};const selection={isCollapsed:false,rangeCount:1,toString:()=> 'exact text\n',getRangeAt:()=>({startContainer:container,endContainer:container,getClientRects:()=>[{left:20,top:40,width:30,height:10}]})};assert.deepEqual(selectionInPage(selection,layer,7),{page:7,text:'exact text\n',rects:[{x:.1,y:.1,width:.3,height:.05}]});assert.equal(selectionInPage({...selection,isCollapsed:true},layer,7),null);
});
test('original-file capture is opt-in and keeps exact original bytes independently of document indexes',()=>{
 const card={title:'Original',body:'',attachment,documentIndex:{text:'should not become source'}};const plain=cardCapturePayload(card,{operationId:'id'});assert.equal(plain.attachment,undefined);const captured=cardCapturePayload(card,{operationId:'id',includeAttachment:true});assert.deepEqual(captured.attachment,attachment);assert.equal(captured.body,'');assert.equal(captured.documentIndex,undefined);
});
