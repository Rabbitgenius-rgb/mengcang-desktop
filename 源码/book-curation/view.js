"use strict";

const { Notice } = require("obsidian");

const STAGE_LABELS = {
  before: "阅读前",
  during: "阅读中",
  after: "阅读后"
};

function element(ownerDocument, tag, className = "", text) {
  const node = ownerDocument.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(ownerDocument, className, text, label = text) {
  const node = element(ownerDocument, "button", className, text);
  node.type = "button";
  if (label) node.setAttribute("aria-label", label);
  return node;
}

function textOf(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function itemId(item, prefix, index) {
  return textOf(item?.id) || `${prefix}-${index}`;
}

function jobStatusCopy(job) {
  if (!job) return { label: "等待生成", tone: "pending" };
  if (job.status === "ready") return { label: "候选已就绪", tone: "ready" };
  if (job.status === "confirmed") return { label: "已确认写入", tone: "confirmed" };
  if (job.status === "error") return { label: "生成未完成", tone: "error" };
  return { label: "正在准备", tone: "pending" };
}

function appendPending(panelBody, ownerDocument, job, plugin) {
  const needsSetup = job?.pendingReason === "generator_not_configured";
  panelBody.append(
    element(
      ownerDocument,
      "p",
      "mengcang-book-curation__empty",
      needsSetup
        ? "当前没有配置本地模型；可继续使用不联网的基础阅读引线，或在设置中启用 localhost 模型。"
        : "新书已进入策展队列。生成期间不会修改书籍 Markdown。"
    )
  );
  if (needsSetup && typeof plugin?.openBookCurationSettings === "function") {
    const settings = button(ownerDocument, "mengcang-book-curation__secondary", "打开策展设置");
    settings.addEventListener("click", () => plugin.openBookCurationSettings());
    panelBody.appendChild(settings);
  }
}

function appendError(panelBody, ownerDocument, job, service, bookPath) {
  const repairNeeded = job?.error?.repairNeeded === true;
  const message = textOf(job?.error?.message || job?.error) || "本地生成器暂时不可用，书籍笔记保持未改动。";
  panelBody.appendChild(element(ownerDocument, "p", "mengcang-book-curation__error", message));
  if (repairNeeded) {
    panelBody.appendChild(element(
      ownerDocument,
      "p",
      "mengcang-book-curation__error",
      "检测到可能已保留的部分写入或用户修改。插件已停止自动重试，请先检查书籍与作品笔记。"
    ));
    return;
  }
  const retry = button(ownerDocument, "mengcang-book-curation__secondary", "重试生成草案");
  retry.addEventListener("click", async () => {
    retry.disabled = true;
    try {
      await service.retry(bookPath, { force: true });
    } catch (error) {
      new Notice(`无法重试策展：${error?.message || "未知错误"}`);
      retry.disabled = false;
    }
  });
  panelBody.appendChild(retry);
}

function appendQuestionGroups(panelBody, ownerDocument, questions) {
  const section = element(ownerDocument, "section", "mengcang-book-curation__section");
  section.appendChild(element(ownerDocument, "h3", "", "可以带着读的问题"));
  for (const stage of ["before", "during", "after"]) {
    const items = questions.filter((question) => (question.readingStage || question.stage) === stage);
    if (!items.length) continue;
    const group = element(ownerDocument, "div", `mengcang-book-curation__questions is-${stage}`);
    const heading = element(ownerDocument, "div", "mengcang-book-curation__stage", STAGE_LABELS[stage]);
    if (stage === "after") heading.appendChild(element(ownerDocument, "span", "", "· 可能含剧透"));
    group.appendChild(heading);
    const list = element(ownerDocument, "ol", "");
    items.forEach((question) => {
      const item = element(ownerDocument, "li", "", textOf(question.text));
      if (question.spoilerLevel && question.spoilerLevel !== "none") {
        item.dataset.spoiler = question.spoilerLevel;
      }
      list.appendChild(item);
    });
    group.appendChild(list);
    section.appendChild(group);
  }
  panelBody.appendChild(section);
}

function appendWorks(panelBody, ownerDocument, works, selection) {
  const section = element(ownerDocument, "section", "mengcang-book-curation__section");
  section.append(
    element(ownerDocument, "h3", "", "相关作品候选"),
    element(ownerDocument, "p", "mengcang-book-curation__hint", "候选只是策展联想，不代表历史影响。勾选后仍需点击确认，才会创建真实笔记节点。")
  );
  if (!works.length) {
    section.appendChild(element(ownerDocument, "p", "mengcang-book-curation__empty", "基础模式不会虚构作品。启用本地模型后可生成待核对候选。"));
    panelBody.appendChild(section);
    return;
  }
  const list = element(ownerDocument, "div", "mengcang-book-curation__works");
  works.forEach((work, index) => {
    const id = itemId(work, "work", index);
    const label = element(ownerDocument, "label", "mengcang-book-curation__work");
    const input = element(ownerDocument, "input");
    input.type = "checkbox";
    input.checked = selection.has(id);
    input.addEventListener("change", () => {
      if (input.checked) selection.add(id);
      else selection.delete(id);
    });
    const copy = element(ownerDocument, "span", "mengcang-book-curation__work-copy");
    copy.append(
      element(ownerDocument, "strong", "", [work.title, work.creator].filter(Boolean).join(" · ")),
      element(ownerDocument, "span", "", textOf(work.rationale || work.reason))
    );
    const sourceUrl = textOf(work?.source?.catalogUrl || work.officialUrl || work.sourceUrl);
    if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      const source = element(ownerDocument, "a", "mengcang-book-curation__source", "查看候选来源 ↗");
      source.href = sourceUrl;
      source.target = "_blank";
      source.rel = "noreferrer noopener";
      source.addEventListener("click", (event) => event.stopPropagation());
      copy.appendChild(source);
      copy.appendChild(element(
        ownerDocument,
        "span",
        work?.source?.verificationStatus === "verified"
          ? "mengcang-book-curation__verified"
          : "mengcang-book-curation__unverified",
        work?.source?.verificationStatus === "verified" ? "链接已核验" : "链接未由梦藏核验"
      ));
    } else {
      copy.appendChild(element(ownerDocument, "span", "mengcang-book-curation__unverified", "出处待核对"));
    }
    label.append(input, copy);
    list.appendChild(label);
  });
  section.appendChild(list);
  panelBody.appendChild(section);
}

function appendReady(panelBody, ownerDocument, job, service, bookPath, selection) {
  const draft = job?.draft || {};
  const lines = listOf(draft.curatorialLines || draft.lines).slice(0, 1);
  const questions = listOf(draft.questions);
  const works = listOf(draft.relatedWorks || draft.works);

  const intro = element(ownerDocument, "section", "mengcang-book-curation__section is-intro");
  intro.appendChild(element(ownerDocument, "div", "mengcang-book-curation__label", "AI / 策展引思句 · 非作者原文"));
  if (lines.length) {
    intro.appendChild(element(ownerDocument, "blockquote", "", textOf(lines[0].text)));
  } else {
    intro.appendChild(element(ownerDocument, "p", "mengcang-book-curation__empty", "这次草案没有可展示的引思句。"));
  }
  panelBody.appendChild(intro);
  appendQuestionGroups(panelBody, ownerDocument, questions);
  appendWorks(panelBody, ownerDocument, works, selection);

  const actions = element(ownerDocument, "div", "mengcang-book-curation__actions");
  const retry = button(ownerDocument, "mengcang-book-curation__secondary", "重新生成草案");
  retry.addEventListener("click", async () => {
    retry.disabled = true;
    try {
      await service.retry(bookPath, { force: true });
    } catch (error) {
      new Notice(`无法重新生成：${error?.message || "未知错误"}`);
      retry.disabled = false;
    }
  });
  const confirm = button(ownerDocument, "mengcang-book-curation__primary", "确认策展内容");
  const updateConfirmLabel = () => {
    confirm.textContent = selection.size
      ? `确认并创建 ${selection.size} 个作品节点`
      : "确认引思句与问题";
  };
  updateConfirmLabel();
  panelBody.addEventListener("change", updateConfirmLabel);
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    retry.disabled = true;
    try {
      await service.confirm(bookPath, {
        selectedLineIds: lines.map((item, index) => itemId(item, "line", index)),
        selectedQuestionIds: questions.map((item, index) => itemId(item, "question", index)),
        selectedWorkIds: [...selection]
      });
      new Notice(selection.size
        ? `已创建 ${selection.size} 个作品笔记，节点关系将由 Obsidian 原生 Graph 解析。`
        : "阅读引线已写入书籍笔记。");
    } catch (error) {
      new Notice(`无法确认策展内容：${error?.message || "笔记未改动"}`);
      confirm.disabled = false;
      retry.disabled = false;
    }
  });
  actions.append(retry, confirm);
  panelBody.appendChild(actions);
}

function appendConfirmed(panelBody, ownerDocument, job, service, bookPath) {
  const recordedPaths = job?.createdWorkPaths && typeof job.createdWorkPaths === "object"
    ? Object.values(job.createdWorkPaths).filter(Boolean)
    : [];
  const count = Number(job?.confirmation?.createdWorkCount || job?.confirmation?.workCount)
    || new Set(recordedPaths).size;
  panelBody.append(
    element(ownerDocument, "p", "mengcang-book-curation__confirmed", count
      ? `已写入阅读引线，并创建或连接 ${count} 个作品节点。`
      : "已将引思句与问题写入这本书的 Markdown。")
  );
  const regenerate = button(ownerDocument, "mengcang-book-curation__secondary", "生成新一版草案");
  regenerate.addEventListener("click", async () => {
    regenerate.disabled = true;
    try {
      await service.retry(bookPath, { force: true });
    } catch (error) {
      new Notice(`无法生成新草案：${error?.message || "未知错误"}`);
      regenerate.disabled = false;
    }
  });
  panelBody.appendChild(regenerate);
}

function mountBookCurationPanel(plugin, bookPath, ownerDocument = document) {
  const service = plugin?.bookCuration;
  const panel = element(ownerDocument, "aside", "mengcang-book-curation");
  panel.setAttribute("aria-label", "书籍阅读引线");
  let collapsed = false;
  let selectionJobKey = "";
  const selectedWorkIds = new Set();

  const render = () => {
    const job = service?.getJob?.(bookPath) || null;
    const nextSelectionKey = textOf(job?.generationKey || job?.fingerprint);
    if (nextSelectionKey !== selectionJobKey) {
      selectionJobKey = nextSelectionKey;
      selectedWorkIds.clear();
      for (const work of listOf(job?.draft?.relatedWorks || job?.draft?.works)) {
        if (work?.selected) selectedWorkIds.add(textOf(work.id));
      }
    }
    const status = jobStatusCopy(job);
    panel.dataset.status = status.tone;
    panel.classList.toggle("is-collapsed", collapsed);
    panel.replaceChildren();

    const header = element(ownerDocument, "header", "mengcang-book-curation__header");
    const heading = element(ownerDocument, "div", "");
    heading.append(
      element(ownerDocument, "span", "mengcang-book-curation__kicker", "新书自动策展"),
      element(ownerDocument, "h2", "", "阅读引线")
    );
    const tools = element(ownerDocument, "div", "mengcang-book-curation__tools");
    tools.appendChild(element(ownerDocument, "span", "mengcang-book-curation__status", status.label));
    const collapse = button(ownerDocument, "mengcang-book-curation__collapse", collapsed ? "展开" : "收起");
    collapse.addEventListener("click", () => {
      collapsed = !collapsed;
      render();
    });
    tools.appendChild(collapse);
    header.append(heading, tools);
    panel.appendChild(header);
    if (collapsed) return;

    const body = element(ownerDocument, "div", "mengcang-book-curation__body");
    if (!service || !job || job.status === "pending") appendPending(body, ownerDocument, job, plugin);
    else if (job.status === "ready") appendReady(body, ownerDocument, job, service, bookPath, selectedWorkIds);
    else if (job.status === "confirmed") appendConfirmed(body, ownerDocument, job, service, bookPath);
    else appendError(body, ownerDocument, job, service, bookPath);
    panel.appendChild(body);
  };

  const unsubscribe = service?.subscribe?.((changedPath) => {
    if (!changedPath || typeof changedPath === "object" || changedPath === bookPath || changedPath?.bookPath === bookPath) render();
  }) || (() => {});
  render();
  return {
    element: panel,
    refresh: render,
    dispose() {
      unsubscribe();
      panel.remove();
    }
  };
}

module.exports = {
  mountBookCurationPanel
};
