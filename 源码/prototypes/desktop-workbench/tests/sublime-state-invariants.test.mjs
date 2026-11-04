import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceState,workspaceReducer,serializeWorkspace,parseWorkspaceBackup,mergeWorkspaceBackup,selectCards,normalizeWorkspaceState} from '../src/sublime/workspaceModel.js';
function random(seed){let value=seed>>>0;return maximum=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value%maximum;};}
for(const seed of [1,7,19,43,97])test(`state, backup and membership invariants for synthetic seed ${seed}`,()=>{
 const next=random(seed);let state=createWorkspaceState();
 for(let step=0;step<120;step++){
  const id=`card-${next(9)}`,collectionId=`collection-${next(4)}`;let action;
  switch(next(7)){
   case 0:action={type:'card.upsert',card:{id,title:`条目 ${id}`,body:`合成 ${step}\n原文 café 🧪`,ocrText:`识别 ${step}`,tags:[`tag-${next(3)}`]}};break;
   case 1:action={type:'card.favorite',id,value:!!next(2)};break;
   case 2:action={type:'card.hide',id,hidden:!!next(2)};break;
   case 3:action={type:'card.note',id,note:`备注 ${step}`,private:!!next(2)};break;
   case 4:action={type:'collection.upsert',collection:{id:collectionId,title:collectionId,cardIds:state.cards.slice(0,next(state.cards.length+1)).map(card=>card.id)}};break;
   case 5:action={type:'collection.delete',id:collectionId};break;
   default:action={type:'draft.set',key:'new:text',value:{body:`未提交 ${step}`,selected:!!next(2)}};
  }
  const before=structuredClone(state),updated=workspaceReducer(state,action);assert.deepEqual(state,before);
  const restored=parseWorkspaceBackup(serializeWorkspace(updated));assert.deepEqual(restored,updated);assert.deepEqual(mergeWorkspaceBackup(restored,updated),updated);
  const imported=mergeWorkspaceBackup(createWorkspaceState(),updated);assert.deepEqual(mergeWorkspaceBackup(imported,updated),imported);
  for(const collection of restored.collections)for(const cardId of collection.cardIds)assert.ok(restored.annotations[cardId].collectionIds.includes(collection.id));
  for(const [cardId,annotation] of Object.entries(restored.annotations))for(const related of annotation.collectionIds)assert.ok(restored.collections.find(value=>value.id===related)?.cardIds.includes(cardId));
  state=updated;
 }
});
test('read-only source unions may exceed one persisted workspace count limit',()=>{const cards=Array.from({length:20001},(_,i)=>({id:`source-${i}`,title:`source ${i}`}));assert.equal(selectCards(cards,createWorkspaceState(),{query:'source 20000'}).length,1);assert.throws(()=>normalizeWorkspaceState({cards}),/20000/);});
test('prototype-named valid identities preserve memberships without modifying inherited objects',()=>{for(const id of ['toString','valueOf','hasOwnProperty','toLocaleString']){const before=Object.getOwnPropertyDescriptors(Object.prototype[id]);const state=normalizeWorkspaceState({cards:[{id,title:id}],collections:[{id:'collection',title:'Collection',cardIds:[id]}]});assert.deepEqual(state.annotations[id].collectionIds,['collection']);assert.deepEqual(parseWorkspaceBackup(serializeWorkspace(state)),state);assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype[id]),before);}});
test('custom media names never resolve to inherited objects or functions',()=>{for(const type of ['constructor','__proto__','toString']){const state=normalizeWorkspaceState({cards:[{id:'card',title:'Synthetic',type}]});assert.equal(state.cards[0].type,type.toLowerCase());assert.deepEqual(parseWorkspaceBackup(serializeWorkspace(state)),state);}});
