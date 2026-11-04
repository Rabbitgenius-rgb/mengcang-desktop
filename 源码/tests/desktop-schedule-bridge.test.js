'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { VaultGateway, GatewayError } = require('../desktop/gateway.cjs');
const { trustedFrame, jsonValue } = require('../desktop/security.cjs');
const schedulePath = id => `03_projects/_schedule/${id}.md`;

function request() {
  return { action: 'create', id: randomUUID(), operationId: randomUUID(), fields: { title: '安排', notes: '', plannedStart: null, plannedEnd: null, timeZone: 'Asia/Shanghai', projectId: '', sourcePath: '', status: 'todo' } };
}
function harness(t, { legacy = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-gateway-test-')));
  const identity = { id: 'mc-vault-schedule-test', path: root, name: path.basename(root), appVersion: '1.13.7', pluginVersion: '0.6.0', protocolVersion: 1 };
  const input = request(), item = { id: input.id, path: schedulePath(input.id), hash: 'a'.repeat(64), kind: 'schedule', ...input.fields, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z' };
  const snapshot = { identity, entries: [], materials: [], books: [], projects: [], errors: [], ...(legacy ? {} : { schedules: [item], capabilities: { schedule: true } }) };
  const gateway = new VaultGateway({ expectedVaultPath: root, cachePath: path.join(root, 'cache.json') });
  gateway._identity = identity; gateway._credentials = { vaultId: identity.id }; gateway._state.connected = true;
  const calls = []; let handler;
  gateway._request = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    if (handler) return handler(method, endpoint, body);
    if (endpoint === '/snapshot') return structuredClone(snapshot);
    if (endpoint === '/schedule') return { item: { ...item, ...body.fields }, operationId: body.operationId };
    if (endpoint.startsWith('/note?')) return item;
    if (endpoint === '/open') return { opened: true };
    throw new Error('unexpected route');
  };
  t.after(() => { gateway.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  return { gateway, identity, input, item, snapshot, calls, setHandler: value => { handler = value; } };
}

test('gateway refuses schedule writes until a supported snapshot has been loaded', async t => {
  const f = harness(t); await assert.rejects(f.gateway.scheduleSave(f.input), error => error.code === 'SCHEDULE_UNAVAILABLE');
  await f.gateway.snapshot(); const result = await f.gateway.scheduleSave({ ...f.input, vaultId: 'spoof', path: '../../outside.md' });
  const sent = f.calls.find(call => call.endpoint === '/schedule');
  assert.equal(sent.method, 'POST'); assert.equal(sent.body.vaultId, f.identity.id); assert.equal(sent.body.path, undefined);
  assert.equal(result.operationId, f.input.operationId); assert.equal(result.item.id, f.input.id);
  assert.equal((await f.gateway.readNote(f.item.path)).kind, 'schedule');
  assert.deepEqual(await f.gateway.openNote(f.item.path), { opened: true });
});

test('legacy snapshots remain readable and never pretend to support empty schedules', async t => {
  const f = harness(t, { legacy: true }), snapshot = await f.gateway.snapshot();
  assert.equal(snapshot.capabilities, undefined); assert.equal(snapshot.schedules, undefined);
  await assert.rejects(f.gateway.scheduleSave(f.input), error => error.code === 'SCHEDULE_UNAVAILABLE');
  assert.equal(f.calls.filter(call => call.endpoint === '/schedule').length, 0);
});

test('capability without schedule array is an invalid response, not an empty schedule list', async t => {
  const f = harness(t); delete f.snapshot.schedules;
  await assert.rejects(f.gateway.snapshot(), error => error.code === 'INVALID_RESPONSE');
  assert.equal(f.gateway.status().connected, false);
});

test('offline cache retains schedule records and prevents writes', async t => {
  const f = harness(t); await f.gateway.snapshot(); f.gateway._state.connected = false;
  assert.equal((await f.gateway.snapshot()).offline, true);
  const cached = await f.gateway.readNote(f.item.path); assert.equal(cached.offline, true); assert.equal(cached.notes, f.item.notes);
  await assert.rejects(f.gateway.scheduleSave(f.input), error => error.code === 'OFFLINE');
  assert.equal(f.calls.filter(call => call.endpoint === '/schedule').length, 0);
});

test('timeout sends only one schedule mutation and preserves the operation identity for retry', async t => {
  const f = harness(t); await f.gateway.snapshot();
  f.setHandler(() => { throw new GatewayError('TIMEOUT', 'synthetic timeout'); });
  await assert.rejects(f.gateway.scheduleSave(f.input), error => error.code === 'TIMEOUT');
  assert.equal(f.calls.filter(call => call.endpoint === '/schedule').length, 1);
  assert.equal(f.calls.at(-1).body.operationId, f.input.operationId); assert.equal(f.gateway.status().connected, false);
});

test('conflict remains a recoverable error without disconnecting or retrying the write', async t => {
  const f = harness(t); await f.gateway.snapshot();
  f.setHandler(() => { throw new GatewayError('CONFLICT', 'synthetic conflict', 409); });
  await assert.rejects(f.gateway.scheduleSave({ ...f.input, action: 'update', expectedHash: f.item.hash }), error => error.code === 'CONFLICT');
  assert.equal(f.calls.filter(call => call.endpoint === '/schedule').length, 1); assert.equal(f.gateway.status().connected, true);
});

test('current standalone preload does not expose retired schedule mutations or generic IPC',async()=>{
 let api;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer:{invoke:async()=>({ok:true})}})});
 assert.equal(api.scheduleSave,undefined);assert.equal(api.invoke,undefined);assert.equal(Object.isFrozen(api),true);assert.equal(typeof api.capture,'function');
});

test('work writes require the explicit v2 capability and never reach an old connector', async t => {
  const f=harness(t);await f.gateway.snapshot();
  const extended={...f.input,schemaVersion:2,fields:{...f.input.fields,workState:'idle',focusDate:null,focusOrder:null,progressNote:'',progressUpdatedAt:null,waitingReason:'',dueAt:null}};
  await assert.rejects(f.gateway.scheduleSave(extended),error=>error.code==='WORK_OVERVIEW_UNAVAILABLE');assert.equal(f.calls.filter(call=>call.endpoint==='/schedule').length,0);
  await assert.rejects(f.gateway.scheduleSave({...extended,schemaVersion:undefined}),error=>error.code==='WORK_OVERVIEW_UNAVAILABLE');
  await f.gateway.scheduleSave(f.input);assert.equal(f.calls.filter(call=>call.endpoint==='/schedule').length,1);
  f.snapshot.capabilities={schedule:true,workOverview:true,scheduleSchemaVersion:2};await f.gateway.snapshot();await f.gateway.scheduleSave(extended);
  assert.equal(f.calls.at(-1).body.schemaVersion,2);assert.deepEqual(f.calls.at(-1).body.fields,extended.fields);
});
