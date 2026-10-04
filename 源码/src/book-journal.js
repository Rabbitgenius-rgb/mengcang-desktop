"use strict";

const ALLOWED_BOOK_PATH = "01_sources/books/局外人.md";
const ALLOWED_BOOK_TITLE = "局外人";
const BOOK_JOURNAL_FOLDER = "01_sources/reading-journals/局外人";
const JOURNAL_ACTIONS = new Set(["resume", "new"]);
const DEFAULT_PROMPT = "今天，你在哪一刻感到自己像一个局外人？";

function normalizeBookNotePath(value) {
  return value === ALLOWED_BOOK_PATH ? ALLOWED_BOOK_PATH : null;
}

function bookTitleFromPath(value) {
  return normalizeBookNotePath(value) ? ALLOWED_BOOK_TITLE : "";
}

function bookJournalFolderForPath(value) {
  return normalizeBookNotePath(value) ? BOOK_JOURNAL_FOLDER : null;
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeJournalAction(value) {
  const action = textValue(value).toLowerCase();
  return JOURNAL_ACTIONS.has(action) ? action : null;
}

function parseBookJournalProtocolParams(params = {}) {
  if (textValue(params.page) !== "book-journal") return null;
  const bookPath = normalizeBookNotePath(params.book);
  const action = normalizeJournalAction(params.action);
  const folderPath = bookJournalFolderForPath(bookPath);
  if (!bookPath || !action || !folderPath) return null;
  return { bookPath, action, folderPath };
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function localMinuteStamp(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error("无法生成阅读日记时间");
  return [
    value.getFullYear(),
    twoDigits(value.getMonth() + 1),
    twoDigits(value.getDate())
  ].join("-") + `-${twoDigits(value.getHours())}${twoDigits(value.getMinutes())}`;
}

function nextJournalPath(options = {}) {
  const bookPath = normalizeBookNotePath(options.bookPath);
  const folderPath = bookJournalFolderForPath(bookPath);
  const title = bookTitleFromPath(bookPath);
  const exists = typeof options.exists === "function" ? options.exists : () => false;
  if (!bookPath || !folderPath || !title) throw new Error("书籍路径无效");
  const stem = `${localMinuteStamp(options.date)}-${title}`;
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${twoDigits(index + 1)}`;
    const candidate = `${folderPath}/${stem}${suffix}.md`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error("同一分钟内的阅读日记数量超出限制");
}

function isDirectMarkdownChild(file, folderPath) {
  const path = textValue(file?.path);
  if (!path.toLowerCase().endsWith(".md") || !path.startsWith(`${folderPath}/`)) return false;
  return !path.slice(folderPath.length + 1).includes("/");
}

function latestJournalFile(files, folderPath) {
  return [...(Array.isArray(files) ? files : [])]
    .filter((file) => isDirectMarkdownChild(file, folderPath))
    .sort((left, right) => (
      (Number(right?.stat?.mtime) || 0) - (Number(left?.stat?.mtime) || 0)
      || textValue(right?.path).localeCompare(textValue(left?.path), "zh-CN")
    ))[0] || null;
}

function journalFilesInFolder(vault, folderPath) {
  const folder = vault.getAbstractFileByPath(folderPath);
  if (!folder || !Array.isArray(folder.children)) return [];
  return folder.children.filter((entry) => isDirectMarkdownChild(entry, folderPath));
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function makeJournalMarkdown(options = {}) {
  const bookPath = normalizeBookNotePath(options.bookPath);
  const title = bookTitleFromPath(bookPath);
  const createdAt = (options.date instanceof Date ? options.date : new Date(options.date || Date.now())).toISOString();
  if (!bookPath || !title) throw new Error("书籍路径无效");
  const bookLink = `[[${bookPath}|${title}]]`;
  const prompt = textValue(options.prompt) || DEFAULT_PROMPT;
  return [
    "---",
    "type: reading-journal",
    `book: ${yamlString(bookLink)}`,
    `book_path: ${yamlString(bookPath)}`,
    `created_at: ${yamlString(createdAt)}`,
    `updated_at: ${yamlString(createdAt)}`,
    "---",
    `# ${title} · 阅读日记`,
    "",
    `> ${prompt}`,
    "",
    ""
  ].join("\n");
}

function isFileEntry(entry) {
  return Boolean(entry && typeof entry.path === "string" && typeof entry.extension === "string");
}

async function ensureFolder(vault, folderPath) {
  let current = "";
  for (const segment of folderPath.split("/")) {
    current = current ? `${current}/${segment}` : segment;
    const existing = vault.getAbstractFileByPath(current);
    if (isFileEntry(existing)) throw new Error(`无法创建目录：${current} 已是文件`);
    if (!existing) await vault.createFolder(current);
  }
}

class BookJournalService {
  constructor(plugin, options = {}) {
    this.plugin = plugin;
    this.now = typeof options.now === "function" ? options.now : () => new Date();
    this.queue = Promise.resolve();
  }

  openFromProtocol(params = {}, options = {}) {
    const task = async () => {
      const request = parseBookJournalProtocolParams(params);
      if (!request) throw new Error("阅读日记链接无效");
      return this.open(request, options);
    };
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async open(request = {}, options = {}) {
    const normalized = parseBookJournalProtocolParams({
      page: "book-journal",
      book: request.bookPath,
      action: request.action
    });
    if (!normalized) throw new Error("阅读日记链接无效");
    const { bookPath, folderPath, action } = normalized;
    const { vault, workspace } = this.plugin.app;
    const bookFile = vault.getAbstractFileByPath(bookPath);
    if (!isFileEntry(bookFile) || bookFile.extension.toLowerCase() !== "md") {
      throw new Error("找不到对应的书籍笔记");
    }

    let file = action === "resume"
      ? latestJournalFile(journalFilesInFolder(vault, folderPath), folderPath)
      : null;
    let created = false;
    if (!file) {
      const now = this.now();
      await ensureFolder(vault, folderPath);
      const path = nextJournalPath({
        bookPath,
        date: now,
        exists: (candidate) => Boolean(vault.getAbstractFileByPath(candidate))
      });
      file = await vault.create(path, makeJournalMarkdown({ bookPath, date: now }));
      created = true;
    }

    const leaf = options.targetLeaf || workspace.getLeaf?.(false);
    if (leaf?.openFile) {
      await leaf.openFile(file, { active: true });
      await workspace.revealLeaf?.(leaf);
    } else if (workspace.openLinkText) {
      await workspace.openLinkText(file.path, "", true);
    } else {
      throw new Error("当前 Obsidian 工作区无法打开笔记");
    }
    return { action, bookPath, folderPath, file, created };
  }
}

module.exports = {
  ALLOWED_BOOK_PATH,
  ALLOWED_BOOK_TITLE,
  BOOK_JOURNAL_FOLDER,
  JOURNAL_ACTIONS,
  DEFAULT_PROMPT,
  BookJournalService,
  bookJournalFolderForPath,
  bookTitleFromPath,
  ensureFolder,
  isDirectMarkdownChild,
  journalFilesInFolder,
  latestJournalFile,
  localMinuteStamp,
  makeJournalMarkdown,
  nextJournalPath,
  normalizeBookNotePath,
  normalizeJournalAction,
  parseBookJournalProtocolParams
};
