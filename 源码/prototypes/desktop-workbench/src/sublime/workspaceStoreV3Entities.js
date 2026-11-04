const recordFields = ['cards', 'collections', 'boards', 'annotations', 'drafts'];
export const WORKSPACE_V3_STORES = [...recordFields, 'meta'];
export const WORKSPACE_V3_FORMAT = 'workspace-storage-v3';
export const sameValue = (left, right) => left === right || JSON.stringify(left) === JSON.stringify(right);

export function workspaceRecords(state, field) {
  return ['annotations', 'drafts'].includes(field) ? new Map(Object.entries(state[field])) : new Map(state[field].map((value) => [value.id, value]));
}

function versionedEntities(state) {
  const entities = new Map();
  for (const [field, prefix] of [
    ['cards', 'card'],
    ['collections', 'collection'],
    ['boards', 'board'],
  ]) {
    for (const value of state[field]) entities.set(`${prefix}:${value.id}`, value);
  }
  for (const [id, value] of Object.entries(state.annotations)) entities.set(`note:${id}`, value);
  for (const [id, value] of Object.entries(state.drafts)) entities.set(`draft:${id}`, value);
  const memberships = new Map();
  for (const collection of state.collections) {
    for (const id of collection.cardIds) {
      if (!memberships.has(id)) memberships.set(id, []);
      memberships.get(id).push(collection.id);
    }
  }
  const saved = new Set(state.savedIds),
    favorite = new Set(state.favoriteIds),
    hidden = new Set(state.hiddenIds);
  const ids = new Set([...state.cards.map((card) => card.id), ...Object.keys(state.annotations), ...saved, ...favorite, ...hidden, ...memberships.keys()]);
  for (const id of ids) {
    entities.set(`card-editor:${id}`, {
      annotation: Object.hasOwn(state.annotations, id) ? state.annotations[id] : null,
      saved: saved.has(id),
      favorite: favorite.has(id),
      hidden: hidden.has(id),
      collectionIds: (memberships.get(id) || []).sort(),
    });
  }
  return entities;
}

export function workspaceMeta(state, previous, revision, before) {
  const entityVersions = { ...previous.entityVersions };
  if (before) {
    const oldValues = versionedEntities(before),
      nextValues = versionedEntities(state);
    for (const name of new Set([...oldValues.keys(), ...nextValues.keys()])) {
      if (sameValue(oldValues.get(name), nextValues.get(name))) continue;
      entityVersions[name] = revision;
      if (name.startsWith('card:')) entityVersions[`card-editor:${name.slice(5)}`] = revision;
    }
  }
  return {
    ...previous,
    format: WORKSPACE_V3_FORMAT,
    revision,
    entityVersions,
    schemaVersion: state.schemaVersion,
    version: state.version,
    savedIds: state.savedIds,
    favoriteIds: state.favoriteIds,
    hiddenIds: state.hiddenIds,
    order: Object.fromEntries(['cards', 'collections', 'boards'].map((field) => [field, state[field].map((value) => value.id)])),
  };
}

export function writeWorkspaceRecords(transaction, identity, before, after, trace = () => {}) {
  for (const field of recordFields) {
    const oldValues = workspaceRecords(before, field),
      nextValues = workspaceRecords(after, field);
    const objectStore = transaction.objectStore(field);
    for (const [id, value] of nextValues) {
      if (sameValue(oldValues.get(id), value)) continue;
      objectStore.put({ identity, id, value }, [identity, id]);
      trace({ store: field, operation: 'put', id });
    }
    for (const id of oldValues.keys()) {
      if (nextValues.has(id)) continue;
      objectStore.delete([identity, id]);
      trace({ store: field, operation: 'delete', id });
    }
  }
}

export function readWorkspaceRecords(transaction, identity, meta, done, fail) {
  const values = {},
    pending = new Set(recordFields);
  for (const field of recordFields) {
    const request = transaction.objectStore(field).index('identity').getAll(identity);
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      try {
        const records = new Map(request.result.map(({ id, value }) => [id, value]));
        values[field] = ['annotations', 'drafts'].includes(field)
          ? Object.fromEntries(records)
          : (meta.order[field] || []).map((id) => {
              if (!records.has(id)) throw Error('本机资料库实体不完整，请保留数据并恢复备份。');
              return records.get(id);
            });
        pending.delete(field);
        if (!pending.size)
          done({
            schemaVersion: meta.schemaVersion,
            version: meta.version,
            savedIds: meta.savedIds,
            favoriteIds: meta.favoriteIds,
            hiddenIds: meta.hiddenIds,
            ...values,
          });
      } catch (error) {
        fail(error);
      }
    };
  }
}
