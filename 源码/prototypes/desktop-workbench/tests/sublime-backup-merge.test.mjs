import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceState, normalizeWorkspaceState, mergeWorkspaceBackup, previewWorkspaceBackupMerge, parseWorkspaceBackup, serializeWorkspace} from '../src/sublime/workspaceModel.js';

const card = (id, extra = {}) => ({id, path:`local/${id}`, title:id, body:`Body ${id}`, origin:'local', ...extra});
const collection = (id, cardIds = [], extra = {}) => ({id, title:id, cardIds, ...extra});
const node = (id, itemPath) => ({id, itemPath, x:10, y:20});
const board = (id, nodes = [], edges = [], extra = {}) => ({id, title:id, nodes, edges, ...extra});
const state = extra => normalizeWorkspaceState({...createWorkspaceState(), ...extra});

test('same-ID content, unsaved/unfavorite/restored flags and annotations survive an older backup', () => {
  const current = state({cards:[card('existing', {body:'Edited current body'})], annotations:{existing:{note:'Current note', private:false}}, drafts:{appearance:'dark'}});
  const old = state({cards:[card('existing', {body:'Old body'})], savedIds:['existing'], favoriteIds:['existing'], hiddenIds:['existing'], annotations:{existing:{note:'Old note', private:true}}});
  const currentBefore = structuredClone(current), oldBefore = structuredClone(old);
  const merged = mergeWorkspaceBackup(current, old);
  assert.deepEqual(merged, current);
  assert.deepEqual(current, currentBefore);
  assert.deepEqual(old, oldBefore);
  assert.deepEqual(previewWorkspaceBackupMerge(current, old), {
    addedCards:0, preservedCards:1, preservedCardStates:1, addedCollections:0, preservedCollections:0, addedBoards:0, preservedBoards:0,
    addedMemberships:0, addedMembershipsForExistingCards:0, skippedExternalReferences:0, addedDrafts:0, preservedDrafts:0, skippedDrafts:0, recoveryDrafts:0,
  });
});

test('same-ID true flags and empty current notes remain current when the backup has false values', () => {
  const current = state({cards:[card('existing')], savedIds:['existing'], favoriteIds:['existing'], hiddenIds:['existing'], annotations:{existing:{note:'', private:true}}});
  const merged = mergeWorkspaceBackup(current, state({cards:[card('existing')], annotations:{existing:{note:'Former note', private:false}}}));
  assert.deepEqual(merged, current);
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
  assert.deepEqual(merged.drafts, current.drafts);
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
