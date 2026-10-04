'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPublicDnsLookup,parseDnsAnswer,DNS_ENDPOINT,DNS_BOOTSTRAP}=require('../desktop/public-dns.cjs');
const {createWebCapture}=require('../desktop/web-capture.cjs');
const fakeLookup=async()=>[{address:'198.18.0.8',family:4}];
const publicRecords=[{address:'93.184.215.14',family:4}];
const fixture=()=>({status:200,contentType:'text/html',bytes:Buffer.from('<main>Public fixture body, without AI or account data.</main>')});
const answer=(name,type,data)=>({Status:0,Question:[{name:`${name}.`,type}],Answer:data.map(value=>({type,data:value}))});

test('only synthetic benchmark DNS answers trigger public validation and connections use validated public IPs',async()=>{
  let lookups=0,requests=0;
  const capture=createWebCapture({lookup:fakeLookup,trustedLookup:async(name,{signal})=>{lookups++;assert.equal(name,'example.com');assert.equal(signal.aborted,false);return publicRecords;},request:async(url,addresses)=>{requests++;assert.deepEqual(addresses,publicRecords);assert.equal(url.href,'https://example.com/');return fixture();}});
  assert.match((await capture('https://example.com/')).body,/Public fixture/);assert.equal(lookups,1);assert.equal(requests,1);
});

test('normal private, mixed private/fake DNS, and literal fake-IP URLs never use the fallback',async()=>{
  for(const records of [[{address:'10.0.0.1',family:4}],[{address:'198.18.0.8',family:4},{address:'192.168.1.1',family:4}],[{address:'::1',family:6}]]){
    let calls=0;const capture=createWebCapture({lookup:async()=>records,trustedLookup:async()=>{calls++;return publicRecords;},request:async()=>{calls++;return fixture();}});
    await assert.rejects(capture('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(calls,0);
  }
  let calls=0;const capture=createWebCapture({lookup:fakeLookup,trustedLookup:async()=>{calls++;return publicRecords;},request:async()=>{calls++;return fixture();}});
  await assert.rejects(capture('http://198.18.0.8/'),{code:'PRIVATE_ADDRESS'});assert.equal(calls,0);
});

test('a public resolver cannot authorize private, benchmark, malformed or mixed address answers',async()=>{
  for(const records of [[{address:'127.0.0.1',family:4}],[{address:'198.19.0.9',family:4}],[...publicRecords,{address:'10.2.3.4',family:4}],[{address:'93.184.215.14',family:6}],[]]){
    let requests=0;const capture=createWebCapture({lookup:fakeLookup,trustedLookup:async()=>records,request:async()=>{requests++;return fixture();}});
    await assert.rejects(capture('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(requests,0);
  }
});

test('each redirected fake-DNS hostname is resolved and pinned independently',async()=>{
  const resolved=[],requested=[];
  const capture=createWebCapture({lookup:fakeLookup,trustedLookup:async name=>{resolved.push(name);return publicRecords;},request:async(url,addresses)=>{requested.push(url.href);assert.deepEqual(addresses,publicRecords);return requested.length===1?{status:302,location:'https://www.example.com/article'}:fixture();}});
  const result=await capture('https://example.com/');assert.deepEqual(resolved,['example.com','www.example.com']);assert.equal(result.sourceUrl,'https://www.example.com/article');
});

test('public resolver fixture requests only target DNS name and A/AAAA types at a fixed service',async()=>{
  assert.equal(DNS_ENDPOINT,'https://cloudflare-dns.com/dns-query');assert.deepEqual(DNS_BOOTSTRAP,{address:'1.1.1.1',family:4});
  const queries=[];const lookup=createPublicDnsLookup({request:async(name,type,signal)=>{queries.push([name,type]);assert.equal(signal.aborted,false);return answer(name,type,type===1?['93.184.215.14']:['2606:4700:4700::1111']);}});
  assert.deepEqual(await lookup('example.com'),[{address:'93.184.215.14',family:4},{address:'2606:4700:4700::1111',family:6}]);assert.deepEqual(queries,[['example.com',1],['example.com',28]]);
  for(const host of ['https://example.com/path?token=secret','example.com/private','127.0.0.1'])await assert.rejects(lookup(host),{code:'PUBLIC_DNS_UNAVAILABLE'});
});

test('DNS answers must match the exact question, status and address family',()=>{
  assert.deepEqual(parseDnsAnswer(answer('example.com',28,[]),'example.com',28),[]);
  for(const value of [{Status:3,Question:[{name:'example.com.',type:1}]},answer('different.example',1,['8.8.8.8']),{...answer('example.com',1,['8.8.8.8']),TC:true},answer('example.com',1,['::1']),{...answer('example.com',1,[]),Answer:{bad:true}}])assert.throws(()=>parseDnsAnswer(value,'example.com',1),{code:'PUBLIC_DNS_UNAVAILABLE'});
});

test('resolver stalls and failures are bounded and explain retry/manual capture',async()=>{
  const stalled=createPublicDnsLookup({timeoutMs:20,request:()=>new Promise(()=>{})});
  await assert.rejects(stalled('example.com'),error=>error.code==='PUBLIC_DNS_UNAVAILABLE'&&/重试/.test(error.message)&&/手动/.test(error.message));
  let requests=0;const capture=createWebCapture({lookup:fakeLookup,trustedLookup:createPublicDnsLookup({request:async()=>{throw Error('TLS unavailable');}}),request:async()=>{requests++;return fixture();}});
  await assert.rejects(capture('https://example.com/'),{code:'PUBLIC_DNS_UNAVAILABLE'});assert.equal(requests,0);
});
