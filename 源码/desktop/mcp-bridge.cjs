'use strict';

// Local, authenticated, read-only transport. The desktop application owns all
// library reads; clients cannot supply a filesystem path or execute a command.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 30000;
const BRIDGE_VERSION = 1;
const FORMAT = 'mengcang-desktop-mcp';
const ownUid = () => typeof process.getuid === 'function' ? process.getuid() : undefined;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const errorResult = message => ({ content: [{ type: 'text', text: message }], isError: true });

function checkPrivate(stat, directory = false) {
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() ||
      (ownUid() !== undefined && stat.uid !== ownUid()) || (stat.mode & 0o077) !== 0) {
    throw fail('MCP_PRIVATE_PATH', '梦藏 MCP 连接文件必须由当前用户私有保存。');
  }
}

async function readPrivateJson(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    checkPrivate(stat);
    if (stat.size < 1 || stat.size > MAX_REGISTRY_BYTES) throw fail('MCP_REGISTRY_INVALID', '梦藏 MCP 连接信息无效。');
    const buffer = Buffer.alloc(MAX_REGISTRY_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_REGISTRY_BYTES) throw fail('MCP_REGISTRY_INVALID', '梦藏 MCP 连接信息超出范围。');
    try { return JSON.parse(buffer.subarray(0, size).toString('utf8')); }
    catch { throw fail('MCP_REGISTRY_INVALID', '梦藏 MCP 连接信息无效。'); }
  } finally { await handle.close(); }
}

function validateRegistry(value) {
  if (!object(value) || value.format !== FORMAT || value.version !== BRIDGE_VERSION ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.token) || typeof value.socketPath !== 'string' ||
      !path.isAbsolute(value.socketPath) || value.socketPath.includes('\0') ||
      value.socketPath.split(/[\\/]/).includes('..') || Buffer.byteLength(value.socketPath) > 100 ||
      (ownUid() !== undefined && value.uid !== ownUid())) {
    throw fail('MCP_REGISTRY_INVALID', '梦藏 MCP 连接信息无效。');
  }
  return value;
}

function validateUserData(userData) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData) || userData.includes('\0') ||
      userData.split(/[\\/]/).includes('..')) throw fail('MCP_DESKTOP_PATH', '请提供梦藏桌面资料目录的绝对路径。');
  return path.resolve(userData);
}

async function readEndpoint(userData) {
  const directory = path.join(validateUserData(userData), 'mcp');
  try {
    checkPrivate(await fs.lstat(directory), true);
    const endpoint = validateRegistry(await readPrivateJson(path.join(directory, 'connection.json')));
    const runtime = await fs.lstat(path.dirname(endpoint.socketPath));
    checkPrivate(runtime, true);
    const socket = await fs.lstat(endpoint.socketPath);
    if (!socket.isSocket() || socket.isSymbolicLink() || (socket.mode & 0o077) !== 0 ||
        (ownUid() !== undefined && socket.uid !== ownUid())) throw fail('MCP_PRIVATE_PATH', '梦藏 MCP 本机连接不符合私有访问限制。');
    return endpoint;
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('MCP_DESKTOP_CLOSED', '请先打开梦藏桌面软件，再重试读取资料。');
    throw error;
  }
}

function validateArguments(schema, value, at = '参数') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.anyOf && !schema.anyOf.some(part => { try { validateArguments(part, value, at); return true; } catch { return false; } })) {
    throw fail('MCP_ARGUMENTS', `${at}不符合工具格式。`);
  }
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) throw fail('MCP_ARGUMENTS', `${at}超出允许值。`);
  if (schema.const !== undefined && !Object.is(schema.const, value)) throw fail('MCP_ARGUMENTS', `${at}无效。`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = type => type === 'object' ? object(value) : type === 'array' ? Array.isArray(value) :
      type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) :
      type === 'null' ? value === null : typeof value === type;
    if (!types.some(matches)) throw fail('MCP_ARGUMENTS', `${at}类型无效。`);
  }
  if (object(value)) {
    if ((schema.required || []).some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw fail('MCP_ARGUMENTS', `${at}缺少必填项。`);
    for (const key of Object.keys(value)) {
      if (schema.additionalProperties === false && !Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) {
        throw fail('MCP_ARGUMENTS', '工具不接受额外参数、任意文件路径或执行指令。');
      }
      if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) validateArguments(schema.properties[key], value[key], `${at}.${key}`);
    }
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (value.includes('\0') || (schema.minLength !== undefined && length < schema.minLength) ||
        (schema.maxLength !== undefined && length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value))) {
      throw fail('MCP_ARGUMENTS', `${at}长度或格式无效。`);
    }
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) {
    throw fail('MCP_ARGUMENTS', `${at}超出范围。`);
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) throw fail('MCP_ARGUMENTS', `${at}数量超出范围。`);
    if (schema.items) for (const item of value) validateArguments(schema.items, item, at);
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function removeMatching(filename, token, socketPath) {
  try {
    const current = await readPrivateJson(filename);
    if (current.token === token && (!socketPath || current.socketPath === socketPath)) await fs.unlink(filename);
  } catch (error) { if (error.code !== 'ENOENT') return false; }
  return true;
}

async function acquireRegistryLock(directory, token) {
  const filename = path.join(directory, 'connection.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, format: FORMAT, version: BRIDGE_VERSION })); }
      finally { await handle.close(); }
      return () => removeMatching(filename, token);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readPrivateJson(filename);
      if (previous.format !== FORMAT || previous.version !== BRIDGE_VERSION || !Number.isSafeInteger(previous.pid) ||
          typeof previous.token !== 'string' || !/^[a-f0-9]{64}$/.test(previous.token)) throw fail('MCP_REGISTRY_INVALID', '梦藏 MCP 启动锁无效。');
      if (pidAlive(previous.pid)) throw fail('MCP_ALREADY_RUNNING', '另一个梦藏 MCP 正在启动，请使用已有桌面实例。');
      await removeMatching(filename, previous.token);
    }
  }
  throw fail('MCP_ALREADY_RUNNING', '梦藏 MCP 连接目录正在使用中。');
}

async function startMcpBridge({ userData, callTool, tools, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  validateUserData(userData);
  if (process.platform === 'win32') throw fail('MCP_UNSUPPORTED_PLATFORM', '此版本的梦藏本机 MCP 使用 macOS / Unix 私有连接。');
  if (typeof callTool !== 'function') throw new TypeError('callTool must be a function');
  if (!Array.isArray(tools)) tools = require('./mcp-library.cjs').TOOLS;
  if (!Array.isArray(tools) || !tools.length) throw new TypeError('tools must be a non-empty array');
  const toolMap = new Map(tools.map(tool => [tool.name, tool]));
  const directory = path.join(path.resolve(userData), 'mcp');
  await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (ownUid() !== undefined && directoryStat.uid !== ownUid())) throw fail('MCP_PRIVATE_PATH', '梦藏 MCP 连接目录必须由当前用户拥有。');
  await fs.chmod(directory, 0o700);
  const token = crypto.randomBytes(32).toString('hex');
  const registryPath = path.join(directory, 'connection.json');
  const unlock = await acquireRegistryLock(directory, token);
  let runtime, socketPath, server, published = false, closed = false;
  const clients = new Set();
  let runningCalls = 0;
  try {
    try {
      const previous = validateRegistry(await readPrivateJson(registryPath));
      if (pidAlive(previous.pid)) throw fail('MCP_ALREADY_RUNNING', '已有梦藏桌面 MCP 正在运行，不会覆盖它的连接。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Keep the Unix socket path short on macOS, regardless of userData length.
    runtime = await fs.mkdtemp(`/tmp/mengcang-mcp-${ownUid() ?? 'local'}-`);
    await fs.chmod(runtime, 0o700);
    socketPath = path.join(runtime, 'bridge.sock');
    server = net.createServer(socket => {
      clients.add(socket);
      let pending = Buffer.alloc(0), accepted = false;
      const send = value => {
        if (socket.destroyed) return;
        let payload;
        try { payload = JSON.stringify(value); } catch { payload = JSON.stringify({ error: { code: 'MCP_RESPONSE_INVALID', message: '梦藏返回的数据格式无效。' } }); }
        if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) payload = JSON.stringify({ error: { code: 'MCP_RESPONSE_TOO_LARGE', message: '本次资料超过传输范围，请分段读取正文或选择较小图片。' } });
        socket.end(payload + '\n');
      };
      socket.setTimeout(requestTimeoutMs, () => { send({ error: { code: 'MCP_TIMEOUT', message: '梦藏读取超时，请稍后重试。' } }); socket.destroySoon(); });
      socket.on('error', () => {});
      socket.on('close', () => clients.delete(socket));
      socket.on('data', chunk => {
        if (accepted) { socket.destroy(); return; }
        const newline = chunk.indexOf(0x0a);
        const part = newline < 0 ? chunk : chunk.subarray(0, newline);
        if (pending.length + part.length > MAX_REQUEST_BYTES) { accepted = true; send({ error: { code: 'MCP_REQUEST_TOO_LARGE', message: 'MCP 请求超过 64 KiB。' } }); return; }
        pending = Buffer.concat([pending, part]);
        if (newline < 0) return;
        accepted = true;
        if (chunk.subarray(newline + 1).length) { send({ error: { code: 'MCP_REQUEST_INVALID', message: '每个本机连接只接受一次请求。' } }); return; }
        let request;
        try { request = JSON.parse(pending.toString('utf8')); } catch { send({ error: { code: 'MCP_REQUEST_INVALID', message: 'MCP 请求不是有效 JSON。' } }); return; }
        pending = Buffer.alloc(0);
        if (!object(request) || Object.keys(request).some(key => !['token', 'name', 'args'].includes(key)) ||
            typeof request.token !== 'string' || !/^[a-f0-9]{64}$/.test(request.token) ||
            !crypto.timingSafeEqual(Buffer.from(request.token), Buffer.from(token))) {
          send({ error: { code: 'MCP_UNAUTHORIZED', message: '本机 MCP 连接未经授权。' } }); return;
        }
        const tool = toolMap.get(request.name);
        if (!tool) { send({ error: { code: 'MCP_UNKNOWN_TOOL', message: '未知的梦藏只读工具。' } }); return; }
        try { validateArguments(tool.inputSchema, request.args ?? {}); }
        catch (error) { send({ result: errorResult(error.message) }); return; }
        if (runningCalls >= 4) { send({ error: { code: 'MCP_BUSY', message: '梦藏正在读取其他资料，请稍后重试。' } }); return; }
        runningCalls++;
        Promise.resolve().then(() => callTool(request.name, request.args ?? {})).then(result => {
          if (!object(result) || !Array.isArray(result.content)) send({ error: { code: 'MCP_RESPONSE_INVALID', message: '梦藏返回的数据格式无效。' } });
          else send({ result });
        }, () => send({ result: errorResult('梦藏暂时无法读取此资料，请在软件中检查资料是否仍可用。') })).finally(() => { runningCalls--; });
      });
    });
    server.maxConnections = 16;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); }); });
    server.on('error', () => {});
    await fs.chmod(socketPath, 0o600);
    const endpoint = { format: FORMAT, version: BRIDGE_VERSION, pid: process.pid, uid: ownUid(), token, socketPath };
    const temporary = path.join(directory, `connection-${token.slice(0, 12)}.tmp`);
    try {
      const file = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(JSON.stringify(endpoint)); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, registryPath);
      published = true;
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (runtime) await fs.rm(runtime, { recursive: true, force: true });
    throw error;
  } finally { await unlock(); }
  return {
    socketPath, registryPath,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of clients) socket.destroy();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      if (published) await removeMatching(registryPath, token, socketPath);
      await fs.rm(runtime, { recursive: true, force: true });
    },
  };
}

async function callDesktopTool({ userData, name, args = {}, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const endpoint = await readEndpoint(userData);
  const payload = JSON.stringify({ token: endpoint.token, name, args });
  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw fail('MCP_REQUEST_TOO_LARGE', 'MCP 请求超过 64 KiB。');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.socketPath);
    let pending = Buffer.alloc(0), settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; socket.destroy(); if (error) reject(error); else resolve(result); };
    socket.setTimeout(requestTimeoutMs, () => finish(fail('MCP_TIMEOUT', '梦藏读取超时，请稍后重试。')));
    socket.on('connect', () => socket.write(payload + '\n'));
    socket.on('error', error => finish(['ECONNREFUSED', 'ENOENT', 'ECONNRESET'].includes(error.code) ? fail('MCP_DESKTOP_CLOSED', '请先打开梦藏桌面软件，再重试读取资料。') : fail('MCP_CONNECTION', '无法连接梦藏桌面软件。')));
    socket.on('end', () => finish(fail('MCP_CONNECTION', '梦藏连接中断，请重试。')));
    socket.on('data', chunk => {
      const newline = chunk.indexOf(0x0a), part = newline < 0 ? chunk : chunk.subarray(0, newline);
      if (pending.length + part.length > MAX_RESPONSE_BYTES) { finish(fail('MCP_RESPONSE_TOO_LARGE', '本次资料超过传输范围，请分段读取。')); return; }
      pending = Buffer.concat([pending, part]);
      if (newline < 0) return;
      let reply;
      try { reply = JSON.parse(pending.toString('utf8')); } catch { finish(fail('MCP_RESPONSE_INVALID', '梦藏返回的数据格式无效。')); return; }
      if (!object(reply)) { finish(fail('MCP_RESPONSE_INVALID', '梦藏返回的数据格式无效。')); return; }
      if (object(reply.error)) { finish(fail(typeof reply.error.code === 'string' ? reply.error.code : 'MCP_CONNECTION', typeof reply.error.message === 'string' ? reply.error.message : '梦藏读取失败。')); return; }
      if (!object(reply.result) || !Array.isArray(reply.result.content)) { finish(fail('MCP_RESPONSE_INVALID', '梦藏返回的数据格式无效。')); return; }
      finish(null, reply.result);
    });
  });
}

module.exports = { startMcpBridge, callDesktopTool, readEndpoint, validateArguments, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, BRIDGE_VERSION };
