import assert from 'node:assert/strict';
import { barrelPoint, unprojectPoint, preserveAnchor, inertiaStep, clamp }
  from '../site/case-studies-motion.js';

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`);
};
let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}

test('barrel projection retains the center and bows the edges by the shader amount', () => {
  assert.deepEqual(barrelPoint(640, 360, 1280, 720), [640, 360]);
  const point = barrelPoint(1280, 360, 1280, 720);
  close(point[0], 640 + 640 * 1.22);
  close(point[1], 360);
  const portrait = barrelPoint(195, 844, 390, 844);
  close(portrait[1], 422 + 422 * (1 + .22 * 1.5 ** 2));
});

test('inverse barrel projection recovers positions across desktop, portrait and outside edges', () => {
  for (const [width, height] of [[1280, 720], [390, 844], [844, 390], [800, 1000]]) {
    for (const fx of [-.5, 0, .13, .5, .91, 1, 1.6]) {
      for (const fy of [-.5, 0, .19, .5, .88, 1, 1.6]) {
        const original = [fx * width, fy * height];
        const projected = barrelPoint(...original, width, height);
        const recovered = unprojectPoint(...projected, width, height);
        close(recovered[0], original[0]);
        close(recovered[1], original[1]);
      }
    }
  }
});

test('inverse barrel projection stays ordered even far beyond the visible wall', () => {
  let previous = -Infinity;
  for (let x = -20000; x <= 20000; x += 125) {
    const recovered = unprojectPoint(x, 422, 390, 844);
    assert.ok(recovered[0] > previous);
    close(recovered[1], 422);
    const projected = barrelPoint(...recovered, 390, 844);
    close(projected[0], x, 1e-7);
    previous = recovered[0];
  }
});

test('zoom preserves the exact grid location under a pointer at the curved edge', () => {
  const pan = { x: 812.5, y: -432.25 };
  const viewport = { width: 390, height: 844 };
  const previous = { cardWidth: 310, cardHeight: 195.3, gap: 15.5 };
  const next = { cardWidth: 510, cardHeight: 321.3, gap: 25.5 };
  for (const anchor of [[0, 0], [390, 844], [195, 422], [330, 100]]) {
    const projected = barrelPoint(...anchor, viewport.width, viewport.height);
    const nextPan = preserveAnchor(pan, anchor, viewport, previous, next);
    close((projected[0] + pan.x) / (previous.cardWidth + previous.gap),
      (projected[0] + nextPan.x) / (next.cardWidth + next.gap));
    close((projected[1] + pan.y) / (previous.cardHeight + previous.gap),
      (projected[1] + nextPan.y) / (next.cardHeight + next.gap));
    const returned = preserveAnchor(nextPan, anchor, viewport, next, previous);
    close(returned.x, pan.x);
    close(returned.y, pan.y);
  }
});

test('zoom can preserve each axis when the next layout has a different aspect ratio', () => {
  const pan = { x: -123, y: 987 };
  const viewport = { width: 1280, height: 720 };
  const previous = { cardWidth: 400, cardHeight: 252, gap: 20 };
  const next = { cardWidth: 300, cardHeight: 200, gap: 10 };
  const anchor = [1170, 50];
  const p = barrelPoint(...anchor, viewport.width, viewport.height);
  const result = preserveAnchor(pan, anchor, viewport, previous, next);
  close((result.x + p[0]) / 310, (pan.x + p[0]) / 420);
  close((result.y + p[1]) / 210, (pan.y + p[1]) / 272);
});

test('inertia matches one original 60 Hz friction frame', () => {
  const result = inertiaStep(12, -7, 1000 / 60);
  close(result.dx, 12);
  close(result.dy, -7);
  close(result.vx, 12 * .94);
  close(result.vy, -7 * .94);
});

test('inertia preserves travel and velocity across 30, 60 and 120 Hz', () => {
  function integrate(rate) {
    let vx = 30, vy = -19, x = 0, y = 0;
    for (let index = 0; index < rate / 2; index++) {
      const result = inertiaStep(vx, vy, 1000 / rate);
      x += result.dx;
      y += result.dy;
      ({ vx, vy } = result);
    }
    return { x, y, vx, vy };
  }
  const reference = integrate(60);
  for (const rate of [30, 120]) {
    const result = integrate(rate);
    for (const key of Object.keys(reference)) close(result[key], reference[key]);
  }
});

test('zero and negative elapsed time never advance inertia', () => {
  for (const elapsed of [0, -1, -1000]) {
    assert.deepEqual(inertiaStep(12, -7, elapsed), { dx: 0, dy: 0, vx: 12, vy: -7 });
  }
});

test('large elapsed time is bounded and invalid elapsed values stay finite', () => {
  const bounded = inertiaStep(10, -5, 64);
  assert.deepEqual(inertiaStep(10, -5, 60000), bounded);
  assert.deepEqual(inertiaStep(10, -5, Infinity), bounded);
  for (const elapsed of [NaN, -Infinity]) {
    const result = inertiaStep(10, -5, elapsed);
    for (const value of Object.values(result)) assert.ok(Number.isFinite(value));
    close(result.dx, 0);
    close(result.dy, 0);
  }
});

test('inertia integrates the final fraction before stopping at the velocity threshold', () => {
  const result = inertiaStep(.021, -.01, 1000 / 60);
  close(result.dx, .021);
  close(result.dy, -.01);
  assert.equal(result.vx, 0);
  assert.equal(result.vy, 0);
});

test('clamp includes both boundaries', () => {
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(7, 0, 1), 1);
  assert.equal(clamp(.5, 0, 1), .5);
});

console.log(`${passed}/${passed} case-studies motion scenarios passed`);
