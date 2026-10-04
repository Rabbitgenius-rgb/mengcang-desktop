import {searchText} from './desktopModel.js';

export const emptyHistory = () => ({past:[], future:[]});
export function remember(history, current) {
  return {past:[...history.past, structuredClone(current)].slice(-80), future:[]};
}
export function travel(history, current, direction) {
  const source=direction==='back' ? history.past : history.future;
  if (!source.length) return null;
  const target=source[source.length-1];
  return {target, history:direction==='back'
    ? {past:source.slice(0,-1),future:[...history.future,structuredClone(current)]}
    : {past:[...history.past,structuredClone(current)],future:source.slice(0,-1)}};
}

export function quickResults(groups, query, limit=40) {
  const terms=query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const seen=new Set(), results=[];
  for(const [view,items] of groups) for(const item of items) {
    const path=item.path || item.notePath;
    if(!path || seen.has(path)) continue;
    const text=[searchText({...item,title:item.title || item.name}),item.goal || ''].join(' ').normalize('NFKC').toLocaleLowerCase();
    if(!terms.every(term=>text.includes(term))) continue;
    seen.add(path);results.push({view,item,path});
    if(results.length===limit)return results;
  }
  return results;
}

const regions=['.inspiration-cards','.inspiration-document','.inspiration-related','.collections-grid-area','.collections-inspector','.projects-main','.schedule-list-scroll','.schedule-timeline-scroll','.schedule-detail-scroll'];
export function captureScroll(panel) {
  return regions.flatMap(selector=>{const node=panel?.querySelector(selector);return node?[{selector,top:node.scrollTop,left:node.scrollLeft}]:[];});
}
export function restoreScroll(panel, positions=[]) {
  for(const position of positions){const node=panel?.querySelector(position.selector);if(node){node.scrollTop=position.top;node.scrollLeft=position.left;}}
}
