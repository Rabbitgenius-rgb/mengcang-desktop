'use strict';
// Opt-in anonymous public HTML capture. No browser profile, cookies, AI, or Vault access.
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const {parse} = require('./html-parser.cjs');
const {publicDnsLookup} = require('./public-dns.cjs');
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 50000;
const TIMEOUT_MS = 12000;
const fail = (message, code = 'WEB_CAPTURE_FAILED') => Object.assign(new Error(message), {code});

function isPublicAddress(input) {
  const ip = String(input || '').replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    // Only native global unicast; excludes mapped IPv4, NAT64, local, multicast,
    // documentation, protocol assignments, Teredo, and 6to4 transition addresses.
    const groups = ip.split(':');
    const first = parseInt(groups[0], 16), second = parseInt(groups[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) && !(first === 0x3fff && second <= 0x0fff);
  }
  return false;
}

function validatePublicUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw fail('链接格式无效。', 'INVALID_URL');
  let url;
  try { url = new URL(value); } catch { throw fail('请填写完整的 HTTP 或 HTTPS 网页链接。', 'INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw fail('仅支持标准端口、不含账号密码的公开 HTTP 或 HTTPS 链接。', 'INVALID_URL');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || /(?:^|\.)(?:localhost|local|internal|home|lan|onion|invalid|test)$/.test(host) || (!net.isIP(host) && !host.includes('.')) || net.isIP(host) && !isPublicAddress(host)) throw fail('不能采集本机、内网或保留地址。', 'PRIVATE_ADDRESS');
  // Credential-like query strings are deliberately not sent to remote services.
  for (const key of url.searchParams.keys()) if (/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-signature|x-goog-signature)$/i.test(key)) throw fail('链接含有凭证参数，请使用网页的公开链接。', 'CREDENTIAL_URL');
  url.hash = '';
  return url;
}

async function resolvePublic(url, lookup, signal, trustedLookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return [{address:host, family:net.isIP(host)}];
  let records = await abortable(lookup(host, {all:true, verbatim:true}), signal);
  // Proxy DNS commonly supplies 198.18/15 synthetic addresses. Never connect to
  // those addresses: resolve this exact hostname with the fixed public resolver,
  // then apply the same public-address checks and pin its answer to the socket.
  const fakeAddress=record=>record.family===4 && /^198\.(?:18|19)\./.test(record.address) && net.isIP(record.address)===4;
  if(Array.isArray(records) && records.length && records.every(fakeAddress)) records=await abortable(trustedLookup(host,{signal}),signal);
  if (!Array.isArray(records) || !records.length || records.some(record => !isPublicAddress(record.address) || net.isIP(record.address) !== record.family)) throw fail('网页域名指向本机、内网或保留地址，已停止采集。', 'PRIVATE_ADDRESS');
  return records;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve,reject) => {
    const onAbort = () => { reject(signal.reason); };
    signal.addEventListener('abort', onAbort, {once:true});
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function requestPage(url, addresses, {signal, maxBytes = MAX_BYTES} = {}) {
  return new Promise((resolve,reject) => {
    let settled = false;
    const done = (error,value) => { if (settled) return; settled = true; error ? reject(error) : resolve(value); };
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method:'GET', agent:false, signal, maxHeaderSize:16384,
      headers:{Accept:'text/html, application/xhtml+xml, text/plain;q=0.8', 'Accept-Encoding':'gzip, deflate, br', 'User-Agent':'Mengcang-PublicCapture/1.0'},
      // Connect only to this validated DNS result; never resolve a second time.
      lookup(_hostname, options, callback) { const address = addresses[0]; options.all ? callback(null,[address]) : callback(null,address.address,address.family); }
    }, response => {
      const status = response.statusCode || 0;
      if ([301,302,303,307,308].includes(status)) { const location = response.headers.location; response.destroy(); done(null,{status, location}); return; }
      if (status < 200 || status >= 300) { response.destroy(); done(fail(`网页返回 HTTP ${status}；需要登录或被网站限制的内容请手动保存。`, 'HTTP_STATUS')); return; }
      const type = String(response.headers['content-type'] || '').toLowerCase();
      if (!/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/.test(type)) { response.destroy(); done(fail('该链接不是可采集的网页文字；文件请通过文件入口导入。', 'UNSUPPORTED_CONTENT')); return; }
      if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); done(fail('网页超过 2 MiB 采集上限，请手动选择需要保存的段落。', 'PAGE_TOO_LARGE')); return; }
      const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
      const decoder = encoding === 'gzip' ? zlib.createGunzip() : encoding === 'deflate' ? zlib.createInflate() : encoding === 'br' ? zlib.createBrotliDecompress() : null;
      if (!decoder && encoding !== 'identity') { response.destroy(); done(fail('网页压缩格式暂不支持，请手动粘贴正文。', 'UNSUPPORTED_CONTENT')); return; }
      let bytes = 0, wireBytes = 0; const chunks = [];
      const stop = error => { decoder?.destroy(); response.destroy(); request.destroy(); done(error); };
      response.on('data', chunk => {wireBytes += chunk.length;if(wireBytes > maxBytes) stop(fail('网页超过 2 MiB 采集上限。', 'PAGE_TOO_LARGE'));});
      const input = decoder ? response.pipe(decoder) : response;
      input.on('data', chunk => {bytes += chunk.length;if(bytes > maxBytes) stop(fail('网页解压后超过 2 MiB 采集上限，请手动保存段落。', 'PAGE_TOO_LARGE'));else chunks.push(chunk);});
      input.on('error', () => stop(fail('网页内容传输不完整，请重试。', 'INVALID_RESPONSE')));
      if (decoder) response.on('error', () => stop(fail('网页内容传输不完整，请重试。', 'INVALID_RESPONSE')));
      response.on('aborted', () => stop(fail('网页连接提前结束，请重试。', 'INVALID_RESPONSE')));
      input.on('end', () => done(null,{status,contentType:type,bytes:Buffer.concat(chunks)}));
    });
    request.on('error', error => done(signal?.aborted ? signal.reason : fail(error.code === 'ENOTFOUND' ? '找不到网页域名，请检查链接。' : '网页连接失败，请检查网络或手动保存内容。', 'NETWORK_ERROR')));
    request.end();
  });
}

function decodePage(bytes, contentType) {
  const early = bytes.subarray(0,4096).toString('latin1');
  const charset = /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1] || /<meta[^>]+charset\s*=\s*["']?([^\s;"'>]+)/i.exec(early)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { throw fail('网页字符编码暂不支持，请手动粘贴正文。', 'UNSUPPORTED_ENCODING'); }
}

const SKIP = new Set(['script','style','noscript','template','svg','canvas','nav','header','footer','aside','form','button','input','select','textarea']);
const BLOCK = new Set(['p','div','section','article','main','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','br','hr','tr','table']);
const attrs = node => Object.fromEntries((node.attrs || []).map(attribute => [attribute.name,attribute.value]));
const tidy = value => value.replace(/[\t\f\v \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
function nodeText(root) {
  const stack = [root], parts = []; let size = 0;
  while (stack.length && size < MAX_BYTES) {
    const node = stack.pop();
    if (typeof node === 'string') {parts.push(node);size += node.length;continue;}
    if (node.nodeName === '#text') {parts.push(node.value);size += node.value.length;continue;}
    const attributes = attrs(node);
    if (SKIP.has(node.tagName) || Object.hasOwn(attributes,'hidden') || attributes['aria-hidden'] === 'true' || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style || '')) continue;
    if (BLOCK.has(node.tagName)) {parts.push('\n');stack.push('\n');}
    for (let index=(node.childNodes || []).length-1;index>=0;index--) stack.push(node.childNodes[index]);
  }
  return tidy(parts.join(''));
}

function extractPage(html, finalUrl, contentType = 'text/html') {
  const url = validatePublicUrl(finalUrl);
  if (contentType.startsWith('text/plain')) { const body = String(html).trim(); if (!body) throw fail('网页没有可采集的文字。','EMPTY_CONTENT');return {title:url.hostname,body:body.slice(0,MAX_TEXT),sourceTitle:url.hostname,sourceUrl:url.href,author:'',truncated:body.length>MAX_TEXT,warnings:body.length>MAX_TEXT?['正文已截取前 50000 字，可另存剩余段落。']:[]}; }
  const document = parse(String(html));
  const stack = [{node:document,insideContent:false}], meta = {}, roots = []; let title='', heading='', bodyRoot;
  while (stack.length) {
    const {node,insideContent}=stack.pop(), attributes=attrs(node);
    if (node.tagName === 'meta') {const key=(attributes.property || attributes.name || '').toLowerCase();if (key && !meta[key]) meta[key]=attributes.content || '';}
    if (node.tagName === 'title' && !title) title=nodeText(node);
    if (node.tagName === 'h1' && !heading) heading=nodeText(node);
    if (node.tagName === 'body') bodyRoot=node;
    const contentNode=['article','main'].includes(node.tagName) || attributes.role === 'main';
    if (contentNode && !insideContent && roots.length<32) roots.push(node);
    for (let i=(node.childNodes || []).length-1;i>=0;i--) stack.push({node:node.childNodes[i],insideContent:insideContent || contentNode});
  }
  const candidates=roots.map(node=>({node,text:nodeText(node)})).filter(candidate=>candidate.text.length>40);
  candidates.sort((a,b)=>b.text.length-a.text.length);
  let body=candidates[0]?.text || nodeText(bodyRoot || document);
  const description=tidy(meta['og:description'] || meta.description || '');
  const warnings=[];
  if (body.length < 80 && description.length > body.length) {body=description;warnings.push('网页正文未完整提供，仅提取了公开简介；可补充粘贴正文。');}
  if (!body) throw fail('网页没有可采集的公开正文，可能需要登录或 JavaScript 加载；请手动粘贴。','EMPTY_CONTENT');
  if (!candidates.length && body.length < 200 && !warnings.length) warnings.push('公开页面文字较少，可能需要登录或 JavaScript 加载；请核对正文。');
  const truncated=body.length>MAX_TEXT;
  if (truncated) warnings.push('正文已截取前 50000 字，可另存剩余段落。');
  return {title:tidy(meta['og:title'] || title || heading || url.hostname).slice(0,1000),body:body.slice(0,MAX_TEXT),sourceTitle:tidy(meta['og:site_name'] || url.hostname).slice(0,500),sourceUrl:url.href,author:tidy(meta.author || meta['article:author'] || '').slice(0,500),truncated,warnings};
}

function createWebCapture({lookup=dns.lookup.bind(dns), request=requestPage, trustedLookup=publicDnsLookup, timeoutMs=TIMEOUT_MS} = {}) {
  return async function capture(value) {
    let url=validatePublicUrl(value);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(fail('网页采集超时，请重试或手动粘贴正文。','CAPTURE_TIMEOUT')),timeoutMs);
    try {
      for (let hop=0;hop<=4;hop++) {
        const addresses=await resolvePublic(url,lookup,controller.signal,trustedLookup);
        const response=await abortable(request(url,addresses,{signal:controller.signal,maxBytes:MAX_BYTES}),controller.signal);
        if ([301,302,303,307,308].includes(response.status)) {
          if (!response.location || hop===4) throw fail('网页重定向次数过多或目标无效。','REDIRECT_LIMIT');
          url=validatePublicUrl(new URL(response.location,url).href);
          continue;
        }
        if (!Buffer.isBuffer(response.bytes) || response.bytes.length>MAX_BYTES) throw fail('网页内容超出采集上限。','PAGE_TOO_LARGE');
        return extractPage(decodePage(response.bytes,response.contentType || ''),url.href,response.contentType);
      }
    } finally { clearTimeout(timer); }
  };
}
module.exports = {captureWebPage:createWebCapture(),createWebCapture,validatePublicUrl,isPublicAddress,extractPage,requestPage,MAX_BYTES,MAX_TEXT};
