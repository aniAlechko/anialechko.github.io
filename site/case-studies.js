import { projects } from './case-studies-data.js';
import { GlassWallRenderer } from './case-studies-renderer.js';
import { clamp, unprojectPoint, preserveAnchor, inertiaStep } from './case-studies-motion.js';

const canvas = document.querySelector('#project-wall');
const detail = document.querySelector('#project-dialog');
const panel = detail.querySelector('.detail-panel');
const detailStatic = document.querySelector('#detail-static');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

// Returning focus from a project preview should respect the latest input too.
document.addEventListener('pointerdown', () => canvas.setAttribute('data-pointer-focus', ''), { capture: true, passive: true });
document.addEventListener('keydown', () => canvas.removeAttribute('data-pointer-focus'), { capture: true });

const state = { x: 0, y: 0, vx: 0, vy: 0, dragging: false, hover: null, hoverAmount: 0,
  pointerUv: [.5, .5], pointerAmount: 0, pointerInside: false, lastWheel: 0 };
const pointers = new Map();
const noiseBuffers = new WeakMap();
let renderer, width = innerWidth, height = innerHeight, zoom = .75;
let frame = 0, lastTime = 0, snowTime = 0, lastSnowFrame = -1, bootStart = 0;
let fallback = false, fallbackCanvases = [], snowPaused = motionPreference.matches;
let drag, pinch, viewTween, currentProject, selectedProject, selectedCell, openingRect;
let panelAnimation, closing = false, lastOpener;

const entries = () => projects.map(project => ({ ...project }));
const stopMovement = () => { state.vx = state.vy = 0; viewTween = null; };
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
  const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) =>
    unprojectPoint(cx + x * cardWidth / 2, cy + y * cardHeight / 2, width, height));
  const left = Math.min(...corners.map(point => point[0]));
  const top = Math.min(...corners.map(point => point[1]));
  return { left, top, width: Math.max(...corners.map(point => point[0])) - left,
    height: Math.max(...corners.map(point => point[1])) - top };
}

function originTransform(rect) {
  const destination = detail.getBoundingClientRect();
  if (!rect || !destination.width || !destination.height) return 'translate(0, 28px) scale(.94)';
  const x = rect.left + rect.width / 2 - destination.left - destination.width / 2;
  const y = rect.top + rect.height / 2 - destination.top - destination.height / 2;
  return `translate(${x}px, ${y}px) scale(${rect.width / destination.width}, ${rect.height / destination.height})`;
}

function openProject(project, cell = null, rect = null) {
  if (!project || detail.open) return;
  lastOpener = document.activeElement;
  stopMovement();
  selectedProject = project;
  selectedCell = cell;
  openingRect = rect || projectRect(cell);
  closing = false;
  detail.classList.remove('is-closing');
  document.querySelector('#detail-title').textContent = project.title;
  document.querySelector('#detail-description').textContent = project.description || project.subtitle || '';
  const image = document.querySelector('#detail-image');
  image.hidden = true;
  image.onload = () => { if (selectedProject === project) image.hidden = false; };
  image.onerror = () => { image.hidden = true; lastSnowFrame = -1; };
  if (project.image) { image.src = project.image; image.alt = project.title; }
  else image.removeAttribute('src');
  const link = document.querySelector('#detail-link');
  link.hidden = !project.url;
  if (project.url) link.href = project.url;
  detailStatic.width = 384;
  detailStatic.height = 240;
  noiseBuffers.delete(detailStatic);
  paintStatic(detailStatic, project.seed);
  lastSnowFrame = -1;
  detail.showModal();
  if (!motionPreference.matches) {
    panelAnimation?.cancel();
    panelAnimation = panel.animate([
      { transform: originTransform(openingRect), borderRadius: '48px', opacity: .65 },
      { transform: 'translate(0, 0) scale(1)', borderRadius: '26px', opacity: 1 },
    ], { duration: 1050, easing: 'cubic-bezier(.5,0,.12,1)', fill: 'both' });
  }
}

async function closeProject() {
  if (!detail.open || closing) return;
  closing = true;
  detail.classList.add('is-closing');
  if (!motionPreference.matches) {
    const start = getComputedStyle(panel).transform;
    panelAnimation?.cancel();
    panelAnimation = panel.animate([
      { transform: start, opacity: 1, borderRadius: '26px' },
      { transform: originTransform(projectRect(selectedCell) || openingRect), opacity: 0, borderRadius: '48px' },
    ], { duration: 800, easing: 'cubic-bezier(.5,0,.12,1)', fill: 'both' });
    await panelAnimation.finished.catch(() => {});
  }
  detail.close();
  panelAnimation?.cancel();
  closing = false;
  selectedProject = null;
  detail.classList.remove('is-closing');
  if (fallback && lastOpener?.isConnected && lastOpener.closest('#project-fallback')) lastOpener.focus();
  else if (fallback) document.querySelector('.home-link').focus();
  else canvas.focus({ preventScroll: true });
}
document.querySelector('#close-project').addEventListener('click', closeProject);
detail.addEventListener('cancel', event => { event.preventDefault(); closeProject(); });
detail.addEventListener('click', event => {
  if (event.target !== detail) return;
  const rect = detail.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeProject();
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
    }
    button.append(title, subtitle);
    button.addEventListener('click', () => openProject(project, null, button.getBoundingClientRect()));
    container.append(button);
    fallbackCanvases.push({ canvas: noise, seed: project.seed });
    paintStatic(noise, project.seed);
  }
  canvas.dataset.renderer = 'accessible-grid';
  document.body.classList.add('ready','fallback-mode');
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
  if (detail.open) { panelAnimation?.cancel(); openingRect = projectRect(selectedCell); }
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
  if (!renderer || fallback || detail.open) return;
  event.preventDefault(); viewTween = null;
  if (event.ctrlKey || event.metaKey) { changeZoom(zoom * Math.exp(-event.deltaY * .004),[event.clientX,event.clientY]); return; }
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
  const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
  state.x += dx; state.y += dy; state.vx = dx * .22; state.vy = dy * .22;
  state.lastWheel = performance.now(); state.hover = null;
}, { passive: false });

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || fallback || !renderer) return;
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
  if (detail.open) return;
  const direction = { ArrowDown: [0,22],ArrowUp: [0,-22],ArrowLeft: [-22,0],ArrowRight: [22,0] }[event.key];
  if (direction) { event.preventDefault(); viewTween = null; state.vx += direction[0]; state.vy += direction[1]; state.lastWheel = 0; }
  else if (event.key === 'Enter' && currentProject) { event.preventDefault(); const card = renderer?.pick(width/2,height/2,[state.x,state.y]); openProject(currentProject,card?.cell); }
  else if (event.key === 'Home') { event.preventDefault(); resetView(); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoom*1.12); }
  else if (event.key === '-') { event.preventDefault(); changeZoom(zoom/1.12); }
});

function ensureFrame() { if (!frame && !document.hidden) frame = requestAnimationFrame(render); }
function render(time) {
  frame = 0;
  if (document.hidden) return;
  const elapsed = clamp(time-(lastTime || time),0,64); lastTime = time;
  if (!snowPaused) snowTime += elapsed/1000;
  const snowFrame = Math.floor(snowTime*24);
  if (snowFrame !== lastSnowFrame) {
    if (detail.open && selectedProject && document.querySelector('#detail-image').hidden) paintStatic(detailStatic,selectedProject.seed);
    if (fallback) for (const item of fallbackCanvases) paintStatic(item.canvas,item.seed);
    lastSnowFrame = snowFrame;
  }
  if (renderer && !fallback) {
    if (viewTween) {
      const t = clamp((time-viewTween.start)/650,0,1), eased = easeOut(t);
      state.x = viewTween.from.x+(viewTween.to.x-viewTween.from.x)*eased;
      state.y = viewTween.from.y+(viewTween.to.y-viewTween.from.y)*eased;
      if (t === 1) viewTween = null;
    } else if (!state.dragging && !pinch && !detail.open && time-state.lastWheel > 90) {
      const step = inertiaStep(state.vx,state.vy,elapsed);
      state.x += step.dx; state.y += step.dy; state.vx = step.vx; state.vy = step.vy;
    }
    // Keep the infinite map numerically close to its origin after long explorations.
    if (!state.dragging && !detail.open && !viewTween) {
      const layout = renderer.layout;
      const periodX = (layout.cardWidth+layout.gap)*18, periodY = (layout.cardHeight+layout.gap)*12;
      if (Math.abs(state.x) > periodX*4) { state.x %= periodX; state.hover = null; }
      if (Math.abs(state.y) > periodY*4) { state.y %= periodY; state.hover = null; }
    }
    state.hoverAmount += ((state.hover && !state.dragging ? 1 : 0)-state.hoverAmount)*(1-Math.exp(-elapsed/75));
    state.pointerAmount += ((state.pointerInside ? 1 : 0)-state.pointerAmount)*(1-Math.exp(-elapsed/100));
    try {
      renderer.draw({ pan: [state.x,state.y],time: snowTime,hover: { x: state.hover?.cell[0] ?? -9999,y: state.hover?.cell[1] ?? -9999,amount: state.hoverAmount },
        pointer: state.pointerUv,pointAmount: state.pointerAmount,intro: (time-bootStart)/1000 });
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
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; stopMovement(); }
  else { lastTime = 0; ensureFrame(); }
});
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) { snowPaused = true; enableFallback(); }
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
start();
