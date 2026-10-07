import { initGardenRabbits } from './garden-rabbits.js';

export function initGarden() {
  const garden = document.querySelector('.garden-scene');
  const daylight = document.querySelector('.garden-daylight');
  const journey = document.querySelector('.journey');
  const hero = document.querySelector('.hero');
  if (!garden || !daylight || !journey || !hero) return { setRoute() {}, cleanup() {} };
  const statement = garden.querySelector('.garden-statement');
  const landing = document.querySelector('#landing');
  const rabbits = initGardenRabbits(garden);

  let route;
  let ready = false;
  let frame = 0;
  let disposed = false;
  let gardenTop = 0;
  let gardenHeight = 0;
  let fishingDistance = 0;
  let pullDistance = 0;
  let lastTop;

  function render() {
    frame = 0;
    if (disposed || !ready) return;
    const scroll = Math.max(0, window.scrollY);
    const artBottom = gardenTop + gardenHeight;
    const playing = !document.hidden && scroll + window.innerHeight > artBottom - (route?.heroHeight || gardenHeight)
      && scroll < artBottom;
    rabbits.setPlaying(playing);
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  function measure() {
    if (!ready) return;
    const heroHeight = route?.heroHeight || hero.getBoundingClientRect().height;
    gardenHeight = Math.max(heroHeight, route?.sceneHeight || route?.arrivalBottom || 0);
    fishingDistance = route?.fishingDistance || 0;
    pullDistance = route && landing
      ? Math.max(0, heroHeight + route.sceneHeight - route.total) : 0;
    garden.style.height = `${gardenHeight}px`;
    garden.style.top = route ? `${heroHeight}px` : '0px';
    if (statement) {
      if (route && Number.isFinite(route.landingTop)) {
        const viewportHeight = route.viewportHeight || heroHeight;
        const halfTextHeight = statement.getBoundingClientRect().height / 2;
        const center = Math.max(64 + halfTextHeight,
          Math.min(viewportHeight * .40, route.landingTop - 24 - halfTextHeight));
        // Position the copy within the final viewport after the extra descent,
        // while leaving room above the character's head.
        statement.style.top = `${route.total - heroHeight + center}px`;
        const textTop = center - halfTextHeight;
        const mountainsHeight = Math.max(18, Math.min(72, viewportHeight * .095, textTop - 76));
        const mountainsTop = Math.max(50, Math.min(viewportHeight * .085, textTop - mountainsHeight - 28));
        garden.style.setProperty('--mountains-top', `${route.total - heroHeight + mountainsTop}px`);
        garden.style.setProperty('--mountains-height', `${mountainsHeight}px`);
      } else {
        statement.style.removeProperty('top');
        garden.style.removeProperty('--mountains-top');
        garden.style.removeProperty('--mountains-height');
      }
    }
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
  document.fonts?.ready.then(() => {
    if (!disposed) measure();
  });

  return {
    getFishingDistance: () => disposed ? 0 : fishingDistance,
    getPullRange: () => !disposed && route && pullDistance > 0 ? {
      start: route.total,
      end: route.total + pullDistance,
    } : null,
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
      rabbits.cleanup();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', resized);
      document.removeEventListener('visibilitychange', schedule);
      journey.classList.remove('has-static-garden');
      statement?.style.removeProperty('top');
      garden.style.removeProperty('--mountains-top');
      garden.style.removeProperty('--mountains-height');
      garden.hidden = true;
      daylight.hidden = true;
    },
  };
}
