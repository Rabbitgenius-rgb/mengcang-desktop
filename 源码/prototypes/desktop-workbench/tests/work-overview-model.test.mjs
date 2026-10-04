import test from 'node:test';
import assert from 'node:assert/strict';
import {draftFromItem,validateScheduleDraft,restoreScheduleDraft,rebaseScheduleDraft,filterSchedules} from '../src/scheduleModel.js';
import {workGroups,focusPatch,moveFocusPatch,projectWorkSummary,statusPatch,overviewDay} from '../src/workOverviewModel.js';
const day='2026-09-30';
const item=(id,extra={})=>({id,title:id,hash:`hash-${id}`,status:'todo',timeZone:'Asia/Shanghai',workState:'idle',focusDate:null,focusOrder:null,projectId:'project',...extra});

test('focus overlaps doing and waiting by identity, with no copied UUID',()=>{
  const doing=item('a',{workState:'doing',focusDate:day,focusOrder:2048}),waiting=item('b',{workState:'waiting',waitingReason:'选方案',focusDate:day,focusOrder:1024});
  const groups=workGroups([doing,waiting,doing,item('c')],day);
  assert.deepEqual(groups.focus.map(value=>value.id),['b','a']);assert.equal(groups.doing[0],doing);assert.equal(groups.waiting[0],waiting);assert.deepEqual(groups.idle.map(value=>value.id),['c']);
});
test('tomorrow focus disappears while work state remains; all items use one explicit local day',()=>{
  const waiting=item('a',{workState:'waiting',focusDate:day,focusOrder:1,timeZone:'America/Los_Angeles'});
  const now='2026-09-30T17:00:00Z';assert.equal(overviewDay(now,'Asia/Shanghai'),'2026-10-01');assert.equal(overviewDay(now,'America/Los_Angeles'),day);
  assert.equal(workGroups([waiting],'2026-10-01').focus.length,0);assert.equal(workGroups([waiting],'2026-10-01').waiting[0].id,waiting.id);
});
test('ordering only changes the moved item, survives JSON restart and admits more than three',()=>{
  let items=['a','b','c','d'].map(id=>item(id));for(let i=0;i<items.length;i++)items[i]={...items[i],...focusPatch(items[i],items,day)};
  assert.equal(workGroups(items,day).focus.length,4);
  const unchanged=JSON.stringify(items[0]);items[2]={...items[2],...moveFocusPatch(items,'c',-1,day)};
  assert.deepEqual(workGroups(JSON.parse(JSON.stringify(items)),day).focus.map(value=>value.id),['a','c','b','d']);assert.equal(JSON.stringify(items[0]),unchanged);
  items[0]={...items[0],...moveFocusPatch(items,'a',1,day)};assert.deepEqual(workGroups(items,day).focus.map(value=>value.id),['c','a','b','d']);
});
test('completed archived missing originals and unrelated filters produce no ghost rows',()=>{
  const records=[item('done',{status:'done',focusDate:day,focusOrder:1}),item('archived',{status:'archived'}),item('missing',{missingOriginal:true}),item('unlinked',{projectId:''}),item('unknown',{projectId:'gone'})];
  assert.deepEqual(workGroups(records,day,'__unlinked').idle.map(value=>value.id),['unlinked']);assert.equal(workGroups(records,day,'gone').idle[0].id,'unknown');
  for(const status of ['done','archived','todo'])assert.deepEqual(statusPatch(status),{status,workState:'idle',focusDate:null,focusOrder:null});
  assert.deepEqual(workGroups([],day),{focus:[],doing:[],waiting:[],idle:[]});
});
test('project summary derives manual progress, priority and active waiting count without percentages',()=>{
  const a=item('a',{workState:'waiting',waitingReason:'需要决定'}),b=item('b',{focusDate:day,focusOrder:1}),done=item('done',{status:'done',progressNote:'最新真实进展',progressUpdatedAt:'2026-09-30T01:00:00Z'});
  const summary=projectWorkSummary([a,b,done,item('other',{projectId:'other'})],'project',day);assert.equal(summary.priority,b);assert.equal(summary.progress,done);assert.equal(summary.waitingCount,1);assert.equal(Object.hasOwn(summary,'percentage'),false);
});
test('waiting requires a user question; deadline is independent and preserves UTC precision on title edits',()=>{
  const original=item('a',{dueAt:'2026-11-01T06:15:23.456Z',timeZone:'America/New_York',plannedStart:'2026-11-01T07:00:00Z',plannedEnd:'2026-11-01T08:00:00Z'}),draft=draftFromItem(original);
  draft.form.title='改标题';const result=validateScheduleDraft(draft);assert.equal(result.fields.dueAt,original.dueAt);assert.equal(result.fields.plannedStart,original.plannedStart);
  draft.form.workState='waiting';assert.ok(validateScheduleDraft(draft).errors.waitingReason);draft.form.waitingReason='确认尺寸';assert.equal(validateScheduleDraft(draft).valid,true);
  draft.form.dueAt='2026-11-02T09:00';assert.equal(validateScheduleDraft(draft).fields.plannedStart,original.plannedStart);
});
test('v1 local drafts restore new defaults and rebase work edits without replacing remote progress',()=>{
  const original=item('a'),draft=draftFromItem(original);for(const field of ['workState','focusDate','focusOrder','progressNote','progressUpdatedAt','waitingReason','dueAt']){delete draft.form[field];delete draft.baseValues[field];delete draft.baseFields[field];}
  draft.form.title='旧草稿';const restored=restoreScheduleDraft(draft,original);assert.equal(restored.form.workState,'idle');assert.equal(validateScheduleDraft(restored).valid,true);
  restored.form.workState='doing';const remote={...original,hash:'new',progressNote:'远端人工进展',progressUpdatedAt:'2026-09-30T01:00:00Z'},rebased=rebaseScheduleDraft(restored,remote);assert.equal(rebased.form.workState,'doing');assert.equal(rebased.form.progressNote,remote.progressNote);assert.equal(rebased.form.title,'旧草稿');assert.equal(rebased.operationId,null);
});
test('manual progress and user questions are searchable without exposing operation metadata',()=>{
  const a=item('a',{progressNote:'已整理三张封面',waitingReason:'选择画幅',operationId:'hidden-id'});assert.equal(filterSchedules([a],'画幅').length,1);assert.equal(filterSchedules([a],'封面').length,1);assert.equal(filterSchedules([a],'hidden-id').length,0);
});
