import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {capturePage,trimUtf16} from '../capture.js';
import {normalizeClipperParams} from '../../src/clipper/contract.mjs';
import {articlePlainText} from '../../src/clipper/article.mjs';
import {rangeForAnchor} from '../../src/clipper/anchors.mjs';
import {domFixture} from './dom-fixture.mjs';

function mount(content) {
  const fixture = domFixture(); fixture.document.body = fixture.element('body', {}, content(fixture.element));
  globalThis.document = fixture.document; globalThis.location = {href: 'https://example.com/article'}; globalThis.Node = {TEXT_NODE: 3, ELEMENT_NODE: 1}; globalThis.getComputedStyle = fixture.document.defaultView.getComputedStyle;
  return () => {delete globalThis.document; delete globalThis.location; delete globalThis.Node; delete globalThis.getComputedStyle;};
}
test('rich article keeps safe link semantics, headings and original-image references while excluding forms and hidden UI', () => {
  const cleanup = mount(e => e('article', {}, e('h2', {}, '阅读标题'), e('p', {}, 'Hello ', e('a', {href: '/story'}, e('strong', {}, 'there')), ' end.'), e('figure', {}, e('img', {src: 'https://example.com/photo.png', alt: '原图'}), e('figcaption', {}, '图注')), e('p', {hidden: true}, '不可见内容'), e('form', {}, e('p', {}, '不读取表单')), e('script', {}, '不读取脚本'), e('nav', {}, '不读取导航')));
  try {
    const value = capturePage('article'); assert.equal(value.captureError, undefined);
    assert.equal(value.body, articlePlainText(value.article));
    assert.equal(value.body, '阅读标题\n\nHello there end.');
    assert.deepEqual(value.article.blocks[0], {id: 'b1', type: 'heading', runs: [{text: '阅读标题'}], level: 2});
    assert.deepEqual(value.article.blocks[1].runs[1], {text: 'there', href: 'https://example.com/story', strong: true});
    assert.deepEqual(value.article.blocks[2], {id: 'b3', type: 'image', src: 'https://example.com/photo.png', alt: '原图', caption: '图注'});
    assert.doesNotThrow(() => normalizeClipperParams({...value, requestId: 'dfdc0efa-7c37-43d2-9e4d-bf6068186aba'}));
    assert(!JSON.stringify(value).includes('<script')); assert(!value.body.includes('不读取'));
  } finally {cleanup();}
});
test('unsafe links become plain text and non-downloadable images remain explicit placeholders', () => {
  const cleanup = mount(e => e('article', {}, e('p', {}, e('a', {href: 'javascript:alert(1)'}, '保留文字'), e('a', {href: 'https://example.com/private?token=secret'}, '凭证链接')), e('img', {src: 'data:image/png;base64,SECRET', alt: '不能下载的图片'})));
  try {
    const value = capturePage('article'); assert.equal(value.captureError, undefined);
    assert(value.article.blocks[0].runs.every(run => !run.href));
    assert.equal(value.article.blocks[1].src, ''); assert.match(value.article.blocks[1].imageError, /公开地址/);
    assert(!JSON.stringify(value).includes('SECRET')); assert(!JSON.stringify(value).includes('secret'));
    assert.equal(value.captureWarnings.length, 1);
  } finally {cleanup();}
});
test('legacy pages without article or main preserve BODY headings, paragraphs and image order', () => {
  const cleanup = mount(e => [e('h1', {}, '合成旧网页标题'), e('p', {}, '第一段正文'), e('img', {src: 'https://example.com/diagram.gif', alt: '中间的图'}), e('h2', {}, '概述'), e('p', {}, '最后一段正文')]);
  try {
    const capture = capturePage('article'); assert.equal(capture.captureError, undefined);
    assert.deepEqual(capture.article.blocks.map(block => block.type), ['heading', 'paragraph', 'image', 'heading', 'paragraph']);
    assert.equal(capture.article.blocks[0].level, 1); assert.equal(capture.article.blocks[3].level, 2);
    assert.equal(capture.article.blocks[2].src, 'https://example.com/diagram.gif');
    assert.equal(capture.body, '合成旧网页标题\n\n第一段正文\n\n概述\n\n最后一段正文');
    assert.equal(capture.body, articlePlainText(capture.article));
    assert.doesNotThrow(() => normalizeClipperParams({...capture, requestId: 'd36f5c93-c5f3-4478-b9b6-17f8a3fa9d7d'}));
  } finally {cleanup();}
});
test('article headers retain their heading and lead while a site banner stays excluded', () => {
  const cleanup = mount(e => [e('header', {}, e('h1', {}, '站点横幅')), e('article', {}, e('header', {}, e('h1', {}, '正文标题'), e('p', {}, '文章导语')), e('p', {}, '正文段落'))]);
  try {
    const capture = capturePage('article'); assert.equal(capture.captureError, undefined);
    assert.deepEqual(capture.article.blocks.map(block => block.type), ['heading', 'paragraph', 'paragraph']);
    assert.equal(capture.body, '正文标题\n\n文章导语\n\n正文段落');
    assert.equal(capture.body, articlePlainText(capture.article));
  } finally {cleanup();}
});
test('a hidden first article or hidden ancestor never masks the next visible article or main', () => {
  for (const content of [
    e => [e('article', {hidden: true}, e('p', {}, '隐藏正文')), e('article', {}, e('p', {}, '可见正文'))],
    e => [e('div', {style: 'display:none'}, e('article', {}, e('p', {}, '隐藏正文'))), e('main', {}, e('header', {}, e('h2', {}, '主内容标题')), e('p', {}, '可见正文'))],
  ]) {
    const cleanup = mount(content);
    try {const capture = capturePage('article'); assert.equal(capture.captureError, undefined); assert.ok(capture.body.includes('可见正文')); assert.ok(!capture.body.includes('隐藏正文'));}
    finally {cleanup();}
  }
});
test('article previews inside navigation, asides, forms or site banners cannot replace the real main content', () => {
  for (const tag of ['nav', 'aside', 'form', 'header']) {
    const cleanup = mount(e => [e(tag, {}, e('article', {}, e('p', {}, '导航预览卡片'))), e('main', {}, e('header', {}, e('h1', {}, '真正文章')), e('p', {}, '正文内容'))]);
    try {
      const capture = capturePage('article'); assert.equal(capture.captureError, undefined);
      assert.equal(capture.body, '真正文章\n\n正文内容');
      assert.deepEqual(capture.article.blocks.map(block => block.type), ['heading', 'paragraph']);
    } finally {cleanup();}
  }
});
test('blockquote text retains quote semantics around nested tables and numbered lists', () => {
  const cleanup = mount(e => e('article', {}, e('blockquote', {}, e('p', {}, '引用开头'), e('div', {},
    e('table', {}, e('tr', {}, e('th', {}, '项目'), e('th', {}, '数量')), e('tr', {}, e('td', {}, '甲'), e('td', {}, '12'))),
    e('ol', {start: '3'}, e('li', {}, '备份'), e('li', {}, '安装'))), e('p', {}, '引用结尾'))));
  try {
    const capture = capturePage('article'); assert.equal(capture.captureError, undefined);
    assert.deepEqual(capture.article.blocks.map(block => block.type), ['quote', 'table', 'list-item', 'list-item', 'quote']);
    assert.deepEqual(capture.article.blocks.filter(block => block.type === 'list-item').map(block => block.marker), ['3.', '4.']);
    assert.equal(capture.body, '引用开头\n\n项目\t数量\n甲\t12\n\n3. 备份\n\n4. 安装\n\n引用结尾');
    assert.equal(capture.body, articlePlainText(capture.article));
    assert.doesNotThrow(() => normalizeClipperParams({...capture, requestId: 'd36f5c93-c5f3-4478-b9b6-17f8a3fa9d7d'}));
  } finally {cleanup();}
});
test('tables preserve cell boundaries, headers, spans, safe links and every image after their table', () => {
  const cleanup = mount(e => e('article', {}, e('table', {}, e('caption', {}, '比较表'), e('thead', {}, e('tr', {}, e('th', {colspan: '2'}, '项目'))), e('tbody', {},
    e('tr', {}, e('td', {}, ''), e('td', {rowspan: '2'}, e('a', {href: '/source'}, e('strong', {}, '甲')), e('img', {src: 'https://example.com/one.png', alt: '第一张'}))),
    e('tr', {}, e('td', {}, '乙', e('img', {src: 'data:image/png;base64,private', alt: '第二张'}))),
  )), e('p', {}, '表后正文')));
  try {
    const capture = capturePage('article'); assert.equal(capture.captureError, undefined);
    assert.deepEqual(capture.article.blocks.map(block => block.type), ['paragraph', 'table', 'image', 'image', 'paragraph']);
    const table = capture.article.blocks[1]; assert.equal(table.imagesAfter, true);
    assert.deepEqual(table.rows[0].cells[0], {runs: [{text: '项目'}], header: true, colspan: 2});
    assert.deepEqual(table.rows[1].cells[0].runs, []);
    assert.deepEqual(table.rows[1].cells[1], {runs: [{text: '甲', href: 'https://example.com/source', strong: true}], header: false, rowspan: 2});
    assert.equal(capture.article.blocks[2].alt, '第一张'); assert.equal(capture.article.blocks[3].alt, '第二张');
    assert.ok(capture.article.blocks[3].imageError); assert.equal(capture.captureWarnings.length, 1);
    assert.equal(capture.body, '比较表\n\n项目\n\t甲\n乙\n\n表后正文');
    assert.equal(capture.body, articlePlainText(capture.article));
    const {captureWarnings, ...params} = capture;
    assert.doesNotThrow(() => normalizeClipperParams({...params, requestId: 'd36f5c93-c5f3-4478-b9b6-17f8a3fa9d7d'}));
  } finally {cleanup();}
  const emptyFirst = mount(e => e('table', {}, e('tr', {}, e('td', {}, ''), e('td', {}, '保留空列'))));
  try {const capture = capturePage('article'); assert.equal(capture.body, '\t保留空列'); assert.equal(capture.body, articlePlainText(capture.article));} finally {emptyFirst();}
});
test('ordered list starts, explicit values, nesting, reverse order and alphabetic markers remain distinct', () => {
  const cleanup = mount(e => e('article', {}, e('ol', {start: '3'},
    e('li', {}, '第三项', e('ul', {}, e('li', {}, '子项'))), e('li', {value: '7'}, '第七项'), e('li', {}, '第八项')),
    e('ol', {reversed: ''}, e('li', {}, '倒序二'), e('li', {}, '倒序一')),
    e('ol', {type: 'A', start: '26'}, e('li', {}, '字母项'), e('li', {}, '后续字母项'))));
  try {
    const capture = capturePage('article'); assert.equal(capture.captureError, undefined);
    assert.deepEqual(capture.article.blocks.map(({marker, depth}) => [marker, depth]), [['3.', 0], ['•', 1], ['7.', 0], ['8.', 0], ['2.', 0], ['1.', 0], ['Z.', 0], ['AA.', 0]]);
    assert.equal(capture.body, '3. 第三项\n\n• 子项\n\n7. 第七项\n\n8. 第八项\n\n2. 倒序二\n\n1. 倒序一\n\nZ. 字母项\n\nAA. 后续字母项');
    assert.equal(capture.body, articlePlainText(capture.article));
    assert.doesNotThrow(() => normalizeClipperParams({...capture, requestId: 'd36f5c93-c5f3-4478-b9b6-17f8a3fa9d7d'}));
  } finally {cleanup();}
});
test('table bounds and unsupported nested tables fail explicitly instead of flattening or truncating', () => {
  for (const [content, reason] of [
    [e => e('table', {}, ...Array.from({length: 201}, () => e('tr', {}, e('td', {}, '格')))), /200 行/],
    [e => e('table', {}, e('tr', {}, e('td', {colspan: '101'}, '格'))), /跨行跨列/],
    [e => e('table', {}, e('tr', {}, e('td', {}, e('table', {}, e('tr', {}, e('td', {}, '内层')))))), /嵌套表格/],
  ]) {
    const cleanup = mount(content); try {assert.match(capturePage('article').captureError, reason);} finally {cleanup();}
  }
});
test('article limits produce explicit errors rather than silently dropping the tail', () => {
  let cleanup = mount(e => e('article', {}, e('p', {}, '字'.repeat(50001))));
  try {assert.match(capturePage('article').captureError, /50000/);} finally {cleanup();}
  cleanup = mount(e => e('article', {}, ...Array.from({length: 1201}, () => e('p', {}, '正文'))));
  try {assert.match(capturePage('article').captureError, /1200/);} finally {cleanup();}
  cleanup = mount(e => e('article', {}, e('p', {}, '正文'), ...Array.from({length: 41}, () => e('img', {src: 'https://example.com/a.png'}))));
  try {assert.match(capturePage('article').captureError, /40/);} finally {cleanup();}
});

async function contentFixture({boundary,textValue} = {}) {
  const {document, element} = domFixture(); const text = textValue ?? 'Before selected sentence after';
  const paragraph = element('p', {}, text), article = boundary ? element('article', {}, ...(boundary === 'last' ? [element('p', {}, 'Earlier article content')] : []), paragraph, ...(boundary === 'first' ? [element('p', {}, 'Following article content')] : [])) : null;
  document.body = boundary ? element('body', {}, element('div', {}, '外部推广前文'), article, element('div', {}, '外部推荐后文')) : element('body', {}, paragraph); const node = paragraph.childNodes[0];
  const whole = !!boundary || textValue !== undefined, start = whole ? 0 : 7, end = whole ? text.length : 24;
  const selected = {startContainer: node, startOffset: start, endContainer: node, endOffset: end, intersectsNode: target => target === node, isPointInRange: (target, offset) => target === node && offset >= start && offset <= end};
  const selection = {rangeCount: 1, isCollapsed: false, getRangeAt: () => selected, toString: () => text.slice(start, end)};
  let listener; const highlights = new Map();
  const context = vm.createContext({document, location: {href: 'https://example.com/article', protocol: 'https:'}, window: {getSelection: () => selection, addEventListener() {}}, CSS: {highlights}, Highlight: class {constructor(...ranges) {this.ranges = ranges;}}, MutationObserver: class {observe() {}}, chrome: {runtime: {id: 'fixture-extension', getURL: part => `chrome-extension://fixture-extension/${part}`, onMessage: {addListener: value => {listener = value;}}, sendMessage: async () => ({ok: false})}}, getComputedStyle: document.defaultView.getComputedStyle, Node: {TEXT_NODE: 3, ELEMENT_NODE: 1}, URL, TextEncoder, setTimeout, clearTimeout});
  vm.runInContext(await fs.readFile(new URL('../content-highlights.js', import.meta.url), 'utf8'), context);
  const convert = value => {context.inputJSON = JSON.stringify(value); return vm.runInContext('JSON.parse(inputJSON)', context);};
  return {document, paragraph, article, highlights, send(request, sender = {id: 'fixture-extension', url: 'chrome-extension://fixture-extension/background.js'}) {let reply; const returned = listener(convert(request), convert(sender), value => {reply = JSON.parse(JSON.stringify(value));}); return {returned, reply};}};
}
test('content selection uses the actual Range and refuses stale context-menu text or foreign extension messages', async () => {
  const f = await contentFixture();
  const request = {action: 'mengcang:collect', kind: 'highlight', selectedText: 'selected sentence', expectedUrl: 'https://example.com/article'};
  const value = f.send(request).reply;
  assert.equal(value.ok, true); assert.equal(value.data.kind, 'highlight'); assert.equal(value.data.anchor.exact, 'selected sentence'); assert.equal(value.data.body, 'selected sentence');
  assert.deepEqual(value.data.anchor.textFragment, {start: 'selected sentence', prefix: 'Before', suffix: 'after'});
  assert.match(f.send({...request, selectedText: 'outdated selection'}).reply.error, /选区已变化/);
  assert.match(f.send({...request, expectedUrl: 'https://example.com/another'}).reply.error, /页面已经切换/);
  assert.equal(f.send(request, {id: 'another-extension', url: 'https://example.com'}).reply, undefined);
  assert.equal(f.send(request, {id: 'fixture-extension', tab: {id: 2}, url: 'https://example.com'}).reply, undefined);
});
test('restored highlights use CSS ranges, preserve source text, and refuse to locate ambiguous or missing quotes', async () => {
  const f = await contentFixture(), original = f.document.body.textContent;
  const item = {id: 'a', anchor: {version: 1, exact: 'selected sentence', prefix: 'Before', suffix: 'after', start: 7, end: 24}};
  const request = {action: 'mengcang:restore', expectedUrl: 'https://example.com/article', items: [item], focusId: 'a'};
  const result = f.send(request).reply;
  assert.equal(result.ok, true); assert.equal(result.data.matched, 1); assert(f.paragraph.scrolled);
  assert.equal(f.highlights.get('mengcang-saved').ranges.length, 1); assert.equal(f.document.body.textContent, original);
  const missing = f.send({...request, items: [{id: 'a', anchor: {...item.anchor, exact: 'different sentence', start: undefined, end: undefined}}]}).reply;
  assert.equal(missing.ok, false); assert.match(missing.error, /原文已变化/);
  f.paragraph.childNodes[0].nodeValue = 'Before selected sentence after selected sentence';
  const ambiguous = f.send({...request, items: [{id: 'a', anchor: {version: 1, exact: 'selected sentence', prefix: '', suffix: ''}}]}).reply;
  assert.equal(ambiguous.ok, false); assert.match(ambiguous.error, /原文已变化/);
});
test('first and last article highlights exclude surrounding promotion divs and resolve in both the Reader root and original page', async () => {
  for (const boundary of ['first', 'last']) {
    const f = await contentFixture({boundary});
    const result = f.send({action: 'mengcang:collect', kind: 'highlight', selectedText: 'Before selected sentence after', expectedUrl: 'https://example.com/article'}).reply;
    assert.equal(result.ok, true); const anchor = result.data.anchor;
    assert(!anchor.prefix.includes('推广')); assert(!anchor.suffix.includes('推荐'));
    assert.deepEqual(anchor.textFragment, {start: 'Before selected sentence after', prefix: '', suffix: ''}, 'native URL context stays inside the selected paragraph even when quote context spans article paragraphs');
    if (boundary === 'first') {assert.equal(anchor.prefix, ''); assert.equal(anchor.suffix, 'Following article content');}
    else {assert.equal(anchor.prefix, 'Earlier article content'); assert.equal(anchor.suffix, '');}
    assert(rangeForAnchor(f.article, anchor), 'the saved Reader article must resolve the same selector');
    assert(rangeForAnchor(f.document.body, anchor), 'extra original-page content must not invalidate its article selector');
    const restored = f.send({action: 'mengcang:restore', expectedUrl: 'https://example.com/article', items: [{id: 'boundary', anchor}], focusId: 'boundary'}).reply;
    assert.equal(restored.ok, true); assert.equal(restored.data.matched, 1);
  }
});
test('emoji at clipping boundaries never creates an invalid highlight title, page metadata or image label', async () => {
  const quote = 'a'.repeat(89) + '😀随后继续';
  const f = await contentFixture({textValue: quote});
  const highlight = f.send({action: 'mengcang:collect', kind: 'highlight', selectedText: quote, expectedUrl: 'https://example.com/article'}).reply;
  assert.equal(highlight.ok, true); assert.equal(highlight.data.title, 'a'.repeat(89));
  assert.doesNotThrow(() => normalizeClipperParams({...highlight.data, requestId: '9d2a27a4-1026-4919-88fa-a6385dc3ae01'}));
  assert.equal(trimUtf16('a'.repeat(88) + '😀随后', 90), 'a'.repeat(88) + '😀');
  const boundary = 'a'.repeat(999) + '😀尾', description = 'a'.repeat(49999) + '😀尾';
  const cleanup = mount(e => e('article', {}, e('p', {}, '正文'), e('figure', {}, e('img', {src: 'https://example.com/a.png', alt: boundary}), e('figcaption', {}, boundary))));
  try {
    const originalQuery = document.querySelector;
    document.title = boundary;
    document.querySelector = selector => selector.startsWith('meta[') ? {content: selector.includes('description') ? description : boundary} : originalQuery(selector);
    const article = capturePage('article'), link = capturePage('link');
    for (const key of ['title', 'author', 'siteName']) assert.equal(article[key], 'a'.repeat(999));
    assert.equal(article.article.blocks[1].alt, 'a'.repeat(999)); assert.equal(article.article.blocks[1].caption, 'a'.repeat(999));
    assert.equal(link.body, 'a'.repeat(49999));
    assert.doesNotThrow(() => normalizeClipperParams({...article, requestId: 'f7daf408-4dd0-4396-9cd9-b2b4e15b6bcf'}));
    assert.doesNotThrow(() => normalizeClipperParams({...link, requestId: '019761d6-fb62-4782-a38a-d0bf03998b13'}));
  } finally {cleanup();}
});
