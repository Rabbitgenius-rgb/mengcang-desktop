"use strict";

const BOOK_INTRO_VIEW_TYPE = "mengcang-book-intro";
const BOOK_INTRO_BOOK_PATH = "01_sources/books/局外人.md";
const BOOK_INTRO_ASSET_PATH = "book-intros/the-stranger/index.html";
const BOOK_INTRO_BRIDGE_TYPE = "mengcang-book-intro";
const BOOK_INTRO_BRIDGE_VERSION = 1;
const BOOK_INTRO_EXTERNAL_URLS = Object.freeze({
  "art-source-smk-kms3696": "https://open.smk.dk/en/artwork/image/KMS3696"
});
const BOOK_INTRO_BRIDGE_ACTIONS = Object.freeze([
  "open-book",
  "book-graph",
  "journal-resume",
  "journal-new",
  ...Object.keys(BOOK_INTRO_EXTERNAL_URLS)
]);
const bookIntroBridgeActionSet = new Set(BOOK_INTRO_BRIDGE_ACTIONS);
const bookIntroExternalUrlSet = new Set(Object.values(BOOK_INTRO_EXTERNAL_URLS));

function normalizeBookIntroBookPath(path) {
  return typeof path === "string" && path === BOOK_INTRO_BOOK_PATH
    ? BOOK_INTRO_BOOK_PATH
    : null;
}

function isBookIntroRecord(record) {
  return normalizeBookIntroBookPath(record?.file?.path || record?.path) !== null;
}

function parseBookIntroProtocolParams(params = {}) {
  if (params?.page !== "book-intro") return null;
  const bookPath = normalizeBookIntroBookPath(params.book);
  return bookPath ? { bookPath } : null;
}

function makeBookIntroViewState(path) {
  const bookPath = normalizeBookIntroBookPath(path);
  if (!bookPath) return null;
  return {
    type: BOOK_INTRO_VIEW_TYPE,
    active: true,
    state: { bookPath }
  };
}

function normalizeBookIntroViewState(state = {}) {
  return {
    bookPath: normalizeBookIntroBookPath(state.bookPath || state.book)
  };
}

function isSelfContainedBookIntroHtml(source) {
  if (typeof source !== "string" || !source) return false;
  const documentShell = source
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, "$1$2");
  return (
    /^<!doctype html>/i.test(source)
    && source.includes(`data-mengcang-book-path="${BOOK_INTRO_BOOK_PATH}"`)
    && source.includes('data-mengcang-inline="styles"')
    && source.includes('data-mengcang-inline="app"')
    && !/<script\b[^>]*\bsrc=/i.test(documentShell)
    && !/<link\b[^>]*\brel=["']stylesheet["']/i.test(documentShell)
  );
}

function parseBookIntroBridgeMessage(event, expectedSource) {
  if (!event || !expectedSource || event.source !== expectedSource) return null;
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.type !== BOOK_INTRO_BRIDGE_TYPE || data.version !== BOOK_INTRO_BRIDGE_VERSION) return null;
  if (normalizeBookIntroBookPath(data.bookPath) !== BOOK_INTRO_BOOK_PATH) return null;
  if (data.event === "ready") return { event: "ready", bookPath: BOOK_INTRO_BOOK_PATH };
  if (data.event !== "action" || !bookIntroBridgeActionSet.has(data.action)) return null;
  return {
    event: "action",
    action: data.action,
    bookPath: BOOK_INTRO_BOOK_PATH
  };
}

function normalizeBookIntroExternalUrl(url) {
  return typeof url === "string" && bookIntroExternalUrlSet.has(url) ? url : null;
}

function bookIntroBridgeCommand(action) {
  if (!bookIntroBridgeActionSet.has(action)) return null;
  if (action === "open-book") {
    return { kind: "open-book", bookPath: BOOK_INTRO_BOOK_PATH };
  }
  if (action === "book-graph") {
    return { kind: "book-graph", bookPath: BOOK_INTRO_BOOK_PATH, depth: 2 };
  }
  const externalUrl = normalizeBookIntroExternalUrl(BOOK_INTRO_EXTERNAL_URLS[action]);
  if (externalUrl) {
    return {
      kind: "open-external",
      bookPath: BOOK_INTRO_BOOK_PATH,
      url: externalUrl
    };
  }
  return {
    kind: "book-journal",
    bookPath: BOOK_INTRO_BOOK_PATH,
    action: action === "journal-resume" ? "resume" : "new"
  };
}

function selectPreferredLeaf(targetLeaf, existingLeaf, fallbackLeaf) {
  return targetLeaf || existingLeaf || fallbackLeaf || null;
}

module.exports = {
  BOOK_INTRO_ASSET_PATH,
  BOOK_INTRO_BOOK_PATH,
  BOOK_INTRO_BRIDGE_ACTIONS,
  BOOK_INTRO_BRIDGE_TYPE,
  BOOK_INTRO_BRIDGE_VERSION,
  BOOK_INTRO_EXTERNAL_URLS,
  BOOK_INTRO_VIEW_TYPE,
  bookIntroBridgeCommand,
  isBookIntroRecord,
  isSelfContainedBookIntroHtml,
  makeBookIntroViewState,
  normalizeBookIntroBookPath,
  normalizeBookIntroExternalUrl,
  normalizeBookIntroViewState,
  parseBookIntroBridgeMessage,
  parseBookIntroProtocolParams,
  selectPreferredLeaf
};
