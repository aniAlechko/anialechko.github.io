import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site/garden.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../site/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const rule = selector => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`))?.[1] || '';

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type) { for (const callback of [...listeners.get(type) || []]) callback(); },
    get listenerCount() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0); },
  };
}

function makeHarness({ height = 800, heroHeight = 800, gardenTop = 800, lineCount = 4,
  reducedMotion = false, state = 'idle', missing } = {}) {
  const writes = [];
  const frames = new Map();
  const observers = new Set();
  const animations = [];
  let nextFrame = 0;
  const window = { ...eventTarget(), innerHeight: height, scrollY: 0 };
  const geometry = { heroHeight, gardenTop };
  const element = () => {
    const classes = new Set();
    const mutations = [];
    return {
      hidden: true, classes, mutations, attributes: {}, dataset: {},
      classList: {
        add(name) { mutations.push(['class', name, true]); classes.add(name); },
        contains(name) { return classes.has(name); },
        toggle(name, enabled) { mutations.push(['class', name, enabled]); if (enabled) classes.add(name); else classes.delete(name); },
        remove(name) { mutations.push(['class', name, false]); classes.delete(name); },
      },
      style: new Proxy({
        setProperty(name, value) { this[name] = value; },
        removeProperty(name) { mutations.push(['removeProperty', name]); delete this[name]; },
      }, {
        set(target, name, value) { writes.push([name, value]); mutations.push(['style', name, value]); target[name] = value; return true; },
      }),
      setAttribute(name, value) { mutations.push(['attribute', name, value]); this.attributes[name] = value; },
      animate(keyframes, options) {
        let resolve;
        const animation = { target: this, keyframes, options, cancelled: false,
          finished: new Promise(done => { resolve = done; }),
          cancel() { this.cancelled = true; },
          finish() { resolve(); },
        };
        animations.push(animation);
        return animation;
      },
    };
  };
  const garden = element();
  const daylight = element();
  const journey = element();
  const hero = element();
  const page = element();
  const theme = element();
  const scene = element(); scene.dataset.state = state;
  const preference = { ...eventTarget(), matches: reducedMotion };
  const lines = Array.from({ length: lineCount }, element);
  theme.attributes.content = '#000000';
  garden.getBoundingClientRect = () => ({ top: geometry.gardenTop - window.scrollY });
  hero.getBoundingClientRect = () => ({ height: geometry.heroHeight });
  const nodes = { '.garden-scene': garden, '.garden-daylight': daylight, '.journey': journey,
    '.hero': hero, '#descent-scene': scene, 'meta[name="theme-color"]': theme };
  const document = { ...eventTarget(), hidden: false, documentElement: page,
    querySelector: selector => selector === missing ? null : nodes[selector] || null,
    querySelectorAll: selector => selector === '.statement-line-text' ? lines : [] };
  const context = vm.createContext({ window, document,
    matchMedia: () => preference,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) { this.target = target; this.options = options; observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  vm.runInContext(source.replace('export function initGarden', 'function initGarden')
    + '\nthis.controller = initGarden();', context);
  return {
    window, document, geometry, garden, daylight, journey, page, theme, scene, preference, lines, writes, animations,
    controller: context.controller,
    get pendingFrames() { return frames.size; },
    get observerCount() { return observers.size; },
    tick() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); },
    scrollTo(scroll) { window.scrollY = scroll; window.emit('scroll'); this.tick(); },
    setState(state) {
      scene.dataset.state = state;
      for (const observer of [...observers]) {
        if (observer.target === scene) observer.callback([{ target: scene, type: 'attributes', attributeName: 'data-state' }]);
      }
      this.tick();
    },
  };
}

const route = { total: 800, heroHeight: 800, fishingDistance: 800, sceneHeight: 800, arrivalBottom: 700 };
// Every scene layer follows the document after the avatar lands.
function frameGeometry(h) {
  const trackHeight = h.geometry.heroHeight + parseFloat(h.garden.style.height);
  return { top: -h.window.scrollY, height: trackHeight, trackHeight };
}
const tests = [
  ['the pale background starts below the hero and keeps fixed local geometry while scrolling', () => {
    const h = makeHarness();
    h.window.emit('scroll'); h.tick();
    assert.equal(h.garden.hidden, true, 'The garden appeared before route setup');
    assert.equal(h.controller.getFishingDistance(), 0);
    h.controller.setRoute(route);
    assert.equal(h.garden.hidden, false);
    assert.equal(h.daylight.hidden, false);
    assert.equal(parseFloat(h.daylight.style.top), 800, 'Daylight leaked into the initial hero');
    assert.equal(parseFloat(h.garden.style.top), 800);
    assert.equal(h.controller.getFishingDistance(), 800);
    const daylightWrites = h.daylight.mutations.length;
    for (const scroll of [100, 300, 600, 800, 1200, 600, 0]) {
      h.scrollTo(scroll);
      assert.equal(parseFloat(h.daylight.style.top), 800, 'Scrolling moved the garden boundary');
      assert.equal(h.pendingFrames, 0, 'Static garden rendering started an animation loop');
    }
    assert.equal(h.daylight.mutations.length, daylightWrites, 'Scrolling rewrote the daylight presentation');
    h.controller.cleanup();
  }],
  ['header footer and browser theme stay dark with no crossing overlay or background animation', () => {
    const h = makeHarness(); h.controller.setRoute(route);
    h.scrollTo(400); h.scrollTo(1600); h.controller.setRoute(null); h.controller.cleanup();
    assert.deepEqual(h.page.mutations, [], 'Garden rendering mutated the page theme');
    assert.deepEqual(h.theme.mutations, [], 'Garden rendering changed browser theme metadata');
    assert.equal(h.theme.attributes.content, '#000000');
    for (const selector of ['.contact-header', '.landing']) {
      assert.match(rule(selector), /background:\s*#000\s*;/);
      assert.match(rule(selector), /color:\s*#fff\s*;/);
    }
    assert.match(rule('.garden-daylight'), /background:\s*#f1f0eb/);
    assert.doesNotMatch(rule('.garden-daylight'), /(?:opacity|animation|transition)\s*:/);
    assert.equal(h.daylight.style.opacity, undefined);
    assert.doesNotMatch(source + css + html, /garden-crossing/);
    assert.equal(rule('.garden-daylight::before'), '', 'The stepped transition edge returned');
  }],
  ['route and viewport changes preserve the garden anchor and physical scene height', () => {
    const h = makeHarness(); h.controller.setRoute({ ...route, arrivalBottom: 1000, fishingDistance: 1000, sceneHeight: 1000 });
    assert.equal(parseFloat(h.garden.style.height), 1000, 'The arrival extends beyond the garden floor');
    h.geometry.gardenTop = 900;
    h.controller.setRoute({ total: 900, heroHeight: 900, fishingDistance: 900, sceneHeight: 900, arrivalBottom: 700 });
    assert.equal(parseFloat(h.garden.style.height), 900, 'The garden became shorter than the hero');
    assert.equal(parseFloat(h.daylight.style.top), 900);
    assert.equal(h.controller.getFishingDistance(), 900);
    h.scrollTo(300);
    h.geometry.gardenTop = 950;
    h.window.innerHeight = 600; h.window.emit('resize'); h.tick();
    assert.equal(parseFloat(h.daylight.style.top), 900, 'The backdrop followed transformed garden bounds');
    assert.equal(parseFloat(h.garden.style.top), 900);
    assert.equal(parseFloat(h.garden.style.height), 900);
    assert.equal(h.controller.getFishingDistance(), 900, 'Viewport-only resize changed the stable fishing distance');
    h.geometry.heroHeight = 720; h.geometry.gardenTop = 1000;
    h.controller.setRoute(null);
    assert.equal(parseFloat(h.garden.style.height), 720);
    assert.equal(parseFloat(h.daylight.style.top), 1000);
    assert.equal(h.controller.getFishingDistance(), 0);
    h.geometry.heroHeight = 650; h.geometry.gardenTop = 1100;
    h.window.emit('resize'); h.tick();
    assert.equal(parseFloat(h.garden.style.height), 650);
    assert.equal(parseFloat(h.daylight.style.top), 1100);
    h.controller.cleanup();
  }],
  ['statement clearance follows the current route and removes stale values for fallbacks', () => {
    const h = makeHarness();
    h.controller.setRoute({ ...route, landedActorTop: 570.94 });
    assert.equal(parseFloat(h.garden.style['--garden-character-top']), 570.94);
    h.scrollTo(800); h.setState('landed');
    assert.equal(h.animations.length, 4);
    h.controller.setRoute({ total: 568, heroHeight: 568, fishingDistance: 578, sceneHeight: 578, arrivalBottom: 578, landedActorTop: 355.83 });
    assert.equal(parseFloat(h.garden.style['--garden-character-top']), 355.83,
      'A responsive route retained the previous avatar clearance');
    assert.equal(h.animations.length, 4, 'Updating clearance restarted the statement reveal');
    assert.equal(h.garden.classes.has('is-statement-visible'), true);
    for (const missingHead of [undefined, NaN, Infinity]) {
      h.controller.setRoute({ ...route, landedActorTop: missingHead });
      assert.equal(h.garden.style['--garden-character-top'], undefined,
        'An unavailable measurement retained an obsolete text cap');
      h.controller.setRoute({ ...route, landedActorTop: 570.94 });
    }
    h.controller.setRoute(null);
    assert.equal(h.garden.style['--garden-character-top'], undefined,
      'The static avatar inherited moving-avatar clearance');
    assert.equal(h.controller.getFishingDistance(), 0);
    h.controller.setRoute({ ...route, landedActorTop: 658.06 });
    assert.equal(parseFloat(h.garden.style['--garden-character-top']), 658.06);
    h.controller.cleanup();
    assert.equal(h.garden.style['--garden-character-top'], undefined,
      'Cleanup retained statement clearance');
  }],
  ['null and invalid routes retain a static accessible garden with reduced-motion support', () => {
    const h = makeHarness();
    for (const invalid of [null, { total: 0 }, { total: -1 }, { total: NaN }, { total: Infinity }]) {
      h.controller.setRoute(invalid);
      assert.equal(h.journey.classes.has('has-static-garden'), true);
      assert.equal(h.garden.hidden, false);
      assert.equal(h.daylight.hidden, false);
      h.scrollTo(800);
      assert.equal(parseFloat(h.daylight.style.top), h.geometry.gardenTop);
      assert.equal(h.pendingFrames, 0);
    }
    assert.match(rule('.has-static-garden .garden-resting-character'), /display:\s*block/);
    assert.match(rule('.has-static-garden .scene-track, .has-static-garden .scene-frame'), /display:\s*contents/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\}[^}]*\.garden-rabbit\s*\{\s*animation:\s*none/s);
    h.controller.setRoute(route);
    assert.equal(h.journey.classes.has('has-static-garden'), false);
    h.controller.cleanup();
  }],
  ['completed landing reveals the statement together with a gentle rise without further scrolling', () => {
    for (const height of [600, 800]) {
      const h = makeHarness({ height, heroHeight: height, gardenTop: height });
      h.controller.setRoute({ total: height, heroHeight: height, fishingDistance: height, sceneHeight: height });
      const values = () => h.lines.map(line => Number(line.style['--line-reveal']));
      assert.deepEqual(values(), [0, 0, 0, 0]);
      for (const fraction of [.45, .8, 1, 1.4]) {
        h.scrollTo(height * fraction);
        assert.deepEqual(values(), [0, 0, 0, 0], 'Scroll progress revealed text before completed landing');
        assert.equal(h.animations.length, 0);
      }
      h.scrollTo(height); h.setState('landing');
      assert.deepEqual(values(), [0, 0, 0, 0], 'The landing turn exposed the statement early');
      h.setState('landed');
      assert.equal(h.garden.classes.has('is-statement-visible'), true);
      assert.deepEqual(values(), [1, 1, 1, 1]);
      assert.equal(h.animations.length, h.lines.length, 'Stationary landing did not animate each line');
      h.animations.forEach((animation, index) => {
        assert.equal(animation.target, h.lines[index]);
        assert.deepEqual(Array.from(animation.keyframes, frame => ({ ...frame })), [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], 'Statement entrance changed its gentle rise or settled position');
        assert.ok(animation.options.duration > 0);
        assert.equal(animation.options.fill, 'both');
        assert.equal(animation.options.delay ?? 0, 0, 'Statement lines did not enter together');
        assert.equal(animation.options.duration, h.animations[0].options.duration,
          'Statement lines did not settle together');
      });
      assert.equal(h.pendingFrames, 0, 'Autoplay retained a JavaScript animation loop');
      for (const fraction of [1.15, 1.4, 1.77, 2, 1.5]) {
        h.scrollTo(height * fraction);
        assert.equal(parseFloat(h.garden.style.top) + frameGeometry(h).top, height - h.window.scrollY);
        assert.deepEqual(values(), [1, 1, 1, 1]);
      }
      h.scrollTo(height * 2.25);
      assert.ok(parseFloat(h.garden.style.top) + frameGeometry(h).top < 0,
        'The garden could not leave toward the footer');
      assert.equal(h.animations.length, h.lines.length, 'Further scrolling replayed the reveal');
      h.controller.cleanup();
    }
  }],
  ['partial return preserves the reveal and only reaching the hero top allows replay', () => {
    const h = makeHarness(); h.controller.setRoute(route);
    h.scrollTo(route.total); h.setState('landed');
    const first = [...h.animations];
    h.setState('climbing');
    for (const scroll of [750, 400, 1, .6, 300, 800]) {
      h.scrollTo(scroll);
      assert.equal(h.garden.classes.has('is-statement-visible'), true, 'A partial return hid the statement');
      assert.deepEqual(h.lines.map(line => Number(line.style['--line-reveal'])), [1, 1, 1, 1]);
      assert.ok(first.every(animation => !animation.cancelled), 'Partial return cancelled the current fade');
    }
    h.setState('landed');
    assert.equal(h.animations.length, 4, 'A second landing without reaching the top replayed the statement');
    h.scrollTo(.5);
    assert.equal(h.garden.classes.has('is-statement-visible'), false);
    assert.deepEqual(h.lines.map(line => Number(line.style['--line-reveal'])), [0, 0, 0, 0]);
    assert.ok(first.every(animation => animation.cancelled), 'Full return left stale animations applied');
    h.setState('climbing'); h.scrollTo(800);
    assert.equal(h.animations.length, 4, 'Leaving the hero replayed before the next completed landing');
    h.setState('landed');
    assert.equal(h.animations.length, 8, 'A full return did not enable the next reveal');
    assert.ok(h.animations.slice(4).every(animation => !animation.cancelled));
    h.controller.cleanup();
  }],
  ['resize unchanged state and tab visibility preserve the revealed latch without replay', () => {
    const h = makeHarness(); h.controller.setRoute(route); h.scrollTo(800); h.setState('landed');
    const lineWrites = () => h.lines.reduce((sum, line) => sum + line.mutations.length, 0);
    const before = lineWrites();
    for (let index = 0; index < 3; index++) { h.window.emit('scroll'); h.tick(); h.setState('landed'); }
    h.document.hidden = true; h.document.emit('visibilitychange'); h.tick();
    h.document.hidden = false; h.document.emit('visibilitychange'); h.tick();
    h.window.innerHeight = 700; h.window.emit('resize'); h.tick();
    h.controller.setRoute({ total: 900, heroHeight: 900, fishingDistance: 910, sceneHeight: 910, arrivalBottom: 910 });
    assert.equal(h.garden.classes.has('is-statement-visible'), true);
    assert.equal(h.animations.length, 4, 'Remeasure or repeated state replayed the reveal');
    assert.equal(lineWrites(), before, 'An unchanged reveal rewrote line styles');
    h.controller.cleanup();
  }],
  ['null routes reduced motion and optional missing elements retain a fully readable fallback', () => {
    const h = makeHarness();
    for (const invalid of [null, { total: 0 }, { total: NaN }]) {
      h.controller.setRoute(invalid);
      assert.deepEqual(h.lines.map(line => Number(line.style['--line-reveal'])), [1, 1, 1, 1]);
      assert.equal(h.animations.length, 0);
      assert.equal(h.pendingFrames, 0);
    }
    h.controller.setRoute(route);
    assert.deepEqual(h.lines.map(line => Number(line.style['--line-reveal'])), [0, 0, 0, 0]);
    h.scrollTo(800); h.setState('landed');
    assert.equal(h.animations.length, 4);
    h.controller.setRoute(null);
    assert.ok(h.animations.every(animation => animation.cancelled), 'Static fallback retained the autoplay animation');
    assert.deepEqual(h.lines.map(line => Number(line.style['--line-reveal'])), [1, 1, 1, 1]);
    h.controller.cleanup();
    const reduced = makeHarness({ reducedMotion: true }); reduced.controller.setRoute(route);
    assert.deepEqual(reduced.lines.map(line => Number(line.style['--line-reveal'])), [1, 1, 1, 1]);
    assert.equal(reduced.animations.length, 0);
    reduced.scrollTo(800); reduced.setState('landed'); reduced.scrollTo(0);
    assert.equal(reduced.animations.length, 0);
    assert.deepEqual(reduced.lines.map(line => Number(line.style['--line-reveal'])), [1, 1, 1, 1]);
    reduced.controller.cleanup();
    const withoutStatement = makeHarness({ lineCount: 0 });
    withoutStatement.controller.setRoute(route); withoutStatement.scrollTo(800); withoutStatement.setState('landed');
    withoutStatement.controller.setRoute(null); withoutStatement.controller.cleanup();
    assert.equal(withoutStatement.pendingFrames, 0);
    const withoutScene = makeHarness({ missing: '#descent-scene' });
    withoutScene.controller.setRoute(route); withoutScene.scrollTo(799);
    assert.equal(withoutScene.animations.length, 0);
    withoutScene.scrollTo(800); assert.equal(withoutScene.animations.length, 4);
    withoutScene.controller.cleanup();
    assert.doesNotMatch(html, /id="statement-stage"/, 'A separate scroll spacer returned');
  }],
  ['enabling reduced motion cancels an active fade and leaves every line readable', () => {
    const h = makeHarness(); h.controller.setRoute(route); h.scrollTo(800); h.setState('landed');
    assert.equal(h.animations.length, 4);
    h.preference.matches = true; h.preference.emit('change'); h.tick();
    assert.ok(h.animations.every(animation => animation.cancelled));
    assert.equal(h.garden.classes.has('is-statement-visible'), true);
    assert.deepEqual(h.lines.map(line => Number(line.style['--line-reveal'])), [1, 1, 1, 1]);
    h.preference.matches = false; h.preference.emit('change'); h.tick();
    assert.equal(h.animations.length, 4, 'Turning motion back on replayed an already visible statement');
    h.controller.cleanup();
  }],
  ['one document frame contains every scene layer and moves continuously with the page', () => {
    assert.match(rule('.scene-track'), /position:\s*absolute/);
    assert.match(rule('.scene-track'), /inset:\s*0/);
    assert.match(rule('.scene-frame'), /position:\s*relative/);
    assert.match(rule('.scene-frame'), /height:\s*100%/);
    assert.doesNotMatch(source + css, /--scene-pin-top|--scene-hold-distance/);
    assert.doesNotMatch(rule('.scene-track') + rule('.scene-frame'), /overflow(?:-[xy])?:\s*(?:hidden|auto|scroll)/);
    assert.doesNotMatch(source + css, /--garden-hold|--statement-drift/);
    assert.doesNotMatch(rule('.garden-scene') + rule('.descent-actor') + rule('.statement-line-text'), /(?:translate|transform)\s*:/);
    const stack = [];
    const found = new Set();
    const layers = ['garden-daylight', 'garden-scene', 'cloud-scene', 'descent-scene'];
    for (const [, closing, tag, attributes] of html.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)) {
      if (closing) { stack.pop(); continue; }
      const classes = attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || [];
      for (const layer of layers.filter(value => classes.includes(value))) {
        assert.ok(stack.some(ancestor => ancestor.includes('scene-track')));
        assert.ok(stack.some(ancestor => ancestor.includes('scene-frame')), `${layer} escaped the shared native frame`);
        found.add(layer);
      }
      if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag) && !/\/\s*$/.test(attributes)) stack.push(classes);
    }
    assert.deepEqual([...found].sort(), [...layers].sort());
    for (const [height, largeViewportHeight, arrivalBottom] of [[780, 840, 788], [800, 800, 1030], [390, 430, 410]]) {
      const h = makeHarness({ height, heroHeight: height, gardenTop: height });
      const sceneHeight = Math.max(largeViewportHeight, arrivalBottom);
      h.controller.setRoute({ total: height, heroHeight: height, fishingDistance: sceneHeight,
        sceneHeight, arrivalBottom });
      const before = h.writes.length;
      for (const fraction of [1, 1.25, 1.5, 1.75, 2, 1.5]) {
        h.window.scrollY = height * fraction;
        h.window.emit('scroll');
        assert.equal(parseFloat(h.garden.style.top) + frameGeometry(h).top, height - h.window.scrollY,
          'Different arrival or large-viewport heights pinned the content');
        assert.equal(h.writes.length, before, 'Scrolling moved scene geometry through JavaScript');
        assert.equal(h.pendingFrames, 1);
      }
      h.tick();
      assert.equal(h.pendingFrames, 0);
      const frame = frameGeometry(h);
      h.window.scrollY = frame.trackHeight;
      const atContact = frameGeometry(h);
      assert.equal(atContact.top + atContact.height, 0, 'The scene covered the contact section');
      assert.ok(atContact.top + parseFloat(h.garden.style.top) + parseFloat(h.garden.style.height) <= 0);
      h.controller.cleanup();
    }
  }],
  ['rabbit animation pauses offscreen or hidden and scroll updates coalesce without an idle loop', () => {
    const h = makeHarness(); h.controller.setRoute(route);
    assert.equal(h.garden.style['--garden-play-state'], 'paused');
    const copyWrites = () => h.lines.reduce((sum, line) => sum + line.mutations.length, 0);
    const before = copyWrites();
    for (const scroll of [100, 400, 800, 1120]) { h.window.scrollY = scroll; h.window.emit('scroll'); }
    assert.equal(h.pendingFrames, 1);
    assert.equal(copyWrites(), before, 'Scroll listeners rendered text outside the scheduled frame');
    assert.equal(h.garden.style['--garden-play-state'], 'paused');
    h.tick();
    assert.equal(h.garden.style['--garden-play-state'], 'running');
    assert.equal(h.pendingFrames, 0);
    const rendered = h.writes.length;
    h.window.emit('scroll'); h.tick();
    assert.equal(h.writes.length, rendered, 'Unchanged scrolling rewrote garden styles');
    h.document.hidden = true; h.document.emit('visibilitychange'); h.tick();
    assert.equal(h.garden.style['--garden-play-state'], 'paused');
    h.document.hidden = false; h.document.emit('visibilitychange'); h.tick();
    assert.equal(h.garden.style['--garden-play-state'], 'running');
    h.scrollTo(1600);
    assert.equal(h.garden.style['--garden-play-state'], 'paused', 'Garden animation continued after leaving the viewport');
    h.scrollTo(2400);
    assert.equal(h.garden.style['--garden-play-state'], 'paused');
    assert.equal(h.pendingFrames, 0);
    h.controller.cleanup();
  }],
  ['cleanup removes pending work and listeners and makes the controller inert', () => {
    const h = makeHarness(); h.controller.setRoute(route); h.scrollTo(800); h.setState('landed'); h.scrollTo(1200);
    assert.equal(h.animations.length, 4);
    assert.ok(h.animations.every(animation => !animation.cancelled));
    assert.ok(h.controller.getFishingDistance() > 0);
    h.window.emit('scroll'); assert.equal(h.pendingFrames, 1);
    h.controller.cleanup(); h.controller.cleanup();
    assert.equal(h.pendingFrames, 0);
    assert.equal(h.window.listenerCount, 0);
    assert.equal(h.document.listenerCount, 0);
    assert.equal(h.preference.listenerCount, 0);
    assert.equal(h.observerCount, 0);
    assert.ok(h.animations.every(animation => animation.cancelled), 'Cleanup left statement animations applied');
    assert.equal(h.garden.classes.has('is-statement-visible'), false);
    assert.equal(h.garden.hidden, true);
    assert.equal(h.daylight.hidden, true);
    assert.equal(h.journey.classes.has('has-static-garden'), false);
    assert.equal(h.controller.getFishingDistance(), 0);
    const writes = h.writes.length;
    h.window.emit('scroll'); h.window.emit('resize'); h.document.emit('visibilitychange');
    h.preference.emit('change'); h.setState('landed');
    h.controller.setRoute(route); h.tick();
    assert.equal(h.writes.length, writes);
  }],
  ['a missing required scene node leaves a harmless controller', () => {
    for (const missing of ['.garden-scene', '.garden-daylight', '.journey', '.hero']) {
      const h = makeHarness({ missing });
      h.controller.setRoute(route); h.controller.setRoute(null); h.controller.cleanup();
      assert.equal(h.writes.length, 0);
      assert.equal(h.window.listenerCount, 0);
      assert.equal(h.document.listenerCount, 0);
      assert.equal(h.preference.listenerCount, 0);
      assert.equal(h.observerCount, 0);
      assert.equal(h.pendingFrames, 0);
    }
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} garden scenarios passed`);
process.exitCode = failed ? 1 : 0;
