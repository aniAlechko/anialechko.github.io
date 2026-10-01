// Regression checks for mobile scrolling and avatar transitions.
// Run: npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const modulePath = new URL('../site/avatar-ladder.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const css = await readFile(new URL('../site/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const pageStart = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
// This DOM fixture models the landing rule's viewport floor, including its
// physical scroll range before JavaScript receives a browser-toolbar resize.
const landingRule = css.match(/\.landing\s*\{([^}]+)\}/)?.[1] || '';
const reservesLargeViewport = /min-height:\s*max\(100lvh,/.test(landingRule);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function makeHarness({ pendingImages = false, pendingLayout = false, largeViewportHeight = 840,
  initialScroll = 0, runPageStart = false, skillsHeight = null, skillsTop = -24 } = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const frames = new Map();
  const events = new Map();
  const decoded = deferred();
  const layoutReady = deferred();
  const animationCalls = [];
  const layouts = [];
  const warnings = [];
  const resizeObservers = new Set();
  const viewport = { width: 390, height: 780, stableHeight: 780, largeViewportHeight };
  const documentElement = { clientWidth: viewport.width };
  const setTimer = (fn, delay = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + delay, fn });
    return id;
  };
  const classes = () => {
    const values = new Set();
    return {
      add: (...names) => names.forEach(name => values.add(name)),
      remove: (...names) => names.forEach(name => values.delete(name)),
      contains: name => values.has(name),
      toggle(name, force = !values.has(name)) {
        if (force) values.add(name); else values.delete(name);
        return force;
      },
    };
  };
  const style = () => ({
    setProperty(name, value) { this[name] = value; },
    removeProperty(name) { delete this[name]; },
  });
  function element(name) {
    return {
      name, style: style(), classList: classes(), dataset: {}, hidden: false,
      naturalWidth: 1024, src: '/images/test.png', children: [], replacements: 0,
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; this.replacements++; },
      decode: () => pendingImages ? decoded.promise : Promise.resolve(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      animate(keyframes, options) {
        const record = { name, keyframes, options, cancelled: false };
        animationCalls.push(record);
        return { finished: Promise.resolve(), cancel() { record.cancelled = true; } };
      },
    };
  }
  const hero = element('hero');
  const original = element('original');
  const speech = element('speech');
  const scene = element('scene');
  const actor = element('actor');
  const spacer = element('spacer');
  const skills = skillsHeight === null ? null : element('skills');
  spacer.querySelector = selector => selector === '.descent-skills' ? skills : null;
  const site = element('site');
  const strip = element('strip');
  const turn = element('turn');
  const ladder = element('ladder');
  const probe = element('probe');
  site.getBoundingClientRect = () => ({ left: 0, top: 0, width: viewport.width,
    height: Math.max(reservesLargeViewport ? viewport.largeViewportHeight : 0,
      Number.parseFloat(site.style['--landing-height'] || String(viewport.stableHeight))) });
  Object.defineProperties(documentElement, {
    scrollHeight: { get: () => viewport.stableHeight
      + Number.parseFloat(spacer.style.height || '0')
      + site.getBoundingClientRect().height },
    clientHeight: { get: () => viewport.height },
  });
  const poses = Object.fromEntries(['front', 'a', 'b'].map(name => {
    const image = element(name);
    image.dataset.pose = name;
    image.hidden = name !== 'front';
    return [name, image];
  }));
  const nodes = { '.hero': hero, '.character': original, '#descent-space': spacer,
    '#landing': site, '#descent-scene': scene };
  const sceneNodes = { '.descent-ladder': ladder, '.descent-ladder-strip': strip,
    '.descent-actor': actor, '.descent-turn': turn, '.descent-ladder-probe': probe };
  hero.querySelector = selector => selector === '.speech' ? speech : null;
  hero.querySelectorAll = selector => selector === '.speech-word' ? [] : [];
  scene.querySelector = selector => sceneNodes[selector] || null;
  scene.querySelectorAll = selector => selector === '.descent-image' ? Object.values(poses) : [];
  const window = {
    scrollY: initialScroll, innerWidth: viewport.width, innerHeight: viewport.height,
    history: { scrollRestoration: 'auto' },
    scrollTo({ top }) { this.scrollY = top; },
    setTimeout: setTimer,
    addEventListener(type, fn) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(fn);
    },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    visualViewport: { width: viewport.width, height: viewport.height },
  };
  documentElement.classList = classes();
  hero.getBoundingClientRect = () => ({ left: 0, top: -window.scrollY,
    width: viewport.width, height: viewport.stableHeight });
  spacer.getBoundingClientRect = () => ({ left: 0, top: viewport.stableHeight - window.scrollY,
    width: viewport.width, height: Number.parseFloat(spacer.style.height || '0') });
  if (skills) skills.getBoundingClientRect = () => ({ left: 0,
    top: viewport.stableHeight - window.scrollY + skillsTop,
    bottom: viewport.stableHeight - window.scrollY + skillsTop + skillsHeight,
    width: 110, height: skillsHeight });
  original.getBoundingClientRect = () => ({ left: viewport.width / 2 - 55,
    top: (viewport.width > 600 ? 140 : 330) - window.scrollY,
    width: 110, height: viewport.width > 600 ? 180 : 220 });
  const matchMedia = query => ({
    media: query,
    matches: /pointer:\s*coarse|hover:\s*none/.test(query),
    addEventListener() {}, removeEventListener() {},
  });
  const context = vm.createContext({
    window, navigator: { maxTouchPoints: 5 },
    screen: { width: 390, height: 844, orientation: { type: 'portrait-primary' } },
    document: { documentElement, querySelector: selector => nodes[selector] || null,
      createDocumentFragment: () => element('fragment'), createElement: element },
    matchMedia,
    getComputedStyle: item => ({ transform: item.style.transform || 'none' }),
    DOMMatrixReadOnly: class { constructor() { this.m42 = 0; } },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; resizeObservers.add(this); }
      observe(target) { this.target = target; }
      disconnect() { resizeObservers.delete(this); }
    },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => warnings.push(args) },
  });
  if (runPageStart) vm.runInContext(pageStart, context);
  vm.runInContext(source.replace('export function initDescent', 'function initDescent'), context);
  const cleanup = context.initDescent({
    layoutReady: pendingLayout ? layoutReady.promise : Promise.resolve(),
    onLayout: layout => layouts.push(layout),
    getScrollTarget: () => null,
  });
  function emit(type) { for (const listener of [...(events.get(type) || [])]) listener({ type }); }
  async function flushMicrotasks() { for (let count = 0; count < 12; count++) await Promise.resolve(); }
  async function tick(milliseconds = 16) {
    now += milliseconds;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.fn();
    }
    const pendingFrames = [...frames];
    frames.clear();
    for (const [, callback] of pendingFrames) callback(now);
    await flushMicrotasks();
    assert.equal(warnings.length, 0, `Module fell back: ${warnings.map(String).join('; ')}`);
  }
  async function ready() {
    await flushMicrotasks();
    await tick();
    await tick();
  }
  async function scrollTo(position) {
    window.scrollY = position;
    emit('scroll');
    await tick();
  }
  async function resize(width, height, stableHeight = viewport.stableHeight) {
    if (width !== viewport.width) viewport.largeViewportHeight = height;
    Object.assign(viewport, { width, height, stableHeight });
    Object.assign(window, { innerWidth: width, innerHeight: height });
    Object.assign(window.visualViewport, { width, height });
    documentElement.clientWidth = width;
    // Safari can clamp scrollY to the new physical maximum before delivering
    // resize. A later min-height repair cannot recover the lost scroll position.
    const physicalMaximum = Math.max(0, documentElement.scrollHeight - height);
    if (window.scrollY > physicalMaximum) {
      window.scrollY = physicalMaximum;
      emit('scroll');
    }
    emit('resize');
    await tick();
  }
  return { ready, tick, scrollTo, resize, scene, actor, hero, strip, spacer, site, poses, layouts,
    animationCalls, window, cleanup,
    maxScroll: () => documentElement.scrollHeight - window.innerHeight,
    contactStart: () => viewport.stableHeight + Number.parseFloat(spacer.style.height || '0'),
    route: () => layouts.filter(Boolean).at(-1),
    resizeSkills: async height => {
      skillsHeight = height;
      for (const observer of resizeObservers) {
        if (observer.target === skills) observer.callback();
      }
      await tick();
    },
    finishImages: async () => { decoded.resolve(); await flushMicrotasks(); await tick(); },
    finishLayout: async () => { layoutReady.resolve(); await flushMicrotasks(); await tick(); },
  };
}

async function landed(harness) {
  await harness.ready();
  await harness.scrollTo(harness.route().total);
  await harness.tick(200);
  assert.equal(harness.scene.dataset.state, 'landed');
  assert.equal(harness.actor.dataset.pose, 'front');
}

const tests = [
  ['reload resets the page before the ladder initializes', async () => {
    assert.ok(pageStart, 'The early page bootstrap is missing');
    assert.ok(html.indexOf('<script>') < html.indexOf('<link'), 'Scroll reset must not wait for external assets');
    const h = makeHarness({ initialScroll: 1200, runPageStart: true });
    assert.equal(h.window.history.scrollRestoration, 'manual');
    assert.equal(h.window.scrollY, 0, 'Initialization started at the previous scroll position');
    await h.ready();
    assert.equal(h.scene.dataset.state, 'idle');
    assert.equal(h.scene.hidden, true, 'The ladder appeared during the fresh entrance');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['scrolling immediately after reload is not undone when loading finishes', async () => {
    const h = makeHarness({ initialScroll: 1200, runPageStart: true,
      pendingImages: true, pendingLayout: true });
    await h.ready();
    const total = h.route().total;
    await h.scrollTo(total);
    await h.finishLayout();
    await h.finishImages();
    await h.tick(4500);
    assert.equal(h.window.scrollY, total, 'A late load callback reset deliberate user scrolling');
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['bounce during the first landing turn does not turn the avatar back', async () => {
    const h = makeHarness();
    await h.ready();
    const total = h.route().total;
    await h.scrollTo(total);
    assert.equal(h.scene.dataset.state, 'landing');
    const turns = h.animationCalls.length;
    for (const offset of [-4, -12, -2, 0]) {
      await h.scrollTo(total + offset);
      assert.ok(['landing', 'landed'].includes(h.scene.dataset.state),
        `Bounce interrupted the landing turn at ${offset}px`);
    }
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.animationCalls.length, turns, 'Bounce interrupted or replayed landing');
    h.cleanup();
  }],
  ['native bottom bounce keeps the front pose and does not replay a turn', async () => {
    const h = makeHarness();
    await landed(h);
    const total = h.route().total;
    const calls = h.animationCalls.length;
    for (const offset of [-1, -4, -12, -6, 0, 9, 0, -2, 0]) {
      await h.scrollTo(total + offset);
      await h.tick(40);
      assert.equal(h.actor.dataset.pose, 'front', `Pose flashed during bounce at ${offset}px`);
      assert.equal(h.scene.dataset.state, 'landed', `Landing restarted during bounce at ${offset}px`);
    }
    assert.equal(h.animationCalls.length, calls, 'Bounce replayed a turn animation');
    h.cleanup();
  }],
  ['a deliberate upward movement resumes climbing after landing', async () => {
    const h = makeHarness();
    await landed(h);
    await h.scrollTo(h.route().total - h.route().pitch * 1.5);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.ok(['a', 'b'].includes(h.actor.dataset.pose));
    assert.equal(h.poses.front.hidden, true);
    h.cleanup();
  }],
  ['mobile toolbar height changes keep the route and landed pose stable', async () => {
    const h = makeHarness();
    await landed(h);
    const route = h.route();
    const builds = h.strip.replacements;
    const layoutCalls = h.layouts.length;
    const turns = h.animationCalls.length;
    for (const height of [840, 802, 780, 824]) {
      await h.resize(390, height);
      await h.tick(200);
      assert.equal(h.strip.replacements, builds, 'Toolbar resize rebuilt the ladder');
      assert.equal(h.layouts.length, layoutCalls, 'Toolbar resize changed scroll route');
      assert.equal(h.scene.dataset.state, 'landed');
      assert.equal(h.actor.dataset.pose, 'front');
      assert.equal(h.scene.hidden, false);
      assert.ok(h.maxScroll() >= h.route().total - 0.5,
        'Toolbar expansion made the bottom of the route unreachable');
    }
    assert.equal(h.route(), route);
    assert.equal(h.animationCalls.length, turns, 'Toolbar resize replayed landing');
    h.cleanup();
  }],
  ['Safari viewport growth preserves bottom arrival before resize handling', async () => {
    const h = makeHarness({ largeViewportHeight: 840 });
    await landed(h);
    const total = h.route().total;
    const builds = h.strip.replacements;
    const turns = h.animationCalls.length;
    const layoutCalls = h.layouts.length;
    await h.resize(390, 840);
    assert.equal(h.window.scrollY, total, 'Browser clamped the landed scroll position');
    assert.equal(h.scene.dataset.state, 'landed', 'Viewport growth restarted departure');
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.strip.replacements, builds);
    assert.equal(h.layouts.length, layoutCalls);
    assert.equal(h.animationCalls.length, turns);
    assert.ok(h.maxScroll() >= total - 0.5, 'Expanded viewport cannot reach route bottom');
    await h.tick(200);
    assert.equal(h.actor.dataset.pose, 'front', 'A delayed turn flashed the back pose');
    h.cleanup();
  }],
  ['toolbar growth during landing preserves the active turn', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().total);
    assert.equal(h.scene.dataset.state, 'landing');
    const builds = h.strip.replacements;
    const turn = h.animationCalls.at(-1);
    const calls = h.animationCalls.length;
    await h.resize(390, 840);
    assert.equal(h.scene.dataset.state, 'landing');
    assert.equal(turn.cancelled, false, 'Resize cancelled the active landing');
    assert.equal(h.animationCalls.length, calls, 'Resize replaced the active landing');
    assert.equal(h.strip.replacements, builds);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['return to Home and a second descent preserve the endpoint handoffs', async () => {
    const h = makeHarness();
    await landed(h);
    const builds = h.strip.replacements;
    await h.scrollTo(0);
    await h.tick(200);
    assert.equal(h.scene.hidden, true, 'Home did not reveal the original hero');
    assert.equal(h.hero.classList.contains('descent-active'), false);
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.animationCalls.filter(call => call.name === 'speech').length, 1,
      'The top speech animation did not replay once');
    await h.scrollTo(h.route().pitch * 2);
    await h.tick();
    await h.tick(200);
    assert.equal(h.scene.hidden, false);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.ok(['a', 'b'].includes(h.actor.dataset.pose));
    await h.scrollTo(h.route().total);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.strip.replacements, builds, 'Return and re-descent rebuilt the route');
    h.cleanup();
  }],
  ['orientation width change recalculates the route', async () => {
    const h = makeHarness();
    await h.ready();
    const total = h.route().total;
    const builds = h.strip.replacements;
    await h.resize(844, 390, 390);
    assert.ok(h.strip.replacements > builds, 'Orientation did not rebuild ladder layout');
    assert.notEqual(h.route().total, total, 'Orientation retained obsolete scroll length');
    assert.ok(h.route().total > 0);
    h.cleanup();
  }],
  ['early scrolling reserves the route before images finish decoding', async () => {
    const h = makeHarness({ pendingImages: true, pendingLayout: true });
    await h.ready();
    assert.ok(Number.parseFloat(h.spacer.style.height) > 0, 'Route was not reserved early');
    const total = h.route().total;
    await h.scrollTo(total);
    await h.finishLayout();
    const reservedHeight = h.spacer.style.height;
    await h.finishImages();
    await h.tick(200);
    assert.equal(h.spacer.style.height, reservedHeight, 'Decoded assets inserted a new route');
    assert.equal(h.window.scrollY, total, 'Initialization changed the current scroll position');
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['a long skills list extends the route and preserves the endpoint handoffs', async () => {
    const baseline = makeHarness();
    await baseline.ready();
    const originalTotal = baseline.route().total;
    baseline.cleanup();
    const h = makeHarness({ skillsHeight: 700, skillsTop: -24 });
    await h.ready();
    const clearance = 700 - 24 + 48;
    const reserved = Number.parseFloat(h.spacer.style.height);
    assert.ok(reserved >= clearance, 'Landing covers the end of the skills list');
    assert.ok(reserved < clearance + h.route().pitch,
      'The skills route adds more than one spare rung');
    assert.ok(h.route().total > originalTotal, 'The longer list did not extend the route');
    await h.scrollTo(h.route().total);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    const route = h.route();
    const builds = h.strip.replacements;
    await h.resize(390, 840);
    assert.equal(h.route(), route, 'Toolbar growth rebuilt the long route');
    assert.equal(h.strip.replacements, builds);
    assert.equal(h.scene.dataset.state, 'landed');
    await h.scrollTo(0);
    await h.tick(200);
    assert.equal(h.scene.hidden, true, 'The extended route did not return to the hero');
    assert.equal(h.hero.classList.contains('descent-active'), false);
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['skills wrapping or font changes resize the route without a viewport change', async () => {
    const h = makeHarness({ skillsHeight: 700, skillsTop: -24 });
    await h.ready();
    const originalTotal = h.route().total;
    await h.resizeSkills(960);
    assert.ok(h.route().total > originalTotal, 'Changed skills height retained the old route');
    assert.ok(Number.parseFloat(h.spacer.style.height) >= 960 - 24 + 48,
      'The updated list overlaps the landing');
    const builds = h.strip.replacements;
    await h.resizeSkills(960);
    assert.equal(h.strip.replacements, builds, 'Unchanged list size rebuilt the route');
    await h.scrollTo(h.route().total);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['the avatar stays above compact contact and resumes climbing on return', async () => {
    const h = makeHarness({ skillsHeight: 960, skillsTop: -24 });
    await landed(h);
    const route = h.route();
    const contactStart = h.contactStart();
    const parkedTop = Number.parseFloat(h.actor.style.top);
    const avatarHeight = 1249 * Number.parseFloat(h.scene.style['--sprite-unit']);
    const minimumContactStart = Math.max(h.hero.getBoundingClientRect().height + 960 - 24 + 48,
      h.window.innerHeight * 1.3);
    const turns = h.animationCalls.length;
    const builds = h.strip.replacements;
    assert.ok(contactStart > route.total, 'Contact starts before the final climb settles');
    assert.ok(Math.abs(contactStart - parkedTop - avatarHeight - 32) < 0.01,
      'The avatar is not fully parked above the contact section');
    assert.ok(contactStart >= minimumContactStart, 'Contact covers the end of the skills');
    assert.ok(contactStart < minimumContactStart + route.pitch,
      'Parking the avatar added empty space before contact');
    for (const position of [(route.total + contactStart) / 2, contactStart, h.maxScroll()]) {
      await h.scrollTo(position);
      await h.tick(200);
      assert.equal(Number.parseFloat(h.actor.style.top), parkedTop,
        'Scrolling through contact moved the parked avatar in the document');
      assert.equal(h.scene.dataset.state, 'landed');
      assert.equal(h.actor.dataset.pose, 'front');
    }
    await h.resize(390, 840);
    assert.equal(h.contactStart(), contactStart, 'Safari toolbar moved the contact section');
    assert.equal(h.route(), route, 'Safari toolbar changed the climb endpoint');
    assert.equal(h.strip.replacements, builds);
    assert.equal(h.animationCalls.length, turns, 'Contact scrolling replayed the landing');
    await h.scrollTo(contactStart);
    assert.ok(Number.parseFloat(h.actor.style.top) + avatarHeight - h.window.scrollY < 0,
      'Avatar overlaps the viewport when the contact section is fully visible');
    await h.scrollTo(route.total - route.pitch * 1.5);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.ok(['a', 'b'].includes(h.actor.dataset.pose));
    await h.scrollTo(0);
    await h.tick(200);
    assert.equal(h.scene.hidden, true);
    assert.equal(h.hero.classList.contains('descent-active'), false);
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.message}`); }
}
console.log(`${tests.length - failed}/${tests.length} scenarios passed`);
process.exitCode = failed ? 1 : 0;
