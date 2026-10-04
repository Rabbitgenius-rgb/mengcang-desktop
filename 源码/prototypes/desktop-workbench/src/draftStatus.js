import {patchFields, valueOf} from './desktopModel.js';

export function hasDraftChanges(draft) {
  return Boolean(draft && (Object.keys(patchFields(draft.form, draft.baseValues)).length || draft.exploration?.trim()));
}

// Each note has one write queue, shared across component remounts. A late write
// must not replace a newer edit or restore a draft after the user discards it.
export function createDraftStore(api) {
  const writes = new Map();
  const enqueue = (key, action) => {
    const previous = writes.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    writes.set(key, pending);
    const remove = () => { if (writes.get(key) === pending) writes.delete(key); };
    pending.then(remove, remove);
    return pending;
  };
  return {
    async read(key) {
      await writes.get(key)?.catch(() => {});
      return valueOf(await api.draftGet(key));
    },
    write(key, draft) {
      return enqueue(key, () => Promise.resolve(api.draftSet(key, draft)).then(valueOf));
    },
    discard(key, retainedDraft) {
      return enqueue(key, async () => {
        try { return valueOf(await api.draftSet(key, null)); }
        catch (error) {
          // The desktop bridge updates its memory cache before its disk write.
          // Restore that cache before allowing another component to read it.
          try { valueOf(await api.draftSet(key, retainedDraft)); } catch {}
          throw error;
        }
      });
    },
  };
}

const stores = new WeakMap();
export function draftStoreFor(api) {
  if (!stores.has(api)) stores.set(api, createDraftStore(api));
  return stores.get(api);
}

export function draftStatus({ready, hasChanges, localState, localError, conflict, saving, saveError}) {
  if (!ready) return {state:'restoring', label:'正在恢复草稿…'};
  if (saving) return {state:'saving-note', label:'正在保存到 Obsidian…'};
  if (conflict) return {state:'conflict', label:'存在冲突 · 请核对当前笔记'};
  if (localError) return {state:'error', label:hasChanges?'本机草稿保存失败':'本机草稿状态更新失败'};
  if (saveError) return {state:'error', label:'尚未确认保存到 Obsidian'};
  if (localState === 'saving') return {state:'saving-local', label:'本机草稿保存中…'};
  if (hasChanges) return {state:'local', label:'本机草稿 · 尚未保存到 Obsidian'};
  return {state:'saved', label:'已保存到 Obsidian'};
}
