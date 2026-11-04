import React from 'react';
import { workspaceReducer } from '.././workspaceModel.js';
import { valueOf } from '../../desktopModel.js';
import {
  aiResultKey,
  normalizeAiRecord,
  listAiRecords,
  compactAiSource,
  captureAiSource,
  isSameAiSourceVersion,
  insightSaveActions,
} from '.././intelligenceDrafts.js';
import { uid } from './constants.js';

export function useAiDrafts({
  epoch,
  commit,
  notify,
  identityId,
  aiVolatile,
  setAiRevision,
  session,
  loadedIdentity,
  setError,
  stateRef,
  draftRef,
  setState,
  state,
  cards,
  api,
}) {
  async function saveEnrichment(source, patch, collectionIds = [], run = epoch.current) {
    if (run !== epoch.current) throw Error('工作区已切换，未采用旧结果。结果草稿仍保留。');
    const now = new Date().toISOString(),
      id = source.origin === 'vault' ? uid() : source.id;
    await commit((existing) => {
      if (run !== epoch.current) throw Error('工作区已切换，未采用旧结果。结果草稿仍保留。');
      const latest = existing.cards.find((x) => x.id === source.id);
      if (
        source.origin !== 'vault' &&
        (!latest ||
          JSON.stringify(compactAiSource({ ...latest, caption: existing.annotations[source.id]?.note ?? latest.caption })) !==
            JSON.stringify(compactAiSource(source)) ||
          JSON.stringify(latest.attachment) !== JSON.stringify(source.attachment))
      )
        throw Error('原卡片已变化，请重新打开工具并核对后保存。');
      const updated = {
        ...(source.origin === 'vault' ? source : latest),
        ...patch,
        id,
        path: id,
        origin: 'local',
        sourceCardId: source.origin === 'vault' ? source.id : source.sourceCardId,
        createdAt: source.createdAt || now,
        updatedAt: now,
      };
      return [
        { type: 'card.upsert', card: updated },
        { type: 'card.save', id, saved: true },
        ...collectionIds
          .filter((key) => existing.collections.some((c) => c.id === key))
          .map((key) => ({ type: 'collection.toggleCard', id: key, cardId: id, selected: true })),
      ].reduce(workspaceReducer, existing);
    });
    notify(source.origin === 'vault' ? '结果已保存为本机副本，原文件保留' : '结果已保存到本机卡片');
  }

  async function persistAiResult(raw) {
    const entry = normalizeAiRecord(raw),
      key = aiResultKey(entry.id),
      originIdentity = identityId,
      volatileKey = `${identityId}:${entry.id}`;
    aiVolatile.current.set(volatileKey, entry);
    setAiRevision((value) => value + 1);
    // The request belongs to this session even if its dialog or workspace closes.
    // Each receipt is a separate atomic draft; another window cannot overwrite it
    // by saving an older snapshot of the full history.
    let next;
    try {
      next = await session.commit((existing) => {
        const prior = existing.drafts[key];
        const value = normalizeAiRecord({
          ...entry,
          createdAt: prior?.createdAt || entry.createdAt,
          savedCardId: prior?.savedCardId || entry.savedCardId,
          ...(prior?.phase === 'complete' && entry.phase !== 'complete' ? { phase: 'complete', result: prior.result, error: '' } : {}),
        });
        return workspaceReducer(existing, { type: 'draft.set', key, value });
      });
    } catch (issue) {
      if (loadedIdentity.current === originIdentity)
        setError('AI 结果暂未保存到磁盘，仍保留在此窗口。请重新打开 AI 解读并另存笔记或复制内容：' + issue.message);
      throw issue;
    }
    if (aiVolatile.current.get(volatileKey) === entry) aiVolatile.current.delete(volatileKey);
    if (loadedIdentity.current === originIdentity) {
      stateRef.current = next;
      draftRef.current = session.drafts();
      setState({ ...next, drafts: session.drafts() });
    }
  }

  function aiResultDrafts() {
    const drafts = { ...state.drafts };
    for (const [key, record] of aiVolatile.current) if (key === `${identityId}:${record.id}`) drafts[aiResultKey(record.id)] = record;
    return listAiRecords(drafts);
  }

  async function restoreAiSource(source) {
    const run = epoch.current,
      guard = () => {
        if (run !== epoch.current) throw Error('工作区已切换，未采用旧结果。结果草稿仍保留。');
      };
    const snapshot = await captureAiSource(source);
    guard();
    const local = stateRef.current.cards.find((card) => card.id === source.id),
      latest = local ? { ...local, caption: stateRef.current.annotations[source.id]?.note ?? local.caption } : cards.find((card) => card.id === source.id);
    if (!latest) throw Error('原素材已不存在。解读草稿仍保留，可另存文字笔记。');
    let attachment = latest.attachment;
    if (snapshot.attachmentMeta && latest.origin === 'vault' && latest.originalPath && api?.readAttachment) {
      attachment = valueOf(await api.readAttachment(latest.path));
      guard();
    }
    const current = await captureAiSource({ ...latest, ...(attachment ? { attachment } : {}) });
    guard();
    if (!isSameAiSourceVersion(snapshot, current)) throw Error('原素材或附件已变化，未采用旧结果。结果草稿仍保留，请核对原素材。');
    const { attachmentMeta, ...restored } = snapshot;
    return {
      ...restored,
      ...(attachment ? { attachment } : {}),
      ...(latest.documentIndex ? { documentIndex: latest.documentIndex } : {}),
      ...(latest.documentHighlights ? { documentHighlights: latest.documentHighlights } : {}),
    };
  }

  async function saveInsight(source, mode, result, record) {
    if (!record?.id) throw Error('解读记录尚未就绪，未重复创建笔记。');
    const entry = normalizeAiRecord(record);
    if (entry.mode !== mode) throw Error('解读方式已变化，请重新打开对应的结果草稿。');
    let cardId,
      created = false;
    await commit((existing) => {
      const saved = insightSaveActions(existing, entry, { now: new Date().toISOString() });
      cardId = saved.cardId;
      created = saved.created;
      return saved.actions.reduce(workspaceReducer, existing);
    });
    notify(created ? '解读已另存为笔记' : '已找到此前保存的解读笔记');
    return cardId;
  }
  return { saveEnrichment, persistAiResult, aiResultDrafts, restoreAiSource, saveInsight };
}
