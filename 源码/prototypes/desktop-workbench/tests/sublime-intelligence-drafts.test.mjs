import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AI_RESULT_PREFIX, aiResultKey, compactAiSource, captureAiSource, normalizeAiRecord, listAiRecords, isSameAiSourceVersion, insightSaveActions} from '../src/sublime/intelligenceDrafts.js';
import {createWorkspaceState, workspaceReducer, serializeWorkspace, parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
import {createWorkspaceStore} from '../src/sublime/workspaceStore.js';

const requestId = '12345678-1234-4234-8234-123456789abc';
const createdAt = '2026-10-04T01:00:00.000Z', updatedAt = '2026-10-04T01:00:01.000Z', savedAt = '2026-10-04T01:00:02.000Z';
const source = {id:'original', path:'original', origin:'local', type:'text', title:'原始标题', body:'原始正文', tags:['原标签'], updatedAt:createdAt};
const result = {text:'第一行完整结果。\n\n  最后一行仍保留空格。  ', engine:'fixture-only', local:false, usage:{prompt_tokens:12, completion_tokens:20, total_tokens:32}};
const complete = changes => normalizeAiRecord({id:requestId, mode:'The Gist', phase:'complete', sourceSnapshot:source, result, createdAt, updatedAt, ...changes});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const attachment = {name:'fixture.png', type:'image/png', size:png.length, dataUrl:`data:image/png;base64,${png.toString('base64')}`};
const roundtrip = state => parseWorkspaceBackup(serializeWorkspace(state));
const apply = (state, operation) => operation.actions.reduce(workspaceReducer, state);

// This isolated IndexedDB interface provides shared transaction locking and
// abort behavior. The production store, reducer, serializer and updater execute
// unchanged; neither a browser profile nor a network service is touched.
function fixtureStores() {
  const data = new Map(); let tail = Promise.resolve();
  const db = {transaction(name, mode) {
    assert.equal(name, 'workspaces'); let finish, ended = false;
    const previous = tail; tail = new Promise(resolve => { finish = resolve; });
    const reads = [], writes = [];
    const tx = {objectStore() { return {
      get(key) { const request = {}; reads.push(() => { request.result = structuredClone(data.get(key)); request.onsuccess?.(); }); return request; },
      put(value, key) { assert.equal(mode, 'readwrite'); writes.push([key, structuredClone(value)]); },
    }; }, abort() { ended = true; queueMicrotask(() => { tx.onabort?.(); finish(); }); }};
    previous.then(async () => {
      await new Promise(resolve => setImmediate(resolve)); if (ended) return;
      for (const read of reads) { if (ended) break; read(); }
      await new Promise(resolve => setImmediate(resolve)); if (ended) return;
      ended = true; for (const [key, value] of writes) data.set(key, value); tx.oncomplete?.(); finish();
    }); return tx;
  }};
  const open = () => createWorkspaceStore('synthetic-ai-results', {openDatabase:async () => db, createChannel:() => null, eventTarget:null});
  return {data, one:open(), two:open(), reopen:open};
}

test('request keys and history are isolated, validated, ordered, and never automatically evicted', () => {
  assert.equal(AI_RESULT_PREFIX, 'ai-result:'); assert.equal(aiResultKey(requestId.toUpperCase()), AI_RESULT_PREFIX + requestId);
  for (const value of ['../outside', '', 'api-key', null]) assert.throws(() => aiResultKey(value), /UUID/);
  const drafts = {'new:text':{body:'untouched'}, [aiResultKey(requestId)]:complete(), 'ai-result:invalid':complete()};
  for (let i = 0; i < 80; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    drafts[aiResultKey(id)] = complete({id, updatedAt:new Date(Date.parse(updatedAt) + i * 1000).toISOString()});
  }
  drafts['ai-result:ffffffff-ffff-ffff-ffff-ffffffffffff'] = {...complete(), id:'ffffffff-ffff-ffff-ffff-ffffffffffff', result:{text:'x', apiKey:'never-allow'}};
  const records = listAiRecords(drafts); assert.equal(records.length, 81); assert.equal(records[0].id.endsWith('000000000079'), true);
  assert.deepEqual(listAiRecords(null), []); assert.deepEqual(drafts['new:text'], {body:'untouched'});
});

test('source snapshots whitelist attribution and metadata while excluding credentials and original bytes', async () => {
  const image = {...source, type:'image', attachment, image:attachment.dataUrl, apiKey:'secret-fixture', credentials:{token:'secret-fixture'}, documentIndex:{text:'indexed words', pages:[{text:'ignored'}]}, version:7, sourceTitle:'出处', author:'作者'};
  const compact = compactAiSource(image), captured = await captureAiSource(image);
  assert.deepEqual(compact.attachmentMeta, {name:attachment.name, type:attachment.type, size:attachment.size});
  assert.equal(captured.attachmentMeta.sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(captured.version, 7); assert.equal(captured.author, '作者'); assert.equal(captured.documentIndex.text, 'indexed words');
  for (const field of ['attachment', 'image', 'dataUrl', 'apiKey', 'credentials']) assert.equal(Object.hasOwn(captured, field), false);
  const encoded = JSON.stringify(captured); assert.equal(encoded.includes('base64'), false); assert.equal(encoded.includes('secret-fixture'), false);
  assert.equal(image.attachment.dataUrl, attachment.dataUrl); assert.deepEqual(compactAiSource(captured), captured);
  await assert.rejects(captureAiSource({...image, attachment:{...attachment, size:attachment.size + 1}}), /字节数/);
});

test('source version matching verifies bytes as well as text, metadata and source location', async () => {
  const image = {...source, type:'image', attachment, originalPath:'originals/fixture.png', originalMime:'image/png'};
  const captured = await captureAiSource(image);
  assert.equal(isSameAiSourceVersion(captured, await captureAiSource(image)), true);
  assert.equal(isSameAiSourceVersion(captured, image), false, 'unhashed raw bytes must be recaptured');
  assert.equal(isSameAiSourceVersion(compactAiSource(image), compactAiSource(image)), false, 'matching metadata alone is insufficient');
  const changedBytes = Buffer.from(png); changedBytes[changedBytes.length - 1] ^= 1;
  const changedAttachment = {...attachment, dataUrl:`data:image/png;base64,${changedBytes.toString('base64')}`};
  assert.equal(isSameAiSourceVersion(captured, await captureAiSource({...image, attachment:changedAttachment})), false);
  for (const changes of [{body:'edited'}, {title:'edited'}, {updatedAt}, {originalPath:'other.png'}, {tags:['edited']}, {originalMime:'image/jpeg'}, {version:2}]) {
    assert.equal(isSameAiSourceVersion(captured, {...captured, ...changes}), false);
  }
  assert.equal(isSameAiSourceVersion(source, {...source}), true); assert.equal(isSameAiSourceVersion(source, null), false);
});

test('large existing source text is retained through workspace backup without increasing the model result limit', () => {
  const body = '长'.repeat(1000000), ocrText = '识'.repeat(1000000);
  const record = complete({sourceSnapshot:{...source, body, ocrText}});
  const state = workspaceReducer(createWorkspaceState(), {type:'draft.set', key:aiResultKey(record.id), value:record});
  const reopened = listAiRecords(roundtrip(state).drafts)[0];
  assert.equal(reopened.sourceSnapshot.body, body); assert.equal(reopened.sourceSnapshot.ocrText, ocrText);
  assert.equal(isSameAiSourceVersion(record.sourceSnapshot, {...source, body, ocrText}), true);
  assert.throws(() => compactAiSource({...source, body:body + '越界'}), /1000000/);
  assert.throws(() => compactAiSource({...source, ocrText:ocrText + '越界'}), /1000000/);
  assert.throws(() => complete({result:{text:'果'.repeat(100001)}}), /100000/);
});

test('pending, complete, failed and classification results roundtrip with exact text and no secrets or base64', () => {
  const pending = complete({phase:'pending', result:null});
  const failed = complete({phase:'failed', result:null, error:'调用取消，未自动重试'});
  const classification = complete({mode:'Classification', result:{tags:['建议'], collectionIds:['collection'], reason:'建议理由', engine:'fixture'}});
  const ocr = complete({mode:'OCR', result:{text:'识别结果', local:true, pages:[{page:1, text:'识别结果', engine:'fixture'}]}});
  for (const record of [pending, complete(), failed, classification, ocr]) {
    const saved = workspaceReducer(createWorkspaceState(), {type:'draft.set', key:aiResultKey(record.id), value:record});
    assert.deepEqual(listAiRecords(roundtrip(saved).drafts), [record]);
  }
  assert.equal(complete().result.text, result.text);
  assert.equal(complete({result:{...result, mode:'The Gist'}}).result.mode, 'The Gist');
  assert.throws(() => complete({result:{...result, mode:'Visual analysis'}}), /响应方式与请求不一致/);
  for (const changes of [{apiKey:'secret'}, {result:{...result, key:'secret'}}, {result:{...result, attachment}}, {result:{...result, text:'x'.repeat(100001)}}, {result:{...result, usage:{total_tokens:NaN}}}, {sourceSnapshot:{...source, body:new Date()}}, {updatedAt:'not a date'}, {mode:'Settings'}, {phase:'pending'}]) {
    assert.throws(() => complete(changes), /AI 结果草稿无效/);
  }
  assert.throws(() => normalizeAiRecord(Object.assign(Object.create({}), complete())), /JSON/);
});

test('quoted data URLs remain ordinary text while raw attachment fields stay excluded', () => {
  const prose = 'HTML 示例：data:image/png;base64,iVBORw0KGgo=；这里只是在说明编码格式。';
  const record = complete({sourceSnapshot:{...source, body:prose}, result:{...result, text:prose}});
  const reopened = listAiRecords(roundtrip(workspaceReducer(createWorkspaceState(), {type:'draft.set', key:aiResultKey(record.id), value:record})).drafts)[0];
  assert.equal(reopened.result.text, prose);
  assert.equal(reopened.sourceSnapshot.body, prose);
  assert.throws(() => complete({result:{...result, dataUrl:attachment.dataUrl}}), /未允许/);
});

test('schema-invalid returned text is retained as copy-only recovery through restart', () => {
  const recoveryText = '服务返回原文\0需人工核对';
  const record = complete({phase:'failed', result:null, error:'校验未完成', recoveryText});
  const state = roundtrip(workspaceReducer(createWorkspaceState(), {type:'draft.set', key:aiResultKey(record.id), value:record}));
  assert.equal(listAiRecords(state.drafts)[0].recoveryText, recoveryText);
  assert.throws(() => insightSaveActions(state, record), /只有已完成/);
});

test('older oversized OCR drafts remain readable instead of disappearing after the limit alignment', () => {
  const text = '旧'.repeat(1000001);
  const record = complete({mode:'OCR', result:{text, local:true, pages:[]}});
  const state = roundtrip(workspaceReducer(createWorkspaceState(), {type:'draft.set', key:aiResultKey(record.id), value:record}));
  assert.equal(listAiRecords(state.drafts)[0].result.text, text);
});

test('a completed image insight atomically creates one text note and its saved receipt through reducer and serialization', async () => {
  const record = complete({mode:'Image description', sourceSnapshot:await captureAiSource({...source, type:'image', attachment})});
  const initial = workspaceReducer(createWorkspaceState(), {type:'draft.set', key:aiResultKey(record.id), value:record});
  const operation = insightSaveActions(initial, record, {now:savedAt});
  assert.equal(operation.created, true); assert.equal(operation.cardId, `ai-insight:${requestId}`); assert.deepEqual(operation.actions.map(action => action.type), ['card.upsert', 'card.save', 'draft.set']);
  const persisted = roundtrip(apply(initial, operation)), note = persisted.cards[0];
  assert.equal(note.body, result.text); assert.equal(note.sourceCardId, source.id); assert.equal(note.type, 'text'); assert.equal(note.attachment, null); assert.equal(note.image, '');
  assert.deepEqual(persisted.savedIds, [operation.cardId]); assert.equal(persisted.drafts[aiResultKey(record.id)].savedCardId, note.id);
  assert.equal(serializeWorkspace(persisted).includes('base64'), false); assert.equal(initial.cards.length, 0);
});

test('repeated or delayed saves retain user edits, archived state, favorites and the original result receipt', () => {
  const record = complete(), first = insightSaveActions(createWorkspaceState(), record, {now:savedAt});
  let state = apply(createWorkspaceState(), first);
  state = [{type:'card.upsert', card:{id:first.cardId, title:'用户修改的标题', body:'用户修改的正文'}}, {type:'card.save', id:first.cardId, saved:false}, {type:'card.hide', id:first.cardId, hidden:true}, {type:'card.favorite', id:first.cardId, value:true}].reduce(workspaceReducer, state);
  const before = roundtrip(state), retry = insightSaveActions(state, record, {now:savedAt});
  assert.equal(retry.created, false); assert.deepEqual(retry.actions.map(action => action.type), ['draft.set']);
  const after = roundtrip(apply(state, retry));
  for (const field of ['cards', 'savedIds', 'hiddenIds', 'favoriteIds']) assert.deepEqual(after[field], before[field]);
  assert.equal(after.cards.length, 1); assert.equal(after.drafts[aiResultKey(record.id)].result.text, result.text);
  assert.throws(() => insightSaveActions(state, {...record, result:{...result, text:'different response'}}, {now:savedAt}), /同一请求的结果已变化/);
  assert.throws(() => insightSaveActions({...state, cards:[]}, record, {now:savedAt}), /不会自动重新创建/);
});

test('two real store connections saving the same request concurrently create a single note and receipt', async () => {
  const {one, two, reopen} = fixtureStores(), record = complete();
  await one.update(state => workspaceReducer(state, {type:'draft.set', key:aiResultKey(record.id), value:record}));
  await Promise.all([one.load(), two.load()]); const observed = [];
  const save = store => store.update(current => { const operation = insightSaveActions(current, record, {now:savedAt}); observed.push(operation.created); return apply(current, operation); });
  await Promise.all([save(one), save(two)]);
  const reopened = await reopen().load(); assert.deepEqual(observed.sort(), [false, true]); assert.equal(reopened.cards.length, 1); assert.equal(reopened.savedIds.length, 1); assert.equal(listAiRecords(reopened.drafts)[0].savedCardId, reopened.cards[0].id);
  await two.update(state => [{type:'card.upsert', card:{id:reopened.cards[0].id, body:'另一窗口的编辑'}}, {type:'card.save', id:reopened.cards[0].id, saved:false}].reduce(workspaceReducer, state));
  await save(one); const afterRetry = await reopen().load(); assert.equal(afterRetry.cards[0].body, '另一窗口的编辑'); assert.deepEqual(afterRetry.savedIds, []); assert.equal(afterRetry.cards.length, 1);
  one.close(); two.close();
});

test('an aborted save transaction leaves no partial card or receipt, and retry then succeeds without another result', async () => {
  const {one, two} = fixtureStores(), record = complete();
  await one.update(state => workspaceReducer(state, {type:'draft.set', key:aiResultKey(record.id), value:record}));
  await assert.rejects(one.update(state => { apply(state, insightSaveActions(state, record, {now:savedAt})); throw Error('synthetic transaction failure'); }), /synthetic transaction failure/);
  const failed = await two.load(); assert.equal(failed.cards.length, 0); assert.equal(listAiRecords(failed.drafts)[0].savedCardId, ''); assert.equal(listAiRecords(failed.drafts)[0].result.text, result.text);
  await one.update(state => apply(state, insightSaveActions(state, record, {now:savedAt})));
  const recovered = await two.load(); assert.equal(recovered.cards.length, 1); assert.equal(recovered.drafts[aiResultKey(record.id)].savedCardId, recovered.cards[0].id);
  one.close(); two.close();
});
