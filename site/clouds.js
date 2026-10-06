const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const shapes = [
  { layer: 'far', image: 'bank', y: 0, size: .36, min: 140, max: 500, depth: .02, end: .22, landing: .40 },
  { layer: 'near', image: 'bank', y: .23, size: .46, min: 210, max: 630, depth: -.20, end: .24, landing: .80 },
  { layer: 'far', image: 'cumulus', y: .14, size: .24, min: 115, max: 330, depth: -.04, end: .26, landing: .57 },
  { layer: 'near', image: 'cumulus', y: .49, size: .30, min: 150, max: 410, depth: -.36, end: .30, landing: 1 },
];
const imageSizes = { bank: [1983, 793], cumulus: [1586, 992] };

export function initClouds({ getHoldDistance = () => 0 } = {}) {
  const scene = document.querySelector('.cloud-scene');
  if (!scene) return { setRoute() {}, cleanup() {} };
  const descent = document.querySelector('#descent-scene');
  const garden = document.querySelector('.garden-scene');
  const statement = document.querySelector('.garden-statement');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let total = 0;
  let heroHeight = 0;
  let landingSkyHeight = 0;
  let width = window.innerWidth;
  let frame = 0;
  let disposed = false;
  let lastTime = null;
  let lastScroll = Math.max(0, window.scrollY);
  let scrollWind = 0;
  let resizeSettles = 0;
  let emission = 0;

  const layers = Object.fromEntries(['far', 'near'].map(name => {
    const layer = document.createElement('div');
    layer.className = `cloud-layer cloud-layer--${name}`;
    scene.append(layer);
    return [name, layer];
  }));
  // Reuse a fixed stream; scrolling never adds extra clouds to the scene.
  const clouds = shapes.map(shape => {
    const element = document.createElement('div');
    element.className = 'cloud';
    element.hidden = true;
    const image = document.createElement('img');
    image.src = `/images/cloud-ink-${shape.image}.png`;
    image.alt = '';
    [image.width, image.height] = imageSizes[shape.image];
    image.draggable = false;
    image.decoding = 'async';
    const cloud = { ...shape, shape, element, windX: null, ready: false, failed: false };
    function failed() {
      if (disposed) return;
      cloud.failed = true;
      cloud.ready = false;
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
      if (total && window.scrollY > 0 && inView(cloud, Math.max(0, window.scrollY))
        && cloud.windX + cloud.width / 2 > 0 && cloud.windX - cloud.width / 2 < width) {
        queueAtRight(cloud);
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
    const previousWidth = width;
    width = window.innerWidth;
    const statementBounds = statement?.getBoundingClientRect();
    const statementTop = statementBounds?.height > 0 && garden
      ? statementBounds.top - garden.getBoundingClientRect().top - Math.max(0, total - heroHeight)
      : heroHeight * .32;
    landingSkyHeight = Math.max(0, Math.min(heroHeight * .34, statementTop - 20));
    for (const cloud of clouds) measureCloud(cloud);
    for (const cloud of clouds) {
      if (cloud.windX !== null) cloud.windX *= width / previousWidth;
    }
    const ordered = clouds.filter(cloud => !cloud.failed)
      .sort((a, b) => (a.windX ?? Infinity) - (b.windX ?? Infinity));
    for (let index = 0; index < ordered.length; index++) {
      const cloud = ordered[index];
      const previous = ordered[index - 1];
      const minimumX = previous
        ? previous.windX + previous.width / 2 + gapBetween(previous, cloud) + cloud.width / 2
        : width * .10;
      if (cloud.windX === null) cloud.windX = minimumX;
      else if (previous) cloud.windX = Math.max(cloud.windX, minimumX);
    }
  }

  function gapBetween(first, second) {
    return clamp(Math.min(first.width, second.width) * .3, 56, 150);
  }

  function measureCloud(cloud) {
    const mobileScale = 1 + .5 * (1 - clamp((width - 480) / 480, 0, 1));
    cloud.width = clamp(width * cloud.size * mobileScale, cloud.min * mobileScale, cloud.max);
    const [imageWidth, imageHeight] = imageSizes[cloud.image];
    cloud.height = cloud.width * imageHeight / imageWidth;
    cloud.top = heroHeight * (1 + cloud.y) + 16;
    const viewportMix = clamp((width - 390) / 810, 0, 1);
    const bandPosition = clamp((cloud.end - .20) / .14, 0, 1);
    const landingBottom = .14 + viewportMix * .04 + bandPosition * (.04 + viewportMix * .01);
    // Keep the cloud bank on its original route. The extra descent carries it
    // above the landing view instead of stretching it down with the section.
    cloud.scrollDepth = heroHeight > 0
      ? Math.min(cloud.depth, (heroHeight + heroHeight * landingBottom - cloud.top - cloud.height) / heroHeight)
      : cloud.depth;
    const baseBottom = cloud.top + heroHeight * cloud.scrollDepth - heroHeight + cloud.height;
    const upwardRoom = Math.max(0, cloud.top - heroHeight - 16);
    cloud.top += clamp(landingSkyHeight * cloud.landing - baseBottom,
      -Math.min(heroHeight * .08, upwardRoom), heroHeight * .09);
    cloud.element.style.width = `${cloud.width}px`;
    cloud.element.style.left = '0px';
    cloud.element.style.top = `${cloud.top + cloud.height / 2}px`;
  }

  function queueAtRight(cloud) {
    let left = width + 24;
    for (const other of clouds) {
      if (other === cloud || other.failed || other.windX === null) continue;
      left = Math.max(left, other.windX + other.width / 2 + gapBetween(other, cloud));
    }
    cloud.windX = left + cloud.width / 2;
  }

  function recycleCloud(cloud) {
    const variation = (++emission * .61803398875) % 1;
    cloud.size = cloud.shape.size * (.96 + variation * .08);
    cloud.y = Math.max(0, cloud.shape.y + (variation - .5) * .06);
    measureCloud(cloud);
    queueAtRight(cloud);
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
      const onLadder = descent?.dataset.state === 'climbing' && scroll > .5 && scroll < total - .5;
      const climbDelta = Math.abs(clamp(scroll, 0, total) - clamp(lastScroll, 0, total));
      const requestedWind = clamp(climbDelta / Math.max(elapsed, 1 / 240) * 1.15, 0, width * 2);
      if (onLadder && resizeSettles === 0) {
        scrollWind += (requestedWind - scrollWind) * (1 - Math.exp(-elapsed / .07));
      } else {
        scrollWind = 0;
      }
      const baseWindScale = clamp(width / 1000, .7, 1.8);
      const windDistance = (28 * baseWindScale + scrollWind) * elapsed;
      for (const cloud of clouds) {
        if (!cloud.failed) cloud.windX -= windDistance;
      }
      for (const cloud of clouds) {
        if (!cloud.failed && cloud.windX + cloud.width / 2 < -32) recycleCloud(cloud);
      }
      lastTime = time;
    } else {
      lastTime = null;
      scrollWind = 0;
    }
    if (resizeSettles > 0) resizeSettles--;
    lastScroll = scroll;
    if (enabled) {
      for (const cloud of clouds) {
        cloud.element.hidden = !cloud.ready;
        if (!cloud.ready || cloud.windX === null) continue;
        cloud.element.style.transform = `translate3d(${cloud.windX.toFixed(2)}px, ${(camera * cloud.scrollDepth).toFixed(2)}px, 0)`;
      }
    }
    if (active) schedule();
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  function resize() {
    resetWind();
    measure();
    schedule();
  }
  function resetWind() {
    lastScroll = Math.max(0, window.scrollY);
    lastTime = null;
    scrollWind = 0;
    resizeSettles = 2;
  }
  function resume() {
    resetWind();
    schedule();
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
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
        resetWind();
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
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
      motion.removeEventListener('change', schedule);
      scene.hidden = true;
      scene.replaceChildren();
    },
  };
}
