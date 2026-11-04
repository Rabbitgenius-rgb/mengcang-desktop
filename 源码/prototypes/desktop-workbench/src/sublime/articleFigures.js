import { articlePageUrl, articleSourceUrl } from './articleReaderModel.js';
import { normalizeWorkspaceAttachment, workspaceReducer } from './workspaceModel.js';

// Resolve only against this article's captured image blocks. A shared page URL
// alone also matches screenshots and unrelated illustrations on the same site.
export function articleFigureBlock(source, card) {
  if (source?.type !== 'article' || card?.type !== 'image') return;
  const page = articlePageUrl(source.sourceUrl);
  if (articlePageUrl(card.sourceUrl) !== page || (!page && (source.sourceUrl || card.sourceUrl))) return;
  const blocks = source.article?.blocks || [];
  const location = card.articleFigure;
  if (!location) {
    // The browser clipper recorded the original image URL in the last body line
    // before reader saves introduced a block identifier. Repeated URLs are ambiguous.
    if (!page || card.sourceCardId || card.sourceLocation !== '浏览器图片') return;
    const lastLine = (card.body || '').trimEnd().split('\n').at(-1);
    const url = articleSourceUrl(lastLine.match(/^图片原址：(.+)$/)?.[1]);
    if (!url) return;
    const matches = blocks.filter((block) => block.type === 'image' && articleSourceUrl(block.src) === url);
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (card.sourceCardId !== source.id) return;
  const matches = blocks.filter((block) => block.type === 'image' && block.id === location.blockId);
  if (matches.length !== 1) return;
  const block = matches[0];
  if (block.src || location.imageUrl) {
    const url = articleSourceUrl(block.src);
    if (!url || url !== articleSourceUrl(location.imageUrl)) return;
  } else if (!block.attachment?.dataUrl || block.attachment.dataUrl !== card.attachment?.dataUrl) {
    return;
  }
  return block;
}

export function articleFigureCollection(source, visibleCards) {
  const byBlock = new Map(),
    items = [];
  if (source?.type === 'article') {
    for (const card of visibleCards) {
      if (card.type !== 'image') continue;
      const block = articleFigureBlock(source, card);
      if (block) {
        if (card.articleFigure || !byBlock.has(block.id)) byBlock.set(block.id, card);
      } else if (card.articleFigure && card.sourceCardId === source.id) {
        items.push({ card }); // A saved figure can outlive its original position.
      }
    }
    for (const [blockId, card] of byBlock) items.push({ card, blockId });
  }
  return { byBlock, items };
}

export function findArticleFigure(cards, sourceId, block) {
  return cards.find(
    (card) => card.sourceCardId === sourceId && card.articleFigure?.blockId === block.id && card.articleFigure.imageUrl === articleSourceUrl(block.src),
  );
}

// Resolve against the current transaction, not the copy the Reader displayed
// before a possible download. Never restore or overwrite an earlier save.
function resolveFigure(state, source, block) {
  const article = state.cards.find((card) => card.id === source.id);
  if (article?.type !== 'article' || !state.savedIds.includes(source.id) || state.hiddenIds.includes(source.id))
    throw Error('来源文章已移出资料库，这张配图尚未收藏。');
  const figures = article.article?.blocks.filter((value) => value.type === 'image') || [];
  const index = figures.findIndex((value) => value.id === block.id),
    live = figures[index];
  if (!live || article.sourceUrl !== source.sourceUrl || live.src !== block.src || live.attachment?.dataUrl !== block.attachment?.dataUrl)
    throw Error('文章配图或出处已变化，请重新打开文章后再收藏。');
  const prior = findArticleFigure(state.cards, source.id, live);
  if (prior && (!state.savedIds.includes(prior.id) || state.hiddenIds.includes(prior.id))) throw Error('先前收藏的配图已移出资料库，未重复添加。');
  return { article, live, index, prior };
}

export async function saveArticleFigure({ session, source, block, isCurrent, fetchImage, newId, now }) {
  const check = () => {
    if (!isCurrent()) throw Error('资料库已切换，配图未写入新资料库。');
  };
  check();
  const { live, prior } = resolveFigure(session.state, source, block);
  if (prior) return prior.id;
  if (!live.attachment && (!articleSourceUrl(live.src) || !fetchImage)) throw Error('没有可收藏的图片文件，请打开原图后从浏览器保存。');
  const attachment = normalizeWorkspaceAttachment(live.attachment || (await fetchImage(live.src)));
  if (!attachment?.type.startsWith('image/')) throw Error('未取得可用的原图文件。');
  check();
  const id = newId(),
    savedAt = now();
  let target;
  await session.commit(
    (state) => {
      check();
      const { article, live, index, prior } = resolveFigure(state, source, block);
      if (prior) {
        target = prior.id;
        return state;
      }
      const location = '文章配图 · 第 ' + (index + 1) + ' 张';
      const label = (live.caption || live.alt || '').trim();
      const title = Array.from(label || article.title + ' · 配图 ' + (index + 1))
        .slice(0, 140)
        .join('');
      const imageUrl = articleSourceUrl(live.src);
      const card = {
        id,
        path: id,
        type: 'image',
        origin: 'local',
        title,
        body: [...new Set([live.caption, live.alt].filter(Boolean))].join('\n\n'),
        attachment,
        sourceCardId: article.id,
        sourceTitle: article.title,
        sourceUrl: articleSourceUrl(article.sourceUrl),
        sourceLocation: location,
        articleFigure: { blockId: live.id, imageUrl },
        author: article.author || '',
        createdAt: savedAt,
        updatedAt: savedAt,
      };
      target = id;
      return workspaceReducer(workspaceReducer(state, { type: 'card.upsert', card }), { type: 'card.save', id, saved: true });
    },
    { failureOwner: 'caller' },
  );
  return target;
}
