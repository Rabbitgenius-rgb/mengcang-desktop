const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { normalizeWorkspaceAttachment, MAX_ATTACHMENT_BYTES } = require('./attachment-validation.cjs');

const MIME_EXTENSIONS = Object.freeze({
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
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function attachmentReference(value) {
  const type = typeof value?.type === 'string' ? value.type.trim().toLowerCase() : '';
  if (
    !value ||
    typeof value !== 'object' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Object.hasOwn(MIME_EXTENSIONS, type) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error('附件引用无效，请保留原资料。');
  }
  return { sha256: value.sha256, type, size: value.size };
}
function inspectBytes(bytes, ref) {
  if (bytes.length !== ref.size || hash(bytes) !== ref.sha256) throw new Error('附件校验失败，原引用已保留。');
  normalizeWorkspaceAttachment({
    name: `attachment.${MIME_EXTENSIONS[ref.type]}`,
    type: ref.type,
    size: ref.size,
    dataUrl: `data:${ref.type};base64,${bytes.toString('base64')}`,
  });
}

/** Only the main process supplies this private directory. No caller supplies paths. */
function createFileAttachmentStore({ directory }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('附件目录必须由主进程指定。');
  const root = path.resolve(directory);
  async function ready() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const entry = await fs.lstat(root);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('附件目录不可用，请保留原资料。');
  }
  async function read(value) {
    const ref = attachmentReference(value);
    await ready();
    const handle = await fs.open(path.join(root, ref.sha256), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== ref.size) throw new Error('附件大小校验失败。');
      const bytes = await handle.readFile();
      inspectBytes(bytes, ref);
      return bytes;
    } finally {
      await handle.close();
    }
  }
  async function put(value) {
    const match = typeof value?.dataUrl === 'string' && /^data:([^;,]+);base64,/i.exec(value.dataUrl);
    const type = String(value?.type || match?.[1] || '')
      .trim()
      .toLowerCase();
    if (!Object.hasOwn(MIME_EXTENSIONS, type)) throw new Error('附件类型不受支持。');
    if (!match) throw new Error('附件内容无效。');
    const encoded = value.dataUrl.slice(value.dataUrl.indexOf(',') + 1);
    const size = (encoded.length / 4) * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    const attachment = normalizeWorkspaceAttachment({
      name: value.name || `attachment.${MIME_EXTENSIONS[type]}`,
      type,
      size: value.size ?? size,
      dataUrl: value.dataUrl,
    });
    const bytes = Buffer.from(encoded, 'base64');
    const ref = attachmentReference({ sha256: hash(bytes), type: attachment.type, size: attachment.size });
    await ready();
    try {
      await read(ref);
      return ref;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const capacity = await fs.statfs(root);
    if (capacity.bavail * capacity.bsize < bytes.length) throw Object.assign(new Error('磁盘空间不足，附件未提交。'), { code: 'ATTACHMENT_NO_SPACE' });
    const temporary = path.join(root, `.pending-${randomUUID()}`);
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.link(temporary, path.join(root, ref.sha256));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await read(ref);
      return ref;
    } finally {
      await fs.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  async function capacity() {
    await ready();
    const stat = await fs.statfs(root);
    return { availableBytes: stat.bavail * stat.bsize };
  }
  return { put, read, capacity };
}
module.exports = { createFileAttachmentStore, attachmentReference };
