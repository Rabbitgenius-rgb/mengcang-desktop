var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// attachment-validation-entry.mjs
var attachment_validation_entry_exports = {};
__export(attachment_validation_entry_exports, {
  MAX_ATTACHMENT_BYTES: () => MAX_ATTACHMENT_BYTES,
  normalizeWorkspaceAttachment: () => normalizeWorkspaceAttachment
});
module.exports = __toCommonJS(attachment_validation_entry_exports);

// prototypes/desktop-workbench/src/sublime/workspaceModel.js
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
var fail = (message) => {
  throw new Error(`\u5DE5\u4F5C\u533A\u6570\u636E\u65E0\u6548\uFF1A${message}\u3002\u8BF7\u4FDD\u7559\u539F\u6570\u636E\u540E\u91CD\u8BD5\u3002`);
};
var text = (value, name, limit = 1e5) => {
  if (value === void 0 || value === null) return "";
  if (typeof value !== "string" || value.length > limit || value.includes("\0")) fail(`${name}\u5E94\u4E3A\u6709\u6548\u6587\u5B57`);
  return value;
};
var MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
var MAX_WORKSPACE_BACKUP_BYTES = 256 * 1024 * 1024;
var WORKSPACE_FILE_TYPES = Object.freeze([
  ["image/png", [".png"], "image"],
  ["image/jpeg", [".jpg", ".jpeg"], "image"],
  ["image/gif", [".gif"], "image"],
  ["image/webp", [".webp"], "image"],
  ["image/avif", [".avif"], "image"],
  ["image/bmp", [".bmp"], "image"],
  ["image/tiff", [".tif", ".tiff"], "image"],
  ["application/pdf", [".pdf"], "pdf"],
  ["application/msword", [".doc"], "word"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", [".docx"], "word"],
  ["image/heic", [".heic"], "heic"],
  ["image/heif", [".heif"], "heic"],
  ["video/mp4", [".mp4"], "video"],
  ["video/quicktime", [".mov"], "video"],
  ["video/x-msvideo", [".avi"], "video"],
  ["video/ogg", [".ogv"], "video"],
  ["audio/mpeg", [".mp3"], "audio"],
  ["audio/wav", [".wav"], "audio"],
  ["audio/x-wav", [], "audio"],
  ["audio/mp4", [".m4a", ".m4b"], "audio"],
  ["audio/aac", [".aac"], "audio"],
  ["audio/flac", [".flac"], "audio"],
  ["audio/ogg", [".ogg", ".opus"], "audio"],
  ["application/ogg", [], "audio"],
  ["image/jpg", [], "image"],
  ["image/pjpeg", [], "image"],
  ["audio/wave", [], "audio"],
  ["audio/vnd.wave", [], "audio"],
  ["audio/x-flac", [], "audio"],
  ["audio/x-m4a", [], "audio"],
  ["video/avi", [], "video"],
  ["video/msvideo", [], "video"],
  ["application/vnd.msword", [], "word"]
].map(([mime, extensions, kind]) => Object.freeze({ mime, extensions: Object.freeze(extensions), kind })));
var supportedMime = new Set(WORKSPACE_FILE_TYPES.map((value) => value.mime));
var canonicalMime = (mime) => ({ "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "audio/x-flac": "audio/flac", "audio/x-m4a": "audio/mp4", "video/avi": "video/x-msvideo", "video/msvideo": "video/x-msvideo", "application/vnd.msword": "application/msword", "application/ogg": "audio/ogg", "video/ogg": "audio/ogg" })[mime] || mime;
var readLittle = (value, offset, length) => {
  let result = 0;
  for (let i = length - 1; i >= 0; i--) result = result * 256 + value.charCodeAt(offset + i);
  return result;
};
function base64Bytes(base64, start, end) {
  const first = Math.floor(start / 3) * 4, last = Math.ceil(end / 3) * 4;
  const bytes = atob(base64.slice(first, last));
  return bytes.slice(start % 3, start % 3 + end - start);
}
function isDocx(base64, size) {
  const tailStart = Math.max(0, size - 65557), tail = base64Bytes(base64, tailStart, size);
  const end = tail.lastIndexOf("PK");
  if (end < 0 || end + 22 > tail.length) return false;
  if (readLittle(tail, end + 4, 2) || readLittle(tail, end + 6, 2) || end + 22 + readLittle(tail, end + 20, 2) !== tail.length) return false;
  const entries = readLittle(tail, end + 10, 2), length = readLittle(tail, end + 12, 4), offset = readLittle(tail, end + 16, 4);
  if (!entries || entries > 1e4 || length > 4 * 1024 * 1024 || offset + length > tailStart + end) return false;
  const directory = base64Bytes(base64, offset, offset + length), names = /* @__PURE__ */ new Set();
  let cursor = 0, totalInflated = 0;
  for (let i = 0; i < entries; i++) {
    if (directory.slice(cursor, cursor + 4) !== "PK" || cursor + 46 > directory.length) return false;
    const flags = readLittle(directory, cursor + 8, 2), uncompressed = readLittle(directory, cursor + 24, 4), nameLength = readLittle(directory, cursor + 28, 2), extra = readLittle(directory, cursor + 30, 2), comment = readLittle(directory, cursor + 32, 2);
    const filename = directory.slice(cursor + 46, cursor + 46 + nameLength);
    totalInflated += uncompressed;
    if (flags & 1 || totalInflated > 128 * 1024 * 1024 || /^[/\\]/.test(filename) || filename.split(/[/\\]/).includes("..")) return false;
    names.add(filename);
    cursor += 46 + nameLength + extra + comment;
    if (cursor > directory.length) return false;
  }
  return cursor === directory.length && names.has("[Content_Types].xml") && names.has("word/document.xml");
}
function inspectFileDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 200) fail("\u9644\u4EF6\u8D85\u8FC764MiB");
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(dataUrl);
  if (!match || !match[2] || match[2].length % 4 !== 0) fail("\u9644\u4EF6\u5FC5\u987B\u662F\u6709\u6548\u7684base64\u6587\u4EF6");
  const declaredMime = match[1].toLowerCase(), mime = canonicalMime(declaredMime);
  if (!supportedMime.has(declaredMime)) fail("\u9644\u4EF6\u7C7B\u578B\u4E0D\u53D7\u652F\u6301\uFF0C\u4E0D\u652F\u6301SVG\u6216HTML");
  const base64 = match[2];
  const size = base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (size < 1 || size > MAX_ATTACHMENT_BYTES) fail("\u9644\u4EF6\u8D85\u8FC764MiB\u6216\u4E3A\u7A7A");
  let header;
  try {
    header = atob(base64.slice(0, 88));
  } catch {
    fail("\u9644\u4EF6base64\u683C\u5F0F\u65E0\u6548");
  }
  const riff = (kind) => header.startsWith("RIFF") && header.slice(8, 12) === kind;
  const ftyp = header.slice(4, 8) === "ftyp", brands = header.slice(8);
  const signature = mime === "application/pdf" ? header.startsWith("%PDF-") : mime === "application/msword" ? header.startsWith("\xD0\xCF\xE0\xA1\xB1\xE1") : mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? header.startsWith("PK") && isDocx(base64, size) : ["image/heic", "image/heif"].includes(mime) ? ftyp && /heic|heix|hevc|hevx|mif1|msf1/.test(brands) : mime === "video/mp4" || mime === "audio/mp4" ? ftyp && /isom|iso[2-9]|mp4[12]|M4A |M4B |avc1|dash/.test(brands) : mime === "video/quicktime" ? ftyp ? brands.includes("qt  ") : ["moov", "mdat", "wide", "free"].includes(header.slice(4, 8)) : mime === "video/x-msvideo" ? riff("AVI ") : ["audio/ogg", "video/ogg", "application/ogg"].includes(mime) ? header.startsWith("OggS") : mime === "audio/wav" || mime === "audio/x-wav" ? riff("WAVE") : mime === "audio/flac" ? header.startsWith("fLaC") : mime === "audio/mpeg" ? header.startsWith("ID3") || header.charCodeAt(0) === 255 && (header.charCodeAt(1) & 224) === 224 : mime === "audio/aac" ? header.startsWith("ADIF") || header.charCodeAt(0) === 255 && (header.charCodeAt(1) & 246) === 240 : mime === "image/png" ? header.startsWith("\x89PNG\r\n\n") : mime === "image/jpeg" ? header.startsWith("\xFF\xD8\xFF") : mime === "image/gif" ? /^GIF8[79]a/.test(header) : mime === "image/webp" ? riff("WEBP") : mime === "image/avif" ? header.slice(4, 8) === "ftyp" && /avif|avis/.test(header.slice(8)) : mime === "image/bmp" ? header.startsWith("BM") : header.startsWith("II*\0") || header.startsWith("MM\0*");
  if (!signature) fail("\u9644\u4EF6\u6587\u4EF6\u5934\u4E0E\u7C7B\u578B\u4E0D\u5339\u914D");
  return { mime: declaredMime, size };
}
function normalizeWorkspaceAttachment(value) {
  if (value === void 0 || value === null) return null;
  if (!object(value)) fail("\u9644\u4EF6\u5E94\u4E3A\u5BF9\u8C61");
  const name = text(value.name, "\u9644\u4EF6\u540D\u79F0", 1e3);
  if (!name.trim() || /[\x00-\x1f\x7f]/.test(name)) fail("\u9644\u4EF6\u540D\u79F0\u65E0\u6548");
  if (/\.(?:html?|svg|xml|[cm]?js|exe|app|sh|command)$/i.test(name.trim())) fail("\u9644\u4EF6\u540D\u79F0\u4E0D\u80FD\u4F7F\u7528\u53EF\u6267\u884C\u7F51\u9875\u6216\u7A0B\u5E8F\u6269\u5C55\u540D");
  const type = text(value.type, "\u9644\u4EF6\u7C7B\u578B", 100);
  const dataUrl = text(value.dataUrl, "\u9644\u4EF6\u5185\u5BB9", Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 200);
  const inspected = inspectFileDataUrl(dataUrl);
  if (canonicalMime(type.trim().toLowerCase()) !== canonicalMime(inspected.mime) || !supportedMime.has(type.trim().toLowerCase()) || !Number.isSafeInteger(value.size) || value.size !== inspected.size) fail("\u9644\u4EF6\u7C7B\u578B\u6216\u5B57\u8282\u6570\u4E0E\u5185\u5BB9\u4E0D\u5339\u914D");
  return { name, type, size: value.size, dataUrl };
}
var AI_MODES = Object.freeze(["The Gist", "Explain Like I\u2019m 5", "Contrarian Take", "Analogy", "Hot Take"]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_ATTACHMENT_BYTES,
  normalizeWorkspaceAttachment
});
