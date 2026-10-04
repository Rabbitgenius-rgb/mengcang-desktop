"use strict";

/**
 * Pure helpers for 梦藏's book-curation workflow.
 *
 * This module deliberately has no Obsidian runtime dependency. Drafts are
 * normalized into review-only data; Markdown is produced only by the explicit
 * render/upsert helpers used after confirmation.
 */

const { stableHash } = require("../star-sea/core");

const SCHEMA_VERSION = 1;
const GENERATOR_VERSION = "book-curation-v1";
const PROMPT_VERSION = "zh-curation-v1";
const AI_CURATORIAL_LABEL = "AI 策展引思句（非作者原文）";
const WORK_NOTES_ROOT = "01_sources/cards/text/作品";
const BOOK_CURATION_MANAGED_START = "<!-- mengcang-book-curation:start -->";
const BOOK_CURATION_MANAGED_END = "<!-- mengcang-book-curation:end -->";
const BOOK_CURATION_HEADING = "## 梦藏阅读引线";

const VALID_JOB_STATUSES = new Set(["pending", "ready", "confirmed", "error"]);
const VALID_READING_STAGES = new Set(["before", "during", "after"]);
const VALID_SPOILER_LEVELS = new Set(["none", "mild", "full"]);
const VALID_REUSE_STATUSES = new Set(["allowed", "prohibited", "unknown"]);
const VALID_RESOLUTION_KINDS = new Set(["existing_note", "new_note"]);
const VALID_WORK_TYPES = new Set([
  "artwork",
  "painting",
  "drawing",
  "print",
  "photography",
  "sculpture",
  "film",
  "music",
  "literature",
  "architecture",
  "other",
]);

class CurationValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CurationValidationError";
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUnicode(value) {
  return String(value == null ? "" : value).normalize("NFC");
}

function inlineText(value, maxLength = 500) {
  const text = normalizeUnicode(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, maxLength).join("");
}

function requiredText(value, field, maxLength = 500) {
  const text = inlineText(value, maxLength);
  if (!text) {
    throw new CurationValidationError(
      "MISSING_REQUIRED_FIELD",
      `${field} is required`,
      { field }
    );
  }
  return text;
}

function stringList(value, options = {}) {
  const raw = Array.isArray(value)
    ? value
    : value == null || value === ""
      ? []
      : String(value).split(/[,，、;；\n]/);
  const result = [];
  const seen = new Set();
  for (const item of raw) {
    const text = inlineText(item, options.maxLength || 160);
    const key = text.toLocaleLowerCase("zh-CN");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= (options.limit || 30)) break;
  }
  return options.sort
    ? result.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))
    : result;
}

function canonicalMarkdownPath(value) {
  let raw = value;
  if (isObject(value)) raw = value.path || value.file?.path || value.id || "";
  const normalized = normalizeUnicode(raw)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "");
  if (!normalized || normalized.includes("\u0000") || /(^|\/)\.\.?($|\/)/.test(normalized)) return "";
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function wikilinkRef(value) {
  return canonicalMarkdownPath(value).replace(/\.md$/i, "");
}

function safeId(value) {
  return inlineText(value, 160).replace(/[^a-zA-Z0-9._-]/g, "");
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function safeHttpUrl(value, field = "url", required = false) {
  const text = inlineText(value, 2048);
  if (!text) {
    if (required) {
      throw new CurationValidationError("MISSING_SOURCE", `${field} is required`, { field });
    }
    return "";
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    throw new CurationValidationError("INVALID_URL", `${field} must be an HTTP(S) URL`, { field });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CurationValidationError("INVALID_URL", `${field} must be a public HTTP(S) URL`, { field });
  }
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function defaultBookCurationState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      autoGenerate: true,
      generator: "local-template",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "",
      fallbackOnError: true,
      timeoutMs: 12000,
      useBuiltInExamples: true,
      generatorVersion: GENERATOR_VERSION,
      promptVersion: PROMPT_VERSION,
    },
    jobs: {},
  };
}

function normalizeSettings(value) {
  const raw = isObject(value) ? value : {};
  const timeout = Number(raw.timeoutMs);
  return {
    autoGenerate: raw.autoGenerate !== false,
    generator: inlineText(raw.generator || raw.provider, 80) || "local-template",
    endpoint: inlineText(raw.endpoint, 500) || "http://127.0.0.1:11434/v1",
    model: inlineText(raw.model, 160),
    fallbackOnError: raw.fallbackOnError !== false,
    timeoutMs: Number.isFinite(timeout) && timeout > 0
      ? Math.max(1, Math.min(60000, Math.trunc(timeout)))
      : 12000,
    useBuiltInExamples: raw.useBuiltInExamples !== false,
    generatorVersion: inlineText(raw.generatorVersion, 120) || GENERATOR_VERSION,
    promptVersion: inlineText(raw.promptVersion, 120) || PROMPT_VERSION,
  };
}

function normalizeError(value) {
  if (!isObject(value)) return null;
  const code = inlineText(value.code, 100);
  const message = inlineText(value.message, 500);
  if (!code && !message) return null;
  return {
    code: code || "UNKNOWN",
    message,
    repairNeeded: value.repairNeeded === true,
    at: inlineText(value.at, 80),
  };
}

function normalizeCreatedWorkPaths(value) {
  const output = {};
  if (!isObject(value)) return output;
  for (const [candidateId, rawPath] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(candidateId)) continue;
    const id = safeId(candidateId);
    const path = canonicalMarkdownPath(rawPath);
    if (id && path) output[id] = path;
  }
  return output;
}

function normalizeJob(value, fallbackPath = "") {
  if (!isObject(value)) return null;
  const path = canonicalMarkdownPath(value.path || value.bookPath || fallbackPath);
  if (!path) return null;
  let status = VALID_JOB_STATUSES.has(value.status) ? value.status : "error";
  let draft = null;
  let error = normalizeError(value.error);
  if (value.draft != null) {
    try {
      draft = sanitizeCurationDraft(value.draft);
    } catch (draftError) {
      status = "error";
      error = {
        code: "INVALID_STORED_DRAFT",
        message: inlineText(draftError.message, 500),
        repairNeeded: false,
        at: "",
      };
    }
  }
  if ((status === "ready" || status === "confirmed") && !draft) {
    status = "error";
    error = {
      code: "MISSING_STORED_DRAFT",
      message: "ready or confirmed jobs must retain their validated draft",
      repairNeeded: false,
      at: "",
    };
  }
  return {
    path,
    fingerprint: safeId(value.fingerprint),
    generationKey: safeId(value.generationKey),
    status,
    draft,
    error,
    attempts: Math.max(0, Math.min(1000, Math.trunc(Number(value.attempts) || 0))),
    confirmedAt: inlineText(value.confirmedAt, 80),
    createdWorkPaths: normalizeCreatedWorkPaths(value.createdWorkPaths),
    confirmKey: safeId(value.confirmKey),
    updatedAt: inlineText(value.updatedAt, 80),
  };
}

function normalizeBookCurationState(raw) {
  const state = defaultBookCurationState();
  if (!isObject(raw) || Number(raw.schemaVersion) !== SCHEMA_VERSION) return state;
  state.settings = normalizeSettings(raw.settings);
  const sourceJobs = isObject(raw.jobs)
    ? raw.jobs
    : isObject(raw.jobsByBook)
      ? raw.jobsByBook
      : {};
  for (const [key, value] of Object.entries(sourceJobs)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const job = normalizeJob(value, key);
    if (job) state.jobs[job.path] = job;
  }
  return state;
}

function bookInputSnapshot(book, versions = {}) {
  const source = isObject(book) ? book : {};
  const path = canonicalMarkdownPath(source.path || source.file?.path || source.id);
  if (!path) {
    throw new CurationValidationError("INVALID_BOOK_PATH", "book must contain a Markdown path");
  }
  return {
    path,
    title: inlineText(source.title || source.file?.basename, 300),
    author: stringList(source.author || source.authors, { limit: 12, maxLength: 160 }),
    translator: stringList(source.translator || source.translators, { limit: 12, maxLength: 160 }),
    summary: inlineText(source.summary || source.description, 4000),
    tags: stringList(source.tags, { limit: 60, maxLength: 120, sort: true }),
    language: inlineText(source.language, 80),
    curationSeed: inlineText(source.curation_seed ?? source.curationSeed, 2000),
    generatorVersion: inlineText(versions.generatorVersion, 120) || GENERATOR_VERSION,
    promptVersion: inlineText(versions.promptVersion, 120) || PROMPT_VERSION,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function bookInputFingerprint(book, versions = {}) {
  return stableHash(stableStringify(bookInputSnapshot(book, versions)));
}

function makeGenerationKey(book, versions = {}) {
  const snapshot = bookInputSnapshot(book, versions);
  return `bc-gen-${stableHash(stableStringify({
    contract: "book-curation-generation-v1",
    path: snapshot.path,
    fingerprint: stableHash(stableStringify(snapshot)),
    generatorVersion: snapshot.generatorVersion,
    promptVersion: snapshot.promptVersion,
  }))}`;
}

function stableLineId(text) {
  return `line-${stableHash(`line-v1\u0000${text}`)}`;
}

function stableQuestionId(text, readingStage, spoilerLevel) {
  return `question-${stableHash(`question-v1\u0000${readingStage}\u0000${spoilerLevel}\u0000${text}`)}`;
}

function canonicalWorkIdentity(work) {
  const source = isObject(work.source) ? work.source : {};
  const institution = inlineText(source.institution || work.institution, 200).toLocaleLowerCase("zh-CN");
  const catalogId = inlineText(source.catalogId || source.catalog_id || work.catalogId, 200).toLocaleLowerCase("zh-CN");
  if (institution && catalogId) return `catalog\u0000${institution}\u0000${catalogId}`;
  const catalogUrl = safeHttpUrl(source.catalogUrl || source.catalog_url || work.sourceUrl || work.source_url, "source.catalogUrl", false);
  if (catalogUrl) return `url\u0000${catalogUrl}`;
  const title = requiredText(work.title, "relatedWorks[].title", 300).toLocaleLowerCase("zh-CN");
  const creator = inlineText(work.creator || work.artist || work.author, 240).toLocaleLowerCase("zh-CN");
  const year = inlineText(work.year || work.workYear || work.work_year, 80);
  return `metadata\u0000${title}\u0000${creator}\u0000${year}`;
}

function makeCandidateId(work) {
  return `work-candidate-${stableHash(`work-candidate-v1\u0000${canonicalWorkIdentity(work)}`)}`;
}

function makeWorkId(work) {
  return `work-${stableHash(`work-v1\u0000${canonicalWorkIdentity(work)}`)}`;
}

function safeFilename(value, fallback = "未命名作品") {
  let text = normalizeUnicode(value)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/[\[\]#^]/g, " ")
    .replace(/(?:^|\s)\.{1,2}(?=\s|$)/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "." || text === "..") text = inlineText(fallback, 80) || "未命名作品";
  text = Array.from(text).slice(0, 100).join("").replace(/[ .]+$/g, "");
  return text || `作品-${stableHash(value).slice(0, 8)}`;
}

function makeWorkNotePath(work) {
  const title = requiredText(work.title, "work.title", 300);
  const creator = inlineText(work.creator || work.artist || work.author, 240);
  const stem = safeFilename(creator ? `${title} — ${creator}` : title, makeWorkId(work));
  return `${WORK_NOTES_ROOT}/${stem}.md`;
}

function sanitizeCuratorialLine(value, index) {
  const raw = typeof value === "string" ? { text: value } : value;
  if (!isObject(raw)) {
    throw new CurationValidationError("INVALID_CURATORIAL_LINE", `curatorialLines[${index}] must be an object or string`);
  }
  if (inlineText(raw.attribution || raw.author || raw.quoteSource || raw.quote_source, 200)) {
    throw new CurationValidationError(
      "CURATORIAL_LINE_ATTRIBUTION_FORBIDDEN",
      "AI curatorial prompts must not be attributed to an author",
      { index }
    );
  }
  if (raw.sourceType && raw.sourceType !== "ai_generated") {
    throw new CurationValidationError(
      "CURATORIAL_LINE_SOURCE_INVALID",
      "curatorial prompt sourceType must be ai_generated",
      { index }
    );
  }
  if (raw.kind && raw.kind !== "curatorial_prompt") {
    const safeGeneratorKinds = new Set(["curatorial-generated", "curatorial_prompt"]);
    if (safeGeneratorKinds.has(raw.kind) && raw.isSourceQuote !== true) {
      // Continue below; aliases are normalized to the strict public contract.
    } else {
      throw new CurationValidationError(
        "CURATORIAL_LINE_KIND_INVALID",
        "AI generated text cannot be stored as an author quote",
        { index }
      );
    }
  }
  if (raw.isSourceQuote === true || raw.is_source_quote === true) {
    throw new CurationValidationError(
      "CURATORIAL_LINE_KIND_INVALID",
      "AI generated text cannot be stored as an author quote",
      { index }
    );
  }
  const text = requiredText(raw.text, `curatorialLines[${index}].text`, 360);
  const spoilerLevel = inlineText(raw.spoilerLevel || raw.spoiler_level, 20) || "none";
  if (!VALID_SPOILER_LEVELS.has(spoilerLevel)) {
    throw new CurationValidationError("INVALID_SPOILER_LEVEL", "invalid curatorial line spoiler level", { index });
  }
  return {
    id: stableLineId(text),
    text,
    kind: "curatorial_prompt",
    sourceType: "ai_generated",
    attribution: null,
    label: AI_CURATORIAL_LABEL,
    spoilerLevel,
    selected: raw.selected !== false,
  };
}

function sanitizeQuestion(value, index) {
  const raw = typeof value === "string" ? { text: value } : value;
  if (!isObject(raw)) {
    throw new CurationValidationError("INVALID_QUESTION", `questions[${index}] must be an object`);
  }
  const text = requiredText(raw.text, `questions[${index}].text`, 500);
  const readingStage = inlineText(raw.readingStage || raw.reading_stage || raw.stage, 20);
  const rawSpoiler = raw.spoilerLevel ?? raw.spoiler_level ?? raw.spoiler;
  const spoilerLevel = typeof rawSpoiler === "boolean"
    ? (rawSpoiler ? "full" : "none")
    : inlineText(rawSpoiler, 20);
  if (!VALID_READING_STAGES.has(readingStage)) {
    throw new CurationValidationError(
      "INVALID_READING_STAGE",
      "question readingStage must be before, during, or after",
      { index }
    );
  }
  if (!VALID_SPOILER_LEVELS.has(spoilerLevel)) {
    throw new CurationValidationError(
      "INVALID_SPOILER_LEVEL",
      "question spoilerLevel must be none, mild, or full",
      { index }
    );
  }
  return {
    id: stableQuestionId(text, readingStage, spoilerLevel),
    text,
    readingStage,
    spoilerLevel,
    theme: inlineText(raw.theme, 120),
    selected: raw.selected !== false,
  };
}

function sanitizeResolution(value) {
  const raw = isObject(value) ? value : {};
  const existingPath = canonicalMarkdownPath(raw.existingPath || raw.existing_path);
  const kind = inlineText(raw.kind, 40) || (existingPath ? "existing_note" : "new_note");
  if (!VALID_RESOLUTION_KINDS.has(kind)) {
    throw new CurationValidationError("INVALID_WORK_RESOLUTION", "work resolution must be existing_note or new_note");
  }
  if (kind === "existing_note" && !existingPath) {
    throw new CurationValidationError("MISSING_EXISTING_NOTE", "existing_note resolution requires existingPath");
  }
  const confidence = Number(raw.confidence);
  return {
    kind,
    existingPath: kind === "existing_note" ? existingPath : null,
    matchMethod: inlineText(raw.matchMethod || raw.match_method, 80),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  };
}

function sanitizeWorkSource(value, work, resolution) {
  const raw = isObject(value) ? value : {};
  const catalogUrl = safeHttpUrl(
    raw.catalogUrl || raw.catalog_url || work.officialUrl || work.official_url || work.sourceUrl || work.source_url,
    "source.catalogUrl",
    resolution.kind === "new_note"
  );
  return {
    catalogUrl,
    catalogTitle: inlineText(raw.catalogTitle || raw.catalog_title, 300),
    institution: inlineText(raw.institution, 240),
    catalogId: inlineText(raw.catalogId || raw.catalog_id, 200),
    accessedAt: inlineText(raw.accessedAt || raw.accessed_at, 80),
    verificationStatus: (raw.runtimeVerified === true || raw.runtime_verified === true
      || work.runtimeLinkVerified === true || work.runtime_link_verified === true)
      ? "verified"
      : "unverified",
    verificationNote: inlineText(
      raw.verificationNote || raw.verification_note || work.verificationNote || work.verification_note,
      500
    ) || "候选链接未由梦藏运行时核验；请在确认前打开来源页检查。",
  };
}

function sanitizeImageRights(value) {
  const raw = isObject(value) ? value : {};
  const reuseStatus = inlineText(raw.reuseStatus || raw.reuse_status, 30) || "unknown";
  if (!VALID_REUSE_STATUSES.has(reuseStatus)) {
    throw new CurationValidationError(
      "INVALID_IMAGE_REUSE_STATUS",
      "image reuseStatus must be allowed, prohibited, or unknown"
    );
  }
  return {
    imageUrl: safeHttpUrl(raw.imageUrl || raw.image_url, "imageRights.imageUrl", false),
    rightsStatement: inlineText(raw.rightsStatement || raw.rights_statement, 500),
    licenseId: inlineText(raw.licenseId || raw.license_id, 120),
    licenseUrl: safeHttpUrl(raw.licenseUrl || raw.license_url, "imageRights.licenseUrl", false),
    creditLine: inlineText(raw.creditLine || raw.credit_line, 500),
    publicDomain: booleanOrNull(raw.publicDomain ?? raw.public_domain),
    reuseStatus,
    // Candidate generation never grants permission to write/download media.
    localPath: null,
  };
}

function sanitizeRelatedWork(value, index = 0) {
  if (!isObject(value)) {
    throw new CurationValidationError("INVALID_RELATED_WORK", `relatedWorks[${index}] must be an object`);
  }
  if (value.historicalInfluenceClaim === true || value.historical_influence_claim === true) {
    throw new CurationValidationError(
      "UNSUPPORTED_HISTORICAL_INFLUENCE",
      "a curatorial association cannot claim historical influence without a separate evidenced workflow",
      { index }
    );
  }
  const suppliedRelationKind = inlineText(
    value.relationKind || value.relation_kind || value.relationType || value.relation_type,
    80
  );
  if (suppliedRelationKind && suppliedRelationKind !== "curatorial_association") {
    throw new CurationValidationError(
      "INVALID_RELATION_KIND",
      "related works must use curatorial_association",
      { index }
    );
  }
  const title = requiredText(value.title, `relatedWorks[${index}].title`, 300);
  const creator = inlineText(value.creator || value.artist || value.author, 240);
  const year = inlineText(value.year || value.workYear || value.work_year, 80);
  const rawWorkType = inlineText(value.workType || value.work_type || value.kind, 40) || "artwork";
  const workTypeAliases = {
    "作品": "artwork",
    "绘画": "painting",
    "画作": "painting",
    "素描": "drawing",
    "版画": "print",
    "摄影": "photography",
    "雕塑": "sculpture",
    "电影": "film",
    "音乐": "music",
    "文学": "literature",
    "建筑": "architecture",
  };
  const workType = workTypeAliases[rawWorkType] || rawWorkType.toLocaleLowerCase("en-US");
  if (!VALID_WORK_TYPES.has(workType)) {
    throw new CurationValidationError("INVALID_WORK_TYPE", "unsupported workType", { index, workType });
  }
  const rationale = requiredText(
    value.rationale || value.explanation || value.association,
    `relatedWorks[${index}].rationale`,
    1000
  );
  const resolution = sanitizeResolution(value.resolution);
  const source = sanitizeWorkSource(value.source, value, resolution);
  const imageRights = sanitizeImageRights(value.imageRights || value.image_rights);
  const normalizedForIdentity = { ...value, title, creator, year, source };
  return {
    id: makeCandidateId(normalizedForIdentity),
    workId: makeWorkId(normalizedForIdentity),
    title,
    creator,
    workType,
    year,
    relationKind: "curatorial_association",
    rationale,
    historicalInfluenceClaim: false,
    resolution,
    source,
    imageRights,
    selected: value.selected === true,
    eligibleForConfirmation: Boolean(source.catalogUrl || resolution.existingPath),
  };
}

function dedupeById(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function sanitizeCurationDraft(value) {
  if (!isObject(value)) {
    throw new CurationValidationError("INVALID_DRAFT", "curation draft must be an object");
  }
  if (!Array.isArray(value.curatorialLines) || !value.curatorialLines.length) {
    throw new CurationValidationError("MISSING_CURATORIAL_LINES", "draft requires at least one curatorial line");
  }
  if (!Array.isArray(value.questions) || !value.questions.length) {
    throw new CurationValidationError("MISSING_QUESTIONS", "draft requires at least one reading question");
  }
  const curatorialLines = dedupeById(value.curatorialLines.slice(0, 6).map(sanitizeCuratorialLine));
  const questions = dedupeById(value.questions.slice(0, 18).map(sanitizeQuestion));
  const relatedWorks = dedupeById((Array.isArray(value.relatedWorks) ? value.relatedWorks : [])
    .slice(0, 18)
    .map(sanitizeRelatedWork));
  return { curatorialLines, questions, relatedWorks };
}

function makeDraftRevision(draft) {
  return `bc-draft-${stableHash(`book-curation-draft-v1\u0000${stableStringify(sanitizeCurationDraft(draft))}`)}`;
}

function makeConfirmKey(bookPath, draft, selectedIds = []) {
  const path = canonicalMarkdownPath(bookPath);
  if (!path) throw new CurationValidationError("INVALID_BOOK_PATH", "confirmation requires a book path");
  const ids = isObject(selectedIds)
    ? Object.keys(selectedIds).sort().flatMap((kind) => (
      stringList(selectedIds[kind], { limit: 100, maxLength: 200, sort: true })
        .map((id) => `${kind}:${id}`)
    ))
    : stringList(selectedIds, { limit: 100, maxLength: 200, sort: true });
  return `bc-confirm-${stableHash(stableStringify({
    contract: "book-curation-confirm-v1",
    path,
    draftRevision: makeDraftRevision(draft),
    selectedIds: ids,
  }))}`;
}

function detectEol(markdown) {
  const match = markdown.match(/\r\n|\n|\r/);
  return match?.[0] === "\r\n" ? "\r\n" : "\n";
}

function escapeMarkdownText(value) {
  return inlineText(value, 2000)
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]*_`])/g, "\\$1");
}

function escapeWikilinkAlias(value) {
  return inlineText(value, 400).replace(/[\]|]/g, " ").replace(/\s+/g, " ").trim();
}

function workPathLookup(selectedWorkPaths, id) {
  const raw = selectedWorkPaths instanceof Map
    ? selectedWorkPaths.get(id)
    : isObject(selectedWorkPaths)
      ? selectedWorkPaths[id]
      : "";
  return canonicalMarkdownPath(raw);
}

function renderBookCurationBlock(payload, eol = "\n") {
  if (!isObject(payload)) throw new TypeError("payload must be an object");
  const draft = sanitizeCurationDraft(payload.draft);
  const lines = [BOOK_CURATION_MANAGED_START, BOOK_CURATION_HEADING, ""];
  const selectedLines = draft.curatorialLines.filter((line) => line.selected);
  if (selectedLines.length) {
    lines.push("### 策展引思句", "");
    for (const line of selectedLines) {
      lines.push(`> ${escapeMarkdownText(line.text)}`, ">", `> 标注：${AI_CURATORIAL_LABEL}。`, "");
    }
  }
  const selectedQuestions = draft.questions.filter((question) => question.selected);
  if (selectedQuestions.length) {
    const stageLabels = { before: "阅读前", during: "阅读中", after: "阅读后" };
    const spoilerLabels = { none: "无剧透", mild: "轻微剧透", full: "含剧透" };
    lines.push("### 可以带着读的问题", "");
    for (const question of selectedQuestions) {
      lines.push(`- ${stageLabels[question.readingStage]}·${spoilerLabels[question.spoilerLevel]}：${escapeMarkdownText(question.text)}`);
    }
    lines.push("");
  }
  const linkedWorks = draft.relatedWorks
    .map((work) => ({ work, path: workPathLookup(payload.selectedWorkPaths, work.id) }))
    .filter((entry) => entry.path);
  if (linkedWorks.length) {
    lines.push("### 相关作品", "");
    for (const { work, path } of linkedWorks) {
      lines.push(`- [[${wikilinkRef(path)}|${escapeWikilinkAlias(work.title)}]] — ${escapeMarkdownText(work.rationale)}`);
    }
    lines.push("");
  }
  lines.push(BOOK_CURATION_MANAGED_END);
  return lines.join(eol);
}

function findManagedBookRegion(markdown) {
  const starts = [];
  const ends = [];
  let index = markdown.indexOf(BOOK_CURATION_MANAGED_START);
  while (index >= 0) {
    starts.push(index);
    index = markdown.indexOf(BOOK_CURATION_MANAGED_START, index + BOOK_CURATION_MANAGED_START.length);
  }
  index = markdown.indexOf(BOOK_CURATION_MANAGED_END);
  while (index >= 0) {
    ends.push(index);
    index = markdown.indexOf(BOOK_CURATION_MANAGED_END, index + BOOK_CURATION_MANAGED_END.length);
  }
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new CurationValidationError(
      "MALFORMED_MANAGED_REGION",
      "book curation managed markers are missing, duplicated, or out of order"
    );
  }
  return {
    start: starts[0],
    end: ends[0] + BOOK_CURATION_MANAGED_END.length,
  };
}

function upsertBookCurationBlock(markdown, payload) {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  const eol = detectEol(markdown);
  const rendered = renderBookCurationBlock(payload, eol);
  const region = findManagedBookRegion(markdown);
  if (region) {
    const current = markdown.slice(region.start, region.end);
    if (current === rendered) return markdown;
    return markdown.slice(0, region.start) + rendered + markdown.slice(region.end);
  }
  if (!markdown) return rendered;
  const separator = markdown.endsWith(`${eol}${eol}`)
    ? ""
    : markdown.endsWith(eol)
      ? eol
      : `${eol}${eol}`;
  return `${markdown}${separator}${rendered}`;
}

function stripBookCurationBlock(markdown) {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  const region = findManagedBookRegion(markdown);
  if (!region) return markdown;
  return markdown.slice(0, region.start) + markdown.slice(region.end);
}

function yamlString(value) {
  return JSON.stringify(inlineText(value, 2000));
}

function markdownUrl(value) {
  return String(value || "").replace(/>/g, "%3E");
}

function buildWorkMarkdown(payload) {
  if (!isObject(payload)) throw new TypeError("payload must be an object");
  const bookPath = canonicalMarkdownPath(payload.book?.path || payload.book?.file?.path || payload.bookPath);
  if (!bookPath) throw new CurationValidationError("INVALID_BOOK_PATH", "work note requires a book Markdown path");
  const bookTitle = requiredText(payload.book?.title || payload.bookTitle || bookPath.split("/").pop().replace(/\.md$/i, ""), "book.title", 300);
  const work = sanitizeRelatedWork(payload.work);
  if (work.resolution.kind === "existing_note") {
    throw new CurationValidationError(
      "EXISTING_NOTE_DOES_NOT_REQUIRE_CREATION",
      "buildWorkMarkdown only creates new work notes"
    );
  }
  const sourceLabel = escapeMarkdownText(work.source.catalogTitle || work.source.institution || "作品资料页");
  const confirmedAt = inlineText(payload.confirmedAt, 80);
  const curationId = safeId(payload.curationId) || `bc-curation-${stableHash(`${bookPath}\u0000${work.id}`)}`;
  const frontmatter = [
    "---",
    `id: ${yamlString(work.workId)}`,
    "type: material",
    "material_kind: artwork",
    `title: ${yamlString(work.title)}`,
    `creator: ${yamlString(work.creator)}`,
    `work_type: ${yamlString(work.workType)}`,
    `work_year: ${yamlString(work.year)}`,
    `institution: ${yamlString(work.source.institution)}`,
    `source_url: ${yamlString(work.source.catalogUrl)}`,
    `source_accessed_at: ${yamlString(work.source.accessedAt)}`,
    `source_catalog_id: ${yamlString(work.source.catalogId)}`,
    `source_verification_status: ${yamlString(work.source.verificationStatus)}`,
    `source_verification_note: ${yamlString(work.source.verificationNote)}`,
    `image_source_url: ${yamlString(work.imageRights.imageUrl)}`,
    `image_rights_statement: ${yamlString(work.imageRights.rightsStatement)}`,
    `image_license_id: ${yamlString(work.imageRights.licenseId)}`,
    `image_license_url: ${yamlString(work.imageRights.licenseUrl)}`,
    `image_credit_line: ${yamlString(work.imageRights.creditLine)}`,
    `image_reuse_status: ${yamlString(work.imageRights.reuseStatus)}`,
    `curation_origin: ${yamlString("mengcang-confirmed")}`,
    `curation_id: ${yamlString(curationId)}`,
    `curation_confirmed_at: ${yamlString(confirmedAt)}`,
    "---",
  ];
  const body = [
    `# ${escapeMarkdownText(work.title)}`,
    "",
    "## 作品资料",
    "",
    `- 创作者：${escapeMarkdownText(work.creator || "待核对")}`,
    `- 年代：${escapeMarkdownText(work.year || "待核对")}`,
    `- 资料来源：[${sourceLabel}](<${markdownUrl(work.source.catalogUrl)}>)`,
    `- 来源核验状态：${escapeMarkdownText(work.source.verificationStatus === "verified" ? "已核验" : "未由梦藏核验")}`,
    `- 核验说明：${escapeMarkdownText(work.source.verificationNote)}`,
    `- 图像复用状态：${escapeMarkdownText(work.imageRights.reuseStatus)}`,
    "",
    "## 与书籍的策展联系",
    "",
    `- 关联书籍：[[${wikilinkRef(bookPath)}|${escapeWikilinkAlias(bookTitle)}]]`,
    "- 关联性质：策展联想，不代表历史影响关系",
    `- 策展说明：${escapeMarkdownText(work.rationale)}`,
    "",
  ];
  return [...frontmatter, "", ...body].join("\n");
}

// Narrow aliases used by the service layer. Both preserve the stricter core
// semantics and are intentionally not permissive compatibility shims.
const normalizeBookCuration = sanitizeCurationDraft;
const upsertManagedBookCuration = upsertBookCurationBlock;

module.exports = {
  SCHEMA_VERSION,
  GENERATOR_VERSION,
  PROMPT_VERSION,
  AI_CURATORIAL_LABEL,
  WORK_NOTES_ROOT,
  BOOK_CURATION_MANAGED_START,
  BOOK_CURATION_MANAGED_END,
  BOOK_CURATION_HEADING,
  CurationValidationError,
  defaultBookCurationState,
  normalizeBookCurationState,
  bookInputSnapshot,
  bookInputFingerprint,
  makeGenerationKey,
  sanitizeCurationDraft,
  normalizeBookCuration,
  makeDraftRevision,
  makeCandidateId,
  makeConfirmKey,
  makeWorkId,
  safeFilename,
  makeWorkNotePath,
  renderBookCurationBlock,
  upsertBookCurationBlock,
  upsertManagedBookCuration,
  stripBookCurationBlock,
  buildWorkMarkdown,
};
