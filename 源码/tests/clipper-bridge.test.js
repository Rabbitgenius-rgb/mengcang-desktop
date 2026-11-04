'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {startClipperBridge}=require('../desktop/clipper-bridge.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const request=(kind='link')=>({version:1,requestId:'a1234567-1234-4234-8234-123456789abc',kind,title:'isolated fixture',body:'test article',sourceUrl:'https://example.com/page',...(kind==='image'?{imageUrl:'https://example.com/a.png'}:{})});
async function fixture({lookupFound=false}={}){
 const handlers=new Map(),sent=[];let registered,downloads=0;
 const contents={mainFrame:{url:'mengcang://app/'},isDestroyed:()=>false,send:(_channel,event)=>{
  sent.push(event);setImmediate(()=>handlers.get('mengcang:clipperResult')({sender:contents,senderFrame:contents.mainFrame},{commandId:event.commandId,workspaceId:event.workspaceId,ok:true,result:{workspaceId:'isolated',revision:2,...(event.method==='lookup'?{found:lookupFound}:{}),item:{id:'browser-clip:fixture',title:'saved',type:'link',sourceUrl:'https://example.com/page'}}}));
 }};
 const event={sender:contents,senderFrame:contents.mainFrame};
 const bridge=await startClipperBridge({directory:'/isolated/not-used',ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},getWindow:()=>({webContents:contents}),getWorkspaceId:()=>'isolated',startServer:async value=>{registered=value;return {close:async()=>{}};},captureImage:async()=>{downloads++;return {name:'a.png',type:'image/png',size:Buffer.from(png,'base64').length,dataUrl:'data:image/png;base64,'+png};}});
 return {handlers,sent,bridge,event,get registered(){return registered;},get downloads(){return downloads;}};
}
test('clipper exposes only capture/status and bounded metadata queries, rejecting invalid input before dispatch',async()=>{
 const f=await fixture();try{
  assert.deepEqual(Object.keys(f.registered.handlers).sort(),['capture','collections','highlights','openRelated','related','status']);assert.deepEqual(await f.registered.handlers.status({}),{ready:false});
  await assert.rejects(f.registered.handlers.collections({arbitrary:'field'}));
  await assert.rejects(f.registered.handlers.highlights({sourceUrl:'file:///private/notes'}));
  await assert.rejects(f.registered.handlers.collections({limit:51}));
  await assert.rejects(f.registered.handlers.related({requestId:'arbitrary',workspaceId:'isolated'}));
  await assert.rejects(f.registered.handlers.openRelated({requestId:request().requestId,workspaceId:'isolated',cardId:''}));
  await assert.rejects(f.registered.handlers.capture({version:99}));assert.equal(f.sent.length,0);
  await assert.rejects(f.registered.handlers.capture(request()),{code:'LIBRARY_NOT_READY'});
 }finally{await f.bridge.close();}assert.equal(f.handlers.size,0);
});
test('metadata queries dispatch only validated parameters to the trusted active workspace',async()=>{
 const f=await fixture();try{
  await f.handlers.get('mengcang:clipperReady')(f.event,{ready:true,workspaceId:'isolated'});
  await f.registered.handlers.collections({});await f.registered.handlers.highlights({sourceUrl:'https://example.com/page',limit:2});
  assert.deepEqual(f.sent.map(event=>event.method),['collections','highlights']);
  assert.deepEqual(f.sent[0].params,{offset:0,limit:50});assert.equal(f.sent[1].params.sourceUrl,'https://example.com/page');
 }finally{await f.bridge.close();}
});
test('rich article retries look up committed receipts before deriving any image downloads',async()=>{
 for(const found of [false,true]){
  const f=await fixture({lookupFound:found});try{
   await f.handlers.get('mengcang:clipperReady')(f.event,{ready:true,workspaceId:'isolated'});
   await f.registered.handlers.capture({...request('article'),article:{version:1,blocks:[{id:'p',type:'paragraph',runs:[{text:'test article'}]},{id:'i',type:'image',src:'https://example.com/a.png'}]}});
   assert.equal(f.sent[0].method,'lookup');assert.equal(f.downloads,found?0:1);
   if(!found)assert.equal(f.sent[1].params.article.blocks[1].attachment.type,'image/png');
  }finally{await f.bridge.close();}
 }
});
test('only the trusted renderer registers and committed clipper results use a separate event',async()=>{
 const f=await fixture();try{
  const bad=await f.handlers.get('mengcang:clipperReady')({...f.event,senderFrame:{url:'https://example.com/'}},{ready:true,workspaceId:'isolated'});assert.equal(bad.ok,false);
  assert.equal((await f.handlers.get('mengcang:clipperReady')(f.event,{ready:true,workspaceId:'isolated'})).ok,true);
  const result=await f.registered.handlers.capture(request());assert.equal(result.revision,2);assert.equal(f.sent[0].type,'clipperRequest');assert.equal(f.sent[0].method,'capture');
 }finally{await f.bridge.close();}
});
test('image retry looks up its committed receipt before downloading and never redownloads a saved original',async()=>{
 for(const found of [false,true]){
  const f=await fixture({lookupFound:found});try{
   await f.handlers.get('mengcang:clipperReady')(f.event,{ready:true,workspaceId:'isolated'});
   await f.registered.handlers.capture(request('image'));assert.equal(f.sent[0].method,'lookup');assert.equal(f.downloads,found?0:1);
   assert.equal(f.sent.length,found?1:2);if(!found)assert.ok(f.sent[1].params.attachment.dataUrl.startsWith('data:image/png;'));
  }finally{await f.bridge.close();}
 }
});
