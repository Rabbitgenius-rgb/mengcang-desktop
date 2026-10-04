'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { relative, fail } = require('../desktop/security.cjs');
const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const registration = source.split('\n').find(line => line.includes("handle('openSourceLink',"));
function harness(note) {
  let handler; const reads=[], opened=[];
  vm.runInNewContext(registration, {
    handle:(_name, callback)=>{handler=callback;}, relative, fail, URL,
    gateway:{readNote:async value=>{reads.push(value);return note;}},
    shell:{openExternal:async url=>{opened.push(url);}},
  });
  return {handler, reads, opened};
}
test('source link of an image opens the stored web source, not its attachment',async()=>{
  const f=harness({kind:'image',url:'https://example.test/colors?q=1',attachmentPath:'01_sources/cards/images/color.png'});
  await f.handler('01_sources/cards/images/color.md');
  assert.deepEqual(f.reads,['01_sources/cards/images/color.md']);
  assert.deepEqual(f.opened,['https://example.test/colors?q=1']);
});
test('source link rejects missing, local, executable and credential-bearing URLs',async()=>{
  for(const url of [undefined,'','file:///etc/passwd','javascript:alert(1)','obsidian://open','https://user:secret@example.test']){
    const f=harness({url});await assert.rejects(f.handler('01_sources/cards/text/test.md'));
    assert.deepEqual(f.opened,[]);
  }
});
test('renderer cannot supply a URL or escaped note path instead of a stored note',async()=>{
  for(const value of ['https://example.test','../outside.md','/absolute.md',{url:'https://example.test'}]){
    const f=harness({url:'https://example.test'});await assert.rejects(f.handler(value));
    assert.deepEqual(f.reads,[]);assert.deepEqual(f.opened,[]);
  }
});
