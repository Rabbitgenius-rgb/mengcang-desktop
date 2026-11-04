import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {IconX} from '@tabler/icons-react';
import './zoomableImage.css';

export function displayedImageSize(image) {
  const box = image.getBoundingClientRect();
  const ratio = image.naturalWidth / image.naturalHeight;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  // Detail previews use object-fit: contain, including height-limited previews.
  const width = Math.min(box.width, box.height * ratio);
  if (!width) return null;
  const height = width / ratio;
  return {
    width, height, ratio,
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
  };
}

export function viewerImageWidth(detail, viewport, whole) {
  if (whole) return Math.min(detail.width, viewport.clientWidth, viewport.clientHeight * detail.ratio);
  return detail.width * 2;
}

function clickedPosition(event, detail) {
  if (!event.detail) return {x: 0.5, y: 0.5};
  const within = value => Math.max(0, Math.min(1, value));
  return {
    x: within((event.clientX - detail.left) / detail.width),
    y: within((event.clientY - detail.top) / detail.height),
  };
}

function ImageLightbox({src, alt, image, trigger, position, onClose}) {
  const viewport = useRef(null);
  const closeButton = useRef(null);
  const fitButton = useRef(null);
  const drag = useRef(null);
  const [whole, setWhole] = useState(false);

  useLayoutEffect(() => {
    const workspace = trigger.closest('.sublime-workspace');
    const previousInert = workspace?.inert;
    const previousOverflow = workspace?.style.overflow;
    if (workspace) {
      workspace.inert = true;
      workspace.style.overflow = 'hidden';
    }
    closeButton.current.focus({preventScroll: true});
    return () => {
      if (workspace) {
        workspace.inert = previousInert;
        workspace.style.overflow = previousOverflow;
      }
      if (trigger.isConnected) trigger.focus({preventScroll: true});
    };
  }, [trigger]);

  useLayoutEffect(() => {
    const view = viewport.current;
    function resize() {
      const detail = displayedImageSize(image);
      if (!detail) return;
      view.style.setProperty('--sw-view-image-width', viewerImageWidth(detail, view, whole) + 'px');
      view.style.setProperty('--sw-view-image-ratio', String(detail.ratio));
    }
    resize();
    // Center the point that was opened. Keyboard activation starts in the middle.
    view.scrollLeft = position.x * view.scrollWidth - view.clientWidth / 2;
    view.scrollTop = position.y * view.scrollHeight - view.clientHeight / 2;
    const observer = new ResizeObserver(resize);
    observer.observe(view);
    observer.observe(image);
    return () => observer.disconnect();
  }, [image, position, whole]);

  function handleKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      const boundary = event.shiftKey ? fitButton.current : closeButton.current;
      const focused = document.activeElement;
      if (focused === boundary || (focused !== fitButton.current && focused !== closeButton.current)) {
        event.preventDefault();
        (event.shiftKey ? closeButton.current : fitButton.current).focus();
      }
    } else if (!whole && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const step = 64;
      const shifts = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]};
      viewport.current.scrollBy(...shifts[event.key]);
    }
  }

  function startPan(event) {
    if (whole || event.pointerType !== 'mouse' || event.button !== 0 || event.target.tagName !== 'IMG') return;
    const view = viewport.current;
    drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop};
    view.setPointerCapture(event.pointerId);
    view.dataset.dragging = 'true';
    event.preventDefault();
  }

  function pan(event) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    viewport.current.scrollLeft = start.left - (event.clientX - start.x);
    viewport.current.scrollTop = start.top - (event.clientY - start.y);
  }

  function endPan() {
    drag.current = null;
    delete viewport.current.dataset.dragging;
  }

  return createPortal(
    <div className="sw-image-lightbox" role="dialog" aria-modal="true" aria-label={'放大图片：' + alt}
      onKeyDown={handleKey} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sw-image-view-tools">
        <button type="button" ref={fitButton} onClick={() => setWhole(!whole)}>{whole ? '放大细看' : '查看全图'}</button>
        <button type="button" className="sw-image-lightbox-close" ref={closeButton} aria-label="关闭放大图片" onClick={onClose}><IconX size={23}/></button>
      </div>
      <div ref={viewport} className="sw-image-viewport" data-whole={whole} tabIndex={-1}
        onPointerDown={startPan} onPointerMove={pan} onLostPointerCapture={endPan}>
        <div className="sw-image-view-sheet" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
          <img src={src} alt={alt} draggable={false}/>
        </div>
      </div>
    </div>, document.body
  );
}

export default function ZoomableImage({src,alt='',className='',onLoad,onError}) {
  const trigger = useRef(null);
  const image = useRef(null);
  const [position, setPosition] = useState(null);
  const [loadedSrc, setLoadedSrc] = useState('');
  useEffect(() => setPosition(null), [src]);

  function open(event) {
    const detail = displayedImageSize(image.current);
    if (detail) setPosition(clickedPosition(event, detail));
  }

  return <>
    <button ref={trigger} type="button" className="sw-zoom-image" aria-label={'放大查看图片：' + alt}
      aria-haspopup="dialog" disabled={loadedSrc !== src} onClick={open}>
      <img ref={image} className={className} src={src} alt={alt}
        onLoad={event => { setLoadedSrc(src); onLoad?.(event); }}
        onError={event => { setLoadedSrc(''); onError?.(event); }}/>
    </button>
    {position && loadedSrc === src && <ImageLightbox src={src} alt={alt} image={image.current}
      trigger={trigger.current} position={position} onClose={() => setPosition(null)}/>}
  </>;
}
