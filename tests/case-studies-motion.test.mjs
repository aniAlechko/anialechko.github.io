import assert from 'node:assert/strict';
import { barrelPoint, unprojectPoint, preserveAnchor, inertiaStep, clamp,
  normalizeWheelDelta, wheelPanTarget, wheelPanStep, cinemaEase, nearestProjectCell }
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

test('cinema lift is monotonic and reversible, with exact resting endpoints', () => {
  close(cinemaEase(0), 0); close(cinemaEase(1), 1);
  let previous = 0;
  for (let step = 1; step <= 100; step++) {
    const progress = cinemaEase(step / 100);
    assert.ok(progress >= previous && progress <= 1);
    previous = progress;
  }
  assert.ok(cinemaEase(.1) < .1);
  assert.ok(cinemaEase(.6) > .85);
});

test('project switching chooses the nearest repeated card across both lattice seams', () => {
  const cells = [0, 1, 2, 2, 0, 1];
  assert.deepEqual(nearestProjectCell(cells, 3, 2, 1, [3.1, .4], [400, 250]), [2, -1]);
  assert.deepEqual(nearestProjectCell(cells, 3, 2, 0, [-2.5, -1.5], [400, 250]), [-3, -2]);
  assert.equal(nearestProjectCell(cells, 3, 2, 9, [0, 0], [400, 250]), null);
});

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

test('a wheel notch moves smoothly across frames instead of jumping by the event distance', () => {
  const position = { x: 0, y: 0 };
  const target = wheelPanTarget(position, position, { x: 0, y: 120 });
  assert.deepEqual(position, { x: 0, y: 0 });
  assert.deepEqual(target, { x: 0, y: 120 });
  const first = wheelPanStep(position, target, 1000 / 60);
  assert.ok(first.y > 0 && first.y < 60);
  assert.equal(first.x, 0);
  assert.equal(first.settled, false);
  const second = wheelPanStep(first, target, 1000 / 60);
  assert.ok(second.y > first.y && second.y < target.y);
});

test('wheel motion follows the same timed input path at 30, 60 and 120 Hz', () => {
  function simulate(rate) {
    let position = { x: 0, y: 0 }, target = { ...position };
    const samples = [];
    for (const delta of [{ x: 48, y: 120 }, { x: 0, y: 80 }, { x: 24, y: 40 }]) {
      target = wheelPanTarget(position, target, delta);
      for (let frame = 0; frame < rate / 10; frame++) {
        position = wheelPanStep(position, target, 1000 / rate);
      }
      assert.equal(position.settled, false);
      samples.push({ x: position.x, y: position.y });
    }
    return samples;
  }
  const reference = simulate(60);
  for (const rate of [30, 120]) {
    const samples = simulate(rate);
    samples.forEach((sample, index) => {
      close(sample.x, reference[index].x);
      close(sample.y, reference[index].y);
    });
  }
});

test('a decaying trackpad stream settles at its supplied distance without an extra fling', () => {
  let position = { x: 0, y: 0 }, target = { ...position };
  const deltas = [80, 60, 40, 24, 12, 6, 2, 1];
  for (const y of deltas) {
    target = wheelPanTarget(position, target, { x: 0, y });
    position = wheelPanStep(position, target, 1000 / 60);
  }
  assert.deepEqual(target, { x: 0, y: deltas.reduce((sum, delta) => sum + delta, 0) });
  for (let frame = 0; frame < 180 && !position.settled; frame++) {
    const next = wheelPanStep(position, target, 1000 / 60);
    assert.ok(next.y >= position.y && next.y <= target.y);
    position = next;
  }
  assert.equal(position.settled, true);
  assert.equal(position.y, target.y);
  assert.equal(position.x, target.x);
  for (let frame = 0; frame < 30; frame++) {
    position = wheelPanStep(position, target, 1000 / 60);
    assert.equal(position.y, target.y);
    assert.equal(position.settled, true);
  }
});

test('reversing the wheel discards the old pending direction on the next frame', () => {
  const position = { x: 15, y: 50 };
  const target = wheelPanTarget(position, { x: 100, y: 200 }, { x: 0, y: -20 });
  assert.deepEqual(target, { x: 100, y: 30 });
  const next = wheelPanStep(position, target, 1000 / 60);
  assert.ok(next.y < position.y && next.y > target.y);
  assert.ok(next.x > position.x && next.x < target.x);
  const reverseX = wheelPanTarget(position, { x: 100, y: 200 }, { x: -10, y: 5 });
  assert.deepEqual(reverseX, { x: 5, y: 205 });
});

test('wheel smoothing does not advance when no time has elapsed', () => {
  const position = { x: 5, y: -10 }, target = { x: 80, y: 140 };
  for (const elapsed of [0, -1, -100]) {
    const next = wheelPanStep(position, target, elapsed);
    assert.equal(next.x, position.x);
    assert.equal(next.y, position.y);
    assert.equal(next.settled, false);
  }
  const almostThere = wheelPanStep({ x: 79.95, y: 139.95 }, target, 0);
  assert.equal(almostThere.x, 79.95);
  assert.equal(almostThere.y, 139.95);
});

test('wheel input preserves pixel, line, page and Shift axis conventions', () => {
  const event = { deltaX: 3, deltaY: 7, deltaMode: 0, shiftKey: false };
  assert.deepEqual(normalizeWheelDelta(event, 800), { x: 3, y: 7 });
  assert.deepEqual(normalizeWheelDelta({ ...event, deltaMode: 1 }, 800), { x: 48, y: 112 });
  assert.deepEqual(normalizeWheelDelta({ ...event, deltaMode: 2 }, 800), { x: 2400, y: 5600 });
  assert.deepEqual(normalizeWheelDelta({ ...event, deltaX: 0, shiftKey: true }, 800), { x: 7, y: 0 });
  assert.deepEqual(normalizeWheelDelta({ ...event, deltaX: 0, deltaMode: 1, shiftKey: true }, 800), { x: 112, y: 0 });
  assert.deepEqual(normalizeWheelDelta({ ...event, shiftKey: true }, 800), { x: 3, y: 7 });
});

test('clamp includes both boundaries', () => {
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(7, 0, 1), 1);
  assert.equal(clamp(.5, 0, 1), .5);
});

console.log(`${passed}/${passed} case-studies motion scenarios passed`);
