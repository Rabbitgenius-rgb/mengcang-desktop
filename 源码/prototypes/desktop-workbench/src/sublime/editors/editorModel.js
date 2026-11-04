import { safeSourceUrl } from '../workspaceModel.js';
export const makeId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const itemKey = (item) => String(item?.path || item?.id || '');
export const messageFor = (error) => (error instanceof Error ? error.message : String(error || '操作未完成，请重试。'));
export const validUrl = (value) => Boolean(safeSourceUrl(value));
export const deriveTitle = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
export const readLocalFile = (file, asData = false) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('无法读取此文件。'));
    asData ? reader.readAsDataURL(file) : reader.readAsText(file);
  });
export const isBookFile = (descriptor) => ['pdf', 'epub'].includes(descriptor?.kind);
export const importedCardType = (descriptor) =>
  descriptor?.kind === 'epub'
    ? 'book'
    : ['image', 'heic'].includes(descriptor?.kind)
      ? 'image'
      : ['video', 'audio'].includes(descriptor?.kind)
        ? descriptor.kind
        : 'file';
export const defaultCard = (card, kind) => ({
  id: card?.id,
  title: card?.title || '',
  body: card?.body || '',
  caption: card?.caption || '',
  sourceUrl: card?.sourceUrl || '',
  sourceTitle: card?.sourceTitle || '',
  author: card?.author || '',
  page: card?.page || '',
  sourceLocation: card?.sourceLocation || '',
  importFingerprint: card?.importFingerprint || '',
  sourceCardId: card?.origin === 'vault' ? card.id : card?.sourceCardId || '',
  ...(card?.sourceAudioSha256 ? { sourceAudioSha256: card.sourceAudioSha256 } : {}),
  ...(card?.sourceAttachmentSha256 ? { sourceAttachmentSha256: card.sourceAttachmentSha256 } : {}),
  type: card?.type || kind,
  image: card?.image || card?.imageData || card?.assetUrl || '',
  favorite: Boolean(card?.favorite),
  private: Boolean(card?.private),
  collectionIds: Array.isArray(card?.collectionIds) ? card.collectionIds : [],
  attachment: card?.attachment || null,
});
