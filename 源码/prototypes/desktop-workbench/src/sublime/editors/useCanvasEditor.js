import { useEffect, useMemo, useRef, useState, useReducer } from 'react';
import { makeId, itemKey, messageFor } from './editorModel.js';
const boardStamp = (board) =>
  JSON.stringify(
    board
      ? [
          board.id,
          board.title,
          board.collectionId || '',
          (board.nodes || []).map((node) => [node.id, node.itemPath, node.x, node.y]),
          (board.edges || []).map((edge) => [edge.id, edge.from, edge.to, edge.label || '']),
        ]
      : null,
  );

export function useCanvasEditor({ board, hasDraft = false, items = [], collections = [], onChange, onBack }) {
  const container = useRef(null),
    gesture = useRef(null),
    ignoreClick = useRef(''),
    boardRef = useRef(board),
    session = useRef(0),
    revision = useRef(0),
    savedRevision = useRef(0),
    pending = useRef(new Set()),
    emitted = useRef(new Map()),
    mounted = useRef(true);
  const [localBoard, setLocalBoard] = useState(board),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(hasDraft),
    [view, setView] = useState({ x: 0, y: 0, scale: 1 }),
    [error, setError] = useState(''),
    [title, setTitle] = useState(board?.title || '');
  const [controls, dispatchControls] = useReducer(
    (state, { field, value }) => ({ ...state, [field]: typeof value === 'function' ? value(state[field]) : value }),
    { selected: '', query: '', addPath: '', linking: false, linkFrom: '' },
  );
  const { selected, query, addPath, linking, linkFrom } = controls;
  const setSelected = (value) => dispatchControls({ field: 'selected', value });
  const setQuery = (value) => dispatchControls({ field: 'query', value });
  const setAddPath = (value) => dispatchControls({ field: 'addPath', value });
  const setLinking = (value) => dispatchControls({ field: 'linking', value });
  const setLinkFrom = (value) => dispatchControls({ field: 'linkFrom', value });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (boardRef.current?.id !== board?.id) {
      session.current++;
      revision.current = 0;
      savedRevision.current = 0;
      pending.current.clear();
      emitted.current.clear();
      boardRef.current = board;
      setLocalBoard(board);
      setSaving(false);
      setDirty(hasDraft);
      setView({ x: 0, y: 0, scale: 1 });
      setSelected('');
      setLinkFrom('');
      setError('');
      setTitle(board?.title || '');
      gesture.current = null;
      ignoreClick.current = '';
      return;
    }
    const stamp = boardStamp(board),
      known = emitted.current.get(stamp);
    if (known !== undefined && known < revision.current) return;
    if (pending.current.size || revision.current > savedRevision.current) return;
    setDirty(hasDraft);
    if (stamp === boardStamp(boardRef.current)) return;
    boardRef.current = board;
    setLocalBoard(board);
    setTitle(board?.title || '');
  }, [board, hasDraft]);
  const byPath = useMemo(() => new Map(items.map((item) => [itemKey(item), item])), [items]);
  const candidates = useMemo(
    () => items.filter((item) => `${item.title || ''}\n${item.body || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [items, query],
  );
  const currentBoard = localBoard?.id === board?.id ? localBoard : board;
  const nodes = currentBoard?.nodes || [],
    edges = currentBoard?.edges || [];
  function update(change) {
    const previous = boardRef.current;
    if (!previous) return;
    const next = typeof change === 'function' ? change(previous) : change;
    if (!next) return;
    const request = ++revision.current,
      requestSession = session.current,
      handler = onChange;
    boardRef.current = next;
    setLocalBoard(next);
    setDirty(true);
    setSaving(true);
    setError('');
    pending.current.add(request);
    emitted.current.set(boardStamp(next), request);
    // Register every mutation with the workspace's serial persistence queue now,
    // before this editor can unmount or the native quit handler starts waiting.
    const saveRequest = (async () => {
      try {
        if (typeof handler !== 'function') throw new Error('当前无法保存画布修改。');
        await handler(next);
        if (mounted.current && session.current === requestSession) {
          savedRevision.current = Math.max(savedRevision.current, request);
          if (request === revision.current) setError('');
        }
      } catch (e) {
        if (mounted.current && session.current === requestSession && request > savedRevision.current)
          setError(`画布修改仍以草稿保留在此编辑器中。${messageFor(e)}`);
      } finally {
        if (mounted.current && session.current === requestSession) {
          pending.current.delete(request);
          setSaving(pending.current.size > 0);
          setDirty(revision.current > savedRevision.current);
        }
      }
    })();
    return saveRequest;
  }
  function moveNode(id, x, y) {
    update((latest) => ({ ...latest, nodes: (latest.nodes || []).map((node) => (node.id === id ? { ...node, x, y } : node)) }));
  }
  function removeNode(id) {
    update((latest) => ({
      ...latest,
      nodes: (latest.nodes || []).filter((node) => node.id !== id),
      edges: (latest.edges || []).filter((edge) => edge.from !== id && edge.to !== id),
    }));
    setSelected('');
    if (linkFrom === id) setLinkFrom('');
  }
  function select(node) {
    setSelected(node.id);
    if (!linking) return;
    if (!linkFrom) {
      setLinkFrom(node.id);
      return;
    }
    if (linkFrom === node.id) {
      setLinkFrom('');
      return;
    }
    const latest = boardRef.current,
      latestNodes = latest?.nodes || [],
      latestEdges = latest?.edges || [],
      pair = [linkFrom, node.id].sort().join('\u0000');
    if (!latestNodes.some((value) => value.id === linkFrom) || !latestNodes.some((value) => value.id === node.id)) {
      setLinkFrom('');
      return;
    }
    if (latestEdges.some((edge) => [edge.from, edge.to].sort().join('\u0000') === pair)) {
      setError('这两张卡片已经连接。');
      setLinkFrom('');
      return;
    }
    update((value) => ({ ...value, edges: [...(value.edges || []), { id: makeId(), from: linkFrom, to: node.id }] }));
    setLinkFrom('');
  }
  function start(event, node) {
    if (event.button !== 0 || event.target.closest('button,input,select,a')) return;
    event.preventDefault();
    if (node) event.currentTarget.focus?.({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const latest = node ? (boardRef.current?.nodes || []).find((value) => value.id === node.id) : null;
    if (node && !latest) return;
    ignoreClick.current = '';
    gesture.current = {
      id: latest?.id,
      startX: event.clientX,
      startY: event.clientY,
      x: latest?.x ?? view.x,
      y: latest?.y ?? view.y,
      scale: view.scale,
      moved: false,
    };
    if (node) setSelected(node.id);
  }
  function move(event) {
    const active = gesture.current;
    if (!active) return;
    const dx = event.clientX - active.startX,
      dy = event.clientY - active.startY;
    if (!active.moved && Math.hypot(dx, dy) < 4) return;
    active.moved = true;
    if (active.id) moveNode(active.id, active.x + dx / active.scale, active.y + dy / active.scale);
    else setView((value) => ({ ...value, x: active.x + dx, y: active.y + dy }));
  }
  function endGesture() {
    if (gesture.current?.moved && gesture.current.id) ignoreClick.current = gesture.current.id;
    gesture.current = null;
  }
  function clicked(node) {
    if (ignoreClick.current === node.id) {
      ignoreClick.current = '';
      return;
    }
    select(node);
  }
  function keyboard(event, node) {
    if (event.target !== event.currentTarget || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(node);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeNode(node.id);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const latest = (boardRef.current?.nodes || []).find((value) => value.id === node.id);
    if (!latest) return;
    const step = event.shiftKey ? 40 : 10;
    moveNode(
      node.id,
      latest.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      latest.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
    );
  }
  function add() {
    if (!addPath || !byPath.has(addPath)) return;
    update((latest) => {
      const count = (latest.nodes || []).length;
      return {
        ...latest,
        nodes: [...(latest.nodes || []), { id: makeId(), itemPath: addPath, x: 40 + (count % 3) * 250, y: 40 + Math.floor(count / 3) * 200 }],
      };
    });
    setAddPath('');
  }
  function zoom(delta) {
    setView((value) => ({ ...value, scale: Math.max(0.35, Math.min(2, value.scale + delta)) }));
  }
  return {
    currentBoard,
    query,
    setQuery,
    candidates,
    addPath,
    setAddPath,
    add,
    selected,
    removeNode,
    linking,
    setLinking,
    setLinkFrom,
    saving,
    dirty,
    error,
    title,
    setTitle,
    boardRef,
    update,
    container,
    view,
    start,
    move,
    endGesture,
    nodes,
    edges,
    byPath,
    linkFrom,
    setSelected,
    clicked,
    keyboard,
    zoom,
    setView,
  };
}
