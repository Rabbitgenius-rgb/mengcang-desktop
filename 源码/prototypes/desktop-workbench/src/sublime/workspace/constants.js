import { IconBookmark, IconNotes, IconPencil, IconFolder, IconLayoutBoard, IconPhoto, IconLink, IconFileText, IconBook2 } from '@tabler/icons-react';
import { createAttachmentStore } from '.././attachmentStore.js';
import { listeningCard } from '.././referenceCards.js';
import { publicDiscoveryItem } from '../../discoveryModel.js';
import { requestWorkspaceDownload } from '.././workspaceDownload.js';
import { INSIGHT_LABELS } from '.././intelligenceHelpers.js';

export const uid = () => crypto.randomUUID();
export const MEDIA = ['All', 'Articles', 'Audio', 'Books', 'Files', 'Highlights', 'Images', 'Links', 'Notes', 'Videos', 'Social'];
export const SORTS = [
  ['relevant', '最相关'],
  ['popular', '标星优先'],
  ['least', '未标星优先'],
  ['updated', '最近更新'],
  ['old-updated', '较早更新'],
  ['newest', '最近创建'],
  ['oldest', '最早创建'],
];
export const MEDIA_LABELS = {
  All: '全部类型',
  Articles: '文章',
  Audio: '音频',
  Books: '图书',
  Files: '文件',
  Highlights: '摘录',
  Images: '图片',
  Links: '链接',
  Notes: '笔记',
  Videos: '视频',
  Social: '社交内容',
};
export const MEDIA_ICONS = {
  All: IconLayoutBoard,
  Articles: IconFileText,
  Audio: IconNotes,
  Books: IconBook2,
  Files: IconFolder,
  Highlights: IconBookmark,
  Images: IconPhoto,
  Links: IconLink,
  Notes: IconPencil,
  Videos: IconPhoto,
  Social: IconNotes,
};
export const AI_LABELS = {
  'The Gist': '核心概述',
  'Explain Like I’m 5': '通俗解释',
  'Contrarian Take': '反向观点',
  Analogy: '类比说明',
  'Hot Take': '鲜明观点',
  Insights: 'AI 解读',
  Related: '关联想法',
  'Semantic search': '语义搜索',
};
export const aiLabel = (mode) =>
  ({ ...AI_LABELS, ...INSIGHT_LABELS, Settings: 'AI 连接与用量', OCR: '文字识别', Classification: '分类建议', Discover: '灵感发现' })[mode] || mode;
export const initialFilters = { query: '', media: 'All', sort: 'newest', inLibrary: false, favorite: false };
export const attachmentFiles = createAttachmentStore();
export const MAX_PASTED_BACKUP_BYTES = 4 * 1024 * 1024;
export const VAULT_DISCONNECTED_MESSAGE = '连接已断开，重新连接后可再次保存；卡片、笔记和原文件仍在本机。';
export const download = requestWorkspaceDownload;
export function checkPastedBackupSize(text) {
  if (text.length > MAX_PASTED_BACKUP_BYTES || new Blob([text]).size > MAX_PASTED_BACKUP_BYTES) throw Error('粘贴内容超过 4MiB，请使用文件导入。');
}

export function routeFromHash() {
  try {
    const [hash, query] = location.hash.replace(/^#\/?/, '').split('?'),
      bits = hash.split('/').map(decodeURIComponent),
      sourcePage = Number(new URLSearchParams(query || '').get('page'));
    return bits[0]
      ? { page: bits[0], id: bits.slice(1).join('/'), sourcePage: Number.isSafeInteger(sourcePage) && sourcePage > 0 ? sourcePage : 1 }
      : { page: 'card', id: listeningCard.id };
  } catch {
    return { page: 'library', id: '' };
  }
}

export function workspaceSearchScope({ page, id }) {
  if (page === 'collection') return 'collection:' + id;
  if (page === 'collections' || page === 'canvases') return page;
  if (page === 'library' || page === 'favorites') return 'library';
  return '';
}

export function adaptItem(item) {
  const publicItem = publicDiscoveryItem(item),
    id = String(item.path || item.id || '');
  return {
    ...publicItem,
    id,
    path: id,
    type: item.kind === 'book' ? 'book' : item.type || item.kind || 'text',
    image: item.assetUrl || item.imageData || item.image || '',
    tags: item.tags || [],
    importFingerprint: item.fields?.import_fingerprint || item.importFingerprint || '',
    origin: 'vault',
    capturedAt: String(item.fields?.captured_at || item.capturedAt || ''),
    createdAt: item.createdAt || item.date || '',
    updatedAt: item.updatedAt || item.date || '',
    originalPath: item.originalPath || '',
    originalMime: item.originalMime || '',
    originalAvailable: item.originalAvailable === true,
    originalName: item.originalName || '',
  };
}
