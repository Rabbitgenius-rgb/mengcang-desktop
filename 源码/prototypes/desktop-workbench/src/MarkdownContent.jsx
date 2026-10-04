import React from 'react';
function inline(text,onNavigate,keyPrefix='') {
 const pattern=/(!?\[\[[^\]]+\]\]|!?\[[^\]]*\]\([^\n)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
 const parts=[];let offset=0;let match;
 while((match=pattern.exec(text))){if(match.index>offset)parts.push(text.slice(offset,match.index));const token=match[0],key=`${keyPrefix}-${match.index}`;
  if(token.startsWith('![[')){const content=token.slice(3,-2);parts.push(<span key={key} className="desktop-inline-attachment">{content.split('|')[0].split('/').pop()}</span>);}
  else if(token.startsWith('[[')){const [path,label]=token.slice(2,-2).split('|');parts.push(onNavigate?<button className="text-btn desktop-inline-link" key={key} onClick={()=>onNavigate(path.endsWith('.md')?path:`${path}.md`)}>{label || path.split('/').pop()}</button>:<span key={key}>{label || path.split('/').pop()}</span>);}
  else if(token.startsWith('**'))parts.push(<strong key={key}>{token.slice(2,-2)}</strong>);
  else if(token.startsWith('`'))parts.push(<code key={key}>{token.slice(1,-1)}</code>);
  else {const label=/^!?\[([^\]]*)\]/.exec(token)?.[1] || '';parts.push(<span key={key}>{label || '附件'}</span>);}
  offset=match.index+token.length;
 }
 if(offset<text.length)parts.push(text.slice(offset));return parts;
}
export default function MarkdownContent({text,onNavigate}) {
 const blocks=[];let paragraph=[],list=[],quotes=[];const flush=()=>{if(paragraph.length){const value=paragraph.join('\n');blocks.push(<p key={`p-${blocks.length}`}>{inline(value,onNavigate)}</p>);paragraph=[];}if(list.length){blocks.push(<ul key={`list-${blocks.length}`}>{list.map((value,index)=><li key={index}>{inline(value,onNavigate,String(index))}</li>)}</ul>);list=[];}if(quotes.length){blocks.push(<blockquote key={`quote-${blocks.length}`}>{inline(quotes.join('\n'),onNavigate)}</blockquote>);quotes=[];}};
 for(const line of String(text || '').split(/\r?\n/)){
  if(!line.trim()){flush();continue;}
  const heading=/^(#{1,6})\s+(.+)$/.exec(line),bullet=/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line),quote=/^>\s?(.*)$/.exec(line);
  if(heading){flush();blocks.push(<h3 key={`heading-${blocks.length}`}>{inline(heading[2],onNavigate)}</h3>);}
  else if(bullet){if(paragraph.length || quotes.length)flush();list.push(bullet[1]);}
  else if(quote){if(paragraph.length || list.length)flush();quotes.push(quote[1]);}
  else {if(list.length || quotes.length)flush();paragraph.push(line);}
 }
 flush();return <div className="desktop-note-body">{blocks}</div>;
}
