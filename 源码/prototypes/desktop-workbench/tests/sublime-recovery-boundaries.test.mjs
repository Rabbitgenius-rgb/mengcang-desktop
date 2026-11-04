import test from 'node:test';import assert from 'node:assert/strict';
import {copyDraftTitle,recoveredBoardCopy} from '../src/sublime/workspaceView.js';
import {workspaceReducer,createWorkspaceState} from '../src/sublime/workspaceModel.js';
test('copy titles remain valid at the maximum length without splitting a Unicode surrogate pair',()=>{
 for(const title of ['长'.repeat(1000),'😀'.repeat(500)]){const source={id:'old',title,collectionId:'keep',nodes:[],edges:[]},before=structuredClone(source),copy=recoveredBoardCopy(source,'new',[{id:'keep'}]);assert.equal(copy.collectionId,'keep');assert.ok(copy.title.length<=1000);assert.ok(copy.title.endsWith(' · 副本'));assert.doesNotMatch(copy.title,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);assert.deepEqual(source,before);assert.doesNotThrow(()=>workspaceReducer(createWorkspaceState(),{type:'collection.upsert',collection:{id:'collection',title:copyDraftTitle(title,'收藏集')}}));}
});
