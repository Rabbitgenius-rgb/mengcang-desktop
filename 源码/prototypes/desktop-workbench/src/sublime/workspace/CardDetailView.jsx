import React from 'react';
import { uid } from './constants.js';
import { CardText } from './WorkspacePrimitives.jsx';
import { CardIdentity } from './WorkspacePrimitives.jsx';
import { NoteReadingBody } from './WorkspacePrimitives.jsx';
import { NoteLinkArea } from './WorkspacePrimitives.jsx';
import { IconButton } from './WorkspacePrimitives.jsx';
import { IconArrowLeft, IconArrowUpRight, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { selectCards, safeSourceUrl } from '../workspaceModel.js';
import { valueOf } from '../../desktopModel.js';
import AttachmentPreview from '../AttachmentPreview.jsx';
import VaultAttachmentPreview from '../VaultAttachmentPreview.jsx';
import { isReadableBook } from '../../reader/readerState.js';
import ArticleReader from '../ArticleReader.jsx';
import { articleHighlights, articleOriginalLocation } from '../articleReaderModel.js';
import { isLinkedNote } from '../linkedNotes.js';
import ZoomableImage from '../ZoomableImage.jsx';
import CardReturnPreview from '../CardReturnPreview.jsx';
import { PodcastClipPlayback } from '../PodcastClips.jsx';
import { isImageReference } from '../intelligenceHelpers.js';
import ArchiveSpec from './archive/ArchiveSpec.jsx';
export function renderCardDetail(view) {
  const {
    current,
    root,
    cardActions,
    api,
    state,
    renderOriginalPosition,
    linkedNoteLinks,
    relatedActions,
    popover,
    relatedContent,
    cards,
    articleNavigation,
    saved,
    savedFigures,
    registerReaderFlush,
    isPodcastClip,
    clipAttachment,
    openNoteReference,
    route,
    libraryCards,
    checkingSource,
    cardIdentityContext,
    filters,
    nativeIds,
    tile,
    navigation,
    setReaderNavigation,
    navigate,
    setError,
    setArticleNavigation,
    collectArticleFigure,
    saveArticleHighlight,
    saveArticleDraft,
    commit,
    saveDocumentExcerpt,
    copyText,
    openCardSource,
    setFilterDraft,
    setModal,
  } = view;
  return (
    <>
      <header className="sw-topbar">
        <div className="sw-card-return">
          <IconButton label="返回" className="sw-back" onClick={() => navigation.back()}>
            <IconArrowLeft size={22} />
          </IconButton>
          <CardReturnPreview card={current} root={root} />
        </div>
        {cardActions(current)}
      </header>
      <section className={`sw-detail-stage ${current.type === 'article' ? 'sw-article-stage' : isImageReference(current) ? 'sw-image-stage' : ''}`}>
        <div className="sw-detail-cluster">
          {current.type !== 'article' && <ArchiveSpec card={current} collections={state.collections} onCollection={(id) => navigate('collection', id)} />}
          {current.type !== 'article' &&
            safeSourceUrl(current.sourceUrl) &&
            !(current.webAnchor && articleOriginalLocation(current.sourceUrl, current.webAnchor)) && (
              <a className="sw-origin-link" href={safeSourceUrl(current.sourceUrl)} target="_blank" rel="noreferrer">
                {new URL(safeSourceUrl(current.sourceUrl)).hostname}
                <IconArrowUpRight size={14} />
              </a>
            )}
          {isReadableBook(current) && (
            <button
              className="se-secondary sw-read-book"
              onClick={() => {
                setReaderNavigation(null);
                navigate('reader', current.id);
              }}
            >
              开始阅读
            </button>
          )}
          {current.origin === 'vault' && current.originalAvailable && !current.originalPath && api?.openOriginal && (
            <button
              className="se-secondary"
              onClick={() =>
                api
                  .openOriginal(current.path)
                  .then(valueOf)
                  .catch((e) => setError(e.message))
              }
            >
              {current.type === 'book' ? '打开原书' : '打开原文件'} · {current.originalName || current.title}
            </button>
          )}
          {current.type === 'highlight' &&
            current.sourceCardId &&
            current.sourceLocation &&
            !current.webAnchor &&
            !current.sourceAttachmentSha256 &&
            !state.drafts['reader-excerpt:' + current.id] && <p className="sw-muted">来源版本未记录，请手动核对当前文件与页码；旧摘录文字仍保留。</p>}
          {current.webAnchor && renderOriginalPosition(current, 'se-secondary sw-web-highlight-source')}
          <article className={`sw-detail-card ${current.type === 'article' ? 'sw-article-shell' : ''}`}>
            {current.type === 'article' ? (
              <ArticleReader
                linkedNoteLinks={linkedNoteLinks}
                renderOriginalPosition={renderOriginalPosition}
                renderActions={relatedActions}
                activeCardId={popover?.cardId}
                relatedContent={relatedContent(current, true)}
                key={current.id}
                card={current}
                highlights={articleHighlights(cards, state, current)}
                favoriteIds={state.favoriteIds}
                focusAnchor={articleNavigation?.sourceId === current.id ? articleNavigation.anchor : undefined}
                focusKey={articleNavigation?.key}
                onNavigationHandled={() => setArticleNavigation(null)}
                onSaveFigure={saved(current) ? (block) => collectArticleFigure(current, block) : undefined}
                savedFigures={savedFigures.byBlock}
                figureItems={savedFigures.items}
                onOpenFigure={(id) => navigate('card', id)}
                canFetchFigure={!!api?.captureArticleImage}
                focusFigure={articleNavigation?.sourceId === current.id ? articleNavigation.figure : undefined}
                onSaveHighlight={(value) => saveArticleHighlight(current, value)}
                onOpenHighlight={(card) => navigate('card', card.id)}
                initialDraft={state.drafts['article-highlight-draft:' + current.id]}
                onDraft={(value) => saveArticleDraft(current, value)}
                registerFlush={registerReaderFlush}
              />
            ) : !current.attachment && !current.image && current.origin === 'vault' && current.originalPath && api?.readAttachment ? (
              <VaultAttachmentPreview card={current} api={api} />
            ) : isPodcastClip ? (
              <>
                <PodcastClipPlayback attachment={clipAttachment} sourceLocation={current.sourceLocation} sourceAudioSha256={current.sourceAudioSha256} />
                {current.body && (
                  <div className="sw-card-body">
                    <NoteReadingBody card={current} onReference={openNoteReference} />
                  </div>
                )}
              </>
            ) : current.attachment ? (
              <AttachmentPreview
                key={current.id}
                attachment={current.attachment}
                initialPage={route.sourcePage || 1}
                index={current.documentIndex}
                highlights={current.documentHighlights || []}
                onIndex={async (index) => {
                  const next = await commit({ type: 'card.documentIndex', id: current.id, expectedDataUrl: current.attachment.dataUrl, index });
                  return next.cards.find((card) => card.id === current.id)?.documentIndex;
                }}
                onHighlight={(highlight) =>
                  commit({
                    type: 'card.highlight',
                    id: current.id,
                    expectedDataUrl: current.attachment.dataUrl,
                    highlight: { ...highlight, id: uid() },
                  })
                }
                onRemoveHighlight={(highlightId) =>
                  commit({ type: 'card.removeHighlight', id: current.id, expectedDataUrl: current.attachment.dataUrl, highlightId })
                }
                onExcerpt={(value) => saveDocumentExcerpt(current, value)}
                onCopy={(text) => copyText(text, '选文已复制')}
              />
            ) : current.image ? (
              <ZoomableImage src={current.image} alt={current.title} />
            ) : (
              <div className="sw-card-body">
                <NoteReadingBody card={current} onReference={openNoteReference} />
              </div>
            )}
            {current.type !== 'article' && current.attachment && !isPodcastClip && current.body && (
              <div className="sw-card-body">
                <NoteReadingBody card={current} onReference={openNoteReference} />
              </div>
            )}
            {current.type !== 'article' && (
              <footer className="sw-detail-caption">
                <div>{isLinkedNote(current) ? current.title : current.sourceTitle || current.title}</div>
                {current.author && <small>{current.author}</small>}
                {current.sourceCardId &&
                  !isLinkedNote(current) &&
                  (current.articleFigure ? libraryCards : cards).some((card) => card.id === current.sourceCardId) && (
                    <button className="se-secondary" disabled={checkingSource === current.id} onClick={() => openCardSource(current)}>
                      {checkingSource === current.id
                        ? '正在核验来源…'
                        : current.articleFigure
                          ? '回到来源文章中的配图'
                          : current.webAnchor
                            ? '在文章中定位'
                            : '查看来源文件'}
                      {Number.isSafeInteger(Number(current.page)) && Number(current.page) > 0 ? ` · 第 ${current.page} 页` : ''}
                    </button>
                  )}
              </footer>
            )}
          </article>
          {current.type !== 'article' && linkedNoteLinks}
          {current.type === 'article' && current.tags?.length > 0 && <p className="sw-muted">标签：{current.tags.join(' · ')}</p>}
          {current.ocrText && (
            <details className="sw-personal-note">
              <summary>
                识别文字
                {current.documentIndex?.source === 'ocr' && current.documentIndex.pages.length
                  ? ` · ${current.documentIndex.pages.length}${current.documentIndex.truncated ? ` / ${current.documentIndex.pageCount}` : ''} 页${current.documentIndex.truncated ? '（部分识别）' : ''}`
                  : ''}
              </summary>
              {current.documentIndex?.source === 'ocr' && current.documentIndex.engine && <small>本机识别 · {current.documentIndex.engine}</small>}
              {current.documentIndex?.source === 'ocr' && current.documentIndex.pages.length ? (
                current.documentIndex.pages.map((page) => (
                  <section key={page.page} aria-label={`识别文字第 ${page.page} 页`}>
                    {current.attachment?.type === 'application/pdf' ? (
                      <button type="button" className="se-secondary" onClick={() => navigate('card', current.id, page.page)}>
                        第 {page.page} 页 · 查看原页
                      </button>
                    ) : (
                      <small>第 {page.page} 页</small>
                    )}
                    {page.engine && <small> · {page.engine}</small>}
                    <CardText text={page.text} />
                  </section>
                ))
              ) : (
                <CardText text={current.ocrText} />
              )}
            </details>
          )}
          {(state.annotations[current.id]?.note ?? current.caption) && (
            <div className="sw-personal-note">
              <small>我的备注</small>
              <CardText text={state.annotations[current.id]?.note ?? current.caption} />
            </div>
          )}
          <details className="sw-detail-info">
            <summary>资料信息</summary>
            <CardIdentity card={current} context={cardIdentityContext} />
            {current.sourceLocation && <p>{current.sourceLocation}</p>}
          </details>
          <NoteLinkArea
            card={current}
            cards={libraryCards}
            collections={state.collections}
            onReference={openNoteReference}
            onCollection={(id) => navigate('collection', id)}
          />
        </div>
      </section>
      <section className={`sw-related ${current.type === 'article' ? 'sw-article-other' : ''}`}>
        {current.type !== 'article' && relatedContent(current)}
        {libraryCards.filter((card) => card.id !== current.id).length > 0 && (
          <details className="sw-other-materials">
            <summary>浏览资料库中的其他素材</summary>
            <IconButton
              label="筛选其他素材"
              onClick={() => {
                setFilterDraft(filters);
                setModal({ type: 'filters' });
              }}
            >
              <IconAdjustmentsHorizontal size={20} />
            </IconButton>
            <div className="sw-masonry" role="grid">
              {selectCards(
                libraryCards.filter((card) => card.id !== current.id),
                state,
                {
                  ...filters,
                  media: filters.media === 'All' ? '' : filters.media,
                  inLibrary: filters.inLibrary ? true : undefined,
                  favorite: filters.favorite ? true : undefined,
                },
                nativeIds,
              ).map(tile)}
            </div>
          </details>
        )}
      </section>
    </>
  );
}
