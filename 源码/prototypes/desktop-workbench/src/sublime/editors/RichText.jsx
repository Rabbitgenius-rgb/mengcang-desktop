import React, { useEffect, useRef, useState } from 'react';
import { IconLink, IconX } from '@tabler/icons-react';
import { validUrl } from './editorModel.js';
import { ErrorMessage } from './EditorChrome.jsx';
import { SafeRichBody, safeRichBlocks } from './SafeRichBody.jsx';
// The editable DOM is built from the same safe elements as the display view.
// React does not own its mutable children, so native editing cannot desynchronize them.
function appendSafeElement(parent, value) {
  if (Array.isArray(value)) {
    value.forEach((child) => appendSafeElement(parent, child));
    return;
  }
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'string' || typeof value === 'number') {
    parent.appendChild(document.createTextNode(String(value)));
    return;
  }
  if (!React.isValidElement(value)) return;
  if (value.type === React.Fragment) {
    appendSafeElement(parent, value.props.children);
    return;
  }
  if (!['p', 'br', 'ul', 'li', 'strong', 'em', 'a'].includes(value.type)) return;
  const node = document.createElement(value.type);
  if (value.type === 'a' && validUrl(value.props.href)) {
    node.setAttribute('href', value.props.href);
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noreferrer');
  }
  appendSafeElement(node, value.props.children);
  parent.appendChild(node);
}
function renderEditableText(node, text) {
  if (!node) return;
  node.replaceChildren();
  if (!text) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'se-safe-rich';
  appendSafeElement(wrapper, safeRichBlocks(text));
  node.appendChild(wrapper);
}

function richChildren(node, linkLabel = false) {
  let text = '',
    lastStructural = false;
  for (const child of node.childNodes) {
    const part = richPart(child, linkLabel);
    if (part.block && text && !text.endsWith('\n')) text += '\n';
    text += part.text;
    if (part.text) lastStructural = part.structural;
  }
  return { text, structural: lastStructural };
}
function richPart(node, linkLabel = false) {
  if (node.nodeType === 3) {
    const text = node.nodeValue || '';
    return { text: linkLabel ? text.replace(/([\\[\]*])/g, '\\$1') : text, block: false, structural: false };
  }
  if (node.nodeType !== 1) return { text: '', block: false, structural: false };
  const tag = node.tagName,
    href = tag === 'A' ? node.getAttribute('href') || '' : '',
    isLink = tag === 'A' && validUrl(href),
    inside = richChildren(node, linkLabel || isLink),
    content = inside.text;
  if (tag === 'BR') return { text: '\n', block: false, structural: false };
  if (tag === 'STRONG' || tag === 'B' || tag === 'EM' || tag === 'I') {
    const mark = tag === 'STRONG' || tag === 'B' ? '**' : '*';
    return {
      text: content
        .split('\n')
        .map((line) => (line ? `${mark}${line}${mark}` : ''))
        .join('\n'),
      block: false,
      structural: inside.structural,
    };
  }
  if (tag === 'A') {
    const url = href.replace(/[()*]/g, '\\$&');
    return {
      text:
        isLink && !linkLabel
          ? content
              .split('\n')
              .map((line) => (line ? `[${line}](${url})` : ''))
              .join('\n')
          : content,
      block: false,
      structural: inside.structural,
    };
  }
  if (tag === 'LI') return { text: `- ${inside.structural ? content.slice(0, -1) : content}\n`, block: true, structural: true };
  if (['P', 'DIV', 'UL', 'OL'].includes(tag)) {
    const emptyBreak = node.childNodes.length === 1 && node.childNodes[0].tagName === 'BR';
    return { text: emptyBreak ? '\n' : inside.structural ? content : content + '\n', block: true, structural: true };
  }
  return { text: content, block: false, structural: inside.structural };
}
function serializeRich(node) {
  return richPart(node).text;
}
function serializeEditable(node) {
  if (node.childNodes.length === 1 && node.childNodes[0].tagName === 'BR') return '';
  const result = richChildren(node);
  return result.structural ? result.text.slice(0, -1) : result.text;
}

export function RichText({ value = '', onChange, label = '正文', placeholder = '在此输入…', disabled = false, autoFocus = false, minRows = 8 }) {
  const editable = useRef(null),
    selection = useRef(null),
    lastText = useRef(null),
    composing = useRef(false);
  const [linkOpen, setLinkOpen] = useState(false),
    [linkUrl, setLinkUrl] = useState('https://'),
    [linkError, setLinkError] = useState(''),
    [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!composing.current && String(value) !== lastText.current) {
      renderEditableText(editable.current, String(value));
      lastText.current = String(value);
      selection.current = null;
    }
  }, [value]);
  useEffect(() => {
    if (autoFocus) editable.current?.focus();
  }, [autoFocus]);
  function remember() {
    const current = window.getSelection();
    if (current?.rangeCount && editable.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
  }
  function changed(event) {
    if (composing.current || event?.nativeEvent?.isComposing || !editable.current) return;
    const next = serializeEditable(editable.current);
    if (next !== lastText.current) {
      lastText.current = next;
      onChange(next);
    }
    remember();
  }
  function command(name, argument = null, restoreSelection = true) {
    if (composing.current) {
      setLinkError('请先完成当前文字输入，再设置格式。');
      return;
    }
    editable.current?.focus();
    const current = window.getSelection();
    if (restoreSelection && selection.current) {
      try {
        current.removeAllRanges();
        current.addRange(selection.current);
      } catch {
        selection.current = null;
      }
    }
    if (typeof document.execCommand !== 'function' || !document.execCommand(name, false, argument)) {
      setLinkError('当前浏览器无法设置文字格式。');
      return;
    }
    changed();
  }
  function addLink() {
    if (!validUrl(linkUrl.trim())) {
      setLinkError('请输入完整的 HTTP 或 HTTPS 链接。');
      return;
    }
    command('createLink', linkUrl.trim());
    setLinkOpen(false);
  }
  return (
    <div className={`se-rich ${minRows <= 3 ? 'se-rich-compact' : ''}`}>
      <div
        ref={editable}
        className="se-rich-editable"
        hidden={preview}
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        tabIndex={0}
        data-placeholder={placeholder}
        onCompositionStart={() => {
          composing.current = true;
          editable.current?.setAttribute('data-composing', 'true');
        }}
        onCompositionEnd={() => {
          composing.current = false;
          editable.current?.removeAttribute('data-composing');
          changed();
        }}
        onInput={changed}
        onMouseUp={remember}
        onKeyUp={remember}
        onBlur={() => {
          if (composing.current) {
            composing.current = false;
            editable.current?.removeAttribute('data-composing');
            changed();
          }
          remember();
        }}
        onPaste={(event) => {
          event.preventDefault();
          command('insertText', event.clipboardData.getData('text/plain'), false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const text = event.dataTransfer.getData('text/plain');
          if (text) command('insertText', text, false);
        }}
      />
      {preview && (
        <div className="se-rich-preview" aria-label={`${label}预览`}>
          <SafeRichBody text={value} />
        </div>
      )}
      <div className="se-rich-toolbar" role="toolbar" aria-label={`${label}格式`}>
        <button type="button" aria-label="切换正文预览" aria-pressed={preview} onClick={() => setPreview((value) => !value)}>
          {preview ? '继续编辑' : '预览'}
        </button>
        <button type="button" aria-label="加粗" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => command('bold')}>
          <b>B</b>
        </button>
        <button type="button" aria-label="斜体" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => command('italic')}>
          <i>I</i>
        </button>
        <button
          type="button"
          aria-label="项目符号列表"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command('insertUnorderedList')}
        >
          ☷
        </button>
        <button
          type="button"
          aria-label="插入链接"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            remember();
            setLinkOpen((value) => !value);
            setLinkError('');
          }}
        >
          <IconLink size={18} />
        </button>
      </div>
      {linkOpen && (
        <div className="se-link-entry">
          <input aria-label="链接地址" type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" autoFocus />
          <button type="button" className="se-secondary" onClick={addLink}>
            插入链接
          </button>
          <button type="button" className="se-icon-button" aria-label="取消插入链接" onClick={() => setLinkOpen(false)}>
            <IconX size={17} />
          </button>
        </div>
      )}
      <ErrorMessage error={linkError} />
    </div>
  );
}
