import {safeSourceUrl,normalizeWorkspaceAttachment,selectCards} from './workspaceModel.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function selectWorkspaceCards(cards,state,{filters={},route={},shuffle=0}={}) {
 let result=selectCards(cards,state,{...filters,media:filters.media==='All'?'':filters.media,hidden:route.page==='trash'?true:undefined,collectionId:route.page==='collection'?route.id:undefined,inLibrary:route.page==='library'||filters.inLibrary?true:undefined,favorite:route.page==='favorites'||filters.favorite?true:undefined});
 if(route.page==='following')result=result.filter(card=>(state.drafts.followingSources||[]).includes(card.sourceUrl));
 if(shuffle){const score=id=>[...id].reduce((sum,c)=>(sum*31+c.charCodeAt(0)+shuffle)%997,0);result=[...result].sort((a,b)=>score(a.id)-score(b.id));}
 if(filters.sort==='popular'||filters.sort==='least')result=[...result].sort((a,b)=>((state.favoriteIds.includes(b.id)?1:0)-(state.favoriteIds.includes(a.id)?1:0))*(filters.sort==='least'?-1:1));
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
