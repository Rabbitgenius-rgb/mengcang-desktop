import JSZip from 'jszip';
import { MAX_ATTACHMENT_BYTES, MAX_WORKSPACE_BACKUP_BYTES, parseWorkspaceBackup, serializeWorkspace } from './workspaceModel.js';
import { attachmentReference, externalizeAttachments, restoreAttachmentData } from './attachmentStore.js';

export const WORKSPACE_ZIP_FORMAT = 'mengcang-workspace-backup-v3';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entryName = (ref) => `attachments/${ref.sha256}`;

export function collectAttachmentReferences(value) {
  const refs = new Map(),
    seen = new WeakSet();
  function visit(item) {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (own(item, '$attachment')) {
      if (Object.keys(item).length !== 1) throw Error('备份附件引用格式无效。');
      const ref = attachmentReference(item.$attachment);
      refs.set(`${ref.sha256}:${ref.type}`, ref);
      return;
    }
    Object.values(item).forEach(visit);
  }
  visit(value);
  return [...refs.values()];
}
function validateManifest(value) {
  if (
    !record(value) ||
    value.format !== WORKSPACE_ZIP_FORMAT ||
    value.version !== 3 ||
    !record(value.state) ||
    value.state.schemaVersion !== 1 ||
    !Array.isArray(value.attachments) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !record(value.entityVersions)
  )
    throw Error('备份清单版本或结构无效。');
  const expected = collectAttachmentReferences(value.state);
  const actual = value.attachments.map(attachmentReference);
  const key = (ref) => `${ref.sha256}:${ref.type}:${ref.size}`;
  if (new Set(actual.map(key)).size !== actual.length || [...expected.map(key)].sort().join('\n') !== actual.map(key).sort().join('\n')) {
    throw Error('备份附件清单与资料引用不一致。');
  }
  for (const version of Object.values(value.entityVersions)) {
    if (!Number.isSafeInteger(version) || version < 0 || version > value.revision) throw Error('备份实体版本无效。');
  }
  return { ...value, attachments: actual };
}
export async function exportWorkspaceZip(state, store, { type = 'blob', revision = 0, entityVersions = {} } = {}) {
  const saved = await externalizeAttachments(state, store),
    refs = collectAttachmentReferences(saved);
  const manifest = validateManifest({
    format: WORKSPACE_ZIP_FORMAT,
    version: 3,
    createdAt: new Date().toISOString(),
    state: saved,
    revision,
    entityVersions,
    attachments: refs,
  });
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  const added = new Set();
  for (const ref of refs) {
    if (added.has(ref.sha256)) continue;
    const blob = await store.get(ref);
    if (blob.size !== ref.size) throw Error('原附件不完整，完整备份尚未生成。');
    zip.file(entryName(ref), await blob.arrayBuffer());
    added.add(ref.sha256);
  }
  // STORE avoids a second compression pass over already compressed media.
  return zip.generateAsync({ type, compression: 'STORE', streamFiles: true, mimeType: 'application/zip' });
}
async function binaryDataUrl(bytes, type) {
  const data = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 32768) binary += String.fromCharCode(...data.subarray(offset, offset + 32768));
  return `data:${type};base64,${btoa(binary)}`;
}
async function digest(bytes) {
  const value = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
export async function importWorkspaceBackup(input, store) {
  if (typeof input === 'string') return { state: parseWorkspaceBackup(input), revision: 0, entityVersions: {}, format: 'legacy-json' };
  const bytes = input instanceof Blob ? await input.arrayBuffer() : input;
  const head = new TextDecoder().decode(
    new Uint8Array(bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + Math.min(bytes.byteLength, 64)) : bytes.slice(0, 64)),
  );
  if (/^\s*\{/.test(head) && bytes.byteLength > MAX_WORKSPACE_BACKUP_BYTES) throw Error('备份超过256MiB导入上限。');
  if (/^\s*\{/.test(head))
    return { state: parseWorkspaceBackup(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), revision: 0, entityVersions: {}, format: 'legacy-json' };
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile || manifestFile._data.uncompressedSize > MAX_WORKSPACE_BACKUP_BYTES) throw Error('备份缺少有效清单或清单过大。');
  const manifestBytes = await manifestFile.async('uint8array');
  if (crc32(manifestBytes) !== manifestFile._data.crc32 >>> 0) throw Error('备份清单校验失败。');
  const manifest = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
  const allowed = new Set(['manifest.json', ...manifest.attachments.map(entryName)]);
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir && name === 'attachments/') continue;
    if (
      file.dir ||
      !allowed.has(name) ||
      (file.unsafeOriginalName && file.unsafeOriginalName !== name) ||
      file._data.uncompressedSize > (name === 'manifest.json' ? MAX_WORKSPACE_BACKUP_BYTES : MAX_ATTACHMENT_BYTES)
    )
      throw Error('备份含非预期文件或不安全路径。');
  }
  for (const ref of manifest.attachments) {
    const file = zip.file(entryName(ref));
    if (!file || file._data.uncompressedSize !== ref.size) throw Error('备份附件缺失或大小不符。');
  }
  const imported = new Set();
  for (const ref of manifest.attachments) {
    if (imported.has(`${ref.sha256}:${ref.type}`)) continue;
    const content = await zip.file(entryName(ref)).async('uint8array');
    if ((await digest(content)) !== ref.sha256) throw Error('备份附件内容校验失败。');
    const stored = attachmentReference(await store.put({ type: ref.type, size: ref.size, dataUrl: await binaryDataUrl(content, ref.type) }));
    if (stored.sha256 !== ref.sha256 || stored.size !== ref.size || stored.type !== ref.type) throw Error('备份附件写入校验失败。');
    imported.add(`${ref.sha256}:${ref.type}`);
  }
  return { state: manifest.state, revision: manifest.revision, entityVersions: manifest.entityVersions, format: WORKSPACE_ZIP_FORMAT };
}
const raster = (type) => /^image\/(?:png|jpe?g|pjpeg|gif|webp|avif|bmp|tiff)$/i.test(String(type || '').trim());
const refValue = (value) => (record(value) && Object.keys(value).length === 1 && own(value, '$attachment') ? attachmentReference(value.$attachment) : null);
function sameImage(left, right) {
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  const one = refValue(left),
    two = refValue(right);
  return one && two && one.sha256 === two.sha256 && one.type === two.type && one.size === two.size;
}
function legacyLimitError() {
  return Object.assign(Error('资料超过旧版 256 MiB 上限，请使用完整 ZIP 备份，无法安全降级到旧版。'), { code: 'LEGACY_BACKUP_TOO_LARGE' });
}
export function estimateLegacyWorkspaceBytes(value) {
  let size = 0;
  const encoder = new TextEncoder();
  function add(bytes) {
    size += bytes;
    if (size > MAX_WORKSPACE_BACKUP_BYTES) throw legacyLimitError();
  }
  function visit(item) {
    const ref = refValue(item);
    if (ref) {
      add(2 + `data:${ref.type};base64,`.length + 4 * Math.ceil(ref.size / 3));
      return;
    }
    if (Array.isArray(item)) {
      add(2 + Math.max(0, item.length - 1));
      for (const child of item) visit(child);
      return;
    }
    if (record(item)) {
      const entries = Object.entries(item).filter(
        ([key, child]) => child !== undefined && !(key === 'image' && raster(item.attachment?.type) && sameImage(child, item.attachment?.dataUrl)),
      );
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, child] of entries) {
        add(encoder.encode(JSON.stringify(key)).length + 1);
        visit(child);
      }
      return;
    }
    add(encoder.encode(JSON.stringify(item) ?? 'null').length);
  }
  visit(value);
  return size;
}
export async function exportLegacyWorkspace(state, store) {
  const saved = await externalizeAttachments(state, store);
  // Count each historical embedding site, including nested drafts. Shared file
  // storage does not shrink the JSON accepted by the old application.
  estimateLegacyWorkspaceBytes(saved);
  const restored = await restoreAttachmentData(saved, store);
  let result;
  try {
    result = serializeWorkspace(restored);
  } catch (error) {
    if (/256MiB/.test(error.message)) throw legacyLimitError();
    throw error;
  }
  if (new Blob([result]).size > MAX_WORKSPACE_BACKUP_BYTES) throw legacyLimitError();
  return result;
}
