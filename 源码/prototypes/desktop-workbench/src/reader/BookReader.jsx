import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft,
  IconHome,
  IconBookmark,
  IconDownload,
  IconLayoutSidebarRight,
  IconMaximize,
  IconX,
  IconTrash,
  IconHighlight,
} from '@tabler/icons-react';
import { valueOf } from '../desktopModel.js';
import { readAttachmentBytes } from '../sublime/attachmentStore.js';
import { requestWorkspaceDownload } from '../sublime/workspaceDownload.js';
import { bookFormat, normalizeReaderState, readerNotesMarkdown, readerReducer, readerStateKey, supersedeReaderActions } from './readerState.js';
import PdfBookReader from './PdfBookReader.jsx';
import EpubBookReader from './EpubBookReader.jsx';
import './bookReader.css';

function Outline({ items, onNavigate, format }) {
  return (
    <ol className="br-outline">
      {(items || []).map((entry, index) => (
        <li key={entry.id || index}>
          <button disabled={format === 'pdf' && !entry.page} onClick={() => onNavigate(entry)}>
            {entry.title || '未命名章节'}
            {format === 'pdf' && entry.page && <small>{entry.page}</small>}
          </button>
          {entry.children?.length > 0 && <Outline items={entry.children} onNavigate={onNavigate} format={format} />}
        </li>
      ))}
    </ol>
  );
}
const uuid = () => crypto.randomUUID();
function recoverableActions(actions, later) {
  const future = supersedeReaderActions(later, []);
  return supersedeReaderActions(actions, future).map((action) => {
    if (action.type !== 'annotation.add') return action;
    const id = action.annotation?.id,
      lastNote = future.filter((value) => value.type === 'annotation.note' && value.id === id).at(-1);
    return lastNote ? { ...action, annotation: { ...action.annotation, note: lastNote.note } } : action;
  });
}
export default function BookReader({
  card,
  api,
  readerStates = {},
  onUpdate,
  onExcerpt,
  onExit,
  onLibrary,
  registerFlush,
  initialPage = 0,
  initialNavigation,
}) {
  const [loaded, setLoaded] = useState(null),
    [error, setError] = useState(''),
    [saveError, setSaveError] = useState(''),
    [state, setState] = useState(() => normalizeReaderState()),
    [meta, setMeta] = useState({}),
    [selection, setSelection] = useState(null),
    [annotationNote, setAnnotationNote] = useState(''),
    [panel, setPanel] = useState('contents'),
    [sideOpen, setSideOpen] = useState(true),
    [navigateTo, setNavigateTo] = useState(null),
    [pendingCount, setPendingCount] = useState(0),
    [notice, setNotice] = useState('');
  const generation = useRef(0),
    sourceRef = useRef(null),
    loadingSource = useRef(false),
    refreshBlocked = useRef(false),
    local = useRef(state),
    jobs = useRef(new Set()),
    failed = useRef([]),
    failedExcerpts = useRef([]),
    excerptJob = useRef(null),
    leaving = useRef(null),
    selected = useRef(null),
    intents = useRef([]),
    counter = useRef(0),
    active = useRef(true),
    root = useRef(null),
    props = useRef({});
  props.current = { onUpdate, onExit, onLibrary, onExcerpt, readerStates, card, initialNavigation };
  selected.current = { selection, note: annotationNote };
  const [sourceReload, setSourceReload] = useState(0);
  const format = bookFormat(loaded),
    key = loaded ? readerStateKey(card.id, loaded.sourceKey) : '';
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const requests = generation;
    const run = ++requests.current;
    const { card, initialNavigation } = props.current;
    setError('');
    setSelection(null);
    setNavigateTo(null);
    async function load() {
      try {
        while (jobs.current.size) await Promise.allSettled([...jobs.current]);
        if (run !== generation.current) return;
        if (failed.current.length || failedExcerpts.current.length) {
          refreshBlocked.current = true;
          throw Error('阅读记录或素材摘录尚未保存，请先重试保存或导出笔记保留。');
        }
        refreshBlocked.current = false;
        loadingSource.current = true;
        setLoaded(null);
        setMeta({});
        setNavigateTo(null);
        setSelection(null);
        let source;
        if (card.attachment) {
          const bytes = await readAttachmentBytes(card.attachment),
            hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
          source = { ...card.attachment, sourceKey: hash };
        } else if (typeof api?.readingSource === 'function') source = valueOf(await api.readingSource(card.path || card.id));
        else throw Error('这份原书暂不能在应用内读取，请使用“打开原文件”或重新导入 PDF / EPUB。');
        if (run !== generation.current) return;
        if (!bookFormat(source) || !source.sourceKey) throw Error('此文件不是可读取的 PDF 或 EPUB。');
        const saved = normalizeReaderState(props.current.readerStates[readerStateKey(card.id, source.sourceKey)]);
        if (initialPage > 0) saved.location.page = initialPage;
        local.current = saved;
        sourceRef.current = source;
        setState(saved);
        setLoaded(source);
        if (initialNavigation) {
          if (initialNavigation.sourceKey === source.sourceKey) setNavigateTo({ ...initialNavigation.locator, nonce: uuid() });
          else setNotice('原书版本已变化，本次没有自动跳转到旧摘录位置。旧摘录文字仍保留。');
        } else if (initialPage > 0) setNavigateTo({ page: initialPage, nonce: uuid() });
      } catch (issue) {
        if (run === generation.current) {
          setError(issue.message || '原书无法读取。');
          if (sourceRef.current) setLoaded(sourceRef.current);
        }
      } finally {
        if (run === generation.current) loadingSource.current = false;
      }
    }
    void load();
    return () => {
      requests.current++;
    };
  }, [card.id, card.attachment?.dataUrl, card.originalPath, card.originalMime, card.updatedAt, api, initialPage, sourceReload]);
  const storedReaderState = readerStates[key];
  useEffect(() => {
    if (!key || jobs.current.size || failed.current.length) return;
    const fresh = normalizeReaderState(storedReaderState);
    local.current = fresh;
    setState(fresh);
  }, [key, storedReaderState]);
  const flush = useCallback(async () => {
    while (jobs.current.size) await Promise.allSettled([...jobs.current]);
    if (failed.current.length || failedExcerpts.current.length) throw Error('阅读笔记或素材摘录尚未保存，请重试保存或导出笔记保留。');
  }, []);
  useEffect(() => {
    registerFlush?.(flush);
    return () => registerFlush?.(null);
  }, [flush, registerFlush]);
  function action(change) {
    const source = sourceRef.current;
    if (!source || loadingSource.current) return Promise.reject(Error('原书尚未就绪'));
    const run = generation.current,
      request = ++counter.current;
    try {
      local.current = readerReducer(local.current, change);
      setState(local.current);
    } catch (issue) {
      setSaveError(issue.message);
      return Promise.reject(issue);
    }
    intents.current.push({ request, change });
    failed.current = failed.current.flatMap((record) => recoverableActions([record.change], [change]).map((change) => ({ ...record, change })));
    // A later annotation-note write is a no-op if its failed create has never
    // reached storage. Commit surviving prerequisites with the new intent in the
    // same transaction, preserving ordering without reviving a later deletion.
    const recovery = failed.current.slice(),
      captured = new Set(recovery.map((record) => record.id)),
      transaction = recovery.length ? { type: 'batch', actions: [...recovery.map((record) => record.change), change] } : change,
      update = props.current.onUpdate;
    setPendingCount((value) => value + 1);
    let job;
    job = Promise.resolve()
      .then(() => update(source, transaction))
      .then((saved) => {
        failed.current = failed.current.filter((record) => !captured.has(record.id));
        if (run === generation.current && active.current) {
          if (!failed.current.length && !failedExcerpts.current.length) setSaveError('');
          if (request === counter.current && saved) {
            local.current = failed.current.reduce((value, record) => readerReducer(value, record.change), normalizeReaderState(saved));
            setState(local.current);
          }
        }
      })
      .catch((issue) => {
        if (source.sourceKey === sourceRef.current?.sourceKey) {
          const residual = recoverableActions(
            [transaction],
            intents.current.filter((item) => item.request > request).map((item) => item.change),
          );
          failed.current = [
            ...failed.current.filter((record) => !captured.has(record.id)),
            ...residual.map((change, index) => ({ id: `${request}:${index}`, request, change })),
          ];
          if (active.current && failed.current.length) {
            setSaveError(issue.message || '阅读记录保存失败');
            local.current = failed.current.reduce((value, record) => readerReducer(value, record.change), local.current);
            setState(local.current);
          }
        }
        throw issue;
      })
      .finally(() => {
        jobs.current.delete(job);
        if (!jobs.current.size) intents.current = [];
        if (active.current) setPendingCount((value) => Math.max(0, value - 1));
      });
    jobs.current.add(job);
    return job;
  }
  const persist = (change) => {
    void action(change).catch(() => {});
  };
  async function retry() {
    const actions = failed.current.map((record) => record.change),
      excerpts = failedExcerpts.current.slice();
    if (!actions.length && !excerpts.length) return;
    try {
      if (actions.length) await action({ type: 'batch', actions });
      for (const record of excerpts) await submitExcerpt(record);
      if (!failed.current.length && !failedExcerpts.current.length) {
        setSaveError('');
        if (refreshBlocked.current) {
          refreshBlocked.current = false;
          setError('');
          setSourceReload((value) => value + 1);
        }
      }
    } catch {
      /* Failed records remain available for retry or export. */
    }
  }
  function progress(location) {
    const next = normalizeReaderState({ location }).location,
      prior = local.current.location;
    if (JSON.stringify(next) === JSON.stringify(prior)) return;
    persist({ type: 'location', location: next });
  }
  const label = (locator) =>
    format === 'pdf' ? `第 ${locator.page || 1} 页` : `第 ${(locator.chapter || 0) + 1} 章 · ${Math.round((locator.progress || 0) * 100)}%`;
  function go(locator) {
    if (!loaded || loadingSource.current) return;
    setNavigateTo({ ...locator, nonce: uuid() });
    setSelection(null);
  }
  function bookmark() {
    const locator = local.current.location;
    persist({ type: 'bookmark.add', bookmark: { id: uuid(), label: label(locator), locator, createdAt: new Date().toISOString() } });
    setPanel('bookmarks');
    setSideOpen(true);
  }
  function highlight() {
    if (!selection) return;
    persist({
      type: 'annotation.add',
      annotation: {
        id: uuid(),
        label: selection.label || label(selection.locator),
        locator: selection.locator,
        text: selection.text,
        note: annotationNote,
        color: 'yellow',
        createdAt: new Date().toISOString(),
      },
    });
    setSelection(null);
    setAnnotationNote('');
    setPanel('annotations');
    setSideOpen(true);
  }
  function submitExcerpt(record) {
    if (excerptJob.current) return excerptJob.current.promise;
    const save = props.current.onExcerpt;
    setPendingCount((value) => value + 1);
    let job;
    job = Promise.resolve()
      .then(() => {
        if (typeof save !== 'function') throw Error('素材摘录保存入口暂不可用，选文与批注仍保留。');
        return save(record.payload);
      })
      .then(() => {
        failedExcerpts.current = failedExcerpts.current.filter((item) => item.payload.operationId !== record.payload.operationId);
        if (active.current) {
          setNotice('摘录已保存到资料库，原文与批注保留');
          if (selected.current.selection === record.selection && selected.current.note === record.payload.note) {
            setSelection(null);
            setAnnotationNote('');
          }
          if (!failed.current.length && !failedExcerpts.current.length) setSaveError('');
        }
      })
      .catch((issue) => {
        if (!failedExcerpts.current.some((item) => item.payload.operationId === record.payload.operationId)) failedExcerpts.current.push(record);
        if (active.current) setSaveError(issue.message || '素材摘录尚未保存，选文与批注仍保留。');
        throw issue;
      })
      .finally(() => {
        jobs.current.delete(job);
        if (excerptJob.current?.promise === job) excerptJob.current = null;
        if (!jobs.current.size) intents.current = [];
        if (active.current) setPendingCount((value) => Math.max(0, value - 1));
      });
    excerptJob.current = { promise: job, record };
    jobs.current.add(job);
    return job;
  }
  function excerpt() {
    if (excerptJob.current) return excerptJob.current.promise.catch(() => {});
    if (!selection || !loaded || loadingSource.current) return Promise.resolve();
    const retained = failedExcerpts.current.find(
      (record) => record.selection === selection && record.payload.note === annotationNote && record.payload.sourceKey === loaded.sourceKey,
    );
    const record = retained || {
      selection,
      payload: { ...selection, note: annotationNote, operationId: uuid(), sourceKey: loaded.sourceKey, sourceName: loaded.name, format },
    };
    return submitExcerpt(record).catch(() => {});
  }
  function leave(destination) {
    if (leaving.current) return leaving.current;
    let job;
    job = Promise.resolve()
      .then(flush)
      .then(async () => {
        if (active.current) await destination?.();
      })
      .catch((issue) => {
        if (active.current) setSaveError(issue.message);
      })
      .finally(() => {
        if (leaving.current === job) leaving.current = null;
      });
    leaving.current = job;
    return job;
  }
  const exit = () => leave(props.current.onExit),
    library = () => leave(props.current.onLibrary);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current.requestFullscreen();
    } catch {
      setNotice('当前窗口无法进入全屏，可使用系统窗口缩放。');
    }
  }
  function exportNotes(kind) {
    const source = loaded || sourceRef.current;
    if (!source) return;
    try {
      const name = (card.title || source.name || '读书笔记').replace(/[\\/:*?"<>|]/g, '-'),
        pending = [
          ...new Map(
            [...failedExcerpts.current, ...(excerptJob.current ? [excerptJob.current.record] : [])].map((record) => [
              record.payload.operationId,
              record.payload,
            ]),
          ).values(),
        ];
      const recovery = pending.length
        ? '\n\n## 尚未存入素材库的摘录\n\n' +
          pending
            .map(
              (item) =>
                `### ${item.label || item.sourceName}\n\n${item.text
                  .split('\n')
                  .map((line) => '> ' + line)
                  .join('\n')}\n\n${item.note || ''}`,
            )
            .join('\n\n')
        : '';
      const payload =
        kind === 'json'
          ? JSON.stringify(
              {
                format: 'mengcang-reading-notes-v1',
                title: card.title,
                source: { name: source.name, type: source.type, sourceKey: source.sourceKey },
                state: normalizeReaderState(local.current),
                ...(pending.length ? { unsavedExcerpts: pending } : {}),
              },
              null,
              2,
            )
          : readerNotesMarkdown(card, local.current, source) + recovery;
      requestWorkspaceDownload(payload, name + '-阅读笔记.' + (kind === 'json' ? 'json' : 'md'), kind === 'json' ? 'application/json' : 'text/markdown');
    } catch (issue) {
      setSaveError(issue.message);
    }
  }
  function recovered(detail) {
    if (detail?.sourceKey === sourceRef.current?.sourceKey) setError('');
  }
  return (
    <section ref={root} className="book-reader" data-theme={state.settings.theme} aria-label="图书阅读器">
      <header className="br-header">
        <button type="button" onClick={exit} aria-label="返回上一页">
          <IconArrowLeft size={20} />
          <span>返回</span>
        </button>
        <div className="br-heading">
          <strong>{card.title || loaded?.name}</strong>
          <small>
            {loaded?.name || '正在读取原书'} · {format?.toUpperCase()}{' '}
            <span role="status">{saveError ? '保存未完成' : pendingCount ? '正在保存…' : '阅读记录已保存'}</span>
          </small>
        </div>
        <div className="br-header-actions">
          {onLibrary && (
            <button type="button" onClick={library} aria-label="返回资料库">
              <IconHome size={18} />
              <span>资料库</span>
            </button>
          )}
          <button onClick={bookmark} disabled={!loaded} title="添加当前位置书签">
            <IconBookmark size={18} />
            <span>书签</span>
          </button>
          <button onClick={fullscreen} title="切换全屏" aria-label="切换全屏">
            <IconMaximize size={19} />
          </button>
          <button onClick={() => setSideOpen((value) => !value)} aria-label={sideOpen ? '收起阅读侧栏' : '展开阅读侧栏'} aria-expanded={sideOpen}>
            <IconLayoutSidebarRight size={19} />
          </button>
        </div>
      </header>
      {(error || saveError) && (
        <div className="br-error" role="alert">
          {error || saveError}
          {(failed.current.length > 0 || failedExcerpts.current.length > 0) && <button onClick={retry}>重试保存</button>}
          {api?.openOriginal && card.origin === 'vault' && (
            <button
              onClick={() =>
                api
                  .openOriginal(card.path || card.id)
                  .then(valueOf)
                  .catch((issue) => setError(issue.message))
              }
            >
              打开原文件
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="br-notice" role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="关闭阅读提示">
            <IconX size={15} />
          </button>
        </div>
      )}
      <div className={'br-layout' + (sideOpen ? '' : ' br-side-hidden')}>
        <main className="br-document">
          {!loaded && !error && (
            <p className="br-loading" role="status">
              正在读取原书…
            </p>
          )}
          {loaded &&
            (format === 'pdf' ? (
              <PdfBookReader
                key={key}
                source={loaded}
                location={state.location}
                settings={state.settings}
                annotations={state.annotations}
                navigateTo={navigateTo}
                onLocation={progress}
                onReady={setMeta}
                onSelection={setSelection}
                onError={setError}
                onRecovered={recovered}
                onSettings={(settings) => persist({ type: 'settings', settings })}
              />
            ) : (
              <EpubBookReader
                key={key}
                source={loaded}
                location={state.location}
                settings={state.settings}
                annotations={state.annotations}
                navigateTo={navigateTo}
                onLocation={progress}
                onReady={setMeta}
                onSelection={setSelection}
                onError={setError}
                onSettings={(settings) => persist({ type: 'settings', settings })}
              />
            ))}
        </main>
        {sideOpen && (
          <aside className="br-sidebar">
            <nav className="br-side-tabs" aria-label="阅读侧栏">
              {[
                ['contents', '目录'],
                ['bookmarks', '书签'],
                ['annotations', '摘录'],
                ['notes', '笔记'],
                ['settings', '设置'],
              ].map(([id, title]) => (
                <button key={id} onClick={() => setPanel(id)} className={panel === id ? 'active' : ''} aria-pressed={panel === id}>
                  {title}
                  {id === 'bookmarks' && state.bookmarks.length > 0 && <small>{state.bookmarks.length}</small>}
                  {id === 'annotations' && state.annotations.length > 0 && <small>{state.annotations.length}</small>}
                </button>
              ))}
            </nav>
            <div className="br-side-body">
              {panel === 'contents' &&
                (meta.outline?.length ? (
                  <Outline
                    items={meta.outline}
                    format={format}
                    onNavigate={(entry) =>
                      go(format === 'pdf' ? { page: entry.page } : { chapter: entry.chapter, progress: 0, fragment: entry.href?.split('#')[1] || '' })
                    }
                  />
                ) : (
                  <p className="br-empty">{loaded ? '原书没有可用目录，可使用页码、章节和全文搜索定位。' : '正在读取目录…'}</p>
                ))}
              {panel === 'bookmarks' && (
                <>
                  <h2>
                    我的书签 <small>{state.bookmarks.length}</small>
                  </h2>
                  {!state.bookmarks.length && <p className="br-empty">读到想保留的位置，点击上方“书签”。</p>}
                  {state.bookmarks.map((item) => (
                    <article key={item.id} className="br-record">
                      <button className="br-record-go" onClick={() => go(item.locator)}>
                        {item.label}
                      </button>
                      <button aria-label={'删除书签 ' + item.label} onClick={() => persist({ type: 'bookmark.remove', id: item.id })}>
                        <IconTrash size={16} />
                      </button>
                    </article>
                  ))}
                </>
              )}
              {panel === 'annotations' && (
                <>
                  <h2>
                    摘录与批注 <small>{state.annotations.length}</small>
                  </h2>
                  {!state.annotations.length && <p className="br-empty">在正文选中文字后保存高亮，可在这里添加批注和返回原文。</p>}
                  {state.annotations.map((item) => (
                    <article key={item.id} className="br-annotation">
                      <header>
                        <button onClick={() => go(item.locator)}>{item.label}</button>
                        <button aria-label={'删除摘录 ' + item.label} onClick={() => persist({ type: 'annotation.remove', id: item.id })}>
                          <IconTrash size={16} />
                        </button>
                      </header>
                      <blockquote>{item.text}</blockquote>
                      <textarea
                        disabled={!loaded}
                        aria-label={'批注 ' + item.label}
                        value={item.note}
                        maxLength={10000}
                        placeholder="写下这段文字带来的想法…"
                        onChange={(event) => persist({ type: 'annotation.note', id: item.id, note: event.target.value })}
                      />
                    </article>
                  ))}
                </>
              )}
              {panel === 'notes' && (
                <>
                  <h2>读书笔记</h2>
                  <textarea
                    disabled={!loaded}
                    className="br-book-note"
                    aria-label="读书笔记"
                    value={state.note}
                    maxLength={50000}
                    placeholder="记录你的理解、问题与想法…"
                    onChange={(event) => persist({ type: 'note', note: event.target.value })}
                  />
                  <p className="br-empty">保存在本机资料库中，随资料库备份保留；原书不改动。</p>
                </>
              )}
              {panel === 'settings' && (
                <>
                  <h2>阅读设置</h2>
                  <label className="br-setting">
                    页面主题
                    <select
                      disabled={!loaded}
                      aria-label="页面主题"
                      value={state.settings.theme}
                      onChange={(event) => persist({ type: 'settings', settings: { theme: event.target.value } })}
                    >
                      <option value="light">明亮</option>
                      <option value="sepia">柔和纸色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                  {format === 'epub' && (
                    <>
                      <label className="br-setting">
                        字号 <span>{state.settings.fontSize}px</span>
                        <input
                          aria-label="正文字号"
                          type="range"
                          min="14"
                          max="32"
                          value={state.settings.fontSize}
                          onChange={(event) => persist({ type: 'settings', settings: { fontSize: Number(event.target.value) } })}
                        />
                      </label>
                      <label className="br-setting">
                        行距 <span>{state.settings.lineHeight}</span>
                        <input
                          aria-label="正文行距"
                          type="range"
                          min="1.3"
                          max="2.5"
                          step="0.1"
                          value={state.settings.lineHeight}
                          onChange={(event) => persist({ type: 'settings', settings: { lineHeight: Number(event.target.value) } })}
                        />
                      </label>
                      <label className="br-setting">
                        正文字体
                        <select
                          value={state.settings.fontFamily}
                          onChange={(event) => persist({ type: 'settings', settings: { fontFamily: event.target.value } })}
                        >
                          <option value="serif">衬线字体</option>
                          <option value="sans">无衬线字体</option>
                        </select>
                      </label>
                    </>
                  )}
                  <p className="br-empty">PDF 保留原书排版，使用阅读工具栏调整缩放。</p>
                  <h2>导出阅读记录</h2>
                  <button className="br-export" onClick={() => exportNotes('markdown')}>
                    <IconDownload size={17} />
                    导出 Markdown 笔记
                  </button>
                  <button className="br-export" onClick={() => exportNotes('json')}>
                    <IconDownload size={17} />
                    导出完整阅读记录
                  </button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      {selection?.text && (
        <section className="br-selection" aria-label="选文操作">
          <div>
            <strong>{selection.label || label(selection.locator)}</strong>
            <p>
              {selection.text.slice(0, 240)}
              {selection.text.length > 240 ? '…' : ''}
            </p>
          </div>
          <input
            aria-label="本次选文批注"
            value={annotationNote}
            maxLength={10000}
            onChange={(event) => setAnnotationNote(event.target.value)}
            placeholder="添加批注（可选）"
          />
          <button className="br-primary" onClick={highlight}>
            <IconHighlight size={17} />
            保存高亮
          </button>
          <button disabled={!!excerptJob.current} onClick={excerpt}>
            {excerptJob.current ? '正在保存摘录…' : '存为素材摘录'}
          </button>
          <button
            onClick={() =>
              navigator.clipboard
                .writeText(selection.text)
                .then(() => setNotice('选文已复制'))
                .catch(() => setNotice('复制失败，请使用系统复制'))
            }
          >
            复制
          </button>
          <button
            aria-label="关闭选文操作"
            onClick={() => {
              setSelection(null);
              setAnnotationNote('');
            }}
          >
            <IconX size={18} />
          </button>
        </section>
      )}
    </section>
  );
}
