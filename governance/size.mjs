import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const client = path.join(root, '源码/prototypes/desktop-workbench/dist/client');
const baselineFile = new URL('./size-baseline.json', import.meta.url);
const files = [];
async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(?:m?js|css)$/.test(entry.name)) files.push({ name: path.relative(client, file), bytes: (await fs.stat(file)).size });
  }
}
await visit(client);
const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
if (process.argv.includes('--update-baseline')) {
  await fs.writeFile(baselineFile, JSON.stringify({ version: 1, bytes, maxBytes: Math.ceil(bytes * 1.1), files }, null, 2) + '\n');
} else {
  const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
  console.log(`Built JS/CSS: ${bytes} bytes, budget ${baseline.maxBytes} bytes.`);
  if (bytes > baseline.maxBytes) throw Error('Build output exceeds the recorded 10% size budget.');
}
