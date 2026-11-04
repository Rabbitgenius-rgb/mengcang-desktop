import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  createAttachmentStore,
  attachmentRefForUrl,
  externalizeAttachments,
  externalizeAttachmentUrls,
  hydrateAttachmentUrls,
  restoreAttachmentData,
  nativeAttachmentUrl,
  readAttachmentBytes,
} from '../src/sublime/attachmentStore.js';
import { createWorkspaceState, workspaceReducer } from '../src/sublime/workspaceModel.js';
import { exportWorkspaceZip, importWorkspaceBackup, exportLegacyWorkspace, estimateLegacyWorkspaceBytes } from '../src/sublime/workspaceBackup.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const bytes = Buffer.from(png, 'base64'),
  dataUrl = `data:image/png;base64,${png}`;
const ref = { sha256: createHash('sha256').update(bytes).digest('hex'), type: 'image/png', size: bytes.length };
const attachment = { name: 'concept.png', type: ref.type, size: ref.size, dataUrl };
function memoryStore() {
  const files = new Map();
  return {
    files,
    writes: 0,
    reads: 0,
    async put(value) {
      const content = Buffer.from(value.dataUrl.split(',')[1], 'base64'),
        sha256 = createHash('sha256').update(content).digest('hex');
      this.writes++;
      files.set(sha256, new Blob([content], { type: value.type }));
      return { sha256, type: value.type, size: content.length };
    },
    async get(value) {
      this.reads++;
      const blob = files.get(value.sha256);
      if (!blob) throw Error('missing');
      return blob;
    },
    async url(value) {
      return nativeAttachmentUrl(value);
    },
  };
}
test('migration externalizes independent images, article blocks and nested draft sources, with reversible exact bytes', async () => {
  const store = memoryStore(),
    original = {
      cards: [{ image: dataUrl, attachment, article: { blocks: [{ attachment }] } }],
      drafts: { editing: { value: { attachment } }, ai: { source: { image: dataUrl, attachment } } },
      body: dataUrl,
      note: dataUrl,
    };
  const saved = await externalizeAttachments(original, store);
  assert.equal(store.files.size, 1);
  assert.equal(store.writes, 1);
  assert.deepEqual(saved.cards[0].image, { $attachment: ref });
  assert.deepEqual(saved.drafts.ai.source.attachment.dataUrl, { $attachment: ref });
  assert.deepEqual(await restoreAttachmentData(saved, store), original);
  assert.equal(original.cards[0].image, dataUrl);
  assert.equal(saved.body, dataUrl);
  assert.equal(saved.note, dataUrl);
});
test('hydrated attachment URLs dehydrate synchronously without loading attachment bytes during metadata updates', async () => {
  const store = memoryStore();
  await store.put(attachment);
  const saved = { attachment: { ...attachment, dataUrl: { $attachment: ref } } };
  const runtime = await hydrateAttachmentUrls(saved, store);
  assert.deepEqual(attachmentRefForUrl(runtime.attachment.dataUrl), ref);
  assert.equal(store.reads, 0);
  assert.deepEqual(externalizeAttachmentUrls(runtime), saved);
  assert.equal(store.reads, 0);
  assert.throws(() => externalizeAttachmentUrls({ attachment }), { code: 'ATTACHMENT_PREPARATION_REQUIRED' });
});
test('native bridge uses compact metadata for URL hydration and validates lazy byte reads', async () => {
  let reads = 0;
  const store = createAttachmentStore({
    bridge: {
      put: async () => ref,
      read: async () => {
        reads++;
        return bytes;
      },
    },
  });
  assert.deepEqual(await store.put(attachment), ref);
  const url = await store.url(ref);
  assert.equal(reads, 0);
  assert.deepEqual(await store.get(ref), new Blob([bytes], { type: ref.type }));
  assert.equal(reads, 1);
  const result = await readAttachmentBytes({ ...attachment, dataUrl: url }, { fetch: async () => new Response(bytes) });
  assert.deepEqual(Buffer.from(result), bytes);
  await assert.rejects(readAttachmentBytes({ ...attachment, dataUrl: url }, { fetch: async () => new Response(Buffer.alloc(bytes.length)) }), /校验失败/);
});
test('ZIP roundtrip preserves full workspace fields and includes each file once', async () => {
  const source = memoryStore();
  const initial = workspaceReducer(createWorkspaceState(), { type: 'card.upsert', card: { id: 'concept', title: '概念图', attachment } });
  const state = {
    ...initial,
    savedIds: ['concept'],
    annotations: { concept: { note: '来源备注', private: true, collectionIds: [] } },
    drafts: { reader: { location: { page: 2 } }, ai: { source: { attachment } } },
  };
  const zip = await exportWorkspaceZip(state, source, { type: 'uint8array', revision: 7, entityVersions: { 'card:concept': 7 } });
  const parsed = await JSZip.loadAsync(zip);
  assert.equal(Object.keys(parsed.files).filter((name) => /^attachments\/[^/]+$/.test(name)).length, 1);
  const target = memoryStore(),
    imported = await importWorkspaceBackup(zip, target);
  assert.equal(imported.revision, 7);
  assert.deepEqual(imported.entityVersions, { 'card:concept': 7 });
  assert.deepEqual(await restoreAttachmentData(imported.state, target), state);
  const legacy = await exportLegacyWorkspace(imported.state, target);
  assert.equal(JSON.parse(legacy).cards[0].attachment.dataUrl, dataUrl);
  assert.equal(JSON.parse(legacy).annotations.concept.note, '来源备注');
  assert.deepEqual((await importWorkspaceBackup(legacy, target)).state.cards[0].attachment, attachment);
  assert.deepEqual((await importWorkspaceBackup(new Blob([legacy]), target)).state.cards[0].attachment, attachment);
});
test('ZIP rejects missing, modified files and traversal paths before state can be accepted', async () => {
  const source = memoryStore(),
    state = { schemaVersion: 1, cards: [{ id: 'a', attachment }] };
  const bytes = await exportWorkspaceZip(state, source, { type: 'uint8array' });
  const absent = await JSZip.loadAsync(bytes);
  absent.remove(`attachments/${ref.sha256}`);
  await assert.rejects(importWorkspaceBackup(await absent.generateAsync({ type: 'uint8array' }), memoryStore()), /缺失/);
  const modified = await JSZip.loadAsync(bytes);
  modified.file(`attachments/${ref.sha256}`, Buffer.alloc(ref.size, 1));
  await assert.rejects(importWorkspaceBackup(await modified.generateAsync({ type: 'uint8array' }), memoryStore()), /校验失败/);
  const traversal = await JSZip.loadAsync(bytes);
  traversal.file('../outside.txt', 'unexpected');
  await assert.rejects(importWorkspaceBackup(await traversal.generateAsync({ type: 'uint8array' }), memoryStore()), /不安全路径/);
});

test('ZIP detects a manifest bit flip even when the corrupted JSON would still parse', async () => {
  const source = memoryStore(),
    zip = Buffer.from(await exportWorkspaceZip({ schemaVersion: 1, cards: [] }, source, { type: 'uint8array' }));
  const offset = zip.indexOf(Buffer.from('"createdAt"'));
  assert.ok(offset > 0);
  zip[offset + 1] = 'd'.charCodeAt(0);
  await assert.rejects(importWorkspaceBackup(zip, memoryStore()), /清单校验失败/);
});
test('missing files are rejected before any imported attachment is staged', async () => {
  const source = memoryStore(),
    archive = await JSZip.loadAsync(await exportWorkspaceZip({ schemaVersion: 1, cards: [{ attachment }] }, source, { type: 'uint8array' }));
  archive.remove(`attachments/${ref.sha256}`);
  const target = memoryStore();
  await assert.rejects(importWorkspaceBackup(await archive.generateAsync({ type: 'uint8array' }), target));
  assert.equal(target.writes, 0);
});
test('desktop read adapters accept checked dataURL bridge responses', async () => {
  const store = createAttachmentStore({ bridge: { read: async () => ({ ok: true, data: { dataUrl } }) } });
  assert.deepEqual(Buffer.from(await (await store.get(ref)).arrayBuffer()), bytes);
});

test('browser attachment storage writes Blobs and recreates URLs from persisted bytes after reopening', async () => {
  const files = new Map();
  let closed = 0;
  const db = {
    close() {
      closed++;
    },
    createObjectStore() {},
    transaction() {
      const tx = {
        objectStore() {
          return {
            get(key) {
              return operation(() => files.get(key));
            },
            put(value, key) {
              return operation(() => {
                files.set(key, value);
                return key;
              });
            },
          };
        },
      };
      function operation(run) {
        const request = {};
        queueMicrotask(() => {
          request.result = run();
          request.onsuccess?.();
          queueMicrotask(() => tx.oncomplete?.());
        });
        return request;
      }
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
  let count = 0;
  const revoked = [],
    urlApi = {
      createObjectURL() {
        return `blob:synthetic-${++count}`;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    };
  const one = createAttachmentStore({ indexedDB, urlApi });
  const saved = await one.put(attachment);
  await one.put({ ...attachment, name: 'renamed.png' });
  assert.equal(files.size, 1);
  assert.ok(files.get(saved.sha256) instanceof Blob);
  const firstUrl = await one.url(saved);
  assert.deepEqual(attachmentRefForUrl(firstUrl), saved);
  await one.dispose();
  assert.equal(attachmentRefForUrl(firstUrl), null);
  assert.deepEqual(revoked, [firstUrl]);
  const two = createAttachmentStore({ indexedDB, urlApi });
  assert.deepEqual(Buffer.from(await (await two.get(saved)).arrayBuffer()), bytes);
  assert.notEqual(await two.url(saved), firstUrl);
  await two.dispose();
  assert.equal(closed, 2);
});

test('legacy downgrade rejects an oversized library before reading any original attachment', async () => {
  const large = { ...ref, size: 64 * 1024 * 1024 };
  let reads = 0;
  const store = {
    get() {
      reads++;
      throw Error('Original bytes must not be loaded');
    },
  };
  const state = {
    schemaVersion: 1,
    cards: Array.from({ length: 5 }, (_, id) => ({
      id: String(id),
      attachment: { name: 'large.png', type: large.type, size: large.size, dataUrl: { $attachment: large } },
    })),
  };
  await assert.rejects(exportLegacyWorkspace(state, store), { code: 'LEGACY_BACKUP_TOO_LARGE' });
  assert.equal(reads, 0);
});
test('legacy size estimation compacts only the duplicate card image and counts nested source copies', () => {
  const marker = { $attachment: ref };
  const state = { card: { attachment: { ...attachment, dataUrl: marker }, image: marker }, draft: { source: { image: marker } } };
  const original = { card: { attachment, image: dataUrl }, draft: { source: { image: dataUrl } } };
  const compact = { ...original, card: { attachment } };
  assert.equal(estimateLegacyWorkspaceBytes(state), new Blob([JSON.stringify(compact)]).size);
});
