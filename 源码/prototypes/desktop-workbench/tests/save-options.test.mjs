import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceState,workspaceReducer} from '../src/sublime/workspaceModel.js';
import {createWorkspaceSession} from '../src/sublime/workspacePersistence.js';
import {saveOptionsSnapshot,hasSaveOptionsChanges,applySaveOptions,savePanelPosition} from '../src/sublime/saveOptions.js';

function fixture(){
 const card={id:'a',title:'Original',type:'image',body:'Exact original text',caption:'Original note',sourceUrl:'https://example.org/a',attachment:{name:'pixel.gif',type:'image/gif',size:34,dataUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}};
 const state=[{type:'card.upsert',card},{type:'card.save',id:'a',saved:true},{type:'collection.upsert',collection:{id:'one',title:'First',cardIds:['a']}},{type:'collection.upsert',collection:{id:'two',title:'Second',cardIds:[]}},{type:'draft.set',key:'existing-reading',value:{page:12}}].reduce(workspaceReducer,createWorkspaceState());
 const base=saveOptionsSnapshot(state,card),value={note:base.note,private:base.private,favorite:base.favorite,collectionIds:[...base.collectionIds],newCollectionTitle:'',newCollectionId:'new-folder'};
 return {card,state,base,value};
}
test('opening or saving unchanged options never alters card, note, collections or drafts',()=>{
 const f=fixture(),before=structuredClone(f.state);
 assert(!hasSaveOptionsChanges(f.base,f.value));
 assert.equal(applySaveOptions(f.state,f.card,f.base,f.value),f.state);assert.deepEqual(f.state,before);
});
test('one save changes only requested metadata and creates a collection atomically',()=>{
 const f=fixture(),before=structuredClone(f.state);
 const next=applySaveOptions(f.state,f.card,f.base,{...f.value,note:'A new note',private:true,favorite:true,collectionIds:['two'],newCollectionTitle:'研究'});
 assert.deepEqual(next.cards,before.cards);assert.deepEqual(next.drafts,before.drafts);assert.deepEqual(next.boards,before.boards);
 assert.equal(next.annotations.a.note,'A new note');assert.equal(next.annotations.a.private,true);assert(next.favoriteIds.includes('a'));
 assert(!next.collections.find(x=>x.id==='one').cardIds.includes('a'));assert(next.collections.find(x=>x.id==='two').cardIds.includes('a'));assert(next.collections.find(x=>x.id==='new-folder').cardIds.includes('a'));
 assert.deepEqual(f.state,before);
});
test('concurrent body changes and unrelated new memberships are retained',()=>{
 const f=fixture();let state=workspaceReducer(f.state,{type:'card.upsert',card:{...f.card,body:'Edited in another window'}});
 state=workspaceReducer(state,{type:'collection.upsert',collection:{id:'other',title:'Other',cardIds:['a']}});
 const next=applySaveOptions(state,f.card,f.base,{...f.value,note:'My note',collectionIds:['one','two']});
 assert.equal(next.cards[0].body,'Edited in another window');assert(next.collections.find(x=>x.id==='other').cardIds.includes('a'));
 assert(next.collections.find(x=>x.id==='two').cardIds.includes('a'));
});
test('a conflicting note or changed archive state refuses the whole write',()=>{
 const f=fixture();
 const latest=workspaceReducer(f.state,{type:'card.note',id:'a',note:'Other window note'}),before=structuredClone(latest);
 assert.throws(()=>applySaveOptions(latest,f.card,f.base,{...f.value,note:'My note',favorite:true}),/其他窗口/);assert.deepEqual(latest,before);
 assert.throws(()=>applySaveOptions(workspaceReducer(f.state,{type:'card.hide',id:'a',hidden:true}),f.card,f.base,{...f.value,favorite:true}),/归档/);
 assert.throws(()=>applySaveOptions(f.state,{...f.card,id:'other'},f.base,f.value),/目标/);
});
test('a disappearing collection can be deselected and a same-name new collection is reused',()=>{
 const f=fixture();const state=workspaceReducer(f.state,{type:'collection.delete',id:'two'});
 assert.throws(()=>applySaveOptions(state,f.card,f.base,{...f.value,collectionIds:['one','two'],favorite:true}),/已被移除/);
 const next=applySaveOptions(state,f.card,f.base,{...f.value,newCollectionTitle:' first '});
 assert.equal(next.collections.length,1);assert.equal(next.collections[0].title,'First');
 assert.equal(next.cards.length,1);
});
test('Vault card options stay local and do not create a duplicate source card',()=>{
 const state=createWorkspaceState(),card={id:'vault/path.md',origin:'vault',title:'Vault source',body:'Original'};
 const base=saveOptionsSnapshot(state,card,true),value={...base,note:'Local note',favorite:true,collectionIds:[]};
 const next=applySaveOptions(state,card,base,value);assert.equal(next.cards.length,0);assert.equal(next.annotations[card.id].note,'Local note');assert(next.favoriteIds.includes(card.id));assert.equal(card.body,'Original');
});
test('an unsaved card is persisted only when the form is submitted and retry keeps one card',()=>{
 const state=createWorkspaceState(),card={id:'preview',type:'text',title:'Preview',body:'Original'};
 const base=saveOptionsSnapshot(state,card),value={...base,note:'Saved together',favorite:true};
 const one=applySaveOptions(state,card,base,value),two=applySaveOptions(one,card,base,value);
 assert.equal(state.cards.length,0);assert.equal(one.cards.length,1);assert.equal(two.cards.length,1);assert.equal(two.annotations.preview.note,'Saved together');assert(two.favoriteIds.includes('preview'));
});
test('storage failure cannot partially apply the form metadata',async()=>{
 const f=fixture();let stored=structuredClone(f.state);
 const store={loadSnapshot:async()=>({state:stored,revision:0,entityVersions:{}}),update:async update=>{update(stored,{revision:0,entityVersions:{}});throw Error('disk failure');}};
 const session=createWorkspaceSession(store);await session.load();
 await assert.rejects(session.commit(current=>applySaveOptions(current,f.card,f.base,{...f.value,note:'New note',favorite:true,newCollectionTitle:'Not committed'})),/disk failure/);
 assert.deepEqual(stored,f.state);assert.deepEqual(session.state.cards,f.state.cards);
});
test('save popovers stay within the desktop viewport for either column and lower cards',()=>{
 for(const anchor of [{right:180,top:70,bottom:104},{right:1435,top:740,bottom:774}]){
  const p=savePanelPosition(anchor,{height:420},{width:1440,height:850});
  assert(p.left>=16&&p.left+p.width<=1424);assert(p.top>=16&&p.top+420<=834);
 }
});
