import { createWorkspaceStoreV3 } from '../源码/prototypes/desktop-workbench/src/sublime/workspaceStoreV3.js';
import { createWorkspaceSession } from '../源码/prototypes/desktop-workbench/src/sublime/workspacePersistence.js';
import { createWorkspaceState, workspaceReducer } from '../源码/prototypes/desktop-workbench/src/sublime/workspaceModel.js';
import { createRecallLibrary } from '../源码/prototypes/desktop-workbench/src/sublime/recallLibrary.js';
import { articlePlainText } from '../源码/src/clipper/article.mjs';
const sourceUrl = 'https://www.w3.org/History/1989/proposal.html';
const quote = 'This proposal concerns the management of general information about accelerators and experiments at CERN.';
export async function seedLibrary(identity) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 480;
  const c = canvas.getContext('2d');
  c.fillStyle = '#f3f5f2';
  c.fillRect(0, 0, 800, 480);
  c.strokeStyle = '#294858';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(180, 240);
  c.lineTo(600, 120);
  c.moveTo(180, 240);
  c.lineTo(600, 360);
  c.stroke();
  for (const [x, y, title] of [
    [180, 240, 'World Wide Web'],
    [600, 120, 'Nodes'],
    [600, 360, 'Links'],
  ]) {
    c.fillStyle = '#d0dfde';
    c.beginPath();
    c.ellipse(x, y, 110, 50, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = '#22313f';
    c.font = '20px system-ui';
    c.textAlign = 'center';
    c.fillText(title, x, y + 7);
  }
  const dataUrl = canvas.toDataURL('image/png'),
    attachment = { name: 'concept.png', type: 'image/png', size: atob(dataUrl.split(',')[1]).length, dataUrl };
  const article = {
    version: 1,
    blocks: [
      { id: 'heading', type: 'heading', level: 1, runs: [{ text: 'Information Management: A Proposal' }] },
      { id: 'cern', type: 'paragraph', runs: [{ text: quote }] },
      { id: 'concept', type: 'image', src: 'https://www.w3.org/History/1989/Image1.gif', alt: '圆圈、节点与链接', caption: '万维网概念图', attachment },
      { id: 'ending', type: 'paragraph', runs: [{ text: 'Nodes and links connect information across documents.' }] },
    ],
  };
  const cards = [
    { id: 'qa-article', type: 'article', title: '万维网验收文章', sourceUrl, article, body: articlePlainText(article) },
    {
      id: 'qa-image',
      type: 'image',
      title: '万维网概念图',
      body: '圆圈、节点与链接',
      image: dataUrl,
      attachment,
      sourceUrl,
      sourceTitle: '万维网验收文章',
      sourceCardId: 'qa-article',
      articleFigure: { blockId: 'concept', imageUrl: 'https://www.w3.org/History/1989/Image1.gif' },
    },
    {
      id: 'qa-highlight',
      type: 'highlight',
      title: 'CERN 摘录',
      body: quote,
      sourceUrl,
      sourceTitle: '万维网验收文章',
      sourceCardId: 'qa-article',
      webAnchor: { version: 1, exact: quote, prefix: '', suffix: '' },
    },
    {
      id: 'qa-note',
      type: 'text',
      title: '圆圈、节点与链接',
      body: '# 阅读想法\n\n1. 从节点找到链接\n2. 沿来源回到文章\n\nhttps://www.w3.org/\n\n```js\nconst web = "links";\n```',
    },
  ];
  let state = createWorkspaceState();
  for (const card of cards)
    state = [
      { type: 'card.upsert', card: { ...card, createdAt: '2026-11-04T00:00:00.000Z' } },
      { type: 'card.save', id: card.id, saved: true },
    ].reduce(workspaceReducer, state);
  state = workspaceReducer(state, { type: 'collection.upsert', collection: { id: 'qa-collection', title: '治理收藏集', cardIds: cards.map((c) => c.id) } });
  const store = createWorkspaceStoreV3(identity);
  await store.update(() => state);
  const session = createWorkspaceSession(store),
    library = createRecallLibrary({ session, workspaceId: identity });
  for (let n = 1; n <= 2; n++) {
    const result = await library.call('capture', {
      requestId: crypto.randomUUID(),
      text: '治理回看原文 ' + n,
      title: '治理回看摘录 ' + n,
      externalSource: {
        version: 1,
        provider: 'deepseek-harness',
        instanceId: 'qa',
        sessionId: 'qa',
        messageId: 'm' + n,
        eventSeq: n,
        turn: 1,
        sessionTitle: '治理验收',
      },
    });
    if (n === 2) await session.commit({ type: 'card.hide', id: result.item.id, value: true });
  }
  await session.settled();
  await store.close();
  return { cards: 6, quote };
}
export async function inspectLibrary(identity) {
  const store = createWorkspaceStoreV3(identity),
    state = await store.load();
  await store.close();
  return state;
}
