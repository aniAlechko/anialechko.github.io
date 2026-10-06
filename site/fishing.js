export function initFishing({ getFishingDistance = () => 0, getPullRange = () => null } = {}) {
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
  const transitionDuration = 180;
  const lineDuration = 360;
  const poses = ['standing', 'reach', 'ready', 'cast', 'idle'];
  const rodTip = { x: 975.25, y: 113.25 };
  let stage = 0;
  let transition = null;
  let lineAnimation = null;
  let lineProgress = 0;
  let lastTime = null;
  let spriteUnit = 0;
  let lastLineHeight;

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
      actor.style.setProperty('--fishing-tip-x', String(rodTip.x));
      actor.style.setProperty('--fishing-tip-y', String(rodTip.y));
    }
  }

  function positionRig(scroll, range) {
    if (!range || !route || !spriteUnit) return;
    // Both sections and the actor stay in the same document flow. Connect the
    // tip to their shared edge, not an arbitrary long string.
    const actorTop = route.landingTop - Math.max(0, scroll - range.start);
    const height = `${Math.max(0, range.end - scroll - actorTop - rodTip.y * spriteUnit + 2).toFixed(2)}px`;
    if (height !== lastLineHeight) {
      actor.style.setProperty('--fishing-line-height', height);
      lastLineHeight = height;
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
    const distance = getFishingDistance();
    const scroll = window.scrollY;
    const pullRange = getPullRange();
    if (!ready || failed || !route || scene.dataset.state !== 'landed'
      || !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(scroll)) {
      reset();
      return;
    }
    // Scroll selects resting poses; reach and cast are timed intermediates.
    // Fit the poses into the visible landscape rather than reserving page
    // distance for them. A fast scroll can always leave the scene immediately.
    const target = scroll < route.total + distance * .10 ? 0
      : scroll < route.total + distance * .25 ? 2 : 4;
    const now = performance.now();
    const elapsed = lastTime === null ? 0 : Math.min(64, Math.max(0, now - lastTime));
    lastTime = now;

    if (reducedMotion.matches) {
      stage = target;
      transition = null;
      lineAnimation = null;
      lineProgress = stage === 4 ? 1 : 0;
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

    // Keep the line extended throughout the fishing stage. Retract only when
    // leaving it, and finish retracting before changing the rod pose.
    if (!transition && stage === 4) {
      animateLine(target === 4 ? 1 : 0, elapsed);
    }
    if (!transition && stage !== target && lineProgress === 0 && !lineAnimation) {
      // Follow the latest scroll position instead of queueing every resting
      // pose after a fast swipe. Reach and cast remain short moving poses.
      const low = target > stage ? target - 2 : target;
      transition = {
        low, high: low + 2,
        to: target, elapsed: 0,
      };
    }
    showPose(poses[transition ? transition.low + 1 : stage]);
    positionRig(scroll, pullRange);
    if (transition || lineAnimation) schedule();
    else lastTime = null;
  }

  function schedule() {
    if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(render);
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
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
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
      spriteUnit = parseFloat(scene.style.getPropertyValue('--sprite-unit')) || 0;
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
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reducedMotion.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', visibilityChanged);
      image.removeEventListener('error', imageFailed);
      reset();
      actor.style.removeProperty('--fishing-line-progress');
      for (const property of ['--fishing-tip-x', '--fishing-tip-y', '--fishing-line-height']) {
        actor.style.removeProperty(property);
      }
    },
  };
}
