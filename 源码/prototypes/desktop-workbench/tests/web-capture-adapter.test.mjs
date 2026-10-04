import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import webCaptureVite, {captureMiddleware} from '../web-capture-vite.mjs';
import {captureWebPage} from '../src/sublime/webCapture.js';

test('capture and attachment transports install equally for development and local preview',()=>{for(const method of ['configureServer','configurePreviewServer']){const endpoints=[];webCaptureVite()[method]({middlewares:{use(path){endpoints.push(path);}}});assert.deepEqual(endpoints,['/__web-capture','/__file-preview']);}});
test('cross-origin requests cannot trigger a capture',async()=>{
  let requests=0,body;
  await captureMiddleware(async()=>{requests++;})({headers:{host:'127.0.0.1:4191',origin:'https://attacker.example','x-mengcang-capture':'1'},method:'POST'},{setHeader(){},end(value){body=value;}});
  assert.equal(requests,0);assert.equal(JSON.parse(body).error.code,'FORBIDDEN');
});
test('same-origin POST validates and invokes one explicit capture',async()=>{
  const req=new EventEmitter();Object.assign(req,{headers:{host:'127.0.0.1:4191',origin:'http://127.0.0.1:4191','x-mengcang-capture':'1','content-type':'application/json'},method:'POST'});
  let requests=0,body;
  const job=captureMiddleware(async url=>{requests++;assert.equal(url,'https://example.com/');return {title:'Captured',body:'Public paragraph'};})(req,{setHeader(){},end(value){body=value;}});
  req.emit('data',Buffer.from(JSON.stringify({url:'https://example.com/'})));req.emit('end');await job;
  assert.equal(requests,1);assert.equal(JSON.parse(body).data.title,'Captured');
});
test('desktop renderer capture uses only its dedicated IPC and surfaces errors',async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch;let called=0;
  try {
    globalThis.fetch=()=>{throw Error('must not fetch in desktop renderer');};
    globalThis.window={mengcang:{webCapture:async url=>{called++;assert.equal(url,'https://example.com/');return {ok:true,data:{title:'Test',body:'Text'}};}}};
    assert.deepEqual(await captureWebPage('https://example.com'),{title:'Test',body:'Text'});assert.equal(called,1);
    globalThis.window.mengcang.webCapture=async()=>({ok:false,error:{code:'PRIVATE_ADDRESS',message:'私网已阻止'}});
    await assert.rejects(captureWebPage('https://example.com'),{code:'PRIVATE_ADDRESS',message:'私网已阻止'});
    await assert.rejects(captureWebPage('file:///etc/passwd'),/HTTP/);
  } finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
