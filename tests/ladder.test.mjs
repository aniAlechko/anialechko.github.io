// Regression checks for mobile scrolling and avatar transitions.
// Run: npm test
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { getHeroLayout } from '../site/responsive-layout.js';

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
  initialScroll = 0, runPageStart = false, landingContentHeight = 280, withSmoothScroll = false,
  withSubscribedLayout = false } = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const frames = new Map();
  const events = new Map();
  const decoded = deferred();
  const layoutReady = deferred();
  const animationCalls = [];
  const layoutListeners = new Set();
  let originalReads = 0;
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
    removeProperty(name) {
      delete this[name];
      delete this[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
    },
  });
  function element(name) {
    return {
      name, style: style(), classList: classes(), dataset: {}, hidden: false,
      naturalWidth: 1024, src: '/images/test.png', children: [], replacements: 0,
      append(child) { this.children.push(...(child.name === 'fragment' ? child.children : [child])); },
      removeChild(child) {
        const index = this.children.indexOf(child);
        assert.ok(index >= 0, 'Removed a tile outside the ladder strip');
        this.children.splice(index, 1);
      },
      replaceChildren(...children) {
        this.children = children.flatMap(child => child.name === 'fragment' ? child.children : [child]);
        this.replacements++;
      },
      get childElementCount() { return this.children.length; },
      get lastElementChild() { return this.children.at(-1) || null; },
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
  const intro = element('intro');
  const status = element('status');
  // Include compositor offsets in measured copy bounds, as a browser does.
  // This catches remeasurement that accidentally uses the shifted layout.
  for (const [index, detail] of [intro, status].entries()) {
    detail.getBoundingClientRect = () => {
      const [x = 0, y = 0] = (detail.style.translate || '')
        .split(/\s+/).map(value => Number.parseFloat(value) || 0);
      const scale = Number(detail.style.scale ?? 1);
      const left = viewport.width / 2 - 100 + x;
      const top = 600 + index * 46 - window.scrollY + y;
      return { left, top, width: 200 * scale, height: 38 * scale,
        right: left + 200 * scale, bottom: top + 38 * scale };
    };
  }
  const scene = element('scene');
  const visibilityChanges = [];
  let sceneHidden = scene.hidden;
  Object.defineProperty(scene, 'hidden', {
    get: () => sceneHidden,
    set: value => { sceneHidden = value; visibilityChanges.push(value); },
  });
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
  hero.querySelector = selector => ({ '.speech': speech, '.hero-intro': intro,
    '.status': status })[selector] || null;
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
  original.getBoundingClientRect = () => {
    originalReads++;
    return { left: (viewport.characterCenter ?? viewport.width / 2) - 55,
      top: (viewport.characterTop ?? (viewport.width > 600 ? 140 : 330)) - window.scrollY,
      width: 110, height: viewport.characterHeight ?? (viewport.width > 600 ? 180 : 220) };
  };
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
    getComputedStyle: item => ({ transform: item.style.transform || 'none',
      minHeight: item === hero ? `${viewport.stableHeight}px` : '0px',
      paddingLeft: item === hero ? '16px' : '0px' }),
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
    subscribeLayout: withSubscribedLayout ? listener => {
      layoutListeners.add(listener);
      return () => layoutListeners.delete(listener);
    } : undefined,
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
  function resizeNow(width, height, stableHeight = viewport.stableHeight) {
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
  }
  async function resize(width, height, stableHeight = viewport.stableHeight) {
    resizeNow(width, height, stableHeight);
    await tick();
  }
  return { ready, tick, scrollTo, resize, resizeNow, scene, actor, hero, intro, status,
    ladder, strip, stage, site, poses, layouts,
    animationCalls, actorDocumentTop, window, smoothScroll, visibilityChanges,
    get originalReads() { return originalReads; },
    get pendingFrames() { return frames.size; },
    get layoutSubscriptions() { return layoutListeners.size; },
    resizeListeners: () => events.get('resize')?.size || 0,
    commitLayout({ characterHeight, characterTop, characterCenter, heroHeight, sideProgress } = {}) {
      if (characterHeight !== undefined) viewport.characterHeight = characterHeight;
      if (characterTop !== undefined) viewport.characterTop = characterTop;
      if (characterCenter !== undefined) viewport.characterCenter = characterCenter;
      if (heroHeight !== undefined) viewport.stableHeight = heroHeight;
      for (const listener of [...layoutListeners]) listener({ sideProgress });
    },
    queueScroll(position) { window.scrollY = position; emit('scroll'); },
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

function assertCenteredDescentAndCopy(h, expectedCenter = h.window.innerWidth / 2) {
  const unit = Number.parseFloat(h.scene.style['--sprite-unit']);
  const ladderUnit = Number.parseFloat(h.scene.style['--ladder-x-unit']);
  const shift = Number.parseFloat(h.scene.style['--descent-shift'] || '0');
  assert.ok(Math.abs(Number.parseFloat(h.actor.style.left) + 524 * unit / 2 + shift - expectedCenter) < .01,
    'The climbing avatar left the displayed hero axis');
  assert.ok(Math.abs(Number.parseFloat(h.ladder.style.left) + 374 * ladderUnit / 2 + shift - expectedCenter) < .01,
    'The ladder left the displayed hero axis');
  assert.equal(shift, 0, 'Scrolling retained a side-column offset');
  for (const [index, detail] of [h.intro, h.status].entries()) {
    for (const property of ['translate', 'scale', 'transform', 'transformOrigin']) {
      assert.equal(detail.style[property], undefined, `Scrolling changed the footer ${property}`);
    }
    const bounds = detail.getBoundingClientRect();
    assert.equal(bounds.left, h.window.innerWidth / 2 - 100, 'Footer copy moved into a side column');
    assert.equal(bounds.top + h.window.scrollY, 600 + index * 46, 'Footer copy moved within the document');
    assert.equal(bounds.width, 200, 'Scrolling changed the footer width');
    assert.equal(bounds.height, 38, 'Scrolling changed the footer height');
  }
}

const tests = [
  ['the original descent length keeps the lower landing and exact return to the hero', async () => {
    for (const [width, height] of [[390, 780], [992, 814], [1364, 900], [844, 390]]) {
      const h = makeHarness(); await h.ready(); await h.resize(width, height, height);
      const route = h.route();
      const initialTop = h.actorDocumentTop();
      const baseTop = h.actor.style.top;
      const actorHeight = 1249 * Number.parseFloat(h.scene.style['--sprite-unit']);
      const initialFeet = initialTop + actorHeight;
      assert.equal(route.total, route.heroHeight, 'The descent no longer uses its original one-screen length');
      await h.scrollTo(route.total / 2); await h.tick(200);
      const middleTop = h.actorDocumentTop();
      const middleFeet = middleTop + actorHeight - h.window.scrollY;
      assert.ok(middleFeet > initialFeet, 'The character stayed at its original screen height during descent');
      await h.scrollTo(route.total); await h.tick(200);
      const feet = h.actorDocumentTop() + actorHeight - h.window.scrollY;
      const bottomGap = Math.min(12, Math.max(6, height * .01));
      assert.ok(Math.abs(feet - (height - bottomGap)) < .01,
        `The landed feet are not near the lower screen edge at ${width}×${height}`);
      assert.ok(feet < height && feet - actorHeight >= 0, 'The landed character is clipped by the viewport');
      assert.equal(h.scene.dataset.state, 'landed');
      assert.equal(h.actor.dataset.pose, 'front');
      assert.equal(h.actor.style.top, baseTop, 'Lower landing rewrote the original hero anchor');
      const ladderEnd = Number.parseFloat(h.ladder.style.top) + Number.parseFloat(h.ladder.style.height);
      assert.ok(ladderEnd >= h.actorDocumentTop() + actorHeight, 'The ladder ends before the lowered feet');
      await h.scrollTo(route.total / 2); await h.tick(200);
      assert.ok(Math.abs(h.actorDocumentTop() - middleTop) < .01, 'Climbing back up retained the landing drop');
      await h.scrollTo(0); await h.tick(200);
      assert.equal(h.actorDocumentTop(), initialTop, 'Returning home jumped away from the original hero position');
      assert.equal(h.scene.hidden, true);
      h.cleanup();
    }
  }],
  ['reported landing clearance matches the displayed avatar after responsive layout changes', async () => {
    const h = makeHarness({ withSubscribedLayout: true }); await h.ready();
    let previousHead;
    for (const [width, height] of [[320, 568], [390, 844], [430, 932], [844, 390], [992, 814]]) {
      const layout = getHeroLayout({ width, height });
      await h.resize(width, height, height);
      h.commitLayout({ characterTop: layout.character.top, characterHeight: layout.character.height,
        characterCenter: layout.character.left + layout.character.width / 2 });
      await h.tick();
      const route = h.route();
      assert.ok(Number.isFinite(route.landedActorTop), 'The route omitted the measured landing clearance');
      if (previousHead !== undefined) assert.notEqual(route.landedActorTop, previousHead,
        'Responsive layout retained the previous avatar clearance');
      previousHead = route.landedActorTop;
      await h.scrollTo(route.total); await h.tick(200);
      const visibleTop = h.actorDocumentTop() - h.window.scrollY;
      assert.ok(Math.abs(route.landedActorTop - visibleTop) < .01,
        `Statement clearance disagrees with the landed avatar at ${width}×${height}`);
      assert.equal(h.scene.dataset.state, 'landed');
      assert.equal(route.total, route.heroHeight, 'Reporting clearance changed the descent length');
      const routes = h.layouts.length;
      await h.resize(width, height + 40, height);
      assert.equal(h.layouts.length, routes, 'Toolbar-only resize changed the stable landing clearance');
      assert.equal(h.route().landedActorTop, previousHead);
    }
    h.cleanup();
  }],
  ['rung poses follow the visible travel while the character moves lower', async () => {
    const h = makeHarness(); await h.ready();
    const route = h.route();
    const initialTop = h.actorDocumentTop();
    let differsFromScroll = false;
    for (const progress of [.2, .35, .5, .65, .8]) {
      await h.scrollTo(route.total * progress); await h.tick(200);
      const actualStep = Math.round((h.actorDocumentTop() - initialTop) / route.pitch);
      const scrollStep = Math.round(h.window.scrollY / route.pitch);
      if (actualStep % 2 !== scrollStep % 2) differsFromScroll = true;
      assert.equal(h.actor.dataset.pose, actualStep % 2 ? 'b' : 'a',
        'The climbing pose follows scroll distance instead of the visible rung displacement');
    }
    assert.ok(differsFromScroll, 'Fixture did not exercise a visible travel step beyond the scroll step');
    h.cleanup();
  }],
  ['mobile down and up scrolling keeps the avatar and ladder centered and footer copy unchanged', async () => {
    const h = makeHarness();
    await h.ready();
    const route = h.route();
    const actorLeft = h.actor.style.left;
    const actorTop = h.actor.style.top;
    const ladderLeft = h.ladder.style.left;
    const ladderTop = h.ladder.style.top;
    const routeHeight = h.stage.style.height;
    const builds = h.strip.replacements;
    const baselineCopy = [h.intro, h.status].map(element => element.getBoundingClientRect());
    assertCenteredDescentAndCopy(h);
    for (const position of [1, route.pitch * 3, route.total, h.contactStart(), h.maxScroll(),
      route.total, route.pitch * 3, 1, 0]) {
      await h.scrollTo(position);
      assertCenteredDescentAndCopy(h);
      await h.tick(200);
      assertCenteredDescentAndCopy(h);
      assert.equal(h.actor.style.left, actorLeft, 'Scrolling rewrote the base actor position');
      assert.equal(h.actor.style.top, actorTop, 'Scrolling rewrote the base actor top');
      assert.equal(h.ladder.style.left, ladderLeft, 'Scrolling rewrote the base ladder position');
      assert.equal(h.ladder.style.top, ladderTop, 'Scrolling rewrote the base ladder top');
      assert.equal(h.route(), route, 'Scrolling changed the rung route');
      assert.equal(h.stage.style.height, routeHeight, 'Scrolling changed the document height');
      assert.equal(h.strip.replacements, builds, 'Scrolling rebuilt the ladder');
    }
    assert.equal(h.scene.hidden, true, 'Return did not restore the original hero');
    for (const [index, element] of [h.intro, h.status].entries()) {
      assert.deepEqual(element.getBoundingClientRect(), baselineCopy[index],
        'Return did not preserve the original text layout');
    }
    h.cleanup();
  }],
  ['orientation changes preserve the centered descent and natural footer throughout the journey', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().pitch * 3);
    await h.tick();
    await h.tick(200);
    assertCenteredDescentAndCopy(h);
    const pose = h.actor.dataset.pose;
    for (const [width, height] of [[810, 390], [809, 780], [390, 780], [844, 390], [390, 780]]) {
      await h.resize(width, height, height);
      assertCenteredDescentAndCopy(h);
      assert.equal(h.actor.dataset.pose, pose, 'Orientation changed the climbing pose');
      await h.scrollTo(h.route().pitch * 3);
      assertCenteredDescentAndCopy(h);
    }
    await h.scrollTo(0);
    await h.tick(200);
    assert.equal(h.scene.hidden, true);
    assertCenteredDescentAndCopy(h);
    h.cleanup();
  }],
  ['layout subscriptions measure displayed geometry synchronously and detach cleanly', async () => {
    const h = makeHarness({ withSubscribedLayout: true });
    await h.ready();
    assert.equal(h.layoutSubscriptions, 1);
    assert.equal(h.resizeListeners(), 0, 'Subscribed descent retained a competing resize listener');
    await h.scrollTo(h.route().pitch * 3);
    await h.tick();
    await h.tick(200);
    const pose = h.actor.dataset.pose;
    const animations = h.animationCalls.length;
    h.resizeNow(810, 780);
    const oldUnit = Number.parseFloat(h.scene.style['--sprite-unit']);
    assert.ok(Math.abs(oldUnit - 220 / 1180) < .00001,
      'A raw resize bypassed the authoritative displayed layout');
    h.commitLayout({ characterHeight: 205, characterCenter: 330, characterTop: 290, sideProgress: .5 });
    const unit = Number.parseFloat(h.scene.style['--sprite-unit']);
    assert.ok(Math.abs(unit - 205 / 1180) < .00001, 'Descent measured a CSS endpoint instead of displayed height');
    assert.ok(Math.abs(Number.parseFloat(h.actor.style.left) + 524 * unit / 2 - 330) < .01);
    assert.equal(h.actor.style.top, '290px');
    assert.equal(h.actor.dataset.pose, pose);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.equal(h.animationCalls.length, animations, 'Displayed layout tick restarted a turn');
    h.cleanup();
    assert.equal(h.layoutSubscriptions, 0, 'Cleanup left a displayed layout subscription behind');
    const afterCleanup = h.originalReads;
    h.commitLayout({ characterHeight: 190, sideProgress: 1 });
    assert.equal(h.originalReads, afterCleanup, 'A removed subscription still measured the character');
  }],
  ['continuous displayed layout follows the hero axis without introducing side columns', async () => {
    const h = makeHarness({ withSubscribedLayout: true });
    await h.ready();
    await h.scrollTo(h.route().pitch * 3);
    await h.tick();
    await h.tick(200);
    h.resizeNow(810, 780);
    const pose = h.actor.dataset.pose;
    const animations = h.animationCalls.length;
    h.commitLayout({ characterHeight: 180, characterCenter: 405, characterTop: 140, sideProgress: 0 });
    const route = h.route();
    for (const factor of [0, .25, .5, .75, 1, .5, 0]) {
      h.commitLayout({ characterHeight: 180, characterCenter: 405, characterTop: 140, sideProgress: factor });
      assertCenteredDescentAndCopy(h, 405);
      assert.equal(h.route(), route, `Side progress ${factor} changed the descent route`);
      assert.equal(h.actor.dataset.pose, pose);
    }
    for (const [factor, center, height] of [[.25, 390, 190], [.5, 375, 200], [.75, 350, 210], [1, 330, 220]]) {
      h.commitLayout({ characterHeight: height, characterCenter: center, characterTop: 140, sideProgress: factor });
      assertCenteredDescentAndCopy(h, center);
      assert.equal(h.actor.dataset.pose, pose, 'Following the displayed hero changed the climbing pose');
    }
    assert.equal(h.animationCalls.length, animations, 'Displayed layout changes restarted a turn');
    h.cleanup();
  }],
  ['the route follows continuous hero height rather than jumping by a whole rung', async () => {
    const h = makeHarness({ withSubscribedLayout: true });
    await h.ready();
    assert.equal(h.route().total, 780);
    assert.equal(h.route().heroHeight, 780);
    for (const height of [779.8, 780.1, 780.4, 780.8, 781.2]) {
      h.commitLayout({ heroHeight: height, characterHeight: 220, sideProgress: 1 });
      assert.ok(Math.abs(h.route().total - height) < .01, 'Route endpoint snapped onto a rung');
      assert.equal(h.route().heroHeight, height, 'Cloud geometry lost the unextended hero height');
    }
    h.cleanup();
  }],
  ['displayed sprite resizing appends and removes only trailing ladder tiles', async () => {
    const h = makeHarness({ withSubscribedLayout: true });
    await h.ready();
    await h.scrollTo(h.route().pitch * 3);
    await h.tick();
    await h.tick(200);
    const pose = h.actor.dataset.pose;
    const calls = h.animationCalls.length;
    let tiles = [...h.strip.children];
    let countChanges = 0;
    for (const height of [215, 210, 200, 190, 180, 190, 200, 210, 220]) {
      h.commitLayout({ characterHeight: height, sideProgress: 1 });
      const next = [...h.strip.children];
      const shared = Math.min(tiles.length, next.length);
      if (tiles.length !== next.length) countChanges++;
      assert.deepEqual(next.slice(0, shared), tiles.slice(0, shared),
        `Resizing to ${height}px replaced visible ladder tiles`);
      assert.equal(h.strip.replacements, 0, 'Resize rebuilt the complete decoded ladder strip');
      assert.equal(h.actor.dataset.pose, pose);
      assert.equal(h.scene.dataset.state, 'climbing');
      assert.equal(h.route().total, 780, 'Sprite size changed the route endpoint');
      tiles = next;
    }
    assert.ok(countChanges >= 4, 'Fixture never crossed enough ladder tile boundaries');
    assert.equal(h.animationCalls.length, calls, 'Tile count changes replayed a turn');
    h.cleanup();
  }],
  ['resize commits actor, ladder, and copy geometry in the same event', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().pitch * 3);
    await h.tick();
    await h.tick(200);
    const pose = h.actor.dataset.pose;
    const animations = h.animationCalls.length;
    h.queueScroll(h.window.scrollY);
    assert.equal(h.pendingFrames, 1);
    h.resizeNow(810, 780);
    const unit = 180 / 1180;
    const center = 810 / 2;
    assert.ok(Math.abs(Number.parseFloat(h.actor.style.left) + 524 * unit / 2 - center) < .01,
      'Resize left the old actor width or position until a later frame');
    assert.ok(Math.abs(Number.parseFloat(h.ladder.style.left)
      + 374 * unit * 380 / 299 / 2 - center) < .01,
    'Presentation observed a ladder out of alignment with the actor');
    assert.equal(h.scene.style['--descent-shift'], undefined, 'Desktop retained an old mobile offset');
    assert.equal(h.intro.style.translate, undefined);
    assert.equal(h.status.style.translate, undefined);
    assert.equal(h.actor.dataset.pose, pose);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.equal(h.pendingFrames, 1, 'Resize retained a stale render beside its anchoring guard');
    await h.tick();
    assert.equal(h.pendingFrames, 0, 'The resize transaction left deferred geometry work');
    assert.equal(h.animationCalls.length, animations);
    for (const width of [809, 650, 430, 810]) {
      h.resizeNow(width, 780);
      const spriteUnit = Number.parseFloat(h.scene.style['--sprite-unit']);
      const xUnit = Number.parseFloat(h.scene.style['--ladder-x-unit']);
      const yUnit = Number.parseFloat(h.scene.style['--ladder-y-unit']);
      assert.ok(Math.abs(Number.parseFloat(h.actor.style.left) + 524 * spriteUnit / 2
        - Number.parseFloat(h.ladder.style.left) - 374 * xUnit / 2) < .01,
      `Ladder and actor centers diverged at ${width}px`);
      assert.ok(Math.abs(217 * yUnit - h.route().pitch) < .01,
        `The resized rung strip no longer matches the route at ${width}px`);
      assert.ok(Math.abs(224 * spriteUnit - h.route().pitch) < .01,
        `The resized climbing sprite no longer matches rung spacing at ${width}px`);
      assert.equal(h.actor.dataset.pose, pose);
    }
    assert.equal(h.animationCalls.length, animations, 'Resize invented a turn gesture');
    h.cleanup();
  }],
  ['width changes preserve the current climbing pose without redeploying the scene', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().pitch * 3);
    await h.tick();
    await h.tick(200);
    const pose = h.actor.dataset.pose;
    const animations = h.animationCalls.length;
    const visibility = h.visibilityChanges.length;
    const builds = h.strip.replacements;
    const tiles = [...h.strip.children];
    await h.resize(410, 780);
    assert.equal(h.strip.replacements, builds, 'A small width change rebuilt identical ladder tiles');
    assert.deepEqual(h.strip.children, tiles, 'A small width change replaced the loaded ladder nodes');
    for (const width of [430, 809, 810, 809, 390]) {
      await h.resize(width, 780);
      assert.equal(h.scene.dataset.state, 'climbing', `Resize redeployed the scene at ${width}px`);
      assert.equal(h.actor.dataset.pose, pose, `Resize changed the stationary step at ${width}px`);
      assert.equal(h.scene.hidden, false, 'Resize hid the visible foreground');
      assert.equal(h.hero.classList.contains('descent-active'), true);
      assertCenteredDescentAndCopy(h);
    }
    assert.equal(h.visibilityChanges.length, visibility, 'Resize exchanged the hero and foreground');
    assert.equal(h.animationCalls.length, animations, 'Resize replayed a turn or speech animation');
    await h.scrollTo(h.route().pitch * 4);
    const visibleStep = Math.round((h.actorDocumentTop() - Number.parseFloat(h.actor.style.top)) / h.route().pitch);
    assert.equal(h.actor.dataset.pose, visibleStep % 2 ? 'b' : 'a', 'Scroll did not resume the visible rung sequence');
    h.cleanup();
  }],
  ['width changes keep a valid landed endpoint visible without replaying arrival', async () => {
    const h = makeHarness();
    await landed(h);
    const animations = h.animationCalls.length;
    const visibility = h.visibilityChanges.length;
    for (const width of [410, 809, 810, 809, 390]) {
      await h.resize(width, 780);
      await h.tick(200);
      assert.equal(h.scene.dataset.state, 'landed', `Width ${width}px restarted arrival`);
      assert.equal(h.actor.dataset.pose, 'front');
      assert.equal(h.scene.classList.contains('is-landed'), true);
      assert.equal(h.scene.hidden, false);
    }
    assert.equal(h.visibilityChanges.length, visibility, 'Resize flashed the original hero');
    assert.equal(h.animationCalls.length, animations, 'Resize replayed arrival');
    h.cleanup();
  }],
  ['width changes preserve an in-progress landing turn and its original timing', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().total);
    assert.equal(h.scene.dataset.state, 'landing');
    const turn = h.animationCalls.at(-1);
    const calls = h.animationCalls.length;
    const visibility = h.visibilityChanges.length;
    await h.resize(410, 780);
    assert.equal(h.scene.dataset.state, 'landing');
    assert.equal(turn.cancelled, false, 'Width resize cancelled a valid landing');
    assert.equal(h.animationCalls.length, calls, 'Width resize replaced the landing turn');
    assert.equal(h.visibilityChanges.length, visibility, 'Width resize hid the active turn');
    await h.tick(140);
    assert.equal(h.scene.dataset.state, 'landed', 'Width resize delayed the arrival');
    assert.equal(h.actor.dataset.pose, 'front');
    h.cleanup();
  }],
  ['width changes preserve the first turn toward the ladder', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().pitch * 2);
    await h.tick();
    assert.equal(h.scene.dataset.state, 'deploying');
    const turn = h.animationCalls.at(-1);
    const calls = h.animationCalls.length;
    const visibility = h.visibilityChanges.length;
    await h.resize(410, 780);
    assert.equal(turn.cancelled, false, 'Width resize cancelled the initial turn');
    assert.equal(h.animationCalls.length, calls, 'Width resize replayed the initial turn');
    assert.equal(h.visibilityChanges.length, visibility, 'Width resize hid the deploying scene');
    await h.tick(140);
    assert.equal(h.scene.dataset.state, 'climbing');
    assert.ok(['a', 'b'].includes(h.actor.dataset.pose));
    h.cleanup();
  }],
  ['a larger resized route keeps its endpoint mode until deliberate scrolling resumes', async () => {
    const h = makeHarness();
    await landed(h);
    const position = h.window.scrollY;
    const animations = h.animationCalls.length;
    const visibility = h.visibilityChanges.length;
    await h.resize(810, 900, 900);
    assert.ok(h.route().total > position, 'Fixture did not move the endpoint beyond the current scroll');
    assert.equal(h.window.scrollY, position, 'Resize changed the user scroll position');
    assert.equal(h.scene.dataset.state, 'landed');
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.scene.classList.contains('is-landed'), true);
    assert.equal(h.animationCalls.length, animations, 'Route resize invented another turn gesture');
    assert.equal(h.visibilityChanges.length, visibility, 'Route resize exchanged the foreground');
    const resizedTop = h.actorDocumentTop() - h.window.scrollY;
    const resizedHeight = 1249 * Number.parseFloat(h.scene.style['--sprite-unit']);
    assert.ok(resizedTop >= 0 && resizedTop + resizedHeight < h.window.innerHeight,
      'Expanding the route pushed the parked character outside the viewport');
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed', 'A later idle frame reopened the ladder');
    await h.scrollTo(position + 10);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'climbing', 'Deliberate scroll did not resume the resized route');
    assert.ok(['a', 'b'].includes(h.actor.dataset.pose));
    assert.equal(h.scene.classList.contains('is-landed'), false);
    const resumedTop = h.actorDocumentTop() - h.window.scrollY;
    assert.ok(Math.abs(resumedTop - resizedTop) < 10,
      'The first small scroll after resize jumped from a forced endpoint position');
    await h.scrollTo(h.route().total);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed', 'The recalculated endpoint did not remain reachable');
    h.cleanup();
  }],
  ['resize scroll anchoring preserves the landed mode without moving native scroll', async () => {
    const h = makeHarness();
    await landed(h);
    const calls = h.animationCalls.length;
    const position = h.window.scrollY;
    h.resizeNow(810, 900, 900);
    const anchoredScroll = position + 30;
    h.queueScroll(anchoredScroll);
    await h.tick();
    await h.tick(200);
    assert.equal(h.window.scrollY, anchoredScroll, 'The resize guard overrode native scroll anchoring');
    assert.equal(h.scene.dataset.state, 'landed', 'Browser anchoring reopened the ladder');
    assert.equal(h.actor.dataset.pose, 'front');
    assert.equal(h.animationCalls.length, calls, 'Browser anchoring replayed a turn');
    await h.scrollTo(anchoredScroll - h.route().pitch * 1.5);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'climbing', 'A deliberate reverse scroll remained locked');
    h.cleanup();
  }],
  ['a shorter resize route does not make a stationary climbing avatar arrive', async () => {
    const h = makeHarness();
    await h.ready();
    await h.scrollTo(h.route().total - h.route().pitch * 2);
    await h.tick();
    await h.tick(200);
    const position = h.window.scrollY;
    const pose = h.actor.dataset.pose;
    const calls = h.animationCalls.length;
    await h.resize(810, 390, 390);
    assert.ok(h.route().total < position, 'Fixture did not shorten the route below the stationary scroll');
    assert.equal(h.scene.dataset.state, 'climbing', 'Resize invented a bottom arrival');
    assert.equal(h.actor.dataset.pose, pose, 'Resize replaced the stationary climbing pose');
    await h.tick(200);
    assert.equal(h.animationCalls.length, calls, 'Resize started a delayed arrival');
    await h.scrollTo((h.route().total + h.maxScroll()) / 2);
    await h.tick(200);
    assert.equal(h.scene.dataset.state, 'landed', 'Real scrolling could no longer reach arrival');
    h.cleanup();
  }],
  ['width changes preserve the return turn and replay the speech once', async () => {
    const h = makeHarness();
    await landed(h);
    await h.scrollTo(0);
    assert.equal(h.scene.dataset.state, 'returning');
    const turn = h.animationCalls.at(-1);
    const calls = h.animationCalls.length;
    await h.resize(410, 780);
    assert.equal(h.scene.dataset.state, 'returning');
    assert.equal(turn.cancelled, false, 'Width resize cancelled the return turn');
    assert.equal(h.animationCalls.length, calls, 'Width resize replayed the return turn');
    await h.tick(200);
    assert.equal(h.scene.hidden, true);
    assert.equal(h.hero.classList.contains('descent-active'), false);
    assert.equal(h.animationCalls.filter(call => call.name === 'speech').length, 1);
    assert.equal(h.scene.style['--descent-shift'], undefined);
    assert.equal(h.status.style.translate, undefined);
    h.cleanup();
  }],
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
    const parkedTop = h.actorDocumentTop();
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
      assert.equal(h.actorDocumentTop(), parkedTop, 'Toolbar height changes moved the lowered landing');
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
    const tiles = [...h.strip.children];
    await h.resize(844, 390, 390);
    assert.notEqual(h.strip.childElementCount, tiles.length, 'Orientation did not update ladder extent');
    assert.deepEqual(h.strip.children.slice(0, Math.min(tiles.length, h.strip.childElementCount)),
      tiles.slice(0, Math.min(tiles.length, h.strip.childElementCount)),
      'Orientation replaced visible leading ladder tiles');
    assert.equal(h.strip.replacements, 0, 'Orientation rebuilt the complete strip');
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
      [total - pitch * 1.01, 40, total, 'landing'],
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
