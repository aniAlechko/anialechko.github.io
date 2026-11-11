const WALL_CURVE = .22;
const FRAME_MS = 1000 / 60;
const FRICTION = .94;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// The cinema lift starts gently, accelerates, then settles over a long tail.
// Use one clock for the lifted screen, wall camera and surrounding controls.
export function cinemaEase(progress) {
  const t = clamp(progress, 0, 1);
  if (t === 0 || t === 1) return t;
  const bezier = (v, a, b) => 3 * (1 - v) ** 2 * v * a + 3 * (1 - v) * v * v * b + v ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (bezier(middle, .32, .18) < t) low = middle; else high = middle;
  }
  return bezier((low + high) / 2, 0, 1);
}

export function nearestProjectCell(cells, columns, rows, index, center, pitch) {
  let closest = null, distance = Infinity;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    if (cells[row * columns + column] !== index) continue;
    const x = column + Math.round((center[0] - column - .5) / columns) * columns;
    const y = row + Math.round((center[1] - row - .5) / rows) * rows;
    const squared = ((x + .5 - center[0]) * pitch[0]) ** 2 + ((y + .5 - center[1]) * pitch[1]) ** 2;
    if (squared < distance) { distance = squared; closest = [x, y]; }
  }
  return closest;
}

export function normalizeWheelDelta(event, pageHeight) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const horizontal = event.shiftKey && !event.deltaX;
  return {
    x: (horizontal ? event.deltaY : event.deltaX) * unit,
    y: (horizontal ? 0 : event.deltaY) * unit,
  };
}

export function wheelPanTarget(position, target, delta) {
  // A reverse gesture replaces the unfinished travel on that axis immediately.
  const retarget = (current, pending, change) =>
    ((pending - current) * change < 0 ? current : pending) + change;
  return { x: retarget(position.x, target.x, delta.x), y: retarget(position.y, target.y, delta.y) };
}

export function wheelPanStep(position, target, elapsedMs) {
  const elapsed = Number.isFinite(elapsedMs) ? clamp(elapsedMs, 0, 64) : 0;
  if (!elapsed) return { ...position, settled: position.x === target.x && position.y === target.y };
  const amount = -Math.expm1(-elapsed / 100);
  const x = position.x + (target.x - position.x) * amount;
  const y = position.y + (target.y - position.y) * amount;
  const settled = Math.max(Math.abs(target.x - x), Math.abs(target.y - y)) < .1;
  return settled ? { ...target, settled: true } : { x, y, settled: false };
}

function projection(x, y, width, height) {
  const nx = x / width * 2 - 1;
  const ny = y / height * 2 - 1;
  const bowY = clamp(height / width, 1, 1.5);
  return { nx, ny, radius: nx * nx + ny * ny * bowY * bowY };
}

export function barrelPoint(x, y, width, height) {
  const { nx, ny, radius } = projection(x, y, width, height);
  const scale = 1 + WALL_CURVE * radius;
  return [(nx * scale + 1) * width / 2, (ny * scale + 1) * height / 2];
}

export function unprojectPoint(worldX, worldY, width, height) {
  const { nx, ny, radius } = projection(worldX, worldY, width, height);
  // A radial projection preserves direction. Solve r + c*r^3 = R for
  // the single positive radius, then recover both coordinates together.
  const projectedRadius = Math.sqrt(radius);
  if (!projectedRadius) return [width / 2, height / 2];
  let low = 0;
  let high = projectedRadius;
  for (let iteration = 0; iteration < 56; iteration++) {
    const middle = (low + high) / 2;
    if (middle * (1 + WALL_CURVE * middle * middle) < projectedRadius) low = middle;
    else high = middle;
  }
  const ratio = (low + high) / (2 * projectedRadius);
  return [(nx * ratio + 1) * width / 2, (ny * ratio + 1) * height / 2];
}

export function preserveAnchor(pan, anchor, viewport, previousLayout, nextLayout) {
  const [x, y] = barrelPoint(anchor[0], anchor[1], viewport.width, viewport.height);
  const scaleX = (nextLayout.cardWidth + nextLayout.gap)
    / (previousLayout.cardWidth + previousLayout.gap);
  const scaleY = (nextLayout.cardHeight + nextLayout.gap)
    / (previousLayout.cardHeight + previousLayout.gap);
  return { x: (pan.x + x) * scaleX - x, y: (pan.y + y) * scaleY - y };
}

export function inertiaStep(vx, vy, elapsedMs) {
  const elapsed = Number.isFinite(elapsedMs) ? clamp(elapsedMs, 0, 64)
    : elapsedMs === Infinity ? 64 : 0;
  const frames = elapsed / FRAME_MS;
  const decay = Math.pow(FRICTION, frames);
  const displacement = (1 - decay) / (1 - FRICTION);
  const nextX = vx * decay;
  const nextY = vy * decay;
  return {
    dx: displacement ? vx * displacement : 0,
    dy: displacement ? vy * displacement : 0,
    vx: Math.abs(nextX) < .02 ? 0 : nextX,
    vy: Math.abs(nextY) < .02 ? 0 : nextY,
  };
}
