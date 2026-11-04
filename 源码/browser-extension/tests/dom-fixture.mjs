export function domFixture() {
  const text = value => ({nodeType: 3, nodeValue: value, childNodes: [], parentElement: null, get textContent() {return this.nodeValue;}});
  const document = {title: '图文测试文章', readyState: 'loading', addEventListener() {}, defaultView: {getComputedStyle: node => ({display: Object.hasOwn(node.attrs || {}, 'hidden') || node.attrs?.style === 'display:none' ? 'none' : 'block', visibility: 'visible', listStyleType: node.attrs?.listStyleType || ''})}};
  const element = (tag, attrs = {}, ...children) => {
    const node = {nodeType: 1, tagName: tag.toUpperCase(), attrs, ownerDocument: document, parentElement: null, childNodes: children.flat().map(child => typeof child === 'string' ? text(child) : child),
      getAttribute(name) {return this.attrs[name] ?? null;},
      matches(selector) {return selector.split(',').some(part => {part = part.trim(); if (part === '[hidden]') return Object.hasOwn(this.attrs, 'hidden'); if (part === '[data-mengcang-ui]') return Object.hasOwn(this.attrs, 'data-mengcang-ui'); const attr = /^\[([^=]+)="([^"]+)"\]$/.exec(part); return attr ? this.attrs[attr[1]] === attr[2] : part.toUpperCase() === this.tagName;});},
      contains(other) {return this === other || this.childNodes.some(child => child === other || child.contains?.(other));},
      closest(tag) {let current = this; while (current) {if (current.tagName === tag.toUpperCase()) return current; current = current.parentElement;} return null;},
      querySelectorAll(selector) {return this.childNodes.flatMap(child => child.nodeType === 1 ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []);},
      querySelector(selector) {return this.querySelectorAll(selector)[0] || null;},
      get textContent() {return this.childNodes.map(child => child.textContent).join('');},
      get currentSrc() {return this.attrs.currentSrc || '';}, get src() {return this.attrs.src || '';}, get alt() {return this.attrs.alt || '';},
      scrollIntoView() {this.scrolled = true;},
    };
    for (const child of node.childNodes) {child.parentElement = node; child.ownerDocument = document;}
    return node;
  };
  document.querySelectorAll = selector => selector.startsWith('meta[') ? [] : document.body?.querySelectorAll(selector) || [];
  document.querySelector = selector => document.querySelectorAll(selector)[0] || null;
  document.createRange = () => ({setStart(node, offset) {this.startContainer = node; this.startOffset = offset;}, setEnd(node, offset) {this.endContainer = node; this.endOffset = offset;}});
  return {document, element, text};
}
