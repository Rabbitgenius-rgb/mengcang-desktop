import React, { useEffect, useMemo, useRef, useState } from 'react';
import { anchorFromSelection, rangeForAnchor } from '../../../../src/clipper/anchors.mjs';
import {
  articleReaderModel,
  articleSourceUrl,
  articlePageUrl,
  articleOriginalLocation,
  savedArticleImage,
  normalizeArticleHighlightDraft,
  reviseArticleHighlightSelection,
  articleReadingNodes,
  articleListNumber,
} from './articleReaderModel.js';
import CardContent from './CardContent.jsx';
import './articleReader.css';

// Reading-tab preference is session-only; it never writes the material or recall state.
const discoveryTabs = new Map();

const LOCATION_NOTICE = '页面已变化或文字重复，未能唯一定位，请查看原文。';
const locateRange = (root, anchor) => {
  try {
    return rangeForAnchor(root, anchor);
  } catch {
    return null;
  }
};

function InlineRuns({ runs = [] }) {
  return runs.map((run, index) => {
    let content = String(run.text || '');
    if (run.strong) content = <strong>{content}</strong>;
    if (run.em) content = <em>{content}</em>;
    const href = articleSourceUrl(run.href);
    return (
      <React.Fragment key={index}>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        ) : (
          content
        )}
      </React.Fragment>
    );
  });
}
function ArticleFigure({ block, onSave, saved, onOpen, canFetch }) {
  const [busy, setBusy] = useState(false),
    [issue, setIssue] = useState(''),
    lock = useRef(false);
  const savedId = saved?.id,
    image = savedArticleImage(block) || savedArticleImage(saved),
    original = articleSourceUrl(block.src);
  async function collect() {
    if (lock.current) return;
    if (savedId) {
      onOpen?.(savedId);
      return;
    }
    lock.current = true;
    setBusy(true);
    setIssue('');
    try {
      await onSave(block);
    } catch (error) {
      setIssue(error.message || '收藏失败，请重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <figure data-article-block={block.id} tabIndex={-1}>
      {image ? (
        <img src={image} alt={block.alt || ''} loading="lazy" />
      ) : (
        <div className="ar-missing-image" data-mengcang-ui="true">
          <span>{block.imageError || '这张图片尚未保存到本机'}</span>
          {original && (
            <a href={original} target="_blank" rel="noopener noreferrer">
              查看原图 ↗
            </a>
          )}
        </div>
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
      {onSave && (image || savedId || (canFetch && original)) && (
        <div className="ar-figure-action" data-mengcang-ui="true">
          <button type="button" disabled={busy} onClick={collect}>
            {busy ? '正在收藏…' : savedId ? '查看已收藏的配图' : image ? '收藏配图' : '下载并收藏配图'}
          </button>
          {issue && <small role="alert">{issue}</small>}
        </div>
      )}
    </figure>
  );
}
function ArticleBlock({ block, onSaveFigure, savedFigure, onOpenFigure, canFetchFigure }) {
  if (block.type === 'table') {
    const row = (value, index) => (
      <tr key={index}>
        {value.cells.map((cell, column) => {
          const Cell = cell.header ? 'th' : 'td';
          return (
            <Cell key={column} colSpan={cell.colspan} rowSpan={cell.rowspan}>
              <InlineRuns runs={cell.runs} />
            </Cell>
          );
        })}
      </tr>
    );
    // Row-group boundaries are not part of the captured schema. Keep rows in
    // one group so a retained rowspan cannot be cut off by an invented thead.
    return (
      <div data-article-block={block.id} className="ar-table-block">
        <div className="ar-table-scroll" role="region" aria-label="文章表格" tabIndex={0}>
          <table>
            <tbody>{block.rows.map(row)}</tbody>
          </table>
        </div>
        {block.imagesAfter && (
          <p className="ar-table-image-note" data-mengcang-ui="true">
            表内图片按原顺序列于表格下方
          </p>
        )}
      </div>
    );
  }
  if (block.type === 'image') {
    return <ArticleFigure block={block} onSave={onSaveFigure} saved={savedFigure} onOpen={onOpenFigure} canFetch={canFetchFigure} />;
  }
  const content = <InlineRuns runs={block.runs} />;
  if (block.type === 'heading') {
    const Heading = `h${Math.min(6, Math.max(1, block.level || 2))}`;
    return <Heading data-article-block={block.id}>{content}</Heading>;
  }
  if (block.type === 'quote') return <blockquote data-article-block={block.id}>{content}</blockquote>;
  if (block.type === 'code')
    return (
      <pre data-article-block={block.id}>
        <code>{content}</code>
      </pre>
    );
  if (block.type === 'list-item')
    return (
      <div className="ar-list-item" data-article-block={block.id}>
        <span className="ar-list-dot" aria-hidden="true">
          •
        </span>
        <p>{content}</p>
      </div>
    );
  return <p data-article-block={block.id}>{content}</p>;
}

function ArticleList({ node, nested = false }) {
  const List = node.ordered ? 'ol' : 'ul';
  return (
    <List
      className="ar-list"
      start={node.ordered ? articleListNumber(node.items[0]?.block.marker) : undefined}
      style={!nested && node.depth ? { paddingInlineStart: `calc(1.65em + ${node.depth * 16}px)` } : undefined}
    >
      {node.items.map(({ block, children }) => (
        <li key={block.id} data-article-block={block.id} data-marker={block.marker} value={node.ordered ? articleListNumber(block.marker) : undefined}>
          <InlineRuns runs={block.runs} />
          {children.map((child, index) => (
            <ArticleList key={index} node={child} nested />
          ))}
        </li>
      ))}
    </List>
  );
}

// Content stays in React's safe element tree. Original HTML, remote frames,
// scripts and un-downloaded image URLs never enter the reading surface.
export default function ArticleReader({
  card,
  highlights = [],
  favoriteIds = [],
  focusAnchor,
  focusFigure,
  focusKey,
  onNavigationHandled,
  onSaveHighlight,
  onOpenHighlight,
  onSaveFigure,
  onOpenFigure,
  savedFigures,
  figureItems = [],
  canFetchFigure,
  initialDraft,
  onDraft,
  registerFlush,
  relatedContent,
  linkedNoteLinks,
  renderActions,
  renderOriginalPosition,
  activeCardId,
}) {
  const model = useMemo(() => articleReaderModel(card), [card]);
  const readerTop = useRef(null),
    discovery = useRef(null),
    content = useRef(null),
    selectionForm = useRef(null),
    selectionActions = useRef(null),
    generation = useRef(0),
    flashTimer = useRef(null),
    onHandled = useRef(onNavigationHandled),
    onDraftRef = useRef(onDraft),
    initialDraftRef = useRef(initialDraft),
    selectionRef = useRef(null),
    pendingDrafts = useRef(new Set()),
    pendingSave = useRef(null),
    draftFailure = useRef(null);
  onHandled.current = onNavigationHandled;
  onDraftRef.current = onDraft;
  initialDraftRef.current = initialDraft;
  const [selection, setSelection] = useState(() => normalizeArticleHighlightDraft(initialDraft)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [discoveryTab, setDiscoveryTab] = useState(() => discoveryTabs.get(card.id) || 'related'),
    [discoveryVisible, setDiscoveryVisible] = useState(false),
    [showSnapshot, setShowSnapshot] = useState(false),
    [selectionActionsVisible, setSelectionActionsVisible] = useState(false);
  const [localTarget, setLocalTarget] = useState(null),
    [itemNotice, setItemNotice] = useState(null);
  const savedItems = [...highlights.map((card) => ({ card })), ...figureItems].sort(
    (a, b) => (Date.parse(b.card.createdAt) || 0) - (Date.parse(a.card.createdAt) || 0),
  );
  selectionRef.current = selection;
  const visibleArticle = model.hasEditedBody && !showSnapshot ? null : model.article;
  const selectionSourceChanged = selection && selection.sourceUrl !== articlePageUrl(card.sourceUrl);
  const favorite = new Set(favoriteIds);
  const highlightName = useMemo(
    () =>
      `mengcang-article-${String(card.id)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 80)}`,
    [card.id],
  );
  const focusName = highlightName + '-focus';
  useEffect(() => {
    const requests = generation;
    requests.current++;
    setSelection(normalizeArticleHighlightDraft(initialDraftRef.current));
    setBusy(false);
    setError('');
    setNotice('');
    setItemNotice(null);
    setShowSnapshot(false);
    setSelectionActionsVisible(false);
    setDiscoveryTab(discoveryTabs.get(card.id) || 'related');
    setDiscoveryVisible(false);
    draftFailure.current = null;
    return () => {
      requests.current++;
      clearTimeout(flashTimer.current);
      globalThis.CSS?.highlights?.delete(focusName);
    };
  }, [card.id, focusName]);
  useEffect(() => {
    if (!discovery.current || typeof globalThis.IntersectionObserver !== 'function') return;
    const observer = new globalThis.IntersectionObserver((entries) => setDiscoveryVisible(entries.some((entry) => entry.isIntersecting)), {
      root: discovery.current.closest?.('.sublime-workspace') || null,
      rootMargin: '-110px 0px -100px 0px',
      threshold: 0,
    });
    observer.observe(discovery.current);
    return () => observer.disconnect();
  }, [card.id]);
  function selectDiscovery(tab, jump = false) {
    setDiscoveryTab(tab);
    discoveryTabs.delete(card.id);
    discoveryTabs.set(card.id, tab);
    if (discoveryTabs.size > 200) discoveryTabs.delete(discoveryTabs.keys().next().value);
    if (jump) discovery.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tab = event.key === 'Home' ? 'related' : event.key === 'End' ? 'highlights' : discoveryTab === 'related' ? 'highlights' : 'related';
    selectDiscovery(tab);
    event.currentTarget.parentElement?.querySelector(`[data-reading-tab="${tab}"]`)?.focus();
  }
  useEffect(() => {
    if (!registerFlush) return;
    registerFlush(async () => {
      while (pendingDrafts.current.size) await Promise.allSettled([...pendingDrafts.current]);
      if (pendingSave.current) await pendingSave.current.catch(() => {});
      if (draftFailure.current || (selectionRef.current && !onDraftRef.current)) throw Error('文章高亮草稿尚未保存，请先保存高亮或取消选文后重试退出。');
    });
    return () => registerFlush(null);
  }, [registerFlush, card.id]);
  const selectionActive = !!selection;
  useEffect(() => {
    setSelectionActionsVisible(false);
    if (!selectionActive || !selectionActions.current || typeof globalThis.IntersectionObserver !== 'function') return;
    // The existing top bar and desktop dock can cover a visually intersecting
    // button, so only retire the shortcut within the unobstructed reading area.
    const observer = new globalThis.IntersectionObserver((entries) => setSelectionActionsVisible(entries.some((entry) => entry.isIntersecting)), {
      root: content.current?.closest?.('.sublime-workspace') || null,
      rootMargin: '-110px 0px -120px 0px',
      threshold: 0.01,
    });
    observer.observe(selectionActions.current);
    return () => observer.disconnect();
  }, [selectionActive, selection?.operationId, card.id]);
  useEffect(() => {
    const registry = globalThis.CSS?.highlights,
      HighlightClass = globalThis.Highlight;
    if (!registry || !HighlightClass || !content.current) return;
    const ranges = highlights.map((item) => locateRange(content.current, item.webAnchor)).filter(Boolean);
    registry.set(highlightName, new HighlightClass(...ranges));
    return () => registry.delete(highlightName);
  }, [card, highlights, highlightName, showSnapshot]);
  const targetFigure = localTarget ? localTarget.figure : focusFigure;
  const targetAnchor = localTarget ? localTarget.anchor : focusAnchor;
  useEffect(() => {
    if (!targetFigure && !targetAnchor) return;
    const range = targetAnchor && content.current && locateRange(content.current, targetAnchor);
    if (model.hasEditedBody && !showSnapshot && !range) {
      setShowSnapshot(true);
      return;
    }
    function reveal() {
      if (targetFigure) {
        const figure = Array.from(content.current?.querySelectorAll('figure[data-article-block]') || []).find((el) => el.dataset.articleBlock === targetFigure);
        if (figure) {
          figure.focus({ preventScroll: true });
          figure.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
        if (!figure && localTarget?.id) setItemNotice({ id: localTarget.id, text: '配图位置已变化，可打开独立卡片。' });
        else setNotice(figure ? '已返回这张配图。' : '这张配图的位置已变化，可打开卡片查看收藏时保留的出处。');
      } else if (range) {
        const parent = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        const block = parent?.closest?.('[data-article-block], p') || parent;
        block?.setAttribute?.('tabindex', '-1');
        block?.focus?.({ preventScroll: true });
        parent?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
        const registry = globalThis.CSS?.highlights,
          HighlightClass = globalThis.Highlight;
        if (registry && HighlightClass) {
          registry.set(focusName, new HighlightClass(range));
          clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => registry.delete(focusName), 4500);
        }
        setNotice('已定位到这段文字。');
      } else if (localTarget?.id) setItemNotice({ id: localTarget.id, text: LOCATION_NOTICE });
      else setNotice(LOCATION_NOTICE);
      if (localTarget) setLocalTarget(null);
      else onHandled.current?.();
    }
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      reveal();
      return;
    }
    const frame = globalThis.requestAnimationFrame(reveal);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [card.id, focusKey, targetAnchor, targetFigure, localTarget, model.hasEditedBody, showSnapshot, focusName]);
  function updateSelection(value) {
    selectionRef.current = value;
    setSelection(value);
    if (!onDraftRef.current) return;
    const run = generation.current,
      write = onDraftRef.current,
      job = Promise.resolve().then(() => write(value));
    pendingDrafts.current.add(job);
    void job
      .then(
        () => {
          if (run === generation.current && selectionRef.current === value) draftFailure.current = null;
        },
        (issue) => {
          if (run === generation.current && selectionRef.current === value) {
            draftFailure.current = issue;
            setError('高亮草稿尚未保存，选文和备注仍保留在此窗口：' + issue.message);
          }
        },
      )
      .finally(() => pendingDrafts.current.delete(job));
  }
  async function cancelSelection() {
    if (busy) return;
    setBusy(true);
    const run = generation.current;
    try {
      if (onDraftRef.current) await onDraftRef.current(null);
      if (run === generation.current) {
        selectionRef.current = null;
        setSelection(null);
        draftFailure.current = null;
        setError('');
      }
    } catch (issue) {
      if (run === generation.current) setError('取消尚未完成，选文仍保留：' + issue.message);
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  function captureSelection() {
    if (busy || selectionRef.current?.submitted || !model.sourceUrl || !onSaveHighlight) return;
    const chosen = globalThis.getSelection?.();
    if (!chosen || chosen.isCollapsed) return;
    try {
      const anchor = anchorFromSelection(content.current, chosen);
      if (!anchor) return;
      const text = chosen.toString();
      if (!text.trim()) return;
      const revised = reviseArticleHighlightSelection(selectionRef.current, { text, anchor, sourceUrl: card.sourceUrl }, () => crypto.randomUUID());
      if (revised !== selectionRef.current) updateSelection(revised);
      setError('');
    } catch (issue) {
      setError(issue.message || '这段文字无法定位，请缩小选择范围后重试。');
    }
  }
  async function saveSelection(event) {
    event?.preventDefault();
    if (!selection || busy || selectionSourceChanged) return;
    const submitted = { ...selection, submitted: true },
      run = generation.current;
    updateSelection(submitted);
    setBusy(true);
    setError('');
    try {
      const job = Promise.resolve(
        onSaveHighlight({
          operationId: submitted.operationId,
          text: submitted.text,
          anchor: submitted.anchor,
          note: submitted.note,
          favorite: submitted.favorite,
        }),
      );
      pendingSave.current = job;
      await job;
      if (run === generation.current) {
        selectionRef.current = null;
        setSelection(null);
        draftFailure.current = null;
        setNotice('高亮与备注已保存到资料库。');
        globalThis.getSelection?.()?.removeAllRanges?.();
      }
    } catch (issue) {
      if (run === generation.current) setError(issue.message || '尚未保存。选文和备注已保留，可重试原请求。');
    } finally {
      if (run === generation.current) {
        pendingSave.current = null;
        setBusy(false);
      }
    }
  }
  const original = articleOriginalLocation(card.sourceUrl);
  return (
    <section className="article-reader" aria-label="文章阅读模式">
      <style>{`::highlight(${highlightName}){background:#dcebb6;color:#263027}::highlight(${focusName}){background:#f1d184;color:#382e16}`}</style>
      <header ref={readerTop} className="ar-header" data-mengcang-ui="true">
        <div className="ar-eyebrow">
          <span>约 {model.minutes} 分钟</span>
          {model.sourceUrl && (
            <a className="ar-source-pill" href={original} target="_blank" rel="noopener noreferrer">
              {new URL(model.sourceUrl).hostname} ↗
            </a>
          )}
        </div>
        <h1>{card.title || '未命名文章'}</h1>
        {card.author && <div className="ar-byline">{card.author}</div>}
        {linkedNoteLinks}
        {!model.sourceUrl && <p className="ar-image-notice">此文章没有网页来源，可阅读正文，暂不能定位原网页。</p>}
        {model.hasEditedBody && (
          <div className="ar-snapshot-notice">
            <p>
              {showSnapshot ? '正在查看收录时的原始图文；编辑后的正文仍保留。' : '正文已编辑，当前显示新版文字。原始图文与图片仍保留。'}
              高亮按当前显示的正文定位。
            </p>
            <button type="button" onClick={() => setShowSnapshot((value) => !value)}>
              {showSnapshot ? '返回当前正文' : '查看原始图文'}
            </button>
          </div>
        )}
        {visibleArticle && visibleArticle.blocks.some((b) => b.type === 'image' && !savedArticleImage(b) && !savedArticleImage(savedFigures?.get(b.id))) && (
          <p className="ar-image-notice">部分图片尚未保存到本机，可在图下查看原图或收藏。</p>
        )}
      </header>
      <div className="ar-layout ar-layout-reading">
        <div className="ar-main">
          <div ref={content} className="ar-body" onMouseUp={captureSelection} onKeyUp={captureSelection} aria-label="文章正文">
            {visibleArticle
              ? articleReadingNodes(visibleArticle.blocks).map((node, index) =>
                  node.kind === 'list' ? (
                    <ArticleList key={'list:' + index} node={node} />
                  ) : (
                    <ArticleBlock
                      key={node.block.id}
                      block={node.block}
                      onSaveFigure={onSaveFigure}
                      onOpenFigure={onOpenFigure}
                      savedFigure={savedFigures?.get(node.block.id)}
                      canFetchFigure={canFetchFigure}
                    />
                  ),
                )
              : model.fallbackParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            {!model.body.trim() && !visibleArticle?.blocks.some((block) => block.type === 'image') && <p className="ar-empty">这张文章卡片还没有正文。</p>}
          </div>
          {selection && (
            <form ref={selectionForm} className="ar-selection" onSubmit={saveSelection} data-mengcang-ui="true" aria-label="保存文章高亮">
              <div className="ar-selection-title">
                <strong>留下这段文字</strong>
                <button type="button" disabled={busy} onClick={cancelSelection}>
                  取消
                </button>
              </div>
              <blockquote>{selection.text}</blockquote>
              {selectionSourceChanged && (
                <p role="alert" className="ar-error">
                  网页来源已变化。原选文与备注仍在，请复制保留，取消后重新选择，避免保存到另一篇文章。
                </p>
              )}
              <label htmlFor="article-highlight-note">我的备注</label>
              <textarea
                id="article-highlight-note"
                rows={3}
                maxLength={50000}
                value={selection.note}
                disabled={busy || selection.submitted}
                onChange={(event) => updateSelection({ ...selection, note: event.target.value })}
                placeholder="想到什么，留在这里…"
              />
              <label className="ar-favorite">
                <input
                  type="checkbox"
                  checked={selection.favorite}
                  disabled={busy || selection.submitted}
                  onChange={(event) => updateSelection({ ...selection, favorite: event.target.checked })}
                />
                标星这条高亮
              </label>
              {error && (
                <p role="alert" className="ar-error">
                  {error}
                </p>
              )}
              <footer ref={selectionActions}>
                {selection.submitted && !busy && error && <small>选文和备注已保留，重试使用原请求。</small>}
                <button type="submit" className="ar-save" disabled={busy || selectionSourceChanged}>
                  {busy ? '正在保存…' : selection.submitted ? '重试保存' : '保存高亮'}
                </button>
              </footer>
            </form>
          )}
          {!selection && error && (
            <p role="alert" className="ar-error">
              {error}
            </p>
          )}
          {notice && (
            <p className="ar-notice" role="status" data-mengcang-ui="true">
              {notice}
            </p>
          )}
        </div>
      </div>
      <section ref={discovery} className="ar-discovery" aria-label="文章相关资料与本文收藏" data-mengcang-ui="true">
        <div className="ar-discovery-tabs" role="tablist" aria-label="文章发现">
          <button
            type="button"
            role="tab"
            id={highlightName + '-related-tab'}
            data-reading-tab="related"
            aria-controls={highlightName + '-related-panel'}
            aria-selected={discoveryTab === 'related'}
            tabIndex={discoveryTab === 'related' ? 0 : -1}
            onKeyDown={tabKey}
            onClick={() => selectDiscovery('related')}
          >
            相关资料
          </button>
          <button
            type="button"
            role="tab"
            id={highlightName + '-highlights-tab'}
            data-reading-tab="highlights"
            aria-controls={highlightName + '-highlights-panel'}
            aria-selected={discoveryTab === 'highlights'}
            tabIndex={discoveryTab === 'highlights' ? 0 : -1}
            onKeyDown={tabKey}
            onClick={() => selectDiscovery('highlights')}
          >
            本文收藏 <span>{savedItems.length}</span>
          </button>
        </div>
        <div role="tabpanel" id={highlightName + '-related-panel'} aria-labelledby={highlightName + '-related-tab'} hidden={discoveryTab !== 'related'}>
          {relatedContent || <p className="ar-empty">暂时没有相关资料。</p>}
        </div>
        <div
          role="tabpanel"
          id={highlightName + '-highlights-panel'}
          aria-labelledby={highlightName + '-highlights-tab'}
          hidden={discoveryTab !== 'highlights'}
        >
          <div className="ar-highlights" aria-label="本文收藏的摘录和配图">
            {!savedItems.length && <p className="ar-empty">还没有本文收藏。选中正文保存摘录，或点配图下的“收藏配图”。</p>}
            {savedItems.map(({ card: item, blockId }) => {
              const isFigure = item.type === 'image';
              const positioned = !isFigure && articleOriginalLocation(item.sourceUrl, item.webAnchor);
              const source = positioned || articleSourceUrl(item.sourceUrl) || articleSourceUrl(card.sourceUrl);
              const openCard = () => (isFigure ? onOpenFigure?.(item.id) : onOpenHighlight?.(item));
              const hint = isFigure ? (blockId ? '在本文看这张图' : '打开已收藏的配图') : '在本文看这段摘录';
              const openLabel = hint + '：' + (item.title || String(item.body || '').slice(0, 70));
              const goToPosition = () => {
                setItemNotice(null);
                setNotice('');
                if (!isFigure && !item.webAnchor) {
                  setItemNotice({ id: item.id, text: LOCATION_NOTICE });
                  return;
                }
                setLocalTarget(isFigure ? { id: item.id, figure: blockId } : { id: item.id, anchor: item.webAnchor });
              };
              return (
                <article key={item.id} className={`ar-highlight-item ${activeCardId === item.id ? 'ar-highlight-active' : ''}`}>
                  {renderActions && <div className="ar-highlight-actions">{renderActions(item)}</div>}
                  <CardContent
                    card={item}
                    onOpen={isFigure && !blockId ? openCard : goToPosition}
                    openLabel={openLabel}
                    actionHint={hint}
                    sourceFooter={
                      <span>
                        {favorite.has(item.id) && (
                          <span className="ar-star" aria-label="已标星">
                            ★{' '}
                          </span>
                        )}
                        {isFigure ? '配图' : '摘录'} · {card.title}
                      </span>
                    }
                  />
                  {isFigure && !blockId && <p className="ar-highlight-note">配图在本文中的位置已变化。</p>}
                  {!isFigure && item.caption && <p className="ar-highlight-note">{item.caption}</p>}
                  {itemNotice?.id === item.id && (
                    <p className="ar-item-notice" role="status">
                      {itemNotice.text}
                    </p>
                  )}
                  <footer>
                    {(!isFigure || blockId) && (
                      <button type="button" onClick={openCard}>
                        打开独立卡片
                      </button>
                    )}
                    {source &&
                      (positioned && renderOriginalPosition ? (
                        renderOriginalPosition(item, '', '去原网页 ↗')
                      ) : (
                        <a href={source} target="_blank" rel="noopener noreferrer">
                          去原网页 ↗
                        </a>
                      ))}
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <nav className="ar-reading-jump" aria-label="文章快捷导航" data-mengcang-ui="true">
        {discoveryVisible ? (
          <button type="button" onClick={() => readerTop.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })}>
            ↑ 回到顶部
          </button>
        ) : (
          <>
            <button type="button" onClick={() => selectDiscovery('related', true)}>
              相关资料
            </button>
            <button type="button" onClick={() => selectDiscovery('highlights', true)}>
              本文收藏 <span>{savedItems.length}</span>
            </button>
          </>
        )}
      </nav>
      {selection && !selectionActionsVisible && (
        <div className="ar-selection-quick" role="region" aria-label="选文保存快捷操作" data-mengcang-ui="true">
          <span>
            {selectionSourceChanged ? '选文来源已变化' : selection.submitted ? '这次保存尚未确认' : `已选 ${Array.from(selection.text).length} 字`}
            {selection.favorite ? ' · ★' : ''}
          </span>
          <button type="button" className="ar-selection-review" onClick={() => selectionForm.current?.scrollIntoView?.({ block: 'center', behavior: 'auto' })}>
            {selection.note ? '查看选文与备注' : '添加备注'}
          </button>
          <button
            type="button"
            className="ar-save"
            aria-label={selection.submitted ? '快速重试保存高亮' : '快速保存高亮'}
            disabled={busy || selectionSourceChanged}
            onClick={saveSelection}
          >
            {busy ? '正在保存…' : selection.submitted ? '重试保存' : '保存高亮'}
          </button>
        </div>
      )}
    </section>
  );
}
