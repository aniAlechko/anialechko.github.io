import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/footer-fish.js', import.meta.url), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of [...listeners.get(type) || []]) listener(); },
    get listenerCount() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0); },
  };
}

function makeHarness({ width = 1200, height = 800, dpr = 1, reducedMotion = false,
  imagesReady = true, missing, noContext = false, noSampler = false, retainSamples = Infinity } = {}) {
  let now = 0;
  let nextFrame = 0;
  let layoutReads = 0;
  const frames = new Map();
  const intersections = new Set();
  const resizes = new Set();
  const images = [];
  const imageGates = new Map();
  const canvases = [];
  const samples = [];
  const geometry = { width, height };
  const createCanvas = role => {
    const canvas = { role, width: 0, height: 0 };
    let matrix = [1, 0, 0, 1, 0, 0];
    let pixels;
    const stack = [];
    const multiply = ([a, b, c, d, e, f]) => {
      const [ma, mb, mc, md, me, mf] = matrix;
      matrix = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d,
        ma * e + mc * f + me, mb * e + md * f + mf];
    };
    const point = (x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5] });
    const context = {
      transforms: [], draws: [], translations: [], arcs: [], arcCount: 0, clearCount: 0,
      setTransform(...values) { this.transforms.push(values); matrix = [...values]; },
      clearRect() { this.clearCount++; this.draws = []; this.translations = []; this.arcs = []; },
      save() { stack.push([...matrix]); },
      restore() { assert.ok(stack.length, 'Canvas restore has no matching save'); matrix = stack.pop(); },
      scale(x, y) { multiply([x, 0, 0, y, 0, 0]); },
      rotate(angle) { multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]); },
      translate(x, y) { this.translations.push({ x, y }); multiply([1, 0, 0, 1, x, y]); },
      drawImage(image, ...args) {
        const species = image.species || image.src;
        canvas.species ||= species;
        const [x, y, width, height] = args.length === 8 ? args.slice(4)
          : args.length === 4 ? args : [...args, image.width, image.height];
        const corners = [point(x, y), point(x + width, y), point(x, y + height), point(x + width, y + height)];
        this.draws.push({ species, args, bounds: {
          left: Math.min(...corners.map(corner => corner.x)), right: Math.max(...corners.map(corner => corner.x)),
          top: Math.min(...corners.map(corner => corner.y)), bottom: Math.max(...corners.map(corner => corner.y)),
        } });
      },
      getImageData(_x, _y, sampleWidth, sampleHeight) {
        if (pixels?.length !== sampleWidth * sampleHeight * 4) pixels = new Uint8ClampedArray(sampleWidth * sampleHeight * 4);
        const data = pixels;
        data.fill(0);
        if (role === 'sampler') {
          const bounds = new Map();
          for (const draw of this.draws) {
            const box = bounds.get(draw.species) || { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
            box.left = Math.min(box.left, draw.bounds.left); box.right = Math.max(box.right, draw.bounds.right);
            box.top = Math.min(box.top, draw.bounds.top); box.bottom = Math.max(box.bottom, draw.bounds.bottom);
            bounds.set(draw.species, box);
          }
          samples.push({ sources: [...new Set(this.draws.map(draw => draw.species))],
            positions: this.translations.map(value => ({ ...value })),
            strips: this.draws.map(draw => [...draw.args]),
            bounds: [...bounds].map(([species, box]) => ({ species, ...box })),
            width: sampleWidth, height: sampleHeight });
          if (samples.length > retainSamples) samples.splice(0, samples.length - retainSamples);
          if (this.draws.length) {
            const center = Math.floor(sampleHeight / 2) * sampleWidth + Math.floor(sampleWidth / 2);
            data.set([160, 190, 210, 255, 160, 190, 210, 255], center * 4);
          }
        } else if (this.draws.length) {
          // A small opaque fish interior surrounded by transparent image margins.
          for (let y = 1; y < sampleHeight - 1; y++) {
            for (let x = 1; x < sampleWidth - 1; x++) data.set([160, 190, 210, 255], (y * sampleWidth + x) * 4);
          }
        }
        return { data };
      },
      beginPath() {}, arc(x, y, radius) { this.arcCount++; this.arcs.push({ x, y, radius }); }, fill() {},
    };
    canvas.context = context;
    canvas.getContext = () => (role === 'main' && noContext) || (role === 'sampler' && noSampler) ? null : context;
    canvases.push(canvas);
    return canvas;
  };
  const canvas = createCanvas('main');
  const footer = { getBoundingClientRect() { layoutReads++; return { ...geometry }; } };
  const window = { ...eventTarget(), devicePixelRatio: dpr };
  const preference = { ...eventTarget(), matches: reducedMotion };
  const document = { ...eventTarget(), hidden: false,
    querySelector(selector) {
      if (selector === missing) return null;
      return selector === '#footer-fish' ? canvas : selector === '#landing' ? footer : null;
    },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return createCanvas(canvases.length === 1 ? 'sampler' : 'asset');
    },
  };
  const context = vm.createContext({
    window, document,
    matchMedia: query => {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return preference;
    },
    Image: class {
      constructor() {
        this.naturalWidth = this.width = 12;
        this.naturalHeight = this.height = 8;
        const promise = new Promise((resolve, reject) => imageGates.set(this, { resolve, reject }));
        this.decode = () => promise;
        images.push(this);
        if (imagesReady) imageGates.get(this).resolve();
      }
    },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { assert.equal(target, footer); intersections.add(this); }
      disconnect() { intersections.delete(this); }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { assert.equal(target, footer); resizes.add(this); }
      disconnect() { resizes.delete(this); }
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  vm.runInContext(source.replace('export function initFooterFish', 'function initFooterFish')
    + '\nthis.controller = initFooterFish();', context);
  return {
    controller: context.controller, canvas, footer, canvases, samples, images, geometry, window, document, preference,
    get pendingFrames() { return frames.size; },
    get observerCount() { return intersections.size + resizes.size; },
    get layoutReads() { return layoutReads; },
    get lastSample() { return samples.at(-1); },
    tick(milliseconds = 16) {
      now += milliseconds;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(now);
    },
    visible(value) { for (const observer of [...intersections]) observer.callback([{ target: footer, isIntersecting: value }]); },
    resize() { for (const observer of [...resizes]) observer.callback([{ target: footer }]); },
    async settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); },
    async load(index) { imageGates.get(images[index]).resolve(); await this.settle(); },
    async reject(index) { imageGates.get(images[index]).reject(new Error('Fish image unavailable')); await this.settle(); },
  };
}

function assertFishInside(h, expected = 2) {
  const sample = h.lastSample;
  assert.equal(sample.bounds.length, expected, 'A decoded fish disappeared instead of fitting inside the footer');
  const dots = h.canvas.context.arcs;
  const cell = dots[1].x - dots[0].x;
  assert.ok(cell > 0, 'Could not measure the displayed sampling-grid spacing');
  const dpr = h.canvas.context.transforms.at(-1)[0];
  const width = h.canvas.width / dpr;
  const height = h.canvas.height / dpr;
  for (const box of sample.bounds) {
    assert.ok(box.left >= 0 && box.top >= 0 && box.right <= sample.width && box.bottom <= sample.height,
      `${box.species} has a transformed body strip outside the sampling surface`);
    // One grid cell also contains the final dot radius and its grid snapping.
    assert.ok(box.left * cell >= cell && box.top * cell >= cell
      && box.right * cell <= width - cell && box.bottom * cell <= height - cell,
    `${box.species} clips against the ${width}x${height} footer after rotation or tail deformation`);
  }
  return cell;
}

const tests = [
  ['every deformed fish stays inside the footer through minutes of swimming and live resizing', async () => {
    const h = makeHarness({ width: 320, height: 640, retainSamples: 1 });
    await h.settle(); h.visible(true); h.tick();
    for (const [width, height, duration] of [[320, 640, 120000], [1440, 900, 180000], [844, 390, 120000]]) {
      h.geometry.width = width; h.geometry.height = height; h.resize(); h.tick(0);
      let cell = assertFishInside(h);
      let previous = h.lastSample.positions;
      const directions = [new Set(), new Set()];
      const layoutReads = h.layoutReads;
      for (let elapsed = 0; elapsed < duration; elapsed += 50) {
        h.tick(50);
        cell = assertFishInside(h);
        const current = h.lastSample.positions;
        current.forEach((position, index) => {
          const dx = (position.x - previous[index].x) * cell;
          const dy = (position.y - previous[index].y) * cell;
          if (Math.abs(dx) > .0001) directions[index].add(Math.sign(dx));
          assert.ok(Math.hypot(dx, dy) < 3, 'A fish teleported when reaching a footer edge');
        });
        previous = current;
        assert.equal(h.pendingFrames, 1, 'Boundary turns changed the number of animation loops');
      }
      assert.ok(directions.every(values => values.size === 2), 'A fish did not turn and return during the swim');
      assert.equal(h.layoutReads, layoutReads, 'Bounded swimming repeatedly measured the footer');
      assert.equal(h.samples.length, 1, 'The long-running geometry test retained old drawing frames');
    }
    h.controller.cleanup();
  }],
  ['initial static fish and late-decoded fish fit after portrait landscape and wide resizes', async () => {
    const h = makeHarness({ width: 390, height: 844, reducedMotion: true, imagesReady: false, retainSamples: 1 });
    h.visible(true);
    await h.load(0); assertFishInside(h, 1);
    await h.load(1); assertFishInside(h);
    for (const [width, height, dpr] of [[320, 568, 3], [844, 220, 2], [1920, 540, 1], [371.6, 900.4, 1.5]]) {
      h.geometry.width = width; h.geometry.height = height; h.window.devicePixelRatio = dpr;
      h.resize(); h.tick(0); assertFishInside(h);
      assert.equal(h.pendingFrames, 0, 'A reduced-motion resize began swimming');
    }
    h.controller.cleanup();
  }],
  ['offscreen fish do no recurring work and visible fish swim through a dotted canvas', async () => {
    const h = makeHarness(); await h.settle();
    assert.equal(h.pendingFrames, 0, 'Offscreen images started a swimming loop');
    const offscreenSamples = h.samples.length;
    h.tick(1000); assert.equal(h.samples.length, offscreenSamples);
    h.visible(true); assert.equal(h.pendingFrames, 1);
    h.tick();
    assert.equal(h.lastSample.sources.length, 2, 'Both decoded fish did not join the footer');
    const initial = h.lastSample;
    for (let index = 0; index < 6; index++) h.tick(16);
    assert.notDeepEqual(h.lastSample.positions, initial.positions, 'Fish did not swim');
    assert.notDeepEqual(h.lastSample.strips, initial.strips, 'The body remained rigid during swimming');
    assert.ok(h.canvas.context.arcCount > 0, 'Fish were never rendered as dots');
    assert.equal(h.pendingFrames, 1, 'Multiple animation loops were scheduled');
    h.controller.cleanup();
  }],
  ['offscreen and hidden intervals pause swimming without a catch-up jump', async () => {
    const h = makeHarness(); await h.settle(); h.visible(true); h.tick(); h.tick(32);
    for (const pause of ['offscreen', 'hidden']) {
      const before = h.lastSample.positions;
      if (pause === 'offscreen') h.visible(false);
      else { h.document.hidden = true; h.document.emit('visibilitychange'); }
      assert.equal(h.pendingFrames, 0);
      const draws = h.samples.length;
      h.tick(60000); assert.equal(h.samples.length, draws, 'Paused fish kept drawing');
      if (pause === 'offscreen') h.visible(true);
      else { h.document.hidden = false; h.document.emit('visibilitychange'); }
      h.tick();
      assert.deepEqual(h.lastSample.positions, before, 'Fish integrated time spent outside the visible footer');
      h.tick(16); assert.notDeepEqual(h.lastSample.positions, before);
    }
    h.controller.cleanup();
  }],
  ['reduced motion presents static fish and preference changes start or stop a single loop', async () => {
    const h = makeHarness({ reducedMotion: true }); await h.settle(); h.visible(true);
    assert.equal(h.lastSample.sources.length, 2, 'Reduced motion hid the fish entirely');
    assert.equal(h.pendingFrames, 0);
    const still = h.lastSample.positions;
    h.tick(1000); assert.deepEqual(h.lastSample.positions, still);
    h.preference.matches = false; h.preference.emit('change');
    assert.equal(h.pendingFrames, 1); h.tick(); h.tick(32);
    assert.notDeepEqual(h.lastSample.positions, still);
    h.preference.matches = true; h.preference.emit('change');
    assert.equal(h.pendingFrames, 0);
    const sampleCount = h.samples.length;
    h.tick(1000); assert.equal(h.samples.length, sampleCount);
    h.controller.cleanup();
  }],
  ['each late image joins independently and a rejected fish never stops the healthy one', async () => {
    const h = makeHarness({ imagesReady: false }); h.visible(true);
    assert.equal(h.pendingFrames, 0, 'Unloaded images retained an empty animation loop');
    await h.load(0); assert.equal(h.pendingFrames, 1); h.tick();
    assert.deepEqual(h.lastSample.sources, [h.images[0].src]);
    const first = h.lastSample.positions;
    await h.reject(1); h.tick(32);
    assert.deepEqual(h.lastSample.sources, [h.images[0].src]);
    assert.notDeepEqual(h.lastSample.positions, first, 'One rejected image stopped the other fish');
    assert.equal(h.pendingFrames, 1);
    h.controller.cleanup();
    const late = makeHarness({ imagesReady: false }); late.visible(true);
    await late.load(1); late.tick();
    assert.deepEqual(late.lastSample.sources, [late.images[1].src]);
    await late.load(0); late.tick();
    assert.equal(late.lastSample.sources.length, 2, 'The second decoded fish failed to join a running renderer');
    assert.equal(late.pendingFrames, 1);
    late.controller.cleanup();
  }],
  ['all failed assets leave no animation loop while resize remains safe', async () => {
    const h = makeHarness({ imagesReady: false }); h.visible(true);
    await h.reject(0); await h.reject(1);
    assert.equal(h.pendingFrames, 0);
    h.geometry.width = 600; h.resize(); h.tick();
    assert.equal(h.pendingFrames, 0);
    assert.equal(h.lastSample.sources.length, 0);
    h.controller.cleanup();
  }],
  ['resize coalesces work and caps display density while keeping the sampling surface small', async () => {
    const h = makeHarness({ dpr: 4 }); await h.settle();
    for (const [width, height, dpr] of [[1200, 800, 4], [371.6, 900.4, 3], [900, 500, 1]]) {
      h.geometry.width = width; h.geometry.height = height; h.window.devicePixelRatio = dpr;
      const reads = h.layoutReads;
      h.resize(); h.resize(); h.window.emit('resize');
      assert.equal(h.pendingFrames, 1, 'Resize notifications scheduled competing measurements');
      h.tick();
      assert.equal(h.layoutReads, reads + 1);
      const scale = Math.min(2, dpr);
      assert.equal(h.canvas.width, Math.round(width) * scale);
      assert.equal(h.canvas.height, Math.round(height) * scale);
      const sampler = h.canvases.find(canvas => canvas.role === 'sampler');
      assert.ok(sampler.width * sampler.height < Math.round(width) * Math.round(height) / 16,
        'Dotted rendering sampled a full-resolution surface');
      assert.equal(h.pendingFrames, 0, 'Offscreen resize retained a drawing loop');
    }
    h.controller.cleanup();
  }],
  ['animation frames do not read layout or repeat asset preparation', async () => {
    const h = makeHarness(); await h.settle(); h.visible(true); h.tick();
    const reads = h.layoutReads;
    const canvasCount = h.canvases.length;
    for (let index = 0; index < 60; index++) h.tick(16);
    assert.equal(h.layoutReads, reads, 'A swimming frame read DOM geometry');
    assert.equal(h.canvases.length, canvasCount, 'Swimming recreated asset surfaces');
    assert.equal(h.images.length, 2, 'Swimming requested new images');
    h.controller.cleanup();
  }],
  ['cleanup removes observers listeners and both frame types and ignores late decoding', async () => {
    for (const imagesReady of [true, false]) {
      const h = makeHarness({ imagesReady }); await h.settle(); h.visible(true); h.tick(); h.resize();
      h.controller.cleanup(); h.controller.cleanup();
      assert.equal(h.pendingFrames, 0);
      assert.equal(h.observerCount, 0);
      assert.equal(h.window.listenerCount, 0);
      assert.equal(h.document.listenerCount, 0);
      assert.equal(h.preference.listenerCount, 0);
      const draws = h.samples.length;
      const canvasCount = h.canvases.length;
      await h.load(0); await h.load(1);
      h.visible(true); h.resize(); h.window.emit('resize'); h.document.emit('visibilitychange');
      h.preference.emit('change'); h.tick(60000);
      assert.equal(h.samples.length, draws, 'A disposed renderer drew again');
      assert.equal(h.canvases.length, canvasCount, 'Late images created surfaces after disposal');
      assert.equal(h.pendingFrames, 0);
    }
  }],
  ['missing markup or unavailable canvas contexts return harmless controllers', async () => {
    for (const options of [{ missing: '#footer-fish' }, { missing: '#landing' }, { noContext: true }, { noSampler: true }]) {
      const h = makeHarness(options); h.controller.cleanup(); await h.settle();
      assert.equal(h.images.length, 0);
      assert.equal(h.observerCount, 0);
      assert.equal(h.window.listenerCount, 0);
      assert.equal(h.document.listenerCount, 0);
      assert.equal(h.preference.listenerCount, 0);
      assert.equal(h.pendingFrames, 0);
    }
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} footer fish scenarios passed`);
process.exitCode = failed ? 1 : 0;
