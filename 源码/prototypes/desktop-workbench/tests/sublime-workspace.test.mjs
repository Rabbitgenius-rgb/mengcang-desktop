import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceState, normalizeWorkspaceState, migrateLegacyDiscovery, workspaceReducer, selectCards, safeSourceUrl, serializeWorkspace, parseWorkspaceBackup, exportCards, normalizeWorkspaceAttachment, MAX_ATTACHMENT_BYTES, MAX_WORKSPACE_BACKUP_BYTES, WORKSPACE_FILE_TYPES, AI_MODES, aiPlaceholder} from '../src/sublime/workspaceModel.js';
import {parseImportText, dedupeImports} from '../src/discoveryModel.js';

const card = (id, extra = {}) => ({id, path:`local/${id}`, title:id, body:'  原文\r\n第二行  ', caption:'自己的注释', sourceUrl:'https://example.test/original', sourceTitle:'来源', author:'作者', type:'text', image:'', createdAt:'2026-09-30T10:00:00Z', updatedAt:'', tags:['阅读'], origin:'local', ...extra});
const reduce = (state, type, values) => workspaceReducer(state, {type, ...values});

test('state persistence retains local content, external Vault identities, private metadata and byte-exact drafts', () => {
  let state = createWorkspaceState();
  state = reduce(state, 'card.upsert', {card:card('a')});
  state = reduce(state, 'card.save', {id:'vault-card', saved:true});
  state = reduce(state, 'card.favorite', {id:'vault-card', value:true});
  state = reduce(state, 'collection.upsert', {collection:{id:'c', title:' 收藏集 ', description:'说明', private:true, pinned:true, cardIds:['a', 'vault-card', 'a']}});
  state = reduce(state, 'card.note', {id:'vault-card', note:'\r\n我的私密注释  ', private:true});
  state = reduce(state, 'draft.set', {key:'capture', value:{body:'  未提交\r\n原文  ', page:3, selected:false, nested:[null, {kind:'text'}]}});
  const saved = serializeWorkspace(state);
  const restored = normalizeWorkspaceState(JSON.parse(saved));
  assert.deepEqual(restored, state);
  assert.equal(restored.cards[0].body, '  原文\r\n第二行  ');
  assert.deepEqual(restored.collections[0].cardIds, ['a', 'vault-card']);
  assert.deepEqual(restored.annotations['vault-card'], {note:'\r\n我的私密注释  ', private:true, collectionIds:['c']});
  assert.deepEqual(restored.savedIds, ['vault-card']);
  assert.equal(restored.drafts.capture.body, '  未提交\r\n原文  ');
});

test('unknown versions and malformed persisted data throw without mutating or replacing the original', () => {
  const original = {...createWorkspaceState(), cards:[card('a')], schemaVersion:2};
  const before = structuredClone(original);
  assert.throws(() => normalizeWorkspaceState(original), /版本.*保留原数据/);
  assert.deepEqual(original, before);
  assert.throws(() => normalizeWorkspaceState({...createWorkspaceState(), version:9}), /版本/);
  assert.throws(() => normalizeWorkspaceState({...createWorkspaceState(), cards:{}}), /卡片应为数组/);
  assert.throws(() => normalizeWorkspaceState({...createWorkspaceState(), savedIds:['valid', null]}), /标识|已保存卡片/);
  assert.throws(() => normalizeWorkspaceState({...createWorkspaceState(), favoriteIds:['__proto__']}), /保留字符/);
  assert.throws(() => normalizeWorkspaceState({...createWorkspaceState(), hiddenIds:[] , unrecognized:'original data'}), /未知字段/);
  assert.throws(() => serializeWorkspace({...createWorkspaceState(), drafts:{bad:{x:NaN}}}), /JSON/);
  assert.throws(() => normalizeWorkspaceState(JSON.parse('{"schemaVersion":1,"annotations":{"__proto__":{"note":"bad"}}}')), /保留字符/);
  assert.throws(() => normalizeWorkspaceState({...createWorkspaceState(), cards:[card('a'), card('a')]}), /重复/);
  assert.deepEqual(normalizeWorkspaceState(null), createWorkspaceState());
});

test('source URLs and image fields reject executable schemes, credentials and parser control characters', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///private/secret', '//example.test', 'https://user:password@example.test/', 'https://example.test\\@evil.test/', 'https://example.test/\npath', 'https://example.test/has space']) assert.equal(safeSourceUrl(url), '', url);
  assert.equal(safeSourceUrl('  https://example.test/path?a=1#part  '), 'https://example.test/path?a=1#part');
  const state = normalizeWorkspaceState({cards:[card('a', {sourceUrl:'javascript:alert(1)', image:'data:image/svg+xml;base64,ZXZpbA=='}), card('b', {image:'/assets/card.avif', tags:['阅读', ' 阅读 ', '']})]});
  assert.equal(state.cards[0].sourceUrl, '');
  assert.equal(state.cards[0].image, '');
  assert.equal(state.cards[1].image, '/assets/card.avif');
  assert.deepEqual(state.cards[1].tags, ['阅读']);
});

test('favorites, library, hidden, media, collection, keyword and date sort intersect without modifying the corpus', () => {
  const cards = [card('old', {type:'highlight', title:'Alpha', createdAt:'2024-01-01'}), card('new', {type:'article', title:'Beta gardening', body:'plant seedlings', createdAt:'2026-10-02', updatedAt:'2026-10-03'}), card('pic', {type:'image', title:'Gamma', image:'/assets/photo.png', createdAt:'2026-01-01'}), card('hidden', {type:'image', title:'Hidden', createdAt:'2026-12-01'})];
  const before = structuredClone(cards);
  let state = normalizeWorkspaceState({savedIds:['old', 'new'], favoriteIds:['new', 'pic'], hiddenIds:['hidden'], collections:[{id:'c', title:'Garden', cardIds:['new', 'pic']}], annotations:{new:{note:'a useful reference', private:true}}});
  assert.deepEqual(selectCards(cards, state).map(card => card.id), ['new', 'pic', 'old']);
  assert.deepEqual(selectCards(cards, state, {inLibrary:true, favorite:true}).map(card => card.id), ['new']);
  assert.deepEqual(selectCards(cards, state, {collectionId:'c', media:'images'}).map(card => card.id), ['pic']);
  assert.deepEqual(selectCards(cards, state, {media:'articles', query:'plant reference'}).map(card => card.id), ['new']);
  assert.deepEqual(selectCards(cards, state, {media:'highlights'}).map(card => card.id), ['old']);
  assert.deepEqual(selectCards(cards, state, {sort:'oldest'}).map(card => card.id), ['old', 'pic', 'new']);
  assert.deepEqual(selectCards(cards, state, {hidden:true}).map(card => card.id), ['hidden']);
  assert.equal(selectCards(cards, state, {collectionId:'absent'}).length, 0);
  assert.deepEqual(cards, before);
  const previous = state;
  state = reduce(state, 'card.favorite', {id:'pic', value:false});
  assert.deepEqual(state.favoriteIds, ['new']);
  assert.deepEqual(previous.favoriteIds, ['new', 'pic']);
});

test('collection updates maintain memberships; deleting collections preserves cards and board content', () => {
  let state = normalizeWorkspaceState({cards:[card('a')], collections:[{id:'c', title:'Collection', cardIds:['a']}]});
  state = reduce(state, 'board.upsert', {board:{id:'b', title:'Board', collectionId:'c', nodes:[{id:'n1', itemPath:'local/a', x:-5, y:10}, {id:'n2', itemPath:'vault/other.md', x:200, y:20}], edges:[{id:'e', from:'n1', to:'n2'}]}});
  state = reduce(state, 'card.note', {id:'a', note:'keep this', private:true});
  state = reduce(state, 'collection.toggleCard', {id:'c', cardId:'vault-card', selected:true});
  state = reduce(state, 'collection.toggleCard', {id:'c', cardId:'vault-card', selected:true});
  assert.deepEqual(state.collections[0].cardIds, ['a', 'vault-card']);
  assert.deepEqual(state.annotations['vault-card'].collectionIds, ['c']);
  state = reduce(state, 'collection.toggleCard', {id:'c', cardId:'a', selected:false});
  assert.deepEqual(state.annotations.a, {note:'keep this', private:true, collectionIds:[]});
  state = reduce(state, 'collection.upsert', {collection:{id:'c', title:'Renamed', pinned:true}});
  assert.deepEqual(state.collections[0].cardIds, ['vault-card']);
  const board = structuredClone(state.boards[0]);
  state = reduce(state, 'collection.delete', {id:'c'});
  assert.deepEqual(state.collections, []);
  assert.deepEqual(state.annotations['vault-card'].collectionIds, []);
  assert.deepEqual(state.boards[0], {...board, collectionId:''});
  assert.equal(state.cards[0].body, card('a').body);
  assert.throws(() => reduce(state, 'collection.toggleCard', {id:'c', cardId:'a'}), /不存在/);
});

test('restoration recovers either saved membership side and explicit removal does not reappear on reload', () => {
  const persisted = {collections:[{id:'c', title:'Collection', cardIds:['from-collection']}], annotations:{'from-annotation':{note:'keep note', private:true, collectionIds:['c']}}};
  const before = structuredClone(persisted);
  const restored = normalizeWorkspaceState(persisted);
  assert.deepEqual(persisted, before);
  assert.deepEqual(restored.collections[0].cardIds, ['from-collection', 'from-annotation']);
  assert.deepEqual(restored.annotations['from-collection'].collectionIds, ['c']);
  const removed = reduce(restored, 'collection.upsert', {collection:{id:'c', cardIds:[]}});
  const reopened = normalizeWorkspaceState(JSON.parse(serializeWorkspace(removed)));
  assert.deepEqual(reopened.collections[0].cardIds, []);
  assert.deepEqual(reopened.annotations['from-annotation'], {note:'keep note', private:true, collectionIds:[]});
});

test('boards reject dangling or invalid geometry and reversed duplicate edges; draft removal is explicit', () => {
  const board = {id:'b', title:'Board', nodes:[{id:'n1', itemPath:'a', x:0, y:0}, {id:'n2', itemPath:'b', x:5, y:10}], edges:[{id:'e1', from:'n1', to:'n2'}]};
  let state = reduce(createWorkspaceState(), 'board.upsert', {board});
  assert.throws(() => reduce(state, 'board.upsert', {board:{...board, edges:[...board.edges, {id:'e2', from:'n2', to:'n1'}]}}), /连线重复/);
  assert.throws(() => reduce(state, 'board.upsert', {board:{...board, nodes:[{id:'n1', itemPath:'a', x:Infinity, y:0}]}}), /坐标/);
  assert.throws(() => reduce(state, 'board.upsert', {board:{...board, edges:[{id:'e', from:'n1', to:'absent'}]}}), /现有/);
  state = reduce(state, 'draft.set', {key:'capture', value:{note:'keep'}});
  state = reduce(state, 'draft.set', {key:'capture', value:null});
  assert.deepEqual(state.drafts, {});
  state = reduce(state, 'board.delete', {id:'b'});
  assert.deepEqual(state.boards, []);
});

test('legacy Discovery migration preserves Vault references and existing objects, deduplicates reverse edges, and is durable and idempotent', () => {
  const existing = normalizeWorkspaceState({
    cards:[card('local')], savedIds:['already-saved'], hiddenIds:['vault/hidden.md'],
    collections:[{id:'same', title:'New title', description:'Keep description', private:true, pinned:true, cardIds:['local']}],
    boards:[{id:'same-board', title:'New board', collectionId:'same', nodes:[{id:'new-node', itemPath:'local/local', x:11, y:22}], edges:[]}],
    annotations:{local:{note:'Keep private note', private:true, collectionIds:['same']}}, drafts:{capture:{body:'Unsaved draft'}},
  });
  const legacy = {
    schema:1,
    collections:[{id:'same', title:'Old title', itemPaths:['vault/old.md']}, {id:'legacy', title:'Old collection', itemPaths:['vault/a.md', 'vault/b.md', 'vault/hidden.md']}],
    boards:[
      {id:'same-board', title:'Old board', collectionId:'same', nodes:[], edges:[]},
      {id:'legacy-board', title:'Legacy board', collectionId:'legacy', nodes:[{id:'n1', itemPath:'vault/a.md', x:-10, y:5}, {id:'n2', itemPath:'vault/b.md', x:200, y:0}], edges:[{id:'forward', from:'n1', to:'n2', label:'First label'}, {id:'reverse', source:'n2', target:'n1', label:'Reverse label'}]},
    ],
  };
  const before = structuredClone({existing, legacy});
  const migrated = migrateLegacyDiscovery(existing, legacy);
  assert.deepEqual(existing, before.existing);assert.deepEqual(legacy, before.legacy);
  assert.deepEqual(migrated.collections[0], existing.collections[0]);
  assert.deepEqual(migrated.boards[0], existing.boards[0]);
  assert.deepEqual(migrated.cards, existing.cards);assert.deepEqual(migrated.annotations.local, existing.annotations.local);
  assert.deepEqual(migrated.collections[1], {id:'legacy', title:'Old collection', description:'', private:false, pinned:false, cardIds:['vault/a.md', 'vault/b.md', 'vault/hidden.md']});
  assert.deepEqual(migrated.savedIds, ['already-saved', 'vault/old.md', 'vault/a.md', 'vault/b.md', 'vault/hidden.md']);
  assert.deepEqual(migrated.hiddenIds, existing.hiddenIds);
  assert.deepEqual(migrated.boards[1].nodes, legacy.boards[1].nodes);
  assert.deepEqual(migrated.boards[1].edges, [{id:'forward', from:'n1', to:'n2', label:'First label'}]);
  assert.deepEqual(migrated.annotations['vault/a.md'], {note:null, private:false, collectionIds:['legacy']});
  assert.deepEqual(migrated.drafts, {capture:{body:'Unsaved draft'}, legacyDiscoveryImported:true});
  const reopened = normalizeWorkspaceState(JSON.parse(serializeWorkspace(migrated)));
  assert.deepEqual(migrateLegacyDiscovery(reopened, legacy), migrated);
  const edited = reduce(reduce(reopened, 'collection.delete', {id:'legacy'}), 'card.save', {id:'vault/a.md', saved:false});
  assert.deepEqual(migrateLegacyDiscovery(edited, legacy), edited, 'a repeated load cannot resurrect removed legacy membership');
});

test('legacy migration rejects unknown versions or damaged relationships before marking or changing either source', () => {
  const state = normalizeWorkspaceState({drafts:{capture:{body:'Keep draft'}}});
  const legacy = {schema:2, collections:[], boards:[]}, before = structuredClone({state, legacy});
  assert.throws(()=>migrateLegacyDiscovery(state, legacy), /版本.*保留原数据/);
  assert.deepEqual({state, legacy}, before);
  for (const invalid of [
    {schema:1, collections:[], boards:{}},
    {schema:1, collections:[{id:'c', title:'Collection', itemPaths:null}], boards:[]},
    {schema:1, collections:[], boards:[{id:'b', title:'Board', collectionId:'missing', nodes:[], edges:[]}]},
    {schema:1, collections:[], boards:[{id:'b', title:'Board', nodes:[{id:'n', itemPath:'vault/a.md', x:0, y:0}], edges:[{id:'e', from:'n', to:'absent'}]}]},
  ]) {
    const saved = structuredClone(invalid);
    assert.throws(()=>migrateLegacyDiscovery(state, invalid), /数据无效/);
    assert.deepEqual(invalid, saved);assert.deepEqual(state, before.state);
    assert.equal(state.drafts.legacyDiscoveryImported, undefined);
  }
  assert.throws(()=>migrateLegacyDiscovery({...state, drafts:{legacyDiscoveryImported:true}}, legacy), /版本.*保留原数据/);
});

test('raster and PDF files persist byte-for-byte, reject disguised HTML/SVG and size mismatches, and export clean references', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const pdf = Buffer.from('%PDF-1.4\n% synthetic fixture\n%%EOF');
  const attachment = (name, type, bytes) => ({name, type, size:bytes.length, dataUrl:`data:${type};base64,${bytes.toString('base64')}`});
  const photo = attachment('tiny.png', 'image/png', png), document = attachment('excerpt.pdf', 'application/pdf', pdf);
  let state = reduce(createWorkspaceState(), 'card.upsert', {card:card('photo', {type:'image', attachment:{...photo, hidden:'do not serialize'}})});
  state = reduce(state, 'card.upsert', {card:card('file', {type:'file', attachment:document})});
  const restored = normalizeWorkspaceState(JSON.parse(serializeWorkspace(state)));
  assert.deepEqual(restored.cards[0].attachment, photo);
  assert.equal(restored.cards[0].image, photo.dataUrl);
  assert.deepEqual(restored.cards[1].attachment, document);
  assert.equal(restored.cards[1].image, '');
  const updated = reduce(restored, 'card.upsert', {card:{id:'photo', caption:'new note'}});
  assert.deepEqual(updated.cards[0].attachment, photo);
  for (const bad of [attachment('bad.svg', 'image/svg+xml', Buffer.from('<svg/>')), attachment('bad.html', 'text/html', Buffer.from('<script/>')), attachment('disguised.png', 'image/png', Buffer.from('<html/>')), {...photo, size:photo.size + 1}, {...photo, type:'application/pdf'}, {...photo, dataUrl:'data:image/png;base64,!!!!'}]) assert.throws(() => reduce(state, 'card.upsert', {card:card('bad', {attachment:bad})}), /附件/);
  const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0);png.copy(oversized);
  assert.throws(() => reduce(state, 'card.upsert', {card:card('large', {attachment:attachment('large.png', 'image/png', oversized)})}), /64MiB/);
  const accepted = Buffer.alloc(MAX_ATTACHMENT_BYTES, 0);png.copy(accepted);
  assert.equal(normalizeWorkspaceState({cards:[card('limit', {attachment:attachment('limit.png', 'image/png', accepted)})]}).cards[0].attachment.size, accepted.length);
  for (const format of ['markdown', 'csv', 'json']) {
    const output = exportCards(restored.cards, format);
    assert.ok(output.includes('tiny.png') && output.includes('excerpt.pdf'));
    assert.ok(!output.includes(photo.dataUrl) && !output.includes(document.dataUrl));
  }
  assert.deepEqual(selectCards(restored.cards, restored, {media:'files'}).map(item => item.id), ['file']);
});

test('note edits merge private state and memberships independently instead of resetting unspecified fields', () => {
  let state = normalizeWorkspaceState({collections:[{id:'c', title:'Collection', cardIds:['a']}]});
  state = reduce(state, 'card.note', {id:'a', note:'first', private:true});
  state = reduce(state, 'card.note', {id:'a', note:'second'});
  assert.deepEqual(state.annotations.a, {note:'second', private:true, collectionIds:['c']});
  state = reduce(state, 'card.note', {id:'a', private:false});
  assert.deepEqual(state.annotations.a, {note:'second', private:false, collectionIds:['c']});
});

test('import identity and source locations survive persistence while distinct pages remain separate', () => {
  const [highlight] = parseImportText('Book Title,Author,Highlight,Note,Location,URL\n原书,作者,逐字摘录,旧注释,123-124,https://example.test/book', 'csv');
  const state = normalizeWorkspaceState({cards:[card('imported', {...highlight, importFingerprint:highlight.fingerprint, sourceLocation:'Location 123-124'})]});
  const reopened = normalizeWorkspaceState(JSON.parse(serializeWorkspace(state)));
  assert.equal(reopened.cards[0].page, '');
  assert.equal(reopened.cards[0].sourceLocation, 'Location 123-124');
  assert.equal(reopened.cards[0].importFingerprint, highlight.fingerprint);
  const importResult = dedupeImports([{...highlight, caption:'新的个人注释'}, {...highlight, page:'125'}, {...highlight, sourceTitle:'另一原书'}], reopened.cards);
  assert.equal(importResult.duplicates, 1);
  assert.deepEqual(importResult.items.map(record => [record.sourceTitle, record.page]), [['原书','125'], ['另一原书','']]);
  for (const format of ['markdown', 'csv', 'json']) {
    const content = exportCards(reopened.cards, format);
    assert.ok(content.includes('123-124') && content.includes('Location 123-124'));
    assert.ok(!content.includes(highlight.fingerprint));
  }
  assert.throws(() => normalizeWorkspaceState({cards:[card('bad', {importFingerprint:'unexpected-format'})]}), /导入识别/);
});

test('All and source plural media names are case-insensitive; off checkbox filters use undefined', () => {
  const cards = [card('image', {type:'image'}), card('file', {type:'file'}), card('note', {type:'text'}), card('social', {type:'social'})];
  const state = normalizeWorkspaceState({savedIds:['note'], favoriteIds:['note']});
  assert.equal(selectCards(cards, state, {media:'All', favorite:undefined, inLibrary:undefined}).length, 4);
  for (const [media, expected] of [['Images','image'],['Files','file'],['Notes','note'],['Socials','social'],['Social','social']]) assert.deepEqual(selectCards(cards, state, {media}).map(card => card.id), [expected]);
  assert.deepEqual(selectCards(cards, state, {inLibrary:true, favorite:true}).map(card => card.id), ['note']);
});

test('card exports contain only requested public cards and never leak metadata, drafts or private annotations', () => {
  const original = card('a', {hidden:'HIDDEN_SECRET', hash:'HASH_SECRET', fields:{caption:'FIELDS_SECRET'}, raw:{token:'TOKEN_SECRET'}, body:'  原文,第一行\r\n第二行含"引号"  \n<!-- mengcang:operation OPERATION_SECRET -->'});
  for (const format of ['markdown', 'csv', 'json']) {
    const output = exportCards([original], format);
    for (const value of ['来源', '作者', 'https://example.test/original', '自己的注释', '原文,第一行']) assert.ok(output.includes(value), `${format}: ${value}`);
    for (const value of ['HIDDEN_SECRET', 'HASH_SECRET', 'FIELDS_SECRET', 'TOKEN_SECRET', 'OPERATION_SECRET']) assert.ok(!output.includes(value), `${format}: leaked ${value}`);
  }
  const [exported] = JSON.parse(exportCards([original], 'json'));
  assert.equal(exported.body, '  原文,第一行\r\n第二行含"引号"  \n');
  assert.deepEqual(JSON.parse(exportCards([], 'json')), []);
  assert.throws(() => exportCards([original], 'unsupported'), /不支持/);
});

test('every AI placeholder is static and side-effect free even when APIs and storage throw if accessed', () => {
  const previousFetch = globalThis.fetch, previousMengcang = globalThis.mengcang;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('AI network call is forbidden'); };
  globalThis.mengcang = new Proxy({}, {get(){calls++;throw new Error('Native call is forbidden');}});
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, get(){calls++;throw new Error('Storage access is forbidden');}});
  try {
    assert.ok(Object.isFrozen(AI_MODES));
    assert.deepEqual(AI_MODES, ['The Gist', 'Explain Like I’m 5', 'Contrarian Take', 'Analogy', 'Hot Take']);
    for (const mode of [...AI_MODES, 'unrecognized']) {
      const first = aiPlaceholder(mode), second = aiPlaceholder(mode);
      assert.equal(first.enabled, false);
      assert.equal(first.title, mode);
      assert.match(first.message, /不会发送请求/);
      assert.deepEqual(first, second);
      assert.ok(Object.isFrozen(first));
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMengcang === undefined) delete globalThis.mengcang; else globalThis.mengcang = previousMengcang;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete globalThis.localStorage;
  }
});

test('collection and private metadata inherit source captions; explicit empty notes remain cleared across backups', () => {
  const source=card('vault-source',{origin:'vault',caption:'Keep original source caption'});
  let state=reduce(createWorkspaceState(),'collection.upsert',{collection:{id:'c',title:'Collection'}});
  state=reduce(state,'card.hide',{id:source.id,hidden:true});
  state=reduce(state,'collection.toggleCard',{id:'c',cardId:source.id,selected:true});
  assert.deepEqual(state.savedIds,[source.id]);assert.deepEqual(state.hiddenIds,[]);
  assert.equal(state.annotations[source.id].note,null);
  assert.equal(state.annotations[source.id]?.note??source.caption,source.caption);
  assert.deepEqual(selectCards([source],state,{collectionId:'c',inLibrary:true}).map(card=>card.id),[source.id]);
  state=reduce(state,'card.note',{id:source.id,private:true});
  assert.equal(state.annotations[source.id].note,null);
  state=reduce(state,'card.note',{id:source.id,note:''});
  assert.equal(state.annotations[source.id].note,'');
  state=reduce(state,'card.note',{id:source.id,private:false});
  const restored=parseWorkspaceBackup(serializeWorkspace(state));
  assert.equal(restored.annotations[source.id]?.note??source.caption,'');
  const inherited=reduce(restored,'card.note',{id:source.id,note:null});
  assert.equal(inherited.annotations[source.id]?.note??source.caption,source.caption);
});

test('compact backup stores each attachment once per card or draft and restores both new compact and old repeated formats', () => {
  const bytes=Buffer.alloc(8*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);
  const attachment={name:'synthetic-header.png',type:'image/png',size:bytes.length,dataUrl:`data:image/png;base64,${bytes.toString('base64')}`};
  const state=normalizeWorkspaceState({cards:[card('a',{attachment}),card('b',{attachment})]});
  const serialized=serializeWorkspace(state), compacted=JSON.parse(serialized);
  assert.equal(Object.hasOwn(compacted.cards[0],'image'),false);
  assert.ok(Buffer.byteLength(serialized)<40*1024*1024,'the two accepted images no longer exceed the former restore threshold');
  assert.deepEqual(parseWorkspaceBackup(serialized),state);
  assert.deepEqual(parseWorkspaceBackup(JSON.stringify(state)),state,'old duplicated schema1 backups still load');
  const draftState=reduce(createWorkspaceState(),'draft.set',{key:'file-editor',value:{image:attachment.dataUrl,attachment,body:'Unsaved'}});
  const draftBackup=serializeWorkspace(draftState);
  assert.equal(Object.hasOwn(JSON.parse(draftBackup).drafts['file-editor'],'image'),false);
  assert.deepEqual(parseWorkspaceBackup(draftBackup),draftState);
  assert.equal(MAX_WORKSPACE_BACKUP_BYTES,256*1024*1024);
  assert.throws(()=>parseWorkspaceBackup(' '.repeat(MAX_WORKSPACE_BACKUP_BYTES+1)),/256MiB/);
  assert.throws(()=>serializeWorkspace({...createWorkspaceState(),drafts:{tooLarge:['x'.repeat(MAX_WORKSPACE_BACKUP_BYTES/2),'x'.repeat(MAX_WORKSPACE_BACKUP_BYTES/2)]}}),/256MiB总上限/);
  for(const invalid of ['null','[]','{}','{"schemaVersion":2}'])assert.throws(()=>parseWorkspaceBackup(invalid),/版本|备份/);
});

test('keyword relevance prioritizes title and tags over body repetition, keeps AND matching and never fabricates AI scores', () => {
  const cards=[card('body',{title:'Other',body:'garden '.repeat(100)}),card('title',{title:'Garden',body:'Source'}),card('tags',{title:'Tag match',body:'Source',tags:['garden']}),card('unrelated',{title:'Else',body:'Source'})];
  const before=structuredClone(cards),state=createWorkspaceState();
  assert.deepEqual(selectCards(cards,state,{query:'GARDEN',sort:'relevant'}).map(card=>card.id),['title','tags','body']);
  assert.ok(selectCards(cards,state,{query:'garden',sort:'relevant'}).every(card=>!Object.hasOwn(card,'score')));
  assert.deepEqual(selectCards(cards,state,{query:'garden source',sort:'relevant'}).map(card=>card.id),['title','tags']);
  assert.deepEqual(cards,before);
  assert.equal(selectCards(cards,state,{query:'',sort:'relevant'}).length,4);
});

test('Articles, Links, Notes, Highlights and Files are distinct media filters', () => {
  const cards=[card('article',{type:'article'}),card('link',{type:'link'}),card('web',{type:'web'}),card('note',{type:'note'}),card('highlight',{type:'highlight'}),card('quote',{type:'quote'}),card('pdf',{type:'pdf'})];
  const state=createWorkspaceState();
  for(const [media,ids] of [['Articles',['article']],['Links',['link','web']],['Notes',['note']],['Highlights',['highlight','quote']],['Files',['pdf']]])assert.deepEqual(selectCards(cards,state,{media}).map(card=>card.id),ids);
});

// Independent synthetic ZIP writer, using stored entries and CRC32. No files are read.
function storedZip(entries) {
  const local=[],central=[];let offset=0;
  const crc=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  for(const [filename,content] of entries){
    const name=Buffer.from(filename),data=Buffer.from(content),checksum=crc(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(checksum,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,name,data);central.push(directory,name);offset+=header.length+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

test('allowed Word, HEIC/HEIF, video and audio attachment bytes persist without executing or pretending to preview them', () => {
  const docx=storedZip([['[Content_Types].xml','<Types/>'],['word/document.xml','<w:document><w:p>synthetic</w:p></w:document>']]);
  const binary=(hex,tail='')=>Buffer.concat([Buffer.from(hex,'hex'),Buffer.from(tail)]);
  const fixtures=[
    ['letter.doc','application/msword',binary('d0cf11e0a1b11ae1','opaque synthetic OLE')],
    ['letter.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx],
    ['photo.heic','image/heic',binary('00000018','ftypheic\0\0\0\0mif1heic')],
    ['photo.heif','image/heif',binary('00000018','ftypmif1\0\0\0\0mif1')],
    ['clip.mp4','video/mp4',binary('00000018','ftypisom\0\0\0\0isommp42')],
    ['clip.mov','video/quicktime',binary('00000014','ftypqt  \0\0\0\0qt  ')],
    ['clip.avi','video/x-msvideo',Buffer.from('RIFF\0\0\0\0AVI synthetic')],
    ['sound.ogg','audio/ogg',Buffer.from('OggS\0synthetic')],
    ['sound.mp3','audio/mpeg',Buffer.from('ID3\0synthetic')],
    ['sound.wav','audio/wav',Buffer.from('RIFF\0\0\0\0WAVEsynthetic')],
    ['sound.m4a','audio/mp4',binary('00000014','ftypM4A \0\0\0\0M4A ')],
    ['sound.aac','audio/aac',binary('fff1','synthetic')],
    ['sound.flac','audio/flac',Buffer.from('fLaCsynthetic')],
  ];
  const cards=fixtures.map(([name,type,bytes],index)=>({id:`file-${index}`,title:name,attachment:{name,type,size:bytes.length,dataUrl:`data:${type};base64,${bytes.toString('base64')}`}}));
  const state=normalizeWorkspaceState({cards}),restored=parseWorkspaceBackup(serializeWorkspace(state));
  for(let i=0;i<cards.length;i++)assert.deepEqual(restored.cards[i].attachment,cards[i].attachment);
  assert.equal(restored.cards[2].image,'');assert.equal(restored.cards[3].image,'');
  assert.equal(restored.cards[4].type,'video');assert.equal(restored.cards[7].type,'audio');
  assert.equal(MAX_ATTACHMENT_BYTES,64*1024*1024);assert.ok(Object.isFrozen(WORKSPACE_FILE_TYPES));
  const upperType={...cards[0].attachment,name:'  Original filename.doc ',type:'APPLICATION/MSWORD'};
  assert.deepEqual(normalizeWorkspaceAttachment(upperType),upperType,'original metadata spelling is retained');
  const aliasType={...cards[12].attachment,type:'audio/x-flac'};
  assert.deepEqual(normalizeWorkspaceAttachment(aliasType),aliasType,'equivalent MIME aliases retain the original declaration');
  const badDocx=storedZip([['[Content_Types].xml','<Types/>'],['wrong/document.xml','<document/>']]);
  const traversal=storedZip([['[Content_Types].xml','<Types/>'],['word/document.xml','<document/>'],['../secret','unsafe']]);
  for(const bytes of [badDocx,traversal,Buffer.from('<html>pretending to be docx</html>')])assert.throws(()=>normalizeWorkspaceAttachment({name:'bad.docx',type:cards[1].attachment.type,size:bytes.length,dataUrl:`data:${cards[1].attachment.type};base64,${bytes.toString('base64')}`}),/附件/);
  assert.throws(()=>normalizeWorkspaceAttachment({...cards[0].attachment,name:'unsafe.html'}),/网页|程序/);
});
