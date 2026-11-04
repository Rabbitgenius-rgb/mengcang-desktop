'use strict';

// Private source contents are read only at runtime and written only to the selected
// Vault or an explicitly selected local plan bundle. Never embed them in this file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeRelationId, upsertManagedRelation, parseManagedRelations } = require('../../star-sea/core');

const SCHEMA = 'mengcang.desktop-migration.v1';
const INDEX = '_meta/mengcang-preview-migration-v1.json';
const REGISTRY = '_meta/projects.json';
const ORIGINALS = '01_sources/_originals/mengcang-preview';
const ENTRY_DIR = '01_sources/cards/text/灵感';
const IMAGE_DIR = '01_sources/cards/images';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fileHash = file => fs.existsSync(file) ? sha(fs.readFileSync(file)) : null;
const uniq = array => [...new Set(array)];
const error = (code, message) => Object.assign(new Error(message), { code });

function within(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..') || relative.includes('\0')) throw error('UNSAFE_PATH', 'Unsafe relative Vault path');
  const full = path.resolve(root, relative);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw error('UNSAFE_PATH', 'Path escapes selected Vault');
  let cursor = full;
  while (cursor !== path.resolve(root)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw error('SYMLINK_PATH', 'Migration does not traverse symlinks');
    cursor = path.dirname(cursor);
  }
  return full;
}

function filesBelow(root, relative) {
  const full = within(root, relative);
  if (!fs.existsSync(full)) return [];
  const result = [];
  for (const item of fs.readdirSync(full, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const child = `${relative}/${item.name}`;
    if (item.isDirectory()) result.push(...filesBelow(root, child));
    else if (item.isFile() && item.name.endsWith('.md')) result.push(child);
  }
  return result;
}

// Used only for identity lookup; this never rewrites existing YAML. Generated
// frontmatter uses one JSON value per YAML key, supported by Obsidian.
function identityFields(markdown) {
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] || '';
  const fields = {};
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!m || !m[2]) continue;
    try { fields[m[1]] = JSON.parse(m[2]); }
    catch { fields[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/\s+#.*$/, ''); }
  }
  return fields;
}
function markdown(fields, body) {
  return `---\n${Object.entries(fields).filter(([,v]) => v !== undefined).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n${body.trim()}\n`;
}
function safeId(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 90) || sha(String(value)).slice(0,16); }
function wiki(target, title) { return `[[${target.replace(/\.md$/i, '').replace(/\]/g, '］')}${title ? `|${title.replace(/[\r\n|\]]/g, ' ')}` : ''}]]`; }
function curationText(entry, sources) {
  const source = sources.find(s => s.id === entry.sourceId);
  if (!source || !Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 || entry.end > source.text.length || entry.end <= entry.start) throw error('INVALID_RANGE', `Invalid range for ${entry.id}`);
  let cursor = entry.start; let result = '';
  for (const r of [...(entry.excludedRanges || []), ...(entry.linkExcerptRanges || [])].sort((a,b) => a.start-b.start)) {
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < entry.start || r.end > entry.end || r.end <= r.start) throw error('INVALID_RANGE', `Invalid excluded range for ${entry.id}`);
    if (r.start > cursor) result += source.text.slice(cursor, r.start);
    cursor = Math.max(cursor, r.end);
  }
  return (result + source.text.slice(cursor,entry.end)).replaceAll('\uFFFC','').replace(/\n{3,}/g,'\n\n').trim();
}
function parsePurposes(source) {
  // The small checked-in decision file is data, not code to execute.
  const block = name => new RegExp(`export const ${name} = ([\\s\\S]*?);`).exec(source)?.[1];
  const roles = {}; const serving = {};
  for (const m of (block('statedPurposes') || '').matchAll(/['"]([\w-]+)['"]\s*:\s*['"](seed|material)['"]/g)) roles[m[1]]=m[2];
  const projectIds = [...(block('statedProjectIds') || '').matchAll(/['"]([\w-]+)['"]/g)].map(m=>m[1]);
  for (const m of (block('statedServes') || '').replace(/\/\/[^\n]*/g,'').matchAll(/['"]([\w-]+)['"]\s*:\s*['"]([\w-]+)['"]/g)) serving[m[1]]=m[2];
  return { roles, projectIds, serving };
}

function createPlan(options) {
  const vault = fs.realpathSync(options.vault);
  const preview = fs.realpathSync(options.preview);
  const bundle = path.resolve(options.out);
  if (bundle === vault || bundle.startsWith(vault + path.sep)) throw error('UNSAFE_BUNDLE', 'Plan bundle must be outside the Vault');
  if (fs.existsSync(path.join(bundle, 'plan.json'))) throw error('PLAN_BUNDLE_EXISTS', 'Use a new plan bundle; existing plans and backups are immutable');
  fs.mkdirSync(path.join(bundle,'payloads'), { recursive:true, mode:0o700 });
  const inputs=[]; const operations=new Map(); const mappings={ sources:[], entries:[], materials:[], links:[], snapshots:[], projects:[], relations:[] }; const conflicts=[]; const warnings=[];
  const load = file => { const content=fs.readFileSync(file); inputs.push({path:fs.realpathSync(file),hash:sha(content),bytes:content.length}); return content; };
  const sourceData=JSON.parse(load(path.join(preview,'inspiration-sources.json')));
  const state=JSON.parse(load(path.join(preview,'inspiration-preview.json')));
  const captures=JSON.parse(load(path.join(preview,'link-captures.json')));
  const purposeFile=options.purposes || path.join(path.dirname(preview),'src/inspirationPurposes.js');
  const decisions=parsePurposes(load(purposeFile).toString('utf8'));
  const recovered = {status:'unavailable',message:'磁盘副本与代码中的明确决定已保留；旧预览仅存浏览器内存的临时调整未取得可验证导出，未推断恢复。'};
  if(options.browserExport) {
    const exp=JSON.parse(load(options.browserExport));
    if (exp.schema !== 'mengcang.preview-state-export.v1' || !exp.state || !exp.exportedAt || !exp.basePreviewHash || exp.basePreviewHash !== inputs.find(i=>i.path.endsWith('inspiration-preview.json')).hash) throw error('INVALID_BROWSER_EXPORT','Browser export must name the exact preview base');
    for(const key of ['entries','materials','links','relations']) if(Array.isArray(exp.state[key])) state[key]=exp.state[key];
    recovered.status='exported'; recovered.message='已合并具备原始副本哈希与导出时间的预览调整。'; recovered.exportedAt=exp.exportedAt;
  }
  const originals=sourceData.sources;
  if(!Array.isArray(originals)||!Array.isArray(state.entries)||!Array.isArray(state.materials)||!Array.isArray(state.links)||!Array.isArray(state.relations)) throw error('INVALID_INPUT','Invalid source or preview data');
  for(const source of state.sources) {
    const original=originals.find(s=>s.id===source.id);
    if(!original || original.text!==source.text) throw error('SOURCE_MISMATCH',`Source and preview differ: ${source.id}`);
  }
  const idSet=(items,label) => {const set=new Set(); for(const item of items) {if(!item.id||set.has(item.id))throw error('DUPLICATE_ID',`Duplicate/missing ${label} identity`);set.add(item.id);}return set;};
  idSet(originals,'source');
  if(new Set(originals.map(s=>s.nativeId)).size!==originals.length)throw error('DUPLICATE_NATIVE_ID','Source native identities must be unique');
  for(const relation of state.relations)if(!['pending','confirmed','dismissed'].includes(relation.status))throw error('INVALID_RELATION_STATUS','Unknown relation status');
  idSet(state.entries,'entry');idSet(state.materials,'material');idSet(state.links,'link');idSet(state.relations,'relation');
  const priorFile=within(vault,INDEX);const prior=fs.existsSync(priorFile)?readJSON(priorFile):null;
  if(prior&&prior.schema!==SCHEMA)throw error('MIGRATION_INDEX_INVALID','Unrecognized existing migration index');
  const registryPath=within(vault,REGISTRY);const registry=fs.existsSync(registryPath)?readJSON(registryPath):{schema:'personal_ai_os.project_registry.v1',projects:[]};
  if(!Array.isArray(registry.projects))throw error('INVALID_REGISTRY','Project registry needs a projects array');
  const notes=[];
  for(const base of ['01_sources/cards/text','01_sources/cards/images','01_sources/cards/web','03_projects']) for(const rel of filesBelow(vault,base)) {
    const content=fs.readFileSync(within(vault,rel),'utf8');notes.push({path:rel,fields:identityFields(content),hash:sha(content),content});
  }
  function existing(predicate,identity) {
    const matches=notes.filter(predicate);
    if(matches.length>1) {conflicts.push({kind:'duplicate-identity',identity,paths:matches.map(n=>n.path)});return null;}
    return matches[0]||null;
  }
  function output(relative,content,kind,identity,{preserve=false}={}) {
    const target=within(vault,relative);const before=fileHash(target); const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);const after=sha(bytes);
    const old=operations.get(relative);
    if(old && old.afterHash!==after) throw error('OUTPUT_COLLISION',`Two planned outputs disagree: ${relative}`);
    const action=preserve && before ? 'reuse' : before===after ? 'reuse' : before===null?'create':'update';
    if(action==='update' && kind==='original') conflicts.push({kind:'immutable-original-conflict',path:relative});
    const payloadHash=preserve && before ? before:after;
    const payload=preserve && before ? fs.readFileSync(target):bytes;
    fs.writeFileSync(path.join(bundle,'payloads',payloadHash),payload,{mode:0o600});
    const op={path:relative,kind,identity,action,beforeHash:before,afterHash:payloadHash,bytes:payload.length,payload:`payloads/${payloadHash}`};
    operations.set(relative,op);return op;
  }
  function reference(relative,kind,identity) {
    const file=within(vault,relative);
    if(!fs.existsSync(file)) {conflicts.push({kind:'missing-reference',path:relative,identity});return null;}
    return output(relative,fs.readFileSync(file),kind,identity,{preserve:true});
  }
  // Keep the exact disk inputs and purpose decisions immutable, separate from cards.
  for(const input of [...inputs]) {
    const ext=path.extname(input.path) || '.bin';
    output(`${ORIGINALS}/inputs/${path.basename(input.path,ext)}-${input.hash.slice(0,16)}${ext}`,fs.readFileSync(input.path),'original',`input:${input.hash}`);
  }
  const sourceById=new Map();
  for(const source of originals) {
    if(!source.nativeId)throw error('SOURCE_ID_MISSING',`Native source identity missing: ${source.id}`);
    const identity=sha(source.nativeId).slice(0,20);const revision=sha(json(source)).slice(0,16);const base=`${ORIGINALS}/notes/${identity}/${revision}`;
    const paths={json:`${base}.json`,text:`${base}.txt`,html:`${base}.html`};
    output(paths.json,json(source),'original',`source:${identity}`);
    output(paths.text,source.text,'original',`source-text:${identity}`);
    output(paths.html,source.html || '', 'original',`source-html:${identity}`);
    const map={id:source.id,nativeId:source.nativeId,identity,revision,paths,hash:sha(source.text),createdAt:source.createdAt,updatedAt:source.updatedAt};
    mappings.sources.push(map);sourceById.set(source.id,map);
  }
  const attachmentMaps=new Map();
  for(const source of originals)for(const attachment of source.attachments||[]) {
    const local=attachment.url?.replace(/^\/__local\//,'');
    if(!local||local===attachment.url)throw error('INVALID_ASSET_PATH',`Unrecognized attachment path: ${attachment.id}`);
    const content=load(within(preview,local));const hash=sha(content);
    if(attachment.sha256 && attachment.sha256!==hash)throw error('ASSET_CHANGED',`Attachment does not match its recorded hash: ${attachment.id}`);
    const relative=`${ORIGINALS}/images/${safeId(attachment.id)}-${hash.slice(0,16)}${path.extname(local)}`;
    output(relative,content,'original',`attachment:${source.nativeId}:${attachment.id}`);
    attachmentMaps.set(`${source.id}:${attachment.id}`,{path:relative,hash,attachment});
  }
  // Reuse explicit previously created note paths. A quotation's unverified video
  // link is kept in provenance mapping, never promoted into its source_url.
  for(const link of state.links) {
    if(link.materialNotePath&&!/^01_sources\/cards\/(?:web|text)\/.+\.md$/.test(link.materialNotePath))throw error('UNSAFE_LINK_NOTE','Link note must be an existing material Markdown note');
    if(!link.materialNotePath) {conflicts.push({kind:'missing-link-note-mapping',id:link.id});continue;}
    const knownNote=notes.find(n=>n.path===link.materialNotePath);
    if(knownNote?.fields.source_url&&knownNote.fields.source_url!==link.url)conflicts.push({kind:'link-source-mismatch',id:link.id,path:link.materialNotePath});
    const item=reference(link.materialNotePath,'link',link.id);
    mappings.links.push({id:link.id,path:link.materialNotePath,url:link.url,sourceId:link.sourceId,start:link.start,end:link.end,status:item?'reuse':'conflict'});
  }
  for(const [id,capture] of Object.entries(captures)) {
    const local=capture.snapshotUrl?.replace(/^\/__local\//,'');
    if(!local || local===capture.snapshotUrl)throw error('INVALID_SNAPSHOT_PATH',`Unrecognized snapshot path: ${id}`);
    const content=load(within(preview,local)); const hash=sha(content);
    if(capture.providedImageSha256 && capture.providedImageSha256!==hash)throw error('SNAPSHOT_CHANGED',`Snapshot does not match its recorded hash: ${id}`);
    const link=state.links.find(l=>l.url===capture.url);const note=notes.find(n=>n.path===link?.materialNotePath);
    let original=note?.fields.original_file;
    if(original&&fileHash(within(vault,original))===hash) reference(original,'original',`snapshot:${id}`);
    else {original=`${ORIGINALS}/snapshots/${safeId(id)}-${hash.slice(0,16)}${path.extname(local)}`;output(original,content,'original',`snapshot:${id}`);}
    const map={id,url:capture.url,path:original,hash,status:capture.captureStatus,source:capture.snapshotSource||'capture',capturedAt:capture.capturedAt,linkId:link?.id||null,notePath:link?.materialNotePath||null,associated:!!link,validContent:capture.captureStatus==='ready'};
    mappings.snapshots.push(map);
    if(!link) warnings.push({kind:'unassociated-snapshot',id,path:original,message:'保留缓存出处；没有创建素材笔记。'});
  }
  const materialById=new Map();
  for(const material of state.materials) {
    if(material.origin!=='note')throw error('UNSUPPORTED_SUPPLEMENT_ASSET',`Supplement needs explicit asset export: ${material.id}`);
    const asset=attachmentMaps.get(`${material.sourceId}:${material.attachmentId}`);const source=sourceById.get(material.sourceId);
    if(!asset||!source)throw error('MATERIAL_ASSET_MISSING',`Missing material source: ${material.id}`);
    const stableId=`image-${sha(`${source.nativeId}\0${material.attachmentId}`).slice(0,24)}`;
    const priorMap=prior?.mappings.materials.find(m=>m.id===material.id);
    const match=existing(n=>n.fields.id===stableId || n.fields.legacy_material_id===material.id || (n.fields.source_native_id===source.nativeId&&n.fields.source_attachment_id===material.attachmentId),material.id);
    const relative=match?.path||priorMap?.path||`${IMAGE_DIR}/mengcang-${stableId}.md`;
    if(priorMap&&!match)conflicts.push({kind:'existing-material-identity-changed',id:material.id,path:relative});
    if(fs.existsSync(within(vault,relative))&&!match)conflicts.push({kind:'material-path-collision',id:material.id,path:relative});
    const content=markdown({id:stableId,type:'material',record_type:'image_reference',status:'inbox',title:material.title||asset.attachment.name,caption:material.description||'',origin:'apple-notes',rights:'unknown',tags:[],original_file:asset.path,cover:`[[${asset.path}]]`,image_sha256:asset.hash,legacy_material_id:material.id,source_native_id:source.nativeId,source_id:material.sourceId,source_attachment_id:material.attachmentId,source_original_path:source.paths.text,source_position:asset.attachment.offset,original_filename:asset.attachment.name,captured_at:sourceData.capturedAt},`# ${material.title||asset.attachment.name}\n\n## 资料\n\n!${wiki(asset.path)}\n\n${material.description||''}\n\n## 出处\n\n${wiki(source.paths.text,'原始记录')} · 原位置 ${asset.attachment.offset}`);
    const item=output(relative,content,'material',material.id,{preserve:!!match});
    mappings.materials.push({id:material.id,noteId:stableId,path:relative,attachmentId:material.attachmentId,originalPath:asset.path,hash:asset.hash,status:item.action});materialById.set(material.id,relative);
  }
  const entryPaths=new Map();const entryMatches=new Map();
  for(const entry of state.entries) {
    const priorMap=prior?.mappings.entries.find(e=>e.id===entry.id);const stableId=`inspiration-${entry.id}`;
    const match=existing(n=>n.fields.id===stableId || n.fields.legacy_entry_id===entry.id,entry.id);
    const relative=match?.path||priorMap?.path||`${ENTRY_DIR}/mengcang-${safeId(entry.id)}.md`;
    if(priorMap&&!match)conflicts.push({kind:'existing-entry-identity-changed',id:entry.id,path:relative});
    if(fs.existsSync(within(vault,relative))&&!match)conflicts.push({kind:'entry-path-collision',id:entry.id,path:relative});
    entryPaths.set(entry.id,relative);entryMatches.set(entry.id,match);
  }
  const linkById=new Map(mappings.links.map(l=>[l.id,l.path]));
  for(const entry of state.entries) {
    const source=sourceById.get(entry.sourceId);if(!source)throw error('SOURCE_MISSING',`Missing source: ${entry.id}`);
    const confirmedRole=(recovered.status==='exported'&&entry.roleStatus==='confirmed'?entry.role:null) || decisions.roles[entry.id] || (entry.roleStatus==='confirmed'?entry.role:null);
    const role=confirmedRole || entry.role || 'seed';
    if(!['seed','material'].includes(role))throw error('INVALID_ROLE',`Invalid purpose: ${entry.id}`);
    const materialPaths=(entry.materialIds||[]).map(id=>{if(!materialById.has(id))throw error('MATERIAL_REFERENCE_MISSING',id);return materialById.get(id);});
    const linkPaths=(entry.linkIds||[]).map(id=>{if(!linkById.has(id))throw error('LINK_REFERENCE_MISSING',id);return linkById.get(id);});
    const candidates=state.relations.filter(r=>r.status==='pending'&&(r.a===entry.id||r.b===entry.id)).map(r=>({id:`preview-${r.id}`,target_path:entryPaths.get(r.a===entry.id?r.b:r.a),reason:r.reason,status:'pending',origin:'preview'}));
    if(candidates.some(c=>!c.target_path))throw error('RELATION_ENDPOINT_MISSING','Pending relation endpoint missing');
    let body=`# ${entry.title}\n\n## 灵感内容\n\n${curationText(entry,originals)}\n\n## 整理说明\n\n${entry.summary||''}`;
    if(entry.question) body+=`\n\n## 继续探索\n\n${entry.question}\n`;
    for(const [index,supplement] of (entry.supplements||[]).entries()) {
      const value=supplement.text||supplement.content||'';
      if(value) {const record={id:supplement.id||`import-${entry.id}-${index}`,kind:supplement.kind||'补充',text:value,createdAt:supplement.createdAt||null};body+=`\n<!-- mengcang:exploration ${JSON.stringify(record).replace(/-->/g,'--&gt;')} -->\n\n${value}\n`;}
    }
    if(materialPaths.length)body+=`\n\n## 相关素材\n\n${materialPaths.map(p=>`- ${wiki(p)}`).join('\n')}`;
    if(linkPaths.length)body+=`\n\n## 链接收藏\n\n${linkPaths.map(p=>`- ${wiki(p)}`).join('\n')}`;
    body+=`\n\n## 原始出处\n\n${wiki(source.paths.text,'原始备忘录')} · 字符位置 ${entry.start}–${entry.end}`;
    const projectId=decisions.projectIds.includes(entry.id)?`project-${entry.id}`:null;
    if(projectId)body+=`\n\n## 项目\n\n${wiki(registry.projects.find(p=>p.id===projectId)?.vault_brief||`03_projects/mengcang-${safeId(projectId)}.md`)}`;
    const fields={id:`inspiration-${entry.id}`,type:'material',record_type:'inspiration',status:'inbox',title:entry.title,caption:entry.caption||'',summary:entry.summary||'',summary_status:entry.summaryStatus==='confirmed'?'confirmed':'pending',role,role_status:confirmedRole?'confirmed':'pending',category:entry.category||'inspiration',tags:entry.tags||[],project_ids:projectId?[projectId]:[],serves_project_id:decisions.serving[entry.id]||entry.servesProjectId||'',origin:'apple-notes',rights:'unknown',legacy_entry_id:entry.id,source_id:entry.sourceId,source_native_id:source.nativeId,source_original_path:source.paths.text,source_json_path:source.paths.json,source_start:entry.start,source_end:entry.end,source_updated:source.updatedAt,source_revision:source.revision,source_changed:false,provenance:entry.kind==='fragment'?'fragment':'note',boundary:entry.boundary==='confirmed'?'confirmed':'pending',material_notes:materialPaths,link_notes:linkPaths,relation_candidates:candidates,created_at:entry.kind==='note'?source.createdAt:null,captured_at:sourceData.capturedAt};
    const relative=entryPaths.get(entry.id);let content=markdown(fields,body);
    const match=entryMatches.get(entry.id);if(match) content=match.content;
    for(const relation of state.relations.filter(r=>r.status==='confirmed'&&(r.a===entry.id||r.b===entry.id))) {
      const sourcePath=entryPaths.get(relation.a);const targetPath=entryPaths.get(relation.b);
      if(!sourcePath||!targetPath)throw error('RELATION_ENDPOINT_MISSING','Confirmed relation endpoint missing');
      const complete={id:makeRelationId(sourcePath,targetPath),sourcePath,targetPath,sourceTitle:state.entries.find(e=>e.id===relation.a).title,targetTitle:state.entries.find(e=>e.id===relation.b).title,summary:relation.reason,origin:'preview-confirmed',confirmedAt:relation.confirmedAt||''};
      // Repeat migrations must not restore a relationship explicitly revoked later.
      if(!prior)content=upsertManagedRelation(content,complete,relative);
    }
    const item=output(relative,content,'entry',entry.id,{preserve:!!prior&&!!match});
    mappings.entries.push({id:entry.id,path:relative,sourceId:entry.sourceId,role,roleStatus:confirmedRole?'confirmed':'pending',summaryStatus:fields.summary_status,status:item.action});
  }
  for(const relation of state.relations) mappings.relations.push({id:relation.id,relationId:makeRelationId(entryPaths.get(relation.a),entryPaths.get(relation.b)),sourcePath:entryPaths.get(relation.a),targetPath:entryPaths.get(relation.b),status:relation.status,reason:relation.reason});
  let registryChanged=false;
  for(const entryId of decisions.projectIds) {
    const entry=state.entries.find(e=>e.id===entryId);if(!entry)throw error('PROJECT_SOURCE_MISSING',`Project source missing: ${entryId}`);
    const id=`project-${entryId}`;const matches=registry.projects.filter(p=>p.id===id);
    if(matches.length>1) {conflicts.push({kind:'duplicate-project',id});continue;}
    const current=matches[0];const relative=current?.vault_brief||`03_projects/mengcang-${safeId(id)}.md`;
    if(!/^03_projects\/.+\.md$/.test(relative))throw error('UNSAFE_PROJECT_PATH','Project notes must stay in 03_projects');
    const content=markdown({id,type:'project',title:entry.title,project_id:id,state_authority:'project-brief',goal:'',source_entry_id:entryId,source_note:entryPaths.get(entryId)},`# ${entry.title}\n\n## 目标\n\n\n## 起点来自灵感\n\n${wiki(entryPaths.get(entryId),entry.title)}\n\n## 相关来源\n\n${wiki(sourceById.get(entry.sourceId).paths.text,'原始备忘录')}`);
    const exists=fs.existsSync(within(vault,relative));
    if(exists&&!current&&identityFields(fs.readFileSync(within(vault,relative),'utf8')).id!==id)conflicts.push({kind:'project-path-collision',id,path:relative});
    const item=output(relative,content,'project',id,{preserve:exists});
    if(!current){registry.projects.push({id,name:entry.title,vault_brief:relative,source_entry_id:entryId,source_notes:[entryPaths.get(entryId)],goal:'',proactivity:'disabled',memory_scope:'project-private'});registryChanged=true;}
    mappings.projects.push({id,path:relative,sourceEntryId:entryId,sourcePath:entryPaths.get(entryId),status:item.action});
  }
  if(registryChanged)output(REGISTRY,json(registry),'registry','projects');else if(fs.existsSync(registryPath))reference(REGISTRY,'registry','projects');
  const inputsDigest=sha(json(inputs.map(i=>({path:i.path,hash:i.hash})).sort((a,b)=>a.path.localeCompare(b.path))));
  if(prior&&prior.inputsDigest!==inputsDigest)conflicts.push({kind:'input-changed-since-migration',message:'来源或已确认决定已变化；请单独规划增量迁移，不覆盖已整理笔记。'});
  const counts={sources:originals.length,entries:state.entries.length,images:state.materials.length,links:state.links.length,confirmedRelations:state.relations.filter(r=>r.status==='confirmed').length,pendingRelations:state.relations.filter(r=>r.status==='pending').length,confirmedPurposes:Object.keys(decisions.roles).length,projects:decisions.projectIds.length,snapshots:Object.keys(captures).length,unassociatedSnapshots:mappings.snapshots.filter(s=>!s.associated).length};
  const index={schema:SCHEMA,inputsDigest,importedAt:prior?.importedAt||new Date().toISOString(),counts,mappings,previewRecovery:recovered};
  output(INDEX,json(prior||index),'migration-index',SCHEMA,{preserve:!!prior});
  const logPath=within(vault,'log.md');const oldLog=fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8'):'';const marker='<!-- mengcang-preview-migration:v1 -->';
  const log=oldLog.includes(marker)?oldLog:`${oldLog.trimEnd()}\n\n${marker}\n\n## 梦藏旧预览迁移\n\n- ${counts.sources} 份来源、${counts.entries} 个词条、${counts.images} 张附图、${counts.links} 条链接映射；既有素材笔记复用。\n- 关系状态保留为 ${counts.confirmedRelations} 条已确认、${counts.pendingRelations} 条待确认；${counts.confirmedPurposes} 项明确用途与 ${counts.projects} 个项目入口。\n- 原始副本及逐项映射见 ${wiki(INDEX, '迁移索引')}。未核实的临时预览调整未推断恢复。\n`;
  output('log.md',log,'log','migration-log',{preserve:!!prior});
  const plan={schema:SCHEMA,createdAt:new Date().toISOString(),vault,preview,inputs,inputsDigest,counts,mappings,previewRecovery:recovered,warnings,conflicts,operations:[...operations.values()]};
  plan.planHash=sha(json(plan));
  fs.writeFileSync(path.join(bundle,'plan.json'),json(plan),{mode:0o600});
  fs.writeFileSync(path.join(bundle,'report.md'),renderReport(plan),{mode:0o600});
  return plan;
}

function renderReport(plan) {
  const counts={};for(const op of plan.operations)counts[op.action]=(counts[op.action]||0)+1;
  let result=`# 梦藏旧预览迁移清单\n\n计划哈希：${plan.planHash}\n\n${JSON.stringify(plan.counts)}\n\n文件操作：新增 ${counts.create||0}，复用 ${counts.reuse||0}，更新 ${counts.update||0}。\n\n${plan.previewRecovery.message}\n\n`;
  result+='## 逐项映射\n\n| 类型 | 稳定标识 | 目标文件 | 操作 |\n| --- | --- | --- | --- |\n';
  for(const op of plan.operations)result+=`| ${op.kind} | ${op.identity.replace(/\|/g,'\\|')} | ${op.path.replace(/\|/g,'\\|')} | ${op.action} |\n`;
  result+='\n## 关系状态\n\n';for(const r of plan.mappings.relations)result+=`- ${r.id}：${r.status}；${r.sourcePath} ↔ ${r.targetPath}\n`;
  result+='\n## 快照\n\n';for(const s of plan.mappings.snapshots)result+=`- ${s.id}：${s.status}，${s.associated?'已关联':'未关联，不建立素材'}，${s.validContent?'内容快照':'仅访问状态快照'}。\n`;
  result+='\n## 冲突\n\n'+(plan.conflicts.length?plan.conflicts.map(c=>`- ${JSON.stringify(c)}`).join('\n'):'无。')+'\n';return result;
}

function loadPlan(bundle) {
  const plan=readJSON(path.join(bundle,'plan.json'));const expected=plan.planHash;const clone={...plan};delete clone.planHash;
  if(plan.schema!==SCHEMA||sha(json(clone))!==expected)throw error('PLAN_CHANGED','Plan changed after review');
  return plan;
}
function checkInputs(plan) { for(const input of plan.inputs)if(fileHash(input.path)!==input.hash)throw error('INPUT_CHANGED',`Source changed since plan: ${path.basename(input.path)}`); }
function atomicWrite(file,buffer,expected) {
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=path.join(path.dirname(file),`.mengcang-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp,buffer,{flag:'wx',mode:0o600});
  try {if(fileHash(file)!==expected)throw error('CONCURRENT_CHANGE',`File changed before write: ${file}`);fs.renameSync(temp,file);}finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function withLock(bundle,action) {
  const lock=path.join(path.resolve(bundle),'operation.lock');let fd;
  try {fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,`${process.pid}\n`);}catch(e){if(e.code==='EEXIST')throw error('MIGRATION_BUSY','Another migration or restore holds this bundle; inspect before retrying');throw e;}
  try{return action();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function applyPlan(options) {return withLock(options.bundle,()=>applyPlanUnlocked(options));}
function applyPlanUnlocked({bundle,vault,failAfter}) {
  bundle=path.resolve(bundle);const plan=loadPlan(bundle);const actual=fs.realpathSync(vault);
  if(actual!==plan.vault)throw error('WRONG_VAULT','Plan belongs to a different Vault');
  if(plan.conflicts.length)throw error('PLAN_CONFLICT','Resolve planned conflicts before applying');
  checkInputs(plan);
  const backupDir=path.join(bundle,'backup');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const backupPath=path.join(backupDir,'manifest.json');let backup=fs.existsSync(backupPath)?readJSON(backupPath):{schema:SCHEMA,planHash:plan.planHash,vault:actual,files:[],status:'prepared'};
  if(backup.planHash!==plan.planHash||backup.vault!==actual||backup.status==='restored')throw error('BACKUP_MISMATCH','Backup does not belong to this active plan');
  // Validate all targets before any mutation, including reused notes and snapshots.
  for(const op of plan.operations) {
    const current=fileHash(within(actual,op.path));
    if(current!==op.beforeHash&&current!==op.afterHash)throw error('TARGET_CHANGED',`Target changed since plan: ${op.path}`);
    const payload=fs.readFileSync(within(bundle,op.payload));if(sha(payload)!==op.afterHash)throw error('PAYLOAD_CHANGED',`Planned payload changed: ${op.path}`);
  }
  for(const op of plan.operations.filter(o=>o.action!=='reuse'))if(!backup.files.some(f=>f.path===op.path)) {
    const current=fileHash(within(actual,op.path));
    if(current===op.afterHash && current!==op.beforeHash)throw error('UNTRACKED_WRITE',`Target matches output without a backup: ${op.path}`);
    if(current!==op.beforeHash)throw error('TARGET_CHANGED',`Target changed: ${op.path}`);
    if(op.beforeHash)fs.writeFileSync(path.join(backupDir,op.beforeHash),fs.readFileSync(within(actual,op.path)),{mode:0o600});
    backup.files.push({path:op.path,beforeHash:op.beforeHash,afterHash:op.afterHash});
  }
  atomicWrite(backupPath,Buffer.from(json(backup)),fileHash(backupPath));
  let writes=0;
  for(const op of plan.operations.filter(o=>o.action!=='reuse')) {
    const file=within(actual,op.path);if(fileHash(file)===op.afterHash)continue;
    atomicWrite(file,fs.readFileSync(within(bundle,op.payload)),op.beforeHash);writes++;
    if(failAfter&&writes>=failAfter)throw error('INJECTED_FAILURE','Simulated interruption; resume using the same plan');
  }
  const verification=verifyPlan({bundle,vault});
  if(!verification.ok)throw error('VERIFY_FAILED','Migration verification failed');
  backup.status='applied';backup.appliedAt=new Date().toISOString();atomicWrite(backupPath,Buffer.from(json(backup)),fileHash(backupPath));
  return {ok:true,writes,verification,backup:backupPath};
}
function verifyPlan({bundle,vault}) {
  const plan=loadPlan(bundle);const actual=fs.realpathSync(vault);if(actual!==plan.vault)throw error('WRONG_VAULT','Wrong Vault');
  const mismatches=[];for(const op of plan.operations)if(fileHash(within(actual,op.path))!==op.afterHash)mismatches.push(op.path);
  const relationErrors=[];
  for(const r of plan.mappings.relations.filter(r=>r.status==='confirmed')) {
    // An already imported record may have had this relation legitimately revoked.
    if(plan.operations.find(o=>o.path===INDEX)?.action==='reuse')continue;
    for(const relative of [r.sourcePath,r.targetPath]) {
      const file=within(actual,relative);
      if(!fs.existsSync(file)||!parseManagedRelations(fs.readFileSync(file,'utf8')).relations.some(v=>v.id===r.relationId))relationErrors.push(relative);
    }
  }
  return {ok:mismatches.length===0&&relationErrors.length===0,files:plan.operations.length,mismatches,relationErrors,counts:plan.counts};
}
function restorePlan(options) {return withLock(options.bundle,()=>restorePlanUnlocked(options));}
function restorePlanUnlocked({bundle,vault}) {
  const plan=loadPlan(bundle);const actual=fs.realpathSync(vault);const backupDir=path.join(bundle,'backup');const manifestPath=path.join(backupDir,'manifest.json');const backup=readJSON(manifestPath);
  if(actual!==plan.vault||backup.vault!==actual||backup.planHash!==plan.planHash)throw error('WRONG_VAULT','Wrong restore target');
  for(const file of backup.files) {
    const current=fileHash(within(actual,file.path));
    if(current!==file.afterHash&&current!==file.beforeHash)throw error('RESTORE_CONFLICT',`Preserving a file edited since migration: ${file.path}`);
    if(file.beforeHash&&fileHash(path.join(backupDir,file.beforeHash))!==file.beforeHash)throw error('BACKUP_DAMAGED',`Backup hash mismatch: ${file.path}`);
  }
  let restored=0;
  for(const item of [...backup.files].reverse()) {
    const file=within(actual,item.path);const current=fileHash(file);if(current===item.beforeHash)continue;
    if(item.beforeHash)atomicWrite(file,fs.readFileSync(path.join(backupDir,item.beforeHash)),item.afterHash);
    else {if(fileHash(file)!==item.afterHash)throw error('RESTORE_CONFLICT',item.path);fs.unlinkSync(file);}
    restored++;
  }
  const verified=backup.files.every(item=>fileHash(within(actual,item.path))===item.beforeHash);
  backup.status='restored';backup.restoredAt=new Date().toISOString();atomicWrite(manifestPath,Buffer.from(json(backup)),fileHash(manifestPath));return {ok:verified,restored};
}
function prepareTestVault({planBundle,out}) {
  const plan=loadPlan(planBundle);const root=path.resolve(out);if(fs.existsSync(root))throw error('TEST_VAULT_EXISTS','Use an empty test Vault location');fs.mkdirSync(root,{recursive:true,mode:0o700});
  let copies=0;
  // Only existing files whose content is needed by this exact migration are copied.
  for(const op of plan.operations)if(op.beforeHash) {
    const source=within(plan.vault,op.path);if(fileHash(source)!==op.beforeHash)throw error('TARGET_CHANGED',op.path);
    const target=within(root,op.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);copies++;
  }
  return {vault:root,copied:copies};
}
module.exports={SCHEMA,INDEX,REGISTRY,sha,fileHash,identityFields,curationText,parsePurposes,createPlan,loadPlan,applyPlan,verifyPlan,restorePlan,prepareTestVault,within};
