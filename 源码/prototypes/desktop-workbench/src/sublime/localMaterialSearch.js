import { attachmentRefForUrl } from './attachmentRegistry.js';
import { articleOriginalLocation, articlePageUrl, articleSourceUrl } from './articleReaderModel.js';

// The local gateway returns a fresh list (and timestamp) when it rereads the
// same Vault. Keep an in-flight search on refresh, but invalidate real edits.
export function createVaultSearchVersion() {
  let previous = new Map(),
    version = 0;
  return (cards) => {
    const next = new Map(cards.map((card) => [card.id, card]));
    const changed =
      next.size !== previous.size ||
      cards.some((card) => {
        const old = previous.get(card.id);
        return (
          !old ||
          old.type !== card.type ||
          old.title !== card.title ||
          old.body !== card.body ||
          old.caption !== card.caption ||
          old.ocrText !== card.ocrText ||
          old.documentIndex?.text !== card.documentIndex?.text
        );
      });
    if (changed) version++;
    previous = next;
    return version;
  };
}

export function localSearchThumbnail(card) {
  const sources = [card.image, card.attachment?.dataUrl, card.previewImage];
  return (
    sources.find(
      (src) =>
        typeof src === 'string' &&
        (attachmentRefForUrl(src)?.type.startsWith('image/') ||
          /^(?:data:image\/(?:png|jpeg|gif|webp|avif|bmp|tiff|heic|heif);base64,|mengcang-asset:\/\/vault\/\?path=|blob:mengcang:\/\/app\/)/i.test(src)),
    ) || ''
  );
}

// Use an explicit saved parent first. Older browser image cards have only the
// page URL: link a unique saved article, otherwise keep the recorded web source.
export function imageResultSource(card, library) {
  const url = articleSourceUrl(card.sourceUrl);
  let parent = card.sourceCardId && library.find((item) => item.id === card.sourceCardId && item.id !== card.id && item.type === 'article');
  if (parent && url && parent.sourceUrl && articlePageUrl(parent.sourceUrl) !== articlePageUrl(url)) parent = null;
  if (!parent && !card.sourceCardId && url && card.type !== 'article') {
    const page = articlePageUrl(url);
    const matches = library.filter((item) => item.type === 'article' && articlePageUrl(item.sourceUrl) === page);
    if (matches.length === 1) parent = matches[0];
  }
  if (parent) return { label: '来源文章', title: parent.title || card.sourceTitle || '未命名文章', cardId: parent.id };
  if (!url && !card.sourceTitle) return null;
  return { label: card.articleFigure ? '来源文章' : '来源', title: card.sourceTitle || new URL(url).hostname, url };
}

// Resolve only against saved, visible cards. An article's web citation points
// outside the app; it must not resolve back to the article itself.
export function relatedCardSource(card, library) {
  if (card.sourceCardId && !card.articleFigure && !card.webAnchor) {
    const parent = library.find((item) => item.id === card.sourceCardId && item.id !== card.id);
    if (parent && parent.type !== 'article') {
      return { label: '来源资料', title: parent.title || card.sourceTitle || '未命名资料', cardId: parent.id };
    }
  }
  const source = imageResultSource(card, library);
  if (!source?.url && !source?.cardId) return null;
  if (source.url && card.type === 'article') return { ...source, title: card.sourceTitle || card.title || source.title };
  if (source.url && card.webAnchor) return { ...source, url: articleOriginalLocation(source.url, card.webAnchor) || source.url };
  return source;
}
