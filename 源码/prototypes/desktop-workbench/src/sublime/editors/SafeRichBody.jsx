import React from 'react';
import { richInline } from './richInline.jsx';

export function safeRichBlocks(text, { markdown = false, onReference } = {}) {
  const lines = String(text).split('\n'),
    blocks = [];
  const inline = (line) => richInline(line, 0, true, false, markdown, onReference);
  let paragraph = [],
    list = [],
    quotes = [],
    listKind = 'ul',
    listStart = 1,
    fence = null,
    code = [];
  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(
      <p key={blocks.length}>
        {paragraph.map((line, index) => (
          <React.Fragment key={index}>
            {index > 0 && <br />}
            {inline(line)}
          </React.Fragment>
        ))}
      </p>,
    );
    paragraph = [];
  }
  function flushList() {
    if (!list.length) return;
    const Tag = listKind;
    blocks.push(
      <Tag key={blocks.length} {...(listKind === 'ol' ? { start: listStart } : {})}>
        {list.map((line, index) => {
          const label = markdown && /^([^：:*\[\]`]{1,12}：)\s*(.+)$/.exec(line);
          return (
            <li key={index}>
              {label ? (
                <>
                  <strong>{label[1]}</strong>
                  {inline(label[2])}
                </>
              ) : (
                inline(line)
              )}
            </li>
          );
        })}
      </Tag>,
    );
    list = [];
  }
  function flushQuotes() {
    if (!quotes.length) return;
    blocks.push(
      <blockquote key={blocks.length}>
        {quotes.map((line, index) => (
          <React.Fragment key={index}>
            {index > 0 && <br />}
            {inline(line)}
          </React.Fragment>
        ))}
      </blockquote>,
    );
    quotes = [];
  }
  function flushCode() {
    blocks.push(
      <pre key={blocks.length}>
        <code {...(fence.language ? { className: `language-${fence.language}` } : {})}>{code.join('\n')}</code>
      </pre>,
    );
    fence = null;
    code = [];
  }
  for (const rawLine of lines) {
    const line = markdown ? rawLine.replace(/\r$/, '') : rawLine;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) flushCode();
      else code.push(line);
      continue;
    }
    const open = markdown && /^ {0,3}(`{3,}|~{3,})([a-zA-Z0-9_+-]*)\s*$/.exec(line);
    if (open) {
      flushParagraph();
      flushList();
      flushQuotes();
      fence = { character: open[1][0], length: open[1].length, language: open[2] };
      continue;
    }
    const heading = markdown && /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    const quote = markdown && /^ {0,3}>\s?(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuotes();
      const Tag = `h${heading[1].length}`;
      blocks.push(<Tag key={blocks.length}>{inline(heading[2])}</Tag>);
      continue;
    }
    if (quote) {
      flushParagraph();
      flushList();
      quotes.push(quote[1]);
      continue;
    }
    flushQuotes();
    const ordered = markdown && /^ {0,3}(\d{1,9})[.)]\s+(.*)$/.exec(line);
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const kind = ordered ? 'ol' : 'ul';
      if (listKind !== kind) flushList();
      if (!list.length && ordered) listStart = Number(ordered[1]);
      listKind = kind;
      list.push(ordered ? ordered[2] : unordered[1]);
      continue;
    }
    flushList();
    if (markdown ? !line.trim() : !line) {
      flushParagraph();
      if (!markdown)
        blocks.push(
          <p key={blocks.length}>
            <br />
          </p>,
        );
    } else paragraph.push(line);
  }
  if (fence) flushCode();
  flushParagraph();
  flushList();
  flushQuotes();
  return blocks;
}

export const SafeRichBody = React.memo(function SafeRichBody({ text = '', className = '', onReference }) {
  return text ? <div className={`se-safe-rich ${className}`}>{safeRichBlocks(text, { markdown: true, onReference })}</div> : null;
});
