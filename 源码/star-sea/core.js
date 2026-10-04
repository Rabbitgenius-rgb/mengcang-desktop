"use strict";

/**
 * Pure data helpers for 梦藏·星海.
 *
 * This module intentionally knows nothing about Obsidian's runtime.  It only
 * transforms strings and plain objects, so every write can be tested before a
 * Vault file is touched.
 */

const MANAGED_START = "<!-- mengcang-relations:start -->";
const MANAGED_END = "<!-- mengcang-relations:end -->";
const MANAGED_HEADING = "## 梦藏已确认联系";
const RELATION_ID_PREFIX = "mc-rel-";
const SAFE_EXCERPT_PLACEHOLDER = "暂无可安全展示的摘要。";

class ManagedRelationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ManagedRelationError";
    this.code = code;
    this.details = details;
  }
}

function assertMarkdown(markdown) {
  if (typeof markdown !== "string") {
    throw new TypeError("markdown must be a string");
  }
}

function normalizeUnicode(value) {
  return String(value == null ? "" : value).normalize("NFC");
}

function canonicalNoteRef(value) {
  let raw = value;
  if (value && typeof value === "object") {
    raw = value.path || (value.file && value.file.path) || value.id || "";
  }
  return normalizeUnicode(raw)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\.md$/i, "");
}

/** A deterministic 64-bit FNV-1a hash, returned as 16 lowercase hex chars. */
function stableHash(value) {
  const text = normalizeUnicode(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  // Hash UTF-16 code units deliberately: it is deterministic in Node and in
  // Obsidian's Electron runtime and requires no platform encoding API.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = (hash * prime) & mask;
    hash ^= BigInt((code >>> 8) & 0xff);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function makePairKey(left, right) {
  const a = canonicalNoteRef(left);
  const b = canonicalNoteRef(right);
  if (!a || !b) {
    throw new TypeError("both note references must contain a path or id");
  }
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function makeRelationId(left, right) {
  return `${RELATION_ID_PREFIX}${stableHash(makePairKey(left, right))}`;
}

function detectEol(markdown) {
  const firstBreak = markdown.match(/\r\n|\n|\r/);
  return firstBreak && firstBreak[0] === "\r\n" ? "\r\n" : "\n";
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function sanitizeInline(value) {
  return normalizeUnicode(value).replace(/\s+/g, " ").trim();
}

const SENSITIVE_METADATA_LINE = /^\s*(?:[-*]\s*)?(?:source[_ -]?file|source[_ -]?path|local[_ -]?path|attachment[_ -]?path|captured[_ -]?at|created[_ -]?at|modified[_ -]?at)\s*[:：=]/i;
const UNSAFE_LOCATION_SIGNAL = /(?:file:\/{2,}|\/Users\/|Library\/Mobile\s+Documents|%[0-9a-f]{2}|(?:^|\s)01_sources\/)/i;

/**
 * Remove transport metadata and locations that must never appear in a card or
 * influence candidate ranking. It purposefully favors omission over trying to
 * decode an ambiguous local path.
 */
function sanitizeExcerptSource(value) {
  let text = normalizeUnicode(value).replace(/^\uFEFF/, "");
  if (!text.trim()) return "";

  const safeLines = [];
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    if (SENSITIVE_METADATA_LINE.test(rawLine)) continue;
    let line = rawLine;
    // Keep a Markdown link's human label while discarding an unsafe target.
    line = line.replace(
      /\[([^\]]+)\]\((?:file:\/{2,}|\/Users\/|[^)]*Library\/Mobile\s+Documents|[^)]*%[0-9a-f]{2})[^)]*\)/gi,
      "$1"
    );
    line = line.replace(
      /\[\[(?:file:\/{2,}|\/Users\/|[^\]]*Library\/Mobile\s+Documents|[^\]]*%[0-9a-f]{2})[^\]]*(?:\|([^\]]+))?\]\]/gi,
      (_match, alias) => alias || ""
    );
    line = line.replace(/file:\/{2,}\S+/gi, " ");
    line = line.replace(/\/Users\/\S+(?:\s+Documents\/\S*)?/gi, " ");
    line = line.replace(/\S*Library\/Mobile\s+Documents(?:\/\S*)?/gi, " ");
    line = line.replace(/\S*%[0-9a-f]{2}\S*/gi, " ");
    line = line.replace(/(?:^|\s)01_sources\/\S+/gi, " ");
    line = line.replace(/https?:\/\/\S+/gi, " ");
    line = line.replace(
      /\b(?:source[_ -]?file|source[_ -]?path|local[_ -]?path|attachment[_ -]?path|captured[_ -]?at)\s*[:：=]\s*\S+/gi,
      " "
    );
    safeLines.push(line);
  }

  text = safeLines
    .join(" ")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/^\s*---\s*$/g, " ")
    .replace(/(?:^|\s)#{1,6}\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (UNSAFE_LOCATION_SIGNAL.test(text) || SENSITIVE_METADATA_LINE.test(text)) return "";
  return text;
}

function isTextualRecord(record) {
  const values = [
    record && record.kind,
    record && record.recordType,
    record && record.materialKind,
    record && record.type,
  ]
    .map((value) => sanitizeInline(value).toLowerCase())
    .filter(Boolean);
  return values.some((value) =>
    /^(?:text|inspiration|idea|note|quote|excerpt|insight|viewpoint|灵感|文本|笔记|摘录|观点)$/.test(
      value
    )
  );
}

function truncateExcerpt(text, maxLength) {
  const characters = Array.from(text);
  if (characters.length <= maxLength) return text;
  if (maxLength <= 1) return "…";
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

/**
 * Return a UI-safe preview. Book/image/web records never fall back to a raw
 * body, while explicitly textual records may use bodyText/body as a last
 * resort. The function never emits local paths or capture metadata.
 */
function previewExcerpt(record, maxLength = 170) {
  if (!record || typeof record !== "object") return SAFE_EXCERPT_PLACEHOLDER;
  const numericLimit = Number(maxLength);
  const limit = Number.isFinite(numericLimit)
    ? Math.max(1, Math.min(2000, Math.floor(numericLimit)))
    : 170;
  const preferred = [record.summary, record.description, record.notes, record.observations];
  const sources = isTextualRecord(record)
    ? [...preferred, record.bodyText, record.body]
    : preferred;

  for (const source of sources) {
    const safe = sanitizeExcerptSource(source);
    if (safe) return truncateExcerpt(safe, limit);
  }
  return SAFE_EXCERPT_PLACEHOLDER;
}

function sanitizeAlias(value) {
  return sanitizeInline(value).replace(/\|/g, "／").replace(/\]/g, "］");
}

function wikiTarget(path) {
  return canonicalNoteRef(path).replace(/\]/g, "］");
}

function fallbackTitle(path) {
  const ref = canonicalNoteRef(path);
  return ref.split("/").filter(Boolean).pop() || ref || "未命名笔记";
}

function relationOriginLabel(origin) {
  const key = sanitizeInline(origin).toLowerCase();
  if (key === "ai" || key === "ai_confirmed") return "AI 建议 · 用户确认";
  if (key === "local_confirmed") return "本地候选 · 用户确认";
  if (key === "manual") return "手动连接";
  if (key === "local" || key === "local-ranking") return "本地候选";
  return sanitizeInline(origin) || "用户确认";
}

function normalizeGlobalRelation(relation) {
  if (!relation || typeof relation !== "object") {
    throw new TypeError("relation must be an object");
  }
  const sourcePath = canonicalNoteRef(
    relation.sourcePath || relation.fromPath || relation.source || relation.from
  );
  const targetPath = canonicalNoteRef(
    relation.targetPath || relation.toPath || relation.target || relation.to
  );
  if (!sourcePath || !targetPath || sourcePath === targetPath) {
    throw new TypeError("relation must connect two different note paths");
  }

  const pairKey = makePairKey(sourcePath, targetPath);
  return {
    id: sanitizeInline(relation.id) || makeRelationId(sourcePath, targetPath),
    pairKey,
    sourcePath,
    targetPath,
    sourceTitle: sanitizeInline(relation.sourceTitle) || fallbackTitle(sourcePath),
    targetTitle: sanitizeInline(relation.targetTitle) || fallbackTitle(targetPath),
    summary:
      sanitizeInline(relation.summary || relation.explanation) ||
      `「${fallbackTitle(sourcePath)}」与「${fallbackTitle(targetPath)}」之间存在一条已确认的联系。`,
    origin: sanitizeInline(relation.origin || relation.sourceType) || "manual",
    confirmedAt: sanitizeInline(relation.confirmedAt || relation.createdAt),
  };
}

function relationForSide(relation, sidePath) {
  const normalized = normalizeGlobalRelation(relation);
  const side = canonicalNoteRef(sidePath || relation.sidePath || normalized.sourcePath);
  let linkedPath;
  let linkedTitle;

  if (side === normalized.sourcePath) {
    linkedPath = normalized.targetPath;
    linkedTitle = normalized.targetTitle;
  } else if (side === normalized.targetPath) {
    linkedPath = normalized.sourcePath;
    linkedTitle = normalized.sourceTitle;
  } else {
    throw new TypeError("sidePath must be one endpoint of the relation");
  }

  return {
    ...normalized,
    sidePath: side,
    linkedPath,
    linkedTitle,
  };
}

function validateRelationId(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new TypeError("relation id may contain only letters, numbers, dot, underscore, and hyphen");
  }
}

function serializeRelationMeta(entry) {
  const payload = {
    id: entry.id,
    pairKey: entry.pairKey,
    sourcePath: entry.sourcePath,
    targetPath: entry.targetPath,
    sourceTitle: entry.sourceTitle,
    targetTitle: entry.targetTitle,
    sidePath: entry.sidePath,
    linkedPath: entry.linkedPath,
    linkedTitle: entry.linkedTitle,
    summary: entry.summary,
    origin: entry.origin,
    confirmedAt: entry.confirmedAt,
  };
  return encodeBase64Url(JSON.stringify(payload));
}

function renderRelationBlock(relation, sidePath, eol) {
  const entry = relationForSide(relation, sidePath);
  validateRelationId(entry.id);
  const lines = [
    `<!-- mengcang-relation:${entry.id}:start -->`,
    `<!-- mengcang-relation-meta:${serializeRelationMeta(entry)} -->`,
    `- [[${wikiTarget(entry.linkedPath)}|${sanitizeAlias(entry.linkedTitle)}]] — ${entry.summary}`,
    `  - 关系来源：${relationOriginLabel(entry.origin)}`,
  ];
  if (entry.confirmedAt) lines.push(`  - 确认时间：${entry.confirmedAt}`);
  lines.push(`<!-- mengcang-relation:${entry.id}:end -->`);
  return { entry, markdown: lines.join(eol) };
}

function collectSectionMarkers(markdown) {
  const matches = [];
  const pattern = /<!--\s*mengcang-relations:(start|end)\s*-->/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    matches.push({
      type: match[1],
      start: match.index,
      end: pattern.lastIndex,
      raw: match[0],
    });
  }
  return matches;
}

function collectEntryTokens(markdown, offset = 0) {
  const tokens = [];
  const pattern = /<!--\s*mengcang-relation:([^:\s>]+):(start|end)\s*-->/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    tokens.push({
      id: match[1],
      type: match[2],
      start: offset + match.index,
      end: offset + pattern.lastIndex,
      raw: match[0],
    });
  }
  return tokens;
}

function malformed(message, details) {
  throw new ManagedRelationError("MALFORMED_MANAGED_REGION", message, details);
}

function locateManagedRegion(markdown) {
  const markers = collectSectionMarkers(markdown);
  const allEntryTokens = collectEntryTokens(markdown);
  if (markers.length === 0) {
    if (allEntryTokens.length > 0) {
      malformed("relation markers exist outside a managed region", {
        marker: allEntryTokens[0],
      });
    }
    return null;
  }
  if (
    markers.length !== 2 ||
    markers[0].type !== "start" ||
    markers[1].type !== "end" ||
    markers[0].end > markers[1].start
  ) {
    malformed("managed region start/end markers are damaged or duplicated", {
      markers,
    });
  }
  const region = {
    start: markers[0].start,
    contentStart: markers[0].end,
    contentEnd: markers[1].start,
    end: markers[1].end,
    startMarker: markers[0].raw,
    endMarker: markers[1].raw,
  };
  const outside = allEntryTokens.find(
    (token) => token.start < region.contentStart || token.end > region.contentEnd
  );
  if (outside) {
    malformed("relation marker exists outside the managed region", { marker: outside });
  }
  return region;
}

function parseRelationMeta(body, id) {
  const matches = Array.from(
    body.matchAll(/<!--\s*mengcang-relation-meta:([A-Za-z0-9_-]+)\s*-->/g)
  );
  if (matches.length !== 1) {
    throw new ManagedRelationError(
      "MALFORMED_RELATION_ENTRY",
      `relation ${id} must contain exactly one metadata marker`,
      { id, metadataMarkers: matches.length }
    );
  }
  try {
    const parsed = JSON.parse(decodeBase64Url(matches[0][1]));
    if (!parsed || parsed.id !== id) {
      throw new Error("metadata id does not match boundary id");
    }
    return parsed;
  } catch (error) {
    throw new ManagedRelationError(
      "MALFORMED_RELATION_ENTRY",
      `relation ${id} contains invalid metadata`,
      { id, cause: error.message }
    );
  }
}

/**
 * Parse the managed region without changing Markdown.
 * Returns { relations, hasRegion, eol, region }. Each relation includes its
 * decoded metadata plus raw/body and absolute source offsets.
 */
function parseManagedRelations(markdown) {
  assertMarkdown(markdown);
  const eol = detectEol(markdown);
  const region = locateManagedRegion(markdown);
  if (!region) return { relations: [], hasRegion: false, eol, region: null };

  const content = markdown.slice(region.contentStart, region.contentEnd);
  const tokens = collectEntryTokens(content, region.contentStart);
  const relations = [];
  const seen = new Set();
  let open = null;

  for (const token of tokens) {
    if (token.type === "start") {
      if (open) {
        malformed("relation entry markers may not be nested", { open, marker: token });
      }
      open = token;
      continue;
    }
    if (!open || open.id !== token.id) {
      malformed("relation entry start/end markers are mismatched", {
        open,
        marker: token,
      });
    }
    validateRelationId(token.id);
    if (seen.has(token.id)) {
      throw new ManagedRelationError(
        "DUPLICATE_RELATION_ID",
        `relation id ${token.id} appears more than once`,
        { id: token.id }
      );
    }
    const body = markdown.slice(open.end, token.start);
    const meta = parseRelationMeta(body, token.id);
    relations.push({
      ...meta,
      id: token.id,
      body,
      raw: markdown.slice(open.start, token.end),
      start: open.start,
      end: token.end,
    });
    seen.add(token.id);
    open = null;
  }
  if (open) {
    malformed("relation entry is missing its end marker", { open });
  }

  return { relations, hasRegion: true, eol, region };
}

function insertionSeparator(markdown, eol) {
  const withoutBom = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  if (!withoutBom) return "";
  if (withoutBom.endsWith(eol + eol)) return "";
  if (withoutBom.endsWith(eol)) return eol;
  return eol + eol;
}

/** Insert or update one relation. Only the marked managed region is rewritten. */
function upsertManagedRelation(markdown, relation, sidePath) {
  assertMarkdown(markdown);
  const parsed = parseManagedRelations(markdown);
  const rendered = renderRelationBlock(relation, sidePath, parsed.eol);
  const existing = parsed.relations.find((item) => item.id === rendered.entry.id);

  if (!parsed.hasRegion) {
    const hadFinalEol = /(?:\r\n|\n|\r)$/.test(markdown);
    const section = [
      MANAGED_START,
      MANAGED_HEADING,
      "",
      rendered.markdown,
      MANAGED_END,
    ].join(parsed.eol);
    return (
      markdown +
      insertionSeparator(markdown, parsed.eol) +
      section +
      (hadFinalEol ? parsed.eol : "")
    );
  }

  if (existing) {
    if (existing.raw === rendered.markdown) return markdown;
    return markdown.slice(0, existing.start) + rendered.markdown + markdown.slice(existing.end);
  }

  const { region } = parsed;
  if (parsed.relations.length === 0) {
    const content =
      parsed.eol +
      MANAGED_HEADING +
      parsed.eol +
      parsed.eol +
      rendered.markdown +
      parsed.eol;
    return markdown.slice(0, region.contentStart) + content + markdown.slice(region.contentEnd);
  }

  const last = parsed.relations[parsed.relations.length - 1];
  const addition = parsed.eol + parsed.eol + rendered.markdown;
  return markdown.slice(0, last.end) + addition + markdown.slice(last.end);
}

/** Remove one managed relation by id; unknown ids are a byte-for-byte no-op. */
function removeManagedRelation(markdown, relationId) {
  assertMarkdown(markdown);
  const id = sanitizeInline(relationId);
  const parsed = parseManagedRelations(markdown);
  const targetIndex = parsed.relations.findIndex((item) => item.id === id);
  if (targetIndex < 0) return markdown;

  const target = parsed.relations[targetIndex];
  const previous = parsed.relations[targetIndex - 1];
  const next = parsed.relations[targetIndex + 1];
  let start = target.start;
  let end = target.end;

  // Consume only separator whitespace inside the managed region. Never touch
  // text outside its explicit start/end markers.
  if (next) {
    const separator = markdown.slice(target.end, next.start);
    if (/^[\r\n\t ]*$/.test(separator)) end = next.start;
  } else if (previous) {
    const separator = markdown.slice(previous.end, target.start);
    if (/^[\r\n\t ]*$/.test(separator)) start = previous.end;
  } else {
    const emptyContent = parsed.eol + MANAGED_HEADING + parsed.eol;
    return (
      markdown.slice(0, parsed.region.contentStart) +
      emptyContent +
      markdown.slice(parsed.region.contentEnd)
    );
  }

  return markdown.slice(0, start) + markdown.slice(end);
}

/** Remove the whole managed region from a derived copy (useful for scoring). */
function stripManagedRelations(markdown) {
  assertMarkdown(markdown);
  const parsed = parseManagedRelations(markdown);
  if (!parsed.hasRegion) return markdown;
  return markdown.slice(0, parsed.region.start) + markdown.slice(parsed.region.end);
}

function normalizeNote(note) {
  if (!note || typeof note !== "object") throw new TypeError("note must be an object");
  const path = canonicalNoteRef(note);
  if (!path) throw new TypeError("note must contain path, file.path, or id");
  return {
    ...note,
    path,
    title: sanitizeInline(note.title) || fallbackTitle(path),
  };
}

/** Build the two side-aware entries used by the transactional write service. */
function buildBidirectionalRelationEntries(left, right, options = {}) {
  const source = normalizeNote(left);
  const target = normalizeNote(right);
  const relation = normalizeGlobalRelation({
    id: options.id,
    sourcePath: source.path,
    targetPath: target.path,
    sourceTitle: source.title,
    targetTitle: target.title,
    summary: options.summary || options.explanation,
    origin: options.origin || "manual",
    confirmedAt: options.confirmedAt,
  });
  return {
    id: relation.id,
    pairKey: relation.pairKey,
    relation,
    left: relationForSide(relation, source.path),
    right: relationForSide(relation, target.path),
  };
}

function toStringList(value) {
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (value == null) return [];
  const text = sanitizeInline(value);
  if (!text) return [];
  const hashtagMatches = Array.from(text.matchAll(/#([^\s#,，;；]+)/g), (match) => match[1]);
  if (hashtagMatches.length) return hashtagMatches;
  return text.split(/[\s,，;；|]+/).filter(Boolean);
}

function normalizedSet(value) {
  return new Set(toStringList(value).map((item) => normalizeUnicode(item).toLowerCase()));
}

const DISPLAY_TAG_LABELS = Object.freeze({
  book: "图书",
  books: "图书",
  philosophy: "哲学",
  web: "网页",
  webpage: "网页",
  text: "文本",
  pattern: "图案",
  patterns: "图案",
});

const STRUCTURAL_TAGS = new Set([
  "content",
  "book",
  "books",
  "web",
  "webpage",
  "text",
  "pattern",
  "patterns",
  "image",
  "pdf",
  "content/book",
  "content/books",
  "content/web",
  "content/webpage",
  "content/text",
  "content/pattern",
  "content/patterns",
  "type/book",
  "type/web",
  "type/text",
  "type/pattern",
  "kind/book",
  "kind/web",
  "kind/text",
  "kind/pattern",
  "record/book",
  "record/web",
  "record/text",
  "record/pattern",
]);

function normalizeTag(value) {
  return normalizeUnicode(value).trim().replace(/^#+/, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function isStructuralTag(value) {
  const tag = normalizeTag(value);
  if (!tag) return true;
  if (STRUCTURAL_TAGS.has(tag)) return true;
  const parts = tag.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  const namespace = parts[0];
  const leaf = parts[parts.length - 1];
  return (
    ["content", "type", "kind", "record", "material"].includes(namespace) &&
    ["book", "books", "web", "webpage", "text", "pattern", "patterns", "image", "pdf"].includes(
      leaf
    )
  );
}

function displayTagLabel(value) {
  const tag = normalizeTag(value);
  if (!tag) return "";
  const leaf = tag.split("/").filter(Boolean).pop() || tag;
  return DISPLAY_TAG_LABELS[leaf] || leaf;
}

/** Map technical tag paths to compact, natural Chinese UI labels. */
function toDisplayTags(value) {
  const labels = [];
  const seen = new Set();
  for (const item of toStringList(value)) {
    const label = displayTagLabel(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function thematicTagSet(value) {
  return new Set(
    toStringList(value)
      .map(normalizeTag)
      .filter((tag) => tag && !isStructuralTag(tag))
  );
}

function intersection(left, right) {
  return Array.from(left).filter((item) => right.has(item)).sort();
}

const STOPWORDS = new Set([
  "一个",
  "一些",
  "可以",
  "这个",
  "那个",
  "以及",
  "进行",
  "自己",
  "然后",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "http",
  "https",
  "www",
  "com",
  "file",
  "users",
  "library",
  "mobile",
  "documents",
  "01_sources",
  "source_file",
  "source_path",
  "captured_at",
  "created_at",
  "modified_at",
  "content",
  "book",
  "books",
  "web",
  "text",
  "pattern",
]);

function contentTokens(record) {
  const safeTitle = sanitizeExcerptSource(record.title);
  const safePreview = previewExcerpt(record, 1200);
  const text = normalizeUnicode(
    [safeTitle, safePreview === SAFE_EXCERPT_PLACEHOLDER ? "" : safePreview]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
  const tokens = new Set();
  for (const match of text.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []) {
    if (!STOPWORDS.has(match)) tokens.add(match);
  }
  for (const run of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
    if (run.length <= 4 && !STOPWORDS.has(run)) tokens.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      const pair = run.slice(index, index + 2);
      if (!STOPWORDS.has(pair)) tokens.add(pair);
    }
  }
  return tokens;
}

function semanticValues(record) {
  return normalizedSet([
    record.theme,
    record.family,
    record.form,
    record.period,
    record.sourceName,
    record.author,
  ]);
}

function relationExplanation(base, candidate, shared) {
  if (shared.projects.length) {
    return `都与「${shared.projects.slice(0, 2).join("、")}」项目有关，可能共享同一条创作线索。`;
  }
  if (shared.tags.length) {
    return `共同涉及「${shared.tags.slice(0, 3).join("、")}」，可能从不同材料照亮同一主题。`;
  }
  if (shared.semantic.length) {
    return `都围绕「${shared.semantic.slice(0, 2).join("、")}」展开，值得并置阅读。`;
  }
  if (shared.keywords.length) {
    return `内容中同时出现「${shared.keywords.slice(0, 3).join("、")}」，可能存在可继续追踪的暗线。`;
  }
  return `「${base.title}」与「${candidate.title}」的主题语汇相近，可能形成一条可验证的联系。`;
}

/**
 * Deterministic, local-only candidate ranking. This is a privacy-preserving
 * fallback, not an AI claim. The return value is sorted and capped to Top 3 by
 * default: [{ candidate, score, pairKey, explanation, reasons, shared }].
 */
function rankCandidates(baseInput, corpus, options = {}) {
  const base = normalizeNote(baseInput);
  if (!Array.isArray(corpus)) throw new TypeError("corpus must be an array");
  const limit = Math.max(0, Math.min(50, Number.isFinite(options.limit) ? options.limit : 3));
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 1;
  const blockedPairs = new Set([
    ...(options.confirmedPairKeys || []),
    ...(options.ignoredPairKeys || []),
  ]);
  const baseTags = thematicTagSet(base.tags);
  const baseProjects = normalizedSet(base.projectIds || base.projects || base.project);
  const baseSemantic = semanticValues(base);
  const baseTokens = contentTokens(base);
  const seenPaths = new Set();
  const ranked = [];

  for (const input of corpus) {
    const candidate = normalizeNote(input);
    if (candidate.path === base.path || seenPaths.has(candidate.path)) continue;
    seenPaths.add(candidate.path);
    const pairKey = makePairKey(base.path, candidate.path);
    if (blockedPairs.has(pairKey)) continue;

    const shared = {
      tags: intersection(baseTags, thematicTagSet(candidate.tags)).map(displayTagLabel),
      projects: intersection(
        baseProjects,
        normalizedSet(candidate.projectIds || candidate.projects || candidate.project)
      ),
      semantic: intersection(baseSemantic, semanticValues(candidate)),
      keywords: intersection(baseTokens, contentTokens(candidate)).slice(0, 8),
    };
    let score = 0;
    // An explicit project membership is a deliberate user classification and
    // therefore outranks incidental body-word overlap.
    score += Math.min(128, shared.projects.length * 64);
    score += Math.min(72, shared.tags.length * 24);
    score += Math.min(30, shared.semantic.length * 10);
    score += Math.min(24, shared.keywords.length * 4);
    if (score < minScore) continue;

    const reasons = [];
    if (shared.projects.length) reasons.push(`共同项目：${shared.projects.join("、")}`);
    if (shared.tags.length) reasons.push(`共同标签：${shared.tags.join("、")}`);
    if (shared.semantic.length) reasons.push(`共同分类：${shared.semantic.join("、")}`);
    if (shared.keywords.length) reasons.push(`共同语汇：${shared.keywords.join("、")}`);
    ranked.push({
      candidate: input,
      score,
      pairKey,
      explanation: relationExplanation(base, candidate, shared),
      reasons,
      shared,
    });
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return canonicalNoteRef(left.candidate).localeCompare(canonicalNoteRef(right.candidate), "zh-Hans-CN");
  });
  return ranked.slice(0, limit);
}

function canvasNotePath(record) {
  const path = canonicalNoteRef(record);
  return path ? `${path}.md` : "";
}

function uniqueCanvasNodeId(path, used) {
  const base = `node-${stableHash(path).slice(0, 12)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

/**
 * Build a deterministic Obsidian JSON Canvas document from real file records.
 * Supports buildCanvasDocument(records, edges, options) and
 * buildCanvasDocument({records|notes, edges|relations, ...options}).
 */
function buildCanvasDocument(recordsInput, edgesInput, optionsInput = {}) {
  let records = recordsInput;
  let edges = edgesInput;
  let options = optionsInput;
  if (!Array.isArray(recordsInput) && recordsInput && typeof recordsInput === "object") {
    options = recordsInput;
    records = recordsInput.records || recordsInput.notes || [];
    edges = recordsInput.edges || recordsInput.relations || [];
  }
  if (!Array.isArray(records) || !Array.isArray(edges || [])) {
    throw new TypeError("records and edges must be arrays");
  }

  const width = Number.isFinite(options.width) ? options.width : 360;
  const height = Number.isFinite(options.height) ? options.height : 240;
  const radiusX = Number.isFinite(options.radiusX) ? options.radiusX : 560;
  const radiusY = Number.isFinite(options.radiusY) ? options.radiusY : 380;
  const unique = [];
  const seen = new Set();
  for (const record of records) {
    const path = canvasNotePath(record);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push({ record, path });
  }

  const usedNodeIds = new Set();
  const nodeByRef = new Map();
  const nodes = unique.map((item, index) => {
    let x = 0;
    let y = 0;
    if (index > 0) {
      const count = Math.max(1, unique.length - 1);
      const angle = -Math.PI / 2 + ((index - 1) * Math.PI * 2) / count;
      x = Math.round(Math.cos(angle) * radiusX);
      y = Math.round(Math.sin(angle) * radiusY);
    }
    const id = uniqueCanvasNodeId(item.path, usedNodeIds);
    const canonical = canonicalNoteRef(item.record);
    nodeByRef.set(canonical, { id, x, y });
    const node = {
      id,
      type: "file",
      file: item.path,
      x,
      y,
      width,
      height,
    };
    const subpath = sanitizeInline(item.record.subpath);
    if (subpath) node.subpath = subpath.startsWith("#") ? subpath : `#${subpath}`;
    return node;
  });

  const canvasEdges = [];
  const usedEdges = new Set();
  for (const relation of edges || []) {
    const sourcePath = canonicalNoteRef(
      relation.sourcePath || relation.fromPath || relation.source || relation.from
    );
    const targetPath = canonicalNoteRef(
      relation.targetPath || relation.toPath || relation.target || relation.to
    );
    const source = nodeByRef.get(sourcePath);
    const target = nodeByRef.get(targetPath);
    if (!source || !target || source.id === target.id) continue;
    const pairKey = makePairKey(sourcePath, targetPath);
    const relationId = sanitizeInline(relation.id) || makeRelationId(sourcePath, targetPath);
    const dedupeKey = `${pairKey}\u0000${relationId}`;
    if (usedEdges.has(dedupeKey)) continue;
    usedEdges.add(dedupeKey);

    const leftToRight = source.x <= target.x;
    const edge = {
      id: `edge-${stableHash(dedupeKey).slice(0, 12)}`,
      fromNode: source.id,
      fromSide: leftToRight ? "right" : "left",
      toNode: target.id,
      toSide: leftToRight ? "left" : "right",
    };
    const label = sanitizeInline(relation.summary || relation.explanation || relation.label);
    if (label) edge.label = label;
    if (relation.color || options.edgeColor) edge.color = relation.color || options.edgeColor;
    canvasEdges.push(edge);
  }

  return { nodes, edges: canvasEdges };
}

module.exports = {
  MANAGED_START,
  MANAGED_END,
  MANAGED_HEADING,
  SAFE_EXCERPT_PLACEHOLDER,
  ManagedRelationError,
  stableHash,
  makePairKey,
  makeRelationId,
  parseManagedRelations,
  upsertManagedRelation,
  removeManagedRelation,
  stripManagedRelations,
  buildBidirectionalRelationEntries,
  previewExcerpt,
  displayTagLabel,
  toDisplayTags,
  rankCandidates,
  buildCanvasDocument,
};
