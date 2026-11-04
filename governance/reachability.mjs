import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const ui = path.join(root, '源码/prototypes/desktop-workbench');
const result = await build({
  absWorkingDir: ui,
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  write: false,
  metafile: true,
  outdir: 'dist/reachability',
  packages: 'external',
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.png': 'file', '.jpg': 'file', '.svg': 'file' },
  plugins: [
    {
      name: 'asset-queries',
      setup(builder) {
        builder.onResolve({ filter: /\?(?:worker|url)/ }, (args) => ({ path: args.path, external: true }));
      },
    },
  ],
});
const inputs = Object.keys(result.metafile.inputs).sort();
const legacy = inputs.filter((name) => /(?:^|\/)(?:App|DesktopApp|ScheduleView|Inspiration|DiscoveryView)\.(?:jsx|js)$/.test(name));
const output = path.join(root, '验收记录/governance-reachability.json');
await fs.writeFile(output, JSON.stringify({ entry: 'src/main.jsx', inputs, legacy }, null, 2) + '\n');
console.log(`Production entry reaches ${inputs.length} source files.`);
if (legacy.length && !process.argv.includes('--baseline')) throw Error(`Legacy entry remains reachable: ${legacy.join(', ')}`);
