// Recoverable local AI results. This module never reads storage, credentials,
// the Vault, or a model; callers commit its actions in one workspace transaction.
import {INSIGHT_LABELS, generatedInsightCard} from './intelligenceHelpers.js';
import {MAX_ATTACHMENT_BYTES, MAX_OCR_TEXT, safeSourceUrl} from './workspaceModel.js';
import {fingerprintWorkspaceAttachment} from './attachmentFingerprint.js';
export {MAX_OCR_TEXT};

export const AI_RESULT_PREFIX = 'ai-result:';
const modes = new Set([...Object.keys(INSIGHT_LABELS), 'Classification', 'OCR']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw Error(`AI 结果草稿无效：${message}。原结果不会被截断或覆盖。`); };
function object(value, name) { if (!plain(value)) fail(`${name}必须是普通 JSON 对象`); return value; }
function only(value, fields, name) {
  object(value, name);
  if (Object.keys(value).some(key => !fields.includes(key))) fail(`${name}包含未允许的字段`);
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => descriptor.get || descriptor.set)) fail(`${name}不能包含访问器`);
}
function string(value, name, limit = 100000, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) fail(`${name}不是有效文字或超过 ${limit} 字上限`);
  // Text may legitimately quote data URLs (for example OCR of documentation).
  // Raw attachments and credentials are excluded by field allowlists, not by
  // rejecting arbitrary substrings in the user's or model's prose.
  return value;
}
function identifier(value, name) {
  const result = string(value, name, 4096);
  if (!result.trim() || /[\x00-\x1f\x7f]/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) fail(`${name}无效`);
  return result;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) fail('请求标识必须是 UUID');
  return value.toLowerCase();
}
function date(value, name) {
  const result = string(value, name, 100);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) fail(`${name}必须是有效 ISO 日期`);
  return result;
}
function array(value, name, max, normalize) {
  if (!Array.isArray(value) || value.length > max) fail(`${name}不是数组或超过 ${max} 项上限`);
  return value.map(normalize);
}
function attachmentMeta(value, retainHash) {
  object(value, '附件信息');
  const name = string(value.name, '附件名称', 1000), type = string(value.type, '附件类型', 100);
  if (!name.trim() || !type.trim() || /[\x00-\x1f\x7f]/.test(name + type)
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_ATTACHMENT_BYTES) fail('附件信息不完整');
  const result = {name, type, size:value.size};
  if (retainHash && value.sha256 !== undefined) {
    if (typeof value.sha256 !== 'string' || !/^[\da-f]{64}$/i.test(value.sha256)) fail('附件 SHA256 无效');
    result.sha256 = value.sha256.toLowerCase();
  }
  return result;
}

export function aiResultKey(id) { return `${AI_RESULT_PREFIX}${uuid(id)}`; }

export function compactAiSource(source) {
  object(source, '来源快照');
  const result = {id:identifier(source.id, '来源标识')};
  for (const [key, limit] of Object.entries({title:1000, body:1000000, caption:50000, sourceTitle:1000,
    author:1000, createdAt:100, updatedAt:100, date:100, ocrText:MAX_OCR_TEXT, page:1000,
    sourceLocation:1000, importFingerprint:150, originalPath:4096, originalMime:100})) {
    result[key] = string(key === 'page' && Number.isSafeInteger(source[key]) ? String(source[key]) : source[key], `来源 ${key}`, limit);
  }
  result.path = source.path ? identifier(source.path, '来源路径') : result.id;
  result.origin = string(source.origin, '来源类别', 100) || 'local';
  result.type = string(source.type, '来源类型', 100) || 'text';
  result.sourceCardId = source.sourceCardId ? identifier(source.sourceCardId, '原始卡片标识') : '';
  const sourceUrl = string(source.sourceUrl, '来源网址', 100000);
  result.sourceUrl = sourceUrl ? safeSourceUrl(sourceUrl) : '';
  result.tags = array(source.tags ?? [], '来源标签', 20000, tag => string(tag, '标签', 120));
  if (source.version !== undefined) {
    if (typeof source.version !== 'string' && !Number.isFinite(source.version)) fail('来源版本无效');
    result.version = typeof source.version === 'string' ? string(source.version, '来源版本', 100) : source.version;
  }
  if (source.documentIndex !== undefined && source.documentIndex !== null) {
    object(source.documentIndex, '文档文字索引');
    result.documentIndex = {text:string(source.documentIndex.text, '文档文字索引', 1000000), indexedAt:string(source.documentIndex.indexedAt, '索引日期', 100)};
  }
  // A raw attachment can have changed since an earlier digest was captured.
  // Only captureAiSource may associate its newly computed digest with bytes.
  if (source.attachment) result.attachmentMeta = attachmentMeta(source.attachment, false);
  else if (source.attachmentMeta) result.attachmentMeta = attachmentMeta(source.attachmentMeta, true);
  return result;
}

export async function captureAiSource(source) {
  const result = compactAiSource(source);
  if (!source.attachment?.dataUrl) return result;
  result.attachmentMeta = await fingerprintWorkspaceAttachment(source.attachment);
  return result;
}

function normalizeResult(value, mode) {
  only(value, ['mode', 'text', 'tags', 'collectionIds', 'reason', 'engine', 'local', 'usage', 'pages'], '工具结果');
  const result = {};
  if (own(value, 'mode')) { if (value.mode !== mode) fail('响应方式与请求不一致'); result.mode = value.mode; }
  // Earlier versions could persist up to 20 MiB of OCR in a draft, even though
  // it could not be saved to a card. Keep those drafts readable for recovery;
  // new main-process requests and card adoption use MAX_OCR_TEXT.
  if (own(value, 'text')) result.text = string(value.text, '结果正文', mode === 'OCR' ? 20 * 1024 * 1024 : 100000);
  if (mode !== 'Classification' && (typeof result.text !== 'string' || mode !== 'OCR' && !result.text.trim())) fail('结果正文不能为空');
  if (own(value, 'tags') || mode === 'Classification') result.tags = array(value.tags, '建议标签', 8, tag => {
    const checked = string(tag, '建议标签', 50); if (!checked.trim()) fail('建议标签不能为空'); return checked;
  });
  if (own(value, 'collectionIds') || mode === 'Classification') result.collectionIds = array(value.collectionIds, '建议收藏集', 3, entry => identifier(entry, '收藏集标识'));
  if (own(value, 'reason') || mode === 'Classification') result.reason = string(value.reason, '分类理由', 2000);
  if (own(value, 'engine')) result.engine = string(value.engine, '模型名称', 200);
  if (own(value, 'local')) { if (typeof value.local !== 'boolean') fail('本机标记应为布尔值'); result.local = value.local; }
  if (own(value, 'usage')) {
    only(value.usage, ['prompt_tokens', 'completion_tokens', 'total_tokens'], '用量'); result.usage = {};
    for (const [key, count] of Object.entries(value.usage)) {
      if (!Number.isSafeInteger(count) || count < 0) fail('用量必须为非负整数'); result.usage[key] = count;
    }
  }
  if (own(value, 'pages')) {
    if (mode !== 'OCR') fail('只有文字识别结果可包含分页');
    let previous = 0;
    result.pages = array(value.pages, '识别分页', 100, page => {
      only(page, ['page', 'text', 'engine'], '识别页');
      if (!Number.isInteger(page.page) || page.page <= previous || page.page > 100) fail('识别页码无效'); previous = page.page;
      return {page:page.page, text:string(page.text, '识别页正文', 200000), engine:string(page.engine, '识别引擎', 200)};
    });
  }
  return result;
}

export function normalizeAiRecord(record) {
  only(record, ['id', 'mode', 'phase', 'sourceSnapshot', 'result', 'createdAt', 'updatedAt', 'savedCardId', 'error', 'recoveryText'], '请求记录');
  if (!modes.has(record.mode)) fail('解读方式不受支持');
  if (!['pending', 'complete', 'failed'].includes(record.phase)) fail('请求阶段无效');
  if (record.phase !== 'complete' && record.result != null) fail('未完成的请求不能携带结果');
  // Preserve a returned textual response even when it fails the result schema.
  // This is copy-only recovery content, never an adoptable/classification result.
  if (own(record, 'recoveryText') && (typeof record.recoveryText !== 'string' || record.recoveryText.length > MAX_OCR_TEXT)) fail('待核对原文格式无效');
  return {id:uuid(record.id), mode:record.mode, phase:record.phase, sourceSnapshot:compactAiSource(record.sourceSnapshot),
    result:record.phase === 'complete' ? normalizeResult(record.result, record.mode) : null,
    createdAt:date(record.createdAt, '创建时间'), updatedAt:date(record.updatedAt, '更新时间'),
    savedCardId:record.savedCardId ? identifier(record.savedCardId, '保存卡片标识') : '', error:string(record.error, '错误说明', 10000),
    ...(record.phase === 'failed' && own(record, 'recoveryText') ? {recoveryText:record.recoveryText} : {})};
}

export function listAiRecords(drafts) {
  if (!plain(drafts)) return [];
  const records = [];
  for (const [key, value] of Object.entries(drafts)) {
    if (!key.startsWith(AI_RESULT_PREFIX)) continue;
    try { const record = normalizeAiRecord(value); if (key === aiResultKey(record.id)) records.push(record); } catch { /* A corrupt record cannot conceal other recoverable results. */ }
  }
  return records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export function isSameAiSourceVersion(source, current) {
  try {
    const left = compactAiSource(source), right = compactAiSource(current);
    const attachmentRequired = value => !!value.attachmentMeta || !!value.originalPath || !!value.originalMime || ['image', 'file', 'audio', 'video'].includes(value.type);
    if ((attachmentRequired(left) || attachmentRequired(right)) && (!left.attachmentMeta?.sha256 || !right.attachmentMeta?.sha256)) return false;
    return JSON.stringify(left) === JSON.stringify(right);
  } catch { return false; }
}

export function insightSaveActions(existing, record, {now = new Date().toISOString()} = {}) {
  const input = normalizeAiRecord(record), key = aiResultKey(input.id), cardId = `ai-insight:${input.id}`;
  if (input.phase !== 'complete' || !own(INSIGHT_LABELS, input.mode)) fail('只有已完成的解读可另存笔记');
  let latest = input;
  if (existing.drafts?.[key]) {
    latest = normalizeAiRecord(existing.drafts[key]);
    for (const field of ['id', 'mode', 'createdAt', 'sourceSnapshot']) if (JSON.stringify(latest[field]) !== JSON.stringify(input[field])) fail('同一请求的来源或内容已变化，请重新打开历史结果');
    if (latest.phase === 'complete' && JSON.stringify(latest.result) !== JSON.stringify(input.result)) fail('同一请求的结果已变化，请重新打开历史结果');
    latest = {...input, savedCardId:latest.savedCardId || input.savedCardId, updatedAt:latest.updatedAt};
  }
  if (latest.savedCardId && latest.savedCardId !== cardId) fail('保存回执与解读标识不一致');
  const present = existing.cards?.some(card => card.id === cardId);
  if (!present && latest.savedCardId) throw Error('此解读笔记已被移除。已保存回执保留，请先核对资料库；不会自动重新创建。');
  const savedAt = date(now, '保存时间');
  const receipt = normalizeAiRecord({...latest, savedCardId:cardId, updatedAt:Date.parse(savedAt) >= Date.parse(latest.updatedAt) ? savedAt : latest.updatedAt});
  const actions = present ? [] : [
    {type:'card.upsert', card:generatedInsightCard(input.sourceSnapshot, input.mode, input.result, {id:cardId, now:savedAt})},
    {type:'card.save', id:cardId, saved:true},
  ];
  actions.push({type:'draft.set', key, value:receipt});
  return {actions, cardId, created:!present};
}
