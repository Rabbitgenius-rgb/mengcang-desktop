import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceNavigation,readWorkspaceNavigation,workspaceRouteHash} from '../src/sublime/workspaceNavigation.js';

function browserFixture(identity='preview'){
 const entries=[{state:{parent:'preserved'},hash:'#/staff'}];let index=0;
 const location={get hash(){return entries[index].hash;}};
 const history={get state(){return entries[index].state;},replaceState(state,_,hash){entries[index].state=structuredClone(state);if(hash)entries[index].hash=hash;},pushState(state,_,hash){entries.splice(index+1);entries.push({state:structuredClone(state),hash});index++;},back(){if(index)index--;},forward(){if(index+1<entries.length)index++;}};
 let view={route:{page:'staff',id:''},filters:{query:'listening',media:'Notes'},shuffle:2,selected:['a'],selectionMode:true,scrollTop:420,scrollLeft:0};
 const navigation=createWorkspaceNavigation({history,location,identity,snapshot:()=>view,restore:next=>{view=structuredClone(next);},fallback:()=>({page:'library',id:''})});
 return {history,location,navigation,get view(){return view;},set view(value){view=value;}};
}
test('card back and browser forward restore independent source query, filters and scroll',()=>{
 const b=browserFixture();b.navigation.open({page:'card',id:'a',sourcePage:2});
 assert.equal(b.view.scrollTop,0);assert.deepEqual(b.view.selected,[]);
 b.view.filters.query='detail-query';b.view.scrollTop=180;b.navigation.back();b.navigation.restoreCurrent();
 assert.equal(b.view.route.page,'staff');assert.equal(b.view.filters.query,'listening');assert.equal(b.view.filters.media,'Notes');assert.equal(b.view.scrollTop,420);assert.equal(b.view.shuffle,2);assert.deepEqual(b.view.selected,['a']);
 b.history.forward();b.navigation.restoreCurrent();assert.equal(b.view.route.id,'a');assert.equal(b.view.route.sourcePage,2);assert.equal(b.view.scrollTop,180);assert.equal(b.view.filters.query,'detail-query');assert.equal(b.history.state.parent,'preserved');
});
test('browser back into another identity does not restore its card, query or scroll',()=>{
 const a=browserFixture('identity-a');a.navigation.open({page:'card',id:'private-a'});
 let restored;
 const b=createWorkspaceNavigation({history:a.history,location:a.location,identity:'identity-b',snapshot:()=>a.view,restore:next=>{restored=next;},fallback:()=>({page:'card',id:'private-a'})});
 b.restoreCurrent();assert.equal(restored.route.page,'library');assert.deepEqual(restored.filters,{});assert.equal(restored.scrollTop,0);assert.equal(a.location.hash,'#/library');assert.equal(a.history.state.parent,'preserved');
});
test('new navigation after back replaces the forward branch without sharing mutable snapshots',()=>{
 const b=browserFixture();b.navigation.open({page:'card',id:'a'});b.navigation.back();b.navigation.restoreCurrent();b.navigation.open({page:'favorites',id:''});b.history.forward();
 assert.equal(b.location.hash,'#/favorites');b.view.filters.query='changed';
 assert.equal(readWorkspaceNavigation(b.history.state,'preview',b.location.hash).filters.query,'listening');
});
test('direct link back uses library fallback and another identity cannot restore this workspace',()=>{
 const b=browserFixture();b.navigation.back();assert.equal(b.view.route.page,'library');
 assert.equal(readWorkspaceNavigation(b.history.state,'another',b.location.hash),null);
 assert.equal(readWorkspaceNavigation(b.history.state,'preview','#/other'),null);
 assert.equal(workspaceRouteHash({page:'card',id:'a/b ?中文',sourcePage:7}),'#/card/a%2Fb%20%3F%E4%B8%AD%E6%96%87?page=7');
});
