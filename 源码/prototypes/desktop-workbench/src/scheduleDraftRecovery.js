import {restoreScheduleDraft,scheduleDraftKey,scheduleHasChanges,scheduleIndexKey,uniqueSchedules} from './scheduleModel.js';

// Recovery completes as one read-only step. A failed or malformed read must not
// be replaced by an empty editable draft, because the next write would erase it.
export async function restoreScheduleWorkspace(store,identity,items){
  const index=await store.read(scheduleIndexKey(identity));
  if(index!=null && (index.version!==1 || !Array.isArray(index.ids) || index.ids.some(id=>typeof id!=='string')))throw new Error('本机草稿清单格式异常，请保留草稿后重试。');
  const ids=[...new Set(index?.ids || [])],byId=new Map(uniqueSchedules(items).items.map(item=>[item.id,item]));
  const pairs=await Promise.all([...new Set([...byId.keys(),...ids])].map(async id=>{
    const item=byId.get(id),saved=await store.read(scheduleDraftKey(identity,id));
    if(saved!=null && (saved.version!==1 || saved.id!==id || !saved.form || !saved.baseValues))throw new Error('一份本机日程草稿无法解析，编辑已暂停。');
    if(!item && !saved)return null;
    const draft=restoreScheduleDraft(saved,item || {id});
    return [id,draft,{localState:scheduleHasChanges(draft)?'saved':'idle',missingOriginal:!item && !draft.isNew,conflict:Boolean(item && draft.baseHash!==item.hash && scheduleHasChanges(draft))}];
  }));
  return {ids,drafts:Object.fromEntries(pairs.filter(Boolean).map(([id,draft])=>[id,draft])),states:Object.fromEntries(pairs.filter(Boolean).map(([id,,state])=>[id,state]))};
}
