import { useState } from 'react';
import { createWorkspaceState } from '.././workspaceModel.js';
import { initialStarView } from '.././starHomeView.js';
import { initialFilters, routeFromHash } from './constants.js';

export function useWorkspaceState({ demo }) {
  const [state, setState] = useState(createWorkspaceState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [readerNavigation, setReaderNavigation] = useState(null);
  const [articleNavigation, setArticleNavigation] = useState(null);
  const [, setAiRevision] = useState(0);
  const [recoveryEditorVersion, setRecoveryEditorVersion] = useState(0);
  const [starView, setStarView] = useState(initialStarView);
  const [route, setRoute] = useState(() => (!demo && !location.hash ? { page: 'library', id: '' } : routeFromHash()));
  const [filters, setFilters] = useState(initialFilters);
  const [filterDraft, setFilterDraft] = useState(initialFilters);
  const [popover, setPopover] = useState(null);
  const [modal, setModal] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [editorDraft, setEditorDraft] = useState(undefined);
  const [moreOptions, setMoreOptions] = useState(false);
  const [selected, setSelected] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [shuffle, setShuffle] = useState(0);
  const [collectionQuery, setCollectionQuery] = useState('');
  const [systemLight, setSystemLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);
  const [checkingSource, setCheckingSource] = useState('');
  return {
    state,
    setState,
    ready,
    setReady,
    error,
    setError,
    toast,
    setToast,
    saving,
    setSaving,
    readerNavigation,
    setReaderNavigation,
    articleNavigation,
    setArticleNavigation,
    setAiRevision,
    recoveryEditorVersion,
    setRecoveryEditorVersion,
    starView,
    setStarView,
    route,
    setRoute,
    filters,
    setFilters,
    filterDraft,
    setFilterDraft,
    popover,
    setPopover,
    modal,
    setModal,
    noteDraft,
    setNoteDraft,
    editorDraft,
    setEditorDraft,
    moreOptions,
    setMoreOptions,
    selected,
    setSelected,
    selectionMode,
    setSelectionMode,
    shuffle,
    setShuffle,
    collectionQuery,
    setCollectionQuery,
    systemLight,
    setSystemLight,
    checkingSource,
    setCheckingSource,
  };
}
