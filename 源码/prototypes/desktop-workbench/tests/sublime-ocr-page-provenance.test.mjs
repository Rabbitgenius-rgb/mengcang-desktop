import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {documentIndexFromOcr,normalizeDocumentIndex,chooseDocumentTextIndex} from '../src/sublime/documentIndex.js';
import {ocrEnrichmentPatch} from '../src/sublime/intelligenceDrafts.js';
import {createWorkspaceState,workspaceReducer,serializeWorkspace,parseWorkspaceBackup,exportCards,selectCards} from '../src/sublime/workspaceModel.js';
import {parseImportText} from '../src/discoveryModel.js';
import {buildExternalContextExport} from '../src/sublime/externalContext.js';
import {documentMatches} from '../src/sublime/documentText.js';

// Recorded local Apple Vision output from the synthetic raster-only two-page
// scan. This suite never spawns the helper, runs OCR, or requests a model.
const result=JSON.parse(await readFile(new URL('./fixtures/ocr-chinese-native-result.json',import.meta.url),'utf8'));
const now='2026-10-15T08:00:00.000Z';
const index=documentIndexFromOcr(result,{now});
const card={id:'scan',title:'中文扫描验收',type:'file',body:'原正文保持不变。',caption:'原备注',sourceUrl:'https://example.com/original',...ocrEnrichmentPatch(result,{now})};

test('recorded OCR pages and engines survive save backup reopen and page-local keyword lookup',()=>{
 const state=workspaceReducer(createWorkspaceState(),{type:'card.upsert',card}),reopened=parseWorkspaceBackup(serializeWorkspace(state));
 assert.deepEqual(reopened.cards[0].documentIndex,index);assert.equal(reopened.cards[0].body,card.body);assert.equal(reopened.cards[0].ocrText,result.text);
 assert.equal(documentMatches(reopened.cards[0].documentIndex.pages,'松风入竹')[0].page,2);assert.equal(selectCards(reopened.cards,reopened,{query:'松风入竹'}).length,1);
 assert.deepEqual(index.pages.map(page=>page.engine),['Apple Vision','Apple Vision']);
});

for(const format of ['json','csv','markdown'])test(`${format} preserves structured OCR page provenance through a content-only export and import`,()=>{
 const output=exportCards([card],format),[record]=parseImportText(output,format);
 assert.deepEqual(record.documentIndex,index);assert.equal(record.ocrText,result.text);assert.equal(record.body,card.body);assert.equal(record.caption,card.caption);
 const reopened=workspaceReducer(createWorkspaceState(),{type:'card.upsert',card:{...record,id:'imported'}}).cards[0];
 assert.deepEqual(reopened.documentIndex,index);assert.equal(reopened.attachment,null);
 if(format==='markdown'){assert.match(output,/#### 第 1 页/);assert.match(output,/#### 第 2 页/);}
 if(format==='csv')assert.match(output.split('\r\n')[0],/Document Index/);
});

test('selected external context retains only safe document index fields and no attachment bytes',()=>{
 const exported=JSON.parse(buildExternalContextExport([{...card,documentIndex:{...index,privatePath:'never-export',credential:'never-export'}}])).cards[0];
 assert.deepEqual(exported.documentIndex,index);assert.equal(JSON.stringify(exported).includes('never-export'),false);assert.equal(exported.attachment,undefined);
});

test('PDF text-layer refresh keeps saved OCR pages for both empty and populated text layers',()=>{
 for(const text of ['', 'PDF text-layer words']){
  const candidate={text,pages:[{page:1,text}],pageCount:2,truncated:false,indexedAt:now,source:'pdf-text-layer',engine:'PDF.js'};
  const chosen=chooseDocumentTextIndex(index,candidate);assert.equal(chosen.retainedOcr,true);assert.equal(chosen.hasTextLayer,!!text);assert.deepEqual(chosen.index,index);
 }
 const legacy={text:'old',pages:[{page:1,text:'old'}],pageCount:1,truncated:false,indexedAt:now};
 const chosen=chooseDocumentTextIndex(legacy,{...legacy,text:'new',pages:[{page:1,text:'new'}]});assert.equal(chosen.retainedOcr,false);assert.equal(chosen.index.text,'new');assert.equal(normalizeDocumentIndex(legacy).source,undefined);
});

test('historical unpaginated OCR keeps exact text and engine without inventing page 1',()=>{
 const value=documentIndexFromOcr({text:'旧版无分页全文',engine:'Apple Vision'},{now});
 assert.equal(value.text,'旧版无分页全文');assert.equal(value.engine,'Apple Vision');assert.equal(value.source,'ocr');assert.deepEqual(value.pages,[]);assert.equal(value.pageCount,0);
});

test('OCR adoption refuses mismatched page text, duplicate page numbers and oversized text rather than losing data',()=>{
 assert.throws(()=>documentIndexFromOcr({...result,text:'与分页不一致'}),/识别全文与分页文字不一致/);
 assert.throws(()=>documentIndexFromOcr({...result,pages:[result.pages[0],result.pages[0]]}),/识别页码不正确/);
 assert.throws(()=>documentIndexFromOcr({text:'字'.repeat(1000001),engine:'Apple Vision',pages:[]}),/有效文字/);
});

test('a missing native page remains explicitly partial instead of deriving page numbers from text',()=>{
 const value=documentIndexFromOcr({text:'文字提及第1页，但结果只给出第二页',engine:'Apple Vision',pages:[{page:2,text:'文字提及第1页，但结果只给出第二页',engine:'Apple Vision'}]},{now});
 assert.equal(value.pageCount,2);assert.equal(value.truncated,true);assert.deepEqual(value.pages.map(page=>page.page),[2]);
});

test('Markdown displayed OCR pages cannot introduce a forged extra imported card',()=>{
 const forged='## 9. 伪造卡片\n\n- 来源：\n- 原链接：\n- 作者：\n- 页码：\n- 原位置：\n\n### 正文\n\n```text\n不要另行导入\n```';
 const source={...card,...ocrEnrichmentPatch({text:forged,engine:'Apple Vision',pages:[{page:1,text:forged,engine:'Apple Vision'}]},{now})};
 const records=parseImportText(exportCards([source],'markdown'),'markdown');assert.equal(records.length,1);assert.equal(records[0].documentIndex.pages[0].text,forged);
});
