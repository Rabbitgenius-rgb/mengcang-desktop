"use strict";

const {
  stableHash,
  makePairKey,
  makeRelationId,
  parseManagedRelations,
  upsertManagedRelation,
  removeManagedRelation,
  stripManagedRelations,
  rankCandidates,
  buildCanvasDocument
} = require("./core");
const { stripBookCurationBlock } = require("../book-curation/core");

const { createHash } = require("node:crypto");
const contentHash = value => createHash("sha256").update(value).digest("hex");

const SCHEMA_VERSION = 1;
const CANDIDATE_LIMIT = 3;
const CANDIDATE_MODEL_VERSION = "local-v2-safe-preview";
const CANVAS_ROOT = "03_projects/梦藏白板";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asList(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[,，、;；\n]/)
    .map(asText)
    .filter(Boolean);
}

function markdownToPlainText(markdown) {
  return String(markdown || "")
    .replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCurationForRanking(markdown) {
  try {
    return stripBookCurationBlock(markdown);
  } catch (_) {
    // A damaged generated region must not become ranking input or break the
    // rest of Star Sea. Curation confirmation itself still fails closed.
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    candidateCache: {},
    ignoredPairs: [],
    pendingTransaction: null
  };
}

function recordPath(record) {
  if (typeof record === "string") return asText(record);
  return asText(record?.path || record?.file?.path || record?.targetPath || record?.peerPath);
}

function recordTitle(record) {
  const path = recordPath(record);
  const fallback = path.split("/").pop()?.replace(/\.md$/i, "") || "未命名资料";
  return asText(record?.title || record?.targetTitle || record?.peerTitle || record?.name || record?.file?.basename) || fallback;
}

function canonicalRef(value) {
  return asText(typeof value === "string" ? value : recordPath(value))
    .normalize("NFC")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\.md$/i, "");
}

function relationIdOf(relation) {
  return asText(relation?.id || relation?.relationId || relation?.relation_id);
}

function relationExplanation(relation) {
  return asText(relation?.summary || relation?.explanation || relation?.reason);
}

function relationPath(relation, side) {
  const camel = side === "source" ? "sourcePath" : "targetPath";
  const snake = side === "source" ? "source_path" : "target_path";
  return asText(relation?.[camel] || relation?.[snake]);
}

function relationPeerPath(relation, anchorPath) {
  const sourcePath = relationPath(relation, "source");
  const targetPath = relationPath(relation, "target");
  const anchorRef = canonicalRef(anchorPath);
  if (canonicalRef(sourcePath) === anchorRef) return targetPath;
  if (canonicalRef(targetPath) === anchorRef) return sourcePath;
  return asText(relation?.peerPath || relation?.peer_path || targetPath || sourcePath);
}

function sanitizeShared(shared) {
  if (!isObject(shared)) return {};
  const output = {};
  for (const key of ["projects", "tags", "semantic", "keywords"]) {
    const values = asList(shared[key]).slice(0, 12);
    if (values.length) output[key] = values;
  }
  return output;
}

function sanitizeRelation(relation) {
  if (!isObject(relation)) return null;
  const id = relationIdOf(relation);
  const sourcePath = relationPath(relation, "source");
  const targetPath = relationPath(relation, "target");
  if (!id || !sourcePath || !targetPath) return null;
  return {
    id,
    sourcePath,
    targetPath,
    sourceTitle: asText(relation.sourceTitle || relation.source_title),
    targetTitle: asText(relation.targetTitle || relation.target_title),
    summary: relationExplanation(relation),
    origin: asText(relation.origin || relation.source) || "manual",
    confirmedAt: asText(relation.confirmedAt || relation.confirmed_at)
  };
}

function sanitizeCandidate(candidate) {
  const target = candidate?.target || candidate?.candidate || candidate;
  const targetPath = recordPath(target) || asText(candidate?.targetPath);
  if (!targetPath) return null;
  const score = Number(candidate?.score);
  return {
    targetPath,
    targetTitle: recordTitle(target) || asText(candidate?.targetTitle),
    targetKind: asText(target?.kind || candidate?.targetKind),
    score: Number.isFinite(score) ? score : 0,
    explanation: asText(candidate?.explanation),
    reasons: asList(candidate?.reasons).slice(0, 6),
    shared: sanitizeShared(candidate?.shared),
    pairKey: asText(candidate?.pairKey)
  };
}

function normalizeState(raw) {
  const state = defaultState();
  if (!isObject(raw) || Number(raw.schemaVersion) !== SCHEMA_VERSION) return state;

  if (isObject(raw.candidateCache)) {
    for (const [anchorPath, entry] of Object.entries(raw.candidateCache)) {
      if (!anchorPath || !isObject(entry)) continue;
      const candidates = Array.isArray(entry.candidates)
        ? entry.candidates.map(sanitizeCandidate).filter(Boolean).slice(0, CANDIDATE_LIMIT)
        : [];
      state.candidateCache[anchorPath] = {
        fingerprint: asText(entry.fingerprint),
        generatedAt: asText(entry.generatedAt),
        candidates
      };
    }
  }

  state.ignoredPairs = unique(Array.isArray(raw.ignoredPairs) ? raw.ignoredPairs.map(asText) : []).slice(-2000);
  state.pendingTransaction = isObject(raw.pendingTransaction)
    ? sanitizePendingTransaction(raw.pendingTransaction)
    : null;
  return state;
}

function sanitizePendingTransaction(transaction) {
  if (!isObject(transaction)) return null;
  const relationId = asText(transaction.relationId);
  const paths = unique(Array.isArray(transaction.paths) ? transaction.paths.map(asText) : []);
  if (!relationId || paths.length !== 2) return null;
  const priorRelations = {};
  if (isObject(transaction.priorRelations)) {
    for (const path of paths) {
      priorRelations[path] = sanitizeRelation(transaction.priorRelations[path]);
    }
  }
  return {
    id: asText(transaction.id),
    operation: asText(transaction.operation),
    // A persisted in-progress transaction means the plugin stopped before it
    // could prove that both sides committed. On reload it must be repaired,
    // never silently treated as complete.
    status: "repair_needed",
    relationId,
    paths,
    desiredRelation: sanitizeRelation(transaction.desiredRelation),
    priorRelations,
    completedPaths: unique(Array.isArray(transaction.completedPaths) ? transaction.completedPaths.map(asText) : []),
    failedPath: asText(transaction.failedPath),
    error: asText(transaction.error).slice(0, 500),
    startedAt: asText(transaction.startedAt),
    updatedAt: asText(transaction.updatedAt)
  };
}

function transactionError(message, details = {}) {
  const error = new Error(message);
  error.name = "StarSeaTransactionError";
  Object.assign(error, details);
  return error;
}

function preferredSubpath(record) {
  const explicit = asText(record?.subpath || record?.canvasSubpath);
  if (explicit) return explicit.startsWith("#") ? explicit : `#${explicit}`;

  const markdown = asText(record?.body || record?.markdown || record?.content);
  const headings = markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => ({ depth: match[1].length, text: match[2].replace(/\s+#+\s*$/, "").trim() }))
    .filter((heading) => heading.text);
  const preferred = headings.find((heading) => heading.depth >= 2 && /^(?:原始灵感|阅读笔记|正文|内容|观点|摘录)/.test(heading.text));
  const firstSection = headings.find((heading) => heading.depth >= 2);
  const heading = preferred || firstSection || headings[0];
  return heading ? `#${heading.text}` : "";
}

function safeFilename(value) {
  const cleaned = asText(value)
    .replace(/[\\/:*?"<>|#[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return cleaned || "星海创作";
}

class StarSeaService {
  constructor(plugin) {
    if (!plugin?.app?.vault) throw new TypeError("StarSeaService requires an Obsidian plugin instance");
    this.plugin = plugin;
    this.app = plugin.app;
    this.state = defaultState();
    this.loaded = false;
    this.dataQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
  }

  async loadData() {
    const raw = (await this.plugin.loadData()) || {};
    const source = isObject(raw.starSea) ? raw.starSea : raw;
    this.state = normalizeState(source);
    this.loaded = true;
    return this.getState();
  }

  async saveData() {
    const serialized = this.getState();
    const task = async () => {
      if (typeof this.plugin.updateMengcangData === "function") {
        await this.plugin.updateMengcangData((raw) => ({ ...raw, starSea: serialized }));
        return serialized;
      }
      const raw = (await this.plugin.loadData()) || {};
      const next = isObject(raw) ? { ...raw, starSea: serialized } : { starSea: serialized };
      await this.plugin.saveData(next);
      return serialized;
    };
    const run = this.dataQueue.then(task, task);
    this.dataQueue = run.catch(() => undefined);
    return run;
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getPendingTransaction() {
    return this.state.pendingTransaction ? JSON.parse(JSON.stringify(this.state.pendingTransaction)) : null;
  }

  buildCorpus(snapshot = {}) {
    const buckets = [
      ["books", "book"],
      ["patterns", "pattern"],
      ["textCards", "text"],
      ["webClips", "web"]
    ];
    const corpus = [];
    const seen = new Set();

    for (const [key, fallbackKind] of buckets) {
      const records = Array.isArray(snapshot?.[key]) ? snapshot[key] : [];
      for (const record of records) {
        const path = recordPath(record);
        if (!path || seen.has(path) || record?.isDemo || record?.isAtlas) continue;
        const file = record?.file || this.app.vault.getAbstractFileByPath(path);
        if (!file || asText(file.extension || path.split(".").pop()).toLowerCase() !== "md") continue;
        seen.add(path);
        const rawMarkdown = typeof record?.rawMarkdown === "string"
          ? record.rawMarkdown
          : typeof record?.markdown === "string"
            ? record.markdown
            : typeof record?.content === "string"
              ? record.content
              : typeof record?.body === "string"
                ? record.body
                : "";
        const searchableBody = stripCurationForRanking(stripManagedRelations(rawMarkdown));
        corpus.push({
          ...record,
          file,
          path,
          title: recordTitle(record),
          kind: asText(record?.kind) || fallbackKind,
          tags: unique(asList(record?.tags)),
          projectIds: unique(asList(record?.projectIds || record?.projects)),
          summary: asText(record?.summary || record?.description),
          rawMarkdown,
          body: searchableBody,
          bodyText: markdownToPlainText(searchableBody),
          subpath: preferredSubpath(record)
        });
      }
    }
    return corpus;
  }

  getCandidates(anchor, corpus, options = {}) {
    const anchorRecord = this._resolveRecord(anchor, corpus);
    const anchorPath = recordPath(anchorRecord);
    if (!anchorPath) return [];

    const confirmedPairKeys = this._confirmedPairKeysFromRecord(anchorRecord);
    const fingerprint = this._candidateFingerprint(anchorRecord, corpus);
    let cacheEntry = this.state.candidateCache[anchorPath];

    if (options.force || !cacheEntry || cacheEntry.fingerprint !== fingerprint) {
      const ranked = rankCandidates(anchorRecord, corpus, {
        limit: CANDIDATE_LIMIT,
        confirmedPairKeys,
        minScore: Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : undefined
      });
      const candidates = (Array.isArray(ranked) ? ranked : [])
        .map((entry) => {
          const normalized = sanitizeCandidate(entry);
          if (!normalized) return null;
          normalized.pairKey = normalized.pairKey || makePairKey(anchorPath, normalized.targetPath);
          return normalized;
        })
        .filter(Boolean)
        .slice(0, CANDIDATE_LIMIT);
      cacheEntry = {
        fingerprint,
        generatedAt: nowIso(),
        candidates
      };
      this.state.candidateCache[anchorPath] = cacheEntry;
      void this.saveData().catch(() => undefined);
    }

    const ignored = new Set(this.state.ignoredPairs);
    const confirmed = new Set(confirmedPairKeys);
    const byPath = new Map(corpus.map((record) => [canonicalRef(record), record]));
    return cacheEntry.candidates
      .filter((candidate) => !ignored.has(candidate.pairKey) && !confirmed.has(candidate.pairKey))
      .map((candidate) => ({
        ...candidate,
        origin: "local",
        target: byPath.get(canonicalRef(candidate.targetPath)) || {
          path: candidate.targetPath,
          title: candidate.targetTitle,
          kind: candidate.targetKind
        }
      }));
  }

  getConfirmed(anchor, corpus = []) {
    const anchorRecord = this._resolveRecord(anchor, corpus);
    const anchorPath = recordPath(anchorRecord);
    const markdown = typeof anchorRecord?.rawMarkdown === "string" ? anchorRecord.rawMarkdown : "";
    if (!anchorPath || !markdown) return [];
    const relations = this._relationsFromMarkdown(markdown);
    const byPath = new Map(corpus.map((record) => [canonicalRef(record), record]));
    return relations.map((relation) => {
      const peerRef = relationPeerPath(relation, anchorPath);
      const peer = byPath.get(canonicalRef(peerRef));
      const peerFile = peer ? this._resolveFile(peer) : this._resolveFile(peerRef);
      const peerPath = recordPath(peer) || asText(peerFile?.path) || `${canonicalRef(peerRef)}.md`;
      return {
        relationId: relationIdOf(relation),
        peerPath,
        peerTitle: peer ? recordTitle(peer) : this._peerTitleFromRelation(relation, anchorPath),
        explanation: relationExplanation(relation),
        origin: asText(relation.origin || relation.source),
        confirmedAt: asText(relation.confirmedAt || relation.confirmed_at),
        peer: peer || null
      };
    });
  }

  explainPair(anchor, target) {
    const ranked = rankCandidates(anchor, [target], { limit: 1, minScore: 0 });
    return ranked[0]?.explanation || `「${recordTitle(anchor)}」与「${recordTitle(target)}」之间存在一条值得继续验证的联系。`;
  }

  async ignoreCandidate(anchor, target) {
    await this._ensureLoaded();
    const anchorPath = recordPath(anchor);
    const targetPath = recordPath(target);
    if (!anchorPath || !targetPath || anchorPath === targetPath) return false;
    const pairKey = makePairKey(anchorPath, targetPath);
    if (this.state.ignoredPairs.includes(pairKey)) return false;
    this.state.ignoredPairs.push(pairKey);
    this.state.ignoredPairs = unique(this.state.ignoredPairs).slice(-2000);
    await this.saveData();
    return true;
  }

  async restoreIgnoredCandidate(anchor, target) {
    await this._ensureLoaded();
    const pairKey = makePairKey(recordPath(anchor), recordPath(target));
    const next = this.state.ignoredPairs.filter((item) => item !== pairKey);
    if (next.length === this.state.ignoredPairs.length) return false;
    this.state.ignoredPairs = next;
    await this.saveData();
    return true;
  }

  async confirmRelation(anchor, target, explanation, origin = "manual", options = {}) {
    const summary = asText(explanation);
    if (!summary) throw new TypeError("点亮关系前需要一句关系说明");
    const left = this._relationEndpoint(anchor);
    const right = this._relationEndpoint(target);
    if (!left.path || !right.path || left.path === right.path) throw new TypeError("关系两端必须是两篇不同的真实笔记");
    const relationId = makeRelationId(left.path, right.path);
    const relation = {
      id: relationId,
      sourcePath: left.path,
      targetPath: right.path,
      sourceTitle: left.title,
      targetTitle: right.title,
      summary,
      origin: ["ai", "ai_confirmed", "manual", "local", "local_confirmed"].includes(asText(origin))
        ? asText(origin)
        : "manual",
      confirmedAt: nowIso()
    };
    const result = await this._enqueueWrite(() => this._runBidirectionalTransaction({
      operation: "confirm",
      relation,
      endpoints: [left, right],
      expectedHashes: options.expectedHashes
    }));
    return {
      ...result,
      peerPath: right.path,
      relationId,
      explanation: summary
    };
  }

  async updateRelation(anchor, relationId, explanation) {
    const summary = asText(explanation);
    if (!summary) throw new TypeError("关系说明不能为空");
    const context = await this._relationContext(anchor, relationId);
    if (!context) throw new Error(`找不到关系：${asText(relationId)}`);
    const relation = { ...context.relation, summary };
    const result = await this._enqueueWrite(() => this._runBidirectionalTransaction({
      operation: "update",
      relation,
      endpoints: [context.anchor, context.peer]
    }));
    return {
      ...result,
      peerPath: context.peer.path,
      relationId: relation.id,
      explanation: summary
    };
  }

  async removeRelation(anchor, relationId, options = {}) {
    const context = await this._relationContext(anchor, relationId);
    if (!context) return { removed: false, relationId: asText(relationId), peerPath: "" };
    const result = await this._enqueueWrite(() => this._runBidirectionalTransaction({
      operation: "remove",
      relation: context.relation,
      endpoints: [context.anchor, context.peer],
      remove: true,
      expectedHashes: options.expectedHashes
    }));
    return {
      ...result,
      removed: true,
      peerPath: context.peer.path,
      relationId: context.relation.id,
      explanation: context.relation.summary
    };
  }

  async repairPendingTransaction(strategy = "rollback") {
    await this._ensureLoaded();
    const pending = this.state.pendingTransaction;
    if (!pending || pending.status !== "repair_needed") return { repaired: false, reason: "none" };
    const useDesired = strategy === "complete";
    const failures = [];
    for (const path of pending.paths) {
      const file = this._resolveFile(path);
      if (!file) {
        failures.push({ path, error: "file_missing" });
        continue;
      }
      const relation = useDesired ? pending.desiredRelation : pending.priorRelations[path];
      try {
        await this._mutateFile(file, (markdown) => this._applyRelationState(markdown, pending.relationId, relation, path));
      } catch (error) {
        failures.push({ path, error: asText(error?.message || error) });
      }
    }
    if (failures.length) {
      pending.error = failures.map((item) => `${item.path}: ${item.error}`).join("; ").slice(0, 500);
      pending.updatedAt = nowIso();
      await this.saveData();
      return { repaired: false, failures, pending: this.getPendingTransaction() };
    }
    this.state.pendingTransaction = null;
    await this.saveData();
    return { repaired: true, strategy };
  }

  async createCanvas(anchor, selectedNodes = [], confirmedRelations = []) {
    const anchorRecord = this._canvasRecord(anchor);
    const selected = Array.isArray(selectedNodes) ? selectedNodes : [];
    const relations = Array.isArray(confirmedRelations) ? confirmedRelations : [];
    const records = [anchorRecord, ...selected.map((item) => this._canvasRecord(item?.target || item))]
      .filter((record) => record.path);
    const deduped = [...new Map(records.map((record) => [record.path, record])).values()];
    if (!anchorRecord.path || !anchorRecord.file) throw new TypeError("创建白板需要一个真实 Markdown 基点");
    if (deduped.some((record) => !record.file)) throw new TypeError("白板只能加入真实 Markdown 文件");

    const selectedPaths = new Set(deduped.map((record) => record.path));
    const selectedRefs = new Set(deduped.map((record) => canonicalRef(record.path)));
    const edges = relations
      .map((relation) => ({
        id: relationIdOf(relation),
        sourcePath: relationPath(relation, "source") || anchorRecord.path,
        targetPath: relationPath(relation, "target") || asText(relation.peerPath),
        label: relationExplanation(relation)
      }))
      .filter((edge) => selectedRefs.has(canonicalRef(edge.sourcePath)) && selectedRefs.has(canonicalRef(edge.targetPath)));
    const document = buildCanvasDocument(deduped, edges, { anchorPath: anchorRecord.path });
    const byRef = new Map(deduped.map((record) => [canonicalRef(record.path), record]));
    for (const node of document.nodes || []) {
      const record = byRef.get(canonicalRef(node.file));
      if (record?.subpath) node.subpath = record.subpath;
    }
    this._assertCanvasDocument(document, selectedPaths);

    await this._ensureFolder(CANVAS_ROOT);
    const date = new Date().toISOString().slice(0, 10);
    const base = `${date}-${safeFilename(anchorRecord.title)}-星海`;
    const canvasPath = this._unusedCanvasPath(`${CANVAS_ROOT}/${base}.canvas`);
    const created = await this.app.vault.create(canvasPath, `${JSON.stringify(document, null, 2)}\n`);
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(created);
    if (typeof this.app.workspace.revealLeaf === "function") await this.app.workspace.revealLeaf(leaf);
    return { path: canvasPath, file: created, document };
  }

  _resolveRecord(record, corpus = []) {
    const path = recordPath(record);
    const found = corpus.find((item) => recordPath(item) === path);
    if (!found) return record || {};
    if (!record || record === found) return found;
    return { ...found, ...record, file: record.file || found.file };
  }

  _resolveFile(recordOrPath) {
    if (recordOrPath?.file) {
      const extension = asText(recordOrPath.file.extension || recordOrPath.file.path?.split(".").pop()).toLowerCase();
      return extension === "md" ? recordOrPath.file : null;
    }
    const path = typeof recordOrPath === "string" ? recordOrPath : recordPath(recordOrPath);
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path)
      || this.app.vault.getAbstractFileByPath(`${canonicalRef(path)}.md`);
    const extension = asText(file?.extension || path.split(".").pop()).toLowerCase();
    return file && extension === "md" ? file : null;
  }

  _relationEndpoint(record) {
    const path = recordPath(record);
    const file = this._resolveFile(record);
    if (!path || !file) throw new TypeError("关系只能连接真实 Markdown 笔记");
    return { path, title: recordTitle(record), file };
  }

  async _relationContext(anchor, relationId) {
    const anchorEndpoint = this._relationEndpoint(anchor);
    const markdown = await this._readFile(anchorEndpoint.file);
    const parsed = this._relationsFromMarkdown(markdown);
    const found = parsed.find((relation) => relationIdOf(relation) === asText(relationId));
    if (!found) return null;
    const relation = sanitizeRelation(found);
    if (!relation) throw new Error(`关系数据损坏：${asText(relationId)}`);
    const peerRef = relationPeerPath(relation, anchorEndpoint.path);
    const peerFile = this._resolveFile(peerRef);
    const peerPath = asText(peerFile?.path) || `${canonicalRef(peerRef)}.md`;
    if (!peerFile) throw new Error(`关系另一端不存在：${peerPath}`);
    return {
      relation,
      anchor: anchorEndpoint,
      peer: {
        path: peerPath,
        title: this._peerTitleFromRelation(relation, anchorEndpoint.path),
        file: peerFile
      }
    };
  }

  _peerTitleFromRelation(relation, anchorPath) {
    return canonicalRef(relationPath(relation, "source")) === canonicalRef(anchorPath)
      ? asText(relation.targetTitle || relation.target_title)
      : asText(relation.sourceTitle || relation.source_title);
  }

  _relationsFromMarkdown(markdown) {
    const parsed = parseManagedRelations(markdown);
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.relations) ? parsed.relations : [];
  }

  async _confirmedPairKeys(anchor) {
    const path = recordPath(anchor);
    const file = this._resolveFile(anchor);
    if (!path || !file) return [];
    const markdown = await this._readFile(file);
    return unique(this._relationsFromMarkdown(markdown)
      .map((relation) => relationPeerPath(relation, path))
      .filter(Boolean)
      .map((peerPath) => makePairKey(path, peerPath)));
  }

  _confirmedPairKeysFromRecord(anchor) {
    const path = recordPath(anchor);
    const markdown = typeof anchor?.rawMarkdown === "string" ? anchor.rawMarkdown : "";
    if (!path || !markdown) return [];
    return unique(this._relationsFromMarkdown(markdown)
      .map((relation) => relationPeerPath(relation, path))
      .filter(Boolean)
      .map((peerPath) => makePairKey(path, peerPath)));
  }

  _candidateFingerprint(anchor, corpus) {
    const parts = corpus
      .map((record) => [
        recordPath(record),
        stableHash(JSON.stringify([
          recordTitle(record),
          asText(record?.kind),
          asList(record?.tags),
          asList(record?.projectIds),
          asText(record?.summary),
          stripCurationForRanking(stripManagedRelations(typeof record?.rawMarkdown === "string"
            ? record.rawMarkdown
            : asText(record?.body || record?.bodyText)))
        ]))
      ])
      .sort((left, right) => left[0].localeCompare(right[0]));
    return stableHash(JSON.stringify({
      candidateModelVersion: CANDIDATE_MODEL_VERSION,
      anchorPath: recordPath(anchor),
      parts
    }));
  }

  async _readFile(file) {
    if (typeof this.app.vault.cachedRead === "function") return this.app.vault.cachedRead(file);
    return this.app.vault.read(file);
  }

  async _mutateFile(file, transform) {
    let changed = false;
    if (typeof this.app.vault.process === "function") {
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

  _applyRelationState(markdown, relationId, relation, sidePath) {
    return relation
      ? upsertManagedRelation(markdown, relation, sidePath)
      : removeManagedRelation(markdown, relationId);
  }

  async _runBidirectionalTransaction({ operation, relation, endpoints, remove = false, expectedHashes = null }) {
    await this._ensureLoaded();
    if (this.state.pendingTransaction?.status === "repair_needed") {
      throw transactionError("存在尚未修复的双向关系事务，请先完成修复", {
        repairNeeded: true,
        pending: this.getPendingTransaction()
      });
    }
    const cleanRelation = sanitizeRelation(relation);
    if (!cleanRelation) throw new TypeError("关系数据不完整");
    if (!Array.isArray(endpoints) || endpoints.length !== 2) throw new TypeError("双向关系需要两个端点");

    const normalizedEndpoints = endpoints.map((endpoint) => this._relationEndpoint(endpoint));
    const paths = normalizedEndpoints.map((endpoint) => endpoint.path);
    const priorRelations = {};
    for (const endpoint of normalizedEndpoints) {
      const markdown = await this._readFile(endpoint.file);
      const prior = this._relationsFromMarkdown(markdown)
        .find((item) => relationIdOf(item) === cleanRelation.id);
      priorRelations[endpoint.path] = sanitizeRelation(prior);
    }

    const desiredRelation = remove ? null : cleanRelation;
    const pending = {
      id: `tx-${stableHash(`${operation}:${cleanRelation.id}:${Date.now()}`)}`,
      operation,
      status: "in_progress",
      relationId: cleanRelation.id,
      paths,
      desiredRelation,
      priorRelations,
      completedPaths: [],
      failedPath: "",
      error: "",
      startedAt: nowIso(),
      updatedAt: nowIso()
    };
    this.state.pendingTransaction = pending;
    await this.saveData();

    const changedEndpoints = [];
    try {
      for (const endpoint of normalizedEndpoints) {
        const changed = await this._mutateFile(endpoint.file, (markdown) => {
          if (expectedHashes && contentHash(markdown) !== expectedHashes[endpoint.path]) {
            throw transactionError("关系笔记已有新的修改，请刷新核对", { code: "CONFLICT", status: 409 });
          }
          return this._applyRelationState(markdown, cleanRelation.id, desiredRelation, endpoint.path);
        });
        if (changed) changedEndpoints.push(endpoint);
        pending.completedPaths.push(endpoint.path);
        pending.updatedAt = nowIso();
      }
      await this._verifyBidirectionalState(normalizedEndpoints, cleanRelation.id, desiredRelation);
    } catch (writeError) {
      pending.failedPath = paths.find((path) => !pending.completedPaths.includes(path)) || "";
      pending.error = asText(writeError?.message || writeError).slice(0, 500);
      const compensationFailures = [];
      for (const endpoint of [...changedEndpoints].reverse()) {
        try {
          const prior = priorRelations[endpoint.path];
          await this._mutateFile(endpoint.file, (markdown) => {
            // Native edits outside the managed relation are preserved. If the
            // relation itself changed concurrently, surface repair instead of
            // overwriting that newer user decision during compensation.
            const current = sanitizeRelation(this._relationsFromMarkdown(markdown)
              .find(item => relationIdOf(item) === cleanRelation.id));
            const same = !desiredRelation ? !current : current
              && current.id === desiredRelation.id
              && current.summary === desiredRelation.summary
              && current.origin === desiredRelation.origin
              && current.confirmedAt === desiredRelation.confirmedAt
              && makePairKey(current.sourcePath, current.targetPath) === makePairKey(desiredRelation.sourcePath, desiredRelation.targetPath);
            if (!same) {
              throw transactionError("关系在补偿前发生变化，需要人工核对", { code: "RELATION_REPAIR_REQUIRED" });
            }
            return this._applyRelationState(markdown, cleanRelation.id, prior, endpoint.path);
          });
        } catch (compensationError) {
          compensationFailures.push({
            path: endpoint.path,
            error: asText(compensationError?.message || compensationError)
          });
        }
      }

      if (compensationFailures.length) {
        pending.status = "repair_needed";
        pending.error = `${pending.error}; compensation: ${compensationFailures.map((item) => `${item.path}: ${item.error}`).join("; ")}`.slice(0, 500);
        pending.updatedAt = nowIso();
        await this.saveData();
        throw transactionError("双向关系写入失败，且补偿未完成，需要修复", {
          relationId: cleanRelation.id,
          repairNeeded: true,
          pending: this.getPendingTransaction(),
          cause: writeError
        });
      }

      this.state.pendingTransaction = null;
      await this.saveData();
      throw transactionError("双向关系写入失败，已撤回本次关系块变更", {
        relationId: cleanRelation.id,
        compensated: true,
        code: writeError.code,
        status: writeError.status,
        cause: writeError
      });
    }

    this.state.pendingTransaction = null;
    if (remove) {
      const pairKey = makePairKey(paths[0], paths[1]);
      this.state.ignoredPairs = unique([...this.state.ignoredPairs, pairKey]).slice(-2000);
    }
    await this.saveData();
    return {
      ok: true,
      operation,
      relationId: cleanRelation.id,
      explanation: cleanRelation.summary,
      paths
    };
  }

  _enqueueWrite(task) {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async _verifyBidirectionalState(endpoints, relationId, desiredRelation) {
    const expected = desiredRelation ? sanitizeRelation(desiredRelation) : null;
    for (let index = 0; index < endpoints.length; index += 1) {
      const endpoint = endpoints[index];
      const peer = endpoints[index === 0 ? 1 : 0];
      const markdown = await this._readFile(endpoint.file);
      const found = this._relationsFromMarkdown(markdown)
        .find((relation) => relationIdOf(relation) === relationId);
      if (!expected) {
        if (found) throw new Error(`关系撤回验证失败：${endpoint.path}`);
        continue;
      }
      const actual = sanitizeRelation(found);
      const linkedPath = asText(found?.linkedPath || found?.linked_path);
      if (
        !actual
        || actual.summary !== expected.summary
        || actual.origin !== expected.origin
        || actual.confirmedAt !== expected.confirmedAt
        || makePairKey(actual.sourcePath, actual.targetPath) !== makePairKey(expected.sourcePath, expected.targetPath)
        || canonicalRef(linkedPath) !== canonicalRef(peer.path)
      ) {
        throw new Error(`双向关系验证失败：${endpoint.path}`);
      }
    }
  }

  async _ensureLoaded() {
    if (!this.loaded) await this.loadData();
  }

  _canvasRecord(record) {
    const path = recordPath(record);
    return {
      path,
      title: recordTitle(record),
      kind: asText(record?.kind),
      file: this._resolveFile(record),
      subpath: preferredSubpath(record)
    };
  }

  _assertCanvasDocument(document, selectedPaths) {
    if (!isObject(document) || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
      throw new Error("白板文档生成失败");
    }
    const nodeIds = new Set();
    const representedPaths = new Set();
    for (const node of document.nodes) {
      if (node?.type !== "file" || !selectedPaths.has(asText(node.file))) {
        throw new Error("白板只允许引用真实 Markdown 文件节点");
      }
      if (!asText(node.id) || nodeIds.has(node.id)) throw new Error("白板节点 ID 无效");
      nodeIds.add(node.id);
      representedPaths.add(asText(node.file));
    }
    if ([...selectedPaths].some((path) => !representedPaths.has(path))) {
      throw new Error("白板缺少已选择的素材节点");
    }
    for (const edge of document.edges) {
      if (!nodeIds.has(edge?.fromNode) || !nodeIds.has(edge?.toNode)) {
        throw new Error("白板关系引用了不存在的节点");
      }
    }
  }

  async _ensureFolder(path) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  _unusedCanvasPath(initialPath) {
    if (!this.app.vault.getAbstractFileByPath(initialPath)) return initialPath;
    const stem = initialPath.replace(/\.canvas$/i, "");
    let index = 2;
    let candidate = `${stem}-${index}.canvas`;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      index += 1;
      candidate = `${stem}-${index}.canvas`;
    }
    return candidate;
  }
}

module.exports = {
  StarSeaService,
  SCHEMA_VERSION,
  CANDIDATE_LIMIT,
  CANVAS_ROOT,
  __test: {
    asList,
    markdownToPlainText,
    defaultState,
    normalizeState,
    preferredSubpath,
    recordPath,
    safeFilename,
    sanitizeCandidate,
    sanitizeShared,
    sanitizePendingTransaction,
    sanitizeRelation
  }
};
