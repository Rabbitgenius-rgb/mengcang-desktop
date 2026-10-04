import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import discoveryVite from '../discovery-vite.mjs';
import {makeDiscoveryPreview} from '../src/discoveryPreview.js';
import {AI_MODES, aiPlaceholder} from '../src/sublime/workspaceModel.js';

const require = createRequire(import.meta.url);
const policy = require('../../../desktop/ai-policy.cjs');

test('all five Insights modes and opt-in payloads remain blocked by the actual AI policy', () => {
  assert.equal(policy.AI_ENABLED, false);
  for (const mode of AI_MODES) {
    assert.equal(aiPlaceholder(mode).enabled, false);
    assert.throws(() => policy.rejectAiRequest({mode, enabled:true, aiEnabled:true, command:'analyze'}), error => error.code === 'AI_DISABLED');
  }
  for (const command of ['analyze', 'extract', 'capabilities']) assert.throws(() => policy.rejectAiRequest({command}), error => error.code === 'AI_DISABLED');
});

test('actual Desktop analysis and extraction handlers reject without calling helper, gateway, or network', async () => {
  const source = await readFile(new URL('../../../desktop/main.cjs', import.meta.url), 'utf8');
  const registrations = source.match(/handle\('discovery(?:Analyze|Extract)'[^\n]+/g);
  assert.equal(registrations?.length, 2);
  const handlers = new Map();
  let calls = 0;
  const forbidden = () => {calls++;throw new Error('Actual analysis must never start');};
  vm.runInNewContext(registrations.join('\n'), {handle:(name, handler) => handlers.set(name, handler), rejectAiRequest:policy.rejectAiRequest, discoveryAnalyze:forbidden, fetch:forbidden, gateway:new Proxy({}, {get:forbidden})});
  for (const name of ['discoveryAnalyze', 'discoveryExtract']) {
    assert.throws(() => handlers.get(name)({enabled:true, texts:[{id:'fixture', text:'Synthetic public text'}], base64:'not-a-file', kind:'image'}), error => error.code === 'AI_DISABLED');
  }
  assert.equal(calls, 0);
});

test('Vite analysis middleware rejects before reading any request input or launching analysis', () => {
  let path, handler, reads = 0;
  discoveryVite().configureServer({middlewares:{use(endpoint, callback){path=endpoint;handler=callback;}}});
  assert.equal(path, '/__discovery/analyze');
  const request = new Proxy({}, {get(){reads++;throw new Error('AI request contents must not be read');}});
  const headers = new Map();
  let body;
  const response = {statusCode:0, setHeader:(name,value)=>headers.set(name,value), end:value=>{body=value;}};
  handler(request, response);
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(body).code, 'AI_DISABLED');
  assert.equal(headers.get('Cache-Control'), 'no-store');
  assert.equal(reads, 0);
});

test('browser adapter AI methods fail without touching fetch, storage or library mutation callbacks', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let calls = 0;
  const forbidden = () => {calls++;throw new Error('An AI side effect escaped the policy');};
  globalThis.fetch = forbidden;
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, get:forbidden});
  try {
    const api = makeDiscoveryPreview(forbidden, forbidden);
    await assert.rejects(api.discoveryAnalyze({enabled:true, texts:[{id:'fixture',text:'Public synthetic text'}],images:[]}), error => error.code === 'AI_DISABLED');
    await assert.rejects(api.discoveryExtract({kind:'pdf',base64:'not-a-file'}), error => error.code === 'AI_DISABLED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  }
});
