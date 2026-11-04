import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as browser from '../src/sublime/relatedBrowser.js';
import * as materialSearch from '../src/sublime/localMaterialSearch.js';
import * as personal from '../src/sublime/personalRelated.js';
const compiled=(await transform(await readFile(new URL('../src/sublime/PersonalRelated.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'})).code;
const find=(node,predicate)=>!node||typeof node!=='object'?null:Array.isArray(node)?(node.map(n=>find(n,predicate)).find(Boolean)||null):predicate(node)?node:find(node.props?.children,predicate);
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
function form(initial,moreCards=[]){
 const slots=[],refs=[],effectSlots=[],events=new Map(),views=new Map();if(initial)views.set('source',initial);
 const source={id:'source',title:'Original',sourceUrl:'https://example.test/one',tags:['hypertext']},library=[source,{id:'related',title:'Original excerpt',body:'A separate excerpt',sourceUrl:source.sourceUrl,type:'text'},...moreCards];
 let sc=0,rc=0,ec=0,tree,pending=[];
 const workspace={name:'workspace'},body={name:'body'},portals=[];
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const id=sc++;if(!slots[id])slots[id]={value:typeof initial==='function'?initial():initial};return [slots[id].value,next=>{slots[id].value=typeof next==='function'?next(slots[id].value):next;}];},useRef:initial=>refs[rc++]??(refs[rc-1]={current:initial}),useMemo:fn=>fn(),useLayoutEffect:()=>{},useEffect:(fn,deps)=>{const id=ec++,old=effectSlots[id];if(!old||deps.some((x,i)=>x!==old.deps[i]))pending.push(()=>{old?.cleanup?.();effectSlots[id]={deps,cleanup:fn()};});}};
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,console,document:{body,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},require:id=>id==='react-dom'?{createPortal:(node,target)=>{portals.push(target);return {type:'portal',props:{children:[node],target}};}}:id==='react'?react:id==='@tabler/icons-react'?new Proxy({},{get:(_,name)=>name}):id==='./relatedBrowser.js'?browser:id==='./localMaterialSearch.js'?materialSearch:id==='./personalRelated.js'?personal:id==='./OriginalPositionStatus.jsx'?{default:()=>null}:id==='./useOriginalPosition.js'?{useOriginalPosition:()=>({state:null,open:()=>{}})}:id==='../desktopModel.js'?{valueOf:x=>x}:id==='./CardContent.jsx'?{default:()=>null,CollectionChips:()=>null}:id.endsWith('.css')?{}:(()=>{throw Error(id);})()});
 const render=()=>{sc=rc=ec=0;pending=[];tree=module.exports.default({source,library,collections:[],cache:new Map(),views,onOpen:()=>{}});pending.forEach(fn=>fn());return tree;};render();
 const button=label=>find(tree,n=>n.type==='button'&&(n.props['aria-label']===label||text(n).trim()===label));
 return {render,button,choose:(field,value)=>find(tree,n=>n.type==='input'&&n.props.name==='related-'+field+'-source'&&n.props.value===value).props.onChange(),view:()=>structuredClone(views.get('source')),portal:()=>portals.at(-1),workspace,attachRoot:()=>{refs[0].current={closest:selector=>selector==='.sublime-workspace'?workspace:null};},dialog:()=>find(tree,n=>n.props?.role==='dialog'),escape:()=>events.get('keydown')?.({key:'Escape',preventDefault(){},stopPropagation(){}})};
}
test('filter controls remain a draft until Apply, then reset pagination and preserve chosen sort',()=>{
 const f=form({type:'all',scope:'all',sort:'relevance',limit:18});
 f.button('筛选相关资料').props.onClick();f.render();f.choose('type','image');f.render();f.choose('sort','created-asc');f.render();
 assert.equal(f.view().type,'all');assert.equal(f.view().limit,18);
 f.button('应用').props.onClick();f.render();assert.equal(f.dialog(),null);
 assert.equal(f.view().type,'image');assert.equal(f.view().sort,'created-asc');assert.equal(f.view().limit,6);
});

test('returning from the same webpage restores the previous recommendation, including after reopening a card',()=>{
 const otherSources=Array.from({length:10},(_,i)=>({id:'r'+i,type:'text',title:'Report '+i,body:'Observation '+i,sourceUrl:'https://example.test/report/'+i,tags:['hypertext']}));
 const f=form({type:'all',scope:'content',sort:'updated-asc'},otherSources);
 assert.ok(f.button('查看更多相关资料'));f.button('查看更多相关资料').props.onClick();f.render();
 assert.equal(f.button('查看更多相关资料'),null);
 const original=f.view();assert.equal(original.limit,12);
 f.button('查看同一网页的 1 份资料').props.onClick();f.render();
 assert.equal(f.view().scope,'source');assert.equal(f.view().limit,6);
 const reopened=form(f.view(),otherSources);
 reopened.button('返回推荐').props.onClick();reopened.render();
 assert.deepEqual(reopened.view(),original);assert.equal(reopened.button('查看更多相关资料'),null);
});
test('Escape and close discard pending changes, and Clear only takes effect after Apply',()=>{
 const f=form({type:'image',scope:'source',sort:'updated-desc',limit:12});
 f.button('筛选相关资料').props.onClick();f.render();f.choose('type','audio');f.render();f.escape();f.render();assert.equal(f.dialog(),null);assert.equal(f.view().type,'image');
 f.button('筛选相关资料').props.onClick();f.render();f.button('清除').props.onClick();f.render();assert.equal(f.view().scope,'source');
 f.button('关闭相关筛选').props.onClick();f.render();assert.equal(f.view().sort,'updated-desc');
 f.button('筛选相关资料').props.onClick();f.render();f.button('清除').props.onClick();f.render();f.button('应用').props.onClick();f.render();
 assert.deepEqual({...f.view(),result:null},{type:'all',scope:'all',sort:'relevance',limit:6,filtersOpen:false,result:null});
});

test('filter is portaled to the workspace overlay layer instead of its low-z-index heading',()=>{
 const f=form();f.attachRoot();
 f.button('筛选相关资料').props.onClick();f.render();
 assert.equal(f.portal(),f.workspace);assert(f.dialog());
 f.choose('sort','created-desc');f.render();f.button('应用').props.onClick();f.render();
 assert.equal(f.view().sort,'created-desc');assert.equal(f.dialog(),null);
});

test('related card body and source title have independent actions and render one source title',async()=>{
 const code=(await transform(await readFile(new URL('../src/sublime/CardContent.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'})).code;
 const react={
  createElement:(type,props,...children)=>typeof type==='function'?type({...props,children}):{type,props:{...props,children}},
  useState:value=>[value,()=>{}]
 };
 const module={exports:{}},deps={'react':react,'./relatedBrowser.js':browser,'@tabler/icons-react':{},'./cardContent.css':{}};
 vm.compileFunction(code,['module','exports','require'])(module,module.exports,name=>deps[name]);
 const Card=module.exports.default,opened=[];
 const parent={id:'w3',type:'article',title:'万维网提案',sourceUrl:'https://example.test/proposal',body:'来源正文'};
 const figure={id:'diagram',type:'image',title:parent.title,sourceCardId:parent.id,sourceTitle:parent.title,sourceUrl:parent.sourceUrl,author:'Tim'};
 const render=card=>Card({card,onOpen:id=>opened.push(['card',id]),sourceAction:materialSearch.relatedCardSource(card,[figure,parent]),onOpenSource:id=>opened.push(['source',id])});
 const tree=render(figure),main=find(tree,n=>n.props.className?.includes('sc-open')),footer=find(tree,n=>n.type==='footer');
 const source=find(footer,n=>n.props['aria-label']==='来源文章：万维网提案');
 assert.ok(main&&source);
 assert.equal(find(main,n=>n===source),null);
 assert.equal(text(footer),'万维网提案Tim');
 main.props.onClick();source.props.onClick();
 assert.deepEqual(opened,[['card','diagram'],['source','w3']]);
 const webFooter=find(render(parent),n=>n.type==='footer'),web=find(webFooter,n=>n.type==='a');
 assert.equal(web.props.href,parent.sourceUrl);assert.equal(web.props.target,'_blank');
 assert.equal(text(webFooter),parent.title);
});

test('external related source passes the user click to the positioning action',async()=>{
 const code=(await transform(await readFile(new URL('../src/sublime/CardContent.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'})).code;
 const react={Fragment:Symbol('fragment'),createElement:(type,props,...children)=>typeof type==='function'?type({...props,children}):{type,props:{...props,children}},useState:value=>[value,()=>{}]};
 const module={exports:{}},deps={'react':react,'./relatedBrowser.js':browser,'@tabler/icons-react':{},'./cardContent.css':{}};
 vm.compileFunction(code,['module','exports','require'])(module,module.exports,name=>deps[name]);
 const card={id:'quote',type:'highlight',title:'中文摘录',body:'中文摘录',sourceUrl:'https://example.org/article',webAnchor:{version:1,exact:'中文摘录',prefix:'',suffix:''}};
 let received;const tree=module.exports.default({card,sourceAction:materialSearch.relatedCardSource(card,[]),onExternalSource:event=>received=event});
 const link=find(tree,node=>node.type==='a'&&node.props['aria-label']==='打开原网页：example.org');
 const event={type:'click'};assert.ok(link);link.props.onClick(event);assert.equal(received,event);
});

test('keyword title hits appear once on the card, including punctuation and titles already on the first line',async()=>{
 const code=(await transform(await readFile(new URL('../src/sublime/CardContent.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'})).code;
 const react={Fragment:Symbol(),createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:value=>[value,()=>{}]};
 const titleSearch=await import('../src/sublime/searchTitle.js');
 const deps={'react':react,'./relatedBrowser.js':browser,'./searchTitle.js':titleSearch,'@tabler/icons-react':{},'./cardContent.css':{}},module={exports:{}};
 vm.compileFunction(code,['module','exports','require'])(module,module.exports,name=>deps[name]);
 const render=body=>module.exports.default({card:{id:'h',title:'圆圈、节点与链接',type:'highlight',sourceUrl:'https://example.org/',body},keyword:'圆圈、节点与链接'});
 for(const body of ['另一段摘录正文','圆圈、节点与链接\n下一段']){
  const tree=render(body);assert.equal(text(tree).split('圆圈、节点与链接').length-1,1);
  assert.equal(text(find(tree,n=>n.type==='mark')),'圆圈、节点与链接');
 }
 assert.deepEqual(titleSearch.titleMatchParts('C++ 及 a.b','c++ a.b'),[['C++',true],[' 及 ',false],['a.b',true]]);
});
