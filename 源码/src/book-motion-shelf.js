"use strict";

const BOOK_MOTION_CARD_COUNT = 24;
const BOOK_MOTION_OPEN_DURATION_MS = 4000;
const BOOK_MOTION_IDLE_LAP_SECONDS = 210;
const BOOK_MOTION_SHELVES = Object.freeze([
  Object.freeze({ id: "want-to-read", label: "想读", number: "01", note: "等待相遇" }),
  Object.freeze({ id: "reading", label: "在读", number: "02", note: "正在发生" }),
  Object.freeze({ id: "read", label: "已读", number: "03", note: "沉淀为藏" })
]);
const bookMotionShelfIds = new Set(BOOK_MOTION_SHELVES.map((shelf) => shelf.id));

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function easeOutExpo(value) {
  return value >= 1 ? 1 : 1 - 2 ** (-10 * value);
}

function easeInExpo(value) {
  return value <= 0 ? 0 : 2 ** (10 * value - 10);
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function easeInOutQuad(value) {
  return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
}

function cubicBezier(x1, y1, x2, y2) {
  const sample = (time, first, second) => (
    ((1 - 3 * second + 3 * first) * time + (3 * second - 6 * first)) * time + 3 * first
  ) * time;
  const slope = (time, first, second) => (
    3 * (1 - 3 * second + 3 * first) * time * time
    + 2 * (3 * second - 6 * first) * time
    + 3 * first
  );
  return (value) => {
    const x = clamp(value);
    let time = x;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const delta = sample(time, x1, x2) - x;
      const currentSlope = slope(time, x1, x2);
      if (Math.abs(currentSlope) < 0.000001) break;
      time = clamp(time - delta / currentSlope);
    }
    return sample(time, y1, y2);
  };
}

const ringScaleEase = cubicBezier(0.87, 0.01, 0.63, 1);

function normalizeBookMotionShelfId(value) {
  return bookMotionShelfIds.has(value) ? value : null;
}

function groupBookMotionShelves(books = []) {
  const groups = Object.fromEntries(BOOK_MOTION_SHELVES.map((shelf) => [shelf.id, []]));
  for (const book of books) {
    const status = normalizeBookMotionShelfId(book?.readingStatus);
    if (status) groups[status].push(book);
  }
  return groups;
}

function signedBookMotionSlot(index, activeIndex, length = BOOK_MOTION_CARD_COUNT) {
  let distance = index - activeIndex;
  const halfway = length / 2;
  if (distance > halfway) distance -= length;
  if (distance < -halfway) distance += length;
  return distance;
}

function bookMotionScreenScale(viewport = {}) {
  const width = Number(viewport.width) || 1440;
  const height = Number(viewport.height) || 900;
  return clamp(Math.min(width / 1600, height / 900), 0.48, 1.2);
}

function bookMotionFrame(progress, viewport = {}) {
  const normalized = clamp(progress);
  const screenScale = bookMotionScreenScale(viewport);
  const baseRadius = 328 * screenScale;
  const targetRadius = 3.7 * 328 * screenScale;
  const virtualScroll = normalized * 2450;
  const zoomPartOne = clamp(virtualScroll / 1400);
  const zoomPartTwo = easeInOutQuad(clamp((virtualScroll - 150) / 2300));
  const scaleProgress = ringScaleEase(zoomPartOne);
  const radius = mix(baseRadius, targetRadius, scaleProgress);
  const motionScale = radius / baseRadius;
  const projectionBaselineCorrection = 18 * screenScale * easeOutCubic(zoomPartOne);
  return {
    progress: normalized,
    screenScale,
    baseRadius,
    targetRadius,
    radius,
    motionScale,
    angleProgress: zoomPartTwo,
    shiftY: radius * easeOutCubic(zoomPartOne) - projectionBaselineCorrection,
    overviewLiftY: -20 * screenScale * (1 - easeOutCubic(zoomPartOne)),
    cardProjectionCorrection: mix(1, 1.025, easeOutCubic(zoomPartOne)),
    copyExit: easeOutCubic(clamp(normalized / 0.2)),
    chromeOpacity: easeOutCubic(clamp((normalized - 0.76) / 0.2)),
    captionOpacity: easeOutCubic(clamp((normalized - 0.12) / 0.34))
  };
}

function makeElement(ownerDocument, tagName, className = "", text = "") {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function firstAvailableShelfId(groups, preferred) {
  if (normalizeBookMotionShelfId(preferred) && groups[preferred]?.length) return preferred;
  return BOOK_MOTION_SHELVES.find((shelf) => groups[shelf.id]?.length)?.id || BOOK_MOTION_SHELVES[0].id;
}

function canBookMotionIdleRotate({ phase, hoverPaused, keyboardPaused, reducedMotion, documentHidden }) {
  return (
    phase === "overview"
    && !hoverPaused
    && !keyboardPaused
    && !reducedMotion
    && !documentHidden
  );
}

function mountBookMotionShelf(container, options = {}) {
  const ownerDocument = container.ownerDocument || document;
  const ownerWindow = ownerDocument.defaultView || window;
  const groups = groupBookMotionShelves(options.books);
  const reducedQuery = ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)");
  const finePointerQuery = ownerWindow.matchMedia?.("(pointer: fine)");
  const state = {
    shelfId: firstAvailableShelfId(groups, options.selectedStatus),
    activeSlot: 0,
    progress: 0,
    phase: "overview",
    idleAngle: 0,
    idleVelocity: 0,
    hoverPaused: false,
    keyboardPaused: false,
    keyboardNavigation: false,
    pendingShelfId: "",
    suppressClick: false,
    handoffActive: false,
    lastWheelAt: 0,
    drag: null,
    dragAngle: 0
  };
  const cleanupTasks = [];
  const cards = [];
  let animationFrame = 0;
  let idleFrame = 0;
  let resizeObserver = null;
  let lastIdleTime = ownerWindow.performance.now();
  let animationToken = 0;
  let handoffOverlay = null;
  let renderedCopyShelfId = "";
  let renderedRootClass = "";
  let renderedFrame = bookMotionFrame(0, { width: 1440, height: 900 });
  let viewport = { width: 1440, height: 900 };
  let progressRange = 0;
  let pointerFrame = 0;
  let pendingPointer = null;

  const root = makeElement(ownerDocument, "section", "mengcang-motion-bookshelf phase-overview");
  root.dataset.motionProgress = "0.0000";
  root.dataset.motionPhase = "overview";
  root.dataset.visibleShelf = state.shelfId;
  root.setAttribute("aria-label", "梦藏白色圆环图书书架");

  const header = makeElement(ownerDocument, "header", "mengcang-motion-bookshelf__header");
  header.appendChild(makeElement(ownerDocument, "strong", "", "梦藏"));
  const navigation = makeElement(ownerDocument, "nav", "");
  navigation.setAttribute("aria-label", "图书阅读状态");
  const statusButtons = new Map();
  for (const shelf of BOOK_MOTION_SHELVES) {
    const button = makeElement(ownerDocument, "button", "", shelf.label);
    button.type = "button";
    button.disabled = !groups[shelf.id]?.length;
    button.setAttribute("aria-pressed", "false");
    navigation.appendChild(button);
    statusButtons.set(shelf.id, button);
  }
  header.append(navigation, makeElement(ownerDocument, "span", "", "BOOKS / 03"));

  const progressTrack = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__progress");
  progressTrack.setAttribute("aria-hidden", "true");
  const progressMarker = makeElement(ownerDocument, "span");
  progressTrack.appendChild(progressMarker);

  const stage = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__stage");
  const orbitFrame = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__orbit-frame");
  const orbit = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__orbit");
  orbit.dataset.dragging = "false";
  orbitFrame.appendChild(orbit);
  stage.appendChild(orbitFrame);

  const copy = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__copy");
  const copyTitle = makeElement(ownerDocument, "h1");
  const copyNote = makeElement(ownerDocument, "p");
  copy.append(copyTitle, copyNote);
  stage.appendChild(copy);

  for (let index = 0; index < BOOK_MOTION_CARD_COUNT; index += 1) {
    const card = makeElement(ownerDocument, "button", "mengcang-motion-card");
    card.type = "button";
    card.dataset.slot = String(index);
    card.style.setProperty("--angle", `${360 / BOOK_MOTION_CARD_COUNT * index}deg`);
    const face = makeElement(ownerDocument, "span", "mengcang-motion-card__face");
    const image = makeElement(ownerDocument, "img", "mengcang-motion-card__image");
    image.alt = "";
    image.draggable = false;
    face.appendChild(image);
    card.appendChild(face);
    orbit.appendChild(card);
    cards.push({ card, face, image, record: null, pointerStrength: 0 });
  }

  const detail = makeElement(ownerDocument, "section", "mengcang-motion-bookshelf__detail");
  detail.setAttribute("aria-hidden", "true");
  const detailToolbar = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__detail-toolbar");
  const backButton = makeElement(ownerDocument, "button", "", "返回圆环");
  backButton.type = "button";
  const detailCount = makeElement(ownerDocument, "span");
  detailToolbar.append(backButton, detailCount);
  const detailMarker = makeElement(ownerDocument, "span", "mengcang-motion-bookshelf__detail-marker");
  detailMarker.setAttribute("aria-hidden", "true");
  const caption = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__caption");
  caption.setAttribute("aria-live", "polite");
  const captionMeta = makeElement(ownerDocument, "p");
  const captionTitle = makeElement(ownerDocument, "h2");
  caption.append(captionMeta, captionTitle);
  const controls = makeElement(ownerDocument, "div", "mengcang-motion-bookshelf__controls");
  controls.setAttribute("aria-label", "轮转控制");
  const previousButton = makeElement(ownerDocument, "button", "", "上一册");
  const controlLine = makeElement(ownerDocument, "span");
  controlLine.setAttribute("aria-hidden", "true");
  const nextButton = makeElement(ownerDocument, "button", "", "下一册");
  previousButton.type = "button";
  nextButton.type = "button";
  controls.append(previousButton, controlLine, nextButton);
  detail.append(detailToolbar, detailMarker, caption, controls);

  const footnote = makeElement(ownerDocument, "p", "mengcang-motion-bookshelf__footnote", "真实阅读状态来自 Vault · 此动画不会改写笔记");
  root.append(header, progressTrack, stage, detail, footnote);
  container.appendChild(root);

  function viewportSize() {
    return viewport;
  }

  function currentShelf() {
    return BOOK_MOTION_SHELVES.find((shelf) => shelf.id === state.shelfId) || BOOK_MOTION_SHELVES[0];
  }

  function currentBooks() {
    return groups[state.shelfId] || [];
  }

  function recordForSlot(index) {
    const books = currentBooks();
    return books.length ? books[modulo(index, books.length)] : null;
  }

  function activePhysicalSlot() {
    return modulo(state.activeSlot, BOOK_MOTION_CARD_COUNT);
  }

  function activeRecord() {
    return recordForSlot(activePhysicalSlot());
  }

  function updateRootClass() {
    const nextClass = `mengcang-motion-bookshelf phase-${state.phase}${state.progress > 0.0001 ? " has-active-shelf" : ""}${state.keyboardNavigation ? " is-keyboard-navigation" : ""}`;
    if (nextClass === renderedRootClass) return;
    renderedRootClass = nextClass;
    root.className = nextClass;
  }

  function applyOrbitTransform(frame = renderedFrame) {
    const activeBaseAngle = 360 / BOOK_MOTION_CARD_COUNT * state.activeSlot;
    const ringRotation = -activeBaseAngle * frame.angleProgress;
    const renderedIdleAngle = state.idleAngle * (1 - frame.angleProgress);
    const rotation = ringRotation + renderedIdleAngle + state.dragAngle;
    orbit.style.transform = `scale(${frame.motionScale}) rotate(${rotation}deg)`;
  }

  function renderMotionFrame() {
    const frame = bookMotionFrame(state.progress, viewportSize());
    renderedFrame = frame;
    updateRootClass();
    root.dataset.motionProgress = state.progress.toFixed(4);
    progressMarker.style.transform = `translate3d(0, ${frame.progress * progressRange}px, 0)`;
    copy.style.opacity = String(1 - frame.copyExit);
    copy.style.transform = `translate(-50%, ${mix(-50, 45, frame.copyExit)}%) scale(${mix(1, 0.82, frame.copyExit)})`;
    orbitFrame.style.transform = `translate(-50%, -50%) translate3d(0, ${frame.shiftY + frame.overviewLiftY}px, 0)`;
    orbit.style.setProperty("--card-projection-correction", frame.cardProjectionCorrection.toFixed(5));
    applyOrbitTransform(frame);
    detailToolbar.style.opacity = String(frame.chromeOpacity);
    detailMarker.style.opacity = String(frame.chromeOpacity);
    caption.style.opacity = String(frame.captionOpacity);
    controls.style.opacity = String(frame.chromeOpacity);
  }

  function updateViewport(rectangle = root.getBoundingClientRect()) {
    viewport = {
      width: rectangle.width || 1440,
      height: rectangle.height || 900
    };
    const frame = bookMotionFrame(state.progress, viewport);
    const baseCardWidth = 51.1 * 0.95 * frame.screenScale;
    const baseCardHeight = 68.14 * 0.95 * frame.screenScale;
    orbitFrame.style.width = `${frame.baseRadius * 2}px`;
    orbitFrame.style.height = `${frame.baseRadius * 2}px`;
    orbit.style.setProperty("--radius", `${frame.baseRadius}px`);
    orbit.style.setProperty("--card-width", `${baseCardWidth}px`);
    orbit.style.setProperty("--card-height", `${baseCardHeight}px`);
    progressRange = Math.max(0, viewport.height - 122);
    renderMotionFrame();
  }

  function resetHoverField() {
    pendingPointer = null;
    if (pointerFrame) {
      ownerWindow.cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
    }
    state.hoverPaused = false;
    for (const entry of cards) {
      const { card, face } = entry;
      if (entry.pointerStrength > 0.0001) {
        face.style.setProperty("--pointer-depth", "0px");
        face.style.setProperty("--pointer-radial", "0px");
        face.style.setProperty("--pointer-turn", "0deg");
        face.style.setProperty("--pointer-scale", "1");
        face.style.setProperty("--pointer-light", "1");
        entry.pointerStrength = 0;
      }
      card.style.zIndex = "";
    }
    scheduleIdle();
  }

  function assignBooks() {
    const books = currentBooks();
    cards.forEach((entry, index) => {
      const record = books.length ? books[index % books.length] : null;
      entry.record = record;
      entry.card.disabled = !record;
      entry.card.dataset.bookPath = record?.file?.path || "";
      entry.card.dataset.bookTitle = record?.title || "";
      entry.card.style.setProperty("--card-opacity", record ? "1" : "0");
      entry.image.src = record?.cover || "";
      entry.image.alt = "";
    });
  }

  function render() {
    const shelf = currentShelf();
    const books = currentBooks();
    const physicalActiveSlot = activePhysicalSlot();
    const selectedRecord = activeRecord();

    updateRootClass();
    root.dataset.motionPhase = state.phase;
    root.dataset.visibleShelf = state.shelfId;

    for (const [shelfId, button] of statusButtons) {
      const selected = shelfId === state.shelfId;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }

    if (renderedCopyShelfId !== shelf.id) {
      renderedCopyShelfId = shelf.id;
      copyTitle.textContent = shelf.label;
      copyNote.replaceChildren(
        ownerDocument.createTextNode(shelf.note),
        makeElement(ownerDocument, "small", "", ` · ${books.length} 本 · 点击圆环进入`)
      );
    }
    cards.forEach((entry, index) => {
      const relative = signedBookMotionSlot(index, physicalActiveSlot);
      const detailInteractive = state.phase === "detail" && Math.abs(relative) <= 3;
      const isActive = state.phase === "detail" && relative === 0;
      entry.card.style.pointerEvents = !entry.record || (state.phase === "detail" && !detailInteractive) ? "none" : "";
      if (state.phase !== "overview") entry.card.style.zIndex = String(30 - Math.abs(relative));
      else if (!state.hoverPaused) entry.card.style.zIndex = "";
      entry.card.classList.toggle("is-active", isActive);
      entry.card.setAttribute("aria-current", isActive ? "true" : "false");
      entry.card.tabIndex = !entry.record
        ? -1
        : state.phase === "detail"
          ? (detailInteractive ? 0 : -1)
          : (state.phase === "overview" ? (index === 0 ? 0 : -1) : -1);
      entry.card.setAttribute("aria-label", entry.record
        ? state.phase === "detail"
          ? `${entry.record.title}${relative === 0 ? "，当前书籍" : ""}`
          : `打开${shelf.label}书架，共 ${books.length} 本`
        : "空书位");
      entry.image.alt = state.phase === "detail" && entry.record ? `《${entry.record.title}》封面` : "";
    });

    const detailVisible = state.phase !== "overview";
    detail.style.visibility = detailVisible ? "visible" : "hidden";
    detail.setAttribute("aria-hidden", state.phase === "detail" ? "false" : "true");
    detailCount.textContent = `${shelf.number} / 03`;
    captionMeta.textContent = `${shelf.label} · 按住左右拖拽书架`;
    captionTitle.textContent = selectedRecord?.title || "这个状态还没有书";
    backButton.disabled = state.phase !== "detail";
    previousButton.disabled = state.phase !== "detail";
    nextButton.disabled = state.phase !== "detail";
    renderMotionFrame();
  }

  function stopProgressAnimation() {
    animationToken += 1;
    ownerWindow.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function animateProgress(destination, onDone) {
    stopProgressAnimation();
    const token = animationToken;
    const target = clamp(destination);
    const from = state.progress;
    if (reducedQuery?.matches || Math.abs(target - from) < 0.0001) {
      state.progress = target;
      renderMotionFrame();
      onDone?.();
      return;
    }
    const startedAt = ownerWindow.performance.now();
    const duration = Math.max(260, BOOK_MOTION_OPEN_DURATION_MS * Math.abs(target - from));
    const easing = target > from ? easeOutExpo : easeInExpo;
    const tick = (now) => {
      if (token !== animationToken) return;
      const elapsed = clamp((now - startedAt) / duration);
      state.progress = mix(from, target, easing(elapsed));
      renderMotionFrame();
      if (elapsed < 1) animationFrame = ownerWindow.requestAnimationFrame(tick);
      else {
        animationFrame = 0;
        onDone?.();
      }
    };
    animationFrame = ownerWindow.requestAnimationFrame(tick);
  }

  function startOpen(index, trigger) {
    if (!currentBooks().length || state.phase !== "overview") return;
    const shouldMoveKeyboardFocus = state.keyboardNavigation;
    resetHoverField();
    state.activeSlot = index;
    state.phase = "opening";
    root.dataset.returnFocusSlot = trigger?.dataset?.slot || "";
    render();
    animateProgress(1, () => {
      state.phase = "detail";
      render();
      if (shouldMoveKeyboardFocus) backButton.focus({ preventScroll: true });
    });
  }

  function closeShelf(pendingShelfId = "") {
    if (state.phase === "overview" || state.phase === "closing") return;
    state.pendingShelfId = normalizeBookMotionShelfId(pendingShelfId) || "";
    state.phase = "closing";
    render();
    animateProgress(0, () => {
      const nextShelfId = state.pendingShelfId;
      state.pendingShelfId = "";
      state.phase = "overview";
      state.activeSlot = 0;
      if (nextShelfId) {
        state.shelfId = nextShelfId;
        options.onStatusChange?.(nextShelfId);
        assignBooks();
      }
      resetHoverField();
      render();
      if (nextShelfId && currentBooks().length) {
        ownerWindow.requestAnimationFrame(() => startOpen(0, statusButtons.get(nextShelfId)));
      } else {
        const returnSlot = Number(root.dataset.returnFocusSlot || 0);
        cards[returnSlot]?.card?.focus?.({ preventScroll: true });
      }
    });
  }

  function selectStatus(shelfId) {
    if (!normalizeBookMotionShelfId(shelfId) || !groups[shelfId]?.length || shelfId === state.shelfId) return;
    if (state.phase !== "overview") {
      closeShelf(shelfId);
      return;
    }
    state.shelfId = shelfId;
    state.activeSlot = 0;
    options.onStatusChange?.(shelfId);
    resetHoverField();
    assignBooks();
    render();
  }

  function selectSlot(index) {
    const physical = activePhysicalSlot();
    state.activeSlot += signedBookMotionSlot(index, physical);
    render();
  }

  function move(direction) {
    if (state.phase !== "detail" || !currentBooks().length) return;
    state.activeSlot += direction;
    render();
  }

  function openHandoff(record, entry) {
    if (!record || state.handoffActive) return;
    if (reducedQuery?.matches) {
      void options.onOpenIntro?.(record);
      return;
    }
    const rectangle = entry.image.getBoundingClientRect();
    const targetHeight = ownerWindow.innerHeight;
    const targetWidth = Math.min(ownerWindow.innerWidth, targetHeight * 1190 / 1540);
    const overlay = makeElement(ownerDocument, "div", "mengcang-motion-handoff");
    const image = makeElement(ownerDocument, "img", "mengcang-motion-handoff__cover");
    image.src = entry.image.src;
    image.alt = "";
    image.style.setProperty("--handoff-start-left", `${rectangle.left}px`);
    image.style.setProperty("--handoff-start-top", `${rectangle.top}px`);
    image.style.setProperty("--handoff-start-width", `${rectangle.width}px`);
    image.style.setProperty("--handoff-start-height", `${rectangle.height}px`);
    image.style.setProperty("--handoff-end-left", `${(ownerWindow.innerWidth - targetWidth) / 2}px`);
    image.style.setProperty("--handoff-end-top", "0px");
    image.style.setProperty("--handoff-end-width", `${targetWidth}px`);
    image.style.setProperty("--handoff-end-height", `${targetHeight}px`);
    overlay.appendChild(image);
    ownerDocument.body.appendChild(overlay);
    handoffOverlay = overlay;
    state.handoffActive = true;
    ownerWindow.requestAnimationFrame(() => overlay.classList.add("is-entering"));
    ownerWindow.setTimeout(() => {
      void Promise.resolve(options.onOpenIntro?.(record)).finally(() => {
        overlay.classList.add("is-releasing");
        ownerWindow.setTimeout(() => overlay.remove(), 480);
      });
    }, 900);
  }

  function handleCardClick(index, event) {
    if (state.suppressClick) {
      state.suppressClick = false;
      event.preventDefault();
      return;
    }
    const entry = cards[index];
    if (!entry.record) return;
    if (state.phase === "overview") {
      startOpen(index, entry.card);
      return;
    }
    if (state.phase !== "detail") {
      if (state.progress > 0.72) selectSlot(index);
      return;
    }
    const relative = signedBookMotionSlot(index, activePhysicalSlot());
    if (relative !== 0) {
      selectSlot(index);
      return;
    }
    if (options.isIntroBook?.(entry.record)) openHandoff(entry.record, entry);
    else void options.onOpenBook?.(entry.record);
  }

  function applyPointerField(pointer) {
    if (!pointer || state.phase !== "overview" || reducedQuery?.matches || (finePointerQuery && !finePointerQuery.matches)) return;
    const stageRectangle = stage.getBoundingClientRect();
    const frame = bookMotionFrame(0, viewportSize());
    const centerX = stageRectangle.left + stageRectangle.width / 2;
    const centerY = stageRectangle.top + stageRectangle.height / 2 + frame.overviewLiftY;
    const influenceRadius = Math.PI * 0.3 * frame.radius;
    let strongest = 0;
    cards.forEach((entry, index) => {
      const theta = (360 / BOOK_MOTION_CARD_COUNT * index + state.idleAngle) * Math.PI / 180;
      const cardX = centerX + Math.sin(theta) * frame.radius;
      const cardY = centerY - Math.cos(theta) * frame.radius;
      const proximity = clamp(1 - Math.hypot(cardX - pointer.clientX, cardY - pointer.clientY) / influenceRadius);
      const strength = easeInOutSine(proximity);
      strongest = Math.max(strongest, strength);
      if (Math.abs(strength - entry.pointerStrength) < 0.002) return;
      entry.pointerStrength = strength;
      const sideLighting = Math.sin(Math.PI * strength);
      const midPerspectiveLift = Math.sin(Math.PI * strength);
      entry.face.style.setProperty("--pointer-depth", `${160 * frame.screenScale * strength}px`);
      entry.face.style.setProperty("--pointer-radial", `${frame.screenScale * (-60 * strength - 30 * midPerspectiveLift)}px`);
      entry.face.style.setProperty("--pointer-turn", `${180 * strength}deg`);
      entry.face.style.setProperty("--pointer-scale", `${1 + 0.14 * strength}`);
      entry.face.style.setProperty("--pointer-light", `${1 - 0.42 * sideLighting}`);
      entry.card.style.zIndex = strength > 0.001 ? String(100 + Math.round(strength * 100)) : "";
    });
    state.hoverPaused = strongest > 0.01;
    scheduleIdle();
  }

  function handlePointerMove(event) {
    if (state.phase !== "overview" || reducedQuery?.matches || (finePointerQuery && !finePointerQuery.matches)) return;
    pendingPointer = { clientX: event.clientX, clientY: event.clientY };
    if (pointerFrame) return;
    pointerFrame = ownerWindow.requestAnimationFrame(() => {
      pointerFrame = 0;
      const pointer = pendingPointer;
      pendingPointer = null;
      applyPointerField(pointer);
    });
  }

  function finishDrag(event, commit) {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.drag = null;
    if (orbit.hasPointerCapture?.(event.pointerId)) orbit.releasePointerCapture(event.pointerId);
    orbit.classList.remove("is-dragging");
    orbit.dataset.dragging = "false";
    state.dragAngle = 0;
    if (!drag.moved) {
      applyOrbitTransform();
      return;
    }
    const slotDelta = commit ? Math.round(-drag.angle / (360 / BOOK_MOTION_CARD_COUNT)) : 0;
    state.suppressClick = true;
    if (slotDelta) state.activeSlot += slotDelta;
    render();
  }

  function handleOrbitPointerDown(event) {
    if (state.phase !== "detail" || state.progress < 0.999 || !event.isPrimary || event.button !== 0) return;
    state.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      angle: 0
    };
  }

  function handleOrbitPointerMove(event) {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(deltaX) < 10 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      drag.moved = true;
      orbit.classList.add("is-dragging");
      orbit.dataset.dragging = "true";
      orbit.setPointerCapture?.(event.pointerId);
    }
    drag.angle = clamp(deltaX / Math.max(1, orbit.getBoundingClientRect().width / 2) * 180 / Math.PI, -75, 75);
    state.dragAngle = drag.angle;
    applyOrbitTransform();
    event.preventDefault();
  }

  function handleWheel(event) {
    if (state.phase === "overview" || Math.abs(event.deltaY) < 4) return;
    event.preventDefault();
    if (state.phase === "detail" && state.progress >= 0.999 && event.deltaY > 0) {
      const now = ownerWindow.performance.now();
      if (now - state.lastWheelAt > 360) {
        state.lastWheelAt = now;
        move(1);
      }
      return;
    }
    if (event.deltaY < 0) closeShelf();
  }

  function handleKeyDown(event) {
    state.keyboardPaused = true;
    state.keyboardNavigation = true;
    updateRootClass();
    if (event.key === "Escape" && state.phase !== "overview") closeShelf();
    if (state.phase === "detail" && event.key === "ArrowLeft") move(-1);
    if (state.phase === "detail" && event.key === "ArrowRight") move(1);
  }

  function handlePointerDown() {
    state.keyboardPaused = false;
    state.keyboardNavigation = false;
    updateRootClass();
    scheduleIdle();
  }

  function scheduleIdle() {
    if (idleFrame || reducedQuery?.matches || ownerDocument.hidden) return;
    lastIdleTime = ownerWindow.performance.now();
    idleFrame = ownerWindow.requestAnimationFrame(tickIdle);
  }

  function tickIdle(now) {
    idleFrame = 0;
    const delta = Math.min(64, Math.max(1, now - lastIdleTime));
    lastIdleTime = now;
    const canRotate = canBookMotionIdleRotate({
      phase: state.phase,
      hoverPaused: state.hoverPaused,
      keyboardPaused: state.keyboardPaused,
      reducedMotion: Boolean(reducedQuery?.matches),
      documentHidden: ownerDocument.hidden
    });
    const damping = 1 - Math.exp(-0.006 * delta);
    const targetVelocity = canRotate ? -360 / BOOK_MOTION_IDLE_LAP_SECONDS : 0;
    state.idleVelocity += (targetVelocity - state.idleVelocity) * damping;
    if (Math.abs(state.idleVelocity) > 0.0001) {
      state.idleAngle = modulo(state.idleAngle + state.idleVelocity * delta / 1000 + 180, 360) - 180;
      applyOrbitTransform();
    }
    if (canRotate || Math.abs(state.idleVelocity) > 0.0001) {
      lastIdleTime = now;
      idleFrame = ownerWindow.requestAnimationFrame(tickIdle);
    }
  }

  for (const [shelfId, button] of statusButtons) {
    const onClick = () => selectStatus(shelfId);
    button.addEventListener("click", onClick);
    cleanupTasks.push(() => button.removeEventListener("click", onClick));
  }
  cards.forEach((entry, index) => {
    const onClick = (event) => handleCardClick(index, event);
    entry.card.addEventListener("click", onClick);
    cleanupTasks.push(() => entry.card.removeEventListener("click", onClick));
  });
  backButton.addEventListener("click", () => closeShelf());
  previousButton.addEventListener("click", () => move(-1));
  nextButton.addEventListener("click", () => move(1));
  stage.addEventListener("pointermove", handlePointerMove, { passive: true });
  stage.addEventListener("pointerleave", resetHoverField);
  root.addEventListener("pointerdown", handlePointerDown);
  orbit.addEventListener("pointerdown", handleOrbitPointerDown);
  orbit.addEventListener("pointermove", handleOrbitPointerMove);
  orbit.addEventListener("pointerup", (event) => finishDrag(event, true));
  orbit.addEventListener("pointercancel", (event) => finishDrag(event, false));
  root.addEventListener("wheel", handleWheel, { passive: false });
  root.addEventListener("keydown", handleKeyDown);
  root.addEventListener("focusout", (event) => {
    if (!event.relatedTarget || !root.contains(event.relatedTarget)) {
      state.keyboardPaused = false;
      scheduleIdle();
    }
  });
  const handleVisibilityChange = () => {
    if (!ownerDocument.hidden) scheduleIdle();
  };
  ownerDocument.addEventListener("visibilitychange", handleVisibilityChange);

  cleanupTasks.push(() => stage.removeEventListener("pointermove", handlePointerMove));
  cleanupTasks.push(() => stage.removeEventListener("pointerleave", resetHoverField));
  cleanupTasks.push(() => root.removeEventListener("pointerdown", handlePointerDown));
  cleanupTasks.push(() => orbit.removeEventListener("pointerdown", handleOrbitPointerDown));
  cleanupTasks.push(() => orbit.removeEventListener("pointermove", handleOrbitPointerMove));
  cleanupTasks.push(() => root.removeEventListener("wheel", handleWheel));
  cleanupTasks.push(() => root.removeEventListener("keydown", handleKeyDown));
  cleanupTasks.push(() => ownerDocument.removeEventListener("visibilitychange", handleVisibilityChange));

  if (ownerWindow.ResizeObserver) {
    resizeObserver = new ownerWindow.ResizeObserver((entries) => {
      updateViewport(entries[0]?.contentRect);
    });
    resizeObserver.observe(root);
  } else {
    const handleResize = () => updateViewport();
    ownerWindow.addEventListener("resize", handleResize);
    cleanupTasks.push(() => ownerWindow.removeEventListener("resize", handleResize));
  }

  updateViewport();
  assignBooks();
  options.onStatusChange?.(state.shelfId);
  render();
  scheduleIdle();

  return () => {
    stopProgressAnimation();
    ownerWindow.cancelAnimationFrame(idleFrame);
    ownerWindow.cancelAnimationFrame(pointerFrame);
    resizeObserver?.disconnect();
    for (const cleanup of cleanupTasks) cleanup();
    if (!state.handoffActive) handoffOverlay?.remove();
    root.remove();
  };
}

module.exports = {
  BOOK_MOTION_CARD_COUNT,
  BOOK_MOTION_IDLE_LAP_SECONDS,
  BOOK_MOTION_OPEN_DURATION_MS,
  BOOK_MOTION_SHELVES,
  bookMotionFrame,
  bookMotionScreenScale,
  canBookMotionIdleRotate,
  groupBookMotionShelves,
  mountBookMotionShelf,
  normalizeBookMotionShelfId,
  signedBookMotionSlot
};
