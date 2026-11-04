import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { IDBFactory } from 'fake-indexeddb';
import { createAttachmentStore, reconnectAttachmentUrls } from '../src/sublime/attachmentStore.js';
import { inspectWorkspaceBackup, applyWorkspaceBackup, exportWorkspaceZip, previewBackupState } from '../src/sublime/workspaceBackup.js';
import {
  createWorkspaceState,
  canRestoreEmptyWorkspace,
  restoreEmptyWorkspace,
  workspaceReducer,
  mergeWorkspaceBackup,
} from '../src/sublime/workspaceModel.js';
const require = createRequire(import.meta.url);
const { createFileAttachmentStore } = require('../../../desktop/attachment-store.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
function picture(i) {
  const bytes = Buffer.concat([png, Buffer.from([i])]);
  return { name: 'source.png', type: 'image/png', size: bytes.length, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
}
async function backup() {
  const files = createAttachmentStore({ bridge: null, indexedDB: new IDBFactory() });
  const state = [0, 1].reduce(
    (s, i) => workspaceReducer(s, { type: 'card.upsert', card: { id: 'image' + i, title: 'Picture', type: 'image', attachment: picture(i) } }),
    createWorkspaceState(),
  );
  const bytes = await exportWorkspaceZip(state, files, { type: 'uint8array' });
  await files.dispose();
  return bytes;
}
async function native(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mc-repair-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = createFileAttachmentStore({ directory });
  return {
    files: createAttachmentStore({
      bridge: {
        put: files.put,
        read: async (ref) => new Uint8Array(await files.read(ref)),
        restore: files.restore,
        settleRestore: files.settleRestore,
      },
    }),
    directory,
  };
}

test('ZIP inspection validates the last member and all metadata before touching native files', async (t) => {
  const { directory } = await native(t);
  const bytes = await backup(),
    plan = await inspectWorkspaceBackup(bytes);
  assert.equal((await previewBackupState(plan)).cards.length, 2);
  assert.deepEqual(await readdir(directory), []);
  const zip = await JSZip.loadAsync(bytes);
  const last = plan.attachments.at(-1);
  zip.file('attachments/' + last.sha256, Buffer.alloc(last.size));
  await assert.rejects(inspectWorkspaceBackup(await zip.generateAsync({ type: 'uint8array' })), /校验失败/);
  assert.deepEqual(await readdir(directory), []);
});

test('native confirmed restore replaces damaged bytes and rolls back unpublished new files on failed entity commit', async (t) => {
  const { files, directory } = await native(t),
    plan = await inspectWorkspaceBackup(await backup());
  const [one, two] = plan.attachments;
  const onePath = path.join(directory, one.sha256);
  await writeFile(onePath, Buffer.alloc(one.size));
  await assert.rejects(
    applyWorkspaceBackup(plan, files, () => {
      throw Error('transaction aborted');
    }),
    /transaction aborted/,
  );
  assert.deepEqual(await readdir(directory), [one.sha256]); // repaired shared digest is preserved
  const repaired = Buffer.from((await plan.readFile(one)).dataUrl.split(',')[1], 'base64');
  assert.deepEqual(await readFile(onePath), repaired);
  await applyWorkspaceBackup(plan, files, () => true);
  assert.deepEqual(Buffer.from(await (await files.get(two)).arrayBuffer()), Buffer.from((await plan.readFile(two)).dataUrl.split(',')[1], 'base64'));
});
test('concurrent ordinary saves retain a shared new file when the in-flight restore aborts', async (t) => {
  const { files, directory } = await native(t),
    plan = await inspectWorkspaceBackup(await backup());
  const adopted = plan.attachments[0];
  await assert.rejects(
    applyWorkspaceBackup(plan, files, async () => {
      await files.put(await plan.readFile(adopted));
      throw Error('cancelled');
    }),
    /cancelled/,
  );
  assert.deepEqual(await readdir(directory), [adopted.sha256]);
});

async function browserBlobWrite(idb, key, blob) {
  const db = await new Promise((resolve, reject) => {
    const r = idb.open('mengcang-workspace-attachments-v3', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise((r, j) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(blob, key);
    tx.oncomplete = r;
    tx.onabort = j;
  });
  db.close();
}
test('browser confirmed repair replaces damaged Blob; failed entity commit cleans provisional blobs but preserves ordinary concurrent writes', async () => {
  const indexedDB = new IDBFactory(),
    files = createAttachmentStore({ indexedDB, bridge: null }),
    plan = await inspectWorkspaceBackup(await backup());
  const [one, two] = plan.attachments;
  await browserBlobWrite(indexedDB, one.sha256, new Blob([new Uint8Array(one.size)]));
  const placeholder = await files.url(one);
  assert.match(placeholder, /^mengcang-asset:/);
  await assert.rejects(files.get(one), { code: 'ATTACHMENT_INTEGRITY' });
  await assert.rejects(
    applyWorkspaceBackup(plan, files, () => {
      throw Error('failure');
    }),
    /failure/,
  );
  assert.equal((await files.get(one)).size, one.size);
  await assert.rejects(files.get(two), /校验失败/);
  const display = await files.url(one);
  assert.match(display, /^blob:/);
  const before = { cards: [{ attachment: { dataUrl: placeholder }, body: placeholder }] };
  const reconnected = reconnectAttachmentUrls(before, new Map([[placeholder, display]]));
  assert.equal(reconnected.cards[0].attachment.dataUrl, display);
  assert.equal(reconnected.cards[0].body, placeholder);
  const otherWindow = createAttachmentStore({ indexedDB, bridge: null });
  await assert.rejects(
    applyWorkspaceBackup(plan, files, async () => {
      await otherWindow.put(await plan.readFile(two));
      throw Error('failure');
    }),
    /failure/,
  );
  assert.equal((await otherWindow.get(two)).size, two.size);
  await files.dispose();
  await otherWindow.dispose();
});
test('exact empty restore retains original note, private flag, star, hidden and recall, and rejects a competing edit', () => {
  const clean = { ...createWorkspaceState(), drafts: { legacyDiscoveryImported: true } },
    id = '01_sources/original.md';
  const state = {
    ...createWorkspaceState(),
    annotations: { [id]: { note: 'actual note', private: true, collectionIds: [] } },
    favoriteIds: [id],
    hiddenIds: [id],
    drafts: { 'recall-workbench-v1': { read: { a: true } } },
  };
  const exact = restoreEmptyWorkspace(clean, state);
  assert.equal(exact.annotations[id].note, 'actual note');
  assert.equal(exact.annotations[id].private, true);
  assert.deepEqual(exact.favoriteIds, [id]);
  assert.deepEqual(exact.hiddenIds, [id]);
  assert.deepEqual(exact.drafts['recall-workbench-v1'], state.drafts['recall-workbench-v1']);
  const changed = workspaceReducer(clean, { type: 'card.note', id, note: 'newer note' });
  assert.equal(canRestoreEmptyWorkspace(changed), false);
  assert.throws(() => restoreEmptyWorkspace(changed, state), /已有本机资料/);
  const merged = mergeWorkspaceBackup(changed, state, { knownCardIds: [id] });
  assert.equal(merged.annotations[id].note, 'newer note');
  assert.deepEqual(merged.hiddenIds, []);
  assert.deepEqual(merged.favoriteIds, []);
});
