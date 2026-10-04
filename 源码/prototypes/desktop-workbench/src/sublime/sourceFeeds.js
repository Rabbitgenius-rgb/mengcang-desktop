import {dedupeImports} from '../discoveryModel.js';

export const MAX_CLIP_BYTES=512*1024;
export function publicSourceUrl(value){
  const url=new URL(String(value||'').trim());
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw Error('请使用不含账号密码、采用标准端口的公开 HTTP 或 HTTPS 链接。');
  const host=url.hostname.toLowerCase();
  if(!host.includes('.')||/(?:^|\.)(?:localhost|local|internal|lan|home|onion|test|invalid)$/.test(host)||host.startsWith('[')||/^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./.test(host))throw Error('不能保存本机或内网订阅地址。');
  for(const key of url.searchParams.keys())if(/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-signature|x-goog-signature)$/i.test(key))throw Error('链接含有凭证参数，请使用公开链接。');
  url.hash='';return url.href;
}

export function normalizeFeeds(value){
  if(!Array.isArray(value))return [];
  const seen=new Set();return value.slice(0,100).flatMap(feed=>{
    try{const url=publicSourceUrl(feed.url);if(seen.has(url))return [];seen.add(url);return [{url,title:String(feed.title||new URL(url).hostname).slice(0,1000),lastChecked:String(feed.lastChecked||'').slice(0,100),itemCount:Number.isSafeInteger(feed.itemCount)&&feed.itemCount>=0?feed.itemCount:0}];}catch{return [];}
  });
}
export function feedRecords(feed){
  if(!feed||!Array.isArray(feed.items))throw Error('订阅返回的数据无效。');
  return feed.items.slice(0,200).map(item=>{
    const enclosure=item.enclosureUrl?publicSourceUrl(item.enclosureUrl):'';
    return {title:String(item.title||'未命名条目').slice(0,1000),body:String(item.body||'').slice(0,50000)+(enclosure?`\n\n[${item.type==='video'?'视频':'音频或附件'}原文件](${enclosure})`:''),sourceTitle:String(item.sourceTitle||feed.title||'').slice(0,1000),sourceUrl:publicSourceUrl(item.sourceUrl||feed.url),author:String(item.author||'').slice(0,1000),date:String(item.date||'').slice(0,100),type:['audio','video'].includes(item.type)?item.type:'article',sourceLocation:`订阅条目:${String(item.id||'').slice(0,100)}`};
  });
}
export function pendingFeedRecords(records,existingCards=[]){
  const known=new Set(existingCards.map(card=>card.sourceLocation).filter(value=>value?.startsWith('订阅条目:'))),seen=new Set();
  const fresh=records.filter(record=>!known.has(record.sourceLocation)&&!seen.has(record.sourceLocation)&&(seen.add(record.sourceLocation),true));
  const result=dedupeImports(fresh,existingCards);return {items:result.items,duplicates:records.length-result.items.length};
}
export function parseWebClip(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_CLIP_BYTES)throw Error('剪藏文件不能超过 512 KiB。');
  let value;try{value=JSON.parse(text);}catch{throw Error('无法读取剪藏文件，请使用梦藏剪藏书签导出的 JSON。');}
  if(value?.format!=='mengcang-web-clip'||value.schema!==1||!Array.isArray(value.items)||!value.items.length||value.items.length>50)throw Error('不是受支持的梦藏剪藏文件。');
  return value.items.map(item=>{
    if(!item||typeof item!=='object')throw Error('剪藏条目格式无效。');
    const body=String(item.body||'');if(!body.trim()||body.length>50000)throw Error('剪藏正文应为 1–50000 字。');
    const sourceUrl=publicSourceUrl(item.sourceUrl);
    return {title:String(item.title||sourceUrl).slice(0,1000),body,sourceUrl,sourceTitle:String(item.sourceTitle||new URL(sourceUrl).hostname).slice(0,1000),author:String(item.author||'').slice(0,1000),caption:String(item.caption||'').slice(0,50000),type:item.type==='highlight'?'highlight':'article',date:typeof item.date==='string'&&Number.isFinite(Date.parse(item.date))?new Date(item.date).toISOString():''};
  });
}

// Runs only when the user invokes their bookmark. It reads visible page text,
// opens an editable local preview, then exports a file after a second click.
function bookmarkCapture(){
  const selected=String(window.getSelection?.()||''),main=document.querySelector('article')||document.querySelector('main')||document.body;
  const rawBody=selected.trim()?selected:main?.innerText||'',body=rawBody.slice(0,50000);
  if(!body.trim()){window.alert('此页面没有可剪藏的文字，请先选中需要的段落。');return;}
  if(document.getElementById('mengcang-clip-preview'))return;
  const host=document.createElement('div');host.id='mengcang-clip-preview';host.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0009;display:grid;place-items:center';
  const shadow=host.attachShadow({mode:'closed'}),box=document.createElement('section');box.style.cssText='background:#252a2e;color:#eef0f2;border:1px solid #58616a;padding:24px;border-radius:20px;font:15px system-ui;max-width:620px;width:calc(100vw - 64px);box-sizing:border-box';
  const title=document.createElement('h2');title.textContent='保存到梦藏';title.style.margin='0 0 12px';
  const hint=document.createElement('p');hint.textContent=(rawBody.length>50000?'正文已截取前 50000 字。':'')+'确认或修改要保存的文字后，下载剪藏文件，再回梦藏导入。仅保存下方文字与当前网址。';
  const input=document.createElement('textarea');input.value=body;input.setAttribute('aria-label','剪藏正文');input.style.cssText='box-sizing:border-box;width:100%;height:45vh;background:#181b1e;color:#eef0f2;border:1px solid #58616a;padding:12px;border-radius:10px;font:15px/1.5 system-ui';
  const save=document.createElement('button');save.textContent='下载剪藏文件';save.style.cssText='padding:10px 16px;border:0;border-radius:12px;background:#b8efc4;color:#13251b;margin:14px 12px 0 0;cursor:pointer';
  const close=document.createElement('button');close.textContent='取消';close.style.cssText='padding:10px 16px;border:1px solid #69747f;border-radius:12px;background:transparent;color:inherit;cursor:pointer';close.onclick=()=>host.remove();
  save.onclick=()=>{
    const text=input.value;if(!text.trim()||text.length>50000){window.alert('请选择 1–50000 字正文。');return;}
    const source=new URL(location.href);if(!['http:','https:'].includes(source.protocol)||source.username||source.password){window.alert('请在不含账号密码的公开网页使用剪藏。');return;}
    for(const key of source.searchParams.keys())if(/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-signature|x-goog-signature)$/i.test(key)){window.alert('当前网址含有凭证参数，请先打开公开链接。');return;}
    source.hash='';const data={format:'mengcang-web-clip',schema:1,items:[{title:document.title,body:text,sourceUrl:source.href,sourceTitle:source.hostname,type:selected.trim()?'highlight':'article',date:new Date().toISOString()}]};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='梦藏-网页剪藏.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);host.remove();
  };
  box.append(title,hint,input,save,close);shadow.append(box);document.documentElement.append(host);input.focus();
}
export const WEB_CLIP_BOOKMARKLET='javascript:('+bookmarkCapture.toString()+')();';
export function bookmarkInstallerHtml(){
  const escaped=WEB_CLIP_BOOKMARKLET.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>梦藏网页剪藏</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{max-width:680px;margin:12vh auto;padding:24px;background:#151719;color:#ddd;font:17px/1.8 system-ui}a{display:inline-block;background:#b8efc4;color:#14251c;padding:12px 24px;border-radius:28px;text-decoration:none}li{margin:12px 0}</style><h1>梦藏网页剪藏</h1><p>将下方按钮拖到浏览器书签栏。</p><a href="${escaped}">保存到梦藏</a><ol><li>在目标网页选中文字，再点击书签；未选择时提取文章或页面可见文字。</li><li>检查并编辑预览内容，点击“下载剪藏文件”。</li><li>在梦藏的“来源订阅与剪藏”中导入文件，核对后保存。</li></ol><p>剪藏不读取 Cookie、密码字段或浏览器账号；不会向外部服务发送内容。部分网站会限制书签脚本，此时可手动复制文字到梦藏。</p></html>`;
}
