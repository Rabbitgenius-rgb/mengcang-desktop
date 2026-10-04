import test from 'node:test';
import assert from 'node:assert/strict';
import {notePresentation,relatedMaterialPaths,relationPayload} from '../src/notePresentation.js';
import {draftFields,normalizeRecord} from '../src/desktopModel.js';

test('imported candidate provenance ID is not sent as a canonical relation ID',()=>{
 const actual=relationPayload({id:'preview-rel-3',targetPath:'b.md'},'confirm',{sourcePath:'a.md',targetPath:'b.md'});
 assert.equal(actual.relationId,undefined);assert.equal(actual.action,'confirm');
 const confirmed=relationPayload({relationId:'mc-rel-0123456789abcdef',peerPath:'b.md'},'revoke',{sourcePath:'a.md',targetPath:'b.md'});
 assert.equal(confirmed.relationId,'mc-rel-0123456789abcdef');
});
test('related materials include all four linked notes and deduplicate overlaps',()=>{
 assert.deepEqual(relatedMaterialPaths({materialPaths:['image.md','shared.md'],linkedPaths:['web1.md','web2.md','web3.md','poem.md','shared.md']}),['image.md','shared.md','web1.md','web2.md','web3.md','poem.md']);
});
test('legacy web share is folded separately while meaningful caption stays visible',()=>{
 const actual=notePresentation({title:'测试国画',fields:{caption:'用高斯泼溅效果做成的国画模型。'},body:'# 测试国画\n\n## 原始分享文字\n\n> 4.66 复制打开… https://example.test\n\n## 页面快照\n\n![[01_sources/_originals/test.png|720]]\n\n## AI 整理\n\n- 原有参考说明。\n\n## 来源状态\n\n- 来源待核对。'});
 assert.equal(actual.caption,'用高斯泼溅效果做成的国画模型。');
 assert.equal(actual.rawShare,'4.66 复制打开… https://example.test');
 assert.doesNotMatch(actual.body,/复制打开|原始分享文字|_originals|页面快照/);
 assert.match(actual.body,/原有参考说明/);assert.match(actual.body,/来源待核对/);
});
test('body caption is supported without inventing a caption or altering Markdown',()=>{
 const actual=notePresentation({title:'素材',fields:{},body:'## 配文\n\n正文保存的配文。\n\n## 资料说明\n\n保留说明。'});
 assert.equal(actual.caption,'正文保存的配文。');assert.equal(actual.body,'## 资料说明\n\n保留说明。');
});
test('managed payloads and source navigation are hidden without removing later human sections',()=>{
 const actual=notePresentation({title:'一条灵感',kind:'entry',fields:{summary:'整理说明',summary_status:'confirmed',caption:''},explorations:[{id:'e',kind:'补充',createdAt:'2026-09-28',text:'新增探索'}],body:'# 一条灵感\n\n## 灵感内容\n\n原始想法。\n\n## 整理说明\n\n整理说明\n\n## 继续探索\n\n原来提出的问题？\n\n<!-- mengcang:exploration {"id":"e","text":"新增探索"} -->\n- **补充 · 2026-09-28** 新增探索\n\n## 相关素材\n\n- [[01_sources/cards/images/a.md]]\n\n## 原始出处\n\n[[01_sources/_originals/a.txt|原始备忘录]] · 字符位置 12–30\n\n## 自己的后记\n\n不能丢失这段话。\n\n## 梦藏已确认联系\n\n<!-- mengcang-relations:start -->\n<!-- mengcang-relation-meta:ZXhhbXBsZQ -->\n- [[b.md]] — 关系说明\n<!-- mengcang-relations:end -->'});
 assert.equal(actual.summary,'整理说明');assert.equal(actual.caption,'');
 assert.doesNotMatch(actual.body,/mengcang|ZXhh|字符位置|_originals|相关素材|整理说明|新增探索/);
 assert.match(actual.body,/原始想法/);assert.match(actual.body,/原来提出的问题/);assert.match(actual.body,/不能丢失这段话/);
});
test('explicitly cleared caption remains empty in the editor and real book status is recognized',()=>{
 assert.equal(draftFields({fields:{caption:'',summary:'旧摘要'},description:'旧摘要',tags:[]}).caption,'');
 assert.equal(normalizeRecord({fields:{reading_status:'want-to-read'},kind:'book'}, {assetUrl:()=>''}).status,'want');
});
