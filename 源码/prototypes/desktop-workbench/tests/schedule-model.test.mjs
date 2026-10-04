import test from 'node:test';
import assert from 'node:assert/strict';
import {addCalendarDays,dayBounds,draftFromItem,filterSchedules,itemFromDraft,layoutDay,localDateKey,localDateTime,localTimeToIso,placeScheduleForm,rebaseScheduleDraft,restoreScheduleDraft,scheduleColor,scheduleDraftKey,scheduleHasChanges,uniqueSchedules,validateScheduleDraft,validateScheduleForm} from '../src/scheduleModel.js';

const timeZone='Asia/Shanghai';
const record=(id,start,end,extra={})=>({id,path:`日程/${id}.md`,hash:`hash-${id}`,title:`事项 ${id}`,notes:'',plannedStart:start?localTimeToIso(start,timeZone):null,plannedEnd:end?localTimeToIso(end,timeZone):null,timeZone,status:'todo',projectId:'',sourcePath:'',...extra});

test('calendar keys use the selected IANA zone instead of UTC slicing',()=>{
  assert.equal(localDateKey('2026-09-28T17:30:00Z',timeZone),'2026-09-29');
  assert.equal(localDateKey('2026-09-29T02:30:00Z','America/Los_Angeles'),'2026-09-28');
  assert.equal(addCalendarDays('2026-12-31',1),'2027-01-01');
  assert.equal(addCalendarDays('2028-03-01',-1),'2028-02-29');
});

test('wall time converts exactly, while invalid and nonexistent times are rejected',()=>{
  assert.equal(localTimeToIso('2026-09-29T09:15',timeZone),'2026-09-29T01:15:00.000Z');
  assert.equal(localTimeToIso('2026-02-30T09:15',timeZone),null);
  assert.equal(localTimeToIso('2026-03-08T02:30','America/New_York'),null);
  assert.equal(localTimeToIso('2026-11-01T01:30','America/New_York'),'2026-11-01T05:30:00.000Z');
  assert.equal(localTimeToIso('2026-09-29T09:15','not/a-zone'),null);
});

test('day boundaries preserve 23- and 25-hour local days',()=>{
  assert.equal(dayBounds('2026-09-29',timeZone).minutes,1440);
  assert.equal(dayBounds('2026-03-08','America/New_York').minutes,1380);
  assert.equal(dayBounds('2026-11-01','America/New_York').minutes,1500);
});

test('a cross-midnight item is clipped on both days, with an exclusive end',()=>{
  const item=record('overnight','2026-09-28T23:30','2026-09-29T01:00');
  const first=layoutDay([item],'2026-09-28',timeZone).segments[0];
  const second=layoutDay([item],'2026-09-29',timeZone).segments[0];
  assert.equal(first.top,1410);assert.equal(first.duration,30);assert.equal(first.continuesAfter,true);
  assert.equal(second.top,0);assert.equal(second.duration,60);assert.equal(second.continuesBefore,true);
  assert.equal(layoutDay([record('midnight','2026-09-28T23:00','2026-09-29T00:00')],'2026-09-29',timeZone).segments.length,0);
});

test('overlap groups receive separate columns and touching endpoints reuse one',()=>{
  const items=[record('a','2026-09-29T09:00','2026-09-29T12:00'),record('b','2026-09-29T09:00','2026-09-29T10:00'),record('c','2026-09-29T10:00','2026-09-29T11:00'),record('d','2026-09-29T13:00','2026-09-29T14:00')];
  const segments=layoutDay(items,'2026-09-29',timeZone).segments,byId=new Map(segments.map(s=>[s.item.id,s]));
  assert.equal(byId.get('a').columns,2);assert.notEqual(byId.get('a').column,byId.get('b').column);
  assert.equal(byId.get('b').column,byId.get('c').column);assert.equal(byId.get('d').columns,1);
  for(const a of segments)for(const b of segments)if(a.item.id!==b.item.id && a.start<b.end && b.start<a.end)assert.notEqual(a.column,b.column);
});

test('duplicate IDs are flagged, deduplicated and never occupy a second column',()=>{
  const item=record('same','2026-09-29T09:00','2026-09-29T10:00');
  assert.deepEqual(uniqueSchedules([item,{...item,title:'duplicate'}]).duplicates,['same']);
  assert.equal(layoutDay([item,item],'2026-09-29',timeZone).segments.length,1);
});

test('timeline excludes done, archived, invalid and unscheduled items',()=>{
  const item=record('base','2026-09-29T09:00','2026-09-29T10:00');
  assert.equal(layoutDay([{...item,id:'done',status:'done'},{...item,id:'archive',status:'archived'},{...item,id:'invalid',invalidTime:true},record('pending')],'2026-09-29',timeZone).segments.length,0);
});

test('search finds user notes and linked titles without indexing IDs or management paths',()=>{
  const item=record('secret-id',null,null,{title:'准备阅读',notes:'了解建筑细节',projectId:'project-secret',sourcePath:'hidden-path.md'});
  const context={projects:[{id:'project-secret',title:'江南园林'}],sources:[{path:'hidden-path.md',title:'造园札记'}]};
  assert.equal(filterSchedules([item],'园林 细节',context).length,1);
  assert.equal(filterSchedules([item],'造园',context).length,1);
  assert.equal(filterSchedules([item],'secret',context).length,0);
  assert.equal(filterSchedules([item],'hidden-path',context).length,0);
});

test('form validation requires paired ordered times and caps one item at 24 hours',()=>{
  const form=draftFromItem(record('a')).form;
  assert.equal(validateScheduleForm(form).valid,true);
  assert.equal(validateScheduleForm({...form,title:'  '}).valid,false);
  assert.equal(validateScheduleForm({...form,plannedStart:'2026-09-29T09:00'}).valid,false);
  assert.equal(validateScheduleForm({...form,plannedStart:'2026-09-29T09:00',plannedEnd:'2026-09-29T08:00'}).valid,false);
  assert.equal(validateScheduleForm({...form,plannedStart:'2026-09-29T09:00',plannedEnd:'2026-09-30T09:00'}).valid,true);
  assert.equal(validateScheduleForm({...form,plannedStart:'2026-09-29T09:00',plannedEnd:'2026-09-30T09:01'}).valid,false);
});

test('drag placement snaps to 15 minutes and preserves duration across midnight',()=>{
  const form=draftFromItem(record('a','2026-09-29T09:00','2026-09-29T10:30')).form;
  const moved=placeScheduleForm(form,'2026-09-30',1430,timeZone);
  assert.equal(moved.plannedStart,'2026-09-30T23:45');assert.equal(moved.plannedEnd,'2026-10-01T01:15');
  const unscheduled=placeScheduleForm(draftFromItem(record('b')).form,'2026-09-29',541,timeZone);
  assert.equal(unscheduled.plannedStart,'2026-09-29T09:00');assert.equal(unscheduled.plannedEnd,'2026-09-29T10:00');
});

test('draft keys isolate both Vault and schedule ID, and foreign drafts are ignored',()=>{
  assert.notEqual(scheduleDraftKey({id:'vault-a'},'x'),scheduleDraftKey({id:'vault-b'},'x'));
  assert.notEqual(scheduleDraftKey({id:'vault-a'},'x'),scheduleDraftKey({id:'vault-a'},'y'));
  const item=record('a'),wrong={...draftFromItem(item),id:'b',form:{...draftFromItem(item).form,title:'wrong'}};
  assert.equal(restoreScheduleDraft(wrong,item).form.title,item.title);
});

test('conflicting restore keeps edits and explicit rebase adopts only untouched remote fields',()=>{
  const original=record('a',null,null,{notes:'原备注'}),draft=draftFromItem(original);
  draft.form={...draft.form,title:'我的修改'};draft.operationId='stable-retry';draft.submittedFields={title:'我的修改'};
  const remote={...original,hash:'changed-hash',notes:'远端备注'};
  const restored=restoreScheduleDraft(draft,remote);
  assert.equal(restored.baseHash,original.hash);assert.equal(restored.operationId,'stable-retry');
  const rebased=rebaseScheduleDraft(restored,remote);
  assert.equal(rebased.baseHash,'changed-hash');assert.equal(rebased.form.title,'我的修改');assert.equal(rebased.form.notes,'远端备注');
  assert.equal(rebased.operationId,null);assert.equal(scheduleHasChanges(rebased),true);
  assert.equal(itemFromDraft(rebased,remote).isLocal,true);
});

test('new drafts remain local until a hashed save receipt is used as their new base',()=>{
  const local=draftFromItem({id:'new',title:'起草',timeZone});
  assert.equal(scheduleHasChanges(local),true);assert.equal(local.isNew,true);
  const saved=draftFromItem({...itemFromDraft(local),hash:'saved-hash',path:'日程/new.md'});
  assert.equal(scheduleHasChanges(saved),false);assert.equal(saved.isNew,false);
  assert.equal(localDateTime('2026-09-29T01:00:00Z',timeZone),'2026-09-29T09:00');
  assert.equal(scheduleColor('stable-id'),scheduleColor('stable-id'));
});

test('editing only notes preserves exact UTC seconds and the second DST fold',()=>{
  const item=record('fold',null,null,{timeZone:'America/New_York',plannedStart:'2026-11-01T06:15:23.456Z',plannedEnd:'2026-11-01T06:45:47.123Z'});
  const draft=draftFromItem(item);draft.form={...draft.form,notes:'仅修改备注'};
  const validated=validateScheduleDraft(draft);
  assert.equal(validated.valid,true);assert.equal(validated.fields.plannedStart,item.plannedStart);assert.equal(validated.fields.plannedEnd,item.plannedEnd);
  assert.equal(itemFromDraft(draft,item).plannedStart,item.plannedStart);
  const restored=restoreScheduleDraft(JSON.parse(JSON.stringify(draft)),item);
  assert.equal(validateScheduleDraft(restored).fields.plannedEnd,item.plannedEnd);
  restored.form={...restored.form,plannedEnd:'2026-11-01T02:00'};
  assert.equal(validateScheduleDraft(restored).fields.plannedStart,item.plannedStart);
  assert.equal(validateScheduleDraft(restored).fields.plannedEnd,'2026-11-01T07:00:00.000Z');
});

test('indexed edited drafts remain recoverable when the original is absent',()=>{
  const item=record('missing','2026-09-29T09:00','2026-09-29T10:00'),draft=draftFromItem(item);
  draft.form={...draft.form,notes:'需要保留的本机修改'};
  const restored=restoreScheduleDraft(JSON.parse(JSON.stringify(draft)),{id:item.id});
  assert.equal(restored.isNew,false);assert.equal(restored.baseHash,item.hash);assert.equal(restored.path,item.path);
  assert.equal(restored.form.notes,'需要保留的本机修改');assert.equal(validateScheduleDraft(restored).fields.plannedStart,item.plannedStart);
  assert.equal(layoutDay([{...itemFromDraft(restored),missingOriginal:true}],'2026-09-29',timeZone).segments.length,0);
});

test('notes use the connector limit of 50,000 characters',()=>{
  const form=draftFromItem(record('long')).form;
  assert.equal(validateScheduleForm({...form,notes:'字'.repeat(50000)}).valid,true);
  assert.match(validateScheduleForm({...form,notes:'字'.repeat(50001)}).errors.notes,/50,000/);
});
