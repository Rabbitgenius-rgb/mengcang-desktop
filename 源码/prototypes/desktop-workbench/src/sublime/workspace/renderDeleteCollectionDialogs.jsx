import React from 'react';
import { renderBackupRestoreReview } from './BackupRestoreReview.jsx';
export function renderDeleteCollectionDialogs(view) {
  const { modal, previewPastedBackup, setModal, perform, updatePastedBackup } = view;
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
            粘贴“导出旧版兼容备份”生成的 JSON 内容，最多 4 MiB。完整 ZIP 备份和更大的 JSON 请通过“导入备份”选择文件。
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
      {modal.type === 'restore' && renderBackupRestoreReview(view)}
    </>
  );
}
