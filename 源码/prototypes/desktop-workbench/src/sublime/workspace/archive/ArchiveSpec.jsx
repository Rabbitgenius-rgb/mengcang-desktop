import React from 'react';
import { IconArrowUpRight } from '@tabler/icons-react';
import { archiveEntry } from './archiveModel.js';
import { safeSourceUrl } from '../../workspaceModel.js';

// Identity block beside the object (A24 ruled spec sheet / M+ identity area).
// Display only: every value comes from the card as stored.
export default function ArchiveSpec({ card, collections = [], onCollection }) {
  const entry = archiveEntry(card);
  const url = safeSourceUrl(card.sourceUrl);
  const groups = collections.filter((collection) => collection.cardIds?.includes(card.id));
  return (
    <header className="as-spec">
      <span className="as-kind">{entry.kindLabel}</span>
      <h1 className="as-title">{entry.title}</h1>
      <dl className="as-sheet">
        {entry.source && (
          <>
            <dt>来源</dt>
            <dd>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {entry.source}
                  <IconArrowUpRight size={12} aria-hidden="true" />
                </a>
              ) : (
                entry.source
              )}
            </dd>
          </>
        )}
        {entry.author && (
          <>
            <dt>作者</dt>
            <dd>{entry.author}</dd>
          </>
        )}
        {entry.date && (
          <>
            <dt>收录</dt>
            <dd className="as-mono">{entry.date}</dd>
          </>
        )}
        {groups.length > 0 && (
          <>
            <dt>收藏集</dt>
            <dd>
              {groups.map((group) => (
                <button key={group.id} type="button" onClick={() => onCollection(group.id)}>
                  {group.title}
                </button>
              ))}
            </dd>
          </>
        )}
        {entry.tags.length > 0 && (
          <>
            <dt>标签</dt>
            <dd>{entry.tags.join(' · ')}</dd>
          </>
        )}
      </dl>
    </header>
  );
}
