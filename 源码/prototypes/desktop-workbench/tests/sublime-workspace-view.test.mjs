import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceState, normalizeWorkspaceState, serializeWorkspace} from '../src/sublime/workspaceModel.js';
import {selectWorkspaceCards} from '../src/sublime/workspaceView.js';

const card = (id, extra = {}) => ({id, title:id, body:'Synthetic topic', type:'text', createdAt:'2026-01-01', origin:'local', ...extra});
const ids = cards => cards.map(card => card.id);
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const select = (cards, state, sort, options = {}) => selectWorkspaceCards(cards, state, {...options, filters:{...options.filters, sort}});

test('popular and least only partition favorites, preserving input order within each rank', () => {
  const cards = freeze([
    card('ordinary-first', {createdAt:'2024-01-01'}),
    card('favorite-first', {createdAt:'2023-01-01'}),
    card('ordinary-last', {createdAt:'2026-01-01'}),
    card('favorite-last', {createdAt:'2025-01-01'}),
  ]);
  const state = freeze({...createWorkspaceState(), favoriteIds:['favorite-last', 'favorite-first']});
  assert.deepEqual(ids(select(cards, state, 'popular')), ['favorite-first', 'favorite-last', 'ordinary-first', 'ordinary-last']);
  assert.deepEqual(ids(select(cards, state, 'least')), ['ordinary-first', 'ordinary-last', 'favorite-first', 'favorite-last']);
  assert.deepEqual(ids(cards), ['ordinary-first', 'favorite-first', 'ordinary-last', 'favorite-last']);
});

test('duplicate, absent, empty and all-favorite memberships retain stable ordering', () => {
  const cards = freeze([card('a'), card('b'), card('c')]);
  for (const sort of ['popular', 'least']) {
    for (const favoriteIds of [[], ['absent'], ['c', 'a', 'b', 'a']]) {
      const state = freeze({...createWorkspaceState(), favoriteIds});
      assert.deepEqual(ids(select(cards, state, sort)), ['a', 'b', 'c']);
      assert.deepEqual(select([], state, sort), []);
    }
    const favoriteIds = ['b', 'absent', 'b'];
    const state = freeze({...createWorkspaceState(), favoriteIds});
    assert.deepEqual(ids(select(cards, state, sort)), sort === 'popular' ? ['b', 'a', 'c'] : ['a', 'c', 'b']);
    assert.deepEqual(state.favoriteIds, ['b', 'absent', 'b']);
  }
});

test('favorite ranking preserves exact raw ID matching rather than normalizing the comparison', () => {
  const cards = freeze([card('ordinary'), card('a')]);
  const state = freeze({...createWorkspaceState(), favoriteIds:[' a ']});
  // selectCards normalizes membership for filtering, but this view's rank uses
  // the supplied array's exact IDs. Keep that distinction in this optimization.
  assert.deepEqual(ids(select(cards, state, 'popular')), ['ordinary', 'a']);
  assert.deepEqual(ids(select(cards, state, 'least')), ['ordinary', 'a']);
  assert.deepEqual(ids(select(cards, state, 'popular', {route:{page:'favorites'}})), ['a']);
});

test('favorite ranking runs after library, hidden, favorites and collection filtering', () => {
  const cards = freeze([
    card('ordinary'), card('favorite'), card('hidden-ordinary'),
    card('hidden-favorite'), card('outside-favorite'),
  ]);
  const state = freeze(normalizeWorkspaceState({
    savedIds:['ordinary', 'favorite', 'hidden-ordinary', 'hidden-favorite'],
    favoriteIds:['favorite', 'hidden-favorite', 'outside-favorite'],
    hiddenIds:['hidden-ordinary', 'hidden-favorite'],
    collections:[{id:'collection', title:'Synthetic collection', cardIds:['ordinary', 'favorite', 'hidden-favorite']}],
  }));
  const cases = [
    [{page:'library'}, ['favorite', 'ordinary'], ['ordinary', 'favorite']],
    [{page:'favorites'}, ['favorite', 'outside-favorite'], ['favorite', 'outside-favorite']],
    [{page:'trash'}, ['hidden-favorite', 'hidden-ordinary'], ['hidden-ordinary', 'hidden-favorite']],
    [{page:'collection', id:'collection'}, ['favorite', 'ordinary'], ['ordinary', 'favorite']],
    [{page:'collection', id:'missing'}, [], []],
  ];
  for (const [route, popular, least] of cases) {
    assert.deepEqual(ids(select(cards, state, 'popular', {route})), popular);
    assert.deepEqual(ids(select(cards, state, 'least', {route})), least);
  }
  assert.deepEqual(ids(select(cards, state, 'least', {route:{page:'collection', id:'collection'}, filters:{favorite:true}})), ['favorite']);
});

test('query and media constraints still intersect with favorite ranking', () => {
  const cards = freeze([card('ordinary'), card('favorite'), card('link', {type:'link'}), card('other', {body:'Unrelated'})]);
  const state = freeze({...createWorkspaceState(), favoriteIds:['favorite', 'link', 'other']});
  const options = {filters:{media:'Notes', query:'topic'}};
  assert.deepEqual(ids(select(cards, state, 'popular', options)), ['favorite', 'ordinary']);
  assert.deepEqual(ids(select(cards, state, 'least', options)), ['ordinary', 'favorite']);
});

test('favorite ranks preserve the preceding shuffle order, including equal shuffle scores', () => {
  const cards = freeze(['z', 'BB', 'Aa', 'x', 'a', 'b'].map(id => card(id)));
  const state = freeze({...createWorkspaceState(), favoriteIds:['BB', 'Aa', 'b']});
  const shuffle = 13;
  const score = id => [...id].reduce((sum, c) => (sum * 31 + c.charCodeAt(0) + shuffle) % 997, 0);
  assert.equal(score('BB'), score('Aa'));
  const shuffled = [...cards].sort((a, b) => score(a.id) - score(b.id));
  const favorite = shuffled.filter(card => state.favoriteIds.includes(card.id));
  const ordinary = shuffled.filter(card => !state.favoriteIds.includes(card.id));
  assert.deepEqual(ids(select(cards, state, 'popular', {shuffle})), ids([...favorite, ...ordinary]));
  assert.deepEqual(ids(select(cards, state, 'least', {shuffle})), ids([...ordinary, ...favorite]));
  assert.ok(ids(favorite).indexOf('BB') < ids(favorite).indexOf('Aa'));
});

test('read-only native membership intersects with favorite, hidden and collection filters without entering persisted state', () => {
  const state = freeze(normalizeWorkspaceState({
    cards:[card('local')], savedIds:['local'],
    favoriteIds:['native-favorite', 'native-hidden'], hiddenIds:['native-hidden'],
    collections:[{id:'mixed', title:'Synthetic mixed collection', cardIds:['local', 'native-favorite', 'native-hidden']}],
  }));
  const native = freeze([card('native-ordinary', {origin:'vault'}), card('native-favorite', {origin:'vault'}), card('native-hidden', {origin:'vault'})]);
  const cards = freeze([native[0], state.cards[0], native[1], native[2]]);
  const readOnlySavedIds = freeze(native.map(card => card.id));
  const before = structuredClone({cards, state, readOnlySavedIds});
  const persisted = serializeWorkspace(state);
  const result = select(cards, state, 'popular', {route:{page:'library'}, readOnlySavedIds});
  assert.deepEqual(ids(result), ['native-favorite', 'native-ordinary', 'local']);
  assert.strictEqual(result[0], native[1]);
  assert.deepEqual(ids(select(cards, state, 'least', {route:{page:'collection', id:'mixed'}, filters:{inLibrary:true}, readOnlySavedIds})), ['local', 'native-favorite']);
  assert.deepEqual(ids(select(cards, state, 'popular', {route:{page:'favorites'}, readOnlySavedIds})), ['native-favorite']);
  assert.deepEqual(ids(select(cards, state, 'least', {route:{page:'trash'}, filters:{inLibrary:true}, readOnlySavedIds})), ['native-hidden']);
  assert.deepEqual({cards, state, readOnlySavedIds}, before);
  assert.equal(serializeWorkspace(state), persisted);
  const restored = JSON.parse(persisted);
  for (const field of ['savedIds', 'favoriteIds', 'hiddenIds']) assert.ok(Array.isArray(restored[field]), field);
  assert.deepEqual(restored.savedIds, ['local']);
  assert.deepEqual(ids(restored.cards), ['local']);
});

test('read-only candidate count may exceed 20,000 while persisted membership remains bounded', () => {
  // Candidate count is independent of the persisted workspace's array limits.
  const cards = freeze(Array.from({length:20001}, (_, index) => card(`native-${index}`, {origin:'vault'})));
  const state = freeze({...createWorkspaceState(), savedIds:['native-0', 'native-20000'], favoriteIds:['native-20000']});
  assert.deepEqual(ids(select(cards, state, 'popular', {route:{page:'library'}})), ['native-20000', 'native-0']);
  assert.deepEqual(ids(select(cards, state, 'least', {route:{page:'library'}})), ['native-0', 'native-20000']);
  assert.equal(state.cards.length, 0);
  assert.equal(cards.length, 20001);
});

test('replacement favorite arrays take effect on the next selection without mutating prior state', () => {
  const cards = freeze([card('a'), card('b'), card('c')]);
  const previous = freeze({...createWorkspaceState(), favoriteIds:['b']});
  const next = freeze({...previous, favoriteIds:['c']});
  assert.deepEqual(ids(select(cards, previous, 'popular')), ['b', 'a', 'c']);
  assert.deepEqual(ids(select(cards, next, 'popular')), ['c', 'a', 'b']);
  assert.deepEqual(ids(select(cards, next, 'least')), ['a', 'b', 'c']);
  assert.deepEqual(previous.favoriteIds, ['b']);
});

test('read-only identity context validates every member including sparse array holes',()=>{
 const state=createWorkspaceState(),cards=[card('native')];
 for(const readOnlySavedIds of [Array(1),['native',null],['native',42],['__proto__'],['bad\0id'],'native']){
  assert.throws(()=>select(cards,state,'newest',{route:{page:'library'},readOnlySavedIds}),/只读来源卡片/);
 }
 assert.deepEqual(ids(select(cards,state,'newest',{route:{page:'library'},readOnlySavedIds:['native','native']})),['native']);assert.deepEqual(state,createWorkspaceState());
});
