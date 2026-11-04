export const initialStarView = () => ({ camera: { yaw: 0, pitch: 0, zoom: 1 }, selectedId: null, query: '', beforeSearch: null });

export function reconcileStarView(view, ids) {
  const selectedId = view.selectedId && ids.has(view.selectedId) ? view.selectedId : null;
  const beforeSearch =
    view.beforeSearch && view.beforeSearch.selectedId && !ids.has(view.beforeSearch.selectedId)
      ? { ...view.beforeSearch, selectedId: null }
      : view.beforeSearch;
  return selectedId === view.selectedId && beforeSearch === view.beforeSearch ? view : { ...view, selectedId, beforeSearch };
}

// Searching changes emphasis, never the map. Preserve the exact browsing
// context separately so inspecting results does not destroy it.
export function changeStarQuery(view, query) {
  const wasSearching = Boolean(view.query.trim()),
    searching = Boolean(query.trim());
  if (searching && !wasSearching) return { ...view, query, beforeSearch: { camera: { ...view.camera }, selectedId: view.selectedId }, selectedId: null };
  if (!searching && wasSearching) return { ...view, ...(view.beforeSearch || {}), query, beforeSearch: null };
  return { ...view, query, selectedId: searching ? null : view.selectedId };
}
