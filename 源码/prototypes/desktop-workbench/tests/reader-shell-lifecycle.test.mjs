import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as model from '../src/reader/readerState.js';
import * as desktop from '../src/desktopModel.js';
const compiled=(await transform(await readFile(new URL('../src/reader/BookReader.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=(key='first')=>({name:key+'.pdf',type:'application/pdf',sourceKey:key,size:100,url:'mengcang-reader://source/'+key});
function find(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return null;}return predicate(node)?node:find(node.props?.children,predicate);}
function text(node){return node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function lifecycle(overrides={},{update,readingSource,readerStates={}}={}){
 const slots=[],downloads=[],calls=[],exits=[],libraryExits=[];let cursor=0,pending=[],dirty=false,tree,registeredFlush;
 const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},useCallback:(callback,deps)=>{const index=cursor++;if(!slots[index]||!equal(slots[index].deps,deps))slots[index]={deps,value:callback};return slots[index].value;},useEffect:(effect,deps)=>{const index=cursor++,prior=slots[index];if(!prior||!equal(prior.deps,deps)){slots[index]={deps,cleanup:prior?.cleanup};pending.push({index,effect});}}};
 function PdfStub(){}function EpubStub(){}
 const modules={'react':react,'@tabler/icons-react':new Proxy({},{get:(_target,name)=>name}),'../desktopModel.js':desktop,'../sublime/attachmentPreview.js':{attachmentBytes(){throw Error('No attachment read is needed for native-source shell tests');}},'../sublime/workspaceDownload.js':{requestWorkspaceDownload:(payload,name,type)=>downloads.push({payload,name,type})},'./readerState.js':model,'./PdfBookReader.jsx':{__esModule:true,default:PdfStub},'./EpubBookReader.jsx':{__esModule:true,default:EpubStub},'./bookReader.css':{}};
 const module={exports:{}};vm.compileFunction(compiled,['module','exports','require','crypto','navigator','document'])(module,module.exports,name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},globalThis.crypto,{clipboard:{writeText:async()=>{}}},{fullscreenElement:null});
 let props={card:{id:'book',path:'01_sources/books/book.md',title:'图书',origin:'vault',updatedAt:'first'},api:{readingSource:readingSource||(async()=>({ok:true,data:source()}))},readerStates,onUpdate:async(current,action)=>{calls.push({source:current,action});const key=model.readerStateKey(props.card.id,current.sourceKey),saved=update?await update(current,action,readerStates[key]):model.readerReducer(readerStates[key],action);if(saved)readerStates[key]=saved;return saved;},onExit:()=>exits.push('exit'),onLibrary:()=>libraryExits.push('library'),registerFlush:value=>{registeredFlush=value;},...overrides};
 function render(patch={}){props={...props,...patch};cursor=0;dirty=false;tree=module.exports.default(props);return tree;}
 function commit(){for(let pass=0;pass<35;pass++){const tasks=pending;pending=[];for(const {index,effect} of tasks){slots[index].cleanup?.();slots[index].cleanup=effect();}if(!dirty&&!pending.length)return;render();}throw Error('Reader shell did not settle');}
 async function flush(){for(let pass=0;pass<40;pass++){await Promise.resolve();if(dirty)render();commit();}return tree;}
 const api={render,commit,flush,downloads,calls,exits,libraryExits,readerStates,find:predicate=>find(tree,predicate),byLabel:label=>find(tree,node=>node.props?.['aria-label']===label),button:label=>find(tree,node=>node.type==='button'&&text(node)===label),text:()=>text(tree),parser:()=>find(tree,node=>node.type===PdfStub||node.type===EpubStub),get registeredFlush(){return registeredFlush;},unmount(){for(const slot of slots)slot?.cleanup?.();}};render();return api;
}
async function openNotes(view){view.button('笔记').props.onClick();await view.flush();}
async function writeNote(view,note){view.byLabel('读书笔记').props.onChange({target:{value:note}});await view.flush();}

test('a failed old note followed by successful newer input cannot be replayed over the newer note',async()=>{
 let fail=true;const view=lifecycle({}, {update:(_source,action,prior)=>{if(fail){fail=false;throw Error('合成写入失败');}return model.readerReducer(prior,action);}});view.commit();await view.flush();await openNotes(view);await writeNote(view,'A');assert.ok(view.button('重试保存'));await writeNote(view,'AB');assert.equal(view.readerStates[model.readerStateKey('book','first')].note,'AB');assert.equal(view.button('重试保存'),null);await view.registeredFlush();await view.byLabel('返回上一页').props.onClick();assert.equal(view.exits.length,1);assert.equal(view.calls.length,2);view.unmount();
});

test('an earlier failure arriving after a newer successful intent cannot resurrect a stale retry',async()=>{
 const old=deferred();let count=0;const view=lifecycle({}, {update:async(_source,action,prior)=>++count===1?old.promise:model.readerReducer(prior,action)});view.commit();await view.flush();await openNotes(view);await writeNote(view,'A');await writeNote(view,'AB');assert.equal(view.readerStates[model.readerStateKey('book','first')].note,'AB');old.reject(Error('迟到的旧写入失败'));await view.flush();assert.equal(view.button('重试保存'),null);await view.registeredFlush();assert.equal(view.byLabel('读书笔记').props.value,'AB');view.unmount();
});

test('the registered backup/quit flush rejects unsaved notes until retry succeeds and preserves exportable text',async()=>{
 let fail=true;const view=lifecycle({}, {update:(_source,action,prior)=>{if(fail)throw Error('合成磁盘错误');return model.readerReducer(prior,action);}});view.commit();await view.flush();await openNotes(view);await writeNote(view,'未能落盘的完整笔记');await assert.rejects(view.registeredFlush(),/尚未保存/);await view.byLabel('返回上一页').props.onClick();assert.equal(view.exits.length,0);view.button('设置').props.onClick();await view.flush();view.button('导出 Markdown 笔记').props.onClick();assert.match(view.downloads[0].payload,/未能落盘的完整笔记/);fail=false;await view.button('重试保存').props.onClick();await view.flush();await view.registeredFlush();await view.byLabel('返回上一页').props.onClick();assert.equal(view.exits.length,1);view.unmount();assert.equal(view.registeredFlush,null);
});

test('the registered flush waits for in-flight writes before exit and does not acknowledge a later failed write',async()=>{
 const write=deferred();const view=lifecycle({}, {update:()=>write.promise});view.commit();await view.flush();await openNotes(view);await writeNote(view,'正在保存');let done=false;const exiting=view.byLabel('返回上一页').props.onClick().then(()=>{done=true;});await view.flush();assert.equal(done,false);assert.equal(view.exits.length,0);write.reject(Error('合成晚到磁盘错误'));await exiting;await view.flush();assert.equal(view.exits.length,0);await assert.rejects(view.registeredFlush(),/尚未保存/);view.unmount();
});

test('source refresh waits for the original write and never adopts the old book state as the new source state',async()=>{
 const write=deferred();let requested=0;const view=lifecycle({}, {readingSource:async()=>({ok:true,data:source(++requested===1?'first':'second')}),update:()=>write.promise});view.commit();await view.flush();await openNotes(view);await writeNote(view,'旧原件笔记');view.render({card:{id:'book',path:'01_sources/books/book.md',title:'图书',origin:'vault',updatedAt:'second'}});view.commit();await view.flush();assert.equal(requested,1);assert.equal(view.parser().props.source.sourceKey,'first');write.resolve(model.normalizeReaderState({note:'旧原件笔记'}));await view.flush();assert.equal(requested,2);assert.ok(view.parser(),view.text());assert.equal(view.parser().props.source.sourceKey,'second');assert.equal(view.parser().props.location.page,1);assert.equal(view.byLabel('读书笔记').props.value,'');assert.equal(view.readerStates[model.readerStateKey('book','first')].note,'旧原件笔记');view.unmount();
});

test('late native source loading cannot replace a newly selected source descriptor',async()=>{
 const old=deferred();let requests=0;const view=lifecycle({}, {readingSource:async()=>++requests===1?old.promise:{ok:true,data:source('second')}});view.commit();await view.flush();view.render({card:{id:'book',title:'图书',updatedAt:'second'}});view.commit();await view.flush();assert.ok(view.parser(),view.text());assert.equal(view.parser().props.source.sourceKey,'second');old.resolve({ok:true,data:source('first')});await view.flush();assert.ok(view.parser(),view.text());assert.equal(view.parser().props.source.sourceKey,'second');view.unmount();
});

test('source refresh blocked by a failed write still permits full note export and resumes loading after successful retry',async()=>{
 let fail=true,requested=0;const view=lifecycle({}, {readingSource:async()=>({ok:true,data:source(++requested===1?'first':'second')}),update:(_source,action,prior)=>{if(fail)throw Error('合成磁盘故障');return model.readerReducer(prior,action);}});view.commit();await view.flush();await openNotes(view);await writeNote(view,'刷新前未保存的完整笔记');view.render({card:{id:'book',title:'图书',updatedAt:'second'}});view.commit();await view.flush();assert.equal(view.parser().props.source.sourceKey,'first');await assert.rejects(view.registeredFlush(),/尚未保存/);view.button('设置').props.onClick();await view.flush();view.button('导出 Markdown 笔记').props.onClick();assert.equal(view.downloads.length,1,'Failed old-source input must remain exportable during refresh');assert.match(view.downloads[0].payload,/刷新前未保存的完整笔记/);fail=false;await view.button('重试保存').props.onClick();await view.flush();assert.ok(view.parser(),'A successful retry should resume the blocked source refresh');assert.equal(view.parser().props.source.sourceKey,'second');view.unmount();
});

test('retrying a failed annotation creation preserves a newer note that could not yet update its missing saved target',async()=>{
 let fail=true;const view=lifecycle({}, {update:(_source,action,prior)=>{if(fail&&action.type==='annotation.add'){fail=false;throw Error('合成高亮创建失败');}return model.readerReducer(prior,action);}});view.commit();await view.flush();view.parser().props.onSelection({text:'书中的真实选文',locator:{page:2},label:'第 2 页'});await view.flush();view.button('保存高亮').props.onClick();await view.flush();const note=view.find(node=>node.type==='textarea'&&node.props['aria-label']==='批注 第 2 页');assert.ok(note);note.props.onChange({target:{value:'创建尚未保存时新增的批注'}});await view.flush();if(view.button('重试保存')){await view.button('重试保存').props.onClick();await view.flush();}await view.registeredFlush();const saved=view.readerStates[model.readerStateKey('book','first')];assert.equal(saved.annotations.length,1);assert.equal(saved.annotations[0].note,'创建尚未保存时新增的批注');view.unmount();
});

test('a late failed annotation create retries with a newer note without losing the selected quotation',async()=>{
 const old=deferred();let requests=0;const view=lifecycle({}, {update:async(_source,action,prior)=>++requests===1?old.promise:model.readerReducer(prior,action)});view.commit();await view.flush();view.parser().props.onSelection({text:'延迟保存的选文',locator:{page:2},label:'第 2 页'});await view.flush();view.button('保存高亮').props.onClick();await view.flush();view.find(node=>node.type==='textarea'&&node.props['aria-label']==='批注 第 2 页').props.onChange({target:{value:'较新的批注'}});await view.flush();old.reject(Error('迟到的创建失败'));await view.flush();assert.equal(view.find(node=>node.type==='textarea'&&node.props['aria-label']==='批注 第 2 页').props.value,'较新的批注');await view.button('重试保存').props.onClick();await view.flush();const saved=view.readerStates[model.readerStateKey('book','first')];assert.equal(saved.annotations[0].text,'延迟保存的选文');assert.equal(saved.annotations[0].note,'较新的批注');await view.registeredFlush();view.unmount();
});

test('a later deletion prevents a delayed failed create from reviving its removed annotation',async()=>{
 const old=deferred();let requests=0;const view=lifecycle({}, {update:async(_source,action,prior)=>++requests===1?old.promise:model.readerReducer(prior,action)});view.commit();await view.flush();view.parser().props.onSelection({text:'随后删除的选文',locator:{page:2},label:'第 2 页'});await view.flush();view.button('保存高亮').props.onClick();await view.flush();view.byLabel('删除摘录 第 2 页').props.onClick();await view.flush();old.reject(Error('迟到的创建失败'));await view.flush();assert.equal(view.button('重试保存'),null);assert.equal(view.parser().props.annotations.length,0);await view.registeredFlush();view.unmount();
});

async function selectText(view,quote,note=''){
 view.parser().props.onSelection({text:quote,locator:{page:2},label:'第 2 页'});await view.flush();
 view.byLabel('本次选文批注').props.onChange({target:{value:note}});await view.flush();
}

test('an excerpt includes its annotation and stable operation identity and double clicking shares one save',async()=>{
 const write=deferred(),payloads=[];const view=lifecycle({onExcerpt:payload=>{payloads.push(payload);return write.promise;}});view.commit();await view.flush();await selectText(view,'真实选文','自己的批注');
 const click=view.button('存为素材摘录').props.onClick,first=click(),second=click();await view.flush();
 assert.equal(payloads.length,1);assert.equal(view.button('正在保存摘录…').props.disabled,true);
 const payload=payloads[0];assert.equal(payload.text,'真实选文');assert.equal(payload.note,'自己的批注');assert.match(payload.operationId,/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);assert.deepEqual(JSON.parse(JSON.stringify(payload.locator)),{page:2});assert.equal(payload.sourceKey,'first');assert.equal(payload.sourceName,'first.pdf');assert.equal(payload.format,'pdf');
 let flushed=false;const flushing=view.registeredFlush().then(()=>{flushed=true;});await view.flush();assert.equal(flushed,false);write.resolve();await Promise.all([first,second,flushing]);await view.flush();
 assert.equal(view.byLabel('选文操作'),null);assert.equal(view.text().includes('摘录已保存到资料库'),true);assert.equal(payloads.length,1);view.unmount();
});

test('an older successful excerpt cannot clear a later selection or its new annotation',async()=>{
 const write=deferred(),payloads=[];const view=lifecycle({onExcerpt:payload=>{payloads.push(payload);return write.promise;}});view.commit();await view.flush();await selectText(view,'第一段选文','第一条批注');const saving=view.button('存为素材摘录').props.onClick();await view.flush();
 await selectText(view,'第二段选文','第二条批注');write.resolve();await saving;await view.flush();assert.equal(payloads.length,1);assert.equal(payloads[0].text,'第一段选文');assert.match(text(view.byLabel('选文操作')),/第二段选文/);assert.equal(view.byLabel('本次选文批注').props.value,'第二条批注');await view.registeredFlush();view.unmount();
});

test('failed excerpts block flush and both exits, survive unrelated saves, and reuse their operation on click and retry',async()=>{
 let fail=true;const payloads=[],view=lifecycle({onExcerpt:async payload=>{payloads.push(payload);if(fail)throw Error('摘录磁盘写入失败');}});view.commit();await view.flush();await selectText(view,'尚未保存的摘录','保留批注');
 await view.button('存为素材摘录').props.onClick();await view.flush();assert.ok(view.button('重试保存'));await assert.rejects(view.registeredFlush(),/尚未保存/);
 await view.button('存为素材摘录').props.onClick();await view.flush();assert.equal(payloads.length,2);assert.equal(payloads[1].operationId,payloads[0].operationId,'Clicking the same failed selection must not create a second material card');
 await openNotes(view);await writeNote(view,'其他读书笔记保存成功');assert.equal(view.readerStates[model.readerStateKey('book','first')].note,'其他读书笔记保存成功');assert.ok(view.button('重试保存'),'An unrelated successful reader-state write must not acknowledge a failed excerpt');await assert.rejects(view.registeredFlush(),/尚未保存/);
 await view.byLabel('返回上一页').props.onClick();await view.flush();await view.byLabel('返回资料库').props.onClick();await view.flush();assert.equal(view.exits.length,0);assert.equal(view.libraryExits.length,0);
 fail=false;await view.button('重试保存').props.onClick();await view.flush();assert.equal(payloads.length,3);assert.equal(payloads[2].operationId,payloads[0].operationId);assert.equal(payloads[2].note,'保留批注');await view.registeredFlush();await view.byLabel('返回上一页').props.onClick();await view.flush();await view.byLabel('返回资料库').props.onClick();assert.equal(view.exits.length,1);assert.equal(view.libraryExits.length,1);view.unmount();
});

test('retrying an old failed excerpt preserves a newly selected passage and does not reload the unchanged book',async()=>{
 let fail=true,loads=0;const payloads=[],view=lifecycle({onExcerpt:async payload=>{payloads.push(payload);if(fail)throw Error('摘录暂未保存');}}, {readingSource:async()=>{loads++;return {ok:true,data:source()};}});view.commit();await view.flush();await selectText(view,'失败的第一段','第一段批注');await view.button('存为素材摘录').props.onClick();await view.flush();
 await selectText(view,'稍后选择的第二段','第二段新批注');fail=false;await view.button('重试保存').props.onClick();await view.flush();assert.equal(loads,1);assert.equal(payloads.length,2);assert.equal(payloads[1].operationId,payloads[0].operationId);assert.match(text(view.byLabel('选文操作')),/稍后选择的第二段/);assert.equal(view.byLabel('本次选文批注').props.value,'第二段新批注');assert.equal(view.button('重试保存'),null);await view.registeredFlush();view.unmount();
});

test('Markdown and JSON export retain the full failed excerpt, its annotation and source position',async()=>{
 const quote='原书中的长选文。'.repeat(80)+'\n最后一行选文',note='不能遗失的个人批注。'.repeat(60),payloads=[],view=lifecycle({onExcerpt:async payload=>{payloads.push(payload);throw Error('导出前保存失败');}});view.commit();await view.flush();await selectText(view,quote,note);await view.button('存为素材摘录').props.onClick();await view.flush();view.button('设置').props.onClick();await view.flush();view.button('导出 Markdown 笔记').props.onClick();view.button('导出完整阅读记录').props.onClick();
 assert.equal(view.downloads.length,2);const markdown=view.downloads.find(item=>item.type==='text/markdown').payload,json=JSON.parse(view.downloads.find(item=>item.type==='application/json').payload);assert.ok(markdown.includes('## 尚未存入素材库的摘录'));assert.ok(markdown.includes(quote.split('\n').map(line=>'> '+line).join('\n')));assert.ok(markdown.includes(note));assert.equal(json.unsavedExcerpts.length,1);assert.equal(json.unsavedExcerpts[0].text,quote);assert.equal(json.unsavedExcerpts[0].note,note);assert.equal(json.unsavedExcerpts[0].operationId,payloads[0].operationId);assert.equal(json.unsavedExcerpts[0].sourceKey,'first');assert.deepEqual(json.unsavedExcerpts[0].locator,{page:2});assert.equal(json.state.note,'');await assert.rejects(view.registeredFlush(),/尚未保存/);view.unmount();
});

test('PDF recovery clears only the matching source read error and preserves failed-save protection',async()=>{
 const view=lifecycle({}, {update:()=>{throw Error('真实未保存的阅读笔记');}});view.commit();await view.flush();await openNotes(view);await writeNote(view,'尚未落盘');view.parser().props.onError('本页读取失败');await view.flush();assert.match(view.text(),/本页读取失败/);
 view.parser().props.onRecovered({sourceKey:'obsolete',page:2});await view.flush();assert.match(view.text(),/本页读取失败/);view.parser().props.onRecovered({sourceKey:'first',page:2});await view.flush();assert.doesNotMatch(view.text(),/本页读取失败/);assert.match(view.text(),/真实未保存的阅读笔记/);assert.ok(view.button('重试保存'));await assert.rejects(view.registeredFlush(),/尚未保存/);view.unmount();
});
