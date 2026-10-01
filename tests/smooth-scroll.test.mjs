import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/smooth-scroll.js', import.meta.url), 'utf8');
const route = {
  pitch: 40,
  total: 990,
  segments: [{ start: 0, end: 400 }, { start: 550, end: 990 }],
};

function makeHarness(initialScroll, activeRoute = route) {
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  const events = new Map();
  const page = { scrollHeight: 4000 };
  const window = {
    scrollY: initialScroll,
    innerHeight: 800,
    scrollTo({ top }) { this.scrollY = top; },
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type) { events.delete(type); },
  };
  const context = vm.createContext({
    window,
    document: { documentElement: page, body: {} },
    HTMLElement: class {},
    performance: { now: () => now },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(source.replace('export function initSmoothScroll', 'function initSmoothScroll'), context);
  const controller = context.initSmoothScroll();
  controller.setRoute(activeRoute);
  function wheel(deltaY, deltaMode = 0) {
    now += 16;
    const event = {
      deltaY, deltaX: 0, deltaMode, cancelable: true, defaultPrevented: false,
      composedPath: () => [],
      preventDefault() { this.defaultPrevented = true; },
    };
    events.get('wheel')(event);
    return { target: controller.getTarget(), prevented: event.defaultPrevented };
  }
  function advance(count = 1) {
    for (let index = 0; frames.size && index < count; index++) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    }
  }
  function finish() {
    advance(300);
    assert.equal(frames.size, 0, 'Scroll did not settle');
  }
  return { wheel, advance, finish, window, controller, emit: type => events.get(type)?.({}) };
}

const tests = [
  ['second descent snaps relative to its own first rung in both directions', () => {
    const forward = makeHarness(550);
    assert.equal(forward.wheel(40).target, 590);
    forward.finish();
    assert.equal(forward.window.scrollY, 590);
    const reverse = makeHarness(630);
    assert.equal(reverse.wheel(-40).target, 590);
    reverse.finish();
    assert.equal(reverse.window.scrollY, 590);
  }],
  ['small line-mode wheel input advances a rung in the second descent', () => {
    assert.equal(makeHarness(550).wheel(1, 1).target, 590);
    assert.equal(makeHarness(630).wheel(-1, 1).target, 590);
  }],
  ['the middle interval scrolls without rung snapping', () => {
    const h = makeHarness(440);
    const expected = 440 + 40 * (1 + 0.9 * 40 / 700);
    assert.ok(Math.abs(h.wheel(40).target - expected) < 0.001);
    h.finish();
    assert.ok(Math.abs(h.window.scrollY - expected) < 0.001);
  }],
  ['continued wheel input crosses both sides of the about interval without forced stops', () => {
    const h = makeHarness(380);
    const first = h.wheel(120).target;
    const expected = 380 + 120 * (1 + 0.9 * 120 / 700);
    assert.ok(Math.abs(first - expected) < 0.001, 'The requested motion was shortened at about arrival');
    assert.equal(h.window.scrollY, 380, 'Changing the target moved the page directly');
    h.advance(4);
    assert.ok(h.window.scrollY > 400 && h.window.scrollY < first, 'The page did not ease through the first boundary');
    const next = h.wheel(120).target;
    assert.ok(next > 550, 'Continued input was pinned to the end of the about interval');
    assert.equal((next - 550) % route.pitch, 0, 'The next descent lost its own rung grid');
    h.finish();
    assert.equal(h.window.scrollY, next);
  }],
  ['continued reverse input crosses the about interval without forced stops', () => {
    const h = makeHarness(570);
    const first = h.wheel(-120).target;
    const expected = 570 - 120 * (1 + 0.9 * 120 / 700);
    assert.ok(Math.abs(first - expected) < 0.001, 'Reverse motion was shortened at about arrival');
    assert.equal(h.window.scrollY, 570);
    h.advance(4);
    assert.ok(h.window.scrollY < 550 && h.window.scrollY > first, 'The page did not ease through the reverse boundary');
    const next = h.wheel(-120).target;
    assert.ok(next < 400, 'Continued reverse input was pinned to the first descent');
    assert.equal(next % route.pitch, 0);
    h.finish();
    assert.equal(h.window.scrollY, next);
  }],
  ['entering either climb from the middle interval uses its own rung grid', () => {
    assert.equal(makeHarness(530).wheel(40).target, 590);
    assert.equal(makeHarness(410).wheel(-40).target, 360);
  }],
  ['a wheel target can pass the final arrival directly into contact', () => {
    const h = makeHarness(970);
    const first = h.wheel(120).target;
    assert.ok(first > 990, 'Contact scrolling was stopped at the final ladder rung');
    assert.equal(h.window.scrollY, 970);
    h.advance(4);
    assert.ok(h.wheel(120).target > first);
    h.finish();
    assert.ok(h.window.scrollY > 990);
  }],
  ['a strong burst settles within 640ms after the last wheel input', () => {
    const h = makeHarness(40);
    h.wheel(120);
    h.advance(2);
    h.wheel(240);
    h.advance(2);
    const destination = h.wheel(360).target;
    const releasedAt = h.window.scrollY;
    assert.ok(destination > releasedAt + route.pitch, 'The burst lost its forward momentum');
    h.advance(40);
    assert.equal(h.controller.getTarget(), null, 'A strong gesture left a long easing tail');
    assert.equal(h.window.scrollY, destination);
  }],
  ['contact scrolling uses the viewport instead of the ladder rung size', () => {
    const h = makeHarness(1200);
    const destination = h.wheel(700).target;
    assert.equal(destination, 1200 + h.window.innerHeight * 0.4,
      'The old ladder geometry limited scrolling inside contact');
    h.finish();
    assert.equal(h.window.scrollY, destination);
  }],
  ['reversing direction before arrival follows the new input', () => {
    const h = makeHarness(380);
    assert.ok(h.wheel(120).target > 400);
    assert.ok(h.wheel(-40).target < 380);
    h.finish();
    assert.ok(h.window.scrollY < 380);
  }],
  ['legacy routes retain their original rung grid and uncapped exit', () => {
    const legacy = { pitch: 40, total: 400 };
    assert.equal(makeHarness(120, legacy).wheel(40).target, 160);
    assert.ok(makeHarness(380, legacy).wheel(120).target > legacy.total);
    const outside = makeHarness(440, legacy);
    const expected = 440 + 40 * (1 + 0.9 * 40 / 700);
    assert.ok(Math.abs(outside.wheel(40).target - expected) < 0.001);
  }],
  ['continuous touchpad input remains native and cancels a wheel animation', () => {
    const h = makeHarness(380);
    assert.equal(h.wheel(120).prevented, true);
    const result = h.wheel(18);
    assert.equal(result.prevented, false);
    assert.equal(result.target, null);
    assert.equal(h.window.scrollY, 380);
  }],
  ['touch input stops the wheel animation without moving the page', () => {
    const h = makeHarness(570);
    h.wheel(120);
    h.emit('touchstart');
    assert.equal(h.controller.getTarget(), null);
    h.finish();
    assert.equal(h.window.scrollY, 570);
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.message}`); }
}
console.log(`${tests.length - failed}/${tests.length} smooth-scroll scenarios passed`);
process.exitCode = failed ? 1 : 0;
