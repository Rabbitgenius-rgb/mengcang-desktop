import {safeSourceUrl,normalizeWorkspaceAttachment,selectCards} from './workspaceModel.js';
export {cardIdentityMetadata,createCardIdentityContext} from './cardIdentity.js';

// Reading-only projections. Never rewrite the archived note or persist inferred relations.
export function noteReadingSections(body='') {
 const main=[],archive=[];let archival=false,fence=false;
 for(const line of String(body).split('\n')){
  if(/^\s*```/.test(line))fence=!fence;
  if(!fence&&/^##\s+/.test(line))archival=/^##\s+收录授权原话\s*$/.test(line);
  (archival?archive:main).push(line);
 }
 return {body:main.join('\n').trim(),archive:archive.join('\n').trim()};
}

function trimPlainUrl(value) {
 const pairs=new Map([[')','('],[']','['],['}','{'],['）','（']]),balance=new Map();
 for(const character of value)for(const [close,open] of pairs){if(character===close)balance.set(close,(balance.get(close)||0)+1);else if(character===open)balance.set(close,(balance.get(close)||0)-1);}
 let end=value.length;
 while(end){const last=value[end-1];if(/[.,;]/.test(last)){end--;continue;}if((balance.get(last)||0)>0){balance.set(last,balance.get(last)-1);end--;continue;}break;}
 return value.slice(0,end);
}

function textNoteLinks(text,withLabelOrigin=false) {
 const result=[],seen=new Set();
 const add=(kind,target,label,namedLabel=false)=>{if(!target)return;const key=kind+':'+target;if(seen.has(key))return;seen.add(key);result.push({kind,target,label:label||target,...(withLabelOrigin&&kind==='external'?{namedLabel}: {})});};
 // Balanced delimiters, indexed once; malformed long notes remain linear.
 const ends=new Map(),stack=[],plainCandidates=[],excluded=[];let fence='',fenceLength=0,inlineTicks=0;
 for(let i=0;i<text.length;i++){
  if(i===0||text[i-1]==='\n'){
   const lineEnd=text.indexOf('\n',i),end=lineEnd<0?text.length:lineEnd,line=text.slice(i,end),marker=/^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
   if(marker&&!fence){fence=marker[1][0];fenceLength=marker[1].length;stack.length=0;inlineTicks=0;i=end;continue;}
   if(fence){if(marker&&marker[1][0]===fence&&marker[1].length>=fenceLength&&!marker[2].trim())fence='';stack.length=0;i=end;continue;}
  }
  const c=text[i];if(c==='\\'){i++;continue;}
  if(c==='`'){let end=i+1;while(text[end]==='`')end++;const length=end-i;if(!inlineTicks)inlineTicks=length;else if(inlineTicks===length)inlineTicks=0;i=end-1;continue;}
  if(c==='\n'){stack.length=0;inlineTicks=0;continue;}if(inlineTicks)continue;
  if((c==='h'||c==='H')&&/^https?:\/\//i.test(text.slice(i,i+8)))plainCandidates.push(i);
  if(c==='['||c==='(')stack.push(i);
  else if((c===']'||c===')')&&stack.length){const start=stack[stack.length-1];if((text[start]==='['&&c===']')||(text[start]==='('&&c===')')){stack.pop();ends.set(start,i);}}
 }
 for(let i=0;i<text.length;i++){
  const end=ends.get(i);if(text[i]!=='['||end===undefined)continue;
  const embedded=text[i-1]==='!'&&text[i-2]!=='\\';
  if(text[i+1]==='['&&text[end-1]===']'){
   const [target,label]=text.slice(i+2,end-1).split('|');
   if(!embedded)add('internal',target.trim(),label||target.split('/').pop().replace(/\.md$/i,''));excluded.push([i,end+1]);i=end;continue;
  }
  const urlEnd=ends.get(end+1);
  if(text[end+1]==='('&&urlEnd!==undefined){const url=safeSourceUrl(text.slice(end+2,urlEnd).replace(/\\([()*])/g,'$1'));if(!embedded&&url)add('external',url,text.slice(i+1,end).replace(/\*+/g,''),true);excluded.push([i,urlEnd+1]);i=urlEnd;}
 }
 // Plain URLs share the same safety and deduplication rules as named links.
 // Candidate positions exclude code; ranges exclude images and link syntax.
 const plain=/https?:\/\/[^\s<>"'`，。；！？、「」『』【】《》]+/iy;let range=0,consumed=0;
 for(const start of plainCandidates){
  while(range<excluded.length&&excluded[range][1]<=start)range++;
  if(start<consumed||excluded[range]&&excluded[range][0]<=start||/[\w/@]/.test(text[start-1]||'')||/(?:javascript|data|blob):$/i.test(text.slice(Math.max(0,start-16),start)))continue;
  plain.lastIndex=start;const match=plain.exec(text);if(!match)continue;consumed=plain.lastIndex;
  const url=safeSourceUrl(trimPlainUrl(match[0]));if(url)add('external',url,new URL(url).hostname);
 }
 return result;
}

function collectNoteLinks(card,withLabelOrigin=false) {
 const result=textNoteLinks(String(card.body||''),withLabelOrigin),seen=new Set(result.map(link=>link.kind+':'+link.target));
 const add=link=>{const key=link.kind+':'+link.target;if(!seen.has(key)){seen.add(key);result.push(link);}};
 const source=safeSourceUrl(card.sourceUrl);if(source)add({kind:'external',target:source,label:card.sourceTitle||new URL(source).hostname,...(withLabelOrigin?{namedLabel:!!card.sourceTitle}: {})});
 const figureUrl=safeSourceUrl(card.articleFigure?.imageUrl);if(figureUrl)add({kind:'external',target:figureUrl,label:'图片原址',...(withLabelOrigin?{namedLabel:true}: {})});
 // Saved extraction is read-only. Parse fields separately so an unfinished code
 // block cannot hide another field's links; recognized brackets are not relations.
 const extracted=[card.ocrText,card.documentIndex?.text,...(Array.isArray(card.documentIndex?.pages)?card.documentIndex.pages.map(page=>page?.text):[])];
 for(const text of new Set(extracted.filter(value=>typeof value==='string'&&value))){
  for(const link of textNoteLinks(text,withLabelOrigin))if(link.kind==='external')add(link);
 }
 return result;
}
export function noteLinks(card={}) {return collectNoteLinks(card);}

// Display metadata stays separate from the shared source inventory used by AI
// prompts and exports. Page attribution comes only from saved per-page text.
export function noteLinkPresentation(card={}) {
 const pagesByUrl=new Map();
 for(const page of Array.isArray(card.documentIndex?.pages)?card.documentIndex.pages:[]){
  if(!Number.isSafeInteger(page?.page)||page.page<1)continue;
  for(const link of textNoteLinks(String(page.text||''))){
   if(link.kind!=='external')continue;
   if(!pagesByUrl.has(link.target))pagesByUrl.set(link.target,new Set());
   pagesByUrl.get(link.target).add(page.page);
  }
 }
 return collectNoteLinks(card,true).map(({namedLabel,...link})=>{
  if(link.kind!=='external')return link;
  const url=new URL(link.target),pages=[...(pagesByUrl.get(link.target)||[])].sort((a,b)=>a-b);
  let path=url.pathname;try{path=decodeURI(path);}catch{/* Preserve malformed escapes verbatim. */}
  // A hostname-only fallback cannot distinguish two sources on the same site.
  const label=!namedLabel?url.host+(path==='/'?'':path)+url.search+url.hash:link.label;
  const pageLabel=pages.length?`第 ${pages.join('、')} 页`:'';
  return {...link,label,pages,description:[pageLabel,link.target].filter(Boolean).join(' · ')};
 });
}

export function resolveNoteReference(target,cards=[],current={}) {
 const raw=String(target).split('#')[0].trim(),normalize=value=>String(value||'').normalize('NFC').replace(/^\.\//,'').replace(/\.md$/i,'');
 if(!raw||/^(?:[a-z]+:|\/|\\)/i.test(raw))return {status:'missing',matches:[]};
 const key=normalize(raw),folder=String(current.path||current.id||'').split('/').slice(0,-1).join('/');
 const byPath=cards.filter(card=>[normalize(card.path),normalize(card.id)].includes(key));
 const relative=!byPath.length&&folder?cards.filter(card=>normalize(card.path||card.id)===normalize(folder+'/'+raw)):[];
 const byName=!byPath.length&&!relative.length&&!key.includes('/')?cards.filter(card=>normalize(String(card.path||card.id).split('/').pop())===key||normalize(card.title)===key):[];
 const matches=[...new Map([...byPath,...relative,...byName].map(card=>[card.id,card])).values()];
 return {status:matches.length===1?'resolved':matches.length?'ambiguous':'missing',matches};
}

export function copyDraftTitle(value,fallback='草稿'){
 const title=typeof value==='string'&&value.trim()?value.trim():fallback,suffix=' · 副本';
 let prefix=title.slice(0,1000-suffix.length);if(/[\uD800-\uDBFF]$/.test(prefix))prefix=prefix.slice(0,-1);
 return prefix+suffix;
}
export function recoveredBoardCopy(value,id,collections){
 return {...value,id,title:copyDraftTitle(value.title,'画布'),collectionId:collections.some(collection=>collection.id===value.collectionId)?value.collectionId:''};
}

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function selectWorkspaceCards(cards,state,{filters={},route={},shuffle=0,readOnlySavedIds=[]}={}) {
 let result=selectCards(cards,state,{...filters,media:filters.media==='All'?'':filters.media,hidden:route.page==='trash'?true:undefined,collectionId:route.page==='collection'?route.id:undefined,inLibrary:route.page==='library'||filters.inLibrary?true:undefined,favorite:route.page==='favorites'||filters.favorite?true:undefined},readOnlySavedIds);
 if(route.page==='following')result=result.filter(card=>(state.drafts.followingSources||[]).includes(card.sourceUrl));
 if(shuffle){const score=id=>[...id].reduce((sum,c)=>(sum*31+c.charCodeAt(0)+shuffle)%997,0);result=[...result].sort((a,b)=>score(a.id)-score(b.id));}
 if(filters.sort==='popular'||filters.sort==='least'){
  const favoriteIds=new Set(state.favoriteIds);
  result=[...result].sort((a,b)=>((favoriteIds.has(b.id)?1:0)-(favoriteIds.has(a.id)?1:0))*(filters.sort==='least'?-1:1));
 }
 if(filters.sort==='old-updated')result=[...result].sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
 return result;
}
export function filterWorkspaceGroups(groups, query='', {shuffle=0,pinned=false}={}) {
  const terms=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const score=id=>[...String(id)].reduce((sum,c)=>(sum*31+c.charCodeAt(0)+shuffle)%997,0);
  return groups.filter(group=>terms.every(term=>[group.title,group.description].filter(Boolean).join(' ').toLocaleLowerCase().includes(term))).sort((a,b)=>{
    if(pinned&&Boolean(a.pinned)!==Boolean(b.pinned))return Number(Boolean(b.pinned))-Number(Boolean(a.pinned));
    return shuffle?score(a.id)-score(b.id):0;
  });
}
export function cardCapturePayload(card, {operationId,caption,includeAttachment=false}={}) {
  const rawPage=String(card.page??'').trim(),numericPage=/^\d+$/.test(rawPage)?Number(rawPage):null;
  const page=Number.isSafeInteger(numericPage)&&numericPage>0&&numericPage<=1000000?numericPage:null;
  const sourceLocation=[page===null&&rawPage?`Page ${rawPage}`:'',card.sourceLocation||''].filter(Boolean).join(' · ');
  return {operationId,title:card.title,body:card.body||'',caption:caption??card.caption??'',sourceUrl:safeSourceUrl(card.sourceUrl),sourceTitle:card.sourceTitle||'',author:card.author||'',page,sourceLocation,importFingerprint:card.importFingerprint||'',tags:card.tags||[],...(includeAttachment&&card.attachment?{attachment:normalizeWorkspaceAttachment(card.attachment)}:{})};
}
export function buildOfflineCardHTML(card,{includeNote=false,includeAttachment=true}={}) {
  const title=escapeHTML(card.title||'未命名卡片'),source=safeSourceUrl(card.sourceUrl),attachment=includeAttachment?card.attachment:null;
  const image=/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(card.image||'')?card.image:'';
  const metadata=[card.sourceTitle,card.author,card.page?`第 ${card.page} 页`:'',card.sourceLocation].filter(Boolean).map(escapeHTML).join(' · ');
  const attachmentSafe=attachment&&/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(attachment.dataUrl||'');
  const media=attachmentSafe&&/^(audio|video)\//.test(attachment.type)?`<${attachment.type.startsWith('video')?'video':'audio'} controls preload="metadata" src="${escapeHTML(attachment.dataUrl)}"></${attachment.type.startsWith('video')?'video':'audio'}>`:'';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'"><title>${title}</title><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#111;color:#b1bac4;font:17px/1.65 system-ui,sans-serif}main{max-width:780px;margin:8vh auto;padding:28px}article{background:#21262d;border-radius:16px;padding:28px}h1{font-size:25px;font-weight:500;margin:0 0 20px}p{white-space:pre-wrap;overflow-wrap:anywhere}img,video{display:block;max-width:100%;max-height:70vh;margin:20px auto}audio{width:100%}a{color:#71c9f9;overflow-wrap:anywhere}small{color:#8b949e}.note{border-top:1px solid #444;padding-top:20px;margin-top:25px}.attachment{display:block;margin-top:22px}@media(max-width:500px){main{padding:16px;margin:24px auto}article{padding:20px}}</style></head><body><main><article><h1>${title}</h1>${image?`<img src="${image}" alt="${title}">`:''}${card.body?`<p>${escapeHTML(card.body)}</p>`:''}${media}${metadata?`<small>${metadata}</small>`:''}${source?`<p><a href="${escapeHTML(source)}" target="_blank" rel="noopener noreferrer">查看原始来源</a></p>`:''}${includeNote&&card.caption?`<div class="note"><small>附记</small><p>${escapeHTML(card.caption)}</p></div>`:''}${attachmentSafe?`<a class="attachment" href="${escapeHTML(attachment.dataUrl)}" download="${escapeHTML(attachment.name)}">下载附件 · ${escapeHTML(attachment.name)}</a>`:''}</article><p><small>梦藏 · 离线卡片。正文与所选附件包含在此文件中，无需登录。</small></p></main></body></html>`;
}
