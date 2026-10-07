import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/app.js', import.meta.url), 'utf8');
// Replace only module bindings; run the actual startup flow with controlled assets.
const script = source.replace(/^import .*;\r?$/gm, '')
  .replace("import('./background.js')", 'loadBackground()');
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function eventTarget() {
  const events = new Map();
  return {
    addEventListener(type, listener) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(listener);
    },
    removeEventListener(type, listener) { events.get(type)?.delete(listener); },
    emit(type, event = {}) {
      for (const listener of [...events.get(type) || []]) listener({ target: this, ...event });
    },
  };
}

function makeHarness({ fonts = 'ready', images = 'ready', background = 'ready', clouds = 'ready', garden = 'ready', fishing = 'ready',
  footerFish = 'ready', reducedMotion = false, initialRoute } = {}) {
  let now = 0;
  let nextTimer = 0;
  let completed = false;
  let failure;
  let onInteraction;
  const timers = new Map();
  const fontGate = deferred();
  const imageGate = deferred();
  const backgroundGate = deferred();
  const classes = new Set(['js']);
  const page = { classList: {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    contains: name => classes.has(name),
  } };
  const character = eventTarget();
  const lastWord = eventTarget();
  const window = { ...eventTarget(), scrollY: 0 };
  const warnings = [];
  const backgroundEntries = [];
  const responsiveCalls = [];
  const cloudRoutes = [];
  const gardenRoutes = [];
  const fishingRoutes = [];
  const fishingDistances = [];
  const routeOrder = [];
  const smoothScrollRoutes = [];
  let gardenFishingDistance = 0;
  let smoothScrollOptions;
  let cloudOptions;
  let fishingOptions;
  let footerFishInitializations = 0;
  let responsiveAPI;
  let descentOptions;
  let backgroundOptions;
  const asset = (state, gate) => state === 'pending' ? gate.promise
    : state === 'failed' ? Promise.reject(new Error('Asset unavailable')) : Promise.resolve();
  const image = { decode: () => asset(images, imageGate) };
  const nodes = {
    '.character': character,
    '.character-pose--idle .character-image': image,
    '.character-pose--jump .character-image': image,
    '.speech-word-mask:last-child .speech-word': lastWord,
  };
  const context = vm.createContext({
    window,
    document: {
      documentElement: page,
      querySelector: selector => nodes[selector] || null,
      fonts: { load: font => asset(fonts === 'partial'
        ? (font.includes('Display') ? 'pending' : 'failed') : fonts, fontGate) },
    },
    matchMedia: () => ({ matches: reducedMotion }),
    console: { warn: (...args) => warnings.push(args) },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    initSmoothScroll(options) {
      smoothScrollOptions = options;
      onInteraction = options.onInteraction;
      return { setRoute: route => { routeOrder.push('scroll'); smoothScrollRoutes.push(route); }, getTarget: () => null };
    },
    initClouds(options) {
      cloudOptions = options;
      if (clouds === 'failed') throw new Error('Cloud layer unavailable');
      return { setRoute(route) {
        routeOrder.push('clouds');
        cloudRoutes.push(route);
      }, cleanup() {} };
    },
    initGarden() {
      if (garden === 'failed') throw new Error('Garden unavailable');
      return { setRoute(route) {
        routeOrder.push('garden');
        gardenRoutes.push(route);
        gardenFishingDistance = route?.total > 0 ? route.fishingDistance || 0 : 0;
      }, getFishingDistance: () => gardenFishingDistance,
      cleanup() {} };
    },
    initFishing(options) {
      fishingOptions = options;
      if (fishing === 'failed') throw new Error('Fishing unavailable');
      return { setRoute(route) {
        routeOrder.push('fishing');
        fishingRoutes.push(route);
        fishingDistances.push(options.getFishingDistance());
      }, cleanup() {} };
    },
    initFooterFish() {
      footerFishInitializations++;
      if (footerFish === 'failed') throw new Error('Footer fish unavailable');
      return { cleanup() {} };
    },
    initResponsiveLayout({ layoutReady }) {
      const listeners = new Set();
      let layout;
      const commit = () => {
        responsiveCalls.push('hero');
        layout = { width: 1200, height: 900 };
        for (const listener of listeners) listener(layout);
      };
      window.addEventListener('resize', commit);
      Promise.resolve(layoutReady).then(commit);
      responsiveAPI = {
        subscribe(listener) {
          listeners.add(listener);
          if (layout) listener(layout);
          return () => listeners.delete(listener);
        },
        cleanup() { listeners.clear(); window.removeEventListener('resize', commit); },
      };
      return responsiveAPI;
    },
    initDescent(options) {
      descentOptions = options;
      options.subscribeLayout(() => responsiveCalls.push('ladder'));
      if (initialRoute !== undefined) options.onLayout(initialRoute);
    },
    async loadBackground() {
      if (background === 'missing') throw new Error('Background module unavailable');
      if (background === 'pending') await backgroundGate.promise;
      return { async initBackground(fontsReady, options) {
        await fontsReady;
        backgroundOptions = options;
        options.subscribeLayout(() => responsiveCalls.push('background'));
        // The renderer needs to know whether to animate or join an already visible page.
        return () => backgroundEntries.push({
          ready: classes.has('is-ready'), entering: classes.has('is-entering'),
        });
      } };
    },
  });
  vm.runInContext(`(async () => {\n${script}\n})()`, context, { filename: 'site/app.js' })
    .then(() => { completed = true; }, error => { failure = error; });

  async function advance(milliseconds) {
    await flush();
    const end = now + milliseconds;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      timer.callback();
      await flush();
    }
    now = end;
    await flush();
    if (failure) throw failure;
  }
  return {
    classes, character, lastWord, window, warnings, backgroundEntries, advance,
    responsiveCalls, cloudRoutes, gardenRoutes, fishingRoutes, fishingDistances, routeOrder, smoothScrollRoutes,
    get smoothScrollOptions() { return smoothScrollOptions; },
    get cloudOptions() { return cloudOptions; },
    get fishingOptions() { return fishingOptions; },
    get footerFishInitializations() { return footerFishInitializations; },
    get responsiveAPI() { return responsiveAPI; },
    get descentOptions() { return descentOptions; },
    get backgroundOptions() { return backgroundOptions; },
    interact: () => onInteraction(),
    resolveBackground: backgroundGate.resolve,
    resolveAssets() { fontGate.resolve(); imageGate.resolve(); },
    assertComplete() {
      if (failure) throw failure;
      assert.equal(completed, true, 'Startup did not finish');
      assert.ok(classes.has('is-ready'), 'The hero remained hidden');
    },
  };
}

const tests = [
  ['garden fishing clouds and scroll easing receive routes in dependency order', async () => {
    const initialRoute = { pitch: 42, total: 844, heroHeight: 844, sceneHeight: 844, fishingDistance: 844, arrivalBottom: 700 };
    const h = makeHarness({ initialRoute }); await h.advance(0); h.assertComplete();
    assert.equal(h.cloudRoutes[0], initialRoute, 'Clouds missed the route emitted during descent initialization');
    assert.equal(h.gardenRoutes[0], initialRoute, 'Garden missed the route emitted during descent initialization');
    assert.equal(h.fishingRoutes[0], initialRoute, 'Fishing missed the initial descent route');
    assert.equal(h.smoothScrollRoutes[0], initialRoute, 'Scroll easing missed the initial route');
    assert.equal(h.smoothScrollOptions.onScroll, undefined, 'Startup retained the obsolete JavaScript pin callback');
    const resizedRoute = { pitch: 35, total: 650, heroHeight: 650, sceneHeight: 650, fishingDistance: 650, arrivalBottom: 520 };
    h.descentOptions.onLayout(resizedRoute);
    h.descentOptions.onLayout(null);
    assert.deepEqual(h.cloudRoutes, [initialRoute, resizedRoute, null], 'Clouds retained an obsolete route');
    assert.deepEqual(h.gardenRoutes, h.cloudRoutes, 'Garden retained an obsolete route');
    assert.deepEqual(h.fishingRoutes, h.cloudRoutes, 'Fishing retained an obsolete route');
    assert.deepEqual(h.smoothScrollRoutes, h.cloudRoutes, 'Clouds and scroll easing use different route updates');
    assert.deepEqual(h.fishingDistances, [844, 650, 0], 'Fishing read the garden distance before it was updated');
    assert.deepEqual(h.routeOrder, Array.from({ length: 3 }, () => ['garden', 'fishing', 'clouds', 'scroll']).flat());
    assert.equal(h.cloudOptions, undefined, 'Clouds retained garden distance options');
    assert.equal(h.fishingOptions.getFishingDistance(), 0, 'Fishing retained a removed garden distance');
    assert.equal(h.footerFishInitializations, 1, 'Footer fish initialization depends on descent route updates');
    assert.equal(h.warnings.length, 0);
  }],
  ['failed footer fish leave contact startup and every descent feature usable', async () => {
    const initialRoute = { pitch: 42, total: 844, heroHeight: 844, sceneHeight: 844, fishingDistance: 844 };
    const h = makeHarness({ footerFish: 'failed', initialRoute });
    await h.advance(0); h.assertComplete();
    assert.equal(h.footerFishInitializations, 1);
    assert.ok(h.classes.has('is-entering'));
    assert.ok(h.descentOptions);
    for (const routes of [h.gardenRoutes, h.fishingRoutes, h.cloudRoutes, h.smoothScrollRoutes]) {
      assert.deepEqual(routes, [initialRoute], 'Footer fish failure interrupted another feature');
    }
    h.descentOptions.onLayout(null);
    for (const routes of [h.gardenRoutes, h.fishingRoutes, h.cloudRoutes, h.smoothScrollRoutes]) {
      assert.deepEqual(routes, [initialRoute, null]);
    }
    assert.equal(h.warnings.length, 1);
    assert.match(String(h.warnings[0][0]), /footer/i);
    h.interact();
    assert.ok(h.classes.has('skip-intro'));
  }],
  ['a failed garden leaves the hero ladder clouds and scrolling usable', async () => {
    const initialRoute = { pitch: 42, total: 844, heroHeight: 844, sceneHeight: 844, fishingDistance: 844 };
    const h = makeHarness({ garden: 'failed', initialRoute });
    await h.advance(0); h.assertComplete();
    assert.ok(h.classes.has('is-entering'), 'Garden failure prevented the hero entrance');
    assert.ok(h.descentOptions, 'Garden failure prevented ladder initialization');
    assert.deepEqual(h.cloudRoutes, [initialRoute]);
    assert.deepEqual(h.smoothScrollRoutes, [initialRoute]);
    h.descentOptions.onLayout(null);
    assert.deepEqual(h.cloudRoutes, [initialRoute, null]);
    assert.deepEqual(h.smoothScrollRoutes, [initialRoute, null]);
    assert.equal(h.warnings.length, 1, 'Garden failure was not isolated to one warning');
    assert.match(String(h.warnings[0][0]), /garden/i);
    assert.equal(h.cloudOptions, undefined, 'An unavailable garden added cloud options');
    assert.equal(h.fishingOptions.getFishingDistance(), 0, 'Fishing retained an unavailable garden distance');
    h.interact();
    assert.ok(h.classes.has('skip-intro'), 'Garden failure prevented deliberate scrolling');
  }],
  ['failed fishing leaves the garden clouds ladder and scroll easing usable', async () => {
    const initialRoute = { pitch: 42, total: 844, heroHeight: 844, sceneHeight: 844, fishingDistance: 844 };
    const h = makeHarness({ fishing: 'failed', initialRoute });
    await h.advance(0); h.assertComplete();
    assert.ok(h.descentOptions, 'Fishing failure prevented ladder initialization');
    assert.deepEqual(h.gardenRoutes, [initialRoute]);
    assert.deepEqual(h.cloudRoutes, [initialRoute]);
    assert.deepEqual(h.smoothScrollRoutes, [initialRoute]);
    h.descentOptions.onLayout(null);
    assert.deepEqual(h.gardenRoutes, [initialRoute, null]);
    assert.deepEqual(h.cloudRoutes, [initialRoute, null]);
    assert.deepEqual(h.smoothScrollRoutes, [initialRoute, null]);
    assert.equal(h.warnings.length, 1, 'Fishing failure was not isolated to one warning');
    assert.match(String(h.warnings[0][0]), /fishing/i);
    h.interact();
    assert.ok(h.classes.has('skip-intro'));
  }],
  ['a failed cloud layer leaves the hero, ladder and scroll easing usable', async () => {
    const initialRoute = { pitch: 42, total: 844, heroHeight: 844, sceneHeight: 844, fishingDistance: 844 };
    const h = makeHarness({ clouds: 'failed', initialRoute });
    await h.advance(0); h.assertComplete();
    assert.ok(h.classes.has('is-entering'), 'Cloud failure prevented the hero entrance');
    assert.ok(h.descentOptions, 'Cloud failure prevented ladder initialization');
    assert.equal(h.descentOptions.subscribeLayout, h.responsiveAPI.subscribe);
    assert.deepEqual(h.smoothScrollRoutes, [initialRoute], 'Cloud failure interrupted route setup');
    h.descentOptions.onLayout(null);
    assert.deepEqual(h.smoothScrollRoutes, [initialRoute, null], 'Cloud failure interrupted route removal');
    assert.equal(h.warnings.length, 1, 'Cloud failure was not isolated to one warning');
    assert.match(String(h.warnings[0][0]), /cloud/i);
    h.interact();
    assert.ok(h.classes.has('skip-intro'), 'Cloud failure prevented deliberate scrolling');
  }],
  ['ladder and background share the complete displayed hero layout on each resize', async () => {
    const h = makeHarness(); await h.advance(0); h.assertComplete();
    assert.equal(h.descentOptions.subscribeLayout, h.responsiveAPI.subscribe);
    assert.equal(h.backgroundOptions.subscribeLayout, h.responsiveAPI.subscribe);
    h.responsiveCalls.length = 0;
    h.window.emit('resize');
    assert.deepEqual(h.responsiveCalls, ['hero', 'ladder', 'background'],
      'A consumer resized before the hero had committed its real geometry');
  }],
  ['normal startup reveals the page and finishes the entrance', async () => {
    const h = makeHarness();
    await h.advance(0);
    h.assertComplete();
    assert.ok(h.classes.has('is-entering'));
    assert.ok(h.classes.has('has-jump-pose'));
    assert.deepEqual(h.backgroundEntries, [{ ready: false, entering: true }]);
    h.lastWord.emit('animationend', { animationName: 'unrelated-animation' });
    assert.ok(h.classes.has('is-entering'), 'An unrelated animation ended the entrance');
    h.character.emit('animationend', { animationName: 'character-jump' });
    h.lastWord.emit('animationend', { animationName: 'speech-word-rise' });
    assert.ok(h.classes.has('character-landed'));
    assert.equal(h.classes.has('is-entering'), false);
    h.interact();
    assert.equal(h.classes.has('skip-intro'), false, 'A finished entrance was changed by later input');
  }],
  ['deliberate scrolling reveals the hero before stalled assets finish', async () => {
    const h = makeHarness({ fonts: 'pending', images: 'pending', background: 'pending' });
    h.interact();
    assert.ok(h.classes.has('is-ready'));
    assert.ok(h.classes.has('skip-intro'));
    assert.ok(h.classes.has('character-landed'));
    await h.advance(2100);
    h.assertComplete();
    h.resolveAssets();
    h.resolveBackground();
    await h.advance(0);
    assert.equal(h.classes.has('is-entering'), false, 'Late assets replayed a skipped entrance');
    assert.deepEqual(h.backgroundEntries, [{ ready: true, entering: false }]);
  }],
  ['native scrolling also settles the entrance immediately', async () => {
    const h = makeHarness({ background: 'pending' });
    h.window.scrollY = 24;
    h.window.emit('scroll');
    assert.ok(h.classes.has('is-ready'));
    assert.ok(h.classes.has('skip-intro'));
    await h.advance(2100);
    h.assertComplete();
    assert.equal(h.classes.has('is-entering'), false);
  }],
  ['an unavailable background does not prevent the page from opening', async () => {
    const h = makeHarness({ background: 'missing' });
    await h.advance(0);
    h.assertComplete();
    assert.ok(h.classes.has('is-entering'));
    assert.equal(h.warnings.length, 1);
    assert.equal(h.backgroundEntries.length, 0);
  }],
  ['a late background joins the visible page without requesting another entrance', async () => {
    const h = makeHarness({ background: 'pending' });
    await h.advance(2100);
    h.assertComplete();
    h.character.emit('animationend', { animationName: 'character-jump' });
    h.lastWord.emit('animationend', { animationName: 'speech-word-rise' });
    h.resolveBackground();
    await h.advance(0);
    assert.deepEqual(h.backgroundEntries, [{ ready: true, entering: false }]);
    assert.equal(h.classes.has('is-entering'), false);
  }],
  ['reduced motion opens directly in the settled state', async () => {
    const h = makeHarness({ reducedMotion: true });
    await h.advance(0);
    h.assertComplete();
    assert.ok(h.classes.has('skip-intro'));
    assert.ok(h.classes.has('character-landed'));
    assert.equal(h.classes.has('is-entering'), false);
    assert.deepEqual(h.backgroundEntries, [{ ready: true, entering: false }]);
  }],
  ['failed fonts and image decoding still reveal the page without a broken jump pose', async () => {
    const h = makeHarness({ fonts: 'failed', images: 'failed' });
    await h.advance(0);
    h.assertComplete();
    assert.equal(h.classes.has('has-jump-pose'), false);
    assert.ok(h.classes.has('is-entering'));
  }],
  ['one failed font does not release the background before the display font finishes', async () => {
    const h = makeHarness({ fonts: 'partial' });
    await h.advance(0);
    assert.equal(h.backgroundEntries.length, 0, 'The background started with a pending display font');
    assert.equal(h.classes.has('is-ready'), false);
    h.resolveAssets();
    await h.advance(0);
    h.assertComplete();
    assert.deepEqual(h.backgroundEntries, [{ ready: false, entering: true }]);
  }],
  ['fonts and images that never settle cannot keep the page hidden', async () => {
    const h = makeHarness({ fonts: 'pending', images: 'pending' });
    await h.advance(2100);
    h.assertComplete();
    assert.equal(h.classes.has('has-jump-pose'), false);
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} startup scenarios passed`);
process.exitCode = failed ? 1 : 0;
