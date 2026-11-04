import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStoreV3, WORKSPACE_V3_DATABASE } from '../src/sublime/workspaceStoreV3.js';
import { createLegacyWorkspaceAccess, openWorkspaceDatabase } from '../src/sublime/workspaceMigrationV3.js';
import { WORKSPACE_V3_STORES } from '../src/sublime/workspaceStoreV3Entities.js';
import { createWorkspaceState, normalizeWorkspaceState, workspaceReducer } from '../src/sublime/workspaceModel.js';
import { createAttachmentStore, externalizeAttachmentUrls, restoreAttachmentData, nativeAttachmentUrl } from '../src/sublime/attachmentStore.js';
import { createWorkspaceSession } from '../src/sublime/workspacePersistence.js';
const isolated = () => ({ indexedDB: new IDBFactory(), createChannel: () => null, eventTarget: null, locks: null });
const add = (id) => (state) =>
  [
    { type: 'card.upsert', card: { id, title: id, body: id } },
    { type: 'card.save', id, saved: true },
  ].reduce(workspaceReducer, state);
async function record(db, field, id, next) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(field, next === undefined ? 'readonly' : 'readwrite');
    const request = next === undefined ? tx.objectStore(field).get(id) : tx.objectStore(field).put(next, id);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
async function seed(options, state, revision = 17) {
  const db = await openWorkspaceDatabase(options.indexedDB, 'mengcang-sublime-workspace-v1', ['workspaces'])();
  const raw = { format: 'workspace-storage-v2', state: normalizeWorkspaceState(state), revision, entityVersions: { 'card:original': revision } };
  await record(db, 'workspaces', 'test', raw);
  return { db, raw };
}

test('v3 migrates every entity, keeps the legacy record and a verified backup, then reloads', async () => {
  const options = isolated();
  const state = add('original')(createWorkspaceState());
  state.drafts['recall-state'] = { unread: ['original'], archived: ['another'] };
  state.drafts['window-draft:old:new:text'] = { key: 'new:text', value: { body: 'unfinished' }, base: null };
  state.annotations.original = { note: 'preserved', private: true, collectionIds: ['saved'] };
  state.collections = [{ id: 'saved', title: 'Saved', cardIds: ['original'] }];
  state.boards = [{ id: 'canvas', title: 'Canvas', nodes: [{ id: 'node', itemPath: 'original', x: 0, y: 0 }], edges: [] }];
  const { db, raw } = await seed(options, state);
  const store = createWorkspaceStoreV3('test', options);
  const migrated = await store.loadSnapshot();
  assert.deepEqual(migrated.state, raw.state);
  assert.equal(migrated.revision, 17);
  assert.deepEqual(await record(db, 'workspaces', 'test'), raw);
  const backupDB = await openWorkspaceDatabase(options.indexedDB, 'mengcang-sublime-workspace-v1-migration-backups', ['backups'])();
  assert.deepEqual((await record(backupDB, 'backups', '["test",17]')).raw, raw);
  store.close();
  assert.deepEqual((await createWorkspaceStoreV3('test', options).loadSnapshot()).state, raw.state);
});

test('v3 concurrent stores preserve independent edits and metadata-only updates avoid card writes', async () => {
  const trace = [],
    options = { ...isolated(), trace: (entry) => trace.push(entry) };
  const a = createWorkspaceStoreV3('test', options),
    b = createWorkspaceStoreV3('test', options);
  await Promise.all([a.load(), b.load()]);
  await Promise.all([a.update(add('A')), b.update(add('B'))]);
  assert.deepEqual(
    (await a.load()).cards.map((card) => card.id),
    ['A', 'B'],
  );
  trace.length = 0;
  await a.update((state) => workspaceReducer(state, { type: 'card.favorite', id: 'A', value: true }));
  assert.ok(trace.some((entry) => entry.store === 'meta'));
  assert.equal(
    trace.some((entry) => entry.store === 'cards'),
    false,
  );
  assert.equal((await b.load()).favoriteIds.includes('A'), true);
  assert.ok((await b.loadSnapshot()).entityVersions['card-editor:A'] > 0);
});

test('v3 rejects stale same-card writes while retaining conflict drafts and other window changes', async () => {
  const options = isolated(),
    a = createWorkspaceStoreV3('test', options),
    b = createWorkspaceStoreV3('test', options);
  const one = createWorkspaceSession(a, { sessionId: 'one' }),
    two = createWorkspaceSession(b, { sessionId: 'two' });
  await one.commit([
    { type: 'card.upsert', card: { id: 'same', body: 'original' } },
    { type: 'card.save', id: 'same', saved: true },
  ]);
  await two.load();
  one.beginEdit('edit:same', { type: 'card', id: 'same' });
  two.beginEdit('edit:same', { type: 'card', id: 'same' });
  await one.commit({ type: 'draft.set', key: 'edit:same', value: { body: 'local unfinished' } });
  await two.commit({ type: 'card.upsert', card: { id: 'same', body: 'other window' } }, { editKey: 'edit:same' });
  await assert.rejects(one.commit({ type: 'card.upsert', card: { id: 'same', body: 'stale overwrite' } }, { editKey: 'edit:same' }), {
    code: 'WORKSPACE_CONFLICT',
  });
  assert.equal((await b.load()).cards[0].body, 'other window');
  assert.equal(one.drafts()['edit:same'].body, 'stale overwrite');
});

test('invalid or asynchronous v3 updater rolls back without partial entities or revision increments', async () => {
  const store = createWorkspaceStoreV3('test', isolated());
  await store.update(add('retained'));
  const before = await store.loadSnapshot();
  await assert.rejects(
    store.update(async (state) => state),
    /同步/,
  );
  await assert.rejects(
    store.update(() => {
      throw Error('synthetic failure');
    }),
    /synthetic failure/,
  );
  assert.deepEqual(await store.loadSnapshot(), before);
});

test('migration backup failure falls back to read-only without writing v3 or changing legacy', async () => {
  const options = isolated(),
    { raw } = await seed(options, add('original')(createWorkspaceState()));
  const access = createLegacyWorkspaceAccess('test', options);
  const store = createWorkspaceStoreV3('test', {
    ...options,
    legacy: {
      ...access,
      backup: async () => {
        throw Error('disk full');
      },
    },
  });
  const snapshot = await store.loadSnapshot();
  assert.equal(snapshot.readOnly, true);
  assert.deepEqual(snapshot.state, raw.state);
  await assert.rejects(store.update(add('lost')), { code: 'WORKSPACE_READ_ONLY' });
  const db = await openWorkspaceDatabase(options.indexedDB, WORKSPACE_V3_DATABASE, WORKSPACE_V3_STORES)();
  assert.equal(await record(db, 'meta', 'test'), undefined);
});

test('v3 detects an old application saving the retained v2 record before restart', async () => {
  const options = isolated(),
    { db, raw } = await seed(options, add('original')(createWorkspaceState()));
  const first = createWorkspaceStoreV3('test', options);
  await first.load();
  await first.update(add('new v3 card'));
  await record(db, 'workspaces', 'test', { ...raw, revision: raw.revision + 1, state: add('legacy new')(raw.state) });
  const reopened = createWorkspaceStoreV3('test', options);
  const current = await reopened.loadSnapshot();
  assert.equal(current.readOnly, true);
  assert.ok(current.state.cards.some((card) => card.id === 'new v3 card'));
  assert.ok((await record(db, 'workspaces', 'test')).state.cards.some((card) => card.id === 'legacy new'));
});

test('legacy cleanup is explicit after three distinct successful starts, retaining its backup and v3 changes', async () => {
  const options = { ...isolated(), locks: navigator.locks },
    { db } = await seed(options, add('original')(createWorkspaceState()));
  const store = createWorkspaceStoreV3('test', options);
  await store.load();
  await assert.rejects(store.cleanupLegacy(), /三次/);
  await store.recordSuccessfulStartup('app-start-one');
  await store.recordSuccessfulStartup('app-start-one');
  assert.equal(store.migrationStatus().successfulStarts, 1);
  await store.recordSuccessfulStartup('app-start-two');
  await store.recordSuccessfulStartup('app-start-three');
  assert.equal(store.migrationStatus().canCleanup, true);
  await store.update(add('after migration'));
  await store.cleanupLegacy();
  assert.equal(await record(db, 'workspaces', 'test'), undefined);
  const reopened = await createWorkspaceStoreV3('test', options).loadSnapshot();
  assert.equal(reopened.readOnly, undefined);
  assert.ok(reopened.state.cards.some((card) => card.id === 'after migration'));
});

test('library identity isolates v3 records and broadcasts', async () => {
  const options = isolated(),
    a = createWorkspaceStoreV3('one', options),
    b = createWorkspaceStoreV3('two', options);
  await Promise.all([a.load(), b.load()]);
  await a.update(add('private one'));
  assert.equal((await b.load()).cards.length, 0);
  let foreign = 0;
  const stop = b.subscribe(() => foreign++);
  await a.update(add('private two'));
  assert.equal(foreign, 0);
  stop();
});

const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
test('attachment preparation conflict rejects once without rerunning the synchronous updater', async () => {
  const options = isolated();
  let complete,
    preparing,
    calls = 0;
  const started = new Promise((resolve) => {
    preparing = resolve;
  });
  const ready = new Promise((resolve) => {
    complete = resolve;
  });
  const attachments = {
    put: async (input) => {
      preparing();
      await ready;
      return { sha256: 'a'.repeat(64), type: 'image/png', size: input.size };
    },
    url: async (ref) => nativeAttachmentUrl(ref),
  };
  const a = createWorkspaceStoreV3('test', { ...options, attachments }),
    b = createWorkspaceStoreV3('test', options);
  await Promise.all([a.load(), b.load()]);
  const saving = a.update((state) => {
    calls++;
    return { ...state, drafts: { ...state.drafts, newFile: { dataUrl: picture } } };
  });
  const rejected = assert.rejects(saving, { code: 'WORKSPACE_CONFLICT' });
  await started;
  await b.update(add('other-window'));
  complete();
  await rejected;
  assert.equal(calls, 1);
  const loaded = await a.load();
  assert.equal(loaded.cards[0].id, 'other-window');
  assert.equal(loaded.drafts.newFile, undefined);
});

test('attachment IO failure preserves revision and original cards with no partially written draft', async () => {
  const options = isolated(),
    attachments = {
      put: async () => {
        throw Error('disk full');
      },
      url: async (ref) => nativeAttachmentUrl(ref),
    };
  const store = createWorkspaceStoreV3('test', { ...options, attachments });
  await store.update(add('original'));
  const before = await store.loadSnapshot();
  await assert.rejects(
    store.update((state) => ({ ...state, drafts: { newFile: { dataUrl: picture } } })),
    /disk full/,
  );
  assert.deepEqual(await store.loadSnapshot(), before);
});

test('a mutating updater cannot corrupt the in-memory snapshot after failure', async () => {
  const store = createWorkspaceStoreV3('test', isolated());
  await store.update(add('original'));
  await assert.rejects(
    store.update((state) => {
      state.cards[0].body = 'corrupted';
      throw Error('failure');
    }),
  );
  assert.equal((await store.load()).cards[0].body, 'original');
});

test('real Blob attachment migration removes base64 from v3 records and restores exact bytes after reload', async () => {
  const options = isolated(),
    state = add('original')(createWorkspaceState());
  state.drafts.fileDraft = { attachment: { dataUrl: picture } };
  const { db, raw } = await seed(options, state);
  const attachmentStore = createAttachmentStore({ indexedDB: options.indexedDB });
  const store = createWorkspaceStoreV3('test', { ...options, attachments: attachmentStore });
  const result = await store.loadSnapshot();
  assert.equal(result.readOnly, undefined);
  const v3 = await openWorkspaceDatabase(options.indexedDB, WORKSPACE_V3_DATABASE, WORKSPACE_V3_STORES)();
  const persisted = await record(v3, 'drafts', ['test', 'fileDraft']);
  assert.ok(persisted.value.attachment.dataUrl.$attachment.sha256);
  assert.equal(JSON.stringify(persisted).includes('base64'), false);
  assert.deepEqual(await record(db, 'workspaces', 'test'), raw);
  const reopened = createWorkspaceStoreV3('test', { ...options, attachments: attachmentStore });
  const restored = await restoreAttachmentData(externalizeAttachmentUrls((await reopened.load()).drafts), attachmentStore);
  assert.equal(restored.fileDraft.attachment.dataUrl, picture);
  await attachmentStore.dispose();
});

test('raw legacy records without revisions detect old-application edits after migration', async () => {
  const options = isolated();
  const db = await openWorkspaceDatabase(options.indexedDB, 'mengcang-sublime-workspace-v1', ['workspaces'])();
  const original = add('original')(createWorkspaceState());
  await record(db, 'workspaces', 'test', original);
  const first = createWorkspaceStoreV3('test', options);
  assert.equal((await first.load()).cards[0].id, 'original');
  // An older raw-state writer has no revision to advance.
  const changed = add('new-in-old-app')(original);
  await record(db, 'workspaces', 'test', changed);
  const reopened = createWorkspaceStoreV3('test', options);
  const snapshot = await reopened.loadSnapshot();
  assert.equal(snapshot.readOnly, true);
  assert.ok(snapshot.state.cards.some((card) => card.id === 'original'));
  assert.deepEqual(await record(db, 'workspaces', 'test'), changed);
  await assert.rejects(reopened.update(add('unsafe-fork')), { code: 'WORKSPACE_READ_ONLY' });
});

test('restart completes interrupted legacy cleanup metadata without rewriting v3 contents', async () => {
  const options = { ...isolated(), locks: navigator.locks };
  const { db } = await seed(options, add('original')(createWorkspaceState()));
  const access = createLegacyWorkspaceAccess('test', options);
  const store = createWorkspaceStoreV3('test', {
    ...options,
    legacy: {
      ...access,
      remove: async (previous) => {
        await access.remove(previous);
        throw Error('process interrupted after deletion');
      },
    },
  });
  await store.load();
  for (const id of ['start-one', 'start-two', 'start-three']) await store.recordSuccessfulStartup(id);
  await store.update(add('migration-era-card'));
  const before = await store.loadSnapshot();
  await assert.rejects(store.cleanupLegacy(), /process interrupted/);
  assert.equal(await record(db, 'workspaces', 'test'), undefined);
  const trace = [];
  const reopened = createWorkspaceStoreV3('test', { ...options, trace: (entry) => trace.push(entry) });
  assert.deepEqual(await reopened.loadSnapshot(), before);
  assert.equal(reopened.migrationStatus().legacyCleaned, true);
  assert.equal(reopened.migrationStatus().canCleanup, false);
  assert.equal(
    trace.some((entry) => entry.store !== 'meta'),
    false,
  );
});

test('damaged retained legacy data leaves healthy v3 and its post-migration records readable for export', async () => {
  const options = isolated();
  const { db, raw } = await seed(options, add('original')(createWorkspaceState()));
  const first = createWorkspaceStoreV3('test', options);
  await first.update(add('post-migration'));
  const damaged = { ...raw, state: { ...raw.state, schemaVersion: 999 } };
  await record(db, 'workspaces', 'test', damaged);
  const reopened = createWorkspaceStoreV3('test', options);
  const session = createWorkspaceSession(reopened);
  await session.load();
  assert.equal(session.migrationStatus().readOnly, true);
  assert.match(session.migrationStatus().issue, /可导出/);
  assert.deepEqual(
    (await session.settled()).cards.map((card) => card.id),
    ['original', 'post-migration'],
  );
  assert.deepEqual(await record(db, 'workspaces', 'test'), damaged);
  await assert.rejects(reopened.update(add('not saved')), { code: 'WORKSPACE_READ_ONLY' });
  assert.equal(session.migrationStatus().canCleanup, false);
});

test('cleanup validates original bytes referenced only by a draft and preserves legacy if a different window commits during validation', async () => {
  const options = { ...isolated(), locks: navigator.locks };
  const state = add('sample')(createWorkspaceState());
  state.drafts.figure = { attachment: { dataUrl: picture } };
  const { db, raw } = await seed(options, state);
  const files = createAttachmentStore({ indexedDB: options.indexedDB });
  let targetRead;
  const store = createWorkspaceStoreV3('test', { ...options, attachments: { ...files, url: nativeAttachmentUrl, get: (ref) => targetRead(ref) } });
  await store.load();
  for (const id of ['a', 'b', 'c']) await store.recordSuccessfulStartup(id);
  targetRead = () => {
    throw Error('missing original');
  };
  await assert.rejects(store.cleanupLegacy(), /附件校验失败/);
  assert.deepEqual(await record(db, 'workspaces', 'test'), raw);

  // Simulate an older/non-cooperating writer that does not participate in Web Locks.
  const other = createWorkspaceStoreV3('test', { ...options, attachments: files, locks: null });
  targetRead = async (ref) => {
    await other.update(add('concurrent change'));
    return files.get(ref);
  };
  await assert.rejects(store.cleanupLegacy(), /校验期间资料库已改变/);
  assert.deepEqual(await record(db, 'workspaces', 'test'), raw);
  targetRead = (ref) => files.get(ref);
  await store.cleanupLegacy();
  assert.equal(await record(db, 'workspaces', 'test'), undefined);
  assert.ok((await store.load()).cards.some((card) => card.id === 'concurrent change'));
});
