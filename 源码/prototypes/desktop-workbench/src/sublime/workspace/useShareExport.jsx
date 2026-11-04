import { restoreAttachmentData, externalizeAttachmentUrls } from '../attachmentStore.js';
import { attachmentFiles } from './constants.js';
import React from 'react';
import { workspaceReducer, exportCards } from '.././workspaceModel.js';
import { ImportEditor } from '.././SublimeEditors.jsx';
import { dedupeImports } from '../../discoveryModel.js';
import { buildOfflineCardHTML } from '.././workspaceView.js';
import { buildExternalContextExport } from '.././externalContext.js';
import { buildPublishableCollectionHTML } from '.././publishableCollection.js';
import { uid, download } from './constants.js';

export function useShareExport({
  setPopover,
  setModal,
  epoch,
  modal,
  setSaving,
  notify,
  setError,
  session,
  viewRef,
  modalRef,
  commit,
  cards,
  navigate,
  perform,
  currentCollection,
  collectionDraftKey,
  state,
  setSelected,
}) {
  function share(card) {
    setPopover(null);
    setModal({ type: 'share', card, includeNote: false, includeAttachment: true });
  }

  async function exportShare() {
    const run = epoch.current,
      chosen = modal;
    setSaving(true);
    try {
      let card = chosen.includeAttachment ? await restoreAttachmentData(externalizeAttachmentUrls(chosen.card), attachmentFiles) : { ...chosen.card };
      if (card.image && !card.image.startsWith('data:')) {
        const url = new URL(card.image, location.href);
        if (url.origin !== location.origin && url.protocol !== 'mengcang-asset:' && url.protocol !== 'blob:')
          throw Error('此图片尚未保存到本机，请先保存图片文件后分享。');
        const response = await fetch(url);
        if (!response.ok) throw Error('图片读取失败，请重试。');
        const blob = await response.blob();
        if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(blob.type) || blob.size > 64 * 1024 * 1024) throw Error('此图片格式暂不能嵌入离线分享。');
        card.image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      if (run !== epoch.current) return;
      const generated = buildOfflineCardHTML(card, chosen),
        filename = (card.title || '梦藏卡片').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70) + '.html';
      download(generated, filename, 'text/html');
      setModal((value) => (value === chosen ? { ...value, generated, filename } : value));
      notify('离线卡片已生成，已请求浏览器下载。');
    } catch (e) {
      if (run === epoch.current) setError(e.message || '分享文件生成失败');
    } finally {
      if (run === epoch.current) setSaving(session.writing > 0);
    }
  }

  async function importRecords(records, { draftSnapshot } = {}) {
    const now = new Date().toISOString(),
      submitted = draftSnapshot === undefined ? undefined : JSON.stringify(draftSnapshot),
      originRoute = viewRef.current.route,
      originModal = modalRef.current;
    let count = 0;
    await commit((existing) => {
      const { items: unique } = dedupeImports(records, [...cards, ...existing.cards]);
      if (!unique.length) throw Error('所选内容已在资料库中，无需重复导入。');
      count = unique.length;
      let next = unique.reduce((next, record) => {
        const id = uid();
        return workspaceReducer(
          workspaceReducer(next, {
            type: 'card.upsert',
            card: {
              ...record,
              importFingerprint: record.fingerprint,
              id,
              path: id,
              type: record.type || (record.sourceUrl ? 'link' : 'highlight'),
              origin: 'local',
              createdAt: record.date || now,
              updatedAt: now,
            },
          }),
          { type: 'card.save', id, saved: true },
        );
      }, existing);
      // Only the ImportEditor owns this draft. Clear its exact submitted snapshot
      // atomically with the cards; feed imports and later input retain their draft.
      if (submitted !== undefined && JSON.stringify(existing.drafts.importLibrary) === submitted)
        next = workspaceReducer(next, { type: 'draft.set', key: 'importLibrary', value: null });
      return next;
    });
    if (viewRef.current.route === originRoute && modalRef.current === originModal) navigate('library');
    notify(`已导入 ${count} 张卡片`);
  }

  function setCollectionPinned(id, pinned) {
    perform((existing) => {
      if (!existing.collections.some((collection) => collection.id === id)) throw Error('收藏集已不存在，未重新创建。');
      // A list toggle changes only this flag, not an old full-editor snapshot.
      return workspaceReducer(existing, { type: 'collection.upsert', collection: { id, pinned } });
    }, '收藏集已更新');
  }

  async function saveCollection(value) {
    const collection = {
      ...currentCollection,
      ...value,
      id: value.id || uid(),
      pinned: value.pinned ?? currentCollection?.pinned ?? false,
      cardIds: currentCollection?.cardIds || [],
    };
    await commit([
      { type: 'collection.upsert', collection },
      { type: 'draft.set', key: collectionDraftKey, value: null },
    ]);
    navigate('collection', collection.id);
    notify('收藏集已保存');
  }

  async function createBoard(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget),
      collectionId = String(fields.get('collection') || ''),
      collection = state.collections.find((item) => item.id === collectionId),
      board = {
        id: uid(),
        title: String(fields.get('name') || '').trim(),
        collectionId,
        nodes: (collection?.cardIds || []).map((itemPath, index) => ({ id: uid(), itemPath, x: 40 + (index % 3) * 250, y: 40 + Math.floor(index / 3) * 200 })),
        edges: [],
      };
    if (!board.title) return;
    await commit({ type: 'board.upsert', board });
    navigate('canvas', board.id);
  }

  function exportText(chosen, format) {
    return format === 'mcp'
      ? buildExternalContextExport(chosen, { title: currentCollection?.title || '梦藏已选资料' })
      : format === 'html'
        ? buildPublishableCollectionHTML(chosen, { title: currentCollection?.title || '梦藏资料合集' })
        : exportCards(chosen, format);
  }

  function openExport(chosen) {
    if (!chosen.length) return;
    setModal({ type: 'export', format: 'markdown', text: exportText(chosen, 'markdown'), count: chosen.length, cards: chosen });
    setPopover(null);
  }

  function toggleSelect(id) {
    setSelected((values) => (values.includes(id) ? values.filter((value) => value !== id) : [...values, id]));
  }
  return { share, exportShare, importRecords, setCollectionPinned, saveCollection, createBoard, exportText, openExport, toggleSelect };
}
