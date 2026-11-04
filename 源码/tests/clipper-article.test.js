const test=require('node:test'),assert=require('node:assert/strict');
const {prepareArticleImages}=require('../desktop/clipper-article.cjs');
const picture=(id,src='https://example.com/image.png')=>({id,type:'image',src,alt:'原图',caption:'图注'});
const file={name:'image.png',type:'image/png',size:4,dataUrl:'data:image/png;base64,AAAA'};
test('article downloads retain order, reuse repeated URLs and keep an explicit failure placeholder',async()=>{
 let requests=0;const input={version:1,blocks:[{id:'p',type:'paragraph',runs:[{text:'原文'}]},picture('one'),picture('two'),picture('bad','https://example.com/missing.png')]};
 const result=await prepareArticleImages(input,{captureImage:async url=>{requests++;if(url.endsWith('missing.png'))throw Error('blocked');return file;}});
 assert.equal(requests,2);assert.deepEqual(result.blocks.map(block=>block.id),['p','one','two','bad']);
 assert.equal(result.blocks[1].attachment.name,'image.png');assert.ok(result.blocks[3].imageError);assert.equal(input.blocks[1].attachment,undefined);
});
test('article byte and time budgets keep text while reporting every image that could not be saved',async()=>{
 const input={version:1,blocks:[picture('one'),picture('two'),picture('three')]};
 const bytes=await prepareArticleImages(input,{maxBytes:4,captureImage:async()=>file});
 assert.equal(bytes.blocks.filter(block=>block.attachment).length,1);assert.equal(bytes.blocks.filter(block=>block.imageError).length,2);
 let tick=0,requests=0;const timed=await prepareArticleImages(input,{now:()=>tick++,deadlineMs:0,captureImage:async()=>{requests++;return file;}});
 assert.equal(requests,0);assert.ok(timed.blocks.every(block=>block.imageError));
});
test('inline originals are reserved before derived downloads and are never silently discarded',async()=>{
 const input={version:1,blocks:[picture('remote'),{id:'inline',type:'image',src:'',attachment:file}]};
 const result=await prepareArticleImages(input,{maxBytes:4,captureImage:async()=>file});
 assert.ok(result.blocks[0].imageError);assert.deepEqual(result.blocks[1].attachment,file);
 await assert.rejects(prepareArticleImages(input,{maxBytes:3}),{code:'ARTICLE_IMAGE_TOO_LARGE'});
});
test('table and numbered list data survive image preparation while adjacent table images use the normal download path',async()=>{
 const table={id:'table',type:'table',rows:[{cells:[{runs:[{text:'列一'}],header:true,colspan:2}]}],imagesAfter:true};
 const list={id:'list',type:'list-item',marker:'4.',depth:1,runs:[{text:'列表项'}]};
 const input={version:1,blocks:[list,table,picture('table-image')]};let requests=0;
 const result=await prepareArticleImages(input,{captureImage:async()=>{requests++;return file;}});
 assert.equal(requests,1);assert.deepEqual(result.blocks[0],list);assert.deepEqual(result.blocks[1],table);assert.deepEqual(result.blocks[2].attachment,file);
 assert.equal(input.blocks[2].attachment,undefined);
});
