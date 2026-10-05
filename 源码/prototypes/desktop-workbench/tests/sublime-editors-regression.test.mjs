import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as model from '../src/sublime/workspaceModel.js';
import * as discovery from '../src/discoveryModel.js';
import * as attachments from '../src/sublime/attachmentPreview.js';

const source=await readFile(new URL('../src/sublime/SublimeEditors.jsx',import.meta.url),'utf8');
const compiled=(await transform(source,{loader:'jsx',format:'cjs',jsx:'transform'})).code;

// Exercise the real editor event handlers with persistent hook slots. No browser,
// IndexedDB, network or Vault adapter is used by this regression harness.
function editor(name,props,services={}){
  const slots=[];let cursor=0,tree;
  const react={Fragment:Symbol('fragment'),memo:value=>value,createElement:(type,props,...children)=>({type,props:{...props,children}}),isValidElement:value=>Boolean(value&&value.props),useEffect:()=>{},useMemo:factory=>factory(),useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];}};
  const icons=new Proxy({},{get:(_,name)=>function Icon(){return react.createElement('svg',{'data-icon':String(name)});}});
  const module={exports:{}};
  const context={module,exports:module.exports,Blob,URL,Error,crypto:globalThis.crypto,console,setTimeout,clearTimeout,require:path=>path==='react'?react:path==='@tabler/icons-react'?icons:path==='../discoveryModel.js'?discovery:path==='./workspaceModel.js'?model:path==='./attachmentPreview.js'?attachments:path==='./webCapture.js'?{captureWebPage:services.captureWebPage||(()=>{throw Error('Unexpected web request');})}:path==='./AttachmentPreview.jsx'?{default:()=>null}:path.endsWith('.css')?{}:(()=>{throw Error('Unexpected import '+path);})()};
  vm.runInNewContext(compiled,context);
  function render(){cursor=0;tree=module.exports[name](props);return tree;}
  render();
  return {render,find:predicate=>find(tree,predicate)};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}if(predicate(tree))return tree;return find(tree.props?.children,predicate);}
function text(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree.props?.children);}
const control=(render,label)=>render.find(node=>node.props?.['aria-label']===label);
const button=(render,label)=>render.find(node=>node.type==='button'&&text(node)===label);

test('collection field changes emit a complete draft and recover after leaving the editor',()=>{
  let persisted;
  const props={onDraftChange:value=>{persisted=JSON.parse(JSON.stringify(value));},onSave:async()=>{},onCancel:()=>{}};
  const form=editor('CollectionEditor',props);
  control(form,'收藏集名称').props.onChange({target:{value:'归档主题'}});form.render();
  control(form,'收藏集说明').props.onChange({target:{value:' 原始描述\n第二行 '}});form.render();
  form.find(node=>node.props?.label==='私密').props.onChange(true);
  assert.deepEqual(persisted,{title:'归档主题',description:' 原始描述\n第二行 ',private:true,pinned:false});
  const resumed=editor('CollectionEditor',{...props,draft:persisted});
  assert.equal(control(resumed,'收藏集名称').props.value,'归档主题');
  assert.equal(control(resumed,'收藏集说明').props.value,' 原始描述\n第二行 ');
  assert.equal(resumed.find(node=>node.props?.label==='私密').props.checked,true);
  assert.ok(!/Collaborators|协作者/.test(text(resumed.render())));
});

test('import preview, selected entries and unmodified original text recover from the persisted draft',async()=>{
  const input=JSON.stringify([{title:'一',body:' 原文一\r\n次行 ',caption:'备注一'},{title:'二',body:'原文二'}]);
  const records=discovery.dedupeImports(discovery.parseImportText(input,'json')).items;
  let persisted,received;
  const initial={text:input,format:'json',filename:'library.json',previewed:true,selected:records.map(record=>record.fingerprint)};
  const props={draft:initial,onDraftChange:value=>{persisted=JSON.parse(JSON.stringify(value));},onImport:async entries=>{received=entries;throw Error('simulated save failure');},onCancel:()=>{}};
  const form=editor('ImportEditor',props);
  form.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange();form.render();
  assert.equal(persisted.selected.length,1);
  const resumed=editor('ImportEditor',{...props,draft:persisted});
  await button(resumed,' 导入 1 项').props.onClick();resumed.render();
  assert.equal(received.length,1);assert.equal(received[0].body,'原文二');
  assert.equal(control(resumed,'导入内容').props.value,input);
  assert.ok(resumed.find(node=>node.props?.error==='simulated save failure'));
  assert.ok(button(resumed,' 导入 1 项'));
});

test('explicit webpage capture preserves handwritten body and title until the replace action is chosen',async()=>{
  let calls=0,persisted;
  const form=editor('CardEditor',{kind:'link',card:{id:'card',title:'手写标题',body:' 原始手写内容\n第二行 ',caption:'**原备注**',sourceUrl:'https://example.test/article'},onDraftChange:value=>{persisted=value;},onSave:async()=>{},onCancel:()=>{}},{captureWebPage:async url=>{calls++;return {title:'网页标题',body:'抓取的真实原文',sourceTitle:'网页出处',sourceUrl:url,warnings:[]};}});
  assert.equal(calls,0);
  await button(form,'获取网页内容').props.onClick();form.render();
  assert.equal(calls,1);assert.equal(persisted.body,' 原始手写内容\n第二行 ');assert.equal(persisted.title,'手写标题');assert.equal(persisted.caption,'**原备注**');
  button(form,'使用网页内容替换正文').props.onClick();form.render();
  assert.equal(persisted.body,'抓取的真实原文');assert.equal(persisted.title,'手写标题');
});

test('failed webpage capture is visible and preserves the original editable draft',async()=>{
  const form=editor('CardEditor',{kind:'link',card:{id:'card',title:'title',body:'original',sourceUrl:'https://example.test/article'},onSave:async()=>{},onCancel:()=>{}},{captureWebPage:async()=>{throw Error('Access denied by source');}});
  await button(form,'获取网页内容').props.onClick();form.render();
  assert.ok(form.find(node=>node.props?.error==='Access denied by source'));
  assert.equal(form.find(node=>node.props?.label==='卡片正文').props.value,'original');
  assert.equal(button(form,'保存').props.disabled,false);
});

test('canvas keyboard handling leaves nested links active while keeping node movement available',()=>{
  const board={id:'b',title:'Board',collectionId:'',nodes:[{id:'n',itemPath:'card',x:0,y:0}],edges:[]};
  const form=editor('CanvasEditor',{board,items:[{id:'card',title:'Card',body:'[source](https://example.test)'}],onChange:async()=>{},onBack:()=>{}});
  const node=form.find(value=>value.type==='article'),element={tagName:'ARTICLE'},anchor={tagName:'A'};let prevented=false;
  node.props.onKeyDown({key:'Enter',target:anchor,currentTarget:element,preventDefault(){prevented=true;} });
  assert.equal(prevented,false);
  node.props.onKeyDown({key:'ArrowRight',target:element,currentTarget:element,preventDefault(){prevented=true;},stopPropagation(){}});
  assert.equal(prevented,true);form.render();
  assert.equal(form.find(value=>value.type==='article').props.style.left,10);
});

test('clicking a canvas card gives it keyboard focus and persists arrow movement without hijacking links',async()=>{
  const updates=[];
  const board={id:'b',title:'Board',collectionId:'',nodes:[{id:'n',itemPath:'card',x:40,y:40}],edges:[]};
  const form=editor('CanvasEditor',{board,items:[{id:'card',title:'Card',body:'[source](https://example.test)'}],onChange:async value=>{updates.push(value);},onBack:()=>{}});
  const node=form.find(value=>value.type==='article');
  let focused=false,prevented=false;
  const element={focus(options){focused=true;assert.equal(options.preventScroll,true);},setPointerCapture(){}};
  node.props.onPointerDown({button:0,target:{closest:()=>null},currentTarget:element,pointerId:1,clientX:50,clientY:50,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(focused,true,'a selected card must also receive the keyboard focus');
  node.props.onKeyDown({key:'ArrowRight',target:element,currentTarget:element,preventDefault(){},stopPropagation(){}});
  form.render();
  assert.equal(form.find(value=>value.type==='article').props.style.left,50);
  await Promise.resolve();await Promise.resolve();
  assert.equal(updates.at(-1).nodes[0].x,50);
  focused=false;prevented=false;
  node.props.onPointerDown({button:0,target:{closest:()=>({tagName:'A'})},currentTarget:element,preventDefault(){prevented=true;}});
  assert.equal(focused,false);
  assert.equal(prevented,false);
});

test('every canvas mutation reaches workspace persistence synchronously even while an earlier save is pending',async()=>{
 const updates=[],waits=[];
 const board={id:'canvas',title:'Draft',nodes:[{id:'node',itemPath:'card',x:0,y:0}],edges:[]};
 const form=editor('CanvasEditor',{board,hasDraft:true,items:[],onChange:value=>{updates.push(value);return new Promise(resolve=>waits.push(resolve));},onBack:()=>{}});
 assert.match(text(form.render()),/未保存的草稿/);
 const element={};
 function move(){form.find(value=>value.type==='article').props.onKeyDown({key:'ArrowRight',target:element,currentTarget:element,preventDefault(){},stopPropagation(){}});form.render();}
 move();move();
 assert.equal(updates.length,2,'the second mutation must be registered before navigation or quit can happen');
 assert.deepEqual(updates.map(value=>value.nodes[0].x),[10,20]);
 waits[0]();await Promise.resolve();await Promise.resolve();form.render();assert.match(text(form.render()),/正在保存/);
 waits[1]();await Promise.resolve();await Promise.resolve();form.render();assert.doesNotMatch(text(form.render()),/未保存的草稿|正在保存/);
});
