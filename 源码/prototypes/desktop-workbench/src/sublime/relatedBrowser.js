import { localSearchThumbnail } from './localMaterialSearch.js';
import { articlePageUrl } from './articleReaderModel.js';
import { duplicateMaterialIds, readableMaterialText } from './intelligenceHelpers.js';

export const RELATED_PAGE_SIZE = 6;
export const RELATED_TYPES = [
  ['all', '全部类型'],
  ['image', '图片'],
  ['article', '文章'],
  ['highlight', '摘录'],
  ['text', '笔记'],
  ['link', '网页'],
  ['book', '图书'],
  ['file', '文件'],
  ['audio', '音频'],
  ['video', '视频'],
];
export const RELATED_SORTS = [
  ['relevance', '相关度'],
  ['updated-desc', '最近更新'],
  ['updated-asc', '最早更新'],
  ['created-desc', '最近创建'],
  ['created-asc', '最早创建'],
];
export const relatedTypeKey = (card) => (card.type === 'quote' ? 'highlight' : card.type === 'note' ? 'text' : card.type || 'text');
export function normalizeRelatedView(value = {}) {
  return {
    type: RELATED_TYPES.some(([key]) => key === value.type) ? value.type : 'all',
    scope: ['all', 'content', 'source'].includes(value.scope) ? value.scope : 'all',
    sort: RELATED_SORTS.some(([key]) => key === value.sort) ? value.sort : 'relevance',
    limit: Number.isSafeInteger(value.limit) && value.limit >= RELATED_PAGE_SIZE ? Math.min(value.limit, 2000) : RELATED_PAGE_SIZE,
    filtersOpen: !!value.filtersOpen,
  };
}
export function relatedSourceKey(card, byId) {
  const seen = new Set();
  while (card && !seen.has(card.id)) {
    seen.add(card.id);
    const page = articlePageUrl(card.sourceUrl);
    if (page) return 'page:' + page;
    if (card.sourceCardId) {
      const parent = byId.get(card.sourceCardId);
      if (parent) {
        card = parent;
        continue;
      }
      return 'card:' + card.sourceCardId;
    }
    return card.originalPath ? 'file:' + card.originalPath : 'card:' + card.id;
  }
  return 'card:' + [...seen].sort()[0];
}
// Only saved, visible library cards enter this read-only projection.
export function relatedResults(source, library, exact = [], semantic = [], view = {}) {
  const options = normalizeRelatedView(view),
    byId = new Map(library.map((card) => [card.id, card]));
  if (!byId.has(source.id)) return { items: [], total: 0, sourceCount: 0, allCount: 0 };
  const excluded = new Set([source.id, ...duplicateMaterialIds(library, source)]),
    rows = new Map();
  const sourceKey = relatedSourceKey(source, byId);
  for (const [values, isSemantic] of [
    [exact, false],
    [semantic, true],
  ])
    for (const item of values) {
      const card = byId.get(item.id);
      if (!card || excluded.has(item.id)) continue;
      const group = relatedSourceKey(card, byId),
        prior = rows.get(item.id);
      const score = isSemantic ? 75 + Math.max(0, Math.min(1, item.score || 0)) * 25 : Number(item.score) || 0;
      rows.set(item.id, {
        ...item,
        card,
        group,
        sameSource: group === sourceKey,
        semantic: isSemantic || !!prior?.semantic,
        score: Math.max(prior?.score || 0, score),
        reason: prior?.reason || item.reason,
      });
    }
  const ranked = [...rows.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const fingerprints = new Set(),
    allFingerprints = new Set();
  let allCount = 0;
  const typed = ranked.filter((row) => {
    const card = row.card,
      body = readableMaterialText(card.body, card.title);
    const fingerprint =
      body || card.ocrText || card.documentIndex?.text
        ? [card.title, body, readableMaterialText(card.ocrText, card.title), readableMaterialText(card.documentIndex?.text, card.title)].join('\n').trim()
        : '';
    if (!fingerprint || !allFingerprints.has(fingerprint)) {
      allCount++;
      if (fingerprint) allFingerprints.add(fingerprint);
    }
    if (options.type !== 'all' && relatedTypeKey(card) !== options.type) return false;
    if (!fingerprint) return true;
    if (fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint);
    return true;
  });
  const sourceCount = typed.filter((row) => row.sameSource).length;
  const selected = typed.filter((row) => options.scope === 'all' || (options.scope === 'source' ? row.sameSource : !row.sameSource));
  const seen = new Set(),
    diverse =
      options.scope === 'source'
        ? selected
        : selected.filter((row) => {
            if (seen.has(row.group)) return false;
            seen.add(row.group);
            return true;
          });
  const ordered = sortRelatedRows(diverse, options.sort);
  return { items: ordered.slice(0, options.limit), total: diverse.length, sourceCount, webSource: sourceKey.startsWith('page:'), allCount };
}
// Choose a source representative by relevance before applying date order.
// Invalid dates always follow dated cards, including ascending order.
export function sortRelatedRows(rows, sort = 'relevance') {
  const tie = (a, b) => b.score - a.score || a.id.localeCompare(b.id);
  if (sort === 'relevance') return [...rows].sort(tie);
  const [field, direction] = sort.split('-'),
    key = field === 'updated' ? 'updatedAt' : 'createdAt';
  const timestamp = (row) => {
    const raw = row.card[key] || (key === 'updatedAt' ? row.card.createdAt : '');
    const n = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  return [...rows].sort((a, b) => {
    const at = timestamp(a),
      bt = timestamp(b);
    if (at === null || bt === null) return at === bt ? tie(a, b) : at === null ? 1 : -1;
    return (at - bt) * (direction === 'asc' ? 1 : -1) || tie(a, b);
  });
}
export function relatedCardPreview(card) {
  const image = localSearchThumbnail(card);
  // A highlight's title often repeats its entire quotation. Its preview must
  // preserve that quotation, including literal markup, as React text.
  const quote = card.type === 'highlight' && (String(card.body || '').trim() || String(card.webAnchor?.exact || '').trim());
  const text =
    quote || [card.body, card.caption, card.ocrText, card.documentIndex?.text].map((value) => readableMaterialText(value, card.title)).find(Boolean) || '';
  let origin = card.sourceTitle || card.author || '';
  if (!origin && card.sourceUrl)
    try {
      origin = new URL(card.sourceUrl).hostname;
    } catch {}
  return { image, text: Array.from(text).slice(0, 1600).join(''), origin: origin || (card.origin === 'vault' ? '本机资料' : '我的资料库') };
}
