import { createWorkspaceState, normalizeWorkspaceState } from './workspaceModel.js';
import { workspaceConflict } from './workspaceStore.js';
import { createAttachmentStore, externalizeAttachments, externalizeAttachmentUrls, hydrateAttachmentUrls } from './attachmentStore.js';
import {
  createLegacyWorkspaceAccess,
  verifyAndRemoveLegacy,
  legacyWorkspaceSource,
  matchingLegacyVersion,
  openWorkspaceDatabase,
} from './workspaceMigrationV3.js';
import { WORKSPACE_V3_STORES, workspaceMeta, writeWorkspaceRecords, readWorkspaceRecords } from './workspaceStoreV3Entities.js';
import { withAttachmentMaintenance } from './attachmentMaintenance.js';

export const WORKSPACE_V3_DATABASE = 'mengcang-sublime-workspace-v3';
const localListeners = new Map();
const staleCache = Symbol('refresh-before-updater');
const frozenRecords = new WeakSet();
function immutable(value) {
  if (value === null || typeof value !== 'object' || frozenRecords.has(value)) return value;
  for (const child of Object.values(value)) immutable(child);
  frozenRecords.add(value);
  return Object.freeze(value);
}
const defaultChannel = (name) => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null);

/** Synchronous updaters execute exactly once. Ordinary updates commit under one
 * IDB lock. New file bytes are prepared before a second revision-checked commit.
 * Web Locks serialize that preparation across cooperating browser windows. */
export function createWorkspaceStoreV3(identity = 'browser-preview', options = {}) {
  const key = String(identity);
  const {
    indexedDB = globalThis.indexedDB,
    openDatabase = openWorkspaceDatabase(indexedDB, WORKSPACE_V3_DATABASE, WORKSPACE_V3_STORES),
    legacy = createLegacyWorkspaceAccess(key, { indexedDB }),
    attachments = createAttachmentStore({ indexedDB }),
    normalize = normalizeWorkspaceState,
    locks = globalThis.navigator?.locks,
    createChannel = defaultChannel,
    eventTarget = globalThis.window,
    trace = () => {},
  } = options;
  let cache,
    opening,
    queue = Promise.resolve(),
    channel,
    readOnlyError,
    disposed = false;
  const listeners = new Set();

  function stateSnapshot(value = cache) {
    return {
      state: value.state,
      revision: value.meta.revision,
      entityVersions: value.meta.entityVersions,
      ...(readOnlyError ? { readOnly: true, migrationError: readOnlyError.message } : {}),
    };
  }
  async function accept(value) {
    if (cache && cache.meta.revision > value.meta.revision) return cache;
    if (cache && cache.meta.revision === value.meta.revision) {
      cache.meta = value.meta;
      return cache;
    }
    const state = immutable(normalize(await hydrateAttachmentUrls(value.diskState, attachments)));
    if (cache && cache.meta.revision > value.meta.revision) return cache;
    cache = { ...value, state };
    return cache;
  }
  async function readRaw({ fresh = false } = {}) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_V3_STORES, 'readonly');
      const request = tx.objectStore('meta').get(key);
      let result, failure;
      request.onsuccess = () => {
        const meta = request.result;
        if (!meta) {
          result = null;
          return;
        }
        if (!fresh && cache?.meta.revision === meta.revision) {
          result = { ...cache, meta };
          return;
        }
        readWorkspaceRecords(
          tx,
          key,
          meta,
          (diskState) => {
            result = { meta, diskState };
          },
          (error) => {
            failure = error;
            tx.abort();
          },
        );
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('本机资料库读取失败。'));
    });
  }
  async function bootstrap(previous) {
    const backup = previous.present ? await legacy.backup(previous) : null;
    const diskState = await externalizeAttachments(previous.snapshot.state, attachments);
    // Legacy writers do not participate in the v3 transaction. Check again after
    // potentially slow attachment IO, before committing any migrated entity.
    const current = await legacy.read();
    if (
      current.present !== previous.present ||
      current.snapshot.revision !== previous.snapshot.revision ||
      JSON.stringify(current.raw) !== JSON.stringify(previous.raw)
    )
      throw Error('旧版资料在迁移期间改变，已保留原库，请关闭旧版后重试。');
    const source = await legacyWorkspaceSource(previous);
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_V3_STORES, 'readwrite');
      const request = tx.objectStore('meta').get(key);
      request.onsuccess = () => {
        if (request.result) return;
        const meta = workspaceMeta(
          diskState,
          { entityVersions: previous.snapshot.entityVersions, legacySource: source, legacyBackup: backup, successfulStartIds: [], legacyCleaned: false },
          previous.snapshot.revision,
        );
        writeWorkspaceRecords(tx, key, createWorkspaceState(), diskState, trace);
        tx.objectStore('meta').put(meta, key);
      };
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || Error('资料库迁移未完成，原库仍保留。'));
    });
    return readRaw();
  }
  async function initialize() {
    if (!opening)
      opening = (async () => {
        const existing = await readRaw();
        if (existing) {
          await accept(existing);
          if (existing.meta.legacyCleaned) return;
          let previous;
          try {
            previous = await legacy.read();
          } catch (error) {
            readOnlyError = Error('旧版迁移副本无法读取。新资料库已只读打开，可导出已保存的资料。' + (error?.message || ''));
            return;
          }
          if (existing.meta.legacyCleanupRequested && !previous.present && !existing.meta.legacyCleaned) {
            // Deletion can finish before its completion marker reaches disk.
            // Finish only the maintenance marker, retaining every v3 entity.
            await maintain((meta) => ({ ...meta, legacyCleaned: true }), { duringStartup: true });
          }
          if (!(existing.meta.legacyCleanupRequested && !previous.present) && !(await matchingLegacyVersion(previous, existing.meta.legacySource))) {
            readOnlyError = Error('检测到旧版资料库发生变化。当前资料以只读方式打开，请先核对旧版新增内容。');
          }
          return;
        }
        const previous = await legacy.read();
        try {
          await accept(await bootstrap(previous));
        } catch (error) {
          // Only a failed first migration can fall back to v2. Never hide an
          // existing v3 library by silently replacing it with an older snapshot.
          readOnlyError = error;
          cache = {
            state: immutable(previous.snapshot.state),
            diskState: previous.snapshot.state,
            meta: workspaceMeta(previous.snapshot.state, { entityVersions: previous.snapshot.entityVersions }, previous.snapshot.revision),
          };
        }
      })().catch((error) => {
        opening = null;
        throw error;
      });
    return opening;
  }
  async function loadSnapshot() {
    await initialize();
    if (!readOnlyError) await accept(await readRaw());
    return stateSnapshot();
  }
  function changed() {
    for (const listener of listeners) listener();
  }
  function publish() {
    for (const listener of localListeners.get(key) || []) listener();
    let sender = channel;
    try {
      if (!sender) sender = createChannel(WORKSPACE_V3_DATABASE);
      sender?.postMessage({ key });
    } catch {
      /* Focus refresh also invalidates other windows. */
    } finally {
      if (sender && sender !== channel) sender.close?.();
    }
  }
  function connect() {
    if (disposed || localListeners.get(key)?.has(changed)) return;
    if (!localListeners.has(key)) localListeners.set(key, new Set());
    localListeners.get(key).add(changed);
    try {
      channel = createChannel(WORKSPACE_V3_DATABASE);
      if (channel)
        channel.onmessage = (event) => {
          if (event.data?.key === key) changed();
        };
    } catch {
      channel = null;
    }
    eventTarget?.addEventListener?.('focus', changed);
    eventTarget?.addEventListener?.('pageshow', changed);
  }
  function disconnect() {
    channel?.close?.();
    channel = null;
    localListeners.get(key)?.delete(changed);
    if (!localListeners.get(key)?.size) localListeners.delete(key);
    eventTarget?.removeEventListener?.('focus', changed);
    eventTarget?.removeEventListener?.('pageshow', changed);
  }
  function readOnlyFailure() {
    if (readOnlyError) throw Object.assign(Error(`资料库当前只读：${readOnlyError.message}`), { code: 'WORKSPACE_READ_ONLY' });
  }
  function writeResult(tx, before, state, diskState, meta) {
    const nextMeta = workspaceMeta(diskState, meta, meta.revision + 1, before.diskState);
    writeWorkspaceRecords(tx, key, before.diskState, diskState, trace);
    tx.objectStore('meta').put(nextMeta, key);
    trace({ store: 'meta', operation: 'put', id: key });
    return { state, diskState, meta: nextMeta };
  }
  async function updateOnce(updater) {
    const db = await openDatabase();
    const previous = cache;
    const outcome = await new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_V3_STORES, 'readwrite'),
        request = tx.objectStore('meta').get(key);
      let result,
        failure,
        refreshing = false;
      request.onsuccess = () => {
        const meta = request.result;
        if (!meta || meta.revision !== previous.meta.revision) {
          refreshing = true;
          tx.abort();
          return;
        }
        try {
          const output = updater(previous.state, stateSnapshot(previous));
          if (output == null) throw Error('更新操作未返回资料库状态，原内容未更改。');
          if (typeof output.then === 'function') throw Error('资料库事务更新必须同步完成。');
          const state = normalize(output);
          try {
            result = writeResult(tx, previous, state, externalizeAttachmentUrls(state), meta);
          } catch (error) {
            if (error.code !== 'ATTACHMENT_PREPARATION_REQUIRED') throw error;
            result = { prepare: true, state, previous, meta };
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => (refreshing ? resolve(staleCache) : reject(failure || tx.error || Error('本机保存失败，当前输入仍保留。')));
    });
    if (outcome === staleCache) return staleCache;
    if (!outcome.prepare) return outcome;
    const diskState = await externalizeAttachments(outcome.state, attachments);
    const state = normalize(await hydrateAttachmentUrls(diskState, attachments));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_V3_STORES, 'readwrite'),
        request = tx.objectStore('meta').get(key);
      let result, failure;
      request.onsuccess = () => {
        try {
          const meta = request.result;
          if (meta?.revision !== outcome.meta.revision) throw workspaceConflict('附件准备期间其他窗口已保存资料，当前输入保留，请核对后重试。');
          result = writeResult(tx, outcome.previous, state, diskState, meta);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('附件资料未能保存，当前输入仍保留。'));
    });
  }
  function update(updater) {
    const next = queue
      .catch(() => {})
      .then(async () => {
        await initialize();
        readOnlyFailure();
        const execute = async () => {
          for (let attempt = 0; attempt < 20; attempt++) {
            const result = await updateOnce(updater);
            if (result === staleCache) {
              await accept(await readRaw());
              continue;
            }
            cache = { ...result, state: immutable(result.state) };
            publish();
            return stateSnapshot();
          }
          throw workspaceConflict('资料库持续被其他窗口更新，当前输入保留，请稍后重试。');
        };
        return locks?.request ? locks.request(`${WORKSPACE_V3_DATABASE}:${key}`, execute) : execute();
      });
    queue = next;
    return next;
  }
  async function maintain(transform, { duringStartup = false } = {}) {
    if (!duringStartup) await initialize();
    readOnlyFailure();
    const db = await openDatabase();
    let meta, failure;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite'),
        request = tx.objectStore('meta').get(key);
      request.onsuccess = () => {
        try {
          meta = transform(request.result);
          tx.objectStore('meta').put(meta, key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('迁移状态未能保存。'));
    });
    if (cache.meta.revision === meta.revision) cache.meta = meta;
    return meta;
  }
  function migrationStatus() {
    const meta = cache?.meta;
    return {
      readOnly: !!readOnlyError,
      issue: readOnlyError?.message || '',
      migrated: !!meta?.legacySource?.present,
      successfulStarts: meta?.successfulStartIds?.length || 0,
      canCleanup: !readOnlyError && !!meta?.legacySource?.present && !meta?.legacyCleaned && (meta?.successfulStartIds?.length || 0) >= 3,
      legacyCleaned: !!meta?.legacyCleaned,
    };
  }
  return {
    loadSnapshot,
    load: async () => (await loadSnapshot()).state,
    update,
    save(value) {
      const expected = cache?.meta.revision;
      return update((current, meta) => {
        if (expected === undefined ? meta.revision !== 0 : meta.revision !== expected) throw workspaceConflict('其他窗口已更新资料库，旧快照未覆盖。', meta);
        return value;
      }).then(() => ({ saved: true }));
    },
    subscribe(listener) {
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disconnect();
      };
    },
    close() {
      disposed = true;
      listeners.clear();
      disconnect();
      void queue
        .catch(() => {})
        .then(async () => {
          if (!options.openDatabase) await openDatabase.close?.();
          if (!options.legacy) await legacy.close?.();
          if (!options.attachments) await attachments.dispose?.();
        })
        .catch(() => {});
    },
    migrationStatus,
    async recordSuccessfulStartup(startupId) {
      if (typeof startupId !== 'string' || !startupId.trim() || startupId.length > 200) throw Error('启动标识无效。');
      await maintain((meta) => ({ ...meta, successfulStartIds: [...new Set([...(meta.successfulStartIds || []), startupId])].slice(0, 3) }));
      return migrationStatus();
    },
    async cleanupLegacy() {
      await initialize();
      readOnlyFailure();
      if (!migrationStatus().canCleanup) throw Error('请完成三次正常启动读回后再清理旧副本。');
      if (!locks?.request) throw Error('当前环境无法锁定跨窗口写入，旧副本已保留。请在梦藏桌面版重试。');
      await withAttachmentMaintenance(
        () =>
          locks.request(`${WORKSPACE_V3_DATABASE}:${key}`, () =>
            verifyAndRemoveLegacy({ readWorkspace: () => readRaw({ fresh: true }), legacy, attachments, updateMeta: maintain }),
          ),
        { locks },
      );
      return migrationStatus();
    },
  };
}
