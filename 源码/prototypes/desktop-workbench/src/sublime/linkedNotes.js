import { workspaceReducer } from './workspaceModel.js';

export const linkedNoteDraftKey = (sourceId) => 'linked-note-draft:' + sourceId;
const sameDraft = (a, b) => a === b || (!!a && !!b && a.id === b.id && a.createdAt === b.createdAt && a.title === b.title && a.body === b.body);

// One draft per source. Check its previous contents inside the transaction so
// a delayed autosave or a second window cannot overwrite someone else's edit.
export function openLinkedNoteDraft({ source, initial, id, createdAt, commit, nativeSource }) {
  const key = linkedNoteDraftKey(source.id);
  let stored = initial ?? null;
  if (
    stored !== null &&
    (typeof stored.id !== 'string' ||
      !stored.id.startsWith('linked-note:') ||
      typeof stored.createdAt !== 'string' ||
      typeof stored.title !== 'string' ||
      typeof stored.body !== 'string')
  ) {
    throw Error('无法读取这张资料的关联笔记草稿，原草稿已保留。');
  }
  let value = stored || { id, createdAt, title: '', body: '' };
  let tail = Promise.resolve(),
    finished = false;
  function write(mode) {
    const input = value;
    const run = async () => {
      if (finished) return;
      const next = mode === 'retain' && (input.title || input.body || stored) ? input : null;
      if (mode === 'retain' && sameDraft(stored, next)) return;
      if (mode !== 'discard' || stored) {
        await commit((state) => {
          const current = state.drafts[key] ?? null;
          if (!sameDraft(current, stored)) {
            if (mode === 'discard') return state;
            throw Error('草稿已在别处修改。请先复制当前输入，再放弃这次编辑，重新打开核对。');
          }
          const updated = mode === 'publish' ? createLinkedNote(state, { ...input, source }, nativeSource()) : state;
          return sameDraft(current, next) ? updated : workspaceReducer(updated, { type: 'draft.set', key, value: next });
        });
      }
      stored = next;
      finished = mode !== 'retain';
    };
    tail = tail.then(run, run);
    return tail;
  }
  return {
    get value() {
      return value;
    },
    update(field, text) {
      value = { ...value, [field]: text };
      return value;
    },
    flush: () => write('retain'),
    discard: () => write('discard'),
    publish: () => write('publish'),
  };
}

export function isLinkedNote(card) {
  return card?.type === 'text' && card.id?.startsWith('linked-note:') && !!card.sourceCardId;
}

// The note owns the link. Source cards, including read-only Vault files,
// need no edit, and renames and duplicate article URLs do not affect it.
export function linkedNoteRelations(card, library) {
  const source = isLinkedNote(card) ? library.find((item) => item.id === card.sourceCardId) || null : null;
  const notes = library.filter((item) => isLinkedNote(item) && item.sourceCardId === card.id);
  return { source, notes };
}

export function createLinkedNote(state, { id, source, title, body, createdAt }, nativeSource = false) {
  if (!source?.id || id === source.id || !id?.startsWith('linked-note:')) throw Error('关联笔记标识无效。');
  if (!body?.trim()) throw Error('请先写下笔记正文。');
  const noteTitle = title?.trim() || body.trim().split(/\r?\n/, 1)[0].slice(0, 90);
  const existing = state.cards.find((item) => item.id === id);
  if (existing) {
    if (
      isLinkedNote(existing) &&
      existing.sourceCardId === source.id &&
      existing.body === body &&
      existing.title === noteTitle &&
      state.savedIds.includes(id) &&
      !state.hiddenIds.includes(id)
    )
      return state;
    throw Error('这条笔记已经变化，请重新打开后核对。');
  }

  const localSource = state.cards.find((item) => item.id === source.id);
  if (state.hiddenIds.includes(source.id) || !(nativeSource || (localSource && state.savedIds.includes(source.id)))) {
    throw Error('来源资料已移出个人资料库。请恢复来源后再保存笔记。');
  }
  const note = {
    id,
    path: id,
    type: 'text',
    origin: 'local',
    title: noteTitle,
    body,
    sourceCardId: source.id,
    sourceTitle: localSource?.title || source.title || '',
    createdAt,
    updatedAt: createdAt,
  };
  const withNote = workspaceReducer(state, { type: 'card.upsert', card: note });
  return workspaceReducer(withNote, { type: 'card.save', id, saved: true });
}
