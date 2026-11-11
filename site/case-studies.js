import { projects } from './case-studies-data.js';
import { GlassWallRenderer } from './case-studies-renderer.js';
import { clamp, unprojectPoint, preserveAnchor, inertiaStep, normalizeWheelDelta, wheelPanTarget, wheelPanStep, cinemaEase, nearestProjectCell } from './case-studies-motion.js';

const canvas = document.querySelector('#project-wall');
const detail = document.querySelector('#project-dialog');
const detailScreen = detail.querySelector('.detail-screen');
const detailChrome = [...detail.querySelectorAll('.detail-toolbar, .detail-caption, .detail-related')];
const detailStatic = document.querySelector('#detail-static');
let detailVideo = document.querySelector('#detail-video');
const videoCache = new Map(), relatedVideoCache = new Map();
const relatedContainer = document.querySelector('#related-projects');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

// Dialog autofocus must not draw a keyboard ring after a pointer click or a deep link.
document.addEventListener('pointerdown', () => {
  document.documentElement.removeAttribute('data-keyboard-focus');
  canvas.setAttribute('data-pointer-focus', '');
}, { capture: true, passive: true });
document.addEventListener('keydown', event => {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  document.documentElement.setAttribute('data-keyboard-focus', '');
  canvas.removeAttribute('data-pointer-focus');
}, { capture: true });

const state = { x: 0, y: 0, vx: 0, vy: 0, dragging: false, hover: null, hoverAmount: 0,
  pointerUv: [.5, .5], pointerAmount: 0, pointerInside: false };
const pointers = new Map();
const noiseBuffers = new WeakMap();
let renderer, width = innerWidth, height = innerHeight, zoom = .75;
let frame = 0, lastTime = 0, snowTime = 0, lastSnowFrame = -1, bootStart = 0;
let fallback = false, fallbackCanvases = [], snowPaused = motionPreference.matches;
let drag, pinch, viewTween, wheelTarget, currentProject, selectedProject, selectedCell, openingRect;
let sceneTween, cinemaAmount = 0, cinemaPose, scenePhase = 'wall';
let closing = false, switching = false, sequenceRun = 0, lastOpener;
const mix = (a, b, t) => a + (b - a) * t;
const ramp = (a, b, value) => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let backdropPointerDown = false;
let relatedCanvases = [], relatedVideos = [];

const entries = () => projects.map(project => ({ ...project }));
const stopMovement = () => { state.vx = state.vy = 0; viewTween = wheelTarget = null; };
const easeOut = value => 1 - Math.pow(1 - value, 3);

function paintStatic(target, seed) {
  let buffer = noiseBuffers.get(target);
  if (!buffer) {
    const context = target.getContext('2d', { alpha: false });
    const pixels = context.createImageData(target.width, target.height);
    buffer = { context, pixels, packed: new Uint32Array(pixels.data.buffer) };
    noiseBuffers.set(target, buffer);
  }
  let random = ((Math.floor(snowTime * 24) + 1) * 7919 + seed * 12347) >>> 0;
  for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const value = Math.round((30 + (random >>> 24) * .64) * (y % 3 === 0 ? .92 : 1));
    buffer.packed[y * target.width + x] = (0xff000000 | (value << 16) | (value << 8) | value) >>> 0;
  }
  buffer.context.putImageData(buffer.pixels, 0, 0);
}

function projectRect(cell) {
  if (!renderer || !cell) return null;
  const { cardWidth, cardHeight, gap } = renderer.layout;
  const cx = (cell[0] + .5) * (cardWidth + gap) - state.x;
  const cy = (cell[1] + .5) * (cardHeight + gap) - state.y;
  const grow = 1 + .04 * (renderer.hoverSlots.find(slot => slot.x === cell[0] && slot.y === cell[1])?.amount || 0);
  const corners = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]].map(([x,y]) =>
    unprojectPoint(cx + x * cardWidth * grow / 2, cy + y * cardHeight * grow / 2, width, height));
  const left = Math.min(...corners.map(point => point[0]));
  const top = Math.min(...corners.map(point => point[1]));
  return { left, top, width: Math.max(...corners.map(point => point[0])) - left,
    height: Math.max(...corners.map(point => point[1])) - top };
}

function setScenePhase(phase) {
  scenePhase = phase;
  canvas.dataset.transition = detail.dataset.transition = phase;
}

function finishSceneTransition() {
  if (!sceneTween) return;
  const tween = sceneTween; sceneTween = null;
  tween.update(1); tween.resolve(true);
}

function runSceneTransition(duration, update, easing = cinemaEase) {
  if (sceneTween) { sceneTween.resolve(false); sceneTween = null; }
  if (motionPreference.matches || !duration) { update(1); return Promise.resolve(true); }
  update(0);
  return new Promise(resolve => {
    sceneTween = { start: performance.now(), duration, update, easing, resolve };
    ensureFrame();
  });
}

function advanceScene(time) {
  if (!sceneTween) return;
  const tween = sceneTween;
  const progress = clamp((time - tween.start) / tween.duration, 0, 1);
  tween.update(tween.easing(progress));
  if (progress === 1) { sceneTween = null; tween.resolve(true); }
}

function clearScreenPose() {
  detailScreen.style.removeProperty('transform');
  detailScreen.style.removeProperty('border-radius');
  detailScreen.querySelector('.detail-screen-surface').style.removeProperty('border-radius');
}

function prepareCinemaPose() {
  clearScreenPose();
  const destination = detailScreen.getBoundingClientRect();
  cinemaPose = {
    destination, source: openingRect || { left: width / 2 - 80, top: height / 2 - 50, width: 160, height: 100 },
    radius: parseFloat(getComputedStyle(detailScreen).borderTopLeftRadius),
    surfaceRadius: parseFloat(getComputedStyle(detailScreen.querySelector('.detail-screen-surface')).borderTopLeftRadius),
    hover: cinemaPose?.hover ?? (renderer?.hoverSlots.find(slot => slot.x === selectedCell?.[0] && slot.y === selectedCell?.[1])?.amount || 0),
  };
}

function paintCinema(amount) {
  cinemaAmount = amount;
  const { source, destination, radius, surfaceRadius } = cinemaPose;
  const w = mix(source.width, destination.width, amount), h = mix(source.height, destination.height, amount);
  const sx = w / destination.width, sy = h / destination.height;
  const x = (source.left + source.width / 2 - destination.left - destination.width / 2) * (1 - amount);
  const y = (source.top + source.height / 2 - destination.top - destination.height / 2) * (1 - amount);
  const round = mix(source.width * .15, radius, amount);
  detailScreen.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + sx + ',' + sy + ')';
  detailScreen.style.borderRadius = (round / sx) + 'px / ' + (round / sy) + 'px';
  const inner = mix(source.width * .14, surfaceRadius, amount);
  detailScreen.querySelector('.detail-screen-surface').style.borderRadius = (inner / sx) + 'px / ' + (inner / sy) + 'px';
  const shade = ramp(.05, .92, amount);
  detail.style.backgroundColor = fallback ? 'rgba(0,0,0,' + shade + ')' : 'transparent';
  document.body.style.setProperty('--cinema-shade', shade);
  cinemaPose.rect = { left: mix(source.left, destination.left, amount), top: mix(source.top, destination.top, amount), width: w, height: h };
  const chrome = ramp(.78, 1, amount);
  for (const element of detailChrome) {
    element.style.opacity = chrome;
    element.style.transform = 'translateY(' + (1 - chrome) * 10 + 'px)';
    element.style.pointerEvents = chrome > .9 ? '' : 'none';
  }
  detail.dataset.progress = amount.toFixed(3);
}

async function animateProjectIn() {
  prepareCinemaPose();
  detailVideo.controls = false;
  setScenePhase('opening');
  const complete = await runSceneTransition(1120, paintCinema);
  if (!complete || closing) return;
  clearScreenPose();
  for (const element of detailChrome) {
    element.style.removeProperty('transform');
    element.style.removeProperty('opacity');
    element.style.removeProperty('pointer-events');
  }
  setScenePhase('open');
}

function nearestCell(project) {
  if (!renderer) return null;
  const { cardWidth, cardHeight, gap } = renderer.layout;
  const pitch = [cardWidth + gap, cardHeight + gap];
  return nearestProjectCell(renderer.cells, 18, 12, projects.indexOf(project),
    [(state.x + width / 2) / pitch[0], (state.y + height / 2) / pitch[1]], pitch);
}

function centeredPan(cell) {
  const { cardWidth, cardHeight, gap } = renderer.layout;
  return { x: (cell[0] + .5) * (cardWidth + gap) - width / 2,
    y: (cell[1] + .5) * (cardHeight + gap) - height / 2 };
}

async function switchProject(project) {
  if (switching || closing || selectedProject === project) return;
  switching = true;
  const run = ++sequenceRun;
  await closeProject(true);
  if (run !== sequenceRun) { switching = false; return; }
  const cell = nearestCell(project);
  if (cell && !motionPreference.matches) {
    setScenePhase('travelling');
    const from = { x: state.x, y: state.y }, to = centeredPan(cell);
    state.hover = { cell }; state.hoverAmount = 0;
    await runSceneTransition(720, t => {
      state.x = mix(from.x, to.x, t); state.y = mix(from.y, to.y, t);
    });
  }
  switching = false;
  if (run === sequenceRun) openProject(project, cell);
}

function wallVideo(project) {
  return renderer?.videoItems.find(item => renderer.entries[item.index]?.id === project?.id)?.video;
}

function presentVideo(project) {
  if (detailVideo.dataset.presentation === 'detail') {
    delete detailVideo.dataset.presentation;
    detailVideo.controls = false;
  }
  detailVideo.hidden = true;
  if (!project.video) return;
  let video = wallVideo(project) || videoCache.get(project.id);
  if (!video) {
    video = document.createElement('video');
    video.src = project.video; video.preload = 'auto';
    videoCache.set(project.id, video);
  }
  videoCache.set(project.id, video);
  if (video !== detailVideo) {
    detailVideo.removeAttribute('id');
    detailVideo.replaceWith(video);
    detailVideo = video;
  }
  detailVideo.id = 'detail-video';
  detailVideo.dataset.presentation = 'detail';
  detailVideo.hidden = false;
  detailVideo.muted = true; detailVideo.loop = true; detailVideo.playsInline = true;
  detailVideo.setAttribute('aria-label', project.title + ' video');
  if (!motionPreference.matches) detailVideo.play().catch(() => {});
}

function openProject(project, cell = null, rect = null) {
  if (!project || closing || switching) return;
  if (detail.open) { switchProject(project); return; }
  lastOpener = document.activeElement;
  stopMovement();
  selectedProject = project;
  cinemaPose = null;
  selectedCell = cell || nearestCell(project);
  if (!cell && selectedCell) Object.assign(state, centeredPan(selectedCell));
  openingRect = rect || projectRect(selectedCell);
  closing = false;
  detail.classList.remove('is-closing');
  document.body.classList.add('project-open');
  detailScreen.setAttribute('role', 'img');
  detailScreen.setAttribute('aria-label', project.title + ' animated cover');
  detailScreen.querySelector('.detail-screen-surface').hidden = !fallback;
  detail.classList.toggle('has-video', Boolean(fallback && project.video));
  if (fallback) presentVideo(project);
  document.querySelector('#detail-title').textContent = project.title;
  document.querySelector('#detail-description').textContent = project.subtitle || '';
  document.querySelector('#detail-mark').textContent = String(project.seed).padStart(2, '0');
  const image = document.querySelector('#detail-image');
  image.hidden = true;
  image.onload = () => { if (selectedProject === project) image.hidden = false; };
  image.onerror = () => { image.hidden = true; lastSnowFrame = -1; };
  if (fallback && project.image) { image.src = project.image; image.alt = project.title; }
  else image.removeAttribute('src');
  detailStatic.width = 384; detailStatic.height = 240;
  noiseBuffers.delete(detailStatic); paintStatic(detailStatic, project.seed); lastSnowFrame = -1;
  document.querySelector('#cover-title').textContent = project.title;
  document.querySelector('#cover-subtitle').textContent = project.subtitle || '';
  renderRelatedProjects(project);
  detail.showModal(); detail.scrollTop = 0;
  history.replaceState(null, '', location.pathname + location.search + '#' + project.id);
  document.querySelector('#close-project').focus({ preventScroll: true });
  animateProjectIn();
}

async function closeProject(keepSequence = false) {
  if (keepSequence !== true) { ++sequenceRun; switching = false; }
  if (!detail.open || closing) return;
  closing = true;
  detailVideo.controls = false;
  detail.classList.add('is-closing');
  setScenePhase('closing');
  const from = cinemaAmount;
  await runSceneTransition(960 * Math.max(.25, from), t => paintCinema(from * (1 - t)),
    t => 1 - cinemaEase(1 - t));
  detail.close();
  document.body.classList.remove('project-open');
  document.body.style.removeProperty('--cinema-shade');
  if (renderer && selectedCell && cinemaPose) {
    const slot = renderer.hoverSlots.find(item => item.x === selectedCell[0] && item.y === selectedCell[1]);
    if (slot) { slot.amount = cinemaPose.hover; slot.velocity = 0; }
  }
  clearScreenPose();
  if (detailVideo.dataset.presentation === 'detail') {
    delete detailVideo.dataset.presentation;
    // Keep this exact decoder and playback position for its next appearance.
    detailVideo.hidden = true;
    if (!motionPreference.matches && !document.hidden) detailVideo.play().catch(() => {});
  }
  closing = false; selectedProject = null; selectedCell = null; cinemaAmount = 0;
  detail.classList.remove('has-video', 'is-closing');
  clearRelatedProjects();
  setScenePhase('wall');
  if (keepSequence !== true || !switching) {
    if (projects.some(project => location.hash === '#' + project.id)) history.replaceState(null, '', location.pathname + location.search);
    if (fallback && lastOpener?.isConnected && lastOpener.closest('#project-fallback')) lastOpener.focus();
    else if (fallback) document.querySelector('.home-link').focus();
    else canvas.focus({ preventScroll: true });
  } else if (!fallback) canvas.focus({ preventScroll: true });
}
document.querySelector('#close-project').addEventListener('click', () => closeProject());

function clearRelatedProjects() {
  for (const video of relatedVideos) video.pause();
  relatedVideos = []; relatedCanvases = [];
  relatedContainer.replaceChildren();
}

function renderRelatedProjects(project) {
  clearRelatedProjects();
  const start = projects.indexOf(project);
  const related = Array.from({ length: projects.length - 1 }, (_, i) => projects[(start + i + 1) % projects.length])
    .sort((a, b) => Number(Boolean(b.video || b.image)) - Number(Boolean(a.video || a.image)))
    .slice(0, 3);
  for (const next of related) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'related-card';
    button.setAttribute('aria-label', `Open ${next.title}`);
    const noise = document.createElement('canvas');
    noise.width = 256; noise.height = 160; noise.setAttribute('aria-hidden', 'true');
    button.append(noise); paintStatic(noise, next.seed);
    relatedCanvases.push({ canvas: noise, seed: next.seed });
    if (next.video) {
      let video = relatedVideoCache.get(next.id);
      if (!video) { video = document.createElement('video'); video.src = next.video; relatedVideoCache.set(next.id, video); }
      video.muted = true; video.defaultMuted = true;
      video.loop = true; video.playsInline = true; video.preload = 'auto';
      video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
      button.append(video); relatedVideos.push(video);
      if (!motionPreference.matches && !document.hidden) video.play().catch(() => {});
    } else if (next.image) {
      const image = document.createElement('img'); image.src = next.image; image.alt = '';
      image.onerror = () => image.remove(); button.append(image);
    }
    const caption = document.createElement('span'); caption.className = 'related-caption';
    const title = document.createElement('strong'); title.textContent = next.title;
    const subtitle = document.createElement('span'); subtitle.textContent = next.subtitle || '';
    caption.append(title, subtitle);
    const reflection = document.createElement('span'); reflection.className = 'related-reflection';
    reflection.textContent = next.subtitle || ''; reflection.setAttribute('aria-hidden', 'true');
    button.append(caption, reflection);
    button.addEventListener('click', () => openProject(next));
    relatedContainer.append(button);
  }
}
detail.addEventListener('cancel', event => { event.preventDefault(); closeProject(); });
const isProjectBackdrop = target => target instanceof Element
  && !target.closest('.detail-screen, .detail-caption, .detail-toolbar, .detail-related');
detail.addEventListener('pointerdown', event => {
  backdropPointerDown = event.button === 0 && isProjectBackdrop(event.target);
});
detail.addEventListener('pointercancel', () => { backdropPointerDown = false; });
detail.addEventListener('click', event => {
  if (backdropPointerDown && isProjectBackdrop(event.target)) closeProject();
  backdropPointerDown = false;
});

function enableFallback() {
  if (fallback) return;
  fallback = true;
  stopMovement();
  renderer?.destroy();
  renderer = null;
  canvas.tabIndex = -1;
  const container = document.querySelector('#project-fallback');
  container.hidden = false;
  for (const project of projects) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'fallback-card';
    const noise = document.createElement('canvas'); noise.width = 190; noise.height = 120; noise.setAttribute('aria-hidden','true');
    const title = document.createElement('strong'); title.textContent = project.title;
    const subtitle = document.createElement('span'); subtitle.textContent = project.subtitle;
    button.append(noise);
    if (project.image) {
      const image = document.createElement('img'); image.src = project.image; image.alt = ''; image.loading = 'lazy';
      image.onerror = () => image.remove(); button.append(image);
    } else if (project.video) {
      const preview = document.createElement('video');
      preview.src = project.video; preview.muted = true; preview.playsInline = true;
      preview.preload = 'auto'; preview.tabIndex = -1; preview.setAttribute('aria-hidden', 'true');
      button.append(preview);
    }
    button.append(title, subtitle);
    button.addEventListener('click', () => openProject(project, null, button.getBoundingClientRect()));
    container.append(button);
    fallbackCanvases.push({ canvas: noise, seed: project.seed });
    paintStatic(noise, project.seed);
  }
  canvas.dataset.renderer = 'accessible-grid';
  document.body.classList.add('ready','fallback-mode');
  if (detail.open && selectedProject) {
    detailScreen.querySelector('.detail-screen-surface').hidden = false;
    detail.classList.toggle('has-video', Boolean(selectedProject.video));
    presentVideo(selectedProject);
    if (selectedProject.image) document.querySelector('#detail-image').src = selectedProject.image;
    paintCinema(cinemaAmount);
  }
  ensureFrame();
}

function resetView(immediate = false) {
  if (!renderer) { window.scrollTo({ top: 0 }); return; }
  const { cardWidth, cardHeight, gap } = renderer.layout;
  const target = { x: (cardWidth + gap) / 2 - width / 2, y: (cardHeight + gap) / 2 - height / 2 };
  stopMovement(); state.hover = null; state.hoverAmount = 0;
  if (immediate || motionPreference.matches) Object.assign(state, target);
  else viewTween = { start: performance.now(), from: { x: state.x, y: state.y }, to: target };
}
function resize() {
  if (scenePhase === 'travelling') finishSceneTransition();
  const previous = renderer?.layout;
  const oldWidth = width, oldHeight = height;
  width = innerWidth; height = innerHeight;
  if (renderer && !fallback) {
    const gridX = previous ? (oldWidth / 2 + state.x) / (previous.cardWidth + previous.gap) : .5;
    const gridY = previous ? (oldHeight / 2 + state.y) / (previous.cardHeight + previous.gap) : .5;
    renderer.resize(width,height,Math.min(devicePixelRatio || 1,1.5,Math.sqrt(2200000 / (width * height))),zoom);
    const next = renderer.layout;
    state.x = gridX * (next.cardWidth + next.gap) - width / 2;
    state.y = gridY * (next.cardHeight + next.gap) - height / 2;
    stopMovement();
    state.hover = null;
  }
  if (detail.open) {
    finishSceneTransition();
    if (selectedCell) openingRect = projectRect(selectedCell);
    prepareCinemaPose();
    if (!closing) { paintCinema(1); clearScreenPose(); }
  }
}
function changeZoom(nextZoom, anchor = [width / 2,height / 2]) {
  if (!renderer || fallback) return;
  const previous = renderer.layout;
  zoom = clamp(nextZoom,.28,1.8);
  renderer.resize(width,height,previous.dpr,zoom);
  Object.assign(state,preserveAnchor({ x: state.x,y: state.y },anchor,{ width,height },previous,renderer.layout));
  stopMovement(); state.hover = null;
  canvas.dataset.zoom = zoom.toFixed(3);
}

function updateHover(x,y) {
  if (!renderer || state.dragging) return;
  const card = renderer.pick(x,y,[state.x,state.y]);
  state.hover = card?.inside ? card : null;
}
canvas.addEventListener('wheel', event => {
  if (!renderer || fallback || detail.open || switching || state.dragging || pinch) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) { changeZoom(zoom * Math.exp(-event.deltaY * .004),[event.clientX,event.clientY]); return; }
  const delta = normalizeWheelDelta(event, height);
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || (!delta.x && !delta.y)) return;
  viewTween = null;
  state.vx = state.vy = 0;
  wheelTarget = wheelPanTarget(state, wheelTarget || state, delta);
  state.hover = null;
}, { passive: false });

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || fallback || !renderer || switching) return;
  canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId,{ x: event.clientX,y: event.clientY }); stopMovement();
  if (pointers.size > 1) {
    const [a,b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x-b.x,a.y-b.y) };
    drag = null; state.dragging = false; return;
  }
  state.dragging = true; canvas.classList.add('dragging');
  drag = { id: event.pointerId,x: event.clientX,y: event.clientY,startX: event.clientX,startY: event.clientY,distance: 0,time: performance.now() };
});
canvas.addEventListener('pointermove', event => {
  state.pointerUv = [event.clientX / width,event.clientY / height]; state.pointerInside = true;
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId,{ x: event.clientX,y: event.clientY });
  if (pointers.size > 1 && pinch) {
    const [a,b] = [...pointers.values()];
    const distance = Math.hypot(a.x-b.x,a.y-b.y);
    if (pinch.distance > 0) changeZoom(zoom * distance / pinch.distance,[(a.x+b.x)/2,(a.y+b.y)/2]);
    pinch.distance = distance; return;
  }
  if (state.dragging && drag?.id === event.pointerId) {
    const now = performance.now(), elapsed = Math.max(8,now-drag.time) / (1000/60);
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    state.x -= dx; state.y -= dy; state.vx = clamp(-dx/elapsed,-80,80); state.vy = clamp(-dy/elapsed,-80,80);
    drag.x = event.clientX; drag.y = event.clientY; drag.time = now;
    drag.distance = Math.max(drag.distance,Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY));
  } else updateHover(event.clientX,event.clientY);
});
function endPointer(event,cancelled = false) {
  pointers.delete(event.pointerId);
  if (pinch) {
    if (pointers.size === 1) {
      const [[id,point]] = [...pointers];
      drag = { id,...point,startX: point.x,startY: point.y,distance: Infinity,time: performance.now() };
      state.dragging = true;
    } else { drag = null; state.dragging = false; canvas.classList.remove('dragging'); }
    pinch = null;
  } else if (drag?.id === event.pointerId) {
    const ended = drag; drag = null; state.dragging = false; canvas.classList.remove('dragging');
    if (performance.now()-ended.time > 100 || cancelled) stopMovement();
    if (!cancelled && ended.distance <= 6 && renderer) {
      const card = renderer.pick(event.clientX,event.clientY,[state.x,state.y]);
      if (card?.inside) openProject(projects[card.index],card.cell);
    }
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup', event => endPointer(event));
canvas.addEventListener('pointercancel', event => endPointer(event,true));
canvas.addEventListener('lostpointercapture', event => { if (pointers.has(event.pointerId)) endPointer(event,true); });
canvas.addEventListener('pointerleave', () => { if (!state.dragging) state.hover = null; state.pointerInside = false; });
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape' && switching && !detail.open) {
    ++sequenceRun; switching = false;
    if (sceneTween) { sceneTween.resolve(false); sceneTween = null; }
    setScenePhase('wall');
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  if (detail.open || switching) return;
  const direction = { ArrowDown: [0,22],ArrowUp: [0,-22],ArrowLeft: [-22,0],ArrowRight: [22,0] }[event.key];
  if (direction) { event.preventDefault(); viewTween = wheelTarget = null; state.vx += direction[0]; state.vy += direction[1]; }
  else if (event.key === 'Enter' && currentProject) { event.preventDefault(); const card = renderer?.pick(width/2,height/2,[state.x,state.y]); openProject(currentProject,card?.cell); }
  else if (event.key === 'Home') { event.preventDefault(); resetView(); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoom*1.12); }
  else if (event.key === '-') { event.preventDefault(); changeZoom(zoom/1.12); }
});

function ensureFrame() { if (!frame && !document.hidden) frame = requestAnimationFrame(render); }
function render(time) {
  frame = 0;
  if (document.hidden) return;
  advanceScene(time);
  const elapsed = clamp(time-(lastTime || time),0,64); lastTime = time;
  if (!snowPaused) snowTime += elapsed/1000;
  const snowFrame = Math.floor(snowTime*24);
  if (snowFrame !== lastSnowFrame) {
    if (fallback && detail.open && selectedProject && !selectedProject.video && document.querySelector('#detail-image').hidden) paintStatic(detailStatic,selectedProject.seed);
    if (detail.open) for (const item of relatedCanvases) paintStatic(item.canvas,item.seed);
    if (fallback) for (const item of fallbackCanvases) paintStatic(item.canvas,item.seed);
    lastSnowFrame = snowFrame;
  }
  if (renderer && !fallback) {
    if (viewTween) {
      const t = clamp((time-viewTween.start)/650,0,1), eased = easeOut(t);
      state.x = viewTween.from.x+(viewTween.to.x-viewTween.from.x)*eased;
      state.y = viewTween.from.y+(viewTween.to.y-viewTween.from.y)*eased;
      if (t === 1) viewTween = null;
    } else if (!state.dragging && !pinch && !detail.open && !switching) {
      if (wheelTarget) {
        const step = wheelPanStep(state, wheelTarget, elapsed);
        state.x = step.x; state.y = step.y;
        if (step.settled) wheelTarget = null;
      } else {
        const step = inertiaStep(state.vx,state.vy,elapsed);
        state.x += step.dx; state.y += step.dy; state.vx = step.vx; state.vy = step.vy;
      }
    }
    // Keep the infinite map numerically close to its origin after long explorations.
    if (!state.dragging && !detail.open && !switching && !viewTween) {
      const layout = renderer.layout;
      const periodX = (layout.cardWidth+layout.gap)*18, periodY = (layout.cardHeight+layout.gap)*12;
      if (Math.abs(state.x) > periodX*4) {
        const wrapped = state.x % periodX;
        if (wheelTarget) wheelTarget.x += wrapped - state.x;
        state.x = wrapped; state.hover = null;
      }
      if (Math.abs(state.y) > periodY*4) {
        const wrapped = state.y % periodY;
        if (wheelTarget) wheelTarget.y += wrapped - state.y;
        state.y = wrapped; state.hover = null;
      }
    }
    state.hoverAmount += ((state.hover && !state.dragging ? 1 : 0)-state.hoverAmount)*(1-Math.exp(-elapsed/75));
    state.pointerAmount += ((state.pointerInside ? 1 : 0)-state.pointerAmount)*(1-Math.exp(-elapsed/100));
    try {
      renderer.draw({ pan: [state.x,state.y],time: snowTime,hover: { x: state.hover?.cell[0] ?? -9999,y: state.hover?.cell[1] ?? -9999,amount: state.hoverAmount },
        pointer: state.pointerUv,pointAmount: state.pointerAmount,intro: (time-bootStart)/1000,
        videosPlaying: !snowPaused,
        cameraScale: 1 + .12 * cinemaAmount,
        liftedCell: detail.open ? selectedCell : null,
        cover: detail.open && cinemaPose ? { rect: cinemaPose.rect, source: cinemaPose.source,
          amount: cinemaAmount, hover: cinemaPose.hover, radius: cinemaPose.radius / cinemaPose.destination.width } : null });
      const centered = renderer.pick(width/2,height/2,[state.x,state.y]);
      const project = centered && projects[centered.index];
      if (project && project !== currentProject) {
        currentProject = project; canvas.dataset.currentProject = project.id;
        document.querySelector('#project-readout').textContent = `${project.title}. ${project.subtitle}.`;
      }
    } catch { enableFallback(); }
  }
  ensureFrame();
}
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); enableFallback(); });
addEventListener('resize',resize,{ passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; stopMovement(); renderer?.pauseVideos(); detailVideo.pause(); for (const video of relatedVideos) video.pause(); }
  else { lastTime = 0; ensureFrame(); if (detail.open && !motionPreference.matches) { if (selectedProject?.video) detailVideo.play().catch(() => {}); for (const video of relatedVideos) video.play().catch(() => {}); } }
});
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) {
    finishSceneTransition();
    if (!closing) { clearScreenPose(); }
    snowPaused = true; detailVideo.pause(); for (const video of relatedVideos) video.pause(); enableFallback();
  }
});

async function start() {
  if (motionPreference.matches) { enableFallback(); return; }
  try {
    await Promise.race([document.fonts.load('700 32px "Neue Montreal"'),new Promise(resolve => setTimeout(resolve,1600))]);
    renderer = new GlassWallRenderer(canvas,entries());
    resize(); resetView(true);
    bootStart = performance.now();
    canvas.dataset.renderer = 'webgl2-glass'; canvas.dataset.zoom = String(zoom);
    document.body.classList.add('ready'); ensureFrame();
  } catch (error) { console.warn('Using the accessible case studies grid.',error.message); enableFallback(); }
}
start().then(() => {
  const linkedProject = projects.find(project => `#${project.id}` === location.hash);
  if (linkedProject) openProject(linkedProject);
});
