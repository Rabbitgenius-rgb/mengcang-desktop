import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconCheck, IconLoader2, IconUpload } from '@tabler/icons-react';
import { dedupeImports, parseImportText } from '../../discoveryModel.js';
import { readLocalFile, messageFor } from './editorModel.js';
import { ErrorMessage, EditorHeader } from './EditorChrome.jsx';
export function ImportEditor({ draft, onDraftChange, onImport, onCancel }) {
  const [value, setValue] = useState(() => ({ text: '', format: 'auto', filename: '', selected: [], previewed: false, ...(draft || {}) })),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const fileInput = useRef(null),
    valueRef = useRef(value),
    fileRun = useRef(0),
    mounted = useRef(true);
  valueRef.current = value;
  useEffect(() => {
    const requests = fileRun;
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current++;
    };
  }, []);
  function previewText(content, name = '', type = 'auto') {
    if (new Blob([content]).size > 10 * 1024 * 1024) throw new Error('导入文本不能超过 10 MB。');
    if (!content.trim()) throw new Error('请先粘贴要导入的内容。');
    const parsed = parseImportText(content, type, { filename: name }),
      deduped = dedupeImports(parsed);
    if (!deduped.items.length) throw new Error('未找到可导入的条目。');
    return { items: deduped.items, duplicates: deduped.duplicates };
  }
  const resolved = useMemo(() => {
    if (!value.previewed) return { preview: null, error: '' };
    try {
      return { preview: previewText(String(value.text || ''), String(value.filename || ''), String(value.format || 'auto')), error: '' };
    } catch (problem) {
      return { preview: null, error: messageFor(problem) };
    }
  }, [value.text, value.filename, value.format, value.previewed]);
  const preview = resolved.preview,
    selected = (Array.isArray(value.selected) ? value.selected : []).filter((fingerprint) =>
      preview?.items.some((record) => record.fingerprint === fingerprint),
    );
  function change(patch) {
    const next = { ...valueRef.current, ...patch };
    valueRef.current = next;
    setValue(next);
    onDraftChange?.(next);
    setError('');
  }
  async function fileChanged(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const run = ++fileRun.current;
    setBusy(true);
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的文件。');
      const content = await readLocalFile(file);
      if (!mounted.current || run !== fileRun.current) return;
      change({ text: content, filename: file.name, format: 'auto', selected: [], previewed: false });
      const result = previewText(content, file.name, 'auto');
      change({ previewed: true, selected: result.items.map((record) => record.fingerprint) });
    } catch (e) {
      if (mounted.current && run === fileRun.current) setError(messageFor(e));
    } finally {
      if (mounted.current && run === fileRun.current) setBusy(false);
    }
  }
  function pastedPreview() {
    try {
      const result = previewText(String(value.text || ''), String(value.filename || ''), String(value.format || 'auto'));
      change({ previewed: true, selected: result.items.map((record) => record.fingerprint) });
    } catch (e) {
      setError(messageFor(e));
    }
  }
  async function commit() {
    if (busy || !preview) return;
    const records = preview.items.filter((record) => selected.includes(record.fingerprint));
    if (!records.length) {
      setError('请至少选择一个要导入的条目。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (typeof onImport !== 'function') throw new Error('当前无法导入。');
      await onImport(records, { draftSnapshot: JSON.parse(JSON.stringify(valueRef.current)) });
    } catch (e) {
      if (mounted.current) setError(messageFor(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <main className="sublime-editor">
      <div className="se-content">
        <EditorHeader title="导入资料库" onCancel={onCancel} busy={busy} />
        <p className="se-intro">支持导入 CSV、JSON、Markdown、Kindle 笔记（My Clippings）或 HTML 书签文件。请先预览内容，再添加到本机资料库。</p>
        <ErrorMessage error={error || resolved.error} />
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".csv,.json,.md,.txt,.html,.htm,text/plain,text/csv,text/html,application/json"
          onChange={fileChanged}
        />
        <button type="button" className="se-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          <IconUpload size={18} />
          选择导入文件
        </button>
        {value.filename && <p className="se-file-name">{value.filename}</p>}
        <label className="se-field">
          格式
          <select
            aria-label="导入格式"
            value={value.format}
            onChange={(event) => change({ format: event.target.value, previewed: false, selected: [] })}
            disabled={busy}
          >
            <option value="auto">自动识别</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
            <option value="kindle">Kindle 笔记（My Clippings）</option>
            <option value="bookmarks">HTML 书签</option>
          </select>
        </label>
        <label className="se-field">
          或粘贴导出的内容
          <textarea
            aria-label="导入内容"
            rows={8}
            value={value.text}
            onChange={(event) => change({ text: event.target.value, filename: '', previewed: false, selected: [] })}
            placeholder="在此粘贴导出的条目…"
            disabled={busy}
          />
        </label>
        <button type="button" className="se-secondary" disabled={busy || !String(value.text || '').trim()} onClick={pastedPreview}>
          预览导入
        </button>
        {preview && (
          <section className="se-import-preview">
            <div className="se-import-summary">
              <h2>{preview.items.length} 个条目</h2>
              <span>已从本次导入中移除 {preview.duplicates} 个重复条目</span>
              <button
                type="button"
                className="se-secondary"
                disabled={busy}
                onClick={() => change({ selected: selected.length === preview.items.length ? [] : preview.items.map((record) => record.fingerprint) })}
              >
                {selected.length === preview.items.length ? '取消全选' : '全选'}
              </button>
            </div>
            {preview.items.map((record) => (
              <article key={record.fingerprint}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(record.fingerprint)}
                    disabled={busy}
                    onChange={() =>
                      change({
                        selected: selected.includes(record.fingerprint)
                          ? selected.filter((value) => value !== record.fingerprint)
                          : [...selected, record.fingerprint],
                      })
                    }
                  />
                  <strong>{record.title}</strong>
                </label>
                <p>
                  {record.sourceTitle || record.sourceUrl}
                  {record.author ? ` · ${record.author}` : ''}
                  {record.page ? ` · 第 ${record.page} 页` : ''}
                  {record.sourceLocation ? ` · ${record.sourceLocation}` : ''}
                </p>
                <details>
                  <summary>查看正文和备注</summary>
                  <p className="se-import-body">{record.body}</p>
                  {record.caption && (
                    <>
                      <h3>备注</h3>
                      <p className="se-import-body">{record.caption}</p>
                    </>
                  )}
                </details>
              </article>
            ))}
            <div className="se-editor-footer">
              <span>已选择 {selected.length} 项</span>
              <button type="button" className="se-save" disabled={busy || !selected.length} onClick={commit}>
                {busy ? <IconLoader2 className="se-spin" size={18} /> : <IconCheck size={18} />} {busy ? '正在导入…' : `导入 ${selected.length} 项`}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
