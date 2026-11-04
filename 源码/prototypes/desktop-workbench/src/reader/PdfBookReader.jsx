import React, { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, TextLayer, PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  clampPdfPage,
  pdfSourceKey,
  createPdfBookSource,
  pdfReaderViewport,
  searchPdfDocument,
  pdfReaderOutline,
  pdfDestinationPage,
  pdfSelection,
  pdfSearchSegments,
  pdfSafeLink,
  pdfLinkRect,
  pdfReadingKeyAction,
} from './pdfReaderModel.js';
import './pdfBookReader.css';
GlobalWorkerOptions.workerSrc = workerUrl;
const assetBase = import.meta.env.BASE_URL + 'pdf-assets/';
const initialZoom = (value) => Math.max(0.5, Math.min(3, Number(value) || 1));
const failure = (problem) => String(problem?.message || 'PDF 暂时无法读取，原文件仍保留。');

export default function PdfBookReader({
  source,
  location,
  settings = {},
  annotations = [],
  navigateTo,
  onLocation,
  onReady,
  onSelection,
  onError,
  onSettings,
  onOpenLink,
  onRecovered,
}) {
  const root = useRef(null),
    viewport = useRef(null),
    canvas = useRef(null),
    layer = useRef(null),
    sheet = useRef(null),
    pdfRef = useRef(null),
    paintedText = useRef(null),
    generation = useRef(0),
    searchGeneration = useRef(0),
    unlock = useRef(null),
    callbacks = useRef({}),
    pageRef = useRef(1),
    pendingNavigation = useRef(null),
    pendingLanding = useRef(null),
    hadReadingError = useRef(false);
  callbacks.current = { onLocation, onReady, onSelection, onError, onSettings, onOpenLink, onRecovered };
  const sourceKey = pdfSourceKey(source);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [draftPage, setDraftPage] = useState('1'),
    [dimensions, setDimensions] = useState({ width: 800, height: 800 }),
    [loaded, setLoaded] = useState(0),
    [painted, setPainted] = useState(0),
    [status, setStatus] = useState('loading'),
    [error, setError] = useState(''),
    [selectionError, setSelectionError] = useState(''),
    [zoom, setZoom] = useState(() => initialZoom(settings.zoom)),
    [fit, setFit] = useState(settings.fit === 'page' ? 'page' : 'width'),
    [password, setPassword] = useState(''),
    [passwordState, setPasswordState] = useState(''),
    [query, setQuery] = useState(''),
    [activeQuery, setActiveQuery] = useState(''),
    [search, setSearch] = useState({ status: 'idle', done: 0, total: 0, textPages: 0 }),
    [hits, setHits] = useState([]),
    [activeHit, setActiveHit] = useState(0),
    [links, setLinks] = useState([]),
    [reload, setReload] = useState(0);
  pageRef.current = page;
  const active = hits[activeHit];
  function report(problem) {
    const message = failure(problem);
    hadReadingError.current = true;
    setError(message);
    callbacks.current.onError?.(message);
  }
  function goPage(value, edge = 'start') {
    const next = clampPdfPage(typeof value === 'function' ? value(pageRef.current) : value, total);
    if (next !== pageRef.current) pendingLanding.current = { page: next, edge };
    setDraftPage(String(next));
    setPage(next);
  }
  function changeSettings(change) {
    if (change.zoom !== undefined) setZoom(initialZoom(change.zoom));
    if (change.fit) setFit(change.fit);
    callbacks.current.onSettings?.({ ...settings, zoom, fit, ...change });
  }
  useEffect(() => {
    setZoom(initialZoom(settings.zoom));
    setFit(settings.fit === 'page' ? 'page' : 'width');
  }, [settings.zoom, settings.fit]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setDimensions({ width: element.clientWidth || 800, height: element.clientHeight || 800 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    searchGeneration.current++;
    let task, timer, sourceLoader;
    pdfRef.current = null;
    paintedText.current = null;
    unlock.current = null;
    pendingNavigation.current = null;
    pendingLanding.current = null;
    setTotal(0);
    setPage(1);
    setDraftPage('1');
    setStatus('loading');
    setError('');
    setSelectionError('');
    setPassword('');
    setPasswordState('');
    setQuery('');
    setActiveQuery('');
    setHits([]);
    setActiveHit(0);
    setSearch({ status: 'idle', done: 0, total: 0, textPages: 0 });
    setLinks([]);
    callbacks.current.onSelection?.(null);
    const isCurrent = () => request === generation.current;
    try {
      sourceLoader = createPdfBookSource(source, {
        RangeTransport: PDFDataRangeTransport,
        assetBase,
        onError: (problem) => {
          if (isCurrent()) {
            setStatus('error');
            report(problem);
            void task?.destroy();
          }
        },
      });
      const setup = sourceLoader.options.then((options) => {
        if (!isCurrent()) return null;
        task = getDocument(options);
        task.onPassword = (update, reason) => {
          if (!isCurrent()) return;
          clearTimeout(timer);
          unlock.current = update;
          setPasswordState(reason === 2 ? '密码不正确，请重试。' : '请输入密码以阅读此 PDF。');
          setStatus('password');
        };
        return task.promise;
      });
      timer = setTimeout(() => {
        if (isCurrent()) {
          setStatus('error');
          report(Error('PDF 加载超时，请重试或打开原文件。'));
          sourceLoader.abort();
          void task?.destroy();
        }
      }, 60000);
      setup
        .then(async (pdf) => {
          clearTimeout(timer);
          if (!pdf) return;
          if (!isCurrent()) {
            void pdf.destroy();
            return;
          }
          pdfRef.current = pdf;
          unlock.current = null;
          setPassword('');
          setPasswordState('');
          setTotal(pdf.numPages);
          setPage(clampPdfPage(pendingNavigation.current?.page ?? location?.page, pdf.numPages));
          setLoaded((value) => value + 1);
          callbacks.current.onReady?.({ totalPages: pdf.numPages, outline: [] });
          try {
            const outline = await pdfReaderOutline(pdf, { cancelled: () => !isCurrent() });
            if (isCurrent()) callbacks.current.onReady?.({ totalPages: pdf.numPages, outline });
          } catch {
            /* A PDF without a usable outline still supports page reading and search. */
          }
        })
        .catch((problem) => {
          clearTimeout(timer);
          if (isCurrent()) {
            setStatus('error');
            report(problem);
          }
        });
    } catch (problem) {
      setStatus('error');
      report(problem);
    }
    return () => {
      generation.current++;
      searchGeneration.current++;
      clearTimeout(timer);
      unlock.current = null;
      pdfRef.current = null;
      paintedText.current = null;
      sourceLoader?.abort();
      void task?.destroy();
    };
  }, [sourceKey, source?.url, source?.dataUrl, reload]);
  useEffect(() => {
    if (!navigateTo) return;
    pendingNavigation.current = navigateTo;
    if (pdfRef.current) setPage(clampPdfPage(navigateTo.page, pdfRef.current.numPages));
  }, [navigateTo?.page, navigateTo?.nonce]);
  useEffect(() => {
    if (!total || !pdfRef.current) return;
    setDraftPage(String(page));
    callbacks.current.onLocation?.({ page, totalPages: total });
    callbacks.current.onSelection?.(null);
    setSelectionError('');
    viewport.current?.scrollTo?.({ top: 0, left: 0 });
  }, [page, total, sourceKey]);
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf || !canvas.current || !layer.current) return;
    let cancelled = false,
      render,
      textLayer;
    const request = generation.current,
      target = canvas.current,
      textContainer = layer.current;
    const current = () => !cancelled && request === generation.current;
    paintedText.current = null;
    textContainer.replaceChildren();
    setLinks([]);
    setStatus('rendering');
    setError('');
    callbacks.current.onSelection?.(null);
    setSelectionError('');
    pdf
      .getPage(page)
      .then(async (pdfPage) => {
        if (!current()) return;
        const drawing = pdfReaderViewport(pdfPage, dimensions, zoom, fit, window.devicePixelRatio || 1);
        target.width = drawing.width;
        target.height = drawing.height;
        target.style.width = drawing.viewport.width + 'px';
        target.style.height = drawing.viewport.height + 'px';
        sheet.current.style.width = drawing.viewport.width + 'px';
        sheet.current.style.height = drawing.viewport.height + 'px';
        textContainer.style.setProperty('--total-scale-factor', String(drawing.viewport.scale * (drawing.viewport.userUnit || 1)));
        render = pdfPage.render({
          canvasContext: target.getContext('2d'),
          viewport: drawing.viewport,
          transform: drawing.transform,
          background: 'rgb(255,255,255)',
        });
        await render.promise;
        if (!current()) return;
        const content = await pdfPage.getTextContent();
        if (!current()) return;
        textLayer = new TextLayer({ textContentSource: content, container: textContainer, viewport: drawing.viewport });
        await textLayer.render();
        if (!current()) return;
        paintedText.current = { content, divs: textLayer.textDivs, page };
        setStatus('ready');
        setPainted((value) => value + 1);
        if (hadReadingError.current) {
          hadReadingError.current = false;
          callbacks.current.onRecovered?.({ sourceKey, page });
        }
        try {
          const original = await pdfPage.getAnnotations({ intent: 'display' });
          if (!current()) return;
          setLinks(
            original
              .filter((item) => item.subtype === 'Link' && (pdfSafeLink(item.url) || item.dest))
              .map((item) => ({ id: item.id, url: pdfSafeLink(item.url), dest: item.dest, rect: pdfLinkRect(item.rect, drawing.viewport) }))
              .filter((item) => item.rect),
          );
        } catch {
          /* Broken optional PDF links do not prevent page reading. */
        }
      })
      .catch((problem) => {
        if (current() && problem.name !== 'RenderingCancelledException') {
          setStatus('error');
          report(problem);
        }
      });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [page, dimensions.width, dimensions.height, zoom, fit, loaded]);
  useEffect(() => {
    const landing = pendingLanding.current,
      element = viewport.current;
    if (status !== 'ready' || !element || !landing || landing.page !== page) return;
    element.scrollTo?.({ top: landing.edge === 'end' ? Math.max(0, element.scrollHeight - element.clientHeight) : 0, left: 0 });
    pendingLanding.current = null;
  }, [status, painted, page]);
  useEffect(() => {
    const text = paintedText.current;
    if (!text || text.page !== page) return;
    const parts = pdfSearchSegments(text.content, activeQuery, active?.page === page ? active.offset : -1);
    text.divs.forEach((div, index) =>
      div.replaceChildren(
        ...(parts[index] || []).map((part) => {
          if (!part.matched) return document.createTextNode(part.text);
          const mark = document.createElement('mark');
          mark.className = part.active ? 'br-pdf-match is-active' : 'br-pdf-match';
          mark.textContent = part.text;
          return mark;
        }),
      ),
    );
    layer.current?.querySelector?.('.br-pdf-match.is-active')?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [activeQuery, active?.page, active?.offset, painted, page]);
  function captureSelection() {
    setSelectionError('');
    try {
      callbacks.current.onSelection?.(pdfSelection(window.getSelection(), layer.current, page));
    } catch (problem) {
      setSelectionError(failure(problem));
      callbacks.current.onSelection?.(null);
    }
  }
  async function startSearch(event) {
    event?.preventDefault();
    const term = query.trim(),
      pdf = pdfRef.current;
    if (!pdf || !term) return;
    const request = ++searchGeneration.current,
      documentRequest = generation.current,
      results = [];
    let done = 0,
      textPages = 0;
    setActiveQuery(term);
    setHits([]);
    setActiveHit(0);
    setSearch({ status: 'searching', done: 0, total: pdf.numPages, textPages: 0 });
    const current = () => request === searchGeneration.current && documentRequest === generation.current;
    try {
      const result = await searchPdfDocument(pdf, term, {
        cancelled: () => !current(),
        onPage: (progress) => {
          if (!current()) return;
          done = progress.page;
          textPages = progress.textPages;
          for (const match of progress.matches) results.push(match);
          if (progress.matches.length) {
            setHits([...results]);
            if (results.length === progress.matches.length) setPage(progress.matches[0].page);
          }
          setSearch({ status: 'searching', done, total: pdf.numPages, textPages });
        },
      });
      if (current()) setSearch({ status: 'complete', done: result.searchedPages, total: pdf.numPages, textPages: result.textPages });
    } catch (problem) {
      if (current()) setSearch({ status: 'error', done, total: pdf.numPages, textPages, error: failure(problem) });
    }
  }
  function cancelSearch() {
    searchGeneration.current++;
    setSearch((current) => ({ ...current, status: 'cancelled' }));
  }
  function clearSearch() {
    searchGeneration.current++;
    setQuery('');
    setActiveQuery('');
    setHits([]);
    setActiveHit(0);
    setSearch({ status: 'idle', done: 0, total: 0, textPages: 0 });
  }
  function nextHit(direction) {
    if (!hits.length) return;
    const next = (activeHit + direction + hits.length) % hits.length;
    setActiveHit(next);
    setPage(hits[next].page);
  }
  async function followLink(link) {
    const request = generation.current;
    if (link.url) {
      try {
        if (callbacks.current.onOpenLink) await callbacks.current.onOpenLink(link.url);
        else window.open(link.url, '_blank', 'noopener,noreferrer');
      } catch (problem) {
        if (request === generation.current) report(problem);
      }
      return;
    }
    try {
      const target = await pdfDestinationPage(pdfRef.current, link.dest);
      if (request === generation.current && target) setPage(target);
    } catch (problem) {
      if (request === generation.current) report(problem);
    }
  }
  function keyboard(event) {
    const element = viewport.current;
    if (!element || !total) return;
    const action = pdfReadingKeyAction(event, {
      page,
      total,
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    });
    if (!action) return;
    event.preventDefault();
    if (action.type === 'page') goPage(action.page, action.edge);
    else if (action.type === 'scroll' && status === 'ready') element.scrollTo?.({ top: action.top });
  }
  const pageReady = status === 'ready' && paintedText.current?.page === page;
  return (
    <section
      className={`br-pdf br-pdf-theme-${settings.theme || 'light'}`}
      ref={root}
      aria-label={`PDF 阅读器：${source?.name || '图书'}`}
      onKeyDown={keyboard}
    >
      <div className="br-pdf-toolbar" role="toolbar" aria-label="PDF 阅读控制">
        <button type="button" title="上一页" aria-label="PDF 上一页" disabled={!total || page <= 1} onClick={() => goPage((value) => value - 1)}>
          ‹
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            goPage(draftPage);
          }}
        >
          <label>
            第{' '}
            <input
              aria-label="PDF 页码"
              inputMode="numeric"
              value={draftPage}
              disabled={!total}
              onChange={(event) => setDraftPage(event.target.value)}
              onBlur={() => {
                if (draftPage.trim()) goPage(draftPage);
                else setDraftPage(String(page));
              }}
            />{' '}
            / {total || '—'} 页
          </label>
        </form>
        <button type="button" title="下一页" aria-label="PDF 下一页" disabled={!total || page >= total} onClick={() => goPage((value) => value + 1)}>
          ›
        </button>
        <span className="br-pdf-toolbar-divider" />
        <button
          type="button"
          aria-label="PDF 缩小"
          disabled={zoom <= 0.5}
          onClick={() => changeSettings({ zoom: Math.max(0.5, Math.round((zoom - 0.25) * 100) / 100) })}
        >
          −
        </button>
        <output aria-label="PDF 缩放比例">{Math.round(zoom * 100)}%</output>
        <button
          type="button"
          aria-label="PDF 放大"
          disabled={zoom >= 3}
          onClick={() => changeSettings({ zoom: Math.min(3, Math.round((zoom + 0.25) * 100) / 100) })}
        >
          ＋
        </button>
        <select value={fit} aria-label="PDF 适应方式" onChange={(event) => changeSettings({ fit: event.target.value, zoom: 1 })}>
          <option value="width">适合宽度</option>
          <option value="page">适合整页</option>
        </select>
      </div>
      <form className="br-pdf-search" role="search" aria-label="图书全文搜索" onSubmit={startSearch}>
        <input
          type="search"
          value={query}
          disabled={!total}
          aria-label="搜索 PDF 全文"
          placeholder="搜索这本书的全文"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={!total || !query.trim()}>
          {search.status === 'searching' ? '重新搜索' : '搜索'}
        </button>
        {search.status === 'searching' && (
          <button type="button" onClick={cancelSearch}>
            停止
          </button>
        )}
        {activeQuery && (
          <>
            <span className="br-pdf-hit-count" aria-live="polite">
              {hits.length ? `${activeHit + 1} / ${hits.length}` : '0 处'}
            </span>
            <button type="button" disabled={!hits.length} aria-label="PDF 上一处搜索结果" onClick={() => nextHit(-1)}>
              ↑
            </button>
            <button type="button" disabled={!hits.length} aria-label="PDF 下一处搜索结果" onClick={() => nextHit(1)}>
              ↓
            </button>
            <button type="button" aria-label="清除 PDF 搜索" onClick={clearSearch}>
              清除
            </button>
          </>
        )}
      </form>
      {search.status !== 'idle' && (
        <p className="br-pdf-search-status" role="status">
          {search.status === 'searching'
            ? `正在搜索 ${search.done} / ${search.total} 页，已找到 ${hits.length} 处。`
            : search.status === 'cancelled'
              ? `已停止：仅搜索 ${search.done} / ${search.total} 页，以上为部分结果。`
              : search.status === 'error'
                ? `搜索在第 ${search.done + 1} 页停止：${search.error}。目前结果仅覆盖前 ${search.done} 页。`
                : `已搜索全部 ${search.total} 页，共 ${hits.length} 处。${search.textPages === 0 ? '此 PDF 没有文字层，无法全文检索；未运行文字识别。' : ''}`}
        </p>
      )}
      {passwordState && (
        <form
          className="br-pdf-password"
          onSubmit={(event) => {
            event.preventDefault();
            if (password) {
              setStatus('loading');
              unlock.current?.(password);
              setPassword('');
            }
          }}
        >
          <label>
            {passwordState}
            <input type="password" autoComplete="off" aria-label="PDF 阅读密码" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit">解锁阅读</button>
        </form>
      )}
      {error && (
        <p role="alert" className="br-pdf-error">
          {error}
          {status === 'error' && (
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              重新读取
            </button>
          )}
        </p>
      )}
      {selectionError && (
        <p role="alert" className="br-pdf-error">
          {selectionError}
        </p>
      )}
      <div
        className="br-pdf-viewport"
        ref={viewport}
        tabIndex={0}
        aria-label="PDF 页面，可用左右方向键翻页"
        onPointerDown={(event) => {
          if (!event.target?.closest?.('button,a,input,textarea,select,[contenteditable]')) event.currentTarget.focus({ preventScroll: true });
        }}
      >
        {(status === 'loading' || status === 'rendering') && (
          <p role="status" className="br-pdf-loading">
            {status === 'loading' ? '正在打开图书…' : `正在显示第 ${page} 页…`}
          </p>
        )}
        <div className={'br-pdf-sheet' + (pageReady ? '' : ' is-pending')} ref={sheet} hidden={!total || status === 'password'} aria-hidden={!pageReady}>
          <canvas ref={canvas} role="img" aria-label={`PDF 第 ${page} 页，共 ${total} 页`} />
          <div className="br-pdf-highlights" aria-hidden="true">
            {annotations
              .filter((item) => Number(item.locator?.page ?? item.page) === page)
              .flatMap((item) =>
                (item.locator?.rects || item.rects || []).map((rect, index) => (
                  <i
                    key={`${item.id}-${index}`}
                    className={item.color === 'blue' ? 'is-blue' : item.color === 'green' ? 'is-green' : ''}
                    style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
                  />
                )),
              )}
          </div>
          <div className="br-pdf-text-layer" ref={layer} onPointerUp={captureSelection} onKeyUp={captureSelection} />
          <div className="br-pdf-links">
            {links.map((link) => (
              <button
                type="button"
                key={link.id}
                aria-label={link.url ? `打开网页：${link.url}` : '跳转到书内引用'}
                title={link.url || '书内链接'}
                style={{
                  left: `${link.rect.x * 100}%`,
                  top: `${link.rect.y * 100}%`,
                  width: `${link.rect.width * 100}%`,
                  height: `${link.rect.height * 100}%`,
                }}
                onClick={() => followLink(link)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
