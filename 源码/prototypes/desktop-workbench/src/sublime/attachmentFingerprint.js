import { normalizeWorkspaceAttachment } from './workspaceModel.js';
import { readAttachmentBytes } from './attachmentStore.js';

// Hash decoded bytes, not a file name, timestamp or caller-supplied digest.
// Only compact metadata is returned; no attachment copy enters a saved record.
export async function fingerprintWorkspaceAttachment(value) {
  const attachment = normalizeWorkspaceAttachment(value);
  if (!attachment) throw Error('原文件不可用，无法核验。');
  if (!globalThis.crypto?.subtle) throw Error('当前环境无法核验原文件，请保留结果并在梦藏应用内重试。');
  const bytes = await readAttachmentBytes(attachment);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return {
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    sha256: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
  };
}
