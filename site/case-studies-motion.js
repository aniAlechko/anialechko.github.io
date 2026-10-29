const WALL_CURVE = .22;
const FRAME_MS = 1000 / 60;
const FRICTION = .94;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
