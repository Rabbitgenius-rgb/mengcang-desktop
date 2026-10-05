import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as model from '../src/sublime/workspaceModel.js';
import * as attachmentHelpers from '../src/sublime/attachmentPreview.js';
import * as documentText from '../src/sublime/documentText.js';
import * as pdfHelpers from '../src/sublime/pdfPreview.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const clone=structuredClone;
const code=async name=>(await transform(await readFile(new URL('../src/sublime/'+name,import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform',define:{'import.meta.env.BASE_URL':'"/"','import.meta.url':'"https://offline.invalid/preview"'}})).code;
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function text(tree){return tree==null||typeof tree==='boolean'?'':typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
function lifecycle(source,initialProps,modules={},globals={}){
 const slots=[];let cursor=0,pending=[],dirty=false,tree,props=initialProps;
 const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={Fragment:Symbol(),createElement:(type,props,...children)=>({type,props:{...props,children}}),useMemo:(factory,deps)=>{const i=cursor++,prior=slots[i];if(!prior||!equal(prior.deps,deps))slots[i]={value:factory(),deps};return slots[i].value;},useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useState:initial=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},useEffect:(effect,deps)=>{const i=cursor++,prior=slots[i];if(!prior||!equal(prior.deps,deps)){slots[i]={deps,cleanup:prior?.cleanup};pending.push({i,effect});}}};
 const icons=new Proxy({},{get:()=>()=>null}),module={exports:{}};
 const require=name=>name==='react'?react:name==='@tabler/icons-react'?icons:name.endsWith('.css')?{}:name in modules?modules[name]:(()=>{throw Error('Unexpected import '+name);})();
 const names=Object.keys(globals);vm.compileFunction(source,['module','exports','require',...names])(module,module.exports,require,...Object.values(globals));
 function refs(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(refs);return;}if(node.props?.ref&&typeof node.props.ref==='object'&&!node.props.ref.current)node.props.ref.current={contains:()=>true,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),replaceChildren(){},style:{setProperty(){}},getContext:()=>({})};refs(node.props?.children);}
 function render(patch={}){props={...props,...patch};cursor=0;dirty=false;tree=module.exports.default(props);refs(tree);return tree;}
 function commit(){for(let pass=0;pass<30;pass++){const tasks=pending;pending=[];for(const {i,effect}of tasks){slots[i].cleanup?.();slots[i].cleanup=effect();}if(!dirty&&!pending.length)return;render();}throw Error('failed settle');}
 async function flush(){for(let i=0;i<12;i++){await Promise.resolve();if(dirty)render();commit();}return tree;}
 render();return {render,commit,flush,find:p=>find(tree,p),text:()=>text(tree),button:label=>find(tree,n=>n.type==='button'&&text(n)===label),unmount(){for(const slot of slots)slot.cleanup?.();},slots};
}
const attachment=(name,kind)=>{const bytes=kind==='word'?Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),Buffer.from(name)]):Buffer.from('%PDF-1.7 synthetic '+name);return {name,type:kind==='word'?'application/msword':'application/pdf',size:bytes.length,dataUrl:`data:${kind==='word'?'application/msword':'application/pdf'};base64,${bytes.toString('base64')}`};};
// Compile only the production component source. PDF.js, Word workers, native
// preview, canvas and browser selection are synthetic; no PDF parser or worker
// is imported. The data model and persistence session are their real modules.
const [wordCode,pdfCode]=await Promise.all([code('AttachmentPreview.jsx'),code('PdfAttachmentPreview.jsx')]);
function wordPreview(props,{getSelection=()=>null}={}){return lifecycle(wordCode,props,{'./attachmentPreview.js':attachmentHelpers,'./documentText.js':documentText,'./nativeFilePreview.js':{previewNativeAttachment(){throw Error('Unexpected native preview');}},'./PdfAttachmentPreview.jsx':{default:()=>null}},{window:{getSelection},Worker:class{constructor(){throw Error('Unexpected worker');}},URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},Blob,setTimeout:()=>0,clearTimeout(){}});}
async function readWord(view){view.commit();await view.flush();await view.button('在本机预览').props.onClick();await view.flush();}
const native=async source=>({kind:'text',body:`Text from ${source.name}`});
for(const rejectOld of [false,true])test(`Word new source can index while an old save ${rejectOld?'fails':'finishes'}`,async()=>{
 const a=attachment('first.doc','word'),b=attachment('second.doc','word'),old=deferred(),latest=deferred();let latestCalls=0;
 const preview=wordPreview({attachment:a,onNativePreview:native,onIndex:()=>old.promise});await readWord(preview);
 const first=preview.button('建立全文索引').props.onClick();await preview.flush();assert.ok(preview.button('正在保存索引…').props.disabled);
 preview.render({attachment:b,onIndex:()=>{latestCalls++;return latest.promise;}});await readWord(preview);
 assert.equal(preview.button('建立全文索引')?.props.disabled,false,'The new source must reset its saving state');
 const second=preview.button('建立全文索引').props.onClick();await preview.flush();assert.equal(latestCalls,1);
 if(rejectOld)old.reject(Error('obsolete save failure'));else old.resolve();await first;await preview.flush();
 assert.ok(preview.button('正在保存索引…').props.disabled,'The old finally must not unlock the new save');assert.equal(preview.text().includes('obsolete save failure'),false);
 latest.resolve();await second;await preview.flush();assert.equal(preview.button('建立全文索引')?.props.disabled,false);assert.ok(preview.text().includes('Text from second.doc'));preview.unmount();
});

test('Word stale index remains rejected by the production session and reducer after replacement',async()=>{
 const a=attachment('old.doc','word'),b=attachment('new.doc','word'),gate=deferred();let state=model.workspaceReducer(model.createWorkspaceState(),{type:'card.upsert',card:{id:'file',attachment:a}});
 const session=createWorkspaceSession({loadSnapshot:async()=>({state:clone(state),revision:1,entityVersions:{}}),update:async updater=>{await gate.promise;state=updater(state,{revision:1,entityVersions:{}});return {state:clone(state),revision:2,entityVersions:{}};}});await session.load();
 const preview=wordPreview({attachment:a,onNativePreview:native,onIndex:index=>session.commit({type:'card.documentIndex',id:'file',expectedDataUrl:a.dataUrl,index})});await readWord(preview);
 const indexing=preview.button('建立全文索引').props.onClick();await preview.flush();state=model.workspaceReducer(state,{type:'card.upsert',card:{id:'file',attachment:b}});
 preview.render({attachment:b,onIndex:index=>session.commit({type:'card.documentIndex',id:'file',expectedDataUrl:b.dataUrl,index})});await readWord(preview);gate.resolve();await indexing;await preview.flush();
 assert.equal(state.cards[0].attachment.dataUrl,b.dataUrl);assert.equal(state.cards[0].documentIndex,null);assert.equal(preview.button('建立全文索引')?.props.disabled,false);preview.unmount();
});

function pdfPreview(onHighlight,props={}){
 let liveText='First selection',start={},end=start,outside=false,collapsed=false,clears=0;
 const currentSelection=()=>({isCollapsed:collapsed,rangeCount:collapsed?0:1,toString:()=>liveText,getRangeAt:()=>({startContainer:start,endContainer:end,startOffset:0,endOffset:liveText.length,getClientRects:()=>[{left:5,top:5,width:40,height:8}]}),removeAllRanges(){clears++;collapsed=true;}});
 const pdf={numPages:2,getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:100*scale,scale}),render:()=>({promise:Promise.resolve(),cancel(){}}),getTextContent:async()=>({items:[{str:'First selection Second selection'}]})}),destroy:async()=>{}};
 const preview=lifecycle(pdfCode,{attachment:attachment('first.pdf','pdf'),onHighlight,...props},{'pdfjs-dist/legacy/build/pdf.mjs':{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(pdf),destroy:async()=>{}}),TextLayer:class{constructor(){this.textDivs=[];}async render(){}cancel(){}}},'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url':{default:'mock-only'},'./attachmentPreview.js':attachmentHelpers,'./pdfPreview.js':pdfHelpers,'./documentText.js':documentText},{ResizeObserver:class{observe(){}disconnect(){}},window:{devicePixelRatio:1,getSelection:currentSelection},document:{createTextNode:()=>({}),createElement:()=>({})},setTimeout:()=>0,clearTimeout(){}});
 const capture=()=>preview.find(n=>n.props?.className==='se-pdf-textLayer').props.onPointerUp();
 return {...preview,async start(){preview.commit();await preview.flush();const layer=preview.find(n=>n.props?.className==='se-pdf-textLayer').props.ref.current;layer.contains=()=>!outside;capture();await preview.flush();},async select(value,{external=false,notify=true}={}){liveText=value;start={};end=start;outside=external;collapsed=false;if(notify)capture();await preview.flush();},clearBrowser(){collapsed=true;},capture,clears:()=>clears,currentText:()=>liveText};
}

test('PDF successful highlight saves and clears only its unchanged original selection',async()=>{
 const saved=deferred(),file=attachment('first.pdf','pdf');let state=model.workspaceReducer(model.createWorkspaceState(),{type:'card.upsert',card:{id:'file',attachment:file}});
 const preview=pdfPreview(async value=>{await saved.promise;state=model.workspaceReducer(state,{type:'card.highlight',id:'file',expectedDataUrl:file.dataUrl,highlight:{...value,id:'hl'}});});await preview.start();
 const job=preview.button('高亮选文').props.onClick();saved.resolve();await job;await preview.flush();assert.equal(state.cards[0].documentHighlights[0].text,'First selection');assert.equal(preview.clears(),1);assert.equal(preview.button('高亮选文'),null);assert.ok(preview.text().includes('高亮已保存在本机'));preview.unmount();
});
for(const text of ['Second selection','First selection'])test(`PDF earlier highlight preserves newer ${text==='First selection'?'equal-text':'different-text'} selection`,async()=>{
 const saved=deferred(),values=[],preview=pdfPreview(async value=>{values.push(clone(value));await saved.promise;});await preview.start();const job=preview.button('高亮选文').props.onClick();await preview.select(text);saved.resolve();await job;await preview.flush();
 assert.equal(values[0].text,'First selection');assert.equal(preview.clears(),0);assert.ok(preview.button('高亮选文'),'The newer selection remains available');preview.unmount();
});
for(const external of [false,true])test(`PDF earlier highlight preserves a live ${external?'other-component':'not-yet-captured'} selection`,async()=>{
 const saved=deferred(),preview=pdfPreview(()=>saved.promise);await preview.start();const job=preview.button('高亮选文').props.onClick();await preview.select('New live selection',{external,notify:false});saved.resolve();await job;await preview.flush();assert.equal(preview.clears(),0);preview.unmount();
});
for(const transition of ['page','attachment','unmount'])test(`PDF ${transition} invalidates a pending highlight completion`,async()=>{
 const saved=deferred(),preview=pdfPreview(()=>saved.promise);await preview.start();const job=preview.button('高亮选文').props.onClick();
 if(transition==='page'){preview.button('下一页').props.onClick();await preview.flush();}else if(transition==='attachment'){preview.render({attachment:attachment('second.pdf','pdf')});preview.commit();await preview.flush();}else preview.unmount();
 saved.resolve();await job;if(transition!=='unmount')await preview.flush();assert.equal(preview.clears(),0);if(transition!=='unmount'){assert.equal(preview.text().includes('高亮已保存在本机'),false);preview.unmount();}
});
test('PDF failure from an old document cannot replace a new document error or selection',async()=>{
 const saved=deferred(),preview=pdfPreview(()=>saved.promise);await preview.start();const job=preview.button('高亮选文').props.onClick();preview.render({attachment:attachment('second.pdf','pdf')});preview.commit();await preview.flush();await preview.select('Second selection');saved.reject(Error('obsolete highlight failed'));await job;await preview.flush();assert.equal(preview.text().includes('obsolete highlight failed'),false);assert.ok(preview.button('高亮选文'));preview.unmount();
});

test('PDF current failed highlight keeps its original selection and shows the save error',async()=>{
 const preview=pdfPreview(async()=>{throw Error('Current save failed');});await preview.start();await preview.button('高亮选文').props.onClick();await preview.flush();assert.equal(preview.clears(),0);assert.ok(preview.button('高亮选文'));assert.ok(preview.text().includes('Current save failed'));preview.unmount();
});

test('PDF completed highlight does not clear a browser selection already dismissed by the user',async()=>{
 const saved=deferred(),preview=pdfPreview(()=>saved.promise);await preview.start();const job=preview.button('高亮选文').props.onClick();preview.clearBrowser();saved.resolve();await job;await preview.flush();assert.equal(preview.clears(),0);preview.unmount();
});

// Use only synthetic text and DOM ranges, with production event handlers.
function wordSelectionPreview(props){
 let value='',outside=false,collapsed=false,clears=0;const node={};
 const getSelection=()=>({isCollapsed:collapsed,rangeCount:collapsed?0:1,toString:()=>value,getRangeAt:()=>({startContainer:node,endContainer:node}),removeAllRanges(){clears++;collapsed=true;}});
 const preview=wordPreview(props,{getSelection});
 return {...preview,async select(text,{external=false,empty=false}={}){value=text;outside=external;collapsed=empty;const word=preview.find(n=>n.type==='pre');word.props.ref.current.contains=()=>!outside;word.props.onPointerUp();await preview.flush();},currentText:()=>value,clears:()=>clears};
}
for(const kind of ['Word','PDF'])test(`${kind} oversized selection never sends a truncated copy, excerpt or highlight`,async()=>{
 const source='x'.repeat(100000)+'Z',calls=[];
 const props={onCopy:value=>calls.push(['copy',value]),onExcerpt:value=>calls.push(['excerpt',value.text]),onHighlight:value=>calls.push(['highlight',value.text])};
 const file=attachment(kind==='Word'?'long.doc':'long.pdf',kind==='Word'?'word':'pdf'),original=clone(file);
 const preview=kind==='Word'?wordSelectionPreview({attachment:file,onNativePreview:async()=>({kind:'text',body:source}),...props}):pdfPreview(props.onHighlight,{attachment:file,...props});
 if(kind==='Word')await readWord(preview);else await preview.start();
 await preview.select(source);
 for(const label of ['复制选文','摘录为卡片','高亮选文']){const button=preview.button(label);if(button&&!button.props.disabled)await button.props.onClick();}
 assert.deepEqual(calls.map(([action,value])=>[action,value.length,value.endsWith('Z')]),[], 'Over-limit actions must not silently publish only the first 100000 characters');
 assert.ok(preview.text().includes('缩小选区'));assert.ok(preview.text().includes('100,000'));
 assert.equal(preview.currentText(),source);assert.equal(preview.clears(),0);assert.deepEqual(file,original);preview.unmount();
});

test('document selection contract preserves exact in-limit text and rejects oversized UTF-16 without truncation',()=>{
 const {MAX_DOCUMENT_SELECTION_TEXT,documentSelectionText}=documentText;assert.equal(MAX_DOCUMENT_SELECTION_TEXT,100000);
 for(const value of ['', ' exact text\n', 'x'.repeat(99998)+'🙂'])assert.equal(documentSelectionText(value),value);
 assert.throws(()=>documentSelectionText('x'.repeat(100000)+'Z'),/100,000.*缩小选区/);
 assert.throws(()=>documentSelectionText('x'.repeat(99999)+'🙂'),/缩小选区/);
 const valid='x'.repeat(100000),state=model.workspaceReducer(model.createWorkspaceState(),{type:'card.upsert',card:{id:'boundary',body:valid}});assert.equal(state.cards[0].body,valid);
 assert.throws(()=>model.workspaceReducer(state,{type:'card.upsert',card:{id:'boundary',body:valid+'Z'}}),/正文/);
});
test('PDF helper rejects only oversized selections belonging to its own page',()=>{
 const node={},outside={},layer={contains:value=>value===node,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};let value='x'.repeat(100000)+'Z';
 const range={startContainer:node,endContainer:node,getClientRects:()=>[{left:0,top:0,width:10,height:5}]},selection={isCollapsed:false,rangeCount:1,toString:()=>value,getRangeAt:()=>range};
 assert.throws(()=>documentText.selectionInPage(selection,layer,3),/缩小选区/);assert.equal(selection.toString(),value);
 assert.equal(documentText.selectionInPage({...selection,isCollapsed:true},layer,3),null);
 assert.equal(documentText.selectionInPage({...selection,getRangeAt:()=>({...range,endContainer:outside})},layer,3),null);
 value='x'.repeat(99998)+'🙂';assert.equal(documentText.selectionInPage(selection,layer,3).text,value);
});
for(const kind of ['Word','PDF'])test(`${kind} selection warning recovers on exact-boundary, external and empty selections`,async()=>{
 const source='x'.repeat(100000)+'Z',calls=[],props={onCopy:value=>calls.push(['copy',value]),onExcerpt:value=>calls.push(['excerpt',value.text])};
 const preview=kind==='Word'?wordSelectionPreview({attachment:attachment('limits.doc','word'),onNativePreview:async()=>({kind:'text',body:source}),...props}):pdfPreview(undefined,props);
 if(kind==='Word')await readWord(preview);else await preview.start();await preview.select(source);assert.ok(preview.text().includes('缩小选区'));
 const exact='x'.repeat(99998)+'🙂';await preview.select(exact);assert.equal(preview.text().includes('缩小选区'),false);
 await preview.button('复制选文').props.onClick();await preview.button('摘录为卡片').props.onClick();assert.deepEqual(calls,[['copy',exact],['excerpt',exact]]);
 await preview.select(source);await preview.select(source,{external:true});assert.equal(preview.text().includes('缩小选区'),false);assert.equal(preview.button('复制选文'),null);
 await preview.select(source);if(kind==='Word')await preview.select('',{empty:true});else{preview.clearBrowser();preview.capture();await preview.flush();}
 assert.equal(preview.text().includes('缩小选区'),false);assert.equal(preview.button('摘录为卡片'),null);assert.equal(preview.clears(),0);preview.unmount();
});
for(const kind of ['Word','PDF'])test(`${kind} selection changes never erase an unrelated current save error`,async()=>{
 const source='x'.repeat(100000)+'Z';
 const preview=kind==='Word'?wordSelectionPreview({attachment:attachment('errors.doc','word'),onNativePreview:native,onIndex:async()=>{throw Error('Unrelated index failure');}}):pdfPreview(async()=>{throw Error('Unrelated highlight failure');});
 if(kind==='Word'){await readWord(preview);await preview.button('建立全文索引').props.onClick();}else{await preview.start();await preview.button('高亮选文').props.onClick();}await preview.flush();
 const message=kind==='Word'?'Unrelated index failure':'Unrelated highlight failure';assert.ok(preview.text().includes(message));
 await preview.select(source);assert.ok(preview.text().includes('缩小选区'));assert.ok(preview.text().includes(message));
 await preview.select('short');assert.equal(preview.text().includes('缩小选区'),false);assert.ok(preview.text().includes(message));preview.unmount();
});
for(const kind of ['Word','PDF'])test(`${kind} changing documents resets an oversized selection warning`,async()=>{
 const source='x'.repeat(100000)+'Z';
 const preview=kind==='Word'?wordSelectionPreview({attachment:attachment('before.doc','word'),onNativePreview:native,onCopy(){}}):pdfPreview(undefined,{onCopy(){}});
 if(kind==='Word')await readWord(preview);else await preview.start();await preview.select(source);assert.ok(preview.text().includes('缩小选区'));
 preview.render({attachment:attachment(kind==='Word'?'after.doc':'after.pdf',kind==='Word'?'word':'pdf')});preview.commit();await preview.flush();assert.equal(preview.text().includes('缩小选区'),false);assert.equal(preview.button('复制选文'),null);assert.equal(preview.clears(),0);preview.unmount();
});
test('PDF page changes reset an oversized selection warning',async()=>{
 const preview=pdfPreview(()=>{});await preview.start();await preview.select('x'.repeat(100001));assert.ok(preview.text().includes('缩小选区'));
 preview.button('下一页').props.onClick();await preview.flush();assert.equal(preview.text().includes('缩小选区'),false);assert.equal(preview.clears(),0);preview.unmount();
});
for(const reject of [false,true])test(`PDF pending highlight ${reject?'failure':'success'} cannot clear a newer oversized selection or its warning`,async()=>{
 const gate=deferred(),preview=pdfPreview(()=>gate.promise);await preview.start();const job=preview.button('高亮选文').props.onClick();const source='x'.repeat(100000)+'Z';await preview.select(source);
 if(reject)gate.reject(Error('Old save failed'));else gate.resolve();await job;await preview.flush();
 assert.equal(preview.currentText(),source);assert.equal(preview.clears(),0);assert.ok(preview.text().includes('缩小选区'));assert.equal(preview.text().includes('高亮已保存在本机'),false);assert.equal(preview.text().includes('Old save failed'),false);assert.equal(preview.button('高亮选文'),null);preview.unmount();
});
