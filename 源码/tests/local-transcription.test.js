'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {createIntelligenceService} = require('../desktop/intelligence.cjs');
const {parseSrt, inspectPcm, MAX_BYTES, MAX_SECONDS} = require('../desktop/local-transcription.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mengcang-local-transcription-test-'));
  const runtime = path.join(root, 'runtime'), temporary = path.join(root, 'temp');
  fs.mkdirSync(runtime, {mode: 0o700}); fs.mkdirSync(temporary, {mode: 0o700});
  for (const name of ['ffmpeg', 'whisper-cli', 'model.bin']) fs.writeFileSync(path.join(runtime, name), 'synthetic fixture, never executed', {mode: name === 'model.bin' ? 0o600 : 0o700});
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, runtime, temporary};
}
function pcm(seconds = 4) {
  const size = Math.ceil(seconds * 32000), bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  return bytes;
}
function attachment() {
  const bytes = pcm();
  return {name: '合成测试.wav', type: 'audio/wav', size: bytes.length, dataUrl: `data:audio/wav;base64,${bytes.toString('base64')}`};
}
const srt = '1\n00:00:00,000 --> 00:00:01,250\n中文 <原文>。\n\n2\n00:00:01,500 --> 00:00:03,200\nOriginal café 🧪.\n';
function serviceOptions(f, extra = {}) {
  return {localTranscriptionRuntimeDir: f.runtime, localTranscriptionTemporaryRoot: f.temporary,
    initialSettings: {localTranscriptionEnabled: true, provider: 'api', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-flash'},
    confirmRequest: async () => true, getApiKey: () => {throw Error('Unexpected credential access');},
    fetchImpl: () => {throw Error('Unexpected network call');}, ...extra};
}
function spawnMock(calls, behavior = {}) {
  return (program, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123456;
    const record = {program, args, options, child, killed: false, closed: false}; calls.push(record);
    child.kill = signal => {record.killed = signal; setTimeout(() => {record.closed = true; child.emit('close', null);}, behavior.closeDelay || 0); return true;};
    if (behavior.neverExit) return child;
    queueMicrotask(() => {
      if (program.endsWith('/ffmpeg')) {
        if (!behavior.ffmpegFail) fs.writeFileSync(args.at(-1), behavior.wav || pcm());
        record.closed = true; child.emit('close', behavior.ffmpegFail ? 1 : 0);
      } else {
        if (!behavior.whisperFail) fs.writeFileSync(`${args[args.indexOf('-of') + 1]}.srt`, behavior.srt ?? srt);
        record.closed = true; child.emit('close', behavior.whisperFail ? 1 : 0);
      }
    });
    return child;
  };
}
function assertNoRuntimeLeft(f, service, calls) {
  assert.deepEqual(fs.readdirSync(f.temporary), []);
  assert.equal(service.status().localTranscription.activeProcesses, 0);
  assert.equal(service.status().localTranscription.phase, 'idle');
  assert.equal(service.status().busy, false);
  assert.equal(service.status().usage.cloudRequests, 0);
  assert.equal(service.status().usage.generationRequests, 0);
  for (const call of calls) { assert.equal(call.closed, true); assert.equal(fs.existsSync(call.options.cwd), false); }
}

test('local transcription is the independent default and does not activate generation or expose runtime paths', () => {
  const service = createIntelligenceService();
  assert.equal(service.status().settings.transcriptionProvider, 'local');
  assert.equal(service.status().settings.localTranscriptionEnabled, false);
  assert.equal(service.status().settings.generationEnabled, false);
  const value = service.status().localTranscription;
  assert.equal(value.model, 'large-v3-turbo'); assert.equal(value.onDemand, true); assert.equal(value.activeProcesses, 0);
  assert.equal(value.maxBytes, MAX_BYTES); assert.equal(value.maxDurationSeconds, MAX_SECONDS);
  assert.equal(JSON.stringify(value).includes('/Users/'), false);
  assert.throws(() => service.configure({localTranscriptionRuntimeDir: '/bin'}));
  assert.throws(() => service.configure({transcriptionProvider: 'shell'}));
});

test('disabled or incomplete local runtime stops before confirmation, process start or key access', async t => {
  const f = fixture(t); let calls = 0;
  const service = createIntelligenceService(serviceOptions(f, {initialSettings: {}, confirmRequest: () => {calls++;}, localTranscriptionSpawnImpl: () => {calls++;}}));
  await assert.rejects(service.request({action: 'transcribe', attachment: attachment()}), {code: 'LOCAL_TRANSCRIPTION_DISABLED'});
  service.configure({localTranscriptionEnabled: true}); fs.rmSync(path.join(f.runtime, 'model.bin'));
  assert.equal(service.status().localTranscription.ready, false);
  assert.deepEqual(service.status().localTranscription.missing, ['model.bin']);
  await assert.rejects(service.request({action: 'transcribe', attachment: attachment()}), {code: 'LOCAL_TRANSCRIPTION_UNAVAILABLE'});
  assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(f.temporary), []);
});

test('cancelled local confirmation creates no temp files, launches no processes and reads no API key', async t => {
  const f = fixture(t); let info, calls = 0;
  const service = createIntelligenceService(serviceOptions(f, {confirmRequest: async value => {info = value; return false;}, localTranscriptionSpawnImpl: () => {calls++;}}));
  await assert.rejects(service.request({action: 'transcribe', attachment: attachment()}), {code: 'AI_CONFIRMATION_REQUIRED'});
  assert.equal(info.provider, 'local'); assert.equal(info.local, true); assert.equal(info.model, 'large-v3-turbo');
  assert.equal(info.endpoint, undefined); assert.equal(info.filename, '合成测试.wav'); assert.equal(info.onDemand, true);
  assert.equal(calls, 0); assert.equal(service.status().usage.localTranscriptionRequests, 0);
  assertNoRuntimeLeft(f, service, []);
});

test('complete audio uses two sequential fixed programs, preserves source text and exits before returning', async t => {
  const f = fixture(t), calls = []; let confirmations = 0;
  const service = createIntelligenceService(serviceOptions(f, {localTranscriptionSpawnImpl: spawnMock(calls), confirmRequest: async () => {confirmations++; return true;}}));
  const before = service.status().settings;
  const result = await service.request({action: 'transcribe', attachment: attachment()});
  assert.equal(confirmations, 1); assert.equal(calls.length, 2);
  assert.equal(calls[0].program, path.join(f.runtime, 'ffmpeg')); assert.equal(calls[1].program, path.join(f.runtime, 'whisper-cli'));
  assert.equal(calls[0].args.includes('-t'), false, 'audio must not be silently truncated');
  assert.equal(calls[0].args[calls[0].args.indexOf('-ar') + 1], '16000');
  assert.equal(calls[0].args[calls[0].args.indexOf('-ac') + 1], '1');
  assert.equal(calls[1].args[calls[1].args.indexOf('-m') + 1], path.join(f.runtime, 'model.bin'));
  for (const call of calls) {assert.equal(call.options.shell, false); assert.equal(call.options.env.ANTHROPIC_API_KEY, undefined); assert.equal(call.options.env.OPENAI_API_KEY, undefined);}
  assert.equal(result.local, true); assert.equal(result.lifecycle, 'on-demand'); assert.equal(result.engine, 'whisper.cpp large-v3-turbo');
  assert.equal(result.durationSeconds, 4); assert.match(result.text, /00:00:01.500 --> 00:00:03.200/);
  assert.match(result.text, /中文 &lt;原文&gt;。/); assert.match(result.transcript, /Original café 🧪\./);
  assert.deepEqual(service.status().settings, before, 'DeepSeek configuration must remain unchanged');
  assert.equal(service.status().usage.localTranscriptionRequests, 1);
  assertNoRuntimeLeft(f, service, calls);
});

test('temporary audio directory is private and raw bytes are never placed on command arguments', async t => {
  const f = fixture(t), calls = [], base = spawnMock(calls);
  const service = createIntelligenceService(serviceOptions(f, {localTranscriptionSpawnImpl: (program, args, options) => {
    assert.equal(fs.statSync(options.cwd).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(options.cwd, 'source.audio')).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(args).includes('base64'), false);
    return base(program, args, options);
  }}));
  await service.request({action: 'transcribe', attachment: attachment()}); assertNoRuntimeLeft(f, service, calls);
});

test('FFmpeg failure exits and cleans up without starting whisper or delivering partial text', async t => {
  const f = fixture(t), calls = [];
  const service = createIntelligenceService(serviceOptions(f, {localTranscriptionSpawnImpl: spawnMock(calls, {ffmpegFail: true})}));
  await assert.rejects(service.request({action: 'transcribe', attachment: attachment()}), {code: 'LOCAL_TRANSCRIPTION_PROCESS_FAILED'});
  assert.equal(calls.length, 1); assertNoRuntimeLeft(f, service, calls);
});

test('whisper failure and malformed timestamps exit and clean up without saving invalid results', async t => {
  for (const behavior of [{whisperFail: true}, {srt: '1\nnot a timestamp\ntext'}]) {
    const f = fixture(t), calls = [];
    const service = createIntelligenceService(serviceOptions(f, {localTranscriptionSpawnImpl: spawnMock(calls, behavior)}));
    await assert.rejects(service.request({action: 'transcribe', attachment: attachment()}));
    assert.equal(calls.length, 2); assertNoRuntimeLeft(f, service, calls);
  }
});

test('timeout kills the process and waits for close before clearing lifecycle or temporary audio', async t => {
  const f = fixture(t), calls = [];
  const service = createIntelligenceService(serviceOptions(f, {localTranscriptionTimeoutMs: 40, localTranscriptionSpawnImpl: spawnMock(calls, {neverExit: true, closeDelay: 30})}));
  const pending = service.request({action: 'transcribe', attachment: attachment()});
  await new Promise(resolve => setTimeout(resolve, 55));
  assert.equal(calls[0].killed, 'SIGKILL'); assert.equal(service.status().localTranscription.activeProcesses, 1);
  assert.equal(fs.existsSync(calls[0].options.cwd), true);
  await assert.rejects(pending, {code: 'LOCAL_TRANSCRIPTION_TIMEOUT'});
  assert.equal(calls.length, 1); assertNoRuntimeLeft(f, service, calls);
});

test('local validation enforces 64 MiB and rejects renderer file paths before confirmation', async t => {
  const f = fixture(t); let calls = 0;
  const service = createIntelligenceService(serviceOptions(f, {confirmRequest: () => {calls++;}}));
  await assert.rejects(service.request({action: 'transcribe', attachment: {...attachment(), size: MAX_BYTES + 1}}));
  await assert.rejects(service.request({action: 'transcribe', attachment: attachment(), program: '/bin/sh'}));
  await assert.rejects(service.request({action: 'transcribe', attachment: {...attachment(), path: '/private/audio'}}));
  assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(f.temporary), []);
});

test('PCM duration limit rejects oversized converted audio instead of claiming a partial transcript', async t => {
  const f = fixture(t), file = path.join(f.root, 'long.wav'), header = pcm(0.01).subarray(0, 44);
  const dataBytes = (MAX_SECONDS + 1) * 32000;
  header.writeUInt32LE(36 + dataBytes, 4); header.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(file, header); fs.truncateSync(file, 44 + dataBytes);
  await assert.rejects(inspectPcm(file), {code: 'LOCAL_TRANSCRIPTION_TOO_LONG'});
});

test('SRT timestamps remain genuine and unordered, missing or empty speech results are explicit errors', () => {
  assert.deepEqual(parseSrt(srt).segments[1], {start: 1.5, end: 3.2, text: 'Original café 🧪.'});
  assert.throws(() => parseSrt(''), {code: 'LOCAL_TRANSCRIPTION_NO_SPEECH'});
  assert.throws(() => parseSrt('1\n00:00:01,000 --> 00:00:00,500\nwrong'), {code: 'LOCAL_TRANSCRIPTION_INVALID'});
});

test('a later kill error does not replace the original local transcription timeout',async t=>{
 const f=fixture(t),calls=[],base=spawnMock(calls,{neverExit:true});
 const service=createIntelligenceService(serviceOptions(f,{localTranscriptionTimeoutMs:20,localTranscriptionSpawnImpl:(...args)=>{const child=base(...args),stop=child.kill;child.kill=signal=>{child.emit('error',Error('synthetic kill error'));return stop(signal);};return child;}}));
 await assert.rejects(service.request({action:'transcribe',attachment:attachment()}),{code:'LOCAL_TRANSCRIPTION_TIMEOUT'});assertNoRuntimeLeft(f,service,calls);
});
