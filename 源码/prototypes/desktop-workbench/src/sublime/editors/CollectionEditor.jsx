import React, { useEffect, useRef, useState } from 'react';
import { IconLock, IconX, IconPin } from '@tabler/icons-react';
import { messageFor } from './editorModel.js';
import { ErrorMessage, FlagButton } from './EditorChrome.jsx';
export function CollectionEditor({ collection = null, draft, onDraftChange, onSave, onCancel, firstCollection = false }) {
  const initial = () => ({
    ...{
      id: collection?.id,
      title: collection?.title || '',
      description: collection?.description || '',
      private: Boolean(collection?.private),
      pinned: Boolean(collection?.pinned),
    },
    ...(draft || {}),
  });
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const valueRef = useRef(value),
    mounted = useRef(true);
  valueRef.current = value;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const initialize = useRef(initial);
  initialize.current = initial;
  useEffect(() => {
    setValue(initialize.current());
    setError('');
  }, [collection?.id]);
  function change(patch) {
    const next = { ...valueRef.current, ...patch };
    valueRef.current = next;
    setValue(next);
    onDraftChange?.(next);
    setError('');
  }
  async function save() {
    if (busy) return;
    if (!value.title.trim()) {
      setError('请为这个收藏集命名。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (typeof onSave !== 'function') throw new Error('当前无法保存。');
      await onSave({
        ...(collection?.id ? { id: collection.id } : {}),
        title: value.title.trim(),
        description: value.description,
        private: Boolean(value.private),
        pinned: Boolean(value.pinned),
      });
    } catch (e) {
      if (mounted.current) setError(messageFor(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <main className="sublime-editor se-panel-editor">
      <h1 className="se-sr-only">{collection ? '编辑收藏集' : '新建收藏集'}</h1>
      <button type="button" className="se-editor-back" aria-label="返回并关闭收藏集编辑器" disabled={busy} onClick={onCancel}>
        <IconX size={23} />
      </button>
      <div className="se-collection-panel-wrap">
        {firstCollection && !collection && (
          <div className="se-first-collection">
            <span>🟢 你的第一个收藏集</span>
            <p>围绕一个主题、项目或感受，用收藏集汇聚想法。</p>
          </div>
        )}
        <div className="se-source-panel">
          <ErrorMessage error={error} />
          <input
            className="se-panel-input"
            aria-label="收藏集名称"
            value={value.title}
            onChange={(event) => change({ title: event.target.value })}
            placeholder="名称"
            autoFocus
            disabled={busy}
          />
          <textarea
            className="se-panel-input se-panel-note"
            aria-label="收藏集说明"
            value={value.description}
            onChange={(event) => change({ description: event.target.value })}
            placeholder="说明（选填）"
            disabled={busy}
          />
          <div className="se-panel-flags">
            <FlagButton label="私密" icon={IconLock} checked={value.private} disabled={busy} onChange={(isPrivate) => change({ private: isPrivate })} />
            <FlagButton label="置顶" icon={IconPin} checked={value.pinned} disabled={busy} onChange={(pinned) => change({ pinned })} />
          </div>
          <div className="se-panel-save">
            <button type="button" className="se-save" disabled={busy} onClick={save}>
              {busy ? '正在保存…' : collection ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
