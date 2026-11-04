import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  canRestoreEmptyWorkspace,
  createWorkspaceState,
  normalizeWorkspaceState,
  prepareWorkspaceBackupRestore,
  restoreEmptyWorkspace,
} from '../src/sublime/workspaceModel.js';
import { createWorkspaceStoreV3 } from '../src/sublime/workspaceStoreV3.js';
import { createWorkspaceSession } from '../src/sublime/workspacePersistence.js';

test('an empty workspace can restore after an appearance choice while retaining its chosen appearance', () => {
  const current = { ...createWorkspaceState(), drafts: { legacyDiscoveryImported: true, appearance: 'light' } };
  assert.equal(canRestoreEmptyWorkspace(current), true);
  const restored = restoreEmptyWorkspace(current, { ...createWorkspaceState(), drafts: { appearance: 'dark' } });
  assert.equal(restored.drafts.appearance, 'light');
  for (const drafts of [{ appearance: 'invalid' }, { 'note:original.md': { note: 'actual input' } }, { arbitrary: true }])
    assert.equal(canRestoreEmptyWorkspace({ ...current, drafts }), false);
});

test('restored window draft cannot reuse its old revision to overwrite a newer saved note', async () => {
  const indexedDB = new IDBFactory();
  const store = createWorkspaceStoreV3('destination', { indexedDB, createChannel: () => null, eventTarget: null });
  const sourceId = 'example.md';
  const draftId = 'window-draft:old:note%3Aexample.md';
  const incoming = normalizeWorkspaceState({
    ...createWorkspaceState(),
    annotations: { [sourceId]: { note: 'new saved note', private: false } },
    drafts: {
      [draftId]: {
        key: 'note:' + sourceId,
        value: { note: 'old unsaved draft', private: false },
        base: { entity: 'note:' + sourceId, version: 1 },
        conflict: false,
      },
    },
  });
  try {
    await store.update((current) => restoreEmptyWorkspace(current, incoming));
    const session = createWorkspaceSession(store, { sessionId: 'new-window' });
    await session.load();
    assert.equal(session.beginEdit('note:' + sourceId), undefined, 'imported draft is not automatically adopted');
    const recovery = session.recoverableDrafts().find((record) => record.id === draftId);
    assert.equal(recovery.value.note, 'old unsaved draft');
    assert.equal(recovery.base, null);
    assert.equal(recovery.conflict, true);
    await session.resumeDraft(draftId);
    await assert.rejects(session.commit({ type: 'card.note', id: sourceId, note: 'old unsaved draft' }), (error) => error.code === 'WORKSPACE_CONFLICT');
    assert.equal((await store.load()).annotations[sourceId].note, 'new saved note');
    const copy = await session.copyDraft(draftId, 'new:text', (value) => ({ body: value.note }));
    assert.equal(copy.value.body, 'old unsaved draft');
  } finally {
    store.close();
  }
});

test('legacy raw editor drafts become recoverable copies rather than implicit current edit baselines', () => {
  const raw = { ...createWorkspaceState(), drafts: { 'note:example.md': { note: 'legacy draft', private: true } } };
  const restored = restoreEmptyWorkspace(createWorkspaceState(), raw);
  assert.equal(restored.drafts['note:example.md'], undefined);
  const record = Object.values(restored.drafts)[0];
  assert.equal(record.value.note, 'legacy draft');
  assert.equal(record.base, null);
  assert.equal(record.recoveryOnly, true);
  assert.equal(record.conflict, true);
});

test('foreign original states become independent recoveries without rebinding notes, flags or links', () => {
  const originalId = '01_sources/cards/text/source.md';
  const incoming = normalizeWorkspaceState({
    ...createWorkspaceState(),
    cards: [{ id: 'local', type: 'text', body: 'my own note', sourceCardId: originalId }],
    savedIds: ['local', originalId],
    favoriteIds: ['local', originalId],
    hiddenIds: ['local', originalId],
    annotations: { [originalId]: { note: 'original annotation', private: true }, local: { note: 'local annotation', private: false } },
    collections: [{ id: 'group', title: 'Group', cardIds: ['local', originalId] }],
    boards: [
      {
        id: 'board',
        title: 'Board',
        nodes: [
          { id: 'x', itemPath: 'local', x: 0, y: 0 },
          { id: 'y', itemPath: originalId, x: 1, y: 1 },
        ],
        edges: [{ id: 'xy', from: 'x', to: 'y' }],
      },
    ],
    drafts: {
      'recall-workbench-v1': { read: { local: true } },
      'note:01_sources/cards/text/source.md': { note: 'original unsaved input', private: true },
      ['reader:' + originalId]: { progress: 10 },
    },
  });
  const restored = prepareWorkspaceBackupRestore(incoming);
  for (const field of ['savedIds', 'favoriteIds', 'hiddenIds']) assert.deepEqual(restored[field], ['local']);
  assert.equal(restored.annotations[originalId], undefined);
  assert.equal(restored.annotations.local.note, 'local annotation');
  assert.equal(restored.cards[0].body, 'my own note');
  assert.equal(restored.cards[0].sourceCardId, '');
  assert.deepEqual(restored.collections[0].cardIds, ['local']);
  assert.equal(restored.boards[0].nodes.length, 1);
  assert.equal(restored.boards[0].edges.length, 0);
  assert.deepEqual(restored.drafts['recall-workbench-v1'], incoming.drafts['recall-workbench-v1']);
  const recoveries = Object.entries(restored.drafts)
    .filter(([key]) => key.startsWith('window-draft:'))
    .map(([, value]) => value);
  assert.equal(recoveries.length, 2);
  assert.ok(recoveries.every((value) => value.key === 'new:text' && value.recoveryOnly && value.conflict && value.base === null));
  assert.ok(recoveries.some((value) => value.value.body === 'original annotation' && value.value.backupOriginalState.hidden === true));
  assert.ok(recoveries.some((value) => value.value.body === 'original unsaved input'));
  assert.deepEqual(prepareWorkspaceBackupRestore(incoming, { allowOriginalState: true }), incoming);
  const proven = prepareWorkspaceBackupRestore(incoming, { allowedOriginalIds: new Set([originalId]) });
  assert.equal(proven.annotations[originalId].note, 'original annotation');
  assert.ok(proven.favoriteIds.includes(originalId));
  assert.ok(proven.hiddenIds.includes(originalId));
  assert.equal(proven.cards[0].sourceCardId, originalId);
  assert.deepEqual(proven.collections[0].cardIds, ['local', originalId]);
});

test('unverified embedded original bodies remain available as independent recovery copies', () => {
  const incoming = normalizeWorkspaceState({
    ...createWorkspaceState(),
    cards: [{ id: 'original.md', origin: 'vault', type: 'text', title: 'Old original', body: 'full old original body' }],
  });
  const restored = prepareWorkspaceBackupRestore(incoming);
  assert.deepEqual(restored.cards, []);
  const copy = Object.values(restored.drafts).find((record) => record.key === 'new:text');
  assert.equal(copy.value.body, 'full old original body');
  assert.equal(copy.value.origin, 'local');
  assert.equal(copy.value.backupOriginalId, 'original.md');
});
