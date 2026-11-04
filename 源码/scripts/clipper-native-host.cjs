'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOST_NAME = 'com.rabbit.mengcang.clipper';
const EXTENSION_ID = 'ebdbkhhcgifolblbcpkpgibjbighfhgi';
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const MAX_INPUT = 1024 * 1024;
const MAX_OUTPUT = 256 * 1024;
const fail = (code, message) => Object.assign(new Error(message), {code});

function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_OUTPUT) throw fail('RESPONSE_TOO_LARGE', '本机保存回执过大。');
  const frame = Buffer.allocUnsafe(body.length + 4); frame.writeUInt32LE(body.length, 0); body.copy(frame, 4); return frame;
}
function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['method', 'params'].includes(key)) || !['status', 'capture','collections','highlights','related','openRelated'].includes(value.method) || !value.params || typeof value.params !== 'object' || Array.isArray(value.params)) throw fail('INVALID_REQUEST', '不支持的本机收录请求。');
  if (value.method === 'status' && Object.keys(value.params).length) throw fail('INVALID_REQUEST', '连接检查不接受额外参数。');
  return value;
}
function readConfig(directory = __dirname) {
  const fallback = path.join(os.homedir(), 'Library', 'Application Support', '梦藏', 'browser-clipper');
  const filename = path.join(directory, 'config.json');
  let stat;
  try {stat = fs.lstatSync(filename);} catch (error) {if (error.code === 'ENOENT') return fallback; throw fail('HOST_CONFIG', '本机连接配置无法读取，请重新安装连接。');}
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192 || (stat.mode & 0o077) || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw fail('HOST_CONFIG', '本机连接配置不符合私有访问限制。');
  let value;
  try {value = JSON.parse(fs.readFileSync(filename, 'utf8'));} catch {throw fail('HOST_CONFIG', '本机连接配置无法读取，请重新安装连接。');}
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'bridgeDirectory') || typeof value.bridgeDirectory !== 'string' || !path.isAbsolute(value.bridgeDirectory) || value.bridgeDirectory.includes('\0')) throw fail('HOST_CONFIG', '本机连接配置无效，请重新安装连接。');
  return value.bridgeDirectory;
}
async function handleRequest(request, {origin, directory, callPrivate} = {}) {
  if (origin !== ORIGIN) throw fail('FORBIDDEN_EXTENSION', '此扩展未被允许连接梦藏。');
  const {method, params} = validateRequest(request);
  const call = callPrivate || require('../../shared/private-rpc.cjs').callPrivate;
  try {return await call({directory: directory || readConfig(), service: 'browser-clipper', method, params, timeoutMs: method==='capture'?120000:30000});}
  catch (error) {
    if (['SERVICE_UNAVAILABLE', 'ENOENT', 'ECONNREFUSED', 'CONNECTION_CLOSED', 'LIBRARY_NOT_READY'].includes(error.code)) throw fail('DESKTOP_UNAVAILABLE', '请先打开梦藏，并等待资料库加载完成后重试。');
    if (['TIMEOUT', 'RECALL_TIMEOUT'].includes(error.code)) throw fail('SAVE_UNCONFIRMED', '尚未确认保存结果，请保持梦藏打开，并使用原请求重试。');
    throw fail(/^[A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'CAPTURE_FAILED', error.message || '收录未完成，请重试。');
  }
}
async function runNativeHost({input = process.stdin, output = process.stdout, origin = process.argv[2], directory, callPrivate} = {}) {
  let buffer = Buffer.alloc(0), length = null, accepted = false, settled = false;
  return await new Promise(resolve => {
    const finish = value => {
      if (settled) return;
      let frame;
      try {frame=encodeMessage(value);} catch {frame=encodeMessage({ok:false,error:{code:'RESPONSE_TOO_LARGE',message:'本机响应超过传输上限，请缩小查询范围后重试。'}});}
      settled = true; clearTimeout(timer); input.removeListener('data', receive); input.removeListener('end', ended); input.pause(); output.write(frame, resolve);
    };
    const reject = error => finish({ok: false, error: {code: error.code || 'INVALID_REQUEST', message: error.message || '无法读取本机请求。'}});
    const timer = setTimeout(() => reject(fail('INPUT_TIMEOUT', '本机请求读取超时。')), 5000);
    const ended = () => {if (!accepted) reject(fail('INVALID_REQUEST', '本机请求不完整。'));};
    const receive = chunk => {
      if (accepted || settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_INPUT + 4) return reject(fail('REQUEST_TOO_LARGE', '收录请求超过传输限制。'));
      if (length === null && buffer.length >= 4) {length = buffer.readUInt32LE(0); if (!length || length > MAX_INPUT) return reject(fail('REQUEST_TOO_LARGE', '收录请求超过传输限制。'));}
      if (length === null || buffer.length < length + 4) return;
      if (buffer.length !== length + 4) return reject(fail('INVALID_REQUEST', '一次连接只接受一条收录请求。'));
      accepted = true; clearTimeout(timer);
      let value; try {value = JSON.parse(buffer.subarray(4).toString('utf8'));} catch {return reject(fail('INVALID_REQUEST', '无法解析本机请求。'));}
      handleRequest(value, {origin, directory, callPrivate}).then(data => finish({ok: true, data}), reject);
    };
    input.on('data', receive); input.on('end', ended); input.on('error', () => reject(fail('INPUT_FAILED', '本机输入连接已中断。')));
    if (origin !== ORIGIN) reject(fail('FORBIDDEN_EXTENSION', '此扩展未被允许连接梦藏。'));
  });
}
if (require.main === module) runNativeHost().then(() => {process.exitCode = 0;}, () => {process.exitCode = 1;});
module.exports = {HOST_NAME, EXTENSION_ID, ORIGIN, MAX_INPUT, encodeMessage, validateRequest, readConfig, handleRequest, runNativeHost};
