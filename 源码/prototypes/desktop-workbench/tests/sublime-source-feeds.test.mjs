import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as feeds from '../src/sublime/sourceFeeds.js';
import * as discovery from '../src/discoveryModel.js';
import {createWorkspaceState,workspaceReducer} from '../src/sublime/workspaceModel.js';
const fixture={url:'https://example.com/feed',title:'公开播客',items:[{id:'a'.repeat(64),title:'第一期',body:'中文原文 café 🧪',sourceUrl:'https://example.com/episode',sourceTitle:'公开播客',type:'audio',enclosureUrl:'https://example.com/episode.mp3',date:'2026-10-04T00:00:00.000Z'}],fetchedAt:'2026-10-04T00:00:00.000Z',warnings:[]};

test('podcast record survives workspace normalization and stable source identity suppresses future updates',()=>{
  const [record]=feeds.feedRecords(fixture);const state=workspaceReducer(createWorkspaceState(),{type:'card.upsert',card:{...record,id:'fixture-card',path:'fixture-card',origin:'local'}});
  assert.equal(state.cards[0].type,'audio');assert.match(state.cards[0].body,/音频或附件原文件.*episode\.mp3/);assert.equal(state.cards[0].sourceLocation,'订阅条目:'+'a'.repeat(64));
  assert.equal(feeds.pendingFeedRecords([{...record,body:record.body+' update'}],state.cards).items.length,0);assert.equal(feeds.pendingFeedRecords([record,record]).items.length,1);
});
test('web clipping parser preserves unmodified original body and rejects malformed or credential URLs',()=>{
  const clip={format:'mengcang-web-clip',schema:1,items:[{title:'原题',body:' 原文\r\n café 🧪 ',sourceUrl:'https://example.com/read',type:'highlight'}]};
  assert.equal(feeds.parseWebClip(JSON.stringify(clip))[0].body,clip.items[0].body);
  for(const bad of [{...clip,format:'other'}, {...clip,items:[]}, {...clip,items:[{...clip.items[0],sourceUrl:'https://example.com/?token=private'}]}, {...clip,items:[{...clip.items[0],body:'x'.repeat(50001)}]}])assert.throws(()=>feeds.parseWebClip(JSON.stringify(bad)));
  assert.throws(()=>feeds.parseWebClip('not json'));assert.throws(()=>feeds.parseWebClip('x'.repeat(feeds.MAX_CLIP_BYTES+1)));
  assert.equal(feeds.normalizeFeeds([{url:'https://example.com/feed'}, {url:'https://example.com/feed'}, {url:'http://localhost/feed'}, {url:'https://example.com/?token=x'}]).length,1);
});
test('bookmark installer exports a plain-text review flow with no remote requests or credential reads',()=>{
  const source=feeds.WEB_CLIP_BOOKMARKLET;assert.match(source,/window\.getSelection/);assert.match(source,/input\.value/);assert.match(source,/下载剪藏文件/);assert.doesNotMatch(source,/document\.cookie|fetch\(|XMLHttpRequest|localStorage|sessionStorage|querySelector\(['"]input/);
  const html=feeds.bookmarkInstallerHtml();assert.match(html,/href="javascript:/);assert.match(html,/&gt;/);assert.doesNotMatch(html,/<script/i);assert.ok(html.includes('书签栏'));
});

const compiled=(await transform(await readFile(new URL('../src/sublime/SourceFeeds.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);return Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function find(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return null;}return predicate(node)?node:find(node.props?.children,predicate);}
function panel(props){
  const slots=[];let cursor=0,tree;const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:()=>{},useMemo:factory=>factory(),useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
  const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,Error,URL,window:{},require:specifier=>specifier==='react'?react:specifier==='./sourceFeeds.js'?feeds:specifier==='../discoveryModel.js'?discovery:specifier==='./workspaceDownload.js'?{requestWorkspaceDownload:()=>{}}:specifier.endsWith('.css')?{}:(()=>{throw Error(specifier);})()});
  function render(next={}){props={...props,...next};cursor=0;return tree=module.exports.default(props);}render();return {render,find:predicate=>find(tree,predicate),button:label=>find(tree,node=>node.type==='button'&&text(node)===label),text:()=>text(tree)};
}
test('source feed opens without fetching, fetch only previews, selected import is explicit and errors preserve preview',async()=>{
  let calls=0,saves=0,imports=[];const form=panel({api:{captureFeed:async()=>{calls++;return {ok:true,data:fixture};}},onFeedsChange:async()=>{saves++;},onImport:async values=>{imports=values;throw Error('保存失败，资料仍保留');},existingCards:[]});
  assert.equal(calls,0);form.find(node=>node.type==='input'&&node.props.id==='sf-url').props.onChange({target:{value:fixture.url}});form.render();await form.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});form.render();
  assert.equal(calls,1);assert.equal(saves,0);assert.equal(imports.length,0);assert.ok(form.button('保存选中 1 条'));
  await form.button('保存订阅来源').props.onClick();form.render();assert.equal(saves,1);assert.equal(imports.length,0);
  await form.button('保存选中 1 条').props.onClick();form.render();assert.equal(imports.length,1);assert.ok(form.text().includes('保存失败，资料仍保留'));assert.ok(form.button('保存选中 1 条'));
});
test('refresh lists existing entries as duplicates and does not enable an empty import',async()=>{
  const form=panel({api:{captureFeed:async()=>({ok:true,data:fixture})},feeds:[{url:fixture.url}],onFeedsChange:async()=>{},onImport:async()=>{throw Error('must not import');},existingCards:feeds.feedRecords(fixture)});
  await form.button('刷新').props.onClick();form.render();assert.ok(form.text().includes('0 条可导入 · 1 条已存在'));assert.equal(form.button('保存选中 0 条').props.disabled,true);
});
test('preview choices retain item identity when another window imports an earlier item',async()=>{
  const second={...fixture.items[0],id:'b'.repeat(64),sourceUrl:'https://example.com/second',title:'第二期'},feed={...fixture,items:[fixture.items[0],second]},records=feeds.feedRecords(feed);let imported=[];
  const form=panel({api:{captureFeed:async()=>({ok:true,data:feed})},feeds:[{url:fixture.url}],onFeedsChange:async()=>{},onImport:async values=>{imported=values;},existingCards:[]});
  await form.button('刷新').props.onClick();form.render();
  form.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:false}});form.render({existingCards:[records[0]]});
  assert.ok(form.button('保存选中 1 条'));await form.button('保存选中 1 条').props.onClick();assert.equal(imported[0].title,'第二期');
});
test('bookmark preview exports only after confirmation, retains selection and executes without external dependencies',async()=>{
  const elements=[],downloads=[],created=[];let removed=false,exported;
  const node=tag=>{const value={tag,style:{},children:[],append(...children){this.children.push(...children);},setAttribute(){},attachShadow(){return node('shadow');},focus(){},remove(){removed=true;},click(){if(tag==='a')downloads.push({href:this.href,name:this.download});}};elements.push(value);return value;};
  const doc={title:'原网页',body:{innerText:'不可导出的其他文字'},documentElement:node('root'),querySelector:()=>null,getElementById:()=>null,createElement:node};
  class ClipURL extends URL{};ClipURL.createObjectURL=blob=>{exported=blob;created.push(blob);return 'blob:clip';};ClipURL.revokeObjectURL=()=>{};
  vm.runInNewContext(feeds.WEB_CLIP_BOOKMARKLET.slice('javascript:'.length),{document:doc,window:{getSelection:()=> '原始选中文字 café 🧪',alert:message=>{throw Error(message);}},location:{href:'https://example.com/read#part'},URL:ClipURL,Blob,setTimeout:()=>0,Date});
  assert.equal(downloads.length,0);assert.equal(created.length,0);
  const textarea=elements.find(element=>element.tag==='textarea');assert.equal(textarea.value,'原始选中文字 café 🧪');textarea.value+='\n我的补充';
  elements.find(element=>element.tag==='button'&&element.textContent==='下载剪藏文件').onclick();
  assert.equal(downloads.length,1);assert.equal(removed,true);const result=feeds.parseWebClip(await exported.text());assert.equal(result[0].body,'原始选中文字 café 🧪\n我的补充');assert.equal(result[0].sourceUrl,'https://example.com/read');
});
