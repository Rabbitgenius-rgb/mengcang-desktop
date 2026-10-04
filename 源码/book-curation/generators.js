"use strict";

const GENERATOR_LOCAL_TEMPLATE = "local-template";
const GENERATOR_LOCAL_MODEL = "local-model";
const DEFAULT_LOCAL_MODEL_TIMEOUT_MS = 12_000;
const MAX_LOCAL_MODEL_TIMEOUT_MS = 60_000;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const QUESTION_STAGES = new Set(["before", "during", "after"]);

const BOOK_PROMPT_METADATA_FIELDS = Object.freeze([
  "title",
  "author",
  "translator",
  "publisher",
  "publishedAt",
  "language",
  "tags",
  "summary"
]);

const STRANGER_TITLES = new Set(["局外人", "异乡人", "the stranger", "l'étranger", "l’etranger", "l'étranger"]);

class BookCurationGenerationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BookCurationGenerationError";
    this.code = code;
    this.details = details;
  }
}

function asText(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("、");
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  return "";
}

function truncateText(value, maxLength) {
  const text = asText(value).replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function redactLocalReferences(value) {
  return asText(value)
    .replace(/file:\/\/\/[^\s)\]}>,]+/gi, "[本地路径已省略]")
    .replace(/(^|[\s"'(])\/(?:Users|home|private|var|Volumes|tmp|opt)\/[^\s"')\]}>,]+/g, "$1[本地路径已省略]")
    .replace(/\b[A-Za-z]:\\[^\s"')\]}>,]+/g, "[本地路径已省略]")
    .replace(/(?:^|[\s"'(])(?:\.\.?\/)?[^\s"')\]}>,]*\.pdf\b/gi, (match) => {
      const prefix = /^[\s"'(]/.test(match) ? match[0] : "";
      return `${prefix}[PDF 已省略]`;
    });
}

function sanitizePromptText(value, maxLength) {
  return truncateText(redactLocalReferences(value), maxLength);
}

function textList(value, maxItems = 8, maxItemLength = 100) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，;；]/)
      : value === null || value === undefined
        ? []
        : [value];
  return values
    .map((item) => sanitizePromptText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function bookTitle(book) {
  return sanitizePromptText(book?.title || book?.name || book?.basename, 140) || "未命名书籍";
}

function sanitizeBookPromptMetadata(book = {}) {
  const metadata = { title: bookTitle(book) };
  const author = textList(book.author ?? book.authors, 6, 100);
  const translator = textList(book.translator ?? book.translators, 6, 100);
  const publisher = sanitizePromptText(book.publisher, 120);
  const publishedAt = sanitizePromptText(book.publishedAt ?? book.published_at, 40);
  const language = sanitizePromptText(book.language, 40);
  const tags = textList(book.tags, 12, 80);
  const summary = sanitizePromptText(book.summary ?? book.description, 600);

  if (author.length) metadata.author = author;
  if (translator.length) metadata.translator = translator;
  if (publisher) metadata.publisher = publisher;
  if (publishedAt) metadata.publishedAt = publishedAt;
  if (language) metadata.language = language;
  if (tags.length) metadata.tags = tags;
  if (summary) metadata.summary = summary;
  return metadata;
}

function templateQuestion(id, stage, title, text) {
  return {
    id,
    stage,
    readingStage: stage,
    text: text.replaceAll("{BOOK}", `《${title}》`),
    spoiler: stage === "after",
    spoilerLevel: stage === "after" ? "mild" : "none"
  };
}

function buildTemplateBookCuration(book = {}) {
  const title = bookTitle(book);
  return {
    schemaVersion: 1,
    bookTitle: title,
    curatorialLines: [{
      id: "template-curatorial-line-1",
      text: `读《${title}》时，不妨留意：它最希望你重新命名的经验，可能正是你最习以为常的部分。`,
      label: "模板策展引思句（非原文）",
      kind: "curatorial_prompt",
      sourceType: "ai_generated",
      source: "local-template",
      isSourceQuote: false,
      spoilerLevel: "none"
    }],
    questions: [
      templateQuestion("template-before-1", "before", title, "在翻开{BOOK}之前，你最希望它帮助你重新理解什么？"),
      templateQuestion("template-before-2", "before", title, "仅从书名与已有印象出发，你认为{BOOK}会挑战你的哪一种预设？"),
      templateQuestion("template-during-1", "during", title, "读到目前，{BOOK}中哪一种矛盾最值得你暂时不急着下结论？"),
      templateQuestion("template-during-2", "during", title, "如果删去{BOOK}中一个反复出现的意象、人物或论点，你对全书的理解会怎样改变？"),
      templateQuestion("template-after-1", "after", title, "读完{BOOK}后，你原先的哪个判断发生了变化，哪个判断反而更坚定？"),
      templateQuestion("template-after-2", "after", title, "如果把{BOOK}连接到你已有的一则笔记或一件作品，最有解释力的连接会是什么？")
    ],
    relatedWorks: [],
    generation: {
      generator: GENERATOR_LOCAL_TEMPLATE,
      status: "ready",
      source: "generic-template",
      note: "通用本地模板未提出具体作品，避免把未经核验的作品当作事实。"
    }
  };
}

function isTheStranger(book = {}) {
  const title = bookTitle(book).toLocaleLowerCase("fr");
  return STRANGER_TITLES.has(title);
}

function strangerQuestion(id, stage, text, spoiler = false) {
  return {
    id,
    stage,
    readingStage: stage,
    text,
    spoiler,
    spoilerLevel: spoiler ? "full" : "none"
  };
}

function strangerWork(id, title, creator, officialUrl, association, workType = "painting") {
  return {
    id,
    title,
    creator,
    kind: workType,
    workType,
    officialUrl,
    association,
    rationale: association,
    relationType: "curatorial_association",
    relationKind: "curatorial_association",
    historicalInfluenceClaim: false,
    resolution: { kind: "new_note" },
    source: {
      catalogUrl: officialUrl,
      catalogTitle: title
    },
    imageRights: { reuseStatus: "unknown" },
    runtimeLinkVerified: false,
    verificationNote: "策展联想；馆藏链接来自内置示例，未由运行时核验，也不代表作品直接受《局外人》影响。"
  };
}

function buildBuiltInBookCuration(book = {}) {
  if (!isTheStranger(book)) return null;
  return {
    schemaVersion: 1,
    bookTitle: bookTitle(book),
    curatorialLines: [{
      id: "stranger-curatorial-line-1",
      text: "一个不愿解释自己的人，也可能把定义自己的权利交给别人。",
      label: "内置策展引思句（原创，非加缪原文）",
      kind: "curatorial_prompt",
      sourceType: "ai_generated",
      source: "mengcang-built-in-example",
      isSourceQuote: false,
      spoilerLevel: "none"
    }],
    questions: [
      strangerQuestion("stranger-before-1", "before", "如果一个人拒绝表演社会期待的悲伤，他是诚实，还是有罪？"),
      strangerQuestion("stranger-before-2", "before", "默尔索的冷漠究竟是性格缺陷，还是一种拒绝虚伪的方式？"),
      strangerQuestion("stranger-before-3", "before", "一个人应该因为行为被审判，还是因为“不像正常人”被审判？"),
      strangerQuestion("stranger-during-1", "during", "小说中的阳光、炎热和身体感觉，为什么不断影响默尔索的决定？"),
      strangerQuestion("stranger-during-2", "during", "加缪为什么用如此平静的语气叙述死亡与暴力？"),
      strangerQuestion("stranger-during-3", "during", "法庭真正审判的是那场犯罪，还是默尔索没有在母亲葬礼上哭？", true),
      strangerQuestion("stranger-after-1", "after", "默尔索最后接受“荒诞”，是获得了自由，还是彻底陷入绝望？", true),
      strangerQuestion("stranger-after-2", "after", "你是否也曾因为一个人没有表现出“正确的情绪”而判断他？", true)
    ],
    relatedWorks: [
      strangerWork(
        "stranger-nighthawks",
        "《夜游者》（Nighthawks）",
        "爱德华·霍普",
        "https://archive.artic.edu/hopper/artwork/111628",
        "人物共处一室却彼此难以抵达，可作为理解疏离感的视觉入口。"
      ),
      strangerWork(
        "stranger-people-in-the-sun",
        "《阳光下的人们》（People in the Sun）",
        "爱德华·霍普",
        "https://americanart.si.edu/artwork/people-sun-10762",
        "阳光、身体与静止之间的张力，可与小说中感官经验对行动的影响并置。"
      ),
      strangerWork(
        "stranger-monk-by-the-sea",
        "《海边的僧侣》（The Monk by the Sea）",
        "卡斯帕·大卫·弗里德里希",
        "https://www.smb.museum/en/museums-institutions/alte-nationalgalerie/collection-research/conservation-care/caspar-david-friedrich-project/",
        "人与沉默世界之间的尺度差异，可引向自由、被遗弃与世界无回应的问题。"
      ),
      strangerWork(
        "stranger-burial-at-ornans",
        "《奥尔南的葬礼》（A Burial at Ornans）",
        "古斯塔夫·库尔贝",
        "https://www.musee-orsay.fr/en/artworks/un-enterrement-ornans-924",
        "公共葬礼中的情感礼仪，可与社会如何规定一个人应该怎样悲伤并置。"
      ),
      strangerWork(
        "stranger-song-of-love",
        "《爱之歌》（The Song of Love）",
        "乔治·德·基里科",
        "https://www.moma.org/collection/works/80419",
        "熟悉事物失去通常因果关系后的陌生感，可作为进入荒诞主题的视觉线索。"
      ),
      strangerWork(
        "stranger-menaced-assassin",
        "《受威胁的凶手》（The Menaced Assassin）",
        "勒内·马格利特",
        "https://www.moma.org/collection/works/79267",
        "观看者如何拼接犯罪叙事，可与法庭替一个人解释动机的过程互相照亮。"
      ),
      strangerWork(
        "stranger-women-of-algiers",
        "《阿尔及尔的女人》（Women of Algiers）",
        "欧仁·德拉克洛瓦",
        "https://collections.louvre.fr/ark:/53355/cl010065869",
        "作为殖民凝视的讨论入口，提醒读者追问小说中谁拥有姓名、声音与被理解的权利。"
      )
    ],
    generation: {
      generator: GENERATOR_LOCAL_TEMPLATE,
      status: "ready",
      source: "mengcang-built-in-example",
      note: "内置策展示例；引思句不是小说原文，作品关系均为未运行时核验的策展联想。"
    }
  };
}

function buildFallbackBookCuration(book = {}, settings = {}) {
  if (settings.useBuiltInExamples !== false) {
    const builtIn = buildBuiltInBookCuration(book);
    if (builtIn) return builtIn;
  }
  return buildTemplateBookCuration(book);
}

function validateLocalEndpoint(endpoint) {
  let url;
  try {
    url = new URL(asText(endpoint));
  } catch (_) {
    throw new BookCurationGenerationError("INVALID_ENDPOINT", "本地模型 endpoint 不是有效 URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new BookCurationGenerationError("INVALID_ENDPOINT", "本地模型 endpoint 仅允许 http 或 https");
  }
  if (!LOCAL_HOSTNAMES.has(url.hostname.toLocaleLowerCase("en-US"))) {
    throw new BookCurationGenerationError("NON_LOCAL_ENDPOINT", "本地模型 endpoint 仅允许 localhost、127.0.0.1 或 [::1]");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new BookCurationGenerationError("INVALID_ENDPOINT", "本地模型 endpoint 不允许凭据、查询参数或片段");
  }
  const cleanPath = url.pathname.replace(/\/+$/, "");
  if (!cleanPath) url.pathname = "/v1/chat/completions";
  else if (cleanPath === "/v1") url.pathname = "/v1/chat/completions";
  else url.pathname = cleanPath;
  return url.toString();
}

function buildLocalModelPrompt(book = {}) {
  const metadata = sanitizeBookPromptMetadata(book);
  const schemaExample = {
    curatorialLines: [{
      text: "一句策展引思句",
      label: "AI 策展引思句（非原文）",
      kind: "curatorial_prompt",
      sourceType: "ai_generated",
      spoilerLevel: "none"
    }],
    questions: [
      { readingStage: "before", spoilerLevel: "none", text: "问题" },
      { readingStage: "before", spoilerLevel: "none", text: "问题" },
      { readingStage: "during", spoilerLevel: "none", text: "问题" },
      { readingStage: "during", spoilerLevel: "mild", text: "问题" },
      { readingStage: "after", spoilerLevel: "full", text: "问题" },
      { readingStage: "after", spoilerLevel: "full", text: "问题" }
    ],
    relatedWorks: [{
      title: "真实存在的作品名称",
      creator: "创作者",
      workType: "painting",
      year: "可选年份",
      relationKind: "curatorial_association",
      rationale: "仅说明策展联想，不声称直接影响",
      resolution: { kind: "new_note" },
      source: { catalogUrl: "真实存在的官方馆藏 URL" },
      imageRights: { reuseStatus: "unknown" }
    }]
  };
  return [
    "你是梦藏的阅读策展助手。只根据下面给出的白名单书籍元数据生成阅读引线。",
    "必须只返回一个合法 JSON 对象，不要 Markdown、代码围栏、前后说明或原文摘录。",
    "curatorialLines 必须恰好 1 条，并明确标注为 AI 策展引思句（非原文），不得冒充作者原话。",
    "questions 必须恰好 6 条：readingStage 为 before、during、after 各 2 条，并设置 spoilerLevel 为 none、mild 或 full；问题应具体、开放且包含书名。",
    "relatedWorks 只能列出你确信真实存在且能给出官方馆藏 catalogUrl 的作品，relationKind 必须是 curatorial_association；不确定时返回空数组。不得声称链接已核验。",
    `JSON 结构：${JSON.stringify(schemaExample)}`,
    `书籍元数据：${JSON.stringify(metadata)}`
  ].join("\n");
}

function normalizeTimeout(value) {
  const timeout = Number(value ?? DEFAULT_LOCAL_MODEL_TIMEOUT_MS);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > MAX_LOCAL_MODEL_TIMEOUT_MS) {
    throw new BookCurationGenerationError("INVALID_TIMEOUT", `timeoutMs 必须在 1 到 ${MAX_LOCAL_MODEL_TIMEOUT_MS} 之间`);
  }
  return Math.floor(timeout);
}

function normalizeModel(value) {
  const model = truncateText(value, 160);
  if (!model) throw new BookCurationGenerationError("MODEL_REQUIRED", "本地模型名称不能为空");
  return model;
}

function safeOfficialUrl(value) {
  const text = truncateText(value, 600);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function normalizeLocalModelDraft(raw, book = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BookCurationGenerationError("INVALID_MODEL_JSON", "本地模型返回值必须是 JSON 对象");
  }
  if (!Array.isArray(raw.curatorialLines) || raw.curatorialLines.length !== 1) {
    throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", "curatorialLines 必须恰好包含一条内容");
  }
  const lineText = truncateText(raw.curatorialLines[0]?.text, 320);
  if (!lineText) throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", "策展引思句不能为空");

  if (!Array.isArray(raw.questions) || raw.questions.length !== 6) {
    throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", "questions 必须恰好包含六个问题");
  }
  const stageCounts = { before: 0, during: 0, after: 0 };
  const questions = raw.questions.map((question, index) => {
    const stage = asText(question?.readingStage || question?.stage).toLocaleLowerCase("en-US");
    const text = truncateText(question?.text, 360);
    if (!QUESTION_STAGES.has(stage) || !text) {
      throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", `第 ${index + 1} 个问题缺少有效 stage 或 text`);
    }
    stageCounts[stage] += 1;
    return {
      id: `local-model-${stage}-${stageCounts[stage]}`,
      stage,
      readingStage: stage,
      text,
      spoiler: stage === "after" ? question?.spoiler !== false : Boolean(question?.spoiler),
      spoilerLevel: ["none", "mild", "full"].includes(asText(question?.spoilerLevel))
        ? asText(question.spoilerLevel)
        : stage === "after" ? "full" : "none"
    };
  });
  if (Object.values(stageCounts).some((count) => count !== 2)) {
    throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", "before、during、after 必须各有两个问题");
  }

  const rawWorks = raw.relatedWorks === undefined ? [] : raw.relatedWorks;
  if (!Array.isArray(rawWorks) || rawWorks.length > 8) {
    throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", "relatedWorks 必须是最多八项的数组");
  }
  const relatedWorks = rawWorks.map((work, index) => {
    const title = truncateText(work?.title, 180);
    const creator = truncateText(work?.creator, 140);
    const rationale = truncateText(work?.rationale || work?.association, 500);
    const catalogUrl = safeOfficialUrl(work?.source?.catalogUrl || work?.officialUrl);
    const workType = truncateText(work?.workType || work?.kind, 80) || "artwork";
    if (!title || !creator || !rationale || !catalogUrl) {
      throw new BookCurationGenerationError("INVALID_MODEL_SCHEMA", `第 ${index + 1} 个作品候选缺少 title、creator、rationale 或官方 catalogUrl`);
    }
    return {
      id: `local-model-work-${index + 1}`,
      title,
      creator,
      kind: workType,
      workType,
      year: truncateText(work?.year, 40),
      officialUrl: catalogUrl,
      association: rationale,
      rationale,
      relationType: "curatorial_association",
      relationKind: "curatorial_association",
      historicalInfluenceClaim: false,
      resolution: { kind: "new_note" },
      source: {
        catalogUrl,
        catalogTitle: truncateText(work?.source?.catalogTitle, 180) || title,
        institution: truncateText(work?.source?.institution, 140)
      },
      imageRights: { reuseStatus: "unknown" },
      runtimeLinkVerified: false,
      verificationNote: "本地模型提出的策展联想；作品与链接未由运行时核验。"
    };
  });

  return {
    schemaVersion: 1,
    bookTitle: bookTitle(book),
    curatorialLines: [{
      id: "local-model-curatorial-line-1",
      text: lineText,
      label: "AI 策展引思句（非原文）",
      kind: "curatorial_prompt",
      sourceType: "ai_generated",
      source: "local-model",
      isSourceQuote: false,
      spoilerLevel: "none"
    }],
    questions,
    relatedWorks,
    generation: {
      generator: GENERATOR_LOCAL_MODEL,
      status: "ready",
      source: "localhost-openai-compatible",
      note: "内容由本地主机模型生成；作品及链接未由运行时核验。"
    }
  };
}

function extractOpenAIContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new BookCurationGenerationError("INVALID_MODEL_RESPONSE", "本地模型响应缺少 choices[0].message.content");
  }
  try {
    return JSON.parse(content);
  } catch (_) {
    throw new BookCurationGenerationError("INVALID_MODEL_JSON", "本地模型必须返回不带代码围栏的严格 JSON");
  }
}

async function defaultRequestJson(spec) {
  if (typeof globalThis.fetch !== "function") {
    throw new BookCurationGenerationError("REQUEST_UNAVAILABLE", "当前运行时没有 fetch，请注入 runtime.requestJson");
  }
  const response = await globalThis.fetch(spec.url, {
    method: spec.method,
    headers: spec.headers,
    body: spec.body,
    signal: spec.signal,
    redirect: "error"
  });
  const text = await response.text();
  if (!response.ok) {
    throw new BookCurationGenerationError("LOCAL_MODEL_HTTP_ERROR", `本地模型请求失败（HTTP ${response.status}）`);
  }
  try {
    return { status: response.status, url: response.url, json: JSON.parse(text) };
  } catch (_) {
    throw new BookCurationGenerationError("INVALID_HTTP_JSON", "本地模型 HTTP 响应不是合法 JSON");
  }
}

function responsePayload(response) {
  if (!response || typeof response !== "object") {
    throw new BookCurationGenerationError("INVALID_MODEL_RESPONSE", "本地模型没有返回 JSON 响应");
  }
  if (Number(response.status) >= 400) {
    throw new BookCurationGenerationError("LOCAL_MODEL_HTTP_ERROR", `本地模型请求失败（HTTP ${Number(response.status)}）`);
  }
  if (response.url) validateLocalEndpoint(response.url);
  if (response.json && typeof response.json === "object") return response.json;
  return response;
}

async function requestWithTimeout(requestJson, spec, timeoutMs) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new BookCurationGenerationError("LOCAL_MODEL_TIMEOUT", `本地模型请求超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => requestJson({ ...spec, signal: controller.signal, redirect: "error" })),
      timeout
    ]);
  } catch (error) {
    if (error instanceof BookCurationGenerationError) throw error;
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new BookCurationGenerationError("LOCAL_MODEL_TIMEOUT", `本地模型请求超过 ${timeoutMs}ms`);
    }
    throw new BookCurationGenerationError("LOCAL_MODEL_REQUEST_FAILED", "无法连接本地主机模型", {
      cause: asText(error?.message || error).slice(0, 240)
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createLocalOpenAICompatibleAdapter(settings = {}, runtime = {}) {
  const endpoint = validateLocalEndpoint(settings.endpoint);
  const model = normalizeModel(settings.model);
  const timeoutMs = normalizeTimeout(settings.timeoutMs);
  const requestJson = typeof runtime.requestJson === "function" ? runtime.requestJson : defaultRequestJson;

  return {
    endpoint,
    model,
    timeoutMs,
    async generate(book = {}) {
      const prompt = buildLocalModelPrompt(book);
      const requestBody = {
        model,
        temperature: 0.7,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "只返回符合用户指定结构的严格 JSON；不要引用未提供的书籍原文。" },
          { role: "user", content: prompt }
        ]
      };
      const response = await requestWithTimeout(requestJson, {
        url: endpoint,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }, timeoutMs);
      return normalizeLocalModelDraft(extractOpenAIContent(responsePayload(response)), book);
    }
  };
}

function fallbackReason(error) {
  if (error instanceof BookCurationGenerationError) return error.code;
  return "LOCAL_MODEL_FAILED";
}

async function generateBookCuration(book = {}, settings = {}, runtime = {}) {
  const generator = asText(settings.generator) || GENERATOR_LOCAL_TEMPLATE;
  const fallback = buildFallbackBookCuration(book, settings);
  if (generator === GENERATOR_LOCAL_TEMPLATE) return fallback;
  if (generator !== GENERATOR_LOCAL_MODEL) {
    throw new BookCurationGenerationError("UNKNOWN_GENERATOR", `未知书籍策展生成器：${generator}`);
  }
  try {
    const adapter = createLocalOpenAICompatibleAdapter(settings, runtime);
    return await adapter.generate(book);
  } catch (error) {
    if (settings.fallbackOnError === false) throw error;
    return {
      ...fallback,
      generation: {
        ...fallback.generation,
        status: "fallback",
        requestedGenerator: GENERATOR_LOCAL_MODEL,
        fallbackReason: fallbackReason(error)
      }
    };
  }
}

module.exports = {
  BOOK_PROMPT_METADATA_FIELDS,
  DEFAULT_LOCAL_MODEL_TIMEOUT_MS,
  GENERATOR_LOCAL_MODEL,
  GENERATOR_LOCAL_TEMPLATE,
  BookCurationGenerationError,
  buildBuiltInBookCuration,
  buildFallbackBookCuration,
  buildLocalModelPrompt,
  buildTemplateBookCuration,
  createLocalOpenAICompatibleAdapter,
  generateBookCuration,
  normalizeLocalModelDraft,
  sanitizeBookPromptMetadata,
  validateLocalEndpoint
};
