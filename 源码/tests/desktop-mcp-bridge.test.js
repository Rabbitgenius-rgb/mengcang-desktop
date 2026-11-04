'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { startMcpBridge, callDesktopTool, readEndpoint, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } = require('../desktop/mcp-bridge.cjs');

const TOOLS = [{
  name: 'fixture_read', description: 'Read-only test tool',
  inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 12 }, offset: { type: 'integer', minimum: 0, maximum: 10 } }, required: ['id'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}];
const result = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const initialize = id => request(id, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bridge-test', version: '1' } });

async function harness(t, options = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-mcp-test-'));
  let bridge;
  t.after(async () => { if (bridge) await bridge.close(); await fs.rm(userData, { recursive: true, force: true }); });
  bridge = await startMcpBridge({ userData, tools: TOOLS, callTool: async (name, args) => result({ name, args }), ...options });
  const endpoint = await readEndpoint(userData);
  return { userData, bridge, endpoint };
}

function socketRequest(socketPath, data) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks = [];
    socket.setTimeout(3000, () => { socket.destroy(); reject(Error('test socket timed out')); });
    socket.on('connect', () => socket.write(typeof data === 'string' ? data : JSON.stringify(data) + '\n'));
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
  });
}

test('desktop bridge publishes private endpoint and reads through authenticated Unix socket', async t => {
  const h = await harness(t);
  for (const filename of [path.join(h.userData, 'mcp'), h.bridge.registryPath, path.dirname(h.bridge.socketPath), h.bridge.socketPath]) {
    assert.equal((await fs.lstat(filename)).mode & 0o077, 0);
  }
  assert.equal(h.endpoint.pid, process.pid);
  assert.equal(h.endpoint.token.length, 64);
  const response = await callDesktopTool({ userData: h.userData, name: 'fixture_read', args: { id: '中文🧪' } });
  assert.deepEqual(JSON.parse(response.content[0].text), { name: 'fixture_read', args: { id: '中文🧪' } });
  await h.bridge.close();
  await assert.rejects(readEndpoint(h.userData), { code: 'MCP_DESKTOP_CLOSED' });
  assert.equal(fsSync.existsSync(h.bridge.socketPath), false);
  await h.bridge.close();
});

test('socket rejects unauthenticated, unknown, malformed and multi-frame requests', async t => {
  let calls = 0;
  const h = await harness(t, { callTool: async () => { calls++; return result('ok'); } });
  const valid = { token: h.endpoint.token, name: 'fixture_read', args: { id: 'x' } };
  assert.equal((await socketRequest(h.bridge.socketPath, { ...valid, token: '0'.repeat(64) })).error.code, 'MCP_UNAUTHORIZED');
  assert.equal((await socketRequest(h.bridge.socketPath, { ...valid, token: undefined })).error.code, 'MCP_UNAUTHORIZED');
  assert.equal((await socketRequest(h.bridge.socketPath, { ...valid, name: 'execute_command' })).error.code, 'MCP_UNKNOWN_TOOL');
  assert.equal((await socketRequest(h.bridge.socketPath, '{broken}\n')).error.code, 'MCP_REQUEST_INVALID');
  assert.equal((await socketRequest(h.bridge.socketPath, JSON.stringify(valid) + '\n{}\n')).error.code, 'MCP_REQUEST_INVALID');
  assert.equal(calls, 0);
});

test('socket and client cap requests in UTF-8 bytes and reject schema violations before reads', async t => {
  let calls = 0;
  const h = await harness(t, { callTool: async () => { calls++; return result('ok'); } });
  const valid = { token: h.endpoint.token, name: 'fixture_read', args: { id: 'x' } };
  for (const args of [{}, { id: 'x', path: '/etc/passwd' }, { id: 'x', offset: -1 }, { id: 'x', offset: 1.5 }, { id: 4 }, { id: 'x'.repeat(13) }]) {
    const response = await socketRequest(h.bridge.socketPath, { ...valid, args });
    assert.equal(response.result.isError, true);
  }
  const oversized = JSON.stringify({ ...valid, args: { id: '图'.repeat(MAX_REQUEST_BYTES / 2) } }) + '\n';
  assert.equal((await socketRequest(h.bridge.socketPath, oversized)).error.code, 'MCP_REQUEST_TOO_LARGE');
  await assert.rejects(callDesktopTool({ userData: h.userData, name: 'fixture_read', args: { id: '图'.repeat(MAX_REQUEST_BYTES / 2) } }), { code: 'MCP_REQUEST_TOO_LARGE' });
  assert.equal(calls, 0);
});

test('another active desktop endpoint is not overwritten or cleaned up', async t => {
  const h = await harness(t);
  const before = await fs.readFile(h.bridge.registryPath, 'utf8');
  await assert.rejects(startMcpBridge({ userData: h.userData, tools: TOOLS, callTool: async () => result('other') }), { code: 'MCP_ALREADY_RUNNING' });
  assert.equal(await fs.readFile(h.bridge.registryPath, 'utf8'), before);
  assert.equal(fsSync.existsSync(h.bridge.socketPath), true);
});

test('closing bridge only removes its own registered endpoint', async t => {
  const h = await harness(t);
  const replacement = { ...h.endpoint, token: '1'.repeat(64), socketPath: '/tmp/replacement.sock' };
  await fs.writeFile(h.bridge.registryPath, JSON.stringify(replacement), { mode: 0o600 });
  await h.bridge.close();
  assert.deepEqual(JSON.parse(await fs.readFile(h.bridge.registryPath, 'utf8')), replacement);
  assert.equal(fsSync.existsSync(h.bridge.socketPath), false);
});

test('client refuses public registry or symlink socket directories', async t => {
  const h = await harness(t);
  await fs.chmod(h.bridge.registryPath, 0o644);
  await assert.rejects(readEndpoint(h.userData), { code: 'MCP_PRIVATE_PATH' });
  await fs.chmod(h.bridge.registryPath, 0o600);
  const linked = path.join(h.userData, 'linked-runtime');
  await fs.symlink(path.dirname(h.bridge.socketPath), linked);
  await fs.writeFile(h.bridge.registryPath, JSON.stringify({ ...h.endpoint, socketPath: path.join(linked, 'bridge.sock') }));
  await assert.rejects(readEndpoint(h.userData), { code: 'MCP_PRIVATE_PATH' });
});

test('image blocks larger than the old 8 MiB snapshot limit travel intact, responses remain bounded', async t => {
  const image = { type: 'image', mimeType: 'image/png', data: Buffer.alloc(8 * 1024 * 1024, 1).toString('base64') };
  let large = false;
  const h = await harness(t, { callTool: async () => large ? result('x'.repeat(MAX_RESPONSE_BYTES)) : { content: [image] } });
  const response = await callDesktopTool({ userData: h.userData, name: 'fixture_read', args: { id: 'image' } });
  assert.equal(response.content[0].type, 'image');
  assert.equal(response.content[0].data.length, image.data.length);
  assert.equal(response.content[0].data, image.data);
  large = true;
  await assert.rejects(callDesktopTool({ userData: h.userData, name: 'fixture_read', args: { id: 'large' } }), { code: 'MCP_RESPONSE_TOO_LARGE' });
});

test('async read failures and timeouts do not expose internal errors or keep sockets alive', async t => {
  let mode = 'throw';
  const h = await harness(t, { requestTimeoutMs: 80, callTool: async () => { if (mode === 'throw') throw Error('internal-secret-do-not-send'); return new Promise(() => {}); } });
  const failed = await callDesktopTool({ userData: h.userData, name: 'fixture_read', args: { id: 'x' } });
  assert.equal(failed.isError, true);
  assert.equal(JSON.stringify(failed).includes('internal-secret'), false);
  mode = 'timeout';
  await assert.rejects(callDesktopTool({ userData: h.userData, name: 'fixture_read', args: { id: 'x' } }), { code: 'MCP_TIMEOUT' });
  await h.bridge.close();
});

test('bridge safely replaces confirmed-dead registry without deleting old socket files', async t => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-mcp-stale-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const gone = spawn(process.execPath, ['-e', '']);
  const deadPid = gone.pid;
  await new Promise((resolve, reject) => { gone.on('exit', resolve); gone.on('error', reject); });
  const directory = path.join(userData, 'mcp');
  await fs.mkdir(directory, { mode: 0o700 });
  const staleSocket = path.join(userData, 'old.sock');
  await fs.writeFile(staleSocket, 'belongs-to-old-instance', { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'connection.json'), JSON.stringify({ format: 'mengcang-desktop-mcp', version: 1, pid: deadPid, uid: process.getuid(), token: '2'.repeat(64), socketPath: staleSocket }), { mode: 0o600 });
  const bridge = await startMcpBridge({ userData, tools: TOOLS, callTool: async () => result('new') });
  t.after(() => bridge.close());
  assert.equal((await readEndpoint(userData)).pid, process.pid);
  assert.equal(await fs.readFile(staleSocket, 'utf8'), 'belongs-to-old-instance');
});

test('MCP initialize and tool discovery work without opening the desktop app', async () => {
  const { createProtocol } = require('../scripts/mengcang-desktop-mcp.cjs');
  let calls = 0;
  const protocol = createProtocol({ userData: '/tmp/missing-desktop', tools: TOOLS, call: async () => { calls++; throw Error('请先打开梦藏桌面软件，再重试读取资料。'); } });
  assert.equal((await protocol(request(1, 'tools/list'))).error.code, -32000);
  const started = await protocol(initialize(2));
  assert.equal(started.result.serverInfo.name, 'mengcang-desktop');
  await protocol({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual((await protocol(request(3, 'tools/list'))).result.tools, TOOLS);
  assert.equal((await protocol(request(4, 'tools/call', { name: 'not_supported', arguments: {} }))).error.code, -32602);
  assert.equal((await protocol(request(5, 'tools/call', { name: 'fixture_read', arguments: { id: 'x', command: 'rm' } }))).result.isError, true);
  const closed = await protocol(request(6, 'tools/call', { name: 'fixture_read', arguments: { id: 'x' } }));
  assert.equal(closed.result.isError, true);
  assert.match(closed.result.content[0].text, /先打开梦藏/);
  assert.equal(calls, 1);
  assert.equal((await protocol(request(7, 'ping'))).result.constructor, Object);
  assert.equal((await protocol(null)).error.code, -32600);
});

function spawnClient(t, userData) {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/mengcang-desktop-mcp.cjs'), '--desktop', userData], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '', errors = '', pending = '';
  const replies = [], waiters = [];
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  child.stdout.on('data', chunk => {
    output += chunk.toString(); pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      let parsed;
      try { parsed = JSON.parse(line); } catch (error) { for (const waiter of waiters.splice(0)) waiter.reject(error); continue; }
      replies.push(parsed);
      for (let index = waiters.length - 1; index >= 0; index--) if (waiters[index].predicate(parsed)) {
        const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(parsed);
      }
    }
  });
  return {
    child, replies,
    get output() { return output; }, get errors() { return errors; },
    send(value) { child.stdin.write(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value) + '\n'); },
    wait(predicate) {
      const existing = replies.find(predicate); if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject };
        waiter.timer = setTimeout(() => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); reject(Error(`MCP test timed out; stderr: ${errors}`)); }, 6000);
        waiters.push(waiter);
      });
    },
  };
}

test('stdio framing survives partial UTF-8, malformed frames and oversized requests; stdout remains protocol-only', async t => {
  const { TOOLS: desktopTools } = require('../desktop/mcp-library.cjs');
  const h = await harness(t, { tools: desktopTools, callTool: async (name, args) => result({ name, args, text: '中文🧪' }) });
  const client = spawnClient(t, h.userData);
  client.send(JSON.stringify(initialize(10)) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' + JSON.stringify(request(11, 'tools/list')) + '\n');
  const listed = await client.wait(reply => reply.id === 11);
  assert.equal(listed.result.tools.length, desktopTools.length);
  client.send('null\n{invalid}\n');
  assert.equal((await client.wait(reply => reply.error?.code === -32600)).id, null);
  await client.wait(reply => reply.error?.code === -32700);
  client.send('图'.repeat(MAX_REQUEST_BYTES / 2));
  client.send('\n' + JSON.stringify(request(12, 'ping')) + '\n');
  await client.wait(reply => reply.error?.message?.includes('64 KiB'));
  await client.wait(reply => reply.id === 12);
  const readTool = desktopTools.find(tool => tool.name === 'search_materials') || desktopTools.find(tool => tool.name === 'search_cards');
  assert.ok(readTool, 'reader exposes search tool');
  const frame = Buffer.from(JSON.stringify(request(13, 'tools/call', { name: readTool.name, arguments: { query: '中文🧪' } })) + '\n');
  const split = frame.indexOf(Buffer.from('中文')) + 1;
  client.send(frame.subarray(0, split)); client.send(frame.subarray(split));
  const read = await client.wait(reply => reply.id === 13);
  assert.equal(read.result.isError, undefined);
  assert.equal(JSON.parse(read.result.content[0].text).args.query, '中文🧪');
  assert.equal(client.errors, '');
  for (const line of client.output.trim().split('\n')) assert.equal(JSON.parse(line).jsonrpc, '2.0');
});

test('stdio reports closed desktop as tool error while initialize and discovery remain available', async t => {
  const { TOOLS: desktopTools } = require('../desktop/mcp-library.cjs');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'mengcang-mcp-closed-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const client = spawnClient(t, userData);
  client.send(initialize(20)); client.send({ jsonrpc: '2.0', method: 'notifications/initialized' }); client.send(request(21, 'tools/list'));
  await client.wait(reply => reply.id === 21);
  const tool = desktopTools.find(item => !item.inputSchema.required?.length);
  assert.ok(tool);
  client.send(request(22, 'tools/call', { name: tool.name, arguments: {} }));
  const failed = await client.wait(reply => reply.id === 22);
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /先打开梦藏/);
  assert.equal(client.errors, '');
});

test('stdio supports concurrent tool calls without interleaving JSON responses', async t => {
  const { TOOLS: desktopTools } = require('../desktop/mcp-library.cjs');
  const tool = desktopTools.find(item => !item.inputSchema.required?.length);
  const h = await harness(t, { tools: desktopTools, callTool: async () => { await new Promise(resolve => setTimeout(resolve, 15)); return result('async'); } });
  const client = spawnClient(t, h.userData);
  client.send(initialize(30)); client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  client.send(JSON.stringify(request(31, 'tools/call', { name: tool.name, arguments: {} })) + '\n' + JSON.stringify(request(32, 'tools/call', { name: tool.name, arguments: {} })) + '\n' + JSON.stringify(request(33, 'ping')) + '\n');
  const replies = await Promise.all([31, 32, 33].map(id => client.wait(reply => reply.id === id)));
  assert.equal(replies[0].result.content[0].text, 'async');
  assert.equal(replies[1].result.content[0].text, 'async');
  assert.deepEqual(replies[2].result, {});
});
