import React, { useState } from 'react';
import { IconStarFilled, IconArrowUpRight } from '@tabler/icons-react';
import { archiveEntry, serial } from './archiveModel.js';

// The physical form of one saved item: picture, paper slip, typeset quote or
// ticket. Shared by the wall and the zoom stage so both read as the same object.
export function ArchiveFace({ entry, large = false }) {
  const [failed, setFailed] = useState('');
  const form = entry.form === 'image' && failed === entry.image ? 'slip' : entry.form;
  if (form === 'image')
    return (
      <span className="ao-picture">
        <img src={entry.image} alt={entry.title} loading="lazy" onError={() => setFailed(entry.image)} />
      </span>
    );
  if (form === 'quote')
    return (
      <span className={'ao-paper ao-quote ao-tone-' + entry.tone}>
        <span className="ao-mark" aria-hidden="true">
          “
        </span>
        <span className="ao-quote-text">{entry.text || entry.title}</span>
        {(entry.source || entry.author) && <span className="ao-cite">— {entry.author || entry.source}</span>}
      </span>
    );
  return (
    <span className={'ao-paper ao-' + form + ' ao-tone-' + entry.tone}>
      <span className="ao-paper-head">
        <span>{entry.kindLabel}</span>
        {form === 'ticket' && entry.host ? (
          <span className="ao-host">
            {entry.host}
            <IconArrowUpRight size={11} aria-hidden="true" />
          </span>
        ) : (
          entry.date && <span>{entry.date}</span>
        )}
      </span>
      <span className="ao-paper-title">{entry.title}</span>
      {entry.text && <span className={'ao-paper-text' + (large ? ' is-large' : '')}>{entry.text}</span>}
    </span>
  );
}

export function ArchiveObject({ card, index, ctx }) {
  const entry = archiveEntry(card);
  const { onOpen, actions, selectionMode, selected, onToggle, favorite, active } = ctx;
  return (
    <article className={'ao ao-form-' + entry.form + (active === card.id ? ' is-active' : '')} role="gridcell">
      <button type="button" className="ao-open" onClick={() => onOpen(card)} aria-label={`打开 ${entry.title} · ${entry.kindLabel}`}>
        <ArchiveFace entry={entry} />
      </button>
      <div className="ao-caption" aria-hidden="true">
        <span className="ao-no">№ {serial(index)}</span>
        <span className="ao-caption-title">{entry.form === 'image' ? entry.title : entry.source || entry.kindLabel}</span>
      </div>
      <div className="ao-actions">{actions(card)}</div>
      {selectionMode && (
        <label className="ao-select">
          <input type="checkbox" checked={selected.includes(card.id)} onChange={() => onToggle(card.id)} aria-label={`选择 ${entry.title}`} />
        </label>
      )}
      {favorite.has(card.id) && <IconStarFilled className="ao-star" size={12} aria-label="已标星" />}
    </article>
  );
}

export function ArchiveWall({ cards, ctx, label }) {
  return (
    <div className="aw-wall" role="grid" aria-label={label}>
      {cards.map((card, index) => (
        <ArchiveObject key={card.id} card={card} index={index} ctx={ctx} />
      ))}
    </div>
  );
}
