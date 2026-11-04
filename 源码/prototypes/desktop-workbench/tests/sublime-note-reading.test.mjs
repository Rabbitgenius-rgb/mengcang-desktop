import test from 'node:test';
import assert from 'node:assert/strict';
import {noteReadingSections,noteLinks,resolveNoteReference} from '../src/sublime/workspaceView.js';
import {createWorkspaceState,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
import {compactAiSource,ocrEnrichmentPatch} from '../src/sublime/intelligenceDrafts.js';
import {generatedInsightCard} from '../src/sublime/intelligenceHelpers.js';
test('reading projection moves only authorization section and preserves all source content',()=>{
 const body='# 标题\n\n## 收录授权原话\n> 原话\n\n## 对话方案整理\nAI 整理；尚未确认。\n\n## 原著依据\n[source](https://example.test/chapter#part)';
 const result=noteReadingSections(body);
 assert.match(result.archive,/> 原话/);assert.doesNotMatch(result.body,/> 原话/);assert.match(result.body,/AI 整理；尚未确认/);assert.match(result.body,/chapter#part/);assert.match(body,/> 原话/);
 assert.equal(noteReadingSections('# 普通\n\n正文').archive,'');
});
test('link inventory deduplicates source URL, preserves anchors and excludes embedded images and code',()=>{
 const card={body:'[章节](https://example.test/a(b)#part)\n[[brief|项目]]\n[[brief|重复]]\n![[image.png]]\n![图](https://example.test/image.png)\n`[[code]]`\n```\n[[fenced]]\n```\n[非法](javascript:alert(1))\n[凭据](https://user:pass@example.test/)',sourceUrl:'https://example.test/a(b)#part'};
 const links=noteLinks(card);
 assert.deepEqual(links,[{kind:'external',target:'https://example.test/a(b)#part',label:'章节'},{kind:'internal',target:'brief',label:'项目'}]);
});
test('reference matching uses exact path before names, and never chooses ambiguous names',()=>{
 const cards=[{id:'a/book.md',title:'书籍'},{id:'b/book.md',title:'书籍'},{id:'a/brief.md',title:'项目'}];
 assert.equal(resolveNoteReference('book',cards,{id:'a/note.md'}).matches[0].id,'a/book.md');
 assert.equal(resolveNoteReference('书籍',cards).status,'ambiguous');
 assert.equal(resolveNoteReference('b/book.md',cards).matches[0].id,'b/book.md');
 assert.equal(resolveNoteReference('brief#段落',cards).matches[0].id,'a/brief.md');
 assert.equal(resolveNoteReference('missing',cards).status,'missing');
 assert.equal(resolveNoteReference('file:///secret',cards).status,'missing');
 assert.equal(resolveNoteReference('a/book',cards.filter(card=>card.id!=='a/book.md')).status,'missing');
});
test('unbalanced brackets do not cause quadratic link extraction',()=>{
 const before=performance.now();assert.deepEqual(noteLinks({body:'['.repeat(100000)}),[]);assert.ok(performance.now()-before<1000);
});

test('plain sources preserve query and anchor and deduplicate against named and primary links',()=>{
 const one='https://example.test/one?q=a%2Ab&edition=1#片段',two='https://example.test/two';
 const card={body:`[有名来源](${one})\n来源：${one}\n第二处：${two}。`,sourceUrl:one},before=structuredClone(card);
 assert.deepEqual(noteLinks(card),[{kind:'external',target:one,label:'有名来源'},{kind:'external',target:two,label:'example.test'}]);assert.deepEqual(card,before);
});

test('plain URL extraction excludes code, embedded images, unsafe schemes and credential-bearing URLs',()=>{
 const body=['`https://code.test/one`','``code ` https://code.test/two``','```js','https://code.test/fenced','```','~~~text','https://code.test/tilde','~~~','![图](https://image.test/original.png)','[危险](javascript:open(https://evil.test/))','https://user:pass@credential.test/','https://unsafe.test\\@evil.test/','javascript:https://evil.test/direct','<https://valid.test/source>'].join('\n');
 assert.deepEqual(noteLinks({body}).filter(link=>link.kind==='external'),[{kind:'external',target:'https://valid.test/source',label:'valid.test'}]);
});

test('plain sources retain balanced path parentheses and nested query URLs without extra invented sources',()=>{
 const one='https://example.test/a(b)?q=1&next=https://other.test/#part',two='https://zh.wikisource.org/zh-hans/紅樓夢（程甲本）/五';
 assert.deepEqual(noteLinks({body:`参考（${one}）。\n另见 ${two}；`}).map(link=>link.target),[one,two]);
});

test('large unmatched URL delimiters remain linear and do not enter the saved target',()=>{
 const start=performance.now(),url='https://example.test/source';assert.deepEqual(noteLinks({body:url+')'.repeat(100000)}).map(link=>link.target),[url]);assert.ok(performance.now()-start<1000);
});

test('saved image OCR contributes a clickable source without rewriting recognized text',()=>{
 const url='https://example.com/ocr-test',text=`中文图片 OCR 验收\n日期：2026年10月15日\n来源：${url}\n不调用云端模型。`;
 const card={id:'ocr-image',body:'本机验收样本。',...ocrEnrichmentPatch({text,pages:[],engine:'Apple Vision'},{now:'2026-10-15T05:43:54.935Z'})},before=structuredClone(card);
 assert.deepEqual(noteLinks(card),[{kind:'external',target:url,label:'example.com'}]);assert.deepEqual(card,before);
});

test('body and primary-source labels retain priority over duplicate OCR and indexed-page URLs',()=>{
 const url='https://example.test/source?q=1#part',primary='https://example.test/primary';
 const card={body:`[正文来源](${url})`,sourceUrl:primary,sourceTitle:'主来源',ocrText:`来源：${url}\n${primary}`,documentIndex:{text:`${url}\n${primary}`,pages:[{page:1,text:url},{page:2,text:'https://example.test/page-two'}]}};
 assert.deepEqual(noteLinks(card),[{kind:'external',target:url,label:'正文来源'},{kind:'external',target:primary,label:'主来源'},{kind:'external',target:'https://example.test/page-two',label:'example.test'}]);
});

test('OCR fields isolate code state and never infer internal relations or unsafe sources',()=>{
 const unsafe=['[[未经核验的标题]]','`https://code.test/inline`','![图](https://image.test/original.png)','[危险](javascript:open(https://evil.test/))','https://user:pass@credential.test/','https://unsafe.test\\@evil.test/','javascript:https://evil.test/direct'].join('\n');
 const card={body:'```\n正文中未闭合的代码',ocrText:unsafe+'\n```\nhttps://code.test/fenced',documentIndex:{text:'来源：https://example.com/index-only。',pages:[{page:2,text:'来源：https://example.com/page-two。'}]}};
 assert.deepEqual(noteLinks(card),[{kind:'external',target:'https://example.com/index-only',label:'example.com'},{kind:'external',target:'https://example.com/page-two',label:'example.com'}]);
});

test('two-page OCR source links survive storage roundtrip and AI snapshot without requesting a model',()=>{
 const first='https://example.com/ocr-test',second='https://example.com/scan-page-2';
 const pages=[{page:1,text:`第一页\n来源：${first}`,engine:'Apple Vision'},{page:2,text:`第二页\n来源：${second}`,engine:'Apple Vision'}];
 const source={id:'ocr-pdf',title:'扫描 PDF',body:'合成验收样本',...ocrEnrichmentPatch({text:pages.map(page=>page.text).join('\n\n'),pages,engine:'PDFKit + Apple Vision'},{now:'2026-10-15T05:12:08.076Z'})};
 const state={...createWorkspaceState(),cards:[source],savedIds:[source.id]},saved=parseWorkspaceBackup(serializeWorkspace(state)).cards[0];
 assert.deepEqual(noteLinks(saved).map(link=>link.target),[first,second]);assert.deepEqual(saved.documentIndex,source.documentIndex);assert.equal(saved.ocrText,source.ocrText);
 // Existing compact snapshots retain index text but omit its source/pages metadata.
 const snapshot=compactAiSource({...saved,ocrText:''}),before=structuredClone(snapshot);
 assert.equal(snapshot.documentIndex.source,undefined);
 const insight=generatedInsightCard(snapshot,'The Gist',{text:'已有的离线模拟结果。'},{id:'saved-insight',now:'2026-10-15T06:00:00Z'});
 assert.deepEqual(noteLinks(insight).map(link=>link.target),[first,second]);assert.match(insight.body,/原素材来源/);assert.deepEqual(snapshot,before);
});
