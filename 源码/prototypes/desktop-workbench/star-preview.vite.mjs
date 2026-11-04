// Explicit localhost-only review server. Private snapshot is outside public/,
// never imported by the application build and never written back to the Vault.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import pdfAssets from './pdf-assets.mjs';
const require=createRequire(import.meta.url);
const {LocalVaultGateway}=require('../../desktop/local-gateway.cjs');
const {PRODUCTION_VAULT}=require('../../desktop/security.cjs');
const root=path.dirname(fileURLToPath(import.meta.url));
const dataRoot=path.resolve(root,'../../verification/star-home-20261023/private-preview');
const gateway=new LocalVaultGateway({vaultPath:PRODUCTION_VAULT,cachePath:path.join(homedir(),'Library/Application Support/梦藏/vault-cache.json')});
let snapshot;
async function library(){
 if(!snapshot)snapshot=(async()=>{
  const raw=JSON.parse(await fs.readFile(path.join(dataRoot,'library.json'),'utf8'));
  const cards=await Promise.all(raw.cards.map(async card=>{
   let original={};
   if(card.sourceKind==='vault')try{const note=await gateway.readNote(card.id);original={originalPath:note.originalPath,originalMime:note.originalMime,originalName:note.originalName,originalAvailable:note.originalAvailable};}catch{/* Full saved snapshot is still available. */}
   const image=card.previewImage?'/__star-preview/'+card.previewImage:card.hasImage&&original.originalMime?.startsWith('image/')?'/__star-preview/image/'+encodeURIComponent(card.id):'';
   return {...card,...original,image,attachment:undefined,documentIndex:card.documentText?{text:card.documentText,pages:[],pageCount:0}:undefined,rawRead:undefined};
  }));
  return {...raw,cards};
 })();
 return snapshot;
}
export default defineConfig({
 server:{host:'127.0.0.1',port:4275,strictPort:true},
 plugins:[react(),pdfAssets(),{name:'star-private-review',apply:'serve',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
   const url=new URL(req.url,'http://127.0.0.1:4275');
   if(!url.pathname.startsWith('/__star-preview/'))return next();
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
   if(req.method!=='GET'||req.headers.host!=='127.0.0.1:4275'||req.headers.origin&&req.headers.origin!=='http://127.0.0.1:4275'||req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;return res.end();}
   try{
    if(url.pathname==='/__star-preview/library'){res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(await library()));}
    const picture=/^\/__star-preview\/images\/(preview-[1-3]\.png)$/.exec(url.pathname);
    if(picture){res.setHeader('Content-Type','image/png');return res.end(await fs.readFile(path.join(dataRoot,'images',picture[1])));}
    const route=/^\/__star-preview\/(book|image)\/(.+)$/.exec(url.pathname);
    if(!route){res.statusCode=404;return res.end();}
    const id=decodeURIComponent(route[2]),card=(await library()).cards.find(card=>card.id===id&&card.sourceKind==='vault');
    if(!card){res.statusCode=404;return res.end();}
    if(route[1]==='image'){
     const attachment=await gateway.readAttachment(id);
     if(!/^image\/(png|jpeg|webp|gif)$/.test(attachment.type))throw Error('此图片格式暂不可预览。');
     res.setHeader('Content-Type',attachment.type);return res.end(Buffer.from(attachment.dataUrl.split(',')[1],'base64'));
    }
    const source=await gateway.readingFile(id);
    if(source.size>64*1024*1024)throw Error('这份原书超过本地浏览器预览上限，请在梦藏中阅读。');
    const bytes=await fs.readFile(source.file);
    // Recheck the original association and version after reading.
    if((await gateway.readingFile(id)).sourceKey!==source.sourceKey)throw Error('原书已变化，请重新打开。');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({name:source.name,type:source.type,size:bytes.length,sourceKey:source.sourceKey,dataUrl:`data:${source.type};base64,${bytes.toString('base64')}`}));
   }catch(error){res.statusCode=422;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
  });
 }}],
});
