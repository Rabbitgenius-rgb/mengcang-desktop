import React from 'react';
import { IconArrowLeft, IconArrowsShuffle, IconAdjustmentsHorizontal, IconDots, IconX } from '@tabler/icons-react';
import { IconButton } from '../WorkspacePrimitives.jsx';
import { MEDIA, MEDIA_LABELS } from '../constants.js';
import { ARCHIVE_VIEWS, ARCHIVE_VIEW_KEY, archiveView } from './archiveModel.js';

const SCOPES = [
  ['library', '全部'],
  ['favorites', '已标星'],
  ['trash', '已归档'],
  ['following', '来源'],
  ['discover', '发现'],
];
const PLACEHOLDER = { library: '在梦藏里找…', favorites: '在已标星里找…', trash: '在已归档里找…', collection: '在这个收藏集里找…' };

// M+ style masthead: the search sentence is the page headline, and a single
// hairline rail holds type, count, mode and view controls.
export function renderArchiveMasthead(view) {
  const { route, filters, searchLabel, groupPage, personalScope, meaningActive, personalSearch, visibleCards, currentCollection, demo, popover, state } = view;
  const { navigate, navigation, changeLibraryQuery, changeSearchMode, setShuffle, setFilterDraft, setModal, setPopover, setFilters, saveDraft } = view;
  const collectionPage = route.page === 'collection' && currentCollection;
  const cardPage = !groupPage && route.page !== 'discover';
  const mode = archiveView(state.drafts);
  const scopes = demo ? [...SCOPES, ['staff', '精选']] : SCOPES;
  return (
    <header className="am-head">
      <div className="am-kicker">
        {collectionPage ? (
          <span className="am-crumb">
            <IconButton label="返回" className="am-back" onClick={() => navigation.back()}>
              <IconArrowLeft size={14} />
            </IconButton>
            收藏集 / {currentCollection.title}
          </span>
        ) : groupPage ? (
          <span className="am-crumb">{route.page === 'collections' ? '收藏集' : '画布'}</span>
        ) : (
          <nav className="am-scopes" aria-label="资料库范围">
            {scopes.map(([page, label]) => (
              <button key={page} type="button" aria-current={route.page === page ? 'page' : undefined} onClick={() => navigate(page)}>
                {label}
              </button>
            ))}
          </nav>
        )}
        {cardPage && (
          <span className="am-count" aria-live="polite">
            {String(visibleCards.length).padStart(3, '0')} 件
          </span>
        )}
      </div>
      <label className="am-search">
        <input
          aria-label={searchLabel}
          placeholder={PLACEHOLDER[route.page] || searchLabel}
          value={filters.query}
          onChange={(event) => changeLibraryQuery(event.target.value)}
        />
        {filters.query && (
          <IconButton label="清除搜索" onClick={() => changeLibraryQuery('')}>
            <IconX size={18} />
          </IconButton>
        )}
      </label>
      {collectionPage && currentCollection.description && <p className="am-lede">{currentCollection.description}</p>}
      <div className="am-rail">
        {cardPage ? (
          <div className="am-types" role="group" aria-label="资料类型">
            {MEDIA.filter((media) => media !== 'Social').map((media) => (
              <button
                key={media}
                type="button"
                aria-pressed={filters.media === media}
                className={filters.media === media ? 'active' : ''}
                onClick={() => setFilters((value) => ({ ...value, media }))}
              >
                {media === 'All' ? '全部类型' : MEDIA_LABELS[media]}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="am-tools">
          {personalScope && (
            <div className="ms-modes" role="group" aria-label="搜索方式">
              <button type="button" aria-pressed={!meaningActive} onClick={() => changeSearchMode('keyword')}>
                关键词
              </button>
              <button type="button" aria-pressed={meaningActive} disabled={!personalSearch} onClick={() => changeSearchMode('meaning')}>
                按意思找
              </button>
            </div>
          )}
          {cardPage && (
            <div className="am-views" role="group" aria-label="观看方式">
              {ARCHIVE_VIEWS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={mode === id} onClick={() => saveDraft(ARCHIVE_VIEW_KEY, id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <IconButton label="随机排列" onClick={() => setShuffle((value) => value + 1)}>
            <IconArrowsShuffle size={17} />
          </IconButton>
          {!groupPage && (
            <IconButton
              label="筛选"
              onClick={() => {
                setFilterDraft(filters);
                setModal({ type: 'filters' });
              }}
            >
              <IconAdjustmentsHorizontal size={17} />
            </IconButton>
          )}
          <IconButton
            label="资料库选项"
            onClick={(event) => setPopover({ type: 'library', anchor: event.currentTarget })}
            aria-haspopup="menu"
            aria-expanded={popover?.type === 'library'}
          >
            <IconDots size={17} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
