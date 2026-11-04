import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStarMap,collectTopics,searchStarCards} from '../src/sublime/starHomeModel.js';
import {createWorkspaceState,selectCards} from '../src/sublime/workspaceModel.js';

const card=(id,overrides={})=>({id,title:`资料 ${id}`,type:'text',tags:[],...overrides});
const position=({id,x,y,z,topics})=>({id,x,y,z,topics});
function frozen(value){
  if(value&&typeof value==='object'){
    Object.freeze(value);
    for(const child of Object.values(value))frozen(child);
  }
  return value;
}

test('empty libraries contain no invented records or unclassified cluster',()=>{
  assert.deepEqual(buildStarMap([],createWorkspaceState()),{nodes:[],clusters:[]});
  assert.deepEqual(buildStarMap(),{nodes:[],clusters:[]});
  assert.deepEqual(searchStarCards([],createWorkspaceState(),'摄影'),[]);
});

test('tags and either side of collection membership form distinct existing topics',()=>{
  const state={...createWorkspaceState(),collections:[
    {id:'a',title:'摄影',cardIds:['one']},
    {id:'b',title:'夜行',cardIds:[]},
    {id:'c',title:'另一收藏集',cardIds:[]},
  ],annotations:{one:{collectionIds:['b','missing']}}};
  assert.deepEqual(collectTopics(card('one',{tags:[' 摄影 ','光影','光影','']}),state),[
    {id:'topic:光影',title:'光影'},
    {id:'topic:夜行',title:'夜行'},
    {id:'topic:摄影',title:'摄影'},
  ]);
  assert.deepEqual(collectTopics(card('two'),state),[{id:'unclassified',title:'未归类'}]);
});

test('same named tag and collection merge across Unicode spelling and case',()=>{
  const state={...createWorkspaceState(),collections:[{id:'c',title:'Café  笔记',cardIds:['a']}]};
  assert.deepEqual(collectTopics(card('a',{tags:['cafe\u0301 笔记','CAFÉ 笔记']}),state),[
    {id:'topic:café 笔记',title:'Café 笔记'},
  ]);
});

test('one stable star per ID, with hidden records and invalid identities excluded',()=>{
  const first=card('same',{title:'首份'}),state={...createWorkspaceState(),hiddenIds:['hidden']};
  const map=buildStarMap([first,card('same',{title:'重复'}),card('hidden'),null,card(''),card(' ')],state);
  assert.equal(map.nodes.length,1);
  assert.strictEqual(map.nodes[0].card,first);
  assert.equal(map.clusters[0].count,1);
});

test('multiple themes keep one star between centers and count explicit memberships',()=>{
  const state=createWorkspaceState(),cards=[
    card('both',{tags:['视觉设计','文学']}),
    card('visual',{tags:['视觉设计']}),
    card('book',{type:'book',tags:['文学']}),
  ];
  const map=buildStarMap(cards,state),node=map.nodes.find(item=>item.id==='both');
  assert.equal(map.nodes.length,3);
  assert.deepEqual(map.clusters.map(group=>group.count),[2,2]);
  assert.equal(node.topics.length,2);
  for(const [axis,tolerance] of [['x',26],['y',23],['z',30]]){
    const midpoint=map.clusters.reduce((sum,group)=>sum+group[axis],0)/2;
    assert.ok(Math.abs(node[axis]-midpoint)<=tolerance);
  }
  assert.equal(map.nodes.find(item=>item.id==='book').card.type,'book');
});

test('positions are deterministic under reordering and unrelated additions',()=>{
  const state=createWorkspaceState(),cards=Array.from({length:60},(_,index)=>card(`中文-${index}`,{tags:[`主题 ${index%4}`]}));
  const original=buildStarMap(cards,state);
  assert.deepEqual(buildStarMap([...cards].reverse(),state),original);
  const extra=buildStarMap([...cards,card('新内容',{tags:['新主题']})],state);
  assert.deepEqual(extra.nodes.filter(node=>node.id!=='新内容').map(position),original.nodes.map(position));
});

test('large synthetic libraries retain depth, unique offsets, and bounded coordinates',()=>{
  const cards=Array.from({length:4000},(_,index)=>card(`material-${index}`,{tags:[`主题 ${index%31}`]}));
  const {nodes,clusters}=buildStarMap(cards,createWorkspaceState());
  assert.equal(nodes.length,4000);
  assert.equal(clusters.length,31);
  assert.equal(new Set(nodes.map(node=>[node.x,node.y,node.z].join(','))).size,nodes.length);
  for(const node of nodes){
    assert.ok(Number.isFinite(node.labelPriority));
    assert.ok(Math.abs(node.x)<=380&&Math.abs(node.y)<=210&&Math.abs(node.z)<=180);
  }
  assert.ok(Math.max(...nodes.map(node=>node.z))-Math.min(...nodes.map(node=>node.z))>200);
  assert.ok(Math.max(...nodes.map(node=>node.x))-Math.min(...nodes.map(node=>node.x))>500);
});

test('search reuses library fields and AND matching without moving or mutating stars',()=>{
  const cards=frozen([
    card('book',{type:'book',title:'中国建筑',author:'林徽因',tags:['建筑'],body:'木构材料'}),
    card('ocr',{title:'照片',ocrText:'中国 建筑 摄影'}),
    card('indexed',{title:'文档',documentIndex:{text:'中国 建筑 测绘'}}),
    card('note',{title:'随笔'}),
    card('partial',{title:'中国绘画'}),
    card('hidden',{title:'中国建筑'}),
  ]);
  const state=frozen({...createWorkspaceState(),hiddenIds:['hidden'],annotations:{note:{note:'中国 建筑 印象',collectionIds:[]}}});
  const before=buildStarMap(cards,state),query='中国 建筑';
  const actual=searchStarCards(cards,state,query);
  const expected=selectCards(cards,state,{query,sort:'relevant'});
  assert.deepEqual(actual,expected);
  assert.deepEqual(new Set(actual.map(item=>item.id)),new Set(['book','ocr','indexed','note']));
  assert.deepEqual(buildStarMap(cards,state),before);
  assert.deepEqual(searchStarCards(cards,state,'林徽因').map(item=>item.id),['book']);
  assert.deepEqual(searchStarCards(cards,state,'不存在'),[]);
});
