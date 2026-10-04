import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { colorForId } from './schema';

const roleNames = { seed: '起点灵感', material: '参考素材' };
const categoryNames = { inspiration: '创作灵感', reflection: '思考与感悟' };
const shortDate = value => value ? new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : '';
const projectName = (projects, id) => projects.find(project => project.id === id)?.name || id;

function useRepository(repository) {
  const [snapshot, setSnapshot] = useState(repository.snapshot);
  useEffect(() => repository.subscribe(setSnapshot), [repository]);
  return snapshot;
}

function Message({ text }) { return text ? <p className="mf-message" role="alert">{text}</p> : null; }

function MaterialCard({ material, open, compact = false }) {
  return <button className={`mf-material-card${compact ? ' is-compact' : ''}`} onClick={() => open(material)}>
    {material.resourceUrl ? <img src={material.resourceUrl} alt="" loading="lazy" /> : <div className="mf-material-icon">{material.kind === 'web' ? '↗' : '✦'}</div>}
    <span className="mf-material-card-copy"><strong>{material.title}</strong><small>{material.description || (material.kind === 'image' ? '图片素材' : material.kind === 'web' ? '网页素材' : '文本素材')}</small></span>
  </button>;
}

function MaterialDetail({ material, repository, back, sourceEntry }) {
  const [title, setTitle] = useState(material.title);
  const [caption, setCaption] = useState(material.description);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(material.title); setCaption(material.description); setError(''); }, [material.path]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await repository.update(material.path, material.hash, { title: title.trim(), caption: caption.trim() }); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <article className="mf-detail mf-note-detail">
    <button className="mf-quiet mf-back" onClick={back}>← 返回{sourceEntry ? `「${sourceEntry.title}」` : '素材列表'}</button>
    <header className="mf-detail-header"><div><small>素材笔记 · {material.kind === 'image' ? '图片' : material.kind === 'web' ? '网页' : '文本'}</small><h2>{material.title}</h2></div><button className="mf-quiet" onClick={() => repository.openNote(material.path).catch(error => setError(error.message))}>在 Obsidian 中打开 ↗</button></header>
    {material.resourceUrl && <div className="mf-hero"><img src={material.resourceUrl} alt={material.title} /></div>}
    {material.kind === 'web' && <div className="mf-capture-state"><span>页面快照：{({ ready: '已保存', blocked: '访问需验证', incomplete: '页面未加载完整', failed: '暂未取得', pending: '正在获取' })[material.fields.capture_status] || '未抓取'}</span>{material.fields.last_capture_error && <small>{material.fields.last_capture_error}</small>}<button className="mf-quiet" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await repository.refreshSnapshot(material.path); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>更新快照</button></div>}
    {material.url && <p className="mf-source-url"><a href={material.url} target="_blank" rel="noreferrer">打开原链接 ↗</a><span>{material.url}</span></p>}
    <form className="mf-form" onSubmit={save}><label>名称<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label><label>配文<textarea rows={3} value={caption} onChange={event => setCaption(event.target.value)} placeholder="这份素材为什么值得保留？" /></label><button type="submit" disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存素材笔记'}</button></form>
    <Message text={error} />
    <details className="mf-raw"><summary>笔记原文与来源</summary><pre>{material.body}</pre></details>
  </article>;
}

function InspirationDetail({ entry, snapshot, repository, openMaterial }) {
  const [summary, setSummary] = useState(entry.description);
  const [kind, setKind] = useState('联想');
  const [exploration, setExploration] = useState('');
  const [source, setSource] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [relationText, setRelationText] = useState({});
  useEffect(() => { setSummary(entry.description); setExploration(''); setError(''); setShowSource(false); }, [entry.path]);
  useEffect(() => {
    let live = true;
    repository.readSource(entry).then(value => { if (live) setSource(value); }).catch(() => { if (live) setSource(''); });
    return () => { live = false; };
  }, [entry.path, entry.sourceRevision, repository]);
  async function update(patch) {
    setError(''); setBusy(true);
    try { await repository.update(entry.path, entry.hash, patch); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function addExploration(event) {
    event.preventDefault(); if (!exploration.trim()) return;
    setError(''); setBusy(true);
    try { await repository.addExploration(entry, kind, exploration); setExploration(''); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const byPath = new Map(snapshot.materials.map(item => [item.path, item]));
  const related = [...new Set([...entry.materialPaths, ...entry.linkedPaths])].map(path => byPath.get(path)).filter(Boolean);
  const candidates = useMemo(() => repository.candidateMaterials(entry), [entry.path, entry.hash, snapshot.revision]);
  async function confirm(candidate) {
    const explanation = (relationText[candidate.targetPath] || candidate.explanation || '').trim();
    if (!explanation) { setError('请先填写这条关联的理由'); return; }
    setBusy(true); setError('');
    try { await repository.confirmRelation(entry, candidate.material, explanation); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <article className="mf-detail">
    <header className="mf-detail-header"><div><h2>{entry.title}</h2>{entry.sourceChanged && <span className="mf-update">备忘录原文有更新，请核对</span>}</div><button className="mf-quiet" onClick={() => repository.openNote(entry.path).catch(error => setError(error.message))}>在 Obsidian 中打开 ↗</button></header>
    <div className="mf-controls"><label>用途<select value={entry.role} onChange={event => update({ role: event.target.value, role_status: 'confirmed' })} disabled={busy}>{Object.entries(roleNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>分类<select value={entry.category} onChange={event => update({ category: event.target.value })} disabled={busy}>{Object.entries(categoryNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>{entry.role === 'material' && <label>服务项目<select value={entry.servesProjectId} onChange={event => update({ serves_project_id: event.target.value })} disabled={busy}><option value="">尚未指定</option>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}</div>
    <section className="mf-section"><h3>灵感内容</h3><div className="mf-original">{entry.body.split('## 继续探索')[0].replace(/^# [^\n]*\n/, '').replace(/^## 灵感内容\s*/, '').trim() || '原文暂未整理'}</div><button className="mf-quiet" onClick={() => setShowSource(!showSource)}>{showSource ? '收起整篇原始记录' : '查看整篇原始记录与位置'}</button>{showSource && <pre className="mf-source">{source || '原始记录暂时无法读取'}</pre>}</section>
    {entry.summaryStatus !== 'confirmed' && <form className="mf-section mf-form" onSubmit={event => { event.preventDefault(); update({ summary: summary.trim(), summary_status: 'confirmed' }); }}><h3>整理说明 <small>待你确认</small></h3><textarea rows={3} value={summary} onChange={event => setSummary(event.target.value)} /><button type="submit" disabled={busy}>{busy ? '保存中…' : '确认整理说明'}</button></form>}
    {related.length > 0 && <section className="mf-section"><h3>相关素材 <small>{related.length}</small></h3><div className="mf-material-grid">{related.map(material => <MaterialCard key={material.path} material={material} open={openMaterial} compact />)}</div></section>}
    {candidates.length > 0 && <section className="mf-section"><h3>可能相关 <small>本地匹配候选</small></h3>{candidates.map(candidate => <div className="mf-candidate" key={candidate.targetPath}><button className="mf-quiet" onClick={() => openMaterial(candidate.material)}>{candidate.material.title} ↗</button><p>{candidate.explanation || '标题、标签或正文存在关联线索'}</p><div><input aria-label={`与${candidate.material.title}的关联理由`} value={relationText[candidate.targetPath] ?? candidate.explanation ?? ''} onChange={event => setRelationText(old => ({ ...old, [candidate.targetPath]: event.target.value }))} /><button disabled={busy} onClick={() => confirm(candidate)}>确认关联</button></div></div>)}</section>}
    <section className="mf-section"><h3>继续探索</h3>{entry.explorations.map(item => <div className="mf-exploration" key={item.id}><small>{item.kind} · {shortDate(item.createdAt)}</small><p>{item.text}</p></div>)}<form className="mf-form" onSubmit={addExploration}><textarea rows={3} placeholder="新的联想、问题或一次小尝试…" value={exploration} onChange={event => setExploration(event.target.value)} /><div className="mf-form-row"><select aria-label="补充类型" value={kind} onChange={event => setKind(event.target.value)}>{['联想', '问题', '尝试', '回应'].map(value => <option key={value}>{value}</option>)}</select><button type="submit" disabled={busy || !exploration.trim()}>添加补充</button></div></form></section>
    <Message text={error} />
  </article>;
}

function InspirationPage({ repository, snapshot }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('');
  const [materialPath, setMaterialPath] = useState('');
  const visible = snapshot.entries.filter(item => (role === 'all' || item.role === role) && (category === 'all' || item.category === category) && (!query || item.searchText.includes(query.toLocaleLowerCase('zh-CN'))));
  useEffect(() => { if (!visible.some(item => item.path === selected)) setSelected(visible[0]?.path || ''); }, [role, category, query, snapshot.revision]);
  const entry = visible.find(item => item.path === selected);
  const material = snapshot.materials.find(item => item.path === materialPath);
  return <div className="mf-layout"><aside className="mf-index"><div className="mf-index-tools"><input type="search" aria-label="搜索灵感" placeholder="搜索灵感内容…" value={query} onChange={event => setQuery(event.target.value)} /><div className="mf-tabs"><button className={role === 'all' ? 'active' : ''} onClick={() => setRole('all')}>全部 {snapshot.entries.length}</button><button className={role === 'seed' ? 'active' : ''} onClick={() => setRole('seed')}>起点灵感</button><button className={role === 'material' ? 'active' : ''} onClick={() => setRole('material')}>参考素材</button></div><select aria-label="灵感分类" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option><option value="inspiration">创作灵感</option><option value="reflection">思考与感悟</option></select></div><div className="mf-index-list">{visible.map(item => <button key={item.path} className={`mf-entry-row${selected === item.path ? ' active' : ''}`} style={{ '--mf-entry-color': colorForId(item.id) }} onClick={() => { setSelected(item.path); setMaterialPath(''); }}><strong>{item.title}</strong><span>{item.description || '原文保留，继续探索中。'}</span><small>{roleNames[item.role] || '起点灵感'} · {item.roleStatus === 'confirmed' ? '已确认' : '待确认'}</small></button>)}</div></aside><div className="mf-reading">{material ? <MaterialDetail key={material.path} material={material} repository={repository} back={() => setMaterialPath('')} sourceEntry={entry} /> : entry ? <InspirationDetail key={entry.path} entry={entry} snapshot={snapshot} repository={repository} openMaterial={item => setMaterialPath(item.path)} /> : <p className="mf-empty">没有匹配的灵感。</p>}</div></div>;
}

function MaterialPage({ repository, snapshot }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [project, setProject] = useState('all');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [browserReady, setBrowserReady] = useState(repository.browserStatus().ready);
  const materials = snapshot.materials.filter(item => (kind === 'all' || item.kind === kind) && (project === 'all' || item.projectIds.includes(project)) && (!query || item.searchText.includes(query.toLocaleLowerCase('zh-CN'))));
  const active = snapshot.materials.find(item => item.path === selected);
  async function addLink(event) {
    event.preventDefault(); setAdding(true); setError('');
    try { const item = await repository.addLink(linkInput); setLinkInput(''); setSelected(item.path); }
    catch (failure) { setError(failure.message); }
    finally { setAdding(false); }
  }
  return <div className="mf-material-layout"><div className="mf-material-browser"><header><h2>素材</h2><p>图片、网页与文本收藏</p></header><div className="mf-material-tools"><input type="search" aria-label="搜索素材" placeholder="搜索标题、配文、标签或正文…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="素材类型" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option><option value="image">图片</option><option value="web">网页</option><option value="text">文本</option></select><select aria-label="关联项目" value={project} onChange={event => setProject(event.target.value)}><option value="all">全部项目</option>{snapshot.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{!browserReady && <p className="mf-setup">自动快照需要本机 Chromium。<button disabled={adding} onClick={async () => { setAdding(true); setError(''); try { await repository.installBrowser(); setBrowserReady(true); } catch (failure) { setError(failure.message); } finally { setAdding(false); } }}>安装截图组件</button></p>}<form className="mf-add-link" onSubmit={addLink}><label>添加网页链接<input value={linkInput} onChange={event => setLinkInput(event.target.value)} placeholder="粘贴公开网页链接或分享文字" /></label><button disabled={adding || !linkInput.trim()}>{adding ? '正在保存…' : '添加链接并获取快照'}</button></form><Message text={error} /><div className="mf-material-grid">{materials.map(item => <MaterialCard key={item.path} material={item} open={value => setSelected(value.path)} />)}</div>{materials.length === 0 && <p className="mf-empty">没有匹配的素材。</p>}</div>{active && <div className="mf-material-side"><MaterialDetail key={active.path} material={active} repository={repository} back={() => setSelected('')} /></div>}</div>;
}

function FusionApp({ repository, route }) {
  const snapshot = useRepository(repository);
  if (!snapshot.ready) return <p className="mf-empty">正在读取 Vault 笔记…</p>;
  return route === 'inspirations' ? <InspirationPage repository={repository} snapshot={snapshot} /> : <MaterialPage repository={repository} snapshot={snapshot} />;
}

export function mountFusionView(host, repository, route) {
  const root = createRoot(host);
  root.render(<FusionApp repository={repository} route={route} />);
  return () => root.unmount();
}
