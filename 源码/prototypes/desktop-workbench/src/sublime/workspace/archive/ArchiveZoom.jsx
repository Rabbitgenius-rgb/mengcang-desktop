import React, { useState } from 'react';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import { ArchiveFace } from './ArchiveWall.jsx';
import { archiveEntry, serial } from './archiveModel.js';

// One object at a time (Studio Freight Zoom / Rabo collection): title on the
// left, identity on the right, the next object peeking below the stage.
export function ArchiveZoom({ cards, ctx, label }) {
  const [position, setPosition] = useState(0);
  if (!cards.length) return null;
  const at = Math.min(position, cards.length - 1);
  const card = cards[at],
    entry = archiveEntry(card),
    next = cards[at + 1] ? archiveEntry(cards[at + 1]) : null;
  const go = (step) => setPosition(Math.max(0, Math.min(cards.length - 1, at + step)));
  return (
    <section
      className="az-zoom"
      aria-label={label + '，第 ' + (at + 1) + ' / ' + cards.length + ' 件'}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') go(1);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') go(-1);
        else return;
        event.preventDefault();
      }}
    >
      <div className="az-side az-side-left">
        <span className="az-no">
          № {serial(at)} <i>/ {serial(cards.length - 1)}</i>
        </span>
        <h2 className="az-title">{entry.title}</h2>
        <div className="az-steps">
          <button type="button" onClick={() => go(-1)} disabled={at === 0} aria-label="上一件">
            <IconArrowLeft size={16} />
          </button>
          <button type="button" onClick={() => go(1)} disabled={at === cards.length - 1} aria-label="下一件">
            <IconArrowRight size={16} />
          </button>
        </div>
      </div>
      <button type="button" key={card.id} className={'az-stage az-form-' + entry.form} onClick={() => ctx.onOpen(card)} aria-label={'打开 ' + entry.title}>
        <ArchiveFace entry={entry} large />
      </button>
      <div className="az-side az-side-right">
        <dl className="az-spec">
          <dt>类型</dt>
          <dd>{entry.kindLabel}</dd>
          {entry.source && (
            <>
              <dt>来源</dt>
              <dd>{entry.source}</dd>
            </>
          )}
          {entry.date && (
            <>
              <dt>收录</dt>
              <dd>{entry.date}</dd>
            </>
          )}
          {entry.tags.length > 0 && (
            <>
              <dt>标签</dt>
              <dd>{entry.tags.join(' · ')}</dd>
            </>
          )}
        </dl>
        <div className="az-actions">{ctx.actions(card)}</div>
      </div>
      {next && (
        <button type="button" className="az-next" onClick={() => go(1)} aria-label={'下一件：' + next.title}>
          <span>下一件</span>
          <strong>{next.title}</strong>
        </button>
      )}
    </section>
  );
}
