import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const HOST = 'com.rabbit.mengcang.clipper';
const EXTENSION = 'ebdbkhhcgifolblbcpkpgibjbighfhgi';
const origin = `chrome-extension://${EXTENSION}/`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const get = name => {const index = arguments_.indexOf(name); return index < 0 ? undefined : arguments_[index + 1];};
const known = new Set(['--dry-run', '--home', '--bridge-directory', '--browsers']);
for (let i = 0; i < arguments_.length; i++) {if (!known.has(arguments_[i])) throw Error(`未知选项：${arguments_[i]}`); if (arguments_[i] !== '--dry-run') {if (!arguments_[i + 1] || arguments_[i + 1].startsWith('--')) throw Error('选项缺少值'); i++;}}
if (process.platform !== 'darwin' && !get('--home')) throw Error('本安装脚本适用于 macOS。');
const home = path.resolve(get('--home') || os.homedir());
const hostDirectory = path.join(home, 'Library/Application Support/梦藏/Browser Extension Host');
const bridgeDirectory = path.resolve(get('--bridge-directory') || path.join(home, 'Library/Application Support/梦藏/browser-clipper'));
const browsers = (get('--browsers') || 'chrome,edge').split(',');
if (!browsers.length || browsers.some(value => !['chrome', 'edge'].includes(value)) || new Set(browsers).size !== browsers.length) throw Error('浏览器仅支持 chrome、edge。');
const locations = {chrome: 'Google/Chrome/NativeMessagingHosts', edge: 'Microsoft Edge/NativeMessagingHosts'};
const manifests = browsers.map(browser => path.join(home, 'Library/Application Support', locations[browser], `${HOST}.json`));
const hostSource = path.join(root, 'native/clipper-host.cjs');
await fs.access(hostSource);
const plan = {hostName: HOST, extensionId: EXTENSION, browsers, hostDirectory, bridgeDirectory, manifestFiles: manifests, runtime: process.execPath, dryRun: arguments_.includes('--dry-run')};
if (plan.dryRun) {console.log(JSON.stringify(plan, null, 2)); process.exit(0);}

const ownedFile = async file => {
  try {const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw Error('已有连接文件的所有者或类型不符合要求。'); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const file of manifests) {
  if (await ownedFile(file)) {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.name !== HOST || !Array.isArray(value.allowed_origins) || value.allowed_origins.length !== 1 || value.allowed_origins[0] !== origin) throw Error('已有同名连接属于其他扩展，未覆盖任何文件。');
  }
}
try {const stat = await fs.lstat(hostDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw Error('本机连接目录不可安全使用。');} catch (error) {if (error.code !== 'ENOENT') throw error;}
await fs.mkdir(hostDirectory, {recursive: true, mode: 0o700});
await fs.chmod(hostDirectory, 0o700);
for (const name of ['clipper-host.cjs', 'config.json', 'launch-host']) await ownedFile(path.join(hostDirectory, name));
const shell = value => `'${value.replace(/'/g, `'"'"'`)}'`;
const files = {
  'clipper-host.cjs': await fs.readFile(hostSource),
  'config.json': Buffer.from(JSON.stringify({bridgeDirectory}, null, 2)),
  'launch-host': Buffer.from(`#!/bin/sh\nexec ${shell(process.execPath)} ${shell(path.join(hostDirectory, 'clipper-host.cjs'))} "$@"\n`),
};
async function replace(file, bytes, mode) {
  if (await ownedFile(file)) await fs.copyFile(file, `${file}.backup-${stamp}`);
  const temporary = `${file}.install-${process.pid}`;
  const handle = await fs.open(temporary, 'wx', mode); try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
  await fs.rename(temporary, file); await fs.chmod(file, mode);
}
for (const [name, bytes] of Object.entries(files)) await replace(path.join(hostDirectory, name), bytes, name === 'launch-host' ? 0o700 : 0o600);
const manifest = Buffer.from(JSON.stringify({name: HOST, description: '梦藏浏览器收录本机连接', path: path.join(hostDirectory, 'launch-host'), type: 'stdio', allowed_origins: [origin]}, null, 2));
for (const filename of manifests) {await fs.mkdir(path.dirname(filename), {recursive: true, mode: 0o700}); await replace(filename, manifest, 0o600);}
console.log(`已安装梦藏本机连接（${browsers.join('、')}）。原有同名配置已留备份，其他扩展和个人资料未修改。`);
