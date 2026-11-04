import React from 'react';
import { workspaceReducer, normalizeWorkspaceState, MAX_WORKSPACE_BACKUP_BYTES, parseWorkspaceBackup } from '.././workspaceModel.js';
import { hydrateAttachmentUrls } from '.././attachmentStore.js';
import { exportWorkspaceZip, importWorkspaceBackup, exportLegacyWorkspace } from '.././workspaceBackup.js';
import { copyDraftTitle, recoveredBoardCopy } from '.././workspaceView.js';
import { uid, attachmentFiles, download, checkPastedBackupSize } from './constants.js';

export function useDraftRecovery({
  epoch,
  modalRef,
  readerFlush,
  settleDocumentJobs,
  identityId,
  session,
  aiVolatile,
  podcastVolatile,
  setError,
  setPopover,
  setModal,
  notify,
  backupRead,
  modal,
  viewRef,
  viewVersion,
  loadedIdentity,
  cards,
  navigate,
  setEditorDraft,
  openEditor,
  openNote,
  setNoteDraft,
  setRecoveryEditorVersion,
  commit,
  setSaving,
}) {
  async function backup(legacy = false) {
    const run = epoch.current;
    try {
      await modalRef.current?.editor?.flush();
      await readerFlush.current?.();
      const latest = await settleDocumentJobs(identityId, () => session.settled());
      if (run !== epoch.current) return;
      // A successful unrelated write can clear the session error while returned
      // results remain only in this window. Recheck after awaiting the snapshot;
      // a response may have arrived during that wait. Other libraries stay isolated.
      const belongsHere = ([key, record]) => key === `${identityId}:${record.id}`;
      if ([...aiVolatile.current].some(belongsHere) || [...podcastVolatile.current].some(belongsHere))
        throw Error('仍有 AI/转录结果只保留在此窗口，完整备份尚未生成。请重新保存结果后再备份；也可先复制这些文字保留。');
      const text = legacy
          ? await exportLegacyWorkspace(latest, attachmentFiles)
          : await exportWorkspaceZip(latest, attachmentFiles, session.backupMetadata?.()),
        filename = legacy ? '梦藏-旧版兼容备份.json' : '梦藏-资料库备份.zip',
        contentType = legacy ? 'application/json' : 'application/zip';
      setError('');
      setPopover(null);
      setModal({ type: 'backup', text, filename, contentType });
      download(text, filename, contentType);
      notify('备份已生成，已请求浏览器下载；也可点击对话框中的下载链接。');
    } catch (e) {
      if (run === epoch.current) setError(e.message);
    }
  }

  function previewBackupText(text, filename) {
    const value = parseWorkspaceBackup(text);
    setError('');
    setPopover(null);
    setModal({ type: 'restore', value, filename });
  }

  function openPastedBackup() {
    backupRead.current++;
    setError('');
    setPopover(null);
    setModal({ type: 'paste-backup', text: '', issue: '' });
  }

  function updatePastedBackup(text) {
    try {
      checkPastedBackupSize(text);
      setModal((value) => (value?.type === 'paste-backup' ? { ...value, text, issue: '' } : value));
    } catch (issue) {
      setModal((value) => (value?.type === 'paste-backup' ? { ...value, issue: issue.message } : value));
    }
  }

  function previewPastedBackup(event) {
    event.preventDefault();
    if (modal?.type !== 'paste-backup') return;
    try {
      checkPastedBackupSize(modal.text);
      if (!modal.text.trim()) throw Error('请先粘贴完整备份 JSON 内容。');
      previewBackupText(modal.text, '粘贴的备份');
    } catch (issue) {
      const message = issue?.name === 'SyntaxError' ? '内容不是有效的 JSON，请复制完整备份后重试。' : issue.message || '备份内容无法读取。';
      setModal((value) => (value?.type === 'paste-backup' ? { ...value, issue: message } : value));
    }
  }

  async function readBackupFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const read = ++backupRead.current,
      run = epoch.current,
      originRoute = viewRef.current.route,
      originModal = modalRef.current,
      view = viewVersion.current;
    const current = () =>
      read === backupRead.current &&
      run === epoch.current &&
      view === viewVersion.current &&
      viewRef.current.route === originRoute &&
      modalRef.current === originModal;
    try {
      const isZip = /\.zip$/i.test(file.name);
      if (!isZip && file.size > MAX_WORKSPACE_BACKUP_BYTES) throw Error('旧 JSON 备份超过256MiB，请选择完整 ZIP 备份。');
      if (isZip) {
        const parsed = await importWorkspaceBackup(await file.arrayBuffer(), attachmentFiles);
        const value = normalizeWorkspaceState(await hydrateAttachmentUrls(parsed.state, attachmentFiles));
        if (current()) {
          setError('');
          setPopover(null);
          setModal({ type: 'restore', value, filename: file.name });
        }
      } else {
        const text = await file.text();
        if (!current()) return;
        previewBackupText(text, file.name);
      }
    } catch (issue) {
      if (current()) setError(`无法读取备份“${file.name}”：${issue.message || '文件读取失败。'}`);
    }
  }

  async function recoverDraft(record, asCopy = false) {
    let recoveryNote = '';
    const run = epoch.current,
      guard = () => {
        if (run !== epoch.current || loadedIdentity.current !== identityId) throw Error('工作区已切换，恢复稿保留在原资料库。');
      };
    try {
      const source = await session.readDraft(record.id);
      guard();
      const key = source.key,
        value = source.value;
      if (key.startsWith('edit:') || key.startsWith('new:')) {
        const card = key.startsWith('edit:') ? cards.find((card) => card.id === key.slice(5)) : null;
        const kind = key === 'new:book' ? 'book' : value.attachment ? 'file' : value.sourceUrl ? 'link' : 'text';
        if (asCopy) {
          const restored = await session.copyDraft(record.id, `new:${kind}`, (value) => ({ ...value, collectionIds: [] }));
          guard();
          navigate('add', kind);
          setEditorDraft(restored.value);
        } else {
          if (key.startsWith('edit:') && !card) throw Error('原卡片已不存在，请使用另存为新卡片。');
          const restored = await session.resumeDraft(record.id);
          guard();
          openEditor(kind, card);
          setEditorDraft(restored.value);
        }
      } else if (key.startsWith('note:')) {
        const card = cards.find((card) => card.id === key.slice(5));
        if (asCopy) {
          const restored = await session.copyDraft(record.id, 'new:text', (value) => ({
            body: value.note || '',
            type: 'text',
            private: !!value.private,
            sourceTitle: card?.title || '',
            sourceUrl: card?.sourceUrl || '',
            collectionIds: [],
          }));
          guard();
          navigate('add', 'text');
          setEditorDraft(restored.value);
        } else {
          if (!card) throw Error('原卡片已不存在，请使用另存为新卡片。');
          const restored = await session.resumeDraft(record.id);
          guard();
          openNote(card);
          setNoteDraft(restored.value.note || '');
        }
      } else if (key.startsWith('collection:')) {
        if (asCopy) {
          await session.copyDraft(record.id, 'collection:new', (value) => ({ ...value, title: copyDraftTitle(value.title, '收藏集') }));
          guard();
          navigate('edit-collection');
        } else {
          await session.resumeDraft(record.id);
          guard();
          navigate('edit-collection', key.slice(11) === 'new' ? '' : key.slice(11));
        }
        setRecoveryEditorVersion((value) => value + 1);
      } else if (key.startsWith('board:')) {
        if (!asCopy) throw Error('画布恢复请使用另存副本，当前画布不会覆盖。');
        const id = uid();
        await commit((existing) => {
          const board = recoveredBoardCopy(value, id, existing.collections);
          recoveryNote = value.collectionId && !board.collectionId ? ' 原收藏集已不存在，副本未加入收藏集。' : '';
          return workspaceReducer(existing, { type: 'board.upsert', board });
        });
        guard();
        navigate('canvas', id);
      } else throw Error('此草稿请通过完整备份保留，当前界面暂不能打开。');
      notify((asCopy ? '已打开独立副本，原内容与其他草稿保留' : '恢复草稿已打开，原有不同输入已保留在恢复列表。') + recoveryNote);
    } catch (e) {
      if (run === epoch.current) setError(e.message);
    } finally {
      if (run === epoch.current) setSaving(session.writing > 0);
    }
  }
  return { backup, previewBackupText, openPastedBackup, updatePastedBackup, previewPastedBackup, readBackupFile, recoverDraft };
}
