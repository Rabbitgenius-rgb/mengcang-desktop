'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {draftName, jsonValue, atomicPrivate, createPrivateWriteQueue, fail} = require('../desktop/security.cjs');

// Exercise the registered production handlers without loading Electron, pairing,
// or a Vault. Every disk write is confined to this generated temporary fixture.
function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-discovery-ipc-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const handlers = new Map(), queue = createPrivateWriteQueue();
  let identity = {id:'synthetic-vault-A'},writable=true;
  require('../desktop/discovery-state.cjs').registerDiscoveryState({userData:root,writes:queue,
    gateway:{get identity(){return identity;}},handle:(name,callback)=>handlers.set(name,callback),
    save:async(file,contents)=>{if(!writable)throw Object.assign(new Error('Synthetic disk full'),{code:'ENOSPC'});return atomicPrivate(file,contents);},
  });
  return {root, queue, get: handlers.get('discoveryStateGet'), set: handlers.get('discoveryStateSet'),
    file: id => path.join(root, 'discovery', draftName(id)),
    switchIdentity: value => {identity = value ? {id: value} : null;},
    setWritable: value => {writable = value;},
  };
}
const state = number => ({schema: 1, collections: [{id: `collection-${number}`, title: `Synthetic ${number}`, itemPaths: []}], boards: []});

test('discovery IPC rejects unpaired, missing and changed identities before touching storage', async t => {
  const f = harness(t);
  assert.throws(() => f.get(), error => error.code === 'VAULT_MISMATCH');
  assert.throws(() => f.set(state(1), 'synthetic-vault-B'), error => error.code === 'VAULT_MISMATCH');
  assert.equal(fs.existsSync(path.join(f.root, 'discovery')), false);
  f.switchIdentity(null);
  assert.throws(() => f.set(state(1), 'synthetic-vault-A'));
  assert.equal(fs.existsSync(path.join(f.root, 'discovery')), false);
});

test('queued states restore the last submitted state; an identity switch never moves an old save into the new identity', async t => {
  const f = harness(t), oldId = 'synthetic-vault-A', newId = 'synthetic-vault-B';
  let release; const blocker = new Promise(resolve => {release = resolve;});
  const block = f.queue.run(f.file(oldId), () => blocker);
  const operations = Array.from({length: 15}, (_, number) => f.set(state(number), oldId));
  f.switchIdentity(newId);
  assert.throws(() => f.set(state(99), oldId), error => error.code === 'VAULT_MISMATCH');
  assert.equal(fs.existsSync(f.file(newId)), false);
  release(); await Promise.all([block, ...operations]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file(oldId), 'utf8')), state(14));
  assert.equal(fs.existsSync(f.file(newId)), false);
  assert.equal(fs.statSync(f.file(oldId)).mode & 0o777, 0o600);
  await f.set(state(20), newId);
  assert.deepEqual(await f.get(newId), state(20));
  f.switchIdentity(oldId);
  assert.deepEqual(await f.get(oldId), state(14));
});

test('failed latest discovery state blocks quit after reads and retries only its original identity', async t => {
  const f = harness(t), oldId = 'synthetic-vault-A', newId = 'synthetic-vault-B';
  await f.set(state(1), oldId);
  f.setWritable(false);
  await assert.rejects(f.set(state(2), oldId), {code: 'ENOSPC'});
  assert.equal(f.queue.failed, 1);
  assert.deepEqual(await f.get(oldId), state(1));
  assert.equal(f.queue.failed, 1);
  f.switchIdentity(newId); f.setWritable(true);
  await f.queue.retryFailures();
  assert.equal(f.queue.failed, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file(oldId), 'utf8')), state(2));
  assert.equal(fs.existsSync(f.file(newId)), false);
});

test('preload forwards expected identity separately from discovery data without exposing ipcRenderer', async () => {
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), {
    require: id => {assert.equal(id, 'electron'); return {contextBridge: {exposeInMainWorld: (name, value) => {assert.equal(name, 'mengcang'); api = value;}}, ipcRenderer: {invoke: async (...args) => {calls.push(args); return {ok: true};}}};},
  });
  await api.discoveryStateGet('synthetic-vault-A');
  const value = state(3); await api.discoveryStateSet(value, 'synthetic-vault-A');
  assert.deepEqual(calls, [['mengcang:discoveryStateGet', 'synthetic-vault-A'], ['mengcang:discoveryStateSet', value, 'synthetic-vault-A']]);
  assert.equal(api.ipcRenderer, undefined);
  assert.equal(Object.isFrozen(api), true);
});
