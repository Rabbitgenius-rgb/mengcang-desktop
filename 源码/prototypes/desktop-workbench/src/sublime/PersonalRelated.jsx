import { createPortal } from 'react-dom';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconAdjustmentsHorizontal, IconArrowUpRight, IconChevronDown, IconCheck, IconX } from '@tabler/icons-react';
import { valueOf } from '../desktopModel.js';
import { personalRelations, nativeRelated } from './personalRelated.js';
import { RELATED_PAGE_SIZE, RELATED_TYPES, RELATED_SORTS, normalizeRelatedView, relatedResults } from './relatedBrowser.js';
import CardContent, { CollectionChips } from './CardContent.jsx';
import { relatedCardSource } from './localMaterialSearch.js';
import OriginalPositionStatus from './OriginalPositionStatus.jsx';
import { useOriginalPosition } from './useOriginalPosition.js';
import './personalRelated.css';

function RelatedCard({ row, onOpen, onOpenSource, library, renderActions, collections, onOpenCollection, originalPosition }) {
  const { card, reason } = row;
  const source = relatedCardSource(card, library),
    status = originalPosition.state?.id === card.id ? originalPosition.state.status : '';
  const external = source?.url && card.webAnchor ? (event) => originalPosition.open(event, card) : undefined;
  const sourceStatus = <OriginalPositionStatus card={card} state={originalPosition.state} />;
  return (
    <div className="pr-entry">
      <article className={'pr-card pr-card-' + card.type} data-related-id={card.id}>
        <CardContent
          card={card}
          onOpen={onOpen}
          reason={reason}
          openLabel={'打开相关资料：' + (card.title || '未命名资料')}
          sourceAction={source}
          onOpenSource={(id) => (onOpenSource ? onOpenSource(card, id) : onOpen(id))}
          onExternalSource={external}
          sourceBusy={status === 'loading'}
          sourceStatus={sourceStatus}
        />
        {renderActions && <div className="pr-actions">{renderActions(card)}</div>}
      </article>
      <CollectionChips card={card} collections={collections} onOpenCollection={onOpenCollection} />
    </div>
  );
}

export default function PersonalRelated({
  source,
  library,
  collections,
  api,
  cache,
  views,
  onOpen,
  onOpenSource,
  renderActions,
  onOpenCollection,
  embedded = false,
}) {
  const root = useRef(null),
    filterRoot = useRef(null),
    filterButton = useRef(null),
    initial = views?.get(source.id);
  const originalPosition = useOriginalPosition({ api, library, scope: 'related:' + source.id });
  const [filterDraft, setFilterDraft] = useState(null),
    [filterPosition, setFilterPosition] = useState(null);
  const [view, setView] = useState(() => normalizeRelatedView(initial)),
    [visible, setVisible] = useState(false);
  const previousRecommendation = useRef(initial?.recommendation || null);
  const [native, setNative] = useState(() => (initial?.result?.source === source && initial?.result?.library === library ? initial.result : null));
  const [loading, setLoading] = useState(false),
    [nativeNote, setNativeNote] = useState('');
  const exact = useMemo(() => personalRelations(source, library, collections), [source, library, collections]);
  const semantic = useMemo(() => (native?.source === source && native?.library === library ? native.items : []), [native, source, library]);
  const results = useMemo(() => relatedResults(source, library, exact, semantic, view), [source, library, exact, semantic, view]);
  useEffect(() => {
    views?.set(source.id, {
      ...view,
      filtersOpen: false,
      result: native,
      ...(previousRecommendation.current ? { recommendation: previousRecommendation.current } : {}),
    });
  }, [views, source.id, view, native]);
  const filterOpen = !!filterDraft;
  useLayoutEffect(() => {
    if (!filterOpen) {
      setFilterPosition(null);
      return;
    }
    const position = () => {
      const anchor = filterButton.current?.getBoundingClientRect(),
        panel = filterRoot.current;
      if (!anchor || !panel) return;
      const width = Math.min(310, window.innerWidth - 24),
        height = Math.min(panel.getBoundingClientRect().height, window.innerHeight - 24);
      let top = anchor.bottom + 8;
      if (top + height > window.innerHeight - 12) top = anchor.top - height - 8;
      top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
      const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
      setFilterPosition((old) => (old?.top === top && old?.left === left && old?.width === width ? old : { top, left, width }));
    };
    position();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null;
    observer?.observe(filterRoot.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [filterOpen]);
  useEffect(() => {
    if (!filterOpen) return;
    filterRoot.current?.querySelector('input')?.focus({ preventScroll: true });
    const outside = (event) => {
      if (!filterRoot.current?.contains(event.target) && !filterButton.current?.contains(event.target)) setFilterDraft(null);
    };
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setFilterDraft(null);
        filterButton.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [filterOpen]);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: root.current.closest('.sublime-workspace'), rootMargin: '180px' },
    );
    io.observe(root.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    if (!visible || library.length < 2 || !api?.intelligenceStatus || !api?.intelligenceRequest) return;
    if (library.length > 2000) {
      setNativeNote('当前显示来源、标签和标题的关联。');
      return;
    }
    setLoading(true);
    setNativeNote('');
    (async () => {
      const status = valueOf(await api.intelligenceStatus());
      if (!active) return;
      if (!status?.settings?.nativeEnabled) {
        setNativeNote('当前显示来源、标签和标题的关联；可在设置中启用本机语义匹配。');
        return;
      }
      if (status.busy) {
        setNativeNote('本机匹配正忙，已保留现有相关资料。');
        return;
      }
      const items = await nativeRelated(
        source,
        library,
        cache,
        async (texts) => valueOf(await api.intelligenceRequest({ action: 'embed', texts })),
        () => active,
        { limit: library.length, distinctive: true },
      );
      if (active) setNative({ source, library, items });
    })()
      .catch(() => {
        if (active) setNativeNote('本机语义匹配暂不可用，已保留现有相关资料。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, source, library, cache, api]);
  function change(next) {
    if (next.scope === 'source' && view.scope !== 'source') previousRecommendation.current = view;
    if (next.scope && next.scope !== 'source') previousRecommendation.current = null;
    setView((value) => ({ ...value, ...next, limit: RELATED_PAGE_SIZE }));
  }
  function returnToRecommendation() {
    const prior = previousRecommendation.current;
    previousRecommendation.current = null;
    setView(prior || { ...view, scope: 'all', limit: RELATED_PAGE_SIZE });
  }
  const filtered = view.type !== 'all' || view.scope !== 'all' || view.sort !== 'relevance';
  const sourceLabel = results.webSource ? '同一网页' : '同一来源';
  const counting = loading || (!visible && library.length > 1 && api?.intelligenceRequest);
  const countLabel = view.scope === 'source' ? sourceLabel + '资料' : view.scope === 'content' ? '其他来源推荐' : '当前推荐';
  function closeFilters() {
    setFilterDraft(null);
    filterButton.current?.focus({ preventScroll: true });
  }
  function filterChoices(title, field, choices) {
    return (
      <fieldset className={'pr-filter-group pr-filter-' + field}>
        <legend>{title}</legend>
        <div>
          {choices.map(([key, label]) => (
            <label key={key}>
              <input
                type="radio"
                name={'related-' + field + '-' + source.id}
                value={key}
                checked={filterDraft[field] === key}
                onChange={() => setFilterDraft((d) => ({ ...d, [field]: key }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div ref={root} className={'pr-panel' + (embedded ? ' pr-embedded' : '')} role="region" aria-label="我的相关资料">
      <header className="pr-header">
        {!embedded && <span className="pr-library-label">我的资料库</span>}
        <div className="pr-heading">
          {!embedded && <h2>相关资料</h2>}
          <button
            ref={filterButton}
            type="button"
            className={'pr-filter-toggle' + (filtered ? ' active' : '')}
            aria-label="筛选相关资料"
            aria-haspopup="dialog"
            aria-expanded={!!filterDraft}
            onClick={() => (filterDraft ? closeFilters() : setFilterDraft({ ...view }))}
          >
            <IconAdjustmentsHorizontal size={23} />
            {filtered && <span className="pr-filter-dot" />}
          </button>
          {filterDraft &&
            createPortal(
              <div ref={filterRoot} className="pr-filters" style={filterPosition || { visibility: 'hidden' }} role="dialog" aria-label="筛选相关资料">
                <div className="pr-filter-title">
                  <span>筛选相关资料</span>
                  <button type="button" aria-label="关闭相关筛选" onClick={closeFilters}>
                    <IconX size={17} />
                  </button>
                </div>
                <div className="pr-filter-scroll">
                  {filterChoices('排序', 'sort', RELATED_SORTS)}
                  {filterChoices('资料类型', 'type', RELATED_TYPES)}
                  {filterChoices('关联范围', 'scope', [
                    ['all', '全部相关'],
                    ['content', '其他来源的相关内容'],
                    ['source', '同一来源'],
                  ])}
                </div>
                <div className="pr-filter-footer">
                  <button type="button" onClick={() => setFilterDraft(normalizeRelatedView())}>
                    清除
                  </button>
                  <button
                    type="button"
                    className="pr-apply"
                    onClick={() => {
                      change({ type: filterDraft.type, scope: filterDraft.scope, sort: filterDraft.sort });
                      closeFilters();
                    }}
                  >
                    应用
                  </button>
                </div>
              </div>,
              root.current?.closest('.sublime-workspace') || document.body,
            )}
        </div>
        {!embedded && (
          <span className="pr-private">
            <IconCheck size={13} /> 已收藏
          </span>
        )}
      </header>
      <div className="pr-status">
        <p role="status" aria-live="polite">
          {countLabel}
          {counting ? ' · 目前找到' : ' '}
          {results.total}
          {view.scope === 'source' ? ' 份' : ' 张'}
          {view.type !== 'all' ? ' · ' + RELATED_TYPES.find(([key]) => key === view.type)[1] : ''}
          {results.items.length < results.total ? ' · 已显示 ' + results.items.length : ''}
        </p>
        {results.sourceCount > 0 && view.scope !== 'source' && (
          <button type="button" onClick={() => change({ scope: 'source' })}>
            查看{sourceLabel}的 {results.sourceCount} 份资料 <IconArrowUpRight size={14} />
          </button>
        )}
        {view.scope === 'source' && (
          <button type="button" onClick={returnToRecommendation}>
            返回推荐
          </button>
        )}
      </div>
      {results.items.length ? (
        <div className="pr-grid">
          {[0, 1].map((column) => (
            <div className="pr-column" key={column}>
              {results.items
                .filter((_, index) => index % 2 === column)
                .map((row) => (
                  <RelatedCard
                    key={row.id}
                    row={row}
                    library={library}
                    onOpen={onOpen}
                    onOpenSource={onOpenSource}
                    renderActions={renderActions}
                    collections={collections}
                    onOpenCollection={onOpenCollection}
                    originalPosition={originalPosition}
                  />
                ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="pr-empty">
          <p>{loading ? '正在从自己的资料库中寻找联系。' : filtered ? '试试其他资料类型或关联范围。' : '有新的相关资料时，会在这里出现。'}</p>
          {filtered && (
            <button type="button" onClick={() => change({ type: 'all', scope: 'all', sort: 'relevance' })}>
              查看全部关联
            </button>
          )}
        </div>
      )}
      {nativeNote && <p className="pr-native-note">{nativeNote}</p>}
      {results.items.length < results.total && (
        <div className="pr-more">
          <button type="button" onClick={() => setView((v) => ({ ...v, limit: v.limit + RELATED_PAGE_SIZE }))}>
            查看更多相关资料 <IconChevronDown size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
