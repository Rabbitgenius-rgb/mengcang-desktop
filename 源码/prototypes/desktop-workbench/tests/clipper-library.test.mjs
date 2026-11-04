import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {createClipperLibrary, connectClipperRenderer, CLIPPER_COLLECTION_ID} from '../src/sublime/clipperLibrary.js';
import {createRecallLibrary, RECALL_COLLECTION_ID} from '../src/sublime/recallLibrary.js';
import {normalizeWorkspaceState, serializeWorkspace, parseWorkspaceBackup, mergeWorkspaceBackup} from '../src/sublime/workspaceModel.js';
import {normalizeClipperParams, clipperPayloadIdentity, MAX_CLIPPER_IMAGE_BYTES} from '../../../src/clipper/contract.mjs';
import {articlePlainText} from '../../../src/clipper/article.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
// The same IndexedDB get/put transaction interface used by recall tests. The
// real store and session own normalization, concurrency, commit and rollback.
function createMemoryWorkspaceFixture() {
  const data = new Map(); let tail = Promise.resolve(), failNext = false, committed = () => {};
  const db = {transaction(name, mode) {
    assert.equal(name, 'workspaces');
    let complete; const previous = tail; tail = new Promise(resolve => { complete = resolve; });
    const operations = [], writes = []; let ended = false;
    const tx = {objectStore() { return {
      get(key) { const request = {}; operations.push(() => { request.result = structuredClone(data.get(key)); request.onsuccess?.(); }); return request; },
      put(value, key) { assert.equal(mode, 'readwrite'); writes.push([key, structuredClone(value)]); },
    }; }, abort() { if (!ended) { ended = true; queueMicrotask(() => { tx.onabort?.(); complete(); }); } }};
    previous.then(async () => {
      await tick(); if (ended) return;
      for (const operation of operations) { if (ended) break; operation(); }
      await tick(); if (ended) return;
      if (failNext && mode === 'readwrite') { failNext = false; tx.error = Error('synthetic commit failure'); tx.abort(); return; }
      ended = true; for (const [key, value] of writes) data.set(key, value);
      if (writes.length) committed(); tx.oncomplete?.(); complete();
    });
    return tx;
  }};
  return {store:() => createWorkspaceStore('isolated-clips', {openDatabase:async () => db, createChannel:() => null, eventTarget:null}), fail:() => { failNext = true; }, onCommit:callback => { committed = callback; }};
}
const request = (extra = {}) => ({version:1, requestId:randomUUID(), kind:'link', sourceUrl:'https://example.test/article#section', title:'一份网页', body:'网页简介', author:'原作者', siteName:'示例站点', ...extra});
const png = () => { const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'); return {name:'image.png', type:'image/png', size:bytes.length, dataUrl:`data:image/png;base64,${bytes.toString('base64')}`}; };
function setup(options = {}) { const fixture = createMemoryWorkspaceFixture(), session = createWorkspaceSession(fixture.store()), library = createClipperLibrary({session, workspaceId:'isolated-clips', ...options}); return {fixture, session, library}; }
const receiptKey = input => `clipper-capture-receipt:${input.requestId}`;

test('strict capture contract rejects malformed, credential-bearing, oversized and empty-article inputs', () => {
  for (const changed of [{version:2}, {requestId:'not-uuid'}, {kind:'script'}, {body:'x'.repeat(50001)}, {title:'x'.repeat(1001)}, {sourceUrl:'javascript:alert(1)'}, {sourceUrl:'https://user:secret@example.test/'}, {sourceUrl:'https://example.test/?access_token=secret'}, {sourceUrl:'https://example.test/?X-Amz-Credential=secret'}, {sourceUrl:'https://example.test/\nelse'}, {unknown:true}, {kind:'article', body:' \n\t'}, {kind:'link', imageUrl:'https://example.test/image.png'}, {kind:'image'}]) {
    assert.throws(() => normalizeClipperParams(request(changed)), {code:'INVALID_CLIPPER'});
  }
  const empty = normalizeClipperParams(request({title:'', body:''})); assert.equal(empty.title, 'example.test'); assert.equal(empty.body, '');
  const image = request({kind:'image', imageUrl:'https://example.test/image.png'});
  assert.equal(normalizeClipperParams(image).imageUrl, image.imageUrl);
  assert.throws(() => normalizeClipperParams(image, {requireImageAttachment:true}), {code:'IMAGE_NOT_DOWNLOADED'});
});

test('link capture atomically saves original metadata, membership and durable receipt without becoming a recall', async () => {
  const {fixture, session, library} = setup(), input = request(), result = await library.call('capture', input);
  assert.equal(result.duplicate, false); assert.equal(result.revision, 1); assert.match(result.captureReceipt.payloadHash, /^[a-f0-9]{64}$/);
  const card = session.state.cards[0]; assert.equal(card.id, `browser-clip:${input.requestId}`); assert.equal(card.body, input.body); assert.equal(card.sourceUrl, input.sourceUrl); assert.equal(card.author, input.author);
  assert.equal(card.type, 'link'); assert.equal(card.externalSource, undefined); assert.equal(card.recallReceipt, undefined);
  assert.deepEqual(session.state.savedIds, [card.id]); assert.deepEqual(session.state.collections[0].cardIds, [card.id]); assert.equal(session.state.collections[0].id, CLIPPER_COLLECTION_ID);
  assert.deepEqual(session.state.drafts[receiptKey(input)], result.captureReceipt);
  const other = createClipperLibrary({session:createWorkspaceSession(fixture.store()), workspaceId:'isolated-clips'});
  assert.equal((await other.call('capture', input)).duplicate, true);
});

test('article capture keeps paragraph text and source exactly and survives full backup roundtrip', async () => {
  const {session, library} = setup(), input = request({kind:'article', body:'第一段 🧪\n\n<script>这里是原文文字</script>\n\n[出处](https://example.test/)' });
  await library.call('capture', input); assert.equal(session.state.cards[0].type, 'article'); assert.equal(session.state.cards[0].body, input.body);
  const backup = parseWorkspaceBackup(serializeWorkspace(session.state)), restored = setup();
  await restored.session.commit(() => mergeWorkspaceBackup(normalizeWorkspaceState(), backup));
  const retried = await restored.library.call('capture', input); assert.equal(retried.duplicate, true); assert.equal(restored.session.state.cards.length, 1); assert.equal(restored.session.state.cards[0].body, input.body);
});

test('concurrent requests from two sessions and retries produce one card and never overwrite edits', async () => {
  const {fixture, session, library} = setup(), input = request(), other = createClipperLibrary({session:createWorkspaceSession(fixture.store()), workspaceId:'isolated-clips'});
  const results = await Promise.all([library.call('capture', input), other.call('capture', input)]);
  assert.equal(results.filter(value => value.duplicate).length, 1); assert.equal(results[0].item.id, results[1].item.id);
  await session.commit({type:'card.upsert', card:{id:results[0].item.id, title:'用户修改后的标题', body:'用户后续补充'}});
  const retry = await other.call('capture', input); assert.equal(retry.duplicate, true); assert.equal(retry.item.title, '用户修改后的标题');
  const saved = await fixture.store().load(); assert.equal(saved.cards.length, 1); assert.equal(saved.cards[0].body, '用户后续补充');
  await assert.rejects(other.call('capture', {...input, body:'同一请求改成别的内容'}), {code:'REQUEST_REUSED'});
});

test('failed transaction leaves original materials and recall states intact, and the same request can retry', async () => {
  const {fixture, session, library} = setup(), recall = createRecallLibrary({session, workspaceId:'isolated-clips'});
  const savedRecall = await recall.call('capture', {requestId:randomUUID(), title:'原回看', text:'需要保留的原话', externalSource:{version:1, provider:'deepseek-harness', instanceId:'fixture', sessionId:'original-thread', messageId:'one', eventSeq:1, turn:1, sessionTitle:'原对话'}});
  await session.commit([{type:'card.upsert', card:{id:'original-material', title:'原素材', body:'原正文'}}, {type:'card.save', id:'original-material', saved:true}, {type:'card.hide', id:savedRecall.item.id, hidden:true}, {type:'draft.set', key:'existing-reading-state', value:{read:{[savedRecall.item.id]:'original'}}}]);
  const before = structuredClone(session.state), input = request(); fixture.fail();
  await assert.rejects(library.call('capture', input), /synthetic commit failure/);
  await session.settled(); assert.deepEqual(await fixture.store().load(), before);
  const result = await library.call('capture', input), after = session.state;
  assert.equal(result.duplicate, false);
  assert.deepEqual(after.cards.filter(card => card.id !== result.item.id), before.cards);
  assert.deepEqual(after.collections.filter(value => value.id !== CLIPPER_COLLECTION_ID), before.collections);
  assert.deepEqual(after.collections.find(value => value.id === RECALL_COLLECTION_ID), before.collections.find(value => value.id === RECALL_COLLECTION_ID));
  assert.deepEqual(after.hiddenIds, before.hiddenIds); assert.deepEqual(after.drafts['existing-reading-state'], before.drafts['existing-reading-state']);
});

test('archive and manual unsave are not undone by capture or lookup retries', async () => {
  const {session, library} = setup(), input = request(), saved = await library.call('capture', input);
  await session.commit({type:'card.hide', id:saved.item.id, hidden:true});
  for (const method of ['capture', 'lookup']) await assert.rejects(library.call(method, input), {code:'CLIPPER_ARCHIVED'});
  assert.deepEqual(session.state.hiddenIds, [saved.item.id]);
  await session.commit([{type:'card.hide', id:saved.item.id, hidden:false}, {type:'card.save', id:saved.item.id, saved:false}]);
  await assert.rejects(library.call('capture', input), {code:'CLIPPER_NOT_FOUND'});
  assert.equal(session.state.savedIds.includes(saved.item.id), false);
});

test('image capture saves original bytes with page and image provenance; URL retries retain first bytes', async () => {
  const {session, library} = setup(), attachment = png(), input = request({kind:'image', imageUrl:'https://cdn.example.test/original.png', attachment});
  const result = await library.call('capture', input), card = session.state.cards[0];
  assert.equal(card.type, 'image'); assert.deepEqual(card.attachment, attachment); assert.equal(card.image, attachment.dataUrl); assert.equal(card.sourceUrl, input.sourceUrl); assert.ok(card.body.includes(input.imageUrl));
  const bytes = Buffer.from(attachment.dataUrl.split(',')[1], 'base64'); bytes[bytes.length - 1] ^= 1;
  const changedDownload = {...attachment, dataUrl:`data:image/png;base64,${bytes.toString('base64')}`};
  assert.deepEqual(clipperPayloadIdentity(input), clipperPayloadIdentity({...input, attachment:changedDownload}));
  const retry = await library.call('capture', {...input, attachment:changedDownload}); assert.equal(retry.item.id, result.item.id); assert.equal(retry.duplicate, true); assert.equal(session.state.cards[0].attachment.dataUrl, attachment.dataUrl);
  await assert.rejects(library.call('capture', {...input, imageUrl:'https://cdn.example.test/another.png'}), {code:'REQUEST_REUSED'});
});

test('invalid raster, fake type, mismatched size and oversize attachments do not create partial cards', async () => {
  const {session, library} = setup(), attachment = png();
  const html = Buffer.from('<html><script>unsafe()</script></html>');
  for (const bad of [{...attachment, name:'image.html'}, {...attachment, dataUrl:`data:image/png;base64,${html.toString('base64')}`, size:html.length}, {...attachment, size:attachment.size + 1}, {...attachment, type:'text/html'}, {...attachment, size:MAX_CLIPPER_IMAGE_BYTES + 1}]) {
    await assert.rejects(library.call('capture', request({kind:'image', imageUrl:'https://example.test/image.png', attachment:bad})), error => ['INVALID_CLIPPER', 'INVALID_CLIPPER_IMAGE'].includes(error.code));
  }
  await session.load(); assert.equal(session.state.cards.length, 0); assert.equal(session.state.collections.length, 0);
});

test('inline-only image identity binds image bytes because there is no derived download URL', async () => {
  const {session, library} = setup(), input = request({kind:'image', attachment:png()});
  await library.call('capture', input);
  const changed = {...input, attachment:{...input.attachment, name:'renamed.png'}};
  assert.notDeepEqual(clipperPayloadIdentity(input), clipperPayloadIdentity(changed));
  await assert.rejects(library.call('capture', changed), {code:'REQUEST_REUSED'}); assert.equal(session.state.cards.length, 1);
});

test('lookup finds image receipt without bytes or writes so a lost reply does not need a new download', async () => {
  const {session, library} = setup(), input = request({kind:'image', imageUrl:'https://cdn.example.test/expired-after-save.png', attachment:png()});
  const absent = await library.call('lookup', input); assert.equal(absent.found, false); assert.equal(absent.revision, 0);
  const saved = await library.call('capture', input), {attachment, ...originalRequest} = input;
  const found = await library.call('lookup', originalRequest); assert.equal(found.found, true); assert.equal(found.duplicate, true); assert.deepEqual(found.item, saved.item); assert.deepEqual(found.captureReceipt, saved.captureReceipt); assert.equal(found.revision, saved.revision);
  await assert.rejects(library.call('lookup', {...originalRequest, title:'被改写的新标题'}), {code:'REQUEST_REUSED'});
});

test('workspace switch while hashing prevents writing to either workspace', async () => {
  let current = true;
  const {session, library} = setup({isCurrent:() => current, hash:async () => { current = false; return 'a'.repeat(64); }});
  await assert.rejects(library.call('capture', request()), {code:'WORKSPACE_CHANGED'});
  await session.load(); assert.equal(session.state.cards.length, 0);
});

test('workspace switch after committed save rejects the stale acknowledgement and remains retryable', async () => {
  let current = true;
  const {fixture, session, library} = setup({isCurrent:() => current}), input = request();
  fixture.onCommit(() => { current = false; });
  await assert.rejects(library.call('capture', input), {code:'WORKSPACE_CHANGED'});
  assert.equal((await fixture.store().load()).cards.length, 1);
  fixture.onCommit(() => {}); current = true;
  assert.equal((await library.call('capture', input)).duplicate, true); assert.equal(session.state.cards.length, 1);
});

test('renderer bridge accepts only its workspace, cleans up readiness, and returns only committed replies', async () => {
  const {session} = setup(), listeners = new Set(), replies = [], ready = [];
  const api = {subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); }, async clipperReady(value) { ready.push(value); }, async clipperResult(value) { replies.push(value); }};
  const disconnect = connectClipperRenderer({api, session, workspaceId:'isolated-clips', isCurrent:() => true}), input = request();
  for (const listener of listeners) listener({type:'clipperRequest', workspaceId:'other-workspace', commandId:'wrong', method:'capture', params:input});
  await tick(); assert.equal(replies.length, 0);
  const waiting = new Promise(resolve => { api.clipperResult = async value => { replies.push(value); resolve(); }; });
  for (const listener of listeners) listener({type:'clipperRequest', workspaceId:'isolated-clips', commandId:'one', method:'capture', params:input});
  await waiting; assert.equal(replies[0].ok, true); assert.equal(replies[0].result.revision, 1); assert.equal(session.state.cards.length, 1);
  disconnect(); assert.equal(listeners.size, 0); assert.deepEqual(ready.map(value => value.ready), [true, false]);
});

const anchorFor = (exact, extra = {}) => ({version:1, exact, prefix:'', suffix:'', ...extra});
const collection = (id, title = id) => ({id, title, description:'', private:true, pinned:false, cardIds:[]});

test('legacy receipts remain replayable with the exact v0.1 identity and no new default fields', async () => {
  const {session, library} = setup();
  const input = request({requestId:'11111111-1111-4111-8111-111111111111'});
  const legacyIdentity = {version:1, requestId:input.requestId, kind:'link', sourceUrl:'https://example.test/article#section', title:'一份网页', body:'网页简介', author:'原作者', siteName:'示例站点'};
  assert.equal(JSON.stringify(clipperPayloadIdentity(input)), JSON.stringify(legacyIdentity));
  const payloadHash = createHash('sha256').update(JSON.stringify(legacyIdentity)).digest('hex'), id = `browser-clip:${input.requestId}`;
  await session.commit([{type:'card.upsert', card:{id, title:input.title, body:input.body, sourceUrl:input.sourceUrl, type:'link'}}, {type:'card.save', id, saved:true},
    {type:'draft.set', key:receiptKey(input), value:{requestId:input.requestId, payloadHash, itemId:id, savedAt:'2026-11-01T00:00:00.000Z'}}]);
  const before = structuredClone(session.state), repeated = await library.call('capture', input);
  assert.equal(repeated.duplicate, true); assert.deepEqual(session.state, before);
});

test('structured article and source-linked highlight survive a full backup without losing image bytes or anchors', async () => {
  const {session, library} = setup(), original = request({kind:'article', body:'一个标题\n\n段落和链接', article:{version:1, blocks:[
    {id:'title', type:'heading', level:2, runs:[{text:'一个标题'}]},
    {id:'paragraph', type:'paragraph', runs:[{text:'段落和', strong:true}, {text:'链接', href:'https://example.test/more'}]},
    {id:'picture', type:'image', src:'https://cdn.example.test/figure.png', alt:'原图说明', attachment:png()},
  ]}});
  const article = await library.call('capture', original);
  const quote = '段落和链接', input = request({kind:'highlight', title:'从文章摘录', body:quote, anchor:anchorFor(quote, {prefix:'一个标题 ', start:5, end:5 + quote.length}), sourceCardId:article.item.id});
  const savedHighlight = await library.call('capture', input);
  assert.deepEqual(session.state.cards.find(card => card.id === article.item.id).article, normalizeClipperParams(original).article);
  assert.deepEqual(session.state.cards.find(card => card.id === savedHighlight.item.id).webAnchor, normalizeClipperParams(input).anchor);
  const restored = setup(), backup = parseWorkspaceBackup(serializeWorkspace(session.state));
  await restored.session.commit(() => mergeWorkspaceBackup(normalizeWorkspaceState(), backup));
  const restoredArticle = restored.session.state.cards.find(card => card.id === article.item.id);
  assert.deepEqual(restoredArticle.article.blocks.find(block => block.type === 'image').attachment, png());
  assert.equal(restored.session.state.cards.find(card => card.id === savedHighlight.item.id).sourceCardId, article.item.id);
  assert.equal((await restored.library.call('capture', original)).duplicate, true);
  assert.equal((await restored.library.call('capture', input)).duplicate, true);
});
test('table cells, numbered lists and their image originals survive session reopen, backup and original-request retry', async () => {
  const {fixture, session, library} = setup();
  await session.commit([{type:'card.upsert', card:{id:'old-article', title:'既有文章', body:'既有正文', type:'article'}}, {type:'card.save', id:'old-article', saved:true}]);
  const original = structuredClone(session.state.cards[0]);
  const article = {version:1, blocks:[
    {id:'list', type:'list-item', marker:'5.', depth:1, runs:[{text:'编号项'}]},
    {id:'table', type:'table', rows:[{cells:[{runs:[], header:false}, {runs:[{text:'表内文字', href:'https://example.test/reference'}], header:true, colspan:2}]}], imagesAfter:true},
    {id:'image', type:'image', src:'https://cdn.example.test/table-image.png', alt:'表内图片', attachment:png()},
  ]};
  const input = request({kind:'article', body:articlePlainText(article), article, note:'表格备注', favorite:true}), saved = await library.call('capture', input);
  const reopened = createClipperLibrary({session:createWorkspaceSession(fixture.store()), workspaceId:'isolated-clips'});
  assert.equal((await reopened.call('capture', input)).duplicate, true);
  const backup = parseWorkspaceBackup(serializeWorkspace(await fixture.store().load())), restored = setup();
  await restored.session.commit(() => mergeWorkspaceBackup(normalizeWorkspaceState(), backup));
  const card = restored.session.state.cards.find(card => card.id === saved.item.id);
  assert.deepEqual(card.article, normalizeClipperParams(input).article); assert.equal(card.body, articlePlainText(card.article));
  assert.equal(card.article.blocks[2].attachment.dataUrl, png().dataUrl);
  assert.deepEqual(restored.session.state.cards.find(card => card.id === 'old-article'), original);
  assert.equal((await restored.library.call('capture', input)).duplicate, true);
});

test('capture atomically applies selected collections, note and favorite while an explicit empty selection stays unfiled', async () => {
  const {session, library} = setup();
  await session.commit([{type:'collection.upsert', collection:collection('research', '研究')}, {type:'collection.upsert', collection:collection('writing', '写作')}]);
  const input = request({note:'收录时写下的备注', favorite:true, collectionIds:['research', 'writing']}), saved = await library.call('capture', input);
  assert.deepEqual(session.state.annotations[saved.item.id].collectionIds, ['research', 'writing']);
  assert.equal(session.state.annotations[saved.item.id].note, input.note); assert.equal(session.state.favoriteIds.includes(saved.item.id), true);
  assert.equal(session.state.collections.some(value => value.id === CLIPPER_COLLECTION_ID), false);
  for (const target of session.state.collections) assert.deepEqual(target.cardIds, [saved.item.id]);
  const other = await library.call('capture', request({collectionIds:[], note:'', favorite:false}));
  assert.equal(session.state.savedIds.includes(other.item.id), true); assert.equal(session.state.favoriteIds.includes(other.item.id), false);
  assert.equal(session.state.annotations[other.item.id].note, ''); assert.deepEqual(session.state.annotations[other.item.id].collectionIds, []);
  assert.equal(session.state.collections.some(value => value.id === CLIPPER_COLLECTION_ID), false);
});

test('unknown collections and cross-page or unavailable source articles reject without partial metadata', async () => {
  const {session, library} = setup();
  await assert.rejects(library.call('capture', request({collectionIds:['missing'], note:'未写入', favorite:true})), {code:'CLIPPER_COLLECTION_NOT_FOUND'});
  await session.load(); assert.equal(session.state.cards.length, 0); assert.equal(session.state.collections.length, 0); assert.deepEqual(session.state.annotations, {});
  const source = await library.call('capture', request({kind:'article', body:'原文章正文'}));
  const quote = request({kind:'highlight', body:'正文', anchor:anchorFor('正文'), sourceCardId:source.item.id});
  const before = structuredClone(session.state);
  await assert.rejects(library.call('capture', {...quote, sourceUrl:'https://example.test/another'}), {code:'CLIPPER_SOURCE_NOT_FOUND'});
  await assert.rejects(library.call('capture', {...quote, sourceCardId:'missing-source'}), {code:'CLIPPER_SOURCE_NOT_FOUND'});
  assert.deepEqual(session.state, before);
  await session.commit({type:'card.hide', id:source.item.id, hidden:true});
  await assert.rejects(library.call('capture', quote), {code:'CLIPPER_SOURCE_NOT_FOUND'});
  assert.equal(session.state.cards.length, 1);
});

test('retry preserves user-edited note, favorite, deleted membership and archived source article', async () => {
  const {fixture, session, library} = setup();
  await session.commit({type:'collection.upsert', collection:collection('original-choice')});
  const article = await library.call('capture', request({kind:'article', body:'原文段落'}));
  const input = request({kind:'highlight', body:'原文段落', anchor:anchorFor('原文段落'), sourceCardId:article.item.id, note:'初始备注', favorite:true, collectionIds:['original-choice']});
  const saved = await library.call('capture', input);
  // A newly opened editor uses the current collection revision. Reusing the
  // collection-creation edit base would correctly report a stale-editor
  // conflict after the intervening capture changed its membership.
  const editor = createWorkspaceSession(fixture.store()); await editor.load();
  await editor.commit([{type:'card.note', id:saved.item.id, note:'后续编辑'}, {type:'card.favorite', id:saved.item.id, value:false}, {type:'collection.delete', id:'original-choice'}, {type:'card.hide', id:article.item.id, hidden:true}]);
  await session.load();
  const before = structuredClone(session.state), repeated = await library.call('capture', input);
  assert.equal(repeated.duplicate, true); assert.deepEqual(session.state, before);
  await assert.rejects(library.call('capture', {...input, note:'更改了原请求'}), {code:'REQUEST_REUSED'});
});

test('collection metadata pagination is read-only, includes a virtual default and never discloses contents', async () => {
  const {session, library} = setup();
  const empty = await library.call('collections', {});
  assert.equal(empty.revision, 0); assert.equal(empty.total, 1); assert.equal(empty.items[0].id, CLIPPER_COLLECTION_ID); assert.equal(session.state.collections.length, 0);
  await session.commit([{type:'collection.upsert', collection:collection('first')}, {type:'collection.upsert', collection:collection('second')}]);
  const before = structuredClone(session.state), items = []; let offset = 0;
  do {const result = await library.call('collections', {offset, limit:1}); items.push(...result.items); offset = result.nextOffset;} while (offset !== null);
  assert.deepEqual(items.map(value => value.id), [CLIPPER_COLLECTION_ID, 'first', 'second']);
  assert.deepEqual(Object.keys(items[0]).sort(), ['id', 'private', 'title']); assert.deepEqual(session.state, before);
  for (const raw of [{limit:51}, {offset:-1}, {limit:0}, {sourceUrl:'https://example.test/'}, {unknown:true}]) await assert.rejects(library.call('collections', raw), {code:'INVALID_CLIPPER'});
});

test('page highlight query isolates exact page identity, excludes hidden or unsaved cards, and paginates without writes', async () => {
  const {session, library} = setup();
  const capture = async extra => library.call('capture', request({kind:'highlight', body:'可定位的原文', anchor:anchorFor('可定位的原文'), ...extra}));
  const first = await capture({favorite:true, note:'不会对网页返回的私密备注'}), second = await capture({sourceUrl:'https://example.test/article#other'});
  const hidden = await capture(), unsaved = await capture();
  await capture({sourceUrl:'https://example.test/article?different=1'}); await capture({sourceUrl:'https://example.test/elsewhere'});
  await session.commit([{type:'card.hide', id:hidden.item.id, hidden:true}, {type:'card.save', id:unsaved.item.id, saved:false}]);
  const before = structuredClone(session.state), one = await library.call('highlights', {sourceUrl:'https://example.test/article#:~:text=anything', limit:1});
  assert.equal(one.total, 2); assert.equal(one.items.length, 1); assert.equal(one.items[0].id, first.item.id); assert.equal(one.items[0].favorite, true); assert.equal(one.nextOffset, 1);
  const two = await library.call('highlights', {sourceUrl:'https://example.test/article', offset:one.nextOffset, limit:1});
  assert.equal(two.items[0].id, second.item.id); assert.equal(two.nextOffset, null);
  assert.deepEqual(Object.keys(one.items[0]).sort(), ['anchor', 'favorite', 'id', 'sourceCardId', 'title']);
  one.items[0].anchor.exact = '调用方修改'; assert.deepEqual(session.state, before);
  assert.equal((await library.call('highlights', {sourceUrl:'https://other.example.test/article'})).total, 0);
  for (const raw of [{}, {sourceUrl:'javascript:bad'}, {sourceUrl:'https://example.test/', offset:-1}, {sourceUrl:'https://example.test/', limit:51}]) await assert.rejects(library.call('highlights', raw), {code:'INVALID_CLIPPER'});
});

test('large page quotes use a bounded native response and remain reachable on subsequent pages', async () => {
  const {library} = setup(), exact = '文'.repeat(50000);
  const first = await library.call('capture', request({kind:'highlight', body:exact, anchor:anchorFor(exact)}));
  const second = await library.call('capture', request({kind:'highlight', body:exact, anchor:anchorFor(exact)}));
  const one = await library.call('highlights', {sourceUrl:'https://example.test/article', limit:50});
  assert.equal(one.total, 2); assert.equal(one.items.length, 1); assert.equal(one.items[0].id, first.item.id); assert.equal(one.nextOffset, 1);
  assert.ok(new TextEncoder().encode(JSON.stringify(one)).length < 256 * 1024);
  const two = await library.call('highlights', {sourceUrl:'https://example.test/article', offset:one.nextOffset, limit:50});
  assert.equal(two.items[0].id, second.item.id); assert.equal(two.nextOffset, null);
});

test('failure while saving organized content leaves card, note, star, membership and receipt absent', async () => {
  const {fixture, session, library} = setup();
  await session.commit({type:'collection.upsert', collection:collection('organized')});
  const before = structuredClone(session.state), input = request({note:'事务内备注', favorite:true, collectionIds:['organized']});
  fixture.fail(); await assert.rejects(library.call('capture', input), /synthetic commit failure/);
  await session.settled(); assert.deepEqual(session.state, before);
  assert.equal((await library.call('capture', input)).duplicate, false); assert.equal(session.state.annotations[`browser-clip:${input.requestId}`].note, input.note);
});

test('screenshots keep the page as provenance, preserve the exact original on retry, and do not enter recall',async()=>{
 const {session,library}=setup(), data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
 const photo=request({kind:'image',screenshot:'region',title:'网页选区 · CERN',siteName:'原网页标题',sourceUrl:'https://example.org/cern#fig2',body:'',attachment:{name:'网页选区.png',type:'image/png',size:Buffer.from(data,'base64').length,dataUrl:'data:image/png;base64,'+data}});
 const one=await library.call('capture',photo);const again=await library.call('capture',photo);
 assert.equal(again.duplicate,true);assert.equal(one.item.id,again.item.id);const [card]=session.state.cards;
 assert.equal(card.type,'image');assert.equal(card.sourceTitle,'原网页标题');assert.equal(card.sourceLocation,'网页截图 · 选区');assert.equal(card.sourceUrl,photo.sourceUrl);assert.equal(card.attachment.dataUrl,photo.attachment.dataUrl);assert.equal(card.recallReceipt,undefined);
 await assert.rejects(library.call('capture',{...photo,screenshot:'viewport'}),{code:'REQUEST_REUSED'});
 assert.throws(()=>normalizeClipperParams({...photo,imageUrl:'https://example.org/not-an-image-original'}));
});

test('inline related results are bounded by a real receipt and current library; opening rechecks live membership without a write',async()=>{
 const {session}=setup(),opened=[],page='https://example.org/cern';
 let vault=[{id:'vault/original.md',type:'article',title:'万维网提案',sourceUrl:page}];
 const library=createClipperLibrary({session,workspaceId:'isolated-clips',getVaultCards:()=>vault,onOpenCard:id=>opened.push(id)});
 await session.commit([{type:'card.upsert',card:{id:'hidden',title:'归档原件',sourceUrl:page,type:'article'}},{type:'card.save',id:'hidden',saved:true},{type:'card.hide',id:'hidden',hidden:true},{type:'card.upsert',card:{id:'draft',title:'草稿',sourceUrl:page,type:'article'}}]);
 const input=request({sourceUrl:page,title:'网页截图 · CERN'});await library.call('capture',input);
 const query={requestId:input.requestId,workspaceId:'isolated-clips'},revision=session.revision;
 const result=await library.call('related',query);assert.deepEqual(result.items,[{id:'vault/original.md',title:'万维网提案',type:'文章',reason:'来自同一网页'}]);
 await library.call('openRelated',{...query,cardId:vault[0].id});assert.deepEqual(opened,['vault/original.md']);
 await assert.rejects(library.call('related',{...query,workspaceId:'other'}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(library.call('related',{...query,requestId:randomUUID()}),{code:'CLIPPER_NOT_FOUND'});
 await assert.rejects(library.call('openRelated',{...query,cardId:'hidden'}),{code:'CLIPPER_NOT_FOUND'});
 vault=[];await assert.rejects(library.call('openRelated',{...query,cardId:'vault/original.md'}),{code:'CLIPPER_NOT_FOUND'});
 assert.equal((await library.call('related',query)).items.length,0);assert.equal(session.revision,revision);
});
