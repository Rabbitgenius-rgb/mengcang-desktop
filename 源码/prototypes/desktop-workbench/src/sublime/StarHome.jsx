import React, { useEffect, useMemo, useRef } from 'react';
import { IconSearch, IconX, IconArrowUpRight, IconRotate, IconMinus, IconPlus, IconArrowLeft } from '@tabler/icons-react';
import StarField from './StarField.jsx';
import { buildStarMap, searchStarCards } from './starHomeModel.js';
import { changeStarQuery, initialStarView, reconcileStarView } from './starHomeView.js';
import { isReadableBook } from '../reader/readerState.js';
import './starHome.css';

const names = {
  book: '图书',
  image: '图片',
  entry: '想法',
  inspiration: '想法',
  text: '笔记',
  note: '笔记',
  link: '链接',
  web: '网页',
  article: '文章',
  audio: '音频',
  video: '视频',
  file: '文件',
  highlight: '摘录',
  project: '项目',
  'project-document': '项目文档',
};
export const starCardType = (card) => names[card.type] || '资料';
const excerpt = (card) =>
  String(card.caption || card.body || card.description || '')
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/\n#{1,6}\s*(?:原始出处|收录记录)/)[0]
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_]/g, '')
    .trim()
    .slice(0, 420);

export default function StarHome({ cards = [], state, value = initialStarView(), onChange, onOpen, onLibrary, onAdd, previewLabel = '' }) {
  const map = useMemo(() => buildStarMap(cards, state), [cards, state.collections, state.annotations]);
  const searching = Boolean(value.query.trim());
  const matches = useMemo(() => searchStarCards(cards, state, value.query), [cards, state, value.query]);
  const matchIds = useMemo(() => new Set(matches.map((card) => card.id)), [matches]);
  const selected = map.nodes.find((node) => node.id === value.selectedId);
  useEffect(() => {
    const next = reconcileStarView(value, new Set(map.nodes.map((node) => node.id)));
    if (next !== value) onChange(next);
  }, [map, value, onChange]);
  const panel = useRef(null),
    search = useRef(null),
    previousSelected = useRef(null);
  const change = (patch) => onChange({ ...value, ...patch });
  function closePreview() {
    change({ selectedId: null });
    requestAnimationFrame(() => document.querySelector('.mc-star-field__hit[data-star-id="' + CSS.escape(value.selectedId || '') + '"]')?.focus());
  }
  useEffect(() => {
    if (value.selectedId && value.selectedId !== previousSelected.current) panel.current?.focus({ preventScroll: true });
    previousSelected.current = value.selectedId;
  }, [value.selectedId]);
  useEffect(() => {
    const key = (event) => {
      if (event.key === 'Escape' && value.selectedId) {
        event.preventDefault();
        closePreview();
      } else if (event.key === 'Escape' && searching) {
        event.preventDefault();
        onChange(changeStarQuery(value, ''));
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [value, searching]);
  return (
    <section className="mc-star-home" aria-label="梦藏星空首页" data-searching={searching} data-selected={selected?.id || ''}>
      <header className="mc-star-header">
        <div className="mc-star-brand">
          <span className="mc-star-symbol" aria-hidden="true">
            ✧
          </span>
          <strong>梦藏</strong>
          <span className="mc-star-brand-divider" />
          <span>私人星空</span>
        </div>
        <label className="mc-star-search">
          <IconSearch size={18} />
          <input
            ref={search}
            aria-label="搜索星空中的资料"
            placeholder="寻找一份资料、一个念头…"
            value={value.query}
            onChange={(event) => onChange(changeStarQuery(value, event.target.value))}
          />
          {value.query && (
            <button
              aria-label="清空星空搜索"
              onClick={() => {
                onChange(changeStarQuery(value, ''));
                search.current?.focus();
              }}
            >
              <IconX size={16} />
            </button>
          )}
        </label>
      </header>
      <div className="mc-star-intro">
        <p>收藏，是为了再次相遇</p>
        <h1>
          念念不忘，
          <br />
          在此回响。
        </h1>
      </div>
      <div className="mc-star-stage">
        <StarField
          nodes={map.nodes}
          clusters={map.clusters}
          camera={value.camera}
          onCameraChange={(camera) => change({ camera })}
          selectedId={selected?.id || null}
          onSelect={(id) => change({ selectedId: id })}
          matchIds={matchIds}
          searching={searching}
          paused={Boolean(selected) || searching}
        />
      </div>
      {!cards.length && (
        <div className="mc-star-empty">
          <span aria-hidden="true">✧</span>
          <h2>点亮第一颗星</h2>
          <p>保存一份资料，让值得留下的想法在这里相遇。</p>
          <button onClick={onAdd || onLibrary}>
            {onAdd ? '保存第一份资料' : '打开资料库'}
            <IconArrowUpRight size={18} />
          </button>
        </div>
      )}
      <div className="mc-star-caption">
        <span className="mc-star-live-dot" />
        <span>{map.nodes.length} 份珍藏</span>
        <i>·</i>
        <span>{map.clusters.length} 个主题</span>
        {previewLabel && <span className="mc-star-preview-label">{previewLabel}</span>}
      </div>
      <div className="mc-star-controls">
        <span>{selected ? '正在静静阅读' : searching ? '匹配已点亮' : '拖动漫游 · 滚动靠近'}</span>
        <div>
          <button
            aria-label="缩小星空"
            disabled={Boolean(selected)}
            onClick={() => change({ camera: { ...value.camera, zoom: Math.max(0.75, value.camera.zoom - 0.15) } })}
          >
            <IconMinus size={16} />
          </button>
          <button aria-label="还原星空视角" onClick={() => change({ camera: initialStarView().camera })}>
            <IconRotate size={16} />
          </button>
          <button
            aria-label="放大星空"
            disabled={Boolean(selected)}
            onClick={() => change({ camera: { ...value.camera, zoom: Math.min(1.6, value.camera.zoom + 0.15) } })}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>
      {(selected || searching) && (
        <aside className="mc-star-panel" aria-label={selected ? '资料预览' : '星空搜索结果'} ref={panel} tabIndex={-1}>
          <div className="mc-star-panel-top">
            <span>{selected ? '与你重逢' : '寻找回响'}</span>
            {selected ? (
              <button aria-label={searching ? '返回星空搜索结果' : '关闭资料预览'} onClick={closePreview}>
                {searching ? <IconArrowLeft size={19} /> : <IconX size={19} />}
              </button>
            ) : (
              <button aria-label="关闭搜索结果" onClick={() => onChange(changeStarQuery(value, ''))}>
                <IconX size={19} />
              </button>
            )}
          </div>
          {selected ? (
            <>
              <div className="mc-star-panel-body">
                <div className="mc-star-type">{starCardType(selected.card)}</div>
                <h2>{selected.card.title || '未命名资料'}</h2>
                {(selected.card.image || selected.card.previewImage) && (
                  <img
                    key={selected.id}
                    className="mc-star-preview-image"
                    src={selected.card.image || selected.card.previewImage}
                    alt={selected.card.title}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
                {excerpt(selected.card) ? (
                  <p className="mc-star-excerpt">{excerpt(selected.card)}</p>
                ) : (
                  <p className="mc-star-excerpt mc-star-muted">打开资料，继续阅读。</p>
                )}
                {selected.card.author && <p className="mc-star-source">{selected.card.author}</p>}
                {selected.card.sourceTitle && <p className="mc-star-source">{selected.card.sourceTitle}</p>}
                <div className="mc-star-topics">
                  <h3>所属主题</h3>
                  <div>
                    {selected.topics.map((topic) => (
                      <span key={topic.id}>{topic.title}</span>
                    ))}
                  </div>
                </div>
              </div>
              <footer>
                <button className="mc-star-open" onClick={() => onOpen(selected.card)}>
                  {isReadableBook(selected.card) ? '打开阅读器' : '打开资料'}
                  <IconArrowUpRight size={19} />
                </button>
                <small>星空会为你保留此刻的位置</small>
              </footer>
            </>
          ) : (
            <>
              <div className="mc-star-results-heading">
                <h2>找到 {matches.length} 份资料</h2>
                <p>星点留在原处，等待与你重逢。</p>
              </div>
              {matches.length ? (
                <ul className="mc-star-results">
                  {matches.map((card) => (
                    <li key={card.id}>
                      <button onClick={() => change({ selectedId: card.id })}>
                        <span className="mc-star-result-dot" />
                        <span>
                          <strong>{card.title || '未命名资料'}</strong>
                          <small>
                            {starCardType(card)}
                            {card.tags?.length ? ' · ' + card.tags.slice(0, 2).join(' / ') : ''}
                          </small>
                        </span>
                        <IconArrowUpRight size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mc-star-no-results">
                  <IconSearch size={28} />
                  <p>这次还没有找到。</p>
                  <small>试试资料名称、正文中的词，或已有标签。</small>
                </div>
              )}
            </>
          )}
        </aside>
      )}
    </section>
  );
}
