// Text quote selectors shared by the isolated extension world and local reader.
// No network, storage, HTML execution or access to browser credentials.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const badUnicode=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_WEB_ANCHOR'});};
export const normalizeAnchorText=value=>String(value??'').replace(/\s+/gu,' ').trim();
function text(value,max,label){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0e-\x1f\x7f-\x9f]/.test(value)||badUnicode.test(value))fail(`${label}无效`);return value;}
export function normalizeWebAnchor(raw){
 if(!object(raw)||Object.keys(raw).some(key=>!['version','exact','prefix','suffix','start','end','textFragment'].includes(key))||raw.version!==1)fail('网页高亮位置格式无效');
 const exact=normalizeAnchorText(text(raw.exact,50000,'高亮文字'));
 if(!exact)fail('高亮文字不能为空');
 const result={version:1,exact,prefix:normalizeAnchorText(text(raw.prefix??'',160,'高亮前文')),suffix:normalizeAnchorText(text(raw.suffix??'',160,'高亮后文'))};
 if(raw.start!==undefined||raw.end!==undefined){
  if(!Number.isSafeInteger(raw.start)||!Number.isSafeInteger(raw.end)||raw.start<0||raw.end<raw.start||raw.end>500000||raw.end-raw.start!==exact.length)fail('网页高亮文字位置无效');
  result.start=raw.start;result.end=raw.end;
 }
 if(raw.textFragment===null)result.textFragment=null;
 else if(raw.textFragment!==undefined){
  const fragment=raw.textFragment;
  if(!object(fragment)||Object.keys(fragment).some(key=>!['start','end','prefix','suffix'].includes(key)))fail('原网页文本定位提示无效');
  const start=normalizeAnchorText(text(fragment.start,160,'原网页起始文字'));
  const end=normalizeAnchorText(text(fragment.end??'',160,'原网页结束文字'));
  const prefix=normalizeAnchorText(text(fragment.prefix??'',160,'原网页前文'));
  const suffix=normalizeAnchorText(text(fragment.suffix??'',160,'原网页后文'));
  if(!start||!exact.startsWith(start)||(end&&!exact.endsWith(end))||(prefix&&!result.prefix.endsWith(prefix))||(suffix&&!result.suffix.startsWith(suffix)))fail('原网页文本定位提示与高亮不一致');
  result.textFragment={start,...(end?{end}:{}),prefix,suffix};
 }
 return result;
}
export function findQuoteAnchor(value,raw){
 const anchor=normalizeWebAnchor(raw),text=normalizeAnchorText(value);let at=-1,result=null;
 // Require a unique context match. Old offsets alone never select a different
 // occurrence when a page is edited or the same sentence appears twice.
 while((at=text.indexOf(anchor.exact,at+1))>=0){
  if(anchor.prefix&&!text.slice(Math.max(0,at-anchor.prefix.length-1),at).trimEnd().endsWith(anchor.prefix))continue;
  const end=at+anchor.exact.length;
  if(anchor.suffix&&!text.slice(end,end+anchor.suffix.length+1).trimStart().startsWith(anchor.suffix))continue;
  if(result)return null;result={start:at,end};
 }
 return result;
}
const ignored='script,style,noscript,svg,canvas,iframe,nav,footer,aside,form,input,textarea,select,button,dialog,[role="navigation"],[role="menu"],[role="dialog"],[hidden],[aria-hidden="true"],[data-mengcang-ui]';
const blocks=new Set(['P','DIV','SECTION','ARTICLE','MAIN','HEADER','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','LI','PRE','TR','TD','TH','UL','OL','FIGURE','FIGCAPTION']);
function articleHeader(node){
 for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.matches?.('article,main,[role="main"]'))return true;
 return false;
}
export function buildTextIndex(root,{maxText=500000}={}){
 if(!root) return {text:'',entries:[]};
 const document=root.ownerDocument||root,view=document.defaultView,chunks=[],entries=[];let length=0,pending=false;
 const append=value=>{length+=value.length;if(length>maxText)throw Object.assign(new Error('页面文字过多，请缩小选择范围后重试。'),{code:'PAGE_TOO_LARGE'});chunks.push(value);};
 function walk(node){
  if(node.nodeType===3){
   const raw=node.nodeValue||'',entry={node,positions:[],offsets:[]};
   for(let i=0;i<raw.length;i++){
    const char=raw[i];if(/\s/u.test(char)){pending=true;continue;}
    if(pending&&length)append(' ');pending=false;
    entry.positions.push(length);entry.offsets.push(i);append(char);
   }
   if(entry.positions.length)entries.push(entry);return;
  }
  if(node.nodeType!==1&&node!==root)return;
  if(node.nodeType===1){
   if(node.matches?.(ignored)||node.tagName==='HEADER'&&!articleHeader(node))return;
   const style=view?.getComputedStyle?.(node);
   if(style?.display==='none'||style?.visibility==='hidden')return;
   if(node.tagName==='BR'){pending=true;return;}
  }
  const block=blocks.has(node.tagName);if(block)pending=true;
  for(const child of node.childNodes||[])walk(child);
  if(block)pending=true;
 }
 walk(root);return {text:chunks.join(''),entries};
}
const safeTail=value=>{const out=value.slice(-160);return /^[\uDC00-\uDFFF]/.test(out)?out.slice(1):out;};
const safeHead=value=>{const out=value.slice(0,160);return /[\uD800-\uDBFF]$/.test(out)?out.slice(0,-1):out;};
const fragmentHead=value=>[...value].slice(0,60).join('');
const fragmentTail=value=>[...value].slice(-60).join('');
function nearestBlock(node,root){for(let parent=node.parentElement||node.parentNode;parent&&parent!==root;parent=parent.parentElement||parent.parentNode)if(blocks.has(parent.tagName))return parent;return root;}
function pointPosition(index,node,offset){const entry=index.entries.find(entry=>entry.node===node),at=entry?.offsets.indexOf(offset)??-1;return at<0?null:entry.positions[at];}
function nativeSelectorUnique(text,fragment,expected){
 // Native text fragments are case-insensitive. Fold only when UTF-16 offsets
 // remain stable; otherwise keep the safe in-page quote locator instead.
 const fold=value=>value.toUpperCase().toLowerCase();
 const folded=fold(text),parts=Object.fromEntries(Object.entries(fragment).map(([key,value])=>[key,fold(value)]));
 if(folded.length!==text.length||Object.keys(fragment).some(key=>parts[key].length!==fragment[key].length))return false;
 text=folded;fragment=parts;
 let start=-1,found=false;
 while((start=text.indexOf(fragment.start,start+1))>=0){
  if(fragment.prefix&&!text.slice(Math.max(0,start-fragment.prefix.length-1),start).trimEnd().endsWith(fragment.prefix))continue;
  const startEnd=start+fragment.start.length;
  let end=fragment.end?text.indexOf(fragment.end,startEnd):startEnd;
  while(end>=0){
   const finish=fragment.end?end+fragment.end.length:end;
   if(!fragment.suffix||text.slice(finish,finish+fragment.suffix.length+1).trimStart().startsWith(fragment.suffix)){
    if(found||start!==expected.start||finish!==expected.end)return false;
    found=true;
   }
   if(!fragment.end)break;
   end=text.indexOf(fragment.end,end+1);
  }
 }
 return found;
}
function nativeFragment(root,first,last,exact){
 const firstBlock=nearestBlock(first.node,root),lastBlock=nearestBlock(last.node,root);
 const firstIndex=buildTextIndex(firstBlock),lastIndex=firstBlock===lastBlock?firstIndex:buildTextIndex(lastBlock);
 const start=pointPosition(firstIndex,first.node,first.offset),lastAt=pointPosition(lastIndex,last.node,last.offset-1);
 if(start===null||lastAt===null)return undefined;
 const end=lastAt+1,sameBlock=firstBlock===lastBlock;
 // Native text fragment components each have to stay within one block. The
 // full quote selector above may span many paragraphs and keeps its context.
 const single=sameBlock&&exact.length<=160;
 const fragment={start:single?exact:fragmentHead(firstIndex.text.slice(start,sameBlock?end:undefined)),
  ...(!single?{end:fragmentTail(lastIndex.text.slice(sameBlock?start:0,end))}:{}),
  prefix:fragmentTail(firstIndex.text.slice(0,start)).trim(),suffix:fragmentHead(lastIndex.text.slice(end)).trim()};
 const all=buildTextIndex(root),expectedStart=pointPosition(all,first.node,first.offset),expectedEnd=pointPosition(all,last.node,last.offset-1);
 // A compact native selector can lose distinctions retained by the full quote.
 // In that case omit native navigation; in-page quote matching still works.
 return nativeSelectorUnique(all.text,fragment,{start:expectedStart,end:expectedEnd+1})?fragment:null;
}
export function anchorFromSelection(root,selection){
 if(!selection||selection.rangeCount!==1||selection.isCollapsed||!root)return null;
 const range=selection.getRangeAt(0);
 if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
 const selected=normalizeAnchorText(selection.toString());if(!selected)return null;
 if(selected.length>50000)fail('单条高亮最多 50000 字，请缩小选择范围。');
 const index=buildTextIndex(root);let start=Infinity,end=-1,first,last;
 for(const entry of index.entries){
  if(!range.intersectsNode(entry.node))continue;
  for(let i=0;i<entry.offsets.length;i++){
   const offset=entry.offsets[i];
   // Testing both ends keeps the Range end exclusive, including when the
   // selection ends between elements rather than in a text node.
   if(range.isPointInRange(entry.node,offset)&&range.isPointInRange(entry.node,offset+1)){
    if(entry.positions[i]<start){start=entry.positions[i];first={node:entry.node,offset};}
    if(entry.positions[i]+1>end){end=entry.positions[i]+1;last={node:entry.node,offset:offset+1};}
   }
  }
 }
 if(!Number.isFinite(start)||end<start||index.text.slice(start,end)!==selected)return null;
 return normalizeWebAnchor({version:1,exact:selected,prefix:safeTail(index.text.slice(0,start)).trim(),suffix:safeHead(index.text.slice(end)).trim(),start,end,textFragment:nativeFragment(root,first,last,selected)});
}
export function rangeForAnchor(root,anchor){
 if(!root)return null;const index=buildTextIndex(root),match=findQuoteAnchor(index.text,anchor);if(!match)return null;
 let first,last;
 for(const entry of index.entries)for(let i=0;i<entry.positions.length;i++){
  if(entry.positions[i]===match.start)first={node:entry.node,offset:entry.offsets[i]};
  if(entry.positions[i]===match.end-1)last={node:entry.node,offset:entry.offsets[i]+1};
 }
 if(!first||!last)return null;
 const range=(root.ownerDocument||root).createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);return range;
}
export function textFragmentUrl(value,raw){
 const anchor=normalizeWebAnchor(raw);let url;
 try{url=new URL(value);}catch{fail('原网页地址无效');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('原网页地址无效');
 if(anchor.textFragment===null)throw Object.assign(new Error('原网页中的文字不能唯一定位，请打开来源网页后使用扩展查看高亮。'),{code:'AMBIGUOUS_TEXT_FRAGMENT'});
 const encode=value=>encodeURIComponent(value).replace(/-/g,'%2D');
 url.hash='';
 const native=anchor.textFragment;
 const quote=native?`${encode(native.start)}${native.end?','+encode(native.end):''}`:anchor.exact.length>160?`${encode(fragmentHead(anchor.exact))},${encode(fragmentTail(anchor.exact))}`:encode(anchor.exact);
 const prefix=native?native.prefix:fragmentTail(anchor.prefix),suffix=native?native.suffix:fragmentHead(anchor.suffix);
 return `${url.href}#:~:text=${prefix?encode(prefix)+'-,':''}${quote}${suffix?',-'+encode(suffix):''}`;
}
