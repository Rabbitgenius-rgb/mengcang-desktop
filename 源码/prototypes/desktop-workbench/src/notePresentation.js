const asText=value=>typeof value==='string'?value:'';
const cleanText=value=>asText(value).replace(/^>\s?/gm,'').trim();
const shareHeadings=new Set(['原始分享文字','原始分享文本','原始分享口令','分享口令']);
const captionHeadings=new Set(['配文','素材配文','我的描述','配文说明']);
function sectionsOf(markdown) {
 const sections=[];let current={heading:'',level:0,lines:[]};
 for(const line of markdown.split(/\r?\n/)) {
  const match=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if(match){sections.push(current);current={heading:match[2],level:match[1].length,lines:[]};}else current.lines.push(line);
 }
 sections.push(current);return sections;
}
function removeGeneratedExplorations(text,explorations) {
 let value=text;
 for(const record of explorations) {
  const content=asText(record.text);if(!content)continue;
  const generated=`- **${record.kind || '补充'} · ${record.createdAt || record.date || ''}** ${content.replace(/\n/g,'\n  ')}`;
  if(value.includes(generated))value=value.replace(generated,'');
  else if(value.includes(content))value=value.replace(content,'');
 }
 return value.trim();
}
function removeNavigation(lines) {
 return lines.filter(line=>!/^\s*(?:[-*]\s*)?\[\[(?:01_sources\/_originals\/|01_sources\/cards\/|03_projects\/)[^\]]+\]\](?:\s*[·—-]\s*(?:字符位置|原位置)\s*[\d–—-]+)?\s*$/.test(line));
}
export function notePresentation(record) {
 const fields=record.fields || {};
 // Only presentation changes. The source Markdown and serialized relationship data remain untouched.
 let markdown=asText(record.body)
  .replace(/<!--\s*mengcang-relations:start\s*-->[\s\S]*?<!--\s*mengcang-relations:end\s*-->/g,'')
  .replace(/<!--\s*mengcang(?:[-:][\s\S]*?)?-->/g,'');
 const rawShares=[];const body=[];let bodyCaption='';let summary=asText(fields.summary);
 for(const section of sectionsOf(markdown)) {
  let content=section.lines.join('\n').trim();
  if(shareHeadings.has(section.heading)){if(content)rawShares.push(cleanText(content));continue;}
  if(captionHeadings.has(section.heading)){if(!bodyCaption)bodyCaption=cleanText(content);continue;}
  if(section.heading==='整理说明'){if(!summary)summary=cleanText(content);continue;}
  if(section.heading==='梦藏已确认联系' && !content)continue;
  if(['原始出处','出处','相关素材','链接收藏','项目'].includes(section.heading))content=removeNavigation(section.lines).join('\n').trim();
  if(['页面快照','资料'].includes(section.heading))content=content.replace(/^\s*!\[\[[^\]]+\]\]\s*$/gm,'').trim();
  if(section.heading==='继续探索' && (record.explorations || []).length)content=removeGeneratedExplorations(content,record.explorations);
  if(!content)continue;
  const sameTitle=section.level===1 && section.heading===record.title;
  const heading=section.heading && !sameTitle ? `${'#'.repeat(section.level)} ${section.heading}\n\n` : '';
  body.push(`${heading}${content}`);
 }
 const isInspiration=record.kind==='entry' || fields.record_type==='inspiration';
 const hasExplicitCaption=Object.prototype.hasOwnProperty.call(fields,'caption') && typeof fields.caption==='string';
 const explicitCaption=hasExplicitCaption ? fields.caption : bodyCaption;
 const description=asText(record.description) || asText(fields.summary) || asText(fields.description);
 const caption=hasExplicitCaption ? explicitCaption : explicitCaption || (isInspiration && summary===description ? '' : description);
 return {body:body.join('\n\n').trim(),rawShare:asText(fields.original_share_text) || asText(fields.share_text) || asText(fields.raw_share) || rawShares.join('\n\n'),caption,summary};
}
export function relatedMaterialPaths(record) { return [...new Set([...(record.materialPaths || []),...(record.linkedPaths || [])].filter(value=>typeof value==='string' && value))]; }
export function relationPayload(candidate,action,values) {
 const relationId=/^mc-rel-[a-f0-9]{16}$/.test(candidate.relationId || '') ? candidate.relationId : undefined;
 // A preview candidate id is only provenance. The connector assigns the canonical pair id.
 return {...values,action,...(relationId?{relationId}:{})};
}
