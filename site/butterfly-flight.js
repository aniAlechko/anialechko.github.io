const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// A close pair chasing around a shared, drifting center. The arc shape, speed,
// following distance and flutter change independently, so the path never loops.
export function createButterflyFlight({ random = Math.random } = {}) {
  const range = (low, high) => low + random() * (high - low);
  const butterflies = [0, 1].map(() => ({
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, bank: 0, pace: 1,
    phase: range(0, TAU), beat: range(0, TAU), burst: 0.7,
    initialized: false, flutterTime: range(0.1, 0.8), flutterTarget: 0.8,
  }));
  let width = 1;
  let height = 1;
  let span = 1;
  let margin = 1;
  let maxRadiusX = 1;
  let maxRadiusY = 1;
  let radiusX = 1;
  let radiusY = 1;
  let targetRadiusX = 1;
  let targetRadiusY = 1;
  let angle = range(0, TAU);
  let speed = 2.7;
  let targetSpeed = 2.7;
  let gap = 2.8;
  let targetGap = 2.8;
  let changeTime = 0;
  let driftTime = 0;
  const drift = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };

  function positions(dt = 0) {
    const centerX = width / 2 + drift.x * Math.max(0, width / 2 - margin - maxRadiusX);
    const centerY = height / 2 + drift.y * Math.max(0, height / 2 - margin - maxRadiusY);
    butterflies.forEach((butterfly, index) => {
      const phase = angle + index * gap;
      const x = centerX + Math.cos(phase) * radiusX;
      const y = centerY + Math.sin(phase) * radiusY;
      if (dt) {
        butterfly.vx = (x - butterfly.x) / dt;
        butterfly.vy = (y - butterfly.y) / dt;
        const velocity = Math.hypot(butterfly.vx, butterfly.vy);
        const heading = Math.atan2(butterfly.vy, butterfly.vx) + Math.PI / 2;
        const turn = wrap(heading - butterfly.angle);
        butterfly.angle += clamp(turn * 10, -6, 6) * dt;
        butterfly.bank += (clamp(turn * 0.28, -0.3, 0.3) - butterfly.bank) * (1 - Math.exp(-dt * 6));
        butterfly.pace += (clamp(velocity / (65 + span), 0, 1.6) - butterfly.pace) * (1 - Math.exp(-dt * 5));
      } else {
        butterfly.angle = Math.atan2(Math.cos(phase) * radiusY, -Math.sin(phase) * radiusX) + Math.PI / 2;
      }
      butterfly.x = x;
      butterfly.y = y;
      butterfly.initialized = true;
    });
  }

  function chooseArc() {
    targetRadiusX = range(0.92, 1.4) * span;
    targetRadiusY = range(0.82, 1.12) * span;
    targetRadiusX = Math.min(targetRadiusX, maxRadiusX);
    targetRadiusY = Math.min(targetRadiusY, maxRadiusY);
    targetGap = range(2.5, 3.55);
    // Smaller butterflies keep an energetic flight speed instead of crawling.
    targetSpeed = (65 + span * 1.1) / Math.max(span, 1) * range(0.8, 1.15);
    changeTime = range(0.85, 2.1);
  }

  function resize(nextWidth, nextHeight, nextSpan) {
    const previousSpan = span;
    const initialized = butterflies[0].initialized;
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    span = Math.max(1, nextSpan);
    margin = Math.min(span * 0.63 + 2, width * 0.25, height * 0.25);
    maxRadiusX = Math.min(span * 1.4, (width - margin * 2) * 0.46);
    maxRadiusY = Math.min(span * 1.12, (height - margin * 2) * 0.46);
    radiusX = initialized ? radiusX * span / previousSpan : span * 1.15;
    radiusY = initialized ? radiusY * span / previousSpan : span * 0.96;
    radiusX = Math.min(radiusX, maxRadiusX);
    radiusY = Math.min(radiusY, maxRadiusY);
    chooseArc();
    if (!initialized) speed = targetSpeed;
    positions();
  }

  function advance(dt) {
    changeTime -= dt;
    driftTime -= dt;
    if (changeTime <= 0) chooseArc();
    if (driftTime <= 0) {
      drift.tx = range(-0.85, 0.85);
      drift.ty = range(-0.85, 0.85);
      driftTime = range(1.7, 3.6);
    }
    // A damped center drift carries both butterflies together through the area.
    for (const axis of ['x', 'y']) {
      const velocity = `v${axis}`;
      drift[velocity] += ((drift[`t${axis}`] - drift[axis]) * 2.8 - drift[velocity] * 3.6) * dt;
      drift[axis] += drift[velocity] * dt;
    }
    const easing = 1 - Math.exp(-dt * 1.7);
    radiusX += (targetRadiusX - radiusX) * easing;
    radiusY += (targetRadiusY - radiusY) * easing;
    gap += (targetGap - gap) * (1 - Math.exp(-dt * 1.25));
    speed += (targetSpeed - speed) * (1 - Math.exp(-dt * 2.2));
    angle += speed * dt;
    butterflies.forEach(butterfly => {
      butterfly.flutterTime -= dt;
      if (butterfly.flutterTime <= 0) {
        const flutter = butterfly.flutterTarget < 0.65;
        butterfly.flutterTarget = flutter ? range(0.8, 1) : range(0.38, 0.6);
        butterfly.flutterTime = flutter ? range(0.3, 0.65) : range(0.2, 0.48);
      }
      butterfly.burst += (butterfly.flutterTarget - butterfly.burst) * (1 - Math.exp(-dt * 9));
      butterfly.beat += dt * TAU * (3.3 + butterfly.burst * 2.8);
    });
    positions(dt);
  }

  function step(dt) {
    if (!butterflies[0].initialized || !Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, 0.12);
    while (remaining > 1e-9) {
      const substep = Math.min(remaining, 1 / 120);
      advance(substep);
      remaining -= substep;
    }
  }

  return { butterflies, resize, step };
}
