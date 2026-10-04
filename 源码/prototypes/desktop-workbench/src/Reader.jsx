import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconSearch, IconX, IconMinus, IconPlus, IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand, IconChevronUp, IconChevronDown, IconCheck, IconFileText, IconLink, IconArrowUpRight, IconTrash } from '@tabler/icons-react';
import { Art } from './common';
import './Reader.css';

const samplePages = [
  {
    chapter: '第二章', title: '在山谷中停留',
    paragraphs: [
      '雾气从山谷中缓缓升起，像一条柔软的河流，漫过树梢，也漫过了时间。我们站在半山腰，四周寂静得只能听见风穿过树林的声音。此刻，世界似乎变得很大，而我们又如此渺小。',
      '但正是在这渺小中，我感到一种久违的平静。那些平日里反复出现的问题，此刻都不再那么迫切。山谷教会我们的，或许不是如何抵达，而是如何在停留中看见更多。',
      '阳光越过远处的山脊，落在脚边的一片叶子上。没有什么催促我们出发。于是，我们坐下来，让一个普通的早晨，慢慢成为值得记住的时光。',
    ],
  },
  {
    chapter: '第二章', title: '光经过的地方',
    paragraphs: [
      '午后的光落在木桌上，缓慢地移动着。那片明亮的形状没有声音，却让人重新注意到房间的轮廓，注意到窗外随风轻动的树影。',
      '我们总是习惯寻找远方的风景，却常常忘记停下来，看看自己所处的地方。一本翻开的书，一杯逐渐变凉的茶，也可以成为生活里安静的入口。',
      '自然并不急于给出答案。它让我们学会观看，学会在寻常的细节里，与自己的感受相遇。',
    ],
  },
  {
    chapter: '第二章', title: '沿着小路向前',
    paragraphs: [
      '山间的小路顺着溪水延伸，每转过一个弯，眼前就会出现不同的景色。我们不再一遍遍确认还有多远，而是听见了脚步、鸟鸣，以及水流的声音。',
      '行走不只是为了到达某个地方。有时候，它是把纷乱的思绪放回身体，让一个问题随着呼吸，慢慢变得清楚。',
      '在这条没有名字的小路上，我想到那些曾经忽略的片刻。原来，生活的丰盛，常常来自我们愿意为一件小事停留多久。',
    ],
  },
];

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countMatches(value, query) { return query ? (value.match(new RegExp(escapeRegExp(query), 'gi')) || []).length : 0; }
const READER_STORAGE = 'mengcang-reader-preview-v1';
const STORAGE_WARNING = '浏览器暂时无法保存阅读状态。当前内容仍可使用，请复制未保存的笔记后再关闭页面。';
let readerSessionState = { version: 1, pages: {} };

function readReaderState() {
  try {
    const raw = localStorage.getItem(READER_STORAGE);
    const value = raw ? JSON.parse(raw) : null;
    if (value?.version === 1 && value.pages && typeof value.pages === 'object' && !Array.isArray(value.pages)) readerSessionState = value;
    return { data: readerSessionState, error: '' };
  } catch {
    return { data: readerSessionState, error: STORAGE_WARNING };
  }
}

export default function Reader({ book, page, onPage, onExit, notes = [], setNotes, notify, reducedMotion }) {
  const [initialPreview] = useState(readReaderState);
  const previewRef = useRef(initialPreview.data);
  const [storageError, setStorageError] = useState(initialPreview.error);
  const storageFailureNotified = useRef(false);
  const [activeTab, setActiveTab] = useState('notes');
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia('(max-width: 820px)').matches);
  const [zoom, setZoom] = useState(100);
  const [pageInput, setPageInput] = useState(String(page));
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [leadState, setLeadState] = useState('candidate');
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationRemoved, setRelationRemoved] = useState(false);
  const documentRef = useRef(null);
  const searchRef = useRef(null);
  const noteRef = useRef(null);
  const requestedNote = useRef(null);
  const draftKey = `${book.id}:${page}`;
  const totalPages = book.totalPages || 280;
  const content = samplePages[((page - 12) % samplePages.length + samplePages.length) % samplePages.length];
  const lead = content === samplePages[0] ? { title: '怎样的环境，让我更容易慢下来？', description: '从「在停留中看见更多」出发，回想一个让自己感到平静的日常空间。', basis: '停留与感受' } : content === samplePages[1] ? { title: '今天，什么细节让我重新看见日常？', description: '从「生活里安静的入口」出发，记下一束光、一阵风，或一个小小的发现。', basis: '日常与观看' } : { title: '如果不急着抵达，我会注意到什么？', description: '从「随着呼吸，慢慢变得清楚」出发，给自己一次没有目的的短暂行走。', basis: '行走与思考' };
  const bookNotes = notes.filter(note => note.bookId === book.id);
  const relatedNotes = bookNotes.filter(note => note.id !== editingId).slice(0, 4);
  const searchQuery = query.trim();
  const textSegments = [content.chapter, content.title, ...content.paragraphs];
  const matchCount = useMemo(() => textSegments.reduce((total, segment) => total + countMatches(segment, searchQuery), 0), [content, searchQuery]);
  const noteChanged = draft.trim() !== (bookNotes.find(note => note.id === editingId)?.text || '').trim();

  useEffect(() => {
    setPageInput(String(page));
    const requested = requestedNote.current;
    const existing = (requested && notes.find(note => note.id === requested)) || notes.find(note => note.bookId === book.id && Number(note.page) === Number(page));
    const pageState = previewRef.current.pages[draftKey] || {};
    const cached = pageState.draft && typeof pageState.draft.text === 'string' ? pageState.draft : null;
    setDraft(cached?.text ?? existing?.text ?? '');
    setEditingId(cached ? cached.id : (existing?.id ?? null));
    requestedNote.current = null;
    setSaved(false);
    setActiveMatch(0);
    setLeadState(['candidate', 'kept', 'skipped'].includes(pageState.leadState) ? pageState.leadState : 'candidate');
    setRelationRemoved(pageState.relationRemoved === true);
    setRelationOpen(false);
    documentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [book.id, page]);

  useEffect(() => {
    if (initialPreview.error && !storageFailureNotified.current) {
      storageFailureNotified.current = true;
      notify?.(STORAGE_WARNING);
    }
  }, []);

  useEffect(() => { setActiveMatch(0); }, [searchQuery]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!searchQuery || !matchCount) return;
    documentRef.current?.querySelector(`[data-match="${activeMatch}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' });
  }, [activeMatch, searchQuery, matchCount, reducedMotion]);

  function persistPage(key, patch) {
    const next = { version: 1, pages: { ...previewRef.current.pages, [key]: { ...previewRef.current.pages[key], ...patch } } };
    previewRef.current = next;
    readerSessionState = next;
    try {
      localStorage.setItem(READER_STORAGE, JSON.stringify(next));
      setStorageError(''); storageFailureNotified.current = false;
      return true;
    } catch {
      setStorageError(STORAGE_WARNING);
      if (!storageFailureNotified.current) { notify?.(STORAGE_WARNING); storageFailureNotified.current = true; }
      return false;
    }
  }
  function persistDraft(text = draft, id = editingId, key = draftKey) {
    return persistPage(key, { draft: { text, id } });
  }
  function changeLead(next) {
    setLeadState(next);
    if (persistPage(draftKey, { leadState: next })) notify?.(next === 'kept' ? '示例引线已保存在此浏览器的原型中' : next === 'skipped' ? '已跳过这条示例引线' : '示例引线已恢复为待确认');
  }
  function changeRelation(removed) {
    setRelationRemoved(removed); setRelationOpen(false);
    if (persistPage(draftKey, { relationRemoved: removed })) notify?.(removed ? '已移除此页的原型关系示例' : '已恢复此页的原型关系示例');
  }
  function navigate(nextPage) {
    const clamped = Math.max(1, Math.min(totalPages, Number(nextPage) || page));
    persistDraft();
    onPage(clamped);
    setPageInput(String(clamped));
  }
  function jumpPage(event) { event.preventDefault(); navigate(pageInput); }
  function updateDraft(value) {
    setDraft(value); setSaved(false);
    persistDraft(value);
  }
  function saveNote() {
    const text = draft.trim();
    if (!text) return;
    const id = editingId || `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry = { id, bookId: book.id, page: Number(page), text, date: new Date().toISOString().slice(0, 10) };
    setNotes(previous => previous.some(note => note.id === id) ? previous.map(note => note.id === id ? { ...note, ...entry } : note) : [entry, ...previous]);
    setEditingId(id); setDraft(text);
    const stored = persistDraft(text, id);
    setSaved(stored);
    if (stored) notify?.('笔记已保存在此浏览器的原型中');
  }
  function newNote() {
    setActiveTab('notes'); setPanelOpen(true); setDraft(''); setEditingId(null); setSaved(false);
    persistDraft('', null);
    window.setTimeout(() => noteRef.current?.focus(), 30);
  }
  function openNote(note) {
    persistDraft();
    requestedNote.current = note.id;
    const nextKey = `${book.id}:${note.page}`;
    const cached = previewRef.current.pages[nextKey]?.draft;
    const restoredText = cached?.id === note.id && typeof cached.text === 'string' ? cached.text : note.text;
    persistDraft(restoredText, note.id, nextKey);
    setDraft(restoredText); setEditingId(note.id); setSaved(false);
    if (Number(note.page) !== Number(page)) onPage(Number(note.page));
    setActiveTab('notes');
  }
  function nextMatch(direction) {
    if (matchCount) setActiveMatch(current => (current + direction + matchCount) % matchCount);
  }
  let offset = 0;
  function highlight(text) {
    if (!searchQuery) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi'));
    return parts.map((part, index) => {
      if (index % 2 === 0) return part;
      const matchIndex = offset++;
      return <mark className={matchIndex === activeMatch ? 'reader-match-active' : ''} data-match={matchIndex} key={`${index}-${matchIndex}`}>{part}</mark>;
    });
  }

  return (
    <section className={`reader-view ${panelOpen ? 'reader-has-panel' : 'reader-panel-closed'}`} aria-label={`阅读 ${book.title}`}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-title">
          <button className="icon-btn" onClick={onExit} aria-label="返回藏书" title="返回藏书"><IconArrowLeft size={18} /></button>
          <span title={book.title}>{book.title}<span className="reader-file-suffix">.pdf</span></span>
          <span className="reader-demo-tag">阅读示例</span>
        </div>
        <div className="reader-toolbar-actions">
          <div className="reader-page-controls">
            <button className="icon-btn" onClick={() => navigate(page - 1)} disabled={page <= 1} aria-label="上一页" title="上一页"><IconChevronLeft size={16} /></button>
            <form onSubmit={jumpPage} className="reader-page-jump">
              <input aria-label="页码，输入后按回车跳转" inputMode="numeric" value={pageInput} onChange={event => setPageInput(event.target.value.replace(/\D/g, ''))} onBlur={() => { if (!pageInput) setPageInput(String(page)); }} />
              <span>/ {totalPages}</span>
            </form>
            <button className="icon-btn" onClick={() => navigate(page + 1)} disabled={page >= totalPages} aria-label="下一页" title="下一页"><IconChevronRight size={16} /></button>
          </div>
          <div className="reader-zoom-controls">
            <button className="icon-btn" onClick={() => setZoom(current => Math.max(70, current - 10))} disabled={zoom <= 70} aria-label="缩小正文" title="缩小"><IconMinus size={15} /></button>
            <button className="reader-zoom-reset" onClick={() => setZoom(100)} title="恢复 100%" aria-label={`当前缩放 ${zoom}%，点击恢复 100%`}>{zoom}%</button>
            <button className="icon-btn" onClick={() => setZoom(current => Math.min(150, current + 10))} disabled={zoom >= 150} aria-label="放大正文" title="放大"><IconPlus size={15} /></button>
          </div>
          <button className={`icon-btn ${searchOpen ? 'reader-tool-active' : ''}`} onClick={() => setSearchOpen(open => !open)} aria-expanded={searchOpen} aria-controls="reader-search" aria-label={searchOpen ? '收起文内搜索' : '搜索当前页'} title="搜索当前页"><IconSearch size={17} /></button>
          <span className="reader-toolbar-divider" />
          <button className={`icon-btn ${panelOpen ? 'reader-tool-active' : ''}`} onClick={() => setPanelOpen(open => !open)} aria-expanded={panelOpen} aria-controls="reader-side-panel" aria-label={panelOpen ? '收起阅读侧栏' : '展开阅读侧栏'} title={panelOpen ? '收起侧栏' : '展开侧栏'}>{panelOpen ? <IconLayoutSidebarRightCollapse size={18} /> : <IconLayoutSidebarRightExpand size={18} />}</button>
        </div>
      </div>

      {storageError && <p className="reader-storage-warning" role="alert">{storageError}</p>}

      {searchOpen && <form id="reader-search" className="reader-search-bar" onSubmit={event => { event.preventDefault(); nextMatch(1); }}>
        <IconSearch size={16} />
        <input ref={searchRef} aria-label="搜索当前页文字" placeholder="搜索当前页文字…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); setQuery(''); } }} />
        <span className="reader-search-count" role="status">{searchQuery ? (matchCount ? `${activeMatch + 1} / ${matchCount}` : '未找到') : '当前页'}</span>
        <button type="button" className="icon-btn" disabled={!matchCount} onClick={() => nextMatch(-1)} aria-label="上一个搜索结果"><IconChevronUp size={15} /></button>
        <button type="button" className="icon-btn" disabled={!matchCount} onClick={() => nextMatch(1)} aria-label="下一个搜索结果"><IconChevronDown size={15} /></button>
        <button type="button" className="icon-btn" onClick={() => { setSearchOpen(false); setQuery(''); }} aria-label="关闭并清除搜索"><IconX size={15} /></button>
      </form>}

      <div className="reader-body">
        <div className="reader-document-scroll" ref={documentRef} tabIndex={0} aria-label="阅读示例正文">
          <div className="reader-page-center">
            <article className="reader-paper" style={{ '--reader-text-scale': zoom / 100 }}>
              <div className="reader-paper-heading"><div>{highlight(content.chapter)}</div><h1>{highlight(content.title)}</h1></div>
              <div className="reader-paper-copy">{content.paragraphs.map((paragraph, index) => <p key={index}>{highlight(paragraph)}</p>)}</div>
              <footer className="reader-paper-page">{page}</footer>
            </article>
            <div className="reader-document-caption">阅读示例 · 演示排版与阅读交互</div>
          </div>
        </div>

        {panelOpen && <aside id="reader-side-panel" className="reader-side-panel" aria-label="阅读侧栏">
          <div className="reader-tabs" role="tablist" aria-label="阅读工具">
            {[['notes', '笔记'], ['leads', '引线'], ['relations', '关系']].map(([id, label], index, tabs) => <button key={id} id={`reader-tab-${id}`} role="tab" aria-selected={activeTab === id} aria-controls={`reader-panel-${id}`} tabIndex={activeTab === id ? 0 : -1} className={activeTab === id ? 'is-active' : ''} onClick={() => setActiveTab(id)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0]; setActiveTab(next); document.getElementById(`reader-tab-${next}`)?.focus(); } }}>{label}</button>)}
          </div>
          <div className="reader-panel-content" id={`reader-panel-${activeTab}`} role="tabpanel" aria-labelledby={`reader-tab-${activeTab}`}>
            {activeTab === 'notes' && <>
              <div className="reader-panel-heading"><h2>第 {page} 页</h2><span>{editingId ? '阅读笔记' : '记下此刻'}</span></div>
              <div className="reader-note-editor">
                <textarea ref={noteRef} value={draft} onChange={event => updateDraft(event.target.value)} aria-label={`第 ${page} 页阅读笔记`} placeholder="这一页，让你想到了什么？" />
                <div className="reader-note-meta"><span>{book.tags?.[0] ? `#${book.tags[0]}` : '#阅读'}</span><span>p. {page}</span></div>
              </div>
              <button className="btn btn-primary reader-save-note" onClick={saveNote} disabled={!draft.trim() || (saved && !noteChanged)}>{saved && !noteChanged ? <><IconCheck size={15} /> 已保存</> : '保存笔记'}</button>
              <p className="reader-local-hint">保存在此浏览器的原型中</p>
              <div className="reader-related-heading"><h3>相关笔记</h3><span>{relatedNotes.length} 则</span></div>
              <div className="reader-related-notes">
                {relatedNotes.length ? relatedNotes.map(note => <button key={note.id} className="reader-related-note" onClick={() => openNote(note)}><IconFileText size={14} /><span><small>p. {note.page}</small><span>{note.text}</span></span><IconChevronRight size={14} /></button>) : <p className="reader-empty-notes">读到有共鸣的地方，<br />留下一点自己的想法。</p>}
              </div>
              <button className="btn reader-new-note" onClick={newNote}><IconPlus size={15} /> 新建笔记</button>
            </>}
            {activeTab === 'leads' && <>
              <div className="reader-panel-heading"><h2>从这一页，继续</h2><span>引线示例</span></div>
              <p className="reader-panel-intro">把阅读中的一个念头，留成下一次探索的起点。</p>
              <div className={`reader-lead-card ${leadState === 'skipped' ? 'is-skipped' : ''}`}>
                <span className="reader-small-label">{leadState === 'kept' ? '原型中已确认' : leadState === 'skipped' ? '已跳过' : '待你确认的引线'}</span>
                <h3>{lead.title}</h3>
                <p>{lead.description}</p>
                <div className="reader-lead-source">示例依据 · 本书第 {page} 页的{lead.basis}</div>
                {leadState === 'candidate' ? <div className="reader-lead-actions"><button className="btn btn-primary" onClick={() => changeLead('kept')}><IconCheck size={14} /> 确认保留</button><button className="btn" onClick={() => changeLead('skipped')}>跳过</button></div> : <button className="reader-text-button" onClick={() => changeLead('candidate')}>{leadState === 'kept' ? '撤回确认，重新考虑' : '重新考虑这条引线'}</button>}
              </div>
              <p className="reader-small-explanation">这是一条演示候选，确认与撤回状态仅保存在此浏览器的原型中。</p>
            </>}
            {activeTab === 'relations' && <>
              <div className="reader-panel-heading"><h2>书与书之间</h2><span>关系示例</span></div>
              <p className="reader-panel-intro">让相似的主题，成为重读另一本书的理由。</p>
              {!relationRemoved ? <>
                <div className="reader-relation-diagram" aria-label={`${book.title}通过相似主题关联远方的山`}><span>{book.title}</span><i /><small>相似主题</small><i /><span>远方的山</span></div>
                <button className={`reader-relation-card ${relationOpen ? 'is-open' : ''}`} onClick={() => setRelationOpen(open => !open)} aria-expanded={relationOpen}>
                  <Art name="bookMountain" className="reader-related-book-art" alt="山景书封示例" />
                  <span><strong>远方的山</strong><small>自然 · 行走 · 自我</small><em>{relationOpen ? '收起关系说明' : '查看关系说明'}</em></span><IconArrowUpRight size={16} />
                </button>
                {relationOpen && <div className="reader-relation-detail"><IconLink size={15} /><p>两本书都从自然中的行走，谈到内心的安定。这张卡片用于演示手动阅读关联。</p><button className="reader-text-button" onClick={() => changeRelation(true)}><IconTrash size={13} /> 移除这条关系</button></div>}
              </> : <div className="reader-relation-empty"><IconLink size={24} /><p>这条示例关系已移除。</p><button className="btn" onClick={() => changeRelation(false)}>恢复示例关系</button></div>}
              <p className="reader-small-explanation">这是阅读关系示例；此页的移除与恢复状态仅保存在浏览器原型中。</p>
            </>}
          </div>
        </aside>}
      </div>
    </section>
  );
}
