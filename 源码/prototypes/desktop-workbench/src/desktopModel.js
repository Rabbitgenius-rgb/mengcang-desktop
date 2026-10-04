import {notePresentation} from './notePresentation.js';
export const VIEWS = ['inspiration', 'materials', 'books', 'projects', 'schedule'];
export function valueOf(result) {
  if (result?.ok === false || result?.error) {
    const detail = typeof result.error === 'object' ? result.error : {};
    const error = new Error(detail.message || result.message || result.error || '操作没有完成');
    error.code = detail.code || result.code;
    error.details = detail.details || result.details;
    throw error;
  }
  return result?.ok === true && 'data' in result ? result.data : result;
}
export function readableError(error) {
  const code = String(error?.code || '');
  if (/CONFLICT|VERSION_MISMATCH/i.test(code)) return '这份笔记已在其他地方修改。草稿已保留，请核对当前笔记后再保存。';
  if (/VAULT_MISMATCH|WRONG_VAULT/i.test(code)) return '连接到的仓库不是 Personal AI OS，已阻止保存。';
  if (/UNAUTHORIZED|AUTH|401/i.test(code)) return '连接凭据已失效，请在设置中重新配对。';
  if (/MISSING|NOT_FOUND|ENOENT/i.test(code)) return '关联文件不存在或已移动，请在 Obsidian 中核对文件位置。';
  return error?.message || '操作未完成，请检查 Obsidian 连接后重试。';
}
export function connectionErrorMessage(error, status, pairingError) {
  if (error?.code === 'OFFLINE_NO_CACHE') {
    if (pairingError) return readableError(pairingError);
    if (status?.code && !['UNPAIRED','DISCONNECTED','PAUSED'].includes(status.code) && status.connected !== true) return readableError(status);
  }
  return readableError(error);
}
export function isConflict(error) { return /CONFLICT|VERSION_MISMATCH/i.test(String(error?.code || '')) || /冲突|其他地方修改/.test(error?.message || ''); }
export function identityKey(identity) { return String(identity?.id || identity?.vaultId || identity?.path || identity?.vaultPath || 'unpaired'); }
export function noteDraftKey(identity, path) { return `${identityKey(identity)}::${path}`; }
export function tagsOf(tags) { return Array.isArray(tags) ? [...new Set(tags.map(String).filter(Boolean))] : typeof tags === 'string' ? tags.split(/[,，\s]+/).filter(Boolean) : []; }
export function draftFields(record) {
  return {role:record.fields?.role || record.role || 'seed', category:record.category || record.fields?.category || '', tags:tagsOf(record.tags || record.fields?.tags).join('，'), caption:notePresentation(record).caption};
}
export function patchFields(form, base) {
  const result = {};
  for (const key of ['role','category','caption']) if (form[key] !== base[key]) result[key] = form[key];
  if (form.role !== base.role) result.role_status = 'confirmed';
  const tags = tagsOf(form.tags), oldTags = tagsOf(base.tags);
  if (JSON.stringify(tags) !== JSON.stringify(oldTags)) result.tags = tags;
  return result;
}
export function mergeSavedDraft(saved, record) {
  const base = draftFields(record);
  return saved?.path === record.path && saved.baseHash ? {...saved, form:{...base,...saved.form}} : {path:record.path, baseHash:record.hash, baseValues:base, form:base, exploration:'', operationId:null, fieldOperationId:null};
}
export function searchText(record) {
  const fields = record.fields || {};
  const presentation = notePresentation(record);
  const searchableFields = ['title','summary','caption','description','category','source','url','author','publisher','isbn','year','notes','progressNote','waitingReason'];
  const textValue = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.filter(item => typeof item === 'string' || typeof item === 'number').join(' ') : '';
  // Search reader content and explicit display fields, never serialized IDs or metadata.
  return [...searchableFields.flatMap(key => [record[key], fields[key]]), record.tags, fields.tags, presentation.caption, presentation.summary, presentation.body, presentation.rawShare, ...(record.explorations || []).map(item => item.text)]
    .map(textValue).filter(Boolean).join(' ').toLocaleLowerCase();
}
function imagePath(value) {
  if (typeof value !== 'string') return '';
  let relative = value.trim();
  const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(relative);
  if (wiki) relative = wiki[1].split('|')[0].trim();
  if (!relative || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(relative) || /[\\\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i.test(relative) ? relative : '';
}
export function normalizeRecord(record, api, projects = []) {
  const fields = record.fields || {};
  const attachment = [record.coverPath, fields.cover, record.attachmentPath, fields.snapshot_path, fields.original_file].map(imagePath).find(Boolean) || '';
  const isInspiration = record.kind === 'entry' || fields.record_type === 'inspiration';
  const createdDate = record.createdAt || fields.created_at || fields.created || '';
  // Capture and source modification dates do not establish when a fragment was written.
  const date = isInspiration ? createdDate : record.createdAt || fields.captured_at || fields.created_at || fields.created || '';
  const projectIds = Array.isArray(record.projectIds) ? record.projectIds : [];
  let assetUrl = '';
  if (typeof attachment === 'string' && attachment && !/^https?:/i.test(attachment)) assetUrl = api.assetUrl(attachment);
  return {...record, raw:record, real:true, id:record.id || record.path, type:record.kind === 'pattern' ? 'image' : record.kind === 'image' || record.kind === 'web' ? record.kind : fields.media === 'web' ? 'web' : fields.media === 'image' ? 'image' : 'text', summary:record.kind === 'entry' ? (fields.summary || record.description || '') : (record.description || notePresentation(record).caption || ''), caption:notePresentation(record).caption || '', role:record.role === 'material' || fields.role === 'material' ? 'reference' : 'inspiration', confirmed:record.summaryStatus === 'confirmed' || fields.summary_status === 'confirmed', tags:tagsOf(record.tags), projectIds, project:projectIds.map(id=>projects.find(p=>p.id===id)?.title || id).join('、'), date, dateLabel:isInspiration && !date ? '日期待考' : '', source:record.url || fields.url || '', assetUrl, status:({reading:'reading',in_progress:'reading',want:'want','want-to-read':'want',unread:'want',read:'read',finished:'read','在读':'reading','想读':'want','已读':'read','读完':'read'})[record.readingStatus || fields.reading_status] || 'unknown', category:record.category || fields.category || fields.collection || '', author:record.author || fields.author || '', hasReadingPosition:fields.reading_position?.page!=null || fields.reading_page!=null, page:Number(fields.reading_position?.page || fields.reading_page || 0), totalPages:Number(fields.pages || fields.total_pages || record.pages || 0), year:fields.publication_date || fields.publish_date || fields.year || '', publisher:fields.publisher || '', isbn:fields.isbn || ''};
}

export function rebaseDraft(draft, currentRecord) {
  const changes = patchFields(draft.form, draft.baseValues);
  const baseValues = draftFields(currentRecord);
  const form = {...baseValues};
  for (const key of ['role','category','caption']) if (key in changes) form[key] = changes[key];
  if ('tags' in changes) form.tags = changes.tags.join('，');
  const alreadyAdded = draft.operationId && (currentRecord.explorations || []).some(item=>item.id===draft.operationId && item.text===draft.exploration?.trim());
  return {...draft, baseHash:currentRecord.hash, baseValues, form, fieldOperationId:null, exploration:alreadyAdded?'':draft.exploration, operationId:alreadyAdded?null:draft.operationId};
}
