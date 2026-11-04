import React from 'react';
import { GeneratedDownload } from './WorkspacePrimitives.jsx';
import { workspaceReducer, safeSourceUrl } from '../workspaceModel.js';
import { resolveNoteReference } from '../workspaceView.js';
import BookCoverEditor from '../BookCoverEditor.jsx';
import IntelligencePanel from '../IntelligencePanel.jsx';
import SourceFeeds from '../SourceFeeds.jsx';
import { aiResultKey, ocrEnrichmentPatch } from '../intelligenceDrafts.js';
export function renderBookCoverDialogs(view) {
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
  } = view;
  return (
    <>
      {modal.type === 'book-cover' && (
        <BookCoverEditor attachment={modal.card.attachment} image={modal.card.image} onSave={saveBookCover} onCancel={() => setModal(null)} />
      )}
      {modal.type === 'reference-choice' && (
        <>
          <p>有多份同名资料，请按路径选择。</p>
          {resolveNoteReference(modal.target, libraryCards, modal.source).matches.map((card) => (
            <button className="sw-reference-choice" key={card.id} onClick={() => navigate('card', card.id)}>
              <strong>{card.title}</strong>
              <small>{card.path || card.id}</small>
            </button>
          ))}
        </>
      )}
      {modal.type === 'drafts' && (
        <>
          <p>其他窗口与历史恢复稿保留在本机。冲突稿另存副本，原内容不会覆盖。</p>
          {!recoveryDrafts.length && <p className="sw-muted">没有其他恢复稿。当前编辑器的草稿会继续保留。</p>}
          {recoveryDrafts.map((record) => (
            <article className="sw-recovery-draft" key={record.id}>
              <strong>{record.key}</strong>
              <small>
                {record.memoryOnly
                  ? '尚未落盘'
                  : record.copyOnly
                    ? '历史编辑稿，请另存新卡片'
                    : record.conflict
                      ? '版本冲突'
                      : record.recoveryOnly
                        ? '历史恢复稿'
                        : '未完成草稿'}{' '}
                · {record.updatedAt}
              </small>
              <p>{String(record.value?.body ?? record.value?.note ?? record.value?.title ?? '文件或结构草稿').slice(0, 180)}</p>
              <footer>
                {!record.conflict && !record.recoveryOnly && !record.copyOnly && !record.key.startsWith('board:') && (
                  <button onClick={() => recoverDraft(record)}>恢复编辑</button>
                )}
                <button className="sw-primary" onClick={() => recoverDraft(record, true)}>
                  另存副本
                </button>
              </footer>
            </article>
          ))}
        </>
      )}
      {modal.type === 'legacy-cleanup' && (
        <>
          <p>新资料库已完成三次启动读回。清理旧版迁移副本后，自动备份仍可用于恢复。</p>
          <button onClick={() => setModal(null)}>取消</button>
          <button
            onClick={async () => {
              try {
                await session.cleanupLegacy();
                setModal(null);
                notify('旧版迁移副本已清理');
              } catch (issue) {
                setError(issue.message);
              }
            }}
          >
            确认清理旧副本
          </button>
        </>
      )}
      {modal.type === 'backup' && (
        <>
          <p>备份已生成。若浏览器没有自动保存，请点击下面的链接下载同一份备份。</p>
          <GeneratedDownload text={modal.text} name={modal.filename} type={modal.contentType || 'application/zip'} label="下载完整备份" />
        </>
      )}
      {modal.type === 'share' && (
        <>
          <p>导出为独立 HTML 卡片，发送文件即可阅读，无需账号或本机服务。</p>
          <blockquote>{modal.card.title}</blockquote>
          {modal.card.caption && (
            <label className="sw-menu-row">
              <input type="checkbox" checked={modal.includeNote} onChange={(e) => setModal((v) => ({ ...v, includeNote: e.target.checked }))} />
              包含我的备注
            </label>
          )}
          {modal.card.attachment && (
            <label className="sw-menu-row">
              <input type="checkbox" checked={modal.includeAttachment} onChange={(e) => setModal((v) => ({ ...v, includeAttachment: e.target.checked }))} />
              附带可下载的原文件
            </label>
          )}
          {modal.generated && <GeneratedDownload text={modal.generated} name={modal.filename} />}
          <footer>
            {safeSourceUrl(modal.card.sourceUrl) && <button onClick={() => copyText(modal.card.sourceUrl, '来源链接已复制')}>复制原网页链接</button>}
            <button className="sw-primary" disabled={saving} onClick={exportShare}>
              {saving ? '正在导出…' : '下载离线卡片'}
            </button>
          </footer>
        </>
      )}
      {modal.type === 'ai' && (
        <IntelligencePanel
          mode={modal.mode}
          card={modal.card}
          cards={libraryCards}
          collections={state.collections}
          api={api}
          resultDrafts={aiResultDrafts()}
          isResultDurable={(id, phase) => !aiVolatile.current.has(`${identityId}:${id}`) && state.drafts[aiResultKey(id)]?.phase === phase}
          onResultDraft={persistAiResult}
          requestIsActive={(id) => aiRequests.current.has(`${identityId}:${id}`)}
          registerRequest={(id, active) => {
            const key = `${identityId}:${id}`;
            if (active) aiRequests.current.add(key);
            else aiRequests.current.delete(key);
          }}
          onSaveInsight={saveInsight}
          onSaveOcr={async (source, result) => {
            const run = epoch.current,
              snapshot = await restoreAiSource(source);
            return saveEnrichment(snapshot, ocrEnrichmentPatch(result), [], run);
          }}
          onApplyClassification={async (source, result) => {
            const run = epoch.current,
              snapshot = await restoreAiSource(source);
            return saveEnrichment(snapshot, { tags: [...new Set([...(snapshot.tags || []), ...result.tags])] }, result.collectionIds, run);
          }}
          onOpen={(id) => navigate('card', id)}
        />
      )}
      {modal.type === 'sources' && (
        <SourceFeeds
          api={api}
          feeds={state.drafts.sourceFeeds || []}
          onFeedsChange={(value) =>
            commit((existing) => {
              if (JSON.stringify(existing.drafts.sourceFeeds || []) !== JSON.stringify(state.drafts.sourceFeeds || []))
                throw Error('来源列表已在其他窗口变化，请重新打开后保存。');
              return workspaceReducer(existing, { type: 'draft.set', key: 'sourceFeeds', value });
            })
          }
          onImport={importRecords}
          existingCards={cards}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
