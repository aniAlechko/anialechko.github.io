import assert from 'node:assert/strict';
import test from 'node:test';
import { createButterflyFlight } from '../site/butterfly-flight.js';

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// The flight canvas spans the section above the contact heading. These are its
// measured sizes for desktop, narrow phones, and phone landscape.
const fields = [
  [1365, 336, 120.96], [1237, 160, 57.6], [358, 171, 61.56],
  [268, 108, 38.88], [812, 78, 28.08],
];

function checkPositions(flight, width, height, span) {
  for (const butterfly of flight.butterflies) {
    for (const value of Object.values(butterfly)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    }
    assert.ok(butterfly.x >= span * 0.6 && butterfly.x <= width - span * 0.6,
      'the wings have space at either horizontal edge');
    assert.ok(butterfly.y >= span * 0.6 && butterfly.y <= height - span * 0.6,
      'the wings have space above and below the flight area');
  }
  const [first, second] = flight.butterflies;
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  assert.ok(distance >= span * 1.2, 'the pair keeps open-wing clearance');
  assert.ok(distance <= span * 3, 'the pair stays together');
}

test('paired flight stays above the heading, close together and separated', () => {
  for (const [width, height, span] of fields) {
    for (const fps of [30, 60]) {
      for (const seed of [3, 19, 41]) {
        const flight = createButterflyFlight({ random: random(seed) });
        flight.resize(width, height, span);
        for (let frame = 0; frame < fps * 45; frame += 1) {
          const before = flight.butterflies.map(({ x, y, angle }) => ({ x, y, angle }));
          flight.step(1 / fps);
          checkPositions(flight, width, height, span);
          flight.butterflies.forEach((butterfly, index) => {
            const previous = before[index];
            assert.ok(Math.hypot(butterfly.x - previous.x, butterfly.y - previous.y) < span * 21 / fps,
              'ordinary flight does not jump by a wing span between frames');
            assert.ok(Math.abs(butterfly.angle - previous.angle) <= 6.01 / fps,
              'heading changes continuously instead of flipping');
          });
        }
      }
    }
  }
});

test('resizing and orientation changes preserve visible, separated flight', () => {
  const flight = createButterflyFlight({ random: random(7) });
  for (const [width, height, span] of [...fields, ...fields.toReversed()]) {
    flight.resize(width, height, span);
    checkPositions(flight, width, height, span);
    for (let frame = 0; frame < 600; frame += 1) {
      flight.step(1 / 60);
      checkPositions(flight, width, height, span);
    }
  }
});

test('paused and invalid time steps do not move or corrupt the pair', () => {
  const flight = createButterflyFlight({ random: random(23) });
  flight.resize(358, 137, 49.32);
  flight.step(1 / 30);
  const before = structuredClone(flight.butterflies);
  for (const dt of [0, -1, NaN, Infinity]) flight.step(dt);
  assert.deepEqual(flight.butterflies, before);
  flight.step(1 / 30);
  assert.notDeepEqual(flight.butterflies, before);
});

test('30fps steps retain the velocity used to turn the butterflies', () => {
  const flight = createButterflyFlight({ random: random(23) });
  flight.resize(358, 137, 49.32);
  for (let frame = 0; frame < 30; frame += 1) {
    flight.step(1 / 30);
    for (const butterfly of flight.butterflies) {
      assert.ok(Math.hypot(butterfly.vx, butterfly.vy) > 1,
        'rounding residue must not replace the last real velocity with zero');
    }
  }
});
