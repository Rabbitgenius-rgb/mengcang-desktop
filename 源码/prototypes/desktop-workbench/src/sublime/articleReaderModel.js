import { normalizeArticleModel, articlePlainText } from '../../../../src/clipper/article.mjs';
import { textFragmentUrl, normalizeAnchorText, normalizeWebAnchor } from '../../../../src/clipper/anchors.mjs';

export function articleSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}
export function articlePageUrl(value) {
  const source = articleSourceUrl(value);
  if (!source) return '';
  const url = new URL(source);
  url.hash = '';
  return url.href;
}
export function articleOriginalLocation(sourceUrl, anchor) {
  if (!articleSourceUrl(sourceUrl)) return '';
  try {
    return anchor ? textFragmentUrl(sourceUrl, anchor) : articleSourceUrl(sourceUrl);
  } catch {
    return '';
  }
}
export function articleReaderModel(card) {
  let article = null;
  if (card?.article)
    try {
      article = normalizeArticleModel(card.article);
    } catch {}
  const snapshotBody = article ? articlePlainText(article) : '';
  // A plain-text edit must take precedence over its older rich capture. Keep
  // the capture and image bytes available as a separate original snapshot.
  const hasEditedBody = !!article && typeof card.body === 'string' && normalizeAnchorText(card.body) !== normalizeAnchorText(snapshotBody);
  const body = article && !hasEditedBody ? snapshotBody : String(card?.body || '');
  const han = (body.match(/[\u3400-\u9fff]/g) || []).length,
    words = (body.match(/[A-Za-z\d]+(?:['’-][A-Za-z\d]+)*/g) || []).length;
  return {
    article,
    body,
    snapshotBody,
    hasEditedBody,
    minutes: Math.max(1, Math.ceil(han / 450 + words / 220)),
    sourceUrl: articleSourceUrl(card?.sourceUrl),
    fallbackParagraphs: body.split(/\n\s*\n/).filter((value) => value.trim()),
    missingImages: article?.blocks.filter((block) => block.type === 'image' && !savedArticleImage(block)).length || 0,
  };
}
export function savedArticleImage(block) {
  const attachment = block?.attachment;
  return attachment &&
    /^image\/(?:png|jpeg|gif|webp|avif)$/i.test(attachment.type || '') &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size > 0 &&
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(attachment.dataUrl || '')
    ? attachment.dataUrl
    : '';
}

export function articleHighlights(cards, state, source) {
  const page = articlePageUrl(source?.sourceUrl);
  if (!page) return [];
  const saved = new Set(state.savedIds || []),
    hidden = new Set(state.hiddenIds || []);
  return cards.filter(
    (card) =>
      card.type === 'highlight' &&
      card.webAnchor &&
      (!card.sourceCardId || card.sourceCardId === source.id) &&
      saved.has(card.id) &&
      !hidden.has(card.id) &&
      articlePageUrl(card.sourceUrl) === page,
  );
}

export function normalizeArticleHighlightDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.operationId))
    return null;
  if (
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    value.text.length > 50000 ||
    value.text.includes('\0') ||
    typeof value.note !== 'string' ||
    value.note.length > 50000 ||
    value.note.includes('\0')
  )
    return null;
  const sourceUrl = articlePageUrl(value.sourceUrl);
  if (!sourceUrl) return null;
  try {
    const anchor = normalizeWebAnchor(value.anchor);
    if (normalizeAnchorText(value.text) !== anchor.exact) return null;
    return {
      operationId: value.operationId,
      text: value.text,
      anchor,
      note: value.note,
      favorite: value.favorite === true,
      submitted: value.submitted === true,
      sourceUrl,
    };
  } catch {
    return null;
  }
}

export function reviseArticleHighlightSelection(previous, { text, anchor, sourceUrl }, createId = () => crypto.randomUUID()) {
  // A submitted intent may already be committed. Re-selection must never
  // mutate its payload or request identity while the caller can still retry it.
  if (previous?.submitted) return previous;
  const page = articlePageUrl(sourceUrl),
    nextAnchor = normalizeWebAnchor(anchor);
  if (!page || typeof text !== 'string' || normalizeAnchorText(text) !== nextAnchor.exact) throw Error('选文与原文位置不一致，请重新选择。');
  const samePage = previous?.sourceUrl === page;
  if (samePage && previous.text === text && JSON.stringify(previous.anchor) === JSON.stringify(nextAnchor)) return previous;
  return {
    operationId: createId(),
    text,
    anchor: nextAnchor,
    note: samePage ? previous.note : '',
    favorite: samePage ? previous.favorite : false,
    submitted: false,
    sourceUrl: page,
  };
}

export function articleListNumber(marker) {
  const match = /^[([]?(-?\d+)[.)\]]?$/.exec(String(marker || '').trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && Math.abs(value) <= 1000000 ? value : undefined;
}
const orderedMarker = (marker) => typeof marker === 'string' && !!marker.trim() && !/^[•◦▪▫‣⁃∙·*+\-–—]$/.test(marker.trim());

// Consecutive list blocks become semantic lists instead of unrelated bullet
// rows. Nested depth attaches to the preceding item without changing its text.
export function articleReadingNodes(blocks = []) {
  const result = [],
    stack = [];
  for (const block of blocks) {
    if (block.type !== 'list-item') {
      result.push({ kind: 'block', block });
      stack.length = 0;
      continue;
    }
    const depth = block.depth || 0,
      ordered = orderedMarker(block.marker);
    while (stack.length && (stack.at(-1).depth > depth || (stack.at(-1).depth === depth && stack.at(-1).ordered !== ordered))) stack.pop();
    let list = stack.at(-1);
    if (!list || list.depth !== depth) {
      const next = { kind: 'list', ordered, depth, items: [] };
      if (list && list.depth < depth && list.items.length) list.items.at(-1).children.push(next);
      else result.push(next);
      stack.push(next);
      list = next;
    }
    list.items.push({ block, children: [] });
  }
  return result;
}
