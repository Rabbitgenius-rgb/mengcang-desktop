'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { startPrivateServer, callPrivate, MAX_FRAME } = require('./private-rpc.cjs');

async function setup(t, handlers = { echo: value => value }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recall-rpc-test-'));
  const server = await startPrivateServer({ directory, service: 'test', handlers });
  t.after(async () => { await server.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, server, call: (method, params, rest = {}) => callPrivate({ directory, service: 'test', method, params, ...rest }) };
}
test('authenticated Unicode requests round-trip concurrently and leave private discovery', async t => {
  const { directory, call, server } = await setup(t);
  const payload = { text: '中文 😀\nconst x = `<script>`;\nhttps://example.com' };
  const result = await Promise.all(Array.from({ length: 8 }, () => call('echo', payload)));
  result.forEach(value => assert.deepEqual(value, payload));
  assert.equal((await fs.stat(path.join(directory, 'test.json'))).mode & 0o777, 0o600);
  await server.close();
  await assert.rejects(call('echo', {}), { code: 'SERVICE_UNAVAILABLE' });
});
test('method allowlist rejects inherited names and preserves a domain error', async t => {
  const { call } = await setup(t, { fail: () => { throw Object.assign(new Error('保存冲突'), { code: 'CONFLICT' }); } });
  await assert.rejects(call('constructor', {}), { code: 'METHOD_NOT_FOUND' });
  await assert.rejects(call('fail', {}), { code: 'CONFLICT', message: '保存冲突' });
});
test('a wrong credential cannot call a handler', async t => {
  let calls = 0;
  const { directory } = await setup(t, { save: () => { calls++; return {}; } });
  const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'test.json'), 'utf8'));
  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.socketPath); let output = '';
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ format: endpoint.format, id: 'bad-token', token: '0'.repeat(64), method: 'save', params: {} }) + '\n'));
    socket.on('data', data => output += data);
    socket.on('end', () => resolve(JSON.parse(output)));
  });
  assert.equal(response.error.code, 'UNAUTHORIZED'); assert.equal(calls, 0);
});
test('private directory and endpoint validation rejects exposed permissions and redirection', async t => {
  const { directory, call } = await setup(t);
  const file = path.join(directory, 'test.json');
  await fs.chmod(file, 0o644);
  await assert.rejects(call('echo', {}), { code: 'UNSAFE_ENDPOINT' });
  await fs.chmod(file, 0o600);
  const endpoint = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...endpoint, socketPath: '/tmp/not-the-recall-socket' }));
  await assert.rejects(call('echo', {}), { code: 'UNSAFE_ENDPOINT' });
});
test('a second live owner cannot replace discovery or unlink its socket', async t => {
  const { directory, call } = await setup(t);
  await assert.rejects(startPrivateServer({ directory, service: 'test', handlers: { echo: () => 'other' } }), { code: 'SERVICE_BUSY' });
  assert.equal(await call('echo', 'original'), 'original');
});
test('timeouts do not report a mutation as saved and large frames are refused', async t => {
  const { call } = await setup(t, { slow: () => new Promise(resolve => setTimeout(() => resolve({ saved: true }), 60)), huge: () => 'x'.repeat(MAX_FRAME) });
  await assert.rejects(call('slow', {}, { timeoutMs: 10 }), { code: 'TIMEOUT' });
  await assert.rejects(call('huge', {}), { code: 'RESPONSE_TOO_LARGE' });
  await assert.rejects(call('slow', 'x'.repeat(MAX_FRAME)), { code: 'REQUEST_TOO_LARGE' });
});
test('close drains accepted work before removing discovery', async t => {
  let finish;
  const { call, server } = await setup(t, { save: () => new Promise(resolve => { finish = resolve; }) });
  const request = call('save', {});
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const closing = server.close();
  assert.equal(server.close(), closing, 'concurrent shutdown waits for the same drain');
  finish({ saved: true });
  assert.deepEqual(await request, { saved: true });
  await closing;
});
test('shutdown retains ownership until socket cleanup completes', async t => {
  const { directory, server } = await setup(t);
  const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'test.json'), 'utf8'));
  const originalRm = fs.rm;
  let release, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  fs.rm = async (target, options) => {
    if (target === endpoint.socketPath) { entered(); await new Promise(resolve => { release = resolve; }); }
    return originalRm(target, options);
  };
  const closing = server.close();
  try {
    await reached;
    await assert.rejects(startPrivateServer({ directory, service: 'test', handlers: { echo: value => value } }), { code: 'SERVICE_BUSY' });
  } finally { fs.rm = originalRm; release(); await closing; }
  const replacement = await startPrivateServer({ directory, service: 'test', handlers: { echo: value => value } });
  try { assert.equal(await callPrivate({ directory, service: 'test', method: 'echo', params: 'replacement' }), 'replacement'); }
  finally { await replacement.close(); }
});
