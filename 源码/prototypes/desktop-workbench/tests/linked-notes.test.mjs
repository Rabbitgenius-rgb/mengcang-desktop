import assert from 'node:assert/strict';
import test from 'node:test';
import {createLinkedNote, isLinkedNote, linkedNoteRelations, linkedNoteDraftKey, openLinkedNoteDraft} from '../src/sublime/linkedNotes.js';
import {createWorkspaceState, workspaceReducer, parseWorkspaceBackup, serializeWorkspace} from '../src/sublime/workspaceModel.js';
import {selectWorkspaceCards} from '../src/sublime/workspaceView.js';

const article={id:'w3-article', title:'万维网的最初提案', body:'原始全文', type:'article', origin:'local', sourceUrl:'https://www.w3.org/History/1989/proposal.html'};
const createdAt='2026-11-02T04:00:00.000Z';
const firstId='linked-note:11111111-1111-4111-8111-111111111111';
const secondId='linked-note:22222222-2222-4222-8222-222222222222';

test('draft writes are ordered, resumable by source, and cleared only by discard or a successful note save',async()=>{
 let state=savedLibrary(),fail=false;
 const key=linkedNoteDraftKey(article.id);
 const open=(source=article)=>openLinkedNoteDraft({source,initial:state.drafts[linkedNoteDraftKey(source.id)],id:firstId,createdAt,nativeSource:()=>false,
  commit:async apply=>{if(fail)throw Error('写入失败');state=apply(state);}});
 const a=open();await a.flush();assert.equal(state.drafts[key],undefined);
 a.update('title','标题');const first=a.flush();a.update('body','最新正文');await Promise.all([first,a.flush()]);
 assert.equal(state.drafts[key].body,'最新正文');assert(!state.cards.some(isLinkedNote));
 const other=open({...article,id:'other'});other.update('title','另一份草稿');await other.flush();
 const b=open();assert.deepEqual(b.value,a.value);
 fail=true;await assert.rejects(b.publish());assert.equal(state.drafts[key].title,'标题');
 fail=false;await Promise.all([b.publish(),b.flush()]);assert.equal(state.drafts[key],undefined);assert.equal(state.cards.filter(isLinkedNote).length,1);
 await other.discard();await other.flush();assert.equal(state.drafts[linkedNoteDraftKey('other')],undefined);
 assert.equal(state.cards.find(isLinkedNote).body,'最新正文');
});

test('a stale draft cannot overwrite or discard another window’s text',async()=>{
 let state=savedLibrary();
 const open=id=>openLinkedNoteDraft({source:article,id,createdAt,initial:state.drafts[linkedNoteDraftKey(article.id)],nativeSource:()=>false,commit:async apply=>{state=apply(state);}});
 const one=open(firstId);one.update('body','第一稿');await one.flush();
 const two=open(secondId);one.update('body','新的文字');await one.flush();
 two.update('body','另外的修改');
 await assert.rejects(two.flush(),/别处修改/);await two.discard();
 assert.equal(two.value.body,'另外的修改');assert.equal(state.drafts[linkedNoteDraftKey(article.id)].body,'新的文字');
});
const draft={id:firstId, source:article, title:'概念图里的关系', body:'把跨部门索引看成节点之间的连接。', createdAt};

function savedLibrary() {
  return [
    {type:'card.upsert',card:article},
    {type:'card.save',id:article.id,saved:true},
    {type:'card.note',id:article.id,note:'这是文章原来的备注',private:true},
    {type:'card.favorite',id:article.id,value:true},
    {type:'collection.upsert',collection:{id:'reading',title:'浏览器剪藏',cardIds:[article.id]}},
    {type:'draft.set',key:'new:text',value:{body:'我的另一篇未写完的笔记'}},
  ].reduce(workspaceReducer,createWorkspaceState());
}

test('independent written note round-trips and is searchable by its own title or body, without modifying its source',()=>{
  const prior=savedLibrary();
  const saved=createLinkedNote(prior,draft);
  const reopened=parseWorkspaceBackup(serializeWorkspace(saved));
  for (const query of ['概念图里的关系','跨部门索引']) {
    const hits=selectWorkspaceCards(reopened.cards,reopened,{route:{page:'library'},filters:{query,media:'Notes'}});
    assert.deepEqual(hits.map(c=>c.id),[firstId]);
  }
  const note=reopened.cards.find(c=>c.id===firstId);
  assert.ok(isLinkedNote(note));
  assert.equal(note.sourceCardId,article.id);
  assert.equal(note.body,draft.body);
  assert.equal(note.createdAt,createdAt);
  assert.deepEqual({...reopened,cards:reopened.cards.filter(c=>c.id!==firstId),savedIds:reopened.savedIds.filter(id=>id!==firstId)},prior);
});

test('multiple written notes share a stable parent after renames; highlight, image, AI, and text copies are excluded',()=>{
  let state=createLinkedNote(savedLibrary(),draft);
  state=createLinkedNote(state,{...draft,id:secondId,title:'另一个问题'});
  state=workspaceReducer(state,{type:'card.upsert',card:{id:article.id,title:'重命名后的提案'}});
  const source=state.cards.find(c=>c.id===article.id);
  const sameTitle={...article,id:'another-article',title:source.title};
  const otherTypes=['highlight','image','text','text'].map((type,index)=>({type,id:['old-excerpt','old-figure','manual-copy','ai-insight:old'][index],sourceCardId:article.id}));
  const visible=[sameTitle,...otherTypes,...state.cards];
  assert.deepEqual(new Set(linkedNoteRelations(source,visible).notes.map(c=>c.id)),new Set([firstId,secondId]));
  for(const note of state.cards.filter(isLinkedNote)) {
    assert.equal(linkedNoteRelations(note,visible).source.id,source.id);
    assert.equal(linkedNoteRelations(note,visible).source.title,source.title);
    assert.equal(linkedNoteRelations(note,[sameTitle,note]).source,null);
  }
  assert.deepEqual(linkedNoteRelations(sameTitle,visible).notes,[]);
  assert.deepEqual(linkedNoteRelations(source,visible.filter(c=>c.id!==secondId)).notes.map(c=>c.id),[firstId]);
});

test('retrying the same operation is idempotent and cannot overwrite subsequently edited content',()=>{
  let state=createLinkedNote(savedLibrary(),draft);
  assert.deepEqual(createLinkedNote(state,draft),state);
  state=workspaceReducer(state,{type:'card.upsert',card:{id:firstId,body:'另一个窗口已编辑'}});
  const snapshot=structuredClone(state);
  assert.throws(()=>createLinkedNote(state,draft),/笔记已经变化/);
  assert.deepEqual(state,snapshot);
});

test('blank body and vanished or archived sources produce no saved card; native sources are never copied',()=>{
  const prior=savedLibrary();
  const before=structuredClone(prior);
  assert.throws(()=>createLinkedNote(prior,{...draft,body:' \n '}));
  const archived=workspaceReducer(prior,{type:'card.hide',id:article.id,hidden:true});
  assert.throws(()=>createLinkedNote(archived,draft));
  assert.throws(()=>createLinkedNote(createWorkspaceState(),draft));
  assert.deepEqual(prior,before);
  const native={...article,id:'01_sources/proposal.md',origin:'vault'};
  const next=createLinkedNote(createWorkspaceState(),{...draft,source:native,title:'',body:'本机资料启发的观点\n第二段'},true);
  assert.equal(next.cards.length,1);
  assert.equal(next.cards[0].title,'本机资料启发的观点');
  assert.equal(linkedNoteRelations(next.cards[0],[native,...next.cards]).source.id,native.id);
});
