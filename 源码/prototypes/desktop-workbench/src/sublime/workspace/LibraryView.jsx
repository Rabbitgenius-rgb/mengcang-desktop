import React from 'react';
import { MEDIA } from './constants.js';
import { MEDIA_LABELS } from './constants.js';
import { MEDIA_ICONS } from './constants.js';
import { initialFilters } from './constants.js';
import { IconButton } from './WorkspacePrimitives.jsx';
import {
  IconArrowLeft,
  IconPlus,
  IconDots,
  IconSparkles,
  IconSearch,
  IconAdjustmentsHorizontal,
  IconStar,
  IconX,
  IconTrash,
  IconPencil,
  IconFolder,
  IconLayoutBoard,
  IconArrowsShuffle,
} from '@tabler/icons-react';
import LibraryMeaningSearch from '../LibraryMeaningSearch.jsx';
export function renderLibrary(view) {
  const { popover } = view;

  const {
    route,
    searchLabel,
    filters,
    personalScope,
    meaningActive,
    personalSearch,
    groupPage,
    visibleCollections,
    visibleBoards,
    libraryCards,
    moreOptions,
    currentCollection,
    demo,
    searchScope,
    visibleCards,
    meaningSearch,
    keywordCards,
    tile,
    selectionMode,
    selectedCards,
    finishSelection,
    navigation,
    navigate,
    changeLibraryQuery,
    changeSearchMode,
    setShuffle,
    setFilterDraft,
    setModal,
    setPopover,
    showAi,
    cards,
    state,
    setCollectionPinned,
    openEditor,
    setMoreOptions,
    setFilters,
    setSelected,
    openExport,
    perform,
    selectedIds,
  } = view;
  return (
    <>
      <header className="sw-topbar sw-library-header">
        {route.page === 'collection' ? (
          <IconButton label="返回" className="sw-back" onClick={() => navigation.back()}>
            <IconArrowLeft size={22} />
          </IconButton>
        ) : (
          <nav className="sw-tabs">
            {['staff', 'discover', 'following'].includes(route.page)
              ? [
                  ['staff', '精选素材'],
                  ['discover', '发现'],
                  ['following', '来源'],
                ].map(([page, label]) => (
                  <button
                    key={page}
                    aria-current={route.page === page ? 'page' : undefined}
                    className={`sw-tab ${route.page === page ? 'active' : ''}`}
                    onClick={() => navigate(page)}
                  >
                    {label}
                  </button>
                ))
              : [
                  ['library', '全部资料'],
                  ['favorites', '已标星'],
                  ['collections', '收藏集'],
                  ['canvases', '画布'],
                ].map(([page, label]) => (
                  <button
                    key={page}
                    aria-current={route.page === page ? 'page' : undefined}
                    className={`sw-tab ${route.page === page ? 'active' : ''}`}
                    onClick={() => navigate(page)}
                  >
                    {label}
                  </button>
                ))}
          </nav>
        )}
        <div className="sw-actions">
          <label className="sw-search">
            <IconSearch size={22} />
            <input aria-label={searchLabel} placeholder={searchLabel} value={filters.query} onChange={(event) => changeLibraryQuery(event.target.value)} />
            {filters.query && (
              <IconButton label="清除搜索" onClick={() => changeLibraryQuery('')}>
                <IconX size={16} />
              </IconButton>
            )}
          </label>
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
          <IconButton label="随机排列" onClick={() => setShuffle((value) => value + 1)}>
            <IconArrowsShuffle size={23} />
          </IconButton>
          {!groupPage && (
            <IconButton
              label="筛选"
              onClick={() => {
                setFilterDraft(filters);
                setModal({ type: 'filters' });
              }}
            >
              <IconAdjustmentsHorizontal size={23} />
            </IconButton>
          )}
          <IconButton
            label="资料库选项"
            onClick={(event) => setPopover({ type: 'library', anchor: event.currentTarget })}
            aria-haspopup="menu"
            aria-expanded={popover?.type === 'library'}
          >
            <IconDots size={22} />
          </IconButton>
        </div>
      </header>
      {route.page === 'discover' ? (
        <div className="sw-status">
          <IconSparkles size={36} />
          <h1>发现</h1>
          <p>从一张参考素材出发，发现本机资料中的相关想法。</p>
          <p className="sw-muted">使用本机句向量；可在连接设置中启用。点击开始分析即可调用 API / CLI。</p>
          <button className="sw-primary" onClick={() => showAi('Discover')}>
            开始发现
          </button>
        </div>
      ) : route.page === 'collections' ? (
        <main className="sw-collection-grid">
          {!visibleCollections.length && filters.query && <p className="sw-muted">没有找到匹配的收藏集。</p>}
          {visibleCollections.map((collection) => (
            <article className="sw-collection-card" key={collection.id}>
              <button onClick={() => navigate('collection', collection.id)}>
                <IconFolder size={36} />
                <h2>{collection.title}</h2>
                <p>{collection.description}</p>
                <small>
                  {collection.cardIds.filter((id) => cards.some((card) => card.id === id) && !state.hiddenIds.includes(id)).length} 张卡片{' '}
                  {collection.private ? '· 私密' : ''} {collection.pinned ? '· 已置顶' : ''}
                </small>
              </button>
              <div>
                <IconButton label={`编辑 ${collection.title}`} onClick={() => navigate('edit-collection', collection.id)}>
                  <IconPencil size={17} />
                </IconButton>
                <IconButton label={`置顶 ${collection.title}`} onClick={() => setCollectionPinned(collection.id, !collection.pinned)}>
                  <IconStar size={17} />
                </IconButton>
                <IconButton label={`移除收藏集 ${collection.title}`} onClick={() => setModal({ type: 'delete-collection', collection })}>
                  <IconTrash size={17} />
                </IconButton>
              </div>
            </article>
          ))}
          <button className="sw-start-tile" onClick={() => navigate('edit-collection')}>
            <IconPlus size={30} />
            新建收藏集
          </button>
        </main>
      ) : route.page === 'canvases' ? (
        <main className="sw-collection-grid">
          {!visibleBoards.length && filters.query && <p className="sw-muted">没有找到匹配的画布。</p>}
          {visibleBoards.map((board) => (
            <article className="sw-collection-card" key={board.id}>
              <button onClick={() => navigate('canvas', board.id)}>
                <IconLayoutBoard size={36} />
                <h2>{board.title}</h2>
                <small>
                  {board.nodes.length} 张卡片 · {board.edges.length} 条连线
                </small>
              </button>
              <IconButton label={`移除画布 ${board.title}`} onClick={() => setModal({ type: 'delete-board', board })}>
                <IconTrash size={17} />
              </IconButton>
            </article>
          ))}
          <button className="sw-start-tile" onClick={() => setModal({ type: 'new-board' })}>
            <IconPlus size={30} />
            新建画布
          </button>
        </main>
      ) : route.page === 'library' && !libraryCards.length && !filters.query ? (
        <main className="sw-empty-library">
          <h1>开始建立你的梦藏资料库</h1>
          <div className="sw-start-panel">
            <div className="sw-start-tiles">
              <button className="sw-start-tile" onClick={() => navigate('staff')}>
                <IconPlus size={29} />
                <small>从这里开始</small>
                <span>浏览精选素材</span>
              </button>
              <button className="sw-start-tile" onClick={() => openEditor('link')}>
                <IconPlus size={29} />
                <span>粘贴链接</span>
              </button>
              <button className="sw-start-tile" onClick={() => openEditor('text')}>
                <IconPlus size={29} />
                <span>写笔记</span>
              </button>
            </div>
            <button className="sw-start-more" onClick={() => setMoreOptions((v) => !v)}>
              更多选项
            </button>
            {moreOptions && (
              <div className="sw-more-options">
                <button onClick={() => openEditor('file')}>导入文件</button>
                <button onClick={() => navigate('edit-collection')}>新建收藏集</button>
                <button onClick={() => setModal({ type: 'new-board' })}>新建画布</button>
                <button onClick={() => navigate('import')}>导入 Kindle 摘录</button>
                <button onClick={() => navigate('import')}>导入 Readwise 导出文件</button>
                <button onClick={() => navigate('import')}>从文件导入书签</button>
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="sw-library-content">
          {route.page === 'collection' && currentCollection && (
            <div className="sw-collection-title">
              <h1>{currentCollection.title}</h1>
              <p>{currentCollection.description}</p>
              <small>{libraryCards.filter((card) => currentCollection.cardIds.includes(card.id)).length} 条资料</small>
            </div>
          )}
          {route.page === 'trash' && (
            <div className="sw-collection-title">
              <h1>已归档卡片</h1>
              <p>已归档素材可搜索、筛选，并在卡片菜单中恢复。</p>
            </div>
          )}
          {route.page === 'staff' && demo && <p className="sw-reference-caption">公开参考素材 · 保存后进入你的本机资料库</p>}
          {route.page === 'following' && <p className="sw-reference-caption">已标记的来源</p>}
          <div className="sw-media-tabs" role="group" aria-label="资料类型，可横向滚动">
            {MEDIA.map((media) => {
              const MediaIcon = MEDIA_ICONS[media];
              return (
                <button
                  key={media}
                  aria-pressed={filters.media === media}
                  className={filters.media === media ? 'active' : ''}
                  onClick={() => setFilters((value) => ({ ...value, media }))}
                >
                  <MediaIcon size={17} />
                  {MEDIA_LABELS[media]}
                </button>
              );
            })}
          </div>
          {personalSearch && (
            <p className="sw-search-summary" aria-live="polite">
              {searchScope}
              {!meaningActive ? ' · ' + visibleCards.length + ' 条' : meaningSearch.result ? ' · 本次显示 ' + visibleCards.length + ' 条' : ''}
            </p>
          )}
          {(meaningActive || (personalSearch && !keywordCards.length)) && (
            <LibraryMeaningSearch
              active={meaningActive}
              query={filters.query}
              search={meaningSearch}
              count={visibleCards.length}
              onMeaning={() => changeSearchMode('meaning')}
              onSettings={() => showAi('Settings')}
            />
          )}
          {visibleCards.length > 0 && (
            <div className="sw-masonry" role="grid" aria-label={meaningActive ? '按意思找到的本机资料' : undefined}>
              {visibleCards.map(tile)}
            </div>
          )}
          {!personalSearch && !visibleCards.length && (
            <div className="sw-status">
              <h2>{route.page === 'following' ? '尚未保存来源' : route.page === 'trash' ? '没有匹配的归档卡片' : '这里还没有卡片'}</h2>
              <p>
                {route.page === 'following'
                  ? '在卡片菜单标记来源，即可在这里集中查看。'
                  : route.page === 'trash'
                    ? '可调整搜索和筛选；没有归档素材时，这里为空。'
                    : '试试其他关键词，或保存一条新想法。'}
              </p>
              <button
                onClick={() => {
                  navigate('library', '', 1, { filters: initialFilters });
                }}
              >
                我的资料库
              </button>
            </div>
          )}
          {selectionMode && (
            <div className="sw-selection">
              <span aria-live="polite">{selectedCards.length} 张已选</span>
              <button disabled={!visibleCards.length} onClick={() => setSelected(visibleCards.map((card) => card.id))}>
                全选
              </button>
              <button disabled={!selectedCards.length} onClick={() => openExport(selectedCards)}>
                导出
              </button>
              <button disabled={!selectedCards.length} onClick={() => setModal({ type: 'bulk-collection' })}>
                加入收藏集
              </button>
              <button
                disabled={!selectedCards.length}
                onClick={() => {
                  perform(
                    selectedIds.map((id) => ({ type: 'card.favorite', id, value: true })),
                    '标星已更新',
                  );
                  finishSelection();
                }}
              >
                标星
              </button>
              <button onClick={finishSelection}>完成</button>
            </div>
          )}
        </main>
      )}
    </>
  );
}
