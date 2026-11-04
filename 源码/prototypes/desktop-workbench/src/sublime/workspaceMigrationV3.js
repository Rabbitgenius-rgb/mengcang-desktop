import { collectAttachmentReferences } from './workspaceBackup.js';
import { createWorkspaceState, normalizeWorkspaceState } from './workspaceModel.js';
import { sameValue } from './workspaceStoreV3Entities.js';
import { hydrateAttachmentUrls, nativeAttachmentUrl } from './attachmentStore.js';

export function openWorkspaceDatabase(indexedDB, name, stores) {
  let opening;
  const open = () => {
    if (!opening)
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          for (const store of stores) {
            const entity = request.result.createObjectStore(store);
            if (store !== 'meta' && store !== 'workspaces' && store !== 'backups') entity.createIndex('identity', 'identity');
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            opening = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          opening = null;
          reject(request.error || Error('本机资料库无法打开。'));
        };
        request.onblocked = () => {
          opening = null;
          reject(Error('本机资料库被其他版本占用，请关闭旧窗口后重试。'));
        };
      });
    return opening;
  };
  open.close = async () => {
    const pending = opening;
    opening = null;
    if (pending) {
      try {
        (await pending).close();
      } catch {
        /* Failed opens own no connection. */
      }
    }
  };
  return open;
}

function transactionRecord(db, store, mode, id, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = mode === 'readonly' ? tx.objectStore(store).get(id) : tx.objectStore(store).put(value, id);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error || Error('迁移备份读写失败，原资料仍保留。'));
  });
}

export function legacyWorkspaceSnapshot(raw) {
  if (raw?.format === 'workspace-storage-v2') {
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 0 || !raw.entityVersions || typeof raw.entityVersions !== 'object') {
      throw Error('旧资料库存储版本无效，请保留原数据。');
    }
    return { state: normalizeWorkspaceState(raw.state), revision: raw.revision, entityVersions: { ...raw.entityVersions } };
  }
  if (raw === undefined) return { state: createWorkspaceState(), revision: 0, entityVersions: {} };
  return { state: normalizeWorkspaceState(raw), revision: 0, entityVersions: {} };
}

export function createLegacyWorkspaceAccess(identity, { indexedDB = globalThis.indexedDB, databaseName = 'mengcang-sublime-workspace-v1' } = {}) {
  const open = openWorkspaceDatabase(indexedDB, databaseName, ['workspaces']);
  const backups = openWorkspaceDatabase(indexedDB, `${databaseName}-migration-backups`, ['backups']);
  async function read() {
    const raw = await transactionRecord(await open(), 'workspaces', 'readonly', identity);
    return { raw, present: raw !== undefined, snapshot: legacyWorkspaceSnapshot(raw) };
  }
  async function backup(legacy) {
    // The backup is outside the destination workspace and committed before
    // attachment conversion or v3 entity writes. Readback verifies its payload.
    const key = JSON.stringify([identity, legacy.snapshot.revision]);
    const db = await backups();
    const previous = await transactionRecord(db, 'backups', 'readonly', key);
    if (previous !== undefined && !sameValue(previous.raw, legacy.raw)) throw Error('同版本旧库备份不一致，已停止迁移。');
    if (previous === undefined) await transactionRecord(db, 'backups', 'readwrite', key, { identity, raw: legacy.raw });
    const saved = await transactionRecord(db, 'backups', 'readonly', key);
    if (!sameValue(saved?.raw, legacy.raw)) throw Error('旧库备份校验失败，已停止迁移。');
    return { database: `${databaseName}-migration-backups`, key };
  }
  async function remove(expected) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite'),
        store = tx.objectStore('workspaces'),
        request = store.get(identity);
      let failure;
      request.onsuccess = () => {
        if (!sameValue(request.result, expected.raw)) {
          failure = Error('旧版资料已改变，旧副本保留，请先核对。');
          tx.abort();
          return;
        }
        store.delete(identity);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('旧副本未能清理。'));
    });
  }
  return { read, backup, remove, close: () => Promise.all([open.close(), backups.close()]) };
}

// Old pre-envelope records have no monotonic revision. Fingerprint only that
// compatibility branch so an older application cannot silently fork its data.
export async function legacyWorkspaceSource(legacy) {
  const source = { present: legacy.present, revision: legacy.snapshot.revision, format: legacy.raw?.format || 'legacy' };
  if (source.present && source.format === 'legacy') {
    if (!globalThis.crypto?.subtle) throw Error('当前环境无法核验旧资料，请保留原库并在梦藏中重试。');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(legacy.raw)));
    source.sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return source;
}

export async function matchingLegacyVersion(legacy, source) {
  if (!source || legacy.present !== source.present) return false;
  if (!legacy.present) return true;
  if (legacy.snapshot.revision !== source.revision || (legacy.raw?.format || 'legacy') !== source.format) return false;
  if (source.format !== 'legacy') return true;
  const current = await legacyWorkspaceSource(legacy);
  return typeof source.sha256 === 'string' && source.sha256 === current.sha256;
}

// Called under the same per-workspace lock as commits. Read the on-disk
// snapshot and original files again; generating desktop display URLs does
// not open their files. A failure leaves both versions available.
export async function verifyAndRemoveLegacy({ readWorkspace, legacy, attachments, updateMeta }) {
  const { meta, diskState } = await readWorkspace();
  if (!meta.legacySource?.present || meta.legacyCleaned || (meta.successfulStartIds?.length || 0) < 3) {
    throw Error('旧副本状态已改变，请重新打开本机工具。');
  }
  try {
    // Run the same entity validation as cold startup, using metadata-only URLs
    // so malformed cards cannot be hidden by an already hydrated in-memory cache.
    normalizeWorkspaceState(await hydrateAttachmentUrls(diskState, { url: nativeAttachmentUrl }));
  } catch (error) {
    throw Error('新资料库结构校验失败，旧版副本已保留。请先恢复资料再重试。', { cause: error });
  }
  const previous = await legacy.read();
  if (!(await matchingLegacyVersion(previous, meta.legacySource))) throw Error('旧版资料发生变化，旧副本已保留。');
  await legacy.backup(previous);
  for (const ref of collectAttachmentReferences(diskState)) {
    try {
      // Both store adapters verify the original size and SHA-256 in get().
      await attachments.get(ref);
    } catch (error) {
      throw Error(`附件校验失败（${ref.type}，${ref.sha256.slice(0, 12)}）。旧版副本已保留，请先恢复原附件再重试。`, { cause: error });
    }
  }
  await updateMeta((current) => {
    if (current.revision !== meta.revision || current.legacyCleaned) throw Error('校验期间资料库已改变，旧副本已保留。请重新核对。');
    return { ...current, legacyCleanupRequested: true };
  });
  await legacy.remove(previous);
  await updateMeta((current) => ({ ...current, legacyCleaned: true }));
}
