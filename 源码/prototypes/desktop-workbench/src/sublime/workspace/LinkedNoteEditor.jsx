import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { IconArrowUpRight, IconLink } from '@tabler/icons-react';
import { isLinkedNote, linkedNoteRelations } from '.././linkedNotes.js';
import { Modal } from './WorkspacePrimitives.jsx';

export function LinkedNoteEditor({ source, editor, onSaved, onClose, onError }) {
  const [value, setValue] = useState(editor.value),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pending = useRef(false),
    errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      editor.flush().catch((issue) => {
        if (active) setError(issue.message);
      });
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [editor, value]);
  useEffect(
    () => () => {
      editor.flush().catch((issue) => errorHandler.current(issue.message));
    },
    [editor],
  );
  function change(field, text) {
    setError('');
    setConfirmDiscard(false);
    setValue(editor.update(field, text));
  }
  async function finish(write, complete) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await write();
      complete();
    } catch (issue) {
      setError(issue.message || '写入失败，当前输入仍在这里。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const close = () => finish(editor.flush, onClose);
  return (
    <Modal title="写关联笔记" onClose={close}>
      <form
        className="sw-linked-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDiscard && value.body.trim()) void finish(editor.publish, onSaved);
        }}
      >
        <p className="sw-linked-purpose">新建一张可在资料库单独找到的笔记，并关联当前资料。</p>
        <p className="sw-linked-context">
          <IconLink size={16} /> <span>{source.title || '未命名资料'}</span>
        </p>
        <label>
          标题（选填）
          <input
            className="sw-field"
            name="title"
            maxLength={1000}
            value={value.title}
            disabled={busy}
            onChange={(e) => change('title', e.target.value)}
            placeholder="给这条想法起个名字"
          />
        </label>
        <label>
          笔记正文
          <textarea
            className="sw-field"
            name="body"
            rows={6}
            value={value.body}
            disabled={busy}
            maxLength={100000}
            onChange={(e) => change('body', e.target.value)}
            placeholder="写下你对这份资料的想法…"
            autoFocus
          />
        </label>
        {error && (
          <p role="alert" className="sw-error">
            {error}
          </p>
        )}
        {confirmDiscard ? (
          <div className="sw-linked-discard" role="group" aria-label="放弃当前草稿">
            <p>放弃这张资料的笔记草稿？</p>
            <button type="button" disabled={busy} onClick={() => setConfirmDiscard(false)}>
              继续写
            </button>
            <button type="button" disabled={busy} onClick={() => finish(editor.discard, onClose)}>
              确认放弃
            </button>
          </div>
        ) : (
          <footer>
            {(value.title || value.body) && (
              <button type="button" className="sw-draft-discard" disabled={busy} onClick={() => setConfirmDiscard(true)}>
                放弃草稿
              </button>
            )}
            <button type="button" onClick={close} disabled={busy}>
              {value.title || value.body ? '保留草稿并关闭' : '关闭'}
            </button>
            <button type="submit" className="sw-primary" disabled={busy || !value.body.trim()}>
              保存笔记
            </button>
          </footer>
        )}
      </form>
    </Modal>
  );
}

export function LinkedNoteLinks({ card, library, onOpen }) {
  const { source, notes } = linkedNoteRelations(card, library);
  if (!source && !notes.length && !isLinkedNote(card)) return null;
  return (
    <nav className="sw-linked-notes" aria-label="笔记与来源">
      {source && (
        <div>
          <span>{source.type === 'article' ? '来源文章' : '来源资料'}</span>
          <button type="button" aria-label={'返回来源：' + source.title} onClick={() => onOpen(source.id)}>
            {source.title || '未命名资料'} <IconArrowUpRight size={15} />
          </button>
        </div>
      )}
      {isLinkedNote(card) && !source && <small>来源资料当前不在我的资料库</small>}
      {notes.length > 0 && (
        <div>
          <span>关联笔记 · {notes.length}</span>
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <button type="button" aria-label={'打开关联笔记：' + note.title} onClick={() => onOpen(note.id)}>
                  {note.title} <IconArrowUpRight size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
