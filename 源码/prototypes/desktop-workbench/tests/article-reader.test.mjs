import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {randomUUID} from 'node:crypto';
import * as model from '../src/sublime/articleReaderModel.js';
import * as anchors from '../../../src/clipper/anchors.mjs';
import {articlePlainText} from '../../../src/clipper/article.mjs';

const compiled=(await transform(await readFile(new URL('../src/sublime/ArticleReader.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'transform'})).code;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const attachment={name:'fixture.png',type:'image/png',size:Buffer.from(png,'base64').length,dataUrl:'data:image/png;base64,'+png};
const article={version:1,blocks:[
  {id:'title',type:'heading',level:2,runs:[{text:'先读，再留下想法'}]},
  {id:'first',type:'paragraph',runs:[{text:'值得留下的句子。',strong:true},{text:'访问来源',href:'https://example.org/reference',em:true}]},
  {id:'figure',type:'image',src:'https://example.org/figure.png',alt:'只有图片替代文字',caption:'真正的图注',attachment},
  {id:'missing',type:'image',src:'https://example.org/missing.png',alt:'未下载图片',imageError:'需要登录，原图片未能保存'},
  {id:'last',type:'paragraph',runs:[{text:'<script>alert("untrusted")</script> 作为普通文字保存。'}]},
]};
const card={id:'article-1',type:'article',origin:'local',title:'隔离阅读样本',sourceUrl:'https://example.org/reading',sourceTitle:'示例来源',author:'合成作者',body:'先读，再留下想法\n\n值得留下的句子。访问来源\n\n<script>alert("untrusted")</script> 作为普通文字保存。',article};
function component(react=React,anchorModule=anchors,dom=globalThis){
  const module={exports:{}};
  const modules={'react':react,'../../../../src/clipper/anchors.mjs':anchorModule,'./articleReaderModel.js':model,'./CardContent.jsx':{default:({card,onOpen,openLabel,sourceFooter})=>React.createElement(React.Fragment,null,React.createElement('button',{'aria-label':openLabel,onClick:()=>onOpen?.(card.id)},card.body),React.createElement('footer',null,sourceFooter))},'./articleReader.css':{}};
  vm.compileFunction(compiled,['module','exports','require','globalThis','crypto'])(module,module.exports,name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},dom,{randomUUID});
  return module.exports.default;
}
const ArticleReader=component();

test('structured reader renders inert headings, inline links and downloaded pixels; original image URLs remain links',()=>{
  const html=renderToStaticMarkup(React.createElement(ArticleReader,{card,highlights:[]}));
  assert.match(html,/<h2[^>]*>先读，再留下想法<\/h2>/);
  assert.match(html,/<strong>值得留下的句子。<\/strong>/);
  assert.match(html,/<a href="https:\/\/example.org\/reference" target="_blank" rel="noopener noreferrer"><em>访问来源<\/em><\/a>/);
  assert.match(html,/<img src="data:image\/png;base64,/);
  assert.doesNotMatch(html,/<img src="https:/);
  assert.match(html,/需要登录，原图片未能保存/);
  assert.match(html,/&lt;script&gt;alert/);
  assert.doesNotMatch(html,/<script[ >]/);
  assert.match(html,/真正的图注/);
  assert.doesNotMatch(html,/<figcaption>只有图片替代文字/);
});

test('old plain-text articles remain readable, and malformed rich payload never turns into executable markup',()=>{
  const legacy={...card,article:undefined,body:'第一段原文。\n\n第二段继续。'};
  const html=renderToStaticMarkup(React.createElement(ArticleReader,{card:legacy}));
  assert.match(html,/<p>第一段原文。<\/p><p>第二段继续。<\/p>/);
  const unsafe={...card,body:'纯文字备份',article:{version:1,blocks:[{id:'unsafe',type:'paragraph',runs:[{text:'危险链接',href:'javascript:alert(1)'}]}]}};
  const safe=renderToStaticMarkup(React.createElement(ArticleReader,{card:unsafe}));
  assert.doesNotMatch(safe,/javascript:|危险链接/);
  assert.match(safe,/纯文字备份/);
});

test('article metadata and URL helpers preserve query identity, reject executable and credential-bearing destinations',()=>{
  assert.equal(model.articlePageUrl('https://example.org/a?q=1#section'),'https://example.org/a?q=1');
  assert.equal(model.articleSourceUrl('javascript:alert(1)'),'');
  assert.equal(model.articleSourceUrl('https://user:password@example.org/a'),'');
  assert.equal(model.articleOriginalLocation('https://example.org/a',{version:1,exact:'原文',prefix:'',suffix:''}),'https://example.org/a#:~:text=%E5%8E%9F%E6%96%87');
  assert.equal(model.articleReaderModel({...card,article:undefined,body:'字'.repeat(451)}).minutes,2);
  assert.equal(model.articleReaderModel(card).missingImages,1);
  assert.equal(model.savedArticleImage({attachment:{...attachment,type:'image/svg+xml'}}),'');
});

test('article highlights include only saved, visible quotations from the same page, including extension-origin selections',()=>{
  const anchor={version:1,exact:'值得留下的句子。',prefix:'',suffix:''};
  const make=(id,extra={})=>({id,type:'highlight',webAnchor:anchor,sourceUrl:card.sourceUrl,...extra});
  const cards=[make('yes',{sourceUrl:card.sourceUrl+'#fragment'}),make('hidden'),make('unsaved'),make('different',{sourceUrl:card.sourceUrl+'?other=1'}),make('no-anchor',{webAnchor:null}),make('wrong-kind',{type:'article'}),make('different-parent',{sourceCardId:'older-capture'}),make('explicit-parent',{sourceCardId:card.id})];
  const found=model.articleHighlights(cards,{savedIds:['yes','hidden','different','no-anchor','wrong-kind','different-parent','explicit-parent'],hiddenIds:['hidden']},card);
  assert.deepEqual(found.map(x=>x.id),['yes','explicit-parent']);
});

function find(node,predicate){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return null;}return predicate(node)?node:find(node.props?.children,predicate);}
function text(node){return node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function lifecycle(onSaveHighlight,overrides={},dependencies={}){
  let slots=[],cursor=0,pending=[],dirty=false,tree,props={card,highlights:[],onSaveHighlight,...overrides};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment',
    useState:initial=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(next!==slots[index].value){slots[index].value=next;dirty=true;}}];},
    useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},
    useMemo:(fn,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={deps,value:fn()};return slots[index].value;},
    useEffect:(effect,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps)){slots[index]={deps,cleanup:slots[index]?.cleanup};pending.push({index,effect});}},
  };
  let selectedText='值得留下的句子。',anchor={version:1,exact:selectedText,prefix:'先读，再留下想法',suffix:'访问来源'};
  const selection={isCollapsed:false,toString:()=>selectedText,removeAllRanges:()=>{}};
  const Reader=component(react,{...anchors,anchorFromSelection:()=>anchor,rangeForAnchor:()=>null,...dependencies.anchors},{getSelection:()=>selection,...dependencies.dom});
  function render(patch={}){props={...props,...patch};cursor=0;dirty=false;tree=Reader(props);return tree;}
  function commit(){for(let i=0;i<30;i++){const tasks=pending;pending=[];for(const {index,effect}of tasks){slots[index].cleanup?.();slots[index].cleanup=effect();}if(!dirty&&!pending.length)return;render();}throw Error('Reader state did not settle');}
  async function flush(){for(let i=0;i<20;i++){await Promise.resolve();if(dirty)render();commit();}}
  const view={render,commit,flush,select(value){selectedText=value;anchor={version:1,exact:value,prefix:'',suffix:''};find(tree,node=>node.props?.['aria-label']==='文章正文').props.onMouseUp();},byLabel:label=>find(tree,node=>node.props?.['aria-label']===label),find:predicate=>find(tree,predicate),text:()=>text(tree),button:label=>find(tree,node=>node.type==='button'&&text(node)===label),unmount(){for(const slot of slots)slot?.cleanup?.();}};
  render();commit();return view;
}

test('failed highlight save preserves quotation, note and request identity, then retries the exact original payload',async()=>{
  const calls=[];let fail=true;
  const view=lifecycle(async value=>{calls.push(value);if(fail)throw Error('合成磁盘错误');});
  view.byLabel('文章正文').props.onMouseUp();await view.flush();
  view.find(node=>node.type==='textarea').props.onChange({target:{value:'完整备注'}});await view.flush();
  await view.byLabel('保存文章高亮').props.onSubmit({preventDefault(){}});await view.flush();
  assert.match(view.text(),/合成磁盘错误/);
  assert.equal(view.find(node=>node.type==='textarea').props.value,'完整备注');
  assert.equal(view.find(node=>node.type==='textarea').props.disabled,true);
  assert.ok(view.button('重试保存'));
  fail=false;await view.byLabel('保存文章高亮').props.onSubmit({preventDefault(){}});await view.flush();
  assert.deepEqual(calls[1],calls[0]);
  assert.equal(view.byLabel('保存文章高亮'),null);
  assert.match(view.text(),/高亮与备注已保存/);view.unmount();
});

test('a late save acknowledgment from the previous article cannot alter the new article selection UI',async()=>{
  let resolve;const saving=new Promise(done=>{resolve=done;});
  const view=lifecycle(()=>saving);view.byLabel('文章正文').props.onMouseUp();await view.flush();
  const pending=view.byLabel('保存文章高亮').props.onSubmit({preventDefault(){}});await view.flush();
  view.render({card:{...card,id:'article-next',title:'另一篇文章'}});view.commit();await view.flush();
  resolve();await pending;await view.flush();
  assert.equal(view.byLabel('保存文章高亮'),null);
  assert.doesNotMatch(view.text(),/高亮与备注已保存/);assert.match(view.text(),/另一篇文章/);view.unmount();
});

test('edited plain text takes precedence while the original rich capture and image remain available',async()=>{
  const edited={...card,body:'这是用户编辑后的当前正文。'};
  const value=model.articleReaderModel(edited);assert.equal(value.hasEditedBody,true);assert.equal(value.body,edited.body);
  assert.equal(value.article.blocks.find(block=>block.id==='figure').attachment.dataUrl,attachment.dataUrl);
  const html=renderToStaticMarkup(React.createElement(ArticleReader,{card:edited}));
  assert.match(html,/这是用户编辑后的当前正文。/);assert.doesNotMatch(html,/<h2[^>]*>先读，再留下想法/);assert.match(html,/查看原始图文/);
  const view=lifecycle(async()=>{}, {card:edited});assert.equal(view.find(node=>node.props?.block?.id==='figure'),null);
  view.button('查看原始图文').props.onClick();await view.flush();
  assert.equal(view.find(node=>node.props?.block?.id==='figure').props.block.attachment.dataUrl,attachment.dataUrl);
  view.button('返回当前正文').props.onClick();await view.flush();assert.match(view.text(),/这是用户编辑后的当前正文。/);view.unmount();
});

test('durable selection drafts restore their text, note and retry identity after leaving the reader',async()=>{
  let savedDraft;
  const first=lifecycle(async()=>{}, {onDraft:async value=>{savedDraft=value;}});
  first.byLabel('文章正文').props.onMouseUp();await first.flush();
  first.find(node=>node.type==='textarea').props.onChange({target:{value:'离开阅读器后仍需保留的备注'}});await first.flush();first.unmount();
  const calls=[],second=lifecycle(async value=>{calls.push(value);}, {initialDraft:savedDraft,onDraft:async()=>{}});
  assert.match(second.text(),/值得留下的句子/);assert.equal(second.find(node=>node.type==='textarea').props.value,'离开阅读器后仍需保留的备注');
  await second.byLabel('保存文章高亮').props.onSubmit({preventDefault(){}});await second.flush();
  assert.equal(calls[0].operationId,savedDraft.operationId);assert.equal(calls[0].note,savedDraft.note);second.unmount();
});

test('failed draft writes block quit until the current draft is durably retained',async()=>{
  let flush,fail=true;
  const view=lifecycle(async()=>{}, {registerFlush:value=>{flush=value;},onDraft:async()=>{if(fail)throw Error('合成草稿写入失败');}});
  view.byLabel('文章正文').props.onMouseUp();await view.flush();
  await assert.rejects(flush(),/高亮草稿尚未保存/);
  fail=false;view.find(node=>node.type==='textarea').props.onChange({target:{value:'这次草稿已保存'}});await view.flush();
  await flush();assert.ok(view.byLabel('保存文章高亮'));view.unmount();assert.equal(flush,null);
});

test('a restored quote cannot silently be saved under an edited source URL',()=>{
  const draft={operationId:randomUUID(),text:'旧网页的原句',note:'已有备注',favorite:false,submitted:false,sourceUrl:'https://example.org/old',anchor:{version:1,exact:'旧网页的原句',prefix:'',suffix:''}};
  const view=lifecycle(async()=>{throw Error('must not save');},{initialDraft:draft});
  assert.match(view.text(),/网页来源已变化/);assert.equal(view.button('保存高亮').props.disabled,true);view.unmount();
});

test('refining an unsubmitted quotation retains note and star in the durable draft and after reopening',async()=>{
  const writes=[],first=lifecycle(async()=>{}, {onDraft:async value=>{writes.push(value);}});
  first.byLabel('文章正文').props.onMouseUp();await first.flush();
  first.find(node=>node.type==='textarea').props.onChange({target:{value:'调整选文时仍需保留的想法'}});await first.flush();
  first.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});await first.flush();
  const before=writes.at(-1),count=writes.length;
  first.byLabel('文章正文').props.onMouseUp();await first.flush();
  assert.equal(writes.length,count,'the identical selection does not replace the draft');
  first.select('更精确的另一段选文。');await first.flush();
  const refined=writes.at(-1);
  assert.equal(refined.note,before.note);assert.equal(refined.favorite,true);assert.notEqual(refined.operationId,before.operationId);assert.equal(refined.text,'更精确的另一段选文。');
  first.unmount();
  const calls=[],restored=lifecycle(async value=>{calls.push(value);},{initialDraft:refined,onDraft:async()=>{}});
  assert.equal(restored.find(node=>node.type==='textarea').props.value,before.note);
  assert.equal(restored.find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,true);
  assert.ok(restored.byLabel('选文保存快捷操作'),'a restored draft exposes its save entry immediately');
  await restored.byLabel('快速保存高亮').props.onClick();await restored.flush();
  assert.deepEqual(calls[0],{operationId:refined.operationId,text:refined.text,anchor:refined.anchor,note:refined.note,favorite:true});restored.unmount();
});

test('reselection cannot mutate a failed submitted request, and a different article gets an independent draft',async()=>{
  const writes=[],calls=[],view=lifecycle(async value=>{calls.push(value);throw Error('合成未确认保存');},{onDraft:async value=>writes.push(value)});
  view.byLabel('文章正文').props.onMouseUp();await view.flush();
  view.find(node=>node.type==='textarea').props.onChange({target:{value:'原请求备注'}});await view.flush();
  await view.byLabel('快速保存高亮').props.onClick();await view.flush();
  const frozen=writes.at(-1),count=writes.length;
  view.select('保存失败后新选择的句子。');await view.flush();
  assert.equal(writes.length,count);assert.equal(view.find(node=>node.type==='textarea').props.value,'原请求备注');
  await view.byLabel('快速重试保存高亮').props.onClick();await view.flush();assert.deepEqual(calls[1],calls[0]);
  assert.equal(writes.at(-1).operationId,frozen.operationId);
  view.render({card:{...card,id:'article-independent'},initialDraft:null});view.commit();await view.flush();
  assert.equal(view.byLabel('保存文章高亮'),null);
  view.select('另一篇文章的选文。');await view.flush();
  assert.equal(view.find(node=>node.type==='textarea').props.value,'');assert.equal(view.find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false);view.unmount();
});

test('a quotation at the start of a long article has an immediate quick save entry without scrolling',async()=>{
  const blocks=[{id:'long-top',type:'paragraph',runs:[{text:'长文开头的选文。'}]},...Array.from({length:100},(_,i)=>({id:'long-'+i,type:'paragraph',runs:[{text:`合成长文第${i+1}段。`+'阅读材料和相关思考。'.repeat(20)}]}))],longArticle={version:1,blocks};
  const calls=[],view=lifecycle(async value=>calls.push(value),{card:{...card,article:longArticle,body:articlePlainText(longArticle)}});
  view.select('长文开头的选文。');await view.flush();
  assert.ok(view.byLabel('选文保存快捷操作'));assert.ok(view.button('添加备注'));
  await view.byLabel('快速保存高亮').props.onClick();await view.flush();assert.equal(calls[0].text,'长文开头的选文。');view.unmount();
});

test('structured lists retain numbering and nesting, and tables retain header cells, spans and nearby saved images',()=>{
  const rich={version:1,blocks:[
    {id:'ol-3',type:'list-item',marker:'3.',depth:0,runs:[{text:'第三步'}]},
    {id:'nested-a',type:'list-item',marker:'a.',depth:1,runs:[{text:'其中的细节'}]},
    {id:'ol-7',type:'list-item',marker:'7.',depth:0,runs:[{text:'第七步'}]},
    {id:'table',type:'table',imagesAfter:true,rows:[
      {cells:[{header:true,rowspan:2,runs:[{text:'维度'}]},{header:true,colspan:2,runs:[{text:'内容'}]}]},
      {cells:[{header:false,runs:[]},{header:false,runs:[{text:'链接',href:'https://example.org/table'}]}]},
    ]},
    {id:'table-image',type:'image',src:'https://example.org/table.png',caption:'表内原图图注',attachment},
    {id:'old-list',type:'list-item',runs:[{text:'旧格式圆点项目'}]},
  ]};
  const richCard={...card,article:rich,body:articlePlainText(rich)};
  assert.equal(model.articleReaderModel(richCard).hasEditedBody,false);
  const html=renderToStaticMarkup(React.createElement(ArticleReader,{card:richCard}));
  assert.match(html,/<ol class="ar-list" start="3">/);assert.match(html,/data-article-block="ol-3" data-marker="3\." value="3"/);
  assert.match(html,/<ol class="ar-list"><li[^>]*data-article-block="nested-a"/);
  assert.match(html,/data-article-block="ol-7" data-marker="7\." value="7"/);
  assert.match(html,/<table><tbody><tr><th rowSpan="2">维度<\/th><th colSpan="2">内容<\/th><\/tr><tr><td><\/td><td><a /);
  assert.match(html,/class="ar-table-image-note" data-mengcang-ui="true">表内图片按原顺序列于表格下方/);
  assert.match(html,/<ul class="ar-list"><li data-article-block="old-list">旧格式圆点项目<\/li><\/ul>/);
  assert.ok(html.indexOf('</table>')<html.indexOf('data-article-block="table-image"'));
  assert.match(html,/src="data:image\/png;base64,/);assert.doesNotMatch(html,/查看原始图文/);
  assert.equal(model.articleListNumber('12)'),12);assert.equal(model.articleListNumber('a.'),undefined);
});


test('reading discovery switches between own highlights and related material without touching the selection draft',async()=>{
  const writes=[],anchor={version:1,exact:'值得留下的句子。',prefix:'',suffix:''};
  const highlight={id:'saved-highlight',type:'highlight',body:anchor.exact,caption:'仍保留的备注',sourceUrl:card.sourceUrl,webAnchor:anchor};
  const view=lifecycle(async()=>{}, {card:{...card,id:'discovery-tab-test'},highlights:[highlight],favoriteIds:[highlight.id],relatedContent:'独立相关资料',onDraft:async value=>writes.push(value)});
  const panel=kind=>view.find(node=>node.props?.role==='tabpanel'&&node.props.id.endsWith('-'+kind+'-panel'));
  const tab=kind=>view.find(node=>node.props?.role==='tab'&&node.props['data-reading-tab']===kind);
  assert.equal(panel('related').props.hidden,false);assert.equal(panel('highlights').props.hidden,true);
  view.select('留下的选文');await view.flush();
  view.find(node=>node.type==='textarea').props.onChange({target:{value:'切换发现视图时仍保留'}});await view.flush();
  const before=writes.at(-1),writeCount=writes.length;
  tab('highlights').props.onClick();await view.flush();
  assert.equal(panel('related').props.hidden,true);assert.equal(panel('highlights').props.hidden,false);
  assert.equal(writes.length,writeCount);assert.equal(view.find(node=>node.type==='textarea').props.value,before.note);
  assert.ok(view.find(node=>node.props?.openLabel==='在本文看这段摘录：'+anchor.exact));
  assert.match(view.text(),/仍保留的备注/);
  view.render({card:{...card,id:'discovery-other'}});view.commit();await view.flush();assert.equal(panel('related').props.hidden,false);
  view.render({card:{...card,id:'discovery-tab-test'}});view.commit();await view.flush();assert.equal(panel('highlights').props.hidden,false);
  view.unmount();
});

test('bottom highlight retains original anchor navigation and original-page destination',async()=>{
  const anchor={version:1,exact:'值得留下的句子。',prefix:'',suffix:''},calls=[];
  const highlight={id:'anchor-test',type:'highlight',body:anchor.exact,sourceUrl:card.sourceUrl,webAnchor:anchor};
  const parent={scrollIntoView:value=>calls.push(value)};
  const view=lifecycle(async()=>{}, {highlights:[highlight]}, {anchors:{rangeForAnchor:(root,value)=>{assert.equal(value,anchor);return {startContainer:{nodeType:3,parentElement:parent}};}}});
  view.byLabel('文章正文').props.ref.current={};
  view.find(node=>node.props?.openLabel==='在本文看这段摘录：'+anchor.exact).props.onOpen();await view.flush();
  assert.deepEqual(calls,[{block:'center',behavior:'auto'}]);assert.match(view.text(),/已定位到这段文字/);
  assert.equal(view.find(node=>node.type==='a'&&text(node)==='去原网页 ↗').props.href,model.articleOriginalLocation(card.sourceUrl,anchor));
  view.unmount();
});

test('discovery tabs support keyboard navigation and keep only the active tab in the tab sequence',async()=>{
  let focused='',prevented=false;
  const view=lifecycle(async()=>{}, {card:{...card,id:'keyboard-tabs'}});
  const tab=kind=>view.find(node=>node.props?.role==='tab'&&node.props['data-reading-tab']===kind);
  tab('related').props.onKeyDown({key:'ArrowRight',preventDefault(){prevented=true;},currentTarget:{parentElement:{querySelector:selector=>({focus(){focused=selector;}})}}});await view.flush();
  assert.equal(prevented,true);assert.equal(tab('highlights').props.tabIndex,0);assert.equal(tab('related').props.tabIndex,-1);assert.match(focused,/highlights/);
  view.unmount();
});

test('article saves mix figures and quotations, focus the exact figure in the original snapshot, and retain card actions',async()=>{
  const anchor={version:1,exact:'值得留下的句子。',prefix:'',suffix:''};
  const quote={id:'saved-quote',type:'highlight',body:anchor.exact,webAnchor:anchor,sourceUrl:card.sourceUrl};
  const picture={id:'saved-image',type:'image',title:'概念图',attachment};
  const missing={...picture,id:'moved-image',title:'失去定位的配图'};
  const calls=[],open=[];
  const target={dataset:{articleBlock:'figure'},focus:opts=>calls.push(['focus',opts]),scrollIntoView:opts=>calls.push(['scroll',opts])};
  const other={dataset:{articleBlock:'another'}};
  const view=lifecycle(async()=>{},{card:{...card,id:'mixed-saving',body:'本文已编辑'},highlights:[quote],
    figureItems:[{card:picture,blockId:'figure'},{card:missing}],onOpenFigure:id=>open.push(id)});
  const tab=view.find(node=>node.props?.role==='tab'&&node.props['data-reading-tab']==='highlights');
  assert.equal(text(tab),'本文收藏 3');
  tab.props.onClick();await view.flush();
  assert.ok(view.find(node=>node.props?.openLabel==='在本文看这段摘录：'+quote.body));
  assert.equal(view.find(node=>node.props?.openLabel==='在本文看这张图：概念图').props.card.attachment.dataUrl,attachment.dataUrl);
  view.byLabel('文章正文').props.ref.current={querySelectorAll:selector=>{assert.equal(selector,'figure[data-article-block]');return [other,target];}};
  view.find(node=>node.props?.openLabel==='在本文看这张图：概念图').props.onOpen();await view.flush();
  assert.match(view.text(),/正在查看收录时的原始图文/);
  assert.deepEqual(calls,[['focus',{preventScroll:true}],['scroll',{block:'center',behavior:'auto'}]]);
  assert.match(view.text(),/已返回这张配图/);
  view.find(node=>node.props?.openLabel==='打开已收藏的配图：失去定位的配图').props.onOpen();await view.flush();
  assert.deepEqual(open,['moved-image']);
  view.unmount();
});

test('article highlight delegates original-page positioning without changing its local anchor',()=>{
 const anchor={version:1,exact:'值得留下的句子。',prefix:'',suffix:''};
 const highlight={id:'cross-language-highlight',type:'highlight',body:anchor.exact,sourceUrl:card.sourceUrl,webAnchor:anchor};
 const seen=[];
 const view=lifecycle(async()=>{}, {highlights:[highlight],
  renderOriginalPosition:item=>{seen.push(item);return '自定义原文定位';}});
 assert.ok(seen.includes(highlight));
 assert.match(view.text(),/自定义原文定位/);
 assert.deepEqual(highlight.webAnchor,anchor);
 view.unmount();
});

test('a lost excerpt reports the failure on the chosen saved item and leaves its independent destinations available',async()=>{
 const first={id:'missing',title:'第一条',type:'highlight',sourceUrl:card.sourceUrl,body:'没有可唯一确定的位置',webAnchor:{version:1,exact:'没有可唯一确定的位置',prefix:'',suffix:''}};
 const second={...first,id:'other',title:'另一条'};
 const view=lifecycle(async()=>{},{highlights:[first,second],__anchors:{rangeForAnchor:()=>null}});
 view.byLabel('文章正文').props.ref.current={};
 view.find(n=>n.props?.openLabel==='在本文看这段摘录：第一条').props.onOpen();await view.flush();
 const item=view.find(n=>n.type==='article'&&text(n).includes('未能唯一定位'));
 assert.ok(item);assert.match(text(item),/打开独立卡片/);assert.match(text(item),/去原网页/);
 assert.equal(view.find(n=>n.props?.className==='ar-notice'),null);view.unmount();
});

test('an ambiguous original fragment still exposes the plain recorded webpage',()=>{
 const broken={id:'ambiguous',type:'highlight',title:'非唯一片段',sourceUrl:card.sourceUrl,webAnchor:{version:1,exact:'重复文字',prefix:'',suffix:'',textFragment:null}};
 const view=lifecycle(async()=>{}, {highlights:[broken],renderOriginalPosition:()=>{throw Error('不得把普通链接当作定位');}});
 assert.equal(model.articleOriginalLocation(broken.sourceUrl,broken.webAnchor),'');
 assert.equal(view.find(n=>n.type==='a'&&text(n)==='去原网页 ↗').props.href,card.sourceUrl);
 view.unmount();
});
