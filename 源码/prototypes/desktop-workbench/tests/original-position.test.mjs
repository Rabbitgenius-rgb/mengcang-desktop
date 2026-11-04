import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOriginalWebPosition,resolveTranslatedOriginalWebPosition,findOriginalWebPosition} from '../src/sublime/originalPosition.js';

const url='https://example.org/article';
const exact='本段讲述 CERN 如何管理信息。';
const excerpt={id:'excerpt',type:'highlight',sourceUrl:url,webAnchor:{version:1,exact,prefix:'',suffix:''}};
const chinese=['这是 MESH 的旧名称。','标识 1989 年的资料。','标题','本段讲述 CERN 如何管理信息。','下一标题','另一段讨论 LHC 的未来。'].join('\n\n');
const english=['This was formerly named MESH.','The reference is from 1989.','A title','This passage explains how CERN manages information. It is the target.','Another heading','A later paragraph discusses the future of LHC.'].join('\n\n');
const article={id:'one',type:'article',sourceUrl:url,body:chinese};
const page={sourceUrl:url,body:english,truncated:false};
const run=(e=excerpt,lib=[article],p=page)=>resolveOriginalWebPosition(e,lib,p);

test('translated quote resolves to a unique original paragraph bounded by matching landmarks',()=>{
 const found=run();
 assert.equal(found.kind,'translated');
 assert.equal(found.url,url+'#:~:text=This%20passage%20explains%20how%20CERN%20manages%20information.');
});

test('same-language quote keeps its original context and fragment',()=>{
 const saved={...excerpt,webAnchor:{version:1,exact:'how CERN manages information',prefix:'',suffix:''}};
 assert.equal(run(saved).url,url+'#:~:text=how%20CERN%20manages%20information');
 assert.equal(run(saved).kind,'direct');
});

test('ambiguous, shifted, incomplete or unrelated pages never guess a translated position',()=>{
 const extra={...page,body:english.replace('A title\n\n','A title\n\nInserted text.\n\n')};
 assert.equal(run(excerpt,[article],extra),null);
 assert.equal(run(excerpt,[article],{...page,truncated:true}),null);
 assert.equal(run(excerpt,[article],{...page,sourceUrl:'https://example.org/other'}),null);
 assert.equal(run(excerpt,[{...article,body:chinese+'\n\n'+exact}]),null);
 assert.equal(run(excerpt,[]),null);
 assert.equal(run(excerpt,[article],{...page,body:english.replace('CERN','OTHER')}),null);
 assert.equal(run(excerpt,[article],{...page,body:english.replace('LHC','another institute')}),null);
});

test('explicit parent identity is respected; competing snapshots must agree',()=>{
 assert.equal(run({...excerpt,sourceCardId:'different'},[article]),null);
 assert.equal(run({...excerpt,sourceCardId:'one'},[article]).kind,'translated');
 const conflicting={...article,id:'other',body:chinese.replace('CERN','DIFFERENT')};
 assert.equal(run(excerpt,[article,conflicting]).kind,'translated');
 const inconsistent={...article,id:'other',body:chinese.replace('标题\n\n','标题\n\n追加一段。\n\n')};
 assert.equal(run(excerpt,[article,inconsistent]),null);
});


test('locating requests only the source URL and does not send local excerpts or notes',async()=>{
 const calls=[];
 const result=await findOriginalWebPosition({...excerpt,sourceUrl:url+'#previous'},[article],{webCapture:async (...args)=>{calls.push(args);return {ok:true,data:page};}});
 assert.equal(result.kind,'translated');
 assert.deepEqual(calls,[[url]]);
});

test('failed or uncorroborated lookups report failure instead of opening a guessed position',async()=>{
 await assert.rejects(findOriginalWebPosition(excerpt,[article],{webCapture:async()=>({ok:false,error:{message:'无法读取'}})}),/无法读取/);
 await assert.rejects(findOriginalWebPosition(excerpt,[],{webCapture:async()=>({ok:true,data:page})}),/未能可靠匹配/);
 await assert.rejects(findOriginalWebPosition(excerpt,[article],{}),/无法读取原网页/);
});

test('an excerpt with no saved article can locate one uniquely corroborated original paragraph',()=>{
 const saved={id:'only-highlight',type:'highlight',sourceUrl:url,webAnchor:{version:1,
  exact:'本段讲述 CERN 如何管理信息的公开方案。',
  prefix:'此前介绍 MESH 以及 1989 年的项目。',
  suffix:'下文讨论 LHC 与 ALICE 的未来。',
 }};
 const source={sourceUrl:url,truncated:false,body:[
  'The MESH project began in 1989.',
  'Information management',
  'This original passage describes how CERN manages information across its projects.',
  'Further discussion',
  'LHC and ALICE projects are discussed in the next section.'
 ].join('\n\n')};
 const before=structuredClone(saved),result=resolveOriginalWebPosition(saved,[],source);
 assert.equal(result.kind,'translated-context');
 assert.equal(result.url,url+'#:~:text=This%20original%20passage%20describes%20how%20CERN%20manages%20information%20across%20its%20projects.');
 assert.deepEqual(saved,before);
});

test('excerpt-only matching refuses missing, shifted, repeated, conflicting or insufficient context',()=>{
 const saved={type:'highlight',sourceUrl:url,webAnchor:{version:1,
  exact:'本段讲述 CERN 如何管理信息的公开方案。',
  prefix:'此前介绍 MESH 以及 1989 年的项目。',
  suffix:'下文讨论 LHC 与 ALICE 的未来。',
 }};
 const body=['The MESH project began in 1989.','A heading',
  'This original passage describes how CERN manages information across its projects.',
  'A second heading','LHC and ALICE projects are discussed next.'].join('\n\n');
 const p={sourceUrl:url,body,truncated:false};
 const resolve=(card=saved,page=p)=>resolveOriginalWebPosition(card,[],page);
 assert.equal(resolve({...saved,webAnchor:{...saved.webAnchor,prefix:''}}),null);
 assert.equal(resolve({...saved,webAnchor:{...saved.webAnchor,exact:'一段没有专名的中文摘录，没有足够的对应线索。'}}),null);
 assert.equal(resolve(saved,{...p,truncated:true}),null);
 assert.equal(resolve(saved,{...p,sourceUrl:'https://example.org/other'}),null);
 assert.equal(resolve(saved,{...p,body:body.replace('LHC and ALICE','OTHER and ALICE')}),null);
 assert.equal(resolve(saved,{...p,body:body.replace('MESH project began in 1989','MESH project began recently')}),null);
 assert.equal(resolve(saved,{...p,body:body.replace('A second heading','CERN appears in another sufficiently long paragraph that could otherwise be mistaken for the selected text.')}),null);
 assert.equal(resolve(saved,{...p,body:body+'\n\nAnother LHC reference and ALICE.'}),null);
 assert.equal(resolve(saved,{...p,body:body.split('\n\n').reverse().join('\n\n')}),null);
});

test('a translated Chinese excerpt without names or numbers locates a distinct sentence',async()=>{
 const saved={type:'highlight',sourceUrl:url,webAnchor:{version:1,exact:'我们可以把圆圈称为节点，把箭头称为链接。每个节点都像一篇简短的笔记或评论。',prefix:'前面介绍了资料之间的联系。',suffix:'接着讨论具体对象。'}};
 const target='We can call the circles nodes, and the arrows links. Suppose each node is like a small note, summary article, or comment.';
 const source={sourceUrl:url,body:['The history of the project explains its beginnings.',target,'The system supports changes and several kinds of access.'].join('\n\n'),truncated:false};
 const calls=[];
 const result=await findOriginalWebPosition(saved,[],{
  webCapture:async (...args)=>{calls.push(['network',...args]);return {ok:true,data:source};},
  intelligenceRequest:async (...args)=>{calls.push(['translate',...args]);return {ok:true,data:{text:'We can call the circles nodes and the arrows links. Each node is like a short note or comment.'}};}
 });
 assert.equal(result.kind,'translated-api');
 assert.match(decodeURIComponent(result.url),/We can call the circles nodes/);
 assert.deepEqual(calls,[['network',url],['translate',{action:'translatePosition',text:saved.webAnchor.exact}]]);
});

test('local translation never guesses when source passages repeat, differ or lack evidence',()=>{
 const saved={type:'highlight',sourceUrl:url,webAnchor:{version:1,exact:'我们可以把圆圈称为节点，把箭头称为链接。每个节点都像一篇简短的笔记或评论。',prefix:'前文',suffix:'后文'}};
 const target='We can call the circles nodes, and the arrows links. Suppose each node is like a small note, summary article, or comment.';
 const source={sourceUrl:url,body:['The history of the project explains its beginnings.',target,'The system supports changes and several kinds of access.'].join('\n\n'),truncated:false};
 const translation='We can call the circles nodes and the arrows links. Each node is like a short note or comment.';
 assert.equal(resolveTranslatedOriginalWebPosition(saved,{...source,body:source.body+'\n\n'+target},translation),null);
 assert.equal(resolveTranslatedOriginalWebPosition(saved,{...source,sourceUrl:'https://example.org/elsewhere'},translation),null);
 assert.equal(resolveTranslatedOriginalWebPosition(saved,{...source,truncated:true},translation),null);
 assert.equal(resolveTranslatedOriginalWebPosition(saved,source,'Cats sleep quietly at home.'),null);
 assert.equal(resolveTranslatedOriginalWebPosition(saved,source,'A brief note.'),null);
});

test('translation is not invoked for a direct match or invalid source page',async()=>{
 let calls=0;
 const direct={...excerpt,webAnchor:{...excerpt.webAnchor,exact:'how CERN manages information'}};
 const api={webCapture:async()=>({ok:true,data:page}),intelligenceRequest:async()=>{calls++;throw Error('unexpected');}};
 assert.equal((await findOriginalWebPosition(direct,[],api)).kind,'direct');
 await assert.rejects(findOriginalWebPosition(excerpt,[],{...api,webCapture:async()=>({ok:true,data:{...page,truncated:true}})}),/未能可靠匹配/);
 assert.equal(calls,0);
});

test('leaving the card before the source loads cannot prompt a translation', async () => {
 const saved={sourceUrl:url,webAnchor:{version:1,exact:'我们把圆圈称为节点，把箭头称为链接。'}};
 let calls=0;
 await assert.rejects(findOriginalWebPosition(saved,[],{
  webCapture:async()=>({ok:true,data:page}),
  intelligenceRequest:async()=>{calls++;}
 },()=>false));
 assert.equal(calls,0);
});

test('a repeated sentence within one paragraph or an opposite claim does not resolve', () => {
 const saved={sourceUrl:url,webAnchor:{version:1,exact:'我们把圆圈称为节点，把箭头称为链接。'}};
 const sentence='We call the circles nodes and the arrows links.';
 assert.equal(resolveTranslatedOriginalWebPosition(saved,{sourceUrl:url,body:sentence+' '+sentence},sentence),null);
 assert.equal(resolveTranslatedOriginalWebPosition(saved,{sourceUrl:url,body:sentence},'We do not call the circles nodes and the arrows links.'),null);
});
