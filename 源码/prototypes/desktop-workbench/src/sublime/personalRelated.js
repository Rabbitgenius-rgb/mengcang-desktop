import { articlePageUrl } from './articleReaderModel.js';
import { duplicateMaterialIds, rankEmbeddings, semanticMaterialText } from './intelligenceHelpers.js';
import { relatedSemanticText, centeredRelatedEmbeddings, supportedRelatedIds } from './relatedEmbeddings.js';

const commonGroups = new Set(['browser-clips-v1', 'harness-recall-v1']);
const words = new Intl.Segmenter('zh', { granularity: 'word' });
const stop = new Set(
  'the and for with from this that have your you how are our 一个 这个 那个 我们 他们 可以 关于 以及 文章 网页 图片 笔记 资料 来源 配图 收藏 本机'.split(' '),
);
const terms = (text) =>
  new Set(
    Array.from(words.segment(String(text || '').slice(0, 320)))
      .filter((s) => s.isWordLike && s.segment.length > 1)
      .map((s) => s.segment.toLowerCase())
      .filter((x) => !stop.has(x) && !/^[\d_]+$/.test(x)),
  );
const normTag = (s) => String(s).trim().toLocaleLowerCase();
const typeLabel = {
  article: '文章',
  image: '图片',
  highlight: '摘录',
  text: '笔记',
  quote: '摘录',
  book: '图书',
  video: '视频',
  audio: '音频',
  file: '文件',
  link: '网页',
};
export const relatedType = (card) => typeLabel[card.type] || '资料';

// Only accepts the visible, saved library projection; no public feed, drafts,
// collection writes or document reads. Each deterministic match has a reason.
export function personalRelations(source, library, collections) {
  const sourcePage = articlePageUrl(source.sourceUrl),
    sourceTags = new Set((source.tags || []).map(normTag));
  const groups = collections.filter((g) => !commonGroups.has(g.id) && g.cardIds.includes(source.id)).map((g) => ({ title: g.title, ids: new Set(g.cardIds) }));
  const excluded = new Set([source.id, ...duplicateMaterialIds(library, source)]);
  const referenceTerms = terms(source.title),
    counts = new Map();
  const candidates = library
    .filter((c) => c.id !== source.id)
    .map((card) => {
      const shared = [...terms(card.title)].filter((x) => referenceTerms.has(x));
      for (const term of shared) counts.set(term, (counts.get(term) || 0) + 1);
      return { card, shared };
    });
  const rows = [];
  for (const { card, shared } of candidates) {
    let score = 0,
      reason = '';
    if (card.id === source.sourceCardId) {
      score = 110;
      reason = source.articleFigure ? '这张配图的来源文章' : '这张卡片的来源';
    } else if (card.sourceCardId === source.id) {
      score = card.articleFigure ? 105 : 101;
      reason = card.articleFigure ? '从本文收藏的配图' : card.type === 'highlight' ? '从本文摘出的文字' : '取自当前资料';
    } else if (excluded.has(card.id)) continue;
    else if (source.sourceCardId && source.sourceCardId === card.sourceCardId) {
      score = 90;
      reason = '出自同一份资料';
    } else if (sourcePage && articlePageUrl(card.sourceUrl) === sourcePage) {
      score = 80;
      reason = '来自同一网页';
    } else {
      const tag = (card.tags || []).find((t) => sourceTags.has(normTag(t))),
        group = groups.find((g) => g.ids.has(card.id));
      const significant = shared.filter((x) => counts.get(x) <= Math.max(2, library.length * 0.15)).sort((a, b) => counts.get(a) - counts.get(b));
      if (tag) {
        score = 65 + (group ? 2 : 0);
        reason = '共同标签 · ' + tag;
      } else if (group) {
        score = 55;
        reason = '同在收藏集 · ' + group.title;
      } else if (significant.length) {
        score = 35 + Math.min(significant.length, 4);
        reason = '标题都提到「' + significant[0] + '」';
      }
    }
    if (score) rows.push({ id: card.id, reason, score });
  }
  return rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// Session-only, content-keyed cache supplied by this workspace. The only
// operation passed here is the desktop's native embed action; no cloud fallback.
export async function nativeRelated(source, library, cache, embed, active, { limit = 8, distinctive = false } = {}) {
  if (!library.some((c) => c.id === source.id) || library.length > 2000) return [];
  const candidates = library
    .map((card) => ({ id: card.id, text: distinctive ? relatedSemanticText(card) : semanticMaterialText(card) }))
    .filter((x) => x.text.trim() && x.id.length <= 2048);
  const valid = new Set(candidates.map((x) => x.id));
  for (const id of cache.keys()) if (!valid.has(id)) cache.delete(id);
  const missing = candidates.filter((x) => cache.get(x.id)?.text !== x.text);
  for (let i = 0; i < missing.length; i += 64) {
    if (!active()) return [];
    const batch = missing.slice(i, i + 64),
      result = await embed(batch);
    const byId = new Map(result.embeddings.map((item) => [item.id, item]));
    for (const x of batch) cache.set(x.id, { text: x.text, embedding: byId.get(x.id) || null });
  }
  if (!active()) return [];
  const vectors = candidates
    .map((x) => cache.get(x.id))
    .filter(Boolean)
    .map((x) => x.embedding)
    .filter(Boolean);
  const supported = distinctive ? supportedRelatedIds(candidates, source.id) : null;
  return rankEmbeddings(distinctive ? centeredRelatedEmbeddings(vectors) : vectors, source.id, { limit, exclude: duplicateMaterialIds(library, source) })
    .filter((x) => x.score >= 0.55 && (!supported || supported.has(x.id)))
    .map((x) => ({ id: x.id, score: x.score, reason: distinctive ? '内容相关 · 本机匹配' : '文字意思相近 · 本机匹配' }));
}
