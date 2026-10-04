import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'styles.css');
const marker = '\n/* MENGCANG_FUSION_STYLES */\n';
const current = fs.readFileSync(target, 'utf8');
const base = current.split(marker)[0].trimEnd();
const additions = fs.readFileSync(path.join(root, 'src/inspiration/fusion.css'), 'utf8').trimEnd();
const result = `${base}${marker}${additions}\n`;
if (current !== result) fs.writeFileSync(target, result);
