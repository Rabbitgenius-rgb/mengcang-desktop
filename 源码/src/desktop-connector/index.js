'use strict';
const fs = require('node:fs');
const pathModule = require('node:path');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { ConnectorError, hash, splitNote, frontmatterOf, mutateNote, validateOperation } = require('./notes');
const { SCHEDULE_ROOT, isSchedulePath, assertSchedulePath, validateScheduleInput, toSchedule, createSchedule, updateSchedule, hasScheduleOperation, assertScheduleLocation } = require('./schedule');
const { ATTACHMENT_TYPES, capturePaths, validateCaptureInput, assertCaptureLocation, hasCaptureOperation, createCapture } = require('./capture');
const { rankCandidates, makePairKey, makeRelationId } = require('../../star-sea/core');
const PRODUCTION_VAULT = '/Users/rabbit/Documents/ChatGPT/个人AiOS系统/personal-ai-os-vault';
const PREFIX = '/mengcang/v1';
const CARD_ROOTS = ['01_sources/cards/images/', '01_sources/cards/text/', '01_sources/cards/web/'];
const BOOK_ROOT = '01_sources/books/';
const REGISTRY = '_meta/projects.json';
const asText = value => value == null ? '' : String(value);
const asList = value => Array.isArray(value) ? value.map(asText).filter(Boolean) : value ? [asText(value)] : [];
const notePath = value => typeof value === 'string' && value.endsWith('.md') && (CARD_ROOTS.some(root => value.startsWith(root)) || value.startsWith(BOOK_ROOT) || value.startsWith('03_projects/'));
function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(value)) throw new ConnectorError('INVALID_PATH', '文件路径无效', 400);
  return value;
}
function assertNotePath(value) { safeRelative(value); if (!notePath(value)) throw new ConnectorError('PATH_FORBIDDEN', '此笔记不在梦藏允许访问的范围内', 403); if (isSchedulePath(value)) assertSchedulePath(value); return value; }
function unwrapped(value) {
  let raw = asText(value).trim();
  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(raw);
  if (wiki) raw = wiki[1];
  return raw;
}
function explorations(body) {
  return [...body.matchAll(/<!-- mengcang:exploration (\{[^\n]*\}) -->/g)].map(match => { try { return JSON.parse(match[1]); } catch { return null; } }).filter(item => item?.id && typeof item.text === 'string');
}
function loopback(address) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }
function safeHttp(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function errorBody(error) { return { error: { code: error.code || (error.repairNeeded ? 'RELATION_REPAIR_REQUIRED' : 'REQUEST_FAILED'), message: error.message || '请求失败', ...(error.details ? { details: error.details } : {}) } }; }
class DesktopConnector {
  constructor(plugin, options = {}) {
    this.plugin = plugin; this.app = plugin.app; this.options = options;
    // A test Vault is allowed only through the constructor, never via an HTTP request.
    this.expectedVaultPath = options.testVaultPath || PRODUCTION_VAULT;
    this.identity = null; this.api = null; this.restHost = null; this.disposed = false;
    this.clients = new Set(); this.unsubscribers = []; this.revision = 0; this.cache = null; this.queue = Promise.resolve(); this.status = 'starting';
  }
  async start() {
    const actualPath = this.app.vault.adapter.getBasePath?.();
    if (!actualPath) throw new ConnectorError('UNSUPPORTED_VAULT', '梦藏桌面仅支持本机文件仓库', 409);
    this.actualVaultPath = fs.realpathSync(actualPath);
    const data = await this.plugin.loadData() || {};
    let id = data.desktopConnector?.vaultId;
    if (!id) {
      let expected; try { expected = fs.realpathSync(this.expectedVaultPath); } catch { expected = pathModule.resolve(this.expectedVaultPath); }
      if (this.actualVaultPath === expected) {
        id = `mc-vault-${randomUUID()}`;
        await this.plugin.updateMengcangData(raw => ({ ...raw, desktopConnector: { ...raw.desktopConnector, vaultId: id } }));
      } else id = `unpaired-${hash(this.actualVaultPath).slice(0, 24)}`;
    }
    const runtimeVersion = this.options.appVersion || require('obsidian').apiVersion || this.app.version || '';
    this.identity = { id, name: this.app.vault.getName(), path: this.actualVaultPath, appVersion: runtimeVersion, pluginVersion: this.plugin.manifest.version, protocolVersion: 1 };
    const markChanged = file => { if (!file || notePath(file.path) || file.path === REGISTRY || file.path === SCHEDULE_ROOT.slice(0, -1) || isSchedulePath(file.path) || CARD_ROOTS.some(root => file.path?.startsWith(root)) || file.path?.startsWith(BOOK_ROOT) || file.path?.startsWith('01_sources/_originals/')) this.invalidate(); };
    for (const event of ['create', 'modify', 'delete']) {
      const ref = this.app.vault.on(event, markChanged); this.unsubscribers.push(() => this.app.vault.offref(ref));
    }
    const ref = this.app.vault.on('rename', (file, oldPath) => { markChanged(file); markChanged({ path: oldPath }); });
    this.unsubscribers.push(() => this.app.vault.offref(ref));
    this.tryRegister(); this.timer = setInterval(() => this.tryRegister(), 2000);
    this.heartbeat = setInterval(() => { for (const response of this.clients) { try { response.write(': heartbeat\n\n'); } catch { this.clients.delete(response); } } }, 20000);
  }
  assertVault(vaultId) {
    let expected; try { expected = fs.realpathSync(this.expectedVaultPath); } catch { expected = pathModule.resolve(this.expectedVaultPath); }
    if (this.actualVaultPath !== expected || vaultId !== this.identity?.id) throw new ConnectorError('WRONG_VAULT', '连接的仓库与 Personal AI OS 不一致，已阻止写入', 403);
  }
  invalidate() { this.cache = null; this.revision++; for (const response of this.clients) { try { response.write(`event: change\ndata: ${JSON.stringify({ revision: this.revision })}\n\n`); } catch { this.clients.delete(response); } } }
  tryRegister() {
    if (this.disposed) return;
    const host = this.app.plugins?.plugins?.['obsidian-local-rest-api'];
    if (host === this.restHost && this.api) return;
    if (this.api) { try { this.api.unregister(); } catch {} this.api = null; }
    if (!host?.getPublicApi) { this.restHost = null; this.status = 'rest-unavailable'; return; }
    try {
      // getPublicApi + addRoute are the tagged 5.2.0 extension API. No public routes.
      this.api = host.getPublicApi(this.plugin.manifest); this.restHost = host;
      this.route('get', '/identity', async () => this.identity);
      this.route('get', '/snapshot', async () => this.snapshot());
      this.route('get', '/note', async request => this.readNote(request.query.path));
      this.route('get', '/related', async request => this.related(request.query.path));
      this.route('get', '/original', async request => this.original(request.query.path));
      this.route('post', '/mutate', async request => this.mutate(request.body));
      this.route('post', '/schedule', async request => this.scheduleSave(request.body));
      this.route('post', '/capture', async request => this.capture(request.body));
      this.route('post', '/relation', async request => this.relation(request.body));
      this.route('post', '/open', async request => {
        this.assertVault(request.body?.vaultId); const file = this.file(request.body?.path);
        await this.app.workspace.getLeaf('tab').openFile(file); return { opened: true };
      });
      this.route('get', '/attachment', async (request, response) => {
        const result = await this.attachment(request.query.path);
        response.set('Content-Type', result.contentType).set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').send(result.data); return null;
      });
      this.route('get', '/events', async (request, response) => {
        response.status(200).set('Content-Type', 'text/event-stream').set('Cache-Control', 'no-store').set('Connection', 'keep-alive');
        response.flushHeaders?.(); response.write(`event: ready\ndata: ${JSON.stringify({ revision: this.revision })}\n\n`);
        this.clients.add(response); response.on('close', () => this.clients.delete(response)); return null;
      });
      this.status = 'ready';
    } catch (error) { this.status = 'registration-failed'; this.lastError = error.message; try { this.api?.unregister(); } catch {} this.api = null; }
  }
  route(method, endpoint, handler) {
    this.api.addRoute(`${PREFIX}${endpoint}`)[method](async (request, response) => {
      try {
        if (!loopback(request.socket?.remoteAddress || request.connection?.remoteAddress)) throw new ConnectorError('LOCAL_ONLY', '只允许本机连接', 403);
        if (this.disposed) throw new ConnectorError('DISCONNECTED', '连接器已关闭', 503);
        const result = await handler(request, response);
        if (result !== null && !response.headersSent) response.set('Cache-Control', 'no-store').json(result);
      } catch (error) { if (!response.headersSent) response.status(error.status || 500).json(errorBody(error)); else response.end(); }
    });
  }
  file(value) {
    const relative = assertNotePath(value); const file = this.app.vault.getAbstractFileByPath(relative);
    if (!file || file.extension !== 'md') throw new ConnectorError('NOT_FOUND', '笔记已移动或删除', 404);
    if (isSchedulePath(relative)) assertScheduleLocation(this.actualVaultPath, relative);
    if (this.actualVaultPath) {
      const absolute = pathModule.join(this.actualVaultPath, relative);
      if (fs.existsSync(absolute) && !fs.realpathSync(absolute).startsWith(`${this.actualVaultPath}${pathModule.sep}`)) throw new ConnectorError('PATH_FORBIDDEN', '笔记不能通过文件链接指向仓库之外', 403);
    }
    return file;
  }
  attachmentPath(value, sourcePath) {
    const raw = unwrapped(value); if (!raw || /^(?:https?:|file:|\/)/.test(raw)) return '';
    try { safeRelative(raw); } catch { return ''; }
    const file = this.app.vault.getAbstractFileByPath(raw) || this.app.metadataCache.getFirstLinkpathDest?.(raw, sourcePath);
    return file?.path || raw;
  }
  toNote(file, markdown) {
    if (isSchedulePath(file.path)) return toSchedule(file.path, markdown);
    const fields = frontmatterOf(markdown); const body = splitNote(markdown).body;
    const title = asText(fields.title || file.basename);
    const base = { id: asText(fields.id || fields.material_id || file.path), path: file.path, title, hash: hash(markdown), fields, body, markdown,
      tags: asList(fields.tags), projectIds: asList(fields.project_ids || fields.project_id), description: asText(fields.caption ?? fields.summary ?? fields.description), explorations: explorations(body),
      searchText: [title, fields.caption, fields.summary, fields.description, ...asList(fields.tags), body].map(asText).join(' ').toLocaleLowerCase('zh-CN') };
    if (fields.record_type === 'inspiration') return { ...base, kind: 'entry', role: asText(fields.role || 'seed'), roleStatus: asText(fields.role_status || 'pending'), category: asText(fields.category || 'inspiration'), summaryStatus: asText(fields.summary_status || 'pending'), linkedPaths: asList(fields.link_notes), materialPaths: asList(fields.material_notes), sourceId: asText(fields.source_id), sourcePath: asText(fields.source_original_path), sourceChanged: fields.source_changed === true, servesProjectId: asText(fields.serves_project_id) };
    if (file.path.startsWith(BOOK_ROOT)) return { ...base, kind: 'book', author: asText(fields.author || fields.authors), coverPath: this.attachmentPath(fields.cover, file.path), originalPath: unwrapped(fields.source_file || fields.pdf), readingStatus: asText(fields.reading_status), pages: Number(fields.pages || fields.source_pages) || 0, collection: asText(fields.collection), volume: Number(fields.volume) || 0 };
    const kind = file.path.startsWith('01_sources/cards/images/') ? 'image' : file.path.startsWith('01_sources/cards/web/') ? 'web' : file.path.startsWith('03_projects/') ? 'project' : 'text';
    if (kind === 'image') {
      // A generated color card can cite JSON as its source while its image is
      // explicitly stored in cover. Keep that provenance separate from display.
      const originalPath = this.attachmentPath(fields.original_file || fields.source_file, file.path);
      const imagePath = value => { const resolved = this.attachmentPath(value, file.path); return /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i.test(resolved) ? resolved : ''; };
      const coverPath = imagePath(fields.cover);
      return { ...base, kind, url: safeHttp(fields.source_url || fields.url), originalPath, coverPath, attachmentPath: coverPath || imagePath(originalPath) || imagePath(fields.snapshot_path) || imagePath(fields.capture_path) };
    }
    return { ...base, kind, url: safeHttp(fields.source_url || fields.url), attachmentPath: this.attachmentPath(fields.original_file || fields.snapshot_path || fields.capture_path || fields.cover, file.path) };
  }
  async readNote(path) { const file = this.file(path); try { return this.toNote(file, await this.app.vault.read(file)); } catch (error) { if (error instanceof ConnectorError) throw error; throw new ConnectorError('READ_FAILED', '无法读取笔记，请检查文件状态', 500); } }
  async snapshot() {
    if (this.cache) return this.cache;
    const revision = this.revision; const errors = []; const entries = []; const materials = []; const books = []; const schedules = [];
    const records = await Promise.all(this.app.vault.getMarkdownFiles().filter(file => CARD_ROOTS.some(root => file.path.startsWith(root)) || file.path.startsWith(BOOK_ROOT) || isSchedulePath(file.path)).map(async file => {
      try { const note = await this.readNote(file.path); return note.kind === 'schedule' || note.fields.type === 'material' || note.fields.type === 'book' || note.fields.record_type === 'inspiration' ? note : null; }
      catch (error) { errors.push({ path: file.path, ...errorBody(error).error }); return null; }
    }));
    for (const note of records.filter(Boolean)) { if (note.kind === 'schedule') schedules.push(note); else if (note.kind === 'entry') entries.push(note); else if (note.kind === 'book') books.push(note); else materials.push(note); }
    let projects = [];
    try { const registry = JSON.parse(await this.app.vault.adapter.read(REGISTRY)); if (!Array.isArray(registry.projects)) throw new Error('schema'); projects = registry.projects.map(project => ({ id: asText(project.id), name: asText(project.name), title: asText(project.name), path: asText(project.vault_brief || project.path), description: asText(project.summary), sourcePaths: asList(project.source_paths || project.source_notes), goal: asText(project.goal) })); }
    catch { errors.push({ path: REGISTRY, code: 'REGISTRY_READ_FAILED', message: '无法读取项目注册表' }); }
    const result = { identity: this.identity, entries, materials, books, projects, schedules, capabilities: { schedule: true, scheduleSchemaVersion: 2, workOverview: true, capture: true, captureAttachment: true }, revision, errors, repair: this.plugin.starSea.getPendingTransaction() };
    if (revision === this.revision) this.cache = result; return result;
  }
  async related(path) {
    if (isSchedulePath(path)) throw new ConnectorError('UNSUPPORTED_RELATION', '日程使用单向来源引用，不创建知识关系', 400);
    const note = await this.readNote(path); const snapshot = await this.snapshot();
    const all = [...snapshot.entries, ...snapshot.materials, ...snapshot.books].map(item => ({ ...item, rawMarkdown: item.markdown, summary: item.description }));
    const anchor = { ...note, rawMarkdown: note.markdown }; const confirmedRaw = this.plugin.starSea.getConfirmed(anchor, all);
    const confirmed = confirmedRaw.map(item => ({ relationId: item.relationId, peerPath: item.peerPath, peerTitle: item.peerTitle, explanation: item.explanation, origin: item.origin, confirmedAt: item.confirmedAt, targetHash: all.find(note => note.path === item.peerPath)?.hash }));
    // Pure local ranking: viewing never writes candidate caches or calls a model.
    const ranked = rankCandidates(anchor, all, { limit: 6, confirmedPairKeys: confirmed.map(item => makePairKey(path, item.peerPath)), ignoredPairKeys: this.plugin.starSea.getState().ignoredPairs });
    const rankedCandidates = ranked.map(item => ({ targetPath: item.candidate.path, targetTitle: item.candidate.title, targetKind: item.candidate.kind, targetHash: item.candidate.hash, explanation: item.explanation, reasons: item.reasons, score: item.score, origin: 'local', status: 'pending' }));
    const confirmedPaths = new Set(confirmed.map(item => item.peerPath));
    const ignoredPairs = new Set(this.plugin.starSea.getState().ignoredPairs);
    const imported = (Array.isArray(note.fields.relation_candidates) ? note.fields.relation_candidates : []).filter(item => item.status === 'pending' && item.target_path && !confirmedPaths.has(item.target_path) && !ignoredPairs.has(makePairKey(path, item.target_path))).map(item => {
      const target = all.find(target => target.path === item.target_path);
      return target ? { id: asText(item.id), targetPath: target.path, targetTitle: target.title, targetKind: target.kind, targetHash: target.hash, explanation: asText(item.reason), reasons: ['旧整理中保留的待确认联系'], score: 0, origin: 'preview', status: 'pending' } : null;
    }).filter(Boolean);
    const importedPaths = new Set(imported.map(item => item.targetPath));
    const candidates = [...imported, ...rankedCandidates.filter(item => !importedPaths.has(item.targetPath))];
    return { candidates, confirmed, repair: this.plugin.starSea.getPendingTransaction(), sourceHash: note.hash };
  }
  async attachment(value) {
    const path = safeRelative(value);
    const extension = path.split('.').pop().toLowerCase();
    const types = { ...ATTACHMENT_TYPES, jpeg:'image/jpeg',tif:'image/tiff',svg:'image/svg+xml' };
    if (!(path.startsWith('01_sources/_originals/') || path.startsWith('01_sources/books/') || path.startsWith('01_sources/cards/')) || !types[extension]) throw new ConnectorError('PATH_FORBIDDEN', '不允许读取此附件', 403);
    const file = this.app.vault.getAbstractFileByPath(path); if (!file?.extension) throw new ConnectorError('ATTACHMENT_MISSING', '附件未找到，请在 Obsidian 中检查路径', 404);
    let actual; try { actual = fs.realpathSync(pathModule.join(this.actualVaultPath, path)); } catch { throw new ConnectorError('ATTACHMENT_MISSING', '附件未下载、已移动或无法读取', 404); }
    if (!actual.startsWith(`${this.actualVaultPath}${pathModule.sep}`)) throw new ConnectorError('PATH_FORBIDDEN', '附件不能指向仓库之外', 403);
    if(fs.statSync(actual).size>64*1024*1024)throw new ConnectorError('ATTACHMENT_TOO_LARGE','附件超过64MiB，请使用原文件打开方式',413);
    try { return { data: Buffer.from(await this.app.vault.readBinary(file)), contentType: types[extension] }; } catch { throw new ConnectorError('ATTACHMENT_READ_FAILED', '无法读取附件，请检查本机文件权限', 500); }
  }
  async original(path) {
    const note = await this.readNote(path); if (note.kind === 'web' && note.url) return { kind: 'url', url: note.url };
    let raw = note.kind === 'book' ? note.originalPath : note.attachmentPath;
    if (!raw) throw new ConnectorError('ORIGINAL_MISSING', '笔记尚未关联原文件', 404);
    if (raw.startsWith('file:')) { try { raw = fileURLToPath(raw); } catch { throw new ConnectorError('INVALID_PATH', '原文件路径无效'); } }
    if (!pathModule.isAbsolute(raw)) { safeRelative(raw); raw = pathModule.join(this.actualVaultPath, raw); }
    if (note.kind === 'book' && pathModule.extname(raw).toLowerCase() !== '.pdf') throw new ConnectorError('UNSUPPORTED_ORIGINAL', '本轮仅支持打开已关联的 PDF 原书');
    if (note.kind !== 'book' && !raw.startsWith(`${this.actualVaultPath}${pathModule.sep}`)) throw new ConnectorError('PATH_FORBIDDEN', '素材附件必须位于仓库内', 403);
    try {
      const resolved = fs.realpathSync(raw); if (!fs.statSync(resolved).isFile()) throw new Error('missing');
      if (note.kind !== 'book' && !resolved.startsWith(`${this.actualVaultPath}${pathModule.sep}`)) throw new ConnectorError('PATH_FORBIDDEN', '素材附件不能指向仓库之外', 403);
      return { kind: 'file', path: resolved };
    } catch (error) { if (error instanceof ConnectorError) throw error; throw new ConnectorError('ORIGINAL_MISSING', '原文件已移动或无法读取，请在 Obsidian 中修正来源路径', 404); }
  }
  enqueue(task) { const pending = this.queue.then(task, task); this.queue = pending.catch(() => {}); return pending; }
  async validateScheduleReferences(fields, previous = null) {
    if (fields.projectId && fields.projectId !== previous?.projectId) {
      let registry;
      try { registry = JSON.parse(await this.app.vault.adapter.read(REGISTRY)); } catch { throw new ConnectorError('REGISTRY_READ_FAILED', '无法核对项目注册表，请稍后重试', 409); }
      if (!Array.isArray(registry.projects) || registry.projects.filter(project => project?.id === fields.projectId).length !== 1) throw new ConnectorError('INVALID_SCHEDULE_PROJECT', '所选项目已不存在或标识重复，请重新选择', 409);
    }
    if (fields.sourcePath && fields.sourcePath !== previous?.sourcePath) {
      assertNotePath(fields.sourcePath);
      if (!CARD_ROOTS.some(root => fields.sourcePath.startsWith(root)) && !fields.sourcePath.startsWith(BOOK_ROOT)) throw new ConnectorError('INVALID_SCHEDULE_SOURCE', '日程来源必须是现有灵感、素材或藏书', 400);
      const source = await this.readNote(fields.sourcePath);
      if (!(source.fields?.record_type === 'inspiration' || source.fields?.type === 'material' || source.fields?.type === 'book' && fields.sourcePath.startsWith(BOOK_ROOT))) throw new ConnectorError('INVALID_SCHEDULE_SOURCE', '日程来源必须是现有灵感、素材或藏书', 400);
    }
  }
  async ensureScheduleFolder() {
    for (const folder of ['03_projects', SCHEDULE_ROOT.slice(0, -1)]) {
      if (assertScheduleLocation(this.actualVaultPath, folder, true)) continue;
      try { await this.app.vault.createFolder(folder); }
      catch (error) { if (!assertScheduleLocation(this.actualVaultPath, folder, true)) throw error; }
      assertScheduleLocation(this.actualVaultPath, folder);
    }
  }
  async scheduleSave(raw) {
    this.assertVault(raw?.vaultId);
    const input = validateScheduleInput(raw);
    return this.enqueue(async () => {
      // Check both the filesystem and Obsidian's index. A file that Obsidian
      // has not indexed yet is occupied, never a reason to replace its bytes.
      const exists = assertScheduleLocation(this.actualVaultPath, input.path, true);
      const file = this.app.vault.getAbstractFileByPath(input.path);
      if (exists && !file) throw new ConnectorError('SCHEDULE_PATH_OCCUPIED', '日程路径已有文件但尚未被 Obsidian 读取，请稍后核对', 409);
      let previous = null;
      if (file) {
        const current = await this.app.vault.read(this.file(input.path));
        const item = toSchedule(input.path, current); previous = item;
        if (hasScheduleOperation(current, input)) { this.invalidate(); return { item, operationId: input.operationId }; }
        if (input.action === 'create') throw new ConnectorError('SCHEDULE_PATH_OCCUPIED', '此日程标识已存在，请保留草稿后核对', 409);
      } else if (input.action === 'update') throw new ConnectorError('NOT_FOUND', '日程已移动或删除，草稿仍被保留', 404);
      await this.validateScheduleReferences(input.fields, previous);
      if (input.action === 'create') {
        await this.ensureScheduleFolder();
        if (assertScheduleLocation(this.actualVaultPath, input.path, true) || this.app.vault.getAbstractFileByPath(input.path)) throw new ConnectorError('SCHEDULE_PATH_OCCUPIED', '日程路径已被占用，请保留草稿后核对', 409);
        await this.app.vault.create(input.path, createSchedule(input));
      } else {
        assertScheduleLocation(this.actualVaultPath, input.path);
        await this.app.vault.process(file, current => {
          assertScheduleLocation(this.actualVaultPath, input.path);
          return updateSchedule(current, input);
        });
      }
      this.invalidate();
      return { item: await this.readNote(input.path), operationId: input.operationId };
    });
  }
  async ensureCaptureFolder(folder) {
    let ancestor='';
    for(const part of folder.split('/')){
      ancestor=ancestor?`${ancestor}/${part}`:part;
      if(!assertCaptureLocation(this.actualVaultPath,ancestor,true)){
        try{await this.app.vault.createFolder(ancestor);}catch(error){if(!assertCaptureLocation(this.actualVaultPath,ancestor,true))throw error;}
      }
      assertCaptureLocation(this.actualVaultPath,ancestor);
    }
  }
  async captureOriginal(input,create=false) {
    const original=input.attachment;if(!original)return;
    const folder=original.path.slice(0,original.path.lastIndexOf('/')),name=original.path.slice(folder.length+1);
    if(create)await this.ensureCaptureFolder(folder);
    else assertCaptureLocation(this.actualVaultPath,folder);
    // The operation folder reserves one immutable fingerprint + original hash.
    // It also identifies partial saves after a lost reply, without an overwrite.
    if(fs.readdirSync(pathModule.join(this.actualVaultPath,folder)).some(item=>item!==name))throw new ConnectorError('OPERATION_REUSED','此操作已用于不同的原文件或采集内容，请保留草稿',409);
    const exists=assertCaptureLocation(this.actualVaultPath,original.path,true,true);
    if(!exists){
      if(!create)throw new ConnectorError('ORIGINAL_MISSING','已保存的原文件已移动或删除，请核对仓库',409);
      const bytes=original.bytes;
      try{await this.app.vault.createBinary(original.path,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));}
      catch(error){if(!assertCaptureLocation(this.actualVaultPath,original.path,true,true))throw error;}
    }
    assertCaptureLocation(this.actualVaultPath,original.path,false,true);
    const file=this.app.vault.getAbstractFileByPath(original.path);
    if(!file||file.path!==original.path)throw new ConnectorError('ATTACHMENT_INDEX_NOT_READY','原文件已保存，等待 Obsidian 读取后可重试同一次操作',409);
    if(fs.statSync(pathModule.join(this.actualVaultPath,original.path)).size!==original.size)throw new ConnectorError('ORIGINAL_CONFLICT','原文件字节数已改变，请保留草稿并核对',409);
    const actual=Buffer.from(await this.app.vault.readBinary(file));
    assertCaptureLocation(this.actualVaultPath,original.path,false,true);
    if(hash(actual)!==original.sha256)throw new ConnectorError('ORIGINAL_CONFLICT','原文件内容已改变，请保留草稿并核对',409);
  }
  async capture(raw) {
    this.assertVault(raw?.vaultId);
    const input = validateCaptureInput(raw);
    if (input.sourcePath) assertNotePath(input.sourcePath);
    return this.enqueue(async () => {
      // Search both carriers before returning/reusing an operation identity. A
      // changed URL must not turn one operation into two independent records.
      for (const candidate of capturePaths(input.operationId)) {
        const exists = assertCaptureLocation(this.actualVaultPath, candidate, true);
        const file = this.app.vault.getAbstractFileByPath(candidate);
        if (exists && !file) throw new ConnectorError('CAPTURE_PATH_OCCUPIED', '采集路径已有文件但尚未被 Obsidian 读取，请保留草稿', 409);
        if (file) {
          if (!exists || file.extension !== 'md' || file.path !== candidate) throw new ConnectorError('CAPTURE_PATH_OCCUPIED', '采集目标索引与真实文件不一致', 409);
          const current = await this.app.vault.read(this.file(candidate));
          assertCaptureLocation(this.actualVaultPath, candidate);
          hasCaptureOperation(current, input);
          if(input.attachment&&frontmatterOf(current).original_file!==input.attachment.path)throw new ConnectorError('ORIGINAL_CONFLICT','笔记关联的原文件已改变，请核对仓库',409);
          await this.captureOriginal(input);
          this.invalidate();
          return { note: this.toNote(file, current), operationId: input.operationId, replayed: true };
        }
      }
      const validateSource = async () => {
        if (!input.sourcePath) return;
        assertCaptureLocation(this.actualVaultPath, input.sourcePath);
        const source = await this.readNote(input.sourcePath);
        assertCaptureLocation(this.actualVaultPath, input.sourcePath);
        if (source.hash !== input.expectedSourceHash) throw new ConnectorError('CONFLICT', '来源笔记已有修改，请保留摘录草稿并核对', 409);
      };
      await validateSource();
      await this.ensureCaptureFolder(input.path.slice(0,input.path.lastIndexOf('/')));
      await this.captureOriginal(input,true);
      // Recheck the parent after awaited folder work, before the create. The
      // excerpt records this exact source version without changing the parent.
      await validateSource();
      for (const candidate of capturePaths(input.operationId)) if (assertCaptureLocation(this.actualVaultPath, candidate, true) || this.app.vault.getAbstractFileByPath(candidate)) throw new ConnectorError('CAPTURE_PATH_OCCUPIED', '采集路径已被占用，请保留草稿', 409);
      try { await this.app.vault.create(input.path, createCapture(input)); }
      catch (error) { if (error.code === 'EEXIST') throw new ConnectorError('CAPTURE_PATH_OCCUPIED', '采集路径已被其他内容占用，请保留草稿', 409); throw error; }
      assertCaptureLocation(this.actualVaultPath, input.path);
      this.invalidate();
      return { note: await this.readNote(input.path), operationId: input.operationId, replayed: false };
    });
  }
  async mutate(input) {
    this.assertVault(input?.vaultId); const file = this.file(input?.path); if (!CARD_ROOTS.some(root => file.path.startsWith(root))) throw new ConnectorError('READ_ONLY_RECORD', '本轮暂不修改书籍与项目属性', 403); validateOperation(input);
    return this.enqueue(async () => { await this.app.vault.process(file, current => mutateNote(current, input)); this.invalidate(); await this.plugin.inspirations?.refreshNow(); return { note: await this.readNote(file.path), operationId: input.operationId }; });
  }
  async relation(input) {
    this.assertVault(input?.vaultId); assertNotePath(input?.sourcePath); assertNotePath(input?.targetPath);
    if (isSchedulePath(input.sourcePath) || isSchedulePath(input.targetPath)) throw new ConnectorError('UNSUPPORTED_RELATION', '日程使用单向来源引用，不创建知识关系', 400);
    if (!['confirm', 'revoke'].includes(input.action) || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId || '') || !/^[a-f0-9]{64}$/.test(input.sourceHash || '') || !/^[a-f0-9]{64}$/.test(input.targetHash || '')) throw new ConnectorError('INVALID_RELATION', '关系请求不完整');
    if (input.action === 'confirm' && (typeof input.explanation !== 'string' || !input.explanation.trim() || input.explanation.length > 4000)) throw new ConnectorError('INVALID_RELATION', '请填写关系说明');
    return this.enqueue(async () => {
      const source = await this.readNote(input.sourcePath); const target = await this.readNote(input.targetPath);
      const relationId = makeRelationId(source.path, target.path);
      if (input.relationId && relationId !== input.relationId) throw new ConnectorError('INVALID_RELATION', '关系标识与笔记不符');
      const fingerprint = hash(JSON.stringify({ action: input.action, source: source.path, target: target.path, explanation: input.explanation || '' }));
      const data = await this.plugin.loadData() || {}; const previous = data.desktopConnector?.operations?.[input.operationId];
      if (previous && previous.fingerprint !== fingerprint) throw new ConnectorError('OPERATION_REUSED', '操作标识已用于另一项关系修改', 409);
      if (previous?.status === 'complete') return { ...previous.result, replayed: true };
      if (this.plugin.starSea.getPendingTransaction()) throw new ConnectorError('RELATION_REPAIR_REQUIRED', '存在待修复的关系，请先在 Obsidian 梦藏中核对修复', 409);
      const saveOperation = async operation => this.plugin.updateMengcangData(raw => ({ ...raw, desktopConnector: { ...raw.desktopConnector, operations: { ...(raw.desktopConnector?.operations || {}), [input.operationId]: operation } } }));
      // If the process exited after the two-end commit but before recording its
      // response, recognize that exact result. This never changes confirmedAt.
      if (previous?.status === 'pending') {
        const left = this.plugin.starSea.getConfirmed({ ...source, rawMarkdown: source.markdown }).find(item => item.relationId === relationId);
        const right = this.plugin.starSea.getConfirmed({ ...target, rawMarkdown: target.markdown }).find(item => item.relationId === relationId);
        const achieved = input.action === 'confirm' ? left && right && left.explanation === input.explanation.trim() && right.explanation === input.explanation.trim() : !left && !right;
        if (achieved) { const result = { ok: true, relationId, operation: input.action, replayed: true }; await saveOperation({ fingerprint, status: 'complete', result }); this.invalidate(); return result; }
      }
      if (source.hash !== input.sourceHash || target.hash !== input.targetHash) throw new ConnectorError('CONFLICT', '关系两端的笔记已有修改，请刷新核对', 409);
      await saveOperation({ fingerprint, status: 'pending' });
      const options = { expectedHashes: { [source.path]: source.hash, [target.path]: target.hash } };
      const result = input.action === 'confirm' ? await this.plugin.starSea.confirmRelation(source, target, input.explanation.trim(), 'manual', options) : await this.plugin.starSea.removeRelation(source, relationId, options);
      await saveOperation({ fingerprint, status: 'complete', result });
      this.invalidate(); await this.plugin.inspirations?.refreshNow(); return result;
    });
  }
  dispose() {
    this.disposed = true; clearInterval(this.timer); clearInterval(this.heartbeat);
    for (const unsubscribe of this.unsubscribers) { try { unsubscribe(); } catch {} } this.unsubscribers = [];
    for (const response of this.clients) response.end(); this.clients.clear();
    try { this.api?.unregister(); } catch {} this.api = null; this.status = 'stopped';
  }
}
module.exports = { DesktopConnector, PRODUCTION_VAULT, PREFIX, safeRelative, assertNotePath, loopback, errorBody };
