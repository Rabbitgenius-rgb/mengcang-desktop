import { noteLinks } from './workspaceView.js';
export const INSIGHT_LABELS = {
  'The Gist': '核心概述',
  'Explain Like I’m 5': '通俗解释',
  'Contrarian Take': '反向观点',
  Analogy: '类比说明',
  'Hot Take': '鲜明观点',
  'Image description': '图片内容描述',
  'Visual analysis': '构图与配色',
};
export const IMAGE_INSIGHT_MODES = Object.freeze(['Image description', 'Visual analysis']);
export const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;
const VISION_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export function isImageReference(card) {
  return card?.type === 'image' || /^image\//i.test(card?.attachment?.type || '') || (card?.origin === 'vault' && /^image\//i.test(card?.originalMime || ''));
}
export function visionImagePayload(attachment) {
  if (!attachment || typeof attachment !== 'object') throw Error('请先导入图片原文件，再使用图片解读。');
  const { name, type, size, dataUrl } = attachment;
  if (typeof name !== 'string' || !name.trim() || name.length > 1000 || /[\x00-\x1f\x7f]/.test(name)) throw Error('图片文件名称无效，请重新导入原文件。');
  if (!VISION_IMAGE_TYPES.has(type) || /\.(?:svg|html?|xml|[cm]?js|exe|app|sh|command)$/i.test(name.trim()))
    throw Error('图片解读只支持 JPEG、PNG、GIF、WebP 原文件，请先转换或导入支持的格式。');
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_VISION_IMAGE_BYTES / 3) * 4 + 100)
    throw Error('图片解读单张上限为 8 MiB，请选择较小的原文件。');
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || !match[2] || match[2].length % 4 || match[1] !== type) throw Error('请使用本机图片原文件；远程图片地址、缩略图和格式不匹配的数据不会发送。');
  const base64 = match[2],
    bytes = (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (!Number.isSafeInteger(size) || size !== bytes || bytes < 1 || bytes > MAX_VISION_IMAGE_BYTES)
    throw Error('图片大小与原文件不一致，或超过 8 MiB，请重新导入。');
  let header;
  try {
    header = atob(base64.slice(0, 88));
  } catch {
    throw Error('图片数据格式无效，请重新导入原文件。');
  }
  const signature =
    type === 'image/png'
      ? header.startsWith('\x89PNG\r\n\x1a\n')
      : type === 'image/jpeg'
        ? header.startsWith('\xFF\xD8\xFF')
        : type === 'image/gif'
          ? /^GIF8[79]a/.test(header)
          : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  if (!signature) throw Error('图片内容与文件类型不一致，请重新导入原文件。');
  return { name, type, size, dataUrl };
}
export function sameImageReference(a, b) {
  return (
    !!a &&
    !!b &&
    ['id', 'path', 'origin', 'updatedAt', 'originalPath', 'originalMime', 'type'].every((key) => a[key] === b[key]) &&
    ['name', 'type', 'size', 'dataUrl'].every((key) => a.attachment?.[key] === b.attachment?.[key])
  );
}
export function formatImageBytes(size) {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(2)} MiB`;
}
export function intelligenceText(card) {
  return [card?.title, card?.body, card?.ocrText, card?.documentIndex?.text].filter(Boolean).join('\n\n').slice(0, 20000);
}
// Dates describe the archived material, never proof of its present-day status.
const sourceDate = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[^\r\n]{1,80})?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
export function insightRecordScope(card) {
  const dates = [
    ['收录时间', card?.capturedAt],
    ['创建时间', card?.createdAt],
    ['修改时间', card?.updatedAt],
    ['资料标注日期', card?.date],
  ];
  const parts = dates.map(([label, value]) => (sourceDate(value) ? `${label}：${value}` : '')).filter(Boolean);
  return `${parts.length ? parts.join('；') : '记录日期未提供'}。状态表述仅指这份材料的记载，最新进展未核实。`;
}
export function insightText(card) {
  const context = `材料记录信息（这些日期不是事件发生时间）：${insightRecordScope(card)}\n材料中的“当前”“本次”“仍为”以记录语境解释；请写“材料记录时”或“该记录记载”，不要断言今天的状态。\n\n以下为原素材：\n`;
  return context + intelligenceText(card).slice(0, 20000 - context.length);
}
export function insightSourceLinks(card) {
  return noteLinks(card).filter((link) => link.kind === 'external');
}
const markdownLabel = (value) =>
  String(value || '来源')
    .replace(/[\r\n]/g, ' ')
    .replace(/[\\[\]]/g, '\\$&');
export function insightSavedBody(source, result) {
  const scope = `> ${insightRecordScope(source)}`;
  const links = insightSourceLinks(source);
  const sources = links.length
    ? '\n\n## 原素材来源\n\n' + links.map((link) => `- [${markdownLabel(link.label)}](${link.target.replace(/[()*]/g, '\\$&')})`).join('\n')
    : '';
  return scope + '\n\n' + result.text + sources;
}
// Derived text only: originals and the full API analysis payload stay intact.
export function readableMaterialText(value, title = '') {
  const seen = new Set(),
    lines = [];
  const cleaned = String(value || '')
    .slice(0, 1000000)
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^\n]*?\)/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target.split('/').pop().replace(/\.md$/i, ''))
    .replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, '')
    .replace(/<[^>]*>/g, '');
  for (let line of cleaned.split(/\r?\n/)) {
    line = line
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/^\s*\[[ xX]\]\s*/, '')
      .replace(/[*~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || line === String(title).trim() || seen.has(line) || /^(?:-{3,}|={3,}|\|[ :|-]+\|)$/.test(line)) continue;
    if (/^(?:原始分享文字|页面快照|原始截图|原文件|原始附件|原始灵感|整理状态)$/.test(line)) continue;
    // Share codes, raw attachment paths and source bookkeeping are not summaries.
    if (/复制打开抖音|打开抖音.*看看|^[A-Za-z0-9]{2,8}:\/\s*\d{1,2}\/\d{1,2}|^\S{1,12}@\S{1,12}\s*[:：]|^!?\[?\[?01_sources\//.test(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n');
}
export function semanticMaterialText(card) {
  const parts = [
    card?.title,
    readableMaterialText(card?.body, card?.title),
    readableMaterialText(card?.caption, card?.title),
    readableMaterialText(card?.ocrText, card?.title),
    readableMaterialText(card?.documentIndex?.text, card?.title),
  ];
  return [...new Set(parts.filter(Boolean))].join('\n\n').slice(0, 20000);
}
export function materialExcerpt(card, limit = 180) {
  const text =
    [card?.caption, card?.body, card?.ocrText, card?.documentIndex?.text].map((value) => readableMaterialText(value, card?.title)).find(Boolean) ||
    '暂无文字摘要，可打开查看原始素材。';
  const characters = Array.from(text);
  return characters.length > limit ? characters.slice(0, limit).join('') + '…' : text;
}
export function duplicateMaterialIds(cards, anchor) {
  if (!anchor) return [];
  const content = (card) =>
    [
      card?.title,
      readableMaterialText(card?.body, card?.title),
      readableMaterialText(card?.ocrText, card?.title),
      readableMaterialText(card?.documentIndex?.text, card?.title),
    ]
      .join('\n')
      .trim();
  const fingerprint = content(anchor);
  // Never merge just by title or provenance: excerpts/insights may share a source.
  if (!readableMaterialText(anchor.body, anchor.title) && !anchor.ocrText && !anchor.documentIndex?.text) return [];
  return cards.filter((card) => card.id !== anchor.id && content(card) === fingerprint).map((card) => card.id);
}
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length || a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x)))
    return null;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : null;
}
export function rankEmbeddings(embeddings, anchorId, { exclude = [], limit = 30 } = {}) {
  const anchor = embeddings.find((x) => x.id === anchorId);
  if (!anchor) return [];
  const blocked = new Set([anchorId, ...exclude]);
  return embeddings
    .filter((x) => !blocked.has(x.id) && x.model === anchor.model && x.language === anchor.language)
    .map((x) => ({ id: x.id, score: cosineSimilarity(anchor.vector, x.vector) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
// Both search entry points use the same on-device ranking. Only plain text is
// sent to the native helper. Short request IDs also accommodate long Vault paths.
export async function rankLocalMaterials({ cards, query, anchor, limit = 30, embed, signal }) {
  const searching = query !== undefined;
  if (searching ? !query.trim() : !anchor) throw Error(searching ? '请用一句话描述想找的内容' : '请先选择参考素材');
  const sources = !searching && !cards.some((card) => card.id === anchor.id) ? [...cards, anchor] : cards;
  const entries = sources.map((card) => ({ card, text: semanticMaterialText(card) })).filter((entry) => entry.text.trim());
  if (entries.length > 2000) throw Error('请用素材类型或收藏集缩小范围后再查找（最多 2000 张卡片）。');
  const embeddings = [];
  const shortIds = entries.some(({ card }) => card.id.length > 2048);
  for (let start = 0; start < entries.length; start += 128) {
    signal?.throwIfAborted();
    const batch = entries.slice(start, start + 128).map(({ card, text }, index) => ({ id: shortIds ? String(start + index) : card.id, text }));
    const result = await embed(batch);
    for (const vector of result.embeddings) embeddings.push(shortIds ? { ...vector, id: entries[Number(vector.id)].card.id } : vector);
  }
  signal?.throwIfAborted();
  const indexed = embeddings.length;
  // The query is never a material ID, even when an imported card is literally named "query".
  const anchorId = searching ? Symbol('search query') : anchor.id;
  if (searching && indexed) {
    const result = await embed([{ id: 'query-' + crypto.randomUUID(), text: query.slice(0, 20000) }]);
    signal?.throwIfAborted();
    if (result.embeddings.length) embeddings.push({ ...result.embeddings[0], id: anchorId });
  }
  const exclude = searching ? [] : duplicateMaterialIds(sources, anchor);
  return { ranked: rankEmbeddings(embeddings, anchorId, { limit, exclude }), indexed, missingCount: entries.length - indexed, local: true };
}

export function extractDataPayload(card) {
  const data = card?.attachment?.dataUrl || card?.image || '';
  const match = /^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(data);
  if (!match) throw Error('请先把图片或 PDF 原文件导入本机，再识别文字。');
  return { kind: match[1] === 'application/pdf' ? 'pdf' : 'image', base64: match[2] };
}
export function generatedInsightCard(source, mode, result, { id, now }) {
  if (!source || !result?.text?.trim()) throw Error('没有可保存的解读内容');
  return {
    id,
    path: id,
    origin: 'local',
    type: 'text',
    title: `${INSIGHT_LABELS[mode] || 'AI 解读'} · ${source.title || '未命名素材'}`.slice(0, 1000),
    body: insightSavedBody(source, result),
    caption: 'AI 生成，请结合原文核对。',
    sourceCardId: source.id,
    sourceTitle: source.title || '',
    sourceUrl: source.sourceUrl || '',
    tags: ['AI 解读'],
    createdAt: now,
    updatedAt: now,
  };
}
