'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DesktopConnector } = require('../src/desktop-connector');
const { hash, frontmatterOf, splitNote } = require('../src/desktop-connector/notes');
const { capturePaths, validateCaptureInput, assertCapturePath, hasCaptureOperation, createCapture } = require('../src/desktop-connector/capture');
const SOURCE = '01_sources/cards/text/source.md';
const sourceText = '---\ntype: material\ntitle: Synthetic parent\n---\nOnly synthetic source material.\n';
const request = extra => ({ operationId: randomUUID(), title: '一个摘录', body: '\n  逐字保留。\r\n\r\n- 原有列表\r\n尾部空格  \n', sourceUrl: '', sourceTitle: '', author: '', page: null, sourcePath: '', expectedSourceHash: '', tags: [], ...extra });
const code = expected => error => error?.code === expected;

async function harness(t, { withSource = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-capture-test-')));
  const files = new Map(), routes = new Map(), calls = { create: 0, folder: 0, relation: 0 };
  let data = {};
  const disk = relative => path.join(root, relative);
  const write = (relative, markdown, indexed = true) => {
    fs.mkdirSync(path.dirname(disk(relative)), { recursive: true });
    fs.writeFileSync(disk(relative), markdown);
    const file = { path: relative, extension: 'md', basename: path.basename(relative, '.md') };
    if (indexed) files.set(relative, file);
    return file;
  };
  if (withSource) write(SOURCE, sourceText);
  const vault = {
    adapter: { getBasePath: () => root, read: async relative => relative === '_meta/projects.json' ? '{"projects":[]}' : fs.promises.readFile(disk(relative), 'utf8') },
    getName: () => 'Synthetic Capture Vault', getMarkdownFiles: () => [...files.values()].filter(file=>file.extension==='md'), getAbstractFileByPath: relative => files.get(relative),
    read: async file => { await vault.beforeRead?.(file); return fs.promises.readFile(disk(file.path), 'utf8'); },
    createFolder: async relative => { calls.folder++; await vault.beforeFolder?.(relative); await fs.promises.mkdir(disk(relative)); },
    create: async (relative, markdown) => {
      calls.create++; await vault.beforeCreate?.(relative);
      await fs.promises.writeFile(disk(relative), markdown, { flag: 'wx' });
      const file = { path: relative, extension: 'md', basename: path.basename(relative, '.md') };
      files.set(relative, file); await vault.afterCreate?.(file); return file;
    },
    createBinary: async (relative,bytes) => {calls.binary=(calls.binary||0)+1;await vault.beforeBinary?.(relative);await fs.promises.writeFile(disk(relative),Buffer.from(bytes),{flag:'wx'});const file={path:relative,extension:path.extname(relative).slice(1)};files.set(relative,file);await vault.afterBinary?.(file);return file;},
    readBinary: async file => {const bytes=await fs.promises.readFile(disk(file.path));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},
    on: () => 1, offref() {},
  };
  const plugin = {
    manifest: { id: 'mengcang-dashboard', version: '0.6.0' },
    app: { vault, metadataCache: {}, plugins: { plugins: {
      'obsidian-local-rest-api': { getPublicApi: () => ({ addRoute: endpoint => ({ get: callback => routes.set(`get ${endpoint}`, callback), post: callback => routes.set(`post ${endpoint}`, callback) }), unregister() {} }) },
    } } },
    loadData: async () => data, updateMengcangData: async callback => { data = callback(data); },
    starSea: { getPendingTransaction: () => null, confirmRelation: async () => { calls.relation++; } },
  };
  const connector = new DesktopConnector(plugin, { testVaultPath: root, appVersion: '1.13.7' });
  t.after(() => { connector.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  await connector.start();
  const save = value => connector.capture({ ...value, vaultId: connector.identity.id });
  return { root, disk, write, files, vault, calls, connector, routes, save, read: relative => fs.readFileSync(disk(relative), 'utf8') };
}

test('capture validates exact fields, UUID, links, source versions, pages and reserved metadata', () => {
  const value = request(), accepted = validateCaptureInput(value);
  assert.equal(accepted.body, value.body);
  assert.equal(accepted.path, capturePaths(value.operationId)[0]);
  assert.equal(assertCapturePath(accepted.path), accepted.path);
  for (const patch of [
    { operationId: '../arbitrary' }, { title: '' }, { title: 'x'.repeat(301) }, { body: 'x'.repeat(100001) }, { body: '\ud800' },
    { body: '<!-- mengcang:operation {"id":"injected"} -->' }, { body: '<!-- MENGCANG-relations:start -->' },
    { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://user:pass@example.test' }, { sourceUrl: ' https://example.test' }, { sourceUrl: 'https://example.test/a\n' }, { sourceUrl: 'https:example.test' }, { sourceUrl: 'https:\\example.test' },
    { page: 0 }, { page: 1.1 }, { page: '2' }, { page: 1000001 }, { sourcePath: SOURCE }, { expectedSourceHash: hash(sourceText) },
    { tags: [''] }, { tags: ['a\nb'] }, { tags: 'tag' }, { destination: '03_projects/arbitrary.md' }, { vaultPath: '/arbitrary' },
    { caption: 'x'.repeat(50001) }, { caption: {} }, { importFingerprint: 'wrong-prefix' }, { importFingerprint: 'highlight-v1:bad\nmarker' },
    { importFingerprint: `highlight-v1:${'x'.repeat(139)}` }, { importFingerprint: 'highlight-v1:bad\x7fmarker' },
    { sourceLocation: 'x'.repeat(1001) }, { sourceLocation: 123 }, { sourceLocation: 'Location 123\n124' }, { sourceLocation: 'Location 123\t124' }, { sourceLocation: 'Location 123\x7f124' },
  ]) assert.throws(() => validateCaptureInput({ ...value, ...patch }));
  assert.throws(() => assertCapturePath('01_sources/cards/text/capture-not-a-uuid.md'), code('PATH_FORBIDDEN'));
  const web = validateCaptureInput(request({ body: '', sourceUrl: 'https://example.test/a?x=1#anchor', page: 3, tags: [' visual ', 'visual'] }));
  assert.equal(web.sourceUrl, 'https://example.test/a?x=1#anchor'); assert.deepEqual(web.tags, ['visual']);
  assert.equal(web.path, capturePaths(web.operationId)[1]);
});

test('new Markdown preserves excerpt bytes and provenance without implicit knowledge relations', () => {
  const raw = request({ sourceUrl: 'https://example.test/article?x=1#p2', sourceTitle: '原网页标题', author: '作者', sourcePath: SOURCE, expectedSourceHash: hash(sourceText), page: 2, tags: ['excerpt'], caption: '我的补充说明\n不会混入逐字高亮', importFingerprint: 'highlight-v1:source-specific-id' });
  const input = validateCaptureInput(raw), markdown = createCapture(input, '2026-10-02T00:00:00.000Z');
  assert.equal(splitNote(markdown).body, raw.body);
  const fields = frontmatterOf(markdown);
  assert.equal(fields.type, 'material'); assert.equal(fields.record_type, 'excerpt'); assert.equal(fields.status, 'inbox'); assert.equal(fields.rights, 'unknown');
  assert.equal(fields.source_url, raw.sourceUrl); assert.equal(fields.source_title, raw.sourceTitle); assert.equal(fields.author, raw.author);
  assert.equal(fields.source_page, 2); assert.equal(fields.source_note, SOURCE); assert.equal(fields.source_note_sha256, hash(sourceText));
  assert.equal(fields.excerpt_sha256, hash(raw.body));
  assert.equal(fields.caption, raw.caption); assert.equal(fields.import_fingerprint, raw.importFingerprint);
  assert.equal(splitNote(markdown).body.includes(raw.caption), false);
  assert.equal(fields.relation_candidates, undefined); assert.equal(fields.material_notes, undefined);
  assert.equal(hasCaptureOperation(markdown, input), true);
  assert.throws(() => hasCaptureOperation(markdown, validateCaptureInput({ ...raw, body: `${raw.body}!` })), code('OPERATION_REUSED'));
  assert.throws(() => hasCaptureOperation(markdown, validateCaptureInput({ ...raw, caption: 'different caption' })), code('OPERATION_REUSED'));
  assert.throws(() => hasCaptureOperation(markdown, validateCaptureInput({ ...raw, importFingerprint: 'highlight-v1:different-import' })), code('OPERATION_REUSED'));
});

test('import matching metadata is preserved without authorizing a cross-operation replay or changing the body', async t => {
  const f = await harness(t), raw = request({ caption: 'Readwise note', importFingerprint: 'highlight-v1:same-import-marker' });
  const saved = await f.save(raw);
  assert.equal(saved.note.fields.caption, raw.caption); assert.equal(saved.note.fields.import_fingerprint, raw.importFingerprint);
  assert.equal(saved.note.body, raw.body); assert.equal((await f.save(raw)).replayed, true);
  await assert.rejects(f.save({ ...raw, caption: 'another note' }), code('OPERATION_REUSED'));
  await assert.rejects(f.save({ ...raw, importFingerprint: 'highlight-v1:another-marker' }), code('OPERATION_REUSED'));
  const other = await f.save({ ...raw, operationId: randomUUID() });
  assert.notEqual(other.note.path, saved.note.path); assert.equal(other.replayed, false); assert.equal(f.calls.create, 2);
});

test('Kindle and Readwise source locations remain exact strings independently of integer PDF pages', async t => {
  const f = await harness(t), raw = request({ sourceLocation: '  Location 123-124 · Kindle  ', page: 7 });
  const saved = await f.save(raw);
  assert.equal(saved.note.fields.source_location, raw.sourceLocation);
  assert.equal(saved.note.fields.source_page, 7); assert.equal(saved.note.body, raw.body);
  assert.equal((await f.save(raw)).replayed, true);
  await assert.rejects(f.save({ ...raw, sourceLocation: 'Location 123' }), code('OPERATION_REUSED'));
  await assert.rejects(f.save({ ...raw, page: '123-124' }), code('INVALID_CAPTURE'));
  const locationOnly = await f.save(request({ sourceLocation: '123-124', page: null }));
  assert.equal(locationOnly.note.fields.source_location, '123-124'); assert.equal(locationOnly.note.fields.source_page, null);
});

test('snapshot advertises capture and route before creating anything; saves discoverable real cards', async t => {
  const f = await harness(t, { withSource: false });
  assert.equal((await f.connector.snapshot()).capabilities.capture, true);
  assert.ok(f.routes.has('post /mengcang/v1/capture')); assert.equal(f.calls.folder, 0); assert.equal(f.calls.create, 0);
  const raw = request({ sourceUrl: 'https://example.test/original', sourceTitle: 'A source', page: 4 });
  const result = await f.save(raw);
  assert.equal(result.replayed, false); assert.equal(result.note.path, capturePaths(raw.operationId)[1]);
  assert.equal(result.note.kind, 'web'); assert.equal(result.note.body, raw.body); assert.equal(result.note.url, raw.sourceUrl);
  assert.equal((await f.connector.snapshot()).materials.length, 1); assert.equal(f.calls.create, 1); assert.equal(f.calls.relation, 0);
});

test('retries, lost responses, concurrent saves and later user edits never create or overwrite a second card', async t => {
  const f = await harness(t), raw = request();
  let failOnce = true;
  f.vault.afterCreate = () => { if (failOnce) { failOnce = false; throw new Error('lost response after commit'); } };
  await assert.rejects(f.save(raw), /lost response/);
  const target = capturePaths(raw.operationId)[0], committed = f.read(target);
  const [a, b] = await Promise.all([f.save(raw), f.save(raw)]);
  assert.equal(a.replayed, true); assert.deepEqual(a, b); assert.equal(f.calls.create, 1); assert.equal(f.read(target), committed);
  f.write(target, `${committed}\nUser edit after first save.\n`);
  const updated = f.read(target); await f.save(raw); assert.equal(f.read(target), updated);
  await assert.rejects(f.save({ ...raw, body: 'different content' }), code('OPERATION_REUSED'));
  await assert.rejects(f.save({ ...raw, sourceUrl: 'https://example.test/changed-carrier' }), code('OPERATION_REUSED'));
  assert.equal(fs.existsSync(f.disk(capturePaths(raw.operationId)[1])), false); assert.equal(f.calls.relation, 0);
});

test('a valid parent requires its exact source hash and remains unchanged', async t => {
  const f = await harness(t), before = f.read(SOURCE), raw = request({ sourcePath: SOURCE, expectedSourceHash: hash(before), page: 2 });
  const saved = await f.save(raw);
  assert.equal(saved.note.fields.source_note, SOURCE); assert.equal(saved.note.fields.source_note_sha256, hash(before));
  assert.equal(f.read(SOURCE), before);
  f.write(SOURCE, `${before}\nA later parent edit.\n`);
  assert.equal((await f.save(raw)).replayed, true);
  await assert.rejects(f.save({ ...raw, operationId: randomUUID() }), code('CONFLICT'));
  assert.equal(f.calls.create, 1);
});

test('missing, forbidden, stale, unindexed and symlink parents fail closed', async t => {
  const f = await harness(t), raw = request({ sourcePath: SOURCE, expectedSourceHash: hash(sourceText), sourceUrl: 'https://example.test/new' });
  await assert.rejects(f.save({ ...raw, expectedSourceHash: '0'.repeat(64) }), code('CONFLICT'));
  assert.equal(fs.existsSync(f.disk('01_sources/cards/web')), false);
  await assert.rejects(f.save({ ...raw, sourcePath: '06_memory/no.md' }), code('PATH_FORBIDDEN'));
  await assert.rejects(f.save({ ...raw, sourcePath: '../outside.md' }), code('INVALID_PATH'));
  await assert.rejects(f.save({ ...raw, sourcePath: '01_sources/cards/text/missing.md' }), code('NOT_FOUND'));
  f.files.delete(SOURCE); await assert.rejects(f.save(raw), code('NOT_FOUND')); f.write(SOURCE, sourceText);
  const linked = '01_sources/cards/text/linked.md'; fs.symlinkSync(f.disk(SOURCE), f.disk(linked)); f.files.set(linked, { path: linked, extension: 'md', basename: 'linked' });
  await assert.rejects(f.save({ ...raw, sourcePath: linked }), code('PATH_FORBIDDEN')); assert.equal(f.calls.create, 0);
});

test('parent changes during awaited folder work are detected immediately before create', async t => {
  const f = await harness(t), raw = request({ sourcePath: SOURCE, expectedSourceHash: hash(sourceText), sourceUrl: 'https://example.test/new' });
  f.vault.beforeFolder = () => f.write(SOURCE, `${sourceText}\nChanged during folder work.\n`);
  await assert.rejects(f.save(raw), code('CONFLICT')); assert.equal(f.calls.create, 0);
});

test('existing files, mismatched indexes, directories, create races and broken capture metadata are never replaced', async t => {
  const f = await harness(t), raw = request(), target = capturePaths(raw.operationId)[0];
  f.write(target, 'Do not overwrite.', false);
  await assert.rejects(f.save(raw), code('CAPTURE_PATH_OCCUPIED')); assert.equal(f.read(target), 'Do not overwrite.');
  f.write(target, '---\ntype: material\n---\nOther card.');
  await assert.rejects(f.save(raw), code('CAPTURE_PATH_OCCUPIED'));
  fs.rmSync(f.disk(target)); await assert.rejects(f.save(raw), code('CAPTURE_PATH_OCCUPIED')); f.files.delete(target);
  fs.mkdirSync(f.disk(target)); await assert.rejects(f.save(raw), code('CAPTURE_PATH_OCCUPIED')); fs.rmSync(f.disk(target), { recursive: true });
  f.vault.beforeCreate = relative => f.write(relative, 'Created concurrently.', false);
  await assert.rejects(f.save(raw), code('CAPTURE_PATH_OCCUPIED')); assert.equal(f.read(target), 'Created concurrently.');
  assert.equal(f.calls.create, 1);
});

test('symlink destinations and ancestors are rejected even when their target is inside the fixture', async t => {
  const f = await harness(t), raw = request(), target = capturePaths(raw.operationId)[0];
  fs.symlinkSync(f.disk(SOURCE), f.disk(target));
  await assert.rejects(f.save(raw), code('PATH_FORBIDDEN')); fs.unlinkSync(f.disk(target));
  fs.mkdirSync(f.disk('real-web')); fs.symlinkSync(f.disk('real-web'), f.disk('01_sources/cards/web'));
  await assert.rejects(f.save({ ...raw, sourceUrl: 'https://example.test/a' }), code('PATH_FORBIDDEN'));
  assert.equal(f.calls.create, 0); assert.equal(f.read(SOURCE), sourceText);
});

test('capture route enforces loopback, paired identity and disposed state', async t => {
  const f = await harness(t), route = f.routes.get('post /mengcang/v1/capture'), raw = request();
  const invoke = async (address, body) => {
    const response = { headersSent: false, set() { return this; }, json(value) { this.value = value; return this; }, status(value) { this.statusCode = value; return this; } };
    await route({ socket: { remoteAddress: address }, body }, response); return response;
  };
  const denied = await invoke('192.0.2.1', { ...raw, vaultId: f.connector.identity.id });
  assert.equal(denied.statusCode, 403); assert.equal(denied.value.error.code, 'LOCAL_ONLY');
  const wrong = await invoke('127.0.0.1', { ...raw, vaultId: 'wrong-vault' }); assert.equal(wrong.value.error.code, 'WRONG_VAULT');
  f.connector.dispose(); const disposed = await invoke('127.0.0.1', { ...raw, vaultId: f.connector.identity.id }); assert.equal(disposed.value.error.code, 'DISCONNECTED');
  assert.equal(f.calls.create, 0);
});

const pdfBytes=fs.readFileSync(path.join(__dirname,'fixtures/discovery-excerpt.pdf'));
const original=extra=>({name:'原始参考.pdf',type:'application/pdf',size:pdfBytes.length,dataUrl:'data:application/pdf;base64,'+pdfBytes.toString('base64'),...extra});
test('original-file capture reserves a fixed operation folder, validates bytes and preserves text-only identities',()=>{
 const plain=request(),before=validateCaptureInput(plain),without=validateCaptureInput({...plain,attachment:null});assert.equal(before.fingerprint,without.fingerprint);
 const input=validateCaptureInput({...plain,body:'',attachment:original()});assert.equal(input.attachment.sha256,hash(pdfBytes));assert.deepEqual(input.attachment.bytes,pdfBytes);assert.match(input.attachment.path,/^01_sources\/_originals\/capture-[a-f0-9-]+\/[a-f0-9]{64}-[a-f0-9]{64}\.pdf$/);
 for(const attachment of [original({name:'evil.html'}),original({size:1}),original({type:'image/png'}),original({dataUrl:'data:application/pdf;base64,'+Buffer.from('<html>bad</html>').toString('base64')}),original({path:'../anywhere'})])assert.throws(()=>validateCaptureInput({...plain,attachment}),code('INVALID_CAPTURE'));
});
test('original bytes, filename, type, hash and note provenance round-trip through the actual connector',async t=>{
 const f=await harness(t,{withSource:false}),raw=request({body:'',attachment:original()}),result=await f.save(raw),fields=result.note.fields;
 assert.equal(fields.original_name,raw.attachment.name);assert.equal(fields.original_sha256,hash(pdfBytes));assert.equal(fields.original_mime,'application/pdf');assert.equal(fields.original_size,pdfBytes.length);assert.equal(result.note.attachmentPath,fields.original_file);
 assert.deepEqual(fs.readFileSync(f.disk(fields.original_file)),pdfBytes);assert.deepEqual((await f.connector.attachment(fields.original_file)).data,pdfBytes);assert.equal((await f.connector.snapshot()).capabilities.captureAttachment,true);
 assert.equal((await f.save(raw)).replayed,true);assert.equal(f.calls.binary,1);assert.equal(f.calls.create,1);assert.equal(f.calls.relation,0);
});
test('partial original commits and lost note replies retry without duplicates or silently changing the operation',async t=>{
 const f=await harness(t,{withSource:false}),raw=request({attachment:original()});let fail=true;
 f.vault.beforeCreate=()=>{if(fail){fail=false;throw Error('synthetic note write failure');}};
 await assert.rejects(f.save(raw),/synthetic note/);assert.equal(f.calls.binary,1);
 await assert.rejects(f.save({...raw,body:'different request after partial commit'}),code('OPERATION_REUSED'));assert.equal(f.calls.binary,1);
 const saved=await f.save(raw);assert.equal(saved.replayed,false);assert.equal(f.calls.binary,1);
 f.write(saved.note.path,fs.readFileSync(f.disk(saved.note.path),'utf8')+'\nLater user edit.');const before=f.read(saved.note.path);await f.save(raw);assert.equal(f.read(saved.note.path),before);
 await assert.rejects(f.save({...raw,attachment:original({name:'other-name.pdf'})}),code('OPERATION_REUSED'));assert.equal(f.calls.binary,1);
});
test('changed originals and symlink ancestors never get overwritten on replay or partial recovery',async t=>{
 const f=await harness(t,{withSource:false}),raw=request({attachment:original()}),saved=await f.save(raw),target=saved.note.fields.original_file;
 const changed=Buffer.from(pdfBytes);changed[changed.length-1]^=1;fs.writeFileSync(f.disk(target),changed);
 await assert.rejects(f.save(raw),code('ORIGINAL_CONFLICT'));assert.deepEqual(fs.readFileSync(f.disk(target)),changed);assert.equal(f.calls.binary,1);
 const other=request({attachment:original()}),input=validateCaptureInput(other),folder=path.dirname(input.attachment.path);fs.symlinkSync(path.dirname(f.disk(target)),f.disk(folder));
 await assert.rejects(f.save(other),code('PATH_FORBIDDEN'));assert.equal(f.calls.binary,1);
});
test('parent validation runs before original creation and again before note commit',async t=>{
 const f=await harness(t),raw=request({sourcePath:SOURCE,expectedSourceHash:hash(sourceText),attachment:original()});
 f.vault.afterBinary=()=>f.write(SOURCE,sourceText+'\nChanged during original save.');
 await assert.rejects(f.save(raw),code('CONFLICT'));assert.equal(f.calls.binary,1);assert.equal(f.calls.create,0);assert.equal(f.read(SOURCE),sourceText+'\nChanged during original save.');
 await assert.rejects(f.save({...raw,operationId:randomUUID()}),code('CONFLICT'));assert.equal(f.calls.binary,1);
});
