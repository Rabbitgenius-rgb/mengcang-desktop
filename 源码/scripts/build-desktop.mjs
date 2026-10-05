import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build as bundle } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root,'prototypes/desktop-workbench');
const build = spawnSync(process.execPath,[path.join(ui,'node_modules/vite/bin/vite.js'),'build','--configLoader','runner'],{cwd:ui,stdio:'inherit'});
if (build.status !== 0) process.exit(build.status || 1);
const target = path.join(root,'desktop/build/app');
await fs.rm(target,{recursive:true,force:true});
await fs.mkdir(target,{recursive:true});
for (const file of ['main.cjs','source-actions.cjs','discovery-state.cjs','mcp-bridge.cjs','mcp-library.cjs','mcp-workspace.cjs','preload.cjs','security.cjs','attachment-validation.cjs','ai-policy.cjs','intelligence.cjs','intelligence-bridge.cjs','local-transcription.cjs','renderer-quit.cjs','feed-capture.cjs','download-lifecycle.cjs','web-capture.cjs','public-dns.cjs','native-file-preview.cjs','html-parser.cjs','html-parser-LICENSE.txt','html-parser-entities-LICENSE.txt']) await fs.copyFile(path.join(root,'desktop',file),path.join(target,file));
await bundle({entryPoints:[path.join(root,'desktop/local-gateway.cjs')],outfile:path.join(target,'local-gateway.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22'});
const nativeBuild=spawnSync(process.execPath,[path.join(root,'scripts/build-discovery-helper.mjs')],{cwd:root,stdio:'inherit'});
if(nativeBuild.status!==0)process.exit(nativeBuild.status || 1);
await fs.copyFile(path.join(root,'desktop/discovery-helper'),path.join(target,'discovery-helper'));
await fs.copyFile(path.join(root,'desktop/discovery.cjs'),path.join(target,'discovery.cjs'));
await fs.copyFile(path.join(root,'scripts/mengcang-mcp.cjs'),path.join(target,'mengcang-mcp.cjs'));
// A single bundled stdio entrypoint works from app.asar.unpacked with ordinary
// Node. It does not depend on Node understanding Electron's ASAR filesystem.
await bundle({entryPoints:[path.join(root,'scripts/mengcang-desktop-mcp.cjs')],outfile:path.join(target,'mengcang-desktop-mcp.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22'});
await fs.cp(path.join(ui,'dist/client'),path.join(target,'renderer'),{recursive:true});
// Generated design boards are preview-only; desktop assets come from the Vault.
await fs.rm(path.join(target,'renderer/references'),{recursive:true,force:true});
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
await fs.writeFile(path.join(target,'package.json'),JSON.stringify({name:'mengcang-desktop',productName:'梦藏',version:pkg.version,main:'main.cjs',description:'本地创作与阅读空间',author:'Rabbit',private:true},null,2));
console.log('Desktop resources bundled; no web server is required.');
