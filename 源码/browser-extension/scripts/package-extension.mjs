import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.dirname(extension), base = path.resolve(project, '../../..', '交付包');
const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
const name = `梦藏浏览器扩展-${manifest.version}`, destination = path.join(base, name), archive = path.join(base, `${name}.zip`);
const files = ['manifest.json', 'background.js', 'capture.js', 'screenshot.js', 'jobs.js', 'popup.html', 'popup.css', 'popup.js', 'content-highlights.js', 'highlights.css', 'native/clipper-host.cjs', 'scripts/install-native-host.mjs', '安装本机连接.command', 'README.md'];
const oldArchive = path.join(base, '梦藏浏览器扩展-0.1.0.zip');
const before = await fs.readFile(oldArchive).catch(() => null);
const destinations = [destination];
if (process.argv.slice(2).some(value => value !== '--update-loaded')) throw Error('仅支持 --update-loaded 选项');
if (process.argv.includes('--update-loaded')) destinations.push(path.join(base, '梦藏浏览器扩展-0.1.0'));
for (const target of destinations) {
  for (const relative of files) {const file = path.join(target, relative); await fs.mkdir(path.dirname(file), {recursive: true}); await fs.copyFile(path.join(extension, relative), file);}
  await fs.chmod(path.join(target, '安装本机连接.command'), 0o755);
}
await fs.rm(archive, {force: true});
const packed = spawnSync('/usr/bin/zip', ['-q', archive, ...files.map(file => `${name}/${file}`)], {cwd: base, encoding: 'utf8'});
if (packed.status !== 0) throw Error(packed.stderr || '扩展压缩失败');
const tested = spawnSync('/usr/bin/unzip', ['-tqq', archive], {encoding: 'utf8'});
if (tested.status !== 0) throw Error('扩展压缩包完整性检查失败');
if (before && !(await fs.readFile(oldArchive)).equals(before)) throw Error('旧版本 ZIP 意外发生变化');
console.log(JSON.stringify({version: manifest.version, runtimeFiles: files.length, zipBytes: (await fs.stat(archive)).size, loadedFolderUpdated: destinations.length === 2, oldZipPreserved: !!before}));
