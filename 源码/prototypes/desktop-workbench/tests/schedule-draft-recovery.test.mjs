import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreScheduleWorkspace} from '../src/scheduleDraftRecovery.js';
import {draftFromItem,scheduleIndexKey,scheduleDraftKey} from '../src/scheduleModel.js';
const identity={id:'test-vault',path:'fixture'};
const item={id:'fixture-id',title:'原记录',hash:'old',path:'03_projects/_schedule/fixture.md',notes:'',timeZone:'Asia/Shanghai',status:'todo'};
test('recovery fails closed on index or record read failure without issuing any writes',async()=>{
 for(const failAt of [scheduleIndexKey(identity),scheduleDraftKey(identity,item.id)]){
  let writes=0;const store={read:async key=>{if(key===failAt)throw new Error('read denied');return null;},write:async()=>writes++};
  await assert.rejects(restoreScheduleWorkspace(store,identity,[item]),/read denied/);assert.equal(writes,0);
 }
});
test('an indexed draft survives missing source and restores as non-writable conflict state',async()=>{
 const draft=draftFromItem(item);draft.form.notes='未保存修改';
 const store={read:async key=>key===scheduleIndexKey(identity)?{version:1,ids:[item.id]}:draft};
 const result=await restoreScheduleWorkspace(store,identity,[]);
 assert.equal(result.drafts[item.id].form.notes,'未保存修改');assert.equal(result.states[item.id].missingOriginal,true);
});
test('malformed recovery metadata is not silently converted to an empty index or fresh draft',async()=>{
 await assert.rejects(restoreScheduleWorkspace({read:async()=>({version:99,ids:[]})},identity,[]),/格式异常/);
 await assert.rejects(restoreScheduleWorkspace({read:async key=>key===scheduleIndexKey(identity)?null:{id:item.id,version:1}},identity,[item]),/无法解析/);
});
