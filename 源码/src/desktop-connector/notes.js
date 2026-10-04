'use strict';
const { createHash } = require('node:crypto');
const YAML = require('yaml');
const hash = value => createHash('sha256').update(value).digest('hex');
class ConnectorError extends Error {
  constructor(code, message, status = 400, details) { super(message); this.code = code; this.status = status; this.details = details; }
}
function splitNote(source) {
  const match = /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return match ? { yaml: match[2], body: source.slice(match[0].length), prefixLength: match[0].length, bom: match[1], eol: match[0].includes('\r\n') ? '\r\n' : '\n' } : { yaml: '', body: source, prefixLength: 0, bom: '', eol: '\n' };
}
function parseDocument(source) {
  const split = splitNote(source);
  const doc = YAML.parseDocument(split.yaml, { keepSourceTokens: true, uniqueKeys: true });
  if (doc.errors.length) throw new ConnectorError('INVALID_METADATA', '笔记属性无法解析，请先在 Obsidian 中修复', 422);
  if (doc.contents && !YAML.isMap(doc.contents)) throw new ConnectorError('INVALID_METADATA', '笔记属性必须是对象', 422);
  return { split, doc };
}
function frontmatterOf(source) { return parseDocument(source).doc.toJS({ maxAliasCount: 100 }) || {}; }
function setYamlFields(source, patch) {
  const { split, doc } = parseDocument(source);
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new ConnectorError('INVALID_FIELD', '不允许的属性名称');
    const prior = doc.get(key, true);
    const next = doc.createNode(value ?? null);
    if (prior && next) { next.comment = prior.comment; next.commentBefore = prior.commentBefore; next.spaceBefore = prior.spaceBefore; }
    doc.set(key, next);
  }
  const encoded = doc.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, split.eol);
  return `${split.bom}---${split.eol}${encoded}${split.eol}---${split.eol}${split.body}`;
}
const ALLOWED_FIELDS = new Set(['role', 'role_status', 'category', 'tags', 'caption', 'summary_status']);
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new ConnectorError('INVALID_FIELDS', '请提供要修改的内容');
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_FIELDS.has(key)) throw new ConnectorError('FORBIDDEN_FIELD', `此版本不能修改属性 ${key}`, 403);
    if (key === 'tags') {
      if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || v.length > 120)) throw new ConnectorError('INVALID_FIELDS', '标签格式不正确');
    } else if (typeof value !== 'string' || value.length > (key === 'caption' ? 50000 : 300)) throw new ConnectorError('INVALID_FIELDS', '属性格式不正确');
    if (key === 'role' && !['seed', 'material'].includes(value)) throw new ConnectorError('INVALID_FIELDS', '用途必须是起点灵感或参考素材');
    if (['role_status', 'summary_status'].includes(key) && !['pending', 'confirmed'].includes(value)) throw new ConnectorError('INVALID_FIELDS', '确认状态不正确');
  }
  return patch;
}
function operationFingerprint(input) {
  return hash(JSON.stringify({ kind: input.kind, fields: input.kind === 'fields' ? Object.fromEntries(Object.entries(input.fields || {}).sort(([a], [b]) => a.localeCompare(b))) : undefined, text: input.kind === 'exploration' ? input.text?.trim() : undefined, explorationKind: input.kind === 'exploration' ? input.explorationKind || '补充' : undefined }));
}
function validateOperation(input) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId || '')) throw new ConnectorError('INVALID_OPERATION', '操作标识无效');
  if (!/^[a-f0-9]{64}$/.test(input.expectedHash || '')) throw new ConnectorError('INVALID_VERSION', '缺少笔记版本，请刷新后重试');
  if (input.kind === 'fields') validatePatch(input.fields);
  else if (input.kind === 'exploration') {
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100000 || typeof (input.explorationKind || '') !== 'string' || (input.explorationKind || '').length > 100) throw new ConnectorError('INVALID_EXPLORATION', '探索内容为空或过长');
  } else throw new ConnectorError('INVALID_OPERATION', '此操作不受支持');
}
function findOperation(source, id) {
  for (const match of source.matchAll(/<!-- mengcang:(?:operation|exploration) (\{[^\n]*\}) -->/g)) {
    try { const value = JSON.parse(match[1]); if (value.id === id) return value; } catch {}
  }
  return null;
}
function mutateNote(current, input, now = new Date().toISOString()) {
  validateOperation(input);
  const fingerprint = operationFingerprint(input);
  const prior = findOperation(current, input.operationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new ConnectorError('OPERATION_REUSED', '操作标识已被另一项修改使用，请保留草稿并重新保存', 409);
    return current;
  }
  if (hash(current) !== input.expectedHash) throw new ConnectorError('CONFLICT', 'Obsidian 中已有新修改，请核对后保存；草稿仍被保留', 409);
  if (input.kind === 'fields') {
    const next = setYamlFields(current, input.fields);
    return `${next.trimEnd()}\n\n<!-- mengcang:operation ${JSON.stringify({ id: input.operationId, fingerprint })} -->\n`;
  }
  const record = { id: input.operationId, fingerprint, kind: input.explorationKind || '补充', text: input.text.trim(), createdAt: now };
  const marker = JSON.stringify(record).replace(/-->/g, '--\\u003e');
  return `${current.trimEnd()}\n\n${current.includes('## 继续探索') ? '' : '## 继续探索\n\n'}<!-- mengcang:exploration ${marker} -->\n- **${record.kind} · ${now}** ${record.text.replace(/\n/g, '\n  ')}\n`;
}
module.exports = { ConnectorError, hash, splitNote, frontmatterOf, setYamlFields, validatePatch, validateOperation, mutateNote, findOperation, operationFingerprint };
