import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspaceState} from '../src/sublime/workspaceModel.js';
import {selectWorkspaceCards} from '../src/sublime/workspaceView.js';
const state=normalizeWorkspaceState({cards:[{id:'a',title:'reading alpha',type:'text',createdAt:'2025-01-01'},{id:'b',title:'reading beta',type:'image',createdAt:'2026-01-01'},{id:'c',title:'reading visible',type:'text'}],savedIds:['a'],hiddenIds:['a','b'],favoriteIds:['b'],annotations:{a:{note:'独有批注'}}});
const archived=filters=>selectWorkspaceCards(state.cards,state,{route:{page:'trash'},filters});
test('archive search, media, favorites and saved filters intersect instead of discarding the query',()=>{
 assert.deepEqual(archived({query:'no-match'}),[]);
 assert.deepEqual(archived({query:'reading',media:'Notes'}).map(x=>x.id),['a']);
 assert.deepEqual(archived({query:'独有批注'}).map(x=>x.id),['a']);
 assert.deepEqual(archived({query:'reading',favorite:true}).map(x=>x.id),['b']);
 assert.deepEqual(archived({query:'reading',favorite:true,inLibrary:true}),[]);
 assert.deepEqual(archived({query:'reading',inLibrary:true}).map(x=>x.id),['a']);
});
test('archived ordering and normal library visibility use the same corpus without mutating it',()=>{
 const before=structuredClone(state);
 assert.deepEqual(archived({sort:'oldest'}).map(x=>x.id),['a','b']);
 assert.deepEqual(archived({sort:'popular'}).map(x=>x.id),['b','a']);
 assert.deepEqual(selectWorkspaceCards(state.cards,state,{route:{page:'staff'}}).map(x=>x.id),['c']);
 assert.deepEqual(state,before);
});
