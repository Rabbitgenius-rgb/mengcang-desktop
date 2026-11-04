import { normalizeClipperParams, normalizeClipperQuery, clipperPayloadIdentity, clipperPageKey, clipperError } from '../../../../src/clipper/contract.mjs';
import { personalRelations, relatedType } from './personalRelated.js';
import { workspaceReducer, normalizeWorkspaceAttachment } from './workspaceModel.js';

export const CLIPPER_COLLECTION_ID = 'browser-clips-v1';
const hashPayload = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
const item = (card) => ({ id: card.id, title: card.title, type: card.type, sourceUrl: card.sourceUrl });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const defaultCollection = () => ({
  id: CLIPPER_COLLECTION_ID,
  title: '浏览器剪藏',
  description: '从浏览器手动保存的网页、文章和图片',
  private: true,
  pinned: false,
  cardIds: [],
});
const PAGE_BYTES = 180 * 1024;
function page(values, { offset, limit }) {
  const items = [];
  let bytes = 2;
  for (const value of values.slice(offset, offset + limit)) {
    const size = new TextEncoder().encode(JSON.stringify(value)).length + 1;
    // A single permitted highlight fits the native response limit, even when
    // its quote is near the capture limit. Do not strand it behind pagination.
    if (items.length && bytes + size > PAGE_BYTES) break;
    items.push(value);
    bytes += size;
  }
  const next = offset + items.length;
  return { items, total: values.length, nextOffset: next < values.length ? next : null };
}
const pageKey = (value) => {
  try {
    return clipperPageKey(value);
  } catch {
    return null;
  }
};

// The active workspace session remains the only writer. Browser captures do
// not open a second database, touch Vault notes, or enter the recall corpus.
export function createClipperLibrary({
  session,
  workspaceId,
  isCurrent = () => true,
  getVaultCards = () => [],
  onOpenCard,
  hash = hashPayload,
  now = () => new Date().toISOString(),
}) {
  const assertCurrent = () => {
    if (!isCurrent()) throw clipperError('WORKSPACE_CHANGED', '梦藏资料库已变化，请重新连接后使用原请求重试');
  };
  const response = (extra) => {
    assertCurrent();
    return { workspaceId, revision: session.revision, ...extra };
  };
  function savedCard(state, id) {
    const card = state.cards.find((value) => value.id === id);
    if (state.hiddenIds.includes(id)) throw clipperError('CLIPPER_ARCHIVED', '这条浏览器收录已归档，请从资料库恢复；重试不会自动恢复它');
    if (!card || !state.savedIds.includes(id)) throw clipperError('CLIPPER_NOT_FOUND', '此前收录已移除，未重新添加或覆盖资料');
    return card;
  }
  function priorReceipt(state, key, id, payloadHash, requestId) {
    const receipt = state.drafts[key];
    if (!receipt) {
      if (state.cards.some((card) => card.id === id)) throw clipperError('REQUEST_REUSED', '该收录标识已被使用，未覆盖原条目');
      return null;
    }
    if (receipt.requestId !== requestId || receipt.payloadHash !== payloadHash || receipt.itemId !== id)
      throw clipperError('REQUEST_REUSED', '同一收录请求已用于不同内容，未覆盖原条目');
    return { receipt, card: savedCard(state, id) };
  }
  return {
    async call(method, raw = {}) {
      if (!['status', 'capture', 'lookup', 'collections', 'highlights', 'related', 'openRelated'].includes(method))
        throw clipperError('METHOD_NOT_FOUND', '不支持的浏览器收录操作');
      assertCurrent();
      if (method === 'status') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length) throw clipperError('INVALID_CLIPPER', '状态请求不接受额外字段');
        return { ready: true, workspaceId };
      }
      if (method === 'related' || method === 'openRelated') {
        const query = normalizeClipperQuery(method, raw);
        if (query.workspaceId !== workspaceId) throw clipperError('WORKSPACE_CHANGED', '这次剪藏属于另一个资料库。');
        await session.load();
        assertCurrent();
        const state = session.state,
          id = 'browser-clip:' + query.requestId;
        if (state.drafts['clipper-capture-receipt:' + query.requestId]?.itemId !== id) throw clipperError('CLIPPER_NOT_FOUND', '未找到这次剪藏的保存回执。');
        const source = savedCard(state, id),
          hidden = new Set(state.hiddenIds),
          saved = new Set(state.savedIds);
        const vault = getVaultCards(),
          vaultIds = new Set(vault.map((card) => card.id)),
          byId = new Map();
        for (const card of [...vault, ...state.cards]) {
          if (!hidden.has(card.id) && (saved.has(card.id) || vaultIds.has(card.id))) byId.set(card.id, card);
        }
        const matches = personalRelations(source, [...byId.values()], state.collections).slice(0, 3);
        if (method === 'openRelated') {
          if (!matches.some((r) => r.id === query.cardId) || !onOpenCard) throw clipperError('CLIPPER_NOT_FOUND', '这条推荐已变化，请刷新相关资料。');
          assertCurrent();
          onOpenCard(query.cardId);
          return response({ opened: query.cardId });
        }
        return response({
          items: matches.map(({ id, reason }) => {
            const card = byId.get(id);
            return { id, title: (card.title || '未命名资料').slice(0, 1000), type: relatedType(card), reason };
          }),
        });
      }
      if (method === 'collections' || method === 'highlights') {
        const query = normalizeClipperQuery(method, raw);
        await session.load();
        assertCurrent();
        const state = session.state;
        if (method === 'collections') {
          // The default is selectable before its first capture, without making
          // this read-only request create a collection or advance the revision.
          const collections = state.collections.some((value) => value.id === CLIPPER_COLLECTION_ID)
            ? state.collections
            : [defaultCollection(), ...state.collections];
          return response(
            page(
              collections.map(({ id, title, private: private_ }) => ({ id, title, private: private_ })),
              query,
            ),
          );
        }
        const source = clipperPageKey(query.sourceUrl),
          saved = new Set(state.savedIds),
          hidden = new Set(state.hiddenIds);
        const highlights = state.cards
          .filter((card) => card.type === 'highlight' && card.webAnchor && saved.has(card.id) && !hidden.has(card.id) && pageKey(card.sourceUrl) === source)
          .map((card) => ({
            id: card.id,
            title: card.title,
            anchor: { ...card.webAnchor },
            sourceCardId: card.sourceCardId || '',
            favorite: state.favoriteIds.includes(card.id),
          }));
        return response(page(highlights, query));
      }
      const params = normalizeClipperParams(raw, { requireImageAttachment: method === 'capture' });
      if (params.attachment) {
        try {
          params.attachment = normalizeWorkspaceAttachment(params.attachment);
        } catch {
          throw clipperError('INVALID_CLIPPER_IMAGE', '图片文件头、名称或类型无效，未保存图片');
        }
      }
      const payloadHash = await hash(clipperPayloadIdentity(params)),
        id = `browser-clip:${params.requestId}`,
        receiptKey = `clipper-capture-receipt:${params.requestId}`;
      assertCurrent();
      await session.load();
      assertCurrent();
      if (method === 'lookup') {
        const found = priorReceipt(session.state, receiptKey, id, payloadHash, params.requestId);
        return found ? response({ found: true, item: item(found.card), duplicate: true, captureReceipt: found.receipt }) : response({ found: false });
      }
      let duplicate = false;
      const savedAt = now();
      await session.commit(
        (current) => {
          assertCurrent();
          const existing = priorReceipt(current, receiptKey, id, payloadHash, params.requestId);
          if (existing) {
            duplicate = true;
            return current;
          }
          const collectionIds = own(params, 'collectionIds') ? params.collectionIds : [CLIPPER_COLLECTION_ID];
          for (const collectionId of collectionIds)
            if (collectionId !== CLIPPER_COLLECTION_ID && !current.collections.some((value) => value.id === collectionId)) {
              throw clipperError('CLIPPER_COLLECTION_NOT_FOUND', '所选收藏集已不存在，请重新选择后保存');
            }
          if (params.sourceCardId) {
            const source = current.cards.find((card) => card.id === params.sourceCardId);
            if (
              !source ||
              source.origin !== 'local' ||
              source.type !== 'article' ||
              !current.savedIds.includes(source.id) ||
              current.hiddenIds.includes(source.id) ||
              pageKey(source.sourceUrl) !== clipperPageKey(params.sourceUrl)
            )
              throw clipperError('CLIPPER_SOURCE_NOT_FOUND', '引用的原文章已变化或不属于此网页，未保存高亮');
          }
          const picture = params.kind === 'image';
          const body = picture ? [params.body, params.imageUrl ? `图片原址：${params.imageUrl}` : ''].filter(Boolean).join('\n\n') : params.body;
          const card = {
            id,
            title: params.title,
            body,
            type: params.kind,
            origin: 'local',
            sourceUrl: params.sourceUrl,
            sourceTitle: params.siteName || new URL(params.sourceUrl).hostname,
            author: params.author,
            sourceLocation: params.screenshot
              ? params.screenshot === 'region'
                ? '网页截图 · 选区'
                : '网页截图 · 可见区域'
              : picture
                ? '浏览器图片'
                : params.kind === 'article'
                  ? '浏览器文章'
                  : params.kind === 'highlight'
                    ? '网页高亮'
                    : '浏览器网页',
            createdAt: savedAt,
            updatedAt: savedAt,
            date: savedAt,
            tags: [],
            ...(picture ? { attachment: params.attachment } : {}),
            ...(params.article ? { article: params.article } : {}),
            ...(params.anchor ? { webAnchor: params.anchor } : {}),
            ...(params.sourceCardId ? { sourceCardId: params.sourceCardId } : {}),
          };
          const receipt = { requestId: params.requestId, payloadHash, itemId: id, savedAt };
          return [
            { type: 'card.upsert', card },
            { type: 'card.save', id, saved: true },
            ...(own(params, 'note') ? [{ type: 'card.note', id, note: params.note }] : []),
            ...(own(params, 'favorite') ? [{ type: 'card.favorite', id, value: params.favorite }] : []),
            ...(collectionIds.includes(CLIPPER_COLLECTION_ID) && !current.collections.some((value) => value.id === CLIPPER_COLLECTION_ID)
              ? [{ type: 'collection.upsert', collection: defaultCollection() }]
              : []),
            ...collectionIds.map((collectionId) => ({ type: 'collection.toggleCard', id: collectionId, cardId: id, selected: true })),
            { type: 'draft.set', key: receiptKey, value: receipt },
          ].reduce(workspaceReducer, current);
        },
        { failureOwner: 'caller' },
      );
      assertCurrent();
      const committed = priorReceipt(session.state, receiptKey, id, payloadHash, params.requestId);
      return response({ item: item(committed.card), duplicate, captureReceipt: committed.receipt });
    },
  };
}

export function connectClipperRenderer({ api, session, workspaceId, isCurrent, getVaultCards, onOpenCard }) {
  if (!api?.clipperReady || !api?.clipperResult || !api?.subscribe) return () => {};
  let disposed = false;
  const library = createClipperLibrary({ session, workspaceId, getVaultCards, onOpenCard, isCurrent: () => !disposed && isCurrent() });
  const stop = api.subscribe((event) => {
    if (event?.type !== 'clipperRequest' || event.workspaceId !== workspaceId || disposed) return;
    void (async () => {
      let reply;
      try {
        const result = await library.call(event.method, event.params);
        if (disposed || !isCurrent()) throw clipperError('WORKSPACE_CHANGED', '梦藏资料库已变化，请使用原请求重试');
        reply = { ok: true, result };
      } catch (error) {
        reply = { ok: false, error: { code: error.code || 'CLIPPER_SAVE_FAILED', message: error.message || '收录未完成，请保留内容后重试' } };
      }
      await api.clipperResult({ commandId: event.commandId, workspaceId, ...reply });
    })().catch(() => {});
  });
  void api.clipperReady({ ready: true, workspaceId }).catch(() => {});
  return () => {
    disposed = true;
    stop?.();
    void api.clipperReady({ ready: false, workspaceId }).catch(() => {});
  };
}
