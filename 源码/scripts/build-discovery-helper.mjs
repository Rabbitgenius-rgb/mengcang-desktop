import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'desktop/DiscoveryHelper.swift');
const output = path.join(root, 'desktop/discovery-helper');
const digest = value => createHash('sha256').update(value).digest('hex');
const cacheDirectory = path.join(os.tmpdir(), 'mengcang-discovery-build');
const metadataFile = path.join(cacheDirectory, `${digest(root)}.json`);
const moduleCache = process.env.MENGCANG_SWIFT_CACHE || path.join(cacheDirectory, 'swift-modules');

function tool(command, args, label) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024});
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim();
    throw new Error(`${label}失败：${detail}`);
  }
  return result.stdout.trim();
}

async function build() {
  if (process.platform !== 'darwin') throw new Error('本机 OCR 与语义分析组件需要 macOS，当前系统无法编译 Apple 原生组件。');
  const sourceBytes = await fs.readFile(source);
  const compiler = tool('xcrun', ['--find', 'swiftc'], '查找 Swift 编译器');
  const compilerVersion = tool(compiler, ['--version'], '读取 Swift 工具链版本');
  const sdk = tool('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], '查找 macOS SDK');
  const sdkVersion = tool('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], '读取 macOS SDK 版本');
  const compilerStat = await fs.stat(compiler);
  const fingerprint = digest(JSON.stringify({version: 1, source: digest(sourceBytes), compiler, compilerVersion,
    compilerModified: compilerStat.mtimeMs, compilerSize: compilerStat.size, sdk, sdkVersion,
    architecture: process.arch, flags: ['-O', '-sdk']}));
  try {
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
    const binaryStat = await fs.lstat(output);
    if (metadata.version === 1 && metadata.fingerprint === fingerprint && binaryStat.isFile()
      && (binaryStat.mode & 0o111) && metadata.binaryHash === digest(await fs.readFile(output))) {
      console.log('[discovery-helper] 已复用匹配源码和 Swift 工具链的本机组件。');
      return;
    }
  } catch { /* Missing or stale cache requires a fresh compile. */ }

  await fs.mkdir(cacheDirectory, {recursive: true, mode: 0o700});
  await fs.mkdir(moduleCache, {recursive: true, mode: 0o700});
  // Compile beside the destination so the final rename is atomic, including
  // projects on external volumes. A failed compile leaves the old helper intact.
  const temporary = path.join(path.dirname(output), `.discovery-helper-${randomUUID()}.tmp`);
  try {
    console.log('[discovery-helper] 正在编译真实本机 OCR 与语义分析组件…');
    tool(compiler, ['-module-cache-path', moduleCache, '-sdk', sdk, '-O', source, '-o', temporary], '编译 DiscoveryHelper.swift');
    await fs.chmod(temporary, 0o755);
    const binaryHash = digest(await fs.readFile(temporary));
    await fs.rename(temporary, output);
    try {
      await fs.writeFile(metadataFile, JSON.stringify({version: 1, fingerprint, binaryHash}), {mode: 0o600});
    } catch (error) {
      console.warn(`[discovery-helper] 组件已编译成功，但构建缓存未保存，下次将重新编译：${error.message}`);
    }
    console.log('[discovery-helper] 编译完成；开发预览可使用本机 Apple Vision / NaturalLanguage。');
  } finally {
    await fs.rm(temporary, {force: true}).catch(() => {});
  }
}

build().catch(error => {
  console.error(`[discovery-helper] ${error.message}`);
  console.error('[discovery-helper] 原生组件构建未完成；predev 会中止本次新启动。请检查 Xcode Command Line Tools、macOS SDK 与目录写入权限后重试。');
  process.exitCode = 1;
});
