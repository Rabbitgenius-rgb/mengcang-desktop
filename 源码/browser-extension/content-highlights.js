(() => {
  // capture.js
  function trimUtf16(value, limit) {
    const result = String(value ?? "").slice(0, limit);
    return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
  }
  function capturePage(kind, selectedText = "", expectedUrl = "") {
    const clip = (value, limit) => {
      const result = value.slice(0, limit);
      return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
    };
    try {
      const url = new URL(location.href);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("\u8BF7\u5728\u666E\u901A\u7F51\u9875\u4E2D\u4F7F\u7528\u68A6\u85CF\u6536\u5F55\u3002");
      const credentialKey = /^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i;
      if ([...url.searchParams.keys()].some((key) => credentialKey.test(key))) throw new Error("\u6765\u6E90\u7F51\u5740\u542B\u6709\u51ED\u8BC1\u53C2\u6570\uFF0C\u8BF7\u4F7F\u7528\u4E0D\u542B\u51ED\u8BC1\u7684\u7F51\u9875\u5730\u5740\u3002");
      if (expectedUrl && new URL(expectedUrl).href !== url.href) throw new Error("\u9875\u9762\u5DF2\u7ECF\u5207\u6362\uFF0C\u8BF7\u56DE\u5230\u8981\u4FDD\u5B58\u7684\u9875\u9762\u540E\u91CD\u8BD5\u3002");
      const clean = (value) => String(value || "").replace(/\u0000/g, "").trim();
      const meta = (key) => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content || "";
      const title = clip(clean(meta("og:title") || document.title || url.hostname), 1e3);
      const base = { version: 1, kind, sourceUrl: url.href, title, author: clip(clean(meta("author") || meta("article:author")), 1e3), siteName: clip(clean(meta("og:site_name") || url.hostname), 1e3) };
      if (kind === "link") return { ...base, body: clip(clean(meta("description") || meta("og:description")), 5e4) };
      if (!["article", "highlight"].includes(kind)) throw new Error("\u4E0D\u652F\u6301\u7684\u6536\u5F55\u65B9\u5F0F\u3002");
      if (clean(selectedText)) {
        const body2 = clean(selectedText);
        if (body2.length > 5e4) throw new Error("\u9009\u4E2D\u6587\u5B57\u8D85\u8FC7 50000 \u5B57\uFF0C\u8BF7\u7F29\u5C0F\u9009\u62E9\u8303\u56F4\u540E\u518D\u6536\u5F55\u3002");
        return { ...base, body: body2 };
      }
      if (kind === "highlight") throw new Error("\u8BF7\u5148\u5728\u7F51\u9875\u4E2D\u9009\u4E2D\u8981\u4FDD\u5B58\u7684\u6587\u5B57\u3002");
      const unwanted = 'script,style,noscript,svg,canvas,iframe,nav,footer,aside,form,input,textarea,select,button,dialog,[role="navigation"],[role="menu"],[role="dialog"],[hidden],[aria-hidden="true"],[data-mengcang-ui]';
      const rendered = (node) => {
        for (let current = node; current?.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
          if (current.matches(unwanted)) return false;
          if (current.tagName === "HEADER") {
            let contentHeader = false;
            for (let parent = current.parentElement; parent; parent = parent.parentElement) if (parent.matches('article,main,[role="main"]')) {
              contentHeader = true;
              break;
            }
            if (!contentHeader) return false;
          }
          const style = getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden") return false;
        }
        return true;
      };
      const candidates = (selector) => document.querySelectorAll ? [...document.querySelectorAll(selector)] : [document.querySelector(selector)].filter(Boolean);
      const root = candidates("article").find(rendered) || candidates('main,[role="main"]').find(rendered) || document.body;
      if (!root) throw new Error("\u9875\u9762\u8FD8\u6CA1\u6709\u53EF\u8BFB\u6B63\u6587\uFF0C\u8BF7\u52A0\u8F7D\u5B8C\u6210\u540E\u91CD\u8BD5\u3002");
      const containers = /* @__PURE__ */ new Set(["BODY", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "UL", "OL", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "FIGURE", "DL", "DT", "DD"]);
      const safeURL = (value) => {
        if (!value) return "";
        try {
          const target = new URL(value, url.href);
          return ["http:", "https:"].includes(target.protocol) && !target.username && !target.password && ![...target.searchParams.keys()].some((key) => credentialKey.test(key)) ? target.href : "";
        } catch {
          return "";
        }
      };
      const visible = (node) => {
        if (node.matches(unwanted)) return false;
        if (node.tagName === "HEADER" && (root === document.body || !root.contains(node))) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const blocks2 = [];
      let skippedImages = 0, imageCount = 0;
      const append = (value) => {
        if (blocks2.length >= 1200) throw new Error("\u6587\u7AE0\u7ED3\u6784\u8D85\u8FC7 1200 \u6BB5\uFF0C\u8BF7\u9009\u4E2D\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
        blocks2.push({ id: `b${blocks2.length + 1}`, ...value });
      };
      const textBlock = (type, runs, level) => {
        if (!runs.some((run) => run.text.trim())) return;
        const next = runs.map((run) => ({ ...run }));
        next[0].text = next[0].text.trimStart();
        next[next.length - 1].text = next[next.length - 1].text.trimEnd();
        append({ type, runs: next.filter((run) => run.text), ...level ? { level } : {} });
      };
      const captionText = (node) => {
        if (!node) return "";
        if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || "");
        if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return "";
        return [...node.childNodes].map(captionText).join("");
      };
      const imageBlock = (node) => {
        const candidates2 = [node.currentSrc, node.src, node.getAttribute("data-src"), node.getAttribute("data-original")];
        if (++imageCount > 40) throw new Error("\u6587\u7AE0\u56FE\u7247\u8D85\u8FC7 40 \u5F20\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u6216\u5355\u72EC\u4FDD\u5B58\u56FE\u7247\u3002");
        const src = candidates2.map(safeURL).find(Boolean) || "";
        const caption = clip(clean(captionText(node.closest("figure")?.querySelector("figcaption"))), 1e3);
        if (!src) skippedImages++;
        append({ type: "image", src, alt: clip(clean(node.alt || ""), 1e3), ...caption ? { caption } : {}, ...!src ? { imageError: "\u6B64\u56FE\u7247\u65E0\u53EF\u76F4\u63A5\u4E0B\u8F7D\u7684\u516C\u5F00\u5730\u5740\uFF0C\u53EF\u4E0B\u8F7D\u540E\u5BFC\u5165\u3002" } : {} });
      };
      const collectInline = (node, runs, marks, flush, type, level, special) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text2 = String(node.nodeValue || "").replace(/\u0000/g, "");
          if (!text2) return;
          const previous = runs[runs.length - 1];
          if (previous && previous.href === marks.href && !!previous.strong === !!marks.strong && !!previous.em === !!marks.em) previous.text += text2;
          else runs.push({ text: text2, ...marks });
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return;
        if (special?.(node, runs, marks)) return;
        if (node.tagName === "IMG") {
          flush(type, runs, level);
          runs.length = 0;
          imageBlock(node);
          return;
        }
        if (node.tagName === "BR") {
          runs.push({ text: "\n", ...marks });
          return;
        }
        const next = { ...marks };
        if (node.tagName === "A") {
          const href = safeURL(node.getAttribute("href"));
          if (href) next.href = href;
        }
        if (["STRONG", "B"].includes(node.tagName)) next.strong = true;
        if (["EM", "I"].includes(node.tagName)) next.em = true;
        const nestedBlock = ["P", "DIV", "LI"].includes(node.tagName);
        if (nestedBlock && runs.length && !runs[runs.length - 1].text.endsWith("\n")) runs.push({ text: "\n", ...next });
        for (const child of node.childNodes) collectInline(child, runs, next, flush, type, level, special);
        if (nestedBlock && runs.length) runs.push({ text: "\n", ...next });
      };
      const listDetails = (node) => {
        let depth = -1;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) if (["UL", "OL"].includes(parent.tagName)) depth++;
        depth = Math.max(0, depth);
        if (depth > 20) throw new Error("\u6587\u7AE0\u5217\u8868\u8D85\u8FC7 20 \u5C42\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
        const list = node.parentElement;
        const style = getComputedStyle(list || node).listStyleType || "";
        if (list?.tagName !== "OL") return { marker: style === "none" ? "" : style === "circle" ? "\u25E6" : style === "square" ? "\u25AA" : "\u2022", depth };
        const children = [...list.childNodes].filter((child) => child.tagName === "LI");
        const integer = (value) => typeof value === "string" && /^[+-]?\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
        const reversed = list.getAttribute("reversed") !== null, step = reversed ? -1 : 1;
        let number = integer(list.getAttribute("start")) ?? (reversed ? children.length : 1);
        for (const child of children) {
          number = integer(child.getAttribute("value")) ?? number;
          if (child === node) break;
          number += step;
        }
        const format = node.getAttribute("type") || list.getAttribute("type") || { "lower-alpha": "a", "lower-latin": "a", "upper-alpha": "A", "upper-latin": "A", "lower-roman": "i", "upper-roman": "I" }[style] || "1";
        let label = String(number);
        if (["a", "A"].includes(format) && number > 0) {
          label = "";
          for (let current = number; current > 0; current = Math.floor((current - 1) / 26)) label = String.fromCharCode(97 + (current - 1) % 26) + label;
          if (format === "A") label = label.toUpperCase();
        } else if (["i", "I"].includes(format) && number > 0 && number < 4e3) {
          label = "";
          let current = number;
          for (const [value, roman] of [[1e3, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (current >= value) {
            label += roman;
            current -= value;
          }
          if (format === "i") label = label.toLowerCase();
        }
        return { marker: style === "none" ? "" : label + ".", depth };
      };
      let tableRows = 0, tableCells = 0;
      const tableBlock = (table) => {
        const rowNodes = [], images = [];
        const findRows = (node) => {
          for (const child of node.childNodes) {
            if (child.nodeType !== Node.ELEMENT_NODE || !visible(child)) continue;
            if (child.tagName === "TABLE") throw new Error("\u5D4C\u5957\u8868\u683C\u6682\u4E0D\u80FD\u5B8C\u6574\u6536\u5F55\uFF0C\u8BF7\u9009\u4E2D\u6587\u5B57\u540E\u4FDD\u5B58\u3002");
            if (child.tagName === "TR") rowNodes.push(child);
            else findRows(child);
          }
        };
        findRows(table);
        if (!rowNodes.length) return;
        if ((tableRows += rowNodes.length) > 200) throw new Error("\u6587\u7AE0\u8868\u683C\u8D85\u8FC7 200 \u884C\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
        const caption = [...table.childNodes].find((child) => child.tagName === "CAPTION" && visible(child));
        if (caption) {
          const runs = [];
          collectInline(caption, runs, {}, textBlock, "paragraph");
          textBlock("paragraph", runs);
        }
        const rows = rowNodes.map((row) => {
          const cells = [...row.childNodes].filter((child) => ["TD", "TH"].includes(child.tagName) && visible(child));
          if (!cells.length || cells.length > 100 || (tableCells += cells.length) > 2e3) throw new Error("\u6587\u7AE0\u8868\u683C\u5355\u5143\u683C\u8D85\u8FC7\u4FDD\u5B58\u4E0A\u9650\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
          let columns = 0;
          return { cells: cells.map((cell) => {
            const runs = [];
            collectInline(cell, runs, {}, textBlock, "paragraph", void 0, (child) => {
              if (child.tagName === "TABLE") throw new Error("\u5D4C\u5957\u8868\u683C\u6682\u4E0D\u80FD\u5B8C\u6574\u6536\u5F55\uFF0C\u8BF7\u9009\u4E2D\u6587\u5B57\u540E\u4FDD\u5B58\u3002");
              if (child.tagName !== "IMG") return false;
              images.push(child);
              return true;
            });
            while (runs.length && !runs[0].text.trim()) runs.shift();
            while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
            if (runs.length) {
              runs[0].text = runs[0].text.trimStart();
              runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
            }
            const result = { runs, header: cell.tagName === "TH" };
            for (const key of ["colspan", "rowspan"]) {
              const raw = cell.getAttribute(key);
              if (raw === null) continue;
              const value = Number(raw);
              if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("\u8868\u683C\u8DE8\u884C\u8DE8\u5217\u8D85\u8FC7\u4FDD\u5B58\u8303\u56F4\uFF0C\u8BF7\u9009\u4E2D\u6587\u5B57\u540E\u4FDD\u5B58\u3002");
              if (value > 1) result[key] = value;
            }
            columns += result.colspan || 1;
            if (columns > 200) throw new Error("\u6587\u7AE0\u8868\u683C\u8D85\u8FC7 200 \u5217\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
            return result;
          }) };
        });
        append({ type: "table", rows, ...images.length ? { imagesAfter: true } : {} });
        for (const image of images) imageBlock(image);
      };
      const walk = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return;
        if (node.tagName === "IMG") {
          imageBlock(node);
          return;
        }
        if (node.tagName === "TABLE") {
          tableBlock(node);
          return;
        }
        if (node.tagName === "BLOCKQUOTE") {
          const runs2 = [];
          collectInline(node, runs2, {}, textBlock, "quote", void 0, (child, inline) => {
            if (!["UL", "OL", "TABLE"].includes(child.tagName)) return false;
            textBlock("quote", inline);
            inline.length = 0;
            walk(child);
            return true;
          });
          textBlock("quote", runs2);
          return;
        }
        if (node.tagName === "LI") {
          const details = listDetails(node), runs2 = [];
          let first = true;
          const emit = (type, value, level) => {
            const before = blocks2.length;
            textBlock(type, value, level);
            if (blocks2.length > before) {
              Object.assign(blocks2[blocks2.length - 1], details, first ? {} : { marker: "" });
              first = false;
            }
          };
          collectInline(node, runs2, {}, emit, "list-item", void 0, (child, inline) => {
            if (!["UL", "OL", "TABLE"].includes(child.tagName)) return false;
            emit("list-item", inline);
            inline.length = 0;
            walk(child);
            return true;
          });
          emit("list-item", runs2);
          return;
        }
        const heading = /^H([1-6])$/.exec(node.tagName);
        const semantic = heading ? "heading" : node.tagName === "BLOCKQUOTE" ? "quote" : node.tagName === "LI" ? "list-item" : node.tagName === "PRE" ? "code" : "paragraph";
        if (!containers.has(node.tagName)) {
          const runs2 = [];
          collectInline(node, runs2, {}, textBlock, semantic, heading ? Number(heading[1]) : void 0);
          textBlock(semantic, runs2, heading ? Number(heading[1]) : void 0);
          return;
        }
        let runs = [];
        const flush = () => {
          textBlock("paragraph", runs);
          runs = [];
        };
        for (const child of node.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE && (containers.has(child.tagName) || /^(?:H[1-6]|P|BLOCKQUOTE|LI|PRE|IMG|FIGCAPTION)$/.test(child.tagName))) {
            flush();
            if (child.tagName !== "FIGCAPTION") walk(child);
          } else collectInline(child, runs, {}, textBlock, "paragraph");
        }
        flush();
      };
      walk(root);
      const body = blocks2.filter((block) => block.type !== "image").map((block) => block.type === "table" ? block.rows.map((row) => row.cells.map((cell) => cell.runs.map((run) => run.text).join("")).join("	")).join("\n") : `${block.type === "list-item" && block.marker ? block.marker + " " : ""}${block.runs.map((run) => run.text).join("")}`).join("\n\n");
      if (!body.trim()) throw new Error("\u6CA1\u6709\u627E\u5230\u53EF\u8BFB\u6B63\u6587\u3002\u53EF\u4EE5\u9009\u4E2D\u6587\u5B57\u540E\uFF0C\u5728\u53F3\u952E\u83DC\u5355\u4E2D\u4FDD\u5B58\u3002");
      if (body.length > 5e4) throw new Error("\u6587\u7AE0\u8D85\u8FC7 50000 \u5B57\uFF0C\u8BF7\u5148\u9009\u4E2D\u8981\u4FDD\u5B58\u7684\u6BB5\u843D\uFF0C\u518D\u4F7F\u7528\u53F3\u952E\u6536\u5F55\u3002");
      let runCount = 0;
      for (const block of blocks2) for (const runs of block.type === "table" ? block.rows.flatMap((row) => row.cells.map((cell) => cell.runs)) : block.runs ? [block.runs] : []) {
        if (runs.length > 512 || (runCount += runs.length) > 1e4) throw new Error("\u6587\u7AE0\u884C\u5185\u7ED3\u6784\u8D85\u8FC7\u4FDD\u5B58\u4E0A\u9650\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
      }
      const article = { version: 1, blocks: blocks2 };
      if (new TextEncoder().encode(JSON.stringify(article)).length > 7e5) throw new Error("\u6587\u7AE0\u94FE\u63A5\u4E0E\u56FE\u7247\u7ED3\u6784\u8FC7\u5927\uFF0C\u8BF7\u9009\u53D6\u9700\u8981\u7684\u90E8\u5206\u540E\u4FDD\u5B58\u3002");
      return { ...base, body, article, ...skippedImages ? { captureWarnings: [`${skippedImages} \u5F20\u6CA1\u6709\u666E\u901A\u516C\u5F00\u5730\u5740\u7684\u56FE\u7247\u672A\u6536\u5F55\uFF0C\u53EF\u4E0B\u8F7D\u540E\u5BFC\u5165\u3002`] } : {} };
    } catch (error) {
      return { captureError: clip(String(error?.message || "\u5F53\u524D\u9875\u9762\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u91CD\u8BD5\u3002"), 500) };
    }
  }

  // ../src/clipper/anchors.mjs
  var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  var badUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  var fail = (message) => {
    throw Object.assign(new Error(message), { code: "INVALID_WEB_ANCHOR" });
  };
  var normalizeAnchorText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
  function text(value, max, label) {
    if (typeof value !== "string" || value.length > max || /[\x00-\x08\x0e-\x1f\x7f-\x9f]/.test(value) || badUnicode.test(value)) fail(`${label}\u65E0\u6548`);
    return value;
  }
  function normalizeWebAnchor(raw) {
    if (!object(raw) || Object.keys(raw).some((key) => !["version", "exact", "prefix", "suffix", "start", "end", "textFragment"].includes(key)) || raw.version !== 1) fail("\u7F51\u9875\u9AD8\u4EAE\u4F4D\u7F6E\u683C\u5F0F\u65E0\u6548");
    const exact = normalizeAnchorText(text(raw.exact, 5e4, "\u9AD8\u4EAE\u6587\u5B57"));
    if (!exact) fail("\u9AD8\u4EAE\u6587\u5B57\u4E0D\u80FD\u4E3A\u7A7A");
    const result = { version: 1, exact, prefix: normalizeAnchorText(text(raw.prefix ?? "", 160, "\u9AD8\u4EAE\u524D\u6587")), suffix: normalizeAnchorText(text(raw.suffix ?? "", 160, "\u9AD8\u4EAE\u540E\u6587")) };
    if (raw.start !== void 0 || raw.end !== void 0) {
      if (!Number.isSafeInteger(raw.start) || !Number.isSafeInteger(raw.end) || raw.start < 0 || raw.end < raw.start || raw.end > 5e5 || raw.end - raw.start !== exact.length) fail("\u7F51\u9875\u9AD8\u4EAE\u6587\u5B57\u4F4D\u7F6E\u65E0\u6548");
      result.start = raw.start;
      result.end = raw.end;
    }
    if (raw.textFragment === null) result.textFragment = null;
    else if (raw.textFragment !== void 0) {
      const fragment = raw.textFragment;
      if (!object(fragment) || Object.keys(fragment).some((key) => !["start", "end", "prefix", "suffix"].includes(key))) fail("\u539F\u7F51\u9875\u6587\u672C\u5B9A\u4F4D\u63D0\u793A\u65E0\u6548");
      const start = normalizeAnchorText(text(fragment.start, 160, "\u539F\u7F51\u9875\u8D77\u59CB\u6587\u5B57"));
      const end = normalizeAnchorText(text(fragment.end ?? "", 160, "\u539F\u7F51\u9875\u7ED3\u675F\u6587\u5B57"));
      const prefix = normalizeAnchorText(text(fragment.prefix ?? "", 160, "\u539F\u7F51\u9875\u524D\u6587"));
      const suffix = normalizeAnchorText(text(fragment.suffix ?? "", 160, "\u539F\u7F51\u9875\u540E\u6587"));
      if (!start || !exact.startsWith(start) || end && !exact.endsWith(end) || prefix && !result.prefix.endsWith(prefix) || suffix && !result.suffix.startsWith(suffix)) fail("\u539F\u7F51\u9875\u6587\u672C\u5B9A\u4F4D\u63D0\u793A\u4E0E\u9AD8\u4EAE\u4E0D\u4E00\u81F4");
      result.textFragment = { start, ...end ? { end } : {}, prefix, suffix };
    }
    return result;
  }
  function findQuoteAnchor(value, raw) {
    const anchor = normalizeWebAnchor(raw), text2 = normalizeAnchorText(value);
    let at = -1, result = null;
    while ((at = text2.indexOf(anchor.exact, at + 1)) >= 0) {
      if (anchor.prefix && !text2.slice(Math.max(0, at - anchor.prefix.length - 1), at).trimEnd().endsWith(anchor.prefix)) continue;
      const end = at + anchor.exact.length;
      if (anchor.suffix && !text2.slice(end, end + anchor.suffix.length + 1).trimStart().startsWith(anchor.suffix)) continue;
      if (result) return null;
      result = { start: at, end };
    }
    return result;
  }
  var ignored = 'script,style,noscript,svg,canvas,iframe,nav,footer,aside,form,input,textarea,select,button,dialog,[role="navigation"],[role="menu"],[role="dialog"],[hidden],[aria-hidden="true"],[data-mengcang-ui]';
  var blocks = /* @__PURE__ */ new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "LI", "PRE", "TR", "TD", "TH", "UL", "OL", "FIGURE", "FIGCAPTION"]);
  function articleHeader(node) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.matches?.('article,main,[role="main"]')) return true;
    return false;
  }
  function buildTextIndex(root, { maxText = 5e5 } = {}) {
    if (!root) return { text: "", entries: [] };
    const document2 = root.ownerDocument || root, view = document2.defaultView, chunks = [], entries = [];
    let length = 0, pending = false;
    const append = (value) => {
      length += value.length;
      if (length > maxText) throw Object.assign(new Error("\u9875\u9762\u6587\u5B57\u8FC7\u591A\uFF0C\u8BF7\u7F29\u5C0F\u9009\u62E9\u8303\u56F4\u540E\u91CD\u8BD5\u3002"), { code: "PAGE_TOO_LARGE" });
      chunks.push(value);
    };
    function walk(node) {
      if (node.nodeType === 3) {
        const raw = node.nodeValue || "", entry = { node, positions: [], offsets: [] };
        for (let i = 0; i < raw.length; i++) {
          const char = raw[i];
          if (/\s/u.test(char)) {
            pending = true;
            continue;
          }
          if (pending && length) append(" ");
          pending = false;
          entry.positions.push(length);
          entry.offsets.push(i);
          append(char);
        }
        if (entry.positions.length) entries.push(entry);
        return;
      }
      if (node.nodeType !== 1 && node !== root) return;
      if (node.nodeType === 1) {
        if (node.matches?.(ignored) || node.tagName === "HEADER" && !articleHeader(node)) return;
        const style = view?.getComputedStyle?.(node);
        if (style?.display === "none" || style?.visibility === "hidden") return;
        if (node.tagName === "BR") {
          pending = true;
          return;
        }
      }
      const block = blocks.has(node.tagName);
      if (block) pending = true;
      for (const child of node.childNodes || []) walk(child);
      if (block) pending = true;
    }
    walk(root);
    return { text: chunks.join(""), entries };
  }
  var safeTail = (value) => {
    const out = value.slice(-160);
    return /^[\uDC00-\uDFFF]/.test(out) ? out.slice(1) : out;
  };
  var safeHead = (value) => {
    const out = value.slice(0, 160);
    return /[\uD800-\uDBFF]$/.test(out) ? out.slice(0, -1) : out;
  };
  var fragmentHead = (value) => [...value].slice(0, 60).join("");
  var fragmentTail = (value) => [...value].slice(-60).join("");
  function nearestBlock(node, root) {
    for (let parent = node.parentElement || node.parentNode; parent && parent !== root; parent = parent.parentElement || parent.parentNode) if (blocks.has(parent.tagName)) return parent;
    return root;
  }
  function pointPosition(index, node, offset) {
    const entry = index.entries.find((entry2) => entry2.node === node), at = entry?.offsets.indexOf(offset) ?? -1;
    return at < 0 ? null : entry.positions[at];
  }
  function nativeSelectorUnique(text2, fragment, expected) {
    const fold = (value) => value.toUpperCase().toLowerCase();
    const folded = fold(text2), parts = Object.fromEntries(Object.entries(fragment).map(([key, value]) => [key, fold(value)]));
    if (folded.length !== text2.length || Object.keys(fragment).some((key) => parts[key].length !== fragment[key].length)) return false;
    text2 = folded;
    fragment = parts;
    let start = -1, found = false;
    while ((start = text2.indexOf(fragment.start, start + 1)) >= 0) {
      if (fragment.prefix && !text2.slice(Math.max(0, start - fragment.prefix.length - 1), start).trimEnd().endsWith(fragment.prefix)) continue;
      const startEnd = start + fragment.start.length;
      let end = fragment.end ? text2.indexOf(fragment.end, startEnd) : startEnd;
      while (end >= 0) {
        const finish = fragment.end ? end + fragment.end.length : end;
        if (!fragment.suffix || text2.slice(finish, finish + fragment.suffix.length + 1).trimStart().startsWith(fragment.suffix)) {
          if (found || start !== expected.start || finish !== expected.end) return false;
          found = true;
        }
        if (!fragment.end) break;
        end = text2.indexOf(fragment.end, end + 1);
      }
    }
    return found;
  }
  function nativeFragment(root, first, last, exact) {
    const firstBlock = nearestBlock(first.node, root), lastBlock = nearestBlock(last.node, root);
    const firstIndex = buildTextIndex(firstBlock), lastIndex = firstBlock === lastBlock ? firstIndex : buildTextIndex(lastBlock);
    const start = pointPosition(firstIndex, first.node, first.offset), lastAt = pointPosition(lastIndex, last.node, last.offset - 1);
    if (start === null || lastAt === null) return void 0;
    const end = lastAt + 1, sameBlock = firstBlock === lastBlock;
    const single = sameBlock && exact.length <= 160;
    const fragment = {
      start: single ? exact : fragmentHead(firstIndex.text.slice(start, sameBlock ? end : void 0)),
      ...!single ? { end: fragmentTail(lastIndex.text.slice(sameBlock ? start : 0, end)) } : {},
      prefix: fragmentTail(firstIndex.text.slice(0, start)).trim(),
      suffix: fragmentHead(lastIndex.text.slice(end)).trim()
    };
    const all = buildTextIndex(root), expectedStart = pointPosition(all, first.node, first.offset), expectedEnd = pointPosition(all, last.node, last.offset - 1);
    return nativeSelectorUnique(all.text, fragment, { start: expectedStart, end: expectedEnd + 1 }) ? fragment : null;
  }
  function anchorFromSelection(root, selection) {
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed || !root) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const selected = normalizeAnchorText(selection.toString());
    if (!selected) return null;
    if (selected.length > 5e4) fail("\u5355\u6761\u9AD8\u4EAE\u6700\u591A 50000 \u5B57\uFF0C\u8BF7\u7F29\u5C0F\u9009\u62E9\u8303\u56F4\u3002");
    const index = buildTextIndex(root);
    let start = Infinity, end = -1, first, last;
    for (const entry of index.entries) {
      if (!range.intersectsNode(entry.node)) continue;
      for (let i = 0; i < entry.offsets.length; i++) {
        const offset = entry.offsets[i];
        if (range.isPointInRange(entry.node, offset) && range.isPointInRange(entry.node, offset + 1)) {
          if (entry.positions[i] < start) {
            start = entry.positions[i];
            first = { node: entry.node, offset };
          }
          if (entry.positions[i] + 1 > end) {
            end = entry.positions[i] + 1;
            last = { node: entry.node, offset: offset + 1 };
          }
        }
      }
    }
    if (!Number.isFinite(start) || end < start || index.text.slice(start, end) !== selected) return null;
    return normalizeWebAnchor({ version: 1, exact: selected, prefix: safeTail(index.text.slice(0, start)).trim(), suffix: safeHead(index.text.slice(end)).trim(), start, end, textFragment: nativeFragment(root, first, last, selected) });
  }
  function rangeForAnchor(root, anchor) {
    if (!root) return null;
    const index = buildTextIndex(root), match = findQuoteAnchor(index.text, anchor);
    if (!match) return null;
    let first, last;
    for (const entry of index.entries) for (let i = 0; i < entry.positions.length; i++) {
      if (entry.positions[i] === match.start) first = { node: entry.node, offset: entry.offsets[i] };
      if (entry.positions[i] === match.end - 1) last = { node: entry.node, offset: entry.offsets[i] + 1 };
    }
    if (!first || !last) return null;
    const range = (root.ownerDocument || root).createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    return range;
  }

  // content-highlights-entry.js
  var stateKey = "__mengcangClipperV2";
  if (!globalThis[stateKey]) {
    let paint = function(items = state.items, focusId = "") {
      if (!globalThis.CSS?.highlights || typeof Highlight !== "function") throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u7F51\u9875\u9AD8\u4EAE\u663E\u793A\uFF0C\u8BF7\u66F4\u65B0 Chrome \u6216 Edge\u3002");
      state.items = items;
      state.url = location.href;
      const ranges = [], found = [];
      let focusRange = null;
      for (const item of items) {
        let range = null;
        try {
          range = rangeForAnchor(document.body, item.anchor);
        } catch {
        }
        found.push({ id: item.id, found: !!range });
        if (range) {
          ranges.push(range);
          if (item.id === focusId) focusRange = range;
        }
      }
      CSS.highlights.set("mengcang-saved", new Highlight(...ranges));
      CSS.highlights.delete("mengcang-focused");
      if (focusId) {
        if (!focusRange) throw new Error("\u539F\u6587\u5DF2\u53D8\u5316\u6216\u5C1A\u672A\u52A0\u8F7D\uFF0C\u65E0\u6CD5\u5B89\u5168\u5B9A\u4F4D\u8FD9\u6761\u9AD8\u4EAE\u3002");
        const focused = new Highlight(focusRange);
        focused.priority = 2;
        CSS.highlights.set("mengcang-focused", focused);
        (focusRange.startContainer.parentElement || document.body).scrollIntoView({ block: "center", behavior: "instant" });
      }
      return { matched: ranges.length, total: items.length, missing: items.length - ranges.length, items: found };
    }, collect = function(message) {
      if (!samePage(message.expectedUrl)) throw new Error("\u9875\u9762\u5DF2\u7ECF\u5207\u6362\uFF0C\u8BF7\u56DE\u5230\u8981\u4FDD\u5B58\u7684\u9875\u9762\u540E\u91CD\u8BD5\u3002");
      if (message.kind !== "highlight") return capturePage(message.kind, message.selectedText || "", message.expectedUrl || "");
      const selection = window.getSelection(), range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
      let articleRoot = range?.startContainer;
      if (articleRoot?.nodeType !== 1) articleRoot = articleRoot?.parentElement;
      while (articleRoot && !articleRoot.matches?.('article,main,[role="main"]')) articleRoot = articleRoot.parentElement;
      const root = range && articleRoot?.contains(range.startContainer) && articleRoot.contains(range.endContainer) ? articleRoot : document.body;
      const anchor = anchorFromSelection(root, selection);
      if (!anchor || !normalizeAnchorText(selection?.toString() || "")) throw new Error("\u9009\u4E2D\u6587\u5B57\u7684\u4F4D\u7F6E\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u540E\u4FDD\u5B58\u3002");
      if (message.selectedText && normalizeAnchorText(message.selectedText) !== anchor.exact) throw new Error("\u9875\u9762\u9009\u533A\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u540E\u4FDD\u5B58\u3002");
      const capture = capturePage("highlight", selection.toString(), message.expectedUrl || "");
      if (capture.captureError) return capture;
      return { ...capture, title: trimUtf16(anchor.exact, 90), anchor };
    };
    const state = { items: [], url: location.href, timer: null, loading: false };
    globalThis[stateKey] = state;
    const samePage = (expected) => !expected || new URL(expected).href === location.href;
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id || sender.tab || sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) return false;
      if (!["mengcang:collect", "mengcang:restore"].includes(message?.action)) return false;
      try {
        if (!samePage(message.expectedUrl)) throw new Error("\u9875\u9762\u5DF2\u7ECF\u5207\u6362\uFF0C\u8BF7\u56DE\u5230\u539F\u9875\u9762\u540E\u518D\u663E\u793A\u9AD8\u4EAE\u3002");
        const result = message.action === "mengcang:collect" ? collect(message) : paint(Array.isArray(message.items) ? message.items : [], message.focusId || "");
        reply({ ok: true, data: result });
      } catch (error) {
        reply({ ok: false, error: trimUtf16(String(error.message || "\u7F51\u9875\u64CD\u4F5C\u672A\u5B8C\u6210"), 500) });
      }
      return false;
    });
    async function loadAutomatic() {
      if (state.loading || !document.body || !["http:", "https:"].includes(location.protocol)) return;
      state.loading = true;
      const expectedUrl = location.href;
      try {
        const response = await chrome.runtime.sendMessage({ action: "page-highlights", sourceUrl: expectedUrl });
        if (response?.ok && samePage(expectedUrl)) paint(response.data.items || []);
      } catch {
      } finally {
        state.loading = false;
      }
    }
    const refresh = () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        if (state.url !== location.href) void loadAutomatic();
        else if (state.items.length) {
          try {
            paint();
          } catch {
          }
        }
      }, 300);
    };
    const ready = () => {
      void loadAutomatic();
      new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
    window.addEventListener("pageshow", () => void loadAutomatic());
    window.addEventListener("focus", () => void loadAutomatic());
    window.addEventListener("popstate", () => void loadAutomatic());
  }
})();
