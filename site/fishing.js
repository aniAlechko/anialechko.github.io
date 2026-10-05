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

  function reset() {
    setLineProgress(0);
    if (!active) return;
    active = false;
    actor.classList.remove('is-fishing');
    fishing.hidden = true;
    fishing.dataset.pose = 'reach';
    lastPose = 'reach';
  }

  function render() {
    frame = 0;
    if (disposed || document.hidden) return;
    const hold = getHoldDistance();
    const scroll = window.scrollY;
    if (!ready || failed || !route || scene.dataset.state !== 'landed'
      || !Number.isFinite(hold) || hold <= 0 || !Number.isFinite(scroll)
      || scroll < route.total + hold * .18) {
      reset();
      return;
    }
    if (!active) {
      active = true;
      fishing.hidden = false;
      actor.classList.add('is-fishing');
    }
    const pose = scroll < route.total + hold * .38 ? 'reach'
      : scroll < route.total + hold * .60 ? 'ready'
      : scroll < route.total + hold * .80 ? 'cast' : 'idle';
    if (pose !== lastPose) {
      fishing.dataset.pose = pose;
      lastPose = pose;
    }
    setLineProgress(Math.max(0, Math.min(1,
      (scroll - (route.total + hold * .80)) / (hold * .20))));
  }

  function schedule() {
    if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(render);
  }

  function visibilityChanged() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
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
  const observer = new MutationObserver(schedule);
  observer.observe(scene, { attributes: true, attributeFilter: ['data-state'] });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
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
      document.removeEventListener('visibilitychange', visibilityChanged);
      image.removeEventListener('error', imageFailed);
      reset();
      actor.style.removeProperty('--fishing-line-progress');
    },
  };
}
