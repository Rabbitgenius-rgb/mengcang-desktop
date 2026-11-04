import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const extension = 'ebdbkhhcgifolblbcpkpgibjbighfhgi', sender = {id: extension, url: `chrome-extension://${extension}/popup.html`};
async function fixture({native, highlights = [], initialStorage = {}} = {}) {
  const handlers = {}, storage = structuredClone(initialStorage), requests = [], scripts = new Map(), grants = new Set(), pageCalls = [], removed = [];
  let tab = {id: 7, url: 'https://example.com/article', title: '公开文章'}, revision = 2;
  const event = name => ({addListener: callback => {handlers[name] = callback;}});
  const chrome = {
    runtime: {id: extension, getURL: part => `chrome-extension://${extension}/${part}`, onInstalled: event('installed'), onMessage: event('message'), sendNativeMessage: async (_host, request) => {
      requests.push(structuredClone(request)); if (native) return native(request);
      if (request.method === 'status') return {ok: true, data: {ready: true}};
      if (request.method === 'collections') return {ok: true, data: {items: [{id: 'browser-clips-v1', title: '浏览器剪藏', private: true}, {id: 'second', title: '写作素材', private: true}], nextOffset: null, total: 2}};
      if (request.method === 'highlights') return {ok: true, data: {items: highlights, nextOffset: null, total: highlights.length}};
      return {ok: true, data: {revision: ++revision, item: {id: request.params.requestId}}};
    }},
    storage: {local: {get: async key => ({[key]: structuredClone(storage[key])}), set: async values => Object.assign(storage, structuredClone(values))}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    tabs: {query: async () => [structuredClone(tab)], get: async () => structuredClone(tab), sendMessage: async (_id, message) => {pageCalls.push(structuredClone(message)); return {ok: true, data: {matched: message.items?.length || 0, total: message.items?.length || 0, missing: 0, items: (message.items || []).map(item => ({id: item.id, found: true}))}};}},
    scripting: {executeScript: async request => request.files ? [] : [{result: {version: 1, kind: request.args[0], sourceUrl: request.args[2], title: '公开文章', body: '原始正文'}}], insertCSS: async () => {}, getRegisteredContentScripts: async request => [...scripts.values()].filter(script => !request?.ids || request.ids.includes(script.id)), registerContentScripts: async values => values.forEach(script => scripts.set(script.id, structuredClone(script))), unregisterContentScripts: async ({ids}) => ids.forEach(id => scripts.delete(id))},
    permissions: {contains: async ({origins}) => origins.every(origin => grants.has(origin)), remove: async ({origins}) => {removed.push(...origins); origins.forEach(origin => grants.delete(origin)); return true;}, onRemoved: event('permissionsRemoved')},
    contextMenus: {onClicked: event('context'), removeAll: async () => {}, create: () => {}},
  };
  globalThis.chrome = chrome; await import(`../background.js?fixture=${crypto.randomUUID()}`);
  return {handlers, storage, requests, scripts, grants, pageCalls, removed, setTab: value => {tab = value;}, cleanup: () => {delete globalThis.chrome;}, send: (message, from = sender) => new Promise(resolve => {const accepted = handlers.message({uiProtocol: 4, ...message}, from, resolve); if (!accepted) resolve(undefined);})};
}
const until = async check => {for (let n = 0; n < 30; n++) {if (check()) return; await new Promise(resolve => setImmediate(resolve));} throw Error('background did not settle');};

test('toolbar options are saved atomically with capture and one-shot notes do not leak to another page', async () => {
  const f = await fixture();
  try {
    const chosen = {note: '我的原始备注', favorite: true, collectionIds: ['second']};
    assert.equal((await f.send({action: 'settings', options: chosen})).ok, true);
    const value = await f.send({action: 'capture', kind: 'article', options: chosen}); assert.equal(value.ok, true);
    const captured = f.requests.find(request => request.method === 'capture').params;
    assert.equal(captured.note, chosen.note); assert.equal(captured.favorite, true); assert.deepEqual(captured.collectionIds, ['second']);
    let status = (await f.send({action: 'status'})).data; assert.equal(status.uiProtocol, 4); assert.equal(status.options.note, ''); assert.deepEqual(status.options.collectionIds, ['second']);
    await f.send({action: 'settings', options: {...chosen, note: '仅当前网页'}});
    f.setTab({id: 7, url: 'https://example.com/another', title: '另一网页'});
    status = (await f.send({action: 'status'})).data; assert.equal(status.options.note, ''); assert.equal(status.options.favorite, true);
  } finally {f.cleanup();}
});
test('context-menu image capture freezes saved collection/star options and the current-page note', async () => {
  const f = await fixture();
  try {
    await f.send({action: 'settings', options: {note: '图片备注', favorite: true, collectionIds: ['second']}});
    f.handlers.context({menuItemId: 'mengcang-image', pageUrl: 'https://example.com/article', srcUrl: 'https://example.com/photo.png', frameId: 0}, {id: 7, url: 'https://example.com/article', title: 'a'.repeat(999) + '😀尾'});
    await until(() => f.requests.some(request => request.method === 'capture'));
    const capture = f.requests.find(request => request.method === 'capture').params;
    assert.equal(capture.kind, 'image'); assert.equal(capture.note, '图片备注'); assert.equal(capture.favorite, true); assert.deepEqual(capture.collectionIds, ['second']);
    assert.equal(capture.title, 'a'.repeat(999));
    await until(() => (f.storage.mengcangClipperJobsV1 || []).some(job => job.status === 'saved'));
  } finally {f.cleanup();}
});
test('a new preference edit arriving during post-save note cleanup is retained instead of overwritten by the old snapshot', async () => {
  const f = await fixture(), key = 'mengcangClipperPreferencesV2';
  try {
    const oldOptions = {note: '已保存的旧备注', favorite: true, collectionIds: ['second']};
    await f.send({action: 'settings', options: oldOptions});
    let readStarted, releaseRead, held = false;
    const started = new Promise(resolve => {readStarted = resolve;}), gate = new Promise(resolve => {releaseRead = resolve;});
    const originalGet = chrome.storage.local.get;
    chrome.storage.local.get = async requested => {
      const snapshot = await originalGet(requested);
      if (requested === key && !held) {held = true; readStarted(); await gate;}
      return snapshot;
    };
    const capture = f.send({action: 'capture', kind: 'article', options: oldOptions}); await started;
    const newOptions = {note: '另一面板刚写的新备注', favorite: false, collectionIds: ['browser-clips-v1']};
    const editing = f.send({action: 'settings', options: newOptions});
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
    releaseRead(); assert.equal((await capture).ok, true); assert.equal((await editing).ok, true);
    assert.equal(f.storage[key].note, newOptions.note); assert.equal(f.storage[key].favorite, false); assert.deepEqual(f.storage[key].collectionIds, newOptions.collectionIds);
  } finally {f.cleanup();}
});
test('old pending requests retry without adding new fields or changing their receipt identity', async () => {
  const params = {version: 1, requestId: crypto.randomUUID(), kind: 'link', sourceUrl: 'https://example.com/old', title: '旧请求', body: ''};
  const f = await fixture({initialStorage: {mengcangClipperJobsV1: [{params, status: 'failed', createdAt: '2026-11-01'}]}});
  try {assert.equal((await f.send({action: 'retry', requestId: params.requestId})).ok, true); assert.deepEqual(f.requests.find(request => request.method === 'capture').params, params);} finally {f.cleanup();}
});
test('automatic restoration grants only the chosen site and revocation unregisters that script', async () => {
  const f = await fixture(), pattern = 'https://example.com/*';
  try {
    const denied = await f.send({action: 'auto-site', enabled: true, pattern}); assert.equal(denied.ok, false); assert.equal(f.scripts.size, 0);
    f.grants.add(pattern); f.grants.add('https://other.example/*');
    assert.equal((await f.send({action: 'auto-site', enabled: true, pattern})).ok, true);
    assert.equal(f.scripts.size, 1); const script = [...f.scripts.values()][0];
    assert.deepEqual(script.matches, [pattern]); assert.equal(script.allFrames, false); assert.equal(script.persistAcrossSessions, true);
    const status = (await f.send({action: 'status'})).data; assert.equal(status.autoSite.enabled, true);
    assert.equal((await f.send({action: 'auto-site', enabled: false, pattern})).ok, true); assert.equal(f.scripts.size, 0);
    assert.deepEqual(f.removed, [pattern]); assert(f.grants.has('https://other.example/*'));
  } finally {f.cleanup();}
});
test('content-script reads require an explicit site grant and exact source URL; no arbitrary URL or foreign frame is dispatched', async () => {
  const saved = {id: 'h1', title: '高亮', anchor: {version: 1, exact: '同页文字', prefix: '', suffix: ''}};
  const f = await fixture({highlights: [saved]});
  const source = {id: extension, url: 'https://example.com/article', frameId: 0, tab: {id: 7, url: 'https://example.com/article'}};
  try {
    let value = await f.send({action: 'page-highlights', sourceUrl: source.url}, source); assert.equal(value.ok, false); assert.equal(f.requests.length, 0);
    f.grants.add('https://example.com/*');
    value = await f.send({action: 'page-highlights', sourceUrl: source.url}, source); assert.equal(value.ok, true); assert.deepEqual(value.data.items, [saved]);
    const calls = f.requests.length;
    for (const from of [{...source, id: 'another-extension'}, {...source, frameId: 2}, {...source, tab: {...source.tab, url: 'https://example.com/another'}}]) assert.equal(await f.send({action: 'page-highlights', sourceUrl: source.url}, from), undefined);
    assert.equal(await f.send({action: 'page-highlights', sourceUrl: 'https://example.com/private'}, source), undefined);
    assert.equal(await f.send({action: 'capture', kind: 'article'}, source), undefined);
    assert.equal(f.requests.length, calls);
  } finally {f.cleanup();}
});
test('highlight paging collects the full page before display, and location rejects cards outside that page', async () => {
  const h = id => ({id, title: id, anchor: {version: 1, exact: id, prefix: '', suffix: ''}}), requests = [];
  const f = await fixture({native: async request => {requests.push(request); if (request.method === 'highlights') return {ok: true, data: request.params.offset === 0 ? {items: [h('first')], nextOffset: 1} : {items: [h('second')], nextOffset: null}}; if (request.method === 'collections') return {ok: true, data: {items: [], nextOffset: null}}; return {ok: true, data: {ready: true}};}});
  try {
    const status = (await f.send({action: 'status'})).data; assert.equal(status.highlights.length, 2); assert.equal(status.restore.matched, 2);
    assert.deepEqual(requests.filter(request => request.method === 'highlights').map(request => request.params.offset), [0, 1]);
    const value = await f.send({action: 'locate', id: 'not-this-page'}); assert.equal(value.ok, false); assert.match(value.error, /不属于当前网页/);
    assert.equal(f.pageCalls.length, 1);
  } finally {f.cleanup();}
});

test('selected collections are checked across every needed page; removed IDs remain explicit until the user releases them', async () => {
  const key = 'mengcangClipperPreferencesV2', chosen = {sourceUrl: 'https://example.com/article', note: '保留备注', favorite: true, collectionIds: ['later-page', 'removed']};
  const f = await fixture({initialStorage: {[key]: chosen}, native: async request => {
    if (request.method === 'collections') {
      const page = request.params.offset === 0 ? {items: [{id: 'browser-clips-v1', title: '浏览器剪藏'}], nextOffset: 50} : request.params.offset === 50 ? {items: [{id: 'later-page', title: '后页收藏集'}], nextOffset: 51} : {items: [], nextOffset: null};
      return {ok: true, data: {...page, revision: 7}};
    }
    if (request.method === 'highlights') return {ok: true, data: {items: [], nextOffset: null}};
    if (request.method === 'capture') return request.params.collectionIds.includes('removed') ? {ok: false, error: {message: '所选收藏集已不存在'}} : {ok: true, data: {revision: 8, item: {id: 'saved'}}};
    return {ok: true, data: {ready: true}};
  }});
  try {
    const status = (await f.send({action: 'status'})).data;
    assert.deepEqual(f.requests.filter(value => value.method === 'collections').map(value => value.params.offset), [0, 50, 51]);
    assert.deepEqual(status.collectionSelection, {checked: true, items: [{id: 'later-page', title: '后页收藏集'}], missingIds: ['removed']});
    assert.deepEqual(status.options.collectionIds, chosen.collectionIds, 'status never silently removes a selected ID');
    assert.deepEqual(f.storage[key], chosen);
    const released = {...chosen, collectionIds: ['later-page']};
    assert.equal((await f.send({action: 'settings', options: released})).ok, true);
    assert.equal((await f.send({action: 'capture', kind: 'article', options: released})).ok, true);
    assert.deepEqual(f.requests.find(value => value.method === 'capture').params.collectionIds, ['later-page']);
  } finally {f.cleanup();}
});

test('an incomplete collection scan keeps selections unverified instead of calling a later-page ID deleted', async () => {
  const chosen = {collectionIds: ['later-page'], note: '', favorite: false};
  const f = await fixture({initialStorage: {mengcangClipperPreferencesV2: chosen}, native: async request => {
    if (request.method === 'collections') return request.params.offset === 0 ? {ok: true, data: {items: [], nextOffset: 50}} : {ok: false, error: {message: '连接中断'}};
    if (request.method === 'highlights') return {ok: true, data: {items: [], nextOffset: null}};
    return {ok: true, data: {ready: true}};
  }});
  try {
    const status = (await f.send({action: 'status'})).data;
    assert.equal(status.collectionSelection.checked, false); assert.deepEqual(status.collectionSelection.missingIds, []);
    assert.deepEqual(status.options.collectionIds, ['later-page']); assert.match(status.collectionError, /连接中断/);
  } finally {f.cleanup();}
});

const pendingJob = (status = 'failed') => ({params: {version: 1, requestId: crypto.randomUUID(), kind: 'link', sourceUrl: 'https://example.com/old', title: '原请求', body: ''}, status, createdAt: '2026-11-01', error: '永久失败'});
test('discarding one of twelve failed jobs frees admission without deleting a card or changing the remaining retry payloads', async () => {
  const jobs = Array.from({length: 12}, () => pendingJob()), f = await fixture({initialStorage: {mengcangClipperJobsV1: jobs}});
  try {
    assert.match((await f.send({action: 'capture', kind: 'link'})).error, /12 条/);
    assert.equal(f.requests.filter(value => value.method === 'capture').length, 0);
    assert.equal((await f.send({action: 'discard', requestId: jobs[0].params.requestId})).ok, false);
    assert.equal(f.storage.mengcangClipperJobsV1.length, 12, 'discard requires an explicit inline confirmation');
    assert.equal((await f.send({action: 'discard', requestId: jobs[0].params.requestId, confirmed: true})).ok, true);
    assert.deepEqual(f.storage.mengcangClipperJobsV1, jobs.slice(1));
    assert.equal((await f.send({action: 'capture', kind: 'link'})).ok, true);
    assert.equal(f.storage.mengcangClipperJobsV1.filter(value => value.status !== 'saved').length, 11);
    assert.equal(f.requests.filter(value => value.method === 'capture').length, 1);
    assert(f.requests.every(value => !/delete|remove|discard/.test(value.method)), 'abandon only updates extension-local jobs');
  } finally {f.cleanup();}
});

test('active saves cannot be discarded; removing another uncertain local job cannot overwrite the eventual receipt', async () => {
  const jobs = [pendingJob(), pendingJob('saving')];
  let release, started; const gate = new Promise(resolve => {release = resolve;}), began = new Promise(resolve => {started = resolve;});
  const f = await fixture({initialStorage: {mengcangClipperJobsV1: jobs}, native: async request => {
    if (request.method === 'capture') {started(); await gate; return {ok: true, data: {revision: 9, item: {id: 'receipt'}}};}
    if (request.method === 'collections' || request.method === 'highlights') return {ok: true, data: {items: [], nextOffset: null}};
    return {ok: true, data: {ready: true}};
  }});
  try {
    const retry = f.send({action: 'retry', requestId: jobs[0].params.requestId}); await began;
    const status = (await f.send({action: 'status'})).data;
    assert.equal(status.jobs[0].active, true); assert.equal(status.jobs[1].active, false, 'persisted saving after a worker restart is an uncertain receipt, not an active call');
    assert.match((await f.send({action: 'discard', requestId: jobs[0].params.requestId, confirmed: true})).error, /正在保存/);
    assert.equal((await f.send({action: 'discard', requestId: jobs[1].params.requestId, confirmed: true})).ok, true);
    release(); assert.equal((await retry).ok, true);
    assert.equal(f.storage.mengcangClipperJobsV1.length, 1); assert.equal(f.storage.mengcangClipperJobsV1[0].status, 'saved');
    assert.equal(f.storage.mengcangClipperJobsV1[0].result.item.id, 'receipt');
    assert.deepEqual(f.requests.find(value => value.method === 'capture').params, jobs[0].params);
    assert.equal((await f.send({action: 'discard', requestId: jobs[0].params.requestId, confirmed: true})).ok, false);
  } finally {release(); f.cleanup();}
});

test('old popup protocols may read status but cannot mutate a new worker', async () => {
  const job = pendingJob(), f = await fixture({initialStorage: {mengcangClipperJobsV1: [job]}});
  try {
    assert.equal((await f.send({action: 'status', uiProtocol: 2})).data.uiProtocol, 4);
    for (const request of [{action: 'capture', kind: 'article'}, {action: 'settings', options: {}}, {action: 'retry', requestId: job.params.requestId}, {action: 'discard', requestId: job.params.requestId, confirmed: true}, {action: 'auto-site', enabled: false, pattern: 'https://example.com/*'}]) {
      const result = await f.send({...request, uiProtocol: 2}); assert.equal(result.ok, false); assert.match(result.error, /更新尚未生效/);
    }
    assert.equal(f.requests.filter(value => value.method === 'capture').length, 0);
    assert.deepEqual(f.storage.mengcangClipperJobsV1, [job]); assert.equal(f.storage.mengcangClipperPreferencesV2, undefined);
  } finally {f.cleanup();}
});
