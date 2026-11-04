import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createAttachmentStore } from '../src/sublime/attachmentStore.js';
import { applyWorkspaceBackup, exportLegacyWorkspace, exportWorkspaceZip, inspectWorkspaceBackup } from '../src/sublime/workspaceBackup.js';
import { createWorkspaceState, workspaceReducer } from '../src/sublime/workspaceModel.js';

const require = createRequire(import.meta.url);
const { createFileAttachmentStore } = require('../../../desktop/attachment-store.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
async function fixture(format) {
  const files = createAttachmentStore({ bridge: null, indexedDB: new IDBFactory() });
  const state = [1, 2].reduce((state, n) => {
    const bytes = Buffer.concat([png, Buffer.from([n])]);
    return workspaceReducer(state, { type: 'card.upsert', card: { id: 'image-' + n, type: 'image', title: '图片', attachment: {
      name: n + '.png', type: 'image/png', size: bytes.length, dataUrl: 'data:image/png;base64,' + bytes.toString('base64'),
    } } });
  }, createWorkspaceState());
  try {
    return inspectWorkspaceBackup(format === 'JSON' ? await exportLegacyWorkspace(state, files) : await exportWorkspaceZip(state, files, { type: 'uint8array' }));
  } finally { await files.dispose(); }
}
async function target(t, mode) {
  if (mode === 'native') {
    const directory = await mkdtemp(path.join(tmpdir(), 'mc-backup-retention-'));
    t.after(() => rm(directory, { force: true, recursive: true }));
    const native = createFileAttachmentStore({ directory });
    return {
      files: createAttachmentStore({ bridge: { put: native.put, restore: native.restore, settleRestore: native.settleRestore, read: native.read } }),
      keys: () => readdir(directory),
      corrupt: ref => writeFile(path.join(directory, ref.sha256), Buffer.alloc(ref.size)),
      bytes: ref => readFile(path.join(directory, ref.sha256)),
    };
  }
  const indexedDB = new IDBFactory();
  const files = createAttachmentStore({ bridge: null, indexedDB });
  t.after(() => files.dispose());
  async function access(mode, fn) {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('mengcang-workspace-attachments-v3', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', mode); const r = fn(tx.objectStore('blobs'));
      tx.oncomplete = () => resolve(r.result); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  }
  return {
    files,
    keys: () => access('readonly', store => store.getAllKeys()),
    corrupt: ref => access('readwrite', store => store.put(new Blob([new Uint8Array(ref.size)]), ref.sha256)),
    bytes: async ref => Buffer.from(await (await files.get(ref)).arrayBuffer()),
  };
}

for (const mode of ['native', 'browser']) for (const format of ['ZIP', 'JSON']) {
  test(`${mode} ${format} preview is pure; entity failure cleans new files and preserves repaired existing bytes`, async t => {
    const plan = await fixture(format), disk = await target(t, mode);
    assert.deepEqual(await disk.keys(), []);
    const [first, damaged] = plan.attachments;
    await disk.corrupt(damaged);
    await assert.rejects(applyWorkspaceBackup(plan, disk.files, () => { throw Error('entity failure'); }), /entity failure/);
    assert.deepEqual(await disk.keys(), [damaged.sha256]);
    const expected = Buffer.from((await plan.readFile(damaged)).dataUrl.split(',')[1], 'base64');
    assert.deepEqual(await disk.bytes(damaged), expected);
    await assert.rejects(disk.files.get(first));
  });
  test(`${mode} ${format} successful merge keeps only attachments referenced by its committed result`, async t => {
    const plan = await fixture(format), disk = await target(t, mode);
    const textOnly = workspaceReducer(createWorkspaceState(), { type: 'card.upsert', card: { id: 'image-1', type: 'text', title: '现有文字', body: '保持文字' } });
    await applyWorkspaceBackup(plan, disk.files, () => textOnly, () => true, { retainedState: state => state });
    assert.deepEqual(await disk.keys(), []);
    const selected = { ...plan.state, cards: [plan.state.cards[0]] };
    await applyWorkspaceBackup(plan, disk.files, () => selected, () => true, { retainedState: state => state });
    assert.deepEqual(await disk.keys(), [plan.attachments[0].sha256]);
  });
  test(`${mode} ${format} unused merge files adopted by an ordinary save remain available`, async t => {
    const plan = await fixture(format), disk = await target(t, mode), adopted = plan.attachments[0];
    await applyWorkspaceBackup(plan, disk.files, async () => {
      await disk.files.put(await plan.readFile(adopted));
      return createWorkspaceState();
    }, () => true, { retainedState: state => state });
    assert.deepEqual(await disk.keys(), [adopted.sha256]);
  });
}
