import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAllowed,captureBoundTab,pixelRect,screenshotSize,maxScreenshotBytes} from '../screenshot.js';
const tab={id:13,windowId:9,url:'https://example.org/original#fig',title:'原网页'};
const event=()=>{const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit(...args){for(const f of listeners)f(...args)},get size(){return listeners.size;}}};
function fixture(action=()=>{}){const tabs={onActivated:event(),onUpdated:event(),onRemoved:event(),query:async()=>[tab],captureVisibleTab:async(windowId,type)=>{assert.equal(windowId,9);assert.deepEqual(type,{format:'png'});action(tabs);return 'data:image/png;base64,AQ==';}};return tabs;}
test('captures only the bound active page and keeps its own provenance',async()=>{
 assert.equal(captureAllowed('chrome://extensions/'),false);assert.equal(captureAllowed('https://chromewebstore.google.com/detail/x'),false);assert.equal(captureAllowed('https://example.org/?access_token=secret'),false);
 const tabs=fixture();assert.deepEqual(await captureBoundTab(tabs,tab),{tabId:13,windowId:9,url:tab.url,title:'原网页',dataUrl:'data:image/png;base64,AQ=='});assert.equal(tabs.onActivated.size,0);
});
test('switch-away-and-back or same-tab navigation during capture rejects the pixels',async()=>{
 for(const action of [tabs=>{tabs.onActivated.emit({windowId:9,tabId:14});tabs.onActivated.emit({windowId:9,tabId:13});},tabs=>tabs.onUpdated.emit(13,{status:'loading'}),tabs=>tabs.onRemoved.emit(13)]){
 const tabs=fixture(action);await assert.rejects(captureBoundTab(tabs,tab),/切换/);assert.equal(tabs.onUpdated.size,0);
 }
});
test('crop uses actual captured pixel dimensions; encoded image plus metadata fit the native frame',()=>{
 assert.deepEqual(pixelRect({left:.25,top:.2,right:.75,bottom:.7},2560,1600),{x:640,y:320,w:1280,h:800});
 assert.throws(()=>pixelRect({left:0,right:2,top:0,bottom:.5},2560,1600));
 assert.equal(screenshotSize('data:image/png;base64,AQ=='),1);
 const options={note:'测'.repeat(50000),collectionIds:['c'.repeat(2000)]};
 assert.ok(Math.ceil(maxScreenshotBytes(options)/3)*4+Buffer.byteLength(JSON.stringify(options))+16384<1024*1024);
});
