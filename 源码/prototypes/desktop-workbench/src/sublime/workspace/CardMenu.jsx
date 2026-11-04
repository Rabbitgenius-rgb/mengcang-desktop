import React from 'react';
import {
  IconArrowUpRight,
  IconNotes,
  IconUpload,
  IconSparkles,
  IconStar,
  IconCopy,
  IconTrash,
  IconPencil,
  IconFolder,
  IconDownload,
  IconPhoto,
  IconBook2,
} from '@tabler/icons-react';
import { safeSourceUrl, exportCards } from '../workspaceModel.js';
import { valueOf } from '../../desktopModel.js';
import { bookFormat } from '../../reader/readerState.js';
export function renderCardMenu(view) {
  const {
    menuCard,
    toggleSave,
    saved,
    state,
    demo,
    connected,
    api,
    onOpen,
    share,
    copyText,
    setPopover,
    popover,
    openEditor,
    setBookClassification,
    setModal,
    openNote,
    removeSavedCard,
    perform,
    stateRef,
    setError,
    onExit,
  } = view;
  return (
    <>
      <button role="menuitem" onClick={(event) => toggleSave(menuCard, popover.anchor || event.currentTarget).catch(() => {})}>
        {saved(menuCard) ? '整理这张卡片' : '保存到资料库'}
      </button>
      <p className="sw-menu-label">阅读</p>
      <button role="menuitem" onClick={() => share(menuCard)}>
        <IconUpload />
        分享
      </button>
      <button
        role="menuitem"
        onClick={() => {
          copyText(menuCard.body || menuCard.title, '文字已复制');
          setPopover(null);
        }}
      >
        <IconCopy />
        复制文字
      </button>
      {safeSourceUrl(menuCard.sourceUrl) && (
        <a role="menuitem" href={safeSourceUrl(menuCard.sourceUrl)} target="_blank" rel="noreferrer">
          <IconArrowUpRight />
          打开原网页
        </a>
      )}
      <button
        role="menuitem"
        onClick={() => setPopover({ type: 'insights', cardId: menuCard.id, anchor: popover.anchor })}
        aria-haspopup="menu"
        aria-expanded={popover?.type === 'insights' && popover.cardId === menuCard.id}
      >
        <IconSparkles />
        AI 解读
      </button>
      {(saved(menuCard) || state.hiddenIds.includes(menuCard.id)) && (
        <>
          <hr />
          <p className="sw-menu-label">整理</p>
          <button role="menuitem" onClick={() => openEditor('text', menuCard)}>
            <IconPencil />
            {menuCard.origin === 'vault' ? '编辑本机副本' : '编辑卡片'}
          </button>
          {menuCard.origin !== 'vault' && bookFormat(menuCard.attachment) && (
            <button role="menuitem" onClick={() => setBookClassification(menuCard)}>
              <IconBook2 />
              {menuCard.type === 'book' ? '移到文件' : '移到图书'}
            </button>
          )}
          {menuCard.origin !== 'vault' && menuCard.type === 'book' && bookFormat(menuCard.attachment) && (
            <button
              role="menuitem"
              onClick={() => {
                setModal({ type: 'book-cover', card: menuCard });
                setPopover(null);
              }}
            >
              <IconPhoto />
              {menuCard.image ? '更换封面' : '设置封面'}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              openNote(menuCard);
            }}
          >
            <IconNotes />
            添加备注
          </button>
          <button role="menuitem" onClick={() => removeSavedCard(menuCard)}>
            从资料库移除
          </button>
          <button
            role="menuitem"
            onClick={() => {
              perform({ type: 'card.favorite', id: menuCard.id, value: !state.favoriteIds.includes(menuCard.id) }, '标星已更新');
              setPopover(null);
            }}
          >
            <IconStar />
            {state.favoriteIds.includes(menuCard.id) ? '取消标星' : '标星'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setModal({ type: 'bulk-collection', cardId: menuCard.id });
              setPopover(null);
            }}
          >
            <IconFolder />
            加入收藏集
          </button>
          <hr />
          <p className="sw-menu-label">文件与归档</p>
          <button
            role="menuitem"
            onClick={() => {
              setModal({ type: 'export', text: exportCards([menuCard], 'markdown'), format: 'markdown', count: 1, cards: [menuCard] });
              setPopover(null);
            }}
          >
            <IconDownload />
            导出卡片
          </button>
          <button
            role="menuitem"
            onClick={() => {
              perform(
                { type: 'card.hide', id: menuCard.id, hidden: !state.hiddenIds.includes(menuCard.id) },
                state.hiddenIds.includes(menuCard.id) ? '卡片已恢复' : '卡片已归档到本机',
              );
              setPopover(null);
            }}
          >
            <IconTrash />
            {state.hiddenIds.includes(menuCard.id) ? '恢复卡片' : '归档卡片'}
          </button>
        </>
      )}
      {safeSourceUrl(menuCard.sourceUrl) && (
        <button
          role="menuitem"
          onClick={() => {
            const list = state.drafts.followingSources || [],
              has = list.includes(menuCard.sourceUrl);
            perform(
              {
                type: 'draft.set',
                key: 'followingSources',
                value: has ? list.filter((url) => url !== menuCard.sourceUrl) : [...list, menuCard.sourceUrl],
              },
              has ? '来源已移除' : '来源已保存到本机',
            );
            setPopover(null);
          }}
        >
          {(state.drafts.followingSources || []).includes(menuCard.sourceUrl) ? '移除来源' : '保存来源'}
        </button>
      )}
      {!demo && connected && api?.captureAvailable && menuCard.origin !== 'vault' && (
        <button
          role="menuitem"
          onClick={() => {
            setModal({
              type: 'vault',
              card: menuCard,
              includeAttachment: stateRef.current.drafts[`vault:${menuCard.id}`]?.payload
                ? !!stateRef.current.drafts[`vault:${menuCard.id}`].payload.attachment
                : !!menuCard.attachment,
            });
            setPopover(null);
          }}
        >
          存入梦藏仓库
        </button>
      )}
      {menuCard.origin === 'vault' && (menuCard.originalPath || menuCard.originalAvailable) && api?.openOriginal && (
        <button
          role="menuitem"
          onClick={() => {
            setPopover(null);
            api
              .openOriginal(menuCard.path)
              .then(valueOf)
              .catch((e) => setError(e.message));
          }}
        >
          打开原文件
        </button>
      )}
      {menuCard.origin === 'vault' && onOpen && (
        <button
          role="menuitem"
          onClick={() => {
            onExit?.();
            onOpen(menuCard.path);
          }}
        >
          在梦藏中打开
        </button>
      )}
    </>
  );
}
