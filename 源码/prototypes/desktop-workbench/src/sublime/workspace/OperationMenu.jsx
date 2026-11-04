import { WorkspaceMenu } from './WorkspaceMenu.jsx';
import React from 'react';
import { aiLabel } from './constants.js';
import {
  IconArrowLeft,
  IconUpload,
  IconSparkles,
  IconPencil,
  IconFolder,
  IconLayoutBoard,
  IconPhoto,
  IconLink,
  IconFileText,
  IconBook2,
} from '@tabler/icons-react';
import { AI_MODES } from '../workspaceModel.js';
import { savePanelPosition } from '../saveOptions.js';
import { IMAGE_INSIGHT_MODES, isImageReference } from '../intelligenceHelpers.js';
import { renderCardMenu } from './CardMenu.jsx';
export function renderOperationMenu(view) {
  const {
    popover,
    menuCard,
    saved,
    state,
    demo,
    connected,
    api,
    onOpen,
    route,
    currentCollection,
    groupPage,
    visibleCards,
    theme,
    recoveryDrafts,
    backup,
    session,
    openPastedBackup,
    onRefresh,
    onExit,
    share,
    copyText,
    setPopover,
    openEditor,
    setBookClassification,
    setModal,
    openNote,
    removeSavedCard,
    perform,
    stateRef,
    setError,
    showAi,
    navigate,
    setSelectionMode,
    openExport,
    saveDraft,
    backupInput,
    notify,
  } = view;
  return (
    <WorkspaceMenu
      anchor={popover.anchor}
      onClose={() => setPopover(null)}
      className={`sw-popover sw-menu sw-popover-${popover.type}`}
      style={
        popover.anchor
          ? savePanelPosition(popover.anchor.getBoundingClientRect(), { width: 280, height: 400 }, { width: innerWidth, height: innerHeight })
          : undefined
      }
      role="menu"
      aria-label={menuCard ? '卡片操作：' + menuCard.title : '操作菜单'}
    >
      {popover.type === 'more' && menuCard && renderCardMenu(view)}
      {popover.type === 'insights' && (
        <>
          <p className="sw-menu-label">AI 解读</p>
          {[...AI_MODES, ...(isImageReference(menuCard) ? IMAGE_INSIGHT_MODES : [])].map((mode) => (
            <button role="menuitem" key={mode} onClick={() => showAi(mode)}>
              <IconSparkles />
              {aiLabel(mode)}
            </button>
          ))}
          <hr />
          <small className="sw-ai-badge">API / CLI · 点击开始分析即调用</small>
          <button role="menuitem" onClick={() => showAi('Classification')}>
            分类建议
          </button>
          <button role="menuitem" onClick={() => showAi('OCR')}>
            图片 / PDF 文字识别
          </button>
        </>
      )}
      {popover.type === 'add' && (
        <>
          <button
            role="menuitem"
            onClick={() => {
              setPopover(null);
              setModal({ type: 'podcast' });
            }}
          >
            播客片段与字幕
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setPopover(null);
              setModal({ type: 'sources' });
            }}
          >
            来源订阅与网页剪藏
          </button>
          <button role="menuitem" onClick={() => openEditor('link')}>
            <IconLink />
            粘贴链接
          </button>
          <button role="menuitem" onClick={() => openEditor('text')}>
            <IconFileText />
            写笔记
          </button>
          <button role="menuitem" onClick={() => openEditor('book')}>
            <IconBook2 />
            导入图书
          </button>
          <button role="menuitem" onClick={() => openEditor('file')}>
            <IconPhoto />
            导入文件
          </button>
          <hr />
          <button role="menuitem" onClick={() => navigate('edit-collection')}>
            <IconFolder />
            新建收藏集
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setModal({ type: 'new-board' });
              setPopover(null);
            }}
          >
            <IconLayoutBoard />
            新建画布
          </button>
          <button role="menuitem" onClick={() => navigate('import')}>
            <IconUpload />
            导入资料
          </button>
        </>
      )}
      {popover.type === 'library' && (
        <>
          {route.page === 'collection' && currentCollection && (
            <button role="menuitem" onClick={() => navigate('edit-collection', currentCollection.id)}>
              <IconPencil />
              编辑收藏集
            </button>
          )}
          {!groupPage && (
            <button
              role="menuitem"
              onClick={() => {
                setSelectionMode(true);
                setPopover(null);
              }}
            >
              选择卡片
            </button>
          )}
          {!groupPage && (
            <button role="menuitem" disabled={!visibleCards.length} onClick={() => openExport(visibleCards)}>
              导出全部结果
            </button>
          )}
          <button role="menuitem" onClick={() => navigate('import')}>
            导入资料
          </button>
          <button role="menuitem" onClick={() => navigate('trash')}>
            已归档卡片
          </button>
          <button role="menuitem" onClick={() => showAi('Semantic search')}>
            语义搜索
          </button>
        </>
      )}
      {popover.type === 'tools' && (
        <>
          <p className="sw-menu-label">本机工具</p>
          <button role="menuitem" onClick={() => navigate('discover')}>
            发现关联想法
          </button>
          <button role="menuitem" onClick={() => navigate('following')}>
            已保存的来源
          </button>
          <button role="menuitem" onClick={() => navigate('staff')}>
            精选素材
          </button>
          <hr />
          <button role="menuitem" onClick={() => showAi('Settings')}>
            AI 连接与用量
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setPopover(null);
              setModal({ type: 'sources' });
            }}
          >
            来源订阅与网页剪藏
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setPopover(null);
              setModal({ type: 'external-ai' });
            }}
          >
            外部 AI 接入说明
          </button>
          <label className="sw-field">
            主题
            <select aria-label="主题" value={theme} onChange={(event) => saveDraft('appearance', event.target.value)}>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
          </label>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              setPopover(null);
              setModal({ type: 'drafts' });
            }}
          >
            恢复草稿 · {recoveryDrafts.length}
          </button>
          <button role="menuitem" onClick={() => backup()}>
            导出完整备份
          </button>
          {session.migrationStatus?.()?.canCleanup && (
            <button
              role="menuitem"
              onClick={() => {
                setPopover(null);
                setModal({ type: 'legacy-cleanup' });
              }}
            >
              清理旧版迁移副本
            </button>
          )}
          <button role="menuitem" onClick={() => backup(true)}>
            导出旧版兼容备份
          </button>
          <button role="menuitem" onClick={() => backupInput.current?.click()}>
            导入备份并预览
          </button>
          <button role="menuitem" onClick={openPastedBackup}>
            粘贴备份内容
          </button>
          <button role="menuitem" onClick={() => navigate('trash')}>
            已归档卡片
          </button>
          <button role="menuitem" onClick={() => setModal({ type: 'about' })}>
            关于本机资料库
          </button>
          {onRefresh && (
            <button
              role="menuitem"
              onClick={() => {
                setPopover(null);
                Promise.resolve(onRefresh())
                  .then(() => notify('已重新读取本地资料'))
                  .catch((e) => setError(e.message));
              }}
            >
              刷新本地资料
            </button>
          )}
          {onExit && (
            <button role="menuitem" onClick={onExit}>
              <IconArrowLeft />
              返回梦藏
            </button>
          )}
        </>
      )}
    </WorkspaceMenu>
  );
}
