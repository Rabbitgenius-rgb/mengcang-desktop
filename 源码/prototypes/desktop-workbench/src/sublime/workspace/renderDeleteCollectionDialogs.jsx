import React from 'react';
import { mergeWorkspaceBackup, previewWorkspaceBackupMerge } from '../workspaceModel.js';
export function renderDeleteCollectionDialogs(view) {
  const { modal, previewPastedBackup, setModal, perform, updatePastedBackup, state, cards, viewRef, epoch, commit, modalRef, navigate, notify, setError } =
    view;
  return (
    <>
      {modal.type === 'delete-collection' && (
        <>
          <p>确定移除“{modal.collection.title}”？卡片仍保留在资料库中。</p>
          <footer>
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="sw-primary"
              onClick={() => {
                perform({ type: 'collection.delete', id: modal.collection.id }, '收藏集已移除');
                setModal(null);
              }}
            >
              移除收藏集
            </button>
          </footer>
        </>
      )}
      {modal.type === 'delete-board' && (
        <>
          <p>确定移除“{modal.board.title}”？卡片仍保留在资料库中。</p>
          <footer>
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="sw-primary"
              onClick={() => {
                perform({ type: 'board.delete', id: modal.board.id }, '画布已移除');
                setModal(null);
              }}
            >
              移除画布
            </button>
          </footer>
        </>
      )}
      {modal.type === 'paste-backup' && (
        <form onSubmit={previewPastedBackup}>
          <p id="sw-backup-paste-help" className="sw-muted">
            粘贴“导出完整备份”生成的 JSON 内容，最多 4MiB。先预览，确认合并后才会保存；更大的备份请使用文件导入。
          </p>
          <textarea
            aria-label="备份 JSON 内容"
            aria-describedby="sw-backup-paste-help"
            aria-invalid={!!modal.issue}
            rows={10}
            value={modal.text}
            onChange={(event) => updatePastedBackup(event.target.value)}
            spellCheck={false}
            autoFocus
          />
          {modal.issue && <p role="alert">{modal.issue}</p>}
          <footer>
            <button type="button" onClick={() => setModal(null)}>
              取消
            </button>
            <button type="submit" className="sw-primary">
              预览备份
            </button>
          </footer>
        </form>
      )}
      {modal.type === 'restore' && <p>所选备份：{modal.filename || '未命名备份'}</p>}
      {modal.type === 'restore' &&
        (() => {
          let preview;
          try {
            preview = previewWorkspaceBackupMerge(state, modal.value, {
              knownCardIds: cards.map((card) => card.id),
              knownCardPaths: cards.map((card) => card.path).filter(Boolean),
            });
          } catch (issue) {
            return (
              <>
                <p role="alert">无法合并这份备份：{issue.message || '合并后的资料库超过允许范围。'}</p>
                <p>当前资料库和原备份保持不变。请关闭此窗口，选择较小的备份或分批导入卡片。</p>
              </>
            );
          }
          return (
            <>
              <p>
                备份包含 {modal.value.cards.length} 张卡、{modal.value.collections.length} 个收藏集和 {modal.value.boards.length} 个画布。
              </p>
              <p>
                将新增 {preview.addedCards} 张卡、{preview.addedCollections} 个收藏集和 {preview.addedBoards} 个画布；保留 {preview.preservedCardStates}{' '}
                张当前卡片的内容、收藏和归档状态。
              </p>
              <p className="sw-muted">
                同 ID 的现有收藏集、画布、注释与普通草稿保留；已有卡片的标星、私密和归档状态以当前值为准。
                {preview.mergedReaderRecords > 0 && ` ${preview.mergedReaderRecords} 份阅读记录会合并书签和摘录，保留当前进度与设置；不同笔记会保留恢复副本。`}
                {preview.recoveredNotes || 0} 份不同的备份备注会另存为可手动恢复的副本，不覆盖当前备注。新增收藏集会添加{' '}
                {preview.addedMembershipsForExistingCards} 个现有卡片成员关系；{preview.skippedExternalReferences} 个无法定位的外部引用及{' '}
                {preview.skippedDrafts} 个旧草稿或重试请求将跳过；{preview.recoveryDrafts || 0} 个历史草稿将保留在恢复列表。
              </p>
              <footer>
                <button
                  className="sw-primary"
                  onClick={async () => {
                    const chosen = modal,
                      originRoute = viewRef.current.route,
                      run = epoch.current;
                    try {
                      await commit((existing) =>
                        mergeWorkspaceBackup(existing, chosen.value, {
                          knownCardIds: cards.map((card) => card.id),
                          knownCardPaths: cards.map((card) => card.path).filter(Boolean),
                        }),
                      );
                      if (modalRef.current === chosen && viewRef.current.route === originRoute) navigate('library');
                      notify('备份已合并 · 当前状态已保留');
                    } catch (e) {
                      if (run === epoch.current) setError(e.message);
                    }
                  }}
                >
                  合并备份
                </button>
              </footer>
            </>
          );
        })()}
    </>
  );
}
