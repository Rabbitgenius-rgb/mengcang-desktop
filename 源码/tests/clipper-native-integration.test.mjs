import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createWorkspaceStore} from '../prototypes/desktop-workbench/src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../prototypes/desktop-workbench/src/sublime/workspacePersistence.js';
import {createClipperLibrary} from '../prototypes/desktop-workbench/src/sublime/clipperLibrary.js';
import {createRecallLibrary} from '../prototypes/desktop-workbench/src/sublime/recallLibrary.js';

const require = createRequire(import.meta.url);
const {startClipperBridge} = require('../desktop/clipper-bridge.cjs');
const {ORIGIN} = require('../browser-extension/native/clipper-host.cjs');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tick = () => new Promise(resolve => setImmediate(resolve));

// Use the real production IndexedDB store/session logic, with an isolated
// in-memory IndexedDB transaction interface. No Chromium or user files open.
function memoryWorkspace() {
  const data = new Map(); let tail = Promise.resolve(), held = null;
  const db = {transaction(name, mode) {
    assert.equal(name, 'workspaces');
    let complete; const previous = tail; tail = new Promise(resolve => { complete = resolve; });
    const reads = [], writes = []; let ended = false;
    const tx = {objectStore() { return {
      get(key) { const request = {}; reads.push(() => { request.result = structuredClone(data.get(key)); request.onsuccess?.(); }); return request; },
      put(value, key) { assert.equal(mode, 'readwrite'); writes.push([key, structuredClone(value)]); },
    }; }, abort() { if (!ended) { ended = true; queueMicrotask(() => { tx.onabort?.(); complete(); }); } }};
    previous.then(async () => {
      await tick(); if (ended) return;
      for (const read of reads) { if (ended) break; read(); }
      await tick(); if (ended) return;
      if (writes.length && held) { const gate = held; held = null; gate.entered(); await gate.wait; }
      ended = true; for (const [key, value] of writes) data.set(key, value);
      tx.oncomplete?.(); complete();
    });
    return tx;
  }};
  return {
    store:() => createWorkspaceStore('native-integration', {openDatabase:async () => db, createChannel:() => null, eventTarget:null}),
    holdNextWrite() { let entered, release; const started = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; }); held = {entered, wait}; return {started, release}; },
  };
}
const payload = extra => ({version:1, requestId:randomUUID(), kind:'link', sourceUrl:'https://example.test/native-integration', title:'隔离浏览器收录', body:'仅为自动集成验收的合成内容。', ...extra});
function png() {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  return {name:'isolated-pixel.png', type:'image/png', size:bytes.length, dataUrl:`data:image/png;base64,${bytes.toString('base64')}`};
}
function nativeMessage(filename, origin, message) {
  const child = spawn(process.execPath, [filename, origin], {stdio:['pipe', 'pipe', 'pipe']}), stdout = [], stderr = [];
  child.stdin.on('error', () => {}); // A rejected origin can close stdin first.
  child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('isolated native host timed out')); }, 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      try {
        assert.equal(signal, null); assert.equal(code, 0); assert.equal(Buffer.concat(stderr).toString(), '');
        const bytes = Buffer.concat(stdout); assert.ok(bytes.length >= 4);
        const length = bytes.readUInt32LE(0); assert.equal(bytes.length, length + 4, 'stdout must contain exactly one native frame, with no logs or trailing bytes');
        resolve(JSON.parse(bytes.subarray(4).toString('utf8')));
      } catch (error) { reject(error); }
    });
  });
  const body = Buffer.from(JSON.stringify(message)), frame = Buffer.alloc(body.length + 4);
  frame.writeUInt32LE(body.length); body.copy(frame, 4); child.stdin.end(frame);
  return {done, stdout};
}

test('actual native frames commit organized articles, source-linked highlights and images without touching recall', {timeout:30000}, async () => {
  const temporary = await fs.mkdtemp('/private/tmp/mengcang-clipper-integration-'); await fs.chmod(temporary, 0o700);
  const directory = path.join(temporary, 'bridge'), hostDirectory = path.join(temporary, 'native');
  await fs.mkdir(hostDirectory, {mode:0o700});
  const nativeHost = path.join(hostDirectory, 'clipper-host.cjs');
  await fs.copyFile(path.join(root, 'browser-extension/native/clipper-host.cjs'), nativeHost);
  await fs.writeFile(path.join(hostDirectory, 'config.json'), JSON.stringify({bridgeDirectory:directory}), {mode:0o600});
  const fixture = memoryWorkspace(), session = createWorkspaceSession(fixture.store());
  const recall = createRecallLibrary({session, workspaceId:'native-integration'});
  const oldRecall = await recall.call('capture', {requestId:randomUUID(), title:'既有回看', text:'应当完整保留的对话原话。', externalSource:{version:1, provider:'deepseek-harness', instanceId:'isolated-fixture', sessionId:'before-clipping', messageId:'before-message', eventSeq:1, turn:1, sessionTitle:'原回看线程'}});
  await session.commit([{type:'card.upsert', card:{id:'original-material', title:'既有资料', body:'既有正文'}}, {type:'card.save', id:'original-material', saved:true}, {type:'draft.set', key:'native-integration-read-state', value:{[oldRecall.item.id]:'previous-read-state'}}]);
  const before = structuredClone(session.state), library = createClipperLibrary({session, workspaceId:'native-integration'}), ipc = new Map(), dispatched = [], bridgeErrors = [];
  let downloads = 0, bridge, socketDirectory;
  const contents = {mainFrame:{url:'mengcang://app/'}, isDestroyed:() => false, send(channel, event) {
    assert.equal(channel, 'mengcang:event'); assert.equal(event.type, 'clipperRequest'); dispatched.push(event);
    void (async () => {
      let reply;
      try { reply = {ok:true, result:await library.call(event.method, event.params)}; }
      catch (error) { reply = {ok:false, error:{code:error.code || 'TEST_FAILURE', message:error.message}}; }
      const acknowledged = await ipc.get('mengcang:clipperResult')({sender:contents, senderFrame:contents.mainFrame}, {commandId:event.commandId, workspaceId:event.workspaceId, ...reply});
      assert.equal(acknowledged.ok, true); assert.equal(acknowledged.data.accepted, true);
    })().catch(error => bridgeErrors.push(error));
  }};
  try {
    bridge = await startClipperBridge({directory, ipcMain:{handle:(name, callback) => ipc.set(name, callback), removeHandler:name => ipc.delete(name)}, getWindow:() => ({webContents:contents}), getWorkspaceId:() => 'native-integration', isQuitting:() => false,
      captureImage:async url => { assert.equal(url, 'https://cdn.example.test/isolated-pixel.png'); if (++downloads > 1) throw Error('original image is now unavailable'); return png(); }});
    socketDirectory = path.dirname(JSON.parse(await fs.readFile(path.join(directory, 'browser-clipper.json'), 'utf8')).socketPath);
    const ready = await ipc.get('mengcang:clipperReady')({sender:contents, senderFrame:contents.mainFrame}, {ready:true, workspaceId:'native-integration'}); assert.equal(ready.ok, true);
    const status = await nativeMessage(nativeHost, ORIGIN, {method:'status', params:{}}).done;
    assert.deepEqual(status, {ok:true, data:{ready:true, workspaceId:'native-integration'}});
    const collectionsBefore = await nativeMessage(nativeHost, ORIGIN, {method:'collections', params:{limit:1}}).done;
    assert.equal(collectionsBefore.ok, true); assert.equal(collectionsBefore.data.items[0].id, 'browser-clips-v1');
    assert.equal(session.state.collections.some(value => value.id === 'browser-clips-v1'), false, 'metadata lookup must not create the virtual default');

    const link = payload(), gate = fixture.holdNextWrite(), pendingLink = nativeMessage(nativeHost, ORIGIN, {method:'capture', params:link});
    await Promise.race([gate.started, pendingLink.done.then(() => { throw Error('native host responded before the workspace write began'); })]);
    await tick(); assert.equal(Buffer.concat(pendingLink.stdout).length, 0, 'success must wait until the workspace transaction commits'); gate.release();
    const first = await pendingLink.done; assert.equal(first.ok, true); assert.equal(first.data.item.type, 'link'); assert.equal(first.data.duplicate, false);
    assert.equal(session.state.cards.find(card => card.id === first.data.item.id).sourceUrl, link.sourceUrl);
    const article = payload({kind:'article', title:'隔离文章', body:'第一段原文。\n\n第二段原文与出处。', note:'原生连接内保存的备注', favorite:true, article:{version:1, blocks:[
      {id:'first', type:'paragraph', runs:[{text:'第一段原文。', strong:true}]},
      {id:'second', type:'paragraph', runs:[{text:'第二段原文与', em:true}, {text:'出处。', href:'https://example.test/reference'}]},
    ]}});
    const articleResult = await nativeMessage(nativeHost, ORIGIN, {method:'capture', params:article}).done;
    assert.equal(articleResult.ok, true); assert.equal(articleResult.data.item.type, 'article'); assert.equal(session.state.cards.find(card => card.id === articleResult.data.item.id).body, article.body);
    assert.equal(session.state.cards.find(card => card.id === articleResult.data.item.id).article.blocks[1].runs[1].href, 'https://example.test/reference');
    assert.equal(session.state.annotations[articleResult.data.item.id].note, article.note); assert.ok(session.state.favoriteIds.includes(articleResult.data.item.id));
    const image = payload({kind:'image', title:'隔离图片', imageUrl:'https://cdn.example.test/isolated-pixel.png'});
    const imageResult = await nativeMessage(nativeHost, ORIGIN, {method:'capture', params:image}).done;
    assert.equal(imageResult.ok, true); assert.equal(imageResult.data.item.type, 'image'); assert.equal(downloads, 1);
    assert.deepEqual(session.state.cards.find(card => card.id === imageResult.data.item.id).attachment, png());
    for (const input of [link, article, image]) {
      const repeated = await nativeMessage(nativeHost, ORIGIN, {method:'capture', params:input}).done;
      assert.equal(repeated.ok, true); assert.equal(repeated.data.duplicate, true);
    }
    assert.equal(downloads, 1, 'image retry must lookup its successful receipt before another download');
    assert.equal(session.state.cards.filter(card => card.id.startsWith('browser-clip:')).length, 3);
    const highlight = payload({kind:'highlight', title:'原文章高亮', body:'第二段原文与出处。', anchor:{version:1, exact:'第二段原文与出处。', prefix:'第一段原文。 ', suffix:'', start:7, end:16}, sourceCardId:articleResult.data.item.id, note:'高亮备注', favorite:true});
    const highlighted = await nativeMessage(nativeHost, ORIGIN, {method:'capture', params:highlight}).done;
    assert.equal(highlighted.ok, true); assert.equal(highlighted.data.item.type, 'highlight');
    const pageHighlights = await nativeMessage(nativeHost, ORIGIN, {method:'highlights', params:{sourceUrl:link.sourceUrl + '#different-section'}}).done;
    assert.equal(pageHighlights.ok, true); assert.equal(pageHighlights.data.items.length, 1); assert.equal(pageHighlights.data.items[0].id, highlighted.data.item.id);
    assert.equal(pageHighlights.data.items[0].anchor.exact, highlight.body); assert.equal(pageHighlights.data.items[0].sourceCardId, articleResult.data.item.id);
    assert.equal(Object.hasOwn(pageHighlights.data.items[0], 'note'), false, 'page rendering does not require private notes');
    const otherPage = await nativeMessage(nativeHost, ORIGIN, {method:'highlights', params:{sourceUrl:'https://example.test/unrelated'}}).done;
    assert.equal(otherPage.ok, true); assert.equal(otherPage.data.items.length, 0);
    const collectionsAfter = await nativeMessage(nativeHost, ORIGIN, {method:'collections', params:{}}).done;
    assert.equal(collectionsAfter.ok, true); assert.equal(collectionsAfter.data.items.some(value => value.id === 'browser-clips-v1'), true);
    assert.equal((await nativeMessage(nativeHost, ORIGIN, {method:'capture', params:highlight}).done).data.duplicate, true);
    assert.equal(session.state.cards.filter(card => card.id.startsWith('browser-clip:')).length, 4);
    assert.deepEqual(session.state.cards.filter(card => !card.id.startsWith('browser-clip:')), before.cards);
    assert.deepEqual(session.state.collections.filter(value => value.id !== 'browser-clips-v1'), before.collections);
    assert.deepEqual(session.state.drafts['native-integration-read-state'], before.drafts['native-integration-read-state']);
    assert.deepEqual((await recall.call('get', {id:oldRecall.item.id})).item, oldRecall.item);

    const restoredSession = createWorkspaceSession(fixture.store()), restoredLibrary = createClipperLibrary({session:restoredSession, workspaceId:'native-integration'});
    const reopened = await restoredLibrary.call('lookup', image); assert.equal(reopened.found, true); assert.equal(reopened.item.id, imageResult.data.item.id);
    assert.equal((await restoredSession.load()).cards.filter(card => card.id.startsWith('browser-clip:')).length, 4);
    assert.equal((await restoredLibrary.call('highlights', {sourceUrl:link.sourceUrl})).items[0].id, highlighted.data.item.id);
    const revisionBeforeWrongOrigin = restoredSession.revision, eventsBeforeWrongOrigin = dispatched.length;
    const wrongOrigin = await nativeMessage(nativeHost, 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', {method:'capture', params:payload()}).done;
    assert.equal(wrongOrigin.ok, false); assert.equal(wrongOrigin.error.code, 'FORBIDDEN_EXTENSION');
    assert.equal(dispatched.length, eventsBeforeWrongOrigin); await restoredSession.load(); assert.equal(restoredSession.revision, revisionBeforeWrongOrigin);

    await bridge.close(); bridge = null;
    const closed = await nativeMessage(nativeHost, ORIGIN, {method:'capture', params:payload()}).done;
    assert.equal(closed.ok, false); assert.equal(closed.error.code, 'DESKTOP_UNAVAILABLE');
    assert.equal(ipc.size, 0); assert.deepEqual(bridgeErrors, []);
  } finally {
    await bridge?.close();
    if (socketDirectory) await fs.rm(socketDirectory, {recursive:true, force:true});
    await fs.rm(temporary, {recursive:true, force:true});
  }
});
