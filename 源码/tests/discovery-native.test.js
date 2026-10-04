'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {analyze,validateRequest}=require('../desktop/discovery.cjs');
test('native request rejects malformed batches and never accepts renderer file paths',()=>{
 assert.throws(()=>validateRequest({texts:[{id:'ok',text:'valid'},null]}),/格式无效/);
 assert.throws(()=>validateRequest({command:'extract',kind:'pdf',path:'/any/private/file.pdf'}));
 assert.throws(()=>validateRequest({images:new Array(33).fill({id:'x',base64:'abc'})}));
});
test('local semantic retrieval ranks meaning without query words in source text',async()=>{
 const q='cultivating plants',garden='The gardener nurtures flowers, waters seedlings, and tends the soil each morning.';
 assert.equal(garden.toLowerCase().includes(q),false);
 const result=await analyze({texts:[{id:'q',text:q},{id:'garden',text:garden},{id:'radio',text:'An engineer tunes the radio receiver and repairs its electronic circuit.'}]});
 const vectors=result.embeddings;assert.equal(vectors.length,3);assert.ok(result.capabilities.semanticLanguages.includes('zh-Hans'));
 const query=vectors.find(item=>item.id==='q');
 const cosine=value=>query.vector.reduce((s,x,i)=>s+x*value.vector[i],0)/Math.sqrt(query.vector.reduce((s,x)=>s+x*x,0)*value.vector.reduce((s,x)=>s+x*x,0));
 assert.equal(new Set(vectors.map(item=>item.model)).size,1);
 assert.ok(cosine(vectors.find(item=>item.id==='garden'))>cosine(vectors.find(item=>item.id==='radio')));
});
test('Vision extracts visible image words that were not supplied as text metadata',async()=>{
 const image=fs.readFileSync(require('node:path').join(__dirname,'../prototypes/desktop-workbench/public/assets/inspiration-text-BCUMTc7F.avif'));
 const result=await analyze({command:'extract',kind:'image',base64:image.toString('base64')});
 assert.equal(result.engine,'Apple Vision');assert.match(result.text,/put the ocean/);assert.match(result.text,/through a straw/);
});
test('PDFKit keeps exact excerpt text and one-based page provenance',async()=>{
 const file=fs.readFileSync(require('node:path').join(__dirname,'fixtures/discovery-excerpt.pdf'));
 const result=await analyze({command:'extract',kind:'pdf',base64:file.toString('base64')});
 assert.equal(result.pages.length,2);assert.equal(result.pages[1].page,2);
 assert.equal(result.pages[0].text.trim(),'A quiet moment opens a space for a new idea.');
 assert.equal(result.pages[1].text.trim(),'A fragment becomes meaningful when its origin is preserved.');
 await assert.rejects(analyze({command:'extract',kind:'pdf',base64:Buffer.from('fake PDF').toString('base64')}),/PDF/);
});
