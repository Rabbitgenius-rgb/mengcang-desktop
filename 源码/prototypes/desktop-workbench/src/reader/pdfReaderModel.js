import { attachmentBytes } from '../sublime/attachmentPreview.js';
import { documentSelectionText, pdfPageText } from '../sublime/documentText.js';

export function clampPdfPage(value, total = 1) {
  const number = Number(value),
    maximum = Math.max(1, Math.floor(Number(total) || 1));
  return Math.max(1, Math.min(maximum, Number.isFinite(number) ? Math.floor(number) : 1));
}
export function pdfSourceKey(source) {
  return String(source?.sourceKey || source?.url || source?.dataUrl || '');
}
// The native gateway grants a short-lived opaque local URL. It never accepts
// an arbitrary filesystem path or web URL from a book or PDF annotation.
export function pdfBookOptions(source, assetBase = '') {
  const options = {
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    isEvalSupported: false,
    useWasm: false,
    enableXfa: false,
    maxImageSize: 32000000,
    canvasMaxAreaInBytes: 24000000,
    useSystemFonts: true,
  };
  if (source?.dataUrl) return { ...options, data: attachmentBytes(source) };
  const raw = String(source?.url || '');
  if (!/^mengcang-reader:\/\/source\/[A-Za-z0-9_-]+$/.test(raw)) throw Error('阅读器只接受已授权的本机图书。');
  const url = new URL(raw);
  if (url.protocol !== 'mengcang-reader:' || url.hostname !== 'source' || url.search || url.hash || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname))
    throw Error('阅读器只接受已授权的本机图书。');
  return { ...options, url: url.href, disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024 };
}
export function pdfReaderViewport(pdfPage, { width = 800, height = 800 } = {}, zoom = 1, fit = 'width', dpr = 1) {
  const base = pdfPage.getViewport({ scale: 1 });
  if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) throw Error('PDF 页尺寸无效。');
  const availableWidth = Math.max(120, Number(width) - 48 || 120),
    availableHeight = Math.max(120, Number(height) - 40 || 120);
  const fitScale = fit === 'page' ? Math.min(availableWidth / base.width, availableHeight / base.height) : availableWidth / base.width;
  const scale = fitScale * Math.max(0.5, Math.min(3, Number(zoom) || 1));
  const viewport = pdfPage.getViewport({ scale });
  const ratio = Math.min(2, Math.max(1, Number(dpr) || 1), Math.sqrt(6000000 / (viewport.width * viewport.height)));
  return {
    viewport,
    width: Math.max(1, Math.floor(viewport.width * ratio)),
    height: Math.max(1, Math.floor(viewport.height * ratio)),
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  };
}
export function pdfTextMatches(text, query, page = 1) {
  const term = String(query).trim();
  if (!term) return [];
  const pattern = new RegExp(term.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'), 'giu'),
    matches = [];
  let found;
  while ((found = pattern.exec(text))) matches.push({ page, offset: found.index, length: found[0].length });
  return matches;
}
export function pdfSearchSegments(content, query, activeOffset = -1) {
  const items = content.items.filter((item) => typeof item.str === 'string'),
    matches = pdfTextMatches(pdfPageText(content), query);
  let offset = 0,
    first = 0;
  return items.map((item) => {
    const start = offset,
      end = start + item.str.length,
      parts = [];
    offset = end + (item.hasEOL ? 1 : 0);
    while (first < matches.length && matches[first].offset + matches[first].length <= start) first++;
    let cursor = 0;
    for (let i = first; i < matches.length && matches[i].offset < end; i++) {
      const from = Math.max(start, matches[i].offset) - start,
        to = Math.min(end, matches[i].offset + matches[i].length) - start;
      if (from > cursor) parts.push({ text: item.str.slice(cursor, from) });
      if (to > from) parts.push({ text: item.str.slice(from, to), matched: true, active: matches[i].offset === activeOffset, offset: matches[i].offset });
      cursor = Math.max(cursor, to);
    }
    if (cursor < item.str.length || !parts.length) parts.push({ text: item.str.slice(cursor) });
    return parts;
  });
}
export class PdfSearchCancelled extends Error {
  constructor() {
    super('全文搜索已停止。');
    this.name = 'PdfSearchCancelled';
  }
}
// Extract one page at a time and emit hits progressively. No page, character,
// time, or hit-count ceiling: a 4,000-page book really searches every page.
export async function searchPdfDocument(
  pdf,
  query,
  { cancelled = () => false, onPage = () => {}, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {},
) {
  const results = [];
  let textPages = 0;
  for (let page = 1; page <= pdf.numPages; page++) {
    if (cancelled()) throw new PdfSearchCancelled();
    const item = await pdf.getPage(page),
      content = await item.getTextContent();
    if (cancelled()) throw new PdfSearchCancelled();
    const text = pdfPageText(content),
      matches = pdfTextMatches(text, query, page);
    if (text.trim()) textPages++;
    for (const match of matches) results.push(match);
    item.cleanup?.();
    onPage({ page, total: pdf.numPages, matches, textPages });
    // Let input, cancel, page navigation and rendering continue during a long scan.
    await yieldControl();
  }
  if (cancelled()) throw new PdfSearchCancelled();
  return { matches: results, searchedPages: pdf.numPages, textPages };
}
export async function pdfDestinationPage(pdf, destination) {
  const dest = typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
  if (!Array.isArray(dest) || !dest.length) return null;
  const value = dest[0],
    index = Number.isInteger(value) ? value : typeof value === 'object' && value ? await pdf.getPageIndex(value) : null;
  return Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index + 1 : null;
}
export async function pdfReaderOutline(pdf, { cancelled = () => false } = {}) {
  const original = await pdf.getOutline();
  if (cancelled()) return [];
  const map = async (items, prefix = '') => {
    const output = [];
    for (let index = 0; index < (items || []).length; index++) {
      if (cancelled()) return [];
      const item = items[index],
        id = prefix + index;
      let page = null;
      try {
        page = await pdfDestinationPage(pdf, item.dest);
      } catch {
        /* A broken bookmark must not break the remaining outline. */
      }
      output.push({ id, title: String(item.title || '未命名章节'), page, children: await map(item.items, id + '.') });
    }
    return output;
  };
  return map(original);
}
export function pdfSelection(selection, layer, page) {
  if (!selection || selection.isCollapsed || !selection.rangeCount || !layer) return null;
  const range = selection.getRangeAt(0);
  if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return null;
  const text = documentSelectionText(selection.toString());
  if (!text.trim()) return null;
  const bounds = layer.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .slice(0, 1000)
    .map((rect) => {
      const left = Math.max(0, Math.min(1, (rect.left - bounds.left) / bounds.width)),
        top = Math.max(0, Math.min(1, (rect.top - bounds.top) / bounds.height));
      const right = Math.max(left, Math.min(1, ((rect.right ?? rect.left + rect.width) - bounds.left) / bounds.width)),
        bottom = Math.max(top, Math.min(1, ((rect.bottom ?? rect.top + rect.height) - bounds.top) / bounds.height));
      return { x: left, y: top, width: Math.min(1 - left, Math.max(0, right - left)), height: Math.min(1 - top, Math.max(0, bottom - top)) };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
  return { text, locator: { page, rects }, label: `第 ${page} 页` };
}
export function pdfSafeLink(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function pdfLinkRect(rect, viewport) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return null;
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect),
    left = Math.max(0, Math.min(x1, x2)),
    top = Math.max(0, Math.min(y1, y2)),
    right = Math.min(viewport.width, Math.max(x1, x2)),
    bottom = Math.min(viewport.height, Math.max(y1, y2));
  return right > left && bottom > top
    ? { x: left / viewport.width, y: top / viewport.height, width: (right - left) / viewport.width, height: (bottom - top) / viewport.height }
    : null;
}
export function pdfKeyboardPagingAllowed(event) {
  const space = event.key === ' ' || event.key === 'Spacebar';
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.nativeEvent?.isComposing &&
    event.keyCode !== 229 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (!event.shiftKey || space) &&
    !event.target?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="dialog"]')
  );
}
// Vertical reading keys must not skip the unseen remainder of a tall page.
// Horizontal arrows intentionally change the PDF page and begin at its top.
export function pdfReadingKeyAction(event, { page = 1, total = 1, scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  if (!pdfKeyboardPagingAllowed(event)) return null;
  const key = event.key,
    current = clampPdfPage(page, total),
    maximum = Math.max(0, (Number(scrollHeight) || 0) - (Number(clientHeight) || 0)),
    top = Math.max(0, Math.min(maximum, Number(scrollTop) || 0));
  if (key === 'Home') return { type: 'scroll', top: 0 };
  if (key === 'End') return { type: 'scroll', top: maximum };
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const next = clampPdfPage(current + (key === 'ArrowRight' ? 1 : -1), total);
    return next === current ? { type: 'idle' } : { type: 'page', page: next, edge: 'start' };
  }
  const space = key === ' ' || key === 'Spacebar',
    direction =
      key === 'ArrowDown' || key === 'PageDown' || (space && !event.shiftKey) ? 1 : key === 'ArrowUp' || key === 'PageUp' || (space && event.shiftKey) ? -1 : 0;
  if (!direction) return null;
  const step = key === 'ArrowDown' || key === 'ArrowUp' ? 40 : Math.max(40, (Number(clientHeight) || 0) - 40);
  if ((direction > 0 && top < maximum - 2) || (direction < 0 && top > 2))
    return { type: 'scroll', top: Math.max(0, Math.min(maximum, top + direction * step)) };
  const next = clampPdfPage(current + direction, total);
  return next === current ? { type: 'idle' } : { type: 'page', page: next, edge: direction < 0 ? 'end' : 'start' };
}

// PDF.js treats custom schemes as non-HTTP and disables its native URL range
// reader. Bridge the granted scheme explicitly; a large book is never eagerly
// fetched merely because the custom URL looks like a normal PDF URL.
export function createPdfBookSource(source, { RangeTransport, fetcher = globalThis.fetch, assetBase = '', onError = () => {} } = {}) {
  const base = pdfBookOptions(source, assetBase);
  if (base.data) return { options: Promise.resolve(base), abort() {} };
  const controller = new AbortController();
  let aborted = false,
    transport;
  const abort = () => {
    aborted = true;
    controller.abort();
  };
  const report = (problem) => {
    if (aborted) return;
    abort();
    onError(problem);
  };
  const chunkSize = base.rangeChunkSize;
  async function fetchRange(begin, end, length) {
    if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end <= begin || end > length) throw Error('PDF 请求页块无效。');
    const response = await fetcher(base.url, {
      method: 'GET',
      headers: { Range: `bytes=${begin}-${end - 1}` },
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (
      response.status !== 206 ||
      response.headers.get('Content-Range') !== `bytes ${begin}-${end - 1}/${length}` ||
      Number(response.headers.get('Content-Length')) !== end - begin
    )
      throw Error('本机图书页块不可用，请重新打开图书。');
    const expected = end - begin,
      output = new Uint8Array(expected);
    let position = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (position + value.length > expected) {
            await reader.cancel();
            throw Error('PDF 页块大小不匹配。');
          }
          output.set(value, position);
          position += value.length;
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== expected) throw Error('PDF 页块大小不匹配。');
      output.set(bytes);
      position = bytes.length;
    }
    if (position !== expected) throw Error('PDF 页块未读取完整，请重新打开。');
    return output;
  }
  const options = (async () => {
    const response = await fetcher(base.url, { method: 'HEAD', signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    const length = Number(response.headers.get('Content-Length'));
    if (
      response.status !== 200 ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      (Number.isSafeInteger(source.size) && source.size !== length) ||
      response.headers.get('Accept-Ranges') !== 'bytes'
    )
      throw Error('本机图书不可用或原件已更改，请返回资料卡重新打开。');
    const initial = await fetchRange(0, Math.min(chunkSize, length), length);
    if (aborted) throw new PdfSearchCancelled();
    transport = new (class extends RangeTransport {
      constructor() {
        super(length, initial, true, source.name);
      }
      requestDataRange(begin, end) {
        void fetchRange(begin, end, length)
          .then((bytes) => {
            if (!aborted) this.onDataRange(begin, bytes);
          })
          .catch(report);
      }
      abort() {
        abort();
      }
    })();
    const { url, ...safe } = base;
    return { ...safe, range: transport };
  })();
  return {
    options,
    abort() {
      abort();
      transport?.abort();
    },
  };
}
