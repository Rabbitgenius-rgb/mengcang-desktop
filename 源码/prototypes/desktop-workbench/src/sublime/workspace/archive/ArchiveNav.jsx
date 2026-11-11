import React from 'react';
import { IconPlus, IconAdjustments } from '@tabler/icons-react';
import { IconButton } from '../WorkspacePrimitives.jsx';
import { WORKBENCH_KEY, normalizeWorkbench, recallCards, unread } from '../../../recall/recallModel.js';
import { ARCHIVE_VIEWS, archiveView } from './archiveModel.js';

const LINKS = [
  ['recall', '回看', ['recall']],
  ['home', '星空', ['home']],
  ['library', '资料库', ['library', 'favorites', 'trash', 'staff', 'discover', 'following']],
  ['collections', '收藏集', ['collections', 'collection']],
  ['canvases', '画布', ['canvases']],
];

// Typewriter-style top bar and a fixed caption line (Studio Freight pattern).
// Replaces the floating dock, the top tab pills and the add button.
export function renderArchiveNav(view) {
  const { route, navigate, state, libraryCards, popover, setPopover } = view;
  const model = normalizeWorkbench(state.drafts[WORKBENCH_KEY]);
  const unreadCount = recallCards(state).filter((card) => unread(card, model)).length;
  const viewLabel = ARCHIVE_VIEWS.find(([id]) => id === archiveView(state.drafts))?.[1];
  return (
    <>
      <header className="an-bar">
        <button type="button" className="an-mark" onClick={() => navigate('library')} aria-label="梦藏 · 回到资料库">
          <span className="an-moon" aria-hidden="true" />
          梦藏
        </button>
        <nav className="an-links" aria-label="主导航">
          {LINKS.map(([page, label, pages]) => {
            const active = pages.includes(route.page);
            return (
              <button key={page} type="button" className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onClick={() => navigate(page)}>
                {label}
                {page === 'recall' && unreadCount > 0 && (
                  <sup className="an-unread" aria-label={unreadCount + ' 条未读'}>
                    {unreadCount}
                  </sup>
                )}
              </button>
            );
          })}
        </nav>
        <div className="an-tools">
          <IconButton
            label="添加卡片"
            className="an-add"
            onClick={(event) => setPopover({ type: 'add', anchor: event.currentTarget })}
            aria-haspopup="menu"
            aria-expanded={popover?.type === 'add'}
          >
            <IconPlus size={15} stroke={2} aria-hidden="true" />
            <span>添加</span>
          </IconButton>
          <IconButton
            label="本机工具"
            className="an-tool"
            onClick={(event) => setPopover({ type: 'tools', anchor: event.currentTarget })}
            aria-haspopup="menu"
            aria-expanded={popover?.type === 'tools'}
          >
            <IconAdjustments size={17} stroke={1.6} aria-hidden="true" />
          </IconButton>
        </div>
      </header>
      <footer className="an-foot" aria-label="资料库状态">
        <span>
          <i aria-hidden="true" />
          内容保存在本机
        </span>
        <span className="an-foot-mid">梦藏 · 夜间档案馆</span>
        <span>
          {libraryCards.length} 件{viewLabel && route.page === 'library' ? ' · ' + viewLabel : ''}
        </span>
      </footer>
    </>
  );
}
