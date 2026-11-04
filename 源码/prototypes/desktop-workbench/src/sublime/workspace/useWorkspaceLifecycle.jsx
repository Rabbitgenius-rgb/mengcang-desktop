import React from 'react';
import { initialFilters } from './constants.js';
import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createRendererQuitController, lockWorkspaceInput } from '../rendererQuit.js';
import { createWorkspaceState, workspaceReducer, migrateLegacyDiscovery } from '../workspaceModel.js';
import { valueOf } from '../../desktopModel.js';
import { applyBookCover, defaultBookCover } from '../bookCover.js';
import { connectRecallRenderer } from '../recallLibrary.js';
import { connectClipperRenderer } from '../clipperLibrary.js';
import { initialStarView } from '../starHomeView.js';
import { settleWorkspaceBeforeQuit } from '../podcastTranscription.js';
export function useWorkspaceLifecycle({
  ready,
  onReady,
  standalone,
  api,
  session,
  identityId,
  activeSearchScope,
  filters,
  searches,
  navigation,
  route,
  shuffle,
  collectionQuery,
  selected,
  selectionMode,
  starView,
  popover,
  connected,
  state,
  selectedIds,
  meaningActive,
  meaningSearch,
  editId,
  loadedIdentity,
  setError,
  root,
  modalRef,
  readerFlush,
  settleDocumentJobs,
  podcastJobs,
  aiRequests,
  sessions,
  podcastVolatile,
  aiVolatile,
  navigationMounted,
  scrollRestore,
  stateRef,
  draftRef,
  setState,
  setSaving,
  epoch,
  setReady,
  setCheckingSource,
  setEditorDraft,
  setPopover,
  setModal,
  setSelected,
  setSelectionMode,
  setNoteDraft,
  setToast,
  setStarView,
  setFilters,
  setFilterDraft,
  setCollectionQuery,
  setMoreOptions,
  setShuffle,
  setRoute,
  apiRef,
  toastTimer,
  commit,
  coverJobs,
  viewRef,
  clipperView,
  collectionDraftKey,
  setSystemLight,
}) {
  const latestActions = useRef({ commit, settleDocumentJobs });
  latestActions.current = { commit, settleDocumentJobs };
  const invalidateLoad = useCallback(() => {
    epoch.current++;
    clearTimeout(toastTimer.current);
  }, [epoch, toastTimer]);
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);
  useEffect(() => {
    if (!ready || !standalone || loadedIdentity.current !== identityId) return;
    return connectRecallRenderer({ api, session, workspaceId: identityId, isCurrent: () => loadedIdentity.current === identityId });
  }, [ready, standalone, api, session, identityId, loadedIdentity]);
  useEffect(() => {
    if (!api?.subscribe || !api?.rendererQuitReady) return;
    const controller = createRendererQuitController({
      lock: () => lockWorkspaceInput(root.current),
      settle: async () => {
        await modalRef.current?.editor?.flush();
        await readerFlush.current?.();
        return latestActions.current.settleDocumentJobs(undefined, () =>
          settleWorkspaceBeforeQuit({
            jobs: podcastJobs.current,
            requests: aiRequests.current,
            sessions: sessions.current,
            hasVolatile: () => podcastVolatile.current.size > 0 || aiVolatile.current.size > 0,
          }),
        );
      },
      acknowledge: async (value) => {
        const reply = valueOf(await api.rendererQuitReady(value));
        if (reply?.accepted !== true) throw Error('退出确认已失效，窗口已保留，请重试退出。');
      },
      onError: setError,
    });
    const unsubscribe = api.subscribe((event) => {
      if (event?.type === 'prepareQuit' || event?.type === 'quitCancelled') void controller.handle(event);
    });
    return () => {
      unsubscribe?.();
      controller.dispose();
    };
  }, [aiRequests, aiVolatile, api, modalRef, podcastJobs, podcastVolatile, readerFlush, root, sessions, setError]);
  useEffect(() => {
    if (ready && loadedIdentity.current === identityId && activeSearchScope) searches.set(activeSearchScope, filters);
  }, [ready, identityId, activeSearchScope, filters, searches, loadedIdentity]);
  useLayoutEffect(() => {
    if (ready && loadedIdentity.current === identityId && !navigationMounted.current) {
      navigationMounted.current = true;
      navigation.restoreCurrent();
    }
  }, [ready, navigation, loadedIdentity, identityId, navigationMounted]);
  useLayoutEffect(() => {
    const target = scrollRestore.current;
    if (
      !ready ||
      loadedIdentity.current !== identityId ||
      !target ||
      JSON.stringify(target.route) !== JSON.stringify(route) ||
      JSON.stringify(target.filters) !== JSON.stringify(filters)
    )
      return;
    root.current?.scrollTo({ top: target.scrollTop || 0, left: target.scrollLeft || 0 });
    scrollRestore.current = null;
  }, [ready, route, filters, shuffle, scrollRestore, loadedIdentity, identityId, root]);
  useEffect(() => {
    if (ready && loadedIdentity.current === identityId && !scrollRestore.current) navigation.record();
  }, [ready, route, filters, shuffle, collectionQuery, selected, selectionMode, starView, navigation, loadedIdentity, identityId, scrollRestore]);
  useEffect(() => {
    if (!ready || loadedIdentity.current !== identityId || !session.subscribe) return;
    return session.subscribe((value, meta = {}) => {
      if (loadedIdentity.current !== identityId) return;
      stateRef.current = value;
      draftRef.current = session.drafts();
      setState({ ...value, drafts: session.drafts() });
      setSaving(session.writing > 0);
      if (meta.error) setError(meta.error.message || String(meta.error));
    });
  }, [ready, session, identityId, loadedIdentity, stateRef, draftRef, setState, setSaving, setError]);
  useEffect(() => {
    const run = ++epoch.current;
    if (loadedIdentity.current && loadedIdentity.current !== identityId) {
      const next = { page: 'library', id: '', sourcePage: 1 };
      setRoute(next);
      history.replaceState({ ...history.state, mengcangSublimeNavigation: null }, '', '#/library');
    }
    navigationMounted.current = false;
    scrollRestore.current = null;
    setReady(false);
    setError('');
    setSaving(false);
    setCheckingSource('');
    setEditorDraft(undefined);
    draftRef.current = {};
    setPopover(null);
    setModal(null);
    setSelected([]);
    setSelectionMode(false);
    setNoteDraft('');
    setToast('');
    setStarView(initialStarView());
    setFilters(initialFilters);
    setFilterDraft(initialFilters);
    setCollectionQuery('');
    setMoreOptions(false);
    setShuffle(0);
    stateRef.current = createWorkspaceState();
    setState(stateRef.current);
    session
      .load()
      .then(async (value) => {
        let migrationError = '';
        if (!value.drafts.legacyDiscoveryImported && apiRef.current?.discoveryStateGet) {
          try {
            const legacy = valueOf(await apiRef.current.discoveryStateGet());
            if (epoch.current !== run) return;
            value = await session.commit((existing) => migrateLegacyDiscovery(existing, legacy || { schema: 1, collections: [], boards: [] }));
          } catch (e) {
            migrationError = '原收藏与画布仍保留在旧存储中，本次未能迁移：' + e.message;
          }
        }
        if (epoch.current !== run) return;
        stateRef.current = value;
        setState({ ...value, drafts: session.drafts() });
        draftRef.current = session.drafts();
        loadedIdentity.current = identityId;
        setReady(true);
        const storage = session.migrationStatus?.();
        if (storage?.readOnly) setError(storage.issue || '资料库以只读模式打开，请导出备份后检查迁移。');
        else if (apiRef.current?.runtimeStartupId) await session.recordSuccessfulStartup?.(apiRef.current.runtimeStartupId);
        if (migrationError) setError(migrationError);
      })
      .catch((e) => {
        if (epoch.current === run) setError(e.message);
      });
    return invalidateLoad;
  }, [
    apiRef,
    draftRef,
    epoch,
    identityId,
    loadedIdentity,
    navigationMounted,
    scrollRestore,
    session,
    setCheckingSource,
    setCollectionQuery,
    setEditorDraft,
    setError,
    setFilterDraft,
    setFilters,
    setModal,
    setMoreOptions,
    setNoteDraft,
    setPopover,
    setReady,
    setRoute,
    setSaving,
    setSelected,
    setSelectionMode,
    setShuffle,
    setStarView,
    setState,
    setToast,
    stateRef,
    toastTimer,
    invalidateLoad,
  ]);
  useEffect(() => {
    const change = () => navigation.restoreCurrent();
    window.addEventListener('popstate', change);
    window.addEventListener('hashchange', change);
    return () => {
      window.removeEventListener('popstate', change);
      window.removeEventListener('hashchange', change);
    };
  }, [navigation]);
  useEffect(() => {
    if (!popover) return;
    const escape = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPopover(null);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [popover, setPopover]);
  useEffect(() => {
    if (!connected || !ready || stateRef.current.drafts.legacyDiscoveryImported || !apiRef.current?.discoveryStateGet) return;
    let cancelled = false;
    const run = epoch.current;
    apiRef.current
      .discoveryStateGet()
      .then((result) => {
        if (cancelled || epoch.current !== run) return;
        return latestActions.current.commit((existing) =>
          existing.drafts.legacyDiscoveryImported ? existing : migrateLegacyDiscovery(existing, valueOf(result) || { schema: 1, collections: [], boards: [] }),
        );
      })
      .catch((e) => {
        if (!cancelled && epoch.current === run) setError('原收藏与画布仍保留，本次重连未能迁移：' + e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [apiRef, connected, epoch, ready, session, setError, stateRef]);
  useEffect(() => {
    const job = { controller: new AbortController(), seen: new Map(), tail: Promise.resolve() };
    coverJobs.current = job;
    return () => {
      job.controller.abort();
      if (coverJobs.current === job) coverJobs.current = null;
    };
  }, [coverJobs, session]);
  useEffect(() => {
    const jobs = coverJobs.current;
    if (!ready || loadedIdentity.current !== identityId || !jobs) return;
    for (const source of state.cards) {
      if (
        source.origin === 'vault' ||
        source.type !== 'book' ||
        source.image ||
        !source.attachment ||
        !state.savedIds.includes(source.id) ||
        state.hiddenIds.includes(source.id) ||
        jobs.seen.get(source.id) === source.attachment.dataUrl
      )
        continue;
      jobs.seen.set(source.id, source.attachment.dataUrl);
      jobs.tail = jobs.tail
        .then(async () => {
          if (jobs.controller.signal.aborted || root.current?.inert) return;
          let image;
          try {
            image = await defaultBookCover(source.attachment, { signal: jobs.controller.signal });
          } catch {
            return;
          }
          if (
            !image ||
            jobs.controller.signal.aborted ||
            root.current?.inert ||
            (modalRef.current?.type === 'book-cover' && modalRef.current.card.id === source.id) ||
            (viewRef.current?.route?.page === 'add' && viewRef.current.route.id === 'edit:' + source.id)
          )
            return;
          await latestActions.current.commit((latest) => {
            const current = latest.cards.find((card) => card.id === source.id);
            if (!latest.savedIds.includes(source.id) || latest.hiddenIds.includes(source.id)) return latest;
            try {
              return workspaceReducer(latest, { type: 'card.upsert', card: applyBookCover(current, source, image) });
            } catch {
              return latest;
            }
          });
        })
        .catch(() => {});
    }
  }, [ready, session, identityId, state.cards, state.savedIds, state.hiddenIds, coverJobs, loadedIdentity, root, modalRef, viewRef]);
  useEffect(() => {
    if (!ready || !standalone || loadedIdentity.current !== identityId) return;
    return connectClipperRenderer({
      api,
      session,
      workspaceId: identityId,
      isCurrent: () => loadedIdentity.current === identityId,
      getVaultCards: () => clipperView.current.external,
      onOpenCard: (id) => clipperView.current.open(id),
    });
  }, [ready, standalone, api, session, identityId, loadedIdentity, clipperView]);
  useEffect(() => {
    if (selectionMode && selectedIds.length !== selected.length && (!meaningActive || meaningSearch.result)) setSelected(selectedIds);
  }, [selectionMode, selectedIds, selected.length, meaningActive, meaningSearch.result, setSelected]);
  useEffect(() => {
    if (ready && loadedIdentity.current === identityId && route.page === 'edit-collection' && route.id)
      session.beginEdit?.(collectionDraftKey, { type: 'collection', id: route.id });
    if (ready && loadedIdentity.current === identityId && route.page === 'canvas' && route.id)
      session.beginEdit?.(`board:${route.id}`, { type: 'board', id: route.id });
  }, [ready, session, route.page, route.id, loadedIdentity, identityId, collectionDraftKey]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)'),
      change = () => setSystemLight(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [setSystemLight]);
  useLayoutEffect(() => {
    if (!ready || loadedIdentity.current !== identityId || route.page !== 'add' || !editId) return;
    const key = `edit:${editId}`;
    session.beginEdit?.(key, { type: 'card', id: editId });
    return () => session.endEdit?.(key);
  }, [ready, session, identityId, route.page, editId, loadedIdentity]);
}
