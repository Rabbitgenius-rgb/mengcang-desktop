'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hash, frontmatterOf, setYamlFields, mutateNote, splitNote } = require('../src/desktop-connector/notes');
const { DesktopConnector, safeRelative, assertNotePath } = require('../src/desktop-connector');
const { StarSeaService } = require('../star-sea/service');
const { parseManagedRelations } = require('../star-sea/core');
const a = '01_sources/cards/text/分散灵感.md';
const b = '01_sources/cards/web/参考.md';
const source = '---\ntype: material\nrecord_type: inspiration\ntitle: 月亮网站\n# 标签说明\ntags: # 行内说明\n  - 夜空\n  - 月亮\nunknown:\n  nested:\n    - 保留\ncaption: |-\n  原来的多行\n  配文\n---\n# 正文\n\n请保留这里。\n';
function fieldsInput(markdown, fields, operationId = 'operation-field-001') { return { kind: 'fields', expectedHash: hash(markdown), operationId, fields }; }
function harness(t, entries = { [a]: source, [b]: '---\ntype: material\ntitle: 月亮图片\ntags: [月亮]\n---\n## 来源\n月亮参考\n' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-connector-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = new Map(); const contents = new Map(Object.entries(entries)); const events = new Map(); let counter = 0;
  for (const name of Object.keys(entries)) files.set(name, { path: name, extension: 'md', basename: name.split('/').pop().slice(0, -3) });
  const vault = { adapter: { getBasePath: () => root, read: async target => { if (target === '_meta/projects.json') return '{"projects":[]}'; throw new Error('missing'); } }, getName: () => 'Test Vault', getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: name => files.get(name), read: async file => { if (!contents.has(file.path)) throw new Error('missing'); return contents.get(file.path); }, cachedRead: async file => contents.get(file.path), process: async (file, callback) => { vault.beforeProcess?.(file); contents.set(file.path, callback(contents.get(file.path))); }, on: (event, callback) => { const id = ++counter; events.set(id, { event, callback }); return id; }, offref: id => events.delete(id) };
  const plugin = { manifest: { id: 'mengcang-dashboard', version: '0.5.0' }, data: { unrelated: { keep: 1 } }, app: { vault, metadataCache: { getFirstLinkpathDest: () => null }, workspace: { getLeaf: () => ({ openFile: async () => {} }) }, plugins: { plugins: {} } }, loadData: async () => structuredClone(plugin.data), saveData: async data => { plugin.data = structuredClone(data); }, updateMengcangData: async callback => { plugin.data = callback(structuredClone(plugin.data)); }, inspirations: { refreshNow: async () => {} } };
  plugin.starSea = new StarSeaService(plugin);
  const connector = new DesktopConnector(plugin, { testVaultPath: root, appVersion: '1.13.7' });
  t.after(() => connector.dispose());
  return { connector, plugin, vault, contents, root, files, events };
}
test('YAML document edits replace multiline metadata and preserve nested unknown fields/comments/body', () => {
  const result = setYamlFields(source, { tags: ['光线'], caption: '新配文' });
  assert.deepEqual(frontmatterOf(result).tags, ['光线']);
  assert.deepEqual(frontmatterOf(result).unknown, { nested: ['保留'] });
  assert.equal(frontmatterOf(result).caption, '新配文');
  assert.match(result, /# 标签说明/); assert.match(result, /# 行内说明/);
  assert.equal(splitNote(result).body, splitNote(source).body);
  assert.throws(() => setYamlFields('---\ntags: [broken\n---\nbody', { caption: 'x' }), error => error.code === 'INVALID_METADATA');
});
test('version conflict and non-allowlisted mutations refuse changes', () => {
  assert.throws(() => mutateNote(source + '用户修改', fieldsInput(source, { caption: '覆盖' })), error => error.code === 'CONFLICT');
  assert.throws(() => mutateNote(source, fieldsInput(source, { unknown: '覆盖' })), error => error.code === 'FORBIDDEN_FIELD');
});
test('stable operation id makes exploration retry and field retry idempotent even with old expected hash', () => {
  const input = { kind: 'exploration', expectedHash: hash(source), operationId: 'explore-operation-001', text: '做一个月亮网站', explorationKind: '联想' };
  const once = mutateNote(source, input); const twice = mutateNote(once, input);
  assert.equal(once, twice); assert.equal((once.match(/<!-- mengcang:exploration/g) || []).length, 1);
  assert.throws(() => mutateNote(once, { ...input, text: '不同内容' }), error => error.code === 'OPERATION_REUSED');
  const update = fieldsInput(source, { caption: '配文' }); const saved = mutateNote(source, update);
  assert.equal(saved, mutateNote(saved, update));
});
test('image, web and text material exploration survives mutation readback, snapshot and retry', async t => {
  const paths = ['01_sources/cards/images/图片.md', '01_sources/cards/web/网页.md', '01_sources/cards/text/文字.md'];
  const initial = '---\ntype: material\ntitle: 参考素材\n---\n保留原有正文。\n';
  const { connector, contents } = harness(t, Object.fromEntries(paths.map(notePath => [notePath, initial])));
  await connector.start();
  for (const [index, notePath] of paths.entries()) {
    const input = { path: notePath, vaultId: connector.identity.id, kind: 'exploration', expectedHash: hash(initial), operationId: `material-explore-${index}`, text: `素材探索 ${index}`, explorationKind: '补充' };
    const result = await connector.mutate(input);
    assert.equal(result.note.explorations.length, 1);
    assert.equal(result.note.explorations[0].id, input.operationId);
    assert.equal(result.note.explorations[0].text, input.text);
    const committed = contents.get(notePath);
    await connector.mutate(input);
    assert.equal(contents.get(notePath), committed);
    assert.deepEqual((await connector.readNote(notePath)).explorations, result.note.explorations);
    const fromSnapshot = (await connector.snapshot()).materials.find(note => note.path === notePath);
    assert.deepEqual(fromSnapshot.explorations, result.note.explorations);
    assert.match(committed, /保留原有正文。/);
  }
});
test('image cover serves preview and original opening while JSON source provenance remains intact', async t => {
  const notePath = '01_sources/cards/images/patterns/color-card.md';
  const cover = '01_sources/cards/images/patterns/assets/color.png';
  const sourcePath = '01_sources/_originals/data/colors.json';
  const markdown = `---\ntype: material\ntitle: Synthetic color card\ncover: "![[${cover}|480]]"\noriginal_file: "${sourcePath}"\nsource_file: "${sourcePath}"\n---\nOriginal source description.\n`;
  const { connector, vault, contents, root, files } = harness(t, { [notePath]: markdown });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  fs.mkdirSync(path.dirname(path.join(root, cover)), { recursive: true }); fs.writeFileSync(path.join(root, cover), png);
  files.set(cover, { path: cover, extension: 'png' }); vault.readBinary = async file => fs.promises.readFile(path.join(root, file.path));
  await connector.start();
  const note = await connector.readNote(notePath);
  assert.equal(note.attachmentPath, cover); assert.equal(note.coverPath, cover); assert.equal(note.originalPath, sourcePath);
  assert.equal(note.fields.original_file, sourcePath); assert.equal(note.fields.source_file, sourcePath); assert.equal(contents.get(notePath), markdown);
  const attachment = await connector.attachment(note.attachmentPath); assert.equal(attachment.contentType, 'image/png'); assert.deepEqual(attachment.data, png);
  assert.deepEqual(await connector.original(notePath), { kind: 'file', path: fs.realpathSync(path.join(root, cover)) });
  await assert.rejects(connector.attachment(sourcePath), error => error.code === 'PATH_FORBIDDEN');
});
test('image path selection keeps direct image sources and reports missing covers without exposing JSON', async t => {
  const notePath = '01_sources/cards/images/direct-image.md';
  const sourcePath = '01_sources/_originals/images/source.jpg';
  const { connector, contents } = harness(t, { [notePath]: `---\noriginal_file: ${sourcePath}\ncover: 01_sources/_originals/data/source.json\n---\n` });
  await connector.start(); assert.equal((await connector.readNote(notePath)).attachmentPath, sourcePath);
  const missing = '01_sources/cards/images/missing.png';
  contents.set(notePath, `---\noriginal_file: 01_sources/_originals/data/source.json\ncover: ${missing}\n---\n`);
  assert.equal((await connector.readNote(notePath)).attachmentPath, missing);
  await assert.rejects(connector.attachment(missing), error => error.code === 'ATTACHMENT_MISSING');
  await assert.rejects(connector.original(notePath), error => error.code === 'ORIGINAL_MISSING');
});
test('path validation rejects traversal, configuration and absolute file reads', () => {
  for (const value of ['../outside', '/Users/x', '01_sources/../.obsidian', '01_sources//a', '01_sources\\a', '.obsidian/data.json']) assert.throws(() => assertNotePath(value));
  assert.equal(safeRelative(a), a);
});
test('snapshot recognizes dispersed inspirations and surfaces malformed notes instead of empty success', async t => {
  const { connector, contents, files, plugin } = harness(t);
  const bad = '01_sources/cards/text/bad.md'; contents.set(bad, '---\ntags: [broken\n---\nx'); files.set(bad, { path: bad, extension: 'md', basename: 'bad' });
  await connector.start(); const result = await connector.snapshot();
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].path, a); assert.equal(result.materials.length, 1);
  assert.equal(result.errors[0].code, 'INVALID_METADATA'); assert.deepEqual(plugin.data.unrelated, { keep: 1 });
  assert.equal(JSON.stringify(result).includes('resourceUrl'), false);
});
test('wrong vault id and concurrent process callback change refuse writes and preserve current body', async t => {
  const { connector, contents, vault } = harness(t); await connector.start();
  await assert.rejects(connector.mutate({ ...fieldsInput(source, { caption: 'x' }), path: a, vaultId: 'wrong' }), error => error.code === 'WRONG_VAULT');
  vault.beforeProcess = file => contents.set(file.path, contents.get(file.path) + '原生修改');
  await assert.rejects(connector.mutate({ ...fieldsInput(source, { caption: 'x' }), path: a, vaultId: connector.identity.id }), error => error.code === 'CONFLICT');
  assert.match(contents.get(a), /原生修改$/);
});
test('related is read only and confirmation/retry/revoke keep both ends consistent', async t => {
  const { connector, plugin, contents } = harness(t); await plugin.starSea.loadData(); await connector.start();
  const before = JSON.stringify(plugin.data); const related = await connector.related(a); assert.equal(JSON.stringify(plugin.data), before); assert.ok(related.candidates.length);
  const input = { vaultId: connector.identity.id, sourcePath: a, targetPath: b, sourceHash: hash(contents.get(a)), targetHash: hash(contents.get(b)), operationId: 'relation-operation-001', action: 'confirm', explanation: '共同月亮主题' };
  const result = await connector.relation(input); const once = contents.get(a); await connector.relation(input); assert.equal(contents.get(a), once);
  assert.equal(parseManagedRelations(contents.get(a)).relations.length, 1); assert.equal(parseManagedRelations(contents.get(b)).relations.length, 1);
  await connector.relation({ ...input, relationId: result.relationId, sourceHash: hash(contents.get(a)), targetHash: hash(contents.get(b)), operationId: 'relation-operation-002', action: 'revoke' });
  assert.equal(parseManagedRelations(contents.get(a)).relations.length, 0); assert.equal(parseManagedRelations(contents.get(b)).relations.length, 0);
});
test('native edit between relation preflight and Vault.process aborts without overwriting', async t => {
  const { connector, plugin, contents, vault } = harness(t); await plugin.starSea.loadData(); await connector.start();
  const input = { vaultId: connector.identity.id, sourcePath: a, targetPath: b, sourceHash: hash(contents.get(a)), targetHash: hash(contents.get(b)), operationId: 'relation-race-001', action: 'confirm', explanation: '月亮主题' };
  let changed = false; vault.beforeProcess = file => { if (file.path === b && !changed) { changed = true; contents.set(b, contents.get(b) + '\n原生编辑'); } };
  await assert.rejects(connector.relation(input), error => error.code === 'CONFLICT');
  assert.equal(parseManagedRelations(contents.get(a)).relations.length, 0); assert.match(contents.get(b), /原生编辑$/);
  assert.equal(plugin.starSea.getPendingTransaction(), null);
});
test('routes require REST authentication handle, reject nonlocal caller and dispose events', async t => {
  const { connector, plugin } = harness(t); const registered = {}; let unregistered = 0;
  plugin.app.plugins.plugins['obsidian-local-rest-api'] = { getPublicApi: () => ({ addRoute: path => ({ get: handler => registered[path] = handler, post: handler => registered[path] = handler }), unregister: () => unregistered++ }) };
  await connector.start(); assert.ok(registered['/mengcang/v1/identity']);
  const response = { headersSent: false, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await registered['/mengcang/v1/identity']({ socket: { remoteAddress: '192.168.1.1' } }, response);
  assert.equal(response.statusCode, 403); assert.equal(response.body.error.code, 'LOCAL_ONLY'); connector.dispose(); assert.equal(unregistered, 1);
});
test('relation recovery after response-journal failure recognizes existing two-end commit', async t => {
  const { connector, plugin, contents } = harness(t); await plugin.starSea.loadData(); await connector.start();
  const input = { vaultId: connector.identity.id, sourcePath: a, targetPath: b, sourceHash: hash(contents.get(a)), targetHash: hash(contents.get(b)), operationId: 'relation-crash-001', action: 'confirm', explanation: '月亮主题' };
  const update = plugin.updateMengcangData; let failOnce = true;
  plugin.updateMengcangData = async callback => {
    const next = callback(structuredClone(plugin.data));
    if (failOnce && next.desktopConnector?.operations?.[input.operationId]?.status === 'complete') { failOnce = false; throw new Error('simulated response-journal failure'); }
    plugin.data = next;
  };
  await assert.rejects(connector.relation(input), /response-journal failure/); const committed = contents.get(a);
  plugin.updateMengcangData = update; const result = await connector.relation(input);
  assert.equal(result.replayed, true); assert.equal(contents.get(a), committed);
  assert.equal(plugin.data.desktopConnector.operations[input.operationId].status, 'complete');
});
test('relation compensation does not erase concurrent changes to the relation itself', async t => {
  const { connector, plugin, contents, vault } = harness(t); await plugin.starSea.loadData(); await connector.start();
  const { upsertManagedRelation } = require('../star-sea/core');
  const input = { vaultId: connector.identity.id, sourcePath: a, targetPath: b, sourceHash: hash(contents.get(a)), targetHash: hash(contents.get(b)), operationId: 'relation-rollback-race-001', action: 'confirm', explanation: '月亮主题' };
  let changed = false; vault.beforeProcess = file => {
    if (file.path === b && !changed) {
      changed = true;
      const relation = parseManagedRelations(contents.get(a)).relations[0];
      contents.set(a, upsertManagedRelation(contents.get(a), { ...relation, summary: '用户已重新说明此关系' }, a));
      throw new Error('second-side unavailable');
    }
  };
  await assert.rejects(connector.relation(input), error => error.repairNeeded === true);
  assert.match(contents.get(a), /用户已重新说明此关系/); assert.equal(plugin.starSea.getPendingTransaction().status, 'repair_needed');
});
test('wrong physical Vault remains unpaired and cannot persist an identity or mutate notes', async t => {
  const { connector, plugin, contents } = harness(t); connector.expectedVaultPath = `${connector.expectedVaultPath}-different`;
  const initialData = JSON.stringify(plugin.data); await connector.start();
  assert.match(connector.identity.id, /^unpaired-/); assert.equal(JSON.stringify(plugin.data), initialData);
  await assert.rejects(connector.mutate({ ...fieldsInput(source, { caption: 'x' }), path: a, vaultId: connector.identity.id }), error => error.code === 'WRONG_VAULT');
  assert.equal(contents.get(a), source);
});
test('imported pending candidates are preserved independently of ranking and vanish after confirmation', async t => {
  const { connector, plugin, contents } = harness(t); contents.set(a, setYamlFields(source, { relation_candidates: [{ id: 'old-candidate', target_path: b, reason: '旧预览待核对', status: 'pending', origin: 'preview' }] }));
  await plugin.starSea.loadData(); await connector.start();
  const related = await connector.related(a); assert.equal(related.candidates[0].id, 'old-candidate'); assert.equal(related.candidates[0].explanation, '旧预览待核对');
  await connector.relation({ vaultId: connector.identity.id, sourcePath: a, targetPath: b, sourceHash: hash(contents.get(a)), targetHash: hash(contents.get(b)), operationId: 'relation-imported-001', action: 'confirm', explanation: '现在确认' });
  const confirmed = await connector.related(a); assert.equal(confirmed.confirmed.length, 1); assert.equal(confirmed.candidates.some(item => item.targetPath === b), false);
});

test('clearing an explicit caption remains empty after saving and reading; a missing caption falls back to summary',async t=>{
 const {connector,contents}=harness(t);const initial=setYamlFields(source,{summary:'保留摘要',caption:'原配文'});contents.set(a,initial);await connector.start();
 await connector.mutate({...fieldsInput(initial,{caption:''},'caption-empty-001'),path:a,vaultId:connector.identity.id});
 const saved=await connector.readNote(a);assert.equal(saved.fields.caption,'');assert.equal(saved.fields.summary,'保留摘要');assert.equal(saved.description,'');
 const withoutCaption='---\ntype: material\nsummary: 保留摘要\n---\n正文';contents.set(b,withoutCaption);
 assert.equal((await connector.readNote(b)).description,'保留摘要');
});
