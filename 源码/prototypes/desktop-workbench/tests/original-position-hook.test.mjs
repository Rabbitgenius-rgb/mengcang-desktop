import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as position from '../src/sublime/originalPosition.js';

const compiled=(await transform(await readFile(new URL('../src/sublime/useOriginalPosition.js',import.meta.url),'utf8'),{loader:'js',format:'cjs'})).code;
const url='https://example.org/article';
const excerpt={id:'excerpt',type:'highlight',sourceUrl:url,webAnchor:{version:1,exact:'本段讲述 CERN 如何管理信息。',prefix:'',suffix:''}};
const library=[{id:'article',type:'article',sourceUrl:url,body:['MESH 是旧名。','出版于 1989 年。','标题','本段讲述 CERN 如何管理信息。','下一标题','这里讨论 LHC 的未来。'].join('\n\n')}];
const page={sourceUrl:url,truncated:false,body:['MESH was the old name.','Published in 1989.','Title','This paragraph explains how CERN manages its information.','Next title','This discusses the future of LHC.'].join('\n\n')};
function harness(webCapture,fixtureLibrary=library,intelligenceRequest) {
 const slots=[],refs=[],effects=[],opened=[];let si=0,ri=0,ei=0,work=[],scope='article:one',instance;
 const same=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState:initial=>{const index=si++;if(!slots[index])slots[index]={value:initial};return [slots[index].value,next=>slots[index].value=typeof next==='function'?next(slots[index].value):next];},useRef:initial=>refs[ri++]??(refs[ri-1]={current:initial}),useEffect:(effect,deps)=>{const index=ei++;if(!effects[index]||!same(effects[index].deps,deps))work.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:effect()};});}};
 const document={body:{appendChild(){}},createElement:()=>({click(){opened.push(this.href)},remove(){}})};
 const module={exports:{}};
 vm.compileFunction(compiled,['module','exports','require','document'])(module,module.exports,id=>id==='react'?react:id==='./originalPosition.js'?position:(()=>{throw Error(id)})(),document);
 const api={webCapture,intelligenceRequest};
 function render(){si=ri=ei=0;work=[];instance=module.exports.useOriginalPosition({api,library:fixtureLibrary,scope});for(const f of work)f();return instance;}
 render();return {render,opened,refresh:next=>{fixtureLibrary=next;return render();},changeScope:value=>{scope=value;return render();},get:()=>instance};
}
const event=()=>({prevented:false,preventDefault(){this.prevented=true;}});
test('one click opens the confirmed English fragment and repeated clicks do not duplicate requests',async()=>{
 let finish,calls=0;const f=harness(()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const e=event(),job=f.get().open(e,excerpt);assert(e.prevented);
 await f.get().open(event(),excerpt);assert.equal(calls,1);
 assert.equal(f.render().state.status,'loading');
 finish({ok:true,data:page});await job;f.render();
 assert.equal(f.opened.length,1);assert.match(f.opened[0],/#:~:text=This%20paragraph%20explains%20how%20CERN/);
 assert.equal(f.get().state,null);
});
test('a late result cannot open a page after leaving the original card',async()=>{
 let finish;const f=harness(()=>new Promise(resolve=>finish=resolve));
 const job=f.get().open(event(),excerpt);f.changeScope('different:card');
 finish({ok:true,data:page});await job;assert.equal(f.opened.length,0);
});
test('lookup failures show an error and English excerpts keep the normal link',async()=>{
 let calls=0;const f=harness(async()=>{calls++;return {ok:false,error:{message:'offline'}};});
 await f.get().open(event(),excerpt);assert.equal(f.render().state.status,'error');assert.equal(f.opened.length,0);
 const e=event();await f.get().open(e,{...excerpt,webAnchor:{...excerpt.webAnchor,exact:'An English quotation'}});
 assert.equal(e.prevented,false);assert.equal(calls,1);
});

test('the same one-click action works with only an excerpt and no saved article',async()=>{
 const quote={...excerpt,webAnchor:{...excerpt.webAnchor,exact:'本段讲述 CERN 如何管理信息的公开方案。',
  prefix:'此前介绍 MESH 以及 1989 年的项目。',suffix:'下文讨论 LHC 与 ALICE 的未来。'}};
 const source={sourceUrl:url,truncated:false,body:[
  'The MESH project began in 1989.','Information management',
  'This original passage describes how CERN manages information across its projects.',
  'Further discussion','LHC and ALICE projects are discussed in the next section.'
 ].join('\n\n')};
 const f=harness(async()=>({ok:true,data:source}),[]);
 const e=event();await f.get().open(e,quote);
 assert.equal(e.prevented,true);assert.equal(f.opened.length,1);
 assert.match(f.opened[0],/#:~:text=This%20original%20passage%20describes%20how%20CERN/);
});

test('closing native confirmation can reload the library without losing the result', async () => {
 const quote={...excerpt,webAnchor:{version:1,exact:'这里把圆圈称作节点，箭头则叫链接。'}};
 const sentence='We refer to the circles as nodes and the arrows as links.';
 const source={sourceUrl:url,body:sentence,truncated:false};
 const f=harness(async()=>({ok:true,data:source}),[quote],async()=>{
  f.refresh([structuredClone(quote)]);
  return {ok:true,data:{text:sentence}};
 });
 await f.get().open(event(),quote);
 assert.equal(f.opened.length,1);
 assert.ok(decodeURIComponent(f.opened[0]).includes(sentence));
 assert.equal(f.render().state.result.sourceSentence,sentence);
 await f.get().open(event(),quote);
 assert.equal(f.opened.length,2);
});

test('an excerpt removed while confirmation is open cannot navigate', async () => {
 const quote={...excerpt,webAnchor:{version:1,exact:'这里把圆圈称作节点，箭头则叫链接。'}};
 const sentence='We refer to the circles as nodes and the arrows as links.';
 const f=harness(async()=>({ok:true,data:{sourceUrl:url,body:sentence}}),[quote],async()=>{
  f.refresh([]);
  return {ok:true,data:{text:sentence}};
 });
 await f.get().open(event(),quote);
 assert.equal(f.opened.length,0);
 assert.equal(f.render().state,null);
});
