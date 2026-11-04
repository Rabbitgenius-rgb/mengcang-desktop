import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { IconArrowUpRight, IconX } from '@tabler/icons-react';
import { safeSourceUrl } from '.././workspaceModel.js';
import { SafeRichBody } from '.././SublimeEditors.jsx';
import { noteReadingSections, noteLinkPresentation, resolveNoteReference, cardIdentityMetadata } from '.././workspaceView.js';
import { CollectionChips } from '.././CardContent.jsx';
import { download } from './constants.js';

export function CardText({ text = '', onReference }) {
  return <SafeRichBody text={text} className="sw-rich-body" onReference={onReference} />;
}

export function CardIdentity({ card, context }) {
  const identity = cardIdentityMetadata(card, context);
  return (
    <span className="sw-card-identity" aria-label={identity.accessibleLabel}>
      <span className="sw-card-identity-origin">{identity.originLabel}</span>
      {identity.recognitionLabel && <span className="sw-card-identity-recognition">{identity.recognitionLabel}</span>}
      {identity.duplicateLabel && <small className="sw-card-identity-duplicate">{identity.duplicateLabel}</small>}
    </span>
  );
}

export function NoteReadingBody({ card, onReference }) {
  const reading = noteReadingSections(card.body || card.title);
  return (
    <>
      <CardText text={reading.body} onReference={onReference} />
      {reading.archive && (
        <details className="sw-note-archive">
          <summary>收录记录 · 展开原话</summary>
          <CardText text={reading.archive} onReference={onReference} />
        </details>
      )}
    </>
  );
}

export function NoteLinkArea({ card, cards, collections, onReference, onCollection }) {
  const links = noteLinkPresentation(card).filter((link) => link.kind !== 'external' || link.target !== safeSourceUrl(card.sourceUrl));
  return (
    <>
      <CollectionChips card={card} collections={collections} onOpenCollection={onCollection} />
      {links.length > 0 && (
        <details className="sw-note-links" aria-label="链接与关联">
          <summary>更多关联 · {links.length}</summary>
          <ul>
            {links.map((link) => {
              const resolved = link.kind === 'internal' ? resolveNoteReference(link.target, cards, card) : null;
              return (
                <li key={link.kind + link.target}>
                  {link.kind === 'external' ? (
                    <a href={link.target} target="_blank" rel="noreferrer">
                      <span>{link.label}</span>
                      <small>{link.description}</small>
                      <IconArrowUpRight size={16} />
                    </a>
                  ) : (
                    <button type="button" onClick={() => onReference(link.target)}>
                      <span>{link.label}</span>
                      <small>
                        {resolved.status === 'resolved' ? '资料库内引用' : resolved.status === 'ambiguous' ? '有同名资料 · 选择' : '未找到对应资料 · 查找'}
                      </small>
                      <IconArrowUpRight size={16} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </>
  );
}

export function IconButton({ label, children, onClick, className = '', ...rest }) {
  return (
    <button type="button" className={`sw-icon-button ${className}`} aria-label={label} title={label} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current,
      active = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      active?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sw-modal ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton label="关闭对话框" onClick={onClose}>
          <IconX size={20} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}

export function GeneratedDownload({ text, name, type = 'text/html', label = '重新下载生成的卡片' }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([text], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [text, type]);
  return url ? (
    <p>
      <a download={name} href={url}>
        {label}
      </a>
    </p>
  ) : null;
}
