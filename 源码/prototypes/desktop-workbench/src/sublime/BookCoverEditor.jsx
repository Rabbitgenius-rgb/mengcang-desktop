import React, { useEffect, useRef, useState } from 'react';
import { IconPhoto, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { openBookCover, imageBookCover } from './bookCover.js';
import './bookCover.css';

export default function BookCoverEditor({ attachment, image = '', onSave, onCancel }) {
  const [preview, setPreview] = useState(image),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(0),
    [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const book = useRef(null),
    run = useRef(0),
    mounted = useRef(false),
    input = useRef(null),
    savingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let source;
    (async () => {
      try {
        source = await openBookCover(attachment, { signal: controller.signal });
        if (!mounted.current) return source.close();
        book.current = source;
        setPages(source.pages);
        if (!image) {
          const cover = await source.render(1);
          if (mounted.current) {
            setPreview(cover);
            if (!cover) setNotice('原书没有内置封面，可选择本机图片。');
          }
        }
      } catch (problem) {
        if (mounted.current) setError(problem.message || '无法提取封面，原文件仍保留。');
      } finally {
        if (mounted.current) setBusy(false);
      }
    })();
    return () => {
      mounted.current = false;
      run.current++;
      controller.abort();
      source?.close();
      book.current = null;
    };
  }, [attachment]);
  async function selectPage(number) {
    if (busy || saving || !book.current) return;
    const request = ++run.current;
    setBusy(true);
    setError('');
    try {
      const result = await book.current.render(number);
      if (mounted.current && request === run.current) {
        setPage(number);
        setPreview(result);
        setNotice('');
      }
    } catch (problem) {
      if (mounted.current && request === run.current) setError(problem.message);
    } finally {
      if (mounted.current && request === run.current) setBusy(false);
    }
  }
  async function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || saving) return;
    const request = ++run.current;
    setBusy(true);
    setError('');
    try {
      const result = await imageBookCover(file);
      if (mounted.current && request === run.current) {
        setPreview(result);
        setNotice('已选本机封面图片。');
      }
    } catch (problem) {
      if (mounted.current && request === run.current) setError(problem.message);
    } finally {
      if (mounted.current && request === run.current) setBusy(false);
    }
  }
  async function save() {
    if (busy || savingRef.current || !preview || preview === image) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(preview);
    } catch (problem) {
      if (mounted.current) setError(problem.message);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <section className="sw-book-cover-editor" aria-label="图书封面设置">
      <p>封面只用于卡片展示，原书和阅读进度保持不变。</p>
      <div className="sw-book-cover-preview" aria-busy={busy}>
        {preview ? <img src={preview} alt="待保存的图书封面" /> : <IconPhoto size={42} />}
      </div>
      {busy && <p role="status">正在本机生成封面…</p>}
      {pages > 0 && (
        <div className="sw-book-cover-pages">
          <button type="button" aria-label="上一页封面" disabled={busy || saving || page === 1} onClick={() => selectPage(page - 1)}>
            <IconChevronLeft size={18} />
          </button>
          <label>
            PDF 页码{' '}
            <input
              type="number"
              aria-label="封面页码"
              min="1"
              max={pages}
              key={page}
              defaultValue={page}
              disabled={busy || saving}
              onBlur={(event) => {
                const number = Number(event.target.value);
                if (number !== page) void selectPage(number);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <span>/ {pages}</span>
          <button type="button" aria-label="下一页封面" disabled={busy || saving || page === pages} onClick={() => selectPage(page + 1)}>
            <IconChevronRight size={18} />
          </button>
        </div>
      )}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseImage} />
      <button type="button" className="sw-secondary" disabled={busy || saving} onClick={() => input.current?.click()}>
        选择本机封面图片
      </button>
      {pages > 0 && <p className="sw-muted">首面若是目录或资源说明，可选其他页面作为封面。</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="sw-book-cover-error" role="alert">
          {error}
        </p>
      )}
      <div className="sw-modal-actions">
        <button type="button" className="sw-secondary" disabled={saving} onClick={onCancel}>
          取消
        </button>
        <button type="button" className="sw-primary" disabled={busy || saving || !preview || preview === image} onClick={save}>
          {saving ? '正在保存…' : '保存封面'}
        </button>
      </div>
    </section>
  );
}
