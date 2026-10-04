import {localDateKey,uniqueSchedules} from './scheduleModel.js';

export const workStateLabel = {idle:'稍后',doing:'正在执行',waiting:'等我决定'};
export function workGroups(items,day,projectId='') {
  const active=uniqueSchedules(items).items.filter(item=>item.status==='todo' && !item.missingOriginal && (!projectId || (projectId==='__unlinked'?!item.projectId:item.projectId===projectId)));
  const byTitle=(a,b)=>a.title.localeCompare(b.title,'zh-CN') || a.id.localeCompare(b.id);
  const focus=active.filter(item=>item.focusDate===day).sort((a,b)=>(a.focusOrder ?? 0)-(b.focusOrder ?? 0) || a.id.localeCompare(b.id));
  return {focus,doing:active.filter(item=>item.workState==='doing').sort(byTitle),waiting:active.filter(item=>item.workState==='waiting').sort(byTitle),idle:active.filter(item=>!item.workState || item.workState==='idle').sort(byTitle)};
}
export function focusPatch(item,items,day) {
  if(item.focusDate===day)return {focusDate:null,focusOrder:null};
  const orders=workGroups(items,day).focus.map(item=>item.focusOrder || 0);
  return {focusDate:day,focusOrder:Math.max(0,...orders)+1024};
}
// Only the moved UUID is written. Fractional orders avoid a partially saved
// two-note swap; conflicts leave the exact pending operation in its draft.
export function moveFocusPatch(items,id,direction,day) {
  const ordered=workGroups(items,day).focus,index=ordered.findIndex(item=>item.id===id),target=index+direction;
  if(index<0 || target<0 || target>=ordered.length)return null;
  const others=ordered.filter(item=>item.id!==id);
  const left=others[target-1]?.focusOrder,right=others[target]?.focusOrder;
  const order=left===undefined?right-1024:right===undefined?left+1024:(left+right)/2;
  if(!Number.isFinite(order) || order===left || order===right || Math.abs(order)>1e12)throw new Error('关注顺序过于接近，请先移出今天再重新加入。');
  return {focusDate:day,focusOrder:order};
}
export function statusPatch(status) {return {status,workState:'idle',focusDate:null,focusOrder:null};}
export function projectWorkSummary(items,projectId,day) {
  const related=uniqueSchedules(items).items.filter(item=>item.projectId===projectId && !item.missingOriginal);
  const progress=related.filter(item=>item.progressNote && item.progressUpdatedAt).sort((a,b)=>Date.parse(b.progressUpdatedAt)-Date.parse(a.progressUpdatedAt) || a.id.localeCompare(b.id))[0] || null;
  const groups=workGroups(related,day);
  const priority=groups.focus[0] || groups.doing[0] || groups.idle[0] || groups.waiting[0] || null;
  return {progress,priority,waitingCount:groups.waiting.length};
}
export function overviewDay(now,timeZone) {return localDateKey(now,timeZone);}
