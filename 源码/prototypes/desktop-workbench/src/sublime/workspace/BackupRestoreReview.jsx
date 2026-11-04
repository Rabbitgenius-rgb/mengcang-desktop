import React, { useRef, useState } from 'react';
import {
  canRestoreEmptyWorkspace,
  restoreEmptyWorkspace,
  mergeWorkspaceBackup,
  previewWorkspaceBackupMerge,
  normalizeWorkspaceState,
  prepareWorkspaceBackupRestore,
  serializeWorkspace,
} from '../workspaceModel.js';
import { hydrateAttachmentUrls, nativeAttachmentUrl, reconnectAttachmentUrls, externalizeAttachmentUrls } from '../attachmentStore.js';
import { applyWorkspaceBackup, inspectWorkspaceBackup, previewBackupState } from '../workspaceBackup.js';
import { matchingBackupOriginals } from '../workspaceBackupSource.js';
import { withAttachmentMaintenance } from '../attachmentMaintenance.js';
import { attachmentFiles } from './constants.js';

export function useBackupRestore({ modal, cards, identityId, documentJobs, documentWaiters, viewRef, epoch, session, modalRef, navigate, notify, setError }) {
  const pending = useRef(new WeakSet());
  const [working, setWorking] = useState(null);
  function confirmRestore(exact) {
    if (modalRef.current !== modal || pending.current.has(modal)) return;
    if (session.migrationStatus?.()?.readOnly) {
      setError('资料库当前只读，请先导出备份并核对旧版资料。');
      return;
    }
    pending.current.add(modal);
    setWorking(modal);
    const run = epoch.current,
      route = viewRef.current.route;
    const isVisible = () => run === epoch.current && viewRef.current.route === route && modalRef.current === modal;
    const job = withAttachmentMaintenance(async () => {
      try {
        if (session.migrationStatus?.()?.readOnly) throw Error('资料库当前只读，请先导出备份并核对旧版资料。');
        const plan = modal.plan || (await inspectWorkspaceBackup(serializeWorkspace(modal.value)));
        const allowedOriginalIds = await matchingBackupOriginals(plan, identityId, cards);
        const approved = prepareWorkspaceBackupRestore(normalizeWorkspaceState(await previewBackupState(plan)), { allowedOriginalIds });
        await applyWorkspaceBackup(
          plan,
          attachmentFiles,
          async () => {
            const replacements = new Map();
            const incoming = normalizeWorkspaceState(
              await hydrateAttachmentUrls(externalizeAttachmentUrls(approved), {
                async url(ref) {
                  const display = await attachmentFiles.url(ref);
                  if (display.startsWith('blob:')) replacements.set(nativeAttachmentUrl(ref), display);
                  return display;
                },
              }),
            );
            const context = { knownCardIds: cards.map((card) => card.id), knownCardPaths: cards.map((card) => card.path).filter(Boolean) };
            // Confirmation belongs to this captured session. Later navigation
            // controls only where feedback appears, never the transaction target.
            return session.commit(
              (existing) => {
                if (exact) return restoreEmptyWorkspace(existing, incoming);
                return mergeWorkspaceBackup(reconnectAttachmentUrls(existing, replacements), incoming, context);
              },
              { failureOwner: 'caller' },
            );
          },
          () => run === epoch.current,
          { retainedState: (result) => result },
        );
        if (isVisible()) {
          navigate('library');
          notify(exact ? '备份已恢复' : '备份已合并 · 当前状态已保留');
        }
      } catch (error) {
        if (isVisible()) setError(error.message);
      } finally {
        pending.current.delete(modal);
        setWorking((current) => (current === modal ? null : current));
      }
    });
    // Include attachment preparation and rollback in the existing quit/export
    // wait, even before the entity transaction is submitted.
    documentJobs?.current.set(job, identityId);
    for (const waiter of documentWaiters?.current || []) if (waiter.identity === undefined || waiter.identity === identityId) waiter.jobs.add(job);
    void job.finally(() => documentJobs?.current.delete(job)).catch(() => {});
    return job;
  }
  return { confirmRestore, restoringBackup: working === modal };
}

export function renderBackupRestoreReview({ modal, cards, state, session, confirmRestore, restoringBackup }) {
  const readOnly = session?.migrationStatus?.()?.readOnly;
  const context = { knownCardIds: cards.map((card) => card.id), knownCardPaths: cards.map((card) => card.path).filter(Boolean) };
  const exact = canRestoreEmptyWorkspace(state);
  let preview;
  try {
    preview = previewWorkspaceBackupMerge(state, modal.value, context);
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
      <p>所选备份：{modal.filename || '未命名备份'}</p>
      {readOnly && <p role="alert">资料库当前只读。可以导出备份，请核对旧版资料后再恢复。</p>}
      <p className="sw-muted">原始资料的整理状态只恢复到身份和内容均匹配的原卡。无法核对的备注会保留为独立恢复稿。</p>
      <p className="sw-muted">备份中的旧编辑草稿保留为恢复副本，可从本机工具的“恢复草稿”另存。</p>
      <p>
        备份包含 {modal.value.cards.length} 张卡、{modal.value.collections.length} 个收藏集和 {modal.value.boards.length} 个画布。
      </p>
      {exact && <p>当前工作区为空。选择“恢复备份”可还原资料、回看记录，以及原始资料的备注、标星和隐藏状态。</p>}
      {exact && <strong>以下统计仅适用于“合并备份”</strong>}
      <p>
        将新增 {preview.addedCards} 张卡、{preview.addedCollections} 个收藏集和 {preview.addedBoards} 个画布；保留 {preview.preservedCardStates}{' '}
        张当前卡片的内容、收藏和归档状态。
      </p>
      <p className="sw-muted">
        同 ID 的现有收藏集、画布、注释与普通草稿保留；已有卡片的标星、私密和归档状态以当前值为准。
        {preview.mergedReaderRecords > 0 && ` ${preview.mergedReaderRecords} 份阅读记录会合并书签和摘录，保留当前进度与设置；不同笔记会保留恢复副本。`}
        {preview.recoveredNotes || 0} 份不同的备份备注会另存为可手动恢复的副本，不覆盖当前备注。新增收藏集会添加 {preview.addedMembershipsForExistingCards}{' '}
        个现有卡片成员关系；{preview.skippedExternalReferences} 个无法定位的外部引用及 {preview.skippedDrafts} 个旧草稿或重试请求将跳过；
        {preview.recoveryDrafts || 0} 个历史草稿将保留在恢复列表。
      </p>
      <footer>
        <button disabled={restoringBackup || readOnly} onClick={() => confirmRestore(false)}>
          合并备份
        </button>
        {exact && (
          <button className="sw-primary" disabled={restoringBackup || readOnly} onClick={() => confirmRestore(true)}>
            恢复备份
          </button>
        )}
      </footer>
    </>
  );
}
