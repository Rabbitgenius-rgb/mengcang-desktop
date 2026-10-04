const { createHash, randomUUID } = require('node:crypto');
const { TFile } = require('obsidian');
const { splitNote, frontmatterOf, setYamlFields } = require('../desktop-connector/notes');

const ENTRY_ROOT = '01_sources/cards/text/灵感/';
const CARD_ROOTS = ['01_sources/cards/images/', '01_sources/cards/text/', '01_sources/cards/web/'];
const REGISTRY = '_meta/projects.json';
const SNAPSHOT_ROOT = '01_sources/_originals/images/web-snapshots';

const hash = value => createHash('sha256').update(value).digest('hex');
const text = value => value === undefined || value === null ? '' : String(value);
const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : value ? [text(value)] : [];

function extractExplorations(body) {
  const records = [];
  const regex = /<!-- mengcang:exploration (\{[^\n]*\}) -->/g;
  for (const match of body.matchAll(regex)) {
    try { const record = JSON.parse(match[1]); if (record?.id && record?.text) records.push(record); } catch {}
  }
  return records;
}

function plain(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/!\[\[[^\]]+\]\]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/[#>*_`\[\]]/g, ' ').trim();
}

function safeResourcePath(value) {
  const match = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(text(value));
  return match ? match[1] : text(value);
}

class InspirationStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.listeners = new Set();
    this.snapshot = { ready: false, entries: [], materials: [], projects: [], revision: 0 };
    this.refreshToken = 0;
    this.timer = null;
    this.disposed = false;
  }

  start() {
    const schedule = file => {
      const path = file?.path || '';
      if (CARD_ROOTS.some(root => path.startsWith(root)) || path === REGISTRY) this.scheduleRefresh();
    };
    this.plugin.registerEvent(this.app.vault.on('create', schedule));
    this.plugin.registerEvent(this.app.vault.on('modify', schedule));
    this.plugin.registerEvent(this.app.vault.on('delete', schedule));
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      schedule(file); schedule({ path: oldPath });
    }));
    this.plugin.registerEvent(this.app.metadataCache.on('changed', schedule));
    void this.refreshNow();
  }

  scheduleRefresh() {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.refreshNow(); }, 180);
  }

  async refreshNow() {
    const token = ++this.refreshToken;
    const files = this.app.vault.getMarkdownFiles().filter(file => CARD_ROOTS.some(root => file.path.startsWith(root)));
    const errors = [];
    const records = await Promise.all(files.map(async file => {
      try {
        const markdown = await this.app.vault.cachedRead(file);
        const fields = frontmatterOf(markdown);
        if (fields.type !== 'material' && fields.record_type !== 'inspiration') return null;
        const title = text(fields.title || file.basename);
        const note = { id: text(fields.id || fields.material_id || file.path), path: file.path, title,
          fields, markdown, body: splitNote(markdown).body, hash: hash(markdown),
          description: text(fields.caption ?? fields.summary ?? fields.description),
          tags: list(fields.tags), projectIds: list(fields.project_ids || fields.project_id),
          searchText: [title, fields.caption, fields.summary, fields.description, fields.tags, plain(markdown)]
            .flat().map(text).join(' ').toLocaleLowerCase('zh-CN') };
        if (fields.record_type === 'inspiration') {
          return { ...note, kind: 'entry', role: text(fields.role || 'seed'),
            roleStatus: text(fields.role_status || 'pending'), category: text(fields.category || 'inspiration'),
            provenance: text(fields.provenance), summaryStatus: text(fields.summary_status || 'pending'),
            sourceId: text(fields.source_id), sourcePath: text(fields.source_original_path),
            sourceStart: Number(fields.source_start) || 0, sourceEnd: Number(fields.source_end) || 0,
            sourceUpdated: text(fields.source_updated), sourceRevision: text(fields.source_revision),
            sourceChanged: fields.source_changed === true,
            boundary: text(fields.boundary || 'pending'),
            linkedPaths: list(fields.link_notes), materialPaths: list(fields.material_notes),
            servesProjectId: text(fields.serves_project_id), explorations: extractExplorations(note.body) };
        }
        const isImage = file.path.startsWith('01_sources/cards/images/');
        return { ...note, kind: isImage ? 'image' : file.path.startsWith('01_sources/cards/web/') ? 'web' : 'text',
          url: text(fields.source_url || fields.url),
          originalPath: safeResourcePath(fields.original_file || fields.cover),
          resourceUrl: (() => { const p = safeResourcePath(fields.original_file || fields.cover); return p && this.app.vault.getAbstractFileByPath(p) ? this.app.vault.getResourcePath(this.app.vault.getAbstractFileByPath(p)) : ''; })() };
      } catch (error) { errors.push({ path: file.path, code: error.code || 'READ_FAILED', message: error.message || '无法读取笔记' }); return null; }
    }));
    let projects = [];
    try { const registry = JSON.parse(await this.app.vault.adapter.read(REGISTRY)); projects = registry.projects || []; } catch (error) { errors.push({ path: REGISTRY, code: 'REGISTRY_READ_FAILED', message: '无法读取项目注册表' }); }
    if (this.disposed || token !== this.refreshToken) return;
    this.snapshot = { ready: true, entries: records.filter(x => x?.kind === 'entry').sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
      materials: records.filter(x => x && x.kind !== 'entry'), projects, errors, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async readSource(entry) {
    if (!entry?.sourcePath?.startsWith('01_sources/_originals/')) return '';
    return this.app.vault.adapter.read(entry.sourcePath);
  }

  async update(path, expectedHash, patch, bodyChange = null) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('笔记已移动或删除，请重新打开');
    await this.app.vault.process(file, current => {
      if (hash(current) !== expectedHash) throw new Error('笔记已有新的修改；你的输入仍在页面中，请核对后重试');
      const next = Object.keys(patch).length ? setYamlFields(current, patch) : current;
      return bodyChange ? bodyChange(next) : next;
    });
    await this.refreshNow();
  }

  async addExploration(entry, kind, content) {
    const value = content.trim();
    if (!value) throw new Error('请先填写探索内容');
    const record = { id: randomUUID(), kind, text: value, createdAt: new Date().toISOString() };
    await this.update(entry.path, entry.hash, {}, source => {
      const marker = `<!-- mengcang:exploration ${JSON.stringify(record).replace(/-->/g, '--&gt;')} -->`;
      return `${source.trimEnd()}\n\n${source.includes('## 继续探索') ? '' : '## 继续探索\n\n'}${marker}\n- **${kind} · ${record.createdAt}** ${value.replace(/\n/g, '\n  ')}\n`;
    });
  }

  async openNote(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('笔记不存在');
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  async ensureFolder(path) {
    let current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async addLink(input) {
    const match = text(input).match(/https?:\/\/[^\s<>"，。]+/);
    if (!match) throw new Error('请粘贴网页链接或带链接的分享文字');
    const { publicUrl, captureIntoNote } = require('./snapshot');
    const url = await publicUrl(match[0]);
    const title = new URL(url).hostname;
    const id = `web-${randomUUID()}`;
    const path = `01_sources/cards/web/${id}.md`;
    await this.ensureFolder('01_sources/cards/web');
    await this.ensureFolder(SNAPSHOT_ROOT);
    const markdown = `---\nid: ${JSON.stringify(id)}\ntype: material\nrecord_type: web_reference\nstatus: inbox\ntitle: ${JSON.stringify(title)}\nsource_url: ${JSON.stringify(url)}\norigin: external\nrights: unknown\ncapture_status: pending\ncreated_at: ${JSON.stringify(new Date().toISOString())}\ntags: []\n---\n\n# ${title}\n\n## 素材配文\n\n\n## 原始分享文字\n\n${text(input).trim() === url ? url : text(input).trim()}\n`;
    const file = await this.app.vault.create(path, markdown);
    await this.refreshNow();
    void captureIntoNote(this, file).catch(error => console.error('Mengcang snapshot failed', error));
    return { path, id, title };
  }

  async refreshSnapshot(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('素材笔记不存在');
    const { captureIntoNote } = require('./snapshot');
    return captureIntoNote(this, file);
  }

  browserStatus() { return require('./snapshot').browserStatus(); }

  async installBrowser() { return require('./snapshot').installBrowser(this.plugin); }

  async confirmRelation(entry, material, explanation) {
    await this.plugin.starSea.confirmRelation({ path: entry.path, title: entry.title }, { path: material.path, title: material.title }, explanation, 'manual');
    await this.refreshNow();
  }

  candidateMaterials(entry) {
    const known = new Map(this.snapshot.materials.map(item => [item.path, item]));
    const inherited = this.plugin.starSea.buildCorpus(this.plugin.store.snapshot);
    const imageCorpus = this.snapshot.materials.filter(item => item.kind === 'image').map(item => ({
      path: item.path, file: this.app.vault.getAbstractFileByPath(item.path), title: item.title,
      kind: 'pattern', tags: item.tags, summary: item.description, rawMarkdown: item.markdown,
      projectIds: item.projectIds
    }));
    const candidates = this.plugin.starSea.getCandidates({ path: entry.path, title: entry.title }, [...inherited, ...imageCorpus]);
    return candidates.map(candidate => ({ ...candidate, material: known.get(candidate.targetPath) })).filter(candidate => candidate.material);
  }

  dispose() {
    this.disposed = true;
    this.refreshToken++;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}

module.exports = { InspirationStore, ENTRY_ROOT, CARD_ROOTS, splitNote, frontmatterOf, setYamlFields, extractExplorations, hash };
