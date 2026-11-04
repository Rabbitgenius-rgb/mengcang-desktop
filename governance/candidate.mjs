import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '../源码/node_modules/@electron/packager/dist/index.js';
import { electronCache } from '../源码/scripts/electron-cache.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '源码');
const qa = path.join(root, 'qa');
const vault = path.join(qa, 'candidate-vault');
const appDir = path.join(source, 'desktop/build/app');
await fs.mkdir(path.join(vault, '01_sources/cards/text'), { recursive: true });
await fs.writeFile(path.join(vault, '01_sources/cards/text/source.md'), '---\ntype: material\ntitle: 治理验收来源\n---\n这是隔离验收资料。\n');
await fs.writeFile(
  path.join(appDir, 'candidate-config.json'),
  JSON.stringify({
    name: '梦藏治理候选',
    userDataPath: path.join(qa, process.argv.includes('--benchmark') ? 'benchmark-profile' : 'candidate-profile'),
    vaultPath: vault,
    recallBridgeDirectory: path.join(qa, 'candidate-bridge'),
    recallCompanionDirectory: path.join(qa, 'candidate-companion'),
  }),
);
if (!process.argv.includes('--package')) {
  console.log(appDir);
} else {
  const version = JSON.parse(await fs.readFile(path.join(source, 'node_modules/electron/package.json'))).version;
  const results = await packager({
    dir: appDir,
    out: path.join(qa, 'packages'),
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
