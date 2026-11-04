import JSZip from 'jszip';

// EPUBs are untrusted documents. Nothing from a book becomes executable markup,
// stylesheet, a remote resource URL, or an unrestricted filesystem reference.
export const EPUB_LIMITS = Object.freeze({
  archiveBytes: 80 * 1024 * 1024,
  files: 2500,
  totalBytes: 120 * 1024 * 1024,
  entryBytes: 12 * 1024 * 1024,
  xmlBytes: 4 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  ratio: 200,
  chapters: 600,
  nodes: 100000,
  totalNodes: 500000,
  chapterBytes: 32 * 1024 * 1024,
  imagesPerChapter: 120,
});
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
const TAGS = new Set([
  ...BLOCKS,
  'a',
  'abbr',
  'b',
  'br',
  'caption',
  'cite',
  'code',
  'del',
  'em',
  'i',
  'img',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'var',
]);
const OMIT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'audio',
  'video',
  'source',
  'link',
  'meta',
  'base',
  'canvas',
  'template',
]);
const localName = (node) =>
  String(node?.localName || node?.nodeName || '')
    .split(':')
    .pop()
    .toLowerCase();
const elements = (node, name) => Array.from(node.getElementsByTagName('*')).filter((child) => localName(child) === name);
const attr = (node, name) => node?.getAttribute(name) || '';
const titleText = (node) =>
  String(node?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
const boundedInt = (value, min, max, fallback = min) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const XHTML_ENTITIES = {
  nbsp: 160,
  copy: 169,
  reg: 174,
  ndash: 8211,
  mdash: 8212,
  hellip: 8230,
  laquo: 171,
  raquo: 187,
  lsquo: 8216,
  rsquo: 8217,
  ldquo: 8220,
  rdquo: 8221,
  ensp: 8194,
  emsp: 8195,
  thinsp: 8201,
  shy: 173,
  bull: 8226,
  middot: 183,
  trade: 8482,
  euro: 8364,
  pound: 163,
  yen: 165,
  cent: 162,
  sect: 167,
  para: 182,
  deg: 176,
  plusmn: 177,
  times: 215,
  divide: 247,
  eacute: 233,
  Eacute: 201,
  aacute: 225,
  Aacute: 193,
  agrave: 224,
  Agrave: 192,
  auml: 228,
  Auml: 196,
  ouml: 246,
  Ouml: 214,
  uuml: 252,
  Uuml: 220,
  szlig: 223,
};
export const epubChapterIndex = (value, count) => Math.floor(boundedInt(value, 0, Math.max(0, count - 1)));
export const epubProgress = (value) => boundedInt(value, 0, 1);

export function safeArchivePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1200 ||
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  )
    return null;
  const parts = value.split('/');
  if (parts.some((part) => part === '..' || part === '.') || parts.slice(0, -1).some((part) => !part)) return null;
  return value;
}

export function resolveEpubHref(base, value) {
  if (typeof value !== 'string' || value.length > 1600 || /[\\\u0000-\u0020\u007f]/.test(value) || /^(?:\/|[a-z][a-z\d+.-]*:)/i.test(value)) return null;
  const [withoutHash, fragment = ''] = value.split('#');
  if (withoutHash.includes('?')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutHash);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(decoded)) return null;
  const stack = base.split('/').slice(0, -1);
  if (withoutHash) {
    for (const part of decoded.split('/')) {
      if (part === '..') {
        if (!stack.length) return null;
        stack.pop();
      } else if (part && part !== '.') stack.push(part);
    }
  } else stack.push(base.split('/').at(-1));
  const path = stack.join('/');
  if (!safeArchivePath(path)) return null;
  let anchor;
  try {
    anchor = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(anchor) || anchor.length > 500) return null;
  return { path, fragment: anchor, href: path + (anchor ? '#' + anchor : '') };
}

export function inspectEpubZip(input, limits = EPUB_LIMITS) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > limits.archiveBytes) throw Error('EPUB 文件过大，当前上限为 80 MiB。');
  if (bytes.byteLength < 22) throw Error('这不是完整的 EPUB 文件。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw Error('EPUB 压缩目录损坏。');
  const disk = view.getUint16(end + 4, true),
    startDisk = view.getUint16(end + 6, true),
    count = view.getUint16(end + 10, true),
    directorySize = view.getUint32(end + 12, true),
    directoryStart = view.getUint32(end + 16, true);
  if (disk || startDisk || count === 65535 || directoryStart === 0xffffffff || count !== view.getUint16(end + 8, true))
    throw Error('暂不支持分卷或 ZIP64 EPUB。');
  if (!count || count > limits.files || directoryStart + directorySize > end) throw Error('EPUB 文件数量超限或压缩目录无效。');
  let offset = directoryStart,
    total = 0;
  const seen = new Set(),
    records = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw Error('EPUB 压缩目录不完整。');
    const flags = view.getUint16(offset + 8, true),
      compression = view.getUint16(offset + 10, true),
      compressed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true),
      nameLength = view.getUint16(offset + 28, true),
      extraLength = view.getUint16(offset + 30, true),
      commentLength = view.getUint16(offset + 32, true),
      attributes = view.getUint32(offset + 38, true),
      local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extraLength + commentLength > directoryStart + directorySize) throw Error('EPUB 压缩目录越界。');
    let name;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw Error('EPUB 内部文件名不是有效的 UTF-8。');
    }
    if (!safeArchivePath(name) || seen.has(name)) throw Error('EPUB 含不安全或重复的内部路径。');
    if (flags & 1) throw Error('这本 EPUB 已加密，暂不支持 DRM 图书。');
    if (![0, 8].includes(compression) || ((attributes >>> 16) & 0xf000) === 0xa000) throw Error('EPUB 含不支持的压缩或符号链接。');
    if (size > limits.entryBytes || (size > 1024 * 1024 && size / Math.max(1, compressed) > limits.ratio)) throw Error('EPUB 内部文件解压体积超限。');
    if (
      local + 30 > directoryStart ||
      view.getUint32(local, true) !== 0x04034b50 ||
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + compressed > directoryStart
    )
      throw Error('EPUB 文件数据范围无效。');
    total += size;
    if (total > limits.totalBytes) throw Error('EPUB 总解压体积超限。');
    seen.add(name);
    records.push({ name, size, compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== directoryStart + directorySize) throw Error('EPUB 压缩目录长度不一致。');
  return records;
}

function parseXml(text, label, DOMParserClass) {
  if (/<!ENTITY/i.test(text)) throw Error(`${label} 含不支持的实体声明。`);
  // EPUB 2 commonly declares a public XHTML DTD. Remove the declaration rather
  // than asking an XML engine to resolve it; never accept an internal subset.
  text = text.replace(
    /<!DOCTYPE\s+html(?:\s+PUBLIC\s+["']-\/\/W3C\/\/DTD XHTML (?:1\.0 (?:Strict|Transitional|Frameset)|1\.1)\/\/EN["']\s+["']https?:\/\/www\.w3\.org\/[^"'<>\[\]]+["'])?\s*>/gi,
    '',
  );
  if (/<!DOCTYPE/i.test(text)) throw Error(`${label} 含不支持的文档类型声明。`);
  // Common XHTML publishing entities become numeric references; arbitrary DTD
  // entities remain unsupported and are rejected by the strict XML parser.
  text = text.replace(/&([A-Za-z][A-Za-z0-9]{1,20});/g, (whole, name) => (XHTML_ENTITIES[name] ? `&#${XHTML_ENTITIES[name]};` : whole));
  const parsed = new DOMParserClass().parseFromString(text, 'application/xml');
  if (!parsed.documentElement || localName(parsed.documentElement) === 'parsererror' || elements(parsed, 'parsererror').length)
    throw Error(`${label} XML 格式损坏。`);
  return parsed;
}

export function sanitizeEpubChapter(xml, { path, DOMParserClass = globalThis.DOMParser } = {}) {
  const document = typeof xml === 'string' ? parseXml(xml, 'EPUB 正文', DOMParserClass) : xml,
    body = elements(document, 'body')[0];
  if (!body) throw Error('EPUB 正文缺少 body。');
  let count = 0;
  const images = new Set();
  function convert(node) {
    if (++count > EPUB_LIMITS.nodes) throw Error('EPUB 章节结构过于复杂。');
    if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || '';
    if (node.nodeType !== 1) return null;
    const tag = localName(node);
    if (OMIT.has(tag)) return null;
    const children = Array.from(node.childNodes).flatMap((child) => {
      const next = convert(child);
      return next == null ? [] : Array.isArray(next) ? next : [next];
    });
    if (!TAGS.has(tag)) return children;
    const attributes = {};
    const anchor = attr(node, 'id') || attr(node, 'name');
    if (anchor && anchor.length < 500) attributes.anchor = anchor;
    const language = attr(node, 'lang') || attr(node, 'xml:lang');
    if (/^[a-z]{2,8}(?:-[a-z\d]{2,8})*$/i.test(language)) attributes.lang = language;
    if (tag === 'a') {
      const target = resolveEpubHref(path, attr(node, 'href'));
      if (target) attributes.href = target.href;
      // Remote hyperlinks are displayed as ordinary text; they never navigate.
      if (!target) return { tag: 'span', attrs: attributes, children };
    }
    if (tag === 'img') {
      const target = resolveEpubHref(path, attr(node, 'src'));
      if (!target) return null;
      images.add(target.path);
      if (images.size > EPUB_LIMITS.imagesPerChapter) throw Error('EPUB 章节图片过多。');
      attributes.imagePath = target.path;
      attributes.alt = attr(node, 'alt').slice(0, 500);
      return { tag: 'img', attrs: attributes, children: [] };
    }
    if (['td', 'th'].includes(tag)) {
      for (const name of ['colspan', 'rowspan']) {
        const value = Number(attr(node, name));
        if (Number.isInteger(value) && value > 1 && value <= 20) attributes[name] = value;
      }
    }
    return { tag, attrs: attributes, children: BLOCKS.has(tag) ? [...children, '\n'] : children };
  }
  const tree = Array.from(body.childNodes).flatMap((node) => {
    const converted = convert(node);
    return converted == null ? [] : Array.isArray(converted) ? converted : [converted];
  });
  function textOf(node) {
    return typeof node === 'string' ? node : (node.children || []).map(textOf).join('');
  }
  const text = tree.map(textOf).join('');
  const heading = elements(body, 'h1')[0] || elements(body, 'h2')[0] || elements(document, 'title')[0];
  return { tree, text, title: titleText(heading), images: [...images], nodeCount: count };
}

function streamEntry(file, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0,
      failed = false;
    const stream = file.internalStream('uint8array');
    stream.on('data', (chunk) => {
      if (failed) return;
      length += chunk.byteLength;
      if (length > maxBytes) {
        failed = true;
        stream.pause();
        reject(Error('EPUB 文件实际解压体积超限。'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error) => {
      if (!failed) {
        failed = true;
        reject(Error('EPUB 解压失败：' + String(error.message || error).slice(0, 120)));
      }
    });
    stream.on('end', () => {
      if (failed) return;
      const output = new Uint8Array(length);
      let position = 0;
      for (const chunk of chunks) {
        output.set(chunk, position);
        position += chunk.length;
      }
      resolve(output);
    });
    stream.resume();
  });
}

export function rasterMime(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(new TextDecoder().decode(bytes.subarray(0, 6)))) return 'image/gif';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP')
    return 'image/webp';
  return null;
}

export function rasterDimensions(bytes, type = rasterMime(bytes)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png' && bytes.length >= 24 && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR')
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (type === 'image/gif' && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (type === 'image/webp' && bytes.length >= 30) {
    const variant = String.fromCharCode(...bytes.subarray(12, 16));
    if (variant === 'VP8X')
      return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (variant === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (variant === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7)
        return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
      offset += length;
    }
  }
  return null;
}

export async function openEpub(input, { DOMParserClass = globalThis.DOMParser, signal } = {}) {
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('EPUB 读取已取消。', 'AbortError');
  };
  checkAbort();
  if (!DOMParserClass) throw Error('当前环境缺少 EPUB XML 读取能力。');
  const metadata = inspectEpubZip(input),
    known = new Map(metadata.map((entry) => [entry.name, entry]));
  const zip = await JSZip.loadAsync(input, { createFolders: false });
  let actualBytes = 0;
  const decoded = new Set();
  async function read(path, limit = EPUB_LIMITS.xmlBytes) {
    checkAbort();
    const meta = known.get(path),
      file = zip.file(path);
    if (!meta || !file) throw Error('EPUB 缺少文件：' + path.slice(0, 150));
    if (meta.size > limit) throw Error('EPUB 内部资源过大：' + path.slice(0, 150));
    const output = await streamEntry(file, Math.min(limit, decoded.has(path) ? limit : EPUB_LIMITS.totalBytes - actualBytes));
    if (!decoded.has(path)) {
      actualBytes += output.length;
      decoded.add(path);
    }
    checkAbort();
    if (output.length !== meta.size) throw Error('EPUB 实际解压长度与目录不一致。');
    return output;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  async function xml(path, label) {
    let text;
    try {
      text = decoder.decode(await read(path));
    } catch (error) {
      if (error instanceof TypeError) throw Error(`${label} 不是有效的 UTF-8。`);
      throw error;
    }
    return parseXml(text, label, DOMParserClass);
  }
  if (known.has('META-INF/encryption.xml')) throw Error('这本 EPUB 含加密资源，暂不支持 DRM 或字体混淆。');
  const mimetype = known.get('mimetype');
  if (mimetype) {
    const mime = decoder.decode(await read('mimetype', 200)).trim();
    if (mime !== 'application/epub+zip') throw Error('文件类型不是 EPUB。');
  }
  const container = await xml('META-INF/container.xml', 'EPUB 容器'),
    rootfile =
      elements(container, 'rootfile').find((node) => attr(node, 'media-type') === 'application/oebps-package+xml') || elements(container, 'rootfile')[0],
    opfPath = rootfile && safeArchivePath(attr(rootfile, 'full-path'));
  if (!opfPath) throw Error('EPUB 缺少有效的图书目录。');
  const opf = await xml(opfPath, 'EPUB 图书目录');
  if (localName(opf.documentElement) !== 'package') throw Error('EPUB 图书目录根节点无效。');
  const manifest = new Map();
  for (const item of elements(opf, 'item')) {
    const id = attr(item, 'id'),
      target = resolveEpubHref(opfPath, attr(item, 'href'));
    if (id && target && !manifest.has(id))
      manifest.set(id, { id, path: target.path, type: attr(item, 'media-type'), properties: attr(item, 'properties').split(/\s+/) });
  }
  const spine = elements(opf, 'spine')[0],
    refs = spine ? elements(spine, 'itemref') : [];
  if (!refs.length || refs.length > EPUB_LIMITS.chapters) throw Error('EPUB 没有可读章节或章节数量超限。');
  const chapters = [];
  const pathIndices = new Map();
  let chapterBytes = 0,
    chapterNodes = 0;
  for (const ref of refs) {
    const item = manifest.get(attr(ref, 'idref'));
    if (!item || !['application/xhtml+xml', 'text/html'].includes(item.type)) throw Error('EPUB 含暂不支持的正文格式。');
    if (pathIndices.has(item.path)) continue;
    chapterBytes += known.get(item.path)?.size || 0;
    if (chapterBytes > EPUB_LIMITS.chapterBytes) throw Error('EPUB 全书正文体积过大，暂无法加载。');
    const chapter = await xml(item.path, 'EPUB 章节');
    const content = sanitizeEpubChapter(chapter, { path: item.path, DOMParserClass });
    chapterNodes += content.nodeCount;
    if (chapterNodes > EPUB_LIMITS.totalNodes) throw Error('EPUB 全书结构过于复杂，暂无法加载。');
    pathIndices.set(item.path, chapters.length);
    chapters.push({ path: item.path, ...content, title: content.title || `第 ${chapters.length + 1} 章` });
  }
  function resolveTarget(base, href) {
    const target = resolveEpubHref(base, href);
    if (!target || !pathIndices.has(target.path)) return null;
    return { ...target, chapter: pathIndices.get(target.path) };
  }
  let outline = [];
  const navItem = [...manifest.values()].find((item) => item.properties.includes('nav'));
  if (navItem) {
    const nav = await xml(navItem.path, 'EPUB 目录导航'),
      navNode =
        elements(nav, 'nav').find((node) =>
          (attr(node, 'epub:type') || node.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || attr(node, 'type')).split(/\s+/).includes('toc'),
        ) || elements(nav, 'nav')[0];
    let serial = 0;
    function navList(list, depth = 0) {
      if (depth > 12) return [];
      return Array.from(list?.childNodes || [])
        .filter((node) => localName(node) === 'li')
        .flatMap((li) => {
          const a = Array.from(li.childNodes).find((node) => localName(node) === 'a'),
            nested = Array.from(li.childNodes).find((node) => localName(node) === 'ol'),
            target = a && resolveTarget(navItem.path, attr(a, 'href')),
            children = navList(nested, depth + 1);
          return target
            ? [{ id: 'nav-' + serial++, title: titleText(a) || chapters[target.chapter].title, chapter: target.chapter, href: target.href, children }]
            : children;
        });
    }
    outline = navList(Array.from(navNode?.childNodes || []).find((node) => localName(node) === 'ol'));
  }
  if (!outline.length) {
    const ncx = manifest.get(attr(spine, 'toc')) || [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml');
    if (ncx) {
      const navigation = await xml(ncx.path, 'EPUB NCX 目录');
      let serial = 0;
      function points(parent, depth = 0) {
        if (depth > 12) return [];
        return Array.from(parent?.childNodes || [])
          .filter((node) => localName(node) === 'navpoint')
          .flatMap((point) => {
            const content = Array.from(point.childNodes).find((node) => localName(node) === 'content'),
              label = Array.from(point.childNodes).find((node) => localName(node) === 'navlabel'),
              target = content && resolveTarget(ncx.path, attr(content, 'src')),
              children = points(point, depth + 1);
            return target
              ? [{ id: 'ncx-' + serial++, title: titleText(label) || chapters[target.chapter].title, chapter: target.chapter, href: target.href, children }]
              : children;
          });
      }
      outline = points(elements(navigation, 'navmap')[0]);
    }
  }
  if (!outline.length)
    outline = chapters.map((chapter, index) => ({ id: 'chapter-' + index, title: chapter.title, chapter: index, href: chapter.path, children: [] }));
  const metadataNode = elements(opf, 'metadata')[0],
    coverId = metadataNode && elements(metadataNode, 'meta').find((node) => attr(node, 'name').toLowerCase() === 'cover'),
    coverItem = [...manifest.values()].find((item) => item.properties.includes('cover-image')) || manifest.get(coverId && attr(coverId, 'content'));
  const coverPath = coverItem && known.has(coverItem.path) && /^image\/(?:png|jpeg|gif|webp)$/.test(coverItem.type) ? coverItem.path : null;
  return {
    chapters,
    outline,
    coverPath,
    title: titleText(metadataNode && elements(metadataNode, 'title')[0]),
    author: titleText(metadataNode && elements(metadataNode, 'creator')[0]),
    resolveHref(href) {
      const [path, fragment = ''] = String(href).split('#');
      const chapter = pathIndices.get(path);
      return chapter === undefined ? null : { chapter, fragment };
    },
    async image(path) {
      if (!known.has(path)) return null;
      const bytes = await read(path, EPUB_LIMITS.imageBytes),
        type = rasterMime(bytes),
        dimensions = type && rasterDimensions(bytes, type);
      return dimensions &&
        dimensions.width > 0 &&
        dimensions.height > 0 &&
        dimensions.width <= 16000 &&
        dimensions.height <= 16000 &&
        dimensions.width * dimensions.height <= 40000000
        ? new Blob([bytes], { type })
        : null;
    },
  };
}

export function searchEpub(book, query, { limit = 200 } = {}) {
  const needle = String(query || '')
    .trim()
    .slice(0, 300);
  if (!needle) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const results = [];
  for (let chapter = 0; chapter < book.chapters.length; chapter++) {
    const text = book.chapters[chapter].text;
    pattern.lastIndex = 0;
    let match;
    while (results.length < limit && (match = pattern.exec(text))) {
      const start = match.index,
        end = start + match[0].length;
      results.push({
        chapter,
        start,
        end,
        title: book.chapters[chapter].title,
        excerpt: text.slice(Math.max(0, start - 45), Math.min(text.length, end + 65)).replace(/\s+/g, ' '),
      });
    }
    if (results.length >= limit) break;
  }
  return results;
}

export async function readEpubSource(source, { signal, fetcher = globalThis.fetch } = {}) {
  const target = source?.dataUrl || source?.url;
  if (typeof target !== 'string' || !target) throw Error('找不到 EPUB 原文件。');
  if (source.size > EPUB_LIMITS.archiveBytes) throw Error('EPUB 文件过大，当前上限为 80 MiB。');
  if (target.startsWith('data:')) {
    const match = target.match(/^data:application\/(?:epub\+zip|octet-stream|zip);base64,([a-z\d+/=\r\n]+)$/i);
    if (!match || match[1].length > Math.ceil((EPUB_LIMITS.archiveBytes * 4) / 3) + 100) throw Error('EPUB 文件数据无效或过大。');
    const decoded = atob(match[1]);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }
  let url;
  try {
    url = new URL(target, globalThis.location?.href);
  } catch {
    throw Error('EPUB 文件地址无效。');
  }
  if (
    url.username ||
    url.password ||
    (!['blob:', 'mengcang-reader:'].includes(url.protocol) && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
    throw Error('EPUB 阅读仅接受本机文件。');
  const response = await fetcher(url.href, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw Error('无法读取 EPUB 原文件。');
  const length = Number(response.headers?.get('content-length'));
  if (length > EPUB_LIMITS.archiveBytes) throw Error('EPUB 文件过大。');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > EPUB_LIMITS.archiveBytes) throw Error('EPUB 文件过大。');
    return bytes;
  }
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > EPUB_LIMITS.archiveBytes) {
        await reader.cancel();
        throw Error('EPUB 文件过大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
