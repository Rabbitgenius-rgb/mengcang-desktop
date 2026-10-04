'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('packaged PDF module workers have executable MIME types under nosniff',()=>{
  const mapping=vm.runInNewContext(`(${source.match(/^const mime\s*=\s*(.+);$/m)[1]})`);
  for(const file of ['assets/pdf.worker.min-fixture.mjs','assets/attachmentWord-fixture.js']) {
    assert.equal(mapping[path.extname(file)],'application/javascript',file);
  }
  assert.equal(mapping['.wasm'],'application/wasm');
  assert.match(source,/'X-Content-Type-Options':'nosniff'/);
});

test('desktop CSP permits only local blob attachments and packaged/local workers',()=>{
  const csp=JSON.parse(source.match(/^const csp\s*=\s*(.+);$/m)[1]);
  const directives=Object.fromEntries(csp.split(';').map(value=>value.trim().split(/\s+/)).map(([name,...values])=>[name,values]));
  assert.deepEqual(directives['media-src'],['blob:']);
  assert.deepEqual(directives['object-src'],['blob:']);
  assert.deepEqual(directives['worker-src'],["'self'",'blob:']);
  assert.deepEqual(directives['script-src'],["'self'"]);
  assert.deepEqual(directives['connect-src'],["'self'",'mengcang-asset:']);
  assert.deepEqual(directives['frame-src'],["'none'"]);
  assert.deepEqual(directives['default-src'],["'none'"]);
  assert.deepEqual(directives['base-uri'],["'none'"]);
  assert.deepEqual(directives['form-action'],["'none'"]);
  assert.deepEqual(directives['img-src'],["'self'",'mengcang-asset:','data:','blob:']);
  assert.doesNotMatch(csp,/https?:|unsafe-eval/);
});

test('desktop request interceptor allows application-owned attachment blobs without opening network URLs',()=>{
  const declaration=source.match(/^\s*window\.webContents\.session\.webRequest\.onBeforeRequest\((.+)\);$/m)?.[1];
  assert.ok(declaration);
  const intercept=vm.runInNewContext(`(${declaration})`,{URL});
  const allowed=url=>{let result;intercept({url},value=>{result=value;});assert.ok(result,'The request must receive a decision');return result.cancel===false;};
  for(const url of ['mengcang://app/assets/attachmentWord-worker.js','mengcang-asset://vault/?path=fixture.pdf','blob:mengcang://app/4b2ac5d7-7f75-4f5f-bb44-d88820f8d4e6']) assert.equal(allowed(url),true,url);
  for(const url of ['https://example.com/video.mp4','http://127.0.0.1/private','file:///etc/passwd','data:text/html,script','blob:https://example.com/id','blob:null/id','blob:mengcang://app.evil/id','blob:mengcang-asset://vault/id','not a url']) assert.equal(allowed(url),false,url);
});
