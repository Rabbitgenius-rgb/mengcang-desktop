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
  if (bytes.length !== ref.size || hash(bytes) !== ref.sha256) throw Object.assign(new Error('附件校验失败，原引用已保留。'), {code:'ATTACHMENT_INTEGRITY'});
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
      if (!stat.isFile()) throw new Error('附件路径不是常规文件。');
      if (stat.size !== ref.size) throw Object.assign(new Error('附件大小校验失败。'), {code:'ATTACHMENT_INTEGRITY'});
      const bytes = await handle.readFile();
      inspectBytes(bytes, ref);
      return bytes;
    } finally {
      await handle.close();
    }
  }
  // Serialize claiming a new digest, repairing it, and rolling back unpublished
  // bytes. An ordinary save adopting the same digest takes permanent ownership.
  const provisional = new Map();
  let mutations = Promise.resolve();
  function mutate(fn) {
    const result = mutations.then(fn);
    mutations = result.catch(() => {});
    return result;
  }
  function claim(ref, token, created) {
    if (!token) provisional.delete(ref.sha256);
    else if (created || provisional.has(ref.sha256)) {
      if (!provisional.has(ref.sha256)) provisional.set(ref.sha256,new Set());
      provisional.get(ref.sha256).add(token);
    }
  }
  async function write(value, token) {
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
    let repairing = false;
    try {
      await read(ref);
      claim(ref, token, false);
      return ref;
    } catch (error) {
      repairing = !!token && error.code === 'ATTACHMENT_INTEGRITY';
      if (!repairing && error.code !== 'ENOENT') throw error;
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
      const destination = path.join(root, ref.sha256);
      // The supplied bytes were checked for MIME, length and digest, and the
      // complete temporary file is durable before replacing a damaged target.
      if (repairing) await fs.rename(temporary, destination);
      else try {
        await fs.link(temporary, destination);
        claim(ref,token,true);
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
  function validateToken(token) {
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) throw Error('恢复操作标识无效。');
  }
  function restore(value, token) {
    validateToken(token);
    return mutate(() => write(value,token));
  }
  function settleRestore(token, committed) {
    validateToken(token);
    if (typeof committed !== 'boolean') throw Error('恢复提交状态无效。');
    return mutate(async () => {
      for (const [sha,owners] of provisional) {
        if (!owners.delete(token)) continue;
        if (committed) { provisional.delete(sha); continue; }
        if (owners.size === 0) {
          await fs.rm(path.join(root,sha),{force:true});
          provisional.delete(sha);
        }
      }
    });
  }
  return { put:value=>mutate(()=>write(value)), read, capacity, restore, settleRestore };
}
module.exports = { createFileAttachmentStore, attachmentReference };
