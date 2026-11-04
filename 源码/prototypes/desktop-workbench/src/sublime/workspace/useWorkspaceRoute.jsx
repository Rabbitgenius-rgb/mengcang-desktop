import React from 'react';
import { workspaceReducer } from '.././workspaceModel.js';
import { resolveNoteReference } from '.././workspaceView.js';
import { initialFilters, workspaceSearchScope } from './constants.js';

export function useWorkspaceRoute({
  activeSearchScope,
  searches,
  setPopover,
  setModal,
  setEditorDraft,
  navigation,
  loadedIdentity,
  identityId,
  commit,
  setSelected,
  setSelectionMode,
  meaningActive,
  setFilters,
  meaningCache,
  libraryCards,
  current,
  notify,
  session,
  setNoteDraft,
  stateRef,
  cards,
  popover,
  perform,
  draftKey,
}) {
  function navigate(page, id = '', sourcePage = 1, overrides = {}) {
    const target = { page, id, sourcePage },
      scope = workspaceSearchScope(target);
    if (scope && scope !== activeSearchScope && !overrides.filters) overrides = { ...overrides, filters: searches.get(scope) || initialFilters };
    setPopover(null);
    setModal(null);
    setEditorDraft(undefined);
    navigation.open(target, overrides);
  }

  function changeRecallArchive(id, hidden) {
    const guard = () => {
      if (loadedIdentity.current !== identityId) throw Error('工作区已切换，请回到原工作区重试。');
    };
    guard();
    return commit((existing) => {
      guard();
      const card = existing.cards.find((c) => c.id === id);
      if (!card?.recallReceipt || !card.externalSource || !existing.savedIds.includes(id)) throw Error('此摘录不存在，或不属于当前资料库。');
      return workspaceReducer(existing, { type: 'card.hide', id, hidden });
    });
  }

  function finishSelection() {
    setSelected([]);
    setSelectionMode(false);
  }

  function changeSearchMode(searchMode) {
    if (meaningActive === (searchMode === 'meaning')) return;
    setSelected([]);
    setFilters((value) => ({ ...value, searchMode }));
  }

  function changeLibraryQuery(query) {
    meaningCache.last = null;
    setFilters((value) => ({ ...value, query, searchMode: 'keyword' }));
  }

  function openNoteReference(target) {
    const match = resolveNoteReference(target, libraryCards, current);
    if (match.status === 'resolved') {
      navigate('card', match.matches[0].id);
      if (String(target).includes('#')) notify('已打开引用资料；章节位置请在正文中查看。');
    } else if (match.status === 'ambiguous') setModal({ type: 'reference-choice', target, source: current });
    else {
      navigate('library', '', 1, { filters: { ...initialFilters, query: String(target).split('#')[0].split('/').pop().replace(/\.md$/i, '') } });
      notify(match.status === 'ambiguous' ? '找到多份同名资料，请选择要查看的一份。' : '当前资料库未找到该引用，已按名称查找。');
    }
  }

  function openNote(card) {
    const draft = session.beginEdit?.(`note:${card.id}`, { type: 'note', id: card.id });
    setNoteDraft(draft?.note ?? stateRef.current.annotations[card.id]?.note ?? card.caption ?? '');
    setModal({ type: 'note', card });
    setPopover(null);
  }

  function showAi(mode = 'Insights') {
    const card = cards.find((x) => x.id === popover?.cardId) || current;
    setPopover(null);
    setModal({ type: 'ai', mode, card });
  }

  function openEditor(kind, card) {
    const key = card ? `edit:${card.id}` : `new:${kind}`;
    navigate('add', card ? 'edit:' + card.id : kind);
    setEditorDraft(session.drafts()[key]);
  }

  function editDraft(value) {
    const safe = JSON.parse(JSON.stringify(value));
    setEditorDraft(safe);
    perform({ type: 'draft.set', key: draftKey, value: safe });
  }
  return { navigate, changeRecallArchive, finishSelection, changeSearchMode, changeLibraryQuery, openNoteReference, openNote, showAi, openEditor, editDraft };
}
