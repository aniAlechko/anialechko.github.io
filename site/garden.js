export function initGarden() {
  const garden = document.querySelector('.garden-scene');
  const daylight = document.querySelector('.garden-daylight');
  const journey = document.querySelector('.journey');
  const hero = document.querySelector('.hero');
  if (!garden || !daylight || !journey || !hero) return { setRoute() {}, cleanup() {} };
  const statementStage = document.querySelector('#statement-stage');

  let route;
  let ready = false;
  let frame = 0;
  let disposed = false;
  let gardenTop = 0;
  let gardenHeight = 0;
  let holdDistance = 0;
  let lastTop;
  let lastPlaying;

  function render() {
    frame = 0;
    if (disposed || !ready) return;
    const scroll = Math.max(0, window.scrollY);
    const hold = route ? Math.max(0, Math.min(holdDistance, scroll - route.total)) : 0;
    const playing = !document.hidden && scroll + window.innerHeight > gardenTop + hold
      && scroll < gardenTop + hold + gardenHeight ? 'running' : 'paused';
    if (playing !== lastPlaying) {
      garden.style.setProperty('--garden-play-state', playing);
      lastPlaying = playing;
    }
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  function measure() {
    if (!ready) return;
    const heroHeight = route?.heroHeight || hero.getBoundingClientRect().height;
    gardenHeight = Math.max(heroHeight, route?.arrivalBottom || 0);
    holdDistance = route && statementStage ? heroHeight : 0;
    if (statementStage) statementStage.style.height = `${holdDistance}px`;
    journey.style.setProperty('--scene-hold-distance', `${holdDistance}px`);
    journey.style.setProperty('--scene-pin-top', `${route ? -route.total : 0}px`);
    garden.style.height = `${gardenHeight}px`;
    garden.style.top = route ? `${heroHeight}px` : '0px';
    gardenTop = route ? heroHeight : garden.getBoundingClientRect().top + window.scrollY;
    const top = `${gardenTop.toFixed(2)}px`;
    if (top !== lastTop) {
      daylight.style.top = top;
      lastTop = top;
    }
    schedule();
  }
  function resized() {
    // Animated scene geometry arrives through setRoute after the hero lays out.
    if (route) schedule();
    else measure();
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', resized, { passive: true });
  document.addEventListener('visibilitychange', schedule);

  return {
    getHoldDistance: () => disposed ? 0 : holdDistance,
    setRoute(nextRoute) {
      if (disposed) return;
      route = Number.isFinite(nextRoute?.total) && nextRoute.total > 0 ? nextRoute : null;
      ready = true;
      journey.classList.toggle('has-static-garden', !route);
      garden.hidden = false;
      daylight.hidden = false;
      measure();
      cancelAnimationFrame(frame);
      render();
    },
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', resized);
      document.removeEventListener('visibilitychange', schedule);
      journey.classList.remove('has-static-garden');
      journey.style.removeProperty('--scene-hold-distance');
      journey.style.removeProperty('--scene-pin-top');
      if (statementStage) statementStage.style.height = '0px';
      garden.hidden = true;
      daylight.hidden = true;
    },
  };
}
