const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
const references = new Map();
const plain = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/msword': 'doc',
  'application/vnd.msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/avi': 'avi',
  'video/msvideo': 'avi',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
};
export function attachmentReference(value) {
  const type = typeof value?.type === 'string' ? value.type.trim().toLowerCase() : '';
  if (
    !plain(value) ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Object.hasOwn(MIME_EXTENSIONS, type) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_ATTACHMENT_BYTES
  )
    throw Error('附件引用无效，请保留原资料。');
  return { sha256: value.sha256, type, size: value.size };
}
export function attachmentRefForUrl(value) {
  return references.get(value) || null;
}
export function nativeAttachmentUrl(value) {
  const ref = attachmentReference(value);
  const url = `mengcang-asset://library/${ref.sha256}?type=${encodeURIComponent(ref.type)}&size=${ref.size}`;
  references.set(url, ref);
  return url;
}

export function registerAttachmentUrl(url, value) {
  const ref = attachmentReference(value);
  references.set(url, ref);
  return url;
}
export function forgetAttachmentUrl(url) {
  references.delete(url);
}
export function attachmentFileExtension(type) {
  return MIME_EXTENSIONS[type] || 'bin';
}
