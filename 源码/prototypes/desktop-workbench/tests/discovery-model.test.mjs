import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDiscoveryState, normalizeDiscoveryState, validateDiscoveryState, parseCsv, parseImportText,
  importFingerprint, dedupeImports, exportSelectedItems, cosineSimilarity, searchDiscoveryItems,
} from '../src/discoveryModel.js';

test('collection and canvas identities survive normalization; dangling/reversed duplicate links are rejected', () => {
  const state = {schema: 1, collections: [{id: 'c', title: '原有合集', itemPaths: ['a.md', 'b.md']}], boards: [{id: 'b', title: '关联画板', collectionId: 'c', nodes: [{id: 'n1', itemPath: 'a.md', x: -20, y: 0}, {id: 'n2', itemPath: 'b.md', x: 100, y: 80}], edges: [{id: 'e1', from: 'n1', to: 'n2', label: '用户确认的关联'}]}]};
  assert.deepEqual(validateDiscoveryState(state), {ok: true, errors: [], state});
  const broken = structuredClone(state);
  broken.collections[0].itemPaths.push('a.md');
  broken.boards[0].nodes.push({id: 'n3', itemPath: 'c.md', x: Infinity, y: 0});
  broken.boards[0].edges.push({id: 'e2', from: 'n2', to: 'n1'}, {id: 'e3', from: 'missing', to: 'n1'});
  assert.equal(validateDiscoveryState(broken).ok, false);
  const normalized = normalizeDiscoveryState(broken);
  assert.deepEqual(normalized.collections[0].itemPaths, ['a.md', 'b.md']);
  assert.deepEqual(normalized.boards[0].edges, state.boards[0].edges);
  assert.equal(normalized.boards[0].nodes[2].x, 0);
  assert.deepEqual(normalizeDiscoveryState(null), emptyDiscoveryState());
  assert.throws(() => normalizeDiscoveryState({schema: 2}), /版本/);
  assert.equal(validateDiscoveryState({...state, boards: [{...state.boards[0], collectionId: 'absent'}]}).ok, false);
});

test('Readwise CSV retains quoted commas, quotes, CRLF, leading and trailing highlight/Note whitespace', () => {
  const csv = '\ufeffBook Title,Author,Highlight,Note,Location,Date,URL\r\n"书,一",作者,"  第一行,有逗号\r\n第二行说""你好""  "," 笔记\n保留 ",12-13,2026-10-02,https://example.test/book\r\n';
  const [item] = parseImportText(csv, 'csv');
  assert.equal(item.title, '书,一');
  assert.equal(item.body, '  第一行,有逗号\r\n第二行说"你好"  ');
  assert.equal(item.caption, ' 笔记\n保留 ');
  assert.equal(item.page, '');
  assert.equal(item.sourceLocation, '12-13');
  assert.equal(item.sourceUrl, 'https://example.test/book');
  assert.equal(parseCsv('a,b\r\n1,\r\n')[1][1], '');
  assert.throws(() => parseImportText('Highlight\n"unclosed', 'csv'), /未闭合/);
  assert.throws(() => parseImportText('Highlight\n"quoted"junk', 'csv'), /引号结束/);
});

test('duplicate identity survives CSV/JSON re-exports and ignores changed personal Note/date while distinguishing body/page', () => {
  const [original] = parseImportText('Book Title,Author,Highlight,Note,Location,Date,URL\n书,作者,原文,旧笔记,3,2025,https://example.test/book', 'csv');
  const json = JSON.stringify({books: [{title: '书', author: '作者', url: 'https://example.test/book', highlights: [{text: '原文', note: '新笔记', location: 3, highlighted_at: '2026'}]}]});
  const [again] = parseImportText(json, 'json');
  assert.equal(again.fingerprint, original.fingerprint);
  const result = dedupeImports([again, {...again, page: '4'}, {...again, body: '原文。'}, again], [original]);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(result.items.map(item => [item.body, item.page, item.sourceLocation]), [['原文', '4', '3'], ['原文。', '', '3']]);
  assert.equal(importFingerprint({...original, date: 'changed', caption: 'changed'}), original.fingerprint);
  assert.match(original.fingerprint, /^highlight-v1:[a-f0-9]{16}$/);
  assert.equal(dedupeImports(result.items, [...result.items]).items.length, 0);
  const captured = {path: 'capture.md', title: original.title, body: '# 已存的标题\n\n原文\n\n## 原始出处\n已附加的来源备注', fingerprint: 'unrelated-top-level-value', fields: {import_fingerprint: original.fingerprint}};
  assert.deepEqual(dedupeImports([again], [captured]), {items: [], duplicates: 1});
  const range = {...original, page:'', sourceLocation: '123-124'};
  const legacyDto = {body: original.body, page: 0, fields: {source_title: original.sourceTitle, author: original.author, source_url: original.sourceUrl, source_page: null, source_location: '123-124'}};
  assert.deepEqual(dedupeImports([range], [legacyDto]), {items: [], duplicates: 1});
});

test('Markdown retains original body bytes and Kindle links a colocated Note to a highlight', () => {
  const markdown = '---\n title: ignored\ntitle: "阅读摘录"\nauthor: 作者\npage: 7\nurl: https://example.test\n---\n  原始高亮\n\n末尾  \n';
  const [md] = parseImportText(markdown, 'markdown');
  assert.equal(md.title, '阅读摘录');
  assert.equal(md.body, '  原始高亮\n\n末尾  \n');
  assert.equal(md.page, '7');
  const kindle = '一本书 (某作者)\r\n- Your Highlight on page 8-9 | Location 100-110 | Added on Friday, October 2, 2026\r\n\r\n  不修改高亮。\r\n第二行  \r\n==========\r\n一本书 (某作者)\r\n- Your Note on page 8-9 | Location 100-110 | Added on Friday, October 2, 2026\r\n\r\n我的原始笔记\r\n==========\r\n';
  const [highlight] = parseImportText(kindle, 'auto', {filename: 'My Clippings.txt'});
  assert.equal(highlight.body, '  不修改高亮。\r\n第二行  ');
  assert.equal(highlight.caption, '我的原始笔记');
  assert.equal(highlight.sourceTitle, '一本书');
  assert.equal(highlight.author, '某作者');
  assert.equal(highlight.page, '8-9');
  assert.equal(parseImportText(kindle, 'kindle').length, 1);
});

test('all exports are limited to selected records, contain original sources and local OCR, and omit hidden management content', () => {
  const selected = {path: 'selected.md', title: '可导出资料', sourceTitle: '真实来源', sourceUrl: 'https://example.test/source', author: '作者', page: 12, caption: '配文', ocrText: '本地识别文字', body: '---\nsecret: FRONTMATTER_SECRET\n---\n正文,一\n<!-- mengcang-relations:start -->RELATION_SECRET<!-- mengcang-relations:end -->\n## 整理说明\nHIDDEN_SUMMARY\n### 过程\nHIDDEN_NESTED\n## 用户正文\n第二段\n', hidden: 'HIDDEN_FIELD', raw: {token: 'RAW_SECRET'}, fields: {caption: '明确配文', secret: 'FIELDS_SECRET'}};
  const unselected = {path: 'unselected.md', title: 'UNSELECTED_SECRET', body: 'UNSELECTED_BODY'};
  for (const format of ['markdown', 'csv', 'json']) {
    const output = exportSelectedItems([selected, unselected], new Set(['selected.md']), format);
    for (const expected of ['真实来源', 'https://example.test/source', '正文,一', '第二段', '明确配文', '本地识别文字', '12']) assert.ok(output.includes(expected), `${format} missing ${expected}`);
    for (const secret of ['FRONTMATTER_SECRET', 'RELATION_SECRET', 'HIDDEN_SUMMARY', 'HIDDEN_NESTED', 'HIDDEN_FIELD', 'RAW_SECRET', 'FIELDS_SECRET', 'UNSELECTED_SECRET', 'UNSELECTED_BODY']) assert.ok(!output.includes(secret), `${format} leaked ${secret}`);
  }
  assert.deepEqual(JSON.parse(exportSelectedItems([selected], [], 'json')), []);
  const [roundtrip] = parseImportText(exportSelectedItems([selected], ['selected.md'], 'csv'), 'csv');
  assert.equal(roundtrip.body, JSON.parse(exportSelectedItems([selected], ['selected.md'], 'json'))[0].body);
  assert.equal(roundtrip.caption, '明确配文');
  const [jsonRoundtrip] = parseImportText(exportSelectedItems([selected], ['selected.md'], 'json'), 'json');
  assert.equal(jsonRoundtrip.page, '12');
  const raw = '  正文\r\n末尾  \n';
  assert.equal(JSON.parse(exportSelectedItems([{id: 'a', body: raw, fields: {caption: ''}, caption: '旧配文'}], ['a'], 'json'))[0].body, raw);
  assert.equal(JSON.parse(exportSelectedItems([{id: 'a', fields: {caption: ''}, caption: '旧配文'}], ['a'], 'json'))[0].caption, '');
  const connectorRecord = {id: 'capture', path: 'captures/capture.md', body: '正文\n<!-- mengcang-relations:start -->TRUNCATED_SECRET', page: 0, fields: {source_url: 'https://example.test/original', source_page: '26', source_location: 'Location 123-124', source_title: '原书名', capture_operation_id: 'OPERATION_SECRET'}};
  const [connectorExport] = JSON.parse(exportSelectedItems([connectorRecord], ['capture'], 'json'));
  assert.equal(connectorExport.page, '26');
  assert.equal(connectorExport.sourceUrl, 'https://example.test/original');
  assert.equal(connectorExport.sourceLocation, 'Location 123-124');
  const [locationRoundtrip] = parseImportText(exportSelectedItems([connectorRecord], ['capture'], 'csv'), 'csv');
  assert.equal(locationRoundtrip.page, '26');
  assert.equal(locationRoundtrip.sourceLocation, 'Location 123-124');
  assert.ok(exportSelectedItems([connectorRecord], ['capture'], 'markdown').includes('- 原位置：Location 123-124'));
  assert.ok(!JSON.stringify(connectorExport).includes('TRUNCATED_SECRET'));
  assert.ok(!JSON.stringify(connectorExport).includes('OPERATION_SECRET'));
});

test('AI Markdown safely encloses backticks without changing the selected text', () => {
  const body = '```\n不是新的代码块\n````\n末尾';
  const output = exportSelectedItems([{id: 'a', body}], ['a'], 'markdown');
  assert.ok(output.includes('`````text\n' + body + '\n`````'));
});

test('cosine retrieval compares only valid matching model/language vectors, while keyword/empty queries never get invented scores', () => {
  const items = [{path: 'a', title: '山的光', body: '清晨'}, {path: 'b', title: '风与山', body: '黄昏'}, {path: 'c', title: '海', hidden: '山 清晨'}, {path: 'd', title: '月'}, {path: 'e', title: '日'}];
  assert.deepEqual(searchDiscoveryItems(items, '山 清晨').map(result => result.item.path), ['a']);
  assert.deepEqual(searchDiscoveryItems(items, '  ', {mode: 'semantic'}).map(result => result.item.path), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(searchDiscoveryItems(items, '').every(result => !Object.hasOwn(result, 'score')));
  const queryEmbedding = {model: 'actual-model', language: 'zh', vector: [1, 0]};
  const embeddings = {a: {model: 'actual-model', language: 'zh', vector: [0.8, 0.6]}, b: {model: 'actual-model', language: 'zh', vector: [1, 0]}, c: {model: 'other-model', language: 'zh', vector: [1, 0]}, d: {model: 'actual-model', language: 'en', vector: [1, 0]}, e: {model: 'actual-model', language: 'zh', vector: [0, 0]}};
  const results = searchDiscoveryItems(items, '山', {mode: 'semantic', queryEmbedding, embeddings});
  assert.deepEqual(results.map(result => result.item.path), ['b', 'a']);
  assert.equal(results[0].score, 1);
  assert.ok(Math.abs(results[1].score - 0.8) < 1e-12);
  for (const pair of [[[0, 0], [1, 0]], [[1], [1, 0]], [[NaN], [1]], [[], []]]) assert.equal(cosineSimilarity(...pair), null);
  assert.equal(cosineSimilarity([1e308, 0], [1e308, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test('compatible OCR alternates recall an item without replacing source text or comparing foreign-language/invalid vectors', () => {
  const items = [{path: 'ocr', body: '原中文正文'}, {path: 'foreign', body: 'Another source'}, {path: 'invalid', body: 'Unusable vectors'}, {path: 'primary', body: 'Original matching source'}];
  const queryEmbedding = {language: 'en', model: 'synthetic-en-r1', vector: [1, 0]};
  const vector = values => ({language: 'en', model: 'synthetic-en-r1', vector: values});
  const embeddings = {
    ocr: {language: 'zh-Hans', model: 'synthetic-zh-r1', vector: [0, 1], alternates: [vector([1, 0])]},
    foreign: {...vector([0, 1]), alternates: [{language: 'fr', model: 'synthetic-en-r1', vector: [1, 0]}]},
    invalid: {...vector([0, 0]), alternates: [vector([NaN, 0]), {...vector([1, 0]), model: 'other-model'}, vector([1])]},
    primary: {...vector([0.8, 0.6]), alternates: [vector([0, 1])]},
  };
  const before = structuredClone({items, embeddings});
  const result = searchDiscoveryItems(items, 'visible image words', {mode: 'semantic', queryEmbedding, embeddings});
  assert.deepEqual(result.map(({item}) => item.path), ['ocr', 'primary', 'foreign']);
  assert.equal(result[0].score, 1);
  assert.ok(Math.abs(result[1].score - 0.8) < 1e-12);
  assert.equal(result[2].score, 0, 'A foreign-language alternate must not inflate the actual compatible primary score');
  assert.equal(result.some(({item}) => item.path === 'invalid'), false, 'Invalid and incompatible alternates cannot invent a score');
  assert.deepEqual({items, embeddings}, before);
  assert.equal(result[0].item.body, '原中文正文');
});
