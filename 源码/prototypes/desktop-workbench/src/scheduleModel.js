import {identityKey} from './desktopModel.js';

export const WORK_FIELDS = ['workState','focusDate','focusOrder','progressNote','progressUpdatedAt','waitingReason','dueAt'];
export const WORK_DEFAULTS = {workState:'idle',focusDate:null,focusOrder:null,progressNote:'',progressUpdatedAt:null,waitingReason:'',dueAt:null};
export const LEGACY_SCHEDULE_FIELDS = ['title','notes','plannedStart','plannedEnd','timeZone','projectId','sourcePath','status'];
export const SCHEDULE_FIELDS = [...LEGACY_SCHEDULE_FIELDS,...WORK_FIELDS];
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const pad = value => String(value).padStart(2,'0');
const wallPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const formatters = new Map();
function parts(value,timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  return Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
export function localDateKey(value=new Date(),timeZone=localTimeZone()) {
  const p=parts(value,timeZone);return `${p.year}-${p.month}-${p.day}`;
}
export function localDateTime(value,timeZone=localTimeZone()) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  const p=parts(value,timeZone);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function addCalendarDays(day,count) {
  const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+count);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
}
// Resolve wall time through IANA offsets. Nonexistent DST times are rejected;
// repeated wall times consistently choose the earlier occurrence.
export function localTimeToIso(wall,timeZone=localTimeZone()) {
  if (!wallPattern.test(wall || '')) return null;
  const naive=Date.parse(`${wall}:00Z`);if (!Number.isFinite(naive)) return null;
  const offsets=new Set();
  try {
    for (const hours of [-36,-12,0,12,36]) {
      const at=naive+hours*3600000,p=parts(at,timeZone);
      offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)-at);
    }
    const matches=[...offsets].map(offset=>naive-offset).filter(at=>localDateTime(at,timeZone)===wall).sort((a,b)=>a-b);
    return matches.length?new Date(matches[0]).toISOString():null;
  } catch { return null; }
}
export function dayBounds(day,timeZone=localTimeZone()) {
  const start=Date.parse(localTimeToIso(`${day}T00:00`,timeZone)),end=Date.parse(localTimeToIso(`${addCalendarDays(day,1)}T00:00`,timeZone));
  return {start,end,minutes:(end-start)/60000};
}
export function clockLabel(iso,timeZone=localTimeZone()) {
  return new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
}
export function scheduleDraftKey(identity,id) { return `${identityKey(identity)}::schedule::${id}`; }
export function scheduleIndexKey(identity) { return `${identityKey(identity)}::schedule::draft-index`; }
export function scheduleFields(item={}) {
  return {...WORK_DEFAULTS,...Object.fromEntries(WORK_FIELDS.filter(key=>item[key]!==undefined).map(key=>[key,item[key]])),title:item.title || '',notes:item.notes || '',plannedStart:item.plannedStart || null,plannedEnd:item.plannedEnd || null,timeZone:item.timeZone || localTimeZone(),projectId:item.projectId || '',sourcePath:item.sourcePath || '',status:['todo','done','archived'].includes(item.status)?item.status:'todo'};
}
export function formFromItem(item={}) {
  const fields=scheduleFields(item);
  return {...fields,plannedStart:localDateTime(fields.plannedStart,fields.timeZone),plannedEnd:localDateTime(fields.plannedEnd,fields.timeZone),dueAt:localDateTime(fields.dueAt,fields.timeZone)};
}
export function draftFromItem(item) {
  const form=formFromItem(item);
  return {version:1,id:item.id,path:item.path || '',baseHash:item.hash || null,baseFields:scheduleFields(item),baseValues:{...form},form,isNew:!item.hash,operationId:null,submittedFields:null};
}
export function scheduleHasChanges(draft) {
  return Boolean(draft && (draft.isNew || SCHEDULE_FIELDS.some(key=>draft.form[key]!==draft.baseValues?.[key])));
}
export function restoreScheduleDraft(saved,item) {
  const fresh=draftFromItem(item);
  if (saved?.version!==1 || saved.id!==item.id || !saved.form || !saved.baseValues) return fresh;
  if (!saved.isNew && !scheduleHasChanges(saved) && item.hash) return fresh;
  return {...saved,baseValues:{...fresh.baseValues,...saved.baseValues},baseFields:saved.baseFields ? {...WORK_DEFAULTS,...saved.baseFields} : (saved.baseHash===item.hash?fresh.baseFields:null),form:{...fresh.form,...saved.form}};
}
export function rebaseScheduleDraft(draft,item) {
  const fresh=draftFromItem(item),form={...fresh.form};
  for (const key of SCHEDULE_FIELDS) if (draft.form[key] !== undefined && draft.form[key]!==draft.baseValues[key]) form[key]=draft.form[key];
  return {...fresh,form,isNew:false,operationId:null,submittedFields:null};
}
export function validateScheduleForm(form,base=null) {
  const errors={};
  if (!form.title?.trim()) errors.title='请填写事项名称。';
  if ((form.title || '').length>300) errors.title='事项名称请保持在 300 字以内。';
  if ((form.notes || '').length>50000) errors.notes='备注请保持在 50,000 字以内。';
  let timeZoneValid=true;try {parts(Date.now(),form.timeZone);}catch {timeZoneValid=false;errors.timeZone='时区无效，请核对本机时区。';}
  const unchanged=field=>base?.baseFields && base.baseValues?.[field]===form[field] && base.baseValues?.timeZone===form.timeZone;
  const plannedStart=unchanged('plannedStart')?base.baseFields.plannedStart:form.plannedStart && timeZoneValid?localTimeToIso(form.plannedStart,form.timeZone):null;
  const plannedEnd=unchanged('plannedEnd')?base.baseFields.plannedEnd:form.plannedEnd && timeZoneValid?localTimeToIso(form.plannedEnd,form.timeZone):null;
  if (form.plannedStart || form.plannedEnd) {
    if (!plannedStart) errors.plannedStart='请选择有效的开始时间。';
    if (!plannedEnd) errors.plannedEnd='请选择有效的结束时间。';
    if (plannedStart && plannedEnd && Date.parse(plannedEnd)<=Date.parse(plannedStart)) errors.plannedEnd='结束时间需要晚于开始时间。';
    else if (plannedStart && plannedEnd && Date.parse(plannedEnd)-Date.parse(plannedStart)>24*3600000) errors.plannedEnd='单个事项最长安排 24 小时，请分开记录。';
  }
  if (!['todo','done','archived'].includes(form.status)) errors.status='事项状态无效。';
  if (!['idle','doing','waiting'].includes(form.workState)) errors.workState='工作状态无效。';
  if (form.status==='todo' && form.workState==='waiting' && !form.waitingReason?.trim()) errors.waitingReason='请写明需要你决定或补资料的问题。';
  if ((form.progressNote || '').length>10000 || (form.waitingReason || '').length>10000) errors.progressNote='进展与等待说明请保持在 10,000 字以内。';
  const dueAt=unchanged('dueAt')?base.baseFields.dueAt:form.dueAt && timeZoneValid?localTimeToIso(form.dueAt,form.timeZone):null;
  if(form.dueAt && !dueAt)errors.dueAt='请选择有效的截止时间。';
  if(form.focusDate!==null && (!/^\d{4}-\d{2}-\d{2}$/.test(form.focusDate) || !localTimeToIso(`${form.focusDate}T12:00`,'UTC')))errors.focusDate='关注日期无效。';
  if((form.focusDate===null)!==(form.focusOrder===null) || form.focusOrder!==null && (!Number.isFinite(form.focusOrder) || Math.abs(form.focusOrder)>1e12))errors.focusOrder='关注顺序无效。';
  return {errors,valid:!Object.keys(errors).length,fields:{...scheduleFields(form),title:form.title?.trim() || '',plannedStart,plannedEnd,dueAt}};
}
export function validateScheduleDraft(draft) { return validateScheduleForm(draft.form,draft); }
export function itemFromDraft(draft,original={}) {
  const result=validateScheduleDraft(draft);
  return {...original,...result.fields,id:draft.id,path:draft.path || original.path || '',hash:draft.baseHash,isLocal:scheduleHasChanges(draft),invalidTime:Boolean(result.errors.plannedStart || result.errors.plannedEnd)};
}
export function uniqueSchedules(items=[]) {
  const seen=new Set(),duplicates=new Set(),unique=[];
  for (const item of items) {
    if (!item?.id) continue;
    if (seen.has(item.id)) {duplicates.add(item.id);continue;}
    seen.add(item.id);unique.push(item);
  }
  return {items:unique,duplicates:[...duplicates]};
}
export function filterSchedules(items,query,{projects=[],sources=[]}={}) {
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const projectNames=new Map(projects.map(p=>[p.id,p.title || p.name || ''])),sourceNames=new Map(sources.map(s=>[s.path,s.title || '']));
  return items.filter(item=>{
    const text=[item.title,item.notes,item.progressNote,item.waitingReason,projectNames.get(item.projectId),sourceNames.get(item.sourcePath)].filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every(word=>text.includes(word));
  });
}
// A connected overlap group shares a column count; endpoint-touching events
// reuse a column, so no card is hidden behind another card.
export function layoutDay(items,day,timeZone=localTimeZone()) {
  const bounds=dayBounds(day,timeZone);
  const segments=uniqueSchedules(items).items.filter(item=>item.status==='todo' && !item.invalidTime && !item.missingOriginal).flatMap(item=>{
    const start=Date.parse(item.plannedStart),end=Date.parse(item.plannedEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start || start>=bounds.end || end<=bounds.start) return [];
    return [{item,start:Math.max(start,bounds.start),end:Math.min(end,bounds.end),continuesBefore:start<bounds.start,continuesAfter:end>bounds.end}];
  }).sort((a,b)=>a.start-b.start || b.end-a.end || a.item.id.localeCompare(b.item.id));
  let group=[],groupEnd=-Infinity;
  const finish=()=>{
    const columns=[];
    for (const segment of group) {
      let column=columns.findIndex(end=>end<=segment.start);
      if (column<0) column=columns.length;
      columns[column]=segment.end;segment.column=column;
    }
    for (const segment of group) segment.columns=columns.length;
    group=[];
  };
  for (const segment of segments) {
    if (group.length && segment.start>=groupEnd) finish();
    group.push(segment);groupEnd=group.length===1?segment.end:Math.max(groupEnd,segment.end);
  }
  finish();
  return {bounds,segments:segments.map(segment=>({...segment,top:(segment.start-bounds.start)/60000,duration:(segment.end-segment.start)/60000}))};
}
export function placeScheduleForm(form,day,minute,timeZone=localTimeZone()) {
  const {start,end}=dayBounds(day,timeZone),old=validateScheduleForm(form).fields;
  const oldDuration=Date.parse(old.plannedEnd)-Date.parse(old.plannedStart);
  const duration=Number.isFinite(oldDuration)&&oldDuration>0?oldDuration:60*60000;
  const nextStart=Math.min(end-15*60000,Math.max(start,start+Math.round(minute/15)*15*60000));
  return {...form,plannedStart:localDateTime(nextStart,form.timeZone),plannedEnd:localDateTime(nextStart+duration,form.timeZone)};
}
export function scheduleColor(id) {
  let hash=0;for (const letter of String(id)) hash=(hash*31+letter.charCodeAt(0))|0;
  return Math.abs(hash)%4;
}
