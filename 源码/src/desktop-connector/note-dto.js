'use strict';
// File-format adapter shared by the standalone app; no Obsidian runtime.
const {frontmatterOf,splitNote,hash}=require('./notes.js');
const asText=value=>value==null?'':String(value);
const asList=value=>Array.isArray(value)?value.map(asText).filter(Boolean):value?[asText(value)]:[];
const unwrapped=value=>asText(value).trim().replace(/^!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/,'$1');
const safeHttp=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
function toNote(file,markdown){
 const fields=frontmatterOf(markdown),body=splitNote(markdown).body,title=asText(fields.title||file.basename);
 const explorations=[...body.matchAll(/<!-- mengcang:exploration (\{[^\n]*\}) -->/g)].map(match=>{try{return JSON.parse(match[1]);}catch{return null;}}).filter(item=>item?.id&&typeof item.text==='string');
 const base={id:asText(fields.id||fields.material_id||file.path),path:file.path,title,hash:hash(markdown),fields,body,markdown,tags:asList(fields.tags),projectIds:asList(fields.project_ids||fields.project_id),description:asText(fields.caption??fields.summary??fields.description),explorations,searchText:[title,fields.caption,fields.summary,fields.description,...asList(fields.tags),body].map(asText).join(' ').toLocaleLowerCase('zh-CN')};
 if(fields.record_type==='inspiration')return {...base,kind:'entry',role:asText(fields.role||'seed'),roleStatus:asText(fields.role_status||'pending'),category:asText(fields.category||'inspiration'),summaryStatus:asText(fields.summary_status||'pending'),linkedPaths:asList(fields.link_notes),materialPaths:asList(fields.material_notes),sourceId:asText(fields.source_id),sourcePath:asText(fields.source_original_path),sourceChanged:fields.source_changed===true,servesProjectId:asText(fields.serves_project_id)};
 if(file.path.startsWith('01_sources/books/'))return {...base,kind:'book',author:asText(fields.author||fields.authors),coverPath:this.attachmentPath(fields.cover,file.path),originalPath:unwrapped(fields.source_file||fields.pdf),readingStatus:asText(fields.reading_status),pages:Number(fields.pages||fields.source_pages)||0,collection:asText(fields.collection),volume:Number(fields.volume)||0};
 const kind=file.path.startsWith('01_sources/cards/images/')?'image':file.path.startsWith('01_sources/cards/web/')?'web':'text';
 if(kind==='image'){
  const originalPath=this.attachmentPath(fields.original_file||fields.source_file,file.path);
  const imagePath=value=>{const resolved=this.attachmentPath(value,file.path);return /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i.test(resolved)?resolved:'';};
  const coverPath=imagePath(fields.cover);
  return {...base,kind,url:safeHttp(fields.source_url||fields.url),originalPath,coverPath,attachmentPath:coverPath||imagePath(originalPath)||imagePath(fields.snapshot_path)||imagePath(fields.capture_path)};
 }
 return {...base,kind,url:safeHttp(fields.source_url||fields.url),attachmentPath:this.attachmentPath(fields.original_file||fields.snapshot_path||fields.capture_path||fields.cover,file.path)};
}
module.exports={toNote};
