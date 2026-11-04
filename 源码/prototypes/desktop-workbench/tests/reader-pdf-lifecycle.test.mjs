import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as pdfModel from '../src/reader/pdfReaderModel.js';
const component=(await transform(await readFile(new URL('../src/reader/PdfBookReader.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform',define:{'import.meta.env.BASE_URL':'"/"'}})).code;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=key=>({sourceKey:key,name:key+'.pdf',url:'mengcang-reader://source/'+key});
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result;}return null;}return predicate(tree)?tree:find(tree.props?.children,predicate);}
function text(tree){return tree==null||typeof tree==='boolean'?'':typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children);}
function lifecycle(initialProps,{getDocument,TextLayer}={}){
 const slots=[];let cursor=0,pending=[],dirty=false,tree,props=initialProps;
 const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useState:initial=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},useEffect:(effect,deps)=>{const i=cursor++,prior=slots[i];if(!prior||!equal(prior.deps,deps)){slots[i]={deps,cleanup:prior?.cleanup};pending.push({i,effect});}}};
 const module={exports:{}};const modules={'react':react,'pdfjs-dist/legacy/build/pdf.mjs':{GlobalWorkerOptions:{},getDocument,TextLayer:TextLayer||class{constructor(){this.textDivs=[];}render(){return Promise.resolve();}cancel(){}}},'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url':{default:'synthetic-worker'},'./pdfReaderModel.js':{...pdfModel,createPdfBookSource:source=>({options:Promise.resolve(pdfModel.pdfBookOptions(source)),abort(){}})},'./pdfBookReader.css':{}};
 const globals={ResizeObserver:class{observe(){}disconnect(){}},window:{devicePixelRatio:1,getSelection:()=>null,open(){}},document:{createTextNode:text=>({textContent:text}),createElement:()=>({})},setTimeout:()=>0,clearTimeout(){}};
 vm.compileFunction(component,['module','exports','require',...Object.keys(globals)])(module,module.exports,name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},...Object.values(globals));
 function refs(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(refs);return;}if(node.props?.ref&&typeof node.props.ref==='object'&&!node.props.ref.current)node.props.ref.current={clientWidth:800,clientHeight:800,contains:()=>true,scrollTo(){},focus(){},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),replaceChildren(){},style:{setProperty(){}},getContext:()=>({})};refs(node.props?.children);}
 function render(patch={}){props={...props,...patch};cursor=0;dirty=false;tree=module.exports.default(props);refs(tree);return tree;}
 function commit(){for(let pass=0;pass<30;pass++){const tasks=pending;pending=[];for(const {i,effect}of tasks){slots[i].cleanup?.();slots[i].cleanup=effect();}if(!dirty&&!pending.length)return;render();}throw Error('failed settle');}
 async function flush(){for(let i=0;i<30;i++){await Promise.resolve();if(dirty)render();commit();}return tree;}
 render();return {render,commit,flush,find:p=>find(tree,p),text:()=>text(tree),byLabel:label=>find(tree,node=>node.props?.['aria-label']===label),button:label=>find(tree,node=>node.type==='button'&&text(node)===label),unmount(){for(const slot of slots)slot.cleanup?.();}};
}
function pdf(total=3,options={}){return {numPages:total,getOutline:async()=>[],getPage:options.getPage||(async page=>({getViewport:({scale})=>({width:600*scale,height:900*scale,scale}),render:()=>({promise:Promise.resolve(),cancel(){}}),getTextContent:async()=>({items:[{str:'page '+page}]}),getAnnotations:async()=>[]})),destroy:async()=>{}};}
const task=book=>({promise:Promise.resolve(book),destroy:async()=>{}});

test('saved location, navigation and keyboard paging persist actual bounded page numbers',async()=>{
 const locations=[],ready=[],view=lifecycle({source:source('a'),location:{page:2},onLocation:value=>locations.push({...value}),onReady:value=>ready.push(value)},{getDocument:()=>task(pdf())});view.commit();await view.flush();
 assert.equal(view.byLabel('PDF 页码').props.value,'2');assert.equal(locations.at(-1).page,2);assert.equal(ready.at(-1).totalPages,3);
 view.byLabel('PDF 下一页').props.onClick();await view.flush();assert.equal(view.byLabel('PDF 下一页').props.disabled,true);assert.equal(locations.at(-1).page,3);
 view.render({navigateTo:{page:99,nonce:1}});view.commit();await view.flush();assert.equal(locations.at(-1).page,3);
 view.render({navigateTo:{page:1,nonce:2}});view.commit();await view.flush();assert.equal(locations.at(-1).page,1);
 let prevented=false;view.find(node=>node.type==='section').props.onKeyDown({key:'PageDown',target:{closest:()=>null},preventDefault(){prevented=true;}});await view.flush();assert.equal(locations.at(-1).page,2);assert.equal(prevented,true);
 view.find(node=>node.type==='section').props.onKeyDown({key:'ArrowRight',target:{closest:()=>({})},preventDefault(){throw Error('Input navigation must remain untouched');}});await view.flush();assert.equal(locations.at(-1).page,2);view.unmount();
});
test('late document completion cannot replace a new source, clear its password, or publish old progress',async()=>{
 const old=deferred(),calls=[],ready=[],locations=[];let destroyed=0;
 const view=lifecycle({source:source('old'),location:{page:2},onReady:value=>ready.push(value),onLocation:value=>locations.push(value)},{getDocument:options=>{calls.push(options);return calls.length===1?{promise:old.promise,destroy:async()=>{destroyed++;}}:task(pdf(5));}});view.commit();await view.flush();
 view.render({source:source('new'),location:{page:4}});view.commit();await view.flush();assert.equal(view.byLabel('PDF 页码').props.value,'4');assert.equal(ready.at(-1).totalPages,5);assert.equal(destroyed,1);
 let abandonedDestroyed=0;old.resolve({...pdf(99),destroy:async()=>{abandonedDestroyed++;}});await view.flush();assert.equal(abandonedDestroyed,1);assert.equal(ready.some(value=>value.totalPages===99),false);assert.equal(locations.at(-1).page,4);assert.equal(view.byLabel('PDF 页码').props.value,'4');view.unmount();
});
test('switching page cancels its renderer and prevents an obsolete render error from replacing the new page',async()=>{
 const first=deferred(),renders=[],errors=[];
 const book=pdf(3,{getPage:async page=>({getViewport:({scale})=>({width:600*scale,height:900*scale,scale}),render:()=>{const run={page,cancels:0};renders.push(run);return {promise:page===1?first.promise:Promise.resolve(),cancel(){run.cancels++;}};},getTextContent:async()=>({items:[{str:'page '+page}]}),getAnnotations:async()=>[]})});
 const view=lifecycle({source:source('a'),onError:value=>errors.push(value)},{getDocument:()=>task(book)});view.commit();await view.flush();assert.equal(renders[0].page,1);
 view.byLabel('PDF 下一页').props.onClick();await view.flush();assert.equal(renders[0].cancels,1);assert.equal(renders.at(-1).page,2);
 first.reject(Error('obsolete rendering failure'));await view.flush();assert.deepEqual(errors,[]);assert.equal(view.text().includes('obsolete rendering failure'),false);assert.equal(view.byLabel('PDF 页码').props.value,'2');view.unmount();
});
test('zoom controls notify persistent settings without reloading or resetting the book location',async()=>{
 let loads=0;const changes=[],view=lifecycle({source:source('a'),location:{page:3},settings:{zoom:1,fit:'width',theme:'light'},onSettings:value=>changes.push({...value})},{getDocument:()=>{loads++;return task(pdf());}});view.commit();await view.flush();view.byLabel('PDF 放大').props.onClick();await view.flush();assert.equal(changes.at(-1).zoom,1.25);assert.equal(view.byLabel('PDF 页码').props.value,'3');assert.equal(loads,1);view.unmount();
});
test('password input is sent only to the current parser and never to location or annotation state',async()=>{
 const gate=deferred(),passwords=[],loading={promise:gate.promise,destroy:async()=>{}};
 const view=lifecycle({source:source('locked')},{getDocument:()=>loading});view.commit();await view.flush();loading.onPassword(value=>passwords.push(value),1);await view.flush();view.byLabel('PDF 阅读密码').props.onChange({target:{value:'secret-only-to-parser'}});await view.flush();view.find(node=>node.type==='form'&&node.props?.className==='br-pdf-password').props.onSubmit({preventDefault(){}});await view.flush();assert.deepEqual(passwords,['secret-only-to-parser']);assert.equal(view.byLabel('PDF 阅读密码').props.value,'');gate.resolve(pdf());await view.flush();assert.equal(view.byLabel('PDF 阅读密码'),null);view.unmount();
});

test('a loaded source switch never writes its old page into the new book before the new parser is ready',async()=>{
 const newBook=deferred(),locations=[];let calls=0;
 const view=lifecycle({source:source('first'),location:{page:3},onLocation:value=>locations.push({source:'first',...value})},{getDocument:()=>++calls===1?task(pdf(3)):{promise:newBook.promise,destroy:async()=>{}}});view.commit();await view.flush();assert.equal(locations.at(-1).page,3);
 view.render({source:source('second'),location:{page:2},onLocation:value=>locations.push({source:'second',...value})});view.commit();await view.flush();assert.equal(locations.some(value=>value.source==='second'),false);
 newBook.resolve(pdf(7));await view.flush();assert.equal(locations.at(-1).source,'second');assert.equal(locations.at(-1).page,2);assert.equal(locations.at(-1).totalPages,7);view.unmount();
});

test('vertical keys and Space read within a tall page before crossing page boundaries, and backward paging lands at the bottom',async()=>{
 const view=lifecycle({source:source('tall')},{getDocument:()=>task(pdf())});view.commit();await view.flush();
 const stage=view.byLabel('PDF 页面，可用左右方向键翻页').props.ref.current;Object.assign(stage,{clientHeight:600,scrollHeight:1800,scrollTop:120});stage.scrollTo=({top})=>{stage.scrollTop=top;};
 async function key(value,extra={}){let prevented=false;view.find(node=>node.type==='section').props.onKeyDown({key:value,target:{closest:()=>null},preventDefault(){prevented=true;},...extra});await view.flush();return prevented;}
 assert.equal(await key('ArrowDown'),true);assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(stage.scrollTop,160);
 await key('ArrowUp');assert.equal(stage.scrollTop,120);await key('PageDown');assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(stage.scrollTop,680);
 await key(' ');assert.equal(stage.scrollTop,1200);await key(' ');assert.equal(view.byLabel('PDF 页码').props.value,'2');assert.equal(stage.scrollTop,0);
 await key('PageUp');assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(stage.scrollTop,1200);
 await key(' ',{shiftKey:true});assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(stage.scrollTop,640);
 await key('Home');assert.equal(stage.scrollTop,0);await key('End');assert.equal(stage.scrollTop,1200);assert.equal(view.byLabel('PDF 页码').props.value,'1');
 await key('ArrowRight');assert.equal(view.byLabel('PDF 页码').props.value,'2');assert.equal(stage.scrollTop,0);await key('ArrowLeft');assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(stage.scrollTop,0);view.unmount();
});
test('vertical reading shortcuts preserve typing, IME, modified selections and focused links or controls',async()=>{
 const view=lifecycle({source:source('input')},{getDocument:()=>task(pdf())});view.commit();await view.flush();const stage=view.byLabel('PDF 页面，可用左右方向键翻页').props.ref.current;Object.assign(stage,{clientHeight:600,scrollHeight:1800,scrollTop:100});stage.scrollTo=({top})=>{stage.scrollTop=top;};
 const keyboard=view.find(node=>node.type==='section').props.onKeyDown;
 for(const key of ['ArrowDown','ArrowUp','PageDown','PageUp',' ','Home','End'])keyboard({key,target:{closest:()=>({tagName:'INPUT'})},preventDefault(){throw Error('Focused controls retain their normal behavior');}});
 for(const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true}])keyboard({key:'ArrowDown',...modifiers,target:{closest:()=>null},preventDefault(){throw Error('Modified/composition key must remain untouched');}});
 await view.flush();assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(stage.scrollTop,100);view.unmount();
});
test('failed page requests cannot leave the previous canvas visible under the new page number or highlights',async()=>{
 let paintedPage=0;const second=deferred(),book=pdf(2,{getPage:async page=>{if(page===2)return second.promise;return {getViewport:({scale})=>({width:600*scale,height:900*scale,scale}),render:()=>{paintedPage=page;return {promise:Promise.resolve(),cancel(){}};},getTextContent:async()=>({items:[{str:'first-page-only'}]}),getAnnotations:async()=>[]};}});
 const view=lifecycle({source:source('failure'),annotations:[{id:'a',locator:{page:2,rects:[{x:.1,y:.1,width:.2,height:.1}]}}]},{getDocument:()=>task(book)});view.commit();await view.flush();assert.equal(paintedPage,1);
 view.byLabel('PDF 下一页').props.onClick();await view.flush();const sheet=()=>view.find(node=>String(node.props?.className||'').split(' ').includes('br-pdf-sheet'));
 assert.equal(sheet().props['aria-hidden'],true,'The previously painted canvas must not be presented as page 2 while loading');second.reject(Error('page-two range unavailable'));await view.flush();assert.equal(view.byLabel('PDF 页码').props.value,'2');assert.equal(paintedPage,1);assert.equal(sheet().props['aria-hidden'],true,'The stale page stays hidden after failure');assert.ok(view.button('重新读取'));view.unmount();
});
test('successful retry explicitly recovers parent reading error while retaining independent save errors',async()=>{
 const savedError='笔记仍未保存',recovered=[];let parentError='',attempts=0;
 const broken=pdf(2,{getPage:async()=>{throw Error('synthetic initial page failure');}});
 const view=lifecycle({source:source('retry'),onError:message=>{parentError=message;},onRecovered:receipt=>{recovered.push(receipt);parentError='';}},{getDocument:()=>task(++attempts===1?broken:pdf(2))});view.commit();await view.flush();assert.equal(parentError,'synthetic initial page failure');
 view.button('重新读取').props.onClick();await view.flush();assert.equal(attempts,2);assert.equal(view.byLabel('PDF 页码').props.value,'1');assert.equal(parentError,'');assert.equal(recovered.length,1);assert.equal(recovered[0].sourceKey,'retry');assert.equal(savedError,'笔记仍未保存');assert.equal(view.text().includes('synthetic initial page failure'),false);view.unmount();
});

test('clicking PDF text gives reading keys a viewport target without stealing focus from actual link buttons',async()=>{
 const view=lifecycle({source:source('focus')},{getDocument:()=>task(pdf())});view.commit();await view.flush();const area=view.byLabel('PDF 页面，可用左右方向键翻页'),element=area.props.ref.current;let focused=0;element.focus=options=>{focused++;assert.equal(options.preventScroll,true);};
 area.props.onPointerDown({target:{closest:()=>null},currentTarget:element});assert.equal(focused,1);
 area.props.onPointerDown({target:{closest:()=>({tagName:'BUTTON'})},currentTarget:element});assert.equal(focused,1);view.unmount();
});
