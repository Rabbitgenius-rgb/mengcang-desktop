import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const updateNotice = '扩展更新尚未生效，请关闭面板后在扩展管理页重新加载梦藏';
const oldStatus = {connection: {ready: true}, error: '', captureError: '', jobs: [{requestId: 'old-request', kind: 'link', title: '既有待保存资料', status: 'failed', error: '尚未保存'}]};
const currentStatus = extra => ({uiProtocol: 4, connection: {ready: true}, error: '', captureError: '', collectionPage: {items: [{id: 'browser-clips-v1', title: '浏览器剪藏', private: true}], nextOffset: null}, collectionSelection: {checked: true, items: [], missingIds: []}, collectionError: '', highlightError: '', options: {note: '', favorite: false, collectionIds: ['browser-clips-v1']}, page: {url: 'https://example.com/article'}, autoSite: {pattern: 'https://example.com/*', allowed: false, enabled: false}, highlights: [], restore: {matched: 0, total: 0, missing: 0}, jobs: [], ...extra});
async function popupFixture(initialStatus, respond) {
  const nodes = [], byId = new Map(), requests = []; let status = initialStatus;
  class Element {
    constructor(tag, id = '') {this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.handlers = {}; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; const classes = new Set(); this.classList = {toggle(name, value) {if (value) classes.add(name); else classes.delete(name);}, contains: name => classes.has(name)}; nodes.push(this);}
    addEventListener(type, callback) {this.handlers[type] = callback;}
    append(...values) {this.children.push(...values);}
    replaceChildren(...values) {this.children = values; this.textContent = '';}
    setAttribute(name, value) {this[name] = value;}
  }
  const html = await fs.readFile(new URL('../popup.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<([a-z-]+)\b[^>]*\bid="([^"]+)"/g)) byId.set(match[2], new Element(match[1], match[2]));
  globalThis.document = {getElementById: id => byId.get(id), createElement: tag => new Element(tag), querySelectorAll: selector => nodes.filter(node => selector.split(',').map(tag => tag.toUpperCase()).includes(node.tagName))};
  globalThis.chrome = {runtime: {sendMessage: async request => {requests.push(structuredClone(request)); if (request.action === 'status') return {ok: true, data: structuredClone(status)}; if (respond) return respond(request); if (request.action === 'capture') return {ok: false, error: '桌面当前离线'}; return {ok: true, data: {}};}}};
  await import(`../popup.js?fixture=${crypto.randomUUID()}`);
  const idle = async () => {for (let n = 0; n < 30; n++) {if (!byId.get('refresh').disabled) return; await new Promise(resolve => setImmediate(resolve));} throw Error('popup did not settle');};
  await idle();
  return {byId, nodes, requests, idle, setStatus: value => {status = value;}, click: async id => {await byId.get(id).handlers.click(); await idle();}, cleanup() {delete globalThis.chrome; delete globalThis.document;}};
}

test('new popup plus old background shows an update error and cannot capture or save settings even if a disabled click is dispatched', async () => {
  const f = await popupFixture(oldStatus);
  try {
    assert.equal(f.byId.get('connection').textContent, updateNotice); assert.equal(f.byId.get('message').textContent, updateNotice);
    assert.equal(f.byId.get('collection-count').textContent, '更新后读取'); assert.equal(f.byId.get('collection-list').children.length, 0);
    assert.equal(f.byId.get('refresh').disabled, false);
    for (const id of ['save-page', 'save-article', 'save-selection', 'note', 'favorite', 'restore-highlights', 'auto-site']) assert.equal(f.byId.get(id).disabled, true, id);
    assert.equal(f.byId.get('jobs').children.length, 1, 'existing requests remain viewable');
    for (const id of ['save-page', 'save-article', 'save-selection']) await f.click(id);
    for (const button of f.nodes.filter(node => node.tagName === 'BUTTON' && ['重试', '放弃', '确认放弃'].includes(node.textContent))) await button.handlers.click();
    f.byId.get('note').value = '不能被旧后台默默忽略的备注'; f.byId.get('note').handlers.input();
    assert.equal(f.requests.filter(request => request.action !== 'status').length, 0);
    f.setStatus({...oldStatus, uiProtocol: 2}); await f.click('refresh'); await f.click('save-article');
    assert.equal(f.byId.get('connection').textContent, updateNotice); assert.equal(f.byId.get('save-article').disabled, true);
    assert.equal(f.requests.filter(request => request.action !== 'status').length, 0);
    f.setStatus(currentStatus()); await f.click('refresh');
    assert.equal(f.byId.get('connection').textContent, '已连接梦藏资料库'); assert.equal(f.byId.get('message').textContent, '');
    assert.equal(f.byId.get('save-article').disabled, false); assert.equal(f.byId.get('collection-list').children.length, 1);
  } finally {f.cleanup();}
});

test('popup exposes a deleted selection for explicit removal while a valid later-page collection keeps its checked name', async () => {
  const f = await popupFixture(currentStatus({options: {note: '备注不变', favorite: true, collectionIds: ['removed', 'later-page']}, collectionPage: {items: [{id: 'browser-clips-v1', title: '浏览器剪藏'}], nextOffset: 50}, collectionSelection: {checked: true, items: [{id: 'later-page', title: '后页收藏集'}], missingIds: ['removed']}}));
  try {
    const rows = f.byId.get('collection-list').children;
    assert.equal(rows[0].className, 'missing-collection', 'unavailable selections are visible before the scrollable ordinary choices');
    assert.match(rows[0].children[0].textContent, /已删除的收藏集.*removed/);
    const later = rows.find(row => row.children[0]?.value === 'later-page');
    assert.equal(later.children[0].checked, true); assert.equal(later.children[1].textContent, '后页收藏集');
    assert.equal(f.requests.filter(value => value.action === 'settings').length, 0, 'reading never silently removes a stale ID');
    await rows[0].children[1].handlers.click();
    assert.deepEqual(f.requests.find(value => value.action === 'settings').options, {note: '备注不变', favorite: true, collectionIds: ['later-page']});
    assert.equal(f.byId.get('collection-count').textContent, '已选 1');
    assert.equal(f.byId.get('collection-list').children.some(row => row.className === 'missing-collection'), false);
    f.setStatus(currentStatus({options: {collectionIds: ['unread']}, collectionSelection: {checked: false, items: [], missingIds: []}, collectionError: '连接中断'}));
    // A fresh popup reads the stored choice; a refresh preserves local edits.
  } finally {f.cleanup();}
  const unknown = await popupFixture(currentStatus({options: {collectionIds: ['unread']}, collectionSelection: {checked: false, items: [], missingIds: []}, collectionError: '连接中断'}));
  try {assert.match(unknown.byId.get('collection-list').children[0].children[0].textContent, /尚未核实/); assert.doesNotMatch(unknown.byId.get('collection-list').children[0].children[0].textContent, /已删除/);} finally {unknown.cleanup();}
});

test('abandon is an inline explicit confirmation and running jobs keep retry and abandon disabled', async () => {
  const uncertain = {requestId: 'uncertain', kind: 'image', title: '未确认图片', status: 'saving', active: false};
  const running = {requestId: 'active', kind: 'article', title: '正在保存文章', status: 'saving', active: true};
  const f = await popupFixture(currentStatus({jobs: [uncertain, running]}), request => ({ok: true, data: request.action === 'discard' ? {discarded: true, requestId: request.requestId} : {}}));
  try {
    const rows = f.byId.get('jobs').children, active = rows[0], pending = rows[1];
    const activeActions = active.children.find(node => node.className === 'job-actions');
    assert(activeActions.children.every(button => button.disabled), 'lock(false) must not re-enable an active request');
    for (const button of activeActions.children) await button.handlers.click();
    assert.equal(f.requests.filter(value => value.action !== 'status').length, 0);
    const actions = pending.children.find(node => node.className === 'job-actions'), confirmation = pending.children.find(node => node.className === 'job-confirm');
    assert.equal(confirmation.hidden, true); await actions.children[1].handlers.click();
    assert.equal(confirmation.hidden, false); assert.match(confirmation.children[0].textContent, /不会删除梦藏资料/); assert.match(confirmation.children[0].textContent, /可能已经保存/);
    assert.equal(f.requests.filter(value => value.action === 'discard').length, 0);
    await confirmation.children[2].handlers.click(); assert.equal(confirmation.hidden, true);
    await actions.children[1].handlers.click(); await confirmation.children[1].handlers.click(); await f.idle();
    const discarded = f.requests.filter(value => value.action === 'discard');
    assert.equal(discarded.length, 1); assert.deepEqual(discarded[0], {action: 'discard', requestId: 'uncertain', confirmed: true, uiProtocol: 4});
    assert.match(f.byId.get('message').textContent, /已移除本机待办/);
  } finally {f.cleanup();}
});

test('current protocol permits valid internal-page and offline status instead of misreporting an update mismatch', async () => {
  const f = await popupFixture(currentStatus({page: null, autoSite: null}));
  try {
    assert.equal(f.byId.get('connection').textContent, '已连接梦藏资料库'); assert.notEqual(f.byId.get('message').textContent, updateNotice);
    assert.equal(f.byId.get('auto-site').disabled, true); assert.equal(f.byId.get('save-page').disabled, false);
    f.setStatus(currentStatus({connection: undefined, error: '请打开梦藏', collectionPage: undefined})); await f.click('refresh');
    assert.equal(f.byId.get('connection').textContent, '请打开梦藏'); assert.equal(f.byId.get('save-page').disabled, false);
    await f.click('save-page');
    assert.equal(f.requests.filter(request => request.action === 'capture').length, 1, 'new background may retain an offline capture for later retry');
    assert.equal(f.byId.get('message').textContent, '桌面当前离线'); assert.equal(f.byId.get('save-page').disabled, false);
  } finally {f.cleanup();}
});
