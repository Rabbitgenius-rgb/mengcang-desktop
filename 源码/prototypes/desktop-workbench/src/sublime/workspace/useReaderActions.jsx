import React from 'react';
import { workspaceReducer } from '.././workspaceModel.js';
import { normalizeReaderLocator, readerReducer, readerStateKey } from '../../reader/readerState.js';
import { captureAiSource } from '.././intelligenceDrafts.js';
import { uid } from './constants.js';

export function useReaderActions({
  current,
  epoch,
  commit,
  notify,
  viewRef,
  sourceOpen,
  viewVersion,
  stateRef,
  cards,
  setError,
  libraryCards,
  setArticleNavigation,
  navigate,
  setReaderNavigation,
  setCheckingSource,
}) {
  async function updateReader(source, action) {
    const sourceCard = current,
      origin = epoch.current,
      key = readerStateKey(sourceCard.id, source.sourceKey);
    let adopted;
    await commit((existing) => {
      if (origin !== epoch.current) throw Error('资料库已切换，阅读记录未写入其他资料库');
      adopted = readerReducer(existing.drafts[key], action);
      return workspaceReducer(existing, { type: 'draft.set', key, value: adopted });
    });
    return adopted;
  }

  async function saveReaderExcerpt(value) {
    const source = current,
      operationId = value.operationId || uid(),
      now = new Date().toISOString(),
      locator = normalizeReaderLocator(value.locator),
      origin = epoch.current;
    if (!/^[a-z0-9-]{1,128}$/i.test(operationId)) throw Error('摘录保存标识无效，请保留选文重试。');
    const id = 'reader-excerpt-' + operationId,
      note = String(value.note || ''),
      reference = { cardId: source.id, sourceKey: value.sourceKey, format: value.format, locator };
    const card = {
      id,
      path: id,
      title: value.text.trim().slice(0, 90),
      body: value.text,
      caption: note,
      type: 'highlight',
      origin: 'local',
      sourceCardId: source.id,
      sourceTitle: source.title,
      sourceUrl: source.sourceUrl || '',
      author: source.author || '',
      page: value.format === 'pdf' ? locator.page : '',
      sourceLocation: [value.sourceName, value.label].filter(Boolean).join(' · '),
      createdAt: now,
      updatedAt: now,
      tags: source.tags || [],
    };
    await commit((existing) => {
      if (origin !== epoch.current) throw Error('资料库已切换，摘录仍保留在原窗口。');
      const prior = existing.cards.find((item) => item.id === id),
        pointer = existing.drafts['reader-excerpt:' + id];
      if (prior) {
        if (prior.body !== card.body || prior.caption !== card.caption || JSON.stringify(pointer) !== JSON.stringify(reference))
          throw Error('这次摘录的已保存内容发生变化，未覆盖已有卡片，请导出选文保留。');
        return existing;
      }
      return [
        { type: 'card.upsert', card },
        { type: 'card.save', id, saved: true },
        { type: 'draft.set', key: 'reader-excerpt:' + id, value: reference },
      ].reduce(workspaceReducer, existing);
    });
    notify('书中摘录已保存到资料库');
  }

  async function openCardSource(excerpt) {
    const run = epoch.current,
      originRoute = viewRef.current.route,
      attempt = ++sourceOpen.current,
      view = viewVersion.current;
    const current = () => run === epoch.current && attempt === sourceOpen.current && view === viewVersion.current && viewRef.current.route === originRoute;
    const source = stateRef.current.cards.find((card) => card.id === excerpt.sourceCardId) || cards.find((card) => card.id === excerpt.sourceCardId);
    if (!source) {
      if (current()) setError('来源卡片已不存在，摘录文字仍保留。');
      return;
    }
    if (excerpt.articleFigure) {
      if (!libraryCards.some((c) => c.id === source.id)) return;
      const block = source.article?.blocks.find(
        (b) => b.type === 'image' && b.id === excerpt.articleFigure.blockId && b.src === excerpt.articleFigure.imageUrl,
      );
      if (!block || source.sourceUrl !== excerpt.sourceUrl) {
        setError('来源文章的配图位置或网址已变化，请使用卡片保留的原始链接。');
        return;
      }
      setArticleNavigation({ sourceId: source.id, figure: block.id, key: uid() });
      navigate('card', source.id);
      return;
    }
    if (excerpt.webAnchor) {
      if (source.type !== 'article') {
        setError('来源卡片已不是文章，请从原网页核对这段高亮。');
        return;
      }
      setArticleNavigation({ sourceId: source.id, anchor: excerpt.webAnchor, key: uid() });
      navigate('card', source.id);
      return;
    }
    const readerSource = stateRef.current.drafts['reader-excerpt:' + excerpt.id];
    if (readerSource && readerSource.cardId === source.id && typeof readerSource.sourceKey === 'string') {
      setReaderNavigation({ sourceId: source.id, sourceKey: readerSource.sourceKey, locator: normalizeReaderLocator(readerSource.locator) });
      navigate('reader', source.id);
      return;
    }
    // Historical excerpts have no trustworthy version to reconstruct. Keep their
    // manual navigation, accompanied by the explicit unverified-version notice.
    if (!excerpt.sourceAttachmentSha256) {
      navigate('card', source.id, excerpt.page);
      return;
    }
    setCheckingSource(excerpt.id);
    try {
      const attachment = source.attachment;
      if (!attachment) throw Error('来源附件已移除或无法核验，未跳转；摘录文字仍保留。');
      const captured = await captureAiSource(source);
      if (!current()) return;
      const latest = stateRef.current.cards.find((card) => card.id === source.id);
      if (!latest || latest.attachment?.dataUrl !== attachment.dataUrl || captured.attachmentMeta?.sha256 !== excerpt.sourceAttachmentSha256)
        throw Error('来源附件版本已变化，未打开新文件的旧页码；摘录文字与原文件名仍保留。');
      navigate('card', source.id, excerpt.page);
    } catch (issue) {
      if (current()) setError(issue.message || '来源文件核验失败，摘录文字仍保留。');
    } finally {
      if (run === epoch.current && attempt === sourceOpen.current) setCheckingSource('');
    }
  }
  return { updateReader, saveReaderExcerpt, openCardSource };
}
