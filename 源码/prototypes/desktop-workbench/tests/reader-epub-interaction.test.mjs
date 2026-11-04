import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as model from '../src/reader/epubReaderModel.js';

const compiled=(await transform(await readFile(new URL('../src/reader/EpubBookReader.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const nodeText=tree=>tree==null||typeof tree==='boolean'?'':typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(nodeText).join(''):nodeText(tree.props?.children);
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const node of tree){const match=find(node,predicate);if(match)return match;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}

// The real component/hook handlers run with a deterministic animation queue and
// minimal DOM Range text accounting. No renderer code is reimplemented here.
// ZIP reading is replaced by an already parsed, immutable book to isolate input
// ordering and persisted selection offsets from archive parsing (tested apart).
function readerHarness({brokenImage=false,progress=.6}={}){
 const plain='第一章\n图片后选中的文字\n',treeNodes=[{tag:'h1',children:['第一章','\n']},...(brokenImage?[{tag:'img',attrs:{imagePath:'OPS/image.svg',alt:'缺失的封面图片'},children:[]}]:[]),{tag:'p',children:['图片后选中的文字','\n']}];
 const book={chapters:[{path:'OPS/a.xhtml',title:'第一章',tree:treeNodes,text:plain,images:brokenImage?['OPS/image.svg']:[]}],outline:[],image:async()=>null,resolveHref:()=>null};
 const hooks=[],effects=[],frames=new Map(),locations=[],selections=[];let cursor=0,dirty=true,currentTree,frameId=0,selection=null;
 const viewport={scrollTop:0,scrollHeight:1100,clientHeight:100,getBoundingClientRect:()=>({top:0,height:100})};
 const article={fullText:'',contains:()=>true,querySelectorAll:()=>[],getBoundingClientRect:()=>({top:0,height:100})};
 function same(a,b){return !!a&&!!b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));}
 const react={
  createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;return hooks[i]||(hooks[i]={current:initial});},
  useMemo(factory,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,value:factory()};return hooks[i].value;},
  useCallback(callback,deps){return this.useMemo(()=>callback,deps);},
  useEffect(callback,deps){const i=cursor++,prior=hooks[i];if(prior&&same(prior.deps,deps))return;hooks[i]={deps,cleanup:prior?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=callback();});}
 };
 react.useCallback=(callback,deps)=>react.useMemo(()=>callback,deps);
 const document={createRange(){let endpoint=0;return {selectNodeContents(){},setEnd(node,offset){endpoint=node.globalStart+offset;},toString(){return article.fullText.slice(0,endpoint);}};}};
 const module={exports:{}},context={module,exports:module.exports,console,URL,AbortController,Blob,Image:class{},document,window:{getSelection:()=>selection},NodeFilter:{SHOW_TEXT:4},requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id),require:specifier=>specifier==='react'?react:specifier==='./epubReaderModel.js'?{...model,readEpubSource:async()=>new Uint8Array(),openEpub:async()=>book}:specifier.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+specifier);})()};
 vm.runInNewContext(compiled,context);
 let props={source:{sourceKey:'immutable-book',url:'mengcang-reader://source/fixture'},location:{chapter:0,progress},onLocation:value=>locations.push(value),onSelection:value=>selections.push(value)};
 function render(patch={}){props={...props,...patch};dirty=false;cursor=0;currentTree=module.exports.default(props);const articleElement=find(currentTree,node=>node.type==='article'),viewportElement=find(currentTree,node=>node.props?.className==='mc-epub-scroll');if(articleElement){articleElement.props.ref.current=article;article.fullText=nodeText(articleElement.props.children);}if(viewportElement)viewportElement.props.ref.current=viewport;while(effects.length)effects.shift()();}
 async function settle(){for(let step=0;step<8;step++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}}
 function flushFrames(){for(const [id,callback] of [...frames]){frames.delete(id);callback();}}
 render();
 return {settle,render,flushFrames,viewport,locations,selections,find:predicate=>find(currentTree,predicate),unmount(){for(const hook of hooks)hook?.cleanup?.();},pendingFrames:()=>frames.size,scroll(){find(currentTree,node=>node.props?.className==='mc-epub-scroll').props.onScroll();},select(text){const start=article.fullText.indexOf(text);assert.ok(start>=0);const container={globalStart:0};selection={isCollapsed:false,rangeCount:1,toString:()=>text,getRangeAt:()=>({startContainer:container,startOffset:start,endContainer:container,endOffset:start+text.length})};find(currentTree,node=>node.type==='article').props.onMouseUp();},plain,visibleText:()=>article.fullText};
}

test('EPUB restoration remains scheduled if a scroll event arrives before its animation frame',async()=>{
 const harness=readerHarness();await harness.settle();assert.equal(harness.pendingFrames(),1);
 harness.scroll();harness.flushFrames();await harness.settle();
 assert.equal(harness.viewport.scrollTop,600,'restored fraction must survive an intervening native scroll event');
 assert.ok(harness.locations.length>0,'initial restoration must finish so future scrolls can persist');
 harness.viewport.scrollTop=750;harness.scroll();harness.flushFrames();assert.equal(harness.locations.at(-1).progress,.75);
});

test('EPUB text after an unavailable image retains the same selection and annotation offsets as chapter text',async()=>{
 const harness=readerHarness({brokenImage:true,progress:0});await harness.settle();harness.flushFrames();
 const text='图片后选中的文字';harness.select(text);const saved=harness.selections.at(-1),expected=harness.plain.indexOf(text);
 assert.equal(saved.locator.start,expected,'a visual image placeholder must not add characters to persisted book-text offsets');
 assert.equal(harness.plain.slice(saved.locator.start,saved.locator.end),text);
});

test('EPUB ordinary selection offsets match chapter text without unavailable image placeholders',async()=>{
 const harness=readerHarness({progress:0});await harness.settle();harness.flushFrames();const text='图片后选中的文字';harness.select(text);const saved=harness.selections.at(-1);assert.equal(harness.plain.slice(saved.locator.start,saved.locator.end),text);
});

test('EPUB unavailable images retain their accessible alt label without injecting body text',async()=>{
 const harness=readerHarness({brokenImage:true,progress:0});await harness.settle();
 const placeholder=harness.find(node=>node.props?.className==='mc-epub-image-placeholder');assert.equal(placeholder.props.role,'img');assert.equal(placeholder.props['aria-label'],'缺失的封面图片');assert.equal(nodeText(placeholder),'');assert.equal(harness.visibleText(),harness.plain);
 const css=await readFile(new URL('../src/reader/epubBookReader.css',import.meta.url),'utf8');assert.match(css,/\.mc-epub-image-placeholder::before\s*\{\s*content:\s*attr\(aria-label\)/);
});

test('EPUB unmount cancels independent pending restoration and scroll-save frames',async()=>{
 const harness=readerHarness();await harness.settle();harness.scroll();assert.equal(harness.pendingFrames(),2);harness.unmount();assert.equal(harness.pendingFrames(),0);harness.flushFrames();assert.equal(harness.locations.length,0);
});
