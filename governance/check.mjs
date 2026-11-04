import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '源码');
const ui = path.join(source, 'prototypes/desktop-workbench');
const testFiles = async (directory) =>
  (await fs.readdir(directory))
    .filter((name) => /\.test\.(?:js|mjs|cjs)$/.test(name))
    .sort()
    .map((name) => path.join(directory, name));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const node = process.execPath;
run(node, [
  path.join(root, 'node_modules/prettier/bin/prettier.cjs'),
  '--check',
  '源码/prototypes/desktop-workbench/src',
  'governance',
  'eslint.config.mjs',
  'package.json',
]);
run(node, [path.join(root, 'governance/lint.mjs'), '--strict']);
const unit = await testFiles(path.join(ui, 'tests'));
const buildDependent = unit.filter((file) => file.endsWith('/sites-worker.test.mjs'));
run(node, ['--test', ...(await testFiles(path.join(source, 'tests'))), ...unit.filter((file) => !buildDependent.includes(file))]);
run('npm', ['run', 'desktop:build'], source);
run('npm', ['run', 'build'], ui);
run(node, ['--test', ...buildDependent]);
run(node, [path.join(root, 'governance/reachability.mjs')]);
run(node, [path.join(root, 'governance/structure.mjs')]);
run(node, [path.join(root, 'governance/size.mjs')]);
console.log('All governance checks passed.');
