import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {capturePage} from '../capture.js';
import {visibleJobs} from '../jobs.js';
const extension = 'ebdbkhhcgifolblbcpkpgibjbighfhgi';
test('manifest keeps a stable identity, grants no default all-sites access, and only offers explicit per-site grants', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url)));
  const id = [...crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16)].map(value => String.fromCharCode(97 + (value >> 4)) + String.fromCharCode(97 + (value & 15))).join('');
  assert.equal(id, extension); assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'contextMenus', 'nativeMessaging', 'storage']);
  assert.equal(manifest.version, '0.3.0');
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  for (const key of ['host_permissions', 'content_scripts', 'externally_connectable']) assert.equal(manifest[key], undefined);
});
test('page capture preserves selected text and refuses oversized selections and internal pages', () => {
  globalThis.location = {href: 'https://example.com/article'};
  globalThis.document = {title: '示例文章', querySelector: () => null};
  const selection = capturePage('article', '第一段\n\n第二段');
  assert.equal(selection.body, '第一段\n\n第二段'); assert.equal(selection.sourceUrl, 'https://example.com/article');
  assert.match(capturePage('article', '字'.repeat(50001)).captureError, /50000/);
  assert.match(capturePage('article', '应保留的内容', 'https://example.com/different-page').captureError, /页面已经切换/);
  globalThis.location = {href: 'chrome://settings'};
  assert.match(capturePage('link').captureError, /普通网页/);
  delete globalThis.location; delete globalThis.document;
});
test('all twelve unresolved jobs remain accessible alongside four successful saves', () => {
  const unresolved = Array.from({length: 12}, (_, i) => ({requestId: `pending-${i}`, status: i === 11 ? 'saving' : 'failed'}));
  const saved = Array.from({length: 8}, (_, i) => ({requestId: `saved-${i}`, status: 'saved'}));
  const visible = visibleJobs([...unresolved, ...saved]);
  assert.equal(visible.length, 16);
  assert.deepEqual(new Set(visible.filter(job => job.status !== 'saved').map(job => job.requestId)), new Set(unresolved.map(job => job.requestId)));
  assert.equal(visible.filter(job => job.status === 'saved').length, 4);
});
test('failed capture retries the identical payload and UUID, then reuses its completed receipt', async () => {
  const handlers = {}, storage = {}; const captures = []; let fail = true;
  const event = name => ({addListener: callback => {handlers[name] = callback;}});
  globalThis.chrome = {
    runtime: {id: extension, getURL: part => `chrome-extension://${extension}/${part}`, onInstalled: event('installed'), onMessage: event('message'), sendNativeMessage: async (_host, request) => {
      if (request.method === 'status') return {ok: true, data: {ready: true}};
      if (request.method === 'collections' || request.method === 'highlights') return {ok: true, data: {items: [], nextOffset: null}};
      captures.push(structuredClone(request.params));
      if (fail) throw new Error('The native messaging host was disconnected.');
      return {ok: true, data: {workspaceId: 'fixture', revision: 4, item: {id: 'fixture-card'}, duplicate: captures.length > 1}};
    }},
    storage: {local: {get: async key => ({[key]: structuredClone(storage[key])}), set: async values => Object.assign(storage, structuredClone(values))}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    tabs: {query: async () => [{id: 7, url: 'https://example.com/article', title: '文章'}]},
    scripting: {executeScript: async () => [{result: {version: 1, kind: 'article', title: '文章', sourceUrl: 'https://example.com/article', body: '原来的正文'}}]},
    contextMenus: {onClicked: event('context'), removeAll: async () => {}, create: () => {}},
  };
  await import(`../background.js?fixture=${crypto.randomUUID()}`);
  const sender = {id: extension, url: `chrome-extension://${extension}/popup.html`};
  const send = message => new Promise(resolve => {assert.equal(handlers.message({uiProtocol: 4, ...message}, sender, resolve), true);});
  const failed = await send({action: 'capture', kind: 'article'}); assert.equal(failed.ok, false);
  const first = captures[0], status = await send({action: 'status'}), job = status.data.jobs[0];
  assert.equal(job.status, 'failed'); assert.equal(job.requestId, first.requestId);
  fail = false;
  const retry = await send({action: 'retry', requestId: first.requestId});
  assert.equal(retry.ok, true); assert.deepEqual(captures[1], first);
  await send({action: 'retry', requestId: first.requestId}); assert.equal(captures.length, 2);
  let rejectedReply;
  assert.equal(handlers.message({action: 'capture', kind: 'article'}, {id: extension, url: sender.url, tab: {id: 1}}, value => {rejectedReply = value;}), false);
  assert.equal(rejectedReply, undefined);
  delete globalThis.chrome;
});
test('queued toolbar saves bind the tab at click time and pass an exact URL guard to page extraction', async () => {
  const handlers = {}, storage = {}, extracted = [], captures = [], bindings = [];
  let currentTab = {id: 11, url: 'https://example.com/first'}, releaseFirst, firstStarted, secondBound;
  const started = new Promise(resolve => {firstStarted = resolve;}), bound = new Promise(resolve => {secondBound = resolve;});
  const firstWait = new Promise(resolve => {releaseFirst = resolve;});
  const event = name => ({addListener: callback => {handlers[name] = callback;}});
  globalThis.chrome = {
    runtime: {id: extension, getURL: part => `chrome-extension://${extension}/${part}`, onInstalled: event('installed'), onMessage: event('message'), sendNativeMessage: async (_host, request) => {
      if (request.method === 'status') return {ok: true, data: {ready: true}};
      captures.push(request.params);
      if (captures.length === 1) {firstStarted(); await firstWait;}
      return {ok: true, data: {workspaceId: 'fixture', revision: captures.length, item: {id: request.params.requestId}}};
    }},
    storage: {local: {get: async key => ({[key]: structuredClone(storage[key])}), set: async values => Object.assign(storage, structuredClone(values))}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    tabs: {query: async () => {const snapshot = structuredClone(currentTab); bindings.push(snapshot); if (bindings.length === 2) secondBound(); return [snapshot];}},
    scripting: {executeScript: async options => {extracted.push(options); return [{result: {version: 1, kind: options.args[0], title: '绑定的页面', sourceUrl: options.args[2], body: '正文'}}];}},
    contextMenus: {onClicked: event('context'), removeAll: async () => {}, create: () => {}},
  };
  await import(`../background.js?fixture=${crypto.randomUUID()}`);
  const sender = {id: extension, url: `chrome-extension://${extension}/popup.html`};
  const send = message => new Promise(resolve => handlers.message({uiProtocol: 4, ...message}, sender, resolve));
  const first = send({action: 'capture', kind: 'article'}); await started;
  currentTab = {id: 22, url: 'https://example.com/second'};
  const second = send({action: 'capture', kind: 'article'}); await bound;
  currentTab = {id: 33, url: 'https://example.com/unrelated'};
  releaseFirst(); assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  assert.deepEqual(extracted.map(value => ({tabId: value.target.tabId, expectedUrl: value.args[2]})), [{tabId: 11, expectedUrl: 'https://example.com/first'}, {tabId: 22, expectedUrl: 'https://example.com/second'}]);
  assert.equal(captures[1].sourceUrl, 'https://example.com/second');
  delete globalThis.chrome;
});
