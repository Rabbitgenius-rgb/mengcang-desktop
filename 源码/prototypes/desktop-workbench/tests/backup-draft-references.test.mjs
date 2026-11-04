import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceState,
  normalizeWorkspaceState,
  prepareWorkspaceBackupRestore,
  restoreEmptyWorkspace,
  mergeWorkspaceBackup,
} from '../src/sublime/workspaceModel.js';
import { linkedNoteDraftKey, openLinkedNoteDraft } from '../src/sublime/linkedNotes.js';
import { recoveredBoardCopy } from '../src/sublime/workspaceView.js';
const originalId = '01_sources/cards/text/source.md';
const local = { id: 'local-note', type: 'text', title: '本机笔记', body: '本机笔记正文' };
const oldLinked = { id: 'linked-note:old-unsaved', createdAt: '2026-11-01T00:00:00.000Z', title: '旧库想法', body: '旧库文章的未提交正文' };
const source = { id: originalId, title: '目标库旅行清单', origin: 'vault' };
const state = (drafts) => normalizeWorkspaceState({ ...createWorkspaceState(), cards: [local], savedIds: [local.id], drafts });
const scoped = (key, value) => ({ key, value, base: { entity: key, version: 1 }, conflict: false });

test('foreign linked-note draft becomes an independent recovery through both restore modes', async () => {
  const input = state({ [linkedNoteDraftKey(originalId)]: oldLinked });
  const prepared = prepareWorkspaceBackupRestore(input);
  assert.equal(prepared.drafts[linkedNoteDraftKey(originalId)], undefined);
  const copy = Object.values(prepared.drafts).find((d) => d.key === 'new:text');
  assert.equal(copy.value.body, oldLinked.body);
  assert.equal(copy.value.sourceCardId, '');
  assert.equal(copy.value.backupSourceReferences.sourceCardId, originalId);
  assert.equal(copy.value.backupSourceKey, linkedNoteDraftKey(originalId));
  for (const restored of [
    restoreEmptyWorkspace(createWorkspaceState(), prepared),
    mergeWorkspaceBackup(createWorkspaceState(), prepared, { knownCardIds: [originalId] }),
  ]) {
    let saved = restored;
    const editor = openLinkedNoteDraft({
      source,
      initial: restored.drafts[linkedNoteDraftKey(originalId)],
      id: 'linked-note:new',
      createdAt: '2026-11-04T00:00:00.000Z',
      nativeSource: () => true,
      commit: async (fn) => {
        saved = fn(saved);
      },
    });
    assert.equal(editor.value.body, '');
    editor.update('body', '目标文章自己的新笔记');
    await editor.publish();
    assert.equal(saved.cards.find((c) => c.id === 'linked-note:new').body, '目标文章自己的新笔记');
    assert.ok(Object.values(saved.drafts).some((d) => d.value?.body === oldLinked.body));
  }
  const proven = prepareWorkspaceBackupRestore(input, { allowedOriginalIds: [originalId] });
  assert.deepEqual(proven.drafts[linkedNoteDraftKey(originalId)], oldLinked);
});

test('card, collection and board draft copies only retain verified active references', () => {
  const board = {
    id: 'old-board',
    title: '旧画布草稿',
    collectionId: 'foreign-group',
    nodes: [
      { id: 'local', itemPath: local.id, x: 0, y: 0 },
      { id: 'external', itemPath: originalId, x: 1, y: 1 },
    ],
    edges: [{ id: 'link', from: 'local', to: 'external' }],
  };
  const input = state({
    'window-draft:old:new': scoped('new:text', {
      body: '新笔记正文',
      sourceCardId: originalId,
      articleFigure: { blockId: 'old-figure' },
      collectionIds: ['foreign-group'],
    }),
    'window-draft:old:board': scoped('board:old-board', board),
    'window-draft:old:collection': scoped('collection:new', { id: 'group-draft', title: '旧收藏草稿', cardIds: [local.id, originalId] }),
    'recall-workbench-v1': { read: { [local.id]: true } },
  });
  const prepared = prepareWorkspaceBackupRestore(input);
  const draft = prepared.drafts['window-draft:old:new'].value;
  assert.equal(draft.body, '新笔记正文');
  assert.equal(draft.sourceCardId, '');
  assert.equal(draft.articleFigure, undefined);
  assert.deepEqual(draft.collectionIds, []);
  assert.equal(draft.backupSourceReferences.sourceCardId, originalId);
  assert.deepEqual(draft.backupSourceReferences.articleFigure, { blockId: 'old-figure' });
  const b = prepared.drafts['window-draft:old:board'].value;
  assert.deepEqual(b.nodes, [board.nodes[0]]);
  assert.deepEqual(b.edges, []);
  assert.equal(b.collectionId, '');
  assert.deepEqual(b.backupSourceReferences.nodes, board.nodes);
  assert.deepEqual(b.backupSourceReferences.edges, board.edges);
  const copy = recoveredBoardCopy(b, 'new-board', []);
  assert.deepEqual(copy.nodes, [board.nodes[0]]);
  assert.deepEqual(copy.edges, []);
  const collection = prepared.drafts['window-draft:old:collection'].value;
  assert.deepEqual(collection.cardIds, [local.id]);
  assert.deepEqual(collection.backupSourceReferences.cardIds, [local.id, originalId]);
  assert.deepEqual(prepared.drafts['recall-workbench-v1'], input.drafts['recall-workbench-v1']);
  assert.deepEqual(prepareWorkspaceBackupRestore(prepared), prepared, 'repeat import cannot reactivate metadata');
  const restored = restoreEmptyWorkspace(createWorkspaceState(), prepared);
  assert.equal(restored.drafts['window-draft:old:new'].base, null);
  assert.equal(restored.drafts['window-draft:old:new'].recoveryOnly, true);
});

test('verified figure source stays active when a separate collection reference is removed', () => {
  const input = state({ 'new:text': { body: '保留配图', sourceCardId: originalId, articleFigure: { blockId: 'figure' }, collectionIds: ['missing'] } });
  const prepared = prepareWorkspaceBackupRestore(input, { allowedOriginalIds: [originalId] });
  assert.equal(prepared.drafts['new:text'].sourceCardId, originalId);
  assert.deepEqual(prepared.drafts['new:text'].articleFigure, { blockId: 'figure' });
  assert.deepEqual(prepared.drafts['new:text'].collectionIds, []);
});

test('legacy bare board draft stays recoverable during merge after its foreign node is removed', () => {
  const board = { title: '旧画布', nodes: [{ id: 'local', itemPath: local.id, x: 0, y: 0 }, { id: 'foreign', itemPath: originalId, x: 1, y: 1 }], edges: [{ id: 'edge', from: 'local', to: 'foreign' }] };
  const input = state({ 'board:legacy': { ...board, id: 'legacy' } });
  const prepared = prepareWorkspaceBackupRestore(input);
  assert.equal(prepared.drafts['board:legacy'], undefined);
  const merged = mergeWorkspaceBackup(createWorkspaceState(), prepared);
  const record = Object.values(merged.drafts).find((entry) => entry.key === 'board:legacy');
  assert.ok(record && record.recoveryOnly);
  assert.deepEqual(record.value.nodes, [board.nodes[0]]);
  assert.deepEqual(record.value.backupSourceReferences.nodes, board.nodes);
});
