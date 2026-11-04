import { normalizeWorkspaceAttachment } from './workspaceModel.js';

import {
  attachmentReference,
  attachmentRefForUrl,
  nativeAttachmentUrl,
  registerAttachmentUrl,
  forgetAttachmentUrl,
  attachmentFileExtension,
  rememberInlineAttachmentIdentity,
} from './attachmentRegistry.js';
export { attachmentReference, attachmentRefForUrl, nativeAttachmentUrl } from './attachmentRegistry.js';
const blobMutationQueues = new Map();
const transformedUrls = new WeakMap();
const externalizers = new WeakMap();
const plain = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const inlineData = (value) => typeof value === 'string' && /^data:[^;,]+;base64,/i.test(value);
const binaryFields = new Set(['dataUrl', 'image', 'imageData', 'assetUrl', 'coverImage', 'coverDataUrl', 'thumbnail', 'artwork']);
const binaryField = (key) => key === undefined || binaryFields.has(key);
function inlineAttachment(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(dataUrl);
  if (!match) throw Error('附件内容无效。');
  const type = match[1].toLowerCase();
  const size = (match[2].length / 4) * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  return normalizeWorkspaceAttachment({ name: `attachment.${attachmentFileExtension(type)}`, type, size, dataUrl });
}
function decode(dataUrl) {
  const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
async function fingerprint(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}
async function checkBlob(blob, value) {
  const ref = attachmentReference(value);
  if (!(blob instanceof Blob) || blob.size !== ref.size || (await fingerprint(await blob.arrayBuffer())) !== ref.sha256)
    throw Object.assign(Error('附件校验失败。'), { code: 'ATTACHMENT_INTEGRITY' });
  return blob;
}
function resultData(result) {
  if (result?.ok === false) throw Object.assign(Error(result.error?.message || '附件读写失败。'), { code: result.error?.code });
  return result?.ok === true ? result.data : result;
}
export function createAttachmentStore({
  bridge = globalThis.window?.mengcang?.attachments,
  indexedDB = globalThis.indexedDB,
  databaseName = 'mengcang-workspace-attachments-v3',
  urlApi = globalThis.URL,
} = {}) {
  let opening;
  const urls = new Map();
  function database() {
    if (!opening)
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('blobs');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          opening = null;
          reject(request.error);
        };
        request.onblocked = () => {
          opening = null;
          reject(Error('附件库被其他窗口占用。'));
        };
      });
    return opening;
  }
  async function blobRecord(mode, key, blob) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', mode),
        store = tx.objectStore('blobs');
      const request = mode === 'readonly' ? store.get(key) : store.put(blob, key);
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('附件库读写失败。'));
    });
  }
  function mutateBlob(ref, change) {
    const key = databaseName + ':' + ref.sha256;
    if (globalThis.navigator?.locks) return navigator.locks.request('mengcang-blob:' + key, change);
    const prior = blobMutationQueues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(change);
    blobMutationQueues.set(key, next);
    return next.finally(() => {
      if (blobMutationQueues.get(key) === next) blobMutationQueues.delete(key);
    });
  }
  async function writeBlobs(changes) {
    if (!changes.length) return;
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite'),
        store = tx.objectStore('blobs');
      for (const [key, value] of changes) {
        if (value === null) store.delete(key);
        else store.put(value, key);
      }
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || Error('附件写入未完成。'));
    });
  }
  async function put(value, restoreToken) {
    const decoded = inlineAttachment(value.dataUrl);
    const attachment = normalizeWorkspaceAttachment({
      ...decoded,
      name: value.name || decoded.name,
      type: value.type || decoded.type,
      size: value.size ?? decoded.size,
    });
    if (bridge) {
      const ref = attachmentReference(resultData(restoreToken ? await bridge.restore(attachment, restoreToken) : await bridge.put(attachment)));
      rememberInlineAttachmentIdentity(value.dataUrl, ref);
      return ref;
    }
    const bytes = decode(attachment.dataUrl),
      ref = { sha256: await fingerprint(bytes), type: attachment.type, size: attachment.size };
    await mutateBlob(ref, async () => {
      const previous = await blobRecord('readonly', ref.sha256);
      const ownerKey = 'restore-owners:' + ref.sha256;
      const owners = await blobRecord('readonly', ownerKey);
      const changes = [];
      let write = !previous;
      if (previous) {
        try {
          await checkBlob(previous, ref);
        } catch (error) {
          if (!restoreToken) throw error;
          write = true;
        }
      }
      if (write) changes.push([ref.sha256, new Blob([bytes], { type: ref.type })]);
      if (restoreToken && (!previous || owners)) changes.push([ownerKey, [...new Set([...(owners || []), restoreToken])]]);
      if (!restoreToken && owners) changes.push([ownerKey, null]);
      await writeBlobs(changes);
    });
    rememberInlineAttachmentIdentity(value.dataUrl, ref);
    return ref;
  }
  async function get(value) {
    const ref = attachmentReference(value);
    if (bridge) {
      const result = resultData(await bridge.read(ref));
      const bytes = result?.dataUrl ? decode(inlineAttachment(result.dataUrl).dataUrl) : (result?.bytes ?? result);
      return checkBlob(new Blob([bytes], { type: ref.type }), ref);
    }
    return checkBlob(await blobRecord('readonly', ref.sha256), ref);
  }
  async function url(value) {
    const ref = attachmentReference(value);
    if (bridge) return nativeAttachmentUrl(ref);
    const key = `${ref.sha256}:${ref.type}`;
    if (!urls.has(key)) {
      const promise = get(ref)
        .then((blob) => {
          const source = urlApi.createObjectURL(blob);
          registerAttachmentUrl(source, ref);
          return source;
        })
        .catch((error) => {
          urls.delete(key);
          // Keep the metadata readable so the user can open the backup dialog.
          // Byte reads and exports still reject this digest until it is repaired.
          if (error?.code === 'ATTACHMENT_INTEGRITY') return nativeAttachmentUrl(ref);
          throw error;
        });
      urls.set(key, promise);
    }
    return urls.get(key);
  }
  async function dispose() {
    for (const promise of urls.values()) {
      try {
        const source = await promise;
        urlApi.revokeObjectURL(source);
        forgetAttachmentUrl(source);
      } catch {
        /* Failed URLs own no resources. */
      }
    }
    urls.clear();
    if (opening) (await opening).close();
  }
  async function settleRestore(token, refs, committed) {
    if (bridge) return resultData(await bridge.settleRestore(token, committed));
    for (const ref of refs)
      await mutateBlob(ref, async () => {
        const key = 'restore-owners:' + ref.sha256;
        const owners = await blobRecord('readonly', key);
        if (!owners?.includes(token)) return;
        const remaining = owners.filter((value) => value !== token);
        if (committed) await writeBlobs([[key, null]]);
        else if (remaining.length) await writeBlobs([[key, remaining]]);
        else {
          await writeBlobs([
            [key, null],
            [ref.sha256, null],
          ]);
          for (const [name, promise] of urls)
            if (name.startsWith(ref.sha256 + ':')) {
              const objectUrl = await promise;
              urlApi.revokeObjectURL(objectUrl);
              forgetAttachmentUrl(objectUrl);
              urls.delete(name);
            }
        }
      });
  }
  return { put: (value) => put(value), restore: (value, token) => put(value, token), settleRestore, get, url, dispose };
}
function persistentReference(value) {
  return plain(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '$attachment') ? attachmentReference(value.$attachment) : null;
}
export function externalizeAttachmentUrls(value, field) {
  const reference = persistentReference(value);
  if (reference) return { $attachment: reference };
  if (typeof value === 'string') {
    const ref = attachmentRefForUrl(value);
    if (ref) return { $attachment: ref };
    if (binaryField(field) && inlineData(value)) throw Object.assign(Error('新附件需要先完成本机写入。'), { code: 'ATTACHMENT_PREPARATION_REQUIRED' });
    return value;
  }
  if (!Array.isArray(value) && !plain(value)) return value;
  if (transformedUrls.has(value)) return transformedUrls.get(value);
  const next = Array.isArray(value)
    ? value.map((item) => externalizeAttachmentUrls(item, field))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, externalizeAttachmentUrls(item, key)]));
  if (Object.isFrozen(value)) transformedUrls.set(value, next);
  return next;
}
export async function externalizeAttachments(value, store) {
  const inlineFiles = new Map();
  let cache = externalizers.get(store);
  if (!cache) {
    cache = new WeakMap();
    externalizers.set(store, cache);
  }
  async function visit(item, field) {
    const reference = persistentReference(item);
    if (reference) return { $attachment: reference };
    if (typeof item === 'string') {
      const ref = attachmentRefForUrl(item);
      if (ref) return { $attachment: ref };
      if (binaryField(field) && inlineData(item)) {
        if (!inlineFiles.has(item)) inlineFiles.set(item, store.put(inlineAttachment(item)).then(attachmentReference));
        return { $attachment: await inlineFiles.get(item) };
      }
      return item;
    }
    if (!Array.isArray(item) && !plain(item)) return item;
    if (cache.has(item)) return cache.get(item);
    const next = Array.isArray(item) ? [] : {};
    for (const [key, child] of Object.entries(item))
      Object.defineProperty(next, key, { value: await visit(child, Array.isArray(item) ? field : key), enumerable: true, writable: true, configurable: true });
    if (Object.isFrozen(item)) cache.set(item, next);
    return next;
  }
  return visit(value);
}
async function mapReferences(value, resolve, cache = new WeakMap()) {
  const reference = persistentReference(value);
  if (reference) return resolve(reference);
  if (!Array.isArray(value) && !plain(value)) return value;
  if (cache.has(value)) return cache.get(value);
  const next = Array.isArray(value) ? [] : {};
  for (const [key, child] of Object.entries(value))
    Object.defineProperty(next, key, { value: await mapReferences(child, resolve, cache), enumerable: true, writable: true, configurable: true });
  cache.set(value, next);
  return next;
}
export function hydrateAttachmentUrls(value, store) {
  return mapReferences(value, (reference) => store.url(reference));
}
// Existing browser cards may retain the metadata URL used at a cold start with
// missing bytes. Reconnect those same references in the committed projection.
export function reconnectAttachmentUrls(value, replacements, field) {
  if (!replacements.size) return value;
  if (typeof value === 'string') return binaryField(field) ? (replacements.get(value) ?? value) : value;
  if (!Array.isArray(value) && !plain(value)) return value;
  let output = value;
  for (const [key, child] of Object.entries(value)) {
    const next = reconnectAttachmentUrls(child, replacements, Array.isArray(value) ? field : key);
    if (next === child) continue;
    if (output === value) output = Array.isArray(value) ? [...value] : { ...value };
    Object.defineProperty(output, key, { value: next, enumerable: true, writable: true, configurable: true });
  }
  return output;
}
export async function attachmentDataUrl(value, store) {
  const ref = attachmentReference(value),
    blob = await store.get(ref);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${ref.type};base64,${btoa(binary)}`;
}
export function restoreAttachmentData(value, store) {
  const files = new Map();
  return mapReferences(value, (reference) => {
    const key = `${reference.sha256}:${reference.type}`;
    if (!files.has(key)) files.set(key, attachmentDataUrl(reference, store));
    return files.get(key);
  });
}
export async function readAttachmentBytes(attachment, { fetch: fetchFile = globalThis.fetch, signal } = {}) {
  if (attachmentRefForUrl(attachment?.dataUrl)) {
    const response = await fetchFile(attachment.dataUrl, { credentials: 'omit', signal });
    if (!response.ok) throw Error('原附件暂无法读取。');
    const bytes = new Uint8Array(await response.arrayBuffer()),
      ref = attachmentRefForUrl(attachment.dataUrl);
    await checkBlob(new Blob([bytes], { type: ref.type }), ref);
    return bytes;
  }
  return decode(normalizeWorkspaceAttachment(attachment).dataUrl);
}

export async function inlineWorkspaceAttachment(attachment, options) {
  if (!attachmentRefForUrl(attachment?.dataUrl)) return normalizeWorkspaceAttachment(attachment);
  const bytes = await readAttachmentBytes(attachment, options);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return normalizeWorkspaceAttachment({ ...attachment, dataUrl: `data:${attachment.type};base64,${btoa(binary)}` });
}

export async function inlineWorkspaceSource(source, options) {
  if (!source) return source;
  const next = { ...source };
  if (source.attachment) next.attachment = await inlineWorkspaceAttachment(source.attachment, options);
  const imageRef = attachmentRefForUrl(source.image);
  if (imageRef)
    next.image = (
      await inlineWorkspaceAttachment(
        { name: `attachment.${attachmentFileExtension(imageRef.type)}`, type: imageRef.type, size: imageRef.size, dataUrl: source.image },
        options,
      )
    ).dataUrl;
  return next;
}
