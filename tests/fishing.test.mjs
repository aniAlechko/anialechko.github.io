import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/fishing.js', import.meta.url), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options = {}) {
      if (!listeners.has(type)) listeners.set(type, new Map());
      listeners.get(type).set(callback, options);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type) {
      for (const [callback, options] of [...listeners.get(type) || []]) {
        callback({ type, target: this });
        if (options.once) listeners.get(type).delete(callback);
      }
    },
    get listenerCount() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0); },
  };
}

function makeHarness({ image = 'ready', reducedMotion = false, scroll = 0, state = 'idle', missing } = {}) {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const timers = new Map();
  const observers = new Set();
  const writes = [];
  const element = name => {
    const classes = new Set();
    const attributes = new Map();
    return {
      ...eventTarget(), name, classes, hidden: false, dataset: {},
      classList: {
        add(...names) { for (const value of names) { writes.push([name, 'class', value, true]); classes.add(value); } },
        remove(...names) { for (const value of names) { writes.push([name, 'class', value, false]); classes.delete(value); } },
        contains(value) { return classes.has(value); },
        toggle(value, enabled = !classes.has(value)) {
          this[enabled ? 'add' : 'remove'](value);
          return enabled;
        },
      },
      style: new Proxy({
        setProperty(property, value) { this[property] = value; },
        removeProperty(property) { writes.push([name, 'remove', property]); delete this[property]; },
        getPropertyValue(property) { return this[property] || ''; },
      }, {
        set(target, property, value) { writes.push([name, property, value]); target[property] = value; return true; },
      }),
      setAttribute(property, value) { attributes.set(property, String(value)); },
      getAttribute(property) { return attributes.get(property) ?? null; },
      removeAttribute(property) { attributes.delete(property); },
    };
  };
  const actor = element('actor');
  const scene = element('scene'); scene.dataset.state = state;
  const fishing = element('fishing'); fishing.hidden = true;
  const sprite = element('sprite');
  let resolveImage, rejectImage;
  const decode = new Promise((resolve, reject) => { resolveImage = resolve; rejectImage = reject; });
  sprite.complete = image !== 'pending';
  sprite.naturalWidth = image === 'ready' ? 2048 : 0;
  sprite.decode = () => decode;
  if (image === 'ready') resolveImage();
  if (image === 'failed') rejectImage(new Error('Sprite unavailable'));
  const window = { ...eventTarget(), innerWidth: 1000, innerHeight: 800, scrollY: scroll };
  const motion = { ...eventTarget(), matches: reducedMotion };
  const nodes = { '.descent-actor': actor, '#descent-scene': scene, '.fishing-actor': fishing,
    '.fishing-sprite-source': sprite };
  const document = { ...eventTarget(), hidden: false,
    querySelector: selector => selector === missing ? null : nodes[selector] || null };
  let fishingDistance = 808;
  const context = vm.createContext({
    window, document, performance: { now: () => now },
    matchMedia: () => motion,
    getFishingDistance: () => fishingDistance,
    getComputedStyle: node => node.style,
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) { this.target = target; this.options = options; observers.add(this); }
      disconnect() { observers.delete(this); }
    },
  });
  vm.runInContext(source.replace('export function initFishing', 'function initFishing')
    + '\nthis.controller = initFishing({ getFishingDistance });', context);
  return {
    actor, scene, fishing, sprite, window, document, motion, writes,
    controller: context.controller,
    get pendingFrames() { return frames.size; },
    get pendingTimers() { return timers.size; },
    get observerCount() { return observers.size; },
    set fishingDistance(value) { fishingDistance = value; },
    tick() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(now); },
    advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); this.tick();
      }
      now = end; this.tick();
    },
    scrollTo(value) { window.scrollY = value; window.emit('scroll'); this.tick(); },
    setState(value) {
      scene.dataset.state = value;
      for (const observer of [...observers]) {
        if (observer.target === scene) observer.callback([{ target: scene, type: 'attributes', attributeName: 'data-state' }]);
      }
      this.tick();
    },
    async settle() { for (let index = 0; index < 6; index++) await Promise.resolve(); this.tick(); },
    async finishImage() { sprite.complete = true; sprite.naturalWidth = 2048; resolveImage(); await this.settle(); },
    async failImage() { sprite.complete = true; sprite.naturalWidth = 0; rejectImage(new Error('Sprite unavailable')); await this.settle(); },
  };
}

const route = { pitch: 48, total: 800, heroHeight: 800, sceneHeight: 808, fishingDistance: 808, arrivalBottom: 808 };
const at = fraction => route.total + route.fishingDistance * fraction;
async function readyHarness(options = {}) {
  const h = makeHarness(options);
  h.controller.setRoute(route);
  await h.settle();
  return h;
}

const isFishing = h => h.actor.classes.has('is-fishing');
const assertOriginal = h => {
  assert.equal(isFishing(h), false, 'The original avatar is still replaced');
  assert.equal(h.actor.classes.has('is-fishing-line'), false);
  assert.equal(h.fishing.hidden, true);
};
const assertLine = (h, expected) => {
  assert.ok(Math.abs(Number(h.actor.style['--fishing-line-progress']) - expected) < .0001,
    'The upper fishing line did not follow scroll progress');
  assert.equal(h.actor.classes.has('is-fishing-line'), expected > 0);
};

const tests = [
  ['the original avatar stays visible until completed landing and the scroll start', async () => {
    const h = await readyHarness();
    for (const state of ['idle', 'climbing', 'landing']) {
      h.setState(state); h.scrollTo(at(.9));
      assertOriginal(h);
      assert.equal(h.pendingTimers, 0);
    }
    h.scrollTo(route.total); h.setState('landed');
    for (const scroll of [route.total, at(.05), at(.10) - 1]) {
      h.scrollTo(scroll); assertOriginal(h);
    }
    h.scrollTo(at(.10));
    assert.equal(isFishing(h), true);
    assert.equal(h.fishing.hidden, false);
    assert.equal(h.fishing.dataset.pose, 'reach');
    assertLine(h, 0);
    h.controller.cleanup();
  }],
  ['slow assets select the current scroll pose and failed assets preserve the original avatar', async () => {
    const slow = await readyHarness({ image: 'pending', state: 'landed', scroll: at(.9) });
    slow.advance(5000); assertOriginal(slow);
    assert.equal(slow.pendingTimers, 0);
    await slow.finishImage();
    assert.equal(isFishing(slow), true);
    assert.equal(slow.fishing.dataset.pose, 'idle', 'Late decoding replayed earlier poses');
    assertLine(slow, .5);
    slow.controller.cleanup();
    const failed = await readyHarness({ image: 'pending', state: 'landed', scroll: at(.9) });
    await failed.failImage(); failed.advance(5000); assertOriginal(failed);
    failed.scrollTo(at(1)); assertOriginal(failed);
    assert.equal(failed.pendingTimers, 0);
    failed.controller.cleanup();
  }],
  ['the landing observer selects the current pose without needing another scroll', async () => {
    const h = await readyHarness({ state: 'landing', scroll: at(.30) });
    assertOriginal(h);
    h.setState('landed');
    assert.equal(isFishing(h), true, 'Landing completion required an extra scroll event');
    assert.equal(h.fishing.dataset.pose, 'cast', 'Landing completion restarted the reach pose');
    const writes = h.writes.length;
    h.setState('landed');
    assert.equal(h.writes.length, writes, 'A repeated state notification rewrote unchanged presentation');
    assert.equal(h.pendingTimers, 0);
    h.controller.cleanup();
  }],
  ['scroll selects every pose and extends the line equally in both directions', async () => {
    const h = await readyHarness({ state: 'landed' });
    const checkpoints = [
      [.10, 'reach', 0], [.15, 'reach', 0], [.20, 'ready', 0],
      [.24, 'ready', 0], [.25, 'cast', 0], [.30, 'cast', 0],
      [.80, 'idle', 0], [.85, 'idle', .25], [.90, 'idle', .5],
      [1, 'idle', 1], [1.5, 'idle', 1],
    ];
    for (const [fraction, pose, line] of [...checkpoints, ...checkpoints.toReversed()]) {
      h.scrollTo(at(fraction));
      assert.equal(h.fishing.dataset.pose, pose, `Incorrect pose at fishing fraction ${fraction}`);
      assert.equal(isFishing(h), true);
      assertLine(h, line);
      assert.equal(h.pendingFrames, 0, 'Scroll rendering retained an animation loop');
      assert.equal(h.pendingTimers, 0, 'Scroll poses scheduled timed progression');
    }
    h.scrollTo(at(.10) - 1); assertOriginal(h); assertLine(h, 0);
    h.scrollTo(at(.30)); assert.equal(h.fishing.dataset.pose, 'cast');
    h.controller.cleanup();
  }],
  ['stationary scrolling never advances a pose or line and unchanged events do not rewrite styles', async () => {
    const h = await readyHarness({ state: 'landed' });
    for (const [fraction, pose, line] of [[.15, 'reach', 0], [.20, 'ready', 0], [.30, 'cast', 0], [.9, 'idle', .5]]) {
      h.scrollTo(at(fraction));
      const writes = h.writes.length;
      h.advance(10000);
      h.window.emit('scroll'); h.window.emit('scroll'); h.window.emit('scroll');
      assert.equal(h.pendingFrames, 1, 'Repeated events did not coalesce');
      h.tick();
      assert.equal(h.fishing.dataset.pose, pose);
      assertLine(h, line);
      assert.equal(h.writes.length, writes, 'Stationary events rewrote unchanged fishing styles');
      assert.equal(h.pendingFrames, 0);
      assert.equal(h.pendingTimers, 0);
    }
    h.controller.cleanup();
  }],
  ['resize and repeated routes preserve the current pose and upper line progress', async () => {
    const h = await readyHarness({ state: 'landed', scroll: at(.20) });
    h.window.innerWidth = 1280;
    h.window.emit('resize'); h.tick(); h.controller.setRoute({ ...route });
    assert.equal(h.fishing.dataset.pose, 'ready');
    assertLine(h, 0);
    h.advance(5000); assert.equal(h.fishing.dataset.pose, 'ready');
    h.scrollTo(at(.9));
    for (const width of [390, 844, 1280]) {
      h.window.innerWidth = width;
      h.window.emit('resize'); h.tick();
      assert.equal(h.fishing.dataset.pose, 'idle'); assertLine(h, .5);
    }
    h.fishingDistance = 3200;
    h.controller.setRoute({ ...route, total: 820, sceneHeight: 3220, fishingDistance: 3200 });
    assert.equal(h.fishing.dataset.pose, 'ready', 'A changed route retained stale scroll progress');
    assertLine(h, 0);
    h.controller.cleanup();
  }],
  ['removed routes unavailable fishing distances and resumed climbing restore the original avatar', async () => {
    const h = await readyHarness({ state: 'landed', scroll: at(.9) });
    h.setState('climbing'); assertOriginal(h); assertLine(h, 0);
    h.setState('landed'); assert.equal(h.fishing.dataset.pose, 'idle'); assertLine(h, .5);
    for (const invalid of [null, { total: 0 }, { total: -1 }, { total: NaN }, { total: Infinity }]) {
      h.controller.setRoute(invalid); assertOriginal(h); assertLine(h, 0);
      h.controller.setRoute(route); assert.equal(h.fishing.dataset.pose, 'idle'); assertLine(h, .5);
    }
    for (const distance of [0, -1, NaN, Infinity]) {
      h.fishingDistance = distance; h.controller.setRoute(route); assertOriginal(h);
    }
    h.controller.cleanup();
  }],
  ['image errors restore the original avatar and cannot be undone by late decoding', async () => {
    const active = await readyHarness({ state: 'landed', scroll: at(.9) });
    active.sprite.emit('error'); assertOriginal(active); assertLine(active, 0);
    assert.equal(active.pendingFrames, 0);
    active.advance(1000); active.scrollTo(at(1)); assertOriginal(active);
    active.controller.cleanup();
    const late = await readyHarness({ image: 'pending', state: 'landed', scroll: at(.9) });
    late.sprite.emit('error'); await late.finishImage(); assertOriginal(late);
    assert.equal(late.pendingTimers, 0);
    late.controller.cleanup();
  }],
  ['hidden pages pause rendering and resume at the latest scroll position without replay', async () => {
    const h = await readyHarness({ state: 'landed', scroll: at(.20) });
    h.window.emit('scroll');
    h.document.hidden = true; h.document.emit('visibilitychange');
    assert.equal(h.pendingFrames, 0); assert.equal(h.pendingTimers, 0);
    h.scrollTo(at(.9)); h.advance(5000);
    assert.equal(h.fishing.dataset.pose, 'ready', 'A hidden page continued to render');
    assert.equal(h.pendingFrames, 0);
    h.document.hidden = false; h.document.emit('visibilitychange'); h.tick();
    assert.equal(h.fishing.dataset.pose, 'idle'); assertLine(h, .5);
    h.document.hidden = true; h.document.emit('visibilitychange');
    h.scrollTo(at(.05));
    h.document.hidden = false; h.document.emit('visibilitychange'); h.tick();
    assertOriginal(h); assertLine(h, 0);
    h.controller.cleanup();
  }],
  ['cleanup cancels all work and makes events state changes and late assets harmless', async () => {
    for (const image of ['ready', 'pending']) {
      const h = await readyHarness({ image, state: 'landed', scroll: at(.9) });
      h.window.emit('scroll');
      h.controller.cleanup(); h.controller.cleanup(); assertOriginal(h);
      assert.equal(h.pendingFrames, 0);
      assert.equal(h.pendingTimers, 0);
      assert.equal(h.observerCount, 0);
      assert.equal(h.window.listenerCount, 0);
      assert.equal(h.document.listenerCount, 0);
      assert.equal(h.sprite.listenerCount, 0);
      assert.equal(h.actor.style['--fishing-line-progress'], undefined);
      const writes = h.writes.length;
      await h.finishImage();
      h.sprite.emit('error'); h.window.emit('resize'); h.window.emit('scroll');
      h.document.emit('visibilitychange'); h.setState('landed');
      h.controller.setRoute(route); h.advance(5000);
      assert.equal(h.writes.length, writes, 'Disposed fishing changed presentation');
      assert.equal(h.pendingFrames, 0); assert.equal(h.pendingTimers, 0);
    }
  }],
  ['incomplete markup returns a harmless controller without listeners or observers', async () => {
    for (const missing of ['.descent-actor', '#descent-scene', '.fishing-actor', '.fishing-sprite-source']) {
      const h = makeHarness({ missing });
      h.controller.setRoute(route); h.controller.cleanup(); await h.settle();
      assert.equal(h.window.listenerCount, 0);
      assert.equal(h.document.listenerCount, 0);
      assert.equal(h.sprite.listenerCount, 0);
      assert.equal(h.observerCount, 0);
      assert.equal(h.pendingTimers, 0); assert.equal(h.pendingFrames, 0);
    }
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} fishing scenarios passed`);
process.exitCode = failed ? 1 : 0;
