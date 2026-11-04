import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconFolder, IconPlus, IconStar, IconLock, IconCheck, IconChevronDown, IconX } from '@tabler/icons-react';
import { savePanelPosition, hasSaveOptionsChanges } from './saveOptions.js';
import './saveCardPanel.css';

export default function SaveCardPanel({ card, initial, collections, drafts, anchor, onSave, onClose }) {
  const panel = useRef(null),
    note = useRef(null),
    busyRef = useRef(false);
  const [more, setMore] = useState(false);
  const [value, setValue] = useState(() => structuredClone(initial.value)),
    [expanded, setExpanded] = useState(!!initial.value.newCollectionTitle),
    [creating, setCreating] = useState(!!initial.value.newCollectionTitle),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [position, setPosition] = useState(() =>
    savePanelPosition(anchor?.getBoundingClientRect?.(), { width: 340, height: 250 }, { width: innerWidth, height: innerHeight }),
  );
  useEffect(() => {
    if (hasSaveOptionsChanges(initial.base, value)) drafts.set(card.id, { base: initial.base, value: structuredClone(value) });
    else drafts.delete(card.id);
  }, [drafts, card.id, initial, value]);
  useLayoutEffect(() => {
    const place = () =>
      setPosition(
        savePanelPosition(
          anchor?.getBoundingClientRect?.(),
          { width: 340, height: panel.current?.getBoundingClientRect().height || 250 },
          { width: innerWidth, height: innerHeight },
        ),
      );
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    note.current?.focus();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  const change = (patch) => {
    setValue((v) => ({ ...v, ...patch }));
    setError('');
  };
  async function submit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(initial.base, value);
      drafts.delete(card.id);
      onClose();
    } catch (issue) {
      setError(issue.message || '保存失败，输入已保留，请重试。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const known = new Set(collections.map((x) => x.id)),
    selected = collections.filter((x) => value.collectionIds.includes(x.id));
  const matches = collections.filter((x) => x.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function handleKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...panel.current.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(
      (node) => node.getClientRects().length,
    );
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  const missing = value.collectionIds.filter((id) => !known.has(id));
  const toggle = (id) =>
    change({ collectionIds: value.collectionIds.includes(id) ? value.collectionIds.filter((x) => x !== id) : [...value.collectionIds, id] });
  return (
    <>
      <button className="sw-popover-dismiss" aria-label="关闭保存面板" tabIndex={-1} disabled={busy} onClick={onClose} />
      <form
        ref={panel}
        className="sw-save-panel"
        style={position}
        role="dialog"
        aria-label={'保存选项：' + card.title}
        onSubmit={submit}
        onKeyDown={handleKey}
        aria-modal="true"
      >
        <header>
          <span className="sp-sr-only">{initial.base.saved ? '已在我的资料库' : '保存到我的资料库'}</span>
          <button type="button" aria-label="关闭保存选项" disabled={busy} onClick={onClose}>
            <IconX size={16} />
          </button>
        </header>
        <label className="sp-note-label">
          给这张卡加备注
          <textarea
            ref={note}
            placeholder="写下备注…"
            rows={2}
            maxLength={50000}
            value={value.note}
            disabled={busy}
            onChange={(e) => change({ note: e.target.value })}
          />
        </label>
        <button className="sp-collections-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} disabled={busy}>
          <IconFolder size={17} />
          <span>{selected.length ? selected.map((x) => x.title).join('、') : '收藏集'}</span>
          {selected.length ? <IconChevronDown size={16} /> : <IconPlus size={18} />}
        </button>
        {expanded && (
          <div className="sp-collections">
            <input aria-label="筛选收藏集" placeholder="查找收藏集…" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy} />
            <div className="sp-collection-list">
              {matches.map((c) => (
                <label key={c.id}>
                  <input type="checkbox" checked={value.collectionIds.includes(c.id)} onChange={() => toggle(c.id)} disabled={busy} />
                  <span>{c.title}</span>
                </label>
              ))}
              {missing.map((id) => (
                <label key={id}>
                  <input type="checkbox" checked onChange={() => toggle(id)} disabled={busy} />
                  <span>已移除的收藏集 · 取消选择</span>
                </label>
              ))}
              {!matches.length && <p role="status">{query.trim() ? '没有匹配的收藏集' : collections.length ? '没有可选收藏集' : '还没有收藏集'}</p>}
            </div>
            {!creating ? (
              <button type="button" className="sp-new" onClick={() => setCreating(true)} disabled={busy}>
                <IconPlus size={15} />
                新建收藏集
              </button>
            ) : (
              <input
                aria-label="新收藏集名称"
                placeholder="新收藏集名称 · 保存时创建"
                maxLength={200}
                value={value.newCollectionTitle}
                onChange={(e) => change({ newCollectionTitle: e.target.value })}
                disabled={busy}
              />
            )}
          </div>
        )}
        <div className="sp-options">
          <button
            type="button"
            role="switch"
            aria-label="标星"
            aria-checked={value.favorite}
            disabled={busy}
            onClick={() => change({ favorite: !value.favorite })}
          >
            <IconStar size={16} />
            <span>标星</span>
            <i />
          </button>
        </div>
        <button className="sp-more" type="button" aria-expanded={more} onClick={() => setMore(!more)} disabled={busy}>
          更多选项 <IconChevronDown size={14} />
        </button>
        {more && (
          <div className="sp-options">
            <button
              type="button"
              role="switch"
              aria-label="私密标记"
              aria-checked={value.private}
              disabled={busy}
              onClick={() => change({ private: !value.private })}
            >
              <IconLock size={15} />
              <span>私密</span>
              <i />
            </button>
          </div>
        )}
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <small>
            <IconLock size={12} />
            仅保存在本机
          </small>
          <button className="sp-submit" type="submit" disabled={busy}>
            {busy ? '保存中…' : initial.base.saved ? '保存更改' : '保存'}
            {!busy && <IconCheck size={15} />}
          </button>
        </footer>
      </form>
    </>
  );
}
