export function initFooterFish() {
  const canvas = document.querySelector('#footer-fish');
  const footer = document.querySelector('#landing');
  if (!canvas || !footer) return { cleanup() {} };
  const context = canvas.getContext('2d');
  if (!context) return { cleanup() {} };
  const surface = document.createElement('canvas');
  const sampler = surface.getContext('2d', { willReadFrequently: true });
  if (!sampler) return { cleanup() {} };
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const fish = [
    { src: '/images/footer-fish-amber.png', x: .76, y: .23, direction: -1, phase: .8, size: 1, speed: 20 },
    { src: '/images/footer-fish-blue.png', x: .17, y: .78, direction: 1, phase: 3.7, size: .92, speed: 17 },
  ].map(item => ({ ...item, travel: -item.direction * Math.acos(item.x * 2 - 1) }));
  const tilt = .12;
  let width = 0;
  let height = 0;
  let cell = 5.6;
  let dpr = 1;
  let visible = false;
  let disposed = false;
  let frame = 0;
  let resizeFrame = 0;
  let lastTime = null;
  let elapsed = 0;

  function fitFish(item) {
    const ratio = item.ratio || .6;
    const padding = Math.min(24, Math.min(width, height) * .04) + cell;
    // Reserve the entire tilted silhouette, including the widest tail bend.
    const halfWidth = .5 + ratio * .6175 * Math.sin(tilt);
    const halfHeight = ratio * .6175 + .5 * Math.sin(tilt);
    const preferredLength = Math.min(width * .64, Math.max(220,
      Math.min(width * .39, height * .49, 410))) * item.size;
    item.length = Math.max(0, Math.min(preferredLength,
      (width - padding * 2) / (halfWidth * 2),
      (height - padding * 2) / (halfHeight * 2)));
    item.insetX = item.length * halfWidth + padding;
    item.spanX = Math.max(0, width - item.insetX * 2);
    const insetY = item.length * halfHeight + padding;
    item.sway = Math.min(height * .055, Math.max(0, height / 2 - insetY));
    item.centerY = Math.max(insetY + item.sway,
      Math.min(height - insetY - item.sway, item.y * height));
    item.angularSpeed = item.spanX > 0
      ? item.speed * Math.min(1, width / 900) * 2 / item.spanX : 0;
  }

  function measure() {
    resizeFrame = 0;
    if (disposed) return;
    const bounds = footer.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(bounds.width));
    const nextHeight = Math.max(1, Math.round(bounds.height));
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    cell = width < 600 ? 4.2 : 5.6;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    surface.width = Math.ceil(width / cell);
    surface.height = Math.ceil(height / cell);
    for (const item of fish) fitFish(item);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function drawFish(item) {
    if (!item.image || !item.length) return;
    const length = item.length;
    const breadth = length * item.ratio;
    const wave = Math.sin(elapsed * .31 + item.phase);
    const x = item.insetX + (Math.cos(item.travel) + 1) * item.spanX / 2;
    const y = item.centerY + wave * item.sway;
    const angle = Math.cos(elapsed * .31 + item.phase) * tilt;
    // Ease into each edge and turn side-on before swimming back into the footer.
    const turn = Math.min(.35, item.angularSpeed * .9) || .1;
    const facing = Math.sin(Math.max(-1, Math.min(1, -Math.sin(item.travel) / turn)) * Math.PI / 2);
    sampler.save();
    sampler.translate(x / cell, y / cell);
    sampler.rotate(angle);
    sampler.scale(facing, 1);
    // A travelling bend grows toward the tail while the head stays steady.
    const strips = 48;
    for (let index = 0; index < strips; index++) {
      const u = index / strips;
      const tail = (1 - u) ** 2;
      const bend = Math.sin(elapsed * 2.5 - u * 7 + item.phase) * breadth * .085 * tail;
      const spread = 1 + Math.sin(elapsed * 2.1 - u * 9 + item.phase) * .065 * tail;
      const sw = item.image.width / strips;
      sampler.drawImage(item.image, index * sw, 0, sw, item.image.height,
        (u - .5) * length / cell, (-breadth * spread / 2 + bend) / cell,
        length / strips / cell + .12, breadth * spread / cell);
    }
    sampler.restore();
  }

  function draw() {
    if (!width || !height || disposed) return;
    sampler.clearRect(0, 0, surface.width, surface.height);
    for (const item of fish) drawFish(item);
    const pixels = sampler.getImageData(0, 0, surface.width, surface.height).data;
    context.clearRect(0, 0, width, height);
    // Fish move through the circular grid, matching the page's dotted texture.
    for (let y = 0; y < surface.height; y++) {
      for (let x = 0; x < surface.width; x++) {
        const offset = (y * surface.width + x) * 4;
        const alpha = pixels[offset + 3] / 255;
        if (alpha < .055) continue;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const luminance = red * .299 + green * .587 + blue * .114;
        if (luminance < 9) continue;
        context.globalAlpha = alpha * .87;
        context.fillStyle = `rgb(${red},${green},${blue})`;
        context.beginPath();
        context.arc((x + .5) * cell, (y + .5) * cell, cell * .285, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  function canAnimate() {
    return !disposed && visible && !document.hidden && !preference.matches
      && fish.some(item => item.image);
  }

  function tick(now) {
    frame = 0;
    if (!canAnimate()) { lastTime = null; return; }
    const delta = lastTime === null ? 0 : Math.min(.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    elapsed += delta;
    for (const item of fish) {
      item.travel = (item.travel + item.angularSpeed * delta) % (Math.PI * 2);
    }
    draw();
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    if (disposed) return;
    if (canAnimate()) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = null;
      if (visible && !document.hidden) draw();
    }
  }

  function resized() {
    if (!disposed && !resizeFrame) resizeFrame = requestAnimationFrame(measure);
  }

  const observer = new IntersectionObserver(entries => {
    if (disposed) return;
    visible = entries.some(entry => entry.isIntersecting);
    sync();
  });
  observer.observe(footer);
  const resizeObserver = new ResizeObserver(resized);
  resizeObserver.observe(footer);
  document.addEventListener('visibilitychange', sync);
  preference.addEventListener('change', sync);
  window.addEventListener('resize', resized, { passive: true });
  measure();

  for (const item of fish) {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'low';
    image.src = item.src;
    image.decode().then(() => {
      if (disposed || !image.naturalWidth) return;
      // Trim transparent margins once so both species share a consistent scale.
      const source = document.createElement('canvas');
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) return;
      sourceContext.drawImage(image, 0, 0);
      const data = sourceContext.getImageData(0, 0, source.width, source.height).data;
      let left = source.width, top = source.height, right = 0, bottom = 0;
      for (let y = 0; y < source.height; y++) {
        for (let x = 0; x < source.width; x++) {
          if (data[(y * source.width + x) * 4 + 3] < 32) continue;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      if (right <= left || bottom <= top) return;
      const sprite = document.createElement('canvas');
      sprite.width = 384;
      sprite.height = Math.max(1, Math.round(384 * (bottom - top + 1) / (right - left + 1)));
      const spriteContext = sprite.getContext('2d');
      if (!spriteContext) return;
      spriteContext.drawImage(source, left, top, right - left + 1, bottom - top + 1,
        0, 0, sprite.width, sprite.height);
      item.image = sprite;
      item.ratio = sprite.height / sprite.width;
      fitFish(item);
      if (visible && !document.hidden) draw();
      sync();
    }).catch(() => {});
  }

  return {
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      preference.removeEventListener('change', sync);
      window.removeEventListener('resize', resized);
      for (const item of fish) item.image = null;
      context.clearRect(0, 0, width, height);
    },
  };
}
