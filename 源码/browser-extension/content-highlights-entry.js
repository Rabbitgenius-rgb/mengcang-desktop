import {capturePage, trimUtf16} from './capture.js';
import {anchorFromSelection, normalizeAnchorText, rangeForAnchor} from '../src/clipper/anchors.mjs';

// This module is bundled as a classic isolated-world content script. Repeated
// activeTab injections reuse one listener and do not wrap or rewrite page text.
const stateKey = '__mengcangClipperV2';
if (!globalThis[stateKey]) {
  const state = {items: [], url: location.href, timer: null, loading: false};
  globalThis[stateKey] = state;
  const samePage = expected => !expected || new URL(expected).href === location.href;
  function paint(items = state.items, focusId = '') {
    if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') throw new Error('当前浏览器不支持网页高亮显示，请更新 Chrome 或 Edge。');
    state.items = items; state.url = location.href;
    const ranges = [], found = []; let focusRange = null;
    for (const item of items) {
      let range = null;
      try {range = rangeForAnchor(document.body, item.anchor);} catch { /* A changed page cannot be matched safely. */ }
      found.push({id: item.id, found: !!range});
      if (range) {ranges.push(range); if (item.id === focusId) focusRange = range;}
    }
    CSS.highlights.set('mengcang-saved', new Highlight(...ranges));
    CSS.highlights.delete('mengcang-focused');
    if (focusId) {
      if (!focusRange) throw new Error('原文已变化或尚未加载，无法安全定位这条高亮。');
      const focused = new Highlight(focusRange); focused.priority = 2;
      CSS.highlights.set('mengcang-focused', focused);
      (focusRange.startContainer.parentElement || document.body).scrollIntoView({block: 'center', behavior: 'instant'});
    }
    return {matched: ranges.length, total: items.length, missing: items.length - ranges.length, items: found};
  }
  function collect(message) {
    if (!samePage(message.expectedUrl)) throw new Error('页面已经切换，请回到要保存的页面后重试。');
    if (message.kind !== 'highlight') return capturePage(message.kind, message.selectedText || '', message.expectedUrl || '');
    const selection = window.getSelection(), range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    // Use the selected article, including when an earlier article is a hidden
    // responsive copy. A first document-wide match can bind unrelated context.
    let articleRoot = range?.startContainer;
    if (articleRoot?.nodeType !== 1) articleRoot = articleRoot?.parentElement;
    while (articleRoot && !articleRoot.matches?.('article,main,[role="main"]')) articleRoot = articleRoot.parentElement;
    // Match the Reader's captured content boundary. Promotional divs before or
    // after the article must not become required quote context in the Reader.
    const root = range && articleRoot?.contains(range.startContainer) && articleRoot.contains(range.endContainer) ? articleRoot : document.body;
    const anchor = anchorFromSelection(root, selection);
    if (!anchor || !normalizeAnchorText(selection?.toString() || '')) throw new Error('选中文字的位置已失效，请重新选择后保存。');
    if (message.selectedText && normalizeAnchorText(message.selectedText) !== anchor.exact) throw new Error('页面选区已变化，请重新选择后保存。');
    const capture = capturePage('highlight', selection.toString(), message.expectedUrl || '');
    if (capture.captureError) return capture;
    return {...capture, title: trimUtf16(anchor.exact, 90), anchor};
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(chrome.runtime.getURL('')))) return false;
    if (!['mengcang:collect', 'mengcang:restore'].includes(message?.action)) return false;
    try {
      if (!samePage(message.expectedUrl)) throw new Error('页面已经切换，请回到原页面后再显示高亮。');
      const result = message.action === 'mengcang:collect' ? collect(message) : paint(Array.isArray(message.items) ? message.items : [], message.focusId || '');
      reply({ok: true, data: result});
    } catch (error) {reply({ok: false, error: trimUtf16(String(error.message || '网页操作未完成'), 500)});}
    return false;
  });
  async function loadAutomatic() {
    if (state.loading || !document.body || !['http:', 'https:'].includes(location.protocol)) return;
    state.loading = true; const expectedUrl = location.href;
    try {
      // Background accepts this only for an explicitly granted site and for the
      // exact sender URL. No web-page event or message reaches the native host.
      const response = await chrome.runtime.sendMessage({action: 'page-highlights', sourceUrl: expectedUrl});
      if (response?.ok && samePage(expectedUrl)) paint(response.data.items || []);
    } catch { /* A closed desktop never interrupts the source page. */ }
    finally {state.loading = false;}
  }
  const refresh = () => {clearTimeout(state.timer); state.timer = setTimeout(() => {if (state.url !== location.href) void loadAutomatic(); else if (state.items.length) {try {paint();} catch {}}}, 300);};
  const ready = () => {void loadAutomatic(); new MutationObserver(refresh).observe(document.body, {childList: true, subtree: true, characterData: true});};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
  window.addEventListener('pageshow', () => void loadAutomatic());
  window.addEventListener('focus', () => void loadAutomatic());
  window.addEventListener('popstate', () => void loadAutomatic());
}
