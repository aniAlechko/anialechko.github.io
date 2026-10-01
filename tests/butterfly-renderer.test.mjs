import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createButterflyFlight } from '../site/butterfly-flight.js';

const source = (await readFile(new URL('../site/butterflies.js', import.meta.url), 'utf8'))
  .replace(/^import .*?;\s*/m, '')
  .replace('import.meta.url', "'https://portfolio.test/butterflies.js'")
  .replace('export function initButterflies', 'function initButterflies');

function harness({ coarse = true, innerWidth = 390 } = {}) {
  let now = 0;
  let nextId = 1;
  let seed = 7;
  const timers = new Map();
  const frames = new Map();
  const images = [];
  const observers = [];
  const resizers = [];
  const targets = [];
  const metrics = { reads: 0, atlasReads: 0, paints: 0, bitmapWrites: 0 };
  const bounds = { left: 16, top: 64, width: innerWidth - 32, height: 137 };
  const target = () => {
    const listeners = new Map();
    const result = {
      listeners,
      addEventListener(type, fn, options) {
        if (!listeners.has(type)) listeners.set(type, new Map());
        listeners.get(type).set(fn, options);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      emit(type, event = {}) { for (const fn of [...(listeners.get(type)?.keys() || [])]) fn({ type, ...event }); },
    };
    targets.push(result);
    return result;
  };
  function makeCanvas(main = false) {
    let width = 1;
    let height = 1;
    let atlas = false;
    const context = new Proxy({
      clearRect() { if (main) metrics.paints += 1; },
      drawImage(image) { if (image instanceof FakeImage) atlas = true; },
      getImageData(x, y, w, h) {
        if (atlas) metrics.atlasReads += 1;
        else metrics.reads += 1;
        const data = new Uint8ClampedArray(w * h * 4);
        if (atlas) data.fill(255);
        return { data };
      },
    }, { get: (object, key) => key in object ? object[key] : () => {} });
    return {
      dataset: {},
      get width() { return width; },
      set width(value) { width = value; if (main) metrics.bitmapWrites += 1; },
      get height() { return height; },
      set height(value) { height = value; if (main) metrics.bitmapWrites += 1; },
      getContext: () => context,
      getBoundingClientRect: () => ({ ...bounds }),
    };
  }
  class FakeImage {
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(value) { this.url = value; images.push(this); }
  }
  const canvas = makeCanvas(true);
  const reduced = { ...target(), matches: false };
  const pointer = { ...target(), matches: coarse };
  const document = { ...target(), hidden: false, documentElement: { clientWidth: innerWidth },
    querySelector: () => canvas, createElement: () => makeCanvas() };
  const window = { ...target(), innerWidth, devicePixelRatio: 2,
    matchMedia: query => query.includes('reduced-motion') ? reduced : pointer };
  const setTimeout = (fn, delay = 0) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  const context = vm.createContext({
    window, document, navigator: { maxTouchPoints: coarse ? 5 : 0 },
    matchMedia: window.matchMedia, URL, AbortController, Image: FakeImage,
    Path2D: class { moveTo() {} lineTo() {} closePath() {} },
    performance: { now: () => now },
    setTimeout, clearTimeout: id => timers.delete(id),
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; resizers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
    createButterflyFlight: () => createButterflyFlight({ random: () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    } }),
  });
  vm.runInContext(source, context);
  const cleanup = context.initButterflies(canvas);
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  async function advance(milliseconds) {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.fn();
    const pending = [...frames];
    frames.clear();
    for (const [, callback] of pending) callback(now);
    await flush();
  }
  async function load() {
    for (const image of images) {
      image.complete = true;
      image.naturalWidth = 32;
      image.naturalHeight = 16;
      image.onload?.();
    }
    await flush();
  }
  async function failLoad() {
    for (const image of images) image.onerror?.();
    await flush();
  }
  function visible(value = true) { for (const observer of observers) observer.callback([{ isIntersecting: value }]); }
  function resize(width, height) { Object.assign(bounds, { width, height }); for (const observer of resizers) observer.callback([]); }
  async function ready() { visible(); await load(); await advance(40); }
  function assertQuiet(before) {
    assert.equal(metrics.reads, before.reads, 'animation pixels must not be read during scrolling');
    assert.equal(metrics.atlasReads, before.atlasReads, 'texture preparation must wait for idle too');
    assert.equal(metrics.paints, before.paints, 'canvas must not repaint during scrolling');
    assert.equal(metrics.bitmapWrites, before.bitmapWrites, 'deferred resize must preserve its bitmap');
  }
  return { canvas, metrics, window, document, reduced, pointer, ready, load, failLoad, visible, resize,
    advance, flush, cleanup, frames, timers, observers, resizers, targets, assertQuiet };
}

test('mobile touch holds rendering paused through observer and resize callbacks', async () => {
  const h = harness();
  await h.ready();
  assert.ok(h.metrics.reads > 0, 'the renderer has drawn before the gesture');
  h.window.emit('touchstart', { touches: [{}] });
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'scroll']) {
    assert.ok([...h.window.listeners.get(type).values()].every(options => options?.passive), `${type} remains passive`);
  }
  const before = { ...h.metrics };
  h.resize(370, 145);
  h.visible(false);
  h.visible(true);
  h.document.emit('visibilitychange');
  h.reduced.emit('change');
  for (let i = 0; i < 10; i++) await h.advance(100);
  h.assertQuiet(before);
  h.window.emit('touchend', { touches: [{}] });
  await h.advance(300);
  h.assertQuiet(before);
  h.window.emit('touchend', { touches: [] });
  await h.advance(159);
  h.assertQuiet(before);
  await h.advance(2);
  assert.ok(h.metrics.reads > before.reads, 'rendering resumes after input settles');
  assert.ok(h.metrics.bitmapWrites > before.bitmapWrites, 'pending resize is applied once idle');
  h.cleanup();
});

test('mobile momentum scroll resets the quiet period and touch cancel releases it', async () => {
  const h = harness({ coarse: false, innerWidth: 390 });
  await h.ready();
  h.window.emit('touchstart', { touches: [{}] });
  h.window.emit('touchcancel', { touches: [] });
  const before = { ...h.metrics };
  await h.advance(120);
  h.window.emit('scroll');
  await h.advance(120);
  h.window.emit('scroll');
  await h.advance(159);
  h.assertQuiet(before);
  await h.advance(2);
  assert.ok(h.metrics.reads > before.reads);
  h.cleanup();
});

test('texture readiness cannot restart animation during an active mobile gesture', async () => {
  const h = harness({ coarse: true, innerWidth: 1024 });
  h.visible();
  h.window.emit('touchstart', { touches: [{}] });
  const before = { ...h.metrics };
  await h.load();
  await h.advance(500);
  h.assertQuiet(before);
  h.window.emit('touchend', { touches: [] });
  await h.advance(161);
  assert.ok(h.metrics.reads > before.reads);
  h.cleanup();
});

test('desktop input keeps rendering and cleanup cancels pending work', async () => {
  const h = harness({ coarse: false, innerWidth: 1280 });
  await h.ready();
  const before = h.metrics.reads;
  h.window.emit('pointermove', { pointerType: 'mouse', clientX: 200, clientY: 90 });
  h.window.emit('scroll');
  await h.advance(40);
  assert.ok(h.metrics.reads > before, 'desktop mouse interaction remains live');
  h.cleanup();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  assert.ok(h.observers.every(observer => observer.disconnected));
  assert.ok(h.resizers.every(observer => observer.disconnected));
  assert.ok(h.targets.every(target => [...target.listeners.values()].every(set => set.size === 0)));
  const disposed = { ...h.metrics };
  await h.advance(1000);
  assert.deepEqual(h.metrics, disposed);
});

test('cleanup during a pending mobile gesture leaves no timer or deferred texture work', async () => {
  const h = harness();
  h.visible();
  h.window.emit('touchstart', { touches: [{}] });
  await h.load();
  h.window.emit('touchend', { touches: [] });
  h.cleanup();
  await h.flush();
  const before = { ...h.metrics };
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  await h.advance(1000);
  assert.deepEqual(h.metrics, before);
});

test('first touchmove after lazy initialization holds the finger pause', async () => {
  const h = harness();
  await h.ready();
  h.window.emit('touchmove', { touches: [{}] });
  const before = { ...h.metrics };
  await h.advance(500);
  h.assertQuiet(before);
  h.window.emit('touchend', { touches: [] });
  await h.advance(161);
  assert.ok(h.metrics.reads > before.reads);
  h.cleanup();
});

test('cleanup cancels an image request that has not completed', async () => {
  const h = harness();
  h.visible();
  h.cleanup();
  await h.flush();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0, 'image load timeout must be cancelled');
  const before = { ...h.metrics };
  await h.load();
  await h.advance(16000);
  assert.deepEqual(h.metrics, before);
});

test('texture processing waits until the section becomes visible again', async () => {
  const h = harness();
  h.visible();
  h.visible(false);
  const before = { ...h.metrics };
  await h.load();
  await h.advance(500);
  h.assertQuiet(before);
  assert.equal(h.frames.size, 0);
  h.visible();
  await h.flush();
  assert.ok(h.metrics.reads > before.reads);
  h.cleanup();
});

test('a texture load error waits for mobile input to settle before drawing its fallback', async () => {
  const h = harness();
  h.visible();
  h.window.emit('touchstart', { touches: [{}] });
  const before = { ...h.metrics };
  await h.failLoad();
  await h.advance(500);
  h.assertQuiet(before);
  h.window.emit('touchend', { touches: [] });
  await h.advance(161);
  assert.equal(h.canvas.dataset.renderer, 'fallback');
  assert.ok(h.metrics.reads > before.reads);
  h.cleanup();
});

test('an early settle timer reschedules instead of stranding the animation', async () => {
  const h = harness();
  await h.ready();
  h.window.emit('scroll');
  const before = { ...h.metrics };
  const [id, timer] = [...h.timers][0];
  h.timers.delete(id);
  timer.fn();
  await h.advance(159);
  h.assertQuiet(before);
  await h.advance(2);
  assert.ok(h.metrics.reads > before.reads);
  h.cleanup();
});
