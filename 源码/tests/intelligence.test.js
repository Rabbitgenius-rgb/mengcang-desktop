'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {createIntelligenceService, apiEndpoint, runClaude, MODES} = require('../desktop/intelligence.cjs');

const capabilities = {local: true, ocr: true, pdf: true, semanticLanguages: ['zh-Hans', 'en']};
const insight = {action: 'insight', mode: 'The Gist', title: '合成材料', text: '图书馆为社区提供阅读空间。'};
const response = (content = '社区可以在图书馆阅读。', extras = {}) => new Response(JSON.stringify({
  model: 'synthetic-model', choices: [{message: {content}, finish_reason: 'stop'}],
  usage: {prompt_tokens: 30, completion_tokens: 10, total_tokens: 40}, ...extras,
}), {status: 200, headers: {'content-type': 'application/json'}});
const enabled = {generationEnabled: true, model: 'synthetic-model', transcriptionProvider: 'api'};
function api(options = {}) {
  return createIntelligenceService({initialSettings: enabled, confirmRequest: async () => true,
    getApiKey: async () => 'synthetic-key', fetchImpl: async () => response(), ...options});
}

test('default settings and status never execute a model, native helper or HTTP request', async () => {
  let calls = 0;
  const service = createIntelligenceService({nativeAnalyze: () => {calls++;}, fetchImpl: () => {calls++;}});
  const state = service.status();
  assert.equal(state.settings.nativeEnabled, false);
  assert.equal(state.settings.generationEnabled, false);
  assert.equal(state.cloudBlocked, true);
  assert.equal(state.requiresConfirmation, true);
  await assert.rejects(service.request(insight), {code: 'AI_DISABLED'});
  await assert.rejects(service.request({action: 'embed', texts: [{id: 'a', text: 'synthetic'}]}), {code: 'AI_DISABLED'});
  await assert.rejects(service.request({action: 'extract', kind: 'image', base64: 'eA=='}), {code: 'AI_DISABLED'});
  assert.equal(calls, 0);
  assert.equal(state.usage.cloudRequests, 0);
});

test('configuration rejects secrets, execution paths, external HTTP and private addresses', () => {
  const service = createIntelligenceService();
  for (const patch of [{apiKey: 'secret'}, {approved: true}, {cliProgram: '/bin/sh'}, {provider: 'shell'},
    {endpoint: 'http://api.example.com/v1'}, {endpoint: 'https://api.example.com/v1?api_key=secret'},
    {endpoint: 'https://user:secret@api.example.com/v1'}, {endpoint: 'https://169.254.169.254/v1'},
    {endpoint: 'https://10.0.0.1/v1'}, {endpoint: 'https://server.internal/v1'},
    {timeoutMs: 200000}, {maxOutputTokens: 100000}]) assert.throws(() => service.configure(patch));
  assert.equal(apiEndpoint('https://api.example.com/api/v1/'), 'https://api.example.com/api/v1');
  assert.equal(apiEndpoint('http://localhost:1234/v1'), 'http://127.0.0.1:1234/v1');
  assert.equal(service.status().settings.generationEnabled, false);
});

test('a renderer cannot replace main-process confirmation with approved:true', async () => {
  let calls = 0;
  const service = api({confirmRequest: undefined, fetchImpl: () => {calls++;}, getApiKey: () => {calls++;}});
  await assert.rejects(service.request(insight), {code: 'AI_CONFIRMATION_REQUIRED'});
  await assert.rejects(service.request({...insight, approved: true}), {code: 'INTELLIGENCE_INVALID'});
  assert.equal(calls, 0);
  assert.equal(service.status().usage.cloudRequests, 0);
  assert.equal(service.status().usage.generationRequests, 0);
});

test('declining confirmation does not retrieve credentials or spend a request', async () => {
  let calls = 0;
  const service = api({confirmRequest: async () => false, getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
  await assert.rejects(service.request(insight), {code: 'AI_CONFIRMATION_REQUIRED'});
  assert.equal(calls, 0);
  assert.equal(service.status().usage.cloudRequests, 0);
});

test('every generation receives fresh confirmation before key access and sends only supplied material', async () => {
  const order = [], descriptions = [], requests = [];
  const service = api({confirmRequest: async description => {order.push('confirm'); descriptions.push(description); return true;},
    getApiKey: async () => {order.push('key'); return 'synthetic-secret';},
    fetchImpl: async (url, options) => {order.push('fetch'); requests.push({url, options}); return response();}});
  for (let i = 0; i < 2; i++) {
    const result = await service.request(insight);
    assert.equal(result.text, '社区可以在图书馆阅读。');
    assert.equal(result.local, false);
    assert.deepEqual(result.usage, {prompt_tokens: 30, completion_tokens: 10, total_tokens: 40});
  }
  assert.deepEqual(order, ['confirm', 'key', 'fetch', 'confirm', 'key', 'fetch']);
  assert.equal(descriptions.length, 2);
  assert.equal(descriptions[0].action, 'insight');
  assert.equal(descriptions[0].endpoint, 'https://api.openai.com/v1');
  assert.ok(descriptions[0].characters > 0);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-secret');
  const payload = JSON.parse(requests[0].options.body);
  assert.deepEqual(JSON.parse(payload.messages[1].content), {title: insight.title, text: insight.text});
  assert.equal(payload.tools, undefined);
  assert.equal(JSON.stringify(service.status()).includes('synthetic-secret'), false);
  assert.equal(service.status().usage.generationRequests, 2);
  assert.equal(service.status().usage.cloudRequests, 2);
});

test('missing or malformed API keys fail before transport and are absent from status', async () => {
  let calls = 0;
  for (const key of ['', 'synthetic\ninvalid']) {
    const service = api({getApiKey: async () => key, fetchImpl: () => {calls++;}});
    await assert.rejects(service.request(insight), error => ['API_KEY_REQUIRED', 'INVALID_API_KEY'].includes(error.code));
    assert.equal(service.status().usage.generationRequests, 0);
  }
  assert.equal(calls, 0);
});

test('loopback model generation still requires confirmation but never counts as cloud usage', async () => {
  let confirmations = 0;
  const service = api({initialSettings: {...enabled, endpoint: 'http://127.0.0.1:1234/v1'},
    confirmRequest: async () => {confirmations++; return true;}, getApiKey: async () => ''});
  const result = await service.request(insight);
  assert.equal(result.local, true);
  assert.equal(confirmations, 1);
  assert.equal(service.status().usage.generationRequests, 1);
  assert.equal(service.status().usage.cloudRequests, 0);
});

test('all five exact modes work while invalid mode and excessive input cannot reach transport', async () => {
  let calls = 0;
  const service = api({fetchImpl: async () => {calls++; return response();}});
  for (const mode of ['The Gist', 'Explain Like I’m 5', 'Contrarian Take', 'Analogy', 'Hot Take']) {
    assert.equal((await service.request({...insight, mode})).mode, mode);
  }
  await assert.rejects(service.request({...insight, mode: 'unknown'}));
  await assert.rejects(service.request({...insight, text: 'x'.repeat(20001)}));
  assert.equal(calls, 5);
});

test('busy requests cannot overlap, change settings or change the endpoint during confirmation', async () => {
  let confirm;
  const pending = new Promise(resolve => {confirm = resolve;});
  const service = api({confirmRequest: () => pending});
  const first = service.request(insight);
  assert.equal(service.status().busy, true);
  assert.throws(() => service.configure({endpoint: 'https://api.example.com/v1'}), {code: 'INTELLIGENCE_BUSY'});
  await assert.rejects(service.request(insight), {code: 'INTELLIGENCE_BUSY'});
  confirm(true); await first;
  assert.equal(service.status().busy, false);
});

test('redirect, broken JSON, tool-only and truncated responses fail without automatic retries', async () => {
  const samples = [
    () => new Response('', {status: 302, headers: {location: 'https://other.example/v1'}}),
    () => new Response('not json', {status: 200}),
    () => response('', {choices: [{message: {tool_calls: [{id: 'unwanted'}]}}]}),
    () => response('partial', {choices: [{message: {content: 'partial'}, finish_reason: 'length'}]}),
  ];
  for (const make of samples) {
    let calls = 0;
    const service = api({fetchImpl: async () => {calls++; return make();}});
    await assert.rejects(service.request(insight));
    assert.equal(calls, 1);
    assert.equal(service.status().busy, false);
    assert.equal(service.status().usage.failedRequests, 1);
  }
});

test('HTTP deadline aborts a nonresponsive provider and does not retry', async () => {
  let signal, calls = 0;
  const service = api({initialSettings: {...enabled, timeoutMs: 1000}, fetchImpl: (_url, options) => {
    calls++; signal = options.signal; return new Promise(() => {});
  }});
  await assert.rejects(service.request(insight), {code: 'MODEL_TIMEOUT'});
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(service.status().busy, false);
});

test('oversized declared and streamed provider responses are rejected', async () => {
  for (const make of [
    () => new Response('{}', {headers: {'content-length': String(3 * 1024 * 1024)}}),
    () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) await assert.rejects(api({fetchImpl: async () => make()}).request(insight), {code: 'INVALID_RESPONSE'});
});

test('classification returns suggestions without inventing collections or applying changes', async () => {
  const input = {action: 'classify', text: '阅读空间', collections: [{id: 'reading', title: '阅读'}]};
  const good = api({fetchImpl: async () => response(JSON.stringify({tags: ['阅读', '空间'], collectionIds: ['reading'], reason: '主题相关'}))});
  const result = await good.request(input);
  assert.deepEqual(result.tags, ['阅读', '空间']); assert.deepEqual(result.collectionIds, ['reading']); assert.equal(result.local, false);
  const wrong = api({fetchImpl: async () => response(JSON.stringify({tags: ['阅读'], collectionIds: ['invented'], reason: ''}))});
  await assert.rejects(wrong.request(input), {code: 'INVALID_RESPONSE'});
});

test('official DeepSeek short answers disable thinking and use final content only', async () => {
  for (const endpoint of ['https://api.deepseek.com/v1', 'https://API.DEEPSEEK.COM./v1']) {
    let payload, calls = 0;
    const service = api({initialSettings: {...enabled, endpoint, model: 'deepseek-flash'},
      fetchImpl: async (_url, options) => {
        calls++; payload = JSON.parse(options.body);
        return response('最终解读', {choices: [{message: {content: '最终解读', reasoning_content: '不应作为答案'}, finish_reason: 'stop'}]});
      }});
    assert.equal((await service.request(insight)).text, '最终解读');
    assert.deepEqual(payload.thinking, {type: 'disabled'});
    assert.equal(payload.max_tokens, 1200);
    assert.equal(payload.response_format, undefined);
    assert.equal(calls, 1);
  }
});

test('only the official DeepSeek classification API requests JSON mode', async () => {
  const input = {action: 'classify', text: '阅读空间', collections: [{id: 'reading', title: '阅读'}]};
  for (const endpoint of ['https://api.deepseek.com/v1', 'https://api.example.com/v1', 'https://api.deepseek.com.example.com/v1']) {
    let payload;
    const service = api({initialSettings: {...enabled, endpoint}, fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return response(JSON.stringify({tags: ['阅读'], collectionIds: ['reading'], reason: '主题相关'}));
    }});
    assert.deepEqual((await service.request(input)).collectionIds, ['reading']);
    if (endpoint === 'https://api.deepseek.com/v1') {
      assert.deepEqual(payload.thinking, {type: 'disabled'});
      assert.deepEqual(payload.response_format, {type: 'json_object'});
    } else {
      assert.equal(payload.thinking, undefined);
      assert.equal(payload.response_format, undefined);
    }
  }
});

test('declining a DeepSeek request never reads a key or starts a transport', async () => {
  let confirmations = 0, calls = 0;
  const service = api({initialSettings: {...enabled, endpoint: 'https://api.deepseek.com/v1'},
    confirmRequest: async () => {confirmations++; return false;},
    getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
  await assert.rejects(service.request(insight), {code: 'AI_CONFIRMATION_REQUIRED'});
  assert.equal(confirmations, 1); assert.equal(calls, 0);
  assert.equal(service.status().usage.generationRequests, 0);
  assert.equal(service.status().usage.cloudRequests, 0);
});

test('DeepSeek empty and truncated classification responses fail without retries', async () => {
  const input = {action: 'classify', text: '阅读空间', collections: [{id: 'reading', title: '阅读'}]};
  for (const [content, finish_reason, code] of [
    ['', 'stop', 'INVALID_RESPONSE'],
    [JSON.stringify({tags: ['阅读'], collectionIds: ['reading'], reason: '部分结果'}), 'length', 'MODEL_OUTPUT_TRUNCATED'],
  ]) {
    let calls = 0;
    const service = api({initialSettings: {...enabled, endpoint: 'https://api.deepseek.com/v1'},
      fetchImpl: async () => {calls++; return response(content, {choices: [{message: {content}, finish_reason}]});}});
    await assert.rejects(service.request(input), {code});
    assert.equal(calls, 1);
  }
});

test('native OCR preserves recognized text and one-based page provenance without cloud calls', async () => {
  const calls = [];
  const service = createIntelligenceService({initialSettings: {nativeEnabled: true}, nativeAnalyze: async (input, options) => {
    calls.push({input, options}); return {text: '原文\nOriginal café 🧪', pages: [{page: 1, text: '原文\nOriginal café 🧪', engine: 'Apple Vision'}], engine: 'PDFKit + Apple Vision'};
  }, fetchImpl: () => {throw Error('Unexpected cloud transport');}});
  const result = await service.request({action: 'extract', kind: 'pdf', base64: Buffer.from('%PDF-synthetic').toString('base64')});
  assert.equal(result.text, '原文\nOriginal café 🧪'); assert.equal(result.pages[0].page, 1); assert.equal(result.local, true);
  assert.equal(calls[0].input.command, 'extract');
  assert.equal(service.status().usage.nativeRequests, 1);
  assert.equal(service.status().usage.generationRequests, 0);
  assert.equal(service.status().usage.cloudRequests, 0);
});

test('native requests reject file paths, invalid base64 and mismatched or zero vectors', async () => {
  let calls = 0;
  const service = createIntelligenceService({initialSettings: {nativeEnabled: true}, nativeAnalyze: async () => {calls++; return {};}});
  await assert.rejects(service.request({action: 'extract', kind: 'image', path: '/private/file', base64: 'eA=='}));
  await assert.rejects(service.request({action: 'extract', kind: 'image', base64: 'bad!'}));
  await assert.rejects(service.request({action: 'embed', texts: [{id: 'a', text: 'text'}, {id: 'a', text: 'duplicate'}]}));
  assert.equal(calls, 0);
  for (const value of [{id: 'other', vector: [1, 0]}, {id: 'a', vector: [0, 0]}, {id: 'a', vector: [NaN]}]) {
    const bad = createIntelligenceService({initialSettings: {nativeEnabled: true}, nativeAnalyze: async () => ({embeddings: [{language: 'en', model: 'native', ...value}]})});
    await assert.rejects(bad.request({action: 'embed', texts: [{id: 'a', text: 'text'}]}), {code: 'INVALID_RESPONSE'});
  }
});

test('missing native language embeddings are reported explicitly rather than simulated', async () => {
  const service = createIntelligenceService({initialSettings: {nativeEnabled: true}, nativeAnalyze: async () => ({
    embeddings: [{id: 'en', language: 'en', model: 'apple-nl-sentence-en-r1', vector: [0.2, 0.8]}], capabilities,
  })});
  const result = await service.request({action: 'embed', texts: [{id: 'en', text: 'garden'}, {id: 'unsupported', text: 'synthetic'}]});
  assert.deepEqual(result.missingIds, ['unsupported']); assert.equal(result.embeddings.length, 1);
});

test('native capabilities are metadata, not charged calls, and callers cannot mutate stored state', async () => {
  const service = createIntelligenceService({initialSettings: {nativeEnabled: true}, nativeAnalyze: async () => capabilities});
  await service.request({action: 'capabilities'});
  const state = service.status(); state.nativeCapabilities.semanticLanguages.push('invented'); state.settings.nativeEnabled = false;
  assert.equal(service.status().nativeCapabilities.semanticLanguages.includes('invented'), false);
  assert.equal(service.status().settings.nativeEnabled, true);
  assert.equal(service.status().usage.nativeRequests, 0);
  assert.equal(service.status().usage.metadataRequests, 1);
  assert.equal(service.status().usage.cloudRequests, 0);
});

function mockSpawn(result, inspect) {
  return (program, args, options) => {
    inspect?.(program, args, options);
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.once('finish', () => queueMicrotask(() => {child.stdout.end(JSON.stringify(result)); child.emit('close', 0);}));
    return child;
  };
}
test('Claude CLI is fixed-argv, tool-free, isolated and removes its temporary working directory', async () => {
  let directory, argumentsUsed;
  const result = await runClaude({instructions: 'Read supplied text only.', content: {text: 'synthetic'}, model: '', timeoutMs: 1000,
    executable: '/synthetic/claude', spawnImpl: mockSpawn({type: 'result', result: '合成解读', usage: {input_tokens: 2, output_tokens: 3}}, (_program, args, options) => {
      directory = options.cwd; argumentsUsed = args;
      assert.equal(options.shell, false); assert.equal(fs.readdirSync(directory).length, 0);
      assert.equal(args[args.indexOf('--tools') + 1], '');
      for (const flag of ['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']) assert.ok(args.includes(flag));
      assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
    })});
  assert.equal(result.text, '合成解读'); assert.equal(result.local, false);
  assert.equal(result.usage.prompt_tokens, 2); assert.equal(result.usage.completion_tokens, 3);
  assert.equal(fs.existsSync(directory), false); assert.equal(argumentsUsed.includes('synthetic'), false);
});

test('CLI generation also requires main confirmation, and its metadata probe does not run the CLI', async () => {
  let calls = 0, confirmations = 0;
  const service = createIntelligenceService({initialSettings: {provider: 'cli', generationEnabled: true}, cliExecutable: '/synthetic/claude',
    confirmRequest: async () => {confirmations++; return true;}, spawnImpl: mockSpawn({type: 'result', result: '合成解读'}, () => {calls++;})});
  const probe = await service.request({action: 'probe'});
  assert.equal(probe.cliAvailable, true); assert.equal(calls, 0); assert.equal(confirmations, 0);
  const result = await service.request(insight);
  assert.equal(result.text, '合成解读'); assert.equal(calls, 1); assert.equal(confirmations, 1);
  assert.equal(service.status().usage.cloudRequests, 1); assert.equal(service.status().usage.generationRequests, 1);
});

function audioAttachment() {
  const bytes = Buffer.alloc(48); bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVE', 8);
  return {name: '合成录音.wav', type: 'audio/wav', size: bytes.length, dataUrl: `data:audio/wav;base64,${bytes.toString('base64')}`};
}
test('declined audio transcription never reads a key or sends the audio', async () => {
  let calls = 0, confirmation;
  const service = api({confirmRequest: async details => {confirmation = details; return false;},
    getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
  const attachment = audioAttachment();
  await assert.rejects(service.request({action: 'transcribe', attachment}), {code: 'AI_CONFIRMATION_REQUIRED'});
  assert.equal(calls, 0); assert.equal(service.status().usage.cloudRequests, 0);
  assert.equal(confirmation.filename, attachment.name); assert.equal(confirmation.bytes, attachment.size);
  assert.equal(confirmation.model, 'whisper-1'); assert.equal(confirmation.characters, 0);
  assert.equal(JSON.stringify(confirmation).includes('base64'), false);
});
test('official DeepSeek audio transcription is blocked before confirmation or upload', async () => {
  for (const endpoint of ['https://api.deepseek.com/v1', 'https://api.deepseek.com./v1']) {
    let calls = 0;
    const service = api({initialSettings: {...enabled, endpoint},
      confirmRequest: () => {calls++;}, getApiKey: () => {calls++;}, fetchImpl: () => {calls++;}});
    await assert.rejects(service.request({action: 'transcribe', attachment: audioAttachment()}), error =>
      error.code === 'TRANSCRIPTION_PROVIDER_UNSUPPORTED' && error.message.includes('未发送音频'));
    assert.equal(calls, 0);
    assert.equal(service.status().usage.generationRequests, 0);
    assert.equal(service.status().usage.cloudRequests, 0);
  }
});
test('transcription validates audio, sends multipart after confirmation and returns genuine timestamped WebVTT', async () => {
  let captured;
  const service = api({fetchImpl: async (url, options) => {
    captured = {url, options};
    return new Response(JSON.stringify({text: '你好 <reading>。 下一句。', language: 'chinese', segments: [
      {start: 0, end: 1.25, text: '你好 <reading>。'}, {start: 1.5, end: 3.2, text: '下一句。'},
    ]}));
  }});
  const output = await service.request({action: 'transcribe', attachment: audioAttachment()});
  assert.equal(captured.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.match(captured.options.headers['Content-Type'], /^multipart\/form-data; boundary=mengcang-/);
  assert.ok(Buffer.isBuffer(captured.options.body));
  const body = captured.options.body.toString('utf8');
  assert.match(body, /name="response_format"\r\n\r\nverbose_json/);
  assert.match(body, /name="model"\r\n\r\nwhisper-1/);
  assert.match(body, /RIFF/);
  assert.match(output.text, /^WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.250\n你好 &lt;reading&gt;。/);
  assert.equal(output.transcript, '你好 <reading>。 下一句。');
  assert.equal(output.name, '合成录音.vtt'); assert.equal(output.format, 'vtt'); assert.equal(output.local, false);
  assert.equal(service.status().usage.cloudRequests, 1);
});
test('oversize or fake audio is blocked before confirmation, and unsupported CLI transcription is explicit', async () => {
  let confirmations = 0;
  const service = api({confirmRequest: () => {confirmations++; return true;}});
  const bad = audioAttachment(); bad.dataUrl = `data:audio/wav;base64,${Buffer.alloc(48).toString('base64')}`;
  await assert.rejects(service.request({action: 'transcribe', attachment: bad}));
  await assert.rejects(service.request({action: 'transcribe', attachment: {...audioAttachment(), size: 26 * 1024 * 1024}}));
  const cli = api({initialSettings: {...enabled, provider: 'cli'}});
  await assert.rejects(cli.request({action: 'transcribe', attachment: audioAttachment()}), {code: 'TRANSCRIPTION_API_REQUIRED'});
  assert.equal(confirmations, 0);
});
test('transcription without actual timestamps cannot masquerade as an aligned transcript', async () => {
  for (const value of [{text: 'only text'}, {text: 'bad timestamp', segments: [{start: 2, end: 1, text: 'invalid'}]}]) {
    const service = api({fetchImpl: async () => new Response(JSON.stringify(value))});
    await assert.rejects(service.request({action: 'transcribe', attachment: audioAttachment()}), {code: 'INVALID_RESPONSE'});
  }
});
