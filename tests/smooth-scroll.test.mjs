import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/smooth-scroll.js', import.meta.url), 'utf8');
const route = { pitch: 40, total: 1000 };

function makeHarness(initialScroll) {
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  const events = new Map();
  const mediaEvents = new Map();
  const reducedMotion = {
    matches: false,
    addEventListener(type, listener) { mediaEvents.set(type, listener); },
    removeEventListener(type) { mediaEvents.delete(type); },
  };
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
    matchMedia: () => reducedMotion,
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(source.replace('export function initSmoothScroll', 'function initSmoothScroll'), context);
  const controller = context.initSmoothScroll();
  controller.setRoute(route);
  function wheel(deltaY, deltaMode = 0, overrides = {}) {
    now += 16;
    const event = {
      deltaY, deltaX: 0, deltaMode, cancelable: true, defaultPrevented: false,
      composedPath: () => [],
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
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
  return {
    wheel, advance, finish, window, controller, events, mediaEvents,
    emit: (type, event = {}) => events.get(type)?.(event),
    setReducedMotion(value) {
      reducedMotion.matches = value;
      mediaEvents.get('change')?.();
    },
  };
}

const tests = [
  ['wheel input settles on a ladder rung in both directions', () => {
    const forward = makeHarness(120);
    assert.equal(forward.wheel(40).target, 160);
    forward.finish();
    assert.equal(forward.window.scrollY, 160);
    const reverse = makeHarness(200);
    assert.equal(reverse.wheel(-40).target, 160);
    reverse.finish();
    assert.equal(reverse.window.scrollY, 160);
  }],
  ['small line-mode wheel input advances a rung', () => {
    assert.equal(makeHarness(120).wheel(1, 1).target, 160);
    assert.equal(makeHarness(200).wheel(-1, 1).target, 160);
  }],
  ['returning from contact settles on the ladder rung grid', () => {
    const h = makeHarness(1040);
    assert.equal(h.wheel(-80).target, 960);
    assert.equal(h.window.scrollY, 1040, 'Changing the target moved the page directly');
    h.finish();
    assert.equal(h.window.scrollY, 960);
  }],
  ['a wheel target can pass the final arrival directly into contact', () => {
    const h = makeHarness(980);
    const first = h.wheel(120).target;
    assert.ok(first > route.total, 'Contact scrolling was stopped at the final ladder rung');
    assert.equal(h.window.scrollY, 980);
    h.advance(4);
    assert.ok(h.window.scrollY > route.total && h.window.scrollY < first,
      'The page did not ease through the contact boundary');
    assert.ok(h.wheel(120).target > first);
    h.finish();
    assert.ok(h.window.scrollY > route.total);
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
  ['the page boundaries stop scrolling without trapping wheel input', () => {
    const top = makeHarness(20);
    assert.equal(top.wheel(-120).target, 0);
    top.finish();
    assert.deepEqual(top.wheel(-120), { target: null, prevented: false });
    const bottom = makeHarness(3190);
    assert.equal(bottom.wheel(120).target, 3200);
    bottom.finish();
    assert.deepEqual(bottom.wheel(120), { target: null, prevented: false });
  }],
  ['removing the ladder route leaves ordinary contact scrolling usable', () => {
    const h = makeHarness(120);
    h.controller.setRoute(null);
    const destination = h.wheel(700).target;
    assert.equal(destination, 120 + h.window.innerHeight * 0.4);
    h.finish();
    assert.equal(h.window.scrollY, destination);
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
    const h = makeHarness(560);
    h.wheel(120);
    h.emit('touchstart');
    assert.equal(h.controller.getTarget(), null);
    h.finish();
    assert.equal(h.window.scrollY, 560);
  }],
  ['reduced motion cancels animation and keeps subsequent wheel input native', () => {
    const h = makeHarness(120);
    h.wheel(120);
    h.advance(2);
    const stoppedAt = h.window.scrollY;
    h.setReducedMotion(true);
    assert.equal(h.controller.getTarget(), null);
    assert.deepEqual(h.wheel(120), { target: null, prevented: false });
    h.finish();
    assert.equal(h.window.scrollY, stoppedAt);
  }],
  ['keyboard and external scrolling take over from wheel animation', () => {
    const keyboard = makeHarness(120);
    keyboard.wheel(120);
    keyboard.emit('keydown', { key: 'PageDown' });
    assert.equal(keyboard.controller.getTarget(), null);
    const external = makeHarness(120);
    external.wheel(120);
    external.window.scrollY = 200;
    external.emit('scroll');
    external.finish();
    assert.equal(external.window.scrollY, 200);
    assert.equal(external.controller.getTarget(), null);
  }],
  ['zoom and horizontal wheel gestures remain native', () => {
    const h = makeHarness(120);
    assert.deepEqual(h.wheel(120, 0, { ctrlKey: true }), { target: null, prevented: false });
    assert.deepEqual(h.wheel(120, 0, { deltaX: 180 }), { target: null, prevented: false });
  }],
  ['destroy removes listeners and cancels pending movement', () => {
    const h = makeHarness(120);
    h.wheel(120);
    h.controller.destroy();
    assert.equal(h.events.size, 0);
    assert.equal(h.mediaEvents.size, 0);
    assert.equal(h.controller.getTarget(), null);
    h.finish();
    assert.equal(h.window.scrollY, 120);
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.message}`); }
}
console.log(`${tests.length - failed}/${tests.length} smooth-scroll scenarios passed`);
process.exitCode = failed ? 1 : 0;
