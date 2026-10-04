'use strict';
// Explicit, anonymous public-feed fetches. No cookie jar, credentials, background job or AI.
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {validatePublicUrl,isPublicAddress} = require('./web-capture.cjs');
const {publicDnsLookup} = require('./public-dns.cjs');
const {parseFragment} = require('./html-parser.cjs');
const MAX_BYTES = 2 * 1024 * 1024, MAX_ITEMS = 200, MAX_TEXT = 50000;
const fail = (message,code='FEED_CAPTURE_FAILED') => Object.assign(new Error(message),{code});
const tidy = value => String(value || '').replace(/\0/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const localName = name => name.split(':').at(-1).toLowerCase();

function xmlText(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_all,key)=>{
    if(key[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key.toLowerCase()];
    const point = key[1].toLowerCase()==='x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return point>0 && point<=0x10ffff && !(point>=0xd800 && point<=0xdfff) ? String.fromCodePoint(point) : '\ufffd';
  });
}

// Bounded XML subset for RSS/Atom: never expands entities or opens external resources.
function parseXml(value) {
  if(typeof value!=='string' || Buffer.byteLength(value)>MAX_BYTES)throw fail('订阅内容超过 2 MiB 上限。','FEED_TOO_LARGE');
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(value))throw fail('订阅含有不支持的 XML 文档类型或实体声明。','UNSAFE_XML');
  const document={name:'#document',attrs:{},children:[]},stack=[document];let cursor=0,nodes=0;
  const token=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w.:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g;
  for(const match of value.matchAll(token)) {
    const text=value.slice(cursor,match.index);
    if(text.includes('<'))throw fail('订阅 XML 格式不完整。','INVALID_FEED');
    if(text)stack.at(-1).children.push(xmlText(text));
    cursor=match.index+match[0].length;const tag=match[0];
    if(tag.startsWith('<!--')||tag.startsWith('<?'))continue;
    if(tag.startsWith('<![CDATA[')){stack.at(-1).children.push(tag.slice(9,-3));continue;}
    if(tag.startsWith('</')){const name=tag.slice(2,-1).trim();if(stack.length===1||stack.at(-1).name!==name)throw fail('订阅 XML 标签不匹配。','INVALID_FEED');stack.pop();continue;}
    const header=/^<([\w.:-]+)([\s\S]*?)\/?\s*>$/.exec(tag),attrs=Object.create(null);
    let rest=header[2],attribute;
    while(rest.trim()) {
      attribute=/^\s+([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if(!attribute||Object.hasOwn(attrs,attribute[1]))throw fail('订阅 XML 属性格式无效。','INVALID_FEED');
      attrs[attribute[1]]=xmlText(attribute[2]??attribute[3]);rest=rest.slice(attribute[0].length);
    }
    const node={name:header[1],attrs,children:[]};stack.at(-1).children.push(node);
    if(++nodes>50000||stack.length>64)throw fail('订阅 XML 层级或节点过多。','FEED_TOO_LARGE');
    if(!/\/\s*>$/.test(tag))stack.push(node);
  }
  const tail=value.slice(cursor);if(tail.includes('<')||stack.length!==1)throw fail('订阅 XML 未完整结束。','INVALID_FEED');
  if(tail.trim())document.children.push(xmlText(tail));
  const roots=document.children.filter(child=>typeof child!=='string');
  if(roots.length!==1||document.children.some(child=>typeof child==='string'&&child.replace(/^\ufeff/,'').trim()))throw fail('订阅必须包含一个有效的 RSS 或 Atom 根节点。','INVALID_FEED');
  return roots[0];
}
const children=(node,name)=>node.children.filter(child=>typeof child!=='string' && (!name||localName(child.name)===name.toLowerCase()));
const first=(node,name)=>children(node,name)[0];
const textOf=node=>node?node.children.map(child=>typeof child==='string'?child:textOf(child)).join(''):'';
const field=(node,name)=>tidy(textOf(first(node,name)));
function readable(value) {
  const root=parseFragment(String(value||'')),parts=[];
  const walk=node=>{if(['script','style','iframe','object','form','input'].includes(node.tagName)||node.attrs?.some(attr=>attr.name==='hidden'||attr.name==='aria-hidden'&&attr.value==='true'))return;if(node.nodeName==='#text')parts.push(node.value);for(const child of node.childNodes||[])walk(child);if(['p','div','br','li','blockquote','h1','h2','h3'].includes(node.tagName))parts.push('\n');};
  walk(root);return tidy(parts.join(''));
}
function publicLink(value,base) {if(!String(value||'').trim())return '';try{return validatePublicUrl(new URL(String(value||'').trim(),base).href).href;}catch{return '';}}
function baseFor(node,parent){return node.attrs['xml:base'] ? publicLink(node.attrs['xml:base'],parent)||parent : parent;}
const isoDate=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():'';};

function parseFeed(xml,feedUrl) {
  const url=validatePublicUrl(feedUrl).href,root=parseXml(xml),kind=localName(root.name),base=baseFor(root,url);
  const channel=['rss','rdf'].includes(kind)?first(root,'channel'):root;
  if(!channel||!['rss','rdf','feed'].includes(kind))throw fail('该链接没有提供 RSS 或 Atom 订阅内容。','INVALID_FEED');
  const atom=kind==='feed',feedBase=baseFor(channel,base);
  const atomLink=node=>children(node,'link').find(link=>!link.attrs.rel||link.attrs.rel==='alternate');
  const siteUrl=publicLink(atom?atomLink(channel)?.attrs.href:field(channel,'link'),feedBase);
  const title=readable(field(channel,'title')).slice(0,1000)||new URL(url).hostname;
  const description=readable(field(channel,atom?'subtitle':'description')).slice(0,MAX_TEXT);
  const entries=children(kind==='rdf'?root:channel,atom?'entry':'item'),items=[],seen=new Set(),warnings=[];
  if(entries.length>MAX_ITEMS)warnings.push(`本次只预览前 ${MAX_ITEMS} 条内容。`);
  for(const entry of entries.slice(0,MAX_ITEMS)) {
    const itemBase=baseFor(entry,feedBase),link=atom?atomLink(entry):first(entry,'link');
    let sourceUrl=publicLink(atom?link?.attrs.href:link&&textOf(link),baseFor(link||entry,itemBase));
    const enclosure=atom?children(entry,'link').find(value=>value.attrs.rel==='enclosure'):first(entry,'enclosure');
    const enclosureUrl=enclosure?publicLink(enclosure.attrs.url||enclosure.attrs.href,baseFor(enclosure,itemBase)):'';
    const enclosureType=String(enclosure?.attrs.type||'').split(';')[0].trim().toLowerCase().slice(0,100);
    if(enclosure&&!enclosureUrl)warnings.push('有一条附件链接不符合公开地址要求，已忽略。');
    const rawBody=field(entry,atom?'content':'encoded')||field(entry,atom?'summary':'description');
    const plainBody=readable(rawBody);if(plainBody.length>MAX_TEXT)warnings.push('部分条目正文已截取前 50000 字。');
    const body=plainBody.slice(0,MAX_TEXT),entryTitle=readable(field(entry,'title')).slice(0,1000)||body.slice(0,90)||'未命名条目';
    const rawId=field(entry,atom?'id':'guid');
    if(!sourceUrl && !atom && first(entry,'guid')?.attrs.isPermaLink!=='false')sourceUrl=publicLink(rawId,itemBase);
    if(!sourceUrl)sourceUrl=enclosureUrl||siteUrl||url;
    const id=crypto.createHash('sha256').update(url+'\n'+(rawId||sourceUrl+'\n'+entryTitle)).digest('hex');
    if(seen.has(id))continue;seen.add(id);
    const authorNode=first(entry,'author');
    const author=readable(field(entry,'creator')||(authorNode ? field(authorNode,'name')||textOf(authorNode):'')||field(channel,'author')).slice(0,1000);
    items.push({id,title:entryTitle,body,sourceTitle:title,sourceUrl,author,date:isoDate(field(entry,atom?'published':'pubDate')||field(entry,'updated')||field(entry,'date')),type:enclosureUrl&&enclosureType.startsWith('audio/')?'audio':enclosureUrl&&enclosureType.startsWith('video/')?'video':'article',enclosureUrl,enclosureType});
  }
  return {url,title,description,siteUrl,items,warnings:[...new Set(warnings)],fetchedAt:new Date().toISOString()};
}

function abortable(promise,signal){if(signal.aborted)return Promise.reject(signal.reason);return new Promise((resolve,reject)=>{const aborted=()=>reject(signal.reason);signal.addEventListener('abort',aborted,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));});}
async function resolvePublic(url,lookup,signal,trustedLookup) {
  const host=url.hostname.replace(/^\[|\]$/g,'');if(net.isIP(host))return [{address:host,family:net.isIP(host)}];
  let records=await abortable(lookup(host,{all:true,verbatim:true}),signal);
  if(Array.isArray(records)&&records.length&&records.every(record=>record.family===4&&/^198\.(?:18|19)\./.test(record.address)&&net.isIP(record.address)===4))records=await abortable(trustedLookup(host,{signal}),signal);
  if(!Array.isArray(records)||!records.length||records.some(record=>!isPublicAddress(record.address)||net.isIP(record.address)!==record.family))throw fail('订阅域名指向本机、内网或保留地址，已停止读取。','PRIVATE_ADDRESS');
  return records;
}
function requestFeed(url,addresses,{signal,maxBytes=MAX_BYTES}={}) {
  return new Promise((resolve,reject)=>{
    let settled=false;const done=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};
    const request=(url.protocol==='https:'?https:http).request(url,{method:'GET',agent:false,signal,maxHeaderSize:16384,headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/plain;q=0.5','Accept-Encoding':'gzip, deflate, br','User-Agent':'Mengcang-PublicFeed/1.0'},lookup(_host,options,callback){const address=addresses[0];options.all?callback(null,[address]):callback(null,address.address,address.family);}},response=>{
      const status=response.statusCode||0;
      if([301,302,303,307,308].includes(status)){response.destroy();done(null,{status,location:response.headers.location});return;}
      if(status<200||status>=300){response.destroy();done(fail(`订阅返回 HTTP ${status}，请确认这是可公开访问的订阅地址。`,'HTTP_STATUS'));return;}
      const contentType=String(response.headers['content-type']||'').toLowerCase();
      if(contentType&&!/^(?:application\/(?:rss\+xml|atom\+xml|xml|rdf\+xml)|text\/(?:xml|plain))(?:;|$)/.test(contentType)){response.destroy();done(fail('该地址不是 RSS 或 Atom 订阅，请填写网站提供的订阅链接。','UNSUPPORTED_CONTENT'));return;}
      if(Number(response.headers['content-length'])>maxBytes){response.destroy();done(fail('订阅内容超过 2 MiB 上限。','FEED_TOO_LARGE'));return;}
      const encoding=String(response.headers['content-encoding']||'identity').toLowerCase(),decoder=encoding==='gzip'?zlib.createGunzip():encoding==='deflate'?zlib.createInflate():encoding==='br'?zlib.createBrotliDecompress():null;
      if(!decoder&&encoding!=='identity'){response.destroy();done(fail('订阅压缩格式暂不支持。','UNSUPPORTED_CONTENT'));return;}
      let wireBytes=0,bytes=0;const chunks=[],stop=error=>{decoder?.destroy();response.destroy();request.destroy();done(error);};
      response.on('data',chunk=>{wireBytes+=chunk.length;if(wireBytes>maxBytes)stop(fail('订阅内容超过 2 MiB 上限。','FEED_TOO_LARGE'));});
      const input=decoder?response.pipe(decoder):response;
      input.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)stop(fail('订阅解压后超过 2 MiB 上限。','FEED_TOO_LARGE'));else chunks.push(chunk);});
      input.on('error',()=>stop(fail('订阅内容传输不完整，请重试。','INVALID_RESPONSE')));
      if(decoder)response.on('error',()=>stop(fail('订阅内容传输不完整，请重试。','INVALID_RESPONSE')));
      response.on('aborted',()=>stop(fail('订阅连接提前结束，请重试。','INVALID_RESPONSE')));
      input.on('end',()=>done(null,{status,contentType,bytes:Buffer.concat(chunks)}));
    });
    request.on('error',()=>done(signal?.aborted?signal.reason:fail('订阅连接失败，请检查网络与地址。','NETWORK_ERROR')));request.end();
  });
}
function createFeedCapture({lookup=dns.lookup.bind(dns),request=requestFeed,trustedLookup=publicDnsLookup,timeoutMs=12000}={}) {
  return async function capture(value) {
    let url=validatePublicUrl(value);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(fail('读取订阅超时，请稍后重试。','CAPTURE_TIMEOUT')),timeoutMs);
    try{for(let hop=0;hop<=4;hop++){
      const addresses=await resolvePublic(url,lookup,controller.signal,trustedLookup),result=await abortable(request(url,addresses,{signal:controller.signal,maxBytes:MAX_BYTES}),controller.signal);
      if([301,302,303,307,308].includes(result.status)){if(!result.location||hop===4)throw fail('订阅重定向次数过多或目标无效。','REDIRECT_LIMIT');url=validatePublicUrl(new URL(result.location,url).href);continue;}
      if(!Buffer.isBuffer(result.bytes)||result.bytes.length>MAX_BYTES)throw fail('订阅内容超过 2 MiB 上限。','FEED_TOO_LARGE');
      const header=result.bytes.subarray(0,200).toString('latin1'),charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(result.contentType||'')?.[1]||/<\?xml[^>]*encoding=["']([^"']+)/i.exec(header)?.[1]||'utf-8';
      let xml;try{xml=new TextDecoder(charset).decode(result.bytes);}catch{throw fail('订阅文字编码暂不支持。','INVALID_ENCODING');}
      return parseFeed(xml,url.href);
    }}finally{clearTimeout(timer);}
  };
}
module.exports={captureFeed:createFeedCapture(),createFeedCapture,parseFeed,requestFeed,MAX_BYTES,MAX_ITEMS,MAX_TEXT};
