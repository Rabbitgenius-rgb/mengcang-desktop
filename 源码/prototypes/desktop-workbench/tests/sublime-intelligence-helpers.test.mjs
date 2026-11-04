import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEmbeddings,cosineSimilarity,intelligenceText,insightText,insightRecordScope,insightSourceLinks,readableMaterialText,semanticMaterialText,materialExcerpt,duplicateMaterialIds,generatedInsightCard,extractDataPayload,visionImagePayload,isImageReference,MAX_VISION_IMAGE_BYTES} from '../src/sublime/intelligenceHelpers.js';
test('semantic ranking compares only compatible native vectors and never substitutes keywords',()=>{
 const items=[{id:'q',language:'zh',model:'native-v1',vector:[1,0]},{id:'same',language:'zh',model:'native-v1',vector:[2,0]},{id:'diff',language:'zh',model:'native-v1',vector:[0,3]},{id:'en',language:'en',model:'native-v1',vector:[1,0]},{id:'bad',language:'zh',model:'other',vector:[1,0]},{id:'empty',language:'zh',model:'native-v1',vector:[0,0]}];
 assert.deepEqual(rankEmbeddings(items,'q').map(x=>x.id),['same','diff']);assert.deepEqual(rankEmbeddings(items,'missing'),[]);assert.equal(cosineSimilarity([NaN],[1]),null);assert.equal(cosineSimilarity([1],[1,0]),null);
});
test('generated insight saves separately with original attribution and bounded input',()=>{
 const source={id:'original',title:'原始标题',body:'Original text',ocrText:'OCR',documentIndex:{text:'正文'},sourceUrl:'https://example.com/'};const before=structuredClone(source);
 const card=generatedInsightCard(source,'The Gist',{text:'生成结果'},{id:'new',now:'2026-10-04'});assert.equal(card.sourceCardId,'original');assert.ok(card.body.includes('\n\n生成结果\n\n'));assert.match(card.body,/记录日期未提供/);assert.equal(card.sourceUrl,source.sourceUrl);assert.deepEqual(source,before);assert.equal(intelligenceText({body:'a'.repeat(25000)}).length,20000);assert.match(intelligenceText(source),/OCR/);
});
test('OCR requires explicitly available local original data and rejects remote fetching',()=>{
 assert.throws(()=>extractDataPayload({image:'https://example.com/private.png'}));assert.deepEqual(extractDataPayload({attachment:{dataUrl:'data:application/pdf;base64,JVBERg=='}}),{kind:'pdf',base64:'JVBERg=='});
});
test('vision accepts matching local raster originals, rejects remote and unsupported data, and never stores media in a generated note',()=>{
 const bytes=Buffer.from('\x89PNG\r\n\x1a\nsynthetic','latin1'),image={name:'sample.png',type:'image/png',size:bytes.length,dataUrl:`data:image/png;base64,${bytes.toString('base64')}`};
 assert.deepEqual(visionImagePayload(image),image);
 for(const invalid of [null,{...image,dataUrl:'https://example.test/private.png'},{...image,type:'image/svg+xml'},{...image,name:'sample.svg'},{...image,size:bytes.length+1},{...image,type:'image/jpeg'},{...image,dataUrl:'data:image/png;base64,eA==',size:1},{...image,size:MAX_VISION_IMAGE_BYTES+1},{...image,dataUrl:`data:image/png;base64,${'A'.repeat(Math.ceil(MAX_VISION_IMAGE_BYTES/3)*4+4)}`}])assert.throws(()=>visionImagePayload(invalid));
 const source={id:'original-image',type:'image',title:'原图',attachment:image,image:image.dataUrl};const note=generatedInsightCard(source,'Visual analysis',{text:'图片解读'},{id:'note',now:'2026-10-04'});
 assert.equal(note.title,'构图与配色 · 原图');assert.equal(note.sourceCardId,source.id);assert.equal(note.attachment,undefined);assert.equal(note.image,undefined);assert.equal(JSON.stringify(note).includes('base64'),false);assert.deepEqual(source.attachment,image);
 assert.equal(isImageReference({origin:'vault',type:'file',originalMime:'image/webp'}),true);
 assert.equal(isImageReference({type:'article',image:'https://example.test/thumbnail.png'}),false);
});

test('material previews strip Markdown plumbing, prefer notes and preserve originals',()=>{
 const card={id:'original',title:'群峰叠翠入遥岑，一杆长枪动客心',body:'# 群峰叠翠入遥岑，一杆长枪动客心\n## 原始分享文字\n> 3.53 复制打开抖音，看看作品 https://v.douyin.com/example/\nfOx:/ 12/16\n## 页面快照\n![[01_sources/_originals/image.png]]\n## 画面\n**蓝白山水**与水面之间，人物持长枪向上伸展。',caption:'人物与长枪形成贯穿画面的斜向动势。'};
 const original=structuredClone(card);
 assert.equal(materialExcerpt(card),card.caption);
 const clean=readableMaterialText(card.body,card.title);
 assert.match(clean,/蓝白山水与水面之间/);assert.doesNotMatch(clean,/#|01_sources|http|复制打开抖音|fOx/);
 assert.equal(semanticMaterialText(card).split(card.title).length-1,1);
 assert.match(semanticMaterialText(card),/斜向动势/);
 assert.equal(intelligenceText(card).includes('![[01_sources'),true);assert.deepEqual(card,original);
 assert.equal(materialExcerpt({title:'仅有图片',body:'![](image.png)'}),'暂无文字摘要，可打开查看原始素材。');
 assert.equal(materialExcerpt({body:'汉'.repeat(181)}),'汉'.repeat(180)+'…');
 assert.equal(readableMaterialText('正文 [参考说明](https://example.test/) 与 [[notes/另一笔记.md|另一笔记]]'), '正文 参考说明 与 另一笔记');
});
test('related materials omit exact content copies but retain distinct excerpts from the same source',()=>{
 const original={id:'vault',title:'原文',body:'# 原文\n相同的正文。'},copy={...original,id:'local',sourceCardId:'vault',caption:'新增备注'},excerpt={id:'excerpt',sourceCardId:'vault',title:'原文',body:'另一段摘录。'};
 assert.deepEqual(duplicateMaterialIds([original,copy,excerpt],original),['local']);
 assert.deepEqual(duplicateMaterialIds([original,copy,excerpt],copy),['vault']);
 assert.deepEqual(duplicateMaterialIds([{id:'b',title:'空标题'}],{id:'a',title:'空标题'}),[]);
});

test('insight context preserves metadata roles, unknown dates and the 20k input limit',()=>{
 const source={title:'旧记录',body:'当前选择为备选，本次不实施。',capturedAt:'2026-09-13T00:56:04+08:00',updatedAt:'2026-10-01T00:00:00Z'};
 const input=insightText(source);assert.match(input,/收录时间：2026-09-13/);assert.match(input,/修改时间：2026-10-01/);assert.match(input,/不是事件发生时间/);assert.match(input,/不要断言今天/);assert.ok(input.endsWith(source.body));
 assert.match(insightRecordScope({}),/记录日期未提供/);assert.match(insightRecordScope({date:'not a date'}),/记录日期未提供/);
 assert.equal(insightText({body:'字'.repeat(25000)}).length,20000);
});
test('saved insights preserve both real source links without trusting model citations or duplicating the primary source',()=>{
 const source={id:'real',title:'东风远渡',capturedAt:'2026-09-13T00:56:04+08:00',body:'[第五回](https://zh.wikisource.org/zh-hans/紅樓夢（程甲本）/五)\n[第六十三回](https://zh.wikisource.org/zh-hans/紅樓夢（程甲本）/六十三)\n[危险](javascript:alert(1))\n![图片](https://image.example/pic.png)',sourceUrl:'https://zh.wikisource.org/zh-hans/紅樓夢（程甲本）/五'};
 const before=structuredClone(source),result={text:'材料给出两个链接。'},card=generatedInsightCard(source,'The Gist',result,{id:'saved',now:'2026-10-14'});
 const links=insightSourceLinks(card);assert.equal(links.length,2);assert.ok(links.some(x=>decodeURI(x.target).endsWith('/六十三')));assert.ok(links.some(x=>decodeURI(x.target).endsWith('/五')));
 assert.match(card.body,/原素材来源/);assert.match(card.body,/收录时间：2026-09-13/);assert.ok(card.body.includes(result.text));assert.doesNotMatch(card.body,/javascript:|image.example/);assert.deepEqual(source,before);assert.equal(result.text,'材料给出两个链接。');
});

test('plain URLs omitted by the model survive saving as escaped clickable citations without editing the raw response',()=>{
 const url='https://example.test/a*(b)?q=a%2Ab#part',source={id:'plain-source',body:`原始出处：${url}。\n第二处：https://example.test/two`,sourceUrl:url},result={text:'模拟解读，没有列出网址。'},before=structuredClone(source);
 const saved=generatedInsightCard(source,'Analogy',result,{id:'saved',now:'2026-10-14T00:00:00Z'});
 assert.deepEqual(insightSourceLinks(saved).map(link=>link.target),[url,'https://example.test/two']);assert.ok(saved.body.includes(result.text));assert.match(saved.body,/记录日期未提供/);assert.equal(result.text,'模拟解读，没有列出网址。');assert.deepEqual(source,before);
});
