import React from 'react';
import { IconStar } from '@tabler/icons-react';
import { articleFigureBlock } from '.././articleFigures.js';
import PersonalRelated from '.././PersonalRelated.jsx';
import { openLinkedNoteDraft, linkedNoteDraftKey } from '.././linkedNotes.js';
import CardContent, { CollectionChips } from '.././CardContent.jsx';
import { ImageResultSource } from '.././LibraryMeaningSearch.jsx';
import { isImageReference } from '.././intelligenceHelpers.js';
import { uid } from './constants.js';

export function useRelatedCards({
  popover,
  relatedActions,
  personalSearch,
  meaningActive,
  filters,
  navigate,
  identityFor,
  libraryCards,
  state,
  selectionMode,
  selected,
  toggleSelect,
  membership,
  openCardSource,
  setArticleNavigation,
  identityId,
  api,
  relatedCache,
  relatedViews,
  epoch,
  session,
  demo,
  clipperView,
  commit,
  loadedIdentity,
  setPopover,
  setModal,
  setError,
}) {
  function tile(card) {
    return (
      <article className={`sw-tile ${popover?.cardId === card.id ? 'sw-tile-active' : ''}`} key={card.id} role="gridcell">
        <div className="sw-tile-actions">{relatedActions(card)}</div>
        <CardContent
          card={card}
          keyword={personalSearch && !meaningActive ? filters.query : undefined}
          onOpen={(id) => navigate('card', id)}
          openLabel={
            meaningActive
              ? '打开' + (isImageReference(card) ? '图片' : '资料') + '：' + card.title
              : `打开 ${card.title} · ${identityFor(card).accessibleLabel}`
          }
          sourceFooter={
            personalSearch && isImageReference(card) ? (
              <ImageResultSource card={card} library={libraryCards} onOpen={(id) => navigate('card', id)} />
            ) : undefined
          }
        />
        <CollectionChips card={card} collections={state.collections} onOpenCollection={(id) => navigate('collection', id)} />
        {selectionMode && (
          <label className="sw-tile-select">
            <input type="checkbox" checked={selected.includes(card.id)} onChange={() => toggleSelect(card.id)} aria-label={`选择 ${card.title}`} />
          </label>
        )}
        {membership.favorite.has(card.id) && <IconStar className="sw-favorite-mark" size={15} />}
      </article>
    );
  }

  function relatedContent(card, embedded = false) {
    function openRelatedSource(item, sourceId) {
      const source = libraryCards.find((entry) => entry.id === sourceId);
      if (!source) return;
      if (source.type !== 'article') {
        void openCardSource(item);
        return;
      }
      const figure = articleFigureBlock(source, item);
      const position = figure ? { figure: figure.id } : item.webAnchor ? { anchor: item.webAnchor } : null;
      setArticleNavigation(position ? { ...position, sourceId, key: uid() } : null);
      // A citation may lead from an article's recommendations back into that
      // same article. Keep a history entry so Back returns to the recommendations.
      navigate('card', sourceId, 1, { scrollTop: 0 });
    }
    return (
      <PersonalRelated
        key={identityId + ':' + card.id}
        source={card}
        library={libraryCards}
        collections={state.collections}
        api={api}
        cache={relatedCache}
        views={relatedViews}
        renderActions={relatedActions}
        embedded={embedded}
        onOpen={(id) => navigate('card', id)}
        onOpenSource={openRelatedSource}
        onOpenCollection={(id) => navigate('collection', id)}
      />
    );
  }

  function startLinkedNote(source) {
    const run = epoch.current;
    try {
      const editor = openLinkedNoteDraft({
        source,
        initial: session.drafts()[linkedNoteDraftKey(source.id)],
        id: 'linked-note:' + uid(),
        createdAt: new Date().toISOString(),
        nativeSource: () => !demo && clipperView.current.external.some((card) => card.id === source.id),
        commit: (apply) =>
          commit((latest) => {
            if (run !== epoch.current || loadedIdentity.current !== identityId) throw Error('资料库已切换，请回到原资料库核对草稿。');
            return apply(latest);
          }),
      });
      setPopover(null);
      setModal({ type: 'linked-note', source, editor });
    } catch (issue) {
      setError(issue.message);
    }
  }
  return { tile, relatedContent, startLinkedNote };
}
