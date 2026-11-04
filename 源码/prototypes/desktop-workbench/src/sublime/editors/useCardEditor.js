import { useEffect, useRef, useState, useReducer } from 'react';
import { defaultCard, messageFor, readLocalFile, isBookFile, importedCardType, deriveTitle, validUrl } from './editorModel.js';
import { safeSourceUrl, MAX_ATTACHMENT_BYTES, normalizeWorkspaceAttachment } from '../workspaceModel.js';
import { fileTypeFor } from '../attachmentPreview.js';
import { defaultBookCover } from '../bookCover.js';
import { captureWebPage } from '../webCapture.js';
export function useCardEditor({ kind = 'text', card = null, collections = [], draft, onDraftChange, onSave, onCancel }) {
  const [local, setLocal] = useState(() => defaultCard(card, kind)),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(false),
    [fetched, setFetched] = useState(null),
    [error, setError] = useState(''),
    [popover, setPopover] = useState(''),
    [collectionQuery, setCollectionQuery] = useState('');
  const [{ coverOpen, coverNotice }, setCover] = useReducer((state, patch) => ({ ...state, ...patch }), { coverOpen: false, coverNotice: '' });
  const setCoverOpen = (coverOpen) => setCover({ coverOpen });
  const setCoverNotice = (coverNotice) => setCover({ coverNotice });
  const fileInput = useRef(null),
    controls = useRef(null),
    fileRun = useRef(0),
    captureRun = useRef(0),
    valueRef = useRef(null),
    mounted = useRef(true),
    fileAbort = useRef(null);
  const source = useRef({ card, kind, draft });
  source.current = { card, kind, draft };
  useEffect(() => {
    const fileRequests = fileRun,
      captureRequests = captureRun,
      abort = fileAbort;
    mounted.current = true;
    return () => {
      mounted.current = false;
      fileRequests.current++;
      captureRequests.current++;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    fileRun.current++;
    captureRun.current++;
    setBusy(false);
    setFetching(false);
    setFetched(null);
    if (source.current.draft === undefined) setLocal(defaultCard(source.current.card, source.current.kind));
    setError('');
    setPopover('');
  }, [card?.id, kind]);
  useEffect(() => {
    if (!popover) return;
    const click = (event) => {
        if (!controls.current?.contains(event.target)) setPopover('');
      },
      key = (event) => {
        if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) setPopover('');
      };
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', key);
    };
  }, [popover]);
  const raw = { ...defaultCard(card, kind), ...(draft === undefined ? local : draft) },
    value = { ...raw, body: String(raw.body || ''), caption: String(raw.caption || ''), sourceUrl: String(raw.sourceUrl || '') };
  valueRef.current = value;
  const working = busy || fetching;
  const collectionIds = Array.isArray(value.collectionIds) ? value.collectionIds : [];
  function change(patch) {
    const next = { ...valueRef.current, ...patch };
    valueRef.current = next;
    if (draft === undefined) setLocal(next);
    onDraftChange?.(next);
    if (patch.sourceUrl !== undefined && patch.sourceUrl !== value.sourceUrl) setFetched(null);
    setError('');
  }
  function toggleCollection(id) {
    change({ collectionIds: collectionIds.includes(id) ? collectionIds.filter((value) => value !== id) : [...collectionIds, id] });
  }
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const run = ++fileRun.current;
    fileAbort.current?.abort();
    const controller = new AbortController();
    fileAbort.current = controller;
    setBusy(true);
    setError('');
    try {
      const descriptor = fileTypeFor(file);
      if (kind === 'book' && !isBookFile(descriptor)) throw new Error('图书仅支持 PDF 或 EPUB，请选择对应原文件。');
      if (!descriptor) throw new Error('请选择支持的图片、PDF、EPUB、Word 文档、视频或音频文件。');
      if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) throw new Error(`请选择非空文件，大小不能超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB。`);
      const original = await readLocalFile(file, true);
      if (!mounted.current || run !== fileRun.current) return;
      const dataUrl = `data:${descriptor.type};base64,${original.slice(original.indexOf(',') + 1)}`,
        type = isBookFile(descriptor) && (kind === 'book' || valueRef.current.type === 'book') ? 'book' : importedCardType(descriptor),
        attachment = normalizeWorkspaceAttachment({ name: file.name, type: descriptor.type, size: file.size, dataUrl });
      setCoverOpen(false);
      setCoverNotice('');
      change({ image: descriptor.kind === 'image' ? dataUrl : '', attachment, type });
      if (type === 'book') {
        try {
          const image = await defaultBookCover(attachment, { signal: controller.signal });
          if (mounted.current && run === fileRun.current) {
            change({ image });
            setCoverNotice(image ? '已在本机提取封面，可更换。' : '原书未提供封面，可选择本机图片。');
          }
        } catch {
          if (mounted.current && run === fileRun.current) setCoverNotice('未能提取封面；原文件已保留，可手动设置封面。');
        }
      }
    } catch (e) {
      if (mounted.current && run === fileRun.current) setError(messageFor(e));
    } finally {
      if (mounted.current && run === fileRun.current) setBusy(false);
    }
  }
  async function fetchSource() {
    if (working) return;
    const source = safeSourceUrl(valueRef.current.sourceUrl);
    if (!source) {
      setError('请先输入完整的 HTTP 或 HTTPS 来源链接。');
      return;
    }
    const run = ++captureRun.current,
      snapshot = { ...valueRef.current };
    setFetching(true);
    setError('');
    try {
      const result = await captureWebPage(source);
      if (!mounted.current || run !== captureRun.current || valueRef.current.sourceUrl.trim() !== source) return;
      setFetched(result);
      const current = valueRef.current,
        patch = {};
      if (!current.body.trim() && current.body === snapshot.body) patch.body = result.body;
      if (!current.title && current.title === snapshot.title) patch.title = result.title;
      if (!current.sourceTitle) patch.sourceTitle = result.sourceTitle;
      if (!current.author && result.author) patch.author = result.author;
      if (Object.keys(patch).length) change(patch);
    } catch (e) {
      if (mounted.current && run === captureRun.current) setError(messageFor(e));
    } finally {
      if (mounted.current && run === captureRun.current) setFetching(false);
    }
  }
  function useFetchedContent() {
    if (!fetched) return;
    change({
      body: fetched.body,
      sourceTitle: fetched.sourceTitle,
      ...(!valueRef.current.title ? { title: fetched.title } : {}),
      ...(!valueRef.current.author && fetched.author ? { author: fetched.author } : {}),
    });
  }
  async function save() {
    if (working) return;
    if (kind === 'book' && !isBookFile(value.attachment ? fileTypeFor(value.attachment) : null)) {
      setError('请先选择 PDF 或 EPUB 原文件，再保存图书。');
      return;
    }
    if (value.sourceUrl && !validUrl(value.sourceUrl.trim())) {
      setError('来源必须是 HTTP 或 HTTPS 链接。');
      return;
    }
    if (!value.body.trim() && !value.sourceUrl.trim() && !value.image && !value.attachment) {
      setError('请先添加文字、来源链接或文件，再保存。');
      return;
    }
    if (kind === 'link' && !value.sourceUrl.trim()) {
      setError('请添加要保存的链接。');
      return;
    }
    const displayText = value.body
      .replace(/\[([^\]]+)\]\(https?:[^)]+\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/\*([^*\n]+)\*/g, '$1');
    const title = String(value.title || '').trim() || deriveTitle(displayText || value.caption || value.sourceUrl || value.attachment?.name) || '未命名';
    // Existing and recovered cards retain their semantic type. Upload/removal
    // explicitly updates value.type when the user changes the actual attachment.
    const descriptor = value.attachment ? fileTypeFor(value.attachment) : null,
      type =
        card || draft === undefined || draft?.type
          ? value.type || kind
          : kind === 'file'
            ? descriptor
              ? importedCardType(descriptor)
              : value.image
                ? 'image'
                : 'file'
            : kind;
    const payload = {
      ...(value.id ? { id: value.id } : {}),
      title,
      body: value.body,
      caption: value.caption,
      sourceUrl: value.sourceUrl.trim(),
      sourceTitle: value.sourceTitle || '',
      author: value.author || '',
      page: value.page || '',
      sourceLocation: value.sourceLocation || '',
      importFingerprint: value.importFingerprint || '',
      sourceCardId: value.sourceCardId || '',
      ...(value.sourceAudioSha256 ? { sourceAudioSha256: value.sourceAudioSha256 } : {}),
      ...(value.sourceAttachmentSha256 ? { sourceAttachmentSha256: value.sourceAttachmentSha256 } : {}),
      type,
      image: value.image || '',
      favorite: Boolean(value.favorite),
      private: Boolean(value.private),
      collectionIds: [...new Set(collectionIds)],
      attachment: value.attachment || null,
    };
    setBusy(true);
    setError('');
    try {
      if (typeof onSave !== 'function') throw new Error('当前无法保存。');
      await onSave(payload);
    } catch (e) {
      if (mounted.current) setError(messageFor(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return {
    value,
    working,
    collectionIds,
    change,
    toggleCollection,
    upload,
    fetchSource,
    useFetchedContent,
    save,
    busy,
    fetching,
    fetched,
    error,
    popover,
    setPopover,
    collectionQuery,
    setCollectionQuery,
    coverOpen,
    setCoverOpen,
    coverNotice,
    setCoverNotice,
    fileInput,
    controls,
  };
}
