'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { ConnectorError, hash, frontmatterOf } = require('./notes');
const { normalizeWorkspaceAttachment } = require('../../desktop/attachment-validation.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOTS = ['01_sources/cards/text/', '01_sources/cards/web/'];
const KEYS = new Set(['vaultId', 'operationId', 'title', 'body', 'caption', 'sourceUrl', 'sourceTitle', 'author', 'page', 'sourceLocation', 'sourcePath', 'expectedSourceHash', 'tags', 'importFingerprint','attachment']);
const ORIGINAL_ROOT='01_sources/_originals/';
const ATTACHMENT_TYPES=Object.freeze({png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',tiff:'image/tiff',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',heic:'image/heic',heif:'image/heif',mp4:'video/mp4',mov:'video/quicktime',avi:'video/x-msvideo',ogv:'video/ogg',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',ogg:'audio/ogg'});
function captureAttachment(raw) {
  if(raw===undefined||raw===null)return null;
  if(typeof raw!=='object'||Object.keys(raw).some(key=>!['name','type','size','dataUrl'].includes(key)))fail('附件请求包含不支持的字段');
  let value;try{value=normalizeWorkspaceAttachment(raw);}catch(error){fail(error.message);}
  const mime=value.type.trim().toLowerCase(),aliases={'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg','audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/vnd.wave':'audio/wav','audio/x-flac':'audio/flac','audio/x-m4a':'audio/mp4','video/avi':'video/x-msvideo','video/msvideo':'video/x-msvideo','application/vnd.msword':'application/msword','application/ogg':'audio/ogg'};
  const type=aliases[mime]||mime,extension=Object.keys(ATTACHMENT_TYPES).find(ext=>ATTACHMENT_TYPES[ext]===type);
  if(!extension)fail('此附件类型不能存入仓库');
  const bytes=Buffer.from(value.dataUrl.slice(value.dataUrl.indexOf(',')+1),'base64');
  return {name:value.name,type,size:bytes.length,sha256:hash(bytes),extension,bytes};
}
const RESERVED = /<!--\s*mengcang(?:[-:]|\s|>)/i;
const badUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const fail = (message, code = 'INVALID_CAPTURE', status = 400) => { throw new ConnectorError(code, message, status); };

function text(value, name, limit, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || value.includes('\0') || badUnicode.test(value)) fail(`${name}格式不正确或过长`);
  return value;
}
function capturePaths(operationId) {
  if (typeof operationId !== 'string' || !UUID.test(operationId)) fail('采集操作标识必须是稳定 UUID', 'INVALID_OPERATION');
  return ROOTS.map(root => `${root}capture-${operationId.toLowerCase()}.md`);
}
function validateCaptureInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !KEYS.has(key))) fail('采集请求包含不支持的字段');
  const paths = capturePaths(raw.operationId);
  const title = text(raw.title, '标题', 300).trim();
  if (!title) fail('请填写采集标题');
  const body = text(raw.body, '摘录正文', 100000);
  if (RESERVED.test(body)) fail('摘录不能包含梦藏保留的管理标记');
  const caption = text(raw.caption, '素材配文', 50000, true);
  const importFingerprint = text(raw.importFingerprint, '导入识别标记', 150, true);
  if (importFingerprint && (!importFingerprint.startsWith('highlight-v1:') || /[\x00-\x1f\x7f]/.test(importFingerprint))) fail('导入识别标记格式不正确');
  const sourceUrl = text(raw.sourceUrl, '来源链接', 4096, true);
  if (sourceUrl) {
    let url; try { url = new URL(sourceUrl); } catch { fail('来源链接无效'); }
    if (sourceUrl !== sourceUrl.trim() || /[\\\x00-\x20\x7f]/.test(sourceUrl) || !/^https?:\/\//i.test(sourceUrl) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail('来源链接必须是没有账号信息的 HTTP(S) 链接');
  }
  const attachment=captureAttachment(raw.attachment);
  if (!body.trim() && !sourceUrl&&!attachment) fail('请填写摘录正文、网页来源或原文件');
  const sourceTitle = text(raw.sourceTitle, '来源标题', 1000, true);
  const author = text(raw.author, '作者', 1000, true);
  const sourceLocation = text(raw.sourceLocation, '来源位置', 1000, true);
  if (/[\x00-\x1f\x7f]/.test(sourceLocation)) fail('来源位置不能包含控制字符');
  const sourcePath = text(raw.sourcePath, '来源笔记路径', 2048, true);
  const expectedSourceHash = text(raw.expectedSourceHash, '来源版本', 64, true);
  if (sourcePath && !/^[a-f0-9]{64}$/.test(expectedSourceHash)) fail('引用已有笔记时必须提供来源版本', 'INVALID_VERSION');
  if (!sourcePath && expectedSourceHash) fail('来源版本需要对应的来源笔记');
  const page = raw.page === undefined || raw.page === null ? null : raw.page;
  if (page !== null && (!Number.isSafeInteger(page) || page < 1 || page > 1000000)) fail('来源页码必须是有效的正整数');
  const tags = raw.tags === undefined ? [] : raw.tags;
  if (!Array.isArray(tags) || tags.length > 100 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 120 || /[\r\n\0]/.test(tag) || badUnicode.test(tag))) fail('标签格式不正确');
  const input = { operationId: raw.operationId.toLowerCase(), title, body, caption, sourceUrl, sourceTitle, author, page, sourceLocation, sourcePath, expectedSourceHash, importFingerprint, tags: [...new Set(tags.map(tag => tag.trim()))].sort(), path: paths[sourceUrl ? 1 : 0] };
  // Preserve the actual excerpt, including whitespace and CRLF. Metadata has a
  // fixed key order and set-like tags so retries have a stable content identity.
  input.fingerprint = hash(JSON.stringify({ operationId: input.operationId, title, body, caption, sourceUrl, sourceTitle, author, page, sourceLocation, sourcePath, expectedSourceHash, importFingerprint, tags: input.tags,...(attachment?{attachment:{name:attachment.name,type:attachment.type,size:attachment.size,sha256:attachment.sha256}}:{}) }));
  if(attachment)input.attachment={...attachment,path:`${ORIGINAL_ROOT}capture-${input.operationId}/${input.fingerprint}-${attachment.sha256}.${attachment.extension}`};
  return input;
}
function assertCapturePath(relative) {
  const root = ROOTS.find(value => typeof relative === 'string' && relative.startsWith(value));
  const id = root && relative.slice(root.length + 'capture-'.length, -3);
  if (!root || !UUID.test(id || '') || `${root}capture-${id.toLowerCase()}.md` !== relative) fail('采集目标路径无效', 'PATH_FORBIDDEN', 403);
  return relative;
}
// The caller supplies only a fixed capture path/ancestor, or an already approved
// source note. Even a link resolving inside the Vault is rejected for new saves.
function assertCaptureLocation(root, relative, allowMissing = false, binary = false) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || /[\\\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) fail('采集路径无效', 'PATH_FORBIDDEN', 403);
  const parts = relative.split('/'); let current = root, missing = false;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]); let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!allowMissing) fail('来源或采集文件已移动或删除', 'NOT_FOUND', 404);
      missing = true; continue;
    }
    if (stat.isSymbolicLink()) fail('采集路径不能经过文件链接', 'PATH_FORBIDDEN', 403);
    const directory = index < parts.length - 1 || (!binary&&!relative.endsWith('.md'));
    if (directory ? !stat.isDirectory() : !stat.isFile()) fail('采集路径已被其他文件占用', 'CAPTURE_PATH_OCCUPIED', 409);
    if (!fs.realpathSync(current).startsWith(`${root}${path.sep}`)) fail('采集路径不能指向仓库之外', 'PATH_FORBIDDEN', 403);
  }
  return !missing;
}
function hasCaptureOperation(markdown, input) {
  let fields; try { fields = frontmatterOf(markdown); } catch { fail('采集目标已有无法核对的内容', 'CAPTURE_PATH_OCCUPIED', 409); }
  if (fields.type !== 'material' || fields.record_type !== 'excerpt' || fields.id !== `capture-${input.operationId}` || fields.capture_operation_id !== input.operationId || !/^[a-f0-9]{64}$/.test(fields.capture_fingerprint || '')) fail('采集目标已有其他内容，请保留草稿并核对', 'CAPTURE_PATH_OCCUPIED', 409);
  if (fields.capture_fingerprint !== input.fingerprint) fail('操作标识已用于不同的采集内容，请保留草稿', 'OPERATION_REUSED', 409);
  return true;
}
function createCapture(input, now = new Date().toISOString()) {
  const fields = { type: 'material', record_type: 'excerpt', status: 'inbox', id: `capture-${input.operationId}`, title: input.title, caption: input.caption, tags: input.tags, origin: input.sourcePath ? 'local-excerpt' : input.sourceUrl ? 'web-excerpt' : 'manual-excerpt', rights: 'unknown', captured_at: now, source_url: input.sourceUrl, source_title: input.sourceTitle, author: input.author, source_page: input.page, source_location: input.sourceLocation, source_note: input.sourcePath, source_note_sha256: input.expectedSourceHash, excerpt_sha256: hash(input.body), import_fingerprint: input.importFingerprint, capture_operation_id: input.operationId, capture_fingerprint: input.fingerprint };
  if(input.attachment)Object.assign(fields,{original_file:input.attachment.path,original_name:input.attachment.name,original_mime:input.attachment.type,original_size:input.attachment.size,original_sha256:input.attachment.sha256});
  return `---\n${YAML.stringify(fields, { lineWidth: 0 })}---\n${input.body}`;
}

module.exports = { ROOTS, ATTACHMENT_TYPES, capturePaths, validateCaptureInput, assertCapturePath, assertCaptureLocation, hasCaptureOperation, createCapture };
