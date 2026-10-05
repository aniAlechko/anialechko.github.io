import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/smooth-scroll.js', import.meta.url), 'utf8');
const route = { pitch: 40, total: 1000 };

function makeHarness(initialScroll, { roundScroll = false } = {}) {
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  let scrollWrites = 0;
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
    scrollTo({ top }) { scrollWrites++; this.scrollY = roundScroll ? Math.round(top) : top; },
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
    wheel, advance, finish, window, page, controller, events, mediaEvents,
    get pendingFrames() { return frames.size; },
    get scrollWrites() { return scrollWrites; },
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
  ['a crossing wheel input settles at arrival before the next input continues into contact', () => {
    const h = makeHarness(980);
    const first = h.wheel(120).target;
    assert.equal(first, route.total, 'The crossing gesture raised the landed character above its stop');
    assert.equal(h.window.scrollY, 980);
    h.advance(4);
    assert.ok(h.window.scrollY > 980 && h.window.scrollY < first, 'The page did not ease toward arrival');
    assert.equal(h.wheel(120).target, route.total, 'An unfinished arrival was pushed into contact');
    h.finish();
    assert.equal(h.window.scrollY, route.total);
    assert.ok(h.wheel(120).target > route.total, 'Arrival trapped later scrolling into contact');
    h.finish();
    assert.ok(h.window.scrollY > route.total);
  }],
  ['near-endpoint wheel input holds arrival and still responds immediately to reversal', () => {
    const h = makeHarness(route.total - .5);
    assert.equal(h.wheel(120).target, route.total, 'The last fraction of a pixel bypassed arrival');
    h.advance();
    assert.ok(route.total - h.window.scrollY < .5 && h.controller.getTarget() !== null);
    assert.equal(h.wheel(120).target, route.total, 'Repeated input pushed the pending arrival into contact');
    assert.ok(h.wheel(-40).target < route.total, 'The arrival stop trapped a reverse gesture');
    h.finish();
    assert.ok(h.window.scrollY < route.total);
  }],
  ['a rounded fractional arrival continues into the garden without native jumps or repeated endpoint stops', () => {
    for (const remainder of [.25, .45, .5, .75]) {
      const fractionalRoute = { pitch: 40, total: 800 + remainder };
      const h = makeHarness(780, { roundScroll: true });
      h.controller.setRoute(fractionalRoute);
      assert.equal(h.wheel(120).target, fractionalRoute.total);
      h.finish();
      assert.equal(h.window.scrollY, Math.round(fractionalRoute.total));
      const next = h.wheel(120);
      assert.equal(next.prevented, true, 'The next wheel gesture fell through to an abrupt native scroll');
      assert.ok(next.target > fractionalRoute.total, 'The rounded position was trapped at arrival');
      h.advance();
      assert.ok(h.wheel(120).target > fractionalRoute.total, 'Continuing input returned to the completed arrival');
      h.finish();
      assert.ok(h.window.scrollY > fractionalRoute.total);
    }
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
  ['resizing preserves active wheel momentum without moving the page immediately', () => {
    const h = makeHarness(120);
    const destination = h.wheel(240).target;
    h.advance(3);
    const before = h.window.scrollY;
    const writes = h.scrollWrites;
    h.window.innerHeight = 700;
    h.emit('resize');
    assert.equal(h.controller.getTarget(), destination, 'Resize discarded the pending destination');
    assert.equal(h.window.scrollY, before);
    assert.equal(h.scrollWrites, writes, 'Resize wrote a new scroll position');
    h.advance();
    assert.ok(h.window.scrollY > before && h.window.scrollY < destination,
      'The original wheel ease did not continue after resize');
    h.finish();
    assert.equal(h.window.scrollY, destination);
  }],
  ['repeated resizes retain one wheel ease and realign its destination to the new rung grid', () => {
    const h = makeHarness(120);
    h.wheel(360);
    h.advance(2);
    for (let index = 0; index < 6; index++) {
      h.window.innerHeight = 720 + index * 10;
      h.emit('resize');
      h.controller.setRoute({ pitch: 48, total: 1200 });
      assert.ok(h.controller.getTarget() > h.window.scrollY, 'Resize stopped forward momentum');
      assert.equal(h.controller.getTarget() % 48, 0, 'Target remained on the old rung grid');
      assert.ok(h.pendingFrames <= 2, 'Repeated resize added overlapping animation work');
      h.advance();
    }
    const destination = h.controller.getTarget();
    h.finish();
    assert.equal(h.window.scrollY, destination);
  }],
  ['browser scroll anchoring during resize is adopted without cancelling wheel inertia', () => {
    const h = makeHarness(240);
    const destination = h.wheel(240).target;
    h.advance(2);
    h.emit('resize');
    h.window.scrollY += 7;
    h.emit('scroll');
    assert.equal(h.controller.getTarget(), destination, 'Synchronous anchoring cancelled momentum');
    h.advance();
    h.window.scrollY += 5;
    h.emit('scroll');
    assert.equal(h.controller.getTarget(), destination, 'Deferred anchoring cancelled momentum');
    const anchoredAt = h.window.scrollY;
    h.advance();
    assert.ok(h.window.scrollY > anchoredAt, 'The ease did not adopt the anchored position');
    h.finish();
    assert.equal(h.window.scrollY, destination);
  }],
  ['idle toolbar resizes leave native scrolling untouched and start no animation', () => {
    const h = makeHarness(430);
    h.window.innerHeight = 740;
    h.emit('resize');
    h.window.scrollY = 455;
    h.emit('scroll');
    h.window.innerHeight = 800;
    h.emit('resize');
    assert.equal(h.controller.getTarget(), null);
    assert.equal(h.pendingFrames, 0);
    assert.equal(h.scrollWrites, 0);
    assert.equal(h.window.scrollY, 455);
  }],
  ['explicit user input cancels wheel inertia even during the resize anchor window', () => {
    for (const takeOver of [
      h => h.emit('touchstart'),
      h => h.emit('pointerdown'),
      h => h.emit('keydown', { key: 'Home' }),
      h => assert.equal(h.wheel(18).prevented, false),
      h => h.setReducedMotion(true),
    ]) {
      const h = makeHarness(240);
      h.wheel(240); h.advance(2); h.emit('resize');
      const before = h.window.scrollY;
      const writes = h.scrollWrites;
      takeOver(h);
      assert.equal(h.controller.getTarget(), null);
      assert.equal(h.pendingFrames, 0, 'Takeover left the resize anchor window running');
      h.finish();
      assert.equal(h.window.scrollY, before);
      assert.equal(h.scrollWrites, writes);
    }
  }],
  ['external scrolling cancels wheel inertia after the resize anchor window ends', () => {
    const h = makeHarness(240);
    h.wheel(240); h.emit('resize'); h.advance(2);
    h.window.scrollY += 25;
    const before = h.window.scrollY;
    h.emit('scroll');
    assert.equal(h.controller.getTarget(), null);
    h.finish();
    assert.equal(h.window.scrollY, before);
  }],
  ['resizing clamps pending inertia to the new page boundary', () => {
    const h = makeHarness(2900);
    assert.ok(h.wheel(240).target > 2900);
    h.page.scrollHeight = 3400;
    h.window.scrollY = 2600;
    h.emit('resize');
    h.controller.setRoute(route);
    h.finish();
    assert.equal(h.window.scrollY, 2600);
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
