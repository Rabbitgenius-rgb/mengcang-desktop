import React from 'react';
import { initialFilters } from './constants.js';
import { attachmentFiles } from './constants.js';
import { routeFromHash } from './constants.js';
import { workspaceSearchScope } from './constants.js';
import { useMemo, useRef } from 'react';
import { createWorkspaceStoreV3 as createWorkspaceStore } from '../workspaceStoreV3.js';
import { createWorkspaceSession } from '../workspacePersistence.js';
import { createWorkspaceNavigation } from '../workspaceNavigation.js';
import { initialStarView } from '../starHomeView.js';
export function useWorkspaceRuntime({
  demo,
  identity,
  api,
  state,
  modal,
  route,
  filters,
  shuffle,
  collectionQuery,
  selected,
  selectionMode,
  starView,
  setRoute,
  setStarView,
  setFilters,
  setShuffle,
  setCollectionQuery,
  setSelected,
  setSelectionMode,
  setEditorDraft,
  setPopover,
  setModal,
  setToast,
}) {
  const identityId = demo ? 'browser-preview' : String(identity?.id || identity?.vaultId || 'unpaired');
  const apiRef = useRef(api);
  apiRef.current = api;
  const sessions = useRef(new Map());
  const session = useMemo(() => {
    if (!sessions.current.has(identityId))
      sessions.current.set(identityId, createWorkspaceSession(createWorkspaceStore(identityId, { attachments: attachmentFiles })));
    return sessions.current.get(identityId);
  }, [identityId]);
  const stateRef = useRef(state),
    epoch = useRef(0),
    loadedIdentity = useRef(null),
    root = useRef(null),
    toastTimer = useRef(null),
    draftRef = useRef({}),
    backupInput = useRef(null);
  const readerFlush = useRef(null);
  const registerReaderFlush = useMemo(
    () => (value) => {
      readerFlush.current = value;
    },
    [],
  );
  const aiRequests = useRef(new Set()),
    aiVolatile = useRef(new Map()),
    podcastRequests = useRef(new Set()),
    podcastVolatile = useRef(new Map()),
    podcastJobs = useRef(new Set());
  const viewRef = useRef(null),
    scrollRestore = useRef(null),
    navigationMounted = useRef(false),
    modalRef = useRef(modal),
    backupRead = useRef(0),
    sourceOpen = useRef(0),
    documentJobs = useRef(new Map()),
    documentWaiters = useRef(new Set()),
    viewVersion = useRef(0);
  if ((viewRef.current && viewRef.current.route !== route) || modalRef.current !== modal) viewVersion.current++;
  viewRef.current = { route, filters, shuffle, collectionQuery, selected, selectionMode, starView };
  modalRef.current = modal;
  const searchCache = useMemo(() => ({ identityId, values: new Map() }), [identityId]);
  const searches = searchCache.values;
  const activeSearchScope = workspaceSearchScope(route);
  const navigation = useMemo(
    () =>
      createWorkspaceNavigation({
        history: window.history,
        location: window.location,
        identity: identityId,
        snapshot: () => ({ ...viewRef.current, scrollTop: root.current?.scrollTop || 0, scrollLeft: root.current?.scrollLeft || 0 }),
        fallback: () => (!demo && !location.hash ? { page: 'library', id: '', sourcePage: 1 } : routeFromHash()),
        safeFallback: () => ({
          route: { page: 'home', id: '', sourcePage: 1 },
          filters: initialFilters,
          shuffle: 0,
          collectionQuery: '',
          selected: [],
          selectionMode: false,
          starView: initialStarView(),
        }),
        restore: (value) => {
          scrollRestore.current = value;
          setRoute(value.route);
          setStarView(value.starView || initialStarView());
          setFilters(value.filters);
          setShuffle(value.shuffle || 0);
          setCollectionQuery(value.collectionQuery || '');
          setSelected(value.selected || []);
          setSelectionMode(!!value.selectionMode);
          setEditorDraft(undefined);
          setPopover(null);
          setModal(null);
        },
      }),
    [demo, identityId, setCollectionQuery, setEditorDraft, setFilters, setModal, setPopover, setRoute, setSelected, setSelectionMode, setShuffle, setStarView],
  );
  const notify = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  };
  const coverJobs = useRef(null);
  return {
    identityId,
    apiRef,
    sessions,
    session,
    stateRef,
    epoch,
    loadedIdentity,
    root,
    toastTimer,
    draftRef,
    backupInput,
    readerFlush,
    registerReaderFlush,
    aiRequests,
    aiVolatile,
    podcastRequests,
    podcastVolatile,
    podcastJobs,
    viewRef,
    scrollRestore,
    navigationMounted,
    modalRef,
    backupRead,
    sourceOpen,
    documentJobs,
    documentWaiters,
    viewVersion,
    searches,
    activeSearchScope,
    navigation,
    notify,
    coverJobs,
  };
}
