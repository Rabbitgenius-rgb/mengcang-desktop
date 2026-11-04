import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceState, normalizeWorkspaceState, prepareWorkspaceBackupRestore, restoreEmptyWorkspace, mergeWorkspaceBackup,
} from '../src/sublime/workspaceModel.js';

test('flag-only and membership-only originals remain independent recoveries in restore and merge', () => {
  const star = 'old-star.md', hidden = 'old-hidden.md', member = 'old-member.md';
  const incoming = normalizeWorkspaceState({
    ...createWorkspaceState(),
    favoriteIds: [star], hiddenIds: [hidden],
    collections: [{ id: 'group', title: '原收藏集', cardIds: [member] }],
  });
  const safe = prepareWorkspaceBackupRestore(incoming);
  for (const recovered of [
    restoreEmptyWorkspace(createWorkspaceState(), safe),
    mergeWorkspaceBackup(createWorkspaceState(), safe, { knownCardIds: [star, hidden, member] }),
  ]) {
    assert.deepEqual(recovered.favoriteIds, []);
    assert.deepEqual(recovered.hiddenIds, []);
    assert.deepEqual(recovered.collections[0].cardIds, []);
    const records = Object.values(recovered.drafts);
    assert.equal(records.length, 3);
    assert.ok(records.every((entry) => entry.key === 'new:text' && entry.recoveryOnly && entry.value.body.trim()));
    const byId = Object.fromEntries(records.map((entry) => [entry.value.backupOriginalState.id, entry.value.backupOriginalState]));
    assert.equal(byId[star].favorite, true);
    assert.equal(byId[hidden].hidden, true);
    assert.deepEqual(byId[member].collections, [{ id: 'group', title: '原收藏集' }]);
    assert.equal(byId[star].annotation, null);
    const again = prepareWorkspaceBackupRestore(recovered);
    assert.deepEqual(again.drafts, recovered.drafts);
    assert.deepEqual(mergeWorkspaceBackup(recovered, safe).drafts, recovered.drafts);
  }
});

test('verified originals still inherit their flags and memberships without an unnecessary recovery', () => {
  const id = 'verified.md';
  const incoming = normalizeWorkspaceState({
    ...createWorkspaceState(), favoriteIds: [id], hiddenIds: [id],
    collections: [{ id: 'group', title: '同库收藏集', cardIds: [id] }],
  });
  const result = prepareWorkspaceBackupRestore(incoming, { allowedOriginalIds: [id] });
  assert.deepEqual(result, incoming);
});
