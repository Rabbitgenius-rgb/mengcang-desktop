'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const zlib=require('node:zlib');
const {once}=require('node:events');
const {parseFeed,createFeedCapture,requestFeed,MAX_ITEMS,MAX_BYTES}=require('../desktop/feed-capture.cjs');
const publicLookup=async()=>[{address:'93.184.215.14',family:4}];
const xml=value=>({status:200,contentType:'application/rss+xml; charset=utf-8',bytes:Buffer.from(value)});
const rss='<rss version="2.0"><channel><title>公开来源</title><link>https://example.com/</link><item><guid isPermaLink="false">entry-1</guid><title>倾听 &amp; 发现</title><link>/article</link><description><![CDATA[<p>原文 café 🧪</p><script>neverRun()</script><p>第二段</p>]]></description><pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';

test('RSS parsing preserves text and date, strips executable markup and resolves article URLs',()=>{
  const result=parseFeed(rss,'https://example.com/feed.xml');
  assert.equal(result.title,'公开来源');assert.equal(result.siteUrl,'https://example.com/');assert.equal(result.items.length,1);
  const item=result.items[0];assert.equal(item.title,'倾听 & 发现');assert.equal(item.sourceUrl,'https://example.com/article');assert.equal(item.body,'原文 café 🧪\n第二段');assert.equal(item.date,'2026-10-04T10:00:00.000Z');assert.equal(item.type,'article');assert.match(item.id,/^[a-f0-9]{64}$/);
  assert.equal(parseFeed(rss.replace('第二段','已更新第二段'),'https://example.com/feed.xml').items[0].id,item.id);
});
test('Atom and RSS podcast enclosures retain safe public media URLs and namespaces',()=>{
  const atom=`<?xml version="1.0"?><a:feed xmlns:a="http://www.w3.org/2005/Atom" xml:base="https://example.com/base/"><a:title>设计 &amp; 阅读</a:title><a:link href="../"/><a:entry xml:base="episodes/"><a:id>urn:episode:1</a:id><a:title>第一期</a:title><a:author><a:name>作者</a:name></a:author><a:link href="one"/><a:link rel="enclosure" type="audio/mpeg" href="one.mp3"/><a:summary type="html">&lt;p&gt;节目简介&lt;/p&gt;</a:summary><a:updated>2026-10-04T08:00:00Z</a:updated></a:entry></a:feed>`;
  const item=parseFeed(atom,'https://example.com/atom.xml').items[0];
  assert.equal(item.sourceUrl,'https://example.com/base/episodes/one');assert.equal(item.enclosureUrl,'https://example.com/base/episodes/one.mp3');assert.equal(item.type,'audio');assert.equal(item.author,'作者');assert.equal(item.body,'节目简介');
  const podcast=parseFeed('<rss><channel><title>播客</title><item><guid isPermaLink="false">ep2</guid><title>第二期</title><enclosure type="audio/mpeg" url="https://media.example.com/ep.mp3" length="12"/><description>简介</description></item></channel></rss>','https://example.com/feed');
  assert.equal(podcast.items[0].sourceUrl,'https://media.example.com/ep.mp3');assert.equal(podcast.items[0].type,'audio');
});
test('RSS 1 RDF namespace entries, duplicate IDs and bounded list are supported',()=>{
  const rdf='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>RDF</title></channel><item><title>一</title><link>https://example.com/1</link><description>正文</description></item></rdf:RDF>';
  assert.equal(parseFeed(rdf,'https://example.com/rss').items.length,1);
  const repeated=rss.replace('</channel>',rss.match(/<item>[\s\S]*<\/item>/)[0]+'</channel>');assert.equal(parseFeed(repeated,'https://example.com/rss').items.length,1);
  const many='<rss><channel>'+Array.from({length:MAX_ITEMS+1},(_,index)=>`<item><guid isPermaLink="false">${index}</guid><title>${index}</title></item>`).join('')+'</channel></rss>';
  const feed=parseFeed(many,'https://example.com/rss');assert.equal(feed.items.length,MAX_ITEMS);assert.ok(feed.warnings.some(value=>value.includes('200')));
});
test('XML DTD, entity declarations, excessive nesting, malformed and oversized payloads are rejected',()=>{
  for(const body of ['<!DOCTYPE rss [<!ENTITY local SYSTEM "file:///etc/passwd">]><rss/>','<!ENTITY bomb "xx"><rss/>'])assert.throws(()=>parseFeed(body,'https://example.com/feed'),{code:'UNSAFE_XML'});
  for(const body of ['<rss><channel></rss>','<rss><channel>','<html><body>not a feed</body></html>','<rss a="1" a="2"/>','<rss/><rss/>'])assert.throws(()=>parseFeed(body,'https://example.com/feed'),{code:'INVALID_FEED'});
  assert.throws(()=>parseFeed('<rss>'+'<x>'.repeat(70)+'</x>'.repeat(70)+'</rss>','https://example.com/feed'),{code:'FEED_TOO_LARGE'});
  assert.throws(()=>parseFeed('x'.repeat(MAX_BYTES+1),'https://example.com/feed'),{code:'FEED_TOO_LARGE'});
});
test('private and credential-bearing item links are omitted, never fetched',()=>{
  const value='<rss><channel><title>安全</title><item><title>A</title><link>http://127.0.0.1/private</link><enclosure url="https://example.com/audio?token=secret" type="audio/mpeg"/></item></channel></rss>';
  const feed=parseFeed(value,'https://example.com/rss');assert.equal(feed.items[0].sourceUrl,'https://example.com/rss');assert.equal(feed.items[0].enclosureUrl,'');assert.equal(feed.items[0].type,'article');assert.ok(feed.warnings.length);
});
test('feed network entry rejects private URLs, mixed DNS and rebinding across redirects',async()=>{
  let calls=0;const capture=createFeedCapture({lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request:async()=>{calls++;return xml(rss);}});
  await assert.rejects(capture('http://localhost/'),{code:'PRIVATE_ADDRESS'});await assert.rejects(capture('https://example.com/feed?token=private'),{code:'CREDENTIAL_URL'});await assert.rejects(capture('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(calls,0);
  let looked=0;const rebound=createFeedCapture({lookup:async()=>[{address:++looked===1?'8.8.8.8':'10.1.1.1',family:4}],request:async()=>{calls++;return {status:302,location:'/redirect'};}});
  await assert.rejects(rebound('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(calls,1);
  const privateRedirect=createFeedCapture({lookup:publicLookup,request:async()=>({status:302,location:'http://169.254.169.254/'})});await assert.rejects(privateRedirect('https://example.com/'),{code:'PRIVATE_ADDRESS'});
});
test('proxy synthetic DNS resolves publicly then pins addresses; redirected feeds retain final URL',async()=>{
  let received;const capture=createFeedCapture({lookup:async()=>[{address:'198.18.0.1',family:4}],trustedLookup:publicLookup,request:async(url,addresses)=>{received=addresses;return url.pathname==='/'?{status:302,location:'/rss'}:xml(rss);}});
  const result=await capture('https://example.com/');assert.deepEqual(received,await publicLookup());assert.equal(result.url,'https://example.com/rss');
});
test('feed DNS stalls, response stalls and redirect loops are bounded',async()=>{
  await assert.rejects(createFeedCapture({lookup:()=>new Promise(()=>{}),timeoutMs:20})('https://example.com/'),{code:'CAPTURE_TIMEOUT'});
  await assert.rejects(createFeedCapture({lookup:publicLookup,request:()=>new Promise(()=>{}),timeoutMs:20})('https://example.com/'),{code:'CAPTURE_TIMEOUT'});
  await assert.rejects(createFeedCapture({lookup:publicLookup,request:async()=>({status:302,location:'/again'})})('https://example.com/'),{code:'REDIRECT_LIMIT'});
});
test('transport rejects nonfeeds and decompression bombs without sending credentials',{timeout:5000},async t=>{
  let observed;const server=http.createServer((req,res)=>{observed=req.headers;res.writeHead(200,{'content-type':req.url==='/html'?'text/html':'application/rss+xml','content-encoding':'gzip'});res.end(zlib.gzipSync(req.url==='/large'?'x'.repeat(4000):rss));});
  t.after(()=>{server.closeAllConnections();if(server.listening)return new Promise(resolve=>server.close(resolve));});
  server.listen(0,'127.0.0.1');await once(server,'listening',{signal:AbortSignal.timeout(2000)});
  const base=`http://127.0.0.1:${server.address().port}`,options={signal:AbortSignal.timeout(3000),maxBytes:1024};
  // The transport-only fixture runs locally; createFeedCapture disallows this URL.
  const response=await requestFeed(new URL(base),[{address:'127.0.0.1',family:4}],options);assert.equal(response.bytes.toString(),rss);assert.equal(observed.cookie,undefined);assert.equal(observed.authorization,undefined);assert.equal(observed.referer,undefined);
  await assert.rejects(requestFeed(new URL(base+'/large'),[],options),{code:'FEED_TOO_LARGE'});await assert.rejects(requestFeed(new URL(base+'/html'),[],options),{code:'UNSUPPORTED_CONTENT'});
});
