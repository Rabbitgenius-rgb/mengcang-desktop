const test=require('node:test');
const assert=require('node:assert/strict');
const {createRendererQuitGate}=require('../desktop/renderer-quit.cjs');

test('quit waits for a matching renderer save acknowledgment and ignores stale/malformed tickets',async()=>{
 const sent=[];const gate=createRendererQuitGate({send:id=>{sent.push(id);return true;},makeId:()=>`quit-${sent.length}`});
 const first=gate.wait();assert.equal(gate.wait(),first);
 for(const payload of [null,{quitId:'other',ok:true},{quitId:sent[0],ok:'yes'},{quitId:sent[0],ok:true,extra:true}])assert.equal(gate.ack(payload).accepted,false);
 assert.equal(gate.ack({quitId:sent[0],ok:true}).accepted,true);assert.deepEqual(await first,{ok:true,message:''});
 const second=gate.wait();assert.equal(gate.ack({quitId:sent[0],ok:true}).accepted,false);
 gate.ack({quitId:sent[1],ok:true});assert.equal((await second).ok,true);
});
test('failed renderer persistence keeps the application open and allows a fresh retry',async()=>{
 let id=0;const gate=createRendererQuitGate({send:()=>true,makeId:()=>String(++id)});
 const first=gate.wait();gate.ack({quitId:'1',ok:false,message:'disk failure'});assert.deepEqual(await first,{ok:false,message:'disk failure'});
 const retry=gate.wait();gate.ack({quitId:'2',ok:true});assert.equal((await retry).ok,true);
});
test('unresponsive or unavailable renderer never authorizes quitting',async()=>{
 const timed=createRendererQuitGate({send:()=>true,timeoutMs:10});assert.equal((await timed.wait()).ok,false);
 for(const send of [()=>false,()=>{throw Error('closed');}])assert.equal((await createRendererQuitGate({send}).wait()).ok,false);
});
test('closed window cancels the pending save handshake',async()=>{
 const gate=createRendererQuitGate({send:()=>true});const pending=gate.wait();gate.cancel();assert.equal((await pending).ok,false);
});
