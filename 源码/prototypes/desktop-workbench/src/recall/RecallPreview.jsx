import React, { useRef, useState } from 'react';
import RecallWorkbench from './RecallWorkbench.jsx';
import { normalizeWorkbench } from './recallModel.js';
const topics = ['关于时间与生活的思考', '梦藏产品设计', '阅读与知识的连接'];
const entries = [
  ['轻快，是接纳现实后的回声', '“轻快的悲伤”不是一种可以稳定拥有的能力，而是偶尔、偶然、不请自来的东西；它更像是松手之后的回声，不是努力之后的成果。', 0],
  ['工具应该顺着人的习惯生长', '先理解一个人想做什么，再决定呈现哪些工具。给使用者选择的空间，也让第一次打开页面的人知道从哪里开始。', 1],
  ['把想法变成可以检验的问题', '在急着完善方案之前，先问：这个想法最依赖哪一个假设？如果它不成立，最先改变的会是什么？', 1],
  ['给阅读留一点空白', '值得留下的内容不一定需要立刻归类。有时候，隔一段时间重新遇见它，连接才会慢慢出现。', 2],
  ['可能性与现实之间', '只要“本可以更好”的世界还开着，你就得同时活在两个世界里：现实中的失去，和想象中的补救。', 0],
  ['回看不是重复阅读', '把当时的触动留下，再带着现在的问题回到原文。新的理解，发生在两次阅读之间。', 2],
];
const seed = entries.map(([title, body, topic], i) => ({
  id: 'preview-recall-' + i,
  title,
  body,
  recallDue: i !== 4,
  recallReceipt: { savedAt: `2026-10-${25 - Math.floor(i / 2)}T08:30:00.000Z` },
  externalSource: { instanceId: 'preview-only', sessionId: 'topic-' + topic, sessionTitle: topics[topic], turn: i + 1 },
}));
const key = 'mengcang-independent-recall-preview-v1';
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    return {
      model: normalizeWorkbench(raw?.model),
      cards: seed.map((c) => ({ ...c, recallDue: raw?.due?.[c.id] ?? c.recallDue })),
      hiddenIds: Array.isArray(raw?.hiddenIds) ? raw.hiddenIds.filter((id) => seed.some((c) => c.id === id)) : [],
    };
  } catch {
    return { model: normalizeWorkbench(), cards: seed, hiddenIds: [] };
  }
}
export default function RecallPreview() {
  const [state, setState] = useState(load),
    [notice, setNotice] = useState(''),
    latest = useRef(state);
  function persist(next) {
    localStorage.setItem(
      key,
      JSON.stringify({ model: next.model, due: Object.fromEntries(next.cards.map((c) => [c.id, c.recallDue])), hiddenIds: next.hiddenIds }),
    );
    latest.current = next;
    setState(next);
  }
  async function update(producer) {
    persist({ ...latest.current, model: producer(latest.current.model) });
  }
  async function archive(id, hidden) {
    const current = latest.current;
    persist({ ...current, hiddenIds: hidden ? [...new Set([...current.hiddenIds, id])] : current.hiddenIds.filter((value) => value !== id) });
  }
  return (
    <>
      <RecallWorkbench
        demo
        cards={state.cards.filter((c) => !state.hiddenIds.includes(c.id))}
        model={state.model}
        onUpdate={update}
        onDelete={(id) => archive(id, true)}
        onRestore={(id) => archive(id, false)}
        onLibrary={() => setNotice('这里是独立工作台预览；桌面版可切回现有资料库。')}
        onSettings={() => setNotice('预览使用本地追问示例；桌面版沿用梦藏现有的 AI 连接设置。')}
      />
      {notice && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 18px',
            background: '#242936',
            color: '#ffffff',
            borderRadius: 9,
            fontSize: 12,
            zIndex: 100,
          }}
        >
          {notice}
          <button onClick={() => setNotice('')} style={{ marginLeft: 16, background: 'none', border: 0, cursor: 'pointer' }}>
            关闭
          </button>
        </div>
      )}
    </>
  );
}
