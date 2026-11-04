import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '../源码/node_modules/@electron/packager/dist/index.js';
import { electronCache } from '../源码/scripts/electron-cache.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '源码');
const qa = path.join(root, 'qa');
const benchmark = process.argv.includes('--benchmark');
const recovery = process.argv.includes('--recovery-candidate');
const safety = process.argv.includes('--safety-candidate');
if (benchmark && process.argv.includes('--package')) throw Error('性能资料目录不能打包为候选版。');
if (benchmark) await fs.mkdir(path.join(qa, 'benchmark-runs'), { recursive: true });
const home = benchmark
  ? await fs.mkdtemp(path.join(qa, 'benchmark-runs/run-'))
  : safety
    ? path.join(qa, 'safety-candidate')
    : recovery
      ? path.join(qa, 'recovery-candidate')
      : qa;
const vault = path.join(home, benchmark ? 'vault' : 'candidate-vault');
const appDir = path.join(source, 'desktop/build/app');
await fs.mkdir(path.join(vault, '01_sources/cards/text'), { recursive: true });
if (benchmark)
  await fs.writeFile(path.join(vault, '01_sources/cards/text/source.md'), '---\ntype: material\ntitle: 治理验收来源\n---\n这是隔离验收资料。\n', {
    flag: 'wx',
  });
await fs.writeFile(
  path.join(appDir, 'candidate-config.json'),
  JSON.stringify({
    name: '梦藏治理候选',
    userDataPath: path.join(home, benchmark ? 'profile' : 'candidate-profile'),
    vaultPath: vault,
    recallBridgeDirectory: path.join(home, benchmark ? 'bridge' : 'candidate-bridge'),
    recallCompanionDirectory: path.join(home, benchmark ? 'companion' : 'candidate-companion'),
    acceptanceRunsRoot: path.join(qa, 'acceptance-runs'),
  }),
);
if (!process.argv.includes('--package')) {
  console.log(appDir);
} else {
  const version = JSON.parse(await fs.readFile(path.join(source, 'node_modules/electron/package.json'))).version;
  const out = path.join(qa, safety ? 'packages-safety' : recovery ? 'packages-recovery' : 'packages');
  const results = await packager({
    dir: appDir,
    out,
    name: '梦藏治理候选',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion: version,
    electronZipDir: await electronCache(version),
    appBundleId: 'com.rabbit.mengcang.governance',
    asar: { unpack: '{mengcang-mcp.cjs,mengcang-desktop-mcp.cjs,discovery-helper}' },
    extraResource: [path.join(source, 'desktop/local-transcription')],
    overwrite: true,
    prune: false,
  });
  const bundle = path.join(results[0], '梦藏治理候选.app');
  for (const args of [
    ['--force', '--deep', '--sign', '-', bundle],
    ['--verify', '--deep', '--strict', bundle],
  ]) {
    const result = spawnSync('/usr/bin/codesign', args, { stdio: 'inherit' });
    if (result.status !== 0) throw Error('候选版签名检查失败');
  }
  console.log(bundle);
}
