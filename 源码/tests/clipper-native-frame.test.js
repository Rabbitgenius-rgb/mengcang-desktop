const test=require('node:test'),assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {runNativeHost,ORIGIN}=require('../scripts/clipper-native-host.cjs');
test('an oversized native reply returns exactly one framed error rather than exiting without a receipt',async()=>{
 const input=new PassThrough(),output=new PassThrough(),chunks=[];output.on('data',chunk=>chunks.push(chunk));
 const done=runNativeHost({input,output,origin:ORIGIN,directory:'/isolated',callPrivate:async()=>({items:[{text:'x'.repeat(300000)}]})});
 const body=Buffer.from(JSON.stringify({method:'highlights',params:{sourceUrl:'https://example.com/page'}})),frame=Buffer.alloc(body.length+4);frame.writeUInt32LE(body.length);body.copy(frame,4);input.end(frame);
 await done;
 const bytes=Buffer.concat(chunks);assert.equal(bytes.length,bytes.readUInt32LE(0)+4);
 const reply=JSON.parse(bytes.subarray(4));assert.equal(reply.ok,false);assert.equal(reply.error.code,'RESPONSE_TOO_LARGE');
 assert.ok(bytes.length<1024);
});
