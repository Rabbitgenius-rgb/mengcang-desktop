import WorkspaceSearch from './WorkspaceSearch.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconPlus, IconSearch, IconX, IconChevronLeft, IconExternalLink, IconPhoto, IconLink, IconFileText, IconCalendar, IconPencil, IconCheck, IconBook, IconArrowUpRight, IconMaximize, IconDeviceFloppy, IconQuote } from '@tabler/icons-react';
import { Art, EmptyState } from './common';
import { searchText } from './desktopModel.js';
import { useWorkspaceNavigation } from './useWorkspaceNavigation.js';
import './Collections.css';

const TYPES = { image: '图片', web: '网页', text: '文本' };
const STATUSES = { reading: '在读', want: '想读', read: '已读' };
const MaterialIcon = ({type, ...props}) => type === 'image' ? <IconPhoto {...props}/> : type === 'web' ? <IconLink {...props}/> : <IconFileText {...props}/>;
const labelDate = value => { if (!value) return '刚刚收藏'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`; };
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
function MaterialPreview({item}) {
  return item.type === 'text' ? <span className="materials-text-preview"><IconQuote size={28} stroke={1.3}/><span>{item.body || item.caption || item.title}</span></span> : <Art real={item.real} src={item.assetUrl} name={item.art} alt={item.title}/>;
}

function CollectionDialog({title, children, onClose, wide = false}) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`collections-dialog ${wide ? 'collections-dialog-wide' : ''}`} onCancel={e => {e.preventDefault(); onClose();}} onClick={e => {if(e.target === e.currentTarget) onClose();}}>
    <div className="collections-dialog-inner"><div className="collections-dialog-heading"><h2>{title}</h2><button className="icon-btn" aria-label="关闭弹窗" onClick={onClose}><IconX size={19}/></button></div>{children}</div>
  </dialog>;
}

function MaterialForm({onSave, onClose}) {
  const [form, setForm] = useState({title:'', type:'image', caption:'', source:'', tags:'', project:''});
  const update = (name, value) => setForm(prev => ({...prev, [name]:value}));
  const submit = e => { e.preventDefault(); if (!form.title.trim()) return; onSave({...form, title:form.title.trim(), caption:form.caption.trim(), tags:form.tags.split(/[,，]/).map(v => v.trim()).filter(Boolean), art:'leafShadow', id:uid('material'), date:new Date().toISOString(), body:form.caption.trim()}); };
  return <CollectionDialog title="保存一份素材" onClose={onClose}><form className="collections-form" onSubmit={submit}>
    <p className="collections-form-intro">留住一个值得回看的片段。</p>
    <label>素材名称<input autoFocus required placeholder="为这份素材起个名字" value={form.title} onChange={e => update('title',e.target.value)}/></label>
    <div className="collections-form-row"><label>类型<select value={form.type} onChange={e => update('type',e.target.value)}>{Object.entries(TYPES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>所属项目<input placeholder="可选" value={form.project} onChange={e => update('project',e.target.value)}/></label></div>
    <label>我的描述<textarea rows={4} placeholder="它让我想到……" value={form.caption} onChange={e => update('caption',e.target.value)}/></label>
    <label>原始链接<input type="url" placeholder="https://（可选）" value={form.source} onChange={e => update('source',e.target.value)}/></label>
    <label>标签<input placeholder="自然，光影，生活" value={form.tags} onChange={e => update('tags',e.target.value)}/></label>
    <p className="collections-local-note">当前为交互原型：使用示例预览图，内容仅保存在本机浏览器。</p>
    <div className="collections-form-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn btn-primary" type="submit"><IconPlus size={15}/>保存素材</button></div>
  </form></CollectionDialog>;
}

function MaterialDetails({item, materials, onSelect, onUpdate, onOriginal, onOpenNote, onTag, activeTag, notify, onOpenSettings, mobileClose, expanded = false}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(item.caption || '');
  useEffect(() => { setCaption(item.caption || ''); setEditing(false); }, [item.id, item.caption]);
  const saveCaption = () => { onUpdate({...item, caption:caption.trim()}); setEditing(false); notify?.('素材描述已保存到本机浏览器'); };
  const source = typeof item.source === 'string' ? item.source : '';
  const realSource = /^https?:\/\//.test(source) && !/(^|\/\/)example\.(com|org|net)(\/|$)/.test(source);
  const related = materials.filter(m => m.id !== item.id).map(material => ({material,matchedTags:(material.tags || []).filter(tag => (item.tags || []).includes(tag))})).filter(candidate => candidate.matchedTags.length > 0).sort((a,b) => b.matchedTags.length - a.matchedTags.length).slice(0,3);
  return <>
    <div className="collections-mobile-detail-top"><button className="collections-text-button" onClick={mobileClose}><IconChevronLeft size={17}/>返回素材</button><span>素材笔记</span></div>
    <button className={`materials-inspector-image ${item.type === 'text' ? 'materials-inspector-text' : ''}`} onClick={onOriginal} aria-label={item.type === 'image' ? '查看原图' : '预览素材'}><MaterialPreview item={item}/><span className="materials-image-expand"><IconMaximize size={16}/></span></button>
    <div className="materials-detail-title"><div><span className="collections-detail-eyebrow">素材笔记</span><h2>{item.title}</h2></div>{!expanded && <button className="icon-btn" title="展开素材笔记" aria-label="展开素材笔记" onClick={onOpenNote}><IconArrowUpRight size={18}/></button>}</div>
    <div className="collections-metadata"><span><MaterialIcon type={item.type} size={15}/>{TYPES[item.type] || '素材'}{item.size ? ` · ${item.size}` : ''}</span><span><IconCalendar size={15}/>{labelDate(item.date)}</span><span><IconLink size={15}/>{item.type === 'web' ? '来自网页收藏' : item.type === 'text' ? '来自文字摘录' : '来自图片收藏'}</span></div>
    <div className="collections-tags">{(item.tags || []).map(tag => <button className="chip" key={tag} aria-label={`筛选标签：${tag}`} aria-pressed={activeTag === tag} onClick={() => onTag?.(tag)}>{tag}</button>)}{item.project && <span className="chip collections-project-tag">{item.project}</span>}</div>
    <section className="materials-caption-section"><div className="collections-section-label"><h3>我的描述</h3>{!editing && <button className="collections-text-button" onClick={() => setEditing(true)}><IconPencil size={13}/>编辑</button>}</div>{editing ? <div className="materials-caption-edit"><textarea aria-label="编辑素材描述" autoFocus value={caption} onChange={e => setCaption(e.target.value)} rows={5}/><div><button className="btn" onClick={() => {setCaption(item.caption || '');setEditing(false);}}>取消</button><button className="btn btn-primary" onClick={saveCaption}><IconCheck size={14}/>保存</button></div></div> : <p className="materials-caption">{item.caption || '还没有描述，写下收藏它的理由。'}</p>}</section>
    {expanded && item.body && item.body !== item.caption && <section className="collections-detail-section"><h3>素材正文</h3><p className="materials-note-body">{item.body}</p></section>}
    <section className="collections-detail-section"><h3>来源</h3>{source ? (realSource ? <a className="materials-source" href={source} target="_blank" rel="noopener noreferrer"><IconLink size={14}/><span>{source}</span><IconExternalLink size={14}/></a> : <button className="materials-source" onClick={() => notify?.('这是示例来源，未连接外部网页')}><IconLink size={14}/><span>{source}</span><IconExternalLink size={14}/></button>) : <p className="muted collections-small">手动收藏 · 暂未添加原始链接</p>}</section>
    {item.rawShare && <details className="materials-share"><summary>原始分享文本</summary><p>{item.rawShare}</p></details>}
    <div className="materials-open-actions"><button className="btn" onClick={onOriginal}><MaterialIcon type={item.type} size={15}/>{item.type === 'image' ? '查看原图' : '查看原始内容'}</button><button className="btn" onClick={() => onOpenSettings?.()}><IconBook size={15}/>在 Obsidian 打开</button></div>
    {related.length > 0 && !expanded && <section className="collections-detail-section materials-related"><div className="collections-section-label"><h3>相近素材</h3><span className="muted">按标签推荐</span></div><div className="materials-related-grid">{related.map(({material,matchedTags}) => <button key={material.id} onClick={() => onSelect(material.id)} title={`${material.title} · 共同标签：${matchedTags.join('、')}`}><MaterialPreview item={material}/><span className="materials-related-title">{material.title}</span><span>共同标签：{matchedTags.join('、')}</span></button>)}</div></section>}
  </>;
}

export function MaterialsView({materials = [], setMaterials, initialMaterialId, navigationKey = 0, notify, onOpenSettings, desktop}) {
  const [query,setQuery] = useState('');
  const [type,setType] = useState('all');
  const [project,setProject] = useState('all');
  const [tag,setTag] = useState('');
  const [sort,setSort] = useState('newest');
  const [selectedId,setSelectedId] = useState(initialMaterialId || materials[0]?.id);
  const [mobileDetail,setMobileDetail] = useState(false);
  const [addOpen,setAddOpen] = useState(false);
  const [noteOpen,setNoteOpen] = useState(false);
  const [originalOpen,setOriginalOpen] = useState(false);
  const visible = useMemo(() => materials.filter(m => (type === 'all' || m.type === type) && (project === 'all' || (m.projectIds || []).includes(project) || m.project === project) && (!tag || (m.tags || []).includes(tag)) && searchText(m).includes(query.toLocaleLowerCase())).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title,'zh') : sort === 'oldest' ? String(a.date || '').localeCompare(String(b.date || '')) : String(b.date || '').localeCompare(String(a.date || ''))),[materials,type,project,tag,query,sort]);
  useEffect(() => {if(!visible.some(m => m.id === selectedId)) setSelectedId(visible[0]?.id);},[visible,selectedId]);
  const selected = visible.find(m => m.id === selectedId) || visible[0];
  const managedNavigation = useWorkspaceNavigation(desktop, 'materials', {
    capture: () => ({query, type, project, tag, sort, selectedId:selected?.id || null, mobileDetail}),
    restore: state => {
      setQuery(state?.query ?? '');setType(state?.type ?? 'all');setProject(state?.project ?? 'all');setTag(state?.tag ?? '');setSort(state?.sort ?? 'newest');
      setSelectedId(state?.selectedId ?? undefined);setMobileDetail(Boolean(state?.mobileDetail));
    },
    open: path => {
      if (!path) return false;
      const target = materials.find(material => material.path === path);
      if (!target) return false;
      if (!searchText(target).includes(query.toLocaleLowerCase())) setQuery('');
      if (type !== 'all' && target.type !== type) setType('all');
      if (project !== 'all' && !(target.projectIds || []).includes(project) && target.project !== project) setProject('all');
      if (tag && !(target.tags || []).includes(tag)) setTag('');
      setSelectedId(target.id);setMobileDetail(true);return true;
    },
  });
  useEffect(() => { if(!managedNavigation && initialMaterialId) {setSelectedId(initialMaterialId==='__all'?materials[0]?.id:initialMaterialId);setType('all');setProject('all');setTag('');setQuery('');setMobileDetail(initialMaterialId!=='__all');} },[managedNavigation,initialMaterialId,navigationKey]);
  const projects = desktop ? desktop.projects || [] : [...new Set(materials.map(m => m.project).filter(Boolean))].map(p=>({id:p,title:p}));
  const select = id => {if(id !== selected?.id) desktop?.onBeforeSelect?.();setSelectedId(id);setMobileDetail(true);};
  const selectRelated = id => {setType('all');setProject('all');setTag('');setQuery('');select(id);};
  const filterTag = next => {setTag(prev => prev === next ? '' : next);setMobileDetail(false);setNoteOpen(false);};
  const update = next => setMaterials(prev => prev.map(m => m.id === next.id ? next : m));
  const detailProps = {item:selected,materials,onSelect:selectRelated,onUpdate:update,onOriginal:() => setOriginalOpen(true),onOpenNote:() => setNoteOpen(true),onTag:filterTag,activeTag:tag,notify,onOpenSettings,mobileClose:() => setMobileDetail(false)};
  return <div className="collections-view materials-view">
    <header className="collections-page-header workspace-search-header"><WorkspaceSearch label="搜索素材" placeholder="搜索素材、标签或网址…" value={query} onChange={setQuery}/>{!desktop && <button className="btn btn-primary" onClick={() => setAddOpen(true)}><IconPlus size={16}/>保存素材</button>}</header>
    <div className="collections-toolbar materials-toolbar"><div className="materials-type-filter" aria-label="素材类型">{[['all','全部'],...Object.entries(TYPES)].map(([key,label]) => <button className={type === key ? 'is-active' : ''} key={key} onClick={() => setType(key)}>{label}</button>)}</div><div className="collections-toolbar-end">{desktop && <select aria-label="按标签筛选素材" value={tag} onChange={e=>setTag(e.target.value)}><option value="">所有标签</option>{[...new Set(materials.flatMap(m=>m.tags || []))].sort((a,b)=>a.localeCompare(b,'zh')).map(t=><option key={t} value={t}>{t}</option>)}</select>}{tag && <button className="chip" aria-label="清除标签筛选" onClick={() => setTag('')}>{tag}<IconX size={12}/></button>}<select aria-label="按项目筛选素材" value={project} onChange={e => setProject(e.target.value)}><option value="all">全部项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title || p.id}</option>)}</select><select aria-label="素材排序" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">按添加时间 ↓</option><option value="oldest">按添加时间 ↑</option><option value="title">按名称排序</option></select></div></div>
    <div className="collections-body"><section className="collections-grid-area" aria-label="素材收藏"><div className="materials-grid">{visible.map(m => <button key={m.id} className={`materials-card ${selected?.id === m.id ? 'is-selected' : ''}`} onClick={() => select(m.id)} aria-pressed={selected?.id === m.id}><div className="materials-card-image"><MaterialPreview item={m}/></div><span className="materials-card-title">{m.title}</span><span className="materials-card-meta">{m.type === 'image' ? (m.real?'图片':'JPG') : m.type === 'web' ? '网页' : 'TXT'}<span>·</span>{m.size || (m.type === 'web' ? '网页收藏' : m.type === 'text' ? `${(m.body || m.caption || '').length} 字` : '图片素材')}</span></button>)}</div>{!visible.length && <EmptyState title="还没有找到这份素材" description="换一个关键词，或保存新的片段。"/>}<p className="collections-grid-footnote">{visible.length} 份素材<span>每一次收藏，都是下一次灵感的开始。</span></p></section>
      {selected && <aside className={`collections-inspector materials-inspector ${mobileDetail ? 'is-mobile-open' : ''}`} aria-label="素材详情">{desktop ? <><div className="collections-mobile-detail-top"><button className="collections-text-button" onClick={()=>setMobileDetail(false)}><IconChevronLeft size={17}/>返回素材</button><span>素材笔记</span></div>{desktop.renderDetail(selected)}{desktop.renderRelated(selected)}</> : <MaterialDetails {...detailProps}/>}</aside>}
    </div>
    {addOpen && <MaterialForm onClose={() => setAddOpen(false)} onSave={item => {setMaterials(prev => [item,...prev]); setSelectedId(item.id);setAddOpen(false);setType('all');setProject('all');setTag('');setQuery('');notify?.('素材已保存在本机浏览器');}}/>}
    {noteOpen && selected && <CollectionDialog title="素材笔记" onClose={() => setNoteOpen(false)}><div className="materials-note-dialog"><MaterialDetails {...detailProps} expanded/></div></CollectionDialog>}
    {originalOpen && selected && <CollectionDialog title={selected.title} wide onClose={() => setOriginalOpen(false)}>{selected.type === 'text' ? <div className="materials-original-text">{selected.body || selected.caption}</div> : <Art name={selected.art} alt={selected.title} className="materials-original-image"/>}<p className="collections-local-note">{selected.type === 'web' ? '网页收藏预览 · 可从素材笔记中的来源链接访问原页面。' : '示例素材预览 · 当前未连接原始文件。'}</p></CollectionDialog>}
  </div>;
}

function BookForm({book, onClose, onSave}) {
  const [form,setForm] = useState(book ? {...book,tags:(book.tags || []).join('，')} : {title:'',author:'',category:'散文',status:'want',totalPages:240,page:0,tags:'',description:'',publisher:'',year:''});
  const change = (key,value) => setForm(prev => ({...prev,[key]:value}));
  const submit = e => {e.preventDefault(); if(!form.title.trim()) return; const totalPages = Math.max(1,Number(form.totalPages) || 1); onSave({...form,id:book?.id || uid('book'),art:book?.art || 'bookTree',title:form.title.trim(),author:form.author.trim() || '佚名',totalPages,page:Math.min(totalPages,Math.max(0,Number(form.page) || 0)),tags:form.tags.split(/[,，]/).map(v => v.trim()).filter(Boolean)});};
  return <CollectionDialog title={book ? '编辑书籍信息' : '添加一本藏书'} onClose={onClose}><form className="collections-form" onSubmit={submit}><p className="collections-form-intro">让书在这里相遇，也留下一段阅读的时光。</p>
    <label>书名<input autoFocus required value={form.title} onChange={e => change('title',e.target.value)} placeholder="输入书名"/></label>
    <div className="collections-form-row"><label>作者<input value={form.author} onChange={e => change('author',e.target.value)} placeholder="作者姓名"/></label><label>分类<input value={form.category} onChange={e => change('category',e.target.value)} placeholder="散文 / 文学 / 艺术"/></label></div>
    <div className="collections-form-row"><label>总页数<input type="number" min="1" max="99999" value={form.totalPages} onChange={e => change('totalPages',e.target.value)}/></label><label>已读页数<input type="number" min="0" max={form.totalPages} value={form.page} onChange={e => change('page',e.target.value)}/></label><label>阅读状态<select value={form.status} onChange={e => change('status',e.target.value)}>{Object.entries(STATUSES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <label>简介<textarea rows={3} value={form.description} onChange={e => change('description',e.target.value)} placeholder="关于这本书，你想记住的…"/></label>
    <div className="collections-form-row"><label>出版社<input value={form.publisher || ''} onChange={e => change('publisher',e.target.value)} placeholder="可选"/></label><label>出版时间<input value={form.year || ''} onChange={e => change('year',e.target.value)} placeholder="如 2024年6月"/></label></div>
    <label>标签<input value={form.tags} onChange={e => change('tags',e.target.value)} placeholder="自然，散文，生活"/></label><p className="collections-local-note">{book ? '修改仅保存在本机浏览器。' : '当前添加示例书籍记录，使用示例封面和阅读内容。'}</p><div className="collections-form-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button type="submit" className="btn btn-primary"><IconDeviceFloppy size={15}/>{book ? '保存修改' : '添加书籍'}</button></div>
  </form></CollectionDialog>;
}

export function BooksView({books = [],setBooks,onRead,notify,desktop}) {
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('all');
  const [category,setCategory] = useState('all');
  const [sort,setSort] = useState('default');
  const [selectedId,setSelectedId] = useState(books[0]?.id);
  const [mobileDetail,setMobileDetail] = useState(false);
  const [form,setForm] = useState(null);
  const categories = [...new Set(books.map(b => b.category).filter(Boolean))];
  const visible = useMemo(() => books.filter(b => (status === 'all' || b.status === status) && (category === 'all' || b.category === category) && searchText(b).includes(query.toLocaleLowerCase())).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title,'zh') : sort === 'progress' ? (b.page / b.totalPages) - (a.page / a.totalPages) : 0),[books,query,status,category,sort]);
  useEffect(() => {if(!visible.some(b => b.id === selectedId)) setSelectedId(visible[0]?.id);},[visible,selectedId]);
  const selected = visible.find(b => b.id === selectedId) || visible[0];
  const managedNavigation = useWorkspaceNavigation(desktop, 'books', {
    capture: () => ({query, status, category, sort, selectedId:selected?.id || null, mobileDetail}),
    restore: state => {
      setQuery(state?.query ?? '');setStatus(state?.status ?? 'all');setCategory(state?.category ?? 'all');setSort(state?.sort ?? 'default');
      setSelectedId(state?.selectedId ?? undefined);setMobileDetail(Boolean(state?.mobileDetail));
    },
    open: path => {
      if (!path) return false;
      const target = books.find(book => book.path === path);
      if (!target) return false;
      if (!searchText(target).includes(query.toLocaleLowerCase())) setQuery('');
      if (status !== 'all' && target.status !== status) setStatus('all');
      if (category !== 'all' && target.category !== category) setCategory('all');
      setSelectedId(target.id);setMobileDetail(true);return true;
    },
  });
  useEffect(()=>{if(!managedNavigation && desktop?.selectedPath){const target=books.find(b=>b.path===desktop.selectedPath);if(target){setSelectedId(target.id);setQuery('');setStatus('all');setCategory('all');setMobileDetail(true);}}},[managedNavigation,desktop?.selectedPath,desktop?.navigationKey]);
  const select = id => {if(id !== selected?.id) desktop?.onBeforeSelect?.();setSelectedId(id);setMobileDetail(true);};
  const progress = selected ? Math.min(100,Math.round((selected.page || 0)/Math.max(1,selected.totalPages) * 100)) : 0;
  const setBookStatus = next => {setBooks(prev => prev.map(b => b.id === selected.id ? {...b,status:next} : b));notify?.(`《${selected.title}》已标记为${STATUSES[next]}`);};
  const saveBook = next => {setBooks(prev => prev.some(b => b.id === next.id) ? prev.map(b => b.id === next.id ? next : b) : [next,...prev]);setSelectedId(next.id);setForm(null);setQuery('');setStatus('all');setCategory('all');notify?.('书籍信息已保存在本机浏览器');};
  return <div className="collections-view books-view"><header className="collections-page-header workspace-search-header"><WorkspaceSearch label="搜索藏书" placeholder="搜索书名、作者或关键词…" value={query} onChange={setQuery}/>{!desktop && <button className="btn btn-primary" onClick={() => setForm({mode:'add'})}><IconPlus size={16}/>添加书籍</button>}</header>
    <div className="collections-toolbar books-toolbar"><select aria-label="藏书排序" value={sort} onChange={e => setSort(e.target.value)}><option value="default">全部藏书</option><option value="title">按书名排序</option><option value="progress">按阅读进度</option></select><select aria-label="阅读状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">阅读状态</option>{Object.entries(STATUSES).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select><select aria-label="书籍分类" value={category} onChange={e => setCategory(e.target.value)}><option value="all">分类</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><span className="books-collection-count">{books.length} 本藏书 · {books.filter(b => b.status === 'reading').length} 本在读</span></div>
    <div className="collections-body"><section className="collections-grid-area" aria-label="书架"><div className="books-grid">{visible.map(book => <button className={`books-card ${selected?.id === book.id ? 'is-selected' : ''}`} key={book.id} onClick={() => select(book.id)} aria-pressed={selected?.id === book.id}><div className="books-card-cover"><Art real={book.real} src={book.assetUrl} name={book.art} alt={`${book.title}封面`}/></div><span className="books-card-title">{book.title}</span><span className="books-card-author">{book.author}</span><span className={`books-status books-status-${book.status}`}><i/>{STATUSES[book.status] || (desktop?'未标记':'想读')}</span></button>)}</div>{!visible.length && <EmptyState title="这层书架还空着" description="试试其他筛选条件，或添加一本好书。"/>}<p className="collections-grid-footnote">{visible.length} 本书<span>阅读，是与另一个世界温柔相遇。</span></p></section>
      {selected && <aside className={`collections-inspector books-inspector ${mobileDetail ? 'is-mobile-open' : ''}`} aria-label="书籍详情"><div className="collections-mobile-detail-top"><button className="collections-text-button" onClick={() => setMobileDetail(false)}><IconChevronLeft size={17}/>返回藏书</button><span>书籍详情</span></div><div className="books-inspector-cover"><Art real={selected.real} src={selected.assetUrl} name={selected.art} alt={`${selected.title}封面`}/></div><h2>{selected.title}</h2><p className="books-inspector-author">{selected.author ? `${selected.author} 著` : '作者未填写'}</p><div className="collections-tags">{(selected.tags || [selected.category]).filter(Boolean).map(tag => <span key={tag} className="chip">{tag}</span>)}</div><p className="books-description">{selected.description || (desktop?'笔记中尚未填写简介。':'一本值得慢慢读的书，让思想与生活在字里行间相遇。')}</p><dl className="books-info"><div><dt>出版</dt><dd>{selected.year || '暂无信息'}</dd></div><div><dt>页数</dt><dd>{selected.totalPages ? `${selected.totalPages} 页` : '暂无信息'}</dd></div>{selected.publisher && <div><dt>出版社</dt><dd>{selected.publisher}</dd></div>}{selected.isbn && <div><dt>ISBN</dt><dd>{selected.isbn}</dd></div>}</dl>{(!desktop || (selected.hasReadingPosition && selected.totalPages > 0)) && <div className="books-progress"><div><strong>阅读进度</strong><span>{selected.page || 0} / {selected.totalPages} 页</span></div><progress value={progress} max={100} aria-label={`已读 ${progress}%`}/></div>}<button className="btn btn-primary books-read-button" onClick={() => onRead?.(selected)}><IconBook size={16}/>{desktop ? '打开原书' : selected.page > 0 && selected.status !== 'read' ? '继续阅读' : selected.status === 'read' ? '再次阅读' : '开始阅读'}</button>{desktop ? <div className="desktop-book-actions"><span className="books-status">{STATUSES[selected.status] || '未标记阅读状态'}</span><button className="btn" onClick={()=>desktop.openNote(selected.path)}><IconFileText size={15}/>在 Obsidian 中打开</button></div> : <><div className="books-detail-actions"><button className="btn" onClick={() => setBookStatus(selected.status === 'read' ? 'reading' : 'read')}><IconCheck size={14}/>{selected.status === 'read' ? '标记为在读' : '标记为已读'}</button><button className="btn" onClick={() => setForm({mode:'edit',book:selected})}><IconPencil size={14}/>编辑信息</button></div><label className="books-status-control">阅读状态<select aria-label="更改阅读状态" value={selected.status} onChange={e => setBookStatus(e.target.value)}>{Object.entries(STATUSES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></>}<p className="books-local-hint">{desktop?'阅读状态沿用书籍笔记。':'一本书，一段安静的时光。'}</p></aside>}
    </div>{form && <BookForm book={form.mode === 'edit' ? form.book : undefined} onClose={() => setForm(null)} onSave={saveBook}/>}
  </div>;
}
