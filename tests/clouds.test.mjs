import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/clouds.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../site/styles.css', import.meta.url), 'utf8');
const carrierOffsets = new WeakMap();

function eventTarget() {
  const events = new Map();
  return {
    addEventListener(type, callback, options = {}) {
      if (!events.has(type)) events.set(type, new Map());
      events.get(type).set(callback, options);
    },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
    emit(type) {
      for (const [callback, options] of [...events.get(type) || []]) {
        callback({ type, target: this });
        if (options.once) events.get(type).delete(callback);
      }
    },
    get listenerCount() { return [...events.values()].reduce((sum, listeners) => sum + listeners.size, 0); },
  };
}

function makeHarness({ missingScene = false, reducedMotion = false, width = 390, height = 780,
  scroll = 0, imagesReady = true, holdDistance = 0 } = {}) {
  let nextFrame = 0;
  let created = 0;
  let time = 0;
  let routeTotal = 0;
  const frames = new Map();
  const imagePromises = new Map();
  const writes = [];
  const element = tag => {
    const node = {
      ...eventTarget(), tag, children: [], hidden: false,
      style: new Proxy({ setProperty(name, value) { this[name] = value; } }, {
        set(target, name, value) { writes.push([name, value]); target[name] = value; return true; },
      }),
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
    };
    carrierOffsets.set(node, scroll => routeTotal > 0
      ? Math.max(0, Math.min(holdDistance, scroll - routeTotal)) : 0);
    if (tag === 'img') {
      node.complete = imagesReady;
      node.naturalWidth = imagesReady ? 1 : 0;
      let resolve, reject;
      const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
      node.decode = () => promise;
      imagePromises.set(node, { resolve, reject });
      if (imagesReady) resolve();
    }
    return node;
  };
  const scene = element('scene');
  scene.hidden = true;
  const window = { ...eventTarget(), innerWidth: width, innerHeight: height, scrollY: scroll };
  const motion = { ...eventTarget(), matches: reducedMotion };
  const document = {
    ...eventTarget(), hidden: false,
    querySelector(selector) {
      assert.equal(selector, '.cloud-scene');
      return missingScene ? null : scene;
    },
    createElement(tag) { created++; return element(tag); },
  };
  const context = vm.createContext({
    window, document, performance: { now: () => time },
    getHoldDistance: () => holdDistance,
    matchMedia(query) {
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return motion;
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  vm.runInContext(source.replace('export function initClouds', 'function initClouds')
    + '\nthis.controller = initClouds({ getHoldDistance });', context);
  const controller = {
    setRoute(route) {
      routeTotal = Number.isFinite(route?.total) && route.total > 0 ? route.total : 0;
      return context.controller.setRoute(route);
    },
    cleanup() { return context.controller.cleanup(); },
  };
  return {
    scene, window, document, motion, writes, controller,
    get clouds() { return scene.children.flatMap(layer => layer.children); },
    get pendingFrames() { return frames.size; },
    get created() { return created; },
    tick(milliseconds = 16) {
      time += milliseconds;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(time);
    },
    advance(milliseconds) {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) this.tick(Math.min(16, milliseconds - elapsed));
    },
    async settle() { for (let index = 0; index < 6; index++) await Promise.resolve(); },
    async loadImage(image) {
      image.complete = true;
      image.naturalWidth = image.width || 1;
      image.emit('load');
      imagePromises.get(image).resolve();
      await this.settle();
    },
    async rejectImage(image) {
      image.complete = true;
      image.naturalWidth = 0;
      imagePromises.get(image).reject(new Error('Image decoding failed'));
      await this.settle();
    },
    scrollTo(position) { window.scrollY = position; window.emit('scroll'); this.tick(); },
    snapshot() {
      return { hidden: scene.hidden,
        clouds: this.clouds.map(cloud => ({ hidden: cloud.hidden, width: cloud.style.width,
          left: cloud.style.left, top: cloud.style.top, transform: cloud.style.transform })) };
    },
  };
}

const cssRules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const rule = selector => cssRules.filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
  .map(([, , declarations]) => declarations).join('\n');
const zIndex = selector => Number(rule(selector).match(/z-index:\s*(-?\d+)/)?.[1]);

function imageBox(cloud, scroll = 0) {
  const image = cloud.children[0];
  assert.ok(image.width > 0 && image.height > 0, 'Cloud image dimensions are unavailable before loading');
  const width = parseFloat(cloud.style.width);
  const height = width * image.height / image.width;
  const translation = cloud.style.transform.match(/translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px,\s*0\s*\)/);
  assert.ok(translation, 'Cloud scroll transform could not be measured');
  const left = parseFloat(cloud.style.left) + Number(translation[1]) - width / 2;
  const localTop = parseFloat(cloud.style.top) + Number(translation[2]) - height / 2;
  const top = localTop - scroll + (carrierOffsets.get(cloud)?.(scroll) || 0);
  return { left, top, localTop, right: left + width, bottom: top + height, width, height };
}

async function readyHarness(options = {}, route = { total: 800, heroHeight: 800 }) {
  const h = makeHarness(options);
  await h.settle();
  h.controller.setRoute(route);
  h.tick(0);
  return h;
}
const centerX = cloud => {
  const box = imageBox(cloud);
  return box.left + box.width / 2;
};
function hasHorizontalGap(boxes, y, width) {
  let covered = 0;
  for (const box of boxes.filter(box => box.top <= y && box.bottom >= y).sort((a, b) => a.left - b.left)) {
    if (box.right <= 0 || box.left >= width) continue;
    if (box.left > covered) return true;
    covered = Math.max(covered, box.right);
  }
  return covered < width;
}

const tests = [

  ['decoded clouds leave the initial hero completely clear and idle', async () => {
    for (const [width, height] of [[320, 640], [390, 800], [768, 900], [1440, 800], [1920, 1080]]) {
      const h = await readyHarness({ width, height }, { total: height, heroHeight: height });
      assert.ok(h.clouds.some(cloud => !cloud.hidden) && h.clouds.some(cloud => cloud.hidden),
        'Startup must seed visible sprites and reserve dormant sprites');
      assert.ok(h.clouds.length <= 16, 'The cloud pool exceeds its bound');
      assert.equal(h.scene.hidden, false);
      assert.ok(h.clouds.every(cloud => cloud.hidden || imageBox(cloud).top >= height),
        `A decoded cloud is visible in the initial ${width} x ${height} hero`);
      assert.equal(h.pendingFrames, 0, 'The initial offscreen clouds retained a wind loop');
      h.controller.cleanup();
    }
  }],

  ['route-before-decode startup also leaves the initial hero clear', async () => {
    const h = makeHarness({ imagesReady: false, height: 800 });
    h.controller.setRoute({ total: 800, heroHeight: 800 });
    assert.ok(h.clouds.every(cloud => cloud.hidden));
    for (const cloud of h.clouds) await h.loadImage(cloud.children[0]);
    h.tick(0);
    assert.ok(h.clouds.every(cloud => cloud.hidden || imageBox(cloud).top >= 800));
    assert.equal(h.pendingFrames, 0);
    h.controller.cleanup();
  }],

  ['individual clouds have distinct positions sizes and depths with open space between them', async () => {
    for (const [width, height] of [[390, 844], [1440, 900], [1920, 540]]) {
      const h = await readyHarness({ width, height }, { total: height, heroHeight: height });
      const initial = h.clouds.filter(cloud => !cloud.hidden).map(cloud => imageBox(cloud));
      assert.ok(initial.every(box => box.width < width), 'A cloud spans the whole viewport like a wall');
      assert.ok(new Set(initial.map(box => box.width.toFixed(1))).size > 1, 'All clouds have the same size');
      assert.ok(new Set(initial.map(box => box.top.toFixed(1))).size > 1, 'Clouds are arranged in one flat row');
      assert.ok(new Set(h.clouds.map(cloud => centerX(cloud).toFixed(1))).size > 1, 'Clouds share one horizontal position');
      h.scrollTo(height * .35);
      const before = h.clouds.map(cloud => imageBox(cloud, h.window.scrollY));
      const visible = before.find(box => box.bottom > 0 && box.top < height && box.right > 0 && box.left < width);
      assert.ok(visible, 'No cloud enters during the descent');
      const y = (Math.max(0, visible.top) + Math.min(height, visible.bottom)) / 2;
      assert.ok(hasHorizontalGap(before.filter((_, index) => !h.clouds[index].hidden), y, width), 'Clouds form an uninterrupted horizontal wall');
      h.scrollTo(height * .55);
      const movements = h.clouds.map((cloud, index) =>
        (before[index].top - imageBox(cloud, h.window.scrollY).top).toFixed(1));
      assert.ok(new Set(movements).size > 1, 'Clouds all move on the same depth plane');
      h.scrollTo(height);
      assert.ok(h.clouds.every(cloud => imageBox(cloud, height).bottom <= height * .4),
        'Clouds obscure the lower landing area');
      h.controller.cleanup();
    }
  }],

  ['scrolling carries live clouds continuously and leaves the initial hero clear on return', async () => {
    const h = await readyHarness({ height: 800 });
    let previous;
    let crossed = false;
    for (const scroll of [...Array.from({ length: 67 }, (_, index) => index * 24), 1600]) {
      h.scrollTo(scroll);
      assert.equal(h.scene.hidden, false, 'Scrolling toggled scene visibility');
      const current = h.clouds.map(cloud => ({ hidden: cloud.hidden, width: cloud.style.width,
        top: cloud.style.top, box: imageBox(cloud, scroll) }));
      current.forEach((cloud, index) => {
        if (!cloud.hidden && cloud.box.top < 800 && cloud.box.bottom > 0) crossed = true;
        const before = previous?.[index];
        if (before && !before.hidden && !cloud.hidden && before.top === cloud.top && before.width === cloud.width) {
          assert.ok(cloud.box.top <= before.box.top + .02, 'A live cloud jumped down during descent');
        }
      });
      previous = current;
    }
    assert.ok(crossed, 'No live cloud entered during descent');
    assert.ok(h.clouds.every(cloud => cloud.hidden || imageBox(cloud, 1600).bottom < 0));
    h.scrollTo(0);
    assert.ok(h.clouds.every(cloud => cloud.hidden || imageBox(cloud).top >= 800));
    assert.equal(h.pendingFrames, 0);
    assert.ok(h.writes.every(([name]) => !/opacity|visibility|display/i.test(name)), 'Scroll rendering faded the clouds');
    for (const selector of ['.cloud-scene', '.cloud-layer', '.cloud-layer--near', '.cloud', '.cloud img']) {
      assert.doesNotMatch(rule(selector), /(?:opacity|visibility)\s*:/);
    }
    h.controller.cleanup();
  }],
  ['wind moves left while idle and accelerates during either scroll direction', async () => {
    const h = await readyHarness({ width: 1440, height: 800 });
    h.scrollTo(400);
    h.advance(2000);
    const cloud = h.clouds[1];
    const measureTravel = scrollStep => {
      const start = centerX(cloud);
      let previous = start;
      for (let index = 0; index < 64; index++) {
        if (scrollStep) { h.window.scrollY += scrollStep; h.window.emit('scroll'); }
        h.tick(16);
        const current = centerX(cloud);
        assert.ok(current < previous, 'A cloud stopped or reversed its leftward wind');
        previous = current;
      }
      return start - previous;
    };
    const idle = measureTravel(0);
    const descending = measureTravel(2);
    const ascending = measureTravel(-2);
    assert.ok(idle > 0, 'Idle clouds stopped moving');
    assert.ok(descending > idle * 1.2, 'Downward scrolling did not make wind noticeably faster');
    assert.ok(ascending > idle * 1.2, 'Upward scrolling slowed or reversed the wind');
    h.advance(3000);
    const settled = measureTravel(0);
    assert.ok(settled > 0 && settled < idle * 1.2, 'Wind did not settle back to slow idle motion');
    h.controller.cleanup();
  }],

  ['cloud height stays fixed through the held garden and reverses before leaving normally', async () => {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const h = await readyHarness({ width, height, holdDistance: height },
        { total: height, heroHeight: height });
      h.scrollTo(height);
      const baseline = h.clouds.map(cloud => imageBox(cloud, height));
      const visible = () => h.clouds.filter(cloud => !cloud.hidden).map(cloud => imageBox(cloud, h.window.scrollY))
        .filter(box => box.right > 0 && box.left < width && box.bottom > 0 && box.top < height);
      const moving = h.clouds.find(cloud => !cloud.hidden && centerX(cloud) > width * .5);
      assert.ok(moving, 'No live cloud can demonstrate wind during the hold');
      let previousX = centerX(moving);
      for (const fraction of [1.1, 1.4, 1.75, 2, 1.6, 1.2, 1]) {
        h.scrollTo(height * fraction);
        h.clouds.forEach((cloud, index) => {
          const box = imageBox(cloud, h.window.scrollY);
          assert.ok(Math.abs(box.top - baseline[index].top) < .02,
            `Cloud height moved during the held garden at ${fraction} route lengths`);
          assert.ok(Math.abs(box.localTop - baseline[index].localTop) < .02,
            'A cloud countertranslated inside the already-sticky scene');
        });
        assert.ok(visible().length > 0, 'Holding the garden carried every cloud out of view');
        assert.equal(h.pendingFrames, 1, 'The held cloud field stopped its wind loop');
        assert.ok(centerX(moving) < previousX, 'Hold or reverse scroll stopped or reversed the wind');
        previousX = centerX(moving);
      }
      h.scrollTo(height * 2.1);
      h.clouds.forEach((cloud, index) => assert.ok(imageBox(cloud, h.window.scrollY).top < baseline[index].top,
        'A cloud remained vertically pinned after the garden hold ended'));
      h.scrollTo(height * 3);
      assert.ok(h.clouds.every(cloud => cloud.hidden || imageBox(cloud, h.window.scrollY).bottom < 0),
        'Clouds remained visible after leaving the held garden');
      assert.equal(h.pendingFrames, 0, 'The departed cloud field kept running');
      h.scrollTo(height * 1.5);
      h.clouds.forEach((cloud, index) => {
        const box = imageBox(cloud, h.window.scrollY);
        assert.ok(Math.abs(box.top - baseline[index].top) < .02,
          'Returning from below changed a cloud\'s held height');
        assert.ok(Math.abs(box.localTop - baseline[index].localTop) < .02,
          'Returning from below did not restore the held camera position');
      });
      assert.ok(visible().length > 0);
      h.scrollTo(0);
      assert.ok(h.clouds.every(cloud => cloud.hidden || imageBox(cloud).top >= height));
      assert.equal(h.pendingFrames, 0);
      h.controller.cleanup();
    }
  }],

  ['landing clouds stay above the statement through long idle emission and viewport resizing', async () => {
    const height = 800;
    const total = height;
    const h = await readyHarness({ width: 390, height, holdDistance: height }, { total, heroHeight: height });
    assert.ok(h.clouds.every(cloud => imageBox(cloud).top >= height + 16 - .01),
      'Raising the landing band exposed a cloud on the initial hero');
    assert.equal(h.pendingFrames, 0);
    h.scrollTo(total + height * .5);
    for (const [width, ceiling] of [[390, .18], [1440, .23], [320, .18], [1920, .23]]) {
      h.window.innerWidth = width; h.window.emit('resize'); h.tick(0);
      let previous = h.clouds.map(cloud => ({ hidden: cloud.hidden, left: imageBox(cloud).left }));
      let lateArrivals = 0;
      for (let frame = 0; frame < 2400; frame++) {
        h.tick(50);
        h.clouds.forEach((cloud, index) => {
          const box = imageBox(cloud, h.window.scrollY);
          assert.ok(box.bottom <= height * ceiling + .02,
            `A cloud entered the statement area at ${width}px after ${frame * 50}ms`);
          if (!cloud.hidden && (previous[index].hidden || box.left > previous[index].left + 1)) {
            assert.ok(box.left > width, 'A new landing cloud appeared inside the viewport');
            if (frame >= 1200) lateArrivals++;
          }
          previous[index] = { hidden: cloud.hidden, left: box.left };
        });
        assert.equal(h.pendingFrames, 1, 'The raised landing bank stopped emitting');
        if (frame % 200 === 0) {
          const visible = h.clouds.filter(cloud => !cloud.hidden)
            .map(cloud => imageBox(cloud, h.window.scrollY))
            .filter(box => box.left < width && box.right > 0 && box.bottom > 0);
          assert.ok(visible.length > 0, 'Raising the cloud band removed every visible cloud');
          h.writes.length = 0;
        }
      }
      assert.ok(lateArrivals > 0, 'The landing band exhausted its arrivals after the first minute');
      const bottoms = h.clouds.map(cloud => Math.round(imageBox(cloud, h.window.scrollY).bottom));
      assert.ok(new Set(bottoms).size >= 4, 'Landing clouds collapsed to one shared height');
    }
    h.scrollTo(0);
    assert.ok(h.clouds.every(cloud => imageBox(cloud).top >= height + 16 - .01),
      'Reused landing clouds appeared on the hero when returning to the top');
    assert.equal(h.pendingFrames, 0);
    h.controller.cleanup();
  }],

  ['the landing ceiling changes continuously across mobile and desktop widths', async () => {
    const height = 800;
    const h = await readyHarness({ width: 580, height, holdDistance: height });
    h.scrollTo(height * 1.5);
    let previous = h.clouds.map(cloud => imageBox(cloud, h.window.scrollY).bottom);
    for (let width = 581; width <= 620; width++) {
      h.window.innerWidth = width; h.window.emit('resize'); h.tick(0);
      const current = h.clouds.map(cloud => imageBox(cloud, h.window.scrollY).bottom);
      current.forEach((bottom, index) => {
        assert.ok(Math.abs(bottom - previous[index]) < .5,
          `A one-pixel viewport resize jumped a cloud vertically at ${width}px`);
        assert.ok(bottom < height * .20, 'An intermediate viewport placed clouds below the safe band');
      });
      previous = current;
    }
    h.controller.cleanup();
  }],

  ['held garden scrolling still boosts wind in both directions', async () => {
    const height = 800;
    const h = await readyHarness({ width: 1440, height, holdDistance: height });
    h.scrollTo(height * 1.5);
    h.advance(2000);
    const cloud = h.clouds.find(cloud => !cloud.hidden && centerX(cloud) > h.window.innerWidth * .6);
    assert.ok(cloud, 'No live cloud is available to compare held wind speeds');
    const fixedTop = imageBox(cloud, h.window.scrollY).top;
    const measureTravel = step => {
      const start = centerX(cloud);
      let previous = start;
      for (let index = 0; index < 64; index++) {
        if (step) { h.window.scrollY += step; h.window.emit('scroll'); }
        h.tick(16);
        assert.ok(centerX(cloud) < previous, 'Held wind stopped or reversed');
        assert.ok(Math.abs(imageBox(cloud, h.window.scrollY).top - fixedTop) < .02,
          'The scroll boost also moved the held cloud vertically');
        previous = centerX(cloud);
      }
      return start - previous;
    };
    const idle = measureTravel(0);
    assert.ok(measureTravel(2) > idle * 1.2, 'Held downward scrolling did not boost wind');
    assert.ok(measureTravel(-2) > idle * 1.2, 'Held upward scrolling did not boost wind');
    h.controller.cleanup();
  }],

  ['fresh clouds keep entering from the right while the garden is held', async () => {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const h = await readyHarness({ width, height, holdDistance: height },
        { total: height, heroHeight: height });
      const seeded = new Set(h.clouds.filter(cloud => !cloud.hidden));
      let previous = h.clouds.map(cloud => ({ hidden: cloud.hidden, box: imageBox(cloud) }));
      const arrivals = new Set();
      let entered = false;
      h.window.scrollY = height * 1.65; h.window.emit('scroll');
      for (let frame = 0; frame < 400; frame++) {
        h.tick(50);
        assert.equal(h.pendingFrames, 1, 'Held idle time starved the cloud emitter');
        h.clouds.forEach((cloud, index) => {
          const before = previous[index];
          const after = { hidden: cloud.hidden, box: imageBox(cloud, h.window.scrollY) };
          if (!after.hidden && (before.hidden || after.box.left > before.box.left + 1)) {
            assert.ok(after.box.left > width, 'A held arrival appeared inside the viewport');
            arrivals.add(cloud);
          } else if (!before.hidden && !after.hidden) {
            assert.ok(after.box.left < before.box.left, 'A held live cloud stopped moving left');
          }
          if (!after.hidden && !seeded.has(cloud) && after.box.left < width && after.box.right > 0
            && after.box.bottom > 0 && after.box.top < height) entered = true;
          previous[index] = after;
        });
        if (frame % 100 === 0) h.writes.length = 0;
      }
      assert.ok(arrivals.size > 1, 'The held garden produced no recurring right-edge arrivals');
      assert.ok(entered, 'Fresh held clouds never moved into the visible viewport');
      h.controller.cleanup();
    }
  }],

  ['new clouds enter from the right within seconds and recur throughout long idle periods', async () => {
    for (const [width, height] of [[390, 844], [1440, 900], [1920, 540]]) {
      const h = await readyHarness({ width, height }, { total: height, heroHeight: height });
      const nodes = h.created;
      const seeded = new Set(h.clouds.filter(cloud => !cloud.hidden));
      let previous = h.clouds.map(cloud => ({ hidden: cloud.hidden, box: imageBox(cloud) }));
      const arrivals = new Set();
      const periods = new Set();
      let newArrivalEntered = false;
      let laterReuses = 0;
      h.window.scrollY = height * .55; h.window.emit('scroll');
      for (let frame = 0; frame < 2400; frame++) {
        h.tick(50);
        const milliseconds = (frame + 1) * 50;
        h.clouds.forEach((cloud, index) => {
          const before = previous[index];
          const after = { hidden: cloud.hidden, box: imageBox(cloud) };
          const respawned = !after.hidden && (before.hidden || after.box.left > before.box.left + 1);
          if (respawned) {
            assert.ok(after.box.left > width, 'A new arrival popped into the viewport');
            if (!before.hidden) assert.ok(before.box.right < 0, 'A visible cloud jumped to the entry edge');
            if (arrivals.has(cloud) && milliseconds >= 60000) laterReuses++;
            arrivals.add(cloud);
            periods.add(Math.floor((milliseconds - 1) / 20000));
          }
          if (!before.hidden && after.hidden) {
            assert.ok(after.box.right < 0, 'A live cloud disappeared before leaving the left edge');
          }
          if (!after.hidden && !seeded.has(cloud) && after.box.left < width && after.box.right > 0 && milliseconds <= 5000) {
            newArrivalEntered = true;
          }
          previous[index] = after;
        });
        assert.ok(h.clouds.length <= 16 && h.created === nodes, 'The emitter grew beyond its reserved pool');
        assert.equal(h.pendingFrames, 1, 'Dormant templates could no longer sustain the emitter');
        if (frame % 200 === 0) {
          const visible = h.clouds.filter(cloud => !cloud.hidden).map(cloud => imageBox(cloud, h.window.scrollY))
            .filter(box => box.right > 0 && box.left < width && box.bottom > 0 && box.top < height);
          assert.ok(visible.length > 1, 'The idle cloud field became empty or isolated');
          assert.ok(visible.some(box => hasHorizontalGap(visible,
            (Math.max(0, box.top) + Math.min(height, box.bottom)) / 2, width)),
          'Idle accumulation turned the cloud field into a continuous wall');
          h.writes.length = 0;
        }
      }
      assert.ok(newArrivalEntered, 'No new cloud entered from the right within five seconds');
      assert.ok(arrivals.size > 1, 'The emitter never produced recurring arrivals');
      assert.equal(periods.size, 6, 'A twenty-second idle period had no new arrival');
      assert.ok(laterReuses > 0, 'The emitter exhausted its initial spare sprites after a minute');
      h.controller.cleanup();
    }
  }],
  ['shallow entry keeps emitting after size and height variation for two idle minutes', async () => {
    const h = await readyHarness({ width: 390, height: 800 });
    h.scrollTo(18);
    let previous = h.clouds.map(cloud => ({ hidden: cloud.hidden, left: imageBox(cloud).left }));
    let laterEmissions = 0;
    for (let frame = 0; frame < 2400; frame++) {
      h.tick(50);
      assert.equal(h.pendingFrames, 1, 'Variation moved the only eligible templates outside the shallow viewport');
      h.clouds.forEach((cloud, index) => {
        const box = imageBox(cloud, h.window.scrollY);
        if (!cloud.hidden && (previous[index].hidden || box.left > previous[index].left + 1)) {
          assert.ok(box.top < 800 && box.bottom > 0, 'An eligible emission varied entirely outside the viewport');
          if (frame >= 1200) laterEmissions++;
        }
        previous[index] = { hidden: cloud.hidden, left: box.left };
      });
      if (frame % 200 === 0) h.writes.length = 0;
    }
    assert.ok(laterEmissions > 0, 'Shallow entry stopped producing new clouds after its first minute');
    h.controller.cleanup();
  }],
  ['route and viewport changes preserve visible cloud centers', async () => {
    const h = await readyHarness({ width: 844, height: 800 });
    h.scrollTo(400); h.advance(300);
    const centers = h.clouds.map(centerX);
    h.controller.setRoute({ total: 900, heroHeight: 900 });
    h.clouds.forEach((cloud, index) => assert.ok(Math.abs(centerX(cloud) - centers[index]) < .02));
    for (const width of [1440, 390, 1920, 320, 844]) {
      const before = h.clouds.map(centerX);
      h.window.innerWidth = width; h.window.emit('resize'); h.tick(0);
      h.clouds.forEach((cloud, index) => {
        const box = imageBox(cloud);
        assert.ok(box.width < width, 'Resizing turned a cloud into a full-width wall');
        if (Math.abs(centerX(cloud) - before[index]) < .02) return;
        assert.ok(before[index] - box.width / 2 > width && box.left > width,
          'Resizing teleported a cloud while it was visible');
      });
    }
    assert.equal(h.window.scrollY, 400);
    h.controller.cleanup();
  }],
  ['late image decoding enters from outside the right edge without appearing in place', async () => {
    const h = makeHarness({ imagesReady: false, height: 800 });
    h.controller.setRoute({ total: 800, heroHeight: 800 });
    h.scrollTo(400);
    assert.ok(h.clouds.every(cloud => cloud.hidden));
    assert.equal(h.pendingFrames, 0, 'Unloaded images kept animation running');
    const [cloud, ...pending] = h.clouds;
    await h.loadImage(cloud.children[0]); h.tick(0);
    assert.equal(cloud.hidden, false);
    assert.ok(imageBox(cloud).left > h.window.innerWidth, 'A late image popped into the visible bank');
    assert.ok(pending.every(element => element.hidden), 'Pending images were exposed');
    const before = centerX(cloud);
    h.tick(50);
    const speed = (before - centerX(cloud)) / .05;
    assert.ok(speed > 0, 'A late-loaded cloud has no entry speed');
    const entryFrames = Math.ceil((imageBox(cloud).left - h.window.innerWidth) / speed / .05) + 2;
    for (let index = 0; index < entryFrames && imageBox(cloud).left >= h.window.innerWidth; index++) {
      h.tick(50);
      if (index % 200 === 0) h.writes.length = 0;
    }
    assert.ok(imageBox(cloud).left < h.window.innerWidth, 'The decoded cloud did not drift into view');
    h.controller.cleanup();
  }],

  ['far and near clouds surround the descent without intercepting interaction', async () => {
    const h = await readyHarness();
    const far = h.scene.children.find(layer => layer.className.includes('cloud-layer--far'));
    const near = h.scene.children.find(layer => layer.className.includes('cloud-layer--near'));
    assert.ok(far?.children.length && near?.children.length);
    assert.ok(zIndex('.cloud-layer') < zIndex('.descent-scene'));
    assert.ok(zIndex('.cloud-layer--near') > zIndex('.descent-scene'));
    assert.match(rule('.cloud-scene'), /pointer-events:\s*none/);
    assert.match(rule('.journey'), /overflow:\s*clip/);
    assert.doesNotMatch(rule('.cloud-scene'), /(?:z-index|opacity|transform|isolation)\s*:/);
    for (const cloud of h.clouds) {
      assert.equal(cloud.children[0].alt, '');
      assert.equal(cloud.children[0].draggable, false);
    }
    h.controller.cleanup();
  }],
  ['invalid routes hide the bank and immediately stop active work', async () => {
    const h = await readyHarness(); h.scrollTo(400);
    for (const route of [null, { total: 0 }, { total: -1 }, { total: NaN }, { total: Infinity }]) {
      h.controller.setRoute({ total: 800 });
      assert.equal(h.scene.hidden, false);
      h.controller.setRoute(route);
      assert.equal(h.scene.hidden, true);
      assert.equal(h.pendingFrames, 0, 'An invalid route retained animation work');
    }
    h.controller.cleanup();
  }],
  ['reduced motion stops the wind and restores current position when disabled', async () => {
    const h = await readyHarness({ reducedMotion: true });
    h.scrollTo(400);
    assert.equal(h.scene.hidden, true);
    assert.equal(h.pendingFrames, 0);
    h.motion.matches = false; h.motion.emit('change'); h.tick();
    assert.equal(h.scene.hidden, false);
    assert.equal(h.pendingFrames, 1);
    h.motion.matches = true; h.motion.emit('change'); h.tick();
    assert.equal(h.scene.hidden, true);
    assert.equal(h.pendingFrames, 0);
    h.controller.cleanup();
  }],
  ['mobile toolbar height changes preserve current cloud geometry', async () => {
    const h = await readyHarness(); h.scrollTo(400); h.advance(200);
    const baseline = h.snapshot();
    for (const height of [840, 760, 820, 780]) {
      h.window.innerHeight = height; h.window.emit('resize'); h.tick(0);
      assert.deepEqual(h.snapshot(), baseline, `Toolbar height ${height} reset cloud geometry`);
    }
    h.controller.cleanup();
  }],
  ['one coalesced animation loop runs only while clouds and document are visible', async () => {
    const h = await readyHarness();
    assert.equal(h.pendingFrames, 0);
    h.scrollTo(400);
    assert.equal(h.pendingFrames, 1);
    const writes = h.writes.length;
    for (const scroll of [410, 420, 430, 440]) { h.window.scrollY = scroll; h.window.emit('scroll'); }
    assert.equal(h.pendingFrames, 1, 'Scroll events queued competing animation loops');
    assert.equal(h.writes.length, writes, 'Scroll listeners wrote outside the animation frame');
    h.tick();
    assert.equal(h.pendingFrames, 1);
    assert.ok(h.writes.length > writes);
    h.document.hidden = true; h.document.emit('visibilitychange'); h.tick(0);
    assert.equal(h.pendingFrames, 0, 'A hidden document retained the wind loop');
    const hiddenWrites = h.writes.length;
    h.advance(1000);
    assert.equal(h.writes.length, hiddenWrites, 'Hidden-page time still moved the clouds');
    h.document.hidden = false; h.document.emit('visibilitychange'); h.tick(0);
    assert.equal(h.pendingFrames, 1);
    h.scrollTo(0);
    assert.equal(h.pendingFrames, 0, 'Clouds below the viewport retained the wind loop');
    h.scrollTo(2000);
    assert.equal(h.pendingFrames, 0, 'Clouds above the viewport retained the wind loop');
    h.controller.cleanup();
  }],
  ['returning to the cloud band does not integrate time spent offscreen', async () => {
    const h = await readyHarness(); h.scrollTo(400); h.advance(200);
    h.scrollTo(2000);
    const center = centerX(h.clouds[1]);
    h.advance(60000);
    assert.equal(centerX(h.clouds[1]), center);
    h.scrollTo(400);
    assert.ok(center - centerX(h.clouds[1]) >= 0 && center - centerX(h.clouds[1]) < 2,
      'Returning to the band jumped through accumulated offscreen time');
    h.controller.cleanup();
  }],
  ['rejected image decoding remains hidden while another late image can enter', async () => {
    const h = makeHarness({ imagesReady: false });
    h.controller.setRoute({ total: 800 }); h.scrollTo(400);
    const [failed, healthy] = h.clouds;
    await h.rejectImage(failed.children[0]); h.tick(0);
    assert.equal(failed.hidden, true);
    assert.equal(h.pendingFrames, 0);
    await h.loadImage(healthy.children[0]); h.tick(0);
    assert.equal(healthy.hidden, false);
    assert.equal(failed.hidden, true);
    assert.equal(h.pendingFrames, 1);
    h.controller.cleanup();
  }],
  ['an image failure leaves healthy clouds moving and never restores the failed sprite', async () => {
    const h = await readyHarness(); h.scrollTo(400);
    const [failed, ...healthy] = h.clouds;
    failed.children[0].emit('error'); h.tick(0);
    assert.equal(failed.hidden, true);
    const before = healthy.map(centerX);
    h.advance(500);
    assert.equal(failed.hidden, true);
    assert.ok(healthy.some(cloud => !cloud.hidden), 'One image failure hid every healthy live cloud');
    assert.notDeepEqual(healthy.map(centerX), before, 'One failed image stopped the healthy clouds');
    for (const cloud of healthy) cloud.children[0].emit('error');
    h.tick(0);
    assert.equal(h.pendingFrames, 0, 'An entirely failed bank retained animation work');
    h.controller.cleanup();
  }],
  ['the cloud bank follows hero height independently of the descent route', async () => {
    const h = await readyHarness({}, { total: 1480, heroHeight: 800 });
    const original = h.clouds.map(cloud => cloud.style.top);
    h.controller.setRoute({ total: 1665, heroHeight: 900 });
    const changed = h.clouds.map(cloud => cloud.style.top);
    assert.notDeepEqual(changed, original);
    h.controller.setRoute({ total: 1900, heroHeight: 900 });
    assert.deepEqual(h.clouds.map(cloud => cloud.style.top), changed);
    h.controller.setRoute({ total: 900 });
    assert.deepEqual(h.clouds.map(cloud => cloud.style.top), changed);
    h.controller.cleanup();
  }],
  ['cleanup removes listeners and pending work and makes late image decoding harmless', async () => {
    const h = makeHarness({ imagesReady: false });
    h.controller.setRoute({ total: 800 }); h.scrollTo(400);
    const image = h.clouds[0].children[0];
    h.controller.cleanup(); h.controller.cleanup();
    assert.equal(h.scene.hidden, true);
    assert.equal(h.scene.children.length, 0);
    assert.equal(h.pendingFrames, 0);
    assert.equal(h.window.listenerCount, 0);
    assert.equal(h.document.listenerCount, 0);
    assert.equal(h.motion.listenerCount, 0);
    const writes = h.writes.length;
    await h.loadImage(image);
    h.window.emit('scroll'); h.window.emit('resize'); h.motion.emit('change'); h.document.emit('visibilitychange');
    h.controller.setRoute({ total: 900 }); h.tick();
    assert.equal(h.writes.length, writes, 'A disposed controller changed cloud presentation');
    assert.equal(h.pendingFrames, 0);
    const active = await readyHarness(); active.scrollTo(400);
    assert.equal(active.pendingFrames, 1);
    active.controller.cleanup();
    assert.equal(active.pendingFrames, 0, 'Cleanup retained its active wind loop');
  }],
  ['a page without a cloud scene receives a harmless controller', async () => {
    const h = makeHarness({ missingScene: true });
    h.controller.setRoute({ total: 800 }); h.controller.setRoute(null); h.controller.cleanup();
    await h.settle();
    assert.equal(h.created, 0);
    assert.equal(h.window.listenerCount, 0);
    assert.equal(h.document.listenerCount, 0);
    assert.equal(h.motion.listenerCount, 0);
    assert.equal(h.pendingFrames, 0);
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} cloud scenarios passed`);
process.exitCode = failed ? 1 : 0;
