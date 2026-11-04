// Browser and native capture input. No storage, network, or model requests.
import {normalizeArticleModel} from './article.mjs';
import {normalizeWebAnchor,normalizeAnchorText} from './anchors.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const badUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const credentialKey = /^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i;
export const MAX_CLIPPER_IMAGE_BYTES = 10 * 1024 * 1024;
export const CLIPPER_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
export function clipperError(code, message) { return Object.assign(new Error(message), {code}); }
const fail = message => { throw clipperError('INVALID_CLIPPER', message); };
function shape(value, keys, label) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(`${label}包含不支持的字段`);
}
function text(value, max, label, empty = true) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || badUnicode.test(value) || (!empty && !value.trim())) fail(`${label}无效`);
  return value;
}
function sourceUrl(value, label) {
  text(value, 4096, label, false);
  if (/[\x00-\x20\x7f]/.test(value)) fail(`${label}包含无效字符`);
  let url;
  try { url = new URL(value); } catch { fail(`${label}无效`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail(`${label}必须是未嵌入账号密码的 HTTP(S) 链接`);
  if ([...url.searchParams.keys()].some(key => credentialKey.test(key))) fail(`${label}含有凭证参数，请使用不含凭证的来源链接`);
  return url.href;
}
function imageAttachment(value) {
  shape(value, ['name', 'type', 'size', 'dataUrl'], '图片附件');
  const name = text(value.name, 1000, '图片名称', false), type = text(value.type, 100, '图片类型', false).trim().toLowerCase();
  if (/[\x00-\x1f\x7f]/.test(name) || !CLIPPER_IMAGE_TYPES.includes(type)) fail('图片附件必须是 PNG、JPEG、GIF、WebP 或 AVIF');
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_CLIPPER_IMAGE_BYTES) fail('图片应在 10 MiB 以内');
  const dataUrl = text(value.dataUrl, Math.ceil(MAX_CLIPPER_IMAGE_BYTES / 3) * 4 + 200, '图片内容', false);
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match || match[1].toLowerCase() !== type || match[2].length % 4 !== 0) fail('图片内容必须是类型相符的 base64 文件');
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (bytes !== value.size) fail('图片字节数与内容不匹配');
  // The owning renderer additionally invokes the existing workspace attachment
  // validator, which checks the actual file signature rather than just MIME.
  return {name, type, size:value.size, dataUrl};
}
export function normalizeClipperParams(raw, {requireImageAttachment = false} = {}) {
  shape(raw, ['version', 'requestId', 'kind', 'sourceUrl', 'title', 'body', 'author', 'siteName', 'imageUrl', 'attachment','article','anchor','sourceCardId','note','favorite','collectionIds','screenshot'], '浏览器收录请求');
  if (raw.version !== 1 || !['link', 'article', 'image','highlight'].includes(raw.kind)) fail('不支持的浏览器收录版本或类型');
  if (typeof raw.requestId !== 'string' || !UUID.test(raw.requestId)) fail('浏览器收录请求标识必须是 UUID');
  const url = sourceUrl(raw.sourceUrl, '网页来源'), title = text(raw.title ?? '', 1000, '标题');
  const normalized = {version:1, requestId:raw.requestId.toLowerCase(), kind:raw.kind, sourceUrl:url, title:title.trim() ? title : new URL(url).hostname,
    body:text(raw.body ?? '', 50000, '收录正文'), author:text(raw.author ?? '', 1000, '作者'), siteName:text(raw.siteName ?? '', 1000, '站点名称')};
  if (raw.kind === 'article' && !normalized.body.trim()) fail('此页面没有可收录的文章正文，请先选择文字或保存网页链接');
  if(raw.article!==undefined){
    if(raw.kind!=='article')fail('只有文章收录可以携带图文内容');
    normalized.article=normalizeArticleModel(raw.article,{normalizeAttachment:imageAttachment});
    if(requireImageAttachment&&normalized.article.blocks.some(block=>block.type==='image'&&!block.attachment&&!block.imageError))throw clipperError('IMAGE_NOT_DOWNLOADED','部分文章图片尚未取得，未保存未确认的图片引用');
  }
  if(raw.anchor!==undefined){
    if(raw.kind!=='highlight')fail('只有高亮收录可以携带原文位置');
    normalized.anchor=normalizeWebAnchor(raw.anchor);
  }
  if(raw.kind==='highlight'&&(!normalized.anchor||normalizeAnchorText(normalized.body)!==normalized.anchor.exact))fail('高亮正文与原文位置不一致，请重新选择文字');
  if(raw.sourceCardId!==undefined){
    if(raw.kind!=='highlight')fail('只有高亮可以引用来源文章');
    normalized.sourceCardId=text(raw.sourceCardId,2000,'来源文章标识',false);
  }
  // Omit absent optional fields: old durable receipts bind the original JSON
  // key order and must remain retryable after this compatible extension.
  if(raw.note!==undefined)normalized.note=text(raw.note,50000,'收录备注');
  if(raw.favorite!==undefined){if(typeof raw.favorite!=='boolean')fail('标星状态无效');normalized.favorite=raw.favorite;}
  if(raw.collectionIds!==undefined){
    if(!Array.isArray(raw.collectionIds)||raw.collectionIds.length>100)fail('收藏集选择无效');
    normalized.collectionIds=[...new Set(raw.collectionIds.map(id=>text(id,2000,'收藏集标识',false)))];
  }
  if (raw.kind !== 'image' && (raw.imageUrl !== undefined || raw.attachment !== undefined)) fail('只有图片收录可以携带图片地址和附件');
  if (raw.kind === 'image') {
    if (raw.imageUrl !== undefined) normalized.imageUrl = sourceUrl(raw.imageUrl, '图片来源');
    if (raw.attachment !== undefined) normalized.attachment = imageAttachment(raw.attachment);
    if (!normalized.imageUrl && !normalized.attachment) fail('图片收录缺少原图片地址或文件');
    if (requireImageAttachment && !normalized.attachment) throw clipperError('IMAGE_NOT_DOWNLOADED', '图片原文件尚未取得，未保存图片引用');
  }
  if (raw.screenshot !== undefined) {
    if (!['viewport','region'].includes(raw.screenshot) || raw.kind !== 'image' || normalized.imageUrl || !['image/png','image/jpeg'].includes(normalized.attachment?.type))
      fail('截图必须是来自当前网页的 PNG 或 JPEG 文件');
    normalized.screenshot = raw.screenshot;
  }
  return normalized;
}

// A URL download is derived data: later retries may receive different bytes
// from the same image URL and must still return the first committed original.
// Inline-only local requests have no such derivation, so bind their bytes too.
export function clipperPayloadIdentity(raw) {
  const normalized = normalizeClipperParams(raw), {attachment, ...identity} = normalized;
  if (normalized.kind === 'image' && !normalized.imageUrl && attachment) identity.attachment = attachment;
  if(identity.article)identity.article={version:1,blocks:identity.article.blocks.map(block=>{if(block.type!=='image'||!block.src)return block;const {attachment,imageError,...original}=block;return original;})};
  return identity;
}

export function clipperPageKey(value){const url=new URL(sourceUrl(value,'网页来源'));url.hash='';return url.href;}
export function normalizeClipperQuery(method,raw={}){
  if(method==='related'||method==='openRelated'){
    shape(raw,method==='related'?['workspaceId','requestId']:['workspaceId','requestId','cardId'],'相关资料请求');
    if(typeof raw.requestId!=='string'||!UUID.test(raw.requestId))fail('剪藏回执标识无效');
    return {workspaceId:text(raw.workspaceId,4096,'资料库标识',false),requestId:raw.requestId.toLowerCase(),
      ...(method==='openRelated'?{cardId:text(raw.cardId,4096,'资料标识',false)}:{})};
  }
  if(!['collections','highlights'].includes(method))throw clipperError('METHOD_NOT_FOUND','不支持的浏览器查询');
  shape(raw,method==='highlights'?['sourceUrl','offset','limit']:['offset','limit'],'浏览器查询');
  const offset=raw.offset??0,limit=raw.limit??50;
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(limit)||limit<1||limit>50)fail('浏览器查询分页无效');
  return {offset,limit,...(method==='highlights'?{sourceUrl:sourceUrl(raw.sourceUrl,'网页来源')}:{})};
}
