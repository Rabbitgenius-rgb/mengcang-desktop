import React, { useState } from 'react';
import { IconFolder, IconPhoto } from '@tabler/icons-react';
import { relatedCardPreview, relatedTypeKey } from './relatedBrowser.js';
import './cardContent.css';
import { titleMatchParts } from './searchTitle.js';

// Pure display projection shared by the library, related cards and highlights.
// Source actions live outside the open button, avoiding nested interactive nodes.
export default function CardContent({
  card,
  onOpen,
  sourceFooter,
  sourceAction,
  onOpenSource,
  onExternalSource,
  sourceBusy,
  sourceStatus,
  reason,
  openLabel,
  actionHint,
  keyword,
}) {
  const preview = relatedCardPreview(card),
    kind = relatedTypeKey(card);
  const [failedImage, setFailedImage] = useState('');
  const textFirst = ['text', 'highlight'].includes(kind) && !preview.image;
  const title = card.title || '未命名资料',
    text = preview.text || (!preview.image ? title : '');
  const hostname = (() => {
    try {
      return new URL(card.sourceUrl).hostname;
    } catch {
      return '';
    }
  })();
  const source = card.sourceTitle && card.sourceTitle !== title ? card.sourceTitle : hostname;
  const caption = preview.image ? (card.caption || '').trim() : '';
  const showTitle = !textFirst || (!source && !text.startsWith(title));
  const lines = text.split('\n').filter((line) => line.trim());
  const titleParts = keyword && titleMatchParts(title, keyword);
  const firstIndex = titleParts && !preview.image && lines.length ? lines[0].indexOf(title) : -1;
  const markedTitle = titleParts && titleParts.map(([part, hit], i) => (hit ? <mark key={i}>{part}</mark> : part));
  return (
    <div className="sc-content">
      <button
        type="button"
        className={'sc-open sc-kind-' + kind + (preview.image ? ' sc-has-image' : '') + (textFirst ? ' sc-text-first' : '')}
        onClick={() => onOpen?.(card.id)}
        aria-label={openLabel || '打开 ' + title}
      >
        {markedTitle && firstIndex < 0 && <strong className="sc-match-title">{markedTitle}</strong>}
        {preview.image ? (
          <div className="sc-picture">
            {failedImage === preview.image ? (
              <div className="sc-image-unavailable">
                <IconPhoto size={30} />
                <span>图片暂不可用</span>
              </div>
            ) : (
              <img src={preview.image} alt={title} loading="lazy" onError={() => setFailedImage(preview.image)} />
            )}
          </div>
        ) : (
          <div className="sc-excerpt">
            {lines.map((line, index) => (
              <p key={index}>
                {index === 0 && firstIndex >= 0 ? (
                  <>
                    {line.slice(0, firstIndex)}
                    {markedTitle}
                    {line.slice(firstIndex + title.length)}
                  </>
                ) : (
                  line
                )}
              </p>
            ))}
          </div>
        )}
        {actionHint && <span className="sc-action-hint">{actionHint}</span>}
      </button>
      <footer className={'sc-footer' + (preview.image ? ' sc-image-footer' : '')}>
        {caption && <p className="sc-caption">{caption}</p>}
        {showTitle && !markedTitle && title !== caption && title !== sourceAction?.title && <span className="sc-title">{title}</span>}
        {sourceFooter ??
          (sourceAction || source || card.author ? (
            <div className="sc-origin">
              {sourceAction ? (
                <>
                  <CardSourceLink source={sourceAction} onOpen={onOpenSource} onExternal={onExternalSource} busy={sourceBusy} />
                  {sourceStatus}
                </>
              ) : (
                source && source !== title && <span>{source}</span>
              )}
              {card.author && card.author !== (sourceAction?.title || source) && <small>{card.author}</small>}
            </div>
          ) : null)}
        {reason && <small className="sc-reason">{reason}</small>}
      </footer>
    </div>
  );
}

function CardSourceLink({ source, onOpen, onExternal, busy }) {
  const label = source.label + '：' + source.title;
  if (source.cardId)
    return (
      <button className="sc-source-link" type="button" aria-label={label} onClick={() => onOpen(source.cardId)}>
        {source.title}
      </button>
    );
  return (
    <a
      className="sc-source-link"
      aria-label={'打开原网页：' + source.title}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-busy={busy || undefined}
      onClick={onExternal}
      onAuxClick={onExternal}
    >
      {busy ? '正在匹配原文…' : source.title}
    </a>
  );
}

export function CollectionChips({ card, collections = [], onOpenCollection }) {
  const groups = collections.filter((collection) => collection.cardIds?.includes(card.id));
  if (!groups.length) return null;
  return (
    <div className="sc-collections" aria-label="所在收藏集">
      {groups.map((group) =>
        onOpenCollection ? (
          <button type="button" key={group.id} onClick={() => onOpenCollection(group.id)} title={group.title}>
            <IconFolder size={14} />
            <span>{group.title}</span>
          </button>
        ) : (
          <span className="sc-collection" key={group.id}>
            <IconFolder size={14} />
            {group.title}
          </span>
        ),
      )}
    </div>
  );
}
