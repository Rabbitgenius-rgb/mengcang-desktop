import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineFile = new URL('./lint-baseline.json', import.meta.url);
const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(['源码/prototypes/desktop-workbench/src/**/*.{js,jsx}']);
const counts = {};
for (const result of results) {
  for (const issue of result.messages) {
    const key = JSON.stringify([path.relative(root, result.filePath), issue.ruleId, issue.messageId || issue.message]);
    counts[key] = (counts[key] || 0) + 1;
  }
}
if (process.argv.includes('--update-baseline')) {
  if (results.some((result) => result.messages.some((issue) => issue.fatal))) throw Error('Parse errors cannot enter the lint baseline.');
  await fs.writeFile(baselineFile, JSON.stringify({ version: 1, counts }, null, 2) + '\n');
  console.log(`Recorded ${Object.values(counts).reduce((sum, value) => sum + value, 0)} existing hook warnings/errors.`);
} else {
  const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
  const additions = Object.entries(counts).filter(([key, count]) => count > (baseline.counts[key] || 0));
  console.log(`ESLint: ${Object.values(counts).reduce((sum, value) => sum + value, 0)} outstanding hook findings, ${additions.length} increased groups.`);
  if (
    (process.argv.includes('--strict') && Object.keys(counts).length) ||
    additions.length ||
    results.some((result) => result.messages.some((issue) => issue.fatal))
  ) {
    console.error(await (await eslint.loadFormatter('stylish')).format(results));
    process.exitCode = 1;
  }
}
