import { selectCards } from './workspaceModel.js';

// A read-only projection of the library. Topic membership is explicit metadata;
// the map never infers relations, updates a card, or persists a primary topic.
const UNCLASSIFIED = Object.freeze({ id: 'unclassified', title: '未归类' });
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
const cleanTitle = (value) => (typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '');
const validId = (value) => typeof value === 'string' && value.trim() !== '' && !/[\x00-\x1f\x7f]/.test(value);
const topicFromTitle = (value) => {
  const title = cleanTitle(value);
  return title ? { id: `topic:${title.toLowerCase()}`, title } : null;
};

function unitHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  // Final mixing avoids adjacent identifiers forming rows or visible contours.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}
const scatter = (id, axis, extent) => (unitHash(`${axis}:${id}`) * 2 - 1) * extent;

function topicLookup(state) {
  const collections = new Map(),
    memberships = new Map();
  const sorted = (Array.isArray(state?.collections) ? state.collections : [])
    .filter((collection) => collection && validId(collection.id))
    .slice()
    .sort((a, b) => compare(a.id, b.id));
  for (const collection of sorted) {
    const topic = topicFromTitle(collection.title);
    if (!topic) continue;
    collections.set(collection.id, topic);
    for (const cardId of Array.isArray(collection.cardIds) ? collection.cardIds : []) {
      if (!validId(cardId)) continue;
      if (!memberships.has(cardId)) memberships.set(cardId, new Set());
      memberships.get(cardId).add(collection.id);
    }
  }
  return { collections, memberships, annotations: state?.annotations || {} };
}

function topicsFor(card, lookup) {
  const topics = new Map(),
    add = (topic) => {
      if (topic && !topics.has(topic.id)) topics.set(topic.id, topic);
    };
  const annotation = Object.hasOwn(lookup.annotations, card?.id) ? lookup.annotations[card.id] : null;
  const collectionIds = new Set([...(lookup.memberships.get(card?.id) || []), ...(Array.isArray(annotation?.collectionIds) ? annotation.collectionIds : [])]);
  // Collection names retain their visible spelling when a tag has the same name.
  for (const id of [...collectionIds].sort(compare)) add(lookup.collections.get(id));
  const tags = (Array.isArray(card?.tags) ? card.tags : [])
    .map(topicFromTitle)
    .filter(Boolean)
    .sort((a, b) => compare(a.id, b.id) || compare(a.title, b.title));
  for (const topic of tags) add(topic);
  return topics.size ? [...topics.values()].sort((a, b) => compare(a.id, b.id)) : [{ ...UNCLASSIFIED }];
}

/** Existing tags and collection memberships; no generated semantic categories. */
export function collectTopics(card, state) {
  return topicsFor(card, topicLookup(state));
}

function uniqueVisibleCards(cards, state) {
  const hidden = new Set(Array.isArray(state?.hiddenIds) ? state.hiddenIds : []),
    unique = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !validId(card.id) || hidden.has(card.id) || unique.has(card.id)) continue;
    // The caller's first record is authoritative if duplicate IDs were supplied.
    unique.set(card.id, card);
  }
  return [...unique.values()];
}

/**
 * Stable world coordinates, independent of the search query and input order.
 * Topic centers form a loose diagonal field; each ID supplies its own offsets.
 */
export function buildStarMap(cards, state) {
  const source = uniqueVisibleCards(cards, state).sort((a, b) => compare(a.id, b.id)),
    lookup = topicLookup(state),
    groups = new Map();
  const entries = source.map((card) => ({ card, topics: topicsFor(card, lookup) }));
  for (const { topics } of entries)
    for (const topic of topics) {
      const current = groups.get(topic.id);
      if (current) {
        current.count++;
        continue;
      }
      const x = scatter(topic.id, 'topic-x', 245);
      groups.set(topic.id, {
        ...topic,
        x,
        y: -x * 0.2 + scatter(topic.id, 'topic-y', 65),
        z: scatter(topic.id, 'topic-z', 85),
        count: 1,
      });
    }
  const clusters = [...groups.values()].sort((a, b) => compare(a.id, b.id));
  const favoriteIds = new Set(Array.isArray(state?.favoriteIds) ? state.favoriteIds : []);
  const nodes = entries.map(({ card, topics }) => {
    const centers = topics.map((topic) => groups.get(topic.id)),
      count = centers.length;
    const center = (axis) => centers.reduce((sum, topic) => sum + topic[axis], 0) / count;
    // Multi-topic records are one star near the midpoint of their own themes.
    const spread = count > 1 ? { x: 26, y: 23, z: 30 } : { x: 118, y: 70, z: 86 };
    return {
      id: card.id,
      card,
      x: clamp(center('x') + scatter(card.id, 'node-x', spread.x), 380),
      y: clamp(center('y') + scatter(card.id, 'node-y', spread.y), 210),
      z: clamp(center('z') + scatter(card.id, 'node-z', spread.z), 180),
      topics: centers.map(({ id, title }) => ({ id, title })),
      labelPriority: (favoriteIds.has(card.id) ? 1 : 0) + unitHash(`label:${card.id}`),
    };
  });
  return { nodes, clusters };
}

/** Uses the same fields, AND-term matching, and relevance ordering as the library. */
export function searchStarCards(cards, state, query = '') {
  return selectCards(uniqueVisibleCards(cards, state), state, { query, sort: 'relevant' });
}
