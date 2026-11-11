// Pure display helpers for the 夜间档案馆 presentation layer. Never mutate cards.
import { relatedCardPreview, relatedTypeKey } from '../../relatedBrowser.js';

export const ARCHIVE_VIEWS = [
  ['wall', '墙'],
  ['index', '目录'],
  ['zoom', '细看'],
];
export const ARCHIVE_VIEW_KEY = 'archive-view';

const KIND_LABELS = {
  article: '文章',
  highlight: '摘录',
  image: '图片',
  text: '笔记',
  link: '链接',
  audio: '音频',
  video: '视频',
  book: '图书',
  file: '文件',
  social: '社交',
};

export function archiveView(drafts = {}) {
  const value = drafts[ARCHIVE_VIEW_KEY];
  return ARCHIVE_VIEWS.some(([id]) => id === value) ? value : 'wall';
}

// Stable paper tone from the card identity; colour never encodes a category.
export function paperTone(id = '') {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 4;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function archiveDate(card) {
  const raw = card.capturedAt || card.createdAt || card.updatedAt || '';
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

export function serial(index) {
  return String(index + 1).padStart(3, '0');
}

// One projection shared by wall, index and zoom so all three agree.
export function archiveEntry(card) {
  const preview = relatedCardPreview(card);
  const kind = relatedTypeKey(card);
  const title = (card.title || '').trim() || '未命名资料';
  const host = hostOf(card.sourceUrl);
  const source = card.sourceTitle && card.sourceTitle !== title ? card.sourceTitle : host;
  const text = preview.text && preview.text.trim() !== title ? preview.text : '';
  return {
    id: card.id,
    kind,
    kindLabel: KIND_LABELS[kind] || '资料',
    title,
    text,
    image: preview.image,
    source,
    host,
    author: card.author || '',
    date: archiveDate(card),
    tags: Array.isArray(card.tags) ? card.tags : [],
    tone: paperTone(card.id),
    // Quotes and short notes are objects of text; others lead with a title.
    form: preview.image ? 'image' : kind === 'highlight' ? 'quote' : kind === 'link' ? 'ticket' : 'slip',
  };
}
