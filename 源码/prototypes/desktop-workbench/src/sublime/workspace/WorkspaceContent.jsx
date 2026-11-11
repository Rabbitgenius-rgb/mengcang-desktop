import React from 'react';
import { LinkedNoteEditor } from './LinkedNoteEditor.jsx';
import { IconCheck } from '@tabler/icons-react';
import { workspaceReducer } from '../workspaceModel.js';
import { CardEditor, CollectionEditor, CanvasEditor, ImportEditor } from '../SublimeEditors.jsx';
import BookReader from '../../reader/BookReader.jsx';
import { isReadableBook } from '../../reader/readerState.js';
import SaveCardPanel from '../SaveCardPanel.jsx';
import RecallWorkbench from '../../recall/RecallOnlyWorkbench.jsx';
import { archivedRecallCards } from '../../recallSession.js';
import { WORKBENCH_KEY, normalizeWorkbench, recallCards } from '../../recall/recallModel.js';
import StarHome from '../StarHome.jsx';
import { renderCardDetail } from './CardDetailView.jsx';
import { renderLibrary } from './LibraryView.jsx';
import { renderOperationMenu } from './OperationMenu.jsx';
import { renderWorkspaceDialogs } from './WorkspaceDialogs.jsx';
import { renderArchiveNav } from './archive/ArchiveNav.jsx';
export function renderWorkspaceContent(view) {
  const {
    route,
    identityId,
    state,
    api,
    demo,
    libraryCards,
    starView,
    setStarView,
    current,
    root,
    cardActions,
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
    checkingSource,
    cardIdentityContext,
    filters,
    nativeIds,
    tile,
    updateReader,
    saveReaderExcerpt,
    readerNavigation,
    editing,
    uiCard,
    editorDraft,
    session,
    draftKey,
    editDraft,
    saveCard,
    collectionDraftKey,
    recoveryEditorVersion,
    saveCollection,
    importRecords,
    currentBoard,
    boardDraft,
    searchLabel,
    personalScope,
    meaningActive,
    personalSearch,
    groupPage,
    visibleCollections,
    visibleBoards,
    moreOptions,
    currentCollection,
    searchScope,
    visibleCards,
    meaningSearch,
    keywordCards,
    selectionMode,
    selectedCards,
    finishSelection,
    isEditor,
    menuCard,
    saveOptionDrafts,
    connected,
    onOpen,
    theme,
    recoveryDrafts,
    backup,
    openPastedBackup,
    onRefresh,
    onExit,
    modal,
    setError,
    saveBookCover,
    saving,
    exportShare,
    aiResultDrafts,
    persistAiResult,
    saveInsight,
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
    previewPastedBackup,
    backupInput,
    readBackupFile,
    error,
    toast,
    changeRecallArchive,
    loadedIdentity,
    commit,
    navigate,
    setModal,
    openEditor,
    setReaderNavigation,
    navigation,
    setArticleNavigation,
    collectArticleFigure,
    saveArticleHighlight,
    saveArticleDraft,
    saveDocumentExcerpt,
    copyText,
    openCardSource,
    setFilterDraft,
    saveDraft,
    changeLibraryQuery,
    changeSearchMode,
    setShuffle,
    setPopover,
    showAi,
    setCollectionPinned,
    setMoreOptions,
    setFilters,
    setSelected,
    openExport,
    perform,
    selectedIds,
    saveCardOptions,
    share,
    setBookClassification,
    openNote,
    removeSavedCard,
    stateRef,
    setSelectionMode,
    notify,
    modalRef,
    recoverDraft,
    aiVolatile,
    aiRequests,
    epoch,
    restoreAiSource,
    saveEnrichment,
    setNoteDraft,
    setCollectionQuery,
    collectionTargets,
    createBoard,
    exportText,
    updatePastedBackup,
    viewRef,
  } = view;
  return (
    <>
      {route.page === 'recall' && (
        <RecallWorkbench
          key={identityId}
          withStyles
          cards={recallCards(state)}
          archivedCards={archivedRecallCards(state)}
          model={state.drafts[WORKBENCH_KEY]}
          api={api}
          demo={demo}
          onDelete={(id) => changeRecallArchive(id, true)}
          onRestore={(id) => changeRecallArchive(id, false)}
          onUpdate={(producer) => {
            if (loadedIdentity.current !== identityId) return Promise.reject(Error('工作区已切换，请回到原工作区重试。'));
            return commit((existing) =>
              workspaceReducer(existing, { type: 'draft.set', key: WORKBENCH_KEY, value: producer(normalizeWorkbench(existing.drafts[WORKBENCH_KEY])) }),
            );
          }}
          onReview={(id, due) =>
            commit((existing) => {
              const card = recallCards(existing).find((c) => c.id === id);
              if (!card) throw Error('此摘录已归档或不存在');
              return workspaceReducer(existing, { type: 'card.upsert', card: { ...card, recallDue: due } });
            })
          }
          onLibrary={() => navigate('library')}
          onSettings={() => setModal({ type: 'ai', mode: 'Settings', card: null })}
        />
      )}
      {route.page === 'home' && (
        <StarHome
          cards={libraryCards}
          state={state}
          value={starView}
          onChange={setStarView}
          onLibrary={() => navigate('library')}
          onAdd={() => openEditor('text')}
          onOpen={(card) => {
            setReaderNavigation(null);
            navigate(isReadableBook(card) ? 'reader' : 'card', card.id);
          }}
        />
      )}
      {route.page === 'card' && current ? renderCardDetail(view) : null}
      {route.page === 'card' && !current && (
        <div className="sw-status">
          <h1>未找到卡片</h1>
          <p>本机资料库中没有这张卡片。</p>
          <button onClick={() => navigate('library')}>我的资料库</button>
        </div>
      )}
      {route.page === 'reader' &&
        (current && saved(current) ? (
          <BookReader
            key={identityId + ':' + current.id}
            card={current}
            api={api}
            readerStates={state.drafts}
            onUpdate={updateReader}
            onExcerpt={saveReaderExcerpt}
            registerFlush={registerReaderFlush}
            initialNavigation={readerNavigation?.sourceId === current.id ? readerNavigation : null}
            onExit={() => navigation.back()}
            onLibrary={() => navigate('library')}
          />
        ) : (
          <div className="sw-status">
            <h1>未找到可读图书</h1>
            <button onClick={() => navigate('library')}>我的资料库</button>
          </div>
        ))}
      {route.page === 'add' && (
        <CardEditor
          key={route.id}
          kind={
            editing
              ? editing.attachment || ['image', 'file', 'audio', 'video'].includes(editing.type)
                ? 'file'
                : editing.type === 'link'
                  ? 'link'
                  : 'text'
              : route.id || 'text'
          }
          card={uiCard}
          collections={state.collections}
          draft={editorDraft ?? session.drafts()[draftKey] ?? undefined}
          onDraftChange={editDraft}
          onSave={saveCard}
          onCancel={() => navigate(editing ? 'card' : 'library', editing?.id || '')}
        />
      )}
      {route.page === 'edit-collection' && (
        <CollectionEditor
          key={`${collectionDraftKey}:${recoveryEditorVersion}`}
          draft={state.drafts[collectionDraftKey]}
          onDraftChange={(value) => saveDraft(collectionDraftKey, value)}
          firstCollection={!state.collections.length}
          collection={state.collections.find((c) => c.id === route.id) || null}
          onSave={saveCollection}
          onCancel={() => navigate('collections')}
        />
      )}
      {route.page === 'import' && (
        <ImportEditor
          draft={state.drafts.importLibrary}
          onDraftChange={(value) => saveDraft('importLibrary', value)}
          onImport={importRecords}
          onCancel={() => navigate('library')}
        />
      )}
      {route.page === 'canvas' && (
        <CanvasEditor
          board={currentBoard}
          hasDraft={!!boardDraft}
          items={libraryCards}
          collections={state.collections}
          onChange={(board) => commit({ type: 'board.upsert', board })}
          onBack={() => navigate('canvases')}
        />
      )}
      {!['recall', 'home', 'reader', 'card', 'add', 'edit-collection', 'import', 'canvas'].includes(route.page) && renderLibrary(view)}
      {(!isEditor || route.page === 'recall') && renderArchiveNav(view)}
      {popover?.type === 'saved' && menuCard && (
        <SaveCardPanel
          key={menuCard.id}
          card={menuCard}
          initial={popover.initial}
          collections={state.collections}
          drafts={saveOptionDrafts}
          anchor={popover.anchor}
          onSave={(base, value) => saveCardOptions(menuCard, base, value)}
          onClose={() => setPopover(null)}
        />
      )}
      {popover && popover.type !== 'saved' && (
        <>
          <button className="sw-popover-dismiss" aria-label="关闭菜单" onClick={() => setPopover(null)} />
          {renderOperationMenu(view)}
        </>
      )}
      {modal?.type === 'linked-note' && (
        <LinkedNoteEditor
          key={modal.editor.value.id}
          source={modal.source}
          editor={modal.editor}
          onError={setError}
          onClose={() => {
            if (modalRef.current === modal) setModal(null);
          }}
          onSaved={() => {
            if (modalRef.current === modal) {
              navigate('card', modal.editor.value.id);
              notify('关联笔记已保存到我的资料库');
            }
          }}
        />
      )}
      {modal && modal.type !== 'linked-note' && renderWorkspaceDialogs(view)}
      <input ref={backupInput} hidden type="file" accept=".zip,.json,application/zip,application/json" onChange={readBackupFile} />
      {error && (
        <div className="sw-error" role="alert">
          {error}
          {recoveryDrafts.length > 0 && <button onClick={() => setModal({ type: 'drafts' })}>恢复草稿</button>}
          <button onClick={() => setError('')}>关闭提示</button>
        </div>
      )}
      {saving && (
        <span className="sw-saving" role="status">
          正在保存到本机…
        </span>
      )}
      {toast && (
        <div className="sw-toast" role="status">
          <IconCheck size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
