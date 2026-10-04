const {
  ItemView,
  MarkdownRenderChild,
  Notice,
  openWithDefaultApp,
  Plugin,
  TFile
} = require("obsidian");
const { StarSeaService } = require("../star-sea/service");
const { renderStarSeaPage } = require("../star-sea/view");
const { BookCurationService } = require("../book-curation/service");
const { BookCurationSettingTab } = require("../book-curation/settings");
const { mountBookCurationPanel } = require("../book-curation/view");
const { buildBookLocalGraph } = require("./book-local-graph");
const {
  NATIVE_LOCAL_GRAPH_VIEW_TYPE,
  makeNativeBookGraphViewState
} = require("./native-book-graph");
const { BookJournalService, bookTitleFromPath } = require("./book-journal");
const { InspirationStore } = require("./inspiration/store");
const { DesktopConnector } = require("./desktop-connector");
const { mountFusionView } = require("./inspiration/view.jsx");
const {
  BOOK_INTRO_ASSET_PATH,
  BOOK_INTRO_BOOK_PATH,
  BOOK_INTRO_VIEW_TYPE,
  bookIntroBridgeCommand,
  isBookIntroRecord,
  isSelfContainedBookIntroHtml,
  makeBookIntroViewState,
  normalizeBookIntroViewState,
  normalizeBookIntroExternalUrl,
  parseBookIntroBridgeMessage,
  parseBookIntroProtocolParams,
  selectPreferredLeaf
} = require("./book-intro");

const VIEW_TYPE = "mengcang-dashboard";
const CODE_BLOCK = "mengcang-dashboard";
const OVERVIEW_NOTE_PATH = "01_sources/梦藏总览.md";
const PROJECT_REGISTRY_PATH = "_meta/projects.json";
const INSPIRATION_PAGE_SIZE = 30;
const ROOTS = {
  books: "01_sources/books/",
  patterns: "01_sources/cards/images/patterns/",
  text: "01_sources/cards/text/",
  web: "01_sources/cards/web/"
};
const BASE_PATHS = {
  books: "01_sources/books/bookshelf.base",
  patterns: "01_sources/cards/images/patterns/纹样图鉴.base",
  text: "01_sources/cards/text/text-cards.base",
  web: "01_sources/cards/web/web-clips.base"
};
const READING_STATUS = {
  "want-to-read": "想读",
  reading: "在读",
  read: "已读",
  paused: "暂停"
};
const BOOK_HOVER_SHOW_DELAY_MS = 300;
const BOOK_HOVER_HIDE_DELAY_MS = 180;
const BOOK_HOVER_CARD_GAP_PX = 14;
const BOOK_HOVER_VIEWPORT_MARGIN_PX = 12;
const BOOK_HOVER_STATUS = {
  "want-to-read": "想读",
  "to-read": "想读",
  reading: "在读",
  "in-progress": "在读",
  read: "已读",
  finished: "已读",
  completed: "已读",
  paused: "暂停",
  on_hold: "暂停",
  abandoned: "搁置",
  dropped: "搁置"
};

const bookHoverState = {
  showTimer: 0,
  showWindow: null,
  hideTimer: 0,
  hideWindow: null,
  renderToken: 0,
  activeCover: null,
  activeCard: null,
  activeTrigger: null,
  focusIntentTrigger: null
};
let nextBookHoverCardId = 0;
const bookHoverAutoScrollSyncs = new Set();

function syncBookHoverAutoScroll() {
  for (const sync of bookHoverAutoScrollSyncs) sync();
}

function valueToText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join("、");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function valueToList(value) {
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) ? value : String(value).split(/[,，、;；\n]/);
  return values.map(valueToText).filter(Boolean);
}

const DASHBOARD_ROUTES = new Set(["home", "inspirations", "materials", "patterns", "books", "book-graph", "text", "web"]);
const BOOK_FILTERS = new Set(["all", "want-to-read", "reading", "read", "paused"]);
const WEB_FILTERS = new Set(["all", "inbox", "ready", "used"]);
const TEXT_VIEWS = new Set(["main", "inspirations"]);

function normalizeDashboardViewState(rawState = {}) {
  const route = valueToText(rawState.route);
  const bookStatus = valueToText(rawState.bookStatus);
  const webStatus = valueToText(rawState.webStatus);
  const textView = valueToText(rawState.textView);
  return {
    route: DASHBOARD_ROUTES.has(route) ? route : "home",
    sidebarCollapsed: rawState.sidebarCollapsed === true,
    query: valueToText(rawState.query),
    bookStatus: BOOK_FILTERS.has(bookStatus) ? bookStatus : "all",
    webStatus: WEB_FILTERS.has(webStatus) ? webStatus : "all",
    selectedWebPath: valueToText(rawState.selectedWebPath),
    selectedWebExcerpt: Math.max(0, Math.floor(Number(rawState.selectedWebExcerpt)) || 0),
    atlasPath: valueToText(rawState.atlasPath),
    selectedPatternPath: valueToText(rawState.selectedPatternPath),
    selectedBookPath: valueToText(rawState.selectedBookPath),
    bookGraphDepth: [1, 2].includes(Number(rawState.bookGraphDepth)) ? Number(rawState.bookGraphDepth) : 2,
    textTheme: valueToText(rawState.textTheme),
    selectedTextPath: valueToText(rawState.selectedTextPath),
    textView: TEXT_VIEWS.has(textView) ? textView : "main",
    inspirationProjectId: valueToText(rawState.inspirationProjectId) || "all",
    inspirationPage: Math.max(1, Math.floor(Number(rawState.inspirationPage)) || 1),
    selectedStarPath: valueToText(rawState.selectedStarPath),
    selectedStarTargetPath: valueToText(rawState.selectedStarTargetPath),
    selectedStarRelationId: valueToText(rawState.selectedStarRelationId)
  };
}

function markdownBody(source) {
  const text = valueToText(source);
  return text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trim();
}

function markdownToPlainText(source) {
  return markdownBody(source)
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

function textBucket(record) {
  const recordType = normalizedTextType(record);
  const kind = valueToText(record.materialKind).toLocaleLowerCase("zh-CN");
  if (recordType === "excerpt" || /摘录|引用|quote|excerpt|citation/.test(kind)) return "excerpt";
  if (isOrganizedInspirationRecord(record)) return "organized";
  return "viewpoint";
}

function isInspirationRecord(record) {
  return normalizedTextType(record) === "inspiration";
}

function normalizedTextType(record) {
  const raw = valueToText(record?.recordType || record?.materialKind).toLocaleLowerCase("zh-CN");
  if (/灵感|inspiration|insight/.test(raw)) return "inspiration";
  if (/摘录|引用|quote|excerpt|citation/.test(raw)) return "excerpt";
  if (/观点|opinion|viewpoint/.test(raw)) return "opinion";
  return raw;
}

function isInboxInspirationRecord(record) {
  if (!isInspirationRecord(record)) return false;
  const status = valueToText(record.status).toLocaleLowerCase("zh-CN");
  return ["inbox", "待整理", "待归册", "待归档"].includes(status);
}

function isOrganizedInspirationRecord(record) {
  if (!isInspirationRecord(record) || isInboxInspirationRecord(record)) return false;
  const status = valueToText(record.status).toLocaleLowerCase("zh-CN");
  const kind = valueToText(record.materialKind).toLocaleLowerCase("zh-CN");
  return ["organized", "ready", "active", "used", "archived", "已整理", "已使用", "已归档"].includes(status)
    || /已整理灵感/.test(kind);
}

function isSecondLayerRecord(record) {
  const recordType = normalizedTextType(record);
  return recordType === "opinion" || recordType === "excerpt" || isOrganizedInspirationRecord(record);
}

function normalizeProjectRecords(raw) {
  const source = Array.isArray(raw) ? raw : raw?.projects;
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  const projects = [];
  for (const item of source) {
    const id = valueToText(item?.id);
    const name = valueToText(item?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    projects.push({ id, name });
  }
  return projects;
}

function shortDate(value) {
  const date = safeDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "日期未知";
  return date.slice(5).replace("-", ".");
}

function projectLabel(record, projects = []) {
  const projectIds = valueToList(record?.projectIds);
  if (!projectIds.length) return "无项目";
  const byId = new Map(projects.map((project) => [project.id, project.name]));
  const names = projectIds.map((id) => byId.get(id)).filter(Boolean);
  if (!names.length) return `${projectIds.length} 个项目`;
  return names.length > 1 ? `${names[0]} · +${names.length - 1}` : names[0];
}

function projectFilterOptions(records, projects = []) {
  const options = projects.map((project) => ({ ...project, unregistered: false }));
  const seen = new Set(options.map((project) => project.id));
  for (const record of records) {
    for (const id of valueToList(record.projectIds)) {
      if (!id || id === "all" || id === "none" || seen.has(id)) continue;
      seen.add(id);
      options.push({ id, name: `未注册项目 · ${id}`, unregistered: true });
    }
  }
  return options;
}

function filterInspirationRecords(records, projectId = "all") {
  return records.filter((record) => {
    if (!isInboxInspirationRecord(record)) return false;
    const projectIds = valueToList(record.projectIds);
    if (projectId === "all") return true;
    if (projectId === "none") return projectIds.length === 0;
    return projectIds.includes(projectId);
  });
}

function paginateRecords(records, page = 1, pageSize = INSPIRATION_PAGE_SIZE) {
  const safeSize = Math.max(1, Math.floor(pageSize) || INSPIRATION_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(records.length / safeSize));
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
  const start = (safePage - 1) * safeSize;
  return {
    items: records.slice(start, start + safeSize),
    page: safePage,
    pageCount,
    total: records.length
  };
}

function makeTextDemoRecords() {
  const shared = {
    kind: "text",
    isDemo: true,
    capturedAt: "2026-08-25",
    tags: "示例",
    related: "梦藏文本档案",
    searchText: ""
  };
  return [
    {
      ...shared,
      demoId: "demo-inspiration-mountain",
      recordType: "inspiration",
      status: "inbox",
      title: "山间的节奏",
      theme: "未分类",
      materialKind: "灵感",
      summary: "雾把远处的树和屋檐柔化成光的形状，也许可以把看不清当作一种构图方法。",
      bodyText: "雾把远处的树和屋檐柔化成光的形状，也许可以把看不清当作一种构图方法。",
      tags: "自然、光影",
      projectIds: ["mengcang", "ai-web-design-aesthetic-training"]
    },
    {
      ...shared,
      demoId: "demo-inspiration-line",
      capturedAt: "2026-08-24",
      recordType: "灵感",
      status: "待整理",
      title: "线条的呼吸",
      theme: "未分类",
      materialKind: "灵感",
      summary: "好的线条不是直线的延伸，而是情绪与停顿留下的呼吸。",
      bodyText: "好的线条不是直线的延伸，而是情绪与停顿留下的呼吸。",
      tags: "线条、绘画",
      projectIds: []
    },
    {
      ...shared,
      demoId: "demo-inspiration-paper",
      capturedAt: "2026-08-23",
      recordType: "inspiration",
      status: "inbox",
      title: "纸背透出的光",
      theme: "未分类",
      materialKind: "灵感",
      summary: "让内容像薄纸背后慢慢透出的亮处，边缘可以消失，中心仍然清晰。",
      bodyText: "让内容像薄纸背后慢慢透出的亮处，边缘可以消失，中心仍然清晰。",
      tags: "光影、界面",
      projectIds: ["mengcang"]
    },
    {
      ...shared,
      demoId: "demo-inspiration-order",
      capturedAt: "2026-08-22",
      recordType: "灵感",
      status: "inbox",
      title: "安静里也要有方向",
      theme: "未分类",
      materialKind: "灵感",
      summary: "微小的偏移、停顿与层次，会让静态界面仍然保持呼吸感。",
      bodyText: "微小的偏移、停顿与层次，会让静态界面仍然保持呼吸感。",
      tags: "界面、节奏",
      projectIds: ["ai-web-design-aesthetic-training"]
    },
    {
      ...shared,
      demoId: "demo-inspiration-unassigned",
      capturedAt: "2026-08-21",
      recordType: "灵感",
      status: "inbox",
      title: "先允许它没有归属",
      theme: "未分类",
      materialKind: "灵感",
      summary: "无项目的灵感也要有位置，分类应该发生在需要寻找时。",
      bodyText: "无项目的灵感也要有位置，分类应该发生在需要寻找时，而不是在刚出现时强迫选择。",
      tags: "分类、灵感",
      projectIds: []
    },
    {
      ...shared,
      demoId: "demo-organized",
      capturedAt: "2026-08-20",
      recordType: "inspiration",
      title: "从碎片到可回访的灵感",
      theme: "器物与时间",
      materialKind: "已整理灵感",
      status: "organized",
      summary: "建议把来源、主题和关联对象并列呈现，但本阶段不写回 Vault。",
      bodyText: "后续可由人确认建议，再写入主题、标签、关联对象与整理状态。",
      projectIds: ["mengcang"]
    },
    {
      ...shared,
      demoId: "demo-viewpoint",
      capturedAt: "2026-08-19",
      recordType: "opinion",
      title: "器物会替时间保存触感",
      theme: "器物与时间",
      materialKind: "观点",
      status: "ready",
      summary: "器物不仅保存形制，也保存被使用、被修补和被重新理解的时间。",
      bodyText: "器物不仅保存形制，也保存被使用、被修补和被重新理解的时间。",
      projectIds: []
    },
    {
      ...shared,
      demoId: "demo-excerpt",
      capturedAt: "2026-08-18",
      recordType: "excerpt",
      title: "摘录先保留语境，再提炼结论",
      theme: "器物与时间",
      materialKind: "摘录",
      status: "archived",
      summary: "示例摘录不会进入统计、搜索或 AI 整理流程。",
      bodyText: "真实资料会从 Markdown 正文读取，并保留原笔记作为唯一真源。",
      projectIds: []
    }
  ];
}

function normalizeWikiTarget(rawTarget) {
  let target = valueToText(rawTarget).trim();
  if (!target) return "";
  target = target.replace(/^!/, "");
  const match = target.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  if (match) target = match[1];
  target = target.replace(/^\/+/, "").trim();
  if (/^[a-z]+:\/\//i.test(target)) return "";
  return target;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeButton(className, text, ariaLabel) {
  const button = makeElement("button", className, text);
  button.type = "button";
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  return button;
}

function isMarkdownFile(file) {
  return file instanceof TFile && file.extension === "md";
}

function isBaseFile(file) {
  return file instanceof TFile && file.extension === "base";
}

function isRelevantPath(path) {
  const normalized = valueToText(path).replace(/\/+$/, "");
  if (!normalized) return false;
  if (normalized === PROJECT_REGISTRY_PATH || PROJECT_REGISTRY_PATH.startsWith(`${normalized}/`)) return true;
  return Object.values(ROOTS).some((root) => {
    const base = root.replace(/\/+$/, "");
    return normalized === base || normalized.startsWith(`${base}/`) || base.startsWith(`${normalized}/`);
  });
}

function resolveVaultFile(app, rawTarget, sourcePath) {
  const target = normalizeWikiTarget(rawTarget);
  if (!target) return null;
  const direct = app.vault.getAbstractFileByPath(target);
  if (direct instanceof TFile) return direct;
  const linked = app.metadataCache.getFirstLinkpathDest(target, sourcePath || "");
  return linked instanceof TFile ? linked : null;
}

function resourceUrl(app, rawPath, sourcePath) {
  const raw = valueToText(rawPath);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return "";
  if (/^(data:|app:)/i.test(raw)) return raw;
  const normalized = normalizeWikiTarget(raw);
  if (!normalized) return "";
  const file = resolveVaultFile(app, normalized, sourcePath);
  if (file) return app.vault.getResourcePath(file);
  return app.vault.adapter.getResourcePath(normalized);
}

function sourceHostname(rawUrl) {
  const text = valueToText(rawUrl);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.hostname.replace(/^www\./i, "");
  } catch (_) {
    return "";
  }
}

function safeWebUrl(rawUrl) {
  const text = valueToText(rawUrl);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch (_) {
    return "";
  }
}

function provenanceLabel(value) {
  const provenance = valueToText(value);
  if (provenance === "prototype") return "现代原型";
  if (provenance === "verified") return "已考证";
  if (provenance === "unverified") return "待考证";
  return provenance;
}

function safeDate(value) {
  const text = valueToText(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function statusLabel(value, kind) {
  const status = valueToText(value);
  if (kind === "book") return READING_STATUS[status] || status || "未分类";
  if (status === "inbox") return "待归册";
  if (status === "active" || status === "ready" || status === "organized") return "已整理";
  if (status === "used") return "已使用";
  return status || "未分类";
}

class MengcangStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.listeners = new Set();
    this.timer = 0;
    this.refreshToken = 0;
    this.started = false;
    this.disposed = false;
    this.snapshot = {
      ready: false,
      revision: 0,
      books: [],
      patterns: [],
      textCards: [],
      webClips: [],
      projects: [],
      projectRegistryAvailable: false
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      const scheduleFor = (file) => {
        if (isRelevantPath(file?.path)) this.scheduleRefresh();
      };
      this.plugin.registerEvent(this.app.metadataCache.on("changed", scheduleFor));
      this.plugin.registerEvent(this.app.vault.on("create", scheduleFor));
      this.plugin.registerEvent(this.app.vault.on("modify", scheduleFor));
      this.plugin.registerEvent(this.app.vault.on("delete", scheduleFor));
      this.plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        if (isRelevantPath(file?.path) || isRelevantPath(oldPath || "")) {
          this.scheduleRefresh();
        }
      }));
      void this.refreshNow();
    });
  }

  scheduleRefresh() {
    if (this.disposed) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.refreshNow();
    }, 180);
  }

  async refreshNow() {
    if (this.disposed) return;
    const refreshToken = ++this.refreshToken;
    const bookJobs = [];
    const patternJobs = [];
    const textCardJobs = [];
    const webClipJobs = [];
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    const readRecord = (file, frontmatter, factory) => this.app.vault.cachedRead(file)
      .then((source) => factory.call(this, file, frontmatter, source))
      .catch(() => factory.call(this, file, frontmatter, ""));

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!isRelevantPath(file.path)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const type = valueToText(frontmatter.type);
      if (file.path.startsWith(ROOTS.books) && type === "book") {
        bookJobs.push(readRecord(file, frontmatter, this.makeBook));
      } else if (file.path.startsWith(ROOTS.patterns) && type === "material") {
        patternJobs.push(readRecord(file, frontmatter, this.makePattern));
      } else if (file.path.startsWith(ROOTS.text) && type === "material") {
        textCardJobs.push(readRecord(file, frontmatter, this.makeTextCard));
      } else if (file.path.startsWith(ROOTS.web) && type === "material") {
        webClipJobs.push(readRecord(file, frontmatter, this.makeWebClip));
      }
    }

    const [books, patterns, textCards, webClips, projectRegistry] = await Promise.all([
      Promise.all(bookJobs),
      Promise.all(patternJobs),
      Promise.all(textCardJobs),
      Promise.all(webClipJobs),
      this.readProjects()
    ]);
    if (this.disposed || refreshToken !== this.refreshToken) return;

    const byPath = (a, b) => collator.compare(a.file.path, b.file.path);
    books.sort((a, b) => {
      const collectionOrder = collator.compare(a.collection || "", b.collection || "");
      if (collectionOrder) return collectionOrder;
      if (a.volume !== b.volume) return a.volume - b.volume;
      return byPath(a, b);
    });
    patterns.sort((a, b) => Number(b.isAtlas) - Number(a.isAtlas) || byPath(a, b));
    textCards.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || byPath(a, b));
    webClips.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || byPath(a, b));

    this.snapshot = {
      ready: true,
      revision: this.snapshot.revision + 1,
      books,
      patterns,
      textCards,
      webClips,
      projects: projectRegistry.projects,
      projectRegistryAvailable: projectRegistry.available
    };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  baseRecord(file, frontmatter, kind, source = "") {
    const title = valueToText(frontmatter.title) || file.basename;
    const author = valueToText(frontmatter.author);
    const tags = valueToText(frontmatter.tags);
    const host = sourceHostname(frontmatter.source_url || frontmatter.url);
    const rawMarkdown = typeof source === "string" ? source : "";
    const body = markdownBody(rawMarkdown);
    const bodyText = markdownToPlainText(rawMarkdown);
    return {
      kind,
      file,
      noteId: valueToText(frontmatter.id) || file.path,
      title,
      author,
      tags,
      summary: valueToText(frontmatter.summary || frontmatter.description),
      rawMarkdown,
      body,
      bodyText,
      cover: resourceUrl(this.app, frontmatter.cover, file.path),
      status: valueToText(frontmatter.status),
      capturedAt: safeDate(frontmatter.captured_at || frontmatter.created_at),
      modifiedAt: Number(file.stat?.mtime) || 0,
      searchText: [title, author, tags, valueToText(frontmatter.summary), valueToText(frontmatter.source_name), host, bodyText]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN")
    };
  }

  makeBook(file, frontmatter, source = "") {
    return {
      ...this.baseRecord(file, frontmatter, "book", source),
      readingStatus: valueToText(frontmatter.reading_status),
      collection: valueToText(frontmatter.collection),
      volume: Number(frontmatter.volume) || 0,
      volumeTotal: Number(frontmatter.volume_total) || 0,
      pages: Number(frontmatter.pages || frontmatter.source_pages) || 0
    };
  }

  makePattern(file, frontmatter, source = "") {
    const atlasLevel = valueToText(frontmatter.atlas_level);
    const isAtlas = atlasLevel === "atlas" || Boolean(frontmatter.target_base);
    const base = this.baseRecord(file, frontmatter, "pattern", source);
    const family = valueToText(frontmatter.pattern_family);
    const form = valueToText(frontmatter.pattern_form);
    const period = valueToText(frontmatter.period);
    return {
      ...base,
      isAtlas,
      atlasLevel,
      targetBase: valueToText(frontmatter.target_base),
      family,
      form,
      period,
      carrier: valueToText(frontmatter.carrier),
      usage: valueToText(frontmatter.usage),
      itemCount: Number(frontmatter.item_count) || 0,
      provenance: valueToText(frontmatter.provenance_status),
      searchText: [base.searchText, family, form, period].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN")
    };
  }

  makeTextCard(file, frontmatter, source = "") {
    const base = this.baseRecord(file, frontmatter, "text", source);
    const theme = valueToText(frontmatter.theme || frontmatter.topic || frontmatter.category) || "未分类";
    const related = valueToText(
      frontmatter.related
      || frontmatter.related_objects
      || frontmatter.associations
      || frontmatter.links
    );
    const body = base.body;
    const bodyText = base.bodyText;
    const projectIds = valueToList(
      frontmatter.project_ids
      || frontmatter.projects
      || frontmatter.project_id
    );
    return {
      ...base,
      theme,
      related,
      body,
      bodyText,
      projectIds,
      recordType: valueToText(frontmatter.record_type),
      materialKind: valueToText(frontmatter.material_kind || frontmatter.content_type || frontmatter.note_kind),
      sourceName: valueToText(frontmatter.source_name || frontmatter.origin),
      searchText: [base.title, theme, base.tags, bodyText, related, projectIds.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN")
    };
  }

  async readProjects() {
    try {
      const source = await this.app.vault.adapter.read(PROJECT_REGISTRY_PATH);
      return { projects: normalizeProjectRecords(JSON.parse(source)), available: true };
    } catch (_) {
      return { projects: [], available: false };
    }
  }

  makeWebClip(file, frontmatter, source = "") {
    const base = this.baseRecord(file, frontmatter, "web", source);
    const sourceUrl = safeWebUrl(frontmatter.source_url || frontmatter.url);
    const referenceUrl = safeWebUrl(frontmatter.reference_url);
    const sourceName = valueToText(frontmatter.source_name || frontmatter.site_name || frontmatter.origin);
    const sourceHost = sourceHostname(sourceUrl);
    const award = valueToText(frontmatter.award);
    const observations = valueToList(
      frontmatter.excerpt_options
      || frontmatter.observations
      || frontmatter.excerpts
    );
    const notes = valueToList(
      frontmatter.preview_paragraphs
      || frontmatter.notes
      || frontmatter.design_notes
    );
    const exampleValue = valueToText(frontmatter.is_example).toLocaleLowerCase("zh-CN");
    return {
      ...base,
      sourceName,
      sourceHost,
      sourceUrl,
      referenceUrl,
      award,
      observations,
      notes,
      isExample: frontmatter.is_example === true || exampleValue === "true" || exampleValue === "yes",
      coverFit: valueToText(frontmatter.cover_fit) === "contain" ? "contain" : "cover",
      searchText: [base.searchText, sourceName, sourceHost, award, ...observations, ...notes]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN")
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.disposed = true;
    this.refreshToken += 1;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    this.listeners.clear();
  }
}

function pluginAssetPath(plugin, filename) {
  const pluginDir = plugin.manifest.dir || `.obsidian/plugins/${plugin.manifest.id}`;
  return `${pluginDir}/assets/${filename}`;
}

function pluginAssetUrl(plugin, filename) {
  return plugin.app.vault.adapter.getResourcePath(pluginAssetPath(plugin, filename));
}

function installTextureVariables(root, plugin) {
  const silk = pluginAssetUrl(plugin, "museum-silk-texture.png");
  const lacquer = pluginAssetUrl(plugin, "cinnabar-lacquer-texture.png");
  root.style.setProperty("--mengcang-silk-image", `url("${silk.replace(/"/g, "%22")}")`);
  root.style.setProperty("--mengcang-lacquer-image", `url("${lacquer.replace(/"/g, "%22")}")`);
}

async function openBase(plugin, path) {
  const target = plugin.app.vault.getAbstractFileByPath(path);
  if (!isBaseFile(target)) {
    new Notice(`尚未找到 Base：${path}`);
    return;
  }
  try {
    await plugin.app.workspace.getLeaf("tab").openFile(target);
  } catch (_) {
    new Notice(`无法打开 Base：${path}`);
  }
}

async function openRecord(plugin, record, event = {}) {
  if (record.kind === "pattern" && record.isAtlas) {
    const target = resolveVaultFile(plugin.app, record.targetBase, record.file.path);
    if (!isBaseFile(target)) {
      new Notice(`图鉴目标无效：${record.targetBase || "尚未设置 target_base"}`);
      return;
    }
    try {
      await plugin.app.workspace.getLeaf("tab").openFile(target);
    } catch (_) {
      new Notice(`无法打开图鉴：${record.title}`);
    }
    return;
  }
  const newTab = Boolean(event.metaKey || event.ctrlKey);
  try {
    await plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(record.file);
  } catch (_) {
    new Notice(`无法打开资料：${record.title}`);
  }
}

function addCover(parent, record, kind) {
  const cover = makeElement("div", `mengcang-card-cover mengcang-card-cover--${kind}`);
  const fallback = makeElement("div", "mengcang-card-cover__fallback", record.title);
  cover.appendChild(fallback);
  if (record.cover) {
    const image = makeElement("img", "mengcang-card-cover__image");
    image.alt = "";
    image.loading = "lazy";
    image.src = record.cover;
    image.addEventListener("error", () => image.remove());
    cover.appendChild(image);
  }
  cover.appendChild(makeElement("span", "mengcang-card-cover__spine"));
  parent.appendChild(cover);
  return cover;
}

function clearBookHoverShowTimer() {
  if (bookHoverState.showTimer) {
    (bookHoverState.showWindow || window).clearTimeout(bookHoverState.showTimer);
  }
  bookHoverState.showTimer = 0;
  bookHoverState.showWindow = null;
}

function clearBookHoverHideTimer() {
  if (bookHoverState.hideTimer) {
    (bookHoverState.hideWindow || window).clearTimeout(bookHoverState.hideTimer);
  }
  bookHoverState.hideTimer = 0;
  bookHoverState.hideWindow = null;
}

function removeBookHoverCard() {
  const trigger = bookHoverState.activeCard?.bookHoverTrigger;
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.removeAttribute("aria-controls");
  bookHoverState.activeCard?.remove();
  bookHoverState.activeCard = null;
}

function hideBookHoverCard(options = {}) {
  if (options.owner && bookHoverState.activeCover && !options.owner.contains?.(bookHoverState.activeCover)) return;
  const trigger = bookHoverState.activeTrigger;
  clearBookHoverShowTimer();
  clearBookHoverHideTimer();
  bookHoverState.activeCover = null;
  bookHoverState.activeTrigger = null;
  bookHoverState.focusIntentTrigger = null;
  bookHoverState.renderToken += 1;
  removeBookHoverCard();
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.removeAttribute("aria-controls");
  if (options.restoreFocus && trigger?.isConnected) trigger.focus?.({ preventScroll: true });
  syncBookHoverAutoScroll();
}

function scheduleBookHoverHide(options = {}) {
  const focused = bookHoverState.activeCard?.ownerDocument?.activeElement;
  if (!options.ignoreFocus && focused && bookHoverState.activeCard?.contains?.(focused)) return;
  clearBookHoverHideTimer();
  const ownerWindow = bookHoverState.activeCard?.ownerDocument?.defaultView
    || bookHoverState.activeCover?.ownerDocument?.defaultView
    || window;
  bookHoverState.hideWindow = ownerWindow;
  bookHoverState.hideTimer = ownerWindow.setTimeout(() => {
    bookHoverState.hideTimer = 0;
    bookHoverState.hideWindow = null;
    hideBookHoverCard();
  }, BOOK_HOVER_HIDE_DELAY_MS);
}

function firstBookHoverText(frontmatter, keys) {
  for (const key of keys) {
    const text = valueToText(frontmatter[key]);
    if (text) return text;
  }
  return "";
}

function bookHoverNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clampBookHover(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function bookHoverStatusInfo(frontmatter) {
  const raw = firstBookHoverText(frontmatter, ["reading_status", "readingStatus", "book_status"]) || "未设置";
  const key = raw.toLowerCase().replace(/\s+/g, "-");
  return { key, label: BOOK_HOVER_STATUS[key] || raw };
}

function bookHoverProgressInfo(frontmatter, status) {
  const current = bookHoverNumber(
    frontmatter.current_page
    ?? frontmatter.currentPage
    ?? frontmatter.page_current
    ?? frontmatter.progress_page
  );
  const total = bookHoverNumber(frontmatter.pages);
  const rawProgress = frontmatter.progress ?? frontmatter.reading_progress;
  let percent = null;

  if (current !== null && total !== null && total > 0) {
    percent = (current / total) * 100;
  } else if (typeof rawProgress === "string" && rawProgress.includes("%")) {
    percent = bookHoverNumber(rawProgress);
  } else {
    const numericProgress = bookHoverNumber(rawProgress);
    if (numericProgress !== null) percent = numericProgress <= 1 ? numericProgress * 100 : numericProgress;
  }

  if (percent === null && ["read", "finished", "completed"].includes(status.key)) percent = 100;
  if (percent === null && ["want-to-read", "to-read"].includes(status.key)) percent = 0;
  if (percent !== null) percent = Math.round(clampBookHover(percent, 0, 100));

  const volume = bookHoverNumber(frontmatter.volume);
  const volumeTotal = bookHoverNumber(frontmatter.volume_total);
  let label = "尚未记录页数";
  if (current !== null && total !== null && total > 0) {
    label = `${Math.round(current)} / ${Math.round(total)} 页 · ${percent}%`;
  } else if (total !== null && total > 0) {
    label = `共 ${Math.round(total)} 页${percent !== null && percent > 0 ? ` · ${percent}%` : ""}`;
  } else if (volume !== null && volumeTotal !== null) {
    label = `第 ${Math.round(volume)} / ${Math.round(volumeTotal)} 册`;
  } else if (percent !== null) {
    label = `${percent}%`;
  }
  return { percent, label };
}

function escapeBookHoverRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanBookHoverMarkdown(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, target, alias) => alias || target)
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~`#]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBookHoverSection(markdown, heading) {
  const pattern = new RegExp(`^##\\s+${escapeBookHoverRegExp(heading)}\\s*$`, "mi");
  const match = pattern.exec(markdown);
  if (!match) return "";
  const remainder = markdown.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^##\s+/m);
  return cleanBookHoverMarkdown(nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder);
}

function truncateBookHoverText(text, maximum) {
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum).trimEnd()}…`;
}

function normalizeBookPdfPath(value) {
  const text = valueToText(value);
  if (!text || !text.startsWith("file://")) return text;
  try {
    return decodeURIComponent(new URL(text).pathname);
  } catch (_) {
    const withoutScheme = text.replace(/^file:\/\//, "");
    try {
      return decodeURIComponent(withoutScheme);
    } catch (_) {
      return withoutScheme;
    }
  }
}

function bookPdfExists(path) {
  if (!path) return false;
  try {
    return require("fs").existsSync(path);
  } catch (_) {
    return false;
  }
}

function openBookPdf(path) {
  try {
    if (typeof process !== "undefined" && process.platform === "darwin") {
      const child = require("child_process").spawn(
        "/usr/bin/open",
        ["-a", "Preview", path],
        { detached: true, stdio: "ignore" }
      );
      child.on("error", () => new Notice("无法通过“预览”打开这份 PDF"));
      child.unref();
      return;
    }
    if (typeof openWithDefaultApp === "function") {
      openWithDefaultApp(path);
      return;
    }
    window.open(`file://${encodeURI(path)}`);
  } catch (_) {
    new Notice("无法打开 PDF，请检查文件路径");
  }
}

async function openBookIntroExternalUrl(url) {
  const safeUrl = normalizeBookIntroExternalUrl(url);
  if (!safeUrl) return false;
  try {
    const shell = require("electron")?.shell;
    if (typeof shell?.openExternal === "function") {
      await shell.openExternal(safeUrl, { activate: true });
      return true;
    }
  } catch (_) {
    // Fall through to Obsidian's default-app helper when Electron is unavailable.
  }
  try {
    if (typeof openWithDefaultApp === "function") {
      await Promise.resolve(openWithDefaultApp(safeUrl));
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function collectBookGraphData(plugin, record, depth = 2) {
  const app = plugin?.app;
  const centerPath = record?.file?.path || "";
  const allPaths = typeof app?.vault?.getMarkdownFiles === "function"
    ? app.vault.getMarkdownFiles().map((file) => file.path)
    : [];
  const graph = buildBookLocalGraph({
    centerPath,
    resolvedLinks: app?.metadataCache?.resolvedLinks || {},
    allPaths,
    includeVaultContext: true,
    depth,
    maxNodes: 120,
    maxVaultNodes: 320,
    getTitle: (path) => {
      const file = app?.vault?.getAbstractFileByPath(path);
      const frontmatterTitle = file instanceof TFile
        ? valueToText(app.metadataCache.getFileCache(file)?.frontmatter?.title)
        : "";
      return frontmatterTitle || file?.basename || "";
    }
  });
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      file: app?.vault?.getAbstractFileByPath(node.path) || null
    }))
  };
}

async function collectBookHoverData(plugin, record) {
  const cache = plugin.app.metadataCache.getFileCache(record.file);
  const frontmatter = cache?.frontmatter || {};
  let markdown = "";
  try {
    markdown = await plugin.app.vault.cachedRead(record.file);
  } catch (_) {}

  const status = bookHoverStatusInfo(frontmatter);
  const progress = bookHoverProgressInfo(frontmatter, status);
  const summary = firstBookHoverText(frontmatter, ["summary", "description", "introduction", "intro"])
    || extractBookHoverSection(markdown, "内容摘要");
  const note = firstBookHoverText(frontmatter, ["latest_note", "reading_note"])
    || extractBookHoverSection(markdown, "我的思考")
    || extractBookHoverSection(markdown, "关键观点");
  const pdfPath = normalizeBookPdfPath(frontmatter.source_file ?? frontmatter.pdf);
  const curationJob = plugin.bookCuration?.getJob?.(record.file.path) || null;
  const curationLine = ["ready", "confirmed"].includes(curationJob?.status)
    ? valueToText(curationJob?.draft?.curatorialLines?.[0]?.text || curationJob?.draft?.lines?.[0]?.text)
    : "";

  return {
    title: firstBookHoverText(frontmatter, ["title"]) || record.title || record.file.basename,
    author: firstBookHoverText(frontmatter, ["author", "authors"]) || record.author,
    translator: firstBookHoverText(frontmatter, ["translator"]),
    collection: firstBookHoverText(frontmatter, ["collection"]) || record.collection,
    lastRead: firstBookHoverText(frontmatter, ["last_read_at", "last_read", "updated_at"]),
    status,
    progress,
    summary,
    note: truncateBookHoverText(note, 170),
    curationLine: truncateBookHoverText(curationLine, 150),
    curationStatus: curationJob?.status || "pending",
    cover: record.cover,
    pdfPath,
    pdfAvailable: bookPdfExists(pdfPath)
  };
}

function makeBookHoverElement(ownerDocument, tag, className, text) {
  const element = ownerDocument.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeBookHoverSection(ownerDocument, label, text, emptyText, allowExpand = false) {
  const section = makeBookHoverElement(ownerDocument, "section", "bookshelf-hover-card__section");
  const labelRow = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__section-label");
  labelRow.appendChild(makeBookHoverElement(ownerDocument, "span", "", label));
  if (allowExpand && text && text.length > 50) {
    section.classList.add("is-expandable");
    section.tabIndex = 0;
    section.setAttribute("aria-label", `${label}，聚焦展开全文`);
    section.setAttribute("aria-expanded", "false");
    section.addEventListener("focusin", () => section.setAttribute("aria-expanded", "true"));
    section.addEventListener("focusout", (event) => {
      if (!section.contains?.(event.relatedTarget)) section.setAttribute("aria-expanded", "false");
    });
    labelRow.appendChild(makeBookHoverElement(ownerDocument, "span", "bookshelf-hover-card__expand-hint", "悬停展开"));
  }
  section.appendChild(labelRow);
  section.appendChild(makeBookHoverElement(
    ownerDocument,
    "div",
    `bookshelf-hover-card__section-content${text ? "" : " is-empty"}`,
    text || emptyText
  ));
  return section;
}

function buildBookHoverCard(plugin, record, data, ownerDocument) {
  const card = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card");
  card.id = `mengcang-book-hover-${++nextBookHoverCardId}`;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", `${data.title}的书籍信息`);
  card.dataset.status = data.status.key;

  const hero = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__hero");
  const cover = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__cover");
  if (data.cover) cover.style.backgroundImage = `url("${data.cover.replace(/"/g, "%22")}")`;
  else cover.classList.add("is-placeholder");
  hero.appendChild(cover);

  const identity = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__identity");
  identity.appendChild(makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__eyebrow", data.collection || "我的书架"));
  identity.appendChild(makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__title", data.title));
  identity.appendChild(makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__author", data.author || "作者待补充"));
  if (data.translator) {
    identity.appendChild(makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__translator", `译者：${data.translator}`));
  }
  identity.appendChild(makeBookHoverElement(ownerDocument, "span", "bookshelf-hover-card__status", data.status.label));
  hero.appendChild(identity);
  card.appendChild(hero);

  const progressBlock = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__progress");
  const progressMeta = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__progress-meta");
  progressMeta.append(
    makeBookHoverElement(ownerDocument, "span", "", "阅读进度"),
    makeBookHoverElement(ownerDocument, "span", "", data.progress.label)
  );
  progressBlock.appendChild(progressMeta);
  const track = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__progress-track");
  const fill = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__progress-fill");
  fill.style.width = `${data.progress.percent ?? 0}%`;
  track.appendChild(fill);
  progressBlock.appendChild(track);
  card.appendChild(progressBlock);

  card.appendChild(makeBookHoverSection(ownerDocument, "书本简介", data.summary, "这本书的“内容摘要”尚未填写。", true));
  card.appendChild(makeBookHoverSection(
    ownerDocument,
    "阅读引线 · 非作者原文",
    data.curationLine,
    data.curationStatus === "error" ? "策展草案尚未生成，打开局部图可以重试。" : "正在准备这本书的阅读引线。",
    true
  ));
  card.appendChild(makeBookHoverSection(ownerDocument, "阅读笔记", data.note, "还没有阅读笔记，打开笔记后可以随时补充。"));
  if (data.lastRead) {
    card.appendChild(makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__last-read", `最近阅读：${data.lastRead}`));
  }

  const actions = makeBookHoverElement(ownerDocument, "div", "bookshelf-hover-card__actions");
  const noteButton = makeBookHoverElement(ownerDocument, "button", "bookshelf-hover-card__button is-primary", "打开笔记");
  noteButton.type = "button";
  noteButton.addEventListener("click", async () => {
    hideBookHoverCard();
    await openRecord(plugin, record);
  });

  let primaryAction = noteButton;
  if (isBookIntroRecord(record)) {
    actions.classList.add("has-book-intro");
    noteButton.classList.remove("is-primary");
    const introButton = makeBookHoverElement(
      ownerDocument,
      "button",
      "bookshelf-hover-card__button is-primary is-book-intro",
      "动态策展"
    );
    introButton.type = "button";
    introButton.addEventListener("click", async () => {
      hideBookHoverCard();
      await plugin.openBookIntro(record.file.path, {
        targetLeaf: plugin.app.workspace.getLeaf(false)
      });
    });
    actions.appendChild(introButton);
    primaryAction = introButton;
  }
  actions.appendChild(noteButton);

  const pdfButton = makeBookHoverElement(ownerDocument, "button", "bookshelf-hover-card__button", "用预览打开 PDF");
  pdfButton.type = "button";
  if (!data.pdfAvailable) {
    pdfButton.disabled = true;
    pdfButton.title = data.pdfPath ? "PDF 路径已经失效" : "笔记中没有 PDF 路径";
  } else {
    pdfButton.addEventListener("click", () => openBookPdf(data.pdfPath));
  }
  actions.appendChild(pdfButton);
  card.appendChild(actions);
  card.bookHoverPrimaryAction = primaryAction;

  card.addEventListener("pointerenter", clearBookHoverHideTimer);
  card.addEventListener("pointerleave", scheduleBookHoverHide);
  card.addEventListener("focusin", clearBookHoverHideTimer);
  card.addEventListener("focusout", (event) => {
    if (!card.contains?.(event.relatedTarget)) scheduleBookHoverHide({ ignoreFocus: true });
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    hideBookHoverCard({ restoreFocus: true });
  });
  return card;
}

function positionBookHoverCard(card, cover) {
  const anchor = cover.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const ownerWindow = cover.ownerDocument?.defaultView || window;
  const viewportWidth = ownerWindow.innerWidth;
  const viewportHeight = ownerWindow.innerHeight;
  let left = anchor.right + BOOK_HOVER_CARD_GAP_PX;
  if (left + cardRect.width > viewportWidth - BOOK_HOVER_VIEWPORT_MARGIN_PX) {
    left = anchor.left - cardRect.width - BOOK_HOVER_CARD_GAP_PX;
  }
  left = clampBookHover(
    left,
    BOOK_HOVER_VIEWPORT_MARGIN_PX,
    viewportWidth - cardRect.width - BOOK_HOVER_VIEWPORT_MARGIN_PX
  );
  const preferredTop = anchor.top + anchor.height / 2 - cardRect.height / 2;
  const top = clampBookHover(
    preferredTop,
    BOOK_HOVER_VIEWPORT_MARGIN_PX,
    viewportHeight - cardRect.height - BOOK_HOVER_VIEWPORT_MARGIN_PX
  );
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

async function showBookHoverCard(plugin, cover, record, options = {}) {
  const token = ++bookHoverState.renderToken;
  const focusTrigger = options.focusFirstAction ? bookHoverState.focusIntentTrigger : null;
  removeBookHoverCard();
  const data = await collectBookHoverData(plugin, record);
  if (token !== bookHoverState.renderToken || bookHoverState.activeCover !== cover || !cover.isConnected) return;
  if (options.focusFirstAction && (
    !focusTrigger
    || bookHoverState.focusIntentTrigger !== focusTrigger
    || focusTrigger.ownerDocument?.activeElement !== focusTrigger
  )) {
    hideBookHoverCard();
    return;
  }
  const ownerDocument = cover.ownerDocument || document;
  const ownerWindow = ownerDocument.defaultView || window;
  const card = buildBookHoverCard(plugin, record, data, ownerDocument);
  ownerDocument.body.appendChild(card);
  bookHoverState.activeCard = card;
  const trigger = bookHoverState.activeTrigger || cover.parentElement || cover.parentNode;
  card.bookHoverTrigger = trigger;
  trigger?.setAttribute("aria-expanded", "true");
  trigger?.setAttribute("aria-controls", card.id);
  positionBookHoverCard(card, cover);
  ownerWindow.requestAnimationFrame(() => {
    if (bookHoverState.activeCard !== card) return;
    card.classList.add("is-visible");
    if (options.focusFirstAction) {
      if (focusTrigger.ownerDocument?.activeElement !== focusTrigger) {
        hideBookHoverCard();
        return;
      }
      card.bookHoverPrimaryAction?.focus?.({ preventScroll: true });
      bookHoverState.focusIntentTrigger = null;
    }
  });
}

function attachBookHoverCard(plugin, cover, record, trigger = cover?.parentElement || cover?.parentNode) {
  if (!cover || !record?.file || cover.dataset.bookHoverReady === "true") return;
  cover.dataset.bookHoverReady = "true";
  cover.dataset.bookPath = record.file.path;
  cover.setAttribute("aria-label", `打开${record.title}，悬停查看书籍信息`);
  trigger?.setAttribute("aria-haspopup", "dialog");
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.setAttribute("aria-label", `打开${record.title}；悬停书封或按向下箭头查看书籍信息`);
  cover.addEventListener("pointerenter", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    bookHoverState.activeCover = cover;
    bookHoverState.activeTrigger = trigger;
    bookHoverState.focusIntentTrigger = null;
    syncBookHoverAutoScroll();
    clearBookHoverShowTimer();
    clearBookHoverHideTimer();
    const ownerWindow = cover.ownerDocument?.defaultView || window;
    bookHoverState.showWindow = ownerWindow;
    bookHoverState.showTimer = ownerWindow.setTimeout(() => {
      bookHoverState.showTimer = 0;
      bookHoverState.showWindow = null;
      void showBookHoverCard(plugin, cover, record);
    }, BOOK_HOVER_SHOW_DELAY_MS);
  });
  cover.addEventListener("pointerleave", scheduleBookHoverHide);
  trigger?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && bookHoverState.activeTrigger === trigger) {
      event.preventDefault();
      event.stopPropagation();
      hideBookHoverCard({ restoreFocus: true });
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    clearBookHoverShowTimer();
    clearBookHoverHideTimer();
    bookHoverState.activeCover = cover;
    bookHoverState.activeTrigger = trigger;
    bookHoverState.focusIntentTrigger = trigger;
    syncBookHoverAutoScroll();
    void showBookHoverCard(plugin, cover, record, { focusFirstAction: true });
  });
  trigger?.addEventListener("focusout", () => {
    if (bookHoverState.focusIntentTrigger === trigger && !bookHoverState.activeCard) hideBookHoverCard();
  });
}

function makePatternCard(plugin, record, onOpen) {
  const button = makeButton("mengcang-pattern-card mengcang-record-card", "", `打开${record.title}`);
  if (record.isAtlas) button.classList.add("is-atlas");
  button.mengcangSearch = record.searchText;
  const cover = addCover(button, record, "pattern");
  const title = makeElement("span", "mengcang-record-card__title", record.title);
  const provenance = provenanceLabel(record.provenance);
  if (provenance) cover.appendChild(makeElement("span", "mengcang-card-cover__provenance", provenance));
  const meta = record.isAtlas
    ? [record.family || "专题图鉴", record.itemCount ? `${record.itemCount} 项` : "", record.period, provenance].filter(Boolean).join(" · ")
    : [record.form || record.family || "纹样资料", record.period, provenance].filter(Boolean).join(" · ");
  button.append(title, makeElement("span", "mengcang-record-card__meta", meta));
  button.addEventListener("click", (event) => {
    if (onOpen) onOpen(record, event);
    else openRecord(plugin, record, event);
  });
  return button;
}

function makeBookCard(plugin, record, onOpen) {
  const button = makeButton("mengcang-book-card mengcang-record-card", "", `打开${record.title}`);
  button.mengcangSearch = `${record.searchText} ${record.collection}`.toLocaleLowerCase("zh-CN");
  const cover = addCover(button, record, "book");
  attachBookHoverCard(plugin, cover, record);
  const author = record.author || "作者未录入";
  const status = statusLabel(record.readingStatus, "book");
  const volume = record.volume && record.volumeTotal ? ` · 第 ${record.volume}/${record.volumeTotal} 册` : "";
  button.append(
    makeElement("span", "mengcang-record-card__title", record.title),
    makeElement("span", "mengcang-record-card__meta", `${author}${volume}`),
    makeElement("span", "mengcang-book-card__status", status)
  );
  button.addEventListener("click", (event) => {
    hideBookHoverCard();
    if (onOpen) onOpen(record, event);
    else openRecord(plugin, record, event);
  });
  return button;
}

function canvasContentSubpath(record) {
  const headings = valueToText(record?.body)
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => ({
      depth: match[1].length,
      text: match[2].replace(/\s+#+\s*$/, "").trim()
    }))
    .filter((heading) => heading.text);
  const preferred = headings.find((heading) => heading.depth >= 2 && /^(?:原始灵感|正文|内容|观点|摘录)/.test(heading.text));
  const firstSection = headings.find((heading) => heading.depth >= 2);
  const heading = preferred || firstSection || headings[0];
  return heading ? `#${heading.text}` : "";
}

function canvasInstances(plugin) {
  const workspace = plugin?.app?.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") return [];
  return workspace.getLeavesOfType("canvas")
    .map((leaf) => leaf?.view?.canvas)
    .filter((canvas) => canvas?.nodes && typeof canvas.nodes.values === "function");
}

function snapshotCanvasNodes(plugin) {
  const snapshot = new Map();
  for (const canvas of canvasInstances(plugin)) {
    snapshot.set(canvas, new Set(canvas.nodes.values()));
  }
  return snapshot;
}

function focusNewCanvasFileNode(plugin, record, snapshot) {
  const subpath = canvasContentSubpath(record);
  if (!subpath || !(record?.file instanceof TFile) || !(snapshot instanceof Map)) return 0;
  let focused = 0;
  for (const canvas of canvasInstances(plugin)) {
    const priorNodes = snapshot.get(canvas);
    if (!priorNodes) continue;
    for (const node of canvas.nodes.values()) {
      if (priorNodes.has(node)) continue;
      const sameFile = node?.file === record.file || node?.filePath === record.file.path;
      if (!sameFile) continue;
      if (typeof node.setFilePath === "function") {
        node.setFilePath(record.file.path, subpath);
      } else if (typeof node.setFile === "function") {
        node.setFile(record.file, subpath, true);
        if (typeof node.unloadChild === "function") node.unloadChild();
        if (typeof canvas.markDirty === "function") canvas.markDirty(node);
      } else {
        continue;
      }
      if (typeof canvas.requestSave === "function") canvas.requestSave();
      focused += 1;
    }
  }
  return focused;
}

function attachCanvasFileDrag(plugin, element, record) {
  if (record?.isDemo || !(record?.file instanceof TFile)) return false;
  const dragManager = plugin?.app?.dragManager;
  if (!dragManager || typeof dragManager.handleDrag !== "function" || typeof dragManager.dragFile !== "function") {
    return false;
  }

  let canvasSnapshot = new Map();
  dragManager.handleDrag(element, (event) => {
    canvasSnapshot = snapshotCanvasNodes(plugin);
    if (typeof dragManager.updateSource === "function") {
      dragManager.updateSource([element], "is-being-dragged");
    }
    return dragManager.dragFile(event, record.file, "mengcang-dashboard");
  });
  element.addEventListener("dragend", () => {
    const snapshot = canvasSnapshot;
    canvasSnapshot = new Map();
    window.setTimeout(() => focusNewCanvasFileNode(plugin, record, snapshot), 0);
  });
  element.classList.add("is-canvas-draggable");
  element.setAttribute("title", `拖到 Obsidian 白板并显示正文：${record.title}`);
  element.setAttribute("aria-label", `在阅读台查看${record.title}；也可拖到 Obsidian 白板并优先显示正文`);
  return true;
}

function makeTextCard(plugin, record, onOpen, projects = []) {
  const button = makeButton("mengcang-text-card mengcang-record-card", "", `在阅读台查看${record.title}`);
  if (record.isDemo) button.classList.add("is-demo");
  button.mengcangSearch = record.searchText;
  const inboxInspiration = isInboxInspirationRecord(record);
  const topline = makeElement("span", "mengcang-text-card__topline");
  const typeLabel = inboxInspiration
    ? "灵感 · 待整理"
    : `${record.materialKind || record.sourceName || "文本"} · ${statusLabel(record.status, "text")}`;
  topline.appendChild(makeElement("span", "", typeLabel));
  if (record.isDemo) topline.appendChild(makeElement("span", "mengcang-text-card__demo", "示例"));
  const canvasDraggable = attachCanvasFileDrag(plugin, button, record);
  if (canvasDraggable) topline.appendChild(makeElement("span", "mengcang-text-card__drag-hint", "拖到白板"));

  const tags = valueToList(record.tags).slice(0, 2);
  const footer = makeElement("span", "mengcang-text-card__footer");
  footer.append(
    makeElement("span", "", tags.length ? tags.map((tag) => `#${tag}`).join(" ") : record.sourceName || "待整理"),
    makeElement("span", "", shortDate(record.capturedAt))
  );
  button.append(
    topline,
    makeElement("span", "mengcang-text-card__title", record.title),
    makeElement("span", "mengcang-text-card__summary", record.bodyText || record.summary || "尚未填写正文或摘要。"),
    makeElement("span", "mengcang-text-card__topic", inboxInspiration ? projectLabel(record, projects) : record.theme || "未分类"),
    footer
  );
  button.addEventListener("click", (event) => {
    if (onOpen) onOpen(record, event);
    else if (!record.isDemo) openRecord(plugin, record, event);
  });
  return button;
}

function makeWebCard(plugin, record, onOpen, selected) {
  const button = makeButton("mengcang-web-card mengcang-record-card", "", `查看网页剪报：${record.title}`);
  button.mengcangSearch = record.searchText;
  if (selected !== undefined) button.setAttribute("aria-pressed", selected ? "true" : "false");
  if (selected) button.classList.add("is-selected");
  const visual = makeElement("span", "mengcang-web-card__visual");
  if (record.cover) {
    const image = makeElement("img", "mengcang-web-card__image");
    if (record.coverFit === "contain") image.classList.add("is-contain");
    image.alt = "";
    image.loading = "lazy";
    image.src = record.cover;
    image.addEventListener("error", () => image.remove());
    visual.appendChild(image);
  }
  const source = makeElement("span", "mengcang-web-card__source");
  source.appendChild(makeElement("span", "", record.sourceName || record.sourceHost || "网页剪报"));
  if (record.isExample) source.appendChild(makeElement("span", "mengcang-web-card__example", "示例"));
  button.append(
    visual,
    source,
    makeElement("span", "mengcang-web-card__title", record.title),
    makeElement("span", "mengcang-web-card__date", record.award || record.capturedAt || "日期未录入")
  );
  button.addEventListener("click", (event) => {
    if (onOpen) onOpen(record, event);
    else openRecord(plugin, record, event);
  });
  return button;
}

function startAutoScroll(scroller) {
  const ownerWindow = scroller.ownerDocument?.defaultView || window;
  const reduceMotion = ownerWindow.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let last = 0;
  let direction = 1;
  let paused = false;
  let visible = true;
  let overflowing = false;
  let touchPauseUntil = 0;
  let touchTimer = 0;
  let measureFrame = 0;

  const shouldRun = () => (
    !reduceMotion.matches
    && visible
    && overflowing
    && !paused
    && performance.now() >= touchPauseUntil
    && (!bookHoverState.activeCover || !scroller.contains(bookHoverState.activeCover))
  );
  const sync = () => {
    if (shouldRun() && !frame) frame = ownerWindow.requestAnimationFrame(tick);
    if (!shouldRun() && frame) {
      ownerWindow.cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }
  };
  const updateOverflow = () => {
    overflowing = scroller.scrollWidth - scroller.clientWidth > 6;
    sync();
  };
  const pause = () => { paused = true; sync(); };
  const resume = () => { paused = false; last = 0; sync(); };
  bookHoverAutoScrollSyncs.add(sync);
  const pauseTouch = () => {
    touchPauseUntil = performance.now() + 4500;
    sync();
    if (touchTimer) ownerWindow.clearTimeout(touchTimer);
    touchTimer = ownerWindow.setTimeout(() => {
      touchTimer = 0;
      sync();
    }, 4550);
  };
  const tick = (now) => {
    frame = 0;
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    overflowing = max > 6;
    if (shouldRun()) {
      if (last) {
        scroller.scrollLeft += direction * Math.min(0.55, (now - last) * 0.018);
        if (scroller.scrollLeft >= max - 1) direction = -1;
        else if (scroller.scrollLeft <= 1) direction = 1;
      }
      last = now;
    } else {
      last = 0;
    }
    sync();
  };

  const ResizeObserverClass = ownerWindow.ResizeObserver
    || (typeof ResizeObserver === "function" ? ResizeObserver : null);
  const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(updateOverflow) : null;
  resizeObserver?.observe(scroller);
  if (scroller.firstElementChild) resizeObserver?.observe(scroller.firstElementChild);
  const IntersectionObserverClass = ownerWindow.IntersectionObserver
    || (typeof IntersectionObserver === "function" ? IntersectionObserver : null);
  const intersectionObserver = IntersectionObserverClass
    ? new IntersectionObserverClass((entries) => {
      visible = Boolean(entries[0]?.isIntersecting);
      sync();
    }, { threshold: 0.01 })
    : null;
  intersectionObserver?.observe(scroller);
  const motionChanged = () => sync();
  reduceMotion.addEventListener?.("change", motionChanged);

  scroller.addEventListener("pointerenter", pause);
  scroller.addEventListener("pointerleave", resume);
  scroller.addEventListener("focusin", pause);
  scroller.addEventListener("focusout", resume);
  scroller.addEventListener("pointerdown", pauseTouch, { passive: true });
  measureFrame = ownerWindow.requestAnimationFrame(() => {
    measureFrame = 0;
    updateOverflow();
  });

  return () => {
    bookHoverAutoScrollSyncs.delete(sync);
    if (frame) ownerWindow.cancelAnimationFrame(frame);
    if (measureFrame) ownerWindow.cancelAnimationFrame(measureFrame);
    if (touchTimer) ownerWindow.clearTimeout(touchTimer);
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    reduceMotion.removeEventListener?.("change", motionChanged);
    scroller.removeEventListener("pointerenter", pause);
    scroller.removeEventListener("pointerleave", resume);
    scroller.removeEventListener("focusin", pause);
    scroller.removeEventListener("focusout", resume);
    scroller.removeEventListener("pointerdown", pauseTouch);
  };
}

function makeSection(plugin, title, items, cardFactory, emptyText, sectionId, autoScrollCleanups) {
  const section = makeElement("section", "mengcang-section");
  section.id = sectionId;
  section.appendChild(makeElement("h2", "mengcang-section__title", title));
  const scroller = makeElement("div", "mengcang-section__scroller");
  scroller.dataset.mengcangSection = sectionId;
  const track = makeElement("div", "mengcang-section__track");
  scroller.appendChild(track);
  section.appendChild(scroller);

  if (!items.length) {
    track.appendChild(makeElement("div", "mengcang-section__empty", emptyText));
    return section;
  }

  for (const item of items) track.appendChild(cardFactory(plugin, item));
  const filterEmpty = makeElement("div", "mengcang-section__empty mengcang-section__filter-empty", "没有匹配当前搜索的内容。");
  filterEmpty.hidden = true;
  track.appendChild(filterEmpty);
  scroller.classList.add("mengcang-section__scroller--auto");
  return section;
}

function makeWoodFrame(title, className = "") {
  const section = makeElement("section", `mengcang-section mengcang-library-section ${className}`.trim());
  section.appendChild(makeElement("h2", "mengcang-section__title", title));
  const frame = makeElement("div", "mengcang-wood-frame");
  const inner = makeElement("div", "mengcang-wood-frame__inner");
  frame.append(inner, makeElement("span", "mengcang-wood-frame__rail"));
  section.appendChild(frame);
  return { section, inner };
}

function addGridContents(inner, items, cardFactory, emptyText, scrollKey = "") {
  const grid = makeElement("div", "mengcang-library-grid");
  if (scrollKey) grid.dataset.mengcangSection = scrollKey;
  inner.appendChild(grid);
  if (!items.length) {
    grid.appendChild(makeElement("div", "mengcang-section__empty", emptyText));
    return grid;
  }
  for (const item of items) grid.appendChild(cardFactory(item));
  const filterEmpty = makeElement(
    "div",
    "mengcang-section__empty mengcang-section__filter-empty",
    "没有匹配当前搜索的内容。"
  );
  filterEmpty.hidden = true;
  grid.appendChild(filterEmpty);
  return grid;
}

function makeLacquerButton(text, ariaLabel) {
  return makeButton("mengcang-lacquer-button", text, ariaLabel || text);
}

function makePatternIntro(snapshot, state, atlas) {
  const intro = makeElement("section", "mengcang-pattern-intro");
  const decorativeRecord = snapshot.patterns.find((item) => !item.isAtlas && item.cover) || atlas;
  if (decorativeRecord?.cover) {
    const image = makeElement("img", "mengcang-pattern-intro__image");
    image.alt = "";
    image.src = decorativeRecord.cover;
    image.addEventListener("error", () => image.remove());
    intro.appendChild(image);
  }
  const copy = makeElement("div", "mengcang-pattern-intro__copy");
  copy.append(
    makeElement("span", "mengcang-page-kicker", atlas ? `纹样图鉴 › ${atlas.family || atlas.title}` : "视觉素材仓 · 独立页面"),
    makeElement("h2", "", atlas ? atlas.title : "先收集，再让图案慢慢成册。"),
    makeElement(
      "p",
      "",
      atlas
        ? "这是图鉴下的二级纹样架；点击单个纹样可以先查看详情，再进入对应资料笔记。"
        : "零散截图先放进待归册区；整理后，再合并为大图鉴与二级纹样架。"
    )
  );
  const firstAtlas = snapshot.patterns.find((item) => item.isAtlas);
  const firstAtlasLabel = firstAtlas?.family || firstAtlas?.title.replace(/图鉴$/, "") || "专题纹样";
  const action = makeLacquerButton(atlas ? "返回图鉴总架" : `进入${firstAtlasLabel}图鉴`);
  action.addEventListener("click", () => {
    if (atlas) {
      state.atlasPath = "";
      state.selectedPatternPath = "";
    } else {
      if (!firstAtlas) {
        new Notice("尚未收录可打开的纹样图鉴。");
        return;
      }
      state.atlasPath = firstAtlas.file.path;
      state.selectedPatternPath = "";
    }
    state.requestRender({ top: true });
  });
  intro.append(copy, action);
  return intro;
}

function makePatternDetail(plugin, record, loose = false) {
  if (!record) return null;
  const detail = makeElement("article", "mengcang-pattern-detail");
  detail.setAttribute("aria-live", "polite");
  const visual = makeElement("div", "mengcang-pattern-detail__image");
  if (record.cover) {
    const image = makeElement("img", "");
    image.alt = record.title;
    image.src = record.cover;
    image.addEventListener("error", () => image.remove());
    visual.appendChild(image);
  } else {
    visual.appendChild(makeElement("span", "mengcang-pattern-detail__fallback", record.title));
  }
  const copy = makeElement("div", "mengcang-pattern-detail__copy");
  copy.append(
    makeElement("span", "mengcang-page-kicker", `${loose ? "待归册纹样" : `${record.family || "纹样"}资料页`} · ${record.form || "形式待录入"}`),
    makeElement("h3", "", record.title),
    makeElement("p", "", record.summary || "尚未填写内容摘要。")
  );
  const fields = [
    ["形式", record.form || "待录入"],
    ["时期", record.period || "未考证"],
    ["应用", record.usage || "待整理"],
    ["来源状态", provenanceLabel(record.provenance) || "待考证"]
  ];
  const list = makeElement("dl", "");
  for (const [label, value] of fields) {
    const row = makeElement("div", "");
    row.append(makeElement("dt", "", label), makeElement("dd", "", value));
    list.appendChild(row);
  }
  copy.appendChild(list);
  copy.appendChild(makeElement("div", "mengcang-pattern-detail__boundary", "当前仅作个人整理与内部原型；不代表已确认的历史藏品。"));
  const openButton = makeLacquerButton("打开资料笔记", `打开${record.title}资料笔记`);
  openButton.addEventListener("click", (event) => openRecord(plugin, record, event));
  copy.appendChild(openButton);
  detail.append(visual, copy);
  return detail;
}

function recordMatchesQuery(record, query) {
  const normalized = valueToText(query).toLocaleLowerCase("zh-CN");
  return !normalized || (record.searchText || "").includes(normalized);
}

function homePatternRecords(patterns) {
  return (patterns || []).filter((item) => !item.isAtlas && item.atlasLevel === "item");
}

function renderPatternPage(plugin, snapshot, state) {
  const page = makeElement("div", "mengcang-page-stack mengcang-patterns-page");
  page.appendChild(makeElement("h1", "mengcang-sr-only", "图案收集"));
  const atlases = snapshot.patterns.filter((item) => item.isAtlas);
  const visibleAtlases = atlases.filter((item) => recordMatchesQuery(item, state.query));
  const atlas = atlases.find((item) => item.file.path === state.atlasPath) || null;
  page.appendChild(makePatternIntro(snapshot, state, atlas));

  if (!atlas) {
    const atlasFrame = makeWoodFrame("纹样图鉴总架", "mengcang-pattern-atlas-shelf");
    addGridContents(
      atlasFrame.inner,
      visibleAtlases,
      (record) => makePatternCard(plugin, record, () => {
        state.atlasPath = record.file.path;
        state.selectedPatternPath = "";
        state.requestRender({ top: true });
      }),
      state.query ? "没有符合当前搜索的专题图鉴。" : "当前还没有专题图鉴。",
      "pattern-atlases"
    );
    page.appendChild(atlasFrame.section);

    const loosePatterns = snapshot.patterns.filter((item) => (
      !item.isAtlas && item.atlasLevel !== "item" && recordMatchesQuery(item, state.query)
    ));
    const activeLoose = loosePatterns.find((item) => item.file.path === state.selectedPatternPath) || loosePatterns[0];
    const looseFrame = makeWoodFrame("待归册纹样", "mengcang-pattern-inbox-shelf");
    addGridContents(
      looseFrame.inner,
      loosePatterns,
      (record) => {
        const card = makePatternCard(plugin, record, () => {
          state.selectedPatternPath = record.file.path;
          state.requestRender({ detail: true });
        });
        if (record.file.path === activeLoose?.file.path) card.classList.add("is-selected");
        return card;
      },
      state.query
        ? "没有符合当前搜索的待归册纹样。"
        : "目前没有待归册纹样；新捕捉的零散图案会出现在这里。",
      "pattern-inbox"
    );
    page.appendChild(looseFrame.section);
    const detail = makePatternDetail(plugin, activeLoose, true);
    if (detail) page.appendChild(detail);
    return page;
  }

  const targetBase = resolveVaultFile(plugin.app, atlas.targetBase, atlas.file.path);
  const hasValidTarget = isBaseFile(targetBase);
  const targetDirectory = hasValidTarget ? targetBase.parent?.path || "" : "";
  const nestedPatterns = hasValidTarget ? snapshot.patterns.filter((item) => (
    !item.isAtlas
    && item.atlasLevel === "item"
    && item.family === atlas.family
    && item.file.parent?.path === targetDirectory
    && recordMatchesQuery(item, state.query)
  )) : [];
  const activePattern = nestedPatterns.find((item) => item.file.path === state.selectedPatternPath) || nestedPatterns[0];
  const nestedFrame = makeWoodFrame(`${atlas.family || atlas.title}样架`, "mengcang-pattern-nested-shelf");
  addGridContents(
    nestedFrame.inner,
    nestedPatterns,
    (record) => {
      const card = makePatternCard(plugin, record, () => {
        state.selectedPatternPath = record.file.path;
        state.requestRender({ detail: true });
      });
      if (record.file.path === activePattern?.file.path) card.classList.add("is-selected");
      return card;
    },
    !hasValidTarget
      ? "当前图鉴尚未连接有效的 Base 数据源。"
      : state.query
        ? "没有符合当前搜索的图鉴条目。"
        : "当前图鉴尚未收录具体纹样。",
    `pattern-atlas:${atlas.file.path}`
  );
  page.appendChild(nestedFrame.section);
  const detail = makePatternDetail(plugin, activePattern);
  if (detail) page.appendChild(detail);
  return page;
}

function makeSegmentedControl(options, current, onChange, label) {
  const group = makeElement("div", "mengcang-segmented-control");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const [key, text] of options) {
    const button = makeButton("", text);
    if (key === current) {
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }
    button.addEventListener("click", () => onChange(key));
    group.appendChild(button);
  }
  return group;
}

function renderBooksPage(plugin, snapshot, state) {
  const page = makeElement("div", "mengcang-page-stack mengcang-books-page");
  page.appendChild(makeElement("h1", "mengcang-sr-only", "图书书架"));
  const toolbar = makeElement("section", "mengcang-books-toolbar");
  const copy = makeElement("div", "");
  copy.append(
    makeElement("span", "mengcang-page-kicker", "Obsidian · 同一份书籍笔记"),
    makeElement("h2", "", "从书架继续阅读")
  );
  const filters = [
    ["all", "全部"],
    ["want-to-read", "想读"],
    ["reading", "在读"],
    ["read", "已读"],
    ["paused", "暂停"]
  ];
  toolbar.append(copy, makeSegmentedControl(filters, state.bookStatus, (nextStatus) => {
    state.bookStatus = nextStatus;
    state.requestRender({ top: true });
  }, "筛选阅读状态"));
  page.appendChild(toolbar);

  const visibleBooks = snapshot.books.filter((item) => (
    (state.bookStatus === "all" || item.readingStatus === state.bookStatus)
    && recordMatchesQuery(item, state.query)
  ));
  const frame = makeWoodFrame("图书书架", "mengcang-book-library-shelf");
  addGridContents(
    frame.inner,
    visibleBooks,
    (record) => makeBookCard(plugin, record, () => {
      void state.openBookGraph(record);
    }),
    state.query ? "没有符合当前搜索和阅读状态的书籍。" : "没有符合当前阅读状态的书籍。",
    "book-library"
  );
  page.appendChild(frame.section);
  return page;
}

function bookGraphDirectionLabel(node) {
  if (node.isCenter) return "当前书籍";
  if (!node.isLocal || node.direction === "vault") return "Vault 背景节点";
  if (node.direction === "mutual") return "双向链接";
  if (node.direction === "incoming") return "链入本书";
  if (node.direction === "outgoing") return "本书链出";
  return `第 ${node.distance} 跳上下文`;
}

function bookGraphPathHash(path) {
  let hash = 2166136261;
  for (const char of String(path || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mountBookGraphScene(plugin, scene, detail, graph, query, controls) {
  const ownerDocument = scene.ownerDocument || document;
  const ownerWindow = ownerDocument.defaultView || window;
  const namespace = "http://www.w3.org/2000/svg";
  const width = 1200;
  const height = 720;
  const svg = ownerDocument.createElementNS(namespace, "svg");
  svg.setAttribute("class", "mengcang-book-graph__svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Obsidian 全库节点网络，当前书籍及局部关系已高亮；单击节点查看，双击打开笔记");
  const viewport = ownerDocument.createElementNS(namespace, "g");
  viewport.setAttribute("class", "mengcang-book-graph__viewport");
  svg.appendChild(viewport);
  scene.appendChild(svg);

  const nodes = graph.nodes.map((node) => ({ ...node, x: width / 2, y: height / 2, vx: 0, vy: 0 }));
  const nodeByPath = new Map(nodes.map((node) => [node.path, node]));
  const layers = new Map();
  for (const node of nodes) {
    if (!node.isLocal) {
      const hash = bookGraphPathHash(node.path);
      const secondary = bookGraphPathHash(`${node.path}:y`);
      node.x = 55 + (hash % 1090);
      node.y = 48 + (secondary % 624);
      continue;
    }
    if (!layers.has(node.distance)) layers.set(node.distance, []);
    layers.get(node.distance).push(node);
  }
  for (const [distance, layer] of layers) {
    if (distance === 0) continue;
      const radius = distance === 1 ? 150 : 270;
    layer.forEach((node, index) => {
      const jitter = (bookGraphPathHash(node.path) % 31) - 15;
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / layer.length + distance * 0.17;
      node.x = width / 2 + Math.cos(angle) * (radius + jitter);
      node.y = height / 2 + Math.sin(angle) * (radius * 0.72 + jitter * 0.45);
    });
  }

  const lineElements = [];
  for (const edge of graph.edges) {
    const line = ownerDocument.createElementNS(namespace, "line");
    line.setAttribute("class", `mengcang-book-graph__edge${edge.isLocal ? " is-local" : " is-vault-context"}${edge.mutual ? " is-mutual" : ""}`);
    line.style.setProperty("--book-edge-weight", String(Math.min(4, Math.max(1, edge.strength || 1))));
    viewport.appendChild(line);
    lineElements.push({ edge, line });
  }

  const normalizedQuery = valueToText(query).toLocaleLowerCase("zh-CN");
  const nodeElements = new Map();
  let selectedPath = graph.nodes.find((node) => node.isCenter)?.path || "";

  const renderDetail = (node) => {
    detail.replaceChildren();
    detail.hidden = false;
    detail.append(
      makeElement("span", "mengcang-book-graph__detail-kicker", bookGraphDirectionLabel(node)),
      makeElement("strong", "", node.title),
      makeElement("span", "", `${node.degree} 个 Vault 相邻节点${node.isLocal ? ` · 距当前书 ${node.distance} 跳` : ""}`)
    );
    if (node.file instanceof TFile) {
      const open = makeButton("", "打开笔记", `打开${node.title}笔记`);
      open.addEventListener("click", (event) => openRecord(plugin, { file: node.file, title: node.title }, event));
      detail.appendChild(open);
    }
  };

  for (const node of nodes) {
    const group = ownerDocument.createElementNS(namespace, "g");
    const matchesSearch = !normalizedQuery
      || `${node.title} ${node.path}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
    group.setAttribute(
      "class",
      `mengcang-book-graph__node${node.isLocal ? ` is-local is-distance-${node.distance}` : " is-vault-context"}${node.isCenter ? " is-center" : ""}${matchesSearch ? "" : " is-dimmed"}`
    );
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `${node.title}，${bookGraphDirectionLabel(node)}`);
    const circle = ownerDocument.createElementNS(namespace, "circle");
    circle.setAttribute("r", String(
      node.isCenter
        ? 14
        : node.isLocal && node.distance === 1
          ? Math.min(10, 5.8 + node.degree * 0.45)
          : node.isLocal
            ? Math.min(7, 4.2 + node.degree * 0.22)
            : Math.min(6.5, 3.1 + node.degree * 0.22)
    ));
    const label = ownerDocument.createElementNS(namespace, "text");
    label.setAttribute("class", "mengcang-book-graph__node-label");
    label.setAttribute("y", node.isCenter ? "-22" : "-14");
    label.textContent = node.title;
    group.append(circle, label);
    const select = () => {
      selectedPath = node.path;
      for (const [path, element] of nodeElements) element.classList.toggle("is-selected", path === selectedPath);
      renderDetail(node);
    };
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    group.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (node.file instanceof TFile) void openRecord(plugin, { file: node.file, title: node.title }, event);
    });
    viewport.appendChild(group);
    nodeElements.set(node.path, group);
  }

  const centerNode = nodes.find((node) => node.isCenter);
  if (centerNode) {
    nodeElements.get(centerNode.path)?.classList.add("is-selected");
    renderDetail(centerNode);
  }

  let transform = { x: 0, y: 0, scale: 1 };
  const applyTransform = () => {
    viewport.setAttribute("transform", `translate(${transform.x} ${transform.y}) scale(${transform.scale})`);
  };
  const setZoom = (nextScale) => {
    transform.scale = clampBookHover(nextScale, 0.55, 2.5);
    applyTransform();
  };
  controls.zoomIn.addEventListener("click", () => setZoom(transform.scale * 1.2));
  controls.zoomOut.addEventListener("click", () => setZoom(transform.scale / 1.2));
  controls.reset.addEventListener("click", () => {
    transform = { x: 0, y: 0, scale: 1 };
    applyTransform();
  });
  const onWheel = (event) => {
    event.preventDefault();
    setZoom(transform.scale * (event.deltaY > 0 ? 0.9 : 1.1));
  };
  svg.addEventListener("wheel", onWheel, { passive: false });

  let drag = null;
  const onPointerDown = (event) => {
    if (event.target.closest?.(".mengcang-book-graph__node")) return;
    drag = { x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y };
    svg.setPointerCapture?.(event.pointerId);
    svg.classList.add("is-panning");
  };
  const onPointerMove = (event) => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    transform.x = drag.originX + (event.clientX - drag.x) * width / rect.width;
    transform.y = drag.originY + (event.clientY - drag.y) * height / rect.height;
    applyTransform();
  };
  const stopPan = () => {
    drag = null;
    svg.classList.remove("is-panning");
  };
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", stopPan);
  svg.addEventListener("pointercancel", stopPan);

  const updatePositions = () => {
    for (const { edge, line } of lineElements) {
      const source = nodeByPath.get(edge.source);
      const target = nodeByPath.get(edge.target);
      if (!source || !target) continue;
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
    }
    for (const node of nodes) nodeElements.get(node.path)?.setAttribute("transform", `translate(${node.x} ${node.y})`);
  };

  let frame = 0;
  let iteration = 0;
  const simulate = () => {
    iteration += 1;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1) {
          dx = ((bookGraphPathHash(left.path) % 11) - 5) || 1;
          dy = ((bookGraphPathHash(right.path) % 11) - 5) || -1;
          distanceSquared = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSquared);
        const sameScope = left.isLocal === right.isLocal;
        const force = (sameScope ? 2500 : 1700) / Math.max(180, distanceSquared);
        const fx = dx / distance * force;
        const fy = dy / distance * force;
        if (!left.isCenter) { left.vx -= fx; left.vy -= fy; }
        if (!right.isCenter) { right.vx += fx; right.vy += fy; }
      }
    }
    for (const edge of graph.edges) {
      const source = nodeByPath.get(edge.source);
      const target = nodeByPath.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = edge.isLocal
        ? (source.isCenter || target.isCenter ? 132 : 92)
        : 72;
      const force = (distance - desired) * (edge.isLocal ? 0.0062 : 0.0038);
      const fx = dx / distance * force;
      const fy = dy / distance * force;
      if (!source.isCenter) { source.vx += fx; source.vy += fy; }
      if (!target.isCenter) { target.vx -= fx; target.vy -= fy; }
    }
    for (const node of nodes) {
      if (node.isCenter) {
        node.x = width / 2;
        node.y = height / 2;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx += (width / 2 - node.x) * (node.isLocal ? 0.00045 : 0.00008);
      node.vy += (height / 2 - node.y) * (node.isLocal ? 0.00045 : 0.00008);
      node.vx *= node.isLocal ? 0.86 : 0.89;
      node.vy *= node.isLocal ? 0.86 : 0.89;
      node.x = clampBookHover(node.x + node.vx, 36, width - 36);
      node.y = clampBookHover(node.y + node.vy, 36, height - 36);
    }
    updatePositions();
    if (iteration < 120) frame = ownerWindow.requestAnimationFrame(simulate);
  };
  updatePositions();
  if (!ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    frame = ownerWindow.requestAnimationFrame(simulate);
  }

  return () => {
    if (frame) ownerWindow.cancelAnimationFrame(frame);
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", stopPan);
    svg.removeEventListener("pointercancel", stopPan);
  };
}

function renderBookGraphPage(plugin, snapshot, state, cleanups) {
  const page = makeElement("div", "mengcang-book-graph");
  const book = snapshot.books.find((record) => record.file.path === state.selectedBookPath) || null;
  if (!book) {
    const missing = makeElement("section", "mengcang-book-graph__missing");
    missing.append(
      makeElement("h2", "", "没有找到这本书"),
      makeElement("p", "", "请返回书架重新选择一本书。")
    );
    const back = makeLacquerButton("返回图书书架");
    back.addEventListener("click", () => state.navigate("books"));
    missing.appendChild(back);
    page.appendChild(missing);
    return page;
  }

  const graph = collectBookGraphData(plugin, book, state.bookGraphDepth);
  const header = makeElement("header", "mengcang-book-graph__header");
  const back = makeButton("mengcang-book-graph__back", "← 返回书架", "返回图书书架");
  back.addEventListener("click", () => state.navigate("books"));
  const title = makeElement("div", "mengcang-book-graph__heading");
  title.append(
    makeElement("span", "mengcang-page-kicker", "Obsidian Vault 真实内部链接"),
    makeElement("h1", "", `${book.title} · 节点网络`),
    makeElement("p", "", `${graph.directNeighborCount} 个直接节点 · ${graph.nodes.length - graph.vaultContextNodeCount} 个局部节点 · ${graph.vaultContextNodeCount} 个全库背景节点 · ${graph.edges.length} 条关系`)
  );
  const depthControl = makeSegmentedControl([
    [1, "1 跳"],
    [2, "2 跳"]
  ], state.bookGraphDepth, (nextDepth) => {
    state.bookGraphDepth = Number(nextDepth);
    state.requestRender({ top: true });
  }, "设置局部图深度");
  header.append(back, title, depthControl);
  page.appendChild(header);

  const shell = makeElement("section", "mengcang-book-graph__shell");
  const controls = makeElement("div", "mengcang-book-graph__controls");
  const zoomOut = makeButton("", "−", "缩小局部图");
  const reset = makeButton("", "居中", "将局部图恢复到居中比例");
  const zoomIn = makeButton("", "+", "放大局部图");
  controls.append(zoomOut, reset, zoomIn);
  shell.appendChild(controls);
  const scene = makeElement("div", "mengcang-book-graph__scene");
  shell.appendChild(scene);
  const detail = makeElement("aside", "mengcang-book-graph__detail");
  shell.appendChild(detail);
  if (!graph.directNeighborCount) {
    shell.appendChild(makeElement("div", "mengcang-book-graph__empty", "这本书目前没有 Markdown 内部链接；浅色节点仍显示 Vault 的全库网络背景。"));
  }
  page.appendChild(shell);
  cleanups.push(mountBookGraphScene(plugin, scene, detail, graph, state.query, {
    zoomIn,
    zoomOut,
    reset
  }));
  return page;
}

function makeExternalLink(text, rawUrl, primary = false) {
  const url = safeWebUrl(rawUrl);
  if (!url) return null;
  const link = makeElement("a", `mengcang-web-action${primary ? " is-primary" : ""}`, text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function makeWebDetail(plugin, record, state) {
  if (!record) return null;
  const detail = makeElement("article", "mengcang-web-detail");
  detail.setAttribute("aria-live", "polite");

  const visual = makeElement("div", "mengcang-web-detail__visual");
  if (record.cover) {
    const image = makeElement("img", "");
    if (record.coverFit === "contain") image.classList.add("is-contain");
    image.alt = `${record.title} 网页预览`;
    image.src = record.cover;
    image.addEventListener("error", () => image.remove());
    visual.appendChild(image);
  } else {
    visual.appendChild(makeElement("span", "mengcang-web-detail__fallback", record.title));
  }

  const copy = makeElement("div", "mengcang-web-detail__copy");
  copy.append(
    makeElement(
      "span",
      "mengcang-page-kicker",
      `${record.isExample ? "示例剪报" : "网页剪报"} · ${record.sourceName || record.sourceHost || "来源待整理"}`
    ),
    makeElement("h2", "", record.title),
    makeElement("p", "mengcang-web-detail__summary", record.summary || "尚未填写网页摘要。")
  );

  const excerptIndex = Math.min(Math.max(0, state?.selectedWebExcerpt || 0), Math.max(0, record.observations.length - 1));
  if (record.observations.length) {
    const excerpt = makeElement("section", "mengcang-web-detail__excerpt");
    excerpt.append(
      makeElement("span", "", "当前摘录"),
      makeElement("p", "", record.observations[excerptIndex])
    );
    const excerptFooter = makeElement("div", "");
    excerptFooter.appendChild(makeElement("span", "", `${record.observations[excerptIndex].length} 字`));
    if (record.observations.length > 1) {
      const switchExcerpt = makeButton("", "切换摘录", "切换当前网页设计摘录");
      switchExcerpt.addEventListener("click", () => {
        state.selectedWebExcerpt = (excerptIndex + 1) % record.observations.length;
        state.requestRender();
      });
      excerptFooter.appendChild(switchExcerpt);
    }
    excerpt.appendChild(excerptFooter);
    copy.appendChild(excerpt);
  }

  const meta = makeElement("dl", "mengcang-web-detail__meta");
  const fields = [
    ["站点", record.sourceHost || "待录入"],
    ["收录", record.award || record.sourceName || "待整理"],
    ["状态", statusLabel(record.status, "web")],
    ["捕捉日期", record.capturedAt || "待录入"]
  ];
  for (const [label, value] of fields) {
    const row = makeElement("div", "");
    row.append(makeElement("dt", "", label), makeElement("dd", "", value));
    meta.appendChild(row);
  }
  copy.appendChild(meta);

  if (record.observations.length) {
    const observations = makeElement("section", "mengcang-web-detail__notes");
    observations.appendChild(makeElement("h3", "", "设计观察"));
    record.observations.forEach((observation, index) => {
      const option = makeButton("mengcang-web-detail__observation", observation, `选择第 ${index + 1} 条设计观察`);
      option.setAttribute("aria-pressed", index === excerptIndex ? "true" : "false");
      if (index === excerptIndex) option.classList.add("is-selected");
      option.addEventListener("click", () => {
        state.selectedWebExcerpt = index;
        state.requestRender();
      });
      observations.appendChild(option);
    });
    copy.appendChild(observations);
  }

  if (record.notes.length) {
    const notes = makeElement("section", "mengcang-web-detail__notes is-quiet");
    notes.appendChild(makeElement("h3", "", "收藏说明"));
    for (const note of record.notes) notes.appendChild(makeElement("p", "", note));
    copy.appendChild(notes);
  }

  copy.appendChild(makeElement(
    "div",
    "mengcang-web-detail__boundary",
    record.isExample
      ? "这是经用户批准加入的界面示例；封面仅用于个人设计研究，版权状态未知，不代表已抓取或保存原网页。"
      : "网页笔记与本地封面来自 Vault；插件保持只读，不执行网页抓取或写入。"
  ));

  const actions = makeElement("div", "mengcang-web-detail__actions");
  const sourceLink = makeExternalLink("打开原网页 ↗", record.sourceUrl, true);
  const referenceLink = makeExternalLink("查看收录来源", record.referenceUrl);
  if (sourceLink) actions.appendChild(sourceLink);
  if (referenceLink) actions.appendChild(referenceLink);
  const openNote = makeLacquerButton("打开 Markdown", `打开${record.title}网页笔记`);
  openNote.addEventListener("click", (event) => openRecord(plugin, record, event));
  actions.appendChild(openNote);
  copy.appendChild(actions);

  detail.append(visual, copy);
  return detail;
}

function webStatusMatches(record, filter) {
  if (filter === "all") return true;
  if (filter === "ready") return ["ready", "active", "organized"].includes(record.status);
  return record.status === filter;
}

function renderWebPage(plugin, snapshot, state) {
  const page = makeElement("div", "mengcang-page-stack mengcang-web-page");
  page.appendChild(makeElement("h1", "mengcang-sr-only", "网页采集"));

  const toolbar = makeElement("section", "mengcang-web-toolbar");
  const copy = makeElement("div", "");
  copy.append(
    makeElement("span", "mengcang-page-kicker", "Obsidian · Markdown 网页档案"),
    makeElement("h2", "", "保存页面，也保存为什么值得看。"),
    makeElement("p", "", "案例墙负责快速浏览；详情区保留设计观察、原站和评选来源。插件只读，Markdown 仍是唯一真源。")
  );
  const toolbarActions = makeElement("div", "mengcang-web-toolbar__actions");
  toolbarActions.appendChild(makeSegmentedControl([
    ["all", "全部"],
    ["inbox", "待归册"],
    ["ready", "已整理"],
    ["used", "已使用"]
  ], state.webStatus, (nextStatus) => {
    state.webStatus = nextStatus;
    state.requestRender({ top: true });
  }, "筛选网页剪报状态"));
  const openBaseButton = makeLacquerButton("打开网页 Base", "打开网页剪报 Base");
  openBaseButton.addEventListener("click", () => openBase(plugin, BASE_PATHS.web));
  toolbarActions.appendChild(openBaseButton);
  toolbar.append(copy, toolbarActions);
  page.appendChild(toolbar);

  const visibleClips = snapshot.webClips.filter((record) => (
    webStatusMatches(record, state.webStatus) && recordMatchesQuery(record, state.query)
  ));
  const activeClip = visibleClips.find((record) => record.file.path === state.selectedWebPath) || visibleClips[0] || null;
  if (state.selectedWebPath !== (activeClip?.file.path || "")) {
    state.selectedWebPath = activeClip?.file.path || "";
    state.selectedWebExcerpt = 0;
  }

  const frame = makeWoodFrame("网页剪报墙", "mengcang-web-library-shelf");
  addGridContents(
    frame.inner,
    visibleClips,
    (record) => makeWebCard(plugin, record, (item) => {
      state.selectedWebPath = item.file.path;
      state.selectedWebExcerpt = 0;
      state.requestRender({ webDetail: true });
    }, record.file.path === activeClip?.file.path),
    state.query ? "没有符合当前搜索和整理状态的网页剪报。" : "当前网页剪报目录为空。",
    "web-library"
  );
  page.appendChild(frame.section);
  const detail = makeWebDetail(plugin, activeClip, state);
  if (detail) page.appendChild(detail);
  return page;
}

function textRecordKey(record) {
  return record.isDemo ? record.demoId : record.file?.path || "";
}

function makeSuggestionButton(text, noticeText) {
  const button = makeButton("mengcang-suggestion-button", text, `${text}（建议态）`);
  button.addEventListener("click", () => new Notice(noticeText));
  return button;
}

function makeTextCardGrid(plugin, records, state, projects, emptyText, gridClass = "") {
  const grid = makeElement("div", `mengcang-text-card-grid ${gridClass}`.trim());
  if (!records.length) {
    grid.appendChild(makeElement("div", "mengcang-section__empty", emptyText));
    return grid;
  }
  for (const record of records) {
    const card = makeTextCard(plugin, record, () => {
      state.selectedTextPath = textRecordKey(record);
      state.requestRender({ textDetail: true });
    }, projects);
    if (textRecordKey(record) === state.selectedTextPath) card.classList.add("is-selected");
    grid.appendChild(card);
  }
  return grid;
}

function makeTextReader(plugin, record, state, projects = []) {
  if (!record) return null;
  const reader = makeElement("article", "mengcang-text-reader");
  reader.setAttribute("aria-live", "polite");
  const heading = makeElement("header", "mengcang-text-reader__heading");
  const headingCopy = makeElement("div", "");
  headingCopy.append(
    makeElement("span", "mengcang-page-kicker", record.isDemo ? "页内阅读台 · UI 示例" : "页内阅读台 · Markdown 只读"),
    makeElement("h2", "", record.title),
    makeElement(
      "p",
      "",
      isInboxInspirationRecord(record)
        ? `灵感 · 待整理 · ${projectLabel(record, projects)}`
        : `${record.theme || "未分类"} · ${record.materialKind || "观点"} · ${statusLabel(record.status, "text")}`
    )
  );
  const close = makeButton("mengcang-text-reader__close", "返回卡片", "关闭页内阅读台");
  close.addEventListener("click", () => {
    state.selectedTextPath = "";
    state.requestRender();
  });
  heading.append(headingCopy, close);

  const body = makeElement(
    "div",
    "mengcang-text-reader__body",
    record.bodyText || record.summary || "这条资料尚未录入正文。"
  );
  const suggestion = makeElement("aside", "mengcang-text-reader__suggestions");
  suggestion.append(
    makeElement("div", "mengcang-text-reader__suggestion-title", "整理建议（只读预览）"),
    makeElement("p", "", "这些控件仅展示后续人机协作流程；本阶段不会修改 frontmatter 或 Markdown 正文。")
  );
  const fields = [
    [isInspirationRecord(record) ? "项目" : "主题", isInspirationRecord(record) ? projectLabel(record, projects) : record.theme || "未分类"],
    ["标签", record.tags || "待建议"],
    ["关联", record.related || "待建议"],
    ["状态", statusLabel(record.status, "text")]
  ];
  const controls = makeElement("div", "mengcang-text-reader__controls");
  for (const [label, value] of fields) {
    const field = makeElement("div", "mengcang-text-reader__field");
    field.append(
      makeElement("span", "mengcang-text-reader__field-label", label),
      makeSuggestionButton(value, `${label}编辑仍处于建议态；未写入 Vault。`)
    );
    controls.appendChild(field);
  }
  suggestion.appendChild(controls);

  const actions = makeElement("div", "mengcang-text-reader__actions");
  actions.appendChild(makeSuggestionButton("生成整理建议", "AI 整理是后续能力；当前未执行，也未向 Vault 写入内容。"));
  const open = makeLacquerButton(record.isDemo ? "示例无对应笔记" : "打开笔记", record.isDemo ? "示例卡没有真实笔记" : `打开${record.title}`);
  if (record.isDemo) {
    open.disabled = true;
    open.setAttribute("aria-disabled", "true");
  } else {
    open.addEventListener("click", (event) => openRecord(plugin, record, event));
  }
  actions.appendChild(open);
  suggestion.appendChild(actions);
  reader.append(heading, body, suggestion);
  return reader;
}

function renderTextPage(plugin, snapshot, state) {
  const page = makeElement("div", "mengcang-page-stack mengcang-text-page");
  page.appendChild(makeElement("h1", "mengcang-sr-only", "文本档案"));
  const demoRecords = makeTextDemoRecords();
  const realRecords = snapshot.textCards;
  const projects = snapshot.projects || [];
  const visibleRealRecords = realRecords.filter((record) => recordMatchesQuery(record, state.query));
  const visibleDemoRecords = realRecords.length === 0 && !state.query.trim() ? demoRecords : [];
  const displayRecords = [...visibleRealRecords, ...visibleDemoRecords];
  const inspirationRecords = displayRecords.filter(isInboxInspirationRecord);
  const secondLayerRecords = displayRecords.filter(isSecondLayerRecord);

  if (state.textView === "inspirations") {
    const projectOptions = projectFilterOptions(inspirationRecords, projects);
    const validProjectIds = new Set(projectOptions.map((project) => project.id));
    const activeProjectId = state.inspirationProjectId === "none" || validProjectIds.has(state.inspirationProjectId)
      ? state.inspirationProjectId
      : "all";
    state.inspirationProjectId = activeProjectId;
    const filteredRecords = filterInspirationRecords(inspirationRecords, activeProjectId);
    const pagination = paginateRecords(filteredRecords, state.inspirationPage);
    state.inspirationPage = pagination.page;

    const collection = makeElement("section", "mengcang-section mengcang-text-layer mengcang-inspiration-collection");
    const collectionHeader = makeElement("header", "mengcang-inspiration-collection__header");
    const collectionHeading = makeElement("div", "");
    collectionHeading.append(
      makeElement("span", "mengcang-text-layer__index", "第一层 · 完整收集"),
      makeElement("h2", "mengcang-section__title", "全部待整理灵感")
    );
    const back = makeButton("mengcang-inspiration-collection__back", "返回灵感区", "返回文本档案灵感区");
    back.addEventListener("click", () => {
      state.textView = "main";
      state.inspirationPage = 1;
      state.selectedTextPath = "";
      state.requestRender({ top: true });
    });
    collectionHeader.append(collectionHeading, back);
    collection.appendChild(collectionHeader);

    const toolbar = makeElement("div", "mengcang-inspiration-collection__toolbar");
    const filterLabel = makeElement("label", "");
    filterLabel.appendChild(makeElement("span", "", "按项目筛选"));
    const select = makeElement("select", "");
    select.setAttribute("aria-label", "按项目筛选待整理灵感");
    const options = [
      ["all", "全部项目与无项目"],
      ["none", "无项目"],
      ...projectOptions.map((project) => [project.id, project.name])
    ];
    for (const [value, label] of options) {
      const option = makeElement("option", "", label);
      option.value = value;
      option.selected = value === activeProjectId;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      state.inspirationProjectId = select.value;
      state.inspirationPage = 1;
      state.selectedTextPath = "";
      state.requestRender();
    });
    filterLabel.appendChild(select);
    if (!snapshot.projectRegistryAvailable) {
      filterLabel.appendChild(makeElement(
        "small",
        "mengcang-inspiration-collection__registry-note",
        "项目目录暂不可用；仍可按笔记中的项目 ID 筛选。"
      ));
    }
    const countText = `${state.query ? `搜索“${state.query}” · ` : ""}${pagination.total} 条灵感`;
    toolbar.append(filterLabel, makeElement("p", "", countText));
    collection.append(
      toolbar,
      makeTextCardGrid(
        plugin,
        pagination.items,
        state,
        projects,
        "没有符合当前搜索或项目筛选的灵感。",
        "mengcang-text-card-grid--collection"
      )
    );

    if (pagination.pageCount > 1) {
      const nav = makeElement("nav", "mengcang-inspiration-collection__pagination");
      nav.setAttribute("aria-label", "全部待整理灵感分页");
      const previous = makeButton("", "上一页");
      previous.disabled = pagination.page === 1;
      previous.addEventListener("click", () => {
        state.inspirationPage = pagination.page - 1;
        state.selectedTextPath = "";
        state.requestRender({ top: true });
      });
      const next = makeButton("", "下一页");
      next.disabled = pagination.page === pagination.pageCount;
      next.addEventListener("click", () => {
        state.inspirationPage = pagination.page + 1;
        state.selectedTextPath = "";
        state.requestRender({ top: true });
      });
      nav.append(previous, makeElement("span", "", `${pagination.page} / ${pagination.pageCount}`), next);
      collection.appendChild(nav);
    }
    page.appendChild(collection);

    const selected = inspirationRecords.find((record) => textRecordKey(record) === state.selectedTextPath) || null;
    const reader = makeTextReader(plugin, selected, state, projects);
    if (reader) page.appendChild(reader);
    return page;
  }

  const intro = makeElement("section", "mengcang-text-intro");
  const introCopy = makeElement("div", "mengcang-text-intro__copy");
  introCopy.append(
    makeElement("span", "mengcang-page-kicker", "文本档案 · 独立原生页面"),
    makeElement("h2", "", "先留住一句话，再慢慢长成观点。")
  );
  const introActions = makeElement("div", "mengcang-text-intro__actions");
  introActions.append(
    makeSuggestionButton("快速捕捉 · 后续", "快速捕捉属于后续写入能力；当前未创建文件。"),
    makeSuggestionButton("AI 整理建议 · 后续", "AI 整理属于后续人审流程；当前未执行。")
  );
  const baseButton = makeButton("mengcang-text-base-button", "打开兼容 Base", "打开文本卡片 Base");
  baseButton.addEventListener("click", () => openBase(plugin, BASE_PATHS.text));
  introActions.appendChild(baseButton);
  intro.append(introCopy, introActions);
  page.appendChild(intro);

  const inspiration = makeElement("section", "mengcang-section mengcang-text-layer");
  const newestInspirationRecords = inspirationRecords.slice(0, INSPIRATION_PAGE_SIZE);
  inspiration.append(
    makeElement("span", "mengcang-text-layer__index", "第一层"),
    makeElement("h2", "mengcang-section__title", "灵感区"),
    makeTextCardGrid(
      plugin,
      newestInspirationRecords,
      state,
      projects,
      state.query ? "没有待整理灵感匹配当前搜索。示例卡不会参与搜索。" : "当前没有待整理灵感。",
      "mengcang-text-card-grid--inspiration"
    )
  );
  if (inspirationRecords.length) {
    const openCollection = makeButton(
      "mengcang-inspiration-collection__open",
      inspirationRecords.length > INSPIRATION_PAGE_SIZE
        ? `查看全部待整理灵感（${inspirationRecords.length}）`
        : "查看全部待整理灵感",
      "打开全部待整理灵感收集页"
    );
    openCollection.addEventListener("click", () => {
      state.textView = "inspirations";
      state.inspirationPage = 1;
      state.selectedTextPath = "";
      state.requestRender({ top: true });
    });
    inspiration.appendChild(openCollection);
  }
  page.appendChild(inspiration);

  const themeSet = new Set(secondLayerRecords.map((record) => record.theme || "未分类"));
  themeSet.add("未分类");
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const themes = Array.from(themeSet).sort((a, b) => {
    if (a === "未分类") return 1;
    if (b === "未分类") return -1;
    return collator.compare(a, b);
  });
  const activeTheme = themes.includes(state.textTheme) ? state.textTheme : themes[0] || "未分类";
  if (state.textTheme !== activeTheme) state.textTheme = activeTheme;

  const directory = makeElement("section", "mengcang-section mengcang-text-layer mengcang-text-directory");
  directory.append(
    makeElement("span", "mengcang-text-layer__index", "第二层"),
    makeElement("h2", "mengcang-section__title", "主题目录")
  );
  const themeNav = makeElement("div", "mengcang-text-themes");
  themeNav.setAttribute("role", "tablist");
  themeNav.setAttribute("aria-label", "文本主题");
  for (const theme of themes) {
    const button = makeButton("mengcang-text-theme", theme, `查看${theme}主题`);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", theme === activeTheme ? "true" : "false");
    if (theme === activeTheme) button.classList.add("is-active");
    button.addEventListener("click", () => {
      state.textTheme = theme;
      state.selectedTextPath = "";
      state.requestRender();
    });
    themeNav.appendChild(button);
  }
  directory.appendChild(themeNav);

  const themedRecords = secondLayerRecords.filter((record) => (record.theme || "未分类") === activeTheme);
  const buckets = [
    ["viewpoint", "观点"],
    ["excerpt", "摘录"],
    ["organized", "已整理灵感"]
  ];
  const bucketGrid = makeElement("div", "mengcang-text-buckets");
  for (const [bucketKey, title] of buckets) {
    const section = makeElement("section", "mengcang-text-bucket");
    const bucketRecords = themedRecords.filter((record) => textBucket(record) === bucketKey);
    section.append(
      makeElement("h3", "", title),
      makeTextCardGrid(plugin, bucketRecords, state, projects, `“${activeTheme}”下暂无${title}。`)
    );
    bucketGrid.appendChild(section);
  }
  directory.appendChild(bucketGrid);
  page.appendChild(directory);

  const selected = displayRecords.find((record) => textRecordKey(record) === state.selectedTextPath) || null;
  const reader = makeTextReader(plugin, selected, state, projects);
  if (reader) page.appendChild(reader);
  return page;
}

function applySearch(root, query) {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  for (const section of root.querySelectorAll(".mengcang-section")) {
    const cards = Array.from(section.querySelectorAll(".mengcang-record-card"));
    let visible = 0;
    for (const card of cards) {
      const match = !normalized || (card.mengcangSearch || "").includes(normalized);
      card.hidden = !match;
      if (match) visible += 1;
    }
    const filterEmpty = section.querySelector(".mengcang-section__filter-empty");
    if (filterEmpty) filterEmpty.hidden = visible !== 0;
  }
}

function makeSidebar(plugin, snapshot, root, state) {
  const aside = makeElement("aside", "mengcang-sidebar");
  const toggle = makeButton(
    "mengcang-sidebar__toggle",
    "",
    state.sidebarCollapsed ? "展开功能栏" : "收起功能栏"
  );
  toggle.title = state.sidebarCollapsed ? "展开功能栏" : "收起功能栏";
  toggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  toggle.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    state.requestRender?.({ skipCapture: true });
  });
  aside.appendChild(toggle);

  const brand = makeElement("div", "mengcang-brand");
  const seal = makeElement("span", "mengcang-brand__seal");
  const mark = makeElement("img", "mengcang-brand__mark");
  mark.src = pluginAssetUrl(plugin, "mengcang-dream-butterfly-mark.png");
  mark.alt = "";
  seal.appendChild(mark);
  brand.append(
    seal,
    makeElement("span", "mengcang-brand__name", "梦藏"),
    makeElement("span", "mengcang-brand__tagline", "个人 AIOS 灵感档案")
  );
  aside.appendChild(brand);

  const nav = makeElement("nav", "mengcang-nav");
  const navItems = [
    ["01", "总览", "home", () => state.navigate("home")],
    ["02", "灵感", "inspirations", () => state.navigate("inspirations")],
    ["03", "素材", "materials", () => state.navigate("materials")],
    ["04", "图书书架", "books", () => state.navigate("books")],
    ["05", "图案收集", "patterns", () => state.navigate("patterns")],
    ["06", "文本档案", "text", () => state.navigate("text")],
    ["07", "网页采集", "web", () => state.navigate("web")]
  ];
  for (const [index, label, route, action] of navItems) {
    const button = makeButton("mengcang-nav__item", "", label);
    button.title = label;
    if (route && (state.route === route || (route === "books" && state.route === "book-graph"))) {
      button.classList.add("is-active");
      button.setAttribute("aria-current", "page");
    }
    button.append(makeElement("span", "mengcang-nav__index", index), makeElement("span", "mengcang-nav__label", label));
    button.addEventListener("click", action);
    nav.appendChild(button);
  }
  aside.appendChild(nav);

  const realWebClips = snapshot.webClips.filter((item) => !item.isExample);
  const statusRecords = [...snapshot.patterns, ...snapshot.textCards, ...realWebClips];
  const stats = [
    ["收集箱", statusRecords.filter((item) => item.status === "inbox").length],
    ["已整理", statusRecords.filter((item) => ["active", "ready", "organized"].includes(item.status)).length],
    ["图鉴专题", snapshot.patterns.filter((item) => item.isAtlas).length],
    ["纹样条目", snapshot.patterns.filter((item) => !item.isAtlas).length],
    ["其中原型", snapshot.patterns.filter((item) => item.provenance === "prototype").length],
    ["全部素材", statusRecords.length + snapshot.books.length]
  ];
  const statsGroup = makeElement("div", "mengcang-stats");
  statsGroup.appendChild(makeElement("div", "mengcang-stats__title", "仓库结构"));
  for (const [label, count] of stats) {
    const row = makeElement("div", "mengcang-stats__row");
    row.append(makeElement("span", "", label), makeElement("span", "", String(count)));
    statsGroup.appendChild(row);
  }
  aside.appendChild(statsGroup);
  aside.appendChild(makeElement("div", "mengcang-sidebar__foot", "本地优先 · 明确点亮后才写回 Markdown"));
  return aside;
}

function renderDashboard(containerEl, plugin, snapshot, state, autoScrollCleanups) {
  hideBookHoverCard({ owner: containerEl });
  containerEl.replaceChildren();
  const root = makeElement("div", "mengcang-dashboard");
  root.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
  installTextureVariables(root, plugin);
  containerEl.appendChild(root);
  root.appendChild(makeSidebar(plugin, snapshot, root, state));

  const main = makeElement("main", "mengcang-main");
  const header = makeElement("header", "mengcang-topbar");
  const search = makeElement("input", "mengcang-search");
  search.type = "search";
  search.placeholder = state.route === "stars"
    ? "搜索一颗星，或选择新的关系基点"
    : state.route === "book-graph"
      ? "在这张局部图中查找节点"
    : state.route === "text"
    ? "搜索标题、主题、标签、正文或关联"
    : state.route === "web"
      ? "搜索网页、站点、标签或设计观察"
      : "搜索素材、标签或来源";
  search.setAttribute("aria-label", "搜索梦藏素材");
  search.value = state.query;
  header.appendChild(search);
  main.appendChild(header);

  const content = makeElement("div", "mengcang-content");
  content.dataset.route = state.route;
  if (!snapshot.ready) {
    content.appendChild(makeElement("div", "mengcang-loading", "正在读取 Vault 资料…"));
  } else if (state.route === "inspirations" || state.route === "materials") {
    const host = makeElement("div", "mengcang-fusion-host");
    content.appendChild(host);
    state.fusionCleanup = mountFusionView(host, plugin.inspirations, state.route);
  } else if (state.route === "patterns") {
    content.appendChild(renderPatternPage(plugin, snapshot, state));
  } else if (state.route === "book-graph") {
    content.appendChild(renderBookGraphPage(plugin, snapshot, state, autoScrollCleanups));
  } else if (state.route === "books") {
    content.appendChild(renderBooksPage(plugin, snapshot, state));
  } else if (state.route === "text") {
    content.appendChild(renderTextPage(plugin, snapshot, state));
  } else if (state.route === "web") {
    content.appendChild(renderWebPage(plugin, snapshot, state));
  } else if (state.route === "stars") {
    content.appendChild(renderStarSeaPage(plugin, snapshot, state));
  } else {
    content.append(
      makeSection(
        plugin,
        "图案收集",
        homePatternRecords(snapshot.patterns),
        (activePlugin, item) => makePatternCard(activePlugin, item, () => state.navigate("patterns")),
        "尚未收录纹样资料。",
        "mengcang-patterns",
        autoScrollCleanups
      ),
      makeSection(
        plugin,
        "图书书架",
        snapshot.books,
        (activePlugin, item) => makeBookCard(activePlugin, item, () => {
          void state.openBookGraph(item);
        }),
        "尚未收录真实书籍。",
        "mengcang-books",
        autoScrollCleanups
      ),
      makeSection(
        plugin,
        "文本卡片",
        snapshot.textCards,
        (activePlugin, item) => makeTextCard(activePlugin, item, () => {
          state.selectedTextPath = textRecordKey(item);
          state.textView = "main";
          state.navigate("text");
        }, snapshot.projects),
        "当前文本卡片目录为空；进入文本档案可预览不写入的示例界面。",
        "mengcang-text",
        autoScrollCleanups
      ),
      makeSection(
        plugin,
        "网页剪报",
        snapshot.webClips,
        (activePlugin, item) => makeWebCard(activePlugin, item, () => {
          state.webStatus = "all";
          state.selectedWebPath = item.file.path;
          state.selectedWebExcerpt = 0;
          state.navigate("web");
        }),
        "当前网页剪报目录为空；以后新增 Markdown 剪报会自动出现。",
        "mengcang-web",
        autoScrollCleanups
      )
    );
  }
  main.appendChild(content);
  root.appendChild(main);

  for (const scroller of root.querySelectorAll(".mengcang-section__scroller--auto")) {
    autoScrollCleanups.push(startAutoScroll(scroller));
  }

  for (const scroller of root.querySelectorAll("[data-mengcang-section]")) {
    scroller.scrollLeft = state.scrollPositions[scroller.dataset.mengcangSection] || 0;
  }
  main.scrollTop = state.mainScrollTops[state.route] || 0;
  if (state.searchFocused) search.focus({ preventScroll: true });

  const updateSearch = (event) => {
    state.query = search.value;
    if (state.route === "home" || event?.isComposing) {
      applySearch(root, state.query);
      state.syncViewState?.();
      return;
    }
    if (state.route === "text") state.inspirationPage = 1;
    state.requestRender();
  };
  search.addEventListener("input", updateSearch);
  search.addEventListener("compositionend", updateSearch);
  applySearch(root, state.query);
}

function mountDashboard(containerEl, plugin, initialViewState = {}, onViewStateChange = () => {}) {
  const persistedState = normalizeDashboardViewState(initialViewState);
  const state = {
    ...persistedState,
    scrollPositions: {},
    mainScrollTops: { home: 0, inspirations: 0, materials: 0, patterns: 0, books: 0, "book-graph": 0, text: 0, web: 0 },
    starCanvasPaths: new Set(),
    starManualTargetPath: "",
    searchFocused: false,
    fusionCleanup: null,
    requestRender: null,
    navigate: null,
    openBookGraph: null,
    syncViewState: null
  };
  let autoScrollCleanups = [];
  let detailFrame = 0;
  let currentSnapshot = plugin.store.snapshot;

  state.syncViewState = () => onViewStateChange(normalizeDashboardViewState(state));

  const captureViewState = () => {
    for (const scroller of containerEl.querySelectorAll?.("[data-mengcang-section]") || []) {
      state.scrollPositions[scroller.dataset.mengcangSection] = scroller.scrollLeft;
    }
    const previousMain = containerEl.querySelector?.(".mengcang-main");
    if (previousMain) state.mainScrollTops[state.route] = previousMain.scrollTop;
    const ownerDocument = containerEl.ownerDocument || document;
    state.searchFocused = containerEl.querySelector?.(".mengcang-search") === ownerDocument.activeElement;
  };

  const renderCurrent = (options = {}) => {
    if (!options.skipCapture) captureViewState();
    if (options.top) state.mainScrollTops[state.route] = 0;
    state.syncViewState();
    for (const cleanup of autoScrollCleanups) cleanup();
    autoScrollCleanups = [];
    state.fusionCleanup?.();
    state.fusionCleanup = null;
    if (detailFrame) window.cancelAnimationFrame(detailFrame);
    detailFrame = 0;
    renderDashboard(containerEl, plugin, currentSnapshot, state, autoScrollCleanups);
    state.syncViewState();
    if (options.detail) {
      detailFrame = window.requestAnimationFrame(() => {
        detailFrame = 0;
        containerEl.querySelector?.(".mengcang-pattern-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    if (options.textDetail) {
      detailFrame = window.requestAnimationFrame(() => {
        detailFrame = 0;
        containerEl.querySelector?.(".mengcang-text-reader")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    if (options.webDetail) {
      detailFrame = window.requestAnimationFrame(() => {
        detailFrame = 0;
        containerEl.querySelector?.(".mengcang-web-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  state.requestRender = renderCurrent;
  state.navigate = (route) => {
    const nextRoute = DASHBOARD_ROUTES.has(route) ? route : "home";
    captureViewState();
    if (nextRoute === "text" && state.route !== "text") {
      state.textView = "main";
      state.inspirationPage = 1;
    }
    state.route = nextRoute;
    if (nextRoute === "patterns") {
      state.atlasPath = "";
      state.selectedPatternPath = "";
    }
    if (nextRoute === "stars") {
      state.selectedStarTargetPath = "";
      state.selectedStarRelationId = "";
    }
    renderCurrent({ top: true, skipCapture: true });
  };

  state.openBookGraph = async (record) => {
    if (!record?.file?.path) return;
    captureViewState();
    state.selectedBookPath = record.file.path;
    state.query = "";
    state.syncViewState();
    const returnState = normalizeDashboardViewState({
      ...state,
      route: "books",
      selectedBookPath: record.file.path
    });
    const fallbackState = normalizeDashboardViewState({
      ...state,
      route: "book-graph",
      selectedBookPath: record.file.path
    });
    const opened = await plugin.openNativeBookGraph(record, { returnState, fallbackState });
    if (!opened && containerEl.isConnected) {
      state.route = "book-graph";
      renderCurrent({ top: true, skipCapture: true });
    }
  };

  const unsubscribe = plugin.store.subscribe((snapshot) => {
    currentSnapshot = snapshot;
    renderCurrent();
  });
  return () => {
    hideBookHoverCard({ owner: containerEl });
    state.fusionCleanup?.();
    state.fusionCleanup = null;
    unsubscribe();
    if (detailFrame) window.cancelAnimationFrame(detailFrame);
    detailFrame = 0;
    for (const cleanup of autoScrollCleanups) cleanup();
    autoScrollCleanups = [];
    containerEl.replaceChildren();
  };
}

class MengcangDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.cleanup = null;
    this.dashboardState = normalizeDashboardViewState();
    this.navigation = true;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() {
    if (this.dashboardState.route === "inspirations") return "梦藏 · 灵感";
    if (this.dashboardState.route === "materials") return "梦藏 · 素材";
    if (this.dashboardState.route === "book-graph") return "梦藏 · 书籍局部图";
    if (this.dashboardState.route === "text") return "梦藏 · 文本档案";
    if (this.dashboardState.route === "web") return "梦藏 · 网页采集";
    if (this.dashboardState.route === "stars") return "梦藏 · 星海";
    return "梦藏总览";
  }
  getIcon() { return "archive"; }

  getState() {
    return { ...this.dashboardState };
  }

  async setState(nextState, result) {
    const normalized = normalizeDashboardViewState(nextState);
    const changed = JSON.stringify(normalized) !== JSON.stringify(this.dashboardState);
    this.dashboardState = normalized;
    if (changed && result) result.history = true;
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = mountDashboard(this.contentEl, this.plugin, this.dashboardState, (state) => {
        this.dashboardState = normalizeDashboardViewState(state);
      });
    }
  }

  async onOpen() {
    this.contentEl.addClass("mengcang-dashboard-view-content");
    this.cleanup = mountDashboard(this.contentEl, this.plugin, this.dashboardState, (state) => {
      this.dashboardState = normalizeDashboardViewState(state);
    });
  }

  async onClose() {
    this.cleanup?.();
    this.cleanup = null;
    this.contentEl.removeClass("mengcang-dashboard-view-content");
  }
}

class MengcangBookIntroView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.introState = normalizeBookIntroViewState();
    this.renderToken = 0;
    this.bridgeCleanup = null;
    this.navigation = true;
  }

  getViewType() { return BOOK_INTRO_VIEW_TYPE; }
  getDisplayText() { return "局外人 · 动态策展"; }
  getIcon() { return "book-open"; }

  getState() {
    return { ...this.introState };
  }

  async setState(nextState, result) {
    const normalized = normalizeBookIntroViewState(nextState);
    const changed = normalized.bookPath !== this.introState.bookPath;
    this.introState = normalized;
    if (changed && result) result.history = true;
    if (this.contentEl.isConnected) await this.render();
  }

  async onOpen() {
    this.contentEl.addClass("mengcang-book-intro-view-content");
    await this.render();
  }

  clearBridge() {
    this.bridgeCleanup?.();
    this.bridgeCleanup = null;
  }

  async handleBridgeAction(action) {
    const command = bookIntroBridgeCommand(action);
    if (!command || command.bookPath !== this.introState.bookPath) return false;
    if (command.kind === "open-book") {
      return this.plugin.openBookFileByPath(command.bookPath, { targetLeaf: this.leaf });
    }
    if (command.kind === "book-graph") {
      return this.plugin.openNativeBookGraphByPath(command.bookPath, command.depth, {
        targetLeaf: this.leaf
      });
    }
    if (command.kind === "book-journal") {
      return this.plugin.openBookJournalByProtocol({
        page: "book-journal",
        book: command.bookPath,
        action: command.action
      }, { targetLeaf: this.leaf });
    }
    if (command.kind === "open-external") {
      const opened = await openBookIntroExternalUrl(command.url);
      if (!opened) new Notice("无法打开公开艺术来源，请稍后重试。");
      return opened;
    }
    return false;
  }

  async render() {
    const token = ++this.renderToken;
    const ownerDocument = this.contentEl.ownerDocument || document;
    this.clearBridge();
    this.contentEl.replaceChildren();

    const shell = ownerDocument.createElement("section");
    shell.className = "mengcang-book-intro-view";
    shell.setAttribute("aria-label", "《局外人》动态策展");

    const toolbar = ownerDocument.createElement("nav");
    toolbar.className = "mengcang-book-intro-view__toolbar";
    toolbar.setAttribute("aria-label", "动态策展导航");

    const backButton = ownerDocument.createElement("button");
    backButton.type = "button";
    backButton.className = "mengcang-book-intro-view__button";
    backButton.textContent = "← 返回书架";
    backButton.addEventListener("click", () => {
      void this.plugin.openDashboard({
        targetLeaf: this.leaf,
        route: "books",
        state: { selectedBookPath: BOOK_INTRO_BOOK_PATH }
      });
    });
    toolbar.appendChild(backButton);

    const graphButton = ownerDocument.createElement("button");
    graphButton.type = "button";
    graphButton.className = "mengcang-book-intro-view__button";
    graphButton.textContent = "进入局部图";
    graphButton.disabled = !this.introState.bookPath;
    graphButton.addEventListener("click", () => {
      void this.plugin.openNativeBookGraphByPath(this.introState.bookPath, 2, {
        targetLeaf: this.leaf
      });
    });
    toolbar.appendChild(graphButton);
    shell.appendChild(toolbar);

    const frameHost = ownerDocument.createElement("div");
    frameHost.className = "mengcang-book-intro-view__frame-host";
    shell.appendChild(frameHost);
    this.contentEl.appendChild(shell);

    if (!this.introState.bookPath) {
      const message = ownerDocument.createElement("p");
      message.className = "mengcang-book-intro-view__message";
      message.textContent = "这个动态策展链接无效。";
      frameHost.appendChild(message);
      return;
    }

    const assetPath = pluginAssetPath(this.plugin, BOOK_INTRO_ASSET_PATH);
    let introHtml = "";
    try {
      introHtml = await this.plugin.app.vault.adapter.read(assetPath);
    } catch (_) {
      introHtml = "";
    }
    if (token !== this.renderToken) return;
    if (!isSelfContainedBookIntroHtml(introHtml)) {
      const message = ownerDocument.createElement("p");
      message.className = "mengcang-book-intro-view__message";
      message.textContent = "尚未找到可安全载入的《局外人》动态策展资源。";
      frameHost.appendChild(message);
      return;
    }

    const iframe = ownerDocument.createElement("iframe");
    iframe.className = "mengcang-book-intro-view__iframe";
    iframe.title = "《局外人》动态策展";
    iframe.srcdoc = introHtml;
    iframe.loading = "eager";
    iframe.setAttribute("allow", "fullscreen");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");

    const bridgeStatus = ownerDocument.createElement("div");
    bridgeStatus.className = "mengcang-book-intro-view__bridge-status is-loading";
    bridgeStatus.setAttribute("role", "status");
    bridgeStatus.setAttribute("aria-live", "polite");
    bridgeStatus.textContent = "正在载入动态策展…";
    frameHost.appendChild(bridgeStatus);

    const ownerWindow = ownerDocument.defaultView || window;
    let bridgeReady = false;
    const showBridgeError = (message) => {
      if (token !== this.renderToken || bridgeReady || !bridgeStatus.isConnected) return;
      bridgeStatus.className = "mengcang-book-intro-view__bridge-status is-error";
      bridgeStatus.setAttribute("role", "alert");
      bridgeStatus.textContent = message;
    };
    const readyTimer = ownerWindow.setTimeout(() => {
      showBridgeError("动态策展未能建立安全连接，请返回书架后重试。");
    }, 4000);
    const onMessage = (event) => {
      const message = parseBookIntroBridgeMessage(event, iframe.contentWindow);
      if (!message || token !== this.renderToken) return;
      if (message.event === "ready") {
        bridgeReady = true;
        ownerWindow.clearTimeout(readyTimer);
        bridgeStatus.remove();
        return;
      }
      if (!bridgeReady || message.event !== "action") return;
      void this.handleBridgeAction(message.action);
    };
    const onFrameError = () => showBridgeError("动态策展资源加载失败，请返回书架后重试。");
    ownerWindow.addEventListener("message", onMessage);
    iframe.addEventListener("error", onFrameError);
    this.bridgeCleanup = () => {
      ownerWindow.clearTimeout(readyTimer);
      ownerWindow.removeEventListener("message", onMessage);
      iframe.removeEventListener("error", onFrameError);
    };
    frameHost.appendChild(iframe);
  }

  async onClose() {
    this.renderToken += 1;
    this.clearBridge();
    this.contentEl.replaceChildren();
    this.contentEl.removeClass("mengcang-book-intro-view-content");
  }
}

class MengcangDashboardRenderChild extends MarkdownRenderChild {
  constructor(containerEl, plugin) {
    super(containerEl);
    this.plugin = plugin;
    this.cleanup = null;
  }

  onload() {
    this.containerEl.addClass("mengcang-dashboard-codeblock");
    this.cleanup = mountDashboard(this.containerEl, this.plugin);
  }

  onunload() {
    this.cleanup?.();
    this.cleanup = null;
    this.containerEl.removeClass("mengcang-dashboard-codeblock");
  }
}

class MengcangDashboardPlugin extends Plugin {
  async onload() {
    this.unloading = false;
    this.openingPromise = null;
    this.bookIntroOpeningPromise = null;
    this.redirectTimer = null;
    this.nativeGraphReturns = new Map();
    this.dataWriteQueue = Promise.resolve();
    this.starSea = new StarSeaService(this);
    await this.starSea.loadData();
    this.bookCuration = new BookCurationService(this);
    await this.bookCuration.loadData();
    this.bookJournal = new BookJournalService(this);
    this.store = new MengcangStore(this);
    this.inspirations = new InspirationStore(this);
    this.desktopConnector = new DesktopConnector(this);
    await this.desktopConnector.start();
    this.registerView(VIEW_TYPE, (leaf) => new MengcangDashboardView(leaf, this));
    this.registerView(BOOK_INTRO_VIEW_TYPE, (leaf) => new MengcangBookIntroView(leaf, this));
    this.registerMarkdownCodeBlockProcessor(CODE_BLOCK, (_source, element, context) => {
      context.addChild(new MengcangDashboardRenderChild(element, this));
    });
    this.addRibbonIcon("archive", "打开梦藏总览", () => this.openDashboard());
    this.addSettingTab(new BookCurationSettingTab(this.app, this));
    this.addCommand({
      id: "open-mengcang-dashboard",
      name: "打开梦藏总览",
      callback: () => this.openDashboard()
    });
    this.addCommand({ id: "open-mengcang-inspirations", name: "打开梦藏灵感", callback: () => this.openDashboard({ route: "inspirations" }) });
    this.addCommand({ id: "open-mengcang-materials", name: "打开梦藏素材", callback: () => this.openDashboard({ route: "materials" }) });
    this.addCommand({
      id: "regenerate-current-book-curation",
      name: "重新生成当前书籍的阅读引线草案",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const frontmatter = file instanceof TFile
          ? this.app.metadataCache.getFileCache(file)?.frontmatter || {}
          : {};
        const available = file instanceof TFile
          && file.path.startsWith(ROOTS.books)
          && valueToText(frontmatter.type) === "book";
        if (!available || checking) return available;
        void this.bookCuration.retry(file.path, { force: true })
          .then(() => new Notice("阅读引线草案已重新生成。"))
          .catch((error) => new Notice(`生成失败：${error?.message || "未改动笔记"}`));
        return true;
      }
    });
    this.registerObsidianProtocolHandler("mengcang-dashboard", (params = {}) => {
      const route = valueToText(params.page);
      const bookPath = valueToText(params.book);
      if (route === "book-journal") {
        return this.openBookJournalByProtocol(params);
      }
      if (route === "book-graph" && bookPath) {
        return this.openNativeBookGraphByPath(bookPath, Number(params.depth) || 2);
      }
      return this.openDashboard({
        route: DASHBOARD_ROUTES.has(route) ? route : "home",
        state: {
          query: valueToText(params.query),
          selectedBookPath: bookPath,
          bookGraphDepth: Number(params.depth) || 2,
          selectedStarPath: valueToText(params.anchor),
          selectedStarTargetPath: valueToText(params.target),
          selectedStarRelationId: valueToText(params.relation)
        }
      });
    });
    this.registerObsidianProtocolHandler("mengcang", (params = {}) => (
      this.openBookIntroByProtocol(params)
    ));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (this.unloading || file?.path !== OVERVIEW_NOTE_PATH) return;
      const sourceLeaf = this.app.workspace.getLeaf(false);
      if (this.redirectTimer !== null) window.clearTimeout(this.redirectTimer);
      this.redirectTimer = window.setTimeout(() => {
        this.redirectTimer = null;
        if (this.unloading) return;
        if (sourceLeaf?.view?.file?.path !== OVERVIEW_NOTE_PATH) return;
        this.openDashboard({ targetLeaf: sourceLeaf });
      }, 0);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.refreshNativeGraphReturns();
    }));
    this.store.start();
    this.inspirations.start();
    try {
      await this.bookCuration.start();
    } catch (error) {
      new Notice(`新书自动策展未能启动：${error?.message || "书籍笔记未改动"}`);
    }
    this.app.workspace.onLayoutReady(() => {
      if (!this.unloading && this.app.workspace.getActiveFile()?.path === OVERVIEW_NOTE_PATH) {
        this.openDashboard({ targetLeaf: this.app.workspace.getLeaf(false) });
      }
    });
  }

  async updateMengcangData(mutator) {
    const task = async () => {
      const current = (await this.loadData()) || {};
      const draft = current && typeof current === "object" && !Array.isArray(current)
        ? JSON.parse(JSON.stringify(current))
        : {};
      const transformed = await mutator(draft);
      const next = transformed && typeof transformed === "object" && !Array.isArray(transformed)
        ? transformed
        : draft;
      await this.saveData(next);
      return next;
    };
    const run = this.dataWriteQueue.then(task, task);
    this.dataWriteQueue = run.catch(() => undefined);
    return run;
  }

  openBookCurationSettings() {
    this.app.setting?.open?.();
    this.app.setting?.openTabById?.(this.manifest.id);
  }

  nativeGraphFallbackState(path, depth = 2) {
    return normalizeDashboardViewState({
      route: "book-graph",
      selectedBookPath: path,
      bookGraphDepth: depth
    });
  }

  removeNativeGraphReturn(leaf) {
    const entry = this.nativeGraphReturns.get(leaf);
    entry?.button?.remove?.();
    entry?.curation?.dispose?.();
    entry?.host?.removeClass?.("mengcang-native-local-graph");
    if (entry) {
      entry.button = null;
      entry.curation = null;
      entry.host = null;
    }
  }

  decorateNativeGraphLeaf(leaf) {
    const entry = this.nativeGraphReturns.get(leaf);
    const view = leaf?.view;
    if (!entry || view?.getViewType?.() !== NATIVE_LOCAL_GRAPH_VIEW_TYPE) return false;
    const host = view.contentEl || view.containerEl;
    if (!host) return false;
    if (entry.host === host && entry.button?.isConnected && entry.curation?.element?.isConnected) return true;
    this.removeNativeGraphReturn(leaf);
    const button = makeButton(
      "mengcang-native-graph-return",
      "← 返回梦藏书架",
      "返回梦藏图书书架"
    );
    button.dataset.mengcangNativeGraphReturn = "true";
    button.addEventListener("click", () => {
      void this.returnFromNativeBookGraph(leaf);
    });
    host.addClass?.("mengcang-native-local-graph");
    host.appendChild(button);
    const curation = mountBookCurationPanel(this, entry.bookPath, host.ownerDocument || document);
    host.appendChild(curation.element);
    entry.host = host;
    entry.button = button;
    entry.curation = curation;
    return true;
  }

  refreshNativeGraphReturns() {
    for (const [leaf, entry] of this.nativeGraphReturns) {
      if (leaf?.view?.getViewType?.() === NATIVE_LOCAL_GRAPH_VIEW_TYPE) {
        this.decorateNativeGraphLeaf(leaf);
      } else if (!entry.opening) {
        this.removeNativeGraphReturn(leaf);
        this.nativeGraphReturns.delete(leaf);
      }
    }
  }

  async returnFromNativeBookGraph(leaf) {
    const entry = this.nativeGraphReturns.get(leaf);
    if (!entry || this.unloading) return;
    this.removeNativeGraphReturn(leaf);
    this.nativeGraphReturns.delete(leaf);
    try {
      await leaf.setViewState({ type: VIEW_TYPE, state: entry.returnState, active: true });
      if (!this.unloading) await this.app.workspace.revealLeaf(leaf);
    } catch (_) {
      new Notice("无法返回梦藏书架，请从侧栏重新打开梦藏。");
    }
  }

  async openNativeBookGraph(record, options = {}) {
    const filePath = record?.file?.path || valueToText(record?.path);
    const nativeState = makeNativeBookGraphViewState(filePath);
    if (!nativeState || this.unloading) return false;
    const leaf = options.targetLeaf || this.app.workspace.getLeaf(false);
    if (this.nativeGraphReturns.has(leaf)) {
      this.removeNativeGraphReturn(leaf);
      this.nativeGraphReturns.delete(leaf);
    }
    const returnState = normalizeDashboardViewState({
      ...(options.returnState || {}),
      route: "books",
      selectedBookPath: filePath
    });
    const fallbackState = normalizeDashboardViewState({
      ...(options.fallbackState || {}),
      route: "book-graph",
      selectedBookPath: filePath
    });
    this.nativeGraphReturns.set(leaf, {
      bookPath: filePath,
      returnState,
      fallbackState,
      button: null,
      curation: null,
      host: null,
      opening: true
    });
    try {
      await leaf.setViewState(nativeState);
      if (this.unloading) return false;
      await this.app.workspace.revealLeaf(leaf);
      if (leaf.view?.getViewType?.() !== NATIVE_LOCAL_GRAPH_VIEW_TYPE) {
        throw new Error("Obsidian localgraph view is unavailable");
      }
      const entry = this.nativeGraphReturns.get(leaf);
      if (entry) entry.opening = false;
      this.decorateNativeGraphLeaf(leaf);
      return true;
    } catch (_) {
      this.removeNativeGraphReturn(leaf);
      this.nativeGraphReturns.delete(leaf);
      try {
        await leaf.setViewState({ type: VIEW_TYPE, state: fallbackState, active: true });
        if (!this.unloading) await this.app.workspace.revealLeaf(leaf);
      } catch (_) {}
      new Notice("原生局部图不可用，已切换到梦藏内置图谱。");
      return false;
    }
  }

  async openNativeBookGraphByPath(path, depth = 2, options = {}) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return this.openDashboard({
        targetLeaf: options.targetLeaf,
        route: "book-graph",
        state: this.nativeGraphFallbackState(path, depth)
      });
    }
    const returnState = normalizeDashboardViewState({
      route: "books",
      selectedBookPath: path,
      bookGraphDepth: depth
    });
    return this.openNativeBookGraph(
      { file, title: file.basename },
      {
        targetLeaf: options.targetLeaf || this.app.workspace.getLeaf(false),
        returnState,
        fallbackState: this.nativeGraphFallbackState(path, depth)
      }
    );
  }

  async openBookIntroByProtocol(params = {}) {
    const parsed = parseBookIntroProtocolParams(params);
    if (!parsed) {
      new Notice("动态策展链接无效。");
      return false;
    }
    return Boolean(await this.openBookIntro(parsed.bookPath));
  }

  async openBookIntro(bookPath, options = {}) {
    const viewState = makeBookIntroViewState(bookPath);
    if (!viewState || this.unloading) {
      new Notice("只能打开《局外人》的动态策展。");
      return null;
    }
    const open = async () => {
      try {
        const existing = this.app.workspace.getLeavesOfType(BOOK_INTRO_VIEW_TYPE)[0];
        const leaf = selectPreferredLeaf(options.targetLeaf, existing)
          || this.app.workspace.getLeaf(false);
        await leaf.setViewState(viewState);
        if (this.unloading) return null;
        await this.app.workspace.revealLeaf(leaf);
        return leaf;
      } catch (_) {
        new Notice("无法打开《局外人》动态策展。");
        return null;
      }
    };
    if (options.targetLeaf) return open();
    if (!this.bookIntroOpeningPromise) {
      this.bookIntroOpeningPromise = open();
    }
    const openingPromise = this.bookIntroOpeningPromise;
    try {
      return await openingPromise;
    } finally {
      if (this.bookIntroOpeningPromise === openingPromise) {
        this.bookIntroOpeningPromise = null;
      }
    }
  }

  async openBookFileByPath(path, options = {}) {
    if (path !== BOOK_INTRO_BOOK_PATH || this.unloading) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("找不到《局外人》书籍笔记。");
      return false;
    }
    try {
      const leaf = options.targetLeaf || this.app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true });
      if (!this.unloading) await this.app.workspace.revealLeaf(leaf);
      return true;
    } catch (_) {
      new Notice("无法打开《局外人》书籍笔记。");
      return false;
    }
  }

  async openBookJournalByProtocol(params = {}, options = {}) {
    try {
      const result = await this.bookJournal.openFromProtocol(params, options);
      if (result.created) {
        new Notice(`已创建并打开《${bookTitleFromPath(result.bookPath)}》阅读日记。`);
      }
      return true;
    } catch (error) {
      new Notice(`无法打开阅读日记：${error?.message || "未知错误"}`);
      return false;
    }
  }

  async openDashboard(options = {}) {
    if (this.unloading) return;
    const open = async () => {
      try {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        const leaf = selectPreferredLeaf(options.targetLeaf, existing)
          || this.app.workspace.getLeaf("tab");
        const dashboardState = normalizeDashboardViewState({
          ...(options.state || {}),
          route: options.route || options.state?.route || "home"
        });
        await leaf.setViewState({ type: VIEW_TYPE, state: dashboardState, active: true });
        if (this.unloading) return;
        await this.app.workspace.revealLeaf(leaf);
        return leaf;
      } catch (_) {
        new Notice("无法打开梦藏总览。");
      }
    };
    if (options.targetLeaf) return open();
    if (!this.openingPromise) {
      this.openingPromise = open();
    }
    const openingPromise = this.openingPromise;
    try {
      return await openingPromise;
    } finally {
      if (this.openingPromise === openingPromise) {
        this.openingPromise = null;
      }
    }
  }

  onunload() {
    this.unloading = true;
    hideBookHoverCard();
    if (this.redirectTimer !== null) window.clearTimeout(this.redirectTimer);
    this.redirectTimer = null;
    for (const [leaf] of this.nativeGraphReturns) this.removeNativeGraphReturn(leaf);
    this.nativeGraphReturns.clear();
    this.desktopConnector?.dispose();
    this.bookCuration?.dispose?.();
    this.inspirations?.dispose();
    this.store?.dispose();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(BOOK_INTRO_VIEW_TYPE);
  }
}

MengcangDashboardPlugin.__test = {
  BASE_PATHS,
  INSPIRATION_PAGE_SIZE,
  MengcangStore,
  OVERVIEW_NOTE_PATH,
  PROJECT_REGISTRY_PATH,
  ROOTS,
  filterInspirationRecords,
  homePatternRecords,
  isRelevantPath,
  isInboxInspirationRecord,
  isOrganizedInspirationRecord,
  isSecondLayerRecord,
  normalizeWikiTarget,
  normalizeDashboardViewState,
  normalizeProjectRecords,
  normalizedTextType,
  markdownBody,
  markdownToPlainText,
  canvasContentSubpath,
  snapshotCanvasNodes,
  focusNewCanvasFileNode,
  attachCanvasFileDrag,
  attachBookHoverCard,
  bookHoverProgressInfo,
  bookHoverStatusInfo,
  buildBookHoverCard,
  cleanBookHoverMarkdown,
  collectBookGraphData,
  collectBookHoverData,
  makeNativeBookGraphViewState,
  hideBookHoverCard,
  normalizeBookPdfPath,
  positionBookHoverCard,
  paginateRecords,
  pluginAssetPath,
  pluginAssetUrl,
  projectLabel,
  projectFilterOptions,
  provenanceLabel,
  renderBooksPage,
  renderBookGraphPage,
  renderPatternPage,
  renderTextPage,
  renderWebPage,
  renderStarSeaPage,
  makeWebCard,
  makeWebDetail,
  webStatusMatches,
  safeWebUrl,
  sourceHostname,
  startAutoScroll,
  statusLabel,
  isInspirationRecord,
  textBucket,
  valueToList,
  valueToText
};

module.exports = MengcangDashboardPlugin;
