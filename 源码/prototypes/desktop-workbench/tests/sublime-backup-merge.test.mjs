import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceState, normalizeWorkspaceState, mergeWorkspaceBackup, previewWorkspaceBackupMerge, parseWorkspaceBackup, serializeWorkspace} from '../src/sublime/workspaceModel.js';

const card = (id, extra = {}) => ({id, path:`local/${id}`, title:id, body:`Body ${id}`, origin:'local', ...extra});
const collection = (id, cardIds = [], extra = {}) => ({id, title:id, cardIds, ...extra});
const node = (id, itemPath) => ({id, itemPath, x:10, y:20});
const board = (id, nodes = [], edges = [], extra = {}) => ({id, title:id, nodes, edges, ...extra});
const state = extra => normalizeWorkspaceState({...createWorkspaceState(), ...extra});
const noteRecoveries = (workspace, cardId) => Object.entries(workspace.drafts).filter(([key, record]) => key.startsWith('window-draft:') && record?.key === `note:${cardId}`);

test('a full backup recovers a loaded native note without adopting its flags or changing the current workspace', () => {
  const cardId = '01_sources/cards/text/native.md', note = `  完整本机备注\n${'正文'.repeat(24990)}\n原样保留  `;
  const current = createWorkspaceState();
  const backup = parseWorkspaceBackup(serializeWorkspace(state({
    savedIds:[cardId], favoriteIds:[cardId], hiddenIds:[cardId], annotations:{[cardId]:{note, private:true}},
  })));
  const context = {knownCardIds:[cardId], knownCardPaths:[cardId]}, currentBefore = structuredClone(current), backupBefore = structuredClone(backup);
  const merged = mergeWorkspaceBackup(current, backup, context), recovered = noteRecoveries(merged, cardId);
  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0][1], {key:`note:${cardId}`, value:{note, private:true}, base:null, adoptedFrom:null, imported:true, recoveryOnly:true, conflict:true});
  assert.deepEqual({...merged, drafts:{}}, current);
  assert.deepEqual(current, currentBefore);
  assert.deepEqual(backup, backupBefore);
  const preview = previewWorkspaceBackupMerge(current, backup, context);
  assert.equal(preview.recoveredNotes, 1);
  assert.equal(preview.recoveryDrafts, 1);
  assert.equal(preview.addedDrafts, 1);
  assert.deepEqual(parseWorkspaceBackup(serializeWorkspace(merged)), merged);
});

test('cleared, null and absent current notes stay current while older nonempty notes remain recoverable', () => {
  for (const annotations of [{existing:{note:'', private:true}}, {existing:{note:null, private:false}}, {}]) {
    const current = state({cards:[card('existing')], annotations});
    const backup = state({cards:[card('existing', {body:'Old body'})], annotations:{existing:{note:'Former note', private:false}}});
    const merged = mergeWorkspaceBackup(current, backup);
    assert.deepEqual(merged.cards, current.cards);
    assert.deepEqual(merged.annotations, current.annotations);
    assert.deepEqual(noteRecoveries(merged, 'existing').map(([, record]) => record.value), [{note:'Former note', private:false}]);
  }
});

test('equal, null, empty and whitespace-only backup notes do not create recovery copies', () => {
  const current = state({cards:[card('existing')], annotations:{existing:{note:'Same note', private:false}}});
  for (const note of ['Same note', null, '', ' \n\t ']) {
    const backup = state({cards:[card('existing')], annotations:{existing:{note, private:true}}});
    assert.deepEqual(mergeWorkspaceBackup(current, backup), current);
    const preview = previewWorkspaceBackupMerge(current, backup);
    assert.equal(preview.recoveredNotes, 0);
    assert.equal(preview.recoveryDrafts, 0);
    assert.equal(preview.addedDrafts, 0);
  }
});

test('a note whose original card is absent stays a manual recovery without resurrecting entities or Vault requests', () => {
  const backup = state({
    savedIds:['missing'], favoriteIds:['missing'], hiddenIds:['missing'], annotations:{missing:{note:'Recover without original source', private:true}},
    drafts:{'window-draft:old:vault%3Amissing':{key:'vault:missing', value:{operationId:'never-replay'}, base:null}},
  });
  const merged = mergeWorkspaceBackup(createWorkspaceState(), backup);
  assert.deepEqual({...merged, drafts:{}}, createWorkspaceState());
  const recovered = noteRecoveries(merged, 'missing');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0][1].recoveryOnly, true);
  assert.equal(recovered[0][1].conflict, true);
  assert.deepEqual(recovered[0][1].value, {note:'Recover without original source', private:true});
  assert.equal(Object.hasOwn(merged.drafts, 'window-draft:old:vault%3Amissing'), false);
  const preview = previewWorkspaceBackupMerge(createWorkspaceState(), backup);
  assert.equal(preview.skippedExternalReferences, 1);
  assert.equal(preview.skippedDrafts, 1);
  assert.equal(preview.recoveredNotes, 1);
});

test('recovered annotations cannot make an old embedded body shadow a loaded native source', () => {
  const cardId = 'native/source.md', context = {knownCardIds:[cardId], knownCardPaths:[cardId]};
  const current = state({annotations:{[cardId]:{note:'Current note', private:false}}});
  const backup = state({cards:[card(cardId, {body:'Old native body', origin:'vault'})], annotations:{[cardId]:{note:'Old native note', private:true}}});
  const merged = mergeWorkspaceBackup(current, backup, context);
  assert.deepEqual(merged.cards, []);
  assert.deepEqual(merged.annotations, current.annotations);
  assert.deepEqual(noteRecoveries(merged, cardId).map(([, record]) => record.value), [{note:'Old native note', private:true}]);
  assert.equal(previewWorkspaceBackupMerge(current, backup, context).preservedCards, 1);
});

test('annotation recovery is stable across repeat imports and survives occupied recovery keys', () => {
  const backup = state({annotations:{missing:{note:'Original note', private:true}}});
  const first = mergeWorkspaceBackup(createWorkspaceState(), backup);
  const [key, recovery] = noteRecoveries(first, 'missing')[0] || [];
  assert.ok(key, 'a stable recovery key is required');
  assert.deepEqual(mergeWorkspaceBackup(first, backup), first);
  assert.deepEqual(mergeWorkspaceBackup(createWorkspaceState(), backup), first);
  for (const field of ['recoveredNotes', 'recoveryDrafts', 'addedDrafts']) assert.equal(previewWorkspaceBackupMerge(first, backup)[field], 0, field);
  const current = state({drafts:{[key]:{kept:'unrelated occupied key'}, [`${key}:1`]:{...recovery, value:{note:'Another recovery', private:false}}}});
  const merged = mergeWorkspaceBackup(current, backup);
  assert.deepEqual(merged.drafts[key], current.drafts[key]);
  assert.deepEqual(merged.drafts[`${key}:1`], current.drafts[`${key}:1`]);
  assert.deepEqual(merged.drafts[`${key}:2`], recovery);
  assert.deepEqual(mergeWorkspaceBackup(merged, backup), merged);
  assert.equal(previewWorkspaceBackupMerge(current, backup).addedDrafts, 1);
});

test('exact scoped note values avoid duplicate recovery while distinct privacy and text remain separate', () => {
  const key = 'window-draft:old:note%3Amissing', note = 'Saved local note';
  for (const value of [{note, private:true}, {private:true, note}]) {
    const backup = state({annotations:{missing:{note, private:true}}, drafts:{[key]:{key:'note:missing', value, base:{entity:'note:missing', version:99}}}});
    const merged = mergeWorkspaceBackup(createWorkspaceState(), backup);
    assert.equal(noteRecoveries(merged, 'missing').length, 1);
    assert.equal(merged.drafts[key].recoveryOnly, true);
    const preview = previewWorkspaceBackupMerge(createWorkspaceState(), backup);
    assert.equal(preview.recoveredNotes, 0);
    assert.equal(preview.recoveryDrafts, 1);
    assert.equal(preview.addedDrafts, 1);
  }
  for (const value of [{note, private:false}, {note:'Different draft', private:true}, {note, private:true, body:'Extra user text'}]) {
    const backup = state({annotations:{missing:{note, private:true}}, drafts:{[key]:{key:'note:missing', value, base:null}}});
    const merged = mergeWorkspaceBackup(createWorkspaceState(), backup);
    assert.equal(noteRecoveries(merged, 'missing').length, 2);
    assert.deepEqual(merged.drafts[key].value, value);
    assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(), backup).recoveredNotes, 1);
    assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(), backup).recoveryDrafts, 2);
    assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(), backup).addedDrafts, 2);
  }
});

test('symbol-bearing and inherited-property card IDs preserve exact note identity and privacy', () => {
  for (const cardId of ['native/雪 ☾:100%?#.md', 'toString', 'hasOwnProperty']) {
    for (const privateValue of [true, false]) {
      const backup = state({annotations:{[cardId]:{note:'\n保留全部文字\n', private:privateValue}}});
      const merged = mergeWorkspaceBackup(createWorkspaceState(), backup), [[key, record]] = noteRecoveries(merged, cardId);
      assert.ok(key.endsWith(`:${encodeURIComponent(`note:${cardId}`)}`));
      assert.deepEqual(record.value, {note:'\n保留全部文字\n', private:privateValue});
      assert.deepEqual(mergeWorkspaceBackup(merged, backup), merged);
      assert.deepEqual(parseWorkspaceBackup(serializeWorkspace(merged)), merged);
    }
  }
});

test('notes adopted with truly new card entities do not also produce recovery drafts', () => {
  const backup = state({cards:[card('new')], annotations:{new:{note:'Adopted with new card', private:true}}});
  const merged = mergeWorkspaceBackup(createWorkspaceState(), backup);
  assert.deepEqual(merged, backup);
  assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(), backup).recoveredNotes, 0);
});

test('maximum-length and unusual Unicode identities survive recovery backup re-import without relaxing ID validation', () => {
  for (const cardId of ['a'.repeat(4096), '雪'.repeat(4096), '🌒'.repeat(2048), 'native/\ud800-note.md']) {
    const backup = state({annotations:{[cardId]:{note:'Retain the full original identity', private:true}}});
    const merged = mergeWorkspaceBackup(createWorkspaceState(), backup), records = noteRecoveries(merged, cardId);
    assert.equal(records.length, 1);
    const [key, record] = records[0];
    assert.ok(key.length <= 4096);
    assert.doesNotThrow(() => decodeURIComponent(key.slice(key.indexOf(':', 'window-draft:'.length) + 1)), 'display suffix must not split an encoded Unicode character');
    assert.equal(record.key, `note:${cardId}`);
    const roundtrip = mergeWorkspaceBackup(createWorkspaceState(), parseWorkspaceBackup(serializeWorkspace(merged)));
    assert.deepEqual(roundtrip, merged, 'standalone manual recovery must survive another backup import');
    assert.deepEqual(mergeWorkspaceBackup(roundtrip, backup), roundtrip);
  }
  for (const invalidId of ['a'.repeat(4097), 'constructor', 'prototype', '__proto__', 'bad\u0000id']) {
    assert.throws(() => state({annotations:{[invalidId]:{note:'invalid'}}}), /工作区数据无效/);
  }
  const drafts = Object.fromEntries(['constructor', 'prototype', '__proto__', 'a'.repeat(4097), 'bad\u0000id'].map((id, index) => [`window-draft:invalid-${index}`, {key:`note:${id}`, value:{note:'Do not weaken the ordinary ID validation'}, base:null}]));
  // Null control characters are valid JSON strings, but invalid editor IDs.
  assert.deepEqual(mergeWorkspaceBackup(createWorkspaceState(), state({drafts})).drafts, {});
});

test('same-ID content, unsaved/unfavorite/restored flags and annotations survive an older backup', () => {
  const current = state({cards:[card('existing', {body:'Edited current body'})], annotations:{existing:{note:'Current note', private:false}}, drafts:{appearance:'dark'}});
  const old = state({cards:[card('existing', {body:'Old body'})], savedIds:['existing'], favoriteIds:['existing'], hiddenIds:['existing'], annotations:{existing:{note:'Old note', private:true}}});
  const currentBefore = structuredClone(current), oldBefore = structuredClone(old);
  const merged = mergeWorkspaceBackup(current, old);
  assert.deepEqual({...merged, drafts:current.drafts}, current);
  assert.deepEqual(noteRecoveries(merged, 'existing').map(([, record]) => record.value), [{note:'Old note', private:true}]);
  assert.deepEqual(current, currentBefore);
  assert.deepEqual(old, oldBefore);
  assert.deepEqual(previewWorkspaceBackupMerge(current, old), {
    addedCards:0, preservedCards:1, preservedCardStates:1, addedCollections:0, preservedCollections:0, addedBoards:0, preservedBoards:0,
    addedMemberships:0, addedMembershipsForExistingCards:0, skippedExternalReferences:0, addedDrafts:1, preservedDrafts:0, skippedDrafts:0, recoveryDrafts:1, recoveredNotes:1,
  });
});

test('same-ID true flags and empty current notes remain current when the backup has false values', () => {
  const current = state({cards:[card('existing')], savedIds:['existing'], favoriteIds:['existing'], hiddenIds:['existing'], annotations:{existing:{note:'', private:true}}});
  const merged = mergeWorkspaceBackup(current, state({cards:[card('existing')], annotations:{existing:{note:'Former note', private:false}}}));
  assert.deepEqual({...merged, drafts:current.drafts}, current);
  assert.deepEqual(noteRecoveries(merged, 'existing').map(([, record]) => record.value), [{note:'Former note', private:false}]);
});

test('new entity cards inherit backup flags, attachments, document data, notes and provenance', () => {
  const bytes = Buffer.from('%PDF-1.4\nsource document').toString('base64');
  const attachment = {name:'source.pdf', type:'application/pdf', size:Buffer.from(bytes, 'base64').length, dataUrl:`data:application/pdf;base64,${bytes}`};
  const backup = state({
    cards:[card('source', {attachment, documentIndex:{text:'original words', pageCount:1, pages:[{page:1, text:'original words'}]}, documentHighlights:[{id:'mark', page:1, text:'words', rects:[{x:.1, y:.1, width:.2, height:.1}]}]}), card('excerpt', {type:'highlight', body:'words', sourceCardId:'source', page:1, sourceLocation:'source.pdf'})],
    savedIds:['source', 'excerpt'], favoriteIds:['excerpt'], hiddenIds:['source'], annotations:{excerpt:{note:'My interpretation', private:true}}, collections:[collection('new-collection', ['excerpt'])],
  });
  const incoming = parseWorkspaceBackup(serializeWorkspace(backup));
  const merged = mergeWorkspaceBackup(createWorkspaceState(), incoming);
  assert.deepEqual(merged, backup);
  assert.equal(merged.cards[0].attachment.dataUrl, attachment.dataUrl);
  assert.equal(merged.cards[1].sourceCardId, 'source');
  assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(), incoming).addedCards, 2);
});

test('currently known native IDs retain their flags and notes, even when an old backup supplies missing card bodies', () => {
  const current = state({savedIds:['native-saved'], hiddenIds:['native-hidden'], annotations:{'native-saved':{note:'Current native note', private:false}}, drafts:{'edit:native-draft':{body:'Current unfinished text'}}});
  const backup = state({
    cards:[card('native-saved'), card('native-hidden'), card('native-draft')], savedIds:['native-saved', 'native-hidden', 'native-draft'], favoriteIds:['native-saved', 'native-hidden'], hiddenIds:['native-saved', 'native-draft'],
    annotations:{'native-saved':{note:'Old native note', private:true}, 'native-hidden':{note:'Unexpected old note', private:true}},
  });
  const merged = mergeWorkspaceBackup(current, backup);
  assert.equal(merged.cards.length, 3);
  assert.deepEqual(merged.savedIds, current.savedIds);
  assert.deepEqual(merged.favoriteIds, current.favoriteIds);
  assert.deepEqual(merged.hiddenIds, current.hiddenIds);
  assert.deepEqual(merged.annotations, current.annotations);
  assert.deepEqual(merged.drafts['edit:native-draft'], current.drafts['edit:native-draft']);
  assert.deepEqual(noteRecoveries(merged, 'native-saved').map(([, record]) => record.value), [{note:'Old native note', private:true}]);
  assert.deepEqual(noteRecoveries(merged, 'native-hidden').map(([, record]) => record.value), [{note:'Unexpected old note', private:true}]);
  assert.equal(Object.keys(merged.drafts).length, 3);
  assert.equal(previewWorkspaceBackupMerge(current, backup).preservedCardStates, 3);
});

test('external IDs with no card body on either side cannot reappear solely through old flags or container references', () => {
  const current = state({savedIds:['known-native']});
  const backup = state({
    cards:[card('new')], savedIds:['new', 'missing'], favoriteIds:['missing'], hiddenIds:['missing'], annotations:{missing:{note:'Old external metadata'}},
    collections:[collection('collection', ['known-native', 'new', 'missing'])],
    boards:[board('board', [node('known', 'known-native'), node('new-node', 'local/new'), node('missing-node', 'missing')], [{id:'good-edge', from:'known', to:'new-node'}, {id:'bad-edge', from:'new-node', to:'missing-node'}], {collectionId:'collection'})],
  });
  const merged = mergeWorkspaceBackup(current, backup);
  assert.deepEqual(merged.savedIds, ['known-native', 'new']);
  assert.deepEqual(merged.favoriteIds, []);
  assert.deepEqual(merged.hiddenIds, []);
  assert.equal(Object.hasOwn(merged.annotations, 'missing'), false);
  assert.deepEqual(merged.collections[0].cardIds, ['known-native', 'new']);
  assert.deepEqual(merged.boards[0].nodes.map(item => item.id), ['known', 'new-node']);
  assert.deepEqual(merged.boards[0].edges.map(item => item.id), ['good-edge']);
  const preview = previewWorkspaceBackupMerge(current, backup);
  assert.equal(preview.skippedExternalReferences, 1);
  assert.equal(preview.addedMembershipsForExistingCards, 1);
});

test('current collections and canvases win while new containers preserve valid existing and imported references', () => {
  const current = state({
    cards:[card('existing')], savedIds:['native'],
    collections:[collection('shared', ['existing'], {title:'Current collection'})],
    annotations:{existing:{note:'Current note', private:true}},
    boards:[board('shared-board', [node('current-node', 'local/existing')], [], {collectionId:'shared'})],
  });
  const backup = state({
    cards:[card('existing', {body:'Old body'}), card('new')],
    collections:[collection('shared', ['new'], {title:'Old collection'}), collection('added', ['existing', 'native', 'new'])],
    annotations:{existing:{note:'Old note', private:false}, new:{note:'Imported note', private:false, collectionIds:['shared', 'added']}},
    boards:[board('shared-board', [node('old-node', 'new')]), board('added-board', [node('existing-node', 'local/existing'), node('native-node', 'native'), node('new-node', 'new')], [], {collectionId:'shared'})],
  });
  const merged = mergeWorkspaceBackup(current, backup);
  assert.deepEqual(merged.collections[0], current.collections[0]);
  assert.deepEqual(merged.boards[0], current.boards[0]);
  assert.deepEqual(merged.collections[1].cardIds, ['existing', 'native', 'new']);
  assert.deepEqual(merged.boards[1].nodes.map(item => item.itemPath), ['local/existing', 'native', 'new']);
  assert.equal(merged.annotations.existing.note, 'Current note');
  assert.equal(merged.annotations.existing.private, true);
  assert.deepEqual(merged.annotations.existing.collectionIds, ['shared', 'added']);
  assert.deepEqual(merged.annotations.new.collectionIds, ['added']);
  const preview = previewWorkspaceBackupMerge(current, backup);
  assert.equal(preview.preservedCollections, 1);
  assert.equal(preview.preservedBoards, 1);
  assert.equal(preview.addedMemberships, 3);
  assert.equal(preview.addedMembershipsForExistingCards, 2);
});

test('current and false-valued drafts win, stale editor/native-write drafts are skipped, and new local drafts remain usable', () => {
  const current = state({cards:[card('existing')], collections:[collection('current-collection')], drafts:{appearance:false, 'new:text':{body:'Current unsaved text'}, 'vault:existing':{operationId:'current-request'}}});
  const backup = state({
    cards:[card('existing'), card('new')], collections:[collection('current-collection'), collection('new-collection')],
    drafts:{appearance:'light', 'new:text':{body:'Old unsaved text'}, 'edit:existing':{body:'Old current card'}, 'edit:missing':{body:'Missing card'}, 'edit:new':{body:'New card draft'}, 'note:new':{body:'New note draft'}, 'vault:existing':{operationId:'old-request'}, 'vault:new':{operationId:'old-new-request'}, 'collection:current-collection':{title:'Old current collection'}, 'collection:new-collection':{title:'Imported collection draft'}, importLibrary:{content:'Unsubmitted import'}},
  });
  const merged = mergeWorkspaceBackup(current, backup);
  assert.equal(merged.drafts.appearance, false);
  assert.deepEqual(merged.drafts['new:text'], current.drafts['new:text']);
  assert.deepEqual(merged.drafts['vault:existing'], current.drafts['vault:existing']);
  for (const key of ['edit:existing', 'edit:missing', 'vault:new', 'collection:current-collection']) assert.equal(Object.hasOwn(merged.drafts, key), false, key);
  assert.equal(merged.drafts['edit:new'].body, 'New card draft');
  assert.equal(merged.drafts['note:new'].body, 'New note draft');
  assert.equal(merged.drafts['collection:new-collection'].title, 'Imported collection draft');
  assert.equal(merged.drafts.importLibrary.content, 'Unsubmitted import');
  const preview = previewWorkspaceBackupMerge(current, backup);
  assert.equal(preview.addedDrafts, 4);
  assert.equal(preview.preservedDrafts, 3);
  assert.equal(preview.skippedDrafts, 4);
  assert.equal(preview.skippedExternalReferences, 1);
});

test('repeat imports are idempotent and commit-time recomputation preserves changes made after the preview', () => {
  const old = state({cards:[card('a')], savedIds:['a'], favoriteIds:['a'], hiddenIds:['a'], collections:[collection('collection', ['a'])]});
  const beforePreview = createWorkspaceState();
  assert.equal(previewWorkspaceBackupMerge(beforePreview, old).addedCards, 1);
  const latest = state({cards:[card('a', {body:'Edited after preview'})], savedIds:['a']});
  const merged = mergeWorkspaceBackup(latest, old);
  assert.equal(merged.cards[0].body, 'Edited after preview');
  assert.deepEqual(merged.favoriteIds, []);
  assert.deepEqual(merged.hiddenIds, []);
  assert.deepEqual(mergeWorkspaceBackup(merged, old), merged);
});

test('invalid or unsupported input rejects without changing either input', () => {
  const current = state({cards:[card('a')]});
  const before = structuredClone(current);
  const unsupported = {...createWorkspaceState(), schemaVersion:2};
  const unsupportedBefore = structuredClone(unsupported);
  assert.throws(() => mergeWorkspaceBackup(current, unsupported), /版本/);
  assert.throws(() => previewWorkspaceBackupMerge(current, {...createWorkspaceState(), cards:[card('duplicate'), card('duplicate')]}), /重复/);
  assert.deepEqual(current, before);
  assert.deepEqual(unsupported, unsupportedBefore);
});

test('scoped same-card drafts preserve the current editor and retain imported input as manual recovery copies', () => {
  const logicalKey = 'edit:existing', currentKey = `window-draft:current:${encodeURIComponent(logicalKey)}`, oldKey = `window-draft:old:${encodeURIComponent(logicalKey)}`;
  const currentRecord = {key:logicalKey, value:{body:'Current input'}, base:{entity:'card:existing', version:4}, updatedAt:'2026-10-03T10:00:00Z', conflict:false};
  const current = state({cards:[card('existing')], drafts:{[currentKey]:currentRecord}});
  const backup = state({cards:[card('existing')], drafts:{
    [oldKey]:{key:logicalKey, value:{body:'Old other-window input'}, base:{entity:'card:existing', version:20}, updatedAt:'2026-10-02T10:00:00Z', conflict:false},
    [currentKey]:{...currentRecord, value:{body:'Old same-window input'}},
  }});
  const merged = mergeWorkspaceBackup(current, backup);
  assert.deepEqual(merged.drafts[currentKey], currentRecord);
  assert.equal(merged.drafts[oldKey].value.body, 'Old other-window input');
  assert.equal(merged.drafts[oldKey].recoveryOnly, true);
  assert.equal(merged.drafts[oldKey].conflict, true);
  assert.equal(merged.drafts[oldKey].base, null);
  const recovered = Object.entries(merged.drafts).filter(([key]) => key !== currentKey);
  assert.equal(recovered.length, 2);
  assert.deepEqual(recovered.map(([, entry]) => entry.value.body).sort(), ['Old other-window input', 'Old same-window input']);
  assert.ok(recovered.every(([, entry]) => entry.recoveryOnly && entry.conflict && entry.imported && entry.base === null));
  assert.equal(previewWorkspaceBackupMerge(current, backup).recoveryDrafts, 2);
  assert.deepEqual(mergeWorkspaceBackup(merged, backup), merged);
});

test('scoped-only native edit identities protect current false flags and do not revive scoped vault requests', () => {
  const current = state({drafts:{'window-draft:current:edit%3Anative':{key:'edit:native', value:{body:'Current native draft'}, base:null}}});
  const backup = state({cards:[card('native')], savedIds:['native'], favoriteIds:['native'], hiddenIds:['native'], drafts:{
    'window-draft:old:edit%3Anative':{key:'edit:native', value:{body:'Old native draft'}, base:{entity:'card:native', version:7}},
    'window-draft:old:vault%3Anative':{key:'vault:native', value:{operationId:'old-write', payload:{body:'must not retry'}}, base:null},
  }});
  const merged = mergeWorkspaceBackup(current, backup);
  assert.deepEqual(merged.savedIds, []);
  assert.deepEqual(merged.favoriteIds, []);
  assert.deepEqual(merged.hiddenIds, []);
  assert.equal(merged.drafts['window-draft:old:edit%3Anative'].recoveryOnly, true);
  assert.equal(Object.hasOwn(merged.drafts, 'window-draft:old:vault%3Anative'), false);
  assert.equal(previewWorkspaceBackupMerge(current, backup).skippedDrafts, 1);
});

test('new imported entity scoped drafts reset foreign revisions and keep independent window recovery records', () => {
  const backup = state({cards:[card('new')], drafts:{
    'window-draft:one:edit%3Anew':{key:'edit:new', value:{body:'First unfinished text'}, base:{entity:'card:new', version:900}, updatedAt:'2026-10-02T10:00:00Z', conflict:false},
    'window-draft:two:edit%3Anew':{key:'edit:new', value:{body:'Second unfinished text'}, base:{entity:'card:new', version:900}, updatedAt:'2026-10-03T10:00:00Z', conflict:false},
  }});
  const merged = mergeWorkspaceBackup(createWorkspaceState(), backup);
  for (const record of Object.values(merged.drafts)) {
    assert.equal(record.base, null);
    assert.equal(record.imported, true);
    assert.equal(record.recoveryOnly, false);
    assert.equal(record.conflict, false);
  }
  assert.equal(Object.keys(merged.drafts).length, 2);
  assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(), backup).recoveryDrafts, 0);
});

test('malformed scoped records are skipped while current malformed data is kept untouched', () => {
  const current = state({drafts:{'window-draft:current:invalid':{text:'current preserved metadata'}}});
  const backup = state({drafts:{
    'window-draft:old:bad':{key:'edit:missing'},
    'window-draft:old:unsupported':{key:'capture', value:{body:'unsupported logical key'}},
    'window-draft:old:reserved':{key:'edit:bad\u0000', value:{body:'invalid logical key'}},
  }});
  const merged = mergeWorkspaceBackup(current, backup);
  assert.deepEqual(merged.drafts, current.drafts);
  assert.equal(previewWorkspaceBackupMerge(current, backup).skippedDrafts, 3);
});

test('loaded external identities preserve valid backup references without changing current false flags or replaying foreign draft revisions', () => {
  const current = createWorkspaceState();
  const backup = state({
    savedIds:['native-id'], favoriteIds:['native-id'], hiddenIds:['native-id'],
    annotations:{'native-id':{note:'Old note', private:true}},
    collections:[collection('collection', ['native-id'])],
    boards:[board('board', [node('native-node', '01_sources/native.md')], [], {collectionId:'collection'})],
    drafts:{'window-draft:old:board%3Aboard':{key:'board:board', value:{title:'Unfinished board'}, base:{entity:'board:board', version:900}, adoptedFrom:{id:'foreign', version:899}, conflict:false}},
  });
  const context = {knownCardIds:['native-id'], knownCardPaths:['01_sources/native.md']};
  const merged = mergeWorkspaceBackup(current, backup, context);
  assert.deepEqual(merged.savedIds, []);
  assert.deepEqual(merged.favoriteIds, []);
  assert.deepEqual(merged.hiddenIds, []);
  assert.deepEqual(merged.collections[0].cardIds, ['native-id']);
  assert.equal(merged.boards[0].nodes[0].itemPath, '01_sources/native.md');
  assert.equal(merged.annotations['native-id'].note, null);
  assert.equal(merged.annotations['native-id'].private, false);
  const record = merged.drafts['window-draft:old:board%3Aboard'];
  assert.equal(record.base, null);
  assert.equal(record.adoptedFrom, null);
  assert.equal(record.recoveryOnly, false);
  const preview = previewWorkspaceBackupMerge(current, backup, context);
  assert.equal(preview.skippedExternalReferences, 0);
  assert.equal(preview.preservedCardStates, 1);
  assert.equal(preview.addedMembershipsForExistingCards, 1);
  assert.equal(mergeWorkspaceBackup(current, backup).boards[0].nodes.length, 0, 'only loaded identities may resolve an absent external entity');
});

test('orphaned scoped canvas geometry stays a manual recovery copy without reviving deleted entities',()=>{
 const key='window-draft:old:board%3Adeleted',value=board('deleted',[node('retained','missing-card')],[],{collectionId:'removed'}),backup=state({drafts:{[key]:{key:'board:deleted',value,base:{entity:'board:deleted',version:99},conflict:true}}});
 const merged=mergeWorkspaceBackup(createWorkspaceState(),parseWorkspaceBackup(serializeWorkspace(backup)));assert.deepEqual(merged.boards,[]);assert.deepEqual(merged.drafts[key].value,value);assert.equal(merged.drafts[key].recoveryOnly,true);assert.equal(merged.drafts[key].base,null);assert.deepEqual(mergeWorkspaceBackup(merged,backup),merged);
});

test('an actually loaded native ID cannot be shadowed by an older embedded backup card',()=>{
 const external={id:'native/source.md',path:'native/source.md',title:'Current native title',body:'Current native body',origin:'vault'};
 const current=state({savedIds:['unloaded-native']});
 const backup=state({cards:[card(external.id,{path:external.path,body:'Old native body',origin:'vault'}),card('unloaded-native',{body:'Only available embedded body'}),card('path-only',{body:'Distinct card body'})]});
 const context={knownCardIds:[external.id],knownCardPaths:[external.path,'path-only']};
 const merged=mergeWorkspaceBackup(current,backup,context);
 assert.equal(merged.cards.some(value=>value.id===external.id),false,'local cards must not override the loaded native card in the renderer ID map');
 assert.equal(merged.cards.find(value=>value.id==='unloaded-native').body,'Only available embedded body','flags or notes alone do not mean the native body is loaded');
 assert.equal(merged.cards.find(value=>value.id==='path-only').body,'Distinct card body','a known path is not necessarily a renderer ID collision');
 const rendered=new Map([[external.id,external]]);for(const value of merged.cards)rendered.set(value.id,value);
 assert.equal(rendered.get(external.id).body,external.body);
 assert.equal(previewWorkspaceBackupMerge(current,backup,context).preservedCards,1);
 assert.deepEqual(mergeWorkspaceBackup(merged,backup,context),merged);
});

test('orphaned scoped card, note and collection input survives import as manual recovery only',()=>{
 const records={
  'window-draft:old:edit%3Amissing':{key:'edit:missing',value:{title:'Unfinished card',body:'Retained user prose'},base:{entity:'card-editor:missing',version:91}},
  'window-draft:old:note%3Amissing':{key:'note:missing',value:{note:'Retained annotation'},base:{entity:'note:missing',version:92}},
  'window-draft:old:collection%3Adeleted':{key:'collection:deleted',value:{id:'deleted',title:'Retained collection title',description:'Retained description'},base:{entity:'collection:deleted',version:93}},
 };
 const backup=state({drafts:{...records,'window-draft:old:vault%3Amissing':{key:'vault:missing',value:{operationId:'must-never-replay'},base:null}}});
 const before=structuredClone(backup),merged=mergeWorkspaceBackup(createWorkspaceState(),parseWorkspaceBackup(serializeWorkspace(backup)));
 assert.deepEqual(merged.cards,[]);assert.deepEqual(merged.collections,[]);assert.deepEqual(merged.boards,[]);
 for(const [key,record] of Object.entries(records)){
  assert.deepEqual(merged.drafts[key]?.value,record.value,key);
  assert.equal(merged.drafts[key].recoveryOnly,true);assert.equal(merged.drafts[key].conflict,true);assert.equal(merged.drafts[key].base,null);assert.equal(merged.drafts[key].adoptedFrom,null);
 }
 assert.equal(Object.hasOwn(merged.drafts,'window-draft:old:vault%3Amissing'),false);
 assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(),backup).recoveryDrafts,3);
 assert.equal(previewWorkspaceBackupMerge(createWorkspaceState(),backup).skippedDrafts,1);
 assert.deepEqual(mergeWorkspaceBackup(merged,backup),merged);assert.deepEqual(backup,before);
});

test('membership reconciliation rejects a combined collection above 20000 instead of returning a non-restorable state',()=>{
 const cardIds=Array.from({length:20000},(_,index)=>`member-${index}`);
 const exact={...createWorkspaceState(),collections:[collection('group',cardIds)],annotations:{'member-0':{collectionIds:['group']}}};
 const normalized=normalizeWorkspaceState(exact);assert.equal(normalized.collections[0].cardIds.length,20000);assert.deepEqual(normalizeWorkspaceState(normalized),normalized);
 const overflow={...exact,annotations:{...exact.annotations,extra:{collectionIds:['group']}}};
 const before=structuredClone(overflow);
 assert.throws(()=>normalizeWorkspaceState(overflow),/20000/);
 assert.throws(()=>parseWorkspaceBackup(JSON.stringify(overflow)),/20000/);
 assert.deepEqual(overflow,before,'rejecting a backup must not remove or mutate any supplied membership');
});
