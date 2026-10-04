'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DesktopConnector } = require('../src/desktop-connector');
const { hash, frontmatterOf, setYamlFields, splitNote } = require('../src/desktop-connector/notes');
const { SCHEDULE_ROOT, schedulePath, validateScheduleInput, toSchedule, createSchedule, updateSchedule } = require('../src/desktop-connector/schedule');

const SOURCE = '01_sources/cards/text/source.md';
const BOOK = '01_sources/books/book.md';
const PROJECT = 'real-project-id';
const now = '2026-09-29T00:00:00.000Z';
const fields = extra => ({ title: '整理今天的想法', notes: '只记录自己确认的安排。', plannedStart: null, plannedEnd: null, timeZone: 'Asia/Shanghai', projectId: '', sourcePath: '', status: 'todo', ...extra });
const input = extra => ({ action: 'create', id: randomUUID(), operationId: randomUUID(), fields: fields(), ...extra });
const code = expected => error => error?.code === expected;

async function harness(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-schedule-test-')));
  const files = new Map(), listeners = new Map(), routes = new Map(), opened = [], calls = { create: 0, process: 0, folder: 0 };
  let data = {}, counter = 0;
  const registry = { projects: [{ id: PROJECT, name: '同名项目', vault_brief: '03_projects/one.md', goal: '' }, { id: 'different-id', name: '同名项目', vault_brief: '03_projects/two.md' }] };
  const disk = relative => path.join(root, relative);
  const write = (relative, markdown, indexed = true) => {
    fs.mkdirSync(path.dirname(disk(relative)), { recursive: true }); fs.writeFileSync(disk(relative), markdown);
    const file = { path: relative, extension: 'md', basename: path.basename(relative, '.md') };
    if (indexed) files.set(relative, file); return file;
  };
  write(SOURCE, '---\ntype: material\nrecord_type: inspiration\ntitle: 来源\n---\n原来的正文。\n');
  write(BOOK, '---\ntype: book\ntitle: 书籍\n---\n书籍原文。\n');
  const vault = {
    adapter: { getBasePath: () => root, read: async relative => {
      if (relative === '_meta/projects.json') return JSON.stringify(registry);
      return fs.promises.readFile(disk(relative), 'utf8');
    } },
    getName: () => 'Synthetic Schedule Vault', getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: relative => files.get(relative),
    read: async file => { await vault.beforeRead?.(file); return fs.promises.readFile(disk(file.path), 'utf8'); },
    createFolder: async relative => { calls.folder++; await fs.promises.mkdir(disk(relative)); },
    create: async (relative, markdown) => {
      calls.create++; await vault.beforeCreate?.(relative);
      await fs.promises.writeFile(disk(relative), markdown, { flag: 'wx' });
      const file = { path: relative, extension: 'md', basename: path.basename(relative, '.md') }; files.set(relative, file);
      await vault.afterCreate?.(file); return file;
    },
    process: async (file, callback) => {
      calls.process++; await vault.beforeProcess?.(file);
      const current = await fs.promises.readFile(disk(file.path), 'utf8');
      const next = callback(current); await fs.promises.writeFile(disk(file.path), next);
      await vault.afterProcess?.(file); return next;
    },
    on: (event, callback) => { const id = ++counter; listeners.set(id, { event, callback }); return id; }, offref: id => listeners.delete(id),
  };
  const plugin = {
    manifest: { id: 'mengcang-dashboard', version: '0.6.0' },
    app: { vault, metadataCache: {}, workspace: { getLeaf: () => ({ openFile: async file => { opened.push(file.path); } }) }, plugins: { plugins: {
      'obsidian-local-rest-api': { getPublicApi: () => ({ addRoute: route => ({ get: callback => routes.set(`get ${route}`, callback), post: callback => routes.set(`post ${route}`, callback) }), unregister() {} }) },
    } } },
    loadData: async () => data, updateMengcangData: async callback => { data = callback(data); }, starSea: { getPendingTransaction: () => null },
  };
  const connector = new DesktopConnector(plugin, { testVaultPath: root, appVersion: '1.13.7' });
  t.after(() => { connector.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  await connector.start();
  const save = async value => connector.scheduleSave({ ...value, vaultId: connector.identity.id });
  const read = relative => fs.readFileSync(disk(relative), 'utf8');
  return { root, disk, read, write, files, registry, vault, connector, save, calls, routes, opened, listeners };
}

test('schedule validates exact fields, actual dates, paired UTC bounds, duration and time zone', () => {
  const base = input();
  const accepted = validateScheduleInput({ ...base, fields: fields({ plannedStart: '2026-09-29T00:00:00Z', plannedEnd: '2026-09-30T00:00:00Z' }) });
  assert.equal(accepted.fields.plannedStart, now);
  for (const patch of [
    { title: ' ' }, { notes: '<!-- mengcang:schedule-notes:end -->' }, { notes: 'x'.repeat(50001) }, { status: 'overdue' },
    { plannedStart: now }, { plannedEnd: now }, { plannedStart: now, plannedEnd: now },
    { plannedStart: now, plannedEnd: '2026-09-30T00:00:00.001Z' },
    { plannedStart: '2026-02-30T00:00:00Z', plannedEnd: '2026-03-02T01:00:00Z' },
    { plannedStart: '2026-09-29T08:00:00+08:00', plannedEnd: '2026-09-29T09:00:00+08:00' },
    { plannedStart: now, plannedEnd: '2026-09-28T00:00:00Z' }, { timeZone: 'Moon/Fake' }, { timeZone: '+08:00' },
    { projectId: null }, { sourcePath: [] }, { extra: 'not allowed' },
  ]) assert.throws(() => validateScheduleInput({ ...base, fields: fields(patch) }));
  assert.throws(() => validateScheduleInput({ ...base, id: '../other' }));
  assert.throws(() => validateScheduleInput({ ...base, operationId: 'short' }), code('INVALID_OPERATION'));
  assert.throws(() => validateScheduleInput({ ...base, action: 'update' }), code('INVALID_VERSION'));
  const incomplete = fields(); delete incomplete.plannedEnd;
  assert.throws(() => validateScheduleInput({ ...base, fields: incomplete }));
});

test('managed notes round trip multiline Markdown and preserve unrelated body and unknown YAML', () => {
  const create = validateScheduleInput(input({ fields: fields({ notes: '\nLine one\n\n- List item\n' }) }));
  const first = createSchedule(create, now);
  assert.equal(toSchedule(create.path, first).notes, create.fields.notes);
  const outside = '\n## Obsidian additions\n\nDo not change **this**.\n';
  const original = setYamlFields(first, { unknown: { nested: ['keep'] } }).replace('unknown:', '# User metadata comment\nunknown:') + outside;
  const update = validateScheduleInput({ ...create, action: 'update', expectedHash: hash(original), operationId: randomUUID(), fields: fields({ notes: '', status: 'done' }) });
  const changed = updateSchedule(original, update, '2026-09-29T00:01:00.000Z');
  assert.deepEqual(frontmatterOf(changed).unknown, { nested: ['keep'] });
  assert.match(changed, /# User metadata comment/); assert.ok(changed.includes(outside));
  assert.equal(toSchedule(create.path, changed).notes, '');
  assert.equal(toSchedule(create.path, changed).status, 'done');
  assert.equal(toSchedule(create.path, changed).createdAt, now);
  assert.equal(updateSchedule(changed, update), changed);
  assert.throws(() => updateSchedule(changed, { ...update, fields: fields({ notes: 'different' }) }), code('OPERATION_REUSED'));
  const crlf = original.replace(/\n/g, '\r\n');
  const crlfResult = updateSchedule(crlf, { ...update, expectedHash: hash(crlf) });
  assert.ok(splitNote(crlfResult).body.includes(outside.replace(/\n/g, '\r\n')));
});

test('malformed metadata, mismatched IDs and duplicate managed blocks fail closed', () => {
  const value = validateScheduleInput(input()), markdown = createSchedule(value, now);
  for (const broken of [
    markdown.replace('schema_version: 1', 'schema_version: 2'),
    markdown.replace(value.id, randomUUID()),
    markdown.replace('<!-- mengcang:schedule-notes:end -->', ''),
    markdown + '\n<!-- mengcang:schedule-notes:start -->\nextra\n<!-- mengcang:schedule-notes:end -->\n',
  ]) assert.throws(() => toSchedule(value.path, broken));
});

test('snapshot advertises capability without creating directories; create/read/open link real IDs only', async t => {
  const f = await harness(t), beforeSource = f.read(SOURCE), beforeBook = f.read(BOOK), beforeRegistry = JSON.stringify(f.registry);
  const initial = await f.connector.snapshot();
  assert.deepEqual(initial.capabilities, { schedule: true, scheduleSchemaVersion: 2, workOverview: true, capture: true, captureAttachment: true }); assert.deepEqual(initial.schedules, []);
  assert.equal(fs.existsSync(f.disk(SCHEDULE_ROOT)), false); assert.equal(f.calls.folder, 0);
  const request = input({ fields: fields({ projectId: PROJECT, sourcePath: SOURCE }) });
  const saved = await f.save(request);
  assert.equal(saved.operationId, request.operationId); assert.equal(saved.item.path, schedulePath(request.id));
  assert.equal(saved.item.kind, 'schedule'); assert.equal(saved.item.projectId, PROJECT); assert.equal(saved.item.sourcePath, SOURCE);
  assert.deepEqual(await f.connector.readNote(saved.item.path), saved.item);
  assert.deepEqual((await f.connector.snapshot()).schedules, [saved.item]);
  const response = { headersSent: false, set() { return this; }, json(value) { this.value = value; return this; }, status(value) { this.statusCode = value; return this; } };
  await f.routes.get('post /mengcang/v1/open')({ socket: { remoteAddress: '127.0.0.1' }, body: { vaultId: f.connector.identity.id, path: saved.item.path } }, response);
  assert.deepEqual(f.opened, [saved.item.path]); assert.equal(response.value.opened, true);
  assert.equal(f.read(SOURCE), beforeSource); assert.equal(f.read(BOOK), beforeBook); assert.equal(JSON.stringify(f.registry), beforeRegistry);
});

test('create is idempotent across retry, response loss and concurrent submits', async t => {
  const f = await harness(t), request = input();
  let failOnce = true;
  f.vault.afterCreate = () => { if (failOnce) { failOnce = false; throw Error('response lost after commit'); } };
  await assert.rejects(f.save(request), /response lost/);
  const committed = f.read(schedulePath(request.id));
  const [a, b] = await Promise.all([f.save(request), f.save(request)]);
  assert.deepEqual(a, b); assert.equal(f.read(a.item.path), committed); assert.equal(f.calls.create, 1);
  await assert.rejects(f.save({ ...request, fields: fields({ title: 'another title' }) }), code('OPERATION_REUSED'));
  await assert.rejects(f.save({ ...request, operationId: randomUUID() }), code('SCHEDULE_PATH_OCCUPIED'));
});

test('update, archive and restore use explicit status without changing source or project', async t => {
  const f = await harness(t), request = input({ fields: fields({ sourcePath: BOOK, projectId: PROJECT }) });
  let { item } = await f.save(request);
  const beforeSource = f.read(BOOK), beforeRegistry = JSON.stringify(f.registry);
  for (const status of ['done', 'archived', 'todo']) {
    const update = { ...request, action: 'update', expectedHash: item.hash, operationId: randomUUID(), fields: { ...request.fields, status, plannedStart: '2026-09-28T16:30:00Z', plannedEnd: '2026-09-28T17:00:00Z' } };
    const result = await f.save(update); item = result.item;
    assert.equal(item.status, status); assert.equal(item.timeZone, 'Asia/Shanghai');
    assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: item.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.plannedStart)), '2026-09-29');
    const bytes = f.read(item.path); assert.deepEqual(await f.save(update), result); assert.equal(f.read(item.path), bytes);
  }
  assert.equal(f.read(BOOK), beforeSource); assert.equal(JSON.stringify(f.registry), beforeRegistry);
  assert.equal(fs.existsSync(f.disk(item.path)), true); assert.equal((await f.connector.snapshot()).schedules[0].status, 'todo');
  await assert.rejects(f.connector.mutate({ path: item.path, vaultId: f.connector.identity.id, kind: 'fields', fields: { caption: 'no' }, expectedHash: item.hash, operationId: randomUUID() }), code('READ_ONLY_RECORD'));
  await assert.rejects(f.connector.related(item.path), code('UNSUPPORTED_RELATION'));
  await assert.rejects(f.connector.relation({ vaultId: f.connector.identity.id, sourcePath: item.path, targetPath: BOOK }), code('UNSUPPORTED_RELATION'));
});

test('stale hash and an Obsidian edit immediately before process never overwrite native edits', async t => {
  const f = await harness(t), request = input(), { item } = await f.save(request);
  const update = { ...request, action: 'update', expectedHash: item.hash, operationId: randomUUID(), fields: fields({ title: 'changed' }) };
  fs.appendFileSync(f.disk(item.path), '\nNative edit before request.\n');
  const current = f.read(item.path);
  await assert.rejects(f.save(update), code('CONFLICT')); assert.equal(f.read(item.path), current);
  f.vault.beforeProcess = file => { fs.appendFileSync(f.disk(file.path), '\nNative edit inside process boundary.\n'); };
  await assert.rejects(f.save({ ...update, expectedHash: hash(current) }), code('CONFLICT'));
  assert.equal(f.read(item.path), current + '\nNative edit inside process boundary.\n');
});

test('response loss after update commit retries once without undoing a later native edit', async t => {
  const f = await harness(t), request = input(), { item } = await f.save(request);
  const update = { ...request, action: 'update', expectedHash: item.hash, operationId: randomUUID(), fields: fields({ notes: 'confirmed user notes' }) };
  f.vault.afterProcess = () => { throw Error('response lost after update'); };
  await assert.rejects(f.save(update), /response lost/);
  fs.appendFileSync(f.disk(item.path), '\nAdditional native content.\n'); const committed = f.read(item.path);
  const retried = await f.save(update);
  assert.equal(retried.item.notes, 'confirmed user notes'); assert.equal(f.read(item.path), committed); assert.equal(f.calls.process, 1);
});

test('invalid project, same-name lookup, duplicate IDs, invalid or missing sources create nothing', async t => {
  const f = await harness(t);
  f.write('01_sources/cards/text/not-material.md', '---\ntype: private\n---\nnot a material');
  const rejected = [
    fields({ projectId: '同名项目' }), fields({ projectId: 'missing-project' }),
    fields({ sourcePath: '01_sources/cards/text/missing.md' }), fields({ sourcePath: '03_projects/one.md' }),
    fields({ sourcePath: '../../outside.md' }), fields({ sourcePath: '.obsidian/data.json' }), fields({ sourcePath: '01_sources/cards/text/not-material.md' }),
  ];
  for (const value of rejected) await assert.rejects(f.save(input({ fields: value })));
  f.registry.projects.push({ id: PROJECT, name: 'duplicate id' });
  await assert.rejects(f.save(input({ fields: fields({ projectId: PROJECT }) })), code('INVALID_SCHEDULE_PROJECT'));
  assert.equal(f.calls.create, 0); assert.equal(f.calls.folder, 0); assert.equal(fs.existsSync(f.disk(SCHEDULE_ROOT)), false);
});

test('wrong Vault, traversal and missing update fail before any create or folder mutation', async t => {
  const f = await harness(t), request = input();
  await assert.rejects(f.connector.scheduleSave({ ...request, vaultId: 'wrong' }), code('WRONG_VAULT'));
  await assert.rejects(f.save({ ...request, id: '../escape' }));
  await assert.rejects(f.save({ ...request, action: 'update', expectedHash: 'a'.repeat(64) }), code('NOT_FOUND'));
  assert.equal(f.calls.create, 0); assert.equal(f.calls.folder, 0);
});

test('both indexed and unindexed collisions preserve existing files', async t => {
  const f = await harness(t);
  for (const indexed of [true, false]) {
    const request = input(), target = schedulePath(request.id), original = '---\ntype: unrelated\n---\nKeep this file.\n';
    f.write(target, original, indexed);
    await assert.rejects(f.save(request), code('SCHEDULE_PATH_OCCUPIED')); assert.equal(f.read(target), original);
  }
  const request = input(); fs.mkdirSync(f.disk(schedulePath(request.id)));
  await assert.rejects(f.save(request), code('SCHEDULE_PATH_OCCUPIED'));
  assert.equal(f.calls.create, 0);
});

test('schedule folder symlinks, including dangling links, cannot escape the Vault', async t => {
  for (const dangling of [false, true]) {
    const f = await harness(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.mkdirSync(f.disk('03_projects')); fs.symlinkSync(dangling ? `${outside}/missing` : outside, f.disk(SCHEDULE_ROOT.slice(0, -1)));
    await assert.rejects(f.save(input()), code('PATH_FORBIDDEN'));
    assert.deepEqual(fs.readdirSync(outside), []); assert.equal(f.calls.create, 0);
  }
});

test('schedule file symlink and parent-file collision fail closed', async t => {
  const f = await harness(t), request = input(), target = schedulePath(request.id);
  fs.mkdirSync(f.disk(SCHEDULE_ROOT), { recursive: true }); fs.symlinkSync(f.disk(SOURCE), f.disk(target));
  f.files.set(target, { path: target, extension: 'md', basename: request.id });
  const before = f.read(SOURCE);
  await assert.rejects(f.save(request), code('PATH_FORBIDDEN'));
  await assert.rejects(f.connector.readNote(target), code('PATH_FORBIDDEN')); assert.equal(f.read(SOURCE), before);
  const other = await harness(t); fs.writeFileSync(other.disk('03_projects'), 'occupied');
  await assert.rejects(other.save(input()), code('SCHEDULE_PATH_OCCUPIED')); assert.equal(other.calls.folder, 0);
});

test('external malformed schedule appears as a read error and never contaminates materials', async t => {
  const f = await harness(t), request = input(), { item } = await f.save(request);
  f.write(item.path, '---\nrecord_type: schedule\ntitle: [broken\n---\n'); f.connector.invalidate();
  const snapshot = await f.connector.snapshot();
  assert.deepEqual(snapshot.schedules, []); assert.ok(snapshot.errors.some(error => error.path === item.path));
  assert.equal(snapshot.materials.some(note => note.path === item.path), false);
});

test('schedule route requires local caller and rename events invalidate the cache', async t => {
  const f = await harness(t), response = { headersSent: false, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  await f.routes.get('post /mengcang/v1/schedule')({ socket: { remoteAddress: '192.0.2.1' }, body: input() }, response);
  assert.equal(response.statusCode, 403); assert.equal(response.body.error.code, 'LOCAL_ONLY'); assert.equal(f.calls.create, 0);
  await f.connector.snapshot(); const revision = f.connector.revision;
  const rename = [...f.listeners.values()].find(listener => listener.event === 'rename').callback;
  rename({ path: '03_projects/renamed' }, SCHEDULE_ROOT.slice(0, -1));
  assert.equal(f.connector.cache, null); assert.ok(f.connector.revision > revision);
});

const workFields = extra => fields({ workState: 'idle', focusDate: null, focusOrder: null, progressNote: '', progressUpdatedAt: null, waitingReason: '', dueAt: null, ...extra });
const workInput = extra => input({ schemaVersion: 2, fields: workFields(), ...extra });

test('v1 reads defaults without rewriting and explicit v2 save preserves unknown content', async t => {
  const f=await harness(t), old=input(), {item}=await f.save(old), bytes=f.read(item.path);
  assert.equal(item.schemaVersion,1);assert.equal(item.workState,'idle');assert.equal(item.dueAt,null);
  await f.connector.snapshot();await f.connector.readNote(item.path);assert.equal(f.read(item.path),bytes);
  const native=setYamlFields(bytes,{custom:{keep:['yes']}})+'\n## Native notes\nKeep this.\n';f.write(item.path,native);
  const update=workInput({action:'update',id:item.id,expectedHash:hash(native),fields:workFields({title:'明确行动',progressNote:'整理了资料',focusDate:'2026-09-30',focusOrder:1024})});
  const upgraded=await f.save(update);assert.equal(upgraded.item.schemaVersion,2);assert.equal(upgraded.item.progressNote,'整理了资料');
  assert.equal(frontmatterOf(f.read(item.path)).schema_version,2);assert.deepEqual(frontmatterOf(f.read(item.path)).custom,{keep:['yes']});assert.match(f.read(item.path),/Keep this/);
  assert.equal((await f.save(update)).item.id,item.id);assert.equal(f.calls.process,1);
});

test('work fields require strict schema, reason, real calendar date, finite paired order and UTC deadline', () => {
  for(const patch of [{workState:'ai-running'},{workState:'waiting',waitingReason:' '},{focusDate:'2026-02-30',focusOrder:1},{focusDate:'2026-09-30'},{focusOrder:Infinity},{dueAt:'2026-09-30T09:00+08:00'},{progressNote:12},{waitingReason:'x'.repeat(10001)},{extra:'no'}])assert.throws(()=>validateScheduleInput(workInput({fields:workFields(patch)})));
  assert.throws(()=>validateScheduleInput(input({fields:workFields()})));
  assert.throws(()=>validateScheduleInput(workInput({schemaVersion:3})));
  const valid=validateScheduleInput(workInput({fields:workFields({workState:'waiting',waitingReason:'请选择封面',focusDate:'2026-09-30',focusOrder:-1024,dueAt:now})}));
  assert.equal(valid.fields.focusOrder,-1024);
});

test('progress time only changes with manual progress, deadline never replaces planned bounds', () => {
  const initial=validateScheduleInput(workInput({fields:workFields({progressNote:'已读完',progressUpdatedAt:'2020-01-01T00:00:00Z',dueAt:'2026-10-02T12:00:00Z',plannedStart:now,plannedEnd:'2026-09-29T01:00:00Z'})}));
  const first=createSchedule(initial,now), item=toSchedule(initial.path,first);assert.equal(item.progressUpdatedAt,now);
  const update=validateScheduleInput({...initial,action:'update',operationId:randomUUID(),expectedHash:item.hash,fields:{...initial.fields,title:'改标题',progressUpdatedAt:'2020-01-01T00:00:00Z'}});
  const next=updateSchedule(first,update,'2026-09-30T01:00:00.000Z'), saved=toSchedule(initial.path,next);
  assert.equal(saved.progressUpdatedAt,now);assert.equal(saved.plannedStart,item.plannedStart);assert.equal(saved.plannedEnd,item.plannedEnd);assert.equal(saved.dueAt,item.dueAt);
  const progress=validateScheduleInput({...update,operationId:randomUUID(),expectedHash:saved.hash,fields:{...update.fields,progressNote:'已完成复核'}});
  assert.equal(toSchedule(initial.path,updateSchedule(next,progress,'2026-09-30T02:00:00.000Z')).progressUpdatedAt,'2026-09-30T02:00:00.000Z');
});

test('done archive and restore clear focus and work state while retaining progress reason and source', async t => {
  const f=await harness(t), request=workInput({fields:workFields({workState:'waiting',waitingReason:'需要选择方案',progressNote:'已有两个方案',focusDate:'2026-09-30',focusOrder:1024,sourcePath:SOURCE,projectId:PROJECT})});
  let {item}=await f.save(request);
  for(const status of ['done','todo','archived','todo']){
    const update={...request,action:'update',expectedHash:item.hash,operationId:randomUUID(),fields:{...request.fields,status}};
    item=(await f.save(update)).item;assert.equal(item.workState,'idle');assert.equal(item.focusDate,null);assert.equal(item.focusOrder,null);assert.equal(item.progressNote,request.fields.progressNote);assert.equal(item.waitingReason,request.fields.waitingReason);assert.equal(item.sourcePath,SOURCE);
  }
  assert.equal(f.calls.create,1);assert.equal((await f.connector.snapshot()).schedules.length,1);
});

test('old DTO updates a v2 note without dropping work fields and still normalizes completion', async t => {
  const f=await harness(t), {item}=await f.save(workInput({fields:workFields({workState:'doing',progressNote:'已开始',focusDate:'2026-09-30',focusOrder:1024,dueAt:now})}));
  const legacy=input({action:'update',id:item.id,expectedHash:item.hash,fields:fields({title:'旧界面改标题'})});
  const saved=(await f.save(legacy)).item;assert.equal(saved.schemaVersion,2);assert.equal(saved.workState,'doing');assert.equal(saved.focusDate,item.focusDate);assert.equal(saved.progressUpdatedAt,item.progressUpdatedAt);assert.equal(saved.dueAt,item.dueAt);
  const done=(await f.save({...legacy,expectedHash:saved.hash,operationId:randomUUID(),fields:fields({status:'done'})})).item;
  assert.equal(done.focusDate,null);assert.equal(done.workState,'idle');assert.equal(done.progressNote,'已开始');
});

test('missing references remain editable when unchanged and are never silently removed', async t => {
  const f=await harness(t), {item}=await f.save(workInput({fields:workFields({sourcePath:SOURCE,projectId:PROJECT})}));
  f.files.delete(SOURCE);fs.unlinkSync(f.disk(SOURCE));f.registry.projects=[];
  const saved=await f.save(workInput({action:'update',id:item.id,expectedHash:item.hash,fields:workFields({title:'仍能更新进展',progressNote:'需要补回来源',sourcePath:SOURCE,projectId:PROJECT})}));
  assert.equal(saved.item.sourcePath,SOURCE);assert.equal(saved.item.projectId,PROJECT);
  await assert.rejects(f.save(workInput({action:'update',id:item.id,expectedHash:saved.item.hash,fields:workFields({sourcePath:SOURCE,projectId:'other-missing'})})),code('INVALID_SCHEDULE_PROJECT'));
});

test('v2 retry after commit loss preserves concurrent native changes and never duplicates a UUID', async t => {
  const f=await harness(t), {item}=await f.save(workInput()), update=workInput({action:'update',id:item.id,expectedHash:item.hash,fields:workFields({workState:'waiting',waitingReason:'补充资料',focusDate:'2026-09-30',focusOrder:2048})});
  f.vault.afterProcess=()=>{throw Error('lost work response');};await assert.rejects(f.save(update),/lost work/);
  fs.appendFileSync(f.disk(item.path),'\nNative follow-up\n');const bytes=f.read(item.path);
  const replay=await f.save(update);assert.equal(replay.item.workState,'waiting');assert.equal(f.read(item.path),bytes);assert.equal(f.calls.process,1);
  await assert.rejects(f.save({...update,fields:workFields({title:'reuse'})}),code('OPERATION_REUSED'));
  const stale={...update,operationId:randomUUID()};await assert.rejects(f.save(stale),code('CONFLICT'));assert.equal(f.read(item.path),bytes);
});
