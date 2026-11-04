import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import * as model from '../src/sublime/workspaceModel.js';
import * as discovery from '../src/discoveryModel.js';
import * as attachments from '../src/sublime/attachmentPreview.js';

import { compileEditors } from './support/compile-editors.mjs';
const compiled = await compileEditors();

// Only host DOM construction and the successful createLink command are synthetic.
// Render, toolbar, change and save handlers below are the production components.
// No browser, app, network, model or real persistence profile is opened.
class DomNode {
  constructor(tag, value) {
    this.nodeType = tag ? 1 : 3;
    this.tagName = tag?.toUpperCase();
    this.nodeValue = value ?? null;
    this.childNodes = [];
    this.attributes = {};
  }
  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }
  replaceChildren(...children) {
    this.childNodes = [];
    children.forEach((child) => this.appendChild(child));
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  getAttribute(key) {
    return this.attributes[key] ?? null;
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  focus() {}
  contains(node) {
    return node === this || this.childNodes.some((child) => child.contains(node));
  }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return text(tree.props?.children);
}
function elements(tree, tag, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  if (Array.isArray(tree)) {
    tree.forEach((child) => elements(child, tag, result));
    return result;
  }
  if (tree.type === tag) result.push(tree);
  elements(tree.props?.children, tag, result);
  return result;
}
function domElements(node, tag, result = []) {
  if (node.tagName === tag) result.push(node);
  node.childNodes.forEach((child) => domElements(child, tag, result));
  return result;
}
function domText(node) {
  return node.nodeType === 3 ? node.nodeValue : node.childNodes.map(domText).join('');
}
function fixture() {
  let active;
  const document = { createElement: (tag) => new DomNode(tag), createTextNode: (value) => new DomNode(null, value) };
  const react = {
    Fragment: Symbol('fragment'),
    memo: (value) => value,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    isValidElement: (value) => Boolean(value && value.props),
    useMemo: (factory) => factory(),
    useRef: (initial) => {
      const index = active.cursor++;
      return active.slots[index] ?? (active.slots[index] = { current: initial });
    },
    useState: (initial) => {
      const state = active,
        index = state.cursor++;
      if (!state.slots[index]) state.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [
        state.slots[index].value,
        (next) => {
          state.slots[index].value = typeof next === 'function' ? next(state.slots[index].value) : next;
        },
      ];
    },
    useEffect: (effect, deps) => {
      const state = active,
        index = state.cursor++,
        previous = state.slots[index];
      if (!previous || !deps || deps.some((value, i) => value !== previous.deps[i])) state.effects.push(effect);
      state.slots[index] = { deps };
    },
  };
  react.useReducer = (reducer, initial) => {
    const [state, setState] = react.useState(initial);
    return [state, (action) => setState((previous) => reducer(previous, action))];
  };
  const icons = new Proxy({}, { get: (_, name) => () => react.createElement('svg', { 'data-icon': String(name) }) });
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    document,
    window: { getSelection: () => ({ rangeCount: 0 }) },
    Blob,
    URL,
    Error,
    crypto: globalThis.crypto,
    console,
    setTimeout,
    clearTimeout,
    require: (path) =>
      path === 'react'
        ? react
        : path === '@tabler/icons-react'
          ? icons
          : path === '../discoveryModel.js'
            ? discovery
            : path === './workspaceModel.js'
              ? model
              : path === './attachmentPreview.js'
                ? attachments
                : path === './webCapture.js'
                  ? {
                      captureWebPage: () => {
                        throw Error('Unexpected network request');
                      },
                    }
                  : path === './BookCoverEditor.jsx'
                    ? { default: () => null }
                    : path === './bookCover.js'
                      ? { defaultBookCover: async () => '' }
                      : path === './AttachmentPreview.jsx'
                        ? { default: () => null }
                        : path.endsWith('.css')
                          ? {}
                          : (() => {
                              throw Error('Unexpected import ' + path);
                            })(),
  });
  function mount(name, props) {
    const state = { slots: [], cursor: 0, effects: [], tree: null };
    function render() {
      active = state;
      state.cursor = 0;
      state.effects = [];
      state.tree = module.exports[name](props);
      active = null;
      function refs(tree) {
        if (!tree || typeof tree !== 'object') return;
        if (Array.isArray(tree)) return tree.forEach(refs);
        if (typeof tree.type === 'string' && tree.props.ref && !tree.props.ref.current) tree.props.ref.current = document.createElement(tree.type);
        refs(tree.props?.children);
      }
      refs(state.tree);
      state.effects.forEach((effect) => effect());
      return state.tree;
    }
    render();
    return { render, find: (predicate) => find(state.tree, predicate) };
  }
  return { mount, document, exports: module.exports };
}
function views(body) {
  const harness = fixture(),
    display = harness.exports.SafeRichBody({ text: body }),
    edit = harness.mount('RichText', { value: body, onChange: () => {} }),
    box = edit.find((node) => node.props?.role === 'textbox');
  return { ...harness, display, edit, box, dom: box.props.ref.current };
}

for (const url of ['https://example.test/a(b)c', 'https://example.test/a(b(c)d)e', 'https://example.test/a%28b%29', 'HTTPS://example.test/source']) {
  test(`display and editable trees retain the full HTTP(S) destination: ${url}`, () => {
    const result = views(`[source](${url})`),
      links = elements(result.display, 'a'),
      editableLinks = domElements(result.dom, 'A');
    assert.deepEqual(
      links.map((node) => node.props.href),
      [url],
    );
    assert.deepEqual(
      editableLinks.map((node) => node.getAttribute('href')),
      [url],
    );
    assert.equal(text(result.display), 'source');
    assert.equal(domText(result.dom), 'source');
  });
}

test('balanced bracket labels retain their formatting and cannot create nested anchors', () => {
  const result = views('[reference [1] **bold**](https://example.test/a(b))');
  assert.equal(elements(result.display, 'a').length, 1);
  assert.equal(elements(result.display, 'strong').length, 1);
  assert.equal(text(result.display), 'reference [1] bold');
  const nested = views('[outer [inner](https://example.test/inner)](https://example.test/outer)');
  assert.equal(elements(nested.display, 'a').length, 1);
  assert.equal(domElements(nested.dom, 'A').length, 1);
  assert.equal(elements(nested.display, 'a')[0].props.href, 'https://example.test/outer');
});

for (const body of [
  '[source](https://user:secret@example.test/a(b))',
  '[source](https://example.test\\evil/a(b))',
  '[source](javascript:alert(1))',
  '[source](https://example.test/a(b)',
  '[source](https://example.test/a b)',
  '[source](https://)',
]) {
  test(`invalid or incomplete links remain literal text: ${body}`, () => {
    const result = views(body);
    assert.equal(elements(result.display, 'a').length, 0);
    assert.equal(domElements(result.dom, 'A').length, 0);
    assert.equal(text(result.display), body);
    assert.equal(domText(result.dom), body);
  });
}

for (const [label, url] of [
  ['reference [1]', 'https://example.test/source'],
  ['*literal* [1]', 'https://example.test/source'],
  ['name]rest\\tail[', 'https://example.test/a(b)c'],
  ['中文😀', 'HTTPS://example.test/source'],
  ['source', 'https://example.test/unbalanced('],
  ['source', 'https://example.test/unbalanced)'],
]) {
  test(`toolbar link survives saving and re-entering the editor: ${label} / ${url}`, async () => {
    const harness = fixture();
    let saved;
    const card = harness.mount('CardEditor', {
      kind: 'text',
      card: { id: 'card', title: 'Title', body: label },
      onSave: async (value) => {
        saved = value;
      },
      onCancel: () => {},
    });
    const rich = harness.mount('RichText', card.find((node) => node.type === harness.exports.RichText && node.props.label === '卡片正文').props),
      box = rich.find((node) => node.props?.role === 'textbox'),
      dom = box.props.ref.current;
    rich.find((node) => node.type === 'button' && node.props['aria-label'] === '插入链接').props.onClick();
    rich.render();
    rich.find((node) => node.props?.['aria-label'] === '链接地址').props.onChange({ target: { value: url } });
    rich.render();
    harness.document.execCommand = (command, _ui, argument) => {
      assert.equal(command, 'createLink');
      assert.equal(argument, url);
      const link = harness.document.createElement('a');
      link.setAttribute('href', argument);
      link.appendChild(harness.document.createTextNode(label));
      const paragraph = harness.document.createElement('p');
      paragraph.appendChild(link);
      dom.replaceChildren(paragraph);
      return true;
    };
    rich.find((node) => node.type === 'button' && text(node) === '插入链接').props.onClick();
    card.render();
    await card.find((node) => node.type === 'button' && text(node) === '保存').props.onClick();
    const stored = model.workspaceReducer(model.createWorkspaceState(), { type: 'card.upsert', card: JSON.parse(JSON.stringify(saved)) }),
      body = model.parseWorkspaceBackup(model.serializeWorkspace(stored)).cards[0].body,
      reopened = views(body);
    assert.deepEqual(
      elements(reopened.display, 'a').map((node) => node.props.href),
      [url],
    );
    assert.deepEqual(
      domElements(reopened.dom, 'A').map((node) => node.getAttribute('href')),
      [url],
    );
    assert.equal(text(reopened.display), label);
    assert.equal(domText(reopened.dom), label);
  });
}

test('opening, ordinary blur and saving never rewrites untouched card text', async () => {
  const bodies = [
    '\n 原文\r\n\r\n第二段\n\n',
    '😀👨‍👩‍👧‍👦中文e\u0301𠮷\u200b',
    '* first\n* second',
    '[source](https://example.test/a(b)c)',
    '[source](HTTPS://example.test/a)',
    '# Title\n\n1. Item\n\n```js\nhttps://example.test/ **literal**\n```',
  ];
  for (const body of bodies) {
    const harness = fixture();
    let saved,
      changes = 0;
    const card = harness.mount('CardEditor', {
        kind: 'text',
        card: { id: 'card', title: 'Title', body },
        onDraftChange: () => {
          changes++;
        },
        onSave: async (value) => {
          saved = value;
        },
        onCancel: () => {},
      }),
      rich = harness.mount('RichText', card.find((node) => node.type === harness.exports.RichText).props);
    rich.find((node) => node.props?.role === 'textbox').props.onBlur();
    card.render();
    await card.find((node) => node.type === 'button' && text(node) === '保存').props.onClick();
    assert.equal(saved.body, body);
    assert.equal(changes, 0);
  }
});

test('long malformed links keep all original characters without recursive link parsing', () => {
  for (const body of [
    '['.repeat(100000) + 'tail',
    '[x](https://example.test/' + '('.repeat(50000) + 'tail' + ')'.repeat(49999),
    '[x](https://user:secret@example.test/' + '[x](https://example.test/'.repeat(4000) + 'tail' + ')'.repeat(4001),
  ]) {
    const result = views(body);
    assert.equal(elements(result.display, 'a').length, 0);
    assert.equal(domElements(result.dom, 'A').length, 0);
    assert.equal(text(result.display), body);
    assert.equal(domText(result.dom), body);
  }
});

test('link serialization escapes literal label text while retaining real bold and italic nodes', () => {
  const harness = fixture();
  let saved;
  const rich = harness.mount('RichText', {
      value: 'initial',
      onChange: (value) => {
        saved = value;
      },
    }),
    box = rich.find((node) => node.props?.role === 'textbox'),
    dom = box.props.ref.current;
  const link = harness.document.createElement('a');
  link.setAttribute('href', 'https://example.test/a(b)');
  const strong = harness.document.createElement('strong');
  strong.appendChild(harness.document.createTextNode('bold *literal* [1]'));
  link.appendChild(strong);
  link.appendChild(harness.document.createTextNode(' / '));
  const italic = harness.document.createElement('em');
  italic.appendChild(harness.document.createTextNode('italic **literal**'));
  link.appendChild(italic);
  dom.replaceChildren(link);
  box.props.onInput({ nativeEvent: { isComposing: false } });
  const reopened = views(saved);
  assert.equal(text(reopened.display), 'bold *literal* [1] / italic **literal**');
  assert.equal(elements(reopened.display, 'strong').length, 1);
  assert.equal(elements(reopened.display, 'em').length, 1);
  assert.equal(elements(reopened.display, 'a')[0].props.href, 'https://example.test/a(b)');
});

test('formatting around a link preserves its escaped label and actual href on re-entry', () => {
  const harness = fixture();
  let saved;
  const rich = harness.mount('RichText', {
      value: 'initial',
      onChange: (value) => {
        saved = value;
      },
    }),
    box = rich.find((node) => node.props?.role === 'textbox');
  const strong = harness.document.createElement('strong'),
    link = harness.document.createElement('a');
  link.setAttribute('href', 'https://example.test/a(b)');
  link.appendChild(harness.document.createTextNode('*literal* [1]'));
  strong.appendChild(link);
  box.props.ref.current.replaceChildren(strong);
  box.props.onInput({ nativeEvent: { isComposing: false } });
  const reopened = views(saved);
  assert.equal(text(reopened.display), '*literal* [1]');
  assert.equal(elements(reopened.display, 'strong').length, 1);
  assert.deepEqual(
    elements(reopened.display, 'a').map((node) => node.props.href),
    ['https://example.test/a(b)'],
  );
});

for (const format of ['strong', 'em'])
  for (const url of [
    'https://example.test/a*b',
    'https://example.test/a**b',
    'https://example.test/a***b',
    'https://example.test/a*(b*)',
    'https://example.test/?q=a*b&literal=%2A',
    'https://example.test/a%2Ab',
  ]) {
    test(`${format} around a link preserves literal URL asterisks: ${url}`, () => {
      const harness = fixture();
      let saved;
      const rich = harness.mount('RichText', {
          value: 'initial',
          onChange: (value) => {
            saved = value;
          },
        }),
        box = rich.find((node) => node.props?.role === 'textbox');
      const wrapper = harness.document.createElement(format),
        link = harness.document.createElement('a');
      link.setAttribute('href', url);
      link.appendChild(harness.document.createTextNode('x'));
      wrapper.appendChild(link);
      box.props.ref.current.replaceChildren(wrapper);
      box.props.onInput({ nativeEvent: { isComposing: false } });
      const reopened = views(saved);
      assert.equal(text(reopened.display), 'x');
      assert.equal(domText(reopened.dom), 'x');
      assert.equal(elements(reopened.display, format).length, 1);
      assert.deepEqual(
        elements(reopened.display, 'a').map((node) => node.props.href),
        [url],
      );
      assert.deepEqual(
        domElements(reopened.dom, 'A').map((node) => node.getAttribute('href')),
        [url],
      );
    });
  }

test('read-only card bodies render Markdown headings and quotes without altering editor source', () => {
  const body =
    '# 东风远渡——让距离成为变化的主角\r\n\r\n## 收录授权原话\r\n> 用户的**原话**\r\n> 下一行\r\n\r\n## 对话方案整理\r\n正文\r\n- 变化过程：花色变淡\r\n- [原著依据](https://example.test/source)';
  const result = views(body);
  assert.equal(elements(result.display, 'h1').length, 1);
  assert.equal(text(elements(result.display, 'h1')[0]), '东风远渡——让距离成为变化的主角');
  assert.deepEqual(elements(result.display, 'h2').map(text), ['收录授权原话', '对话方案整理']);
  assert.equal(elements(result.display, 'blockquote').length, 1);
  assert.equal(text(elements(result.display, 'blockquote')[0]), '用户的原话下一行');
  assert.equal(elements(result.display, 'strong').length, 2);
  assert.equal(elements(result.display, 'li').length, 2);
  assert.equal(elements(result.display, 'a')[0].props.href, 'https://example.test/source');
  assert.doesNotMatch(text(result.display), /^#|> 用户/);
  assert.match(domText(result.dom), /# 东风远渡/);
  assert.match(domText(result.dom), /> 用户的原话/);
});
test('display keeps literal hash and greater-than content when it is not Markdown block syntax', () => {
  const body = 'C# 与 3 > 2\n#没有空格\n\\# 字面井号\n<script>alert(1)</script>';
  const result = views(body);
  assert.equal(elements(result.display, 'h1').length, 0);
  assert.equal(elements(result.display, 'blockquote').length, 0);
  assert.equal(elements(result.display, 'script').length, 0);
  assert.equal(text(result.display), body.replaceAll('\n', ''));
  assert.equal(elements(result.display, 'br').length, 3);
});

test('read-only inline code and Vault references display labels while editor retains Markdown', () => {
  const body = '状态仍为 `inbox`；项目：[[projects/brief.md|红楼梦百花岩彩动画]]；书籍：[[红楼梦]]；![[01_sources/image.png|336]]';
  const result = views(body);
  assert.equal(text(elements(result.display, 'code')[0]), 'inbox');
  assert.equal(text(result.display), '状态仍为 inbox；项目：红楼梦百花岩彩动画；书籍：红楼梦；image.png');
  assert.equal(domText(result.dom), body);
  assert.equal(elements(result.display, 'img').length, 0);
});

test('reading has paragraph spacing without empty spacer blocks; editing retains blank lines', () => {
  const result = views('# 标题\n\n\n正文\n\n- 变化过程：花色变淡');
  assert.equal(elements(result.display, 'p').length, 1);
  assert.equal(elements(result.display, 'br').length, 0);
  assert.equal(text(elements(result.display, 'strong')[0]), '变化过程：');
  assert.ok(domElements(result.dom, 'BR').length >= 3);
});
test('internal reference click forwards its original target without touching attachments or inline code', () => {
  const harness = fixture(),
    calls = [];
  const tree = harness.exports.SafeRichBody({ text: '[[brief#段落|项目]] ![[image.png]] `[[literal]]`', onReference: (value) => calls.push(value) });
  const buttons = elements(tree, 'button');
  assert.equal(buttons.length, 1);
  assert.equal(text(buttons[0]), '项目');
  buttons[0].props.onClick();
  assert.deepEqual(calls, ['brief#段落']);
  assert.equal(elements(tree, 'img').length, 0);
});

test('read-only ordered lists preserve their start and coexist with unordered lists', () => {
  const result = views('3. first\n4. second\n\n- third\n- fourth');
  const ordered = elements(result.display, 'ol');
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].props.start, 3);
  assert.equal(elements(result.display, 'li').length, 4);
  assert.equal(elements(result.display, 'ul').length, 1);
});

test('bare HTTP links exclude sentence punctuation and preserve balanced parentheses', () => {
  const result = views('见 https://example.test/a(b)。以及 (https://example.test/source).');
  assert.deepEqual(
    elements(result.display, 'a').map((node) => node.props.href),
    ['https://example.test/a(b)', 'https://example.test/source'],
  );
  assert.equal(text(result.display), '见 https://example.test/a(b)。以及 (https://example.test/source).');
  assert.equal(elements(views('https://user:secret@example.test/source').display, 'a').length, 0);
  assert.equal(elements(views('`https://example.test/source`').display, 'a').length, 0);
});

test('fenced code remains literal React text and cannot render HTML or links', () => {
  const body = '```js\n<script>alert(1)</script>\nhttps://example.test/ **literal**\n```';
  const result = views(body),
    code = elements(result.display, 'code');
  assert.equal(elements(result.display, 'pre').length, 1);
  assert.equal(code[0].props.className, 'language-js');
  assert.equal(text(code[0]), '<script>alert(1)</script>\nhttps://example.test/ **literal**');
  assert.equal(elements(result.display, 'script').length, 0);
  assert.equal(elements(result.display, 'a').length, 0);
  assert.equal(result.edit.find((node) => node.props?.role === 'textbox').props.ref.current, result.dom);
});

test('an unfinished fenced block displays all remaining source without executing Markdown', () => {
  const result = views('~~~\n# literal heading\n1. literal item');
  assert.equal(text(elements(result.display, 'pre')[0]), '# literal heading\n1. literal item');
  assert.equal(elements(result.display, 'h1').length, 0);
  assert.equal(elements(result.display, 'ol').length, 0);
});

test('preview uses the same body component while preserving the original editable source', () => {
  const body = '# Title\n\n1. Item\n\n```js\nconst value = 1;\n```';
  const result = views(body),
    toggle = result.edit.find((node) => node.props?.['aria-label'] === '切换正文预览');
  assert.ok(toggle);
  toggle.props.onClick();
  result.edit.render();
  assert.equal(result.edit.find((node) => node.props?.role === 'textbox').props.hidden, true);
  const preview = result.edit.find((node) => node.type === result.exports.SafeRichBody);
  assert.equal(preview.props.text, body);
  assert.equal(result.edit.find((node) => node.props?.role === 'textbox').props.ref.current, result.dom);
});
