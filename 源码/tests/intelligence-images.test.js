'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createIntelligenceService, MODES} = require('../desktop/intelligence.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIYQAAAAASUVORK5CYII=', 'base64');
const attachment = (bytes = png, type = 'image/png', name = '测试图片.png') => ({name, type, size: bytes.length, dataUrl: `data:${type};base64,${bytes.toString('base64')}`});
const input = {action: 'insight', mode: 'Image description', title: '合成图片', text: '', image: attachment()};
const settings = {generationEnabled: true, endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-flash'};
const response = (content = '图片里有可见主体。', finish_reason = 'stop') => new Response(JSON.stringify({
  model: 'deepseek-flash', choices: [{message: {content}, finish_reason}],
  usage: {prompt_tokens: 42, completion_tokens: 10, total_tokens: 52},
}));
const service = (options = {}) => createIntelligenceService({initialSettings: settings,
  confirmRequest: async () => true, getApiKey: async () => 'synthetic-key', fetchImpl: async () => response(), ...options});

test('image modes send one verified local image and text after fresh confirmation', async () => {
  for (const mode of ['Image description', 'Visual analysis']) {
    const order = []; let description, request;
    const api = service({confirmRequest: async info => {order.push('confirm'); description = info; return true;},
      getApiKey: async () => {order.push('key'); return 'synthetic-key';},
      fetchImpl: async (url, options) => {order.push('fetch'); request = {url, options}; return response();}});
    const result = await api.request({...input, mode});
    assert.ok(MODES[mode]); assert.equal(result.mode, mode); assert.equal(result.text, '图片里有可见主体。');
    assert.deepEqual(order, ['confirm', 'key', 'fetch']);
    assert.deepEqual(description.image, {name: input.image.name, type: 'image/png', bytes: png.length});
    assert.equal(description.characters, JSON.stringify({title: input.title, text: ''}).length);
    assert.equal(JSON.stringify(description).includes('base64'), false);
    assert.equal(JSON.stringify(description).includes('dataUrl'), false);
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://api.deepseek.com/v1/chat/completions');
    assert.deepEqual(body.thinking, {type: 'disabled'});
    assert.deepEqual(body.messages[1].content, [{type: 'text', text: JSON.stringify({title: input.title, text: ''})},
      {type: 'image_url', image_url: {url: input.image.dataUrl, detail: 'high'}}]);
    assert.equal(JSON.parse(body.messages[1].content[0].text).image, undefined);
    assert.equal(api.status().usage.generationRequests, 1); assert.equal(api.status().usage.cloudRequests, 1);
  }
});

test('the five original modes remain text-compatible and can optionally include an image', async () => {
  for (const mode of ['The Gist', 'Explain Like I’m 5', 'Contrarian Take', 'Analogy', 'Hot Take']) {
    let body;
    const api = service({fetchImpl: async (_url, options) => {body = JSON.parse(options.body); return response();}});
    await api.request({action: 'insight', mode, title: '', text: '仅文字材料'});
    assert.equal(typeof body.messages[1].content, 'string');
    assert.deepEqual(JSON.parse(body.messages[1].content), {title: '', text: '仅文字材料'});
    await api.request({...input, mode});
    assert.equal(body.messages[1].content[1].type, 'image_url');
  }
});

test('generic image APIs receive multimodal content without DeepSeek-specific fields', async () => {
  let body;
  const api = service({initialSettings: {...settings, endpoint: 'https://api.example.com/v1', model: 'synthetic-vision'},
    fetchImpl: async (_url, options) => {body = JSON.parse(options.body); return response();}});
  await api.request(input);
  assert.equal(body.messages[1].content[1].image_url.url, input.image.dataUrl);
  assert.equal(body.thinking, undefined); assert.equal(body.response_format, undefined);
});

test('all four supported raster signature fixtures retain their validated MIME type', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=', 'base64');
  const jpegSignature = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
  for (const [bytes, type, name] of [[png, 'image/png', 'test.png'], [gif, 'image/gif', 'test.gif'],
    [webp, 'image/webp', 'test.webp'], [jpegSignature, 'image/jpeg', 'signature.jpg']]) {
    let metadata, calls = 0;
    const api = service({confirmRequest: async info => {metadata = info.image; return true;},
      fetchImpl: async () => {calls++; return response();}});
    await api.request({...input, image: attachment(bytes, type, name)});
    assert.equal(metadata.type, type); assert.equal(metadata.bytes, bytes.length); assert.equal(calls, 1);
  }
});

test('image classification retains JSON mode and candidate validation', async () => {
  let body;
  const input = {action: 'classify', title: '合成图片', text: '', image: attachment(), collections: [{id: 'visual', title: '视觉资料'}]};
  const api = service({fetchImpl: async (_url, options) => {body = JSON.parse(options.body); return response(JSON.stringify({tags: ['图片'], collectionIds: ['visual'], reason: '可见内容相关'}));}});
  const result = await api.request(input);
  assert.deepEqual(result.tags, ['图片']); assert.deepEqual(result.collectionIds, ['visual']);
  assert.deepEqual(body.response_format, {type: 'json_object'});
  assert.equal(body.messages[1].content[1].image_url.url, input.image.dataUrl);
  const invalid = service({fetchImpl: async () => response(JSON.stringify({tags: ['图片'], collectionIds: ['invented'], reason: ''}))});
  await assert.rejects(invalid.request(input), {code: 'INVALID_RESPONSE'});
});

test('cancelled image calls never access a key, send an image or consume requests', async () => {
  let confirmations = 0, calls = 0;
  const api = service({confirmRequest: async () => {confirmations++; return false;},
    getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
  await assert.rejects(api.request(input), {code: 'AI_CONFIRMATION_REQUIRED'});
  assert.equal(confirmations, 1); assert.equal(calls, 0);
  assert.equal(api.status().usage.generationRequests, 0); assert.equal(api.status().usage.cloudRequests, 0);
});

test('both visual-only modes require an image before confirmation', async () => {
  let calls = 0;
  const api = service({confirmRequest: () => {calls++;}, getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
  for (const mode of ['Image description', 'Visual analysis']) {
    await assert.rejects(api.request({action: 'insight', mode, title: '材料', text: '文字'}), {code: 'IMAGE_REQUIRED'});
  }
  assert.equal(calls, 0);
});

test('only documented DeepSeek Flash image models are allowed before authorization', async () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    let calls = 0;
    const api = service({initialSettings: {...settings, endpoint: 'https://api.deepseek.com./v1', model}, fetchImpl: async () => {calls++; return response();}});
    await api.request(input); assert.equal(calls, 1);
  }
  for (const model of ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-flash-custom']) {
    let calls = 0;
    const api = service({initialSettings: {...settings, model}, confirmRequest: () => {calls++;},
      getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
    await assert.rejects(api.request(input), {code: 'IMAGE_MODEL_UNSUPPORTED'});
    await assert.rejects(api.request({action: 'classify', text: '', image: attachment(), collections: []}), {code: 'IMAGE_MODEL_UNSUPPORTED'});
    assert.equal(calls, 0); assert.equal(api.status().usage.cloudRequests, 0);
  }
});

test('CLI images are rejected before confirmation, key access or process spawn', async () => {
  let calls = 0;
  const api = service({initialSettings: {...settings, provider: 'cli'}, confirmRequest: () => {calls++;},
    getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}, spawnImpl: () => {calls++;}});
  await assert.rejects(api.request(input), {code: 'IMAGE_API_REQUIRED'});
  assert.equal(calls, 0); assert.equal(api.status().usage.generationRequests, 0);
});

test('invalid signatures, declarations, remote URLs, paths and unsupported files fail before any approval', async () => {
  const invalid = [
    {...attachment(), size: png.length + 1},
    {...attachment(), size: 8 * 1024 * 1024 + 1},
    attachment(Buffer.from('plain text')),
    {...attachment(), type: 'image/jpeg'},
    {...attachment(), dataUrl: 'https://example.com/image.png'},
    {path: '/tmp/image.png'},
    {...attachment(), path: '/tmp/image.png'},
    {...attachment(), url: 'https://example.com/image.png'},
    attachment(Buffer.from('<svg/>'), 'image/svg+xml', 'image.svg'),
    attachment(Buffer.from('%PDF-synthetic'), 'application/pdf', 'file.pdf'),
    attachment(png, 'image/tiff', 'image.tiff'),
  ];
  for (const image of invalid) {
    let calls = 0;
    const api = service({confirmRequest: () => {calls++;}, getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
    await assert.rejects(api.request({...input, image})); assert.equal(calls, 0);
    assert.equal(api.status().usage.generationRequests, 0); assert.equal(api.status().usage.cloudRequests, 0);
  }
});

test('oversized actual image bytes cannot bypass the declared-size limit', async () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 1); png.copy(bytes);
  let calls = 0;
  const api = service({confirmRequest: () => {calls++;}, getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
  await assert.rejects(api.request({...input, image: {...attachment(bytes), size: png.length}}), {code: 'INVALID_IMAGE'});
  assert.equal(calls, 0);
});

test('empty and truncated image results are rejected without an automatic retry', async () => {
  for (const [content, reason] of [['', 'stop'], ['部分描述', 'length']]) {
    let calls = 0;
    const api = service({fetchImpl: async () => {calls++; return response(content, reason);}});
    await assert.rejects(api.request(input)); assert.equal(calls, 1);
  }
});
