import React from 'react';
import { MEDIA_LABELS } from './constants.js';
import { LinkedNoteLinks } from './LinkedNoteEditor.jsx';
import { adaptItem } from './constants.js';
import { useMemo, useRef } from 'react';
import { listeningCard } from '../referenceCards.js';
import { filterWorkspaceGroups, selectWorkspaceCards, cardIdentityMetadata, createCardIdentityContext } from '../workspaceView.js';
import { useOriginalPosition } from '../useOriginalPosition.js';
import { articleFigureCollection } from '../articleFigures.js';
import { useLibraryMeaningSearch } from '../LibraryMeaningSearch.jsx';
import { createVaultSearchVersion } from '../localMaterialSearch.js';
export function useWorkspaceModels({
  items,
  state,
  demo,
  session,
  route,
  filters,
  shuffle,
  api,
  identityId,
  ready,
  loadedIdentity,
  selected,
  modal,
  navigate,
  popover,
}) {
  const external = useMemo(() => items.filter((item) => item.path || item.id).map(adaptItem), [items]);
  const cards = useMemo(() => {
    const map = new Map((demo ? [listeningCard, ...external.map((item) => ({ ...item, origin: 'reference' }))] : external).map((card) => [card.id, card]));
    state.cards.forEach((card) => map.set(card.id, card));
    return [...map.values()].map((card) => ({ ...card, caption: state.annotations[card.id]?.note ?? card.caption }));
  }, [external, state.cards, state.annotations, demo]);
  const clipperView = useRef(null);
  clipperView.current = { external, open: (id) => navigate('card', id) };
  const nativeIds = useMemo(() => (demo ? [] : external.map((card) => card.id)), [demo, external]);
  const membership = useMemo(
    () => ({ saved: new Set([...state.savedIds, ...nativeIds]), hidden: new Set(state.hiddenIds), favorite: new Set(state.favoriteIds) }),
    [state.savedIds, state.hiddenIds, state.favoriteIds, nativeIds],
  );
  const current = cards.find((card) => card.id === route.id) || null;
  const isPodcastClip = current?.type === 'audio' && current.sourceLocation?.startsWith('音频片段 '),
    clipAttachment = current?.attachment || cards.find((x) => x.id === current?.sourceCardId)?.attachment;
  const currentCollection = state.collections.find((collection) => collection.id === route.id);
  const boardDraft = session.drafts()[`board:${route.id}`];
  const currentBoard = boardDraft
    ? { ...state.boards.find((board) => board.id === route.id), ...boardDraft, id: route.id }
    : state.boards.find((board) => board.id === route.id);
  const saved = (card) => membership.saved.has(card.id) && !membership.hidden.has(card.id);
  const personalScope = ['library', 'favorites', 'collection'].includes(route.page);
  const personalSearch = personalScope && !!filters.query?.trim();
  const keywordCards = useMemo(
    () =>
      selectWorkspaceCards(cards, state, { filters: personalSearch ? { ...filters, inLibrary: true } : filters, route, shuffle, readOnlySavedIds: nativeIds }),
    [cards, state, filters, route, shuffle, nativeIds, personalSearch],
  );
  const libraryCards = useMemo(() => cards.filter((card) => membership.saved.has(card.id) && !membership.hidden.has(card.id)), [cards, membership]);
  const originalPosition = useOriginalPosition({ api, library: libraryCards, scope: identityId + ':' + route.page + ':' + route.id });
  const vaultSearchCache = useMemo(() => ({ identityId, measure: createVaultSearchVersion() }), [identityId]);
  const measureVaultSearch = vaultSearchCache.measure;
  const vaultSearchVersion = useMemo(() => measureVaultSearch(external), [measureVaultSearch, external]);
  const searchRevision = session.revision ?? state;
  const meaningCache = useMemo(() => ({ identityId, vaultSearchVersion, searchRevision, last: null }), [identityId, vaultSearchVersion, searchRevision]);
  const meaningActive = personalSearch && filters.searchMode === 'meaning';
  const meaningKey =
    meaningActive && ready && loadedIdentity.current === identityId
      ? JSON.stringify([route.page, route.id, filters.query, filters.media, !!filters.favorite])
      : '';
  const meaningSearch = useLibraryMeaningSearch({
    scopeKey: meaningKey,
    query: filters.query,
    cache: meaningCache,
    api,
    getCards: () => selectWorkspaceCards(libraryCards, state, { filters: { ...filters, query: '', inLibrary: true }, route, readOnlySavedIds: nativeIds }),
  });
  const searchScope = [
    currentCollection?.title || (route.page === 'favorites' ? '已标星' : '我的资料库'),
    filters.favorite && route.page !== 'favorites' ? '已标星' : '',
    MEDIA_LABELS[filters.media],
  ]
    .filter(Boolean)
    .join(' · ');
  const visibleCards = useMemo(() => {
    if (!meaningActive) return keywordCards;
    if (!meaningSearch.result) return [];
    const byId = new Map(libraryCards.map((card) => [card.id, card]));
    return meaningSearch.result.ranked.map((item) => byId.get(item.id)).filter(Boolean);
  }, [meaningActive, meaningSearch.result, libraryCards, keywordCards]);
  const selectedCards = useMemo(() => {
    const ids = new Set(selected);
    return visibleCards.filter((card) => ids.has(card.id));
  }, [visibleCards, selected]);
  const selectedIds = useMemo(() => selectedCards.map((card) => card.id), [selectedCards]);
  const collectionTargets = modal?.cardId ? [modal.cardId] : selectedIds;
  const identityCaches = useMemo(() => ({ identityId, related: new Map(), views: new Map(), saveDrafts: new Map() }), [identityId]);
  const relatedCache = identityCaches.related,
    relatedViews = identityCaches.views,
    saveOptionDrafts = identityCaches.saveDrafts;
  const savedFigures = useMemo(() => articleFigureCollection(current, libraryCards), [current, libraryCards]);
  const cardIdentityContext = useMemo(() => createCardIdentityContext(libraryCards), [libraryCards]);
  const identityFor = (card) => cardIdentityMetadata(card, cardIdentityContext);
  const groupPage = ['collections', 'canvases'].includes(route.page);
  const searchLabel = groupPage ? (route.page === 'collections' ? '搜索收藏集' : '搜索画布') : '搜索资料库';
  const collectionDraftKey = `collection:${route.id || 'new'}`;
  const visibleCollections = filterWorkspaceGroups(state.collections, filters.query, { shuffle, pinned: true });
  const visibleBoards = filterWorkspaceGroups(state.boards, filters.query, { shuffle });
  const theme = state.drafts.appearance || 'dark';
  const recoveryDrafts = session.recoverableDrafts?.() || [];
  const editId = route.page === 'add' && route.id.startsWith('edit:') ? route.id.slice(5) : '';
  const editing = cards.find((card) => card.id === editId);
  const draftKey = editing ? `edit:${editing.id}` : `new:${route.id || 'text'}`;
  const menuCard = cards.find((card) => card.id === popover?.cardId) || current;
  const uiCard = editing
    ? {
        ...editing,
        caption: state.annotations[editing.id]?.note ?? editing.caption,
        favorite: state.favoriteIds.includes(editing.id),
        private: state.annotations[editing.id]?.private || false,
        collectionIds: state.collections.filter((c) => c.cardIds.includes(editing.id)).map((c) => c.id),
      }
    : null;
  const linkedNoteLinks = current && <LinkedNoteLinks card={current} library={libraryCards} onOpen={(id) => navigate('card', id)} />;
  const isEditor =
    route.page === 'recall' ||
    route.page === 'reader' ||
    route.page === 'add' ||
    route.page === 'import' ||
    route.page === 'edit-collection' ||
    route.page === 'canvas';
  return {
    external,
    cards,
    clipperView,
    nativeIds,
    membership,
    current,
    isPodcastClip,
    clipAttachment,
    currentCollection,
    boardDraft,
    currentBoard,
    saved,
    personalScope,
    personalSearch,
    keywordCards,
    libraryCards,
    originalPosition,
    measureVaultSearch,
    vaultSearchVersion,
    meaningCache,
    meaningActive,
    meaningKey,
    meaningSearch,
    searchScope,
    visibleCards,
    selectedCards,
    selectedIds,
    collectionTargets,
    relatedCache,
    relatedViews,
    saveOptionDrafts,
    savedFigures,
    cardIdentityContext,
    identityFor,
    groupPage,
    searchLabel,
    collectionDraftKey,
    visibleCollections,
    visibleBoards,
    theme,
    recoveryDrafts,
    editId,
    editing,
    draftKey,
    menuCard,
    uiCard,
    linkedNoteLinks,
    isEditor,
  };
}
