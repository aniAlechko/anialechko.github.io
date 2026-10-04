// Regression checks for mobile scrolling and avatar transitions.
// Run: npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const modulePath = new URL('../site/avatar-ladder.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const scrollSource = await readFile(new URL('../site/smooth-scroll.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../site/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const pageStart = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
// Model the stable CSS viewport floor before JavaScript receives Safari's
// toolbar resize, so unreachable contact positions cannot pass as visible.
const landingRule = css.match(/\.landing\s*\{([^}]+)\}/)?.[1] || '';
const fullScreenContact = /min-height:\s*100lvh\s*;/.test(landingRule);

function documentAncestors() {
  const stack = [];
  const ancestors = new Map();
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of html.matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const [, tag, attributes] = match;
    if (match[0].startsWith('</')) { stack.pop(); continue; }
    const node = { tag, id: attributes.match(/\bid="([^"]*)"/)?.[1],
      classes: (attributes.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/) };
    if (node.id) ancestors.set(node.id, [...stack]);
    if (node.classes.includes('hero')) ancestors.set('hero', [...stack]);
    if (!voidTags.has(tag.toLowerCase()) && !match[0].endsWith('/>')) stack.push(node);
  }
  return ancestors;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function makeHarness({ pendingImages = false, pendingLayout = false, largeViewportHeight = 840,
  initialScroll = 0, runPageStart = false, landingContentHeight = 280, withSmoothScroll = false } = {}) {
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
  const actorDocumentTop = () => {
    const translate = actor.style.transform?.match(/translate3d\(0, ([^p]+)px, 0\)/);
    return Number.parseFloat(actor.style.top || '0') + Number(translate?.[1] || 0);
  };
  const stage = element('stage');
  const site = element('site');
  const strip = element('strip');
  const turn = element('turn');
  const ladder = element('ladder');
  const probe = element('probe');
  const stageHeight = () => {
    const height = stage.style.height || '0px';
    const stableScreen = height.match(/^calc\(([-\d.]+)px \+ max\(100lvh, ([-\d.]+)px\)\)$/);
    if (stableScreen) return Number(stableScreen[1])
      + Math.max(viewport.largeViewportHeight, Number(stableScreen[2]));
    return Number.parseFloat(height);
  };
  stage.getBoundingClientRect = () => ({ left: 0, top: viewport.stableHeight,
    width: viewport.width, height: stageHeight() });
  site.getBoundingClientRect = () => {
    const viewportFloor = fullScreenContact ? viewport.largeViewportHeight : 0;
    return { left: 0, top: 0, width: viewport.width,
      height: Math.max(landingContentHeight, viewportFloor) };
  };
  Object.defineProperties(documentElement, {
    scrollHeight: { get: () => viewport.stableHeight
      + stageHeight()
      + site.getBoundingClientRect().height },
    clientHeight: { get: () => viewport.height },
  });
  const poses = Object.fromEntries(['front', 'a', 'b'].map(name => {
    const image = element(name);
    image.dataset.pose = name;
    image.hidden = name !== 'front';
    return [name, image];
  }));
  const nodes = { '.hero': hero, '.character': original, '#descent-stage': stage,
    '#landing': site, '#descent-scene': scene };
  const sceneNodes = { '.descent-ladder': ladder, '.descent-ladder-strip': strip,
    '.descent-actor': actor, '.descent-turn': turn, '.descent-ladder-probe': probe };
  hero.querySelector = selector => selector === '.speech' ? speech : null;
  hero.querySelectorAll = () => [];
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
  };
  documentElement.classList = classes();
  hero.getBoundingClientRect = () => ({ left: 0, top: -window.scrollY,
    width: viewport.width, height: viewport.stableHeight });
  original.getBoundingClientRect = () => ({ left: viewport.width / 2 - 55,
    top: (viewport.width > 600 ? 140 : 330) - window.scrollY,
    width: 110, height: viewport.width > 600 ? 180 : 220 });
  const matchMedia = query => ({
    media: query,
    matches: false,
    addEventListener() {}, removeEventListener() {},
  });
  const context = vm.createContext({
    window, performance: { now: () => now }, HTMLElement: class {},
    document: { documentElement, querySelector: selector => nodes[selector] || null,
      createDocumentFragment: () => element('fragment'), createElement: element },
    matchMedia,
    getComputedStyle: item => ({ transform: item.style.transform || 'none' }),
    DOMMatrixReadOnly: class { constructor() { this.m42 = 0; } },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => warnings.push(args) },
  });
  if (runPageStart) vm.runInContext(pageStart, context);
  let smoothScroll;
  if (withSmoothScroll) {
    vm.runInContext(scrollSource.replace('export function initSmoothScroll', 'function initSmoothScroll'), context);
    smoothScroll = context.initSmoothScroll();
  }
  vm.runInContext(source.replace('export function initDescent', 'function initDescent'), context);
  const cleanup = context.initDescent({
    layoutReady: pendingLayout ? layoutReady.promise : Promise.resolve(),
    onLayout: layout => { layouts.push(layout); smoothScroll?.setRoute(layout); },
    getScrollTarget: () => smoothScroll?.getTarget() ?? null,
  });
  function emit(type, event = { type }) {
    for (const listener of [...(events.get(type) || [])]) listener(event);
  }
  async function flushMicrotasks() { for (let count = 0; count < 12; count++) await Promise.resolve(); }
  async function tick(milliseconds = 16) {
    now += milliseconds;
    const previousScroll = window.scrollY;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.fn();
    }
    const pendingFrames = [...frames];
    frames.clear();
    for (const [, callback] of pendingFrames) callback(now);
    // Browser scroll events arrive after scrollTo returns, not inside it.
    if (window.scrollY !== previousScroll) emit('scroll');
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
  return { ready, tick, scrollTo, resize, scene, actor, hero, ladder, strip, stage, site, poses, layouts,
    animationCalls, actorDocumentTop, window, smoothScroll,
    cleanup() { cleanup(); smoothScroll?.destroy(); },
    maxScroll: () => documentElement.scrollHeight - window.innerHeight,
    contactStart: () => viewport.stableHeight + stageHeight(),
    route: () => layouts.filter(Boolean).at(-1),
    wheel(deltaY) {
      const event = { deltaY, deltaX: 0, deltaMode: 0, cancelable: true, defaultPrevented: false,
        composedPath: () => [], preventDefault() { this.defaultPrevented = true; } };
      emit('wheel', event);
      assert.equal(event.defaultPrevented, true, 'Wheel input did not reach the scroll controller');
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
  ['the descent belongs to a clipped journey before the contact section', async () => {
    const ancestors = documentAncestors();
    for (const id of ['hero', 'descent-stage', 'descent-scene']) {
      assert.ok(ancestors.get(id)?.some(node => node.classes.includes('journey')),
        `${id} must remain inside the journey`);
    }
    assert.ok(ancestors.has('landing'), 'The contact section is missing');
    assert.ok(!ancestors.get('landing').some(node => node.classes.includes('journey')),
      'Contact is still inside the avatar scene');
    assert.ok(html.indexOf('id="descent-stage"') < html.indexOf('id="landing"'),
      'Contact comes before the descent section');
    const journeyRule = css.match(/\.journey\s*\{([^}]+)\}/)?.[1] || '';
    assert.match(journeyRule, /position:\s*relative\s*;/,
      'The scene has no journey containing block');
    assert.match(journeyRule, /overflow:\s*(?:clip|hidden)\s*;/,
      'The journey can paint the avatar into contact');
  }],
  ['contact has its own full screen after the complete descent screen', async () => {
    const h = makeHarness({ landingContentHeight: 80, largeViewportHeight: 840 });
    await landed(h);
    const route = h.route();
    const contactStart = h.contactStart();
    assert.equal(h.site.getBoundingClientRect().height, 840,
      'A short contact section does not fill the stable full viewport');
    assert.ok(h.stage.getBoundingClientRect().height >= 840,
      'The descent stage is shorter than a full screen');
    assert.ok(contactStart - route.total >= 840 - 0.01,
      'Contact is visible while the avatar finishes descending');
    assert.equal(h.scene.style.height, undefined,
      'The scene independently changes the page height');
    assert.ok(h.maxScroll() >= contactStart,
      'The browser cannot scroll to a complete contact screen');
    await h.resize(390, 840);
    assert.equal(h.window.scrollY, route.total, 'Safari clamped the final rung before resizing');
    assert.equal(h.contactStart(), contactStart, 'The toolbar moved the contact boundary');
    assert.ok(Math.abs(h.maxScroll() - contactStart) < 0.01,
      'The page extends beyond the complete contact screen');
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.scene.dataset.state, 'landed');
    await h.scrollTo(contactStart);
    await h.resize(390, 780);
    await h.resize(390, 840);
    assert.equal(h.window.scrollY, contactStart, 'Toolbar growth clamped the complete contact screen');
    h.cleanup();
    assert.equal(h.stage.getBoundingClientRect().height, 0,
      'Cleanup retained an empty descent section');
  }],
  ['tall contact content can grow without changing the descent route', async () => {
    const h = makeHarness({ landingContentHeight: 1100 });
    await landed(h);
    const contactHeight = h.site.getBoundingClientRect().height;
    assert.equal(contactHeight, 1100, 'Contact clips content or adds another screen below it');
    assert.equal(h.maxScroll() + h.window.innerHeight, h.contactStart() + 1100,
      'The page extends beyond the intrinsic contact content');
    assert.equal(h.scene.style.height, undefined, 'Contact still controls the avatar scene height');
    const route = h.route();
    await h.scrollTo(h.maxScroll());
    await h.resize(390, 840);
    assert.equal(h.route(), route, 'Contact scrolling changed the ladder route');
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
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
    assert.ok(h.stage.getBoundingClientRect().height > 0, 'Route was not reserved early');
    const total = h.route().total;
    await h.scrollTo(total);
    await h.finishLayout();
    const reservedHeight = h.stage.style.height;
    await h.finishImages();
    await h.tick(200);
    assert.equal(h.stage.style.height, reservedHeight, 'Decoded assets inserted a new route');
    assert.equal(h.window.scrollY, total, 'Initialization changed the current scroll position');
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['the avatar parks in the descent section and leaves contact a full clear screen', async () => {
    const h = makeHarness();
    await landed(h);
    const route = h.route();
    const contactStart = h.contactStart();
    const parkedTop = h.actorDocumentTop();
    const avatarHeight = 1249 * Number.parseFloat(h.scene.style['--sprite-unit']);
    const ladderEnd = Number.parseFloat(h.ladder.style.top) + Number.parseFloat(h.ladder.style.height);
    const turns = h.animationCalls.length;
    const builds = h.strip.replacements;
    assert.ok(contactStart >= route.total + 840 - 0.01,
      'Contact enters the descent viewport before the avatar parks');
    assert.ok(parkedTop >= h.hero.getBoundingClientRect().height,
      'The avatar parks in the hero instead of its descent section');
    assert.ok(parkedTop + avatarHeight + 16 <= contactStart + 0.01,
      'The parked avatar reaches into contact');
    assert.ok(ladderEnd <= contactStart + 0.01, 'The ladder reaches into contact');
    assert.ok(ladderEnd >= parkedTop + avatarHeight,
      'The ladder ends above the avatar feet');
    for (const position of [(route.total + contactStart) / 2, contactStart, h.maxScroll()]) {
      await h.scrollTo(position);
      await h.tick(200);
      assert.equal(h.actorDocumentTop(), parkedTop,
        'Scrolling through contact moved the parked avatar in the document');
      assert.equal(h.scene.dataset.state, 'landed');
      assert.equal(h.actor.dataset.pose, 'front');
    }
    await h.resize(390, 840);
    assert.equal(h.contactStart(), contactStart, 'Safari toolbar moved the contact section');
    assert.equal(h.route(), route, 'Safari toolbar changed the climb endpoint');
    assert.equal(h.strip.replacements, builds);
    assert.equal(h.animationCalls.length, turns, 'Contact scrolling replayed the landing');
    assert.ok(h.maxScroll() >= contactStart,
      'A complete contact viewport is outside the physical scroll range');
    await h.scrollTo(contactStart);
    assert.ok(h.actorDocumentTop() + avatarHeight - h.window.scrollY < 0,
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
  ['wheel easing and avatar transitions share both endpoint arrivals', async () => {
    const h = makeHarness({ withSmoothScroll: true });
    await h.ready();
    const { pitch, total } = h.route();
    for (const [position, delta, destination, state] of [
      [total - pitch * 1.1, 40, total, 'landing'],
      [pitch * 1.1, -40, 0, 'returning'],
    ]) {
      await h.scrollTo(position);
      await h.tick(200);
      h.wheel(delta);
      assert.ok(Math.abs(h.smoothScroll.getTarget() - destination) < 0.01,
        'The ladder route did not reach the scroll controller');
      for (let frame = 0; frame < 60 && h.scene.dataset.state !== state; frame++) await h.tick();
      assert.equal(h.scene.dataset.state, state, 'The avatar did not begin its arrival');
      assert.notEqual(h.smoothScroll.getTarget(), null, 'The avatar waited for the entire easing tail');
      const turns = h.animationCalls.filter(call => call.name === 'turn').length;
      for (let frame = 0; frame < 60 && h.smoothScroll.getTarget() !== null; frame++) await h.tick();
      await h.tick(200);
      assert.equal(h.smoothScroll.getTarget(), null, 'Wheel easing failed to finish');
      assert.ok(Math.abs(h.window.scrollY - destination) < 0.01);
      assert.equal(h.actor.dataset.pose, 'front');
      assert.equal(h.animationCalls.filter(call => call.name === 'turn').length, turns,
        'The easing tail replayed the arrival turn');
    }
    assert.equal(h.scene.hidden, true, 'Returning to the top did not restore the hero');
    assert.equal(h.animationCalls.filter(call => call.name === 'speech').length, 1);
    h.cleanup();
  }],
  ['reversing a wheel approach keeps the avatar climbing toward the new target', async () => {
    const h = makeHarness({ withSmoothScroll: true });
    await h.ready();
    const { pitch, total } = h.route();
    await h.scrollTo(total - pitch);
    await h.tick(200);
    h.wheel(40);
    await h.tick();
    h.wheel(-120);
    const target = h.smoothScroll.getTarget();
    assert.ok(target < h.window.scrollY, 'Reversed input retained the landing target');
    for (let frame = 0; frame < 60 && h.smoothScroll.getTarget() !== null; frame++) await h.tick();
    await h.tick(200);
    assert.equal(h.window.scrollY, target);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.ok(['a', 'b'].includes(h.actor.dataset.pose));
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
