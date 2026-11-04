import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeWorkbench,filterRecall,recallCards,unread,moveModule,groupTopics} from '../src/recall/recallModel.js';
const card={id:'a',title:'原文摘录',body:'真实内容',recallDue:true,recallReceipt:{savedAt:'2026-10-25'},externalSource:{instanceId:'i',sessionId:'s',sessionTitle:'原对话'}};
test('read and unread filters use the saved reading state, regardless of legacy review flags',()=>{const model=normalizeWorkbench({read:{a:'now'}});assert.equal(unread(card,model),false);assert.deepEqual(filterRecall([card],model,{filter:'read'}),[card]);assert.equal(filterRecall([card],model,{filter:'unread'}).length,0);const legacy={...card,recallDue:false};assert.deepEqual(filterRecall([legacy],normalizeWorkbench(),{filter:'unread'}),[legacy]);assert.equal(filterRecall([legacy],normalizeWorkbench(),{filter:'read'}).length,0);});
test('only saved active recall records enter the independent workspace',()=>{const state={cards:[card,{...card,id:'archived'},{id:'ordinary',title:'资料库笔记'}],savedIds:['a','archived','ordinary'],hiddenIds:['archived']};assert.deepEqual(recallCards(state).map(c=>c.id),['a']);});
test('same named conversations retain separate identities and filters',()=>{const other={...card,id:'b',externalSource:{...card.externalSource,sessionId:'other'}};const groups=groupTopics([card,other]);assert.equal(groups.length,2);assert.equal(filterRecall([card,other],normalizeWorkbench(),{topic:groups[0].id}).length,1);assert.equal(filterRecall([card,other],normalizeWorkbench(),{query:'真实'}).length,2);});
test('module ordering preserves values, enabled states and immutable input',()=>{const m=normalizeWorkbench().modules;const moved=moveModule(m,'scratchpad',-1);assert.equal(m[0].id,'topics');assert.equal(moved[0].id,'scratchpad');assert.equal(moved[0].enabled,true);assert.deepEqual(moveModule(m,'topics',-1),m);});

test('all source threads are available and same titles from different instances stay separate',()=>{const all=Array.from({length:8},(_,i)=>({...card,id:'thread-'+i,externalSource:{...card.externalSource,sessionId:'session-'+i,sessionTitle:'same title'}}));all.push({...card,id:'other-instance',externalSource:{...all[0].externalSource,instanceId:'second-instance'}});const groups=groupTopics(all);assert.equal(groups.length,9);for(const thread of groups)assert.equal(filterRecall(all,normalizeWorkbench(),{topic:thread.id}).length,1);});

test('companion titles sit above the untouched original without changing stored fields',async()=>{
 const {recallDisplayText}=await import('../src/recall/recallModel.js');
 const original=Object.freeze({id:'a',title:'痛感与爱是同一件事的两面。'.repeat(5),body:'痛感与爱是同一件事的两面。\n它证明这段关系重要。',recallReceipt:Object.freeze({payloadHash:'original-receipt'})});
 assert.deepEqual(recallDisplayText(original,{a:'痛苦作为爱的证词'}),{title:'痛苦作为爱的证词',body:original.body});
 assert.equal(recallDisplayText(original).title,'痛感与爱是同一件事的两面');
 assert.equal(original.recallReceipt.payloadHash,'original-receipt');
 assert.equal(original.title,'痛感与爱是同一件事的两面。'.repeat(5));
});
test('the companion fallback preserves short titles and never strips the body heading',async()=>{
 const {recallDisplayText}=await import('../src/recall/recallModel.js');
 assert.deepEqual(recallDisplayText({title:'一个结论。',body:'一个结论。\n这里是后续证据。'}),{title:'一个结论。',body:'一个结论。\n这里是后续证据。'});
 assert.deepEqual(recallDisplayText({title:'独立标题',body:'没有重复的正文'}),{title:'独立标题',body:'没有重复的正文'});
 assert.deepEqual(recallDisplayText({body:'原文'}),{title:'原文',body:'原文'});
 assert.deepEqual(recallDisplayText({title:'只有标题',body:''}),{title:'只有标题',body:''});
 assert.equal(filterRecall([card],normalizeWorkbench(),{query:'浮窗标题',titles:{a:'浮窗标题'}}).length,1);
});
