const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Only the editor's active relation fields are changed. The original references
// remain in inert draft metadata for manual comparison and future exports.
export function sanitizeBackupDraftReferences(value, allowedIds, collectionIds) {
  if (!record(value)) return value;
  const changes = {};
  const removed = {};
  if (value.sourceCardId && !allowedIds.has(value.sourceCardId)) {
    removed.sourceCardId = value.sourceCardId;
    changes.sourceCardId = '';
  }
  if (value.articleFigure && !allowedIds.has(value.sourceCardId)) {
    removed.articleFigure = value.articleFigure;
    changes.articleFigure = undefined;
  }
  if (Array.isArray(value.cardIds)) {
    const cardIds = value.cardIds.filter((id) => allowedIds.has(id));
    if (cardIds.length !== value.cardIds.length) {
      removed.cardIds = value.cardIds;
      changes.cardIds = cardIds;
    }
  }
  if (value.collectionId && !collectionIds.has(value.collectionId)) {
    removed.collectionId = value.collectionId;
    changes.collectionId = '';
  }
  if (Array.isArray(value.collectionIds)) {
    const memberships = value.collectionIds.filter((id) => collectionIds.has(id));
    if (memberships.length !== value.collectionIds.length) {
      removed.collectionIds = value.collectionIds;
      changes.collectionIds = memberships;
    }
  }
  if (Array.isArray(value.nodes)) {
    const nodes = value.nodes.filter((node) => record(node) && allowedIds.has(node.itemPath));
    if (nodes.length !== value.nodes.length) {
      removed.nodes = value.nodes;
      changes.nodes = nodes;
      if (Array.isArray(value.edges)) {
        const nodeIds = new Set(nodes.map((node) => node.id));
        removed.edges = value.edges;
        changes.edges = value.edges.filter((edge) => record(edge) && nodeIds.has(edge.from) && nodeIds.has(edge.to));
      }
    }
  }
  if (!Object.keys(removed).length) return value;
  const result = {
    ...value,
    ...changes,
    backupSourceReferences: { ...(record(value.backupSourceReferences) ? value.backupSourceReferences : {}), ...removed },
  };
  if (Object.hasOwn(changes, 'articleFigure')) delete result.articleFigure;
  return result;
}
