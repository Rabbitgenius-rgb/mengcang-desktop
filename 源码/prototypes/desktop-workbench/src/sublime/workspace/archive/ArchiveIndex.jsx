import React, { useRef, useState } from 'react';
import { archiveEntry, serial } from './archiveModel.js';

// Catalogue rows (Dennis Snellenberg / Studio Freight List). Pictures float
// beside the pointer while a row is hovered; rows stay fully readable without it.
export function ArchiveIndex({ cards, ctx, label }) {
  const [preview, setPreview] = useState(null);
  const float = useRef(null);
  const move = (event) => {
    if (float.current) float.current.style.transform = `translate3d(${event.clientX + 24}px, ${event.clientY - 90}px, 0)`;
  };
  return (
    <div className="ai-index" onMouseMove={move} onMouseLeave={() => setPreview(null)}>
      <div className="ai-head" aria-hidden="true">
        <span>№</span>
        <span>题名</span>
        <span>类型</span>
        <span>来源</span>
        <span>收录</span>
      </div>
      <ol className="ai-list" aria-label={label}>
        {cards.map((card, index) => {
          const entry = archiveEntry(card);
          return (
            <li key={card.id} className={'ai-row' + (ctx.active === card.id ? ' is-active' : '')}>
              <button
                type="button"
                className="ai-open"
                onClick={() => ctx.onOpen(card)}
                onMouseEnter={() => setPreview(entry.image || null)}
                onFocus={() => setPreview(null)}
                aria-label={`打开 ${entry.title} · ${entry.kindLabel}`}
              >
                <span className="ai-no">{serial(index)}</span>
                <span className="ai-title">
                  <strong>{entry.title}</strong>
                  {entry.text && <small>{entry.text}</small>}
                </span>
                <span className="ai-kind">{entry.kindLabel}</span>
                <span className="ai-src">{entry.source || '—'}</span>
                <span className="ai-date">{entry.date || '—'}</span>
              </button>
              <div className="ai-actions">{ctx.actions(card)}</div>
              {ctx.selectionMode && (
                <label className="ao-select">
                  <input type="checkbox" checked={ctx.selected.includes(card.id)} onChange={() => ctx.onToggle(card.id)} aria-label={`选择 ${entry.title}`} />
                </label>
              )}
            </li>
          );
        })}
      </ol>
      <div className="ai-float" ref={float} aria-hidden="true" data-visible={!!preview}>
        {preview && <img src={preview} alt="" />}
      </div>
    </div>
  );
}
