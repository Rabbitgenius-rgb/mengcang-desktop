import React from 'react';
import { IconArrowLeft, IconLink, IconPlus, IconSearch, IconTrash, IconX, IconZoomIn, IconZoomOut, IconFocusCentered } from '@tabler/icons-react';
import { itemKey } from './editorModel.js';
import { ErrorMessage } from './EditorChrome.jsx';
import { SafeRichBody } from './SafeRichBody.jsx';
import { useCanvasEditor } from './useCanvasEditor.js';
export function CanvasEditor(props) {
  const { collections = [], onBack } = props;
  const {
    currentBoard,
    query,
    setQuery,
    candidates,
    addPath,
    setAddPath,
    add,
    selected,
    removeNode,
    linking,
    setLinking,
    setLinkFrom,
    saving,
    dirty,
    error,
    title,
    setTitle,
    boardRef,
    update,
    container,
    view,
    start,
    move,
    endGesture,
    nodes,
    edges,
    byPath,
    linkFrom,
    setSelected,
    clicked,
    keyboard,
    zoom,
    setView,
  } = useCanvasEditor(props);
  if (!currentBoard)
    return (
      <main className="sublime-editor">
        <button type="button" className="se-secondary" onClick={onBack}>
          <IconArrowLeft size={18} />
          返回
        </button>
        <p>尚未选择画布。</p>
      </main>
    );
  return (
    <main className="sublime-canvas-editor">
      <header className="se-canvas-heading">
        <button type="button" className="se-icon-button" aria-label="从画布返回" onClick={onBack}>
          <IconArrowLeft size={22} />
        </button>
        <input
          aria-label="画布标题"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim()) update((latest) => ({ ...latest, title: title.trim() }));
            else setTitle(boardRef.current?.title || '');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229) event.currentTarget.blur();
          }}
        />
        <select
          aria-label="画布所属收藏集"
          value={currentBoard.collectionId || ''}
          onChange={(event) => {
            const collectionId = event.target.value;
            update((latest) => ({ ...latest, collectionId }));
          }}
        >
          <option value="">不加入收藏集</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`se-secondary ${linking ? 'is-active' : ''}`}
          aria-pressed={linking}
          onClick={() => {
            setLinking((value) => !value);
            setLinkFrom('');
          }}
        >
          <IconLink size={18} />
          连接卡片
        </button>
        <button type="button" className="se-icon-button" aria-label="从画布移除选中卡片" disabled={!selected} onClick={() => removeNode(selected)}>
          <IconTrash size={19} />
        </button>
        <small className="se-canvas-save-status" role="status">
          {saving ? '正在保存…' : dirty ? '未保存的草稿' : ''}
        </small>
      </header>
      {(error || dirty) && (
        <div className="se-canvas-error-row">
          <ErrorMessage error={error || '画布仍有未提交的草稿，请重试保存。'} />
          {dirty && (
            <button type="button" className="se-secondary" disabled={saving} onClick={() => update((latest) => ({ ...latest }))}>
              重试保存
            </button>
          )}
        </div>
      )}
      <div className="se-canvas-picker">
        <label>
          <IconSearch size={17} />
          <input
            aria-label="搜索可添加到画布的卡片"
            placeholder="搜索资料库…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setAddPath('');
            }}
          />
        </label>
        <select aria-label="要添加到画布的卡片" value={addPath} onChange={(event) => setAddPath(event.target.value)}>
          <option value="">选择卡片</option>
          {candidates.map((item) => (
            <option key={itemKey(item)} value={itemKey(item)}>
              {item.title || '未命名'}
            </option>
          ))}
        </select>
        <button type="button" className="se-secondary" disabled={!addPath} onClick={add}>
          <IconPlus size={18} />
          添加卡片
        </button>
      </div>
      <div
        className="se-canvas-board"
        ref={container}
        tabIndex={0}
        aria-label="画布，拖动背景可平移"
        onPointerDown={(event) => {
          if (event.target === container.current) start(event);
        }}
        onPointerMove={move}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            zoom(event.deltaY < 0 ? 0.08 : -0.08);
          }
        }}
      >
        <div className="se-canvas-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
          <svg className="se-canvas-edges" aria-label="手动卡片连线">
            {edges.map((edge) => {
              const from = nodes.find((node) => node.id === edge.from),
                to = nodes.find((node) => node.id === edge.to);
              return from && to ? <line key={edge.id} x1={from.x + 110} y1={from.y + 85} x2={to.x + 110} y2={to.y + 85} /> : null;
            })}
          </svg>
          {nodes.map((node) => {
            const item = byPath.get(node.itemPath),
              image = item?.image || item?.imageData || item?.assetUrl;
            return (
              <article
                key={node.id}
                className={`se-canvas-node ${selected === node.id ? 'is-selected' : ''} ${linkFrom === node.id ? 'is-link-start' : ''}`}
                style={{ left: node.x, top: node.y }}
                tabIndex={0}
                aria-label={`${item?.title || '卡片不可用'}。方向键移动，按住 Shift 加速，Delete 键移除。`}
                onFocus={() => setSelected(node.id)}
                onPointerDown={(event) => start(event, node)}
                onPointerMove={(event) => {
                  move(event);
                  event.stopPropagation();
                }}
                onPointerUp={(event) => {
                  endGesture();
                  event.stopPropagation();
                }}
                onPointerCancel={(event) => {
                  endGesture();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  if (!event.target.closest('a')) clicked(node);
                }}
                onKeyDown={(event) => keyboard(event, node)}
              >
                {image && <img src={image} alt="" draggable="false" />}
                <h3>{item?.title || '卡片不可用'}</h3>
                <div className="se-canvas-node-body">
                  <SafeRichBody text={item?.body || node.itemPath} />
                </div>
              </article>
            );
          })}
        </div>
        {!nodes.length && <div className="se-canvas-empty">添加一张卡片，在画布上展开想法。</div>}
        <div className="se-canvas-controls">
          <button type="button" className="se-icon-button" aria-label="缩小" onClick={() => zoom(-0.15)}>
            <IconZoomOut size={20} />
          </button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button type="button" className="se-icon-button" aria-label="放大" onClick={() => zoom(0.15)}>
            <IconZoomIn size={20} />
          </button>
          <button type="button" className="se-icon-button" aria-label="重置画布视图" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>
            <IconFocusCentered size={20} />
          </button>
        </div>
        <p className="se-canvas-hint">{linking ? (linkFrom ? '请选择第二张卡片以连接。' : '请选择两张卡片以连接。') : '拖动背景平移 · 方向键移动当前卡片'}</p>
      </div>
      {edges.length > 0 && (
        <details className="se-canvas-edge-list">
          <summary>连线（{edges.length}）</summary>
          {edges.map((edge) => (
            <div key={edge.id}>
              <span>
                {byPath.get(nodes.find((node) => node.id === edge.from)?.itemPath)?.title || '卡片'} ↔{' '}
                {byPath.get(nodes.find((node) => node.id === edge.to)?.itemPath)?.title || '卡片'}
              </span>
              <button
                type="button"
                className="se-icon-button"
                aria-label="移除连线"
                onClick={() => update((latest) => ({ ...latest, edges: (latest.edges || []).filter((value) => value.id !== edge.id) }))}
              >
                <IconX size={17} />
              </button>
            </div>
          ))}
        </details>
      )}
    </main>
  );
}
