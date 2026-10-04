'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {once} = require('node:events');
const {createWebCapture,isPublicAddress,validatePublicUrl,extractPage,requestPage,MAX_TEXT} = require('../desktop/web-capture.cjs');
const publicLookup = async () => [{address:'93.184.215.14',family:4}];
const page = html => ({status:200,contentType:'text/html; charset=utf-8',bytes:Buffer.from(html)});

test('captures title, author and readable article while omitting scripts, forms and navigation', () => {
  const html = `<!doctype html><head><title>Fallback</title><meta property="og:title" content="A &amp; B"><meta property="og:site_name" content="Fixture Library"><meta name="author" content="张三"></head><body><nav>not content</nav><article><h1>倾听</h1><p>A &lt; B &amp; C. &#x1F4D6;</p><p>完整公开正文。${'文字'.repeat(25)}</p><script>throw Error('must never run')</script><style>secret</style><div hidden>hidden</div><span aria-hidden="true">icon</span><form><input value="password">private field</form></article><footer>footer</footer></body>`;
  const result = extractPage(html,'https://example.com/path#fragment');
  assert.equal(result.title,'A & B');assert.equal(result.author,'张三');assert.equal(result.sourceTitle,'Fixture Library');assert.equal(result.sourceUrl,'https://example.com/path');
  assert.match(result.body,/A < B & C\. 📖/);assert.match(result.body,/倾听\n/);
  for (const excluded of ['not content','throw Error','secret','hidden','icon','private field','footer']) assert.equal(result.body.includes(excluded),false,excluded);
  assert.equal(result.truncated,false);
});

test('HTML5 parsing handles malformed tags and entity text without treating text as executable markup', () => {
  const result=extractPage('<title>Fragments</title><main><p>First<p>Second &copy; 2026 &lt;script&gt; is text<script>unwanted()</script></main>','https://example.com/');
  assert.match(result.body,/First\n+Second © 2026 <script> is text/);assert.doesNotMatch(result.body,/unwanted/);
});

test('long body truncation is visible and JavaScript-only pages fail explicitly', () => {
  const result=extractPage(`<article><p>${'x'.repeat(MAX_TEXT+50)}</p></article>`,'https://example.com/');
  assert.equal(result.body.length,MAX_TEXT);assert.equal(result.truncated,true);assert.match(result.warnings.join(' '),/50000/);
  assert.throws(()=>extractPage('<body><div id="root"></div><script>start()</script></body>','https://example.com/'),{code:'EMPTY_CONTENT'});
  const fallback=extractPage('<meta name="description" content="公开摘要示例"><div id="root"></div>','https://example.com/');assert.equal(fallback.body,'公开摘要示例');assert.ok(fallback.warnings.length);
});

test('public-IP policy rejects loopback, private, reserved and address-translation ranges', () => {
  for(const ip of ['127.0.0.1','0.0.0.0','10.1.2.3','172.31.5.1','192.168.1.1','100.64.0.1','169.254.169.254','192.0.2.8','198.18.0.1','198.51.100.2','203.0.113.1','224.0.0.1','255.255.255.255','::1','::','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','64:ff9b::0808:0808','2001:db8::1','2001::1','2002:7f00:1::','3fff::1']) assert.equal(isPublicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','93.184.215.14','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicAddress(ip),true,ip);
});

test('URL validation blocks credentials, unusual ports, opaque schemes and numeric loopback aliases', () => {
  for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:password@example.com/','http://localhost/','http://local/','http://service.internal/','http://127.1/','http://2130706433/','http://0x7f000001/','http://[::ffff:127.0.0.1]/','https://example.com:8080/','https://example.com/?access_token=secret','https://example.com/?X-Amz-Signature=secret']) assert.throws(()=>validatePublicUrl(url),url);
  assert.equal(validatePublicUrl('https://example.com/article?q=design#part').href,'https://example.com/article?q=design');
});

test('mixed public/private DNS results are rejected before any HTTP request', async () => {
  let calls=0;
  const capture=createWebCapture({lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request:async()=>{calls++;}});
  await assert.rejects(capture('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(calls,0);
});

test('each redirect revalidates URL and DNS; cookies and credentials never carry to a target', async () => {
  const calls=[];
  const blocked=createWebCapture({lookup:publicLookup,request:async(url,addresses,options)=>{calls.push({url:url.href,addresses,options});return {status:302,location:'http://169.254.169.254/latest/meta-data'};}});
  await assert.rejects(blocked('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(calls.length,1);
  let lookupCount=0,requestCount=0;
  const rebound=createWebCapture({lookup:async()=>++lookupCount===1?[{address:'8.8.8.8',family:4}]:[{address:'10.0.0.1',family:4}],request:async()=>{requestCount++;return {status:302,location:'/again'};}});
  await assert.rejects(rebound('https://example.com/'),{code:'PRIVATE_ADDRESS'});assert.equal(requestCount,1);
  const good=createWebCapture({lookup:publicLookup,request:async url=>url.pathname==='/'?{status:302,location:'/article'}:page('<main>A safely captured public article.</main>')});
  assert.equal((await good('https://example.com/')).sourceUrl,'https://example.com/article');
});

test('redirect chains and DNS/response stalls have bounded lifetimes', async () => {
  const loop=createWebCapture({lookup:publicLookup,request:async()=>({status:302,location:'/again'})});
  await assert.rejects(loop('https://example.com/'),{code:'REDIRECT_LIMIT'});
  const stalled=createWebCapture({lookup:()=>new Promise(()=>{}),timeoutMs:20});
  await assert.rejects(stalled('https://example.com/'),{code:'CAPTURE_TIMEOUT'});
  const stalledBody=createWebCapture({lookup:publicLookup,request:()=>new Promise(()=>{}),timeoutMs:20});
  await assert.rejects(stalledBody('https://example.com/'),{code:'CAPTURE_TIMEOUT'});
});

test('transport enforces compression limits and never sends Cookie or Authorization', async t => {
  let observed;
  const server=http.createServer((req,res)=>{observed=req.headers;if(req.url==='/large'){res.writeHead(200,{'content-type':'text/html','content-encoding':'gzip'});res.end(zlib.gzipSync('<p>'+ 'x'.repeat(3000)+'</p>'));}else if(req.url==='/file'){res.writeHead(200,{'content-type':'application/pdf'});res.end('%PDF');}else{res.writeHead(200,{'content-type':'text/html','content-encoding':'gzip'});res.end(zlib.gzipSync('<p>fixture</p>'));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  // Transport-only loopback fixture: production entry validates before calling it.
  const base=`http://127.0.0.1:${server.address().port}`;
  const options={signal:new AbortController().signal,maxBytes:1024};
  const result=await requestPage(new URL(base),[{address:'127.0.0.1',family:4}],options);
  assert.equal(result.bytes.toString(),'<p>fixture</p>');assert.equal(observed.cookie,undefined);assert.equal(observed.authorization,undefined);assert.equal(observed.referer,undefined);
  await assert.rejects(requestPage(new URL(`${base}/large`),[],options),{code:'PAGE_TOO_LARGE'});
  await assert.rejects(requestPage(new URL(`${base}/file`),[],options),{code:'UNSUPPORTED_CONTENT'});
});
