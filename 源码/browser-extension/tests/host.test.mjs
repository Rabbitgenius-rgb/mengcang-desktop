import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const host = require('../../scripts/clipper-native-host.cjs');
const root = path.resolve(import.meta.dirname, '..');
const parse = buffer => {const n = buffer.readUInt32LE(0); assert.equal(buffer.length, n + 4); return JSON.parse(buffer.subarray(4).toString());};
const frame = value => {const body = Buffer.from(JSON.stringify(value)); const prefix = Buffer.alloc(4); prefix.writeUInt32LE(body.length); return Buffer.concat([prefix, body]);};
async function run(chunks, options = {}) {
  const input = new PassThrough(), output = new PassThrough(), response = [];
  output.on('data', chunk => response.push(chunk));
  const complete = host.runNativeHost({input, output, origin: host.ORIGIN, directory: '/isolated', callPrivate: async () => ({ready: true}), ...options});
  for (const chunk of chunks) input.write(chunk);
  await complete;
  input.destroy(); output.destroy();
  return parse(Buffer.concat(response));
}
test('host accepts fragmented native frames and forwards only the narrow service call', async () => {
  const bytes = frame({method: 'capture', params: {requestId: 'synthetic'}});
  let received;
  const response = await run([bytes.subarray(0, 2), bytes.subarray(2, 8), bytes.subarray(8)], {callPrivate: async value => {received = value; return {workspaceId: 'fixture', revision: 7, item: {id: 'saved'}};}});
  assert.equal(response.ok, true); assert.equal(response.data.item.id, 'saved');
  assert.deepEqual(received, {directory: '/isolated', service: 'browser-clipper', method: 'capture', params: {requestId: 'synthetic'}, timeoutMs: 120000});
});
test('host rejects unknown extension origins and never dispatches them', async () => {
  let calls = 0;
  const response = await run([], {origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', callPrivate: async () => calls++});
  assert.equal(response.error.code, 'FORBIDDEN_EXTENSION'); assert.equal(calls, 0);
});
test('host rejects oversized and trailing native messages before dispatch', async () => {
  const large = Buffer.alloc(4); large.writeUInt32LE(host.MAX_INPUT + 1);
  assert.equal((await run([large])).error.code, 'REQUEST_TOO_LARGE');
  const bytes = frame({method: 'status', params: {}});
  assert.equal((await run([Buffer.concat([bytes, bytes])])).error.code, 'INVALID_REQUEST');
});
test('host rejects other methods and wrapper fields', async () => {
  for (const request of [{method: 'delete', params: {}}, {method: 'status', params: {path: '/private'}}, {method: 'status', params: {}, file: '/private'}]) {
    const response = await run([frame(request)]); assert.equal(response.error.code, 'INVALID_REQUEST');
  }
});
test('closed desktop and uncertain saves return actionable errors without filesystem paths', async () => {
  const value = {method: 'status', params: {}};
  const closed = await run([frame(value)], {callPrivate: async () => {throw Object.assign(Error('ENOENT /private/fixture'), {code: 'ENOENT'});}});
  assert.equal(closed.error.code, 'DESKTOP_UNAVAILABLE'); assert(!closed.error.message.includes('/private'));
  const timeout = await run([frame(value)], {callPrivate: async () => {throw Object.assign(Error('timeout'), {code: 'TIMEOUT'});}});
  assert.equal(timeout.error.code, 'SAVE_UNCONFIRMED');
});
test('host private config rejects symlinks and non-private modes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-host-config-'));
  try {
    const file = path.join(directory, 'config.json');
    await fs.writeFile(file, JSON.stringify({bridgeDirectory: '/isolated'}), {mode: 0o600});
    assert.equal(host.readConfig(directory), '/isolated');
    await fs.chmod(file, 0o644); assert.throws(() => host.readConfig(directory), {code: 'HOST_CONFIG'});
    await fs.unlink(file); await fs.symlink('/etc/hosts', file); assert.throws(() => host.readConfig(directory), {code: 'HOST_CONFIG'});
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});
test('bundled host speaks the native protocol as an independent process and exits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-host-process-'));
  try {
    await fs.copyFile(path.join(root, 'native/clipper-host.cjs'), path.join(directory, 'host.cjs'));
    await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({bridgeDirectory: path.join(directory, 'not-running')}), {mode: 0o600});
    const child = spawn(process.execPath, [path.join(directory, 'host.cjs'), host.ORIGIN], {stdio: ['pipe', 'pipe', 'pipe']});
    const output = [], errors = []; child.stdout.on('data', value => output.push(value)); child.stderr.on('data', value => errors.push(value));
    const timer = setTimeout(() => child.kill(), 3000);
    child.stdin.write(frame({method: 'status', params: {}}));
    const code = await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timer);
    assert.equal(code, 0); assert.equal(Buffer.concat(errors).length, 0);
    assert.equal(parse(Buffer.concat(output)).error.code, 'DESKTOP_UNAVAILABLE');
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});
