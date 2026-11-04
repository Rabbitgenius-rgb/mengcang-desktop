import test from 'node:test';
import assert from 'node:assert/strict';
import {initialStarView,changeStarQuery,reconcileStarView} from '../src/sublime/starHomeView.js';
import {createWorkspaceNavigation} from '../src/sublime/workspaceNavigation.js';

test('clear search restores the browsing camera and selected card after viewing other matches',()=>{
 const initial={...initialStarView(),camera:{yaw:.4,pitch:-.2,zoom:1.3},selectedId:'before'};
 const started=changeStarQuery(initial,'海棠');
 assert.equal(started.selectedId,null);
 const explored={...started,selectedId:'matched',camera:{yaw:-.3,pitch:0,zoom:.8}};
 assert.deepEqual(changeStarQuery(explored,''),initial);
 assert.equal(initial.query,'');
});
test('editing search and whitespace do not overwrite the original browsing context',()=>{
 const initial={...initialStarView(),selectedId:'original'};
 let searching=changeStarQuery(initial,'book');
 searching=changeStarQuery({...searching,selectedId:'result'},'books');
 assert.deepEqual(changeStarQuery(searching,'  ').camera,initial.camera);
 assert.equal(changeStarQuery(searching,'  ').selectedId,'original');
});
test('archived selections no longer pause an empty preview or return after clearing search',()=>{
 const original={...initialStarView(),selectedId:'archived'};
 const searching={...changeStarQuery(original,'book'),selectedId:'removed-result'};
 const next=reconcileStarView(searching,new Set(['remaining']));
 assert.equal(next.selectedId,null);assert.equal(next.beforeSearch.selectedId,null);
 assert.equal(changeStarQuery(next,'').selectedId,null);
 assert.deepEqual(next.camera,original.camera);assert.equal(next.query,'book');
 assert.equal(reconcileStarView(next,new Set(['remaining'])),next);
});
test('detail and reader navigation restore independent home snapshots',()=>{
 let index=0,entries=[{state:{},hash:'#/home'}];
 const location={get hash(){return entries[index].hash;}};
 const history={get state(){return entries[index].state;},replaceState(state,_,hash){entries[index]={state:structuredClone(state),hash:hash||location.hash};},pushState(state,_,hash){entries.splice(++index);entries.push({state:structuredClone(state),hash});},back(){index=Math.max(0,index-1);}};
 let view={route:{page:'home',id:''},starView:{...initialStarView(),selectedId:'a',camera:{yaw:.3,pitch:.2,zoom:1.4}},filters:{}};
 const original=structuredClone(view.starView);
 const navigation=createWorkspaceNavigation({history,location,identity:'review',snapshot:()=>view,restore:value=>{view=value;},fallback:()=>({page:'home',id:''})});
 for(const page of ['card','reader']){
  navigation.open({page,id:'a'});view.starView.camera.zoom=.8;
  navigation.back();navigation.restoreCurrent();
  assert.equal(view.route.page,'home');assert.deepEqual(view.starView,original);
 }
});
