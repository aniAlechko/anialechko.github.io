export function initFishing({ getHoldDistance = () => 0 } = {}) {
  const actor = document.querySelector('.descent-actor');
  const scene = document.querySelector('#descent-scene');
  const fishing = document.querySelector('.fishing-actor');
  const image = document.querySelector('.fishing-sprite-source');
  if (![actor, scene, fishing, image].every(Boolean)) {
    return { setRoute() {}, cleanup() {} };
  }

  let route;
  let ready = false;
  let failed = false;
  let active = false;
  let disposed = false;
  let frame = 0;
  let lastLineProgress;
  let lastLineVisible;
  let lastPose;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const transitionDuration = 220;
  const lineDuration = 520;
  const poses = ['standing', 'reach', 'ready', 'cast', 'idle'];
  let stage = 0;
  let transition = null;
  let lineAnimation = null;
  let lineProgress = 0;
  let scrollDirection = 1;
  let lastScroll = window.scrollY;
  let lastTime = null;

  function setLineProgress(progress) {
    const value = progress.toFixed(4);
    if (value !== lastLineProgress) {
      actor.style.setProperty('--fishing-line-progress', value);
      lastLineProgress = value;
    }
    const visible = progress > 0;
    if (visible !== lastLineVisible) {
      actor.classList.toggle('is-fishing-line', visible);
      lastLineVisible = visible;
    }
  }

  function showPose(pose) {
    const visible = pose !== 'standing';
    if (visible !== active) {
      active = visible;
      actor.classList.toggle('is-fishing', visible);
      fishing.hidden = !visible;
    }
    const spritePose = visible ? pose : 'reach';
    if (spritePose !== lastPose) {
      fishing.dataset.pose = spritePose;
      lastPose = spritePose;
    }
  }

  function reset() {
    stage = 0;
    transition = null;
    lineAnimation = null;
    lineProgress = 0;
    lastTime = null;
    setLineProgress(0);
    showPose('standing');
  }

  function animateLine(target, elapsed) {
    if (lineProgress === target) {
      lineAnimation = null;
      return;
    }
    if (lineProgress !== target && lineAnimation?.to !== target) {
      lineAnimation = {
        from: lineProgress, to: target, elapsed: 0,
        duration: lineDuration * Math.abs(target - lineProgress),
      };
    }
    if (!lineAnimation) return;
    lineAnimation.elapsed += elapsed;
    const progress = Math.min(1, lineAnimation.elapsed / lineAnimation.duration);
    const eased = progress * progress * (3 - 2 * progress);
    lineProgress = lineAnimation.from + (lineAnimation.to - lineAnimation.from) * eased;
    if (progress === 1) {
      lineProgress = lineAnimation.to;
      lineAnimation = null;
    }
    setLineProgress(lineProgress);
  }

  function render() {
    frame = 0;
    if (disposed || document.hidden) return;
    const hold = getHoldDistance();
    const scroll = window.scrollY;
    if (!ready || failed || !route || scene.dataset.state !== 'landed'
      || !Number.isFinite(hold) || hold <= 0 || !Number.isFinite(scroll)) {
      reset();
      return;
    }
    // Scroll selects resting poses; reach and cast are timed intermediates.
    const target = scroll < route.total + hold * .20 ? 0
      : scroll < route.total + hold * .60 ? 2 : 4;
    const now = performance.now();
    const elapsed = lastTime === null ? 0 : Math.min(64, Math.max(0, now - lastTime));
    lastTime = now;

    if (reducedMotion.matches) {
      stage = target;
      transition = null;
      lineAnimation = null;
      lineProgress = stage === 4 && scrollDirection > 0 ? 1 : 0;
      setLineProgress(lineProgress);
      showPose(poses[stage]);
      lastTime = null;
      return;
    }

    if (transition) {
      transition.elapsed += elapsed;
      // Reversing during a transition changes its destination without a stale timer.
      transition.to = target <= transition.low ? transition.low : transition.high;
      if (transition.elapsed >= transitionDuration) {
        stage = transition.to;
        transition = null;
      }
    }

    // Finish retracting before changing the rod pose. The target persists when
    // scrolling stops, so the line always completes its time-based movement.
    if (!transition && stage === 4) {
      animateLine(target === 4 && scrollDirection > 0 ? 1 : 0, elapsed);
    }
    if (!transition && stage !== target && lineProgress === 0 && !lineAnimation) {
      const next = stage + Math.sign(target - stage) * 2;
      transition = {
        low: Math.min(stage, next), high: Math.max(stage, next),
        to: next, elapsed: 0,
      };
    }
    showPose(poses[transition ? transition.low + 1 : stage]);
    if (transition || lineAnimation) schedule();
    else lastTime = null;
  }

  function schedule() {
    if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(render);
  }

  function onScroll() {
    const scroll = window.scrollY;
    const delta = scroll - lastScroll;
    if (Math.abs(delta) >= 1) {
      scrollDirection = Math.sign(delta);
      lastScroll = scroll;
    }
    schedule();
  }

  function onResize() {
    lastScroll = window.scrollY;
    schedule();
  }

  function visibilityChanged() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = null;
    } else schedule();
  }

  function imageFailed() {
    if (disposed) return;
    failed = true;
    ready = false;
    cancelAnimationFrame(frame);
    frame = 0;
    reset();
  }

  fishing.hidden = true;
  actor.classList.remove('is-fishing', 'is-fishing-line');
  // A resize can change the climb state without another scroll event.
  // Match the fishing pose before painting the newly positioned character.
  const observer = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    render();
  });
  observer.observe(scene, { attributes: true, attributeFilter: ['data-state'] });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', visibilityChanged);
  image.addEventListener('error', imageFailed);
  Promise.resolve().then(() => image.decode()).then(() => {
    if (disposed || failed) return;
    if (!image.naturalWidth) throw new Error('Fishing image is unavailable.');
    ready = true;
    schedule();
  }).catch(imageFailed);

  return {
    setRoute(nextRoute) {
      if (disposed) return;
      route = Number.isFinite(nextRoute?.total) && nextRoute.total > 0 ? nextRoute : null;
      lastScroll = window.scrollY;
      cancelAnimationFrame(frame);
      frame = 0;
      if (!route) reset();
      else render();
    },
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      reducedMotion.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', visibilityChanged);
      image.removeEventListener('error', imageFailed);
      reset();
      actor.style.removeProperty('--fishing-line-progress');
    },
  };
}
