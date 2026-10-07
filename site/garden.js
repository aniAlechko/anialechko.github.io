import { initGardenRabbits } from './garden-rabbits.js';

export function initGarden() {
  const garden = document.querySelector('.garden-scene');
  const daylight = document.querySelector('.garden-daylight');
  const journey = document.querySelector('.journey');
  const hero = document.querySelector('.hero');
  if (!garden || !daylight || !journey || !hero) return { setRoute() {}, cleanup() {} };
  const landing = document.querySelector('#landing');
  const trail = garden.querySelector('.garden-trail');
  const trailSvg = trail?.querySelector('svg');
  const trailPaths = [...trail?.querySelectorAll('path') || []];
  const trailPlants = trail?.querySelector('.garden-trail-plants');
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

  function layoutTrail(heroHeight) {
    if (!trail || !trailSvg || !trailPlants) return;
    if (!route?.walkPath) {
      trail.hidden = true;
      return;
    }
    trail.hidden = false;
    const width = window.innerWidth;
    const pathWidth = route.actorWidth * 1.25;
    const footY = route.total - heroHeight + route.landingTop + route.actorHeight;
    trail.style.top = `${footY}px`;
    trail.style.height = `${route.walkDistance}px`;
    trail.style.setProperty('--trail-width', `${pathWidth}px`);
    trailSvg.setAttribute('viewBox', `0 0 ${width} ${route.walkDistance}`);
    for (const path of trailPaths) path.setAttribute('d', route.walkPath.pathData());
    trailPlants.replaceChildren();
    for (let index = 0; index < 14; index++) {
      const point = route.walkPath.sample((index + .5) / 14);
      const plant = document.createElement('i');
      plant.className = index % 3 ? 'garden-grass' : 'garden-flower';
      const side = index % 2 ? 1 : -1;
      const x = Math.max(20, Math.min(width - 36, point.x + side * (pathWidth / 2 + 30 + index % 3 * 16)));
      plant.style.left = `${x}px`;
      plant.style.top = `${point.y}px`;
      plant.style.setProperty('--bloom', index % 2 ? '#a62b38' : '#d6a232');
      trailPlants.append(plant);
    }
  }

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
    pullDistance = route && landing ? fishingDistance : 0;
    garden.style.height = `${gardenHeight}px`;
    garden.style.top = route ? `${heroHeight}px` : '0px';
    garden.style.setProperty('--arrival-height', `${fishingDistance || heroHeight}px`);
    layoutTrail(heroHeight);
    if (route) {
      const viewportHeight = route.viewportHeight || heroHeight;
      const mountainsHeight = Math.max(18, Math.min(72, viewportHeight * .095));
      // Landscape spacing stays independent of the shorter ladder route.
      const skyPadding = Math.max(96, Math.min(200, viewportHeight * .20));
      const mountainsTop = skyPadding + Math.max(50, viewportHeight * .085) + viewportHeight * .08;
      garden.style.setProperty('--mountains-top', `${mountainsTop}px`);
      garden.style.setProperty('--mountains-height', `${mountainsHeight}px`);
    } else {
      garden.style.removeProperty('--mountains-top');
      garden.style.removeProperty('--mountains-height');
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
      start: route.fishingStart ?? route.total,
      end: (route.fishingStart ?? route.total) + pullDistance,
    } : null,
    setRoute(nextRoute) {
      if (disposed) return;
      route = Number.isFinite(nextRoute?.total) && nextRoute.total > 0 ? nextRoute : null;
      ready = true;
      journey.classList.toggle('has-static-garden', !route);
      journey.classList.toggle('has-walking-garden', !!route?.walkPath);
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
      journey.classList.remove('has-static-garden', 'has-walking-garden');
      garden.style.removeProperty('--arrival-height');
      trailPlants?.replaceChildren();
      garden.style.removeProperty('--mountains-top');
      garden.style.removeProperty('--mountains-height');
      garden.hidden = true;
      daylight.hidden = true;
    },
  };
}
