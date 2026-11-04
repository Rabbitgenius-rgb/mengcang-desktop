import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] || path.resolve(root, '../应用/梦藏.app/Contents/Resources/local-transcription');
const target = path.join(root, 'desktop/local-transcription');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'runtime-manifest.json'), 'utf8'));
for (const [name, entry] of Object.entries(manifest.files)) {
  if (path.basename(name) !== name) throw Error('转录资源清单包含无效文件名');
  const bytes = await fs.readFile(path.join(source, name));
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`转录资源校验失败 ${name}`);
}
await fs.mkdir(target, {recursive: true});
for (const name of [...Object.keys(manifest.files), 'runtime-manifest.json']) await fs.copyFile(path.join(source, name), path.join(target, name));
for (const name of ['ffmpeg', 'whisper-cli']) await fs.chmod(path.join(target, name), 0o755);
console.log('转录资源已校验并准备完成');
