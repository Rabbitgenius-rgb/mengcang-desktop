"use strict";

const core = require("./core");
const generators = require("./generators");

const BOOKS_ROOT = "01_sources/books/";
const FALLBACK_WORK_NOTES_ROOT = "01_sources/cards/text/作品";
const DEFAULT_LOCAL_ENDPOINT = "http://127.0.0.1:11434/v1";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("、");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function asList(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return String(value).split(/[,，、;；\n]/).map(asText).filter(Boolean);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function stableHash(value) {
  const input = JSON.stringify(stableObject(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function nowIso() {
  return new Date().toISOString();
}

function jobError(error, code = "BOOK_CURATION_FAILED") {
  return {
    code: asText(error?.code || code).slice(0, 100) || code,
    message: asText(error?.message || error).slice(0, 500),
    repairNeeded: false,
    at: nowIso()
  };
}

function markdownBody(source) {
  return String(source || "")
    .replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "")
    .trim();
}

function yamlScalar(value) {
  const text = asText(value);
  if (!text) return "";
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return asText(JSON.parse(text)); } catch (_) {}
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'").trim();
  }
  return text.replace(/\s+#.*$/, "").trim();
}

function frontmatterIdentity(markdown) {
  const match = String(markdown || "").match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { id: "", sourceUrl: "" };
  let id = "";
  let sourceUrl = "";
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^\s*(id|source_url)\s*:\s*(.*?)\s*$/i);
    if (!field) continue;
    if (field[1].toLowerCase() === "id") id = yamlScalar(field[2]);
    else sourceUrl = yamlScalar(field[2]);
  }
  return { id, sourceUrl };
}

function canonicalUrl(value) {
  const text = asText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString();
  } catch (_) {
    return text;
  }
}

function normalizeGenerator(value) {
  const raw = asText(value).toLowerCase();
  if (["local-model", "localhost", "local-llm", "openai-compatible"].includes(raw)) return "local-model";
  return "local-template";
}

function normalizeSettings(raw = {}, defaults = {}) {
  const input = isObject(raw) ? raw : {};
  const base = isObject(defaults) ? defaults : {};
  const generator = normalizeGenerator(input.generator || input.provider || base.generator || base.provider);
  return {
    ...base,
    ...input,
    autoGenerate: input.autoGenerate === undefined
      ? base.autoGenerate !== false
      : input.autoGenerate !== false,
    provider: generator,
    generator,
    endpoint: asText(input.endpoint || input.baseUrl || base.endpoint || base.baseUrl) || DEFAULT_LOCAL_ENDPOINT,
    model: asText(input.model || input.modelName || base.model || base.modelName),
    generatorVersion: asText(input.generatorVersion || base.generatorVersion) || "book-curation-v1",
    promptVersion: asText(input.promptVersion || base.promptVersion) || "zh-curation-v1"
  };
}

function isMarkdownFile(file) {
  return Boolean(file?.path)
    && asText(file.extension || file.path.split(".").pop()).toLowerCase() === "md";
}

function filePath(recordOrPath) {
  return asText(typeof recordOrPath === "string" ? recordOrPath : recordOrPath?.path || recordOrPath?.file?.path);
}

function selectedSubset(items, selectedIds) {
  if (!Array.isArray(items)) return [];
  if (!Array.isArray(selectedIds)) return items.slice();
  const selected = new Set(selectedIds.map(asText).filter(Boolean));
  return items.filter((item) => selected.has(asText(item?.id)));
}

function uniqueBy(items, keyOf) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

class BookCurationService {
  constructor(plugin, options = {}) {
    if (!plugin?.app?.vault || !plugin?.app?.metadataCache) {
      throw new TypeError("BookCurationService requires an Obsidian plugin instance");
    }
    this.plugin = plugin;
    this.app = plugin.app;
    this.core = options.core || core;
    this.generators = options.generators || generators;
    this.requestJson = options.requestJson;
    this.state = this._normalizeState({});
    this.loaded = false;
    this.started = false;
    this.disposed = false;
    this.listeners = new Set();
    this.eventRefs = [];
    this.pendingTasks = new Set();
    this.inflightByPath = new Map();
    this.stateQueue = Promise.resolve();
    this.generationQueue = Promise.resolve();
    this.confirmQueue = Promise.resolve();
  }

  async loadData() {
    if (this.loaded) return this.getSnapshot();
    const raw = typeof this.plugin.loadData === "function" ? (await this.plugin.loadData()) || {} : {};
    this.state = this._normalizeState(raw.bookCuration || {});
    this.loaded = true;
    return this.getSnapshot();
  }

  async start() {
    if (this.started) return this.getSnapshot();
    this.started = true;
    this.disposed = false;
    const metadataCache = this.app.metadataCache;
    try {
      await this.loadData();
      if (typeof metadataCache.on === "function") {
        const ref = metadataCache.on("changed", (file) => {
          if (this.disposed) return;
          this._track(this._considerFile(file));
        });
        this.eventRefs.push(ref);
        if (typeof this.plugin.registerEvent === "function") this.plugin.registerEvent(ref);
      }

      // Scan once immediately so enabling the plugin also covers books that
      // were added while it was disabled. Register the second pass only after
      // startup succeeds, so a retry cannot accumulate callbacks.
      await this.scanBacklog();
      if (typeof this.app.workspace?.onLayoutReady === "function") {
        this.app.workspace.onLayoutReady(() => {
          if (!this.disposed) this._track(this.scanBacklog());
        });
      }
      return this.getSnapshot();
    } catch (error) {
      if (typeof metadataCache.offref === "function") {
        for (const ref of this.eventRefs) metadataCache.offref(ref);
      }
      this.eventRefs = [];
      this.started = false;
      throw error;
    }
  }

  dispose() {
    this.disposed = true;
    this.started = false;
    const metadataCache = this.app.metadataCache;
    if (typeof metadataCache.offref === "function") {
      for (const ref of this.eventRefs) metadataCache.offref(ref);
    }
    this.eventRefs = [];
    this.listeners.clear();
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot() {
    return clone(this.state);
  }

  getJob(path) {
    const normalized = filePath(path);
    return clone(this.state.jobs?.[normalized] || null);
  }

  getJobs() {
    return clone(this.state.jobs || {});
  }

  getSettings() {
    return clone(normalizeSettings(this.state.settings, this._defaultState().settings));
  }

  async updateSettings(patch = {}) {
    if (!isObject(patch)) throw new TypeError("settings patch must be an object");
    const nextSettings = normalizeSettings({ ...this.getSettings(), ...patch }, this._defaultState().settings);
    this._assertLocalSettings(nextSettings);
    await this._commitState((state) => {
      state.settings = nextSettings;
      return state;
    });
    if (nextSettings.autoGenerate) await this.scanBacklog();
    return this.getSettings();
  }

  async retry(path, options = {}) {
    await this.loadData();
    const normalized = filePath(path);
    const existing = this.getJob(normalized);
    if (existing?.status === "error" && existing?.error?.repairNeeded === true) {
      throw new Error("这本书存在需要人工检查的部分写入，暂停重新生成");
    }
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!this._isBookFile(file)) throw new Error(`找不到可生成策展内容的书籍笔记：${normalized}`);
    const result = await this._queueGeneration(file, { force: options.force !== false, manual: true });
    if (result?.status === "error") {
      const error = new Error(asText(result?.error?.message) || "阅读引线生成失败");
      error.code = asText(result?.error?.code) || "GENERATION_FAILED";
      throw error;
    }
    return result;
  }

  async scanBacklog() {
    await this.loadData();
    if (this.disposed) return [];
    const files = typeof this.app.vault.getMarkdownFiles === "function"
      ? this.app.vault.getMarkdownFiles()
      : [];
    const jobs = [];
    for (const file of files) {
      if (!this._isBookFile(file)) continue;
      jobs.push(this._considerFile(file));
    }
    return Promise.all(jobs);
  }

  async waitForIdle() {
    while (this.pendingTasks.size) {
      await Promise.allSettled([...this.pendingTasks]);
    }
    await this.generationQueue.catch(() => undefined);
    await this.stateQueue.catch(() => undefined);
  }

  async confirm(path, selection = {}) {
    const task = () => this._confirm(path, selection);
    const run = this.confirmQueue.then(task, task);
    this.confirmQueue = run.catch(() => undefined);
    return run;
  }

  _defaultState() {
    const raw = typeof this.core.defaultBookCurationState === "function"
      ? this.core.defaultBookCurationState()
      : { schemaVersion: 1, settings: {}, jobs: {} };
    return {
      schemaVersion: Number(raw?.schemaVersion) || 1,
      settings: normalizeSettings(raw?.settings || {}),
      jobs: isObject(raw?.jobs) ? raw.jobs : {}
    };
  }

  _normalizeState(raw) {
    const defaults = this._defaultState();
    const normalized = typeof this.core.normalizeBookCurationState === "function"
      ? this.core.normalizeBookCurationState(raw)
      : raw;
    const source = isObject(normalized) ? normalized : {};
    return {
      ...defaults,
      ...source,
      settings: normalizeSettings({ ...defaults.settings, ...(source.settings || {}) }, defaults.settings),
      jobs: isObject(source.jobs) ? clone(source.jobs) : {}
    };
  }

  _emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch (_) {}
    }
  }

  _track(promise) {
    const tracked = Promise.resolve(promise);
    this.pendingTasks.add(tracked);
    tracked.finally(() => this.pendingTasks.delete(tracked)).catch(() => undefined);
    return tracked;
  }

  _isBookFile(file) {
    if (!isMarkdownFile(file) || !file.path.startsWith(BOOKS_ROOT)) return false;
    const frontmatter = this.app.metadataCache.getFileCache?.(file)?.frontmatter || {};
    return asText(frontmatter.type).toLowerCase() === "book";
  }

  async _considerFile(file) {
    if (this.disposed || !this._isBookFile(file)) return null;
    const existing = this.getJob(file.path);
    if (existing?.status === "error" && existing?.error?.repairNeeded === true) return existing;
    if (!this.getSettings().autoGenerate) return this.getJob(file.path);
    return this._queueGeneration(file, { force: false, manual: false });
  }

  _queueGeneration(file, options) {
    const path = filePath(file);
    if (this.inflightByPath.has(path)) return this.inflightByPath.get(path);
    const task = this.generationQueue.then(
      () => this._generateForFile(file, options),
      () => this._generateForFile(file, options)
    );
    this.generationQueue = task.catch(() => undefined);
    this.inflightByPath.set(path, task);
    task.finally(() => {
      if (this.inflightByPath.get(path) === task) this.inflightByPath.delete(path);
    }).catch(() => undefined);
    return this._track(task);
  }

  async _bookInput(file) {
    const frontmatter = this.app.metadataCache.getFileCache?.(file)?.frontmatter || {};
    let markdown = "";
    try {
      markdown = typeof this.app.vault.cachedRead === "function"
        ? await this.app.vault.cachedRead(file)
        : await this.app.vault.read(file);
    } catch (_) {}
    if (typeof this.core.stripBookCurationBlock === "function") {
      markdown = this.core.stripBookCurationBlock(markdown);
    }
    // Deliberately whitelist prompt fields. Local file paths, PDF hashes and
    // cover paths are not generation inputs even for a localhost model.
    return {
      path: file.path,
      file,
      title: asText(frontmatter.title) || asText(file.basename) || file.path.split("/").pop().replace(/\.md$/i, ""),
      author: asList(frontmatter.author || frontmatter.authors),
      translator: asText(frontmatter.translator),
      summary: asText(frontmatter.summary || frontmatter.description),
      tags: asList(frontmatter.tags),
      language: asText(frontmatter.language),
      publisher: asText(frontmatter.publisher),
      publishedAt: asText(frontmatter.published_at),
      readingStatus: asText(frontmatter.reading_status),
      body: markdownBody(markdown).slice(0, 12000)
    };
  }

  _generationContext(settings) {
    const effective = this._effectiveGeneratorSettings(settings);
    return {
      generatorVersion: `${asText(effective.generatorVersion)}:${stableHash({
        generator: effective.generator,
        model: asText(effective.model),
        endpoint: asText(effective.endpoint)
      })}`,
      promptVersion: asText(effective.promptVersion)
    };
  }

  _fingerprint(book, settings) {
    const versions = this._generationContext(settings);
    if (typeof this.core.bookInputFingerprint === "function") {
      return this.core.bookInputFingerprint(book, versions);
    }
    return `book-curation-${stableHash({ book, versions })}`;
  }

  _generationKey(book, settings) {
    const versions = this._generationContext(settings);
    if (typeof this.core.makeGenerationKey === "function") {
      return this.core.makeGenerationKey(book, versions);
    }
    return `generation-${stableHash({ path: book.path, versions })}`;
  }

  _effectiveGeneratorSettings(settings) {
    const normalized = normalizeSettings(settings, this._defaultState().settings);
    if (normalized.generator !== "local-model" || !normalized.model) {
      return { ...normalized, provider: "local-template", generator: "local-template" };
    }
    this._assertLocalSettings(normalized);
    return normalized;
  }

  _assertLocalSettings(settings) {
    if (normalizeGenerator(settings.generator || settings.provider) !== "local-model") return;
    const endpoint = asText(settings.endpoint || settings.baseUrl) || DEFAULT_LOCAL_ENDPOINT;
    if (typeof this.generators.validateLocalEndpoint === "function") {
      this.generators.validateLocalEndpoint(endpoint);
      return;
    }
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    if (!(["localhost", "127.0.0.1", "::1"].includes(host))) {
      throw new Error("本地模型地址必须使用 localhost、127.0.0.1 或 ::1");
    }
  }

  async _runGenerator(book, settings) {
    const effective = this._effectiveGeneratorSettings(settings);
    const runtime = {};
    if (typeof this.requestJson === "function") runtime.requestJson = this.requestJson;
    let raw;
    if (typeof this.generators.generateBookCuration === "function") {
      raw = await this.generators.generateBookCuration(book, effective, runtime);
    } else if (effective.generator === "local-template" && typeof this.generators.buildTemplateBookCuration === "function") {
      raw = await this.generators.buildTemplateBookCuration(book, effective);
    } else {
      throw new Error("书籍策展生成器不可用");
    }
    if (effective.generator === "local-model" && raw?.generation?.status === "fallback") {
      const reason = asText(raw.generation.fallbackReason) || "LOCAL_MODEL_FAILED";
      const error = new Error(`本地模型未返回有效草案（${reason}）`);
      error.code = reason;
      throw error;
    }
    return typeof this.core.sanitizeCurationDraft === "function"
      ? this.core.sanitizeCurationDraft(raw)
      : raw;
  }

  async _generateForFile(file, options = {}) {
    if (this.disposed || !this._isBookFile(file)) return null;
    await this.loadData();
    const settings = this.getSettings();
    if (!settings.autoGenerate && !options.manual) return this.getJob(file.path);
    const book = await this._bookInput(file);
    const fingerprint = this._fingerprint(book, settings);
    const generationKey = this._generationKey(book, settings);
    const existing = this.getJob(file.path);
    if (existing?.status === "error" && existing?.error?.repairNeeded === true) return existing;
    if (!options.force
      && existing?.fingerprint === fingerprint
      && ["ready", "confirmed"].includes(existing.status)) {
      return existing;
    }

    const attempts = Math.max(0, Number(existing?.attempts) || 0) + 1;
    const baseJob = {
      ...(existing || {}),
      path: file.path,
      fingerprint,
      generationKey,
      status: "pending",
      draft: null,
      error: "",
      attempts,
      updatedAt: nowIso()
    };
    const effective = this._effectiveGeneratorSettings(settings);

    try {
      // Template generation is synchronous/local in spirit; persist only the
      // ready result so a newly added book never waits in a fake queue state.
      if (effective.generator !== "local-template") {
        await this._setJob(file.path, baseJob);
      }
      const draft = await this._runGenerator(book, settings);
      if (this.disposed) return this.getJob(file.path);
      const ready = {
        ...baseJob,
        status: "ready",
        draft,
        error: "",
        updatedAt: nowIso()
      };
      await this._setJob(file.path, ready);
      return this.getJob(file.path);
    } catch (error) {
      const failed = {
        ...baseJob,
        status: "error",
        error: jobError(error, "GENERATION_FAILED"),
        updatedAt: nowIso()
      };
      await this._setJob(file.path, failed);
      return this.getJob(file.path);
    }
  }

  async _confirm(path, selection) {
    await this.loadData();
    const normalizedPath = filePath(path);
    const job = this.getJob(normalizedPath);
    const retryableConfirmError = job?.status === "error" && job?.draft && job?.error?.repairNeeded !== true;
    if (!job?.draft || (!retryableConfirmError && !["ready", "confirmed"].includes(job.status))) {
      throw new Error("这本书还没有可确认的策展草稿");
    }
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!this._isBookFile(file)) throw new Error(`找不到书籍笔记：${normalizedPath}`);

    const book = await this._bookInput(file);
    const draft = typeof this.core.sanitizeCurationDraft === "function"
      ? this.core.sanitizeCurationDraft(job.draft)
      : clone(job.draft);
    const chosen = {
      ...draft,
      curatorialLines: selectedSubset(draft.curatorialLines, selection.selectedLineIds)
        .map((item) => ({ ...item, selected: true })),
      questions: selectedSubset(draft.questions, selection.selectedQuestionIds)
        .map((item) => ({ ...item, selected: true })),
      relatedWorks: selectedSubset(draft.relatedWorks, selection.selectedWorkIds)
        .map((item) => ({ ...item, selected: true }))
    };
    const normalizedSelection = {
      selectedLineIds: chosen.curatorialLines.map((item) => item.id),
      selectedQuestionIds: chosen.questions.map((item) => item.id),
      selectedWorkIds: chosen.relatedWorks.map((item) => item.id)
    };
    const confirmKey = typeof this.core.makeConfirmKey === "function"
      ? this.core.makeConfirmKey(normalizedPath, draft, normalizedSelection)
      : `confirm-${stableHash({ path: normalizedPath, selection: normalizedSelection, draft })}`;
    if (job.status === "confirmed" && job.confirmKey === confirmKey) return job;

    const confirmedAt = nowIso();
    const originalBookMarkdown = await this._readFile(file);
    const selectedWorkPaths = {};
    const created = [];
    let bookChanged = false;

    try {
      const works = uniqueBy(chosen.relatedWorks, (work) => asText(work?.id));
      if (works.length) await this._ensureFolder(this.core.WORK_NOTES_ROOT || FALLBACK_WORK_NOTES_ROOT);
      const pathOwners = new Map();
      for (const work of works) {
        const candidateId = asText(work.id);
        const workPath = this._workNotePath(work);
        selectedWorkPaths[candidateId] = workPath;
        if (pathOwners.has(workPath)) {
          if (!this._sameWorkIdentity(pathOwners.get(workPath), work)) {
            throw new Error(`两个不同作品生成了同一笔记路径：${workPath}`);
          }
          continue;
        }
        pathOwners.set(workPath, work);

        const existing = this.app.vault.getAbstractFileByPath(workPath);
        if (existing) {
          if (!isMarkdownFile(existing)) throw new Error(`作品笔记路径已被非 Markdown 文件占用：${workPath}`);
          await this._assertReusableWorkNote(existing, work);
          continue;
        }
        if (work.resolution?.kind === "existing_note") {
          throw new Error(`已匹配的作品笔记不存在：${workPath}`);
        }
        if (!work.eligibleForConfirmation) {
          throw new Error(`作品缺少可追溯的馆藏来源，暂不能生成笔记：${asText(work.title)}`);
        }
        const content = this.core.buildWorkMarkdown({
          book,
          work,
          confirmedAt,
          curationId: job.generationKey || job.fingerprint,
          path: workPath
        });
        let createdFile;
        try {
          createdFile = await this.app.vault.create(workPath, content);
        } catch (error) {
          const raced = this.app.vault.getAbstractFileByPath(workPath);
          if (raced && isMarkdownFile(raced)) {
            await this._assertReusableWorkNote(raced, work);
            continue;
          }
          throw error;
        }
        created.push({
          path: workPath,
          file: createdFile,
          content,
          mtime: Number(createdFile?.stat?.mtime) || 0
        });
      }

      const payload = { book, draft: chosen, selectedWorkPaths };
      await this._mutateFile(file, (current) => this.core.upsertBookCurationBlock(current, payload));
      bookChanged = true;
    } catch (error) {
      // Only remove files made by this exact confirmation attempt when the book
      // is byte-for-byte untouched. If either the book or a generated work was
      // edited by the user, retain it and report the failure instead.
      let currentBook = "";
      try { currentBook = await this._readFile(file); } catch (_) {}
      const rollback = currentBook === originalBookMarkdown
        ? await this._rollbackCreated(created)
        : { removed: [], retained: created.map((item) => item.path) };
      await this._recordConfirmError(normalizedPath, error, {
        repairNeeded: currentBook !== originalBookMarkdown || rollback.retained.length > 0
      });
      const failure = new Error(asText(error?.message || error) || "书籍策展内容写入失败");
      failure.rollback = rollback;
      failure.bookChanged = currentBook !== originalBookMarkdown;
      throw failure;
    }

    if (!bookChanged) throw new Error("书籍策展内容未能写入");
    const confirmedJob = {
      ...job,
      status: "confirmed",
      error: "",
      confirmedAt,
      confirmKey,
      createdWorkPaths: {
        ...(isObject(job.createdWorkPaths) ? job.createdWorkPaths : {}),
        ...selectedWorkPaths
      },
      updatedAt: confirmedAt
    };
    // Markdown is already committed at this point. A data.json failure must not
    // delete linked notes and leave dangling links in the user's book.
    await this._setJob(normalizedPath, confirmedJob);
    return this.getJob(normalizedPath);
  }

  _workNotePath(work) {
    const existingPath = asText(work?.resolution?.existingPath).replace(/^\/+/, "");
    if (work?.resolution?.kind === "existing_note") {
      if (!existingPath.toLowerCase().endsWith(".md") || existingPath.includes("../")) {
        throw new Error("已有作品笔记路径无效");
      }
      return existingPath;
    }
    if (typeof this.core.makeWorkNotePath !== "function") throw new Error("作品笔记路径生成器不可用");
    const path = asText(this.core.makeWorkNotePath(work)).replace(/^\/+/, "");
    const root = asText(this.core.WORK_NOTES_ROOT || FALLBACK_WORK_NOTES_ROOT).replace(/\/+$/, "");
    if (!path.startsWith(`${root}/`) || !path.toLowerCase().endsWith(".md") || path.includes("../")) {
      throw new Error("作品笔记路径越界");
    }
    return path;
  }

  _sameWorkIdentity(left, right) {
    const leftId = asText(left?.workId || (typeof this.core.makeWorkId === "function" ? this.core.makeWorkId(left) : ""));
    const rightId = asText(right?.workId || (typeof this.core.makeWorkId === "function" ? this.core.makeWorkId(right) : ""));
    const leftUrl = canonicalUrl(left?.source?.catalogUrl);
    const rightUrl = canonicalUrl(right?.source?.catalogUrl);
    return Boolean(leftId && rightId && leftId === rightId && leftUrl && rightUrl && leftUrl === rightUrl);
  }

  async _assertReusableWorkNote(file, work) {
    const cached = this.app.metadataCache.getFileCache?.(file)?.frontmatter || {};
    let actualId = asText(cached.id);
    let actualSourceUrl = asText(cached.source_url || cached.sourceUrl);
    if (!actualId || !actualSourceUrl) {
      const parsed = frontmatterIdentity(await this._readFile(file));
      actualId = actualId || parsed.id;
      actualSourceUrl = actualSourceUrl || parsed.sourceUrl;
    }
    const expectedId = asText(work?.workId || (typeof this.core.makeWorkId === "function" ? this.core.makeWorkId(work) : ""));
    const expectedSourceUrl = canonicalUrl(work?.source?.catalogUrl);
    if (!expectedId || !expectedSourceUrl
      || actualId !== expectedId
      || canonicalUrl(actualSourceUrl) !== expectedSourceUrl) {
      throw new Error(`同路径作品笔记的 id 或 source_url 不匹配，已停止复用：${file.path}`);
    }
  }

  async _readFile(file) {
    if (typeof this.app.vault.cachedRead === "function") return this.app.vault.cachedRead(file);
    return this.app.vault.read(file);
  }

  async _mutateFile(file, transform) {
    if (typeof this.app.vault.process === "function") {
      let changed = false;
      await this.app.vault.process(file, (current) => {
        const next = transform(current);
        changed = next !== current;
        return next;
      });
      return changed;
    }
    const current = await this._readFile(file);
    const next = transform(current);
    if (next === current) return false;
    await this.app.vault.modify(file, next);
    return true;
  }

  async _ensureFolder(path) {
    const parts = asText(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async _rollbackCreated(created) {
    const removed = [];
    const retained = [];
    for (const entry of [...created].reverse()) {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!file || typeof this.app.vault.delete !== "function") {
        retained.push(entry.path);
        continue;
      }
      let current;
      try { current = await this._readFile(file); } catch (_) {
        retained.push(entry.path);
        continue;
      }
      const sameMtime = !entry.mtime || !Number(file.stat?.mtime) || Number(file.stat.mtime) === entry.mtime;
      if (current !== entry.content || !sameMtime) {
        retained.push(entry.path);
        continue;
      }
      try {
        await this.app.vault.delete(file);
        removed.push(entry.path);
      } catch (_) {
        retained.push(entry.path);
      }
    }
    return { removed, retained };
  }

  async _recordConfirmError(path, error, options = {}) {
    const current = this.getJob(path);
    if (!current) return;
    try {
      const normalizedError = jobError(error, "CONFIRM_FAILED");
      normalizedError.repairNeeded = options.repairNeeded === true;
      await this._setJob(path, {
        ...current,
        status: "error",
        error: normalizedError,
        updatedAt: nowIso()
      });
    } catch (_) {}
  }

  async _setJob(path, job) {
    return this._commitState((state) => {
      state.jobs = { ...(state.jobs || {}), [path]: clone(job) };
      return state;
    });
  }

  _commitState(mutator) {
    const task = async () => {
      const working = this._normalizeState(this.state);
      const changed = mutator(working) || working;
      const next = this._normalizeState(changed);
      await this._persistState(next);
      this.state = next;
      this._emit();
      return this.getSnapshot();
    };
    const run = this.stateQueue.then(task, task);
    this.stateQueue = run.catch(() => undefined);
    return run;
  }

  async _persistState(nextState) {
    const serialized = clone(nextState);
    if (typeof this.plugin.updateMengcangData === "function") {
      await this.plugin.updateMengcangData((raw) => {
        const root = isObject(raw) ? { ...raw } : {};
        root.bookCuration = serialized;
        return root;
      });
      return;
    }
    if (typeof this.plugin.loadData !== "function" || typeof this.plugin.saveData !== "function") {
      throw new Error("插件数据存储不可用");
    }
    // This state queue serializes this service. Reading immediately before the
    // save also preserves namespaces written by other plugin services.
    const raw = (await this.plugin.loadData()) || {};
    const root = isObject(raw) ? { ...raw } : {};
    root.bookCuration = serialized;
    await this.plugin.saveData(root);
  }
}

module.exports = {
  BookCurationService,
  BOOKS_ROOT,
  DEFAULT_LOCAL_ENDPOINT,
  normalizeSettings,
  __test: {
    canonicalUrl,
    frontmatterIdentity,
    markdownBody,
    normalizeGenerator,
    selectedSubset,
    stableHash
  }
};
