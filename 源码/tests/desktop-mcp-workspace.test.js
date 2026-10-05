'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const {workspaceReadScript, readWorkspaceSnapshot} = require('../desktop/mcp-workspace.cjs');
function database(raw, {exists=true} = {}) {
  const calls = [];
  return {calls, indexedDB:{
    async databases(){calls.push('databases');return exists ? [{name:'mengcang-sublime-workspace-v1'}] : [];},
    open(name){calls.push(['open',name]);const request={};queueMicrotask(()=>{
      request.result={close(){calls.push('close');},transaction(store,mode){
        calls.push(['transaction',store,mode]);const tx={objectStore(){return {get(key){calls.push(['get',key]);const read={};queueMicrotask(()=>{read.result=raw;read.onsuccess();queueMicrotask(()=>tx.oncomplete?.());});return read;}};},abort(){queueMicrotask(()=>tx.onabort?.());}};return tx;
      }};request.onsuccess();
    });return request;}
  }};
}
const state = {cards:[{id:'one',title:'已保存',image:'data:image/png;base64,AAAA',attachment:{name:'图.png',type:'image/png',size:3,dataUrl:'data:image/png;base64,AAAA'}},{id:'hidden',title:'已归档'},{id:'unsaved',title:'未保存'}],savedIds:['one','hidden'],hiddenIds:['hidden'],favoriteIds:['one'],collections:[],boards:[],annotations:{one:{note:'已保存备注'}},drafts:{'new:text':{title:'未提交秘密'}}};
test('MCP reads the committed app workspace in a readonly transaction and excludes drafts/hidden/unsaved records',async()=>{
  const mock=database({format:'workspace-storage-v2',revision:12,state});
  const result=await vm.runInNewContext(workspaceReadScript('actual-workspace'),{indexedDB:mock.indexedDB,Set,Promise,Error});
  assert.equal(result.revision,12);assert.equal(result.state.cards.length,1);assert.equal(result.state.cards[0].id,'one');
  assert.equal(JSON.stringify(result).includes('未提交秘密'),false);assert.equal(JSON.stringify(result).includes('base64'),false);
  assert.equal(result.state.cards[0].imageAvailable,true);
  assert.deepEqual(mock.calls.find(value=>Array.isArray(value)&&value[0]==='transaction'),['transaction','workspaces','readonly']);
  assert.deepEqual(mock.calls.find(value=>Array.isArray(value)&&value[0]==='get'),['get','actual-workspace']);
});
test('only an explicit image read copies image bytes across the renderer boundary',async()=>{
  const mock=database({format:'workspace-storage-v2',revision:12,state});
  const result=await vm.runInNewContext(workspaceReadScript('actual',{includeAssets:true}),{indexedDB:mock.indexedDB,Set,Promise,Error});
  assert.equal(result.state.cards[0].attachment.dataUrl,state.cards[0].attachment.dataUrl);
});
test('an absent database stays absent rather than creating a second library',async()=>{
  const mock=database(null,{exists:false});
  assert.equal(await vm.runInNewContext(workspaceReadScript('actual'),{indexedDB:mock.indexedDB}),null);
  assert.deepEqual(mock.calls,['databases']);
});
test('MCP rejects non-app and closed windows without executing code',async()=>{
  let called=false;const window={isDestroyed:()=>false,getURL:()=> 'https://example.com/',executeJavaScript(){called=true;}};
  await assert.rejects(readWorkspaceSnapshot(window,'actual'),/打开梦藏/);assert.equal(called,false);
  await assert.rejects(readWorkspaceSnapshot(null,'actual'),/打开梦藏/);
});
test('the workspace key is quoted data, never executable material text',async()=>{
  const key='weird";throw Error("oops")//';const mock=database({format:'workspace-storage-v2',revision:1,state});
  await vm.runInNewContext(workspaceReadScript(key),{indexedDB:mock.indexedDB,Set,Promise,Error});
  assert.equal(mock.calls.find(value=>Array.isArray(value)&&value[0]==='get')[1],key);
});
