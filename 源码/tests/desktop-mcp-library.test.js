'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { LocalVaultGateway } = require('../desktop/local-gateway.cjs');
const { createLibraryReader, TOOLS, MAX_IMAGE_BYTES } = require('../desktop/mcp-library.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAFklEQVR4nGL4z8DAAAQBAQAA//8DAAEHAQD6RQNLAAAAAElFTkSuQmCC', 'base64');
const attachment = { name: 'pixel.png', type: 'image/png', size: PNG.length, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` };
const state = () => ({
  schemaVersion: 1,
  cards: [],
  savedIds: [],
  hiddenIds: [],
  favoriteIds: [],
  collections: [],
  boards: [],
  annotations: {},
  drafts: {},
  version: 1,
});
const json = (value) => JSON.parse(value.content.find((item) => item.type === 'text').text);
function harness(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-mcp-reader-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const h = {
    root,
    state: state(),
    revision: 1,
    assetRequests: [],
    gateway: new LocalVaultGateway({ vaultPath: root, cachePath: path.join(root, 'unused-cache.json') }),
    write(relative, body) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      return target;
    },
  };
  h.reader = createLibraryReader({
    gateway: h.gateway,
    getWorkspace: async ({ includeAssets } = {}) => {
      h.assetRequests.push(includeAssets);
      const copy = structuredClone(h.state);
      if (!includeAssets)
        for (const card of copy.cards) {
          if (card.attachment) card.attachment = { name: card.attachment.name, type: card.attachment.type, size: card.attachment.size };
          if (/^data:image\//.test(card.image || '')) {
            card.imageAvailable = true;
            delete card.image;
          }
        }
      delete copy.drafts;
      return { state: copy, revision: h.revision };
    },
  });
  return h;
}
function add(h, card, { saved = true } = {}) {
  h.state.cards.push({ type: 'text', title: card.id, body: '', caption: '', tags: [], ...card });
  if (saved) h.state.savedIds.push(card.id);
}
test('eight tools expose strict read-only JSON schemas and no write or AI operations', () => {
  assert.deepEqual(
    TOOLS.map((value) => value.name),
    ['library_status', 'list_cards', 'search_cards', 'read_card', 'read_image', 'list_collections', 'list_canvases', 'read_document'],
  );
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(typeof JSON.stringify(tool), 'string');
  }
});
test('live search includes full text tail, existing OCR, annotations and index pages; never exposes drafts', async (t) => {
  const h = harness(t);
  add(h, {
    id: 'software-only',
    title: '长文',
    body: '开头'.repeat(15000) + '全文结尾命中',
    ocrText: 'OCR尾部',
    documentIndex: {
      pageCount: 2,
      pages: [
        { page: 1, text: '第一页索引' },
        { page: 2, text: '第二页索引末尾' },
      ],
      text: '缩略索引',
      truncated: false,
      indexedAt: '2026-10-05',
    },
  });
  h.state.annotations['software-only'] = { note: '独立注释命中' };
  h.state.drafts = { secret: { body: '草稿秘密命中' } };
  for (const query of ['全文结尾命中', 'OCR尾部', '独立注释命中', '第二页索引末尾']) {
    const value = json(await h.reader.callTool('search_cards', { query }));
    assert.equal(value.total, 1);
    assert.equal(value.items[0].id, 'software-only');
  }
  assert.equal(json(await h.reader.callTool('search_cards', { query: '草稿秘密命中' })).total, 0);
  assert.ok(h.assetRequests.every((value) => value === false));
  h.state.cards[0].body = '实时修改之后';
  h.revision = 2;
  assert.equal(json(await h.reader.callTool('search_cards', { query: '实时修改之后' })).revision, 2);
});
test('saved software cards and Vault entities merge by UI id; workspace content and note override same entity', async (t) => {
  const h = harness(t),
    id = '01_sources/cards/text/existing.md';
  h.write(id, '---\ntype: material\ntitle: Vault旧标题\ncaption: Vault旧备注\n---\nVault旧正文');
  h.write('01_sources/books/book.md', '---\ntype: book\ntitle: 本机书籍\n---\n书籍正文');
  h.write('01_sources/cards/text/entry.md', '---\nrecord_type: inspiration\ntitle: 灵感\n---\n灵感正文');
  add(h, { id, title: '软件覆盖标题', body: '软件覆盖正文', caption: '卡片配文' });
  h.state.annotations[id] = { note: '软件当前注释' };
  add(h, { id: 'workspace-only', body: '尚未存入Vault的卡片' });
  const cards = json(await h.reader.callTool('list_cards', {}));
  assert.equal(cards.total, 4);
  assert.equal(cards.items.filter((value) => value.id === id).length, 1);
  assert.equal(cards.items.find((value) => value.id === id).sourceKind, 'workspace');
  const read = json(await h.reader.callTool('read_card', { id }));
  assert.match(read.content, /软件覆盖正文/);
  assert.match(read.content, /软件当前注释/);
  assert.doesNotMatch(read.content, /Vault旧正文|Vault旧备注/);
});
test('archived, hidden, unselected references and draft entities are excluded from both sources and relations', async (t) => {
  const h = harness(t),
    id = '01_sources/cards/text/hidden.md';
  h.write(id, '---\ntype: material\ntitle: Hidden\n---\nsecret hidden');
  h.write('01_sources/cards/text/archive.md', '---\ntype: material\nstatus: archived\n---\nsecret archived');
  h.write('01_sources/cards/text/draft.md', '---\ntype: material\nstatus: draft\n---\nsecret draft');
  h.state.hiddenIds.push(id);
  add(h, { id: 'good', body: 'visible' });
  add(h, { id: 'local-hidden', body: 'secret local' });
  h.state.hiddenIds.push('local-hidden');
  add(h, { id: 'unselected-reference', body: 'secret reference', origin: 'reference' }, { saved: false });
  add(h, { id: 'draft-entity', body: 'secret draft', status: 'draft' });
  h.state.collections = [{ id: 'c', title: '收藏', cardIds: ['good', id, 'local-hidden', 'unselected-reference'] }];
  h.state.boards = [
    {
      id: 'b',
      title: '画布',
      nodes: [
        { id: 'n1', itemPath: 'good', x: 1, y: 2 },
        { id: 'n2', itemPath: id, x: 3, y: 4 },
      ],
      edges: [{ id: 'e', from: 'n1', to: 'n2' }],
    },
  ];
  assert.equal(json(await h.reader.callTool('list_cards')).total, 1);
  assert.equal(json(await h.reader.callTool('search_cards', { query: 'secret' })).total, 0);
  assert.equal(json(await h.reader.callTool('list_collections', { id: 'c' })).total, 1);
  const board = json(await h.reader.callTool('list_canvases', { id: 'b' }));
  assert.equal(board.nodes.total, 1);
  assert.equal(board.edges.total, 0);
  for (const id of ['local-hidden', 'unselected-reference', 'draft-entity']) assert.equal((await h.reader.callTool('read_card', { id })).isError, true);
});
test('Unicode pagination never splits emoji and reads entire tail without clipping', async (t) => {
  const h = harness(t);
  add(h, { id: 'unicode', body: '甲🧪乙🌕末尾' });
  let offset = 0,
    whole = '';
  while (offset !== null) {
    const page = json(await h.reader.callTool('read_card', { id: 'unicode', field: 'body', offset, length: 1 }));
    whole += page.content;
    offset = page.nextOffset;
    assert.equal(Array.from(page.content).length, 1);
    assert.equal(page.offsetUnit, 'unicode-code-points');
  }
  assert.equal(whole, '甲🧪乙🌕末尾');
  assert.equal((await h.reader.callTool('read_card', { id: 'unicode', offset: 7 })).isError, true);
});
test('read_document distinguishes page index, partial index, absent pages and unindexed originals', async (t) => {
  const h = harness(t);
  add(h, {
    id: 'indexed',
    documentIndex: {
      pageCount: 3,
      pages: [
        { page: 1, text: '第1页🧪末尾' },
        { page: 3, text: '第3页全文' },
      ],
      text: '合并索引',
      truncated: true,
      indexedAt: '2026-10-05',
    },
    documentHighlights: [{ id: 'highlight', page: 3, text: '第3页高亮', rects: [] }],
    attachment: { name: 'book.pdf', type: 'application/pdf', size: 100 },
  });
  add(h, { id: 'not-indexed', attachment: { name: 'other.pdf', type: 'application/pdf', size: 100 } });
  const page = json(await h.reader.callTool('read_document', { id: 'indexed', page: 3 }));
  assert.equal(page.content, '第3页全文');
  assert.equal(page.truncated, true);
  assert.equal(page.originalDocumentRead, false);
  assert.equal(page.highlights[0].text, '第3页高亮');
  const missing = json(await h.reader.callTool('read_document', { id: 'indexed', page: 2 }));
  assert.equal(missing.indexAvailable, true);
  assert.equal(missing.indexed, false);
  assert.equal(missing.content, '');
  const absent = json(await h.reader.callTool('read_document', { id: 'not-indexed', page: 1 }));
  assert.equal(absent.indexAvailable, false);
  assert.equal(absent.indexed, false);
  assert.match(absent.notice, /没有读取原件/);
});
test('saved OCR page provenance survives desktop reads and never substitutes a different page', async (t) => {
  const h = harness(t),
    pages = [
      { page: 1, text: '日期：2026年10月15日\n来源：https://example.com/ocr-test', engine: 'Apple Vision' },
      { page: 2, text: '日期：2026年10月16日\n金额：98.50 元；比例：75%。', engine: 'Apple Vision' },
    ];
  add(h, {
    id: 'scan-ocr',
    body: '原始备注保留',
    ocrText: pages.map((page) => page.text).join('\n\n'),
    documentIndex: {
      source: 'ocr',
      engine: 'PDFKit + Apple Vision',
      pageCount: 2,
      pages,
      text: pages.map((page) => page.text).join('\n\n'),
      truncated: false,
      indexedAt: '2026-10-15T00:00:00Z',
    },
  });
  const summary = json(await h.reader.callTool('list_cards')).items[0];
  assert.equal(summary.documentIndex.source, 'ocr');
  assert.equal(summary.documentIndex.engine, 'PDFKit + Apple Vision');
  assert.equal(summary.documentIndex.pageCount, 2);
  const second = json(await h.reader.callTool('read_document', { id: 'scan-ocr', page: 2 }));
  assert.equal(second.content, pages[1].text);
  assert.equal(second.page, 2);
  assert.equal(second.indexSource, 'ocr');
  assert.equal(second.pageEngine, 'Apple Vision');
  assert.equal(second.originalDocumentRead, false);
  assert.doesNotMatch(second.content, /10月15日/);
  const absent = json(await h.reader.callTool('read_document', { id: 'scan-ocr', page: 3 }));
  assert.equal(absent.indexed, false);
  assert.equal(absent.content, '');
  assert.equal(absent.pageEngine, '');
  assert.equal(json(await h.reader.callTool('read_card', { id: 'scan-ocr', field: 'body' })).content, '原始备注保留');
  assert.equal(json(await h.reader.callTool('search_cards', { query: '98.50' })).total, 1);
});
test('mixed PDFKit and Vision pages expose their own saved engines', async (t) => {
  const h = harness(t);
  add(h, {
    id: 'mixed-pdf',
    documentIndex: {
      source: 'ocr',
      engine: 'PDFKit + Apple Vision',
      pageCount: 2,
      pages: [
        { page: 1, text: '可复制文字层', engine: 'PDFKit' },
        { page: 2, text: '扫描页识别', engine: 'Apple Vision' },
      ],
      text: '可复制文字层\n\n扫描页识别',
      truncated: false,
    },
  });
  assert.equal(json(await h.reader.callTool('read_document', { id: 'mixed-pdf', page: 1 })).pageEngine, 'PDFKit');
  assert.equal(json(await h.reader.callTool('read_document', { id: 'mixed-pdf', page: 2 })).pageEngine, 'Apple Vision');
});
test('workspace-only saved image is returned as native ImageContent with exact original bytes', async (t) => {
  const h = harness(t);
  add(h, { id: 'image-only', type: 'image', attachment });
  const listed = json(await h.reader.callTool('list_cards'));
  assert.equal(listed.items[0].hasImage, true);
  assert.equal(JSON.stringify(listed).includes(attachment.dataUrl), false);
  const value = await h.reader.callTool('read_image', { id: 'image-only' });
  assert.equal(value.isError, undefined);
  const image = value.content.find((value) => value.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(image.data, 'base64'), PNG);
  assert.equal(json(value).originalPixels, true);
  assert.equal(json(value).modelInvoked, false);
  assert.deepEqual(h.assetRequests, [false, true]);
  add(h, { id: 'inline-image', type: 'image', image: attachment.dataUrl });
  assert.deepEqual(Buffer.from((await h.reader.callTool('read_image', { id: 'inline-image' })).content[1].data, 'base64'), PNG);
});
test('Vault image reader verifies existing association and native bytes without changing original files', async (t) => {
  const h = harness(t),
    note = '01_sources/cards/images/photo.md',
    file = '01_sources/_originals/photo.png';
  h.write(file, PNG);
  h.write(note, `---\ntype: material\ntitle: 本机原图\noriginal_file: ${file}\noriginal_name: 原图.png\n---\n原图正文`);
  const before = createHash('sha256')
    .update(fs.readFileSync(path.join(h.root, file)))
    .digest('hex');
  const value = await h.reader.callTool('read_image', { id: note });
  assert.equal(value.isError, undefined);
  assert.deepEqual(Buffer.from(value.content[1].data, 'base64'), PNG);
  assert.equal(json(value).name, '原图.png');
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync(path.join(h.root, file)))
      .digest('hex'),
    before,
  );
});
test('remote images, forged data, arbitrary paths and symlink originals never yield pixels', async (t) => {
  const h = harness(t);
  add(h, { id: 'remote', type: 'image', image: 'https://example.invalid/photo.png' });
  add(h, { id: 'forged', type: 'image', attachment: { name: 'bad.png', type: 'image/png', size: 4, dataUrl: 'data:image/png;base64,dGV4dA==' } });
  assert.equal((await h.reader.callTool('read_image', { id: 'remote' })).isError, true);
  assert.equal((await h.reader.callTool('read_image', { id: 'forged' })).isError, true);
  for (const id of ['../../private.md', '/etc/passwd', 'https://example.test', '01_sources/_originals/photo.png'])
    assert.equal((await h.reader.callTool('read_image', { id })).isError, true);
  const real = h.write('outside.png', PNG);
  h.write('01_sources/cards/images/link.md', '---\ntype: material\noriginal_file: 01_sources/_originals/link.png\n---\nlinked');
  fs.mkdirSync(path.join(h.root, '01_sources/_originals'), { recursive: true });
  fs.symlinkSync(real, path.join(h.root, '01_sources/_originals/link.png'));
  const value = await h.reader.callTool('read_image', { id: '01_sources/cards/images/link.md' });
  assert.equal(value.isError, true);
  assert.equal(
    value.content.some((block) => block.type === 'image'),
    false,
  );
});
test('single image transfer cap is explicitly separate from aggregate library storage', async (t) => {
  const h = harness(t),
    bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  PNG.copy(bytes);
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
  add(h, { id: 'large-image', attachment: { name: 'large.png', type: 'image/png', size: bytes.length, dataUrl } });
  const value = await h.reader.callTool('read_image', { id: 'large-image' });
  assert.equal(value.isError, true);
  assert.match(value.content[0].text, /单次 MCP 图片传输上限/);
  assert.match(value.content[0].text, /不是整库容量限制/);
  const status = json(await h.reader.callTool('library_status'));
  assert.equal(status.cards, 1);
  assert.equal(status.limitScope, 'one-image-response');
});
test('strict arguments reject unknown fields/types/tools before any workspace or file access', async (t) => {
  const h = harness(t);
  for (const [name, args] of [
    ['library_status', { path: '/etc/passwd' }],
    ['list_cards', { offset: -1 }],
    ['list_cards', { limit: 51 }],
    ['search_cards', { query: ' ' }],
    ['search_cards', { query: 'x', url: 'https://example.test' }],
    ['read_card', { id: 'x', field: 'settings' }],
    ['read_document', { id: 'x', page: 0 }],
    ['read_image', { id: 'x', path: 'private' }],
    ['save_card', { id: 'x' }],
  ])
    assert.equal((await h.reader.callTool(name, args)).isError, true);
  assert.equal(h.assetRequests.length, 0);
});
test('partial source availability is explicit and model/network/write paths are never invoked', async (t) => {
  const h = harness(t);
  add(h, { id: 'no-model', body: '静态全文' });
  let modelCalls = 0,
    writeCalls = 0,
    networkCalls = 0;
  h.gateway.capture = () => {
    writeCalls++;
    throw Error('must not write');
  };
  h.gateway.requestAi = () => {
    modelCalls++;
    throw Error('must not model');
  };
  const fetchBefore = global.fetch;
  global.fetch = () => {
    networkCalls++;
    throw Error('must not fetch');
  };
  t.after(() => {
    global.fetch = fetchBefore;
  });
  for (const name of ['library_status', 'list_cards', 'search_cards', 'read_card', 'list_collections', 'list_canvases'])
    await h.reader.callTool(name, name === 'search_cards' ? { query: '静态' } : name === 'read_card' ? { id: 'no-model' } : {});
  assert.equal(modelCalls, 0);
  assert.equal(writeCalls, 0);
  assert.equal(networkCalls, 0);
  const reader = createLibraryReader({ gateway: h.gateway, getWorkspace: async () => null });
  const value = json(await reader.callTool('library_status'));
  assert.equal(value.availability.workspace, false);
  assert.equal(value.availability.partial, true);
});

const unavailableWorkspaces = [
  ['absent workspace', () => null],
  ['undefined workspace', () => undefined],
  [
    'renderer failure',
    () => {
      throw Error('Synthetic renderer failure with private details');
    },
  ],
  [
    'renderer timeout',
    async () => {
      throw Error('软件资料读取超时，请等待当前保存完成后重试');
    },
  ],
  [
    'missing hidden filter',
    (h) => {
      const copy = structuredClone(h.state);
      delete copy.hiddenIds;
      return { state: copy };
    },
  ],
  ['invalid hidden filter', (h) => ({ state: { ...h.state, hiddenIds: 'not-an-array' } })],
  ['invalid hidden identity', (h) => ({ state: { ...h.state, hiddenIds: [null] } })],
  ['sparse hidden filter', (h) => ({ state: { ...h.state, hiddenIds: new Array(1) } })],
  ['invalid saved filter', (h) => ({ state: { ...h.state, savedIds: [null] } })],
  ['invalid card records', (h) => ({ state: { ...h.state, cards: [null] } })],
  ['unsupported workspace schema', (h) => ({ state: { ...h.state, schemaVersion: 2 } })],
];
for (const [failure, getWorkspace] of unavailableWorkspaces)
  test(`MCP blocks all content and relations after ${failure}, without reading the Vault`, async (t) => {
    const h = harness(t),
      id = '01_sources/cards/images/hidden-source.md';
    h.write('01_sources/_originals/private.png', PNG);
    h.write(id, '---\ntype: material\ntitle: PRIVATE_VAULT_TITLE\noriginal_file: 01_sources/_originals/private.png\n---\nPRIVATE_VAULT_BODY');
    add(h, { id: 'local-private', body: 'PRIVATE_WORKSPACE_BODY', attachment });
    h.state.hiddenIds.push(id);
    h.state.collections = [{ id: 'private-collection', title: 'PRIVATE_COLLECTION_TITLE', cardIds: [id, 'local-private'] }];
    h.state.boards = [{ id: 'private-canvas', title: 'PRIVATE_CANVAS_TITLE', nodes: [{ id: 'private-node', itemPath: id, x: 1, y: 2 }], edges: [] }];
    let snapshots = 0,
      originalReads = 0;
    const snapshot = h.gateway.snapshot.bind(h.gateway),
      readAttachment = h.gateway.readAttachment.bind(h.gateway);
    h.gateway.snapshot = () => {
      snapshots++;
      return snapshot();
    };
    h.gateway.readAttachment = (...args) => {
      originalReads++;
      return readAttachment(...args);
    };
    const reader = createLibraryReader({ gateway: h.gateway, getWorkspace: () => getWorkspace(h) });
    const status = json(await reader.callTool('library_status'));
    assert.equal(status.contentAccess, 'unavailable');
    assert.equal(status.availability.workspace, false);
    assert.equal(status.availability.partial, true);
    for (const key of ['cards', 'workspaceCards', 'vaultCards', 'collections', 'canvases']) assert.equal(status[key], null);
    assert.match(status.notice, /无法确认隐藏或归档过滤/);
    const calls = [
      ['list_cards', {}],
      ['search_cards', { query: 'PRIVATE' }],
      ['read_card', { id }],
      ['read_image', { id }],
      ['read_document', { id, page: 1 }],
      ['list_collections', {}],
      ['list_collections', { id: 'private-collection' }],
      ['list_canvases', {}],
      ['list_canvases', { id: 'private-canvas' }],
    ];
    for (const [name, args] of calls) {
      const value = await reader.callTool(name, args);
      assert.equal(value.isError, true, name);
      assert.match(value.content[0].text, /本次未提供卡片、原图、正文或关联/);
      assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|private-collection|private-canvas|hidden-source|base64|private details/);
    }
    assert.equal(snapshots, 0);
    assert.equal(originalReads, 0);
  });

test('workspace recovery reads the latest hidden filter rather than reusing previous permissions', async (t) => {
  const h = harness(t),
    first = '01_sources/cards/text/first.md',
    second = '01_sources/cards/text/second.md';
  h.write(first, '---\ntype: material\ntitle: First\n---\nfirst body');
  h.write(second, '---\ntype: material\ntitle: Second\n---\nsecond body');
  h.state.hiddenIds = [first];
  h.state.collections = [{ id: 'collection', title: 'Collection', cardIds: [first, second] }];
  let available = true;
  const reader = createLibraryReader({
    gateway: h.gateway,
    getWorkspace: async () => (available ? { state: structuredClone(h.state), revision: h.revision } : null),
  });
  assert.deepEqual(
    json(await reader.callTool('list_cards')).items.map((card) => card.id),
    [second],
  );
  assert.equal((await reader.callTool('read_card', { id: first })).isError, true);
  available = false;
  assert.equal((await reader.callTool('read_card', { id: second })).isError, true);
  h.state.hiddenIds = [second];
  h.revision = 2;
  available = true;
  const recovered = json(await reader.callTool('list_cards'));
  assert.equal(recovered.revision, 2);
  assert.deepEqual(
    recovered.items.map((card) => card.id),
    [first],
  );
  assert.equal(json(await reader.callTool('read_card', { id: first })).content, 'first body');
  assert.equal((await reader.callTool('read_card', { id: second })).isError, true);
  assert.deepEqual(
    json(await reader.callTool('list_collections', { id: 'collection' })).items.map((card) => card.id),
    [first],
  );
});

test('a valid workspace still exposes safe saved cards and relations when the Vault fails', async (t) => {
  const h = harness(t);
  add(h, { id: 'local-visible', body: 'Safe saved body' });
  add(h, { id: 'local-hidden', body: 'Private hidden body' });
  h.state.hiddenIds.push('local-hidden');
  h.state.collections = [{ id: 'local-collection', title: 'Collection', cardIds: ['local-visible', 'local-hidden'] }];
  h.gateway.snapshot = async () => {
    throw Error('Synthetic Vault failure');
  };
  const status = json(await h.reader.callTool('library_status'));
  assert.equal(status.contentAccess, 'available');
  assert.equal(status.availability.workspace, true);
  assert.equal(status.availability.vault, false);
  assert.equal(status.availability.partial, true);
  assert.equal(status.cards, 1);
  assert.equal(json(await h.reader.callTool('read_card', { id: 'local-visible' })).content, 'Safe saved body');
  assert.equal((await h.reader.callTool('read_card', { id: 'local-hidden' })).isError, true);
  assert.equal(json(await h.reader.callTool('search_cards', { query: 'Private' })).total, 0);
  assert.deepEqual(
    json(await h.reader.callTool('list_collections', { id: 'local-collection' })).items.map((card) => card.id),
    ['local-visible'],
  );
});

test('registered project notes share full-text access and suppression while external book summaries expose no path or bytes', async (t) => {
  const h = harness(t),
    project = {
      id: '03_projects/registered.md',
      path: '03_projects/registered.md',
      kind: 'project',
      title: '合成项目',
      body: '合成项目专有正文',
      fields: {},
      tags: [],
    };
  const hidden = { ...project, id: '03_projects/hidden.md', path: '03_projects/hidden.md', title: 'hidden' },
    archived = { ...project, id: '03_projects/archived.md', path: '03_projects/archived.md', fields: { status: 'archived' } };
  h.state.hiddenIds = [hidden.path];
  h.gateway.snapshot = async () => ({
    entries: [],
    materials: [],
    books: [
      {
        id: 'book',
        path: '01_sources/books/legacy.md',
        title: '旧书',
        kind: 'book',
        fields: { source_file: '/private/never-expose.pdf' },
        tags: [],
        originalAvailable: true,
        originalName: '原书.pdf',
        originalMime: 'application/pdf',
        originalPath: '',
      },
    ],
    projects: [project, hidden, archived],
  });
  h.gateway.readAttachment = () => assert.fail('Must not read an external original');
  const listed = json(await h.reader.callTool('list_cards'));
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.items.find((card) => card.type === 'book').attachment, { name: '原书.pdf', type: 'application/pdf', size: null });
  assert.doesNotMatch(JSON.stringify(listed), /never-expose/);
  assert.equal(json(await h.reader.callTool('search_cards', { query: '专有正文' })).items[0].id, project.path);
  assert.equal(json(await h.reader.callTool('read_card', { id: project.path, field: 'body' })).content, project.body);
  for (const id of [hidden.path, archived.path]) assert.equal((await h.reader.callTool('read_card', { id })).isError, true);
  assert.equal((await h.reader.callTool('read_image', { id: '01_sources/books/legacy.md' })).isError, true);
  const reader = createLibraryReader({ gateway: h.gateway, getWorkspace: async () => null });
  h.gateway.snapshot = () => assert.fail('No workspace means no Vault read');
  assert.equal((await reader.callTool('read_card', { id: project.path })).isError, true);
});

test('approved historical documents remain readable with lifecycle metadata while all current suppression rules apply', async (t) => {
  const h = harness(t),
    id = '03_projects/rabbitpet-project-brief-2026-07-13.md';
  h.write(id, '---\ntype: project\ntitle: 历史项目说明\nstatus: archived\n---\n历史正文，不是当前进行状态');
  const before = fs.readFileSync(path.join(h.root, id));
  const listed = json(await h.reader.callTool('list_cards'));
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].type, 'project-document');
  assert.equal(listed.items[0].sourceLifecycle, 'archived');
  assert.equal(json(await h.reader.callTool('read_card', { id, field: 'body' })).content, '历史正文，不是当前进行状态');
  assert.equal(json(await h.reader.callTool('search_cards', { query: '历史正文' })).total, 1);
  h.state.hiddenIds = [id];
  assert.equal((await h.reader.callTool('read_card', { id })).isError, true);
  h.state.hiddenIds = [];
  for (const flag of ['hidden', 'deleted', 'draft', 'archived']) {
    h.write(id, `---\ntype: project\nstatus: archived\n${flag}: true\n---\n禁止显示`);
    assert.equal((await h.reader.callTool('read_card', { id })).isError, true, flag);
  }
  for (const status of ['draft', 'deleted', 'trash']) {
    h.write(id, `---\ntype: project\nstatus: ${status}\n---\n禁止显示`);
    assert.equal((await h.reader.callTool('read_card', { id })).isError, true, status);
  }
  fs.writeFileSync(path.join(h.root, id), before);
  assert.equal(json(await h.reader.callTool('list_cards')).total, 1);
  const unavailable = createLibraryReader({ gateway: h.gateway, getWorkspace: async () => null });
  assert.equal((await unavailable.callTool('read_card', { id })).isError, true);
  assert.deepEqual(fs.readFileSync(path.join(h.root, id)), before);
});

test('document lifecycle exception requires exact gateway approval and never applies to ordinary source arrays', async (t) => {
  const h = harness(t),
    approved = '03_projects/rabbitpet-project-brief-2026-07-13.md';
  const doc = {
    id: approved,
    path: approved,
    kind: 'project-document',
    readOnly: true,
    legacyProjectDocument: true,
    originalKind: 'project-document',
    title: '历史',
    body: 'body',
    fields: { status: 'archived' },
  };
  h.gateway.snapshot = async () => ({ documents: [{ ...doc, id: '03_projects/unapproved.md', path: '03_projects/unapproved.md' }], projects: [doc] });
  assert.equal(json(await h.reader.callTool('list_cards')).total, 0);
  h.gateway.snapshot = async () => ({ documents: [{ ...doc, hidden: true }] });
  assert.equal(json(await h.reader.callTool('list_cards')).total, 0);
  h.gateway.snapshot = async () => ({ documents: [{ ...doc, legacyProjectDocument: false }] });
  assert.equal(json(await h.reader.callTool('list_cards')).total, 0);
});

test('excluded traditional colour sources never appear in MCP search, direct reads or collection references', async (t) => {
  const h = harness(t),
    colour = '01_sources/cards/images/patterns/色韵/001-海天霞.md',
    good = '01_sources/cards/images/design.md';
  const file = h.write(colour, '---\ntype: material\ntitle: 海天霞\ncollection_kind: color-palette\npattern_family: 色韵\n---\n传统色唯一测试词');
  h.write(good, '---\ntype: material\ntitle: 孟菲斯美学\n---\n颜色参与结构');
  h.state.collections = [{ id: 'existing-collection', title: '保留收藏', cardIds: [colour, good] }];
  assert.equal(json(await h.reader.callTool('library_status')).cards, 1);
  assert.equal(json(await h.reader.callTool('search_cards', { query: '传统色唯一测试词' })).total, 0);
  assert.equal((await h.reader.callTool('read_card', { id: colour })).isError, true);
  assert.equal((await h.reader.callTool('read_image', { id: colour })).isError, true);
  assert.deepEqual(
    json(await h.reader.callTool('list_collections', { id: 'existing-collection' })).items.map((x) => x.id),
    [good],
  );
  assert.match(fs.readFileSync(file, 'utf8'), /传统色唯一测试词/);
  assert.equal(json(await h.reader.callTool('search_cards', { query: '颜色参与结构' })).total, 1);
});

test('externalized original images stay lazy for metadata and are read through the checked attachment store', async (t) => {
  const h = harness(t),
    { createFileAttachmentStore } = require('../desktop/attachment-store.cjs');
  const store = createFileAttachmentStore({ directory: path.join(h.root, 'private-attachments') });
  const ref = await store.put(attachment);
  add(h, { id: 'external-image', title: '本机原图', type: 'image', attachment: { ...attachment, dataUrl: { $attachment: ref } } });
  let reads = 0;
  const reader = createLibraryReader({
    gateway: h.gateway,
    getWorkspace: async () => ({ state: structuredClone(h.state), revision: 8 }),
    getAttachment: async (reference) => {
      reads++;
      assert.deepEqual(reference, ref);
      return store.read(reference);
    },
  });
  assert.equal(json(await reader.callTool('list_cards')).total, 1);
  assert.equal(json(await reader.callTool('search_cards', { query: '本机原图' })).total, 1);
  assert.equal(reads, 0);
  const result = await reader.callTool('read_image', { id: 'external-image' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(Buffer.from(result.content.find((item) => item.type === 'image').data, 'base64'), PNG);
  assert.equal(reads, 1);
  h.state.hiddenIds = ['external-image'];
  assert.equal((await reader.callTool('read_image', { id: 'external-image' })).isError, true);
  assert.equal(reads, 1);
});
test('unavailable or oversized referenced images produce an error without exposing inline fallback data', async (t) => {
  const h = harness(t),
    ref = { sha256: '0'.repeat(64), type: 'image/png', size: PNG.length };
  add(h, { id: 'missing', type: 'image', attachment: { ...attachment, dataUrl: { $attachment: ref } } });
  let reads = 0;
  const reader = createLibraryReader({
    gateway: h.gateway,
    getWorkspace: async () => ({ state: structuredClone(h.state), revision: 1 }),
    getAttachment: async () => {
      reads++;
      throw Error('原图暂不可读取');
    },
  });
  const missing = await reader.callTool('read_image', { id: 'missing' });
  assert.equal(missing.isError, true);
  assert.equal(
    missing.content.some((item) => item.type === 'image'),
    false,
  );
  h.state.cards[0].attachment.dataUrl.$attachment.size = 7 * 1024 * 1024;
  assert.equal((await reader.callTool('read_image', { id: 'missing' })).isError, true);
  assert.equal(reads, 1);
});
