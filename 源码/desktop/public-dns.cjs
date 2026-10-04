'use strict';
const https = require('node:https');
const net = require('node:net');

const DNS_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const DNS_BOOTSTRAP = Object.freeze({address:'1.1.1.1',family:4});
const fail = () => Object.assign(new Error('当前网络使用虚拟 DNS 地址，公共 DNS 校验暂未成功；请稍后重试，或保留链接并手动粘贴正文。'),{code:'PUBLIC_DNS_UNAVAILABLE'});

function requestDnsJSON(hostname, type, signal) {
  const url = new URL(DNS_ENDPOINT);
  url.searchParams.set('name',hostname);url.searchParams.set('type',String(type));
  return new Promise((resolve,reject)=>{
    let completed=false;
    const done=(error,value)=>{if(completed)return;completed=true;error?reject(error):resolve(value);};
    const request=https.request(url,{
      method:'GET',agent:false,signal,maxHeaderSize:8192,
      headers:{Accept:'application/dns-json','Accept-Encoding':'identity','User-Agent':'Mengcang-PublicCapture/1.0'},
      // Trusted resolver endpoint is bootstrapped directly; local fake-IP DNS is
      // never used for its TLS connection. Certificate validation stays enabled.
      lookup(_hostname,options,callback){options.all?callback(null,[DNS_BOOTSTRAP]):callback(null,DNS_BOOTSTRAP.address,DNS_BOOTSTRAP.family);}
    },response=>{
      if(response.statusCode!==200 || !/^application\/(?:dns-json|json)(?:;|$)/i.test(String(response.headers['content-type'] || '')) || Number(response.headers['content-length'])>65536){response.destroy();done(fail());return;}
      const chunks=[];let length=0;
      response.on('data',chunk=>{length+=chunk.length;if(length>65536){response.destroy();request.destroy();done(fail());}else chunks.push(chunk);});
      response.on('error',()=>done(fail()));response.on('aborted',()=>done(fail()));
      response.on('end',()=>{try{done(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{done(fail());}});
    });
    request.on('error',()=>done(fail()));request.end();
  });
}

function parseDnsAnswer(value, hostname, type) {
  const name=hostname.toLowerCase().replace(/\.$/, '');
  if (!value || value.Status!==0 || value.TC===true || !Array.isArray(value.Question) || !value.Question.some(question=>question.type===type && String(question.name).toLowerCase().replace(/\.$/, '')===name)) throw fail();
  if (value.Answer!==undefined && (!Array.isArray(value.Answer) || value.Answer.length>256)) throw fail();
  return (value.Answer || []).filter(answer=>answer.type===type).map(answer=>{
    const address=String(answer.data || ''),family=type===1?4:6;
    if(net.isIP(address)!==family)throw fail();
    return {address,family};
  });
}

function createPublicDnsLookup({request=requestDnsJSON,timeoutMs=4000}={}) {
  return async function publicDnsLookup(hostname,{signal}={}) {
    // Only DNS names are sent; paths, query strings, page content and credentials
    // cannot be added to this fixed resolver request.
    if(typeof hostname!=='string'||hostname.length>253||net.isIP(hostname)||!hostname.includes('.')||!/^[a-z0-9.-]+$/i.test(hostname))throw fail();
    const controller=new AbortController(),cancel=()=>controller.abort(fail());
    if(signal?.aborted)throw signal.reason || fail();
    signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,timeoutMs);
    let onAbort;
    try {
      const pending=Promise.all([1,28].map(async type=>parseDnsAnswer(await request(hostname,type,controller.signal),hostname,type)));
      const stopped=new Promise((_,reject)=>{onAbort=()=>reject(fail());controller.signal.addEventListener('abort',onAbort,{once:true});});
      const records=(await Promise.race([pending,stopped])).flat();
      if(!records.length)throw fail();
      return records;
    } catch {throw fail();}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);controller.abort();}
  };
}

module.exports={publicDnsLookup:createPublicDnsLookup(),createPublicDnsLookup,parseDnsAnswer,DNS_ENDPOINT,DNS_BOOTSTRAP};
