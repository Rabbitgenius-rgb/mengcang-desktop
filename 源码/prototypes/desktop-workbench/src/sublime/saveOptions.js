import { workspaceReducer } from './workspaceModel.js';

export function saveOptionsSnapshot(state, card, nativeSaved = false) {
  return {
    id: card.id,
    exists: state.cards.some((x) => x.id === card.id),
    nativeSaved,
    saved: (nativeSaved || state.savedIds.includes(card.id)) && !state.hiddenIds.includes(card.id),
    hidden: state.hiddenIds.includes(card.id),
    note: state.annotations[card.id]?.note ?? card.caption ?? '',
    private: state.annotations[card.id]?.private ?? false,
    favorite: state.favoriteIds.includes(card.id),
    collectionIds: state.collections.filter((x) => x.cardIds.includes(card.id)).map((x) => x.id),
  };
}
export function hasSaveOptionsChanges(base, value) {
  return (
    !base.saved ||
    ['note', 'private', 'favorite'].some((key) => base[key] !== value[key]) ||
    (value.newCollectionTitle || '').trim() ||
    base.collectionIds.some((id) => !value.collectionIds.includes(id)) ||
    value.collectionIds.some((id) => !base.collectionIds.includes(id))
  );
}
// One transaction. Touch only fields explicitly changed in this panel; keep the
// original card/attachment, unrelated memberships, drafts and recall state.
export function applySaveOptions(state, card, base, value) {
  if (base.id !== card.id) throw Error('保存目标已变化，请重新打开保存面板。');
  if (typeof value.note !== 'string' || value.note.length > 50000) throw Error('备注最多 50000 个字符。');
  if (typeof value.favorite !== 'boolean' || typeof value.private !== 'boolean' || !Array.isArray(value.collectionIds))
    throw Error('保存选项无效，请重新打开面板。');
  const latest = saveOptionsSnapshot(state, card, base.nativeSaved);
  if ((base.exists && !latest.exists) || base.hidden !== latest.hidden || (base.saved && !latest.saved))
    throw Error('这张资料的保存或归档状态已变化，请重新打开后核对。');
  const actions = [];
  if (!latest.saved) {
    if (!latest.exists && !base.nativeSaved) actions.push({ type: 'card.upsert', card });
    actions.push({ type: 'card.save', id: card.id, saved: true }, { type: 'card.hide', id: card.id, hidden: false });
  }
  if (value.note !== base.note) {
    if (latest.note !== base.note && latest.note !== value.note) throw Error('备注已在其他窗口修改。你的输入仍保留，请重新打开并核对原备注。');
    actions.push({ type: 'card.note', id: card.id, note: value.note });
  }
  if (value.private !== base.private) actions.push({ type: 'card.note', id: card.id, private: value.private });
  if (value.favorite !== base.favorite) actions.push({ type: 'card.favorite', id: card.id, value: value.favorite });
  for (const id of new Set([...base.collectionIds, ...value.collectionIds])) {
    const selected = value.collectionIds.includes(id);
    if (selected === base.collectionIds.includes(id)) continue;
    if (!state.collections.some((x) => x.id === id)) {
      if (selected) throw Error('选择的收藏集已被移除，请取消该选项后重试。');
      continue;
    }
    actions.push({ type: 'collection.toggleCard', id, cardId: card.id, selected });
  }
  const title = String(value.newCollectionTitle || '').trim();
  if (title) {
    if (title.length > 200) throw Error('新收藏集名称最多 200 个字符。');
    const existing = state.collections.find((x) => x.title.normalize('NFC').toLocaleLowerCase() === title.normalize('NFC').toLocaleLowerCase());
    const id = existing?.id || value.newCollectionId;
    if (!id || (!existing && state.collections.some((x) => x.id === id))) throw Error('新收藏集标识已变化，请重新打开保存面板。');
    if (!existing) actions.push({ type: 'collection.upsert', collection: { id, title, private: true, cardIds: [] } });
    actions.push({ type: 'collection.toggleCard', id, cardId: card.id, selected: true });
  }
  return actions.reduce(workspaceReducer, state);
}

export function savePanelPosition(anchor, size, viewport) {
  const width = Math.min(size.width || 330, viewport.width - 32),
    height = Math.min(size.height || 330, viewport.height - 32);
  const left = Math.max(16, Math.min((anchor?.right ?? viewport.width - 24) - width, viewport.width - width - 16));
  let top = (anchor?.bottom ?? 72) + 9;
  if (top + height > viewport.height - 16) top = (anchor?.top ?? 72) - height - 9;
  return { left, top: Math.max(16, Math.min(top, viewport.height - height - 16)), width, maxHeight: viewport.height - 32 };
}
