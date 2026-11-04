import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clampStarCamera, projectStarPoint, starDragMoved, starSeed } from './starFieldProjection.js';
import './StarField.css';

const EMPTY = Object.freeze([]);
const DEFAULT_CAMERA = Object.freeze({ yaw: 0, pitch: 0, zoom: 1 });
const TINTS = ['234,241,255', '255,219,174', '167,206,255', '239,239,242'];
const sameCamera = (a, b) => a.yaw === b.yaw && a.pitch === b.pitch && a.zoom === b.zoom;
const hasSelection = (id) => id != null && id !== '';
const titleOf = (node) => String(node.card?.title || node.title || '未命名资料');
const intersects = (a, b, gap = 12) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/** One visible point and one accessible button per supplied record; no generated records. */
export default function StarField({
  nodes = EMPTY,
  clusters = EMPTY,
  camera = DEFAULT_CAMERA,
  onCameraChange,
  selectedId,
  onSelect,
  matchIds,
  searching = false,
  paused = false,
  onHover,
}) {
  const root = useRef(null),
    canvas = useRef(null),
    targets = useRef(new Map()),
    topicElements = useRef(new Map());
  const renderer = useRef(null),
    cameraRef = useRef(clampStarCamera(camera)),
    gesture = useRef(null),
    suppressClick = useRef(false);
  const pointerHover = useRef(null),
    focusHover = useRef(null);
  const [hoveredId, setHoveredId] = useState(null);
  const instructionsId = useId();
  const records = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(nodes) ? nodes : EMPTY)
      .filter((node) => {
        if (node?.id == null || seen.has(node.id) || ![node.x, node.y, node.z].every(Number.isFinite)) return false;
        seen.add(node.id);
        return true;
      })
      .map((node) => ({ ...node, seed: starSeed(node.id), sizeSeed: starSeed(`${node.id}:size`) }));
  }, [nodes]);
  const topics = useMemo(
    () =>
      (Array.isArray(clusters) ? clusters : EMPTY)
        .filter((cluster) => cluster?.id != null && cluster.title && cluster.count >= 2 && [cluster.x, cluster.y, cluster.z].every(Number.isFinite))
        .slice()
        .sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)))
        .slice(0, 5),
    [clusters],
  );
  const matches = useMemo(() => (matchIds instanceof Set ? matchIds : new Set(Array.isArray(matchIds) ? matchIds : [])), [matchIds]);
  const latest = useRef(null);
  latest.current = { records, topics, selectedId, hoveredId, matches, searching, paused, onCameraChange, onSelect, onHover };

  function setHover(id, source = 'pointer') {
    if (source === 'focus') focusHover.current = id;
    else pointerHover.current = id;
    const next = focusHover.current ?? pointerHover.current;
    if (latest.current.hoveredId === next) return;
    latest.current.hoveredId = next;
    setHoveredId(next);
    latest.current.onHover?.(next);
    renderer.current?.invalidate();
  }
  function cameraBlocked() {
    const value = latest.current;
    return value.paused || value.searching || hasSelection(value.selectedId);
  }
  function updateCamera(next) {
    const value = clampStarCamera(next);
    if (sameCamera(value, cameraRef.current)) return;
    cameraRef.current = value;
    renderer.current?.invalidate();
    latest.current.onCameraChange?.(value);
  }

  useLayoutEffect(() => {
    cameraRef.current = clampStarCamera(camera);
    renderer.current?.invalidate();
  }, [camera]);

  useLayoutEffect(() => {
    const element = root.current,
      surface = canvas.current;
    if (!element || !surface) return undefined;
    const context = surface.getContext('2d', { alpha: true });
    if (!context) return undefined;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0,
      height = 0,
      dpr = 1,
      frame = null,
      phase = 0,
      lastTime = null,
      lastPaint = 0,
      alive = true;
    let intersecting = true,
      layoutDirty = true,
      points = [],
      projectedTopics = [];
    const sprites = TINTS.map((tint) => {
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = 96;
      const ctx = sprite.getContext('2d');
      const glow = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
      glow.addColorStop(0, `rgba(${tint},.78)`);
      glow.addColorStop(0.08, `rgba(${tint},.45)`);
      glow.addColorStop(0.24, `rgba(${tint},.14)`);
      glow.addColorStop(0.6, `rgba(${tint},.025)`);
      glow.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 96, 96);
      return sprite;
    });
    const canAnimate = () =>
      alive &&
      width > 0 &&
      height > 0 &&
      intersecting &&
      !document.hidden &&
      !motion.matches &&
      !latest.current.paused &&
      !latest.current.searching &&
      !hasSelection(latest.current.selectedId);

    function layout() {
      const value = latest.current,
        viewport = { width, height };
      points = value.records.map((node) => ({ ...projectStarPoint(node, cameraRef.current, viewport), node }));
      const occupied = [],
        labelIds = new Set();
      const ranked = points
        .filter((point) => point.visible)
        .slice()
        .sort((a, b) => Number(b.node.labelPriority || 0) - Number(a.node.labelPriority || 0) || b.node.seed - a.node.seed);
      context.font = '11px system-ui, sans-serif';
      for (const point of ranked) {
        if (labelIds.size >= 4) break;
        if (value.searching && !value.matches.has(point.node.id)) continue;
        const textWidth = Math.min(170, context.measureText(titleOf(point.node)).width);
        const left = point.x > width - 260;
        const box = { x: left ? point.x - 7 - textWidth : point.x + 7, y: point.y + 13, width: textWidth, height: 18 };
        if (box.x < 12 || box.x + box.width > width - 12 || box.y + box.height > height - 12 || occupied.some((other) => intersects(box, other, 30))) continue;
        labelIds.add(point.node.id);
        occupied.push(box);
      }
      for (const point of points) {
        const button = targets.current.get(point.node.id);
        if (!button) continue;
        button.style.transform = `translate(${point.x - 15}px, ${point.y - 15}px)`;
        button.style.visibility = point.visible ? 'visible' : 'hidden';
        button.style.zIndex = String(point.node.id === value.hoveredId || point.node.id === value.selectedId ? 1000 : Math.round(200 + point.z / 3));
        button.tabIndex = point.visible ? 0 : -1;
        button.dataset.labelled = String(labelIds.has(point.node.id));
        const left = point.x > width - 260;
        button.dataset.labelSide = left ? 'left' : 'right';
        button.dataset.labelTop = String(point.y > height - 60);
        button.style.setProperty('--star-label-width', `${Math.max(30, (left ? point.x : width - point.x) - 22)}px`);
        button.dataset.emphasis = String(point.node.id === value.hoveredId || point.node.id === value.selectedId);
        button.dataset.dim = String(value.searching && !value.matches.has(point.node.id));
      }
      projectedTopics = value.topics.map((topic) => ({ ...projectStarPoint(topic, cameraRef.current, viewport), topic }));
      for (const point of projectedTopics) {
        const label = topicElements.current.get(point.topic.id);
        if (!label) continue;
        const box = { x: point.x - 75, y: point.y - 62, width: 150, height: 38 };
        const visible = point.visible && box.x >= 10 && box.x + 150 < width - 10 && box.y > 10 && !occupied.some((other) => intersects(box, other, 24));
        label.style.transform = `translate(${box.x}px, ${box.y}px)`;
        label.style.visibility = visible ? 'visible' : 'hidden';
        if (visible) occupied.push(box);
      }
      points.sort((a, b) => a.z - b.z);
      element.dataset.ready = 'true';
      layoutDirty = false;
    }

    function paint() {
      if (!alive || width <= 0 || height <= 0 || document.hidden || !intersecting) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (layoutDirty) layout();
      // Broad translucent gas, not extra pinpoints or fabricated material nodes.
      for (let index = 0; index < Math.min(3, projectedTopics.length); index++) {
        const point = projectedTopics[index],
          radius = Math.min(width, height) * (0.33 + index * 0.04);
        const mist = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
        const tint = index === 1 ? '114,91,74' : '82,107,146';
        mist.addColorStop(0, `rgba(${tint},.05)`);
        mist.addColorStop(0.5, `rgba(${tint},.018)`);
        mist.addColorStop(1, `rgba(${tint},0)`);
        context.fillStyle = mist;
        context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
      }
      const value = latest.current;
      for (const point of points) {
        if (!point.visible) continue;
        const { node, x, y, perspective } = point;
        const selected = node.id === value.selectedId,
          hovered = node.id === value.hoveredId;
        const match = value.searching && value.matches.has(node.id),
          dim = value.searching && !match && !selected && !hovered;
        const tintIndex = node.seed < 0.2 ? 1 : node.seed > 0.63 ? 2 : 0;
        const breathing = 0.94 + 0.06 * Math.sin(phase * 0.18 + node.seed * Math.PI * 2);
        const depthLight = Math.max(0.4, Math.min(1, 0.6 + (perspective - 1) * 0.65 + node.sizeSeed * 0.4));
        const brightness = dim ? 0.18 : selected || hovered || match ? 1 : depthLight * breathing;
        const radius = Math.max(
          0.65,
          Math.min(3.8, (0.62 + Math.pow(node.sizeSeed, 2.8) * 2.55) * perspective + (selected || hovered ? 0.55 : match ? 0.26 : 0)),
        );
        const spread = radius * (selected || hovered || node.sizeSeed > 0.87 ? 25 : 13);
        context.globalAlpha = brightness;
        context.drawImage(sprites[tintIndex], x - spread / 2, y - spread / 2, spread, spread);
        context.fillStyle = `rgb(${TINTS[tintIndex]})`;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ffffff';
        context.beginPath();
        context.arc(x, y, Math.max(0.45, radius * 0.48), 0, Math.PI * 2);
        context.fill();
        if (!dim && (node.sizeSeed > 0.985 || selected || hovered)) {
          const length = radius * (selected ? 5.2 : 3.2);
          const ray = context.createLinearGradient(x - length, y, x + length, y);
          ray.addColorStop(0, 'rgba(232,240,255,0)');
          ray.addColorStop(0.5, 'rgba(232,240,255,.55)');
          ray.addColorStop(1, 'rgba(232,240,255,0)');
          context.fillStyle = ray;
          context.fillRect(x - length, y - 0.3, length * 2, 0.6);
          const vertical = context.createLinearGradient(x, y - length, x, y + length);
          vertical.addColorStop(0, 'rgba(232,240,255,0)');
          vertical.addColorStop(0.5, 'rgba(232,240,255,.4)');
          vertical.addColorStop(1, 'rgba(232,240,255,0)');
          context.fillStyle = vertical;
          context.fillRect(x - 0.3, y - length, 0.6, length * 2);
        }
        if (selected || hovered || match) {
          context.strokeStyle = selected ? 'rgba(235,241,252,.72)' : hovered ? 'rgba(235,241,252,.4)' : 'rgba(183,207,242,.28)';
          context.lineWidth = 0.7;
          context.beginPath();
          context.arc(x, y, selected ? 10.5 : hovered ? 9 : 6.8, 0, Math.PI * 2);
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }
    function tick(time) {
      frame = null;
      if (!canAnimate()) {
        lastTime = null;
        return;
      }
      if (lastTime != null) phase += Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;
      if (time - lastPaint >= 32) {
        paint();
        lastPaint = time;
      }
      frame = requestAnimationFrame(tick);
    }
    function invalidate() {
      if (!alive) return;
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
      lastTime = null;
      layoutDirty = true;
      paint();
      if (canAnimate()) frame = requestAnimationFrame(tick);
    }
    function resize() {
      const box = element.getBoundingClientRect();
      width = box.width;
      height = box.height;
      dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      surface.width = Math.max(1, Math.round(width * dpr));
      surface.height = Math.max(1, Math.round(height * dpr));
      invalidate();
    }
    function wheel(event) {
      if (cameraBlocked() || !event.deltaY) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      updateCamera({ ...cameraRef.current, zoom: cameraRef.current.zoom * Math.exp(-Math.max(-180, Math.min(180, delta)) * 0.0012) });
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    const intersection =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            intersecting = entries[0]?.isIntersecting !== false;
            invalidate();
          })
        : null;
    intersection?.observe(element);
    renderer.current = { invalidate };
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', invalidate);
    motion.addEventListener?.('change', invalidate);
    resize();
    return () => {
      alive = false;
      if (frame != null) cancelAnimationFrame(frame);
      observer?.disconnect();
      intersection?.disconnect();
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', invalidate);
      motion.removeEventListener?.('change', invalidate);
      renderer.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if ((paused || searching || hasSelection(selectedId)) && gesture.current) {
      const pointerId = gesture.current.pointerId;
      gesture.current = null;
      if (root.current) {
        root.current.dataset.dragging = 'false';
        if (root.current.hasPointerCapture?.(pointerId)) root.current.releasePointerCapture(pointerId);
      }
      suppressClick.current = true;
    }
    renderer.current?.invalidate();
  }, [records, topics, selectedId, hoveredId, matches, searching, paused]);

  useEffect(() => {
    if (hoveredId != null && !records.some((node) => node.id === hoveredId)) {
      pointerHover.current = focusHover.current = null;
      setHoveredId(null);
      latest.current.onHover?.(null);
    }
  }, [records, hoveredId]);

  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    if (cameraBlocked()) return;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...cameraRef.current }, dragged: false };
  }
  function pointerMove(event) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId || cameraBlocked()) return;
    if (!drag.dragged && !starDragMoved(drag, { x: event.clientX, y: event.clientY })) return;
    if (!drag.dragged) {
      drag.dragged = true;
      suppressClick.current = true;
      root.current?.setPointerCapture?.(event.pointerId);
      root.current.dataset.dragging = 'true';
      root.current.focus({ preventScroll: true });
      setHover(null);
    }
    event.preventDefault();
    updateCamera({ ...drag.camera, yaw: drag.camera.yaw + (event.clientX - drag.x) * 0.0019, pitch: drag.camera.pitch - (event.clientY - drag.y) * 0.0016 });
  }
  function finishPointer(event, cancelled = false) {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (drag.dragged || cancelled) suppressClick.current = true;
    if (root.current) {
      root.current.dataset.dragging = 'false';
      if (root.current.hasPointerCapture?.(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
    }
  }
  function keyDown(event) {
    if (cameraBlocked() || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 2 : 1,
      next = { ...cameraRef.current };
    if (event.key === 'ArrowLeft') next.yaw -= 0.035 * step;
    else if (event.key === 'ArrowRight') next.yaw += 0.035 * step;
    else if (event.key === 'ArrowUp') next.pitch += 0.025 * step;
    else if (event.key === 'ArrowDown') next.pitch -= 0.025 * step;
    else if (event.key === '+' || event.key === '=') next.zoom += 0.06;
    else if (event.key === '-') next.zoom -= 0.06;
    else return;
    event.preventDefault();
    event.stopPropagation();
    updateCamera(next);
  }

  return (
    <div
      ref={root}
      className="mc-star-field"
      role="region"
      aria-label="星空资料"
      aria-describedby={instructionsId}
      tabIndex={0}
      data-paused={paused || searching || hasSelection(selectedId)}
      data-searching={searching}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={(event) => finishPointer(event, true)}
      onKeyDown={keyDown}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail > 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <canvas ref={canvas} className="mc-star-field__canvas" aria-hidden="true" />
      <span id={instructionsId} className="mc-star-field__instructions">
        每一颗星对应一份资料。拖动旋转视角，滚轮缩放；方向键旋转，加减键缩放。Tab 选择资料，回车打开预览。搜索或预览时视角保持固定。
      </span>
      <div className="mc-star-field__topics" aria-hidden="true">
        {topics.map((topic) => (
          <span
            key={topic.id}
            className="mc-star-field__topic"
            title={String(topic.title)}
            ref={(element) => {
              if (element) topicElements.current.set(topic.id, element);
              else topicElements.current.delete(topic.id);
            }}
          >
            {topic.title}
          </span>
        ))}
      </div>
      <div className="mc-star-field__targets">
        {records.map((node) => (
          <button
            key={node.id}
            type="button"
            className="mc-star-field__hit"
            data-star-id={String(node.id)}
            ref={(element) => {
              if (element) targets.current.set(node.id, element);
              else targets.current.delete(node.id);
            }}
            aria-label={`预览：${titleOf(node)}${searching && matches.has(node.id) ? '，匹配搜索' : ''}`}
            aria-pressed={node.id === selectedId}
            onPointerEnter={() => {
              if (!gesture.current?.dragged) setHover(node.id);
            }}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(node.id, 'focus')}
            onBlur={() => setHover(null, 'focus')}
            onClick={() => latest.current.onSelect?.(node.id)}
          >
            <span className="mc-star-field__label" aria-hidden="true">
              {titleOf(node)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
