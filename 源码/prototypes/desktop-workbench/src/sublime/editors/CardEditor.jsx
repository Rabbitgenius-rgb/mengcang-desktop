import React from 'react';
import {
  IconBook,
  IconCheck,
  IconLink,
  IconLoader2,
  IconLock,
  IconPlus,
  IconSearch,
  IconStar,
  IconTrash,
  IconUpload,
  IconX,
  IconFileText,
  IconFolder,
} from '@tabler/icons-react';
import { MAX_ATTACHMENT_BYTES } from '../workspaceModel.js';
import { attachmentAccept, fileTypeFor } from '../attachmentPreview.js';
import AttachmentPreview from '../AttachmentPreview.jsx';
import BookCoverEditor from '../BookCoverEditor.jsx';
import { isBookFile, validUrl } from './editorModel.js';
import { ErrorMessage, FlagButton } from './EditorChrome.jsx';
import { RichText } from './RichText.jsx';
import { useCardEditor } from './useCardEditor.js';
export function CardEditor(props) {
  const { kind = 'text', card = null, collections = [], onCancel } = props;
  const {
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
  } = useCardEditor(props);
  function collectionsControl() {
    const filtered = collections.filter((collection) => collection.title.toLocaleLowerCase().includes(collectionQuery.toLocaleLowerCase()));
    return (
      <div className="se-popover-anchor">
        <button
          type="button"
          className={`se-pill ${collectionIds.length ? 'has-value' : ''}`}
          aria-label="收藏集"
          aria-expanded={popover === 'collections'}
          disabled={working}
          onClick={() => setPopover((value) => (value === 'collections' ? '' : 'collections'))}
        >
          <IconFolder size={17} />
          <span>收藏集{collectionIds.length ? ` (${collectionIds.length})` : ''}</span>
          <IconPlus className="se-pill-plus" size={19} />
        </button>
        {popover === 'collections' && (
          <div className="se-control-popover se-collection-popover">
            <label className="se-collection-search">
              <IconSearch size={18} />
              <input
                aria-label="搜索收藏集"
                placeholder="搜索收藏集"
                value={collectionQuery}
                onChange={(event) => setCollectionQuery(event.target.value)}
                autoFocus
              />
            </label>
            <div>
              {filtered.length ? (
                filtered.map((collection) => (
                  <label key={collection.id}>
                    <input
                      type="checkbox"
                      checked={collectionIds.includes(collection.id)}
                      disabled={working}
                      onChange={() => toggleCollection(collection.id)}
                    />
                    <span>{collection.title}</span>
                    {collectionIds.includes(collection.id) && <IconCheck size={16} />}
                  </label>
                ))
              ) : (
                <p>未找到收藏集</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
  const flags = (
    <>
      <FlagButton label="标星" icon={IconStar} checked={Boolean(value.favorite)} disabled={working} onChange={(favorite) => change({ favorite })} />
      <FlagButton label="私密" icon={IconLock} checked={Boolean(value.private)} disabled={working} onChange={(isPrivate) => change({ private: isPrivate })} />
      {isBookFile(value.attachment ? fileTypeFor(value.attachment) : null) && (
        <FlagButton
          label="收录到图书"
          icon={IconBook}
          checked={value.type === 'book'}
          disabled={working}
          onChange={(isBook) => change({ type: isBook ? 'book' : 'file' })}
        />
      )}
    </>
  );
  const saveButton = (
    <button type="button" className="se-save" disabled={working} onClick={save}>
      {busy ? <IconLoader2 className="se-spin" size={17} /> : null}
      {busy ? '正在保存…' : '保存'}
    </button>
  );
  const sourceInput = (
    <input
      className="se-panel-input"
      aria-label="来源链接"
      placeholder={kind === 'link' ? '链接' : '来源链接（选填）'}
      value={value.sourceUrl}
      onChange={(event) => change({ sourceUrl: event.target.value, sourceTitle: '', author: '' })}
      disabled={working}
      autoFocus
    />
  );
  const captureControl = (
    <div className="se-web-capture">
      <button type="button" className="se-secondary" disabled={working || !validUrl(value.sourceUrl)} onClick={fetchSource}>
        {fetching ? <IconLoader2 className="se-spin" size={16} /> : <IconFileText size={16} />}
        {fetching ? '正在获取…' : '获取网页内容'}
      </button>
      {fetched && (
        <details>
          <summary>网页原文 · {fetched.body.length.toLocaleString()} 字符</summary>
          <textarea readOnly aria-label="采集的网页预览" value={fetched.body} rows={6} />
          <button type="button" className="se-secondary" disabled={working} onClick={useFetchedContent}>
            使用网页内容替换正文
          </button>
          {(fetched.truncated || fetched.warnings?.length > 0) && (
            <p>{[fetched.truncated ? '网页内容因长度限制被截取。' : '', ...(fetched.warnings || [])].filter(Boolean).join(' ')}</p>
          )}
          <small>已有手写正文会保留，只有点击替换才覆盖。</small>
        </details>
      )}
    </div>
  );
  return (
    <main className={`sublime-editor se-card-editor ${kind === 'link' ? 'se-panel-editor' : ''}`}>
      <h1 className="se-sr-only">
        {card
          ? '编辑卡片'
          : `新建${{ text: '文字卡片', link: '链接卡片', file: '文件卡片', book: '图书', image: '图片卡片', video: '视频卡片', audio: '音频卡片' }[kind] || '卡片'}`}
      </h1>
      <button type="button" className="se-editor-back" aria-label="返回并关闭编辑器" disabled={working} onClick={onCancel}>
        <IconX size={23} />
      </button>
      {kind === 'link' ? (
        <div className="se-source-panel se-link-panel" ref={controls}>
          <ErrorMessage error={error} />
          {sourceInput}
          {captureControl}
          <input
            className="se-panel-input se-page-title"
            aria-label="卡片标题"
            placeholder="标题（选填）"
            value={value.title}
            onChange={(event) => change({ title: event.target.value })}
            disabled={working}
          />
          <RichText value={value.body} onChange={(body) => change({ body })} label="卡片正文" placeholder="网页正文（选填）" minRows={3} disabled={working} />
          <RichText
            value={value.caption}
            onChange={(caption) => change({ caption })}
            label="我的备注"
            placeholder="备注（选填）"
            minRows={3}
            disabled={working}
          />
          {collectionsControl()}
          <div className="se-panel-flags">{flags}</div>
          <div className="se-panel-save">{saveButton}</div>
        </div>
      ) : (
        <>
          <div className="se-card-controls" ref={controls}>
            <div className="se-popover-anchor">
              <button
                type="button"
                className="se-pill"
                aria-expanded={popover === 'source'}
                disabled={working}
                onClick={() => setPopover((value) => (value === 'source' ? '' : 'source'))}
              >
                <IconLink size={17} />
                来源
              </button>
              {popover === 'source' && (
                <div className="se-control-popover">
                  {sourceInput}
                  {captureControl}
                </div>
              )}
            </div>
            <div className="se-popover-anchor">
              <button
                type="button"
                className="se-pill"
                aria-expanded={popover === 'note'}
                disabled={working}
                onClick={() => setPopover((value) => (value === 'note' ? '' : 'note'))}
              >
                <IconFileText size={17} />
                备注
              </button>
              {popover === 'note' && (
                <div className="se-control-popover se-note-popover">
                  <RichText
                    value={value.caption}
                    onChange={(caption) => change({ caption })}
                    label="我的备注"
                    placeholder="备注（选填）"
                    minRows={3}
                    disabled={working}
                    autoFocus
                  />
                </div>
              )}
            </div>
            {collectionsControl()}
            {flags}
            {saveButton}
          </div>
          <div className="se-note-body">
            <ErrorMessage error={error} />
            {card?.externalSource?.provider === 'deepseek-harness' && (
              <label className="se-field">
                回看标题
                <input
                  aria-label="回看标题"
                  value={value.title}
                  maxLength={500}
                  onChange={(event) => change({ title: event.target.value })}
                  disabled={working}
                />
              </label>
            )}
            {['file', 'book'].includes(kind) && (
              <section className="se-file-section">
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept={kind === 'book' ? '.pdf,.epub,application/pdf,application/epub+zip' : attachmentAccept()}
                  onChange={upload}
                />
                {value.attachment ? (
                  <AttachmentPreview attachment={value.attachment} />
                ) : (
                  value.image && <img className="se-file-preview" src={value.image} alt="已选图片" />
                )}
                <div className="se-file-row">
                  <button type="button" className="se-secondary" disabled={working} onClick={() => fileInput.current?.click()}>
                    <IconUpload size={18} />
                    {value.attachment ? '替换文件' : '选择文件'}
                  </button>
                  {value.attachment && (
                    <button
                      type="button"
                      className="se-icon-button"
                      aria-label="移除附件"
                      disabled={working}
                      onClick={() => change({ attachment: null, image: '', type: 'file' })}
                    >
                      <IconTrash size={18} />
                    </button>
                  )}
                </div>
                <small>
                  {kind === 'book' ? 'PDF 和 EPUB 图书' : '图片、PDF、EPUB、Word、视频和音频'} · 最大 {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB，完整保留原文件。
                </small>
              </section>
            )}
            {value.type === 'book' && isBookFile(fileTypeFor(value.attachment)) && (
              <section className="se-book-cover-row">
                {value.image && <img src={value.image} alt="图书封面" />}
                <div>
                  <button type="button" className="se-secondary" disabled={working} onClick={() => setCoverOpen(!coverOpen)}>
                    {value.image ? '更换封面' : '设置封面'}
                  </button>
                  <small role="status">{coverNotice || '在本机提取或选择封面图片。'}</small>
                </div>
              </section>
            )}
            {coverOpen && value.attachment && (
              <div className="se-book-cover-panel">
                <BookCoverEditor
                  key={value.attachment.dataUrl}
                  attachment={value.attachment}
                  image={value.image}
                  onSave={(image) => {
                    change({ image });
                    setCoverOpen(false);
                    setCoverNotice('封面已更新，保存卡片后生效。');
                  }}
                  onCancel={() => setCoverOpen(false)}
                />
              </div>
            )}
            <RichText
              value={value.body}
              onChange={(body) => change({ body })}
              label="卡片正文"
              placeholder="在此输入…"
              disabled={working}
              autoFocus={kind === 'text'}
            />
          </div>
        </>
      )}
    </main>
  );
}
