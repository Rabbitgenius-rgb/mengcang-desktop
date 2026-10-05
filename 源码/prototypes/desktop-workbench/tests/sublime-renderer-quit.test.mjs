import test from 'node:test';
import assert from 'node:assert/strict';
import {createRendererQuitController,lockWorkspaceInput} from '../src/sublime/rendererQuit.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('quit locks before settling and only a matching cancellation unlocks the acknowledged view',async()=>{
 const gate=deferred(),acks=[];let locked=0,released=0;const controller=createRendererQuitController({lock:()=>{locked++;return()=>released++;},settle:()=>gate.promise,acknowledge:async value=>acks.push(value)});
 const handling=controller.handle({type:'prepareQuit',quitId:'one'});assert.equal(locked,1);assert.equal(acks.length,0);gate.resolve();await handling;assert.equal(acks[0].ok,true);assert.equal(released,0);
 await controller.handle({type:'quitCancelled',quitId:'other'});assert.equal(released,0);await controller.handle({type:'quitCancelled',quitId:'one'});assert.equal(released,1);controller.dispose();assert.equal(released,1);
});
test('persistence failure is acknowledged without pretending it saved and waits for cancellation',async()=>{
 let released=0,ack,error;const c=createRendererQuitController({lock:()=>()=>released++,settle:async()=>{throw Error('Unsaved');},acknowledge:async value=>ack=value,onError:value=>error=value});await c.handle({type:'prepareQuit',quitId:'failure'});assert.equal(ack.ok,false);assert.equal(error,'Unsaved');assert.equal(released,0);await c.handle({type:'quitCancelled',quitId:'failure'});assert.equal(released,1);
});
test('late superseded completion cannot acknowledge or unlock a newer ticket',async()=>{
 const first=deferred(),second=deferred(),acks=[];let calls=0,released=0;const c=createRendererQuitController({lock:()=>()=>released++,settle:()=>++calls===1?first.promise:second.promise,acknowledge:async v=>acks.push(v)});
 const a=c.handle({type:'prepareQuit',quitId:'old'}),b=c.handle({type:'prepareQuit',quitId:'new'});assert.equal(released,1);first.resolve();await a;assert.equal(acks.length,0);second.resolve();await b;assert.equal(acks[0].quitId,'new');assert.equal(released,1);c.dispose();assert.equal(released,2);
});
test('an IPC acknowledgement failure unlocks and reports the failure',async()=>{let releases=0,error;const c=createRendererQuitController({lock:()=>()=>releases++,settle:async()=>{},acknowledge:async()=>{throw Error('IPC unavailable');},onError:v=>error=v});await c.handle({type:'prepareQuit',quitId:'one'});assert.equal(releases,1);assert.equal(error,'IPC unavailable');});
test('disposing an in-flight controller unlocks once and suppresses its late acknowledgement',async()=>{const gate=deferred();let releases=0,acks=0;const c=createRendererQuitController({lock:()=>()=>releases++,settle:()=>gate.promise,acknowledge:async()=>acks++});const job=c.handle({type:'prepareQuit',quitId:'one'});c.dispose();c.dispose();gate.resolve();await job;assert.equal(releases,1);assert.equal(acks,0);});
test('input lock flushes blur before blocking modal input and restores focus and attributes',()=>{
 const listeners=new Map(),attrs=new Map([['aria-busy','before']]),order=[];const focused={isConnected:true,blur:()=>order.push('blur'),focus:()=>order.push('focus')};
 const document={activeElement:focused,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type);}};
 const element={ownerDocument:document,inert:false,contains:value=>value===focused,getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)};
 const release=lockWorkspaceInput(element);assert.deepEqual(order,['blur']);assert.equal(element.inert,true);assert.equal(attrs.get('aria-busy'),'true');let blocked=0;listeners.get('beforeinput')({preventDefault:()=>blocked++,stopImmediatePropagation:()=>blocked++});assert.equal(blocked,2);
 release();release();assert.equal(listeners.size,0);assert.equal(element.inert,false);assert.equal(attrs.get('aria-busy'),'before');assert.deepEqual(order,['blur','focus']);
});
