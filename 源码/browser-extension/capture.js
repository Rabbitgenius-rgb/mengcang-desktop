// Self-contained DOM extraction. No HTML, scripts, cookies or form fields leave
// the page. Rich reading blocks are data consumed by the desktop React reader.
export function trimUtf16(value, limit) {
  const result = String(value ?? '').slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
}
export function capturePage(kind, selectedText = '', expectedUrl = '') {
 // chrome.scripting serializes capturePage without its module closure. Keep
 // clipping local too, and never split an emoji's UTF-16 surrogate pair.
 const clip = (value, limit) => {const result = value.slice(0, limit); return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;};
 try {
  const url = new URL(location.href);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请在普通网页中使用梦藏收录。');
  const credentialKey = /^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i;
  if ([...url.searchParams.keys()].some(key => credentialKey.test(key))) throw new Error('来源网址含有凭证参数，请使用不含凭证的网页地址。');
  if (expectedUrl && new URL(expectedUrl).href !== url.href) throw new Error('页面已经切换，请回到要保存的页面后重试。');
  const clean = value => String(value || '').replace(/\u0000/g, '').trim();
  const meta = key => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content || '';
  const title = clip(clean(meta('og:title') || document.title || url.hostname), 1000);
  const base = {version: 1, kind, sourceUrl: url.href, title, author: clip(clean(meta('author') || meta('article:author')), 1000), siteName: clip(clean(meta('og:site_name') || url.hostname), 1000)};
  if (kind === 'link') return {...base, body: clip(clean(meta('description') || meta('og:description')), 50000)};
  if (!['article', 'highlight'].includes(kind)) throw new Error('不支持的收录方式。');
  if (clean(selectedText)) {
    const body = clean(selectedText);
    if (body.length > 50000) throw new Error('选中文字超过 50000 字，请缩小选择范围后再收录。');
    return {...base, body};
  }
  if (kind === 'highlight') throw new Error('请先在网页中选中要保存的文字。');
  const unwanted = 'script,style,noscript,svg,canvas,iframe,nav,footer,aside,form,input,textarea,select,button,dialog,[role="navigation"],[role="menu"],[role="dialog"],[hidden],[aria-hidden="true"],[data-mengcang-ui]';
  const rendered = node => {
    for (let current = node; current?.nodeType === Node.ELEMENT_NODE; current = current.parentElement) {
      if (current.matches(unwanted)) return false;
      if (current.tagName === 'HEADER') {
        let contentHeader = false;
        for (let parent = current.parentElement; parent; parent = parent.parentElement) if (parent.matches('article,main,[role="main"]')) {contentHeader = true; break;}
        if (!contentHeader) return false;
      }
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const candidates = selector => document.querySelectorAll ? [...document.querySelectorAll(selector)] : [document.querySelector(selector)].filter(Boolean);
  const root = candidates('article').find(rendered) || candidates('main,[role="main"]').find(rendered) || document.body;
  if (!root) throw new Error('页面还没有可读正文，请加载完成后重试。');
  const containers = new Set(['BODY', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'FIGURE', 'DL', 'DT', 'DD']);
  const safeURL = value => {
    if (!value) return '';
    try {const target = new URL(value, url.href); return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && ![...target.searchParams.keys()].some(key => credentialKey.test(key)) ? target.href : '';} catch {return '';}
  };
  const visible = node => {
    if (node.matches(unwanted)) return false;
    // A site's banner stays excluded; an article's own title and lead are content.
    if (node.tagName === 'HEADER' && (root === document.body || !root.contains(node))) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  const blocks = []; let skippedImages = 0, imageCount = 0;
  const append = value => {if (blocks.length >= 1200) throw new Error('文章结构超过 1200 段，请选中需要的部分后保存。'); blocks.push({id: `b${blocks.length + 1}`, ...value});};
  const textBlock = (type, runs, level) => {
    if (!runs.some(run => run.text.trim())) return;
    const next = runs.map(run => ({...run}));
    next[0].text = next[0].text.trimStart(); next[next.length - 1].text = next[next.length - 1].text.trimEnd();
    append({type, runs: next.filter(run => run.text), ...(level ? {level} : {})});
  };
  const captionText = node => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return '';
    return [...node.childNodes].map(captionText).join('');
  };
  const imageBlock = node => {
    const candidates = [node.currentSrc, node.src, node.getAttribute('data-src'), node.getAttribute('data-original')];
    if (++imageCount > 40) throw new Error('文章图片超过 40 张，请选取需要的部分或单独保存图片。');
    const src = candidates.map(safeURL).find(Boolean) || '';
    const caption = clip(clean(captionText(node.closest('figure')?.querySelector('figcaption'))), 1000);
    if (!src) skippedImages++;
    append({type: 'image', src, alt: clip(clean(node.alt || ''), 1000), ...(caption ? {caption} : {}), ...(!src ? {imageError: '此图片无可直接下载的公开地址，可下载后导入。'} : {})});
  };
  const collectInline = (node, runs, marks, flush, type, level, special) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.nodeValue || '').replace(/\u0000/g, '');
      if (!text) return;
      const previous = runs[runs.length - 1];
      if (previous && previous.href === marks.href && !!previous.strong === !!marks.strong && !!previous.em === !!marks.em) previous.text += text;
      else runs.push({text, ...marks});
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return;
    if (special?.(node, runs, marks)) return;
    if (node.tagName === 'IMG') {flush(type, runs, level); runs.length = 0; imageBlock(node); return;}
    if (node.tagName === 'BR') {runs.push({text: '\n', ...marks}); return;}
    const next = {...marks};
    if (node.tagName === 'A') {const href = safeURL(node.getAttribute('href')); if (href) next.href = href;}
    if (['STRONG', 'B'].includes(node.tagName)) next.strong = true;
    if (['EM', 'I'].includes(node.tagName)) next.em = true;
    const nestedBlock = ['P', 'DIV', 'LI'].includes(node.tagName);
    if (nestedBlock && runs.length && !runs[runs.length - 1].text.endsWith('\n')) runs.push({text: '\n', ...next});
    for (const child of node.childNodes) collectInline(child, runs, next, flush, type, level, special);
    if (nestedBlock && runs.length) runs.push({text: '\n', ...next});
  };
  const listDetails = node => {
    let depth = -1;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (['UL', 'OL'].includes(parent.tagName)) depth++;
    depth = Math.max(0, depth);
    if (depth > 20) throw new Error('文章列表超过 20 层，请选取需要的部分后保存。');
    const list = node.parentElement;
    const style = getComputedStyle(list || node).listStyleType || '';
    if (list?.tagName !== 'OL') return {marker: style === 'none' ? '' : style === 'circle' ? '◦' : style === 'square' ? '▪' : '•', depth};
    const children = [...list.childNodes].filter(child => child.tagName === 'LI');
    const integer = value => typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
    const reversed = list.getAttribute('reversed') !== null, step = reversed ? -1 : 1;
    let number = integer(list.getAttribute('start')) ?? (reversed ? children.length : 1);
    for (const child of children) {number = integer(child.getAttribute('value')) ?? number; if (child === node) break; number += step;}
    const format = node.getAttribute('type') || list.getAttribute('type') || ({'lower-alpha':'a','lower-latin':'a','upper-alpha':'A','upper-latin':'A','lower-roman':'i','upper-roman':'I'}[style]) || '1';
    let label = String(number);
    if (['a', 'A'].includes(format) && number > 0) {
      label = ''; for (let current = number; current > 0; current = Math.floor((current - 1) / 26)) label = String.fromCharCode(97 + (current - 1) % 26) + label;
      if (format === 'A') label = label.toUpperCase();
    } else if (['i', 'I'].includes(format) && number > 0 && number < 4000) {
      label = ''; let current = number;
      for (const [value, roman] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) while (current >= value) {label += roman; current -= value;}
      if (format === 'i') label = label.toLowerCase();
    }
    return {marker: style === 'none' ? '' : label + '.', depth};
  };
  let tableRows = 0, tableCells = 0;
  const tableBlock = table => {
    const rowNodes = [], images = [];
    const findRows = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== Node.ELEMENT_NODE || !visible(child)) continue;
        if (child.tagName === 'TABLE') throw new Error('嵌套表格暂不能完整收录，请选中文字后保存。');
        if (child.tagName === 'TR') rowNodes.push(child); else findRows(child);
      }
    };
    findRows(table);
    if (!rowNodes.length) return;
    if ((tableRows += rowNodes.length) > 200) throw new Error('文章表格超过 200 行，请选取需要的部分后保存。');
    const caption = [...table.childNodes].find(child => child.tagName === 'CAPTION' && visible(child));
    if (caption) {const runs = []; collectInline(caption, runs, {}, textBlock, 'paragraph'); textBlock('paragraph', runs);}
    const rows = rowNodes.map(row => {
      const cells = [...row.childNodes].filter(child => ['TD', 'TH'].includes(child.tagName) && visible(child));
      if (!cells.length || cells.length > 100 || (tableCells += cells.length) > 2000) throw new Error('文章表格单元格超过保存上限，请选取需要的部分后保存。');
      let columns = 0;
      return {cells: cells.map(cell => {
        const runs = [];
        collectInline(cell, runs, {}, textBlock, 'paragraph', undefined, child => {
          if (child.tagName === 'TABLE') throw new Error('嵌套表格暂不能完整收录，请选中文字后保存。');
          if (child.tagName !== 'IMG') return false;
          images.push(child); return true;
        });
        while (runs.length && !runs[0].text.trim()) runs.shift();
        while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
        if (runs.length) {runs[0].text = runs[0].text.trimStart(); runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();}
        const result = {runs, header: cell.tagName === 'TH'};
        for (const key of ['colspan', 'rowspan']) {
          const raw = cell.getAttribute(key);
          if (raw === null) continue;
          const value = Number(raw);
          if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error('表格跨行跨列超过保存范围，请选中文字后保存。');
          if (value > 1) result[key] = value;
        }
        columns += result.colspan || 1;
        if (columns > 200) throw new Error('文章表格超过 200 列，请选取需要的部分后保存。');
        return result;
      })};
    });
    append({type: 'table', rows, ...(images.length ? {imagesAfter: true} : {})});
    for (const image of images) imageBlock(image);
  };
  const walk = node => {
    if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return;
    if (node.tagName === 'IMG') {imageBlock(node); return;}
    if (node.tagName === 'TABLE') {tableBlock(node); return;}
    if (node.tagName === 'BLOCKQUOTE') {
      const runs = [];
      collectInline(node, runs, {}, textBlock, 'quote', undefined, (child, inline) => {
        if (!['UL', 'OL', 'TABLE'].includes(child.tagName)) return false;
        textBlock('quote', inline); inline.length = 0; walk(child); return true;
      });
      textBlock('quote', runs); return;
    }
    if (node.tagName === 'LI') {
      const details = listDetails(node), runs = []; let first = true;
      const emit = (type, value, level) => {const before = blocks.length; textBlock(type, value, level); if (blocks.length > before) {Object.assign(blocks[blocks.length - 1], details, first ? {} : {marker: ''}); first = false;}};
      collectInline(node, runs, {}, emit, 'list-item', undefined, (child, inline) => {
        if (!['UL', 'OL', 'TABLE'].includes(child.tagName)) return false;
        emit('list-item', inline); inline.length = 0; walk(child); return true;
      });
      emit('list-item', runs); return;
    }
    const heading = /^H([1-6])$/.exec(node.tagName);
    const semantic = heading ? 'heading' : node.tagName === 'BLOCKQUOTE' ? 'quote' : node.tagName === 'LI' ? 'list-item' : node.tagName === 'PRE' ? 'code' : 'paragraph';
    if (!containers.has(node.tagName)) {
      const runs = []; collectInline(node, runs, {}, textBlock, semantic, heading ? Number(heading[1]) : undefined); textBlock(semantic, runs, heading ? Number(heading[1]) : undefined); return;
    }
    let runs = [];
    const flush = () => {textBlock('paragraph', runs); runs = [];};
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && (containers.has(child.tagName) || /^(?:H[1-6]|P|BLOCKQUOTE|LI|PRE|IMG|FIGCAPTION)$/.test(child.tagName))) {flush(); if (child.tagName !== 'FIGCAPTION') walk(child);}
      else collectInline(child, runs, {}, textBlock, 'paragraph');
    }
    flush();
  };
  walk(root);
  const body = blocks.filter(block => block.type !== 'image').map(block => block.type === 'table'
    ? block.rows.map(row => row.cells.map(cell => cell.runs.map(run => run.text).join('')).join('\t')).join('\n')
    : `${block.type === 'list-item' && block.marker ? block.marker + ' ' : ''}${block.runs.map(run => run.text).join('')}`).join('\n\n');
  if (!body.trim()) throw new Error('没有找到可读正文。可以选中文字后，在右键菜单中保存。');
  if (body.length > 50000) throw new Error('文章超过 50000 字，请先选中要保存的段落，再使用右键收录。');
  let runCount = 0;
  for (const block of blocks) for (const runs of block.type === 'table' ? block.rows.flatMap(row => row.cells.map(cell => cell.runs)) : block.runs ? [block.runs] : []) {
    if (runs.length > 512 || (runCount += runs.length) > 10000) throw new Error('文章行内结构超过保存上限，请选取需要的部分后保存。');
  }
  const article = {version: 1, blocks};
  if (new TextEncoder().encode(JSON.stringify(article)).length > 700000) throw new Error('文章链接与图片结构过大，请选取需要的部分后保存。');
  return {...base, body, article, ...(skippedImages ? {captureWarnings: [`${skippedImages} 张没有普通公开地址的图片未收录，可下载后导入。`]} : {})};
 } catch (error) {
  return {captureError: clip(String(error?.message || '当前页面无法读取，请重试。'), 500)};
 }
}
