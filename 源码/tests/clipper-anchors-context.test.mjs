import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {buildTextIndex,rangeForAnchor} from '../src/clipper/anchors.mjs';
import {domFixture} from '../browser-extension/tests/dom-fixture.mjs';

test('article and main headers keep readable text while site headers and navigation stay excluded',()=>{
 for(const tag of ['article','main']){
  const {document,element:e}=domFixture();
  const article=e(tag,{},e('header',{},e('h1',{},'文章标题'),e('p',{},'重要导语'),e('nav',{},'文章菜单')),e('p',{},'普通正文'));
  document.body=e('body',{},e('header',{},e('p',{},'站点导航')),article);
  assert.equal(buildTextIndex(document.body).text,'文章标题 重要导语 普通正文');
  assert.ok(rangeForAnchor(article,{version:1,exact:'重要导语',prefix:'文章标题',suffix:'普通正文'}));
 }
});

test('a visible article selection binds its own context after an earlier hidden article',async()=>{
 const {document,element:e}=domFixture(),paragraph=e('p',{},'选中的导语。'),node=paragraph.childNodes[0];
 const visible=e('article',{},e('header',{},e('h1',{},'可见标题'),paragraph),e('p',{},'文章后文'));
 document.body=e('body',{},e('article',{hidden:true},e('p',{},'隐藏副本')),e('div',{},'外部推广'),visible,e('div',{},'外部推荐'));
 const range={startContainer:node,startOffset:0,endContainer:node,endOffset:node.nodeValue.length,intersectsNode:value=>value===node,isPointInRange:(value,offset)=>value===node&&offset>=0&&offset<=node.nodeValue.length};
 const selection={rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=>node.nodeValue};
 let listener;
 const code=(await build({entryPoints:[fileURLToPath(new URL('../browser-extension/content-highlights-entry.js',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
 const context=vm.createContext({document,location:{href:'https://example.com/article',protocol:'https:'},window:{getSelection:()=>selection,addEventListener(){}},CSS:{highlights:new Map()},Highlight:class{},MutationObserver:class{observe(){}},chrome:{runtime:{id:'fixture-extension',getURL:part=>`chrome-extension://fixture-extension/${part}`,onMessage:{addListener:value=>listener=value},sendMessage:async()=>({ok:false})}},getComputedStyle:document.defaultView.getComputedStyle,Node:{TEXT_NODE:3,ELEMENT_NODE:1},URL,TextEncoder,setTimeout,clearTimeout});
 vm.runInContext(code,context);
 context.requestJSON=JSON.stringify({action:'mengcang:collect',kind:'highlight',selectedText:'选中的导语。',expectedUrl:'https://example.com/article'});
 context.senderJSON=JSON.stringify({id:'fixture-extension',url:'chrome-extension://fixture-extension/background.js'});
 let reply;listener(vm.runInContext('JSON.parse(requestJSON)',context),vm.runInContext('JSON.parse(senderJSON)',context),value=>reply=JSON.parse(JSON.stringify(value)));
 assert.equal(reply.ok,true);
 assert.equal(reply.data.anchor.prefix,'可见标题');assert.equal(reply.data.anchor.suffix,'文章后文');
 assert.ok(rangeForAnchor(visible,reply.data.anchor));
});
