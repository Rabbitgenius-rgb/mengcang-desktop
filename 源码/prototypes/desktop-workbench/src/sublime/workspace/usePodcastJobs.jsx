import { sameAttachmentContent } from '../attachmentRegistry.js';
import React from 'react';
import { workspaceReducer } from '.././workspaceModel.js';
import { inlineWorkspaceAttachment } from '.././attachmentStore.js';
import { valueOf } from '../../desktopModel.js';
import {
  podcastTranscriptionKey,
  samePodcastDraft,
  normalizePodcastTranscription,
  listPodcastTranscriptions,
  beginPodcastTranscriptionActions,
  finishPodcastTranscriptionActions,
  recoverPodcastTranscriptionActions,
} from '.././podcastTranscription.js';
import { captureAiSource } from '.././intelligenceDrafts.js';
import { uid } from './constants.js';

export function usePodcastJobs({
  epoch,
  commit,
  navigate,
  notify,
  state,
  podcastVolatile,
  identityId,
  setAiRevision,
  session,
  loadedIdentity,
  stateRef,
  draftRef,
  setState,
  podcastJobs,
  podcastRequests,
  api,
  setError,
}) {
  async function savePodcast(value, context = {}) {
    const run = epoch.current,
      guard = () => {
        if (run !== epoch.current) throw Error('资料库已切换，片段草稿未覆盖。');
      };
    const attachment = value.attachment || context.attachment;
    if (!attachment) throw Error('原音频不可用，请核对来源后再保存；当前草稿已保留。');
    const snapshot = { ...attachment },
      source = await captureAiSource({ id: value.sourceCardId || 'podcast-local-file', type: 'audio', attachment: snapshot });
    guard();
    if (!value.sourceAudioSha256 || source.attachmentMeta?.sha256 !== value.sourceAudioSha256) throw Error('音频版本未核验或已变化，请重新核对后保存。');
    const now = new Date().toISOString(),
      id = uid(),
      card = { ...value, id, path: id, origin: 'local', createdAt: now, updatedAt: now };
    let preservedNewDraft = false;
    await commit((existing) => {
      guard();
      const latest = value.sourceCardId ? existing.cards.find((item) => item.id === value.sourceCardId)?.attachment : value.attachment;
      if (!latest || !sameAttachmentContent(latest, snapshot)) throw Error('原音频在保存期间变化，片段未保存；字幕、备注和时间标记已保留。');
      preservedNewDraft = !!existing.drafts.podcastClip && !samePodcastDraft(existing.drafts.podcastClip, context.formSnapshot);
      return [
        { type: 'card.upsert', card },
        { type: 'card.save', id, saved: true },
        ...(!preservedNewDraft ? [{ type: 'draft.set', key: 'podcastClip', value: null }] : []),
      ].reduce(workspaceReducer, existing);
    });
    guard();
    if (!preservedNewDraft) navigate('card', id);
    notify(preservedNewDraft ? '片段已保存，较新的播客草稿已保留' : '播客片段已保存');
  }

  function podcastResultDrafts() {
    const drafts = { ...state.drafts };
    for (const [key, record] of podcastVolatile.current) if (key === `${identityId}:${record.id}`) drafts[podcastTranscriptionKey(record.id)] = record;
    return listPodcastTranscriptions(drafts);
  }

  function podcastResultIsDurable(record) {
    try {
      return (
        JSON.stringify(normalizePodcastTranscription(state.drafts[podcastTranscriptionKey(record.id)])) ===
        JSON.stringify(normalizePodcastTranscription(record))
      );
    } catch {
      return false;
    }
  }

  function clearPersistedPodcastResult(key, record) {
    const volatile = podcastVolatile.current.get(key);
    if (volatile && JSON.stringify(normalizePodcastTranscription(volatile)) === JSON.stringify(normalizePodcastTranscription(record)))
      podcastVolatile.current.delete(key);
    setAiRevision((value) => value + 1);
  }

  async function persistPodcastTranscript(raw) {
    const record = normalizePodcastTranscription(raw),
      originIdentity = identityId,
      originSession = session,
      key = `${originIdentity}:${record.id}`;
    const next = await originSession.commit((existing) =>
      workspaceReducer(existing, { type: 'draft.set', key: podcastTranscriptionKey(record.id), value: record }),
    );
    clearPersistedPodcastResult(key, record);
    if (loadedIdentity.current === originIdentity) {
      stateRef.current = next;
      draftRef.current = originSession.drafts();
      setState({ ...next, drafts: originSession.drafts() });
      notify('转录结果草稿已保存到本机');
    }
  }

  function transcribePodcast(attachment, context = {}) {
    const job = transcribePodcastTask(attachment, context);
    podcastJobs.current.add(job);
    void job.finally(() => podcastJobs.current.delete(job)).catch(() => {});
    return job;
  }

  async function transcribePodcastTask(attachment, context = {}) {
    const originIdentity = identityId,
      originSession = session,
      id = context.requestId || uid(),
      key = `${identityId}:${id}`,
      now = new Date().toISOString(),
      snapshot = JSON.parse(JSON.stringify(context.formSnapshot || {}));
    if ([...podcastRequests.current].some((value) => value.startsWith(originIdentity + ':'))) throw Error('这份资料库已有转录任务正在处理，请等待完成后再试。');
    podcastRequests.current.add(key);
    setAiRevision((value) => value + 1);
    let record;
    try {
      const sourceSnapshot = await captureAiSource({
        id: snapshot.sourceId || 'podcast-local-file',
        type: 'audio',
        title: attachment?.name || '本机音频',
        origin: 'local',
        attachment,
      });
      record = normalizePodcastTranscription({
        id,
        provider: context.provider || 'local',
        phase: 'pending',
        sourceId: snapshot.sourceId || '',
        sourceSnapshot,
        createdAt: now,
        updatedAt: now,
        baseTranscript: snapshot.transcript || '',
        baseTranscriptName: snapshot.transcriptName || '',
      });
      await originSession.commit((existing) => {
        const currentAttachment = snapshot.attachment || existing.cards.find((card) => card.id === snapshot.sourceId)?.attachment;
        if (!currentAttachment || !sameAttachmentContent(currentAttachment, attachment)) throw Error('原音频已在其他窗口变化，请重新选择后转录。');
        return beginPodcastTranscriptionActions(existing, record, snapshot).reduce(workspaceReducer, existing);
      });
    } catch (issue) {
      podcastRequests.current.delete(key);
      setAiRevision((value) => value + 1);
      throw issue;
    }
    let response, finalRecord;
    try {
      response = valueOf(await api.intelligenceRequest({ action: 'transcribe', attachment: await inlineWorkspaceAttachment(attachment) }));
      if (response?.cancelled) throw Error('本次转录已取消，未自动重试');
      finalRecord = normalizePodcastTranscription({
        ...record,
        phase: 'complete',
        transcript: response.text,
        engine: response.engine,
        updatedAt: new Date().toISOString(),
      });
    } catch (issue) {
      finalRecord = normalizePodcastTranscription({
        ...record,
        phase: 'failed',
        error: issue.code === 'AI_CONFIRMATION_REQUIRED' ? '本次转录已取消，未自动重试' : issue.message || '本次转录未完成，未自动重试',
        updatedAt: new Date().toISOString(),
      });
    }
    let applied = false,
      restoredDraft;
    podcastVolatile.current.set(key, finalRecord);
    setAiRevision((value) => value + 1);
    try {
      const observed = await originSession.settled(),
        currentDraft = observed.drafts.podcastClip,
        currentAttachment = currentDraft?.attachment || observed.cards.find((card) => card.id === currentDraft?.sourceId)?.attachment;
      let matchesOriginal = false;
      if (finalRecord.phase === 'complete' && currentAttachment) {
        try {
          const currentSource = await captureAiSource({
            id: currentDraft.sourceId || 'podcast-local-file',
            type: 'audio',
            title: currentAttachment.name,
            origin: 'local',
            attachment: currentAttachment,
          });
          matchesOriginal = currentSource.attachmentMeta?.sha256 === finalRecord.sourceSnapshot.attachmentMeta?.sha256;
        } catch {
          /* A replaced or unreadable audio file cannot receive old subtitles. */
        }
      }
      const next = await originSession.commit((existing) => {
        const latestDraft = existing.drafts.podcastClip,
          latestAttachment = latestDraft?.attachment || existing.cards.find((card) => card.id === latestDraft?.sourceId)?.attachment;
        const stable = matchesOriginal && sameAttachmentContent(latestAttachment, currentAttachment);
        const completed = finishPodcastTranscriptionActions(existing, finalRecord, { allowApply: stable });
        applied = completed.applied;
        restoredDraft = completed.draft;
        return completed.actions.reduce(workspaceReducer, existing);
      });
      podcastVolatile.current.delete(key);
      if (loadedIdentity.current === originIdentity) {
        stateRef.current = next;
        draftRef.current = originSession.drafts();
        setState({ ...next, drafts: originSession.drafts() });
        if (finalRecord.phase === 'complete') notify(applied ? '转录字幕已保存在播客草稿' : '转录结果已保留，当前草稿未覆盖');
      }
    } catch (issue) {
      if (loadedIdentity.current === originIdentity) setError('转录结果尚未写入磁盘，仍保留在此窗口的播客结果草稿中，请复制字幕后重试保存：' + issue.message);
      throw issue;
    } finally {
      podcastRequests.current.delete(key);
      setAiRevision((value) => value + 1);
    }
    if (finalRecord.phase === 'failed') throw Error(finalRecord.error);
    return { ...response, draftApplied: applied, draft: restoredDraft };
  }

  async function recoverPodcastTranscript(record, context) {
    const run = epoch.current,
      guard = () => {
        if (run !== epoch.current) throw Error('资料库已切换，未覆盖新的播客草稿。');
      };
    const source = await captureAiSource({
      id: context.formSnapshot?.sourceId || 'podcast-local-file',
      type: 'audio',
      title: context.attachment?.name || '本机音频',
      origin: 'local',
      attachment: context.attachment,
    });
    guard();
    if (!source.attachmentMeta?.sha256 || source.attachmentMeta.sha256 !== record.sourceSnapshot?.attachmentMeta?.sha256)
      throw Error('当前音频与这份转录结果的原文件不一致，未覆盖字幕。');
    let restored;
    const volatileKey = `${identityId}:${record.id}`;
    await commit((existing) => {
      guard();
      const currentAttachment = context.formSnapshot?.attachment || existing.cards.find((card) => card.id === context.formSnapshot?.sourceId)?.attachment;
      if (!sameAttachmentContent(currentAttachment, context.attachment)) throw Error('原音频在核对期间发生变化，未覆盖字幕。');
      const result = recoverPodcastTranscriptionActions(existing, record, context.formSnapshot);
      restored = result.draft;
      return result.actions.reduce(workspaceReducer, existing);
    });
    clearPersistedPodcastResult(volatileKey, record);
    return restored;
  }
  return {
    savePodcast,
    podcastResultDrafts,
    podcastResultIsDurable,
    clearPersistedPodcastResult,
    persistPodcastTranscript,
    transcribePodcast,
    transcribePodcastTask,
    recoverPodcastTranscript,
  };
}
