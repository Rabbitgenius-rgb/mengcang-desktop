import React from 'react';
import { renderBookCoverDialogs } from './renderBookCoverDialogs.jsx';
import { renderPodcastDialogs } from './renderPodcastDialogs.jsx';
import { renderNewBoardDialogs } from './renderNewBoardDialogs.jsx';
import { renderDeleteCollectionDialogs } from './renderDeleteCollectionDialogs.jsx';
import { uid } from './constants.js';
import { MEDIA } from './constants.js';
import { SORTS } from './constants.js';
import { MEDIA_LABELS } from './constants.js';
import { aiLabel } from './constants.js';
import { initialFilters } from './constants.js';
import { VAULT_DISCONNECTED_MESSAGE } from './constants.js';
import { download } from './constants.js';
import { Modal } from './WorkspacePrimitives.jsx';
import { GeneratedDownload } from './WorkspacePrimitives.jsx';
import { workspaceReducer, safeSourceUrl, mergeWorkspaceBackup, previewWorkspaceBackupMerge } from '../workspaceModel.js';
import { inlineWorkspaceAttachment } from '../attachmentStore.js';
import { valueOf } from '../../desktopModel.js';
import { cardCapturePayload, resolveNoteReference } from '../workspaceView.js';
import BookCoverEditor from '../BookCoverEditor.jsx';
import IntelligencePanel from '../IntelligencePanel.jsx';
import SourceFeeds from '../SourceFeeds.jsx';
import PodcastClips from '../PodcastClips.jsx';
import { aiResultKey, ocrEnrichmentPatch } from '../intelligenceDrafts.js';
export function renderWorkspaceDialogs(view) {
  const {
    modal,
    saveBookCover,
    libraryCards,
    recoveryDrafts,
    saving,
    exportShare,
    state,
    api,
    aiResultDrafts,
    persistAiResult,
    saveInsight,
    importRecords,
    cards,
    transcribePodcast,
    podcastResultDrafts,
    podcastResultIsDurable,
    persistPodcastTranscript,
    podcastRequests,
    recoverPodcastTranscript,
    savePodcast,
    filterDraft,
    noteDraft,
    collectionQuery,
    connected,
    previewPastedBackup,
    setModal,
    navigate,
    recoverDraft,
    session,
    notify,
    setError,
    copyText,
    aiVolatile,
    identityId,
    aiRequests,
    epoch,
    restoreAiSource,
    saveEnrichment,
    commit,
    saveDraft,
    setFilterDraft,
    filters,
    setFilters,
    setNoteDraft,
    setCollectionQuery,
    collectionTargets,
    perform,
    createBoard,
    exportText,
    stateRef,
    onRefresh,
    updatePastedBackup,
    viewRef,
    modalRef,
  } = view;
  return (
    <Modal
      title={
        modal.type === 'book-cover'
          ? '图书封面'
          : modal.type === 'reference-choice'
            ? '选择引用资料'
            : modal.type === 'ai'
              ? aiLabel(modal.mode)
              : modal.type === 'sources'
                ? '来源订阅与网页剪藏'
                : modal.type === 'podcast'
                  ? '播客片段'
                  : modal.type === 'external-ai'
                    ? '外部 AI 接入'
                    : modal.type === 'filters'
                      ? '筛选'
                      : modal.type === 'note'
                        ? '我的备注'
                        : modal.type === 'bulk-collection'
                          ? '加入收藏集'
                          : modal.type === 'new-board'
                            ? '新建画布'
                            : modal.type === 'backup'
                              ? modal.contentType === 'application/json'
                                ? '导出旧版兼容备份'
                                : '导出完整备份'
                              : modal.type === 'export'
                                ? '导出卡片'
                                : modal.type === 'copy'
                                  ? '复制链接或文字'
                                  : modal.type === 'paste-backup'
                                    ? '粘贴备份内容'
                                    : modal.type === 'restore'
                                      ? '导入备份'
                                      : modal.type === 'share'
                                        ? '分享离线卡片'
                                        : modal.type === 'drafts'
                                          ? '恢复草稿'
                                          : modal.type === 'about'
                                            ? '关于资料库'
                                            : modal.type === 'vault'
                                              ? '存入梦藏仓库'
                                              : '从资料库移除'
      }
      onClose={() => setModal(null)}
    >
      {renderBookCoverDialogs(view)}
      {renderPodcastDialogs(view)}
      {renderNewBoardDialogs(view)}
      {renderDeleteCollectionDialogs(view)}
    </Modal>
  );
}
