// Local text extraction only. No OCR, model, network, or Vault writes.
export const MAX_DOCUMENT_TEXT = 1000000;
export const MAX_DOCUMENT_PAGES = 1500;
// Match card bodies and saved highlights: count UTF-16 units, never slice a selection.
export const MAX_DOCUMENT_SELECTION_TEXT = 100000;
export function documentSelectionText(text) {
  if(text.length>MAX_DOCUMENT_SELECTION_TEXT)throw Error('选文超过 100,000 字，请缩小选区后再复制、摘录或高亮。当前选区与原附件仍保留；如需复制全部选文，可使用系统复制。');
  return text;
}
export function pdfPageText(content) {
  return content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':'')).join('').trimEnd();
}
export async function indexPdfDocument(pdf,{cancelled=()=>false,onProgress=()=>{},deadline=Date.now()+30000}={}) {
  const pages=[];let remaining=MAX_DOCUMENT_TEXT,truncated=false;
  for(let page=1;page<=pdf.numPages;page++) {
    if(cancelled())throw Error('文档已切换，索引取消。');
    if(page>MAX_DOCUMENT_PAGES||remaining<=0||Date.now()>deadline){truncated=true;break;}
    const source=await pdf.getPage(page),text=pdfPageText(await source.getTextContent());
    if(cancelled())throw Error('文档已切换，索引取消。');
    if(pages.length)remaining--;
    const value=text.slice(0,remaining);pages.push({page,text:value});remaining-=value.length;
    if(value.length<text.length){truncated=true;break;}
    onProgress(page,pdf.numPages);
  }
  return {pages,text:pages.map(item=>item.text).join('\n'),pageCount:pdf.numPages,truncated,indexedAt:new Date().toISOString()};
}
function textMatches(text,query,limit=10000) {
  const term=String(query).trim();if(!term)return [];
  // Match the original string so Unicode case folding cannot shift source offsets.
  const pattern=new RegExp(term.replace(/[.*+?^{}$()|[\]\\]/g,'\\$&'),'giu'),matches=[];
  let found;while(matches.length<limit&&(found=pattern.exec(text)))matches.push({offset:found.index,length:found[0].length});
  return matches;
}
export function documentMatches(pages,query) {
  const matches=[];
  for(const item of pages){for(const found of textMatches(item.text,query,10000-matches.length))matches.push({page:item.page,offset:found.offset});if(matches.length>=10000)break;}
  return matches;
}
export function pdfSearchParts(content,query) {
  const matches=textMatches(pdfPageText(content),query),items=content.items.filter(item=>typeof item.str==='string');
  let offset=0,first=0;
  return items.map(item=>{
    const start=offset,end=start+item.str.length,parts=[];offset=end+(item.hasEOL?1:0);
    while(first<matches.length&&matches[first].offset+matches[first].length<=start)first++;
    let cursor=0;
    for(let i=first;i<matches.length&&matches[i].offset<end;i++){
      const from=Math.max(start,matches[i].offset)-start,to=Math.min(end,matches[i].offset+matches[i].length)-start;
      if(from>cursor)parts.push({text:item.str.slice(cursor,from),matched:false});
      if(to>from)parts.push({text:item.str.slice(from,to),matched:true});
      cursor=Math.max(cursor,to);
    }
    if(cursor<item.str.length||!parts.length)parts.push({text:item.str.slice(cursor),matched:false});
    return parts;
  });
}
export function selectionInPage(selection,layer,page) {
  if(!selection||selection.isCollapsed||!selection.rangeCount)return null;
  const range=selection.getRangeAt(0);
  if(!layer.contains(range.startContainer)||!layer.contains(range.endContainer))return null;
  const text=documentSelectionText(selection.toString());if(!text.trim())return null;
  const bounds=layer.getBoundingClientRect();if(!bounds.width||!bounds.height)return null;
  const rects=Array.from(range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0).slice(0,1000).map(rect=>({x:Math.max(0,(rect.left-bounds.left)/bounds.width),y:Math.max(0,(rect.top-bounds.top)/bounds.height),width:Math.min(1,rect.width/bounds.width),height:Math.min(1,rect.height/bounds.height)}));
  return {page,text,rects};
}
