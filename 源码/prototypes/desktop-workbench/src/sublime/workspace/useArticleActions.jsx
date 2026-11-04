import React from 'react';
import { workspaceReducer } from '.././workspaceModel.js';
import { valueOf } from '../../desktopModel.js';
import { createClipperLibrary } from '.././clipperLibrary.js';
import { saveArticleFigure } from '.././articleFigures.js';
import { captureAiSource } from '.././intelligenceDrafts.js';
import { uid } from './constants.js';

export function useArticleActions({
  documentJobs,
  identityId,
  documentWaiters,
  epoch,
  viewRef,
  viewVersion,
  commit,
  navigate,
  notify,
  setError,
  loadedIdentity,
  session,
  api,
}) {
  function saveDocumentExcerpt(source, value) {
    const job = saveDocumentExcerptTask(source, value);
    documentJobs.current.set(job, identityId);
    for (const waiter of documentWaiters.current) if (waiter.identity === undefined || waiter.identity === identityId) waiter.jobs.add(job);
    void job.finally(() => documentJobs.current.delete(job)).catch(() => {});
    return job;
  }

  async function saveDocumentExcerptTask(source, value) {
    const run = epoch.current,
      originRoute = viewRef.current.route,
      view = viewVersion.current;
    try {
      // Keep only the digest alongside the quotation, never a second source file.
      const captured = await captureAiSource(source);
      if (run !== epoch.current) throw Error('资料库已切换，摘录未保存至新资料库。');
      if (!captured.attachmentMeta?.sha256) throw Error('来源文件无法核验，摘录尚未保存，请先复制选文保留。');
      const id = uid(),
        now = new Date().toISOString(),
        card = {
          id,
          path: id,
          title: value.text.trim().slice(0, 90),
          body: value.text,
          type: 'highlight',
          origin: 'local',
          sourceCardId: source.id,
          sourceAttachmentSha256: captured.attachmentMeta.sha256,
          sourceTitle: source.sourceTitle || source.title,
          sourceUrl: source.sourceUrl || '',
          author: source.author || '',
          page: value.page || '',
          sourceLocation: source.attachment.name,
          createdAt: now,
          updatedAt: now,
          tags: source.tags || [],
        };
      await commit([
        { type: 'card.upsert', card },
        { type: 'card.save', id, saved: true },
      ]);
      if (view === viewVersion.current && viewRef.current.route === originRoute) navigate('card', id);
      notify('摘录已保存，来源文件版本和页码已保留');
    } catch (issue) {
      if (run === epoch.current) setError('摘录尚未保存，请先复制选文保留：' + (issue.message || '保存失败。'));
      throw issue;
    }
  }

  function saveArticleDraft(source, value) {
    const workspaceId = identityId,
      key = 'article-highlight-draft:' + source.id;
    return commit((existing) => {
      if (loadedIdentity.current !== workspaceId) throw Error('资料库已切换，高亮草稿未写入其他资料库。');
      return workspaceReducer(existing, { type: 'draft.set', key, value });
    });
  }

  function saveArticleHighlight(source, value) {
    const origin = epoch.current,
      workspaceId = identityId;
    const library = createClipperLibrary({ session, workspaceId, isCurrent: () => origin === epoch.current && loadedIdentity.current === workspaceId });
    const job = (async () => {
      const result = await library.call('capture', {
        version: 1,
        requestId: value.operationId || uid(),
        kind: 'highlight',
        sourceUrl: source.sourceUrl,
        title: Array.from(value.text.trim()).slice(0, 80).join(''),
        body: value.text,
        anchor: value.anchor,
        ...(source.origin === 'local' ? { sourceCardId: source.id } : {}),
        note: value.note || '',
        favorite: !!value.favorite,
      });
      await commit((existing) => {
        if (origin !== epoch.current || loadedIdentity.current !== workspaceId) throw Error('高亮已保存到原资料库，草稿请回原资料库核对。');
        const key = 'article-highlight-draft:' + source.id;
        return existing.drafts[key]?.operationId === value.operationId ? workspaceReducer(existing, { type: 'draft.set', key, value: null }) : existing;
      });
      return result;
    })();
    documentJobs.current.set(job, workspaceId);
    for (const waiter of documentWaiters.current) if (waiter.identity === undefined || waiter.identity === workspaceId) waiter.jobs.add(job);
    void job
      .then(() => {
        if (origin === epoch.current) notify('高亮与备注已保存到资料库');
      })
      .catch(() => {})
      .finally(() => documentJobs.current.delete(job));
    return job;
  }

  function collectArticleFigure(source, block) {
    const origin = epoch.current,
      workspaceId = identityId;
    const job = saveArticleFigure({
      session,
      source,
      block,
      newId: uid,
      now: () => new Date().toISOString(),
      isCurrent: () => origin === epoch.current && loadedIdentity.current === workspaceId,
      fetchImage: api?.captureArticleImage ? (url) => api.captureArticleImage(url).then(valueOf) : null,
    });
    documentJobs.current.set(job, workspaceId);
    for (const waiter of documentWaiters.current) if (waiter.identity === undefined || waiter.identity === workspaceId) waiter.jobs.add(job);
    void job
      .then(() => {
        if (origin === epoch.current) notify('配图已收藏，出处已保留');
      })
      .catch(() => {})
      .finally(() => documentJobs.current.delete(job));
    return job;
  }
  return { saveDocumentExcerpt, saveDocumentExcerptTask, saveArticleDraft, saveArticleHighlight, collectArticleFigure };
}
