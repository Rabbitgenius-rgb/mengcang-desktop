'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createImageCapture,MAX_IMAGE_BYTES}=require('../desktop/clipper-image.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
const publicLookup=async()=>[{address:'93.184.216.34',family:4}];
test('selected public raster image becomes a validated local original',async()=>{
 let requested;
 const capture=createImageCapture({lookup:publicLookup,request:async(url,addresses,options)=>{requested={url,addresses,options};return {status:200,contentType:'image/png',bytes:png};}});
 const result=await capture('https://images.example.com/a%20test.png');
 assert.equal(result.name,'a test.png');assert.equal(result.size,png.length);assert.equal(result.type,'image/png');assert.equal(result.dataUrl,`data:image/png;base64,${png.toString('base64')}`);assert.equal(requested.addresses[0].address,'93.184.216.34');
});
test('private URLs, credentials, and private DNS targets fail before downloading',async()=>{
 let calls=0;const capture=createImageCapture({lookup:async()=>[{address:'127.0.0.1',family:4}],request:async()=>{calls++;}});
 for(const url of ['http://127.0.0.1/a.png','https://user:password@example.com/a.png','https://example.com/a.png?token=private','https://example.com/a.png'])await assert.rejects(capture(url));
 assert.equal(calls,0);
});
test('redirects recheck public URL and never contact an internal target',async()=>{
 let calls=0;const capture=createImageCapture({lookup:publicLookup,request:async()=>{calls++;return {status:302,location:'http://192.168.1.10/private.png'};}});
 await assert.rejects(capture('https://example.com/image.png'),{code:'PRIVATE_ADDRESS'});assert.equal(calls,1);
});
test('HTML disguised as an image, SVG, empty and oversized bodies cannot be saved',async()=>{
 for(const result of [{status:200,contentType:'image/png',bytes:Buffer.from('<html>script</html>')},{status:200,contentType:'image/svg+xml',bytes:Buffer.from('<svg/>')},{status:200,contentType:'image/png',bytes:Buffer.alloc(0)},{status:200,contentType:'image/png',bytes:Buffer.alloc(MAX_IMAGE_BYTES+1)}]){
  await assert.rejects(createImageCapture({lookup:publicLookup,request:async()=>result})('https://example.com/image.png'));
 }
});
test('proxy fake addresses use the validated public DNS fallback',async()=>{
 let fallback=0;const capture=createImageCapture({lookup:async()=>[{address:'198.18.0.3',family:4}],trustedLookup:async()=>{fallback++;return [{address:'93.184.216.34',family:4}];},request:async(_url,addresses)=>{assert.equal(addresses[0].address,'93.184.216.34');return {status:200,contentType:'image/png',bytes:png};}});
 await capture('https://example.com/image.png');assert.equal(fallback,1);
});
