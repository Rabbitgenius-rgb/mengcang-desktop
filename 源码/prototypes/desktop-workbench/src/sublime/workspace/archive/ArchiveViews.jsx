import React from 'react';
import { ArchiveWall } from './ArchiveWall.jsx';
import { ArchiveIndex } from './ArchiveIndex.jsx';
import { ArchiveZoom } from './ArchiveZoom.jsx';
import { archiveView } from './archiveModel.js';

// Three scales for the same visible cards; selection, menus and favourites
// keep using the workspace's existing actions.
export function renderArchiveViews(view) {
  const { visibleCards, state, navigate, relatedActions, selectionMode, selected, toggleSelect, membership, popover, meaningActive } = view;
  const ctx = {
    onOpen: (card) => navigate('card', card.id),
    actions: relatedActions,
    selectionMode,
    selected,
    onToggle: toggleSelect,
    favorite: membership.favorite,
    active: popover?.cardId,
  };
  const label = meaningActive ? '按意思找到的本机资料' : '资料';
  const mode = archiveView(state.drafts);
  if (mode === 'index') return <ArchiveIndex cards={visibleCards} ctx={ctx} label={label} />;
  if (mode === 'zoom') return <ArchiveZoom cards={visibleCards} ctx={ctx} label={label} />;
  return <ArchiveWall cards={visibleCards} ctx={ctx} label={label} />;
}
