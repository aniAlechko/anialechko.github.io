const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const shapes = [
  { layer: 'far', image: 'bank', x: .10, y: 0, size: .36, min: 140, max: 500, depth: .02, end: .22, speed: 25 },
  { layer: 'far', image: 'cumulus', x: .86, y: .14, size: .24, min: 115, max: 330, depth: -.04, end: .26, speed: 29 },
  { layer: 'far', image: 'bank', x: .50, y: .47, size: .29, min: 130, max: 400, depth: -.18, end: .32, speed: 24 },
  { layer: 'near', image: 'bank', x: .28, y: .23, size: .46, min: 210, max: 630, depth: -.20, end: .24, speed: 34 },
  { layer: 'near', image: 'cumulus', x: .90, y: .49, size: .30, min: 150, max: 410, depth: -.36, end: .30, speed: 37 },
  { layer: 'near', image: 'bank', x: .34, y: .73, size: .40, min: 185, max: 560, depth: -.48, end: .34, speed: 30 },
  { layer: 'far', image: 'bank', x: .58, y: .06, size: .31, min: 135, max: 440, depth: -.05, end: .20, speed: 27 },
  { layer: 'near', image: 'cumulus', x: .65, y: .36, size: .28, min: 145, max: 390, depth: -.28, end: .28, speed: 32 },
];
const imageSizes = { bank: [1983, 793], cumulus: [1586, 992] };

export function initClouds({ getHoldDistance = () => 0 } = {}) {
  const scene = document.querySelector('.cloud-scene');
  if (!scene) return { setRoute() {}, cleanup() {} };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let total = 0;
  let heroHeight = 0;
  let width = window.innerWidth;
  let frame = 0;
  let disposed = false;
  let lastTime = null;
  let lastScroll = Math.max(0, window.scrollY);
  let boost = 0;
  let spawnIn = 0;
  let emission = 0;
  let emissionCursor = shapes.length;

  const layers = Object.fromEntries(['far', 'near'].map(name => {
    const layer = document.createElement('div');
    layer.className = `cloud-layer cloud-layer--${name}`;
    scene.append(layer);
    return [name, layer];
  }));
  // Reserve decoded sprites so new arrivals never wait for an image in mid-flight.
  const clouds = Array.from({ length: shapes.length * 2 }, (_, index) => {
    const shape = shapes[index % shapes.length];
    const element = document.createElement('div');
    element.className = 'cloud';
    element.hidden = true;
    const image = document.createElement('img');
    image.src = `/images/cloud-ink-${shape.image}.png`;
    image.alt = '';
    [image.width, image.height] = imageSizes[shape.image];
    image.draggable = false;
    image.decoding = 'async';
    const cloud = { ...shape, shape, element, windX: null, live: index < shapes.length, ready: false, failed: false };
    function failed() {
      if (disposed) return;
      cloud.failed = true;
      cloud.ready = false;
      cloud.live = false;
      element.hidden = true;
      schedule();
    }
    image.addEventListener('error', failed, { once: true });
    element.append(image);
    layers[shape.layer].append(element);
    image.decode().then(() => {
      if (disposed || cloud.failed) return;
      cloud.ready = true;
      // A late image enters at the edge instead of appearing in the middle.
      if (cloud.live && total && window.scrollY > 0 && inView(cloud, Math.max(0, window.scrollY))
        && cloud.windX + cloud.width / 2 > 0 && cloud.windX - cloud.width / 2 < width) {
        cloud.windX = width + cloud.width / 2 + 32;
      }
      schedule();
    }).catch(failed);
    return cloud;
  });

  function cameraScroll(scroll) {
    return scroll - clamp(scroll - total, 0, getHoldDistance());
  }

  function inView(cloud, scroll) {
    const camera = cameraScroll(scroll);
    const top = cloud.top + camera * cloud.scrollDepth - camera;
    return top < window.innerHeight && top + cloud.height > 0;
  }

  function measure() {
    width = window.innerWidth;
    for (const cloud of clouds) measureCloud(cloud);
  }

  function measureCloud(cloud) {
    cloud.width = clamp(width * cloud.size, cloud.min, cloud.max);
    const [imageWidth, imageHeight] = imageSizes[cloud.image];
    cloud.height = cloud.width * imageHeight / imageWidth;
    cloud.top = heroHeight * (1 + cloud.y) + 16;
    const viewportMix = clamp((width - 390) / 810, 0, 1);
    const bandPosition = clamp((cloud.end - .20) / .14, 0, 1);
    const landingBottom = .14 + viewportMix * .04 + bandPosition * (.04 + viewportMix * .01);
    // Keep each whole image above the statement while preserving varied depths.
    cloud.scrollDepth = total > 0
      ? Math.min(cloud.depth, (total + heroHeight * landingBottom - cloud.top - cloud.height) / total)
      : cloud.depth;
    if (cloud.windX === null) cloud.windX = width * cloud.x;
    else if (cloud.windX - cloud.width / 2 > width) {
      cloud.windX = Math.min(cloud.windX, width + cloud.width / 2 + 32);
    }
    cloud.element.style.width = `${cloud.width}px`;
    cloud.element.style.left = '0px';
    cloud.element.style.top = `${cloud.top + cloud.height / 2}px`;
  }

  function emitCloud(scroll) {
    for (let offset = 0; offset < clouds.length; offset++) {
      const index = (emissionCursor + offset) % clouds.length;
      const cloud = clouds[index];
      if (cloud.live || !cloud.ready || !inView(cloud, scroll)) continue;
      const previousSize = cloud.size;
      const previousY = cloud.y;
      const variation = (++emission * .61803398875) % 1;
      cloud.size = cloud.shape.size * (.92 + variation * .16);
      cloud.y = Math.max(0, cloud.shape.y + (variation - .5) * .08);
      cloud.speed = cloud.shape.speed * (.9 + variation * .2);
      measureCloud(cloud);
      if (!inView(cloud, scroll)) {
        cloud.size = previousSize;
        cloud.y = previousY;
        measureCloud(cloud);
      }
      cloud.windX = width + cloud.width / 2 + 12;
      cloud.live = true;
      emissionCursor = (index + 1) % clouds.length;
      return;
    }
  }

  function render(time) {
    frame = 0;
    if (disposed) return;
    const scroll = Math.max(0, window.scrollY);
    const camera = cameraScroll(scroll);
    const enabled = total > 0 && !motion.matches;
    const active = enabled && !document.hidden
      && clouds.some(cloud => cloud.ready && inView(cloud, scroll));
    scene.hidden = !enabled;
    if (active) {
      const elapsed = lastTime === null ? 1 / 60 : clamp((time - lastTime) / 1000, 0, .05);
      const requestedBoost = clamp(Math.abs(scroll - lastScroll) / Math.max(elapsed, 1 / 60) / 180, 0, 6);
      boost += (requestedBoost - boost) * (1 - Math.exp(-elapsed / .12));
      const windTime = elapsed * (1 + boost);
      for (const cloud of clouds) {
        if (!cloud.live) continue;
        cloud.windX -= cloud.speed * clamp(width / 1000, .7, 1.8) * windTime;
        if (cloud.windX + cloud.width / 2 < -32) {
          cloud.live = false;
        }
      }
      spawnIn -= windTime;
      if (spawnIn <= 0) {
        emitCloud(scroll);
        spawnIn = 3.2 + emission % 3 * .7;
      }
      lastTime = time;
    } else {
      lastTime = null;
      boost = 0;
    }
    lastScroll = scroll;
    if (enabled) {
      for (const cloud of clouds) {
        cloud.element.style.transform = `translate3d(${cloud.windX.toFixed(2)}px, ${(camera * cloud.scrollDepth).toFixed(2)}px, 0)`;
        cloud.element.hidden = !cloud.ready || !cloud.live;
      }
    }
    if (active) schedule();
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  function resize() {
    measure();
    schedule();
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);

  return {
    setRoute(route) {
      if (disposed) return;
      const nextTotal = Number.isFinite(route?.total) && route.total > 0 ? route.total : 0;
      const nextHeroHeight = Number.isFinite(route?.heroHeight) && route.heroHeight > 0
        ? route.heroHeight : nextTotal;
      if (total !== nextTotal || heroHeight !== nextHeroHeight || width !== window.innerWidth) {
        total = nextTotal;
        heroHeight = nextHeroHeight;
        measure();
      }
      cancelAnimationFrame(frame);
      render(performance.now());
    },
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', schedule);
      motion.removeEventListener('change', schedule);
      scene.hidden = true;
      scene.replaceChildren();
    },
  };
}
