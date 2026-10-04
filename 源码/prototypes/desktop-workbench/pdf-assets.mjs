import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const folders=['cmaps','standard_fonts','wasm'];
export default function pdfAssets(){return {
 name:'local-pdf-assets',
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const match=/^\/pdf-assets\/(cmaps|standard_fonts|wasm)\/([A-Za-z0-9_.-]+)$/.exec((req.url||'').split('?')[0]);if(!match)return next();
  try{const data=await fs.readFile(path.join(root,match[1],match[2]));res.setHeader('Content-Type',match[2].endsWith('.wasm')?'application/wasm':match[2].endsWith('.js')?'text/javascript':'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end('PDF asset not found');}
 });},
 async generateBundle(){this.emitFile({type:'asset',fileName:'pdf-assets/LICENSE',source:await fs.readFile(path.join(root,'LICENSE'))});for(const folder of folders)for(const file of await fs.readdir(path.join(root,folder))){if(file.startsWith('.'))continue;const full=path.join(root,folder,file);if(!(await fs.stat(full)).isFile())continue;this.emitFile({type:'asset',fileName:`pdf-assets/${folder}/${file}`,source:await fs.readFile(full)});}},
};}
