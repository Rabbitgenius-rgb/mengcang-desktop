import React from 'react';
import { articleSourceUrl } from './articleReaderModel.js';

export default function OriginalPositionStatus({ card, state }) {
  if (state?.id !== card.id) return null;
  if (state.status === 'error')
    return (
      <span className="sw-position-error" role="alert">
        {state.message}
        <a href={articleSourceUrl(card.sourceUrl)} target="_blank" rel="noopener noreferrer">
          打开原网页 ↗
        </a>
      </span>
    );
  if (state.status !== 'located' || state.quote !== card.webAnchor?.exact || state.sourceUrl !== card.sourceUrl) return null;
  return (
    <span className="sw-position-result" role="status">
      <small>英文原句</small>
      <span lang="en">{state.result.sourceSentence}</span>
    </span>
  );
}
