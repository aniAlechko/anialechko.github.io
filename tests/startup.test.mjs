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

function makeHarness({ fonts = 'ready', images = 'ready', background = 'ready', reducedMotion = false } = {}) {
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
      onInteraction = options.onInteraction;
      return { setRoute() {}, getTarget: () => null };
    },
    initDescent() {},
    async loadBackground() {
      if (background === 'missing') throw new Error('Background module unavailable');
      if (background === 'pending') await backgroundGate.promise;
      return { async initBackground(fontsReady) {
        await fontsReady;
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
