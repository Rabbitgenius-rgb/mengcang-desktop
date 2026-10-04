// Pure browser fixture; no production entry imports this module.
// Every note, asset and write below is synthetic. No Vault, IPC or network access.
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/styles.css';
import './desktop-schedule.css';

const NS = 'mengcang:work-overview:20260930:v1';
const TIME_ZONE = 'Asia/Shanghai';
const IDENTITY = {id: 'qa-schedule-fictional-vault', name: '工作总览 QA · 纯虚构仓库', path: 'fixture://schedule-browser-only'};
const PATHS = {entry: 'qa-schedule/entries/窗边的一分钟.md', image: 'qa-schedule/materials/午后叶影.md', book: 'qa-schedule/books/缓慢观察手册.md', project: 'qa-schedule/projects/窗边观察计划.md'};
const IDS = Array.from({length: 6}, (_, i) => `b4372040-61f6-4f1b-909a-${String(i + 1).padStart(12, '0')}`);
const clone = value => value === undefined ? undefined : structuredClone(value);
const hash = revision => Number(revision).toString(16).padStart(64, '0');
const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const at = (day, clock) => new Date(`${day}T${clock}:00+08:00`).toISOString();
const fail = (code, message) => {throw Object.assign(new Error(message), {code});};
const load = (suffix, fallback) => {try {return JSON.parse(localStorage.getItem(`${NS}:${suffix}`)) ?? fallback;} catch {return fallback;}};
const counters = () => ({scheduleCreates: 0, scheduleUpdates: 0, scheduleAttempts: 0, idempotentReplays: 0, conflicts: 0, saveFailures: 0, draftWrites: 0, noteWrites: 0, preferenceWrites: 0, openCalls: 0, externalEdits: 0});
const schedulePath = id => `03_projects/_schedule/${id}.md`;

function asSchedule(id, fields, revision, createdAt = now()) {
  return {schemaVersion:2,id, path: schedulePath(id), kind: 'schedule', ...clone(fields), hash: hash(revision), createdAt, updatedAt: now(), body: `# ${fields.title}\n\n${fields.notes || ''}`, tags: [], projectIds: fields.projectId ? [fields.projectId] : []};
}

function seed() {
  const day = today(), timestamp = at(day, '08:00');
  const common = {createdAt: timestamp, tags: [], projectIds: ['qa-schedule-project'], explorations: [], summaryStatus: 'pending'};
  const records = [
    {...common, id: 'qa-schedule-entry', path: PATHS.entry, kind: 'entry', title: '窗边的一分钟', role: 'seed', category: '观察与叙事', description: '把午后的一个片刻留给安静观察。此条仅为日程来源预览回归而写。', fields: {role: 'seed', category: '观察与叙事', caption: '叶影缓缓移动，给窗边留下一分钟。'}, materialPaths: [PATHS.image], linkedPaths: [PATHS.book], body: '# 窗边的一分钟\n\n不急着记录结论，先观察光从哪一边走进来。\n\n这是纯虚构的 QA 灵感。可对照 [[qa-schedule/materials/午后叶影.md|午后叶影]]，或翻开 [[qa-schedule/books/缓慢观察手册.md|缓慢观察手册]]。'},
    {...common, id: 'qa-schedule-image', path: PATHS.image, kind: 'image', title: '午后叶影', role: 'material', category: '光影', attachmentPath: 'qa-schedule-assets/leaf.svg', originalPath: 'qa-schedule-assets/leaf.svg', fields: {role: 'material', category: '光影', caption: '由几片几何叶形组成的 QA 合成图。'}, body: '# 午后叶影\n\n这是 fixture 自己绘制的 SVG，不来自真实照片或附件。'},
    {...common, id: 'qa-schedule-book', path: PATHS.book, kind: 'book', title: '缓慢观察手册', author: '虚构作者', readingStatus: 'reading', coverPath: 'qa-schedule-assets/book.svg', originalPath: 'qa-schedule-assets/imaginary-book.pdf', fields: {pages: 120, reading_position: {page: 24}, publisher: 'QA 虚构出版社', caption: ''}, body: '# 缓慢观察手册\n\n一本为界面回归虚构的书，不包含真实 PDF。'},
    {...common, id: 'qa-schedule-project', path: PATHS.project, kind: 'project', title: '窗边观察计划', fields: {caption: ''}, body: '# 窗边观察计划\n\n这是 QA 项目，来源与日程均为模拟数据。'},
  ].map((record, index) => ({...record, hash: hash(index + 1)}));
  const base = {notes: '', plannedStart: null, plannedEnd: null, timeZone: TIME_ZONE, projectId: 'qa-schedule-project', sourcePath: '', status: 'todo',workState:'idle',focusDate:null,focusOrder:null,progressNote:'',progressUpdatedAt:null,waitingReason:'',dueAt:null};
  const schedules = [
    {title: '整理窗边观察线索', notes: '待安排。先整理已有想法，再决定具体时间。', sourcePath: PATHS.entry},
    {title: '读一段缓慢观察手册', notes: '待安排。只是一条人工建立的阅读计划。', sourcePath: PATHS.book},
    {title: '上午的光影记录', notes: '上午 09:00–10:00，记录窗边的光线变化。', plannedStart: at(day, '09:00'), plannedEnd: at(day, '10:00'), sourcePath: PATHS.image},
    {title: '午后整理观察笔记', notes: '下午 14:00–15:00，整理今天的观察。', plannedStart: at(day, '14:00'), plannedEnd: at(day, '15:00'), sourcePath: PATHS.entry},
    {title: '重叠的叶影速写', notes: '下午 14:30–15:30，与整理观察笔记重叠半小时。', plannedStart: at(day, '14:30'), plannedEnd: at(day, '15:30'), sourcePath: PATHS.image},
    {title: '完成晨间阅读', notes: '已完成的示例。可检查完成状态在待安排区和时间轴中的处理。', plannedStart: at(day, '07:30'), plannedEnd: at(day, '08:00'), sourcePath: PATHS.book, status: 'done'},
  ].map((fields, index) => asSchedule(IDS[index], {...base,...fields,...(index===0?{focusDate:day,focusOrder:1024,workState:'doing',progressNote:'整理了第一组线索',progressUpdatedAt:timestamp,dueAt:at(day,'18:00')}:index===1?{focusDate:day,focusOrder:2048,workState:'waiting',waitingReason:'先读哪一章？需要你选定范围。',progressNote:'已确认原书',progressUpdatedAt:timestamp}:index===2?{projectId:'',progressNote:'试拍已完成',progressUpdatedAt:timestamp}:index===4?{projectId:'missing-project'}:{})}, index + 10, timestamp));
  return {seedDate: day, records, schedules, revision: 30, operations: {}, counters: counters()};
}

let state = load('state', null) || seed();
let drafts = load('drafts', {});
let preferences = load('preferences', {view: 'projects', reducedMotion: true});
let online = true, legacy = false, workLegacy = false, failNextSave = false, lastReadScheduleId = null;
let lastAction = `已加载 ${state.seedDate} 的 6 条虚构日程；正式 Vault 写入为 0。`;
const listeners = new Set(), qaListeners = new Set();
const publish = () => qaListeners.forEach(listener => listener());
const persist = () => {localStorage.setItem(`${NS}:state`, JSON.stringify(state)); publish();};
const message = value => {lastAction = value; publish();};
const fixtureStatus = () => ({connected: online, paired: true, identity: clone(IDENTITY), capabilities: legacy ? {} : {schedule: true}, message: online ? 'QA 纯模拟连接；所有保存仅在此 fixture 的 localStorage 内。' : 'QA 模拟断线'});
const event = (type = 'change') => listeners.forEach(listener => listener({type, ...(type === 'status' ? {status: fixtureStatus()} : {})}));
const guard = () => {if (!online) fail('OFFLINE', 'QA 模拟断线：保留已读取内容和本机草稿。');};
const recordAt = path => state.records.find(n => n.path === path) || state.schedules.find(n => n.path === path) || fail('NOT_FOUND', `虚构记录不存在：${path}`);
const result = data => ({ok: true, data: clone(data)});
const wrap = fn => async (...args) => {try {return result(await fn(...args));} catch (error) {return {ok: false, error: {code: error.code || 'QA_ERROR', message: error.message}};}};
const fingerprint = input => JSON.stringify([input.action, input.id, input.expectedHash ?? null, Object.keys(input.fields || {}).sort().map(key => [key, input.fields[key]])]);

function validateSchedule(input) {
  if (!['create', 'update'].includes(input?.action)) fail('INVALID_OPERATION', '日程操作必须为 create 或 update。');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id || '')) fail('INVALID_ID', '日程 ID 必须为 UUID。');
  if (!input.operationId || typeof input.operationId !== 'string') fail('INVALID_OPERATION', '保存必须携带稳定 operationId。');
  const f = input.fields;
  if (!f || typeof f.title !== 'string' || !f.title.trim()) fail('INVALID_TITLE', '请填写日程标题。');
  if (typeof f.notes !== 'string') fail('INVALID_NOTES', '日程备注必须是文本。');
  if (!['todo', 'done', 'archived'].includes(f.status)) fail('INVALID_STATUS', '日程状态无效。');
  try {new Intl.DateTimeFormat('en', {timeZone: f.timeZone});} catch {fail('INVALID_TIME_ZONE', '日程时区无效。');}
  if (!f.timeZone) fail('INVALID_TIME_ZONE', '日程必须指定时区。');
  if ((f.plannedStart === null) !== (f.plannedEnd === null)) fail('INVALID_TIME_RANGE', '开始和结束时间需同时填写或同时留空。');
  if (f.plannedStart !== null) {
    if (![f.plannedStart, f.plannedEnd].every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v) && Number.isFinite(Date.parse(v)))) fail('INVALID_TIME_RANGE', '时间必须为 UTC ISO 字符串或 null。');
    if (Date.parse(f.plannedEnd) <= Date.parse(f.plannedStart)) fail('INVALID_TIME_RANGE', '结束时间必须晚于开始时间。');
  }
  const original=state.schedules.find(item=>item.id===input.id);
  if (f.projectId && f.projectId !== original?.projectId && f.projectId !== 'qa-schedule-project') fail('NOT_FOUND', '所选虚构项目不存在。');
  if (f.sourcePath && f.sourcePath!==original?.sourcePath && !state.records.some(n => n.path === f.sourcePath)) fail('NOT_FOUND', '所选虚构来源不存在。');
  if(input.schemaVersion===2 && f.workState==='waiting' && f.status==='todo' && !f.waitingReason?.trim())fail('INVALID_WAITING','请写明等待问题');
  return {...clone(f), title: f.title.trim(), projectId: f.projectId || '', sourcePath: f.sourcePath || ''};
}

function saveSchedule(input) {
  state.counters.scheduleAttempts += 1;
  persist(); guard();
  if (legacy) fail('UNSUPPORTED_CAPABILITY', 'QA 旧连接器未提供日程能力。');
  const saved = Object.hasOwn(state.operations, input?.operationId) ? state.operations[input.operationId] : null;
  if (saved) {
    if (saved.fingerprint !== fingerprint(input)) fail('OPERATION_ID_REUSED', '同一 operationId 不能用于另一份保存内容。');
    state.counters.idempotentReplays += 1;
    lastAction = '重复 operationId 已返回原结果；没有新增模拟写入。';
    persist(); return saved.result;
  }
  const fields = validateSchedule(input);
  const index = state.schedules.findIndex(item => item.id === input.id), current = state.schedules[index];
  if (input.action === 'create' && current || input.action === 'update' && current && current.hash !== input.expectedHash) {
    state.counters.conflicts += 1; persist(); fail('CONFLICT', 'QA 外部修改造成版本冲突：草稿应保留，请核对当前日程。');
  }
  if (input.action === 'update' && !current) fail('NOT_FOUND', '待修改的虚构日程不存在。');
  if (failNextSave) {
    failNextSave = false; state.counters.saveFailures += 1;
    lastAction = '已触发一次模拟保存失败；没有新增或更新日程，草稿应保留。';
    persist(); fail('QA_SAVE_FAILED', 'QA 模拟保存失败，请保留草稿后重试。');
  }
  state.revision += 1;
  if(input.schemaVersion===2){if(fields.status!=='todo' || current && current.status!=='todo')Object.assign(fields,{workState:'idle',focusDate:null,focusOrder:null});fields.progressUpdatedAt=fields.progressNote!==(current?.progressNote || '')?now():current?.progressUpdatedAt || null;}
  const item = asSchedule(input.id, {...current,...fields}, state.revision, current?.createdAt);
  if (current) {state.schedules[index] = item; state.counters.scheduleUpdates += 1;} else {state.schedules.push(item); state.counters.scheduleCreates += 1;}
  const savedResult = {item: clone(item), operationId: input.operationId};
  state.operations[input.operationId] = {fingerprint: fingerprint(input), result: savedResult};
  lastReadScheduleId = item.id;
  lastAction = `模拟${current ? '更新' : '新建'}成功：${item.title}。正式 Vault 写入 0。`;
  persist(); event(); return savedResult;
}

const opened = (method, path) => {guard(); const note = recordAt(path); state.counters.openCalls += 1; lastAction = `${method}：${note.title}（仅模拟，不打开外部软件或链接）。`; persist(); return {opened: true, simulated: true};};

window.mengcang = {
  status: wrap(() => fixtureStatus()),
  pair: wrap(() => {online = true; event('status'); message('已恢复模拟连接，草稿不会自动提交。'); return fixtureStatus();}),
  snapshot: wrap(() => {
    guard();
    return {identity: IDENTITY, entries: state.records.filter(n => n.kind === 'entry'), materials: state.records.filter(n => n.kind === 'image'), books: state.records.filter(n => n.kind === 'book'), projects: [{id: 'qa-schedule-project', path: PATHS.project, title: '窗边观察计划', goal: '', sourcePaths: [{path: PATHS.entry, title: '窗边的一分钟'}]}], ...(legacy ? {} : {schedules: state.schedules, capabilities: {schedule: true,...(!workLegacy?{workOverview:true,scheduleSchemaVersion:2}:{})}}), revision: state.revision, errors: []};
  }),
  scheduleSave: wrap(saveSchedule),
  preferencesGet: wrap(() => preferences),
  preferencesSet: wrap(value => {preferences = {...preferences, ...clone(value)}; localStorage.setItem(`${NS}:preferences`, JSON.stringify(preferences)); state.counters.preferenceWrites += 1; persist(); return {saved: true};}),
  draftGet: wrap(key => drafts[key] ?? null),
  draftSet: wrap((key, value) => {
    const next = {...drafts};
    if (value === null) delete next[key]; else next[key] = clone(value);
    // Commit memory only after localStorage succeeds; null deletion is also atomic.
    localStorage.setItem(`${NS}:drafts`, JSON.stringify(next));
    drafts = next; state.counters.draftWrites += 1; persist(); return {saved: true};
  }),
  readNote: wrap(path => {guard(); const note = recordAt(path); if (note.kind === 'schedule') lastReadScheduleId = note.id; return {note};}),
  related: wrap(path => {guard(); recordAt(path); return {confirmed: [], candidates: [], repair: null};}),
  save: wrap(input => {
    guard(); const note = recordAt(input.path);
    if (note.kind === 'schedule') fail('INVALID_OPERATION', '日程必须通过 scheduleSave 保存。');
    if (note.hash !== input.expectedHash) fail('CONFLICT', 'QA 笔记版本已变化。');
    if (input.kind === 'fields') Object.assign(note.fields, clone(input.fields));
    else if (input.kind === 'exploration') note.explorations.push({id: input.operationId, text: input.text, createdAt: now()});
    else fail('INVALID_OPERATION', '此 fixture 不支持该保存类型。');
    state.revision += 1; note.hash = hash(state.revision); state.counters.noteWrites += 1;
    lastAction = `模拟来源笔记保存：${note.title}；正式 Vault 写入 0。`; persist(); event(); return {note};
  }),
  relation: wrap(() => fail('INVALID_OPERATION', '日程 fixture 没有关联确认候选。')),
  openNote: wrap(path => opened('打开笔记', path)),
  openOriginal: wrap(path => opened('打开原图／原书', path)),
  openSourceLink: wrap(path => opened('打开来源', path)),
  assetUrl: path => {
    const book = String(path).endsWith('book.svg');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${book ? 660 : 360}" viewBox="0 0 480 ${book ? 660 : 360}"><rect width="480" height="660" fill="#e2e7d6"/><rect x="28" y="28" width="424" height="${book ? 604 : 304}" rx="9" fill="none" stroke="#a4b298"/><path d="M98 326 Q182 178 365 58" fill="none" stroke="#789475" stroke-width="6"/><ellipse cx="183" cy="217" rx="60" ry="23" fill="#a8ba8e" transform="rotate(-30 183 217)"/><ellipse cx="285" cy="130" rx="70" ry="25" fill="#8fa780" transform="rotate(18 285 130)"/><text x="240" y="${book ? 453 : 306}" text-anchor="middle" fill="#496343" font-family="sans-serif" font-size="20">${book ? '缓慢观察手册' : '午后叶影'} · QA</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  },
  subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);},
  rendererReady: () => message('真实 DesktopApp 已加载；日程和来源全部为 fixture 虚构数据。'),
};

function currentScheduleId() {
  const selected = document.querySelector('.schedule-inspector[data-schedule-id], [data-schedule-id][aria-pressed="true"], [data-schedule-id][aria-selected="true"], [data-schedule-id][data-selected="true"]');
  return selected?.dataset.scheduleId || lastReadScheduleId || IDS[0];
}
function externalEdit(id = currentScheduleId()) {
  const index = state.schedules.findIndex(item => item.id === id);
  if (index < 0) {message('当前是尚未保存的新建草稿；请先选择一条已有日程。'); return;}
  const item = state.schedules[index], sequence = state.counters.externalEdits + 1;
  state.revision += 1;
  const fields = Object.fromEntries(['title', 'notes', 'plannedStart', 'plannedEnd', 'timeZone', 'projectId', 'sourcePath', 'status','workState','focusDate','focusOrder','progressNote','progressUpdatedAt','waitingReason','dueAt'].map(key => [key, item[key]]));
  state.schedules[index] = asSchedule(item.id, {...fields, notes: `${item.notes}\n\n外部修改 ${sequence}：这段备注来自 QA 工具条。`}, state.revision, item.createdAt);
  state.counters.externalEdits += 1;
  lastAction = `已外部修改“${item.title}”，版本已变化；现有草稿应保留并提示冲突。`;
  persist(); event();
}
function toggleOnline() {online = !online; event('status'); message(online ? '已恢复连接；本机草稿不会自动提交。' : '已模拟断线；应保留当前内容，本机草稿仍可编辑。');}
function toggleLegacy() {legacy = !legacy; event('status'); message(legacy ? '已切换旧连接器：snapshot 不提供 schedules 或 schedule capability。' : '已恢复日程能力；浏览与切换本身没有模拟写入。');}
function toggleWorkLegacy(){workLegacy=!workLegacy;event();message(workLegacy?'模拟 v1 日程连接器：新字段写入禁用。':'恢复工作总览能力。');}
function removeSource(){state.records=state.records.filter(item=>item.path!==PATHS.entry);state.revision++;persist();event();message('已从虚构快照移除来源，日程关联保留。');}
function reset() {for (const suffix of ['state', 'drafts', 'preferences']) localStorage.removeItem(`${NS}:${suffix}`); location.reload();}

function ToolBar() {
  const [, refresh] = useState(0), [expanded, setExpanded] = useState(true), [target, setTarget] = useState('selected');
  const ref = useRef(null);
  useEffect(() => {const listener = () => refresh(n => n + 1); qaListeners.add(listener); return () => qaListeners.delete(listener);}, []);
  useEffect(() => {const measure = () => document.documentElement.style.setProperty('--schedule-qa-height', `${ref.current?.getBoundingClientRect().height || 40}px`); measure(); const observer = new ResizeObserver(measure); observer.observe(ref.current); return () => observer.disconnect();}, []);
  const c = state.counters;
  return <aside ref={ref} className="schedule-qa" aria-label="纯本地工作总览 QA 工具条">
    <div className="schedule-qa-summary"><strong>工作总览 QA · 纯虚构数据</strong><span className={online ? 'qa-online' : 'qa-offline'}>{online ? '模拟在线' : '模拟断线'}</span><output aria-label="模拟日程写入次数">新建 {c.scheduleCreates} · 更新 {c.scheduleUpdates}</output><span className="schedule-qa-vault">正式 Vault 写入 0</span><button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起 QA' : '展开 QA'}</button></div>
    {expanded && <><div className="schedule-qa-controls"><button onClick={toggleOnline}>{online ? '模拟断线' : '恢复连接'}</button><label>修改目标<select aria-label="QA 外部修改目标" value={target} onChange={e => setTarget(e.target.value)}><option value="selected">当前选中日程</option>{state.schedules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button onClick={() => externalEdit(target === 'selected' ? currentScheduleId() : target)}>外部修改选中日程</button><button disabled={failNextSave} onClick={() => {failNextSave = true; message('下一次日程提交将失败一次；不会增加新建或更新计数。');}}>下次保存失败{failNextSave ? '（待触发）' : ''}</button><button aria-pressed={legacy} onClick={toggleLegacy}>{legacy ? '恢复日程能力' : '切换旧连接器'}</button><button onClick={toggleWorkLegacy}>{workLegacy?'恢复总览能力':'切换 v1 日程连接器'}</button><button onClick={removeSource}>移除虚构来源</button><button className="schedule-qa-reset" onClick={reset}>重置 fixture 数据</button></div><div className="schedule-qa-meta"><span>请求 {c.scheduleAttempts} · 幂等重放 {c.idempotentReplays} · 冲突 {c.conflicts} · 失败 {c.saveFailures} · 草稿 {c.draftWrites} · 来源笔记 {c.noteWrites} · 打开 {c.openCalls}</span><span>{state.seedDate} · {TIME_ZONE}</span></div><p role="status">{lastAction}</p></>}
  </aside>;
}

// Read-only inspection for automation. Mutations use the real renderer or QA controls.
window.mengcangWorkQA = {inspect: () => clone({identity: IDENTITY, online, legacy, failNextSave, lastAction, seedDate: state.seedDate, revision: state.revision, records: state.records, schedules: state.schedules, drafts, preferences, counters: state.counters}), storageNamespace: NS};
createRoot(document.getElementById('qa-root')).render(<ToolBar/>);
const {default: DesktopApp} = await import('../../src/DesktopApp.jsx');
createRoot(document.getElementById('root')).render(<DesktopApp/>);
