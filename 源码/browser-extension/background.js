import {capturePage, trimUtf16} from './capture.js';
import {captureBoundTab} from './screenshot.js';
export const HOST = 'com.rabbit.mengcang.clipper';
const JOBS = 'mengcangClipperJobsV1', LAST_ERROR = 'mengcangClipperLastErrorV1', PREFERENCES = 'mengcangClipperPreferencesV2';
const MAX_PENDING = 12;
const UI_PROTOCOL = 4, UPDATE_NOTICE = '扩展更新尚未生效，请关闭面板后在扩展管理页重新加载梦藏';
let serial = Promise.resolve(), preferencesSerial = Promise.resolve(), jobsSerial = Promise.resolve();
const activeRequests = new Set();
const enqueue = operation => {const job = serial.then(operation, operation); serial = job.catch(() => {}); return job;};
const credentialKey = /^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|auth|signature|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i;
const publicPage = value => {try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && ![...url.searchParams.keys()].some(key => credentialKey.test(key));} catch {return false;}};
const sitePattern = value => {if (!publicPage(value)) throw new Error('请在普通网页上设置自动高亮。'); const url = new URL(value); return `${url.protocol}//${url.hostname}/*`;};
const popupSender = sender => sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));

export function userError(error) {
  const message = String(error?.message || error || '保存未完成，请重试。');
  if (/native messaging host not found|specified native messaging host|not registered|not found/i.test(message)) return '尚未安装本机连接。请先运行扩展包中的「安装本机连接」脚本。';
  if (/access to the specified native messaging host is forbidden/i.test(message)) return '本机连接未允许此扩展。请用当前扩展包重新安装本机连接。';
  if (/cannot access|extensions gallery|chrome:|edge:|missing host permission/i.test(message)) return '这个浏览器页面无法收录，或当前框架没有访问权限。请在普通网页主页面操作。';
  return trimUtf16(message, 500);
}
const callHost = async (method, params = {}) => {
  const response = await chrome.runtime.sendNativeMessage(HOST, {method, params});
  if (response?.ok !== true) throw Object.assign(new Error(response?.error?.message || '本机连接没有返回结果，请打开梦藏后重试。'), {code: response?.error?.code});
  return response.data;
};
const readJobs = async () => (await chrome.storage.local.get(JOBS))[JOBS] || [];
const writeJobs = async jobs => chrome.storage.local.set({[JOBS]: jobs});
const updateJobs = change => {
  const operation = jobsSerial.then(async () => {const jobs = await change(await readJobs()); await writeJobs(jobs); return jobs;});
  jobsSerial = operation.catch(() => {});
  return operation;
};
function options(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('收录设置格式无效。');
  const value = {note: raw.note ?? '', favorite: raw.favorite ?? false, collectionIds: raw.collectionIds ?? ['browser-clips-v1']};
  if (typeof value.note !== 'string' || value.note.length > 50000 || typeof value.favorite !== 'boolean' || !Array.isArray(value.collectionIds) || value.collectionIds.length > 100 || value.collectionIds.some(id => typeof id !== 'string' || !id || id.length > 2000)) throw new Error('请检查备注和收藏集设置。');
  value.collectionIds = [...new Set(value.collectionIds)];
  return value;
}
async function preferences(sourceUrl) {
  await preferencesSerial.catch(() => {});
  const saved = (await chrome.storage.local.get(PREFERENCES))[PREFERENCES];
  if (!saved) return options();
  const value = options(saved);
  if (saved.sourceUrl !== sourceUrl) value.note = '';
  return value;
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !publicPage(tab.url)) throw new Error('请打开要保存的普通网页。');
  return tab;
}
async function assertTab(tab) {
  const current = await chrome.tabs.get(tab.id);
  if (!current || current.url !== tab.url) throw new Error('页面已经切换，请回到要操作的页面后重试。');
}
async function badge(text, color, title) {await Promise.allSettled([chrome.action.setBadgeText({text}), chrome.action.setBadgeBackgroundColor({color}), chrome.action.setTitle({title})]);}
async function ensurePage(tabId, frameId) {
  const target = {tabId, ...(Number.isInteger(frameId) ? {frameIds: [frameId]} : {})};
  await chrome.scripting.executeScript({target, files: ['content-highlights.js']});
  await chrome.scripting.insertCSS({target, files: ['highlights.css']});
}
async function pageMessage(tabId, message, frameId = 0) {
  const response = await chrome.tabs.sendMessage(tabId, message, {frameId});
  if (!response?.ok) throw new Error(response?.error || '网页还没有准备好，请刷新网页后重试。');
  return response.data;
}
async function pageHighlights(sourceUrl) {
  const items = []; let offset = 0;
  do {
    const result = await callHost('highlights', {sourceUrl, offset, limit: 50});
    if (!Array.isArray(result?.items)) throw new Error('请更新梦藏与本机连接，以使用网页高亮。');
    items.push(...result.items);
    if (result.nextOffset == null) break;
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset) throw new Error('高亮分页结果无效，请重新打开梦藏。');
    offset = result.nextOffset;
  } while (true);
  return items;
}
async function restore(tab, focusId = '') {
  const items = await pageHighlights(tab.url);
  if (focusId && !items.some(item => item.id === focusId)) throw new Error('这条高亮不属于当前网页，未跳转到其他内容。');
  await assertTab(tab); await ensurePage(tab.id);
  const result = await pageMessage(tab.id, {action: 'mengcang:restore', expectedUrl: tab.url, items, focusId});
  return {...result, highlights: items.map(item => ({id: item.id, title: item.title, text: trimUtf16(item.anchor?.exact || '', 180), favorite: item.favorite, found: result.items?.find(value => value.id === item.id)?.found ?? false}))};
}
async function runJob(job) {
  const requestId = job.params.requestId;
  activeRequests.add(requestId);
  try {
    await updateJobs(jobs => {
      if (!jobs.some(value => value.params.requestId === requestId)) throw new Error('这条本机待办已被移除，未再次发送保存请求。');
      return jobs.map(value => value.params.requestId === requestId ? {...value, status: 'saving', error: ''} : value);
    });
    await badge('…', '#68746a', '正在保存到梦藏…');
    const result = await callHost('capture', job.params);
    if (!result?.item?.id || !Number.isSafeInteger(result.revision)) throw new Error('梦藏没有返回保存回执。请使用原请求重试。');
    await updateJobs(jobs => jobs.map(value => {
      if(value.params.requestId!==requestId)return value;
      // The desktop has the original. Only a failed/unconfirmed capture needs its bytes for retry.
      return {...value,params:value.params.screenshot?Object.fromEntries(Object.entries(value.params).filter(([key])=>key!=='attachment')):value.params,status:'saved',result,error:''};
    }));
    await badge('✓', '#3d7054', '已保存到梦藏');
    // Share the same queue as edits. Read again inside that queue so a popup
    // editing preferences while a capture waits cannot be overwritten by an
    // old snapshot taken before its edit was saved.
    const clearing = preferencesSerial.then(async () => {
      const current = (await chrome.storage.local.get(PREFERENCES))[PREFERENCES];
      if (current?.sourceUrl === job.params.sourceUrl && current.note === job.params.note) await chrome.storage.local.set({[PREFERENCES]: {...current, note: ''}});
    });
    preferencesSerial = clearing.catch(() => {});
    await preferencesSerial;
    return {job: {params:{requestId},status:'saved'}, result, warnings:job.warnings||[]};
  } catch (error) {
    const message = userError(error);
    await updateJobs(jobs => jobs.map(value => value.params.requestId === requestId ? {...value, status: 'failed', error: message} : value));
    await badge('!', '#b45449', '收录尚未保存，点开梦藏扩展重试');
    throw new Error(message);
  } finally {activeRequests.delete(requestId);}
}
async function collect(kind, context = {}) {
  await chrome.storage.local.set({[LAST_ERROR]: ''});
  const tab = context.tab || await activeTab(), sourceUrl = context.pageUrl || tab.url;
  if (!tab?.id || !publicPage(sourceUrl)) throw new Error('请在普通网页中使用梦藏收录。');
  let params;
  if (kind === 'screenshot') {
    const pageTitle=trimUtf16(tab.title||new URL(sourceUrl).hostname,980);
    params={version:1,kind:'image',sourceUrl,title:(context.mode==='region'?'网页选区 · ':'网页截图 · ')+pageTitle,
      siteName:pageTitle,body:'',screenshot:context.mode,attachment:context.attachment};
  } else if (kind === 'image') {
    if (!publicPage(context.imageUrl)) throw new Error('这张图片没有可直接下载的公开地址。请先下载图片，再从梦藏导入。');
    await assertTab(tab);
    params = {version: 1, kind, sourceUrl, title: trimUtf16(context.title || tab.title || '网页图片', 1000), body: '', imageUrl: context.imageUrl};
  } else if (kind === 'highlight') {
    await assertTab(tab); await ensurePage(tab.id, context.frameId);
    params = await pageMessage(tab.id, {action: 'mengcang:collect', kind, selectedText: context.selectionText || '', expectedUrl: sourceUrl}, context.frameId);
  } else {
    const values = await chrome.scripting.executeScript({target: {tabId: tab.id, ...(Number.isInteger(context.frameId) ? {frameIds: [context.frameId]} : {})}, func: capturePage, args: [kind, '', sourceUrl]});
    params = values?.[0]?.result;
  }
  if (!params) throw new Error('页面没有返回内容。请加载完成后重试。');
  if (params.captureError) throw new Error(params.captureError);
  const warnings = params.captureWarnings || []; delete params.captureWarnings;
  Object.assign(params, options(context.options || await preferences(sourceUrl)), {requestId: crypto.randomUUID()});
  const job = {params, createdAt: new Date().toISOString(), status: 'saving', error: '', warnings};
  await updateJobs(jobs => {
    if (jobs.filter(value => value.status !== 'saved').length >= MAX_PENDING) throw new Error('还有 12 条内容尚未保存。请先重试，或在扩展中放弃不再需要的本机待办。');
    return [...jobs.filter(value => value.status === 'saved').slice(-4), ...jobs.filter(value => value.status !== 'saved'), job];
  });
  const result = await runJob(job);
  if (kind === 'highlight') {try {await restore(tab);} catch { /* Saved receipt is independent from current page rendering. */ }}
  return result;
}
async function retry(requestId) {
  await chrome.storage.local.set({[LAST_ERROR]: ''});
  await jobsSerial;
  const job = (await readJobs()).find(value => value.params.requestId === requestId);
  if (!job) throw new Error('找不到这条待保存内容。');
  if (job.status === 'saved') return {job, result: job.result};
  return runJob(job);
}
async function discard(requestId, confirmed) {
  if (confirmed !== true) throw new Error('请先确认只移除本机待办；未确认回执的内容可能已经保存在梦藏。');
  await updateJobs(jobs => {
    const job = jobs.find(value => value.params.requestId === requestId);
    if (!job) throw new Error('找不到这条本机待办，请刷新面板。');
    if (activeRequests.has(requestId)) throw new Error('这条内容正在保存，请等待结果后再处理。');
    if (job.status === 'saved') throw new Error('这条内容已有保存回执，无需放弃本机待办。');
    return jobs.filter(value => value.params.requestId !== requestId);
  });
  await chrome.storage.local.set({[LAST_ERROR]: ''});
  return {discarded: true, requestId};
}
async function collectionChoices(selectedIds) {
  const first = await callHost('collections', {offset: 0, limit: 50});
  const selected = new Set(selectedIds), found = new Map();
  let page = first, offset = 0;
  do {
    if (!Array.isArray(page?.items)) throw new Error('请更新梦藏与本机连接，以选择收藏集。');
    if (first.revision != null && page.revision != null && first.revision !== page.revision) throw new Error('收藏集刚刚发生变化，请刷新后重新核对选择。');
    for (const item of page.items) if (selected.has(item.id)) found.set(item.id, item);
    if (found.size === selected.size || page.nextOffset == null) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error('收藏集分页结果无效，请刷新后重新核对选择。');
    offset = page.nextOffset;
    page = await callHost('collections', {offset, limit: 50});
  } while (true);
  return {collectionPage: first, collectionSelection: {checked: true, items: [...found.values()], missingIds: selectedIds.filter(id => !found.has(id))}};
}
async function siteAllowed(url) {return chrome.permissions?.contains ? chrome.permissions.contains({origins: [sitePattern(url)]}) : false;}
const scriptId = async pattern => 'mengcang-' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pattern)))].slice(0, 12).map(n => n.toString(16).padStart(2, '0')).join('');
async function automaticStatus(url) {
  const pattern = sitePattern(url), allowed = await siteAllowed(url);
  const registered = allowed && chrome.scripting.getRegisteredContentScripts ? await chrome.scripting.getRegisteredContentScripts({ids: [await scriptId(pattern)]}) : [];
  return {pattern, allowed, enabled: !!registered.length};
}
async function automaticSite(tab, enabled, expectedPattern) {
  const pattern = sitePattern(tab.url);
  if (pattern !== expectedPattern) throw new Error('当前网站已变化，请重新打开面板后设置。');
  const id = await scriptId(pattern);
  const registered = await chrome.scripting.getRegisteredContentScripts({ids: [id]});
  if (registered.length) await chrome.scripting.unregisterContentScripts({ids: [id]});
  if (enabled) {
    if (!await siteAllowed(tab.url)) throw new Error('尚未获得当前网站权限，未启用自动高亮。');
    await chrome.scripting.registerContentScripts([{id, matches: [pattern], js: ['content-highlights.js'], css: ['highlights.css'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true}]);
    await restore(tab);
  } else await chrome.permissions.remove({origins: [pattern]});
  return {enabled, pattern};
}
async function status() {
  let connection, error = '', tab, collectionPage, collectionSelection = {checked: false, items: [], missingIds: []}, collectionError = '', highlighted, highlightError = '';
  try {connection = await callHost('status');} catch (issue) {error = userError(issue);}
  try {tab = await activeTab();} catch { /* Status remains useful on internal pages. */ }
  const selected = await preferences(tab?.url || '');
  if (connection?.ready) {
    try {({collectionPage, collectionSelection} = await collectionChoices(selected.collectionIds));} catch (issue) {collectionError = userError(issue);}
    if (tab) {try {highlighted = await restore(tab);} catch (issue) {highlightError = userError(issue);}}
  }
  await jobsSerial;
  const jobs = await readJobs(), captureError = (await chrome.storage.local.get(LAST_ERROR))[LAST_ERROR] || '';
  return {uiProtocol: UI_PROTOCOL, connection, error, captureError, collectionPage, collectionSelection, collectionError, highlightError,
    options: selected, page: tab ? {url: tab.url, title: tab.title || ''} : null,
    autoSite: tab ? await automaticStatus(tab.url) : null,
    highlights: highlighted?.highlights || [], restore: highlighted ? {matched: highlighted.matched, total: highlighted.total, missing: highlighted.missing} : null,
    jobs: jobs.map(({params, createdAt, status, error, result, warnings}) => ({requestId: params.requestId, kind: params.screenshot?'screenshot':params.kind, title: params.title, sourceUrl: params.sourceUrl, createdAt, status, active: activeRequests.has(params.requestId), error, result, warnings}))};
}
async function installMenus() {
  await chrome.contextMenus.removeAll();
  for (const [id, title, contexts] of [['mengcang-page', '保存网页到梦藏', ['page']], ['mengcang-article', '保存文章到梦藏', ['page']], ['mengcang-image', '保存图片到梦藏', ['image']], ['mengcang-selection', '保存选中文字到梦藏', ['selection']]]) chrome.contextMenus.create({id, title, contexts, documentUrlPatterns: ['http://*/*', 'https://*/*']});
}
chrome.runtime.onInstalled.addListener(() => {void installMenus().catch(() => {});});
chrome.permissions?.onRemoved?.addListener(() => {void (async () => {
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  for (const script of scripts) if (script.id.startsWith('mengcang-') && !await chrome.permissions.contains({origins: script.matches})) await chrome.scripting.unregisterContentScripts({ids: [script.id]});
})().catch(() => {});});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!['mengcang-image', 'mengcang-page', 'mengcang-article', 'mengcang-selection'].includes(info.menuItemId)) return;
  const kind = info.menuItemId === 'mengcang-image' ? 'image' : info.menuItemId === 'mengcang-page' ? 'link' : info.menuItemId === 'mengcang-selection' ? 'highlight' : 'article';
  const pageUrl = info.frameUrl || info.pageUrl || tab.url, clickedOptions = preferences(pageUrl);
  void enqueue(async () => collect(kind, {tab, frameId: info.frameId, pageUrl, imageUrl: info.srcUrl, selectionText: info.menuItemId === 'mengcang-selection' ? info.selectionText : '', options: await clickedOptions})).catch(async error => {const message = userError(error); await chrome.storage.local.set({[LAST_ERROR]: message}); await badge('!', '#b45449', message);});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let task;
  try {
  if (message?.action === 'page-highlights') {
    const pageKey = value => {const url = new URL(value); url.hash = ''; return url.href;};
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || (sender.frameId && sender.frameId !== 0) || !publicPage(sender.url) || !publicPage(sender.tab.url) || message.sourceUrl !== sender.url || pageKey(sender.tab.url) !== pageKey(sender.url)) return false;
    task = (async () => {if (!await siteAllowed(sender.url)) throw new Error('此网站尚未开启自动高亮。'); return {items: await pageHighlights(sender.url)};})();
  } else {
    if (!popupSender(sender)) return false;
    if (!['status', 'collections'].includes(message?.action) && message?.uiProtocol !== UI_PROTOCOL) throw new Error(UPDATE_NOTICE);
    if (message?.action === 'status') task = status();
    else if (message?.action === 'collections') task = callHost('collections', {offset: message.offset || 0, limit: 50});
    else if (message?.action === 'snapshot') task=activeTab().then(tab=>{
      if(tab.url!==message.expectedUrl)throw new Error('网页已变化，请重新打开面板后截图。');
      return captureBoundTab(chrome.tabs,tab);
    });
    else if (message?.action === 'save-screenshot') {
      const selected=options(message.options), captured=message.source, attachment=message.attachment;
      if(!['viewport','region'].includes(message.mode)||!attachment||!['image/png','image/jpeg'].includes(attachment.type)||
        !Number.isSafeInteger(attachment.size)||attachment.size<1||attachment.size>660*1024||typeof attachment.dataUrl!=='string'||attachment.dataUrl.length>910000)
        throw new Error('截图文件无效，请重新截取。');
      task=activeTab().then(tab=>{
        if(!captured||tab.id!==captured.tabId||tab.windowId!==captured.windowId||tab.url!==captured.url)throw new Error('截图的网页已切换，未保存，请重新截图。');
        return enqueue(()=>collect('screenshot',{tab:{...tab,title:captured.title},pageUrl:captured.url,mode:message.mode,attachment,options:selected}));
      });
    }
    else if (message?.action === 'related'||message?.action === 'open-related') task=(async()=>{
      await jobsSerial;const job=(await readJobs()).find(j=>j.params.requestId===message.requestId&&j.status==='saved');
      if(!job?.result?.workspaceId)throw new Error('没有找到这次剪藏的保存回执。');
      const go=message.action==='open-related';
      return callHost(go?'openRelated':'related',{requestId:job.params.requestId,workspaceId:job.result.workspaceId,...(go?{cardId:message.cardId}:{})});
    })();
    else if (message?.action === 'settings') {
      const clickedTab = activeTab(); const selected = options(message.options);
      task = preferencesSerial.then(() => clickedTab).then(async tab => {await chrome.storage.local.set({[PREFERENCES]: {...selected, sourceUrl: tab.url}}); return selected;});
      preferencesSerial = task.catch(() => {});
    } else if (message?.action === 'capture' && ['link', 'article', 'highlight'].includes(message.kind)) {
      const clickedTab = activeTab(), selected = message.options === undefined ? null : options(message.options);
      task = clickedTab.then(tab => enqueue(() => collect(message.kind, {tab, pageUrl: tab.url, options: selected})));
    } else if (message?.action === 'retry' && typeof message.requestId === 'string') task = enqueue(() => retry(message.requestId));
    else if (message?.action === 'discard' && typeof message.requestId === 'string') task = discard(message.requestId, message.confirmed);
    else if (message?.action === 'restore' || message?.action === 'locate') {const clickedTab = activeTab(); task = clickedTab.then(tab => restore(tab, message.action === 'locate' ? String(message.id || '') : ''));}
    else if (message?.action === 'auto-site' && typeof message.enabled === 'boolean') {const clickedTab = activeTab(); task = clickedTab.then(tab => automaticSite(tab, message.enabled, message.pattern));}
    else {reply({ok: false, error: '不支持的操作。'}); return false;}
  }
  } catch (error) {reply({ok: false, error: userError(error)}); return false;}
  task.then(data => reply({ok: true, data}), async error => {const text = userError(error); if (!['page-highlights','related','open-related'].includes(message.action)) await chrome.storage.local.set({[LAST_ERROR]: text}); reply({ok: false, error: text});});
  return true;
});
