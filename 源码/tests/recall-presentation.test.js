const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRecallPresentation}=require('../desktop/recall-presentation.cjs');

test('desktop presentation reuses item-specific names and only reads existing files',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'recall-presentation-'));
 const ids=['harness-recall:manual','harness-recall:topic','harness-recall:short','harness-recall:long'];
 const items=Object.fromEntries(ids.map((id,i)=>[id,{id,title:i===3?'原文'.repeat(30):'原标题'}]));
 const topics=[{id:'one',title:'浮窗整理标题',itemIds:[ids[1]]}];
 const state={cache:items,topicAssignments:{[ids[0]]:'用户命名'}};
 const files={'recall-state.json':JSON.stringify(state),'recall-topics-v1.json':JSON.stringify({entries:{one:{topics}}})};
 for(const [name,body]of Object.entries(files))await fs.writeFile(path.join(directory,name),body);
 const reader=createRecallPresentation({directory});t.after(async()=>{reader.close();await fs.rm(directory,{recursive:true,force:true});});
 const expected={[ids[0]]:'用户命名',[ids[1]]:'浮窗整理标题'};
 assert.deepEqual((await reader.read(ids)).titles,expected);
 assert.deepEqual(Object.keys((await reader.read([ids[0]])).titles),[ids[0]]);
 await assert.rejects(reader.read(['a'.repeat(241)]),/无效的摘录列表/);
 for(const [name,body]of Object.entries(files))assert.equal(await fs.readFile(path.join(directory,name),'utf8'),body);
 state.topicAssignments[ids[0]]='修改后的名称';await fs.writeFile(path.join(directory,'next.json'),JSON.stringify(state));await fs.rename(path.join(directory,'next.json'),path.join(directory,'recall-state.json'));
 assert.equal((await reader.read(ids)).titles[ids[0]],'修改后的名称');
});
test('missing or malformed companion data yields safe title fallbacks',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'recall-presentation-invalid-'));
 const reader=createRecallPresentation({directory});t.after(async()=>{reader.close();await fs.rm(directory,{recursive:true,force:true});});
 assert.deepEqual(await reader.read(),{titles:{}});
 await fs.writeFile(path.join(directory,'recall-state.json'),'null');await fs.writeFile(path.join(directory,'recall-topics-v1.json'),'[');
 assert.deepEqual(await reader.read(),{titles:{}});
 await fs.writeFile(path.join(directory,'recall-state.json'),JSON.stringify({cache:{'harness-recall:a':{title:42},'outside:a':{title:'不展示'}}}));
 assert.deepEqual(await reader.read(['harness-recall:a','outside:a']),{titles:{}});
});

test('a shared topic or shared manual group never becomes every excerpt title',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'recall-shared-topic-')),ids=['harness-recall:a','harness-recall:b','harness-recall:c'];
 await fs.writeFile(path.join(directory,'recall-state.json'),JSON.stringify({cache:Object.fromEntries(ids.map(id=>[id,{id,title:'不同的原文内容'}])),topicAssignments:Object.fromEntries(ids.map(id=>[id,'共同主题']))}));
 await fs.writeFile(path.join(directory,'recall-topics-v1.json'),JSON.stringify({entries:{one:{topics:[{id:'shared',title:'轻快的悲伤',itemIds:ids}]}}}));
 const reader=createRecallPresentation({directory});t.after(async()=>{reader.close();await fs.rm(directory,{recursive:true,force:true});});assert.deepEqual(await reader.read(ids),{titles:{}});
});
