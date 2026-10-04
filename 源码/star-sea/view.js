const { Notice } = require("obsidian");
const { previewExcerpt } = require("./core");

const SVG_NS = "http://www.w3.org/2000/svg";
const KIND_LABELS = {
  book: "图书",
  text: "文本",
  pattern: "图案",
  web: "网页"
};
const DARK_SLOTS = [
  { x: 81, y: 23, path: "M500 310 C630 278 690 150 810 142" },
  { x: 82, y: 66, path: "M500 310 C650 322 710 416 820 409" },
  { x: 29, y: 77, path: "M500 310 C430 405 344 470 290 477" }
];
const LIT_SLOTS = [
  { x: 21, y: 24, path: "M500 310 C392 272 322 162 210 148" },
  { x: 18, y: 57, path: "M500 310 C365 315 284 356 180 353" },
  { x: 54, y: 87, path: "M500 310 C505 414 538 474 540 538" }
];
const paletteCache = new Map();

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, label = text) {
  const node = element("button", className, text);
  node.type = "button";
  if (label) node.setAttribute("aria-label", label);
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function pathOf(value) {
  return value?.path || value?.file?.path || value?.target?.path || value?.targetPath || value?.peerPath || "";
}

function titleOf(value) {
  return value?.title || value?.target?.title || value?.peerTitle || pathOf(value).split("/").pop()?.replace(/\.md$/i, "") || "未命名资料";
}

function excerptCard(label, record) {
  const card = element("article", "mengcang-star-sea__excerpt");
  card.append(
    element("strong", "mengcang-star-sea__excerpt-title", `${label} · ${titleOf(record)}`),
    element("blockquote", "", previewExcerpt(record))
  );
  return card;
}

function candidateTarget(candidate, byPath) {
  if (candidate?.target?.path) return candidate.target;
  return byPath.get(candidate?.targetPath || candidate?.path || "") || null;
}

function relationPeer(relation, byPath) {
  if (relation?.peer?.path) return relation.peer;
  return byPath.get(relation?.peerPath || relation?.targetPath || relation?.peer || "") || null;
}

function relationId(relation) {
  return relation?.relationId || relation?.id || "";
}

function relationExplanation(relation) {
  return relation?.explanation || relation?.description || relation?.summary || "";
}

function stableNumber(textValue) {
  const text = String(textValue || "");
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function passivePosition(path, index) {
  const hash = stableNumber(`${path}:${index}`);
  let x = 7 + (hash % 86);
  let y = 8 + ((hash >>> 8) % 82);
  if (x > 39 && x < 62 && y > 32 && y < 67) {
    x = x < 50 ? x - 18 : x + 18;
  }
  return { x: Math.max(5, Math.min(95, x)), y: Math.max(6, Math.min(94, y)) };
}

function starCorpus(service, snapshot) {
  if (typeof service?.buildCorpus === "function") return service.buildCorpus(snapshot);
  return [
    ...(snapshot.textCards || []),
    ...(snapshot.books || []),
    ...(snapshot.patterns || []).filter((record) => !record.isAtlas),
    ...(snapshot.webClips || []).filter((record) => !record.isExample)
  ].filter((record) => pathOf(record));
}

function matchesQuery(record, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return true;
  return [record.title, record.kind, record.tags, record.theme, record.summary, record.bodyText, record.path]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(normalized);
}

function setCanvasSelected(state, targetPath, selected) {
  if (!(state.starCanvasPaths instanceof Set)) state.starCanvasPaths = new Set();
  if (selected) state.starCanvasPaths.add(targetPath);
  else state.starCanvasPaths.delete(targetPath);
}

function addCanvasToggle(parent, state, target) {
  const row = element("label", "mengcang-star-sea__canvas-toggle");
  const input = element("input");
  input.type = "checkbox";
  input.checked = state.starCanvasPaths instanceof Set && state.starCanvasPaths.has(target.path);
  input.addEventListener("change", () => {
    setCanvasSelected(state, target.path, input.checked);
    state.requestRender();
  });
  row.append(input, element("span", "", "把这颗星带入白板"));
  parent.appendChild(row);
}

function revealReview(panel, focusNode) {
  window.setTimeout(() => {
    if (!panel.isConnected) return;
    panel.scrollIntoView({ block: "nearest", behavior: "auto" });
    focusNode?.focus({ preventScroll: true });
  }, 0);
}

async function sampleCoverPalette(url) {
  if (!url) return null;
  if (paletteCache.has(url)) return paletteCache.get(url);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, 24, 24);
        const pixels = context.getImageData(0, 0, 24, 24).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 16) {
          if (pixels[index + 3] < 120) continue;
          const brightness = pixels[index] + pixels[index + 1] + pixels[index + 2];
          if (brightness < 42 || brightness > 735) continue;
          red += pixels[index];
          green += pixels[index + 1];
          blue += pixels[index + 2];
          count += 1;
        }
        if (!count) return resolve(null);
        const rgb = [red, green, blue].map((channel) => Math.round(channel / count));
        resolve({
          core: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
          glow: `rgb(${Math.min(255, rgb[0] + 58)} ${Math.min(255, rgb[1] + 58)} ${Math.min(255, rgb[2] + 58)})`
        });
      } catch (_) {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  paletteCache.set(url, promise);
  return promise;
}

function applyRecordPalette(node, record) {
  node.dataset.kind = record.kind || "text";
  if (record.kind !== "book" || !record.cover) return;
  void sampleCoverPalette(record.cover).then((palette) => {
    if (!palette || !node.isConnected) return;
    node.style.setProperty("--star-core", palette.core);
    node.style.setProperty("--star-glow", palette.glow);
  });
}

function drawRelation(svg, item, slot, state, kind, onSelect) {
  const selected = kind === "dark"
    ? state.selectedStarTargetPath === pathOf(item)
    : state.selectedStarRelationId === relationId(item);
  const main = svgElement("path", {
    d: slot.path,
    class: `mengcang-star-sea__path is-${kind}${selected ? " is-selected" : ""}`,
    tabindex: "0",
    role: "button",
    "aria-label": kind === "dark"
      ? `查看暗线：${titleOf(item)}`
      : `查看已点亮关系：${titleOf(item)}`
  });
  const activate = (event) => {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    onSelect();
  };
  main.addEventListener("click", activate);
  main.addEventListener("keydown", activate);
  const flow = svgElement("path", {
    d: slot.path,
    class: `mengcang-star-sea__flow is-${kind}`,
    "aria-hidden": "true"
  });
  svg.append(main, flow);
}

function makeStarNode(record, slot, className, onActivate, selectedForCanvas = false) {
  const node = button(
    `mengcang-star-sea__node ${className}${selectedForCanvas ? " is-canvas-selected" : ""}`,
    "",
    `${KIND_LABELS[record.kind] || "资料"}：${record.title}`
  );
  node.style.left = `${slot.x}%`;
  node.style.top = `${slot.y}%`;
  node.append(
    element("span", "mengcang-star-sea__node-orb"),
    element("span", "mengcang-star-sea__node-kind", KIND_LABELS[record.kind] || "资料"),
    element("span", "mengcang-star-sea__node-title", record.title)
  );
  applyRecordPalette(node, record);
  node.addEventListener("click", onActivate);
  return node;
}

function reviewCandidate(plugin, service, state, anchor, target, candidate) {
  const panel = element("aside", "mengcang-star-sea__review is-dark");
  panel.tabIndex = -1;
  panel.append(
    element("span", "mengcang-star-sea__status", "暗线 · 待确认"),
    element("h3", "", `${anchor.title} ↔ ${target.title}`),
    element("p", "mengcang-star-sea__review-note", "这只是候选，不会进入 Markdown 或关系图谱。")
  );
  const excerpts = element("div", "mengcang-star-sea__excerpts");
  excerpts.append(
    excerptCard("基点内容", anchor),
    excerptCard("候选内容", target)
  );
  panel.appendChild(excerpts);
  const label = element("label", "mengcang-star-sea__editor");
  label.appendChild(element("span", "", "本地候选依据 · 一句话说明（可以修改）"));
  const textarea = element("textarea");
  textarea.rows = 3;
  textarea.maxLength = 240;
  textarea.value = candidate.explanation || candidate.explanationDraft || "";
  label.appendChild(textarea);
  panel.appendChild(label);
  addCanvasToggle(panel, state, target);

  const actions = element("div", "mengcang-star-sea__review-actions");
  const ignore = button("", "忽略这条暗线", `忽略与${target.title}的候选联系`);
  ignore.addEventListener("click", async () => {
    ignore.disabled = true;
    try {
      await service.ignoreCandidate(anchor, target);
      state.selectedStarTargetPath = "";
      state.requestRender();
    } catch (error) {
      new Notice(`无法忽略候选：${error?.message || "未知错误"}`);
      ignore.disabled = false;
    }
  });
  const confirm = button("is-primary", "确认并点亮", `确认并双向写入${target.title}`);
  confirm.addEventListener("click", async () => {
    const explanation = textarea.value.replace(/\s+/g, " ").trim();
    if (!explanation) {
      new Notice("请先保留或填写一句关系说明。");
      textarea.focus();
      return;
    }
    confirm.disabled = true;
    ignore.disabled = true;
    try {
      const result = await service.confirmRelation(anchor, target, explanation, "local_confirmed");
      state.selectedStarTargetPath = "";
      state.selectedStarRelationId = result?.relationId || result?.id || "";
      await plugin.store.refreshNow();
      new Notice("关系已点亮，并以同一关系 ID 双向写入两篇笔记。");
    } catch (error) {
      new Notice(`点亮失败：${error?.message || "未改动笔记"}`);
      confirm.disabled = false;
      ignore.disabled = false;
    }
  });
  actions.append(ignore, confirm);
  panel.appendChild(actions);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    state.selectedStarTargetPath = "";
    state.requestRender();
  });
  revealReview(panel, textarea);
  return panel;
}

function reviewConfirmed(plugin, service, state, anchor, peer, relation) {
  const panel = element("aside", "mengcang-star-sea__review is-lit");
  panel.tabIndex = -1;
  panel.append(
    element("span", "mengcang-star-sea__status", "亮线 · 已写入"),
    element("h3", "", `${anchor.title} ↔ ${peer.title}`),
    element("p", "mengcang-star-sea__review-note", "这条联系已存在于两篇 Markdown，因此也会进入 Obsidian Graph。")
  );
  const excerpts = element("div", "mengcang-star-sea__excerpts");
  excerpts.append(
    excerptCard("基点内容", anchor),
    excerptCard("已连接内容", peer)
  );
  panel.appendChild(excerpts);
  const label = element("label", "mengcang-star-sea__editor");
  label.appendChild(element("span", "", "关系说明"));
  const textarea = element("textarea");
  textarea.rows = 3;
  textarea.maxLength = 240;
  textarea.value = relationExplanation(relation);
  label.appendChild(textarea);
  panel.appendChild(label);
  addCanvasToggle(panel, state, peer);

  const actions = element("div", "mengcang-star-sea__review-actions");
  const remove = button("is-danger", "撤回亮线", `从两篇笔记撤回与${peer.title}的关系`);
  const update = button("is-primary", "保存说明", "把修改后的说明同步到两篇笔记");
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    update.disabled = true;
    try {
      await service.removeRelation(anchor, relationId(relation));
      state.selectedStarRelationId = "";
      setCanvasSelected(state, peer.path, false);
      await plugin.store.refreshNow();
      new Notice("亮线已从两篇笔记同步撤回。");
    } catch (error) {
      new Notice(`撤回失败：${error?.message || "请检查关系完整性"}`);
      remove.disabled = false;
      update.disabled = false;
    }
  });
  update.addEventListener("click", async () => {
    const explanation = textarea.value.replace(/\s+/g, " ").trim();
    if (!explanation) {
      new Notice("关系说明不能为空。");
      textarea.focus();
      return;
    }
    remove.disabled = true;
    update.disabled = true;
    try {
      await service.updateRelation(anchor, relationId(relation), explanation);
      await plugin.store.refreshNow();
      new Notice("关系说明已同步更新到两篇笔记。");
    } catch (error) {
      new Notice(`更新失败：${error?.message || "未覆盖原内容"}`);
      remove.disabled = false;
      update.disabled = false;
    }
  });
  actions.append(remove, update);
  panel.appendChild(actions);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    state.selectedStarRelationId = "";
    state.requestRender();
  });
  revealReview(panel, textarea);
  return panel;
}

function makeManualPanel(plugin, service, state, anchor, corpus, confirmed) {
  const panel = element("section", "mengcang-star-sea__manual");
  const header = element("div", "mengcang-star-sea__manual-header");
  header.append(
    element("div", "", "手动牵线"),
    element("p", "", "选择另一篇真实笔记，仍需由你确认后才会双向写入。")
  );
  const confirmedPaths = new Set(confirmed.map((relation) => pathOf(relation.peer || { path: relation.peerPath })));
  const targets = corpus.filter((record) => record.path !== anchor.path && !confirmedPaths.has(record.path));
  const select = element("select");
  select.setAttribute("aria-label", "选择要手动连接的笔记");
  const placeholder = element("option", "", "选择一颗星…");
  placeholder.value = "";
  select.appendChild(placeholder);
  for (const target of targets) {
    const option = element("option", "", `${KIND_LABELS[target.kind] || "资料"} · ${target.title}`);
    option.value = target.path;
    option.selected = target.path === state.starManualTargetPath;
    select.appendChild(option);
  }
  const textarea = element("textarea");
  textarea.rows = 2;
  textarea.maxLength = 240;
  textarea.placeholder = "用一句话说明你为什么要连接它们";
  select.addEventListener("change", () => {
    state.starManualTargetPath = select.value;
    const target = corpus.find((record) => record.path === select.value);
    if (target && !textarea.value && typeof service.explainPair === "function") {
      textarea.value = service.explainPair(anchor, target);
    }
  });
  const confirm = button("is-primary", "确认并点亮手动联系", "把手动关系双向写入两篇笔记");
  confirm.addEventListener("click", async () => {
    const target = corpus.find((record) => record.path === select.value);
    const explanation = textarea.value.replace(/\s+/g, " ").trim();
    if (!target) {
      new Notice("请先选择另一篇笔记。");
      select.focus();
      return;
    }
    if (!explanation) {
      new Notice("请先写一句关系说明。");
      textarea.focus();
      return;
    }
    confirm.disabled = true;
    try {
      const result = await service.confirmRelation(anchor, target, explanation, "manual");
      state.selectedStarRelationId = result?.relationId || result?.id || "";
      state.starManualTargetPath = "";
      setCanvasSelected(state, target.path, true);
      await plugin.store.refreshNow();
      new Notice("手动关系已点亮并双向写入。");
    } catch (error) {
      new Notice(`连接失败：${error?.message || "未改动笔记"}`);
      confirm.disabled = false;
    }
  });
  panel.append(header, select, textarea, confirm);
  return panel;
}

function makeCanvasBar(plugin, service, state, anchor, corpus, confirmed) {
  const bar = element("section", "mengcang-star-sea__canvas-bar");
  const selectedPaths = state.starCanvasPaths instanceof Set ? state.starCanvasPaths : new Set();
  const selected = corpus.filter((record) => selectedPaths.has(record.path) && record.path !== anchor.path);
  const copy = element("div", "");
  copy.append(
    element("strong", "", `白板星群 · ${selected.length} 颗已选`),
    element("span", "", "亮线会成为白板边；尚未点亮的暗线只作为无边素材节点。")
  );
  const create = button("is-primary", selected.length ? "进入白板创作" : "先选择想带走的星", "创建并打开梦藏星海白板");
  create.disabled = selected.length === 0;
  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      const selectedSet = new Set(selected.map((record) => record.path));
      const edges = confirmed.filter((relation) => {
        const peer = relationPeer(relation, new Map(corpus.map((record) => [record.path, record])));
        return peer && selectedSet.has(peer.path);
      });
      const result = await service.createCanvas(anchor, selected, edges);
      new Notice(`已创建并打开白板：${result?.path || "梦藏星海"}`);
    } catch (error) {
      new Notice(`无法创建白板：${error?.message || "请检查 Vault 路径"}`);
      create.disabled = false;
    }
  });
  bar.append(copy, create);
  return bar;
}

function makeRepairPanel(plugin, service, state, pending) {
  const panel = element("section", "mengcang-star-sea__repair");
  const copy = element("div", "");
  copy.append(
    element("strong", "", "发现一笔未完成的双向关系事务"),
    element("span", "", "在它被补齐或撤回之前，梦藏会暂停新的关系写入，避免留下单边链接。")
  );
  const actions = element("div", "mengcang-star-sea__repair-actions");
  const rollback = button("", "撤回已写入的一端", "回滚未完成的关系事务");
  const complete = button("is-primary", "补齐另一端", "完成未完成的双向关系事务");
  const run = async (strategy) => {
    rollback.disabled = true;
    complete.disabled = true;
    try {
      const result = await service.repairPendingTransaction(strategy);
      if (!result?.repaired) throw new Error("仍有文件无法修复");
      await plugin.store.refreshNow();
      state.requestRender();
      new Notice(strategy === "complete" ? "双向关系已补齐。" : "未完成的关系已撤回。");
    } catch (error) {
      new Notice(`修复失败：${error?.message || pending?.error || "请检查相关笔记"}`);
      rollback.disabled = false;
      complete.disabled = false;
    }
  };
  rollback.addEventListener("click", () => void run("rollback"));
  complete.addEventListener("click", () => void run("complete"));
  actions.append(rollback, complete);
  panel.append(copy, actions);
  return panel;
}

function renderStarSeaPage(plugin, snapshot, state) {
  const service = plugin.starSea;
  const page = element("div", "mengcang-star-sea");
  page.appendChild(element("h1", "mengcang-sr-only", "梦藏星海"));
  if (!service) {
    page.appendChild(element("div", "mengcang-section__empty", "星海服务尚未就绪。"));
    return page;
  }

  const corpus = starCorpus(service, snapshot).filter((record) => record?.path && !record.isDemo);
  const byPath = new Map(corpus.map((record) => [record.path, record]));
  const searchable = corpus.filter((record) => matchesQuery(record, state.query));
  let anchor = byPath.get(state.selectedStarPath) || searchable[0] || corpus[0] || null;
  if (anchor && state.selectedStarPath !== anchor.path) state.selectedStarPath = anchor.path;

  const intro = element("section", "mengcang-star-sea__intro");
  const introCopy = element("div", "");
  introCopy.append(
    element("span", "mengcang-page-kicker", "梦藏 · 星海关系实验室"),
    element("h2", "", "让脑海里的暗线，第一次被看见。"),
    element("p", "", "暗线是系统提出的可能性，亮线才是你承认的思想关系。当前使用本地隐私候选引擎；未连接外部 AI，也不会自动改写笔记。")
  );
  const picker = element("label", "mengcang-star-sea__anchor-picker");
  picker.appendChild(element("span", "", "选择基点"));
  const select = element("select");
  select.setAttribute("aria-label", "选择进入星海的基点笔记");
  for (const record of searchable) {
    const option = element("option", "", `${KIND_LABELS[record.kind] || "资料"} · ${record.title}`);
    option.value = record.path;
    option.selected = record.path === anchor?.path;
    select.appendChild(option);
  }
  if (!searchable.length) {
    const option = element("option", "", state.query ? "没有匹配的真实资料" : "尚无真实资料");
    option.value = "";
    select.appendChild(option);
    select.disabled = true;
  }
  select.addEventListener("change", () => {
    state.selectedStarPath = select.value;
    state.selectedStarTargetPath = "";
    state.selectedStarRelationId = "";
    state.starManualTargetPath = "";
    state.starCanvasPaths = new Set();
    state.requestRender();
  });
  picker.appendChild(select);
  intro.append(introCopy, picker);
  page.appendChild(intro);

  const pending = typeof service.getPendingTransaction === "function" ? service.getPendingTransaction() : null;
  if (pending?.status === "repair_needed") page.appendChild(makeRepairPanel(plugin, service, state, pending));

  if (!anchor) {
    page.appendChild(element("div", "mengcang-section__empty", "先在梦藏中收录一篇真实 Markdown，星海才会出现基点。"));
    return page;
  }

  let candidates = [];
  let confirmed = [];
  let relationReadError = null;
  try {
    candidates = (service.getCandidates(anchor, corpus) || []).slice(0, 3);
    confirmed = service.getConfirmed(anchor, corpus) || [];
  } catch (error) {
    relationReadError = error;
  }
  if (relationReadError) {
    const warning = element("div", "mengcang-star-sea__warning");
    warning.append(
      element("strong", "", "关系托管区需要修复"),
      element("span", "", relationReadError?.message || "检测到重复或损坏的梦藏关系标记；为保护原文，本页已停止写入。")
    );
    page.appendChild(warning);
  }
  const candidateItems = candidates
    .map((candidate) => ({ candidate, target: candidateTarget(candidate, byPath) }))
    .filter((item) => item.target && item.target.path !== anchor.path);
  const confirmedItems = confirmed
    .map((relation) => ({ relation, peer: relationPeer(relation, byPath) }))
    .filter((item) => item.peer && item.peer.path !== anchor.path);

  const field = element("section", "mengcang-star-sea__field");
  field.setAttribute("aria-label", `以${anchor.title}为基点的关系星海`);
  const svg = svgElement("svg", {
    class: "mengcang-star-sea__routes",
    viewBox: "0 0 1000 620",
    preserveAspectRatio: "none",
    "aria-hidden": "false"
  });
  field.appendChild(svg);

  const occupied = new Set([anchor.path, ...candidateItems.map((item) => item.target.path), ...confirmedItems.map((item) => item.peer.path)]);
  const passiveRecords = corpus.filter((record) => !occupied.has(record.path)).slice(0, 32);
  passiveRecords.forEach((record, index) => {
    const position = passivePosition(record.path, index);
    const star = button("mengcang-star-sea__passive", "", `将${record.title}设为基点`);
    star.style.left = `${position.x}%`;
    star.style.top = `${position.y}%`;
    star.style.setProperty("--star-delay", `${-(index % 9) * .37}s`);
    star.title = record.title;
    applyRecordPalette(star, record);
    star.addEventListener("click", () => {
      state.selectedStarPath = record.path;
      state.selectedStarTargetPath = "";
      state.selectedStarRelationId = "";
      state.starCanvasPaths = new Set();
      state.requestRender();
    });
    field.appendChild(star);
  });

  candidateItems.forEach(({ candidate, target }, index) => {
    const slot = DARK_SLOTS[index];
    drawRelation(svg, { ...candidate, path: target.path, title: target.title }, slot, state, "dark", () => {
      state.selectedStarTargetPath = target.path;
      state.selectedStarRelationId = "";
      state.requestRender();
    });
    field.appendChild(makeStarNode(
      target,
      slot,
      "is-dark",
      () => {
        state.selectedStarTargetPath = target.path;
        state.selectedStarRelationId = "";
        state.requestRender();
      },
      state.starCanvasPaths instanceof Set && state.starCanvasPaths.has(target.path)
    ));
  });

  confirmedItems.slice(0, 3).forEach(({ relation, peer }, index) => {
    const slot = LIT_SLOTS[index];
    drawRelation(svg, { ...relation, path: peer.path, title: peer.title }, slot, state, "lit", () => {
      state.selectedStarRelationId = relationId(relation);
      state.selectedStarTargetPath = "";
      state.requestRender();
    });
    field.appendChild(makeStarNode(
      peer,
      slot,
      "is-lit",
      () => {
        state.selectedStarRelationId = relationId(relation);
        state.selectedStarTargetPath = "";
        state.requestRender();
      },
      state.starCanvasPaths instanceof Set && state.starCanvasPaths.has(peer.path)
    ));
  });

  const anchorNode = makeStarNode(anchor, { x: 50, y: 50 }, "is-anchor", () => {
    void plugin.app.workspace.getLeaf("tab").openFile(plugin.app.vault.getAbstractFileByPath(anchor.path));
  });
  anchorNode.setAttribute("aria-label", `基点：${anchor.title}；点击打开原笔记`);
  field.appendChild(anchorNode);

  const legend = element("div", "mengcang-star-sea__legend");
  legend.append(
    element("span", "is-dark", `${candidateItems.length} 条暗线`),
    element("span", "is-lit", `${confirmedItems.length} 条亮线`),
    element("span", "", `${corpus.length} 颗真实资料星`)
  );
  field.appendChild(legend);
  page.appendChild(field);

  const selectedCandidate = candidateItems.find((item) => item.target.path === state.selectedStarTargetPath);
  const selectedConfirmed = confirmedItems.find((item) => relationId(item.relation) === state.selectedStarRelationId);
  if (selectedCandidate) {
    page.appendChild(reviewCandidate(plugin, service, state, anchor, selectedCandidate.target, selectedCandidate.candidate));
  } else if (selectedConfirmed) {
    page.appendChild(reviewConfirmed(plugin, service, state, anchor, selectedConfirmed.peer, selectedConfirmed.relation));
  }

  if (!relationReadError) {
    page.append(
      makeManualPanel(plugin, service, state, anchor, corpus, confirmed),
      makeCanvasBar(plugin, service, state, anchor, corpus, confirmed)
    );
  }
  return page;
}

module.exports = { renderStarSeaPage };
