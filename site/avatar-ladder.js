let currentCleanup;

export function initDescent({ onInteraction = () => {}, layoutReady = Promise.resolve(), onLayout = () => {}, getScrollTarget = () => null } = {}) {
  if (currentCleanup) return currentCleanup;

  const hero = document.querySelector('.hero');
  const original = document.querySelector('.character');
  const speech = hero?.querySelector('.speech');
  const speechWords = [...hero?.querySelectorAll('.speech-word') || []];
  const details = ['.hero-intro', '.status'].map(selector => hero?.querySelector(selector)).filter(Boolean);
  const stage = document.querySelector('#descent-stage');
  const scene = document.querySelector('#descent-scene');
  const ladder = scene?.querySelector('.descent-ladder');
  const strip = scene?.querySelector('.descent-ladder-strip');
  const actor = scene?.querySelector('.descent-actor');
  const turnElement = scene?.querySelector('.descent-turn');
  const probe = scene?.querySelector('.descent-ladder-probe');
  const poses = Object.fromEntries([...scene?.querySelectorAll('.descent-image') || []]
    .map(image => [image.dataset.pose, image]));
  if (![hero, original, stage, scene, ladder, strip, actor, turnElement, probe,
    poses.front, poses.a, poses.b].every(Boolean)) return () => {};

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let disposed = false;
  let assetsReady = false;
  let geometry;
  let frame = 0;
  let deploymentFrame = 0;
  let needsMeasure = true;
  let snapNext = true;
  let active = false;
  let travel = 0;
  let renderedTravel = null;
  let lastScroll = Math.max(0, window.scrollY);
  let turnAnimation;
  let turnDestination = null;
  let settledEndpoint = null;
  let swapTimer = 0;
  let turnTimer = 0;
  let assetTimer = 0;
  let speechAnimations = [];
  let speechRun = 0;
  let renderedPose;
  let renderedState;
  let renderedSideProgress = null;

  function resetSideLayout() {
    scene.style.removeProperty('--descent-shift');
    for (const detail of details) {
      detail.style.removeProperty('translate');
      detail.style.removeProperty('scale');
      detail.style.removeProperty('transform-origin');
    }
    renderedSideProgress = null;
  }

  function measureSideLayout(bounds, unit, top, heroHeight) {
    if (window.innerWidth > 809) return null;
    const edge = parseFloat(getComputedStyle(hero).paddingLeft) || 16;
    const gap = clamp(window.innerWidth * .03, 12, 24);
    const copyLeft = window.innerWidth / 2 + gap / 2;
    const copyWidth = window.innerWidth - edge - copyLeft;
    const center = bounds.left + bounds.width / 2;
    // Reserve the left edge for the widest climbing pose, independent of the hero.
    const shift = edge + 524 * unit / 2 - center;
    const rows = details.map(element => {
      const rect = element.getBoundingClientRect();
      return { element, left: rect.left, top: rect.top + window.scrollY,
        height: rect.height, scale: Math.min(1, copyWidth / rect.width) };
    });
    const copyHeight = rows.reduce((height, row) => height + row.height * row.scale, 0)
      + Math.max(0, rows.length - 1) * 8;
    let copyTop = Math.min(rows[0]?.top ?? heroHeight, heroHeight - edge - copyHeight);
    for (const row of rows) {
      row.x = copyLeft - row.left;
      row.y = copyTop - row.top;
      copyTop += row.height * row.scale + 8;
    }
    // Clear the copy before it scrolls into the feet; don't change the hero's flow.
    const clearance = (rows[0]?.top ?? heroHeight) - (top + 1249 * unit);
    return { shift, rows, range: clamp(clearance * 2, 16, 120) };
  }

  function moveSideLayout(scroll) {
    const layout = geometry?.sideLayout;
    if (!layout) return;
    const fraction = clamp(scroll / layout.range, 0, 1);
    const progress = 1 - (1 - fraction) ** 3;
    if (renderedSideProgress === progress) return;
    scene.style.setProperty('--descent-shift', `${layout.shift * progress}px`);
    for (const row of layout.rows) {
      row.element.style.transformOrigin = 'left top';
      row.element.style.translate = `${row.x * progress}px ${row.y * progress}px`;
      row.element.style.scale = `${1 + (row.scale - 1) * progress}`;
    }
    renderedSideProgress = progress;
  }

  function moveActor() {
    if (renderedTravel === travel) return;
    // Keep layout coordinates stable while scrolling; only composite the travel.
    actor.style.transform = `translate3d(0, ${travel}px, 0)`;
    renderedTravel = travel;
  }

  function cancelSpeechReplay() {
    speechRun++;
    for (const animation of speechAnimations) animation.cancel();
    speechAnimations = [];
  }

  function replaySpeech() {
    cancelSpeechReplay();
    if (!speech || reducedMotion.matches) return;
    const run = speechRun;
    const rise = speech.getBoundingClientRect().width * 0.14103;
    // Individual translate leaves desktop centering and mobile positioning intact.
    speechAnimations = [speech.animate([
      { opacity: 0, translate: '0 10px' },
      { opacity: 1, translate: '0 0' },
    ], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' }),
    ...speechWords.map((word, index) => word.animate([
      { transform: `translateY(${rise}px)` },
      { transform: 'translateY(0)' },
    ], {
      duration: 500,
      delay: 100 + index * 150,
      easing: 'cubic-bezier(.3, 0, 0, 1)',
      fill: 'both',
    }))];
    Promise.all(speechAnimations.map(animation => animation.finished)).then(() => {
      if (run === speechRun) cancelSpeechReplay();
    }).catch(() => {}); // Renewed scrolling deliberately cancels the replay.
  }

  function setPose(name) {
    if (renderedPose === name) return;
    for (const [pose, image] of Object.entries(poses)) image.hidden = pose !== name;
    actor.dataset.pose = name;
    renderedPose = name;
  }

  function setState(state) {
    if (renderedState === state) return;
    scene.dataset.state = state;
    renderedState = state;
  }

  function cancelTurn() {
    cancelAnimationFrame(deploymentFrame);
    deploymentFrame = 0;
    clearTimeout(swapTimer);
    clearTimeout(turnTimer);
    turnAnimation?.cancel();
    turnAnimation = undefined;
    turnDestination = null;
    scene.classList.remove('is-returning', 'is-landing');
  }

  function hideScene() {
    cancelTurn();
    resetSideLayout();
    active = false;
    settledEndpoint = null;
    travel = 0;
    scene.hidden = true;
    scene.classList.remove('is-active', 'is-landed');
    hero.classList.remove('descent-active');
    hero.classList.remove('return-ready');
    setPose('front');
    setState('idle');
  }

  function useNativeLayout() {
    cancelSpeechReplay();
    hideScene();
    stage.style.height = '0px';
    geometry = undefined;
    onLayout(null);
  }

  function measure() {
    needsMeasure = false;
    if (reducedMotion.matches) {
      useNativeLayout();
      return;
    }
    const bounds = original.getBoundingClientRect();
    const heroHeight = hero.getBoundingClientRect().height;
    if (bounds.height <= 0 || heroHeight <= 0) throw new Error('Avatar has no measurable size.');
    const unit = bounds.height / 1180;
    const center = bounds.left + bounds.width / 2;
    // Keep fractional layout coordinates, excluding only the entrance jump.
    // offsetTop rounds the mobile flex position and causes a handoff shift.
    const transform = getComputedStyle(original).transform;
    const jumpOffset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    const top = bounds.top + window.scrollY - jumpOffset;
    const pitch = 224 * unit;
    const arrivalBottom = top + 1249 * unit + 16;
    // A browser-toolbar resize is not a new layout. Keep the current pose,
    // ladder nodes, and arrival animation when the page itself has not moved.
    if (geometry && geometry.width === window.innerWidth
      && Math.abs(geometry.heroHeight - heroHeight) < 0.5
      && Math.abs(geometry.unit * 1180 - bounds.height) < 0.5
      && Math.abs(geometry.center - center) < 0.5
      && Math.abs(geometry.arrivalBottom - arrivalBottom) < 0.5
      && Math.abs(geometry.top - top) < 0.5) {
      return;
    }
    cancelSpeechReplay();
    hideScene();
    snapNext = true;
    // Arrive in the next screen, then let ordinary scrolling leave the avatar behind.
    const steps = Math.max(1, Math.ceil(heroHeight / pitch));
    const total = steps * pitch;
    const xUnit = unit * 380 / 299;
    const yUnit = unit * 224 / 217;
    const foot = top + 1242 * unit;
    const ladderTop = foot - (Math.ceil(1242 / 224) + 1) * pitch - 108 * yUnit;
    const ladderEnd = total + arrivalBottom;
    const tileCount = Math.ceil((ladderEnd - ladderTop) / pitch);
    const sideLayout = measureSideLayout(bounds, unit, top, heroHeight);
    geometry = { unit, pitch, steps, total, top, center, heroHeight, sideLayout,
      arrivalBottom, width: window.innerWidth };

    scene.style.setProperty('--sprite-unit', `${unit}px`);
    scene.style.setProperty('--ladder-x-unit', `${xUnit}px`);
    scene.style.setProperty('--ladder-y-unit', `${yUnit}px`);
    // Keep a complete arrival screen before contact, including Safari's largest
    // viewport. Its toolbar can then resize without moving either section.
    stage.style.height = `calc(${total - heroHeight}px + max(100lvh, ${arrivalBottom}px))`;
    actor.style.left = `${center - 524 * unit / 2}px`;
    actor.style.top = `${top}px`;
    moveActor();
    ladder.style.left = `${center - 374 * xUnit / 2}px`;
    ladder.style.top = `${ladderTop}px`;
    ladder.style.height = `${ladderEnd - ladderTop}px`;

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < tileCount; index++) {
      const tile = document.createElement('div');
      tile.className = 'ladder-tile';
      const image = document.createElement('img');
      image.src = probe.currentSrc || probe.src;
      image.alt = '';
      image.draggable = false;
      image.width = 1024;
      image.height = 1536;
      tile.append(image);
      fragment.append(tile);
    }
    strip.replaceChildren(fragment);
    onLayout({ pitch, total });
  }

  function turnTo(pose, destination, state, swap, finish) {
    const fromTransform = getComputedStyle(turnElement).transform;
    const alreadyFacing = actor.dataset.pose === pose
      || (pose === 'a' && actor.dataset.pose === 'b');
    cancelTurn();
    turnDestination = destination;
    settledEndpoint = null;
    setState(state);
    const duration = alreadyFacing ? 80 : 150;
    const lift = clamp(8 * geometry.unit, 1, 2.5);
    // A small weight shift connects the two sprite poses at full width.
    // Compressing the image sideways makes the character look like paper.
    const frames = alreadyFacing || destination === 'top' ? [
      { transform: fromTransform },
      { transform: 'translateY(0)' },
    ] : [
      { transform: fromTransform },
      { transform: `translateY(${-lift}px)`, offset: 0.3 },
      { transform: 'translateY(0)' },
    ];
    turnAnimation = turnElement.animate(frames, { duration, easing: 'ease-out' });
    swapTimer = setTimeout(() => {
      if (!active || turnDestination !== destination) return;
      swap();
      setPose(pose);
    }, alreadyFacing ? 0 : 30);
    turnTimer = setTimeout(() => {
      if (!active || turnDestination !== destination) return;
      try {
        cancelTurn();
        swap();
        setPose(pose);
        finish();
      } catch (error) {
        fail(error);
      }
    }, duration);
  }

  function startTurn() {
    cancelSpeechReplay();
    hero.classList.remove('return-ready');
    scene.classList.add('is-active');
    turnTo('a', 'back', 'deploying', () => {
      // Change the crop together with the pose, so the standing sprite stays put.
      scene.classList.remove('is-landed');
    }, schedule);
  }

  function activate(animateTurn) {
    cancelSpeechReplay();
    settledEndpoint = null;
    active = true;
    moveActor();
    scene.hidden = false;
    scene.classList.remove('is-landed');
    hero.classList.add('descent-active');
    if (!animateTurn) {
      scene.classList.add('is-active');
      return;
    }
    setPose('front');
    setState('deploying');
    // Paint the visible scene once before revealing the ladder's clipping mask.
    deploymentFrame = requestAnimationFrame(() => {
      deploymentFrame = 0;
      if (!active || disposed || reducedMotion.matches) return;
      try {
        startTurn();
      } catch (error) {
        fail(error);
      }
    });
  }

  function arriveAt(endpoint) {
    const atTop = endpoint === 'top';
    turnTo('front', endpoint, atTop ? 'returning' : 'landing', () => {
      scene.classList.toggle('is-landed', !atTop);
    }, () => {
      if (atTop) {
        replaySpeech();
        // Show the bubble promptly, but retain the aligned foreground sprite
        // until the last scroll pixels settle. Exchanging it earlier jumps by scrollY.
        hero.classList.add('return-ready');
        scene.classList.add('is-returning');
        setState('returned');
        if (window.scrollY <= 0.5) hideScene();
      } else {
        setState('landed');
      }
      // The remaining easing pixels must not activate another turn.
      settledEndpoint = endpoint;
    });
    scene.classList.add(atTop ? 'is-returning' : 'is-landing');
  }

  function placeActor(step) {
    scene.classList.remove('is-landed');
    setPose(step % 2 ? 'b' : 'a');
    setState('climbing');
  }

  function render() {
    frame = 0;
    if (disposed) return;
    try {
      if (needsMeasure) measure();
      if (!geometry || reducedMotion.matches || !assetsReady) return;
      // Safari reports scroll positions outside the page during rubber-banding.
      const maximumScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const scroll = clamp(window.scrollY, 0, maximumScroll);
      const bottom = Math.min(geometry.total, maximumScroll);
      const reversing = scroll < lastScroll - 0.1;
      const descending = scroll > lastScroll + 0.1;
      lastScroll = scroll;
      const target = getScrollTarget();
      const endpointMargin = Math.min(geometry.pitch * 0.2, 12);
      const headingTop = target === null ? !descending : target <= 0.5;
      const headingBottom = target === null ? !reversing : target >= bottom - 0.5;
      travel = Math.min(scroll, geometry.total);
      moveActor();
      moveSideLayout(scroll);
      // Begin during the visible arrival, not after the exponential tail.
      // Only a target at the endpoint qualifies; ordinary rung stops do not.
      const nearTop = scroll <= endpointMargin && headingTop
        && (target !== null || turnDestination === 'top' || settledEndpoint === 'top');
      if (scroll <= 0.5 || nearTop) {
        if (active && settledEndpoint === 'top') {
          if (scroll <= 0.5) {
            hideScene();
            settledEndpoint = 'top';
          }
        } else if (active && turnDestination !== 'top') arriveAt('top');
        snapNext = false;
        return;
      }
      const step = clamp(Math.round(travel / geometry.pitch), 0, geometry.steps);
      // Page momentum owns the timing. Follow its actual position throughout
      // each rung instead of restarting a separate tween on every scroll event.
      if (!active) activate(!snapNext && step <= 3);
      const nearBottom = bottom - scroll <= endpointMargin && headingBottom
        && (target !== null || turnDestination === 'bottom' || settledEndpoint === 'bottom');
      // Keep the landing through small native-scroll rebounds. Only a real
      // upward movement should reveal the ladder and turn the character again.
      const holdingBottom = (turnDestination === 'bottom' || settledEndpoint === 'bottom')
        && scroll >= bottom - clamp(geometry.pitch * 0.5, 12, 24);
      if (scroll >= bottom - 0.5 || nearBottom || holdingBottom) {
        if (turnDestination !== 'bottom' && settledEndpoint !== 'bottom') arriveAt('bottom');
        snapNext = false;
        return;
      }
      if (turnDestination === 'top' || turnDestination === 'bottom' || settledEndpoint) startTurn();
      settledEndpoint = null;
      if (turnDestination || deploymentFrame) return;
      snapNext = false;
      placeActor(step);
    } catch (error) {
      fail(error);
    }
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }

  function resized() {
    needsMeasure = true;
    schedule();
  }

  function restored() {
    if (window.scrollY > 0.5) onInteraction();
    snapNext = true;
    schedule();
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(assetTimer);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', resized);
    window.removeEventListener('pageshow', restored);
    reducedMotion.removeEventListener('change', resized);
    useNativeLayout();
    strip.replaceChildren();
    currentCleanup = undefined;
  }

  function fail(error) {
    cleanup();
    console.warn('Ladder animation unavailable; the lower section remains accessible.', error);
  }

  currentCleanup = cleanup;
  setState('idle');
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', resized, { passive: true });
  window.addEventListener('pageshow', restored);
  reducedMotion.addEventListener('change', resized);

  // Reserve the route before the entrance ends, so early scrolling cannot
  // encounter a late section resize when the sprites finish decoding.
  if (window.scrollY > 0.5) onInteraction();
  schedule();
  Promise.resolve(layoutReady).then(() => {
    if (!disposed) resized();
  }, error => {
    if (!disposed) fail(error);
  });

  Promise.race([
    Promise.all([layoutReady, ...[...Object.values(poses), probe].map(async image => {
      await image.decode();
      if (!image.naturalWidth) throw new Error('A descent image could not be loaded.');
    })]),
    new Promise((_, reject) => {
      assetTimer = setTimeout(() => reject(new Error('Descent images timed out.')), 8000);
    }),
  ]).then(() => {
    clearTimeout(assetTimer);
    if (disposed) return;
    assetsReady = true;
    schedule();
  }).catch(error => {
    clearTimeout(assetTimer);
    if (!disposed) fail(error);
  });

  return cleanup;
}
