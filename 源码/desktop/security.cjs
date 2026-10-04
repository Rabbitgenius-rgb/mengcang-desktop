'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createHash, randomUUID, X509Certificate } = require('node:crypto');
const PRODUCTION_VAULT = '/Users/rabbit/Documents/ChatGPT/个人AiOS系统/personal-ai-os-vault';
function fail(message, code = 'INVALID_REQUEST') { const error = new Error(message); error.code = code; throw error; }
function relative(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value || /[\\\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) fail('文件路径无效');
  return value;
}
function inside(root, file) { const diff = path.relative(root, file); return diff !== '..' && !diff.startsWith(`..${path.sep}`) && !path.isAbsolute(diff); }
function bundleFile(root, url) {
  const parsed = new URL(url); if (parsed.protocol !== 'mengcang:' || parsed.hostname !== 'app') fail('不允许访问此页面');
  const requested = decodeURIComponent(parsed.pathname);
  if (requested.includes('\0') || requested.includes('\\')) fail('文件路径无效');
  const target = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
  if (!inside(root, target)) fail('文件路径无效');
  const actual = fs.realpathSync(target); if (!inside(fs.realpathSync(root), actual)) fail('文件路径无效');
  return actual;
}
function trustedFrame(event) { return event?.senderFrame?.url?.startsWith('mengcang://app/') && event.senderFrame === event.sender.mainFrame; }
function draftName(key) { if (typeof key !== 'string' || !key || key.length > 8192) fail('草稿标识无效'); return `${createHash('sha256').update(key).digest('hex')}.json`; }
function jsonValue(value, maxBytes = 1024 * 1024) { const data = JSON.stringify(value); if (data === undefined || Buffer.byteLength(data) > maxBytes) fail('内容过大，未保存'); return data; }
function captureJson(value) {
  if(value?.attachment){require('./attachment-validation.cjs').normalizeWorkspaceAttachment(value.attachment);return jsonValue(value,90*1024*1024);}
  return jsonValue(value);
}
function readPairing(vaultPath = PRODUCTION_VAULT) {
  const actual = fs.realpathSync(vaultPath);
  const settingsPath = path.join(actual, '.obsidian/plugins/obsidian-local-rest-api/data.json');
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch(error) { if(error.code==='ENOENT')throw error; fail('连接设置无法读取，请在 Obsidian 检查 Local REST API 设置', 'INVALID_CONFIGURATION'); }
  if ((settings.bindingHost || '127.0.0.1') !== '127.0.0.1' || settings.enableInsecureServer === true || settings.enableSecureServer === false) fail('请将 Local REST API 设置为仅本机 HTTPS 连接', 'UNSAFE_CONNECTION');
  if (!settings.apiKey || !settings.crypto?.cert) fail('Obsidian 连接插件尚未准备好，请启用 Local REST API 和梦藏连接器', 'NOT_CONFIGURED');
  const ca = settings.crypto.caCert || settings.crypto.cert;
  const certificate = new X509Certificate(ca);
  const port = settings.port || 27124;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('连接端口无效');
  return { credentials: { port, token: settings.apiKey, ca, serverCert: settings.crypto.cert }, path: actual, fingerprint: certificate.fingerprint256 };
}
function createPrivateWriteQueue() {
  const pending = new Map();
  const failures = new Map();
  function run(file, task, write = true) {
    const key = path.resolve(file);
    const operation = (pending.get(key) || Promise.resolve()).catch(() => {}).then(async()=>{
      try { const value=await task();if(write)failures.delete(key);return value; }
      catch(error) { if(write)failures.set(key,{task,error});throw error; }
    });
    pending.set(key, operation);
    operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    return operation;
  }
  async function drain() {
    // A typing event or read may arrive while the first batch is settling.
    // Recheck the map instead of draining only a stale snapshot of promises.
    const results = [];
    while (pending.size) results.push(...await Promise.allSettled([...pending.values()]));
    return results;
  }
  async function retryFailures() { const jobs=[...failures.entries()];await Promise.allSettled(jobs.map(([file,{task}])=>run(file,task)));return drain(); }
  return { run, read:(file,task)=>run(file,task,false), drain, retryFailures, hasFailed:file=>failures.has(path.resolve(file)), get failed() { return failures.size; }, get size() { return pending.size; } };
}
async function atomicPrivate(file, contents) {
  await fs.promises.mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temp, contents, {mode:0o600,flag:'wx'});
    await fs.promises.rename(temp, file);
    await fs.promises.chmod(file, 0o600);
  } finally {
    await fs.promises.rm(temp, {force:true}).catch(() => {});
  }
}
module.exports = { PRODUCTION_VAULT, relative, inside, bundleFile, trustedFrame, draftName, jsonValue, captureJson, readPairing, atomicPrivate, createPrivateWriteQueue, fail };
