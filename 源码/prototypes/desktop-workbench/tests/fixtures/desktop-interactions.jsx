// Isolated browser fixture. Production entries never import this module.
// No filesystem, IPC, network API, real Vault, or external application is used.
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/styles.css';
import './desktop-interactions.css';

const NS = 'mengcang:desktop-interactions:20260929:v1';
const IDENTITY = {id: 'qa-fictional-vault', name: '纯本地 QA · 虚构仓库', path: 'fixture://browser-memory-only'};
const PATHS = {
  lantern: 'qa/entries/雨巷灯笼.md',
  courtyard: 'qa/entries/院落的尺度.md',
  letter: 'qa/entries/一封没有寄出的信.md',
  image: 'qa/materials/窗前叶影.md',
  web: 'qa/materials/纸窗实验页面.md',
  text: 'qa/materials/步行摘句.md',
  book: 'qa/books/慢步手册.md',
  project: 'qa/projects/巷口观察计划.md',
};
const clone = value => value === undefined ? undefined : structuredClone(value);
const hash = revision => Number(revision).toString(16).padStart(64, '0');
const now = () => new Date().toISOString();
const fail = (code, message) => {throw Object.assign(new Error(message), {code});};
const load = (suffix, fallback) => {try {return JSON.parse(localStorage.getItem(`${NS}:${suffix}`)) ?? fallback;} catch {return fallback;}};
const freshCounters = () => ({noteWrites: 0, relationWrites: 0, draftWrites: 0, draftFailures: 0, preferenceWrites: 0, openCalls: 0, saveAttempts: 0, relationAttempts: 0, externalEdits: 0});

function seed() {
  const base = {tags: [], projectIds: [], explorations: [], summaryStatus: 'pending', createdAt: '2026-09-29T08:00:00+08:00'};
  const records = [
    {
      id: 'qa-lantern', path: PATHS.lantern, kind: 'entry', title: '雨巷灯笼', role: 'seed', category: '影像与叙事',
      description: '顺着雨后的反光，观察一盏灯怎样把街道变成故事。这是一段只用于界面回归的虚构记录。',
      fields: {role: 'seed', category: '影像与叙事', caption: '琥珀回声：把黄昏留下的亮色写成一个慢慢展开的开场。', summary: '沿着灯光与步行的节奏，寻找一次短片开场。', summary_status: 'pending'},
      tags: ['雨巷', '光影'], projectIds: ['qa-project'], materialPaths: [PATHS.image], linkedPaths: [PATHS.web, PATHS.text],
      body: '# 雨巷灯笼\n\n雨停后，小巷像一本摊开的练习簿。屋檐下的灯映在地面，亮色被鞋底轻轻推开。\n\n## 一个可以继续追问的画面\n\n先让画面保持安静，再出现远处走来的脚步。这个念头只讨论光线和叙述的关系，不对应任何真实项目资料。\n\n可以对照 [[qa/materials/窗前叶影.md|窗前叶影素材]]，也可以读 [[qa/books/慢步手册.md|慢步手册]]。\n\n' + Array.from({length: 9}, (_, i) => `## 观察段落 ${i + 1}\n\n第 ${i + 1} 次停留，观察墙面的反光、人的距离和声音的方向。此处刻意保留足够长的虚构正文，用于核对滚动后切换条目、返回原条目与输入草稿时的交互行为。\n\n- 留下一处明亮的边缘。\n- 比较近处与远处的节奏。`).join('\n\n'),
      explorations: [{id: 'qa-old-exploration', text: '如果镜头保持不动，让倒影先动起来。', createdAt: '2026-09-28T10:00:00+08:00'}],
    },
    {
      id: 'qa-courtyard', path: PATHS.courtyard, kind: 'entry', title: '院落的尺度', role: 'material', category: '空间与体验',
      description: '一把椅子、一片树影和一条可以停留的边界。用于验证筛选后再从关联跳转是否清空旧筛选。',
      fields: {role: 'material', category: '空间与体验', caption: '风铃坐标：在院落边缘给偶遇留一点空间。', summary: '空间比例与停留行为的虚构参考。', summary_status: 'confirmed'},
      summaryStatus: 'confirmed', tags: ['空间', '尺度'], projectIds: [], createdAt: '2026-09-28T08:00:00+08:00',
      body: '# 院落的尺度\n\n把院子想成几种速度的叠加：走过、停住、回头。\n\n## 现场练习\n\n- 沿墙摆放三把不同高度的椅子。\n- 留出一段空白，让人的动作完成构图。\n\n[[qa/entries/雨巷灯笼.md|返回雨巷灯笼]]',
    },
    {
      id: 'qa-letter', path: PATHS.letter, kind: 'entry', title: '一封没有寄出的信', role: 'seed', category: '文字与思考',
      description: '将叙述拆成停顿与空白，尝试让读者在最后一句之前停下来。这条没有日期，用于验证日期待考。',
      fields: {role: 'seed', category: '文字与思考', caption: '', summary: '配文明确为空时，不应回退为这段整理说明。'},
      tags: ['文字', '留白'], createdAt: '',
      body: '# 一封没有寄出的信\n\n有些句子像折痕，展开时还留着之前的方向。\n\n> 留白不是遗漏，而是给下一次阅读留一个入口。\n\n这条笔记的配文刻意留空。',
    },
    {
      id: 'qa-image', path: PATHS.image, kind: 'image', title: '窗前叶影', role: 'material', category: '光影',
      description: '合成叶影图，仅用于测试图片素材。',
      fields: {role: 'material', category: '光影', caption: '银杏余温：窗边的叶片把午后的光切成几小块。'},
      tags: ['光影', '窗边'], projectIds: ['qa-project'], attachmentPath: 'qa-assets/leaf.svg', originalPath: 'qa-originals/leaf.svg',
      body: '# 窗前叶影\n\n这是纯 SVG 绘制的合成图片，未使用真实来源附件。\n\n## 观察\n\n边缘的柔软程度和画面中留白的比例，是这里保留的两条线索。\n\n[[qa/entries/雨巷灯笼.md|查看雨巷灯笼]]',
    },
    {
      id: 'qa-web', path: PATHS.web, kind: 'web', title: '纸窗实验页面', role: 'material', category: '网页',
      description: '虚构页面的摘要，不与配文重复。', createdAt: '2026-09-27T08:00:00+08:00',
      fields: {role: 'material', category: '网页', caption: '苔色信笺：关注纸面层次与窗口之间的切换。', original_share_text: '虚构分享文字：纸窗实验，仅供本地 QA 查看。'},
      tags: ['网页', '留白'], projectIds: [], attachmentPath: 'qa-assets/paper.svg', url: 'https://example.invalid/qa-paper-window',
      body: '# 纸窗实验页面\n\n这里是一段虚构网页笔记正文。来源按钮只写入 QA 日志，不会访问外部网站。\n\n## 原始分享文字\n\n> 虚构分享口令 PAPER-QA。',
    },
    {
      id: 'qa-text', path: PATHS.text, kind: 'text', title: '步行摘句', role: 'material', category: '文字',
      description: '短句与停顿的虚构摘录。', createdAt: '2026-09-26T08:00:00+08:00',
      fields: {role: 'material', category: '文字', caption: '松针絮语：给走路留一点没有目的的时间。'},
      tags: ['文字', '雨巷'], projectIds: ['qa-project'],
      body: '# 步行摘句\n\n走慢一点，听见转角之前的声音。\n\n这是一句为测试新写的虚构文字，不是书籍或真实作者引文。',
    },
    {
      id: 'qa-book', path: PATHS.book, kind: 'book', title: '慢步手册', author: '虚构作者', category: '观察练习',
      description: '一本不存在于现实出版目录的 QA 合成书，用于核对书卡、筛选、原书按钮与阅读进度显示。',
      fields: {pages: 180, reading_position: {page: 36}, publisher: '虚构 QA 出版社', publication_date: '2026', caption: ''},
      tags: ['步行', '观察'], readingStatus: 'reading', coverPath: 'qa-assets/book.svg', originalPath: 'qa-originals/slow-walk.pdf',
      body: '# 慢步手册\n\n虚构书卡，不包含真实 PDF。',
    },
    {
      id: 'qa-project', path: PATHS.project, kind: 'project', title: '巷口观察计划',
      fields: {caption: ''}, body: '# 巷口观察计划\n\n这是 QA 项目笔记。',
    },
  ].map((record, index) => ({...clone(base), ...record, hash: hash(index + 1)}));
  return {records, revision: 20, relations: [{relationId: 'mc-rel-0000000000000001', sourcePath: PATHS.lantern, targetPath: PATHS.text, explanation: '已确认的虚构联系：都以行走时的声音作为叙述线索。'}], operations: {}, counters: freshCounters()};
}

let state = load('state', null) || seed();
let drafts = load('drafts', {});
let preferences = load('preferences', {view: 'inspiration', reducedMotion: true});
let online = true, failNextDraft = false, lastAction = '已加载 3 条灵感、3 份素材、1 本书和 1 个项目。';
const listeners = new Set();
const qaListeners = new Set();
const publish = () => qaListeners.forEach(listener => listener());
const persist = () => {localStorage.setItem(`${NS}:state`, JSON.stringify(state)); publish();};
const message = value => {lastAction = value; publish();};
const event = (type = 'change') => listeners.forEach(listener => listener({type, ...(type === 'status' ? {status: {connected: online, paired: true, identity: IDENTITY}} : {})}));
const guard = () => {if (!online) fail('OFFLINE', 'QA 模拟断线：当前内容可继续查看，修改保留为本机草稿。');};
const recordAt = path => state.records.find(note => note.path === path) || fail('NOT_FOUND', `QA 虚构笔记不存在：${path}`);
const bump = note => {state.revision += 1; note.hash = hash(state.revision);};
const candidates = [
  [PATHS.lantern, PATHS.courtyard, '两条记录分别观察光影与空间尺度，可互相补充。'],
  [PATHS.lantern, PATHS.web, '留白与窗口切换，可以作为短片节奏的另一种参考。'],
  [PATHS.lantern, PATHS.book, '虚构书卡提供慢步观察主题，可继续延伸雨巷想法。'],
  [PATHS.image, PATHS.lantern, '叶影与灯笼都关注亮色的边界和变化。'],
  [PATHS.image, PATHS.web, '图像与纸窗页面共享层次和留白的主题。'],
  [PATHS.courtyard, PATHS.text, '停留与步行形成不同的观察速度。'],
];
const samePair = (relation, a, b) => [relation.sourcePath, relation.targetPath].includes(a) && [relation.sourcePath, relation.targetPath].includes(b);
const fixtureStatus = () => ({connected: online, paired: true, identity: clone(IDENTITY), message: online ? '纯本地 QA 已连接；所有“Obsidian 保存”均为模拟。' : 'QA 模拟断线'});
const opened = (method, path) => {guard(); recordAt(path); state.counters.openCalls += 1; lastAction = `${method}（仅记录，不打开任何软件）：${path}`; persist(); return {opened: true, simulated: true};};

window.mengcang = {
  status: async () => fixtureStatus(),
  pair: async () => {online = true; event('status'); message('QA 模拟重新配对成功。'); return fixtureStatus();},
  snapshot: async () => {
    guard();
    return clone({identity: IDENTITY, entries: state.records.filter(n => n.kind === 'entry'), materials: state.records.filter(n => ['image', 'web', 'text'].includes(n.kind)), books: state.records.filter(n => n.kind === 'book'), projects: [{id: 'qa-project', title: '巷口观察计划', path: PATHS.project, goal: '', sourcePaths: [{path: PATHS.lantern, title: '雨巷灯笼'}, {path: PATHS.courtyard, title: '院落的尺度'}]}], revision: state.revision, errors: []});
  },
  preferencesGet: async () => clone(preferences),
  preferencesSet: async value => {preferences = {...preferences, ...clone(value)}; localStorage.setItem(`${NS}:preferences`, JSON.stringify(preferences)); state.counters.preferenceWrites += 1; persist(); return {saved: true};},
  subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);},
  rendererReady: () => {message('桌面 renderer 已就绪；当前为纯本地虚构数据。');},
  assetUrl: path => {
    const book = path.endsWith('book.svg'), paper = path.endsWith('paper.svg');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${book ? 680 : 360}" viewBox="0 0 480 ${book ? 680 : 360}"><rect width="480" height="680" fill="${paper ? '#e6dcc5' : '#dce7d8'}"/><path d="M80 340 Q230 100 360 40" stroke="#789873" stroke-width="8" fill="none"/><ellipse cx="185" cy="195" rx="66" ry="24" fill="#9ab08a" transform="rotate(-35 185 195)"/><ellipse cx="280" cy="130" rx="62" ry="25" fill="#b4c39b" transform="rotate(20 280 130)"/><rect x="35" y="35" width="410" height="${book ? 600 : 280}" rx="8" fill="none" stroke="#84947b"/><text x="240" y="${book ? 470 : 300}" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#496044">${book ? '慢步手册 · QA 虚构书' : paper ? '纸窗 · QA 合成预览' : '叶影 · QA 合成图'}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  },
  draftGet: async key => clone(drafts[key]),
  draftSet: async (key, value) => {
    // Match the desktop bridge: null deletes a draft only after persistence succeeds.
    // A failed deletion must keep the previous cached draft available for recovery.
    if (value !== null) drafts[key] = clone(value);
    if (failNextDraft) {
      failNextDraft = false;
      if (drafts[key]) drafts[key].localSaveError = true;
      state.counters.draftFailures += 1;
      lastAction = value === null ? '已触发一次草稿删除失败：原草稿仍在内存和草稿 localStorage 中。' : '已触发一次草稿保存失败：文本仍在当前页内存，未写入草稿 localStorage。';
      persist();
      fail('LOCAL_DRAFT_WRITE_FAILED', 'QA 模拟磁盘空间不足（仅本次草稿持久化失败）');
    }
    const next = {...drafts};
    if (value === null) delete next[key];
    else delete next[key].localSaveError;
    localStorage.setItem(`${NS}:drafts`, JSON.stringify(next));
    drafts = next;
    state.counters.draftWrites += 1;
    persist();
    return {saved: true};
  },
  readNote: async path => {guard(); return {note: clone(recordAt(path))};},
  save: async input => {
    state.counters.saveAttempts += 1;
    persist(); guard();
    if (state.operations[input.operationId]) return clone(state.operations[input.operationId]);
    const note = recordAt(input.path);
    if (note.hash !== input.expectedHash) fail('CONFLICT', 'QA 模拟外部编辑：笔记版本已变化。');
    if (input.kind === 'fields') {
      Object.assign(note.fields, clone(input.fields));
      for (const key of ['role', 'category', 'tags']) if (key in input.fields) note[key] = clone(input.fields[key]);
      if ('summary_status' in input.fields) note.summaryStatus = input.fields.summary_status;
    } else if (input.kind === 'exploration') {
      note.explorations.push({id: input.operationId, text: input.text, kind: input.explorationKind, createdAt: now()});
    } else fail('INVALID_OPERATION', 'QA fixture 不支持此保存类型。');
    bump(note); state.counters.noteWrites += 1;
    const result = {note: clone(note)};
    state.operations[input.operationId] = result;
    lastAction = `模拟笔记保存成功：${note.title}（${input.kind}），未接触正式 Vault。`;
    persist(); event(); return clone(result);
  },
  related: async path => {
    guard(); recordAt(path);
    const confirmed = state.relations.filter(r => [r.sourcePath, r.targetPath].includes(path)).map(r => {const peerPath = r.sourcePath === path ? r.targetPath : r.sourcePath; return {...r, peerPath, targetPath: peerPath, title: recordAt(peerPath).title};});
    const pending = candidates.filter(([source, target]) => source === path && !state.relations.some(r => samePair(r, source, target))).map(([source, target, explanation], index) => ({id: `qa-preview-${index}`, targetPath: target, title: recordAt(target).title, explanation}));
    return clone({confirmed, candidates: pending, repair: null});
  },
  relation: async input => {
    state.counters.relationAttempts += 1;
    persist(); guard();
    if (state.operations[input.operationId]) return clone(state.operations[input.operationId]);
    const source = recordAt(input.sourcePath), target = recordAt(input.targetPath);
    if (source.hash !== input.sourceHash || target.hash !== input.targetHash) fail('CONFLICT', 'QA 关联两端版本发生变化。');
    const existing = state.relations.find(r => samePair(r, source.path, target.path));
    if (input.action === 'confirm' && !existing) state.relations.push({relationId: `mc-rel-${(state.revision + 1).toString(16).padStart(16, '0')}`, sourcePath: source.path, targetPath: target.path, explanation: input.explanation});
    else if (input.action === 'revoke') state.relations = state.relations.filter(r => r !== existing);
    else if (input.action !== 'confirm') fail('INVALID_OPERATION', 'QA fixture 不支持此关联操作。');
    bump(source); bump(target); state.counters.relationWrites += 1;
    const result = {saved: true, simulated: true};
    state.operations[input.operationId] = result;
    lastAction = `模拟关联${input.action === 'confirm' ? '确认' : '撤回'}：${source.title} ↔ ${target.title}。`;
    persist(); event(); return clone(result);
  },
  openNote: async path => opened('打开笔记', path),
  openOriginal: async path => opened('打开原图／原书', path),
  openSourceLink: async path => opened('打开来源链接', path),
};

function ToolBar() {
  const [, refresh] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [target, setTarget] = useState(PATHS.lantern);
  const [compact, setCompact] = useState(false);
  useEffect(() => {const listener = () => refresh(n => n + 1); qaListeners.add(listener); return () => qaListeners.delete(listener);}, []);
  useEffect(() => {document.body.dataset.qaExpanded = String(expanded);}, [expanded]);
  useEffect(() => {document.body.dataset.qaCompact = String(compact);}, [compact]);
  const disconnect = () => {online = !online; event('status'); message(online ? '已恢复 QA 连接；草稿不会自动提交。' : '已模拟断线；模拟正式保存按钮应禁用，本机草稿仍可输入。');};
  const externalEdit = () => {
    const note = recordAt(target);
    note.fields.caption = `外部版本 ${state.counters.externalEdits + 1}：这是 QA 工具条模拟的另一处编辑。`;
    note.category = `外部分类 ${state.counters.externalEdits + 1}`;
    note.fields.category = note.category;
    bump(note); state.counters.externalEdits += 1;
    lastAction = `已模拟外部编辑：${note.title}。先有本机草稿时，应出现版本冲突提示。`;
    persist(); event();
  };
  const reset = () => {for (const suffix of ['state', 'drafts', 'preferences']) localStorage.removeItem(`${NS}:${suffix}`); location.reload();};
  const c = state.counters;
  return <aside className="qa-toolbar" aria-label="纯本地 QA 工具条">
    <div className="qa-summary"><strong>QA · 纯虚构数据</strong><span className={online ? 'qa-online' : 'qa-offline'}>{online ? '模拟在线' : '模拟断线'}</span><output aria-label="模拟正式写入次数">笔记写入 {c.noteWrites} · 关联写入 {c.relationWrites}</output><span>正式 Vault 写入 0（未连接）</span><button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起 QA' : '展开 QA'}</button></div>
    {expanded && <div className="qa-expanded">
      <div className="qa-controls"><button onClick={disconnect}>{online ? '模拟断线' : '恢复连接'}</button><label>冲突目标<select aria-label="外部编辑目标" value={target} onChange={e => setTarget(e.target.value)}>{state.records.filter(n => ['entry', 'image', 'web', 'text'].includes(n.kind)).map(n => <option key={n.path} value={n.path}>{n.title}</option>)}</select></label><button onClick={externalEdit}>外部编辑冲突</button><button disabled={failNextDraft} onClick={() => {failNextDraft = true; message('已设置：下一次输入触发的 draftSet 将失败一次。');}}>下一次草稿保存失败{failNextDraft ? '（待触发）' : ''}</button><label className="qa-check"><input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)}/>540px 高度滚动测试</label><button className="qa-reset" onClick={reset}>重置测试数据</button></div>
      <div className="qa-stats" aria-label="QA 写入统计">草稿写入 {c.draftWrites} · 草稿失败 {c.draftFailures} · 偏好写入 {c.preferenceWrites} · 打开请求 {c.openCalls} · 保存请求 {c.saveAttempts} · 关联请求 {c.relationAttempts} · 外部模拟编辑 {c.externalEdits}</div>
      <p className="qa-message" role="status">{lastAction}</p>
    </div>}
  </aside>;
}

// Exposed read-only QA inspection data; application code does not depend on this.
window.mengcangQA = {inspect: () => clone({identity: IDENTITY, online, failNextDraft, counters: state.counters, revision: state.revision, preferences, records: state.records, drafts, relations: state.relations, lastAction}), storageNamespace: NS};
createRoot(document.getElementById('qa-root')).render(<ToolBar/>);
const {default: DesktopApp} = await import('../../src/DesktopApp.jsx');
createRoot(document.getElementById('root')).render(<DesktopApp/>);
