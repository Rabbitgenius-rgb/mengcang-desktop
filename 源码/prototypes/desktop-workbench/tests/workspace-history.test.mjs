import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyHistory,remember,travel,quickResults} from '../src/workspaceHistory.js';
test('back and forward preserve filters selection and independent scroll positions',()=>{
 const a={view:'inspiration',ui:{selectedId:'a',query:'月',role:'inspiration'},scroll:[{selector:'.inspiration-cards',top:220,left:0}]};
 const b={view:'materials',ui:{selectedId:'b',type:'image',query:'',sort:'title'},scroll:[]};
 let history=remember(emptyHistory(),a);a.ui.query='later';
 let result=travel(history,b,'back');assert.equal(result.target.ui.query,'月');assert.equal(result.target.scroll[0].top,220);
 const again=travel(result.history,result.target,'forward');assert.deepEqual(again.target,b);
 assert.equal(travel(again.history,b,'forward'),null);
});
test('new navigation after going back clears stale forward destinations and bounds memory',()=>{
 let h=remember(emptyHistory(),{view:'a'});const result=travel(h,{view:'b'},'back');
 h=remember(result.history,result.target);assert.equal(h.future.length,0);
 for(let i=0;i<100;i++)h=remember(h,{view:'a',ui:{selectedId:i}});
 assert.equal(h.past.length,80);assert.equal(h.past[0].ui.selectedId,20);
});
test('an open preview stack travels with its history entry',()=>{
 const withPeek={view:'materials',ui:{selectedId:'m'},scroll:[],peek:['a.md','b.md']};
 const h=remember(emptyHistory(),withPeek);withPeek.peek.push('c.md');
 const result=travel(h,{view:'books',ui:{},scroll:[],peek:[]},'back');
 assert.deepEqual(result.target.peek,['a.md','b.md']);
 assert.deepEqual(travel(result.history,result.target,'forward').target.peek,[]);
});
test('global quick open finds Chinese captions, books and projects without duplicate paths',()=>{
 const groups=[['inspiration',[{title:'独有灵感',path:'a.md',caption:'琥珀回声'}]],['materials',[{title:'同一篇',path:'a.md',caption:'琥珀回声'},{path:'b.md',title:'月亮',tags:['星空']}]],['books',[{path:'c.md',title:'远方',author:'作者甲'}]],['projects',[{notePath:'d.md',name:'月球网站',description:'一个创作项目',goal:'展示星空'}]]];
 assert.equal(quickResults(groups,'琥珀回声').length,1);assert.equal(quickResults(groups,'作者甲')[0].view,'books');assert.equal(quickResults(groups,'月球 星空')[0].view,'projects');assert.deepEqual(quickResults(groups,'  '),[]);
});
