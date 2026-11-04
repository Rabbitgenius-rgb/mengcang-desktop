'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');

const MODEL = 'large-v3-turbo';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_SECONDS = 2 * 60 * 60;
const TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PCM_BYTES = MAX_SECONDS * 16000 * 2;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const errorOf = (message, code) => Object.assign(new Error(message), {code});

function runtimeStatus(directory) {
  const missing = [];
  for (const name of ['ffmpeg', 'whisper-cli', 'model.bin']) {
    try {
      const file = path.join(directory, name), stat = fs.statSync(file);
      if (!stat.isFile() || !stat.size) throw Error('empty');
      if (name !== 'model.bin') fs.accessSync(file, fs.constants.X_OK);
    } catch { missing.push(name); }
  }
  return {ready: !missing.length, available: !missing.length, missing};
}

function parseSrt(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_RESULT_BYTES) throw errorOf('本机转录结果过大或格式无效', 'LOCAL_TRANSCRIPTION_INVALID');
  const raw = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!raw) throw errorOf('整段音频已处理，但没有识别出可用语音', 'LOCAL_TRANSCRIPTION_NO_SPEECH');
  const blocks = raw.split(/\n[ \t]*\n/);
  if (blocks.length > 20000) throw errorOf('本机转录片段超过上限', 'LOCAL_TRANSCRIPTION_INVALID');
  const stamp = value => {
    const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw errorOf('本机转录时间戳格式无效', 'LOCAL_TRANSCRIPTION_INVALID');
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  };
  let previous = -1;
  const segments = blocks.map(block => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0])) lines.shift();
    const match = /^(\S+)\s+-->\s+(\S+)\s*$/.exec(lines.shift() || '');
    if (!match) throw errorOf('本机转录缺少有效时间戳', 'LOCAL_TRANSCRIPTION_INVALID');
    const start = stamp(match[1]), end = stamp(match[2]), text = lines.join('\n').trim();
    if (start < previous || start < 0 || end <= start || end > MAX_SECONDS + 1 || !text || text.length > 50000) throw errorOf('本机转录片段或时间范围无效', 'LOCAL_TRANSCRIPTION_INVALID');
    previous = start;
    return {start, end, text};
  });
  return {text: segments.map(segment => segment.text).join('\n'), segments};
}

async function inspectPcm(file) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > MAX_PCM_BYTES + 65536) throw errorOf('音频超过本机两小时处理上限；未截取部分音频作为完整结果', 'LOCAL_TRANSCRIPTION_TOO_LONG');
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, 65536));
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw errorOf('本机音频转换没有产生有效 WAV', 'LOCAL_TRANSCRIPTION_INVALID');
    let position = 12, format, dataBytes;
    while (position + 8 <= bytesRead) {
      const kind = buffer.toString('ascii', position, position + 4), size = buffer.readUInt32LE(position + 4);
      if (kind === 'fmt ' && size >= 16 && position + 24 <= bytesRead) {
        format = {codec: buffer.readUInt16LE(position + 8), channels: buffer.readUInt16LE(position + 10),
          sampleRate: buffer.readUInt32LE(position + 12), bits: buffer.readUInt16LE(position + 22)};
      }
      if (kind === 'data') { dataBytes = size; if (position + 8 + dataBytes > stat.size) throw errorOf('转换后的音频不完整', 'LOCAL_TRANSCRIPTION_INVALID'); break; }
      position += 8 + size + size % 2;
    }
    if (!format || format.codec !== 1 || format.channels !== 1 || format.sampleRate !== 16000 || format.bits !== 16 || !dataBytes) {
      throw errorOf('音频须完整转换为 16 kHz 单声道 PCM16', 'LOCAL_TRANSCRIPTION_INVALID');
    }
    const durationSeconds = dataBytes / 32000;
    if (durationSeconds > MAX_SECONDS) throw errorOf('音频超过本机两小时处理上限；未截取部分音频作为完整结果', 'LOCAL_TRANSCRIPTION_TOO_LONG');
    return {durationSeconds};
  } finally { await handle.close(); }
}

function createLocalTranscriber({runtimeDir = path.join(__dirname, 'local-transcription'), spawnImpl = spawn,
  timeoutMs = TIMEOUT_MS, temporaryRoot = os.tmpdir()} = {}) {
  if (typeof runtimeDir !== 'string' || !path.isAbsolute(runtimeDir)) throw errorOf('本机转录组件路径无效', 'LOCAL_TRANSCRIPTION_UNAVAILABLE');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > TIMEOUT_MS) throw errorOf('本机转录时限无效', 'LOCAL_TRANSCRIPTION_INVALID');
  let phase = 'idle';
  const active = new Set();
  const status = () => {
    const runtime = runtimeStatus(runtimeDir);
    return {...runtime, model: MODEL, onDemand: true, lifecycle: 'on-demand', phase, activeProcesses: active.size,
      maxBytes: MAX_BYTES, maxDurationSeconds: MAX_SECONDS, timeoutMs,
      message: runtime.ready ? '本机组件已准备好；按需启动，任务结束即退出并释放模型内存。' : `本机转录组件尚未准备好：${runtime.missing.join('、')}`};
  };
  const setPhase = value => { phase = value; };
  async function processFile(program, args, directory, deadline, label) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw errorOf('本机转录超过处理时限，进程已退出', 'LOCAL_TRANSCRIPTION_TIMEOUT');
    return new Promise((resolve, reject) => {
      let child, terminalError, outputBytes = 0, settled = false, timer;
      const finish = (error) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (child) active.delete(child);
        process.removeListener('exit', onParentExit);
        error ? reject(error) : resolve();
      };
      const stop = error => {
        if (settled || terminalError) return;
        terminalError = error;
        // Do not resolve until close: the caller must never report released
        // memory or delete the temporary files while a model is still alive.
        try { child.kill('SIGKILL'); } catch {}
      };
      const onParentExit = () => { try { child?.kill('SIGKILL'); } catch {} };
      try {
        child = spawnImpl(program, args, {cwd: directory, shell: false, windowsHide: true,
          env: {PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', TMPDIR: directory,
            DYLD_LIBRARY_PATH: path.join(runtimeDir, 'lib'), GGML_METAL_PATH_RESOURCES: runtimeDir},
          stdio: ['ignore', 'pipe', 'pipe']});
      } catch { finish(errorOf(`${label}未能启动`, 'LOCAL_TRANSCRIPTION_PROCESS_FAILED')); return; }
      active.add(child); process.once('exit', onParentExit);
      timer = setTimeout(() => stop(errorOf('本机转录超过处理时限，进程已退出', 'LOCAL_TRANSCRIPTION_TIMEOUT')), remaining);
      const drain = stream => stream.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > MAX_RESULT_BYTES) stop(errorOf(`${label}输出超过允许大小，进程已退出`, 'LOCAL_TRANSCRIPTION_INVALID'));
      });
      drain(child.stdout); drain(child.stderr);
      child.on('error', () => {
        terminalError ||= errorOf(`${label}未能启动`, 'LOCAL_TRANSCRIPTION_PROCESS_FAILED');
        // Failed spawn has no running process to await; regular process errors
        // are followed by close and keep the lifecycle accurate until then.
        if (!child.pid) finish(terminalError);
      });
      child.on('close', code => finish(terminalError || (code === 0 ? null : errorOf(`${label}未完成，进程已退出；没有生成部分转录结果`, 'LOCAL_TRANSCRIPTION_PROCESS_FAILED'))));
    });
  }
  async function run(attachment) {
    if (!status().ready) throw errorOf(status().message, 'LOCAL_TRANSCRIPTION_UNAVAILABLE');
    if (active.size) throw errorOf('已有本机转录正在运行', 'INTELLIGENCE_BUSY');
    const directory = await fs.promises.mkdtemp(path.join(temporaryRoot, 'mengcang-transcription-'));
    const input = path.join(directory, 'source.audio'), wav = path.join(directory, 'audio.wav'), prefix = path.join(directory, 'transcript');
    const deadline = Date.now() + timeoutMs;
    try {
      await fs.promises.chmod(directory, 0o700);
      await fs.promises.writeFile(input, Buffer.from(attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1), 'base64'), {mode: 0o600, flag: 'wx'});
      phase = 'converting';
      await processFile(path.join(runtimeDir, 'ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error',
        '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn',
        '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', '-fs', String(MAX_PCM_BYTES + 65536),
        '-threads', '4', '-y', wav], directory, Math.min(deadline, Date.now() + 10 * 60 * 1000), '音频转换');
      const {durationSeconds} = await inspectPcm(wav);
      phase = 'transcribing';
      await processFile(path.join(runtimeDir, 'whisper-cli'), ['-m', path.join(runtimeDir, 'model.bin'), '-f', wav,
        '-l', 'auto', '-t', '4', '-osrt', '-of', prefix], directory, deadline, '本机转录');
      const resultFile = `${prefix}.srt`;
      let resultStat;
      try { resultStat = await fs.promises.stat(resultFile); }
      catch { throw errorOf('本机模型没有输出字幕文件，未生成部分结果', 'LOCAL_TRANSCRIPTION_INVALID'); }
      if (!resultStat.isFile() || resultStat.size > MAX_RESULT_BYTES) throw errorOf('本机转录文件过大或无效', 'LOCAL_TRANSCRIPTION_INVALID');
      const result = parseSrt(await fs.promises.readFile(resultFile, 'utf8'));
      if (result.segments.some(segment => segment.end > durationSeconds + 1)) throw errorOf('转录时间戳超出音频范围，未保存无效结果', 'LOCAL_TRANSCRIPTION_INVALID');
      return {...result, durationSeconds};
    } finally {
      phase = 'cleanup';
      try { await fs.promises.rm(directory, {recursive: true, force: true}); }
      finally { phase = 'idle'; }
    }
  }
  return Object.freeze({status, setPhase, run});
}

module.exports = {createLocalTranscriber, parseSrt, inspectPcm, MODEL, MAX_BYTES, MAX_SECONDS, TIMEOUT_MS};
