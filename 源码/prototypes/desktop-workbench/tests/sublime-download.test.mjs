import test from 'node:test';
import assert from 'node:assert/strict';
import {requestWorkspaceDownload} from '../src/sublime/workspaceDownload.js';
function fixture(native=true){
 const urls=new Map(),released=[],listeners=new Set(),pageHide=new Set(),timers=[];let clicks=0,sequence=0;
 const env={
  document:{createElement(){return {click(){assert.ok(this.connected);clicks++;},remove(){this.connected=false;}};},body:{appendChild(anchor){anchor.connected=true;}}},
  URL:{createObjectURL(blob){const url=`blob:test/${++sequence}`;urls.set(url,blob);return url;},revokeObjectURL(url){released.push(url);}},
  setTimeout(fn,ms){timers.push({fn,ms});},
  addEventListener(name,fn){assert.equal(name,'pagehide');pageHide.add(fn);},removeEventListener(name,fn){assert.equal(name,'pagehide');pageHide.delete(fn);},
  ...(native?{mengcang:{subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}}}:{}),
 };
 return {env,urls,released,listeners,pageHide,timers,finish(event){for(const fn of [...listeners])fn(event);},get clicks(){return clicks;}};
}
test('a slow native save keeps intact bytes beyond the old timeout and releases only its completed download',async()=>{
 const f=fixture();requestWorkspaceDownload('原文\n第二行','本机卡片.html','text/html',f.env);
 const [url,blob]=[...f.urls][0];assert.equal(await blob.text(),'原文\n第二行');assert.equal(blob.type,'text/html');assert.equal(f.clicks,1);
 for(const timer of f.timers)if(timer.ms<=120000)timer.fn();assert.deepEqual(f.released,[]);
 f.finish({type:'download-finished',url:'blob:another',state:'completed'});assert.deepEqual(f.released,[]);
 f.finish({type:'download-finished',url,state:'completed'});assert.deepEqual(f.released,[url]);assert.equal(f.listeners.size,0);assert.equal(f.pageHide.size,0);
});
test('cancelled and interrupted downloads clean up independently and a retry gets a fresh URL',()=>{
 const f=fixture();requestWorkspaceDownload('a','a.json',undefined,f.env);requestWorkspaceDownload('b','b.json',undefined,f.env);
 f.finish({type:'download-finished',url:'blob:test/1',state:'cancelled'});assert.deepEqual(f.released,['blob:test/1']);assert.equal(f.listeners.size,1);
 f.finish({type:'download-finished',url:'blob:test/2',state:'interrupted'});requestWorkspaceDownload('a','a.json',undefined,f.env);
 assert.equal(f.urls.size,3);assert.equal(f.listeners.size,1);assert.equal(f.clicks,3);
});
test('browser and unfinished native downloads are retained until leaving the page',()=>{
 for(const native of [true,false]){const f=fixture(native);requestWorkspaceDownload('中文','note.md','text/markdown',f.env);
  for(const timer of f.timers)timer.fn();assert.deepEqual(f.released,[]);
  for(const listener of [...f.pageHide])listener();assert.deepEqual(f.released,['blob:test/1']);assert.equal(f.listeners.size,0);assert.equal(f.pageHide.size,0);
 }
});
test('an unsuccessful click releases the URL and subscriptions immediately',()=>{
 const f=fixture();f.env.document.createElement=()=>({click(){throw Error('download blocked');},remove(){}});
 assert.throws(()=>requestWorkspaceDownload('a','a.json',undefined,f.env),/download blocked/);assert.deepEqual(f.released,['blob:test/1']);assert.equal(f.listeners.size,0);assert.equal(f.pageHide.size,0);
});
