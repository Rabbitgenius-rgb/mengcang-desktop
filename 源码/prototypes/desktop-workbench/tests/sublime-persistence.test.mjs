import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {createWorkspaceState,serializeWorkspace,parseWorkspaceBackup} from '../src/sublime/workspaceModel.js';
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const draft=(value,key='edit:one')=>({type:'draft.set',key,value:{body:value}});
function delayedStore(){let state=createWorkspaceState();const writes=[],waits=[];return {writes,waits,load:async()=>state,save:async value=>{writes.push(structuredClone(value));const g=gate();waits.push(g);await g.promise;state=value;}};}
test('old draft completion cannot replace a later input or resumed editor draft',async()=>{
 const store=delayedStore(),session=createWorkspaceSession(store);await session.load();
 const first=session.commit(draft('one'));await tick();const second=session.commit(draft('one two'));
 store.waits[0].resolve();await first;assert.equal(session.drafts()['edit:one'].body,'one two');
 const third=session.commit(draft(session.drafts()['edit:one'].body+' three'));await tick();store.waits[1].resolve();await second;await tick();store.waits[2].resolve();await third;
 assert.equal((await session.settled()).drafts['edit:one'].body,'one two three');
});
test('backup waits for all queued writes and roundtrips the newest draft',async()=>{
 const store=delayedStore(),session=createWorkspaceSession(store);await session.load();const a=session.commit(draft('first'));await tick();const b=session.commit(draft('latest'));let finished=false;const backup=session.settled().then(value=>{finished=true;return parseWorkspaceBackup(serializeWorkspace(value));});
 store.waits[0].resolve();await a;await tick();assert.equal(finished,false);store.waits[1].resolve();await b;assert.equal((await backup).drafts['edit:one'].body,'latest');
});
test('failed write retains draft and prevents a false complete backup; retry recovers',async()=>{
 const store=delayedStore(),session=createWorkspaceSession(store);await session.load();const failed=session.commit(draft('retained'));await tick();store.waits[0].reject(Error('Disk full'));await assert.rejects(failed,/Disk full/);assert.equal(session.drafts()['edit:one'].body,'retained');await assert.rejects(session.settled(),/Disk full/);
 const retry=session.commit(draft('retained'));await tick();store.waits[1].resolve();await retry;assert.equal((await session.settled()).drafts['edit:one'].body,'retained');
});
test('queued writes remain in A and never appear in B; reentering A waits for them',async()=>{
 const aStore=delayedStore(),bStore=delayedStore(),a=createWorkspaceSession(aStore),b=createWorkspaceSession(bStore);await Promise.all([a.load(),b.load()]);const job=a.commit(draft('A only'));await tick();const resumed=a.load();assert.deepEqual(b.drafts(),{});assert.equal(bStore.writes.length,0);aStore.waits[0].resolve();await job;assert.equal((await resumed).drafts['edit:one'].body,'A only');assert.deepEqual(b.drafts(),{});
});
test('pending clear and newer replacement are versioned independently',async()=>{
 const store=delayedStore(),session=createWorkspaceSession(store);await session.load();const first=session.commit(draft('old'));await tick();const clear=session.commit({type:'draft.set',key:'edit:one',value:null});const replacement=session.commit(draft('new'));store.waits[0].resolve();await first;await tick();store.waits[1].resolve();await clear;assert.equal(session.drafts()['edit:one'].body,'new');await tick();store.waits[2].resolve();await replacement;assert.equal((await session.settled()).drafts['edit:one'].body,'new');
});
