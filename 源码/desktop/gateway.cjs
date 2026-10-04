'use strict';
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { X509Certificate, randomUUID } = require('node:crypto');
const DEFAULT_VAULT = '/Users/rabbit/Documents/ChatGPT/个人AiOS系统/personal-ai-os-vault';
const PREFIX = '/mengcang/v1';
const JSON_LIMIT = 10 * 1024 * 1024;
const BINARY_LIMIT = 64 * 1024 * 1024;
class GatewayError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = 'GatewayError'; this.code = code; this.status = status; }
}
function canonicalPath(value) { try { return fs.realpathSync(value); } catch { return path.resolve(value); } }
function atLeast(actual, minimum) {
  const found = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(actual || ''); if (!found) return false;
  const a = found.slice(1).map(Number); const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] > b[i]) return true; if (a[i] < b[i]) return false; } return true;
}
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new GatewayError('INVALID_PATH', '文件路径无效');
  return value;
}
function safeNote(value) { safeRelative(value); if (!value.endsWith('.md') || !['01_sources/cards/', '01_sources/books/', '03_projects/'].some(root => value.startsWith(root))) throw new GatewayError('PATH_FORBIDDEN', '笔记不在梦藏允许访问的范围内'); return value; }
function copy(value) { return value == null ? value : structuredClone(value); }
class VaultGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    this.expectedVaultPath = canonicalPath(options.expectedVaultPath || DEFAULT_VAULT);
    this.expectedVaultName = options.expectedVaultName || path.basename(this.expectedVaultPath);
    this.cachePath = options.cachePath || null;
    this.requestTimeoutMs = options.requestTimeoutMs || 8000;
    this.snapshotTimeoutMs = options.snapshotTimeoutMs || 30000;
    this.reconnectDelayMs = options.reconnectDelayMs || 15000;
    this._transport = options.transport || https;
    this._credentials = null; this._identity = null; this._snapshot = null; this._related = {};
    this._requests = new Set(); this._stream = null; this._streamToken = 0; this._connecting = null; this._generation = 0;
    this._paused = false; this._disposed = false; this._state = { connected: false, paired: false, identity: null, message: '尚未连接 Obsidian', code: 'UNPAIRED' };
    this._readCache(); if (options.credentials) this.configure(options.credentials);
  }
  configure(credentials) {
    if (this._disposed) throw new GatewayError('DISPOSED', '连接已经关闭');
    if (!credentials || typeof credentials !== 'object' || !Number.isInteger(credentials.port) || credentials.port < 1 || credentials.port > 65535 || typeof credentials.token !== 'string' || !credentials.token || credentials.token.length > 16384 || /[\r\n]/.test(credentials.token) || typeof credentials.ca !== 'string' || credentials.ca.length > 100000) throw new GatewayError('INVALID_CREDENTIALS', '本机接口配置不完整');
    let certificate; try { certificate = new X509Certificate(credentials.ca); } catch { throw new GatewayError('INVALID_CERTIFICATE', '本机证书无效，请重新配对'); }
    // Version 5.2.0 supplies a CA without a subjectAltName and a distinct signed
    // server leaf. Hostnames belong to that leaf, never to the trust authority.
    let leaf = null;
    if (credentials.serverCert !== undefined) {
      if (typeof credentials.serverCert !== 'string' || credentials.serverCert.length > 100000) throw new GatewayError('INVALID_CERTIFICATE', '服务器证书格式无效');
      try { leaf = new X509Certificate(credentials.serverCert); } catch { throw new GatewayError('INVALID_CERTIFICATE', '服务器证书无法读取'); }
      if (!certificate.ca || leaf.ca && leaf.fingerprint256 !== certificate.fingerprint256) throw new GatewayError('INVALID_CERTIFICATE', '本机 CA 或服务器证书角色不正确');
      const now = Date.now();
      if (![certificate, leaf].every(cert => Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo))) throw new GatewayError('INVALID_CERTIFICATE', '本机配对证书已过期或尚未生效，请重新配对');
      if (!leaf.checkIssued(certificate) || !leaf.verify(certificate.publicKey)) throw new GatewayError('INVALID_CERTIFICATE', '服务器证书并非由已配对的本机 CA 签发');
    }
    const namedCertificate = leaf || certificate;
    const servername = namedCertificate.checkIP('127.0.0.1') ? undefined : namedCertificate.checkHost('localhost') ? 'localhost' : undefined;
    if (leaf && !leaf.checkIP('127.0.0.1') && !leaf.checkHost('localhost')) throw new GatewayError('INVALID_CERTIFICATE', '服务器证书未包含本机地址');
    // Without an explicit leaf, normal TLS IP verification still runs during
    // the handshake. A CA with no SAN is not itself a configuration error.
    if (credentials.vaultId !== undefined && (typeof credentials.vaultId !== 'string' || !/^[\w-]{8,200}$/.test(credentials.vaultId))) throw new GatewayError('INVALID_CREDENTIALS', '仓库配对标识无效');
    this._generation++; this._connecting = null;
    for (const request of this._requests) request.destroy(new GatewayError('RECONFIGURED', '连接配置已更改，请重新连接后核对')) ;
    this._closeStream(); clearTimeout(this._retryTimer); this._retryTimer = null;
    this._credentials = { port: credentials.port, token: credentials.token, ca: credentials.ca, ...(leaf ? { serverCert: credentials.serverCert, serverFingerprint: leaf.fingerprint256, validFrom: Math.max(Date.parse(certificate.validFrom), Date.parse(leaf.validFrom)), validTo: Math.min(Date.parse(certificate.validTo), Date.parse(leaf.validTo)) } : {}), ...(credentials.vaultId ? { vaultId: credentials.vaultId } : {}), ...(servername ? { servername } : {}) };
    this._paused = false;
    if (!this._cacheUsable()) this._identity = null; else this._identity = copy(this._snapshot.identity);
    this._setState({ connected: false, paired: Boolean(this._credentials.vaultId), identity: this._identity, message: '等待连接 Obsidian', code: 'DISCONNECTED' });
  }
  getPairedCredentials() { return this._credentials ? { port: this._credentials.port, token: this._credentials.token, ca: this._credentials.ca, ...(this._credentials.serverCert ? { serverCert: this._credentials.serverCert } : {}), ...(this._credentials.vaultId ? { vaultId: this._credentials.vaultId } : {}) } : null; }
  status() { return copy(this._state); }
  _setState(patch) {
    const next = { ...this._state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this._state)) return;
    this._state = next; this.emit('status', this.status());
  }
  _verifyIdentity(identity, checkBound = true) {
    if (!identity || typeof identity !== 'object' || typeof identity.path !== 'string' || !path.isAbsolute(identity.path) || canonicalPath(identity.path) !== this.expectedVaultPath || identity.name !== this.expectedVaultName) throw new GatewayError('WRONG_VAULT', '连接的不是已指定的 Personal AI OS，已阻止写入');
    if (typeof identity.id !== 'string' || !/^[\w-]{8,200}$/.test(identity.id) || identity.id.startsWith('unpaired-')) throw new GatewayError('INVALID_IDENTITY', '梦藏连接器尚未绑定此仓库');
    if (identity.protocolVersion !== 1) throw new GatewayError('PROTOCOL_MISMATCH', '梦藏连接器版本不匹配，请更新连接器');
    if (!atLeast(identity.appVersion, '1.13.1')) throw new GatewayError('OBSIDIAN_VERSION', '需要实际运行 Obsidian 1.13.1 或更新版本');
    if (checkBound && this._credentials?.vaultId && identity.id !== this._credentials.vaultId) throw new GatewayError('VAULT_ID_CHANGED', '仓库身份与原配对不同，请核对后重新配对');
    return { id: identity.id, name: identity.name, path: canonicalPath(identity.path), appVersion: identity.appVersion, pluginVersion: identity.pluginVersion || '', protocolVersion: 1 };
  }
  async connect() {
    if (this._disposed) throw new GatewayError('DISPOSED', '连接已经关闭');
    if (this._paused) throw new GatewayError('PAUSED', '连接已暂停');
    if (!this._credentials) throw new GatewayError('UNPAIRED', '请先配对 Personal AI OS');
    if (this._connecting) return this._connecting;
    clearTimeout(this._retryTimer); this._retryTimer = null;
    const generation = this._generation;
    this._connecting = (async () => {
      try {
        const identity = this._verifyIdentity(await this._request('GET', '/identity'));
        if (generation !== this._generation) throw new GatewayError('RECONFIGURED', '连接配置已更改，请重新连接后核对');
        if (this._disposed || this._paused) throw new GatewayError('PAUSED', '连接已暂停');
        this._credentials.vaultId = identity.id; this._identity = identity;
        this._setState({ connected: true, paired: true, identity: copy(identity), message: '已连接 Personal AI OS', code: 'CONNECTED' });
        this._startStream(); return copy(identity);
      } catch (error) { if (generation === this._generation) this._failed(error); throw error; }
      finally { if (generation === this._generation) this._connecting = null; }
    })();
    return this._connecting;
  }
  _options(method, endpoint, body) {
    const credentials = this._credentials;
    if (!credentials) throw new GatewayError('UNPAIRED', '请先配对 Personal AI OS');
    if (credentials.serverCert && !(credentials.validFrom <= Date.now() && Date.now() < credentials.validTo)) throw new GatewayError('TLS_ERROR', '本机配对证书已过期或尚未生效，请重新配对');
    const headers = { Authorization: `Bearer ${credentials.token}`, Accept: 'application/json' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    // Electron's BoringSSL cannot validate IP nameConstraints on a CA. Trust
    // only the exact paired leaf after validating its issuer and validity above;
    // TLS still checks validity/hostname and the fingerprint rejects rotation.
    return { protocol: 'https:', hostname: '127.0.0.1', port: credentials.port, method, path: `${PREFIX}${endpoint}`, headers, ca: credentials.serverCert || credentials.ca, ...(credentials.serverCert ? { allowPartialTrustChain: true } : {}), rejectUnauthorized: true, ...(credentials.servername ? { servername: credentials.servername } : {}),
      checkServerIdentity: (hostname, peer) => {
        const hostnameError = tls.checkServerIdentity(hostname, peer); if (hostnameError) return hostnameError;
        if (credentials.serverFingerprint && peer.fingerprint256 !== credentials.serverFingerprint) {
          const error = new Error('The local server certificate changed'); error.code = 'ERR_TLS_CERT_FINGERPRINT_MISMATCH'; return error;
        }
        return undefined;
      }, agent: false };
  }
  _redact(message) {
    let result = typeof message === 'string' ? message.slice(0, 1500) : '请求失败';
    if (this._credentials?.token) result = result.split(this._credentials.token).join('[已隐藏]');
    return result.replace(/-----BEGIN[^]*?-----END[^-]*-----/g, '[已隐藏证书]').replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]');
  }
  _networkError(error) {
    if (error instanceof GatewayError) return error;
    if (['ETIMEDOUT', 'TIMEOUT'].includes(error?.code)) return new GatewayError('TIMEOUT', '连接超时；如正在保存，结果尚未确认，请保留草稿');
    if (error?.code === 'UNSPECIFIED' && /unsupported name constraint type/i.test(error?.message || '')) return new GatewayError('TLS_ERROR', '本机证书约束验证失败，请重新配对');
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(error?.code || '')) return new GatewayError('TLS_ERROR', '本机证书验证失败，请核对配对证书');
    return new GatewayError('OFFLINE', '无法连接 Obsidian，请确认 Personal AI OS 已打开');
  }
  _httpError(status, body) {
    if (status === 401 || status === 403 && !body?.error?.code) return new GatewayError('AUTH_FAILED', '接口凭据无效，请重新配对', status);
    if (status >= 300 && status < 400) return new GatewayError('REDIRECT_REFUSED', '本机接口发生重定向，已停止连接', status);
    if (body?.error?.code) return new GatewayError(String(body.error.code).slice(0, 100), this._redact(body.error.message), status);
    if (status === 404) return new GatewayError('CONNECTOR_UNAVAILABLE', '梦藏连接器未启用或该接口不存在', status);
    return new GatewayError('HTTP_ERROR', `Obsidian 接口请求失败（${status}）`, status);
  }
  _request(method, endpoint, input, { binary = false, timeoutMs = this.requestTimeoutMs } = {}) {
    if (this._disposed || this._paused) return Promise.reject(new GatewayError('PAUSED', '连接已暂停'));
    const encoded = input === undefined ? undefined : JSON.stringify(input);
    const limit=method==='POST'&&endpoint==='/capture'&&input?.attachment?90*1024*1024:1024*1024;
    if (encoded && Buffer.byteLength(encoded) > limit) return Promise.reject(new GatewayError('REQUEST_TOO_LARGE', '提交内容过大'));
    return new Promise((resolve, reject) => {
      let settled = false; let request; let timeout;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); if (request) this._requests.delete(request); error ? reject(this._networkError(error)) : resolve(value); };
      try {
        request = this._transport.request(this._options(method, endpoint, encoded), response => {
          const limit = binary ? BINARY_LIMIT : JSON_LIMIT; const chunks = []; let size = 0;
          if (Number(response.headers['content-length']) > limit) { finish(new GatewayError('RESPONSE_TOO_LARGE', '返回内容过大，已停止读取')); response.destroy(); return; }
          response.on('data', chunk => { size += chunk.length; if (size > limit) { finish(new GatewayError('RESPONSE_TOO_LARGE', '返回内容过大，已停止读取')); response.destroy(); request.destroy(); } else chunks.push(chunk); });
          response.on('aborted', () => finish(new GatewayError('OFFLINE', '连接中断，请保留当前草稿')));
          response.on('error', error => finish(error));
          response.on('end', () => {
            const buffer = Buffer.concat(chunks); let parsed;
            if (!(binary && response.statusCode >= 200 && response.statusCode < 300)) { try { parsed = JSON.parse(buffer.toString('utf8')); } catch { if (response.statusCode >= 200 && response.statusCode < 300) { finish(new GatewayError('INVALID_RESPONSE', '接口返回的内容无法读取')); return; } } }
            if (response.statusCode < 200 || response.statusCode >= 300) { finish(this._httpError(response.statusCode, parsed)); return; }
            finish(null, binary ? { data: buffer, contentType: response.headers['content-type'] || 'application/octet-stream' } : parsed);
          });
        });
        this._requests.add(request); request.on('error', error => finish(error));
        timeout = setTimeout(() => { finish(new GatewayError('TIMEOUT', '连接超时；如正在保存，结果尚未确认，请保留草稿')); request.destroy(); }, timeoutMs);
        if (encoded !== undefined) request.write(encoded); request.end();
      } catch (error) { finish(error); }
    });
  }
  _failed(error) {
    if (this._disposed || this._paused) return;
    const failure = this._networkError(error);
    this._setState({ connected: false, paired: Boolean(this._credentials?.vaultId), identity: copy(this._identity), code: failure.code, message: failure.message });
    this._closeStream(); this._scheduleReconnect();
  }
  _scheduleReconnect() { if (this._disposed || this._paused || !this._credentials || this._retryTimer) return; this._retryTimer = setTimeout(() => { this._retryTimer = null; this.connect().catch(() => {}); }, this.reconnectDelayMs); this._retryTimer.unref?.(); }
  _closeStream() { this._streamToken++; const stream = this._stream; this._stream = null; stream?.destroy(); }
  _startStream() {
    if (this._stream || this._disposed || this._paused) return;
    const token = ++this._streamToken; let request;
    const fail = error => { if (token !== this._streamToken || this._disposed || this._paused) return; this._failed(this._networkError(error)); };
    try {
      const options = this._options('GET', '/events'); options.headers.Accept = 'text/event-stream';
      request = this._transport.request(options, response => {
        if (response.statusCode !== 200) { response.resume(); fail(this._httpError(response.statusCode)); return; }
        if (!(response.headers['content-type'] || '').startsWith('text/event-stream')) { response.destroy(); fail(new GatewayError('INVALID_RESPONSE', '连接器未提供变更通知')); return; }
        let buffer = ''; response.setEncoding('utf8');
        response.on('data', chunk => {
          if (token !== this._streamToken) return; buffer += chunk;
          if (Buffer.byteLength(buffer) > 256 * 1024) { fail(new GatewayError('EVENT_TOO_LARGE', '变更通知过大，已重新连接')); return; }
          let match;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
            let event = 'message'; const data = [];
            for (const line of block.split(/\r?\n/)) { if (line.startsWith('event:')) event = line.slice(6).trim(); if (line.startsWith('data:')) data.push(line.slice(5).trimStart()); }
            if (event === 'change') { try { const payload = JSON.parse(data.join('\n')); if (Number.isSafeInteger(payload.revision)) this.emit('change', { revision: payload.revision }); } catch {} }
          }
        });
        response.on('end', () => fail(new GatewayError('OFFLINE', 'Obsidian 连接已断开，正在重连')));
        response.on('error', fail); response.on('aborted', () => fail(new GatewayError('OFFLINE', 'Obsidian 连接已中断')));
      });
      // Allow delayed background heartbeats while keeping a bounded idle timeout.
      this._stream = request; request.setTimeout?.(135000, () => fail(new GatewayError('TIMEOUT', '变更通知暂时中断，正在重连'))); request.on('error', fail); request.end();
    } catch (error) { fail(error); }
  }
  _cacheUsable() {
    if (!this._snapshot || !this._credentials?.vaultId || this._snapshot.identity?.id !== this._credentials.vaultId) return false;
    try { this._verifyIdentity(this._snapshot.identity); return true; } catch { return false; }
  }
  _readCache() {
    if (!this.cachePath) return;
    try { if (fs.statSync(this.cachePath).size > JSON_LIMIT * 2) return; const cached = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')); if (cached.version !== 1) return; this._verifyIdentity(cached.snapshot?.identity, false); this._snapshot = cached.snapshot; this._related = cached.related || {}; } catch { this._snapshot = null; this._related = {}; }
  }
  _saveCache() {
    if (!this.cachePath || !this._snapshot) return;
    const temporary = `${this.cachePath}.${randomUUID()}.tmp`;
    try { fs.mkdirSync(path.dirname(this.cachePath), { recursive: true, mode: 0o700 }); fs.writeFileSync(temporary, JSON.stringify({ version: 1, snapshot: this._snapshot, related: this._related }), { mode: 0o600 }); fs.renameSync(temporary, this.cachePath); fs.chmodSync(this.cachePath, 0o600); }
    catch { try { fs.unlinkSync(temporary); } catch {} this._setState({ message: '已连接；离线缓存保存失败，请检查本机空间', code: 'CACHE_WRITE_FAILED' }); }
  }
  _requireConnected() { if (!this._state.connected || !this._identity || !this._credentials?.vaultId) throw new GatewayError('OFFLINE', '尚未连接；草稿已保留，请连接后核对再保存'); this._verifyIdentity(this._identity); }
  async snapshot() {
    if (!this._state.connected) { if (this._cacheUsable()) return { ...copy(this._snapshot), offline: true }; throw new GatewayError('OFFLINE_NO_CACHE', '尚未连接，也没有此仓库的离线缓存'); }
    try {
      const snapshot = await this._request('GET', '/snapshot', undefined, { timeoutMs: this.snapshotTimeoutMs });
      this._verifyIdentity(snapshot?.identity); if (!['entries', 'materials', 'books', 'projects', 'errors'].every(key => Array.isArray(snapshot[key])) || snapshot.capabilities?.schedule === true && !Array.isArray(snapshot.schedules)) throw new GatewayError('INVALID_RESPONSE', '仓库数据格式不正确');
      this._snapshot = { ...snapshot, offline: false }; this._saveCache(); return copy(this._snapshot);
    } catch (error) { this._failed(error); if (this._cacheUsable()) return { ...copy(this._snapshot), offline: true }; throw error; }
  }
  async readNote(notePath) {
    safeNote(notePath);
    if (!this._state.connected) { const note = this._cacheUsable() && [...this._snapshot.entries, ...this._snapshot.materials, ...this._snapshot.books, ...(this._snapshot.capabilities?.schedule === true ? this._snapshot.schedules || [] : [])].find(note => note.path === notePath); if (note) return { ...copy(note), offline: true }; throw new GatewayError('OFFLINE_NOTE_MISSING', '离线缓存中没有此笔记'); }
    return this._call('GET', `/note?path=${encodeURIComponent(notePath)}`);
  }
  async related(notePath) {
    safeNote(notePath);
    if (!this._state.connected) { if (this._cacheUsable() && this._related[notePath]) return { ...copy(this._related[notePath]), offline: true }; throw new GatewayError('OFFLINE_RELATIONS_MISSING', '这篇笔记的关联尚未缓存，请连接后查看'); }
    const result = await this._call('GET', `/related?path=${encodeURIComponent(notePath)}`); this._related[notePath] = result; this._saveCache(); return result;
  }
  async _call(method, endpoint, input, options) {
    this._requireConnected();
    try { return await this._request(method, endpoint, input, options); }
    catch (error) { if (['OFFLINE', 'TIMEOUT', 'TLS_ERROR', 'AUTH_FAILED', 'WRONG_VAULT', 'VAULT_ID_CHANGED', 'INVALID_IDENTITY', 'PROTOCOL_MISMATCH'].includes(error.code)) this._failed(error); throw error; }
  }
  _operation(input) { if (!input || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId || '')) throw new GatewayError('INVALID_OPERATION', '缺少稳定操作标识，请保留草稿后重试'); }
  async save(input) { this._requireConnected(); this._operation(input); safeNote(input.path); if (!['fields', 'exploration'].includes(input.kind)) throw new GatewayError('INVALID_OPERATION', '不支持此保存操作'); return this._call('POST', '/mutate', { ...input, vaultId: this._identity.id }); }
  async capture(input) {
    this._requireConnected(); this._operation(input);
    if (!this._cacheUsable() || this._snapshot.capabilities?.capture !== true) throw new GatewayError('CAPTURE_UNAVAILABLE','当前连接器尚未提供采集保存，请更新连接器后刷新；草稿仍保留在本机');
    if(input.attachment){
      if(this._snapshot.capabilities.captureAttachment!==true)throw new GatewayError('CAPTURE_ATTACHMENT_UNAVAILABLE','当前连接器尚不支持原文件入库；原文件和草稿仍保留在本机');
      require('./attachment-validation.cjs').normalizeWorkspaceAttachment(input.attachment);
    }
    if (input.sourcePath) safeNote(input.sourcePath);
    return this._call('POST','/capture',{...input,vaultId:this._identity.id},{timeoutMs:input.attachment?this.snapshotTimeoutMs:this.requestTimeoutMs});
  }
  async scheduleSave(input) {
    this._requireConnected(); this._operation(input);
    if (!this._cacheUsable() || this._snapshot.capabilities?.schedule !== true) throw new GatewayError('SCHEDULE_UNAVAILABLE', '当前连接器尚未提供日程功能，请更新连接器并刷新');
    if (!['create', 'update'].includes(input.action) || typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) throw new GatewayError('INVALID_OPERATION', '日程操作或标识无效');
    if ((input.schemaVersion === 2 || ['workState','focusDate','focusOrder','progressNote','progressUpdatedAt','waitingReason','dueAt'].some(key => Object.hasOwn(input.fields || {}, key))) && !(this._snapshot.capabilities.workOverview === true && this._snapshot.capabilities.scheduleSchemaVersion === 2)) throw new GatewayError('WORK_OVERVIEW_UNAVAILABLE', '当前连接器不支持工作总览字段；原有日程功能仍可使用，请更新连接器后重新检查');
    return this._call('POST', '/schedule', { ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}), action: input.action, id: input.id, operationId: input.operationId, expectedHash: input.expectedHash, fields: input.fields, vaultId: this._identity.id });
  }
  async relation(input) { this._requireConnected(); this._operation(input); safeNote(input.sourcePath); safeNote(input.targetPath); if (!['confirm', 'revoke'].includes(input.action)) throw new GatewayError('INVALID_OPERATION', '不支持此关系操作'); return this._call('POST', '/relation', { ...input, vaultId: this._identity.id }); }
  async openNote(notePath) { this._requireConnected(); safeNote(notePath); return this._call('POST', '/open', { path: notePath, vaultId: this._identity.id }); }
  async original(notePath) { safeNote(notePath); return this._call('GET', `/original?path=${encodeURIComponent(notePath)}`); }
  async attachment(attachmentPath) { safeRelative(attachmentPath); if (!attachmentPath.startsWith('01_sources/')) throw new GatewayError('PATH_FORBIDDEN', '不允许读取此附件'); return this._call('GET', `/attachment?path=${encodeURIComponent(attachmentPath)}`, undefined, { binary: true, timeoutMs: this.snapshotTimeoutMs }); }
  pause() { if (this._disposed) return; this._paused = true; this._generation++; this._connecting = null; clearTimeout(this._retryTimer); this._retryTimer = null; this._closeStream(); for (const request of this._requests) request.destroy(new GatewayError('PAUSED', '连接已暂停')); this._setState({ connected: false, code: 'PAUSED', message: '连接已暂停，保留离线内容与草稿' }); }
  resume() { if (this._disposed) return Promise.reject(new GatewayError('DISPOSED', '连接已经关闭')); this._paused = false; return this.connect(); }
  dispose() { this.pause(); this._disposed = true; this.removeAllListeners(); }
}
module.exports = { VaultGateway, GatewayError, atLeast, safeRelative, safeNote, DEFAULT_VAULT };
