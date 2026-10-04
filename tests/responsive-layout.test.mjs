import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { getHeroLayout } from '../site/responsive-layout.js';

const source = await readFile(new URL('../site/responsive-layout.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const metrics = { nameWidths: [2.662, 3.398], introWidths: [9.72, 9.19], statusWidths: [9.92, 13.86] };
const near = (actual, expected, label, tolerance = .001) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${label}: expected ${expected}, received ${actual}`);
const center = bounds => bounds.left + bounds.width / 2;
const overlap = (first, last) => Math.min(first.left + first.width, last.left + last.width)
  - Math.max(first.left, last.left) > .1 && Math.min(first.top + first.height, last.top + last.height)
  - Math.max(first.top, last.top) > .1;
const boxes = layout => [...layout.names, layout.character, layout.speech, layout.intro, layout.status];
function numericValues(value) {
  if (typeof value === 'number') return [value];
  return Object.values(value).flatMap(numericValues);
}
function continuous(first, last, label) {
  const a = numericValues(first); const b = numericValues(last);
  assert.equal(a.length, b.length);
  for (let index = 0; index < a.length; index++) near(a[index], b[index], `${label}: value ${index}`, .01);
}

function eventTarget() {
  const events = new Map();
  return {
    addEventListener(type, callback) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(callback);
    },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
    emit(type) { for (const callback of [...events.get(type) || []]) callback(); },
    get listenerCount() { return [...events.values()].reduce((sum, group) => sum + group.size, 0); },
  };
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function makeHarness({ width = 1200, height = 900, stableHeight = height, pending = false,
  measuredMetrics = metrics, missingHero = false, parentScale = 1, withHeader = false,
  reducedMotion = false } = {}) {
  const writes = [];
  const gate = deferred();
  let time = 0;
  let nextFrame = 1;
  const frames = new Map();
  const window = Object.assign(eventTarget(), { innerWidth: width, innerHeight: height, scrollY: 240 });
  const motion = Object.assign(eventTarget(), { matches: reducedMotion });
  window.matchMedia = query => {
    assert.equal(query, '(prefers-reduced-motion: reduce)');
    return motion;
  };
  const makeElement = (name, ratio) => {
    const style = new Proxy({ setProperty(property, value) { this[property] = value; } }, {
      set(target, property, value) { writes.push([name, property, value]); target[property] = value; return true; },
    });
    return { name, style, ratio, querySelector: () => null,
      animate() { throw new Error('Layout used a presentation animation'); } };
  };
  const names = measuredMetrics.nameWidths.map((ratio, index) => makeElement(`name-${index}`, ratio));
  const introRows = measuredMetrics.introWidths.map((ratio, index) => makeElement(`intro-${index}`, ratio));
  const statusRows = measuredMetrics.statusWidths.map((ratio, index) => makeElement(`status-${index}`, ratio));
  const elements = Object.fromEntries(['character', 'speech', 'intro', 'status', 'indicator']
    .map(name => [name, makeElement(name)]));
  introRows.forEach(element => { element.parentElement = elements.intro; });
  statusRows.forEach(element => { element.parentElement = elements.status; });
  elements.intro.querySelectorAll = () => introRows;
  elements.status.querySelectorAll = () => statusRows;
  const classes = new Set();
  const headerClasses = new Set();
  const headerLinks = [[12.25, 3], [15, 4.4]].map((ratios, index) => {
    const labels = ratios.map((ratio, label) => makeElement(`header-${index}-${label}`, ratio));
    const link = makeElement(`header-link-${index}`);
    link.querySelector = selector => ({ '.desktop-label': labels[0], '.mobile-label': labels[1] })[selector];
    return link;
  });
  const header = { ...makeElement('header'),
    classList: { add: name => headerClasses.add(name), contains: name => headerClasses.has(name) },
    querySelectorAll: () => headerLinks,
  };
  const hero = { ...makeElement('hero'),
    classList: { add: name => classes.add(name), contains: name => classes.has(name) },
    querySelectorAll: () => names,
    querySelector: selector => ({ '.character-position': elements.character, '.speech': elements.speech,
      '.hero-intro': elements.intro, '.status': elements.status, '.scroll-indicator': elements.indicator })[selector],
  };
  const fontSize = element => element.name.startsWith('header') ? 20 : parseFloat(element.name.startsWith('name-')
    ? hero.style['--layout-name-size'] || '100px' : hero.style['--layout-details-size'] || '20px');
  const document = { querySelector: selector => selector === '.hero' ? (missingHero ? null : hero)
    : selector === '.contact-header' && withHeader ? header : null,
    createRange: () => ({ selectNodeContents(element) { this.element = element; },
      getBoundingClientRect() { return { width: this.element.ratio * fontSize(this.element)
        * (this.element.parentElement ? parentScale : 1) }; } }),
  };
  const context = vm.createContext({ document, window,
    getComputedStyle: element => element === hero ? { minHeight: `${stableHeight}px` }
      : { fontSize: `${fontSize(element)}px`, scale: `${parentScale} ${parentScale}` },
    performance: { now: () => time },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  vm.runInContext(source.replace(/export function/g, 'function')
    + '\nthis.initResponsiveLayout = initResponsiveLayout;', context);
  const controller = context.initResponsiveLayout({ layoutReady: pending ? gate.promise : Promise.resolve() });
  const bounds = element => Object.fromEntries(['left', 'top', 'width', 'height']
    .map(property => [property, parseFloat(element.style[property])]));
  const assertCommitted = layout => {
    near(parseFloat(hero.style.height), layout.height, 'Hero has its actual height');
    near(parseFloat(hero.style['--character-height']), layout.character.height, 'Actual sprite height');
    near(parseFloat(hero.style['--layout-name-size']), layout.nameSize, 'Actual name font size');
    near(parseFloat(hero.style['--layout-details-size']), layout.detailSize, 'Actual copy font size');
    for (const [index, element] of names.entries()) assert.deepEqual(bounds(element), { ...layout.names[index] });
    for (const name of ['character', 'intro', 'status', 'indicator']) {
      assert.deepEqual(bounds(elements[name]), { ...layout[name] }, `Committed ${name} geometry`);
    }
    const speech = bounds(elements.speech);
    near(speech.left + layout.character.left, layout.speech.left, 'Bubble left follows its parent');
    near(speech.top + layout.character.top, layout.speech.top, 'Bubble top follows its parent');
    for (const [rows, offsets] of [[introRows, layout.introRowOffsets], [statusRows, layout.statusRowOffsets]]) {
      rows.forEach((element, index) => near(parseFloat(element.style.marginLeft), offsets[index], 'Copy row offset'));
    }
    assert.ok(classes.has('layout-managed'));
  };
  return { window, hero, elements, header, headerLinks, controller, writes, gate, assertCommitted, motion,
    get pendingFrames() { return frames.size; },
    advance(milliseconds = 16) {
      time += milliseconds;
      const current = [...frames.values()]; frames.clear();
      for (const callback of current) callback(time);
    },
    settle() {
      for (let index = 0; frames.size && index < 64; index++) this.advance(16);
      assert.equal(frames.size, 0, 'Responsive layout kept animating after it settled');
    },
    resize(nextWidth, nextHeight = stableHeight) {
      window.innerWidth = nextWidth; window.innerHeight = nextHeight; stableHeight = nextHeight; window.emit('resize');
    },
  };
}

const tests = [
  ['desktop and portrait endpoints retain the original sizes and composition', () => {
    const wide = getHeroLayout({ width: 1364, height: 1244 });
    near(wide.progress, 0, 'Desktop layout');
    near(wide.character.height, 313.72, 'Desktop sprite baseline');
    near(wide.nameSize, 189.08227778710076, 'Desktop font baseline');
    near(wide.names[0].top, wide.names[1].top, 'Desktop name baseline');
    near(wide.names[0].left, 22.7788, 'Desktop left edge');
    near(wide.names[1].left + wide.names[1].width, 1364 - 22.7788, 'Desktop right edge');
    near(center(wide.character), center(wide.speech), 'Desktop bubble axis');
    near(center(wide.character), center(wide.indicator), 'Desktop arrow axis');
    near(wide.detailSize, 20, 'Desktop copy size');
    const mobile = getHeroLayout({ width: 390, height: 844 });
    near(mobile.progress, 1, 'Portrait layout');
    near(mobile.nameSize, 105.29411764705883, 'Portrait font baseline');
    near(mobile.character.height, 250, 'Portrait sprite baseline');
    near(mobile.speech.width, 238, 'Portrait bubble baseline');
    near(mobile.detailSize, 16.88, 'Portrait copy baseline');
    for (const bounds of [...mobile.names, mobile.character, mobile.speech, mobile.indicator]) {
      near(center(bounds), 195, 'Portrait shared axis');
    }
    near(mobile.names[0].top + mobile.names[0].height, mobile.names[1].top, 'Stacked name lines');
    near(mobile.character.top - mobile.speech.top - mobile.speech.height, 8, 'Bubble gap');
    near(mobile.status.top - mobile.intro.top - mobile.intro.height, 8, 'Equal copy group gap');
  }],
  ['every settled viewport selects a complete desktop or portrait composition', () => {
    for (const height of [305, 390, 568, 650, 844, 1000, 1244]) for (let width = 320; width <= 1500; width += 4) {
      const layout = getHeroLayout({ width, height });
      const portrait = width <= 500 || width <= 809 && width / height <= 1.2;
      near(layout.progress, portrait ? 1 : 0, `Complete composition at ${width}×${height}`);
      near(layout.sideProgress, width <= 809 ? 1 : 0, `Complete side layout at ${width}×${height}`);
      if (!portrait) near(layout.names[0].top, layout.names[1].top, 'Settled desktop names share a baseline');
      else for (const bounds of [...layout.names, layout.character, layout.speech]) {
        near(center(bounds), width / 2, 'Settled portrait remains centered');
      }
    }
    const reported = getHeroLayout({ width: 849, height: 1244 });
    near(reported.progress, 0, 'Reported intermediate-width screenshot resolves to desktop');
    near(reported.sideProgress, 0, 'Reported intermediate-width header resolves to desktop');
    near(reported.names[0].top, reported.names[1].top, 'Reported screenshot cannot keep diagonal names');
  }],
  ['real geometry is fluid within a fixed composition and animation progress', () => {
    for (const height of [305, 390, 568, 650, 844, 1000, 1244]) {
      for (const width of [500, 720, 760, 800, 809, 810, 860, 960, height * 1.05, height * 1.2, height * 1.4]) {
        for (const progress of [0, .25, .5, .75, 1]) {
          continuous(getHeroLayout({ width: width - .00001, height, progress, sideProgress: progress }),
            getHeroLayout({ width: width + .00001, height, progress, sideProgress: progress }),
            `Width ${width} at height ${height}, progress ${progress}`);
        }
      }
    }
    for (const width of [390, 700, 809, 1024]) for (const height of [460, 500, 540, 620, 650, 680, width / 1.2]) {
      for (const progress of [0, .5, 1]) continuous(
        getHeroLayout({ width, height: height - .00001, progress, sideProgress: progress }),
        getHeroLayout({ width, height: height + .00001, progress, sideProgress: progress }),
        `Height ${height} at width ${width}, progress ${progress}`);
    }
  }],
  ['the transition keeps names, bubble, sprite and copy clear of one another', () => {
    const samples = [];
    for (const height of [305, 390, 568, 650, 844, 1000, 1244]) for (let width = 320; width <= 1500; width += 4) {
      samples.push({ width, height });
    }
    for (const height of [568, 650, 844, 1000, 1244]) for (const width of [720, 760, 799, 809, 810, 849, 860, 900]) {
      for (let step = 0; step <= 50; step++) samples.push({ width, height,
        progress: step / 50, sideProgress: step / 50 });
    }
    for (const sample of samples) {
      const { width, height } = sample;
      const layout = getHeroLayout(sample);
      assert.ok(numericValues(layout).every(Number.isFinite), `Invalid geometry at ${width}×${height}`);
      near(layout.character.width / layout.character.height, 444 / 1180, 'Undistorted sprite');
      near(layout.speech.width / layout.speech.height, 3.2, 'Undistorted bubble');
      near(center(layout.character), center(layout.speech), 'Bubble follows the sprite axis');
      near(center(layout.character), center(layout.indicator), 'Arrow follows the sprite axis');
      for (const bounds of boxes(layout)) {
        assert.ok(bounds.width > 0 && bounds.height > 0, `Collapsed content at ${width}×${height}`);
        assert.ok(bounds.left >= -.1 && bounds.left + bounds.width <= width + .1,
          `Horizontal overflow at ${width}×${height}: ${JSON.stringify(bounds)}`);
        assert.ok(bounds.top >= 64 - .1 && bounds.top + bounds.height <= layout.height + .1,
          `Vertical overflow at ${width}×${height}: ${JSON.stringify(bounds)}`);
      }
      const content = boxes(layout);
      for (let first = 0; first < content.length; first++) for (let last = first + 1; last < content.length; last++) {
        assert.equal(overlap(content[first], content[last]), false,
          `Overlapping content ${first}/${last} at ${width}×${height}, progress ${layout.progress}`);
      }
    }
  }],
  ['measured text metrics keep each real row within its assigned bounds', () => {
    const custom = { nameWidths: [2.7, 3.4], introWidths: [10, 9.5], statusWidths: [10.1, 14.1] };
    for (const width of [390, 700, 790, 830, 1364]) {
      const layout = getHeroLayout({ width, height: 844, metrics: custom });
      for (const [ratios, row, offsets] of [[custom.introWidths, layout.intro, layout.introRowOffsets],
        [custom.statusWidths, layout.status, layout.statusRowOffsets]]) {
        ratios.forEach((ratio, index) => assert.ok(offsets[index] >= 0
          && offsets[index] + ratio * layout.detailSize <= row.width + .001, 'A real text row overflows'));
      }
      layout.names.forEach((bounds, index) => near(bounds.width, custom.nameWidths[index] * layout.nameSize,
        'The actual font determines name width'));
    }
  }],
  ['controller subscribers see complete real geometry before each resize returns', async () => {
    const h = makeHarness(); const layouts = [];
    h.controller.subscribe(layout => { h.assertCommitted(layout); layouts.push(layout); });
    await flush(); assert.equal(layouts.length, 1);
    for (const width of [780, 820, 400, 1400, 390]) {
      const previous = layouts.length; h.resize(width, 844);
      assert.equal(layouts.length, previous + 1, 'Resize deferred or duplicated its geometry update');
      near(layouts.at(-1).width, width, 'The displayed viewport is authoritative');
    }
    assert.equal(h.window.scrollY, 240, 'Layout changed native scroll');
    assert.ok(h.writes.every(([, property, value]) => property !== 'scale'
      && property !== 'transform' && !String(value).includes('scale(')), 'Sizes were implemented by scaling transforms');
    assert.equal(h.window.listenerCount, 1, 'Layout installed a scroll/animation event loop');
    let latest;
    const unsubscribe = h.controller.subscribe(layout => { latest = layout; });
    assert.equal(latest, layouts.at(-1), 'Late subscribers did not receive the displayed layout');
    unsubscribe(); const last = latest; h.resize(500); assert.equal(latest, last);
  }],
  ['a mode transition finishes despite uninterrupted same-target resize events', async () => {
    const h = makeHarness({ width: 849, height: 1244 }); let latest;
    h.controller.subscribe(layout => { h.assertCommitted(layout); latest = layout; }); await flush();
    near(latest.progress, 0, 'Intermediate-width startup is a complete desktop composition');
    assert.equal(h.pendingFrames, 0, 'A settled startup scheduled a mode animation');
    h.resize(799, 1244);
    near(latest.progress, 0, 'A breakpoint crossing starts from the displayed desktop composition');
    assert.ok(h.pendingFrames > 0, 'A breakpoint crossing did not animate');
    let previous = latest.progress;
    for (let elapsed = 16; elapsed <= 784; elapsed += 16) {
      h.advance(); h.resize(790 + elapsed % 10, 1244);
      assert.ok(latest.progress >= previous, 'Same-target resize restarted or reversed the mode transition');
      assert.ok(latest.progress >= 0 && latest.progress <= 1, 'Mode animation overshot its endpoints');
      previous = latest.progress;
    }
    h.advance(16); h.resize(799, 1244);
    near(latest.progress, 1, 'Portrait composition completes within 800 ms');
    near(latest.sideProgress, 1, 'Portrait side layout completes within 800 ms');
    assert.equal(h.pendingFrames, 0, 'Same-target resize prolonged an already completed animation');
    for (const width of [799, 770, 730, 690]) {
      h.resize(width, 1244); near(latest.progress, 1, 'Portrait resizing stays fully composed');
      assert.equal(h.pendingFrames, 0, 'Fluid sizing restarted a settled mode transition');
    }
    h.resize(849, 1244); h.advance(800);
    near(latest.progress, 0, 'Reported intermediate width returns to a complete desktop composition');
    near(latest.sideProgress, 0, 'Reported intermediate width cannot retain a partial side layout');
    near(latest.names[0].top, latest.names[1].top, 'Settled desktop names share a baseline');
    assert.equal(h.pendingFrames, 0, 'Completed desktop transition kept rendering');
  }],
  ['the mode change remains in motion at the old deadline and slows into its final layout', async () => {
    const h = makeHarness({ width: 849, height: 1244 }); let latest;
    h.controller.subscribe(layout => { h.assertCommitted(layout); latest = layout; }); await flush();
    h.resize(799, 1244);
    h.advance(280); h.resize(797, 1244);
    assert.ok(latest.progress > 0 && latest.progress < .5, 'The new transition still finishes or rushes through its first half');
    assert.ok(latest.sideProgress > 0 && latest.sideProgress < .5, 'The ladder side shift finishes ahead of the composition');
    assert.equal(h.pendingFrames, 1, 'The slower transition is not running at the old deadline');
    let previous = latest.progress;
    let previousDelta = Infinity;
    for (let elapsed = 320; elapsed <= 800; elapsed += 40) {
      h.advance(40); h.resize(791 + elapsed % 7, 1244);
      const delta = latest.progress - previous;
      assert.ok(delta >= 0 && latest.progress <= 1, 'Transition reversed or overshot its final layout');
      if (elapsed > 440) assert.ok(delta <= previousDelta + .000001, 'The latter half accelerates instead of settling');
      previous = latest.progress;
      previousDelta = delta;
    }
    near(latest.progress, 1, 'Transition settles at 800 ms despite continuing resize events');
    near(latest.sideProgress, 1, 'Ladder side shift settles with the composition');
    assert.equal(h.pendingFrames, 0, 'Same-target events extended the transition deadline');
  }],
  ['reversing a breakpoint transition starts from its current visible position', async () => {
    const h = makeHarness({ width: 849, height: 1244 }); let latest;
    h.controller.subscribe(layout => { latest = layout; }); await flush();
    h.resize(799, 1244); h.advance(96);
    assert.ok(latest.progress > 0 && latest.progress < 1, 'No intermediate animation was presented');
    const currentProgress = latest.progress; const currentSide = latest.sideProgress;
    h.resize(849, 1244);
    near(latest.progress, currentProgress, 'Reversal preserves current composition progress');
    near(latest.sideProgress, currentSide, 'Reversal preserves current side progress');
    h.advance(16);
    assert.ok(latest.progress < currentProgress, 'Reversal kept moving toward the old target');
    h.advance(784); near(latest.progress, 0, 'Reversed animation finishes at desktop');
    near(latest.sideProgress, 0, 'Reversed side layout finishes at desktop');
    assert.equal(h.pendingFrames, 0);
  }],
  ['reduced motion selects the final composition and stops an active transition', async () => {
    const h = makeHarness({ width: 849, height: 1244, reducedMotion: true }); let latest;
    h.controller.subscribe(layout => { latest = layout; }); await flush();
    h.resize(799, 1244); near(latest.progress, 1, 'Reduced-motion portrait selects its endpoint immediately');
    assert.equal(h.pendingFrames, 0, 'Reduced motion started an animation');
    h.motion.matches = false; h.motion.emit('change');
    h.resize(849, 1244); h.advance(96);
    assert.ok(latest.progress > 0 && latest.progress < 1, 'Motion was not restored after the preference changed');
    h.motion.matches = true; h.motion.emit('change');
    near(latest.progress, 0, 'Turning on reduced motion resolves the active transition');
    near(latest.sideProgress, 0, 'Turning on reduced motion resolves the active side layout');
    assert.equal(h.pendingFrames, 0, 'Reduced-motion change left an animation frame queued');
    h.controller.cleanup(); assert.equal(h.motion.listenerCount, 0, 'Cleanup leaked the preference listener');
  }],
  ['font readiness recalibrates widths and viewport height follows the stable CSS viewport', async () => {
    const custom = { nameWidths: [2.7, 3.4], introWidths: [10, 9.5], statusWidths: [10.1, 14.1] };
    const h = makeHarness({ pending: true, height: 900, stableHeight: 844, measuredMetrics: custom });
    const layouts = []; h.controller.subscribe(layout => layouts.push(layout));
    assert.equal(layouts.length, 0, 'Font metrics were used before readiness');
    h.window.innerWidth = 390; h.window.emit('resize');
    near(layouts.at(-1).height, 844, 'Stable viewport height');
    h.gate.resolve(); await flush(); h.settle(); h.assertCommitted(layouts.at(-1));
    near(layouts.at(-1).names[0].width, custom.nameWidths[0] * layouts.at(-1).nameSize, 'Loaded font width');
    near(layouts.at(-1).status.width, custom.statusWidths[1] * layouts.at(-1).detailSize, 'Loaded copy width');
  }],
  ['font measurement removes the existing descent scale from each paragraph', async () => {
    const custom = { nameWidths: [2.7, 3.4], introWidths: [10, 9.5], statusWidths: [10.1, 14.1] };
    const h = makeHarness({ width: 390, height: 844, parentScale: .68, measuredMetrics: custom });
    let latest; h.controller.subscribe(layout => { latest = layout; }); await flush();
    near(latest.status.width, custom.statusWidths[1] * latest.detailSize, 'Natural copy width after scaled measurement');
    h.resize(1364, 1244); h.settle();
    near(latest.intro.width, custom.introWidths[0] * latest.detailSize, 'Restored desktop copy width');
    near(latest.status.width, custom.statusWidths[1] * latest.detailSize, 'Restored status width');
  }],
  ['resizing and late fonts preserve the initial name entrance distance and timing', async () => {
    const properties = ['--name-entry-distance', '--given-entry-delay', '--family-entry-delay',
      '--given-entry-easing', '--family-entry-easing'];
    for (const initial of [{ width: 1364, height: 1244, pending: false, distance: 150, delays: [1.2, 1.6] },
      { width: 390, height: 844, pending: true, distance: 10, delays: [1, 1.075] }]) {
      const h = makeHarness(initial);
      if (initial.pending) h.window.emit('resize'); // The first layout can precede fonts.
      else await flush();
      const settings = Object.fromEntries(properties.map(property => [property, h.hero.style[property]]));
      near(parseFloat(settings['--name-entry-distance']), initial.distance, 'Original entrance distance');
      near(parseFloat(settings['--given-entry-delay']), initial.delays[0], 'Original given-name timing');
      near(parseFloat(settings['--family-entry-delay']), initial.delays[1], 'Original family-name timing');
      for (const width of [790, 860, 390, 1364]) h.resize(width, 844);
      h.gate.resolve(); await flush();
      assert.deepEqual(Object.fromEntries(properties.map(property => [property, h.hero.style[property]])), settings,
        'A resize or font commit restarted the entrance with new parameters');
      for (const property of properties) assert.equal(h.writes.filter(([, key]) => key === property).length, 1,
        `Entrance parameter ${property} was rewritten`);
    }
  }],
  ['header labels animate across modes and settle at full opacity', async () => {
    const h = makeHarness({ withHeader: true, width: 1364 }); await flush();
    const headerValues = () => [...h.headerLinks.flatMap(link => [parseFloat(link.style.left), parseFloat(link.style.width)]),
      Number(h.header.style['--desktop-label-opacity']), Number(h.header.style['--mobile-label-opacity'])];
    near(parseFloat(h.headerLinks[0].style.left), 24, 'Desktop email edge');
    near(parseFloat(h.headerLinks[0].style.width), 245, 'Desktop label width');
    near(Number(h.header.style['--desktop-label-opacity']), 1, 'Desktop label visible');
    h.resize(390); h.settle();
    near(parseFloat(h.headerLinks[0].style.left) + parseFloat(h.headerLinks[0].style.width) / 2, 390 * .27, 'Mobile email axis');
    near(parseFloat(h.headerLinks[1].style.left) + parseFloat(h.headerLinks[1].style.width) / 2, 390 * .73, 'Mobile LinkedIn axis');
    near(Number(h.header.style['--mobile-label-opacity']), 1, 'Mobile label visible');
    h.resize(849, 1244);
    for (let elapsed = 16; elapsed <= 800; elapsed += 16) {
      h.advance(); h.resize(849 + elapsed % 7, 1244);
      const [, , , , desktop, mobile] = headerValues();
      assert.ok(desktop >= 0 && desktop <= 1 && mobile >= 0 && mobile <= 1);
      near(desktop + mobile, 1, 'Header labels retain visible text throughout the crossfade');
    }
    near(Number(h.header.style['--desktop-label-opacity']), 1, 'Reported width desktop label fully visible');
    near(Number(h.header.style['--mobile-label-opacity']), 0, 'Reported width mobile label fully hidden');
    h.resize(799, 1244); h.advance(800);
    near(Number(h.header.style['--desktop-label-opacity']), 0, 'Portrait desktop label fully hidden');
    near(Number(h.header.style['--mobile-label-opacity']), 1, 'Portrait mobile label fully visible');
    for (const width of [390, 700, 799, 809]) {
      h.resize(width - .00001, 1244); const first = headerValues();
      h.resize(width, 1244); const last = headerValues();
      first.forEach((value, index) => near(value, last[index], `Settled header fluid sizing at ${width}`, .01));
      assert.equal(h.pendingFrames, 0, 'Same header mode started another animation');
    }
  }],
  ['unsubscribe and cleanup stop callbacks and late font work', async () => {
    const h = makeHarness({ pending: true }); let callbacks = 0;
    const unsubscribe = h.controller.subscribe(() => callbacks++);
    h.resize(700); assert.equal(callbacks, 1);
    unsubscribe(); h.resize(800); assert.equal(callbacks, 1);
    h.controller.cleanup(); const writes = h.writes.length;
    assert.equal(h.window.listenerCount, 0);
    assert.equal(h.pendingFrames, 0, 'Cleanup left a responsive frame queued');
    h.resize(1200); h.advance(300); h.gate.resolve(); await flush();
    assert.equal(h.writes.length, writes, 'Disposed font work rewrote the layout');
    assert.equal(callbacks, 1);
  }],
  ['cleanup cancels an in-progress breakpoint animation', async () => {
    const h = makeHarness({ width: 849, height: 1244 }); let latest;
    h.controller.subscribe(layout => { latest = layout; }); await flush();
    h.resize(799, 1244); h.advance(96);
    assert.ok(h.pendingFrames > 0, 'The test did not reach an active transition');
    const displayed = latest; const writes = h.writes.length;
    h.controller.cleanup(); assert.equal(h.pendingFrames, 0, 'Cleanup retained a queued animation');
    h.advance(300); h.resize(849, 1244);
    assert.equal(latest, displayed, 'Disposed animation emitted another layout');
    assert.equal(h.writes.length, writes, 'Disposed animation changed displayed geometry');
  }],
  ['a rejected layout dependency and a missing hero have usable fallbacks', async () => {
    const h = makeHarness({ pending: true }); let latest;
    h.controller.subscribe(layout => { latest = layout; }); h.gate.reject(new Error('Font failed')); await flush();
    h.assertCommitted(latest);
    const absent = makeHarness({ missingHero: true });
    const unsubscribe = absent.controller.subscribe(() => assert.fail('Missing hero emitted a layout'));
    unsubscribe(); absent.controller.cleanup(); absent.resize(390);
    assert.equal(absent.writes.length, 0); assert.equal(absent.window.listenerCount, 0);
  }],
];

let failed = 0;
for (const [name, test] of tests) {
  try { await test(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} responsive layout scenarios passed`);
process.exitCode = failed ? 1 : 0;
