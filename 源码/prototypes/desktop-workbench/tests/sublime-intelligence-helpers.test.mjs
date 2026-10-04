import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEmbeddings,cosineSimilarity,intelligenceText,generatedInsightCard,extractDataPayload,visionImagePayload,isImageReference,MAX_VISION_IMAGE_BYTES} from '../src/sublime/intelligenceHelpers.js';
test('semantic ranking compares only compatible native vectors and never substitutes keywords',()=>{
 const items=[{id:'q',language:'zh',model:'native-v1',vector:[1,0]},{id:'same',language:'zh',model:'native-v1',vector:[2,0]},{id:'diff',language:'zh',model:'native-v1',vector:[0,3]},{id:'en',language:'en',model:'native-v1',vector:[1,0]},{id:'bad',language:'zh',model:'other',vector:[1,0]},{id:'empty',language:'zh',model:'native-v1',vector:[0,0]}];
 assert.deepEqual(rankEmbeddings(items,'q').map(x=>x.id),['same','diff']);assert.deepEqual(rankEmbeddings(items,'missing'),[]);assert.equal(cosineSimilarity([NaN],[1]),null);assert.equal(cosineSimilarity([1],[1,0]),null);
});
test('generated insight saves separately with original attribution and bounded input',()=>{
 const source={id:'original',title:'原始标题',body:'Original text',ocrText:'OCR',documentIndex:{text:'正文'},sourceUrl:'https://example.com/'};const before=structuredClone(source);
 const card=generatedInsightCard(source,'The Gist',{text:'生成结果'},{id:'new',now:'2026-10-04'});assert.equal(card.sourceCardId,'original');assert.equal(card.body,'生成结果');assert.equal(card.sourceUrl,source.sourceUrl);assert.deepEqual(source,before);assert.equal(intelligenceText({body:'a'.repeat(25000)}).length,20000);assert.match(intelligenceText(source),/OCR/);
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
