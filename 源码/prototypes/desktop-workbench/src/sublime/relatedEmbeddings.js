import { readableMaterialText } from './intelligenceHelpers.js';

// Derived only for recommendations: imported bookkeeping is not subject matter.
export function relatedSemanticText(card) {
  const clean = (value) => {
    let skip = false;
    const lines = [];
    for (const line of String(value || '').split('\n')) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) skip = /^(?:整理说明|整理状态|相关素材|原始出处|出处|原始截图|原始附件|收录授权原话)$/.test(heading[1]);
      if (!skip) lines.push(line);
    }
    return readableMaterialText(lines.join('\n'), card.title)
      .replace(/^(?:灵感内容|资料|原始记录.*|原始备忘录.*)$/gm, '')
      .trim();
  };
  const title = /^(?:img|image|dsc|pxl|screenshot)[ _-]*\d+[\w .-]*$/i.test(card.title || '') ? '' : card.title;
  return [...new Set([title, clean(card.body), clean(card.caption), clean(card.ocrText), clean(card.documentIndex?.text)].filter(Boolean))]
    .join('\n\n')
    .slice(0, 20000);
}

// Native sentence embeddings share a strong background direction. Remove that
// direction within each language/model before treating them as related content.
// Never mutate cached vectors or compare incompatible models.
export function centeredRelatedEmbeddings(vectors) {
  const groups = new Map();
  for (const item of vectors) {
    const key = JSON.stringify([item.model, item.language, item.vector?.length]);
    if (!groups.has(key)) groups.set(key, []);
    const norm = Math.hypot(...item.vector);
    if (norm) groups.get(key).push({ ...item, vector: item.vector.map((x) => x / norm) });
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length < 4) return group;
    const mean = group[0].vector.map((_, i) => group.reduce((sum, item) => sum + item.vector[i], 0) / group.length);
    return group.map((item) => {
      const vector = item.vector.map((x, i) => x - mean[i]);
      return { ...item, vector: Math.hypot(...vector) < 1e-10 ? vector.map(() => 0) : vector };
    });
  });
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const generic = new Set(
  'the and for with from this that have your you how are our 一个 这个 那个 我们 他们 可以 关于 以及 文章 网页 图片 笔记 资料 来源 配图 收藏 本机 灵感 内容 原始 整理 相关 素材 标题 保留 使用 需要 进行 时候 通过 其中 这些 一种 自己 不同 没有 什么 就是 因为 所以 然后 这样 现在 如果 应该 可能 什么 还是 一些 这里 这个 那个 他们 它们 作为 一个 但是 非常 已经 时候 其实 还有 之后 之前 一起 发现'.split(
    ' ',
  ),
);
// A passive recommendation needs a concrete content connection as well as a
// native score. This prevents the model's broad similarity from filling a feed.
export function supportedRelatedIds(candidates, sourceId) {
  const terms = (text) => {
    const found = [...segmenter.segment(text)].filter((x) => x.isWordLike && x.segment.length > 1).map((x) => x.segment.toLowerCase());
    // ICU versions can split names such as 万维网 into single characters.
    for (const phrase of text.match(/[\p{Script=Han}]+/gu) || [])
      for (const part of phrase.split(/[的了地得是在和与以我你他它这那有就为也都于到而或并从]/))
        for (let i = 0; i + 3 <= part.length; i++) found.push(part.slice(i, i + 3));
    return new Set(found.filter((x) => !generic.has(x) && !/^\d+$/.test(x)));
  };
  const rows = candidates.map((x) => ({ ...x, terms: terms(x.text) })),
    counts = new Map();
  for (const row of rows) for (const term of row.terms) counts.set(term, (counts.get(term) || 0) + 1);
  const source = rows.find((x) => x.id === sourceId);
  if (!source) return new Set();
  const significant = [...source.terms].filter((term) => counts.get(term) <= Math.max(2, rows.length * 0.15));
  return new Set(rows.filter((row) => row.id !== sourceId && significant.some((term) => row.terms.has(term))).map((row) => row.id));
}
