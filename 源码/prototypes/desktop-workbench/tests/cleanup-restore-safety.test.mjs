import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStoreV3, WORKSPACE_V3_DATABASE } from '../src/sublime/workspaceStoreV3.js';
import { WORKSPACE_V3_STORES } from '../src/sublime/workspaceStoreV3Entities.js';
import { createLegacyWorkspaceAccess, openWorkspaceDatabase } from '../src/sublime/workspaceMigrationV3.js';
import { createWorkspaceState, normalizeWorkspaceState } from '../src/sublime/workspaceModel.js';
import { createAttachmentStore, nativeAttachmentUrl } from '../src/sublime/attachmentStore.js';
import { exportWorkspaceZip, inspectWorkspaceBackup, applyWorkspaceBackup } from '../src/sublime/workspaceBackup.js';
import { withAttachmentMaintenance } from '../src/sublime/attachmentMaintenance.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const picture = (number) => {
  const bytes = Buffer.concat([image, Buffer.from([number])]);
  return { name: `picture-${number}.png`, type: 'image/png', size: bytes.length, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
};
async function record(db, field, key, operation = 'get', value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(field, operation === 'get' ? 'readonly' : 'readwrite');
    const entries = tx.objectStore(field);
    const request = operation === 'put' ? entries.put(value, key) : operation === 'delete' ? entries.delete(key) : entries.get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
async function migrated(t) {
  const indexedDB = new IDBFactory();
  const options = { indexedDB, locks: navigator.locks, eventTarget: null, createChannel: () => null };
  const originalState = normalizeWorkspaceState({
    ...createWorkspaceState(),
    cards: [{ id: 'original', title: 'Original', type: 'text', body: 'Saved original' }],
    savedIds: ['original'],
    drafts: { figures: [picture(1), picture(2)] },
  });
  const v2 = await openWorkspaceDatabase(indexedDB, 'mengcang-sublime-workspace-v1', ['workspaces'])();
  const raw = { format: 'workspace-storage-v2', revision: 11, entityVersions: { 'card:original': 11 }, state: originalState };
  await record(v2, 'workspaces', 'test', 'put', raw);
  const files = createAttachmentStore({ indexedDB, bridge: null });
  const store = createWorkspaceStoreV3('test', { ...options, attachments: { ...files, url: nativeAttachmentUrl } });
  await store.load();
  for (const id of ['one', 'two', 'three']) await store.recordSuccessfulStartup(id);
  t.after(() => { store.close(); v2.close(); });
  return { indexedDB, options, store, files, v2, raw };
}

test('cleanup validates fresh entity contents before deleting v2 even when a stale renderer cache remains valid', async (t) => {
  const { indexedDB, store, v2, raw, files } = await migrated(t);
  const db = await openWorkspaceDatabase(indexedDB, WORKSPACE_V3_DATABASE, WORKSPACE_V3_STORES)();
  t.after(() => { db.close(); return files.dispose(); });
  const card = await record(db, 'cards', ['test', 'original']);
  await record(db, 'cards', ['test', 'original'], 'put', { ...card, value: { ...card.value, origin: 'broken' } });
  await assert.rejects(store.cleanupLegacy(), /结构校验失败/);
  assert.deepEqual(await record(v2, 'workspaces', 'test'), raw);
  assert.equal((await record(db, 'meta', 'test')).legacyCleaned, false);
});

test('cleanup waits for a provisional restore rollback and keeps v2 when its required original is missing again', async (t) => {
  const { indexedDB, store, v2, raw, files, options } = await migrated(t);
  t.after(() => files.dispose());
  const zip = await exportWorkspaceZip(raw.state, files, { type: 'uint8array' });
  const plan = await inspectWorkspaceBackup(zip);
  const [first] = plan.attachments;
  const blobs = await new Promise((resolve, reject) => {
    const request = indexedDB.open('mengcang-workspace-attachments-v3');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  t.after(() => blobs.close());
  await record(blobs, 'blobs', first.sha256, 'delete');
  let release, paused;
  const pause = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { paused = resolve; });
  let stillCurrent = true, commits = 0;
  const restore = withAttachmentMaintenance(() => applyWorkspaceBackup({
    ...plan,
    async readFile(ref) {
      if (ref.sha256 !== first.sha256) { paused(); await pause; }
      return plan.readFile(ref);
    },
  }, files, () => { commits++; }, () => stillCurrent), { locks: options.locks });
  const canceled = assert.rejects(restore, /恢复操作已取消/);
  await ready;
  assert.equal((await files.get(first)).size, first.size);
  let cleanupFinished = false;
  const cleanup = store.cleanupLegacy().finally(() => { cleanupFinished = true; });
  const blocked = assert.rejects(cleanup, /附件校验失败/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupFinished, false);
  assert.deepEqual(await record(v2, 'workspaces', 'test'), raw);
  stillCurrent = false;
  release();
  await canceled;
  await blocked;
  assert.equal(commits, 0);
  assert.deepEqual(await record(v2, 'workspaces', 'test'), raw);
  await assert.rejects(files.get(first), /校验失败/);
  assert.equal(store.migrationStatus().legacyCleaned, false);
  // Repair followed by maintenance still works, and preserves the separate backup.
  await files.put(picture(1));
  await store.cleanupLegacy();
  assert.equal(await record(v2, 'workspaces', 'test'), undefined);
  const access = createLegacyWorkspaceAccess('test', options);
  t.after(() => access.close());
  assert.equal((await access.read()).present, false);
});
