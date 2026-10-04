'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ConnectorError, hash, frontmatterOf, setYamlFields, splitNote } = require('./notes');

const SCHEDULE_ROOT = '03_projects/_schedule/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const START = '<!-- mengcang:schedule-notes:start -->';
const END = '<!-- mengcang:schedule-notes:end -->';
const WORK_KEYS = ['workState', 'focusDate', 'focusOrder', 'progressNote', 'progressUpdatedAt', 'waitingReason', 'dueAt'];
const WORK_DEFAULTS = { workState: 'idle', focusDate: null, focusOrder: null, progressNote: '', progressUpdatedAt: null, waitingReason: '', dueAt: null };
const KEYS = ['title', 'notes', 'plannedStart', 'plannedEnd', 'timeZone', 'projectId', 'sourcePath', 'status'];
const fail = (message, code = 'INVALID_SCHEDULE', status = 400) => { throw new ConnectorError(code, message, status); };

function schedulePath(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('日程标识无效');
  return `${SCHEDULE_ROOT}${id.toLowerCase()}.md`;
}
function isSchedulePath(value) { return typeof value === 'string' && value.startsWith(SCHEDULE_ROOT); }
function assertSchedulePath(value) {
  const id = typeof value === 'string' && value.slice(SCHEDULE_ROOT.length, -3);
  if (!isSchedulePath(value) || !value.endsWith('.md') || !UUID.test(id) || schedulePath(id) !== value) fail('日程文件路径无效', 'PATH_FORBIDDEN', 403);
  return value;
}
function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) fail('日程时间必须是有效的 UTC 时间');
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) fail('日程时间无效');
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction || '').padEnd(3, '0')}Z`);
  if (new Date(stamp).toISOString() !== normalized) fail('日程时间无效');
  return normalized;
}
function scheduleFields(fields, schemaVersion = 1) {
  const keys = schemaVersion === 2 ? [...KEYS, ...WORK_KEYS] : KEYS;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail('日程字段不完整或包含不支持的属性');
  if (typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 300) fail('请填写不超过 300 字的日程标题');
  if (typeof fields.notes !== 'string' || fields.notes.length > 50000 || /<!--\s*mengcang:schedule/i.test(fields.notes)) fail('日程说明过长或包含保留的管理标记');
  if (typeof fields.timeZone !== 'string' || fields.timeZone.length > 100 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(fields.timeZone)) fail('请选择有效的 IANA 时区');
  try { new Intl.DateTimeFormat('en', { timeZone: fields.timeZone }).format(0); } catch { fail('请选择有效的 IANA 时区'); }
  if (typeof fields.projectId !== 'string' || fields.projectId.length > 200 || typeof fields.sourcePath !== 'string' || fields.sourcePath.length > 2048) fail('日程项目或来源格式不正确');
  if (!['todo', 'done', 'archived'].includes(fields.status)) fail('日程状态无效');
  let plannedStart = null, plannedEnd = null;
  if (fields.plannedStart !== null || fields.plannedEnd !== null) {
    plannedStart = utc(fields.plannedStart); plannedEnd = utc(fields.plannedEnd);
    const duration = Date.parse(plannedEnd) - Date.parse(plannedStart);
    if (duration <= 0 || duration > 24 * 60 * 60 * 1000) fail('结束时间必须晚于开始时间，且单项日程不能超过 24 小时');
  }
  const work = schemaVersion === 2 ? workFields(fields) : {};
  return { ...work, title: fields.title.trim(), notes: fields.notes.replace(/\r\n?/g, '\n'), plannedStart, plannedEnd, timeZone: fields.timeZone, projectId: fields.projectId, sourcePath: fields.sourcePath, status: fields.status };
}
function workFields(fields) {
  if (!['idle', 'doing', 'waiting'].includes(fields.workState)) fail('工作状态无效');
  if (fields.focusDate !== null && (typeof fields.focusDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fields.focusDate) || !Number.isFinite(Date.parse(`${fields.focusDate}T00:00:00Z`)) || new Date(`${fields.focusDate}T00:00:00Z`).toISOString().slice(0,10) !== fields.focusDate)) fail('关注日期无效');
  if (fields.focusOrder !== null && (typeof fields.focusOrder !== 'number' || !Number.isFinite(fields.focusOrder) || Math.abs(fields.focusOrder) > 1e12)) fail('关注顺序无效');
  if ((fields.focusDate === null) !== (fields.focusOrder === null)) fail('关注日期与顺序需同时填写');
  for (const key of ['progressNote', 'waitingReason']) if (typeof fields[key] !== 'string' || fields[key].length > 10000) fail('进展或等待说明请保持在 10,000 字以内');
  if (fields.status === 'todo' && fields.workState === 'waiting' && !fields.waitingReason.trim()) fail('请写明需要你决定或补充的内容');
  return { workState: fields.workState, focusDate: fields.focusDate, focusOrder: fields.focusOrder, progressNote: fields.progressNote.replace(/\r\n?/g, '\n'), progressUpdatedAt: fields.progressUpdatedAt === null ? null : utc(fields.progressUpdatedAt), waitingReason: fields.waitingReason.replace(/\r\n?/g, '\n'), dueAt: fields.dueAt === null ? null : utc(fields.dueAt) };
}
function normalizedWork(fields, previous, now) {
  const next = { ...fields };
  if (next.status !== 'todo' || previous && previous.status !== 'todo' && next.status === 'todo') Object.assign(next, { workState: 'idle', focusDate: null, focusOrder: null });
  next.progressUpdatedAt = next.progressNote !== (previous?.progressNote || '') ? now : previous?.progressUpdatedAt || null;
  return next;
}
function validateScheduleInput(input) {
  if (!input || !['create', 'update'].includes(input.action)) fail('不支持此日程操作');
  const schemaVersion = input.schemaVersion ?? 1;
  if (![1, 2].includes(schemaVersion)) fail('日程版本不受支持');
  const path = schedulePath(input.id);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId || '')) fail('缺少稳定日程操作标识', 'INVALID_OPERATION');
  if (input.action === 'update' && !/^[a-f0-9]{64}$/.test(input.expectedHash || '')) fail('缺少日程版本，请刷新后重试', 'INVALID_VERSION');
  return { action: input.action, id: input.id.toLowerCase(), path, operationId: input.operationId, expectedHash: input.expectedHash, schemaVersion, fields: scheduleFields(input.fields, schemaVersion) };
}
function notesBlock(markdown) {
  const body = splitNote(markdown).body;
  const start = body.indexOf(START), end = body.indexOf(END);
  if (start < 0 || end < start || body.indexOf(START, start + START.length) !== -1 || body.indexOf(END, end + END.length) !== -1) fail('日程说明区块缺失或重复，请先在 Obsidian 中核对', 'INVALID_SCHEDULE', 422);
  const interior = body.slice(start + START.length, end);
  if (!/^\r?\n/.test(interior) || !/\r?\n$/.test(interior)) fail('日程说明区块格式不正确', 'INVALID_SCHEDULE', 422);
  return { body, start, end: end + END.length, notes: interior.replace(/^\r?\n/, '').replace(/\r?\n$/, '').replace(/\r\n/g, '\n') };
}
function toSchedule(relative, markdown) {
  assertSchedulePath(relative);
  const metadata = frontmatterOf(markdown);
  if (metadata.record_type !== 'schedule' || ![1, 2].includes(metadata.schema_version) || typeof metadata.id !== 'string' || schedulePath(metadata.id) !== relative) fail('此文件不是匹配的梦藏日程记录', 'SCHEDULE_PATH_OCCUPIED', 409);
  const block = notesBlock(markdown);
  const fields = scheduleFields({ title: metadata.title, notes: block.notes, plannedStart: metadata.planned_start, plannedEnd: metadata.planned_end, timeZone: metadata.time_zone, projectId: metadata.project_id, sourcePath: metadata.source_path, status: metadata.status, ...(metadata.schema_version === 2 ? { workState: metadata.work_state, focusDate: metadata.focus_date, focusOrder: metadata.focus_order, progressNote: metadata.progress_note, progressUpdatedAt: metadata.progress_updated_at, waitingReason: metadata.waiting_reason, dueAt: metadata.due_at } : {}) }, metadata.schema_version);
  return { id: metadata.id.toLowerCase(), kind: 'schedule', path: relative, hash: hash(markdown), schemaVersion: metadata.schema_version, ...WORK_DEFAULTS, ...fields, createdAt: utc(metadata.created_at), updatedAt: utc(metadata.updated_at) };
}
function fingerprint(input) { return hash(JSON.stringify({ action: input.action, id: input.id, fields: input.fields, ...(input.schemaVersion === 2 ? { schemaVersion: 2 } : {}) })); }
function operationRecord(input) { return `<!-- mengcang:schedule-operation ${JSON.stringify({ id: input.operationId, fingerprint: fingerprint(input) })} -->`; }
function hasScheduleOperation(markdown, input) {
  const records = [...splitNote(markdown).body.matchAll(/^<!-- mengcang:schedule-operation (\{[^\r\n]*\}) -->\r?$/gm)];
  for (const [, raw] of records) {
    let record; try { record = JSON.parse(raw); } catch { fail('日程操作记录损坏，请先核对', 'INVALID_SCHEDULE', 422); }
    if (record.id === input.operationId) {
      if (record.fingerprint !== fingerprint(input)) fail('操作标识已用于另一项日程修改，请保留草稿后重新保存', 'OPERATION_REUSED', 409);
      return true;
    }
  }
  return false;
}
function metadataFields(fields, now, schemaVersion = 1) {
  return { title: fields.title, planned_start: fields.plannedStart, planned_end: fields.plannedEnd, time_zone: fields.timeZone, project_id: fields.projectId, source_path: fields.sourcePath, status: fields.status, updated_at: now, ...(schemaVersion === 2 ? { schema_version: 2, work_state: fields.workState, focus_date: fields.focusDate, focus_order: fields.focusOrder, progress_note: fields.progressNote, progress_updated_at: fields.progressUpdatedAt, waiting_reason: fields.waitingReason, due_at: fields.dueAt } : {}) };
}
function createSchedule(input, now = new Date().toISOString()) {
  const body = `## 日程说明\n\n${START}\n${input.fields.notes}\n${END}\n\n${operationRecord(input)}\n`;
  const fields = input.schemaVersion === 2 ? normalizedWork(input.fields, null, now) : input.fields;
  return setYamlFields(body, { record_type: 'schedule', schema_version: input.schemaVersion, id: input.id, created_at: now, ...metadataFields(fields, now, input.schemaVersion) });
}
function updateSchedule(current, input, now = new Date().toISOString()) {
  const previous = toSchedule(input.path, current);
  if (hasScheduleOperation(current, input)) return current;
  if (hash(current) !== input.expectedHash) fail('日程在 Obsidian 中已有修改，请核对后保存；草稿仍被保留', 'CONFLICT', 409);
  const schemaVersion = Math.max(previous.schemaVersion, input.schemaVersion);
  const fields = schemaVersion === 2 ? normalizedWork({ ...Object.fromEntries(WORK_KEYS.map(key => [key, previous[key]])), ...input.fields }, previous, now) : input.fields;
  const next = setYamlFields(current, metadataFields(fields, now, schemaVersion));
  const split = splitNote(next), block = notesBlock(next), eol = split.eol;
  const replacement = `${START}${eol}${input.fields.notes.replace(/\n/g, eol)}${eol}${END}`;
  const body = `${block.body.slice(0, block.start)}${replacement}${block.body.slice(block.end)}`;
  return `${next.slice(0, split.prefixLength)}${body}${body.endsWith(eol) ? '' : eol}${eol}${operationRecord(input)}${eol}`;
}

// A schedule never follows a link, even when its destination happens to be
// inside the Vault. Missing ancestors are permitted only before explicit create.
function assertScheduleLocation(root, relative, allowMissing = false) {
  if (relative !== SCHEDULE_ROOT.slice(0, -1) && relative !== '03_projects') assertSchedulePath(relative);
  const parts = relative.split('/'); let current = root, missing = false;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]); let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!allowMissing) fail('日程文件已移动或删除', 'NOT_FOUND', 404);
      missing = true; continue;
    }
    if (stat.isSymbolicLink()) fail('日程路径不能经过文件链接', 'PATH_FORBIDDEN', 403);
    const directory = index < parts.length - 1 || !relative.endsWith('.md');
    if (directory ? !stat.isDirectory() : !stat.isFile()) fail('日程路径已被其他文件占用', 'SCHEDULE_PATH_OCCUPIED', 409);
    if (!fs.realpathSync(current).startsWith(`${root}${path.sep}`)) fail('日程路径不能指向仓库之外', 'PATH_FORBIDDEN', 403);
  }
  return !missing;
}

module.exports = { WORK_KEYS, WORK_DEFAULTS, SCHEDULE_ROOT, isSchedulePath, assertSchedulePath, schedulePath, scheduleFields, validateScheduleInput, toSchedule, createSchedule, updateSchedule, hasScheduleOperation, assertScheduleLocation };
