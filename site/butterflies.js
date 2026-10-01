import { createButterflyFlight } from './butterfly-flight.js';

const TAU = Math.PI * 2;
const ATLAS_URL = new URL('./images/butterfly-atlas.png', import.meta.url).href;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smoothstep = (low, high, value) => {
  const amount = clamp((value - low) / (high - low), 0, 1);
  return amount * amount * (3 - 2 * amount);
};

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function separateBody(texture) {
  const { width, height } = texture;
  const wings = makeCanvas(width, height);
  const body = makeCanvas(width, height);
  const wingContext = wings.getContext('2d');
  const bodyContext = body.getContext('2d');
  // The antennae stay with the thorax while the wings hinge on either side.
  const bodyMask = new Path2D();
  bodyMask.moveTo(width * 0.35, 0);
  bodyMask.lineTo(width * 0.65, 0);
  bodyMask.lineTo(width * 0.545, height * 0.37);
  bodyMask.lineTo(width * 0.535, height * 0.94);
  bodyMask.lineTo(width * 0.465, height * 0.94);
  bodyMask.lineTo(width * 0.455, height * 0.37);
  bodyMask.closePath();
  wingContext.drawImage(texture, 0, 0);
  wingContext.globalCompositeOperation = 'destination-out';
  wingContext.fill(bodyMask);
  bodyContext.clip(bodyMask);
  bodyContext.drawImage(texture, 0, 0);
  return { wings, body, width, height };
}

async function loadTextures(waitForIdle, signal) {
  const image = new Image();
  image.decoding = 'async';
  // Loaded images can be drawn even when a background tab delays decode().
  await new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error('Butterfly scene disposed'));
    const timeout = setTimeout(() => finish(new Error('Butterfly texture timed out')), 15000);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error('Empty butterfly image'));
    image.onerror = () => finish(new Error('Butterfly texture could not load'));
    image.src = ATLAS_URL;
    if (image.complete && image.naturalWidth && image.naturalHeight) finish();
  });
  // Image decoding can finish during a swipe. Defer pixel processing too.
  if (!await waitForIdle()) throw new Error('Butterfly scene disposed');
  const atlas = makeCanvas(image.naturalWidth, image.naturalHeight);
  const context = atlas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, atlas.width, atlas.height);
  return [0, 1].map(index => {
    const start = Math.floor(index * atlas.width / 2);
    const end = Math.floor((index + 1) * atlas.width / 2);
    let left = end;
    let right = start;
    let top = atlas.height;
    let bottom = 0;
    for (let y = 0; y < atlas.height; y += 1) {
      for (let x = start; x < end; x += 1) {
        if (data[(y * atlas.width + x) * 4 + 3] < 16) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right <= left || bottom <= top) throw new Error('Empty butterfly texture');
    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const scale = Math.min(1, 256 / Math.max(cropWidth, cropHeight));
    const texture = makeCanvas(Math.round(cropWidth * scale), Math.round(cropHeight * scale));
    texture.getContext('2d').drawImage(image, left, top, cropWidth, cropHeight, 0, 0, texture.width, texture.height);
    return separateBody(texture);
  });
}

// A small local fallback keeps the footer usable if its image cannot be loaded.
function fallbackTextures() {
  return ['#168fe3', '#ee830b'].map(color => {
    const texture = makeCanvas(512, 420);
    const context = texture.getContext('2d');
    context.translate(256, 200);
    for (const side of [-1, 1]) {
      context.save();
      context.scale(side, 1);
      context.beginPath();
      context.moveTo(8, -12);
      context.bezierCurveTo(78, -118, 243, -232, 236, -95);
      context.bezierCurveTo(232, -18, 197, 16, 139, 18);
      context.bezierCurveTo(233, 90, 187, 219, 100, 176);
      context.bezierCurveTo(48, 150, 20, 70, 8, -12);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = '#29211c';
      context.lineWidth = 14;
      context.stroke();
      for (const [x, y] of [[216, -136], [227, -72], [191, -18], [152, 112], [103, 159]]) {
        context.beginPath();
        context.moveTo(8, 0);
        context.lineTo(x, y);
        context.lineWidth = 4;
        context.stroke();
      }
      context.restore();
    }
    context.fillStyle = '#786655';
    context.beginPath();
    context.ellipse(0, 22, 9, 65, 0, 0, TAU);
    context.fill();
    return separateBody(texture);
  });
}

function drawTriangle(context, texture, source, destination, bleed, shade) {
  const [a, b, c] = source;
  const [p, q, r] = destination;
  const determinant = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  if (Math.abs(determinant) < 0.0001) return;
  const matrix = axis => [
    (p[axis] * (b.y - c.y) + q[axis] * (c.y - a.y) + r[axis] * (a.y - b.y)) / determinant,
    (p[axis] * (c.x - b.x) + q[axis] * (a.x - c.x) + r[axis] * (b.x - a.x)) / determinant,
    (p[axis] * (b.x * c.y - c.x * b.y) + q[axis] * (c.x * a.y - a.x * c.y) + r[axis] * (a.x * b.y - b.x * a.y)) / determinant,
  ];
  const horizontal = matrix('x');
  const vertical = matrix('y');
  const centerX = (p.x + q.x + r.x) / 3;
  const centerY = (p.y + q.y + r.y) / 3;
  context.save();
  context.beginPath();
  for (let index = 0; index < 3; index += 1) {
    const point = destination[index];
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const length = Math.hypot(dx, dy) || 1;
    const x = point.x + dx / length * bleed;
    const y = point.y + dy / length * bleed;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.clip();
  context.globalAlpha = shade;
  context.transform(horizontal[0], vertical[0], horizontal[1], vertical[1], horizontal[2], vertical[2]);
  context.drawImage(texture, 0, 0);
  context.restore();
}

function drawButterfly(context, texture, butterfly, span, time, still, cell, mobile) {
  const { width, height, wings, body } = texture;
  const burst = still ? 0 : clamp(butterfly.burst, 0, 1);
  const pitch = still ? 0.1 : 0.1 + butterfly.pace * 0.045 + Math.sin(time * 0.63 + butterfly.phase) * 0.025;
  const bank = still ? 0 : clamp(butterfly.bank, -0.65, 0.65);
  const camera = 32 * Math.PI / 180;
  const cosCamera = Math.cos(camera);
  const sinCamera = Math.sin(camera);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosBank = Math.cos(bank);
  const sinBank = Math.sin(bank);
  const sinAngle = Math.sin(butterfly.angle);
  const cosAngle = Math.cos(butterfly.angle);
  // Undo the camera's foreshortening so the projected head follows the flight
  // direction. A screen-space rotation would make every turn look like a coin.
  const heading = Math.atan2(cosCamera * sinAngle, cosAngle)
    + Math.asin(clamp(-Math.tan(pitch) * sinCamera * sinAngle / Math.hypot(cosAngle, cosCamera * sinAngle), -1, 1));
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);
  const lift = still ? 0 : Math.sin(butterfly.beat - 0.4) * burst * 0.014;
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };

  function project(source, side) {
    let x = source.x / width - 0.5;
    let y = (source.y - height * 0.5) / width;
    let z = 0;
    if (side) {
      const reach = Math.max(0, Math.abs(x) - 0.026);
      const lag = smoothstep(0.3, 0.9, source.y / height) * 0.52;
      const phase = butterfly.beat - lag + side * bank * 0.16;
      // A quicker power stroke and flexible trailing edge give the wing a
      // changing surface, while its root stays attached to the body.
      const stroke = Math.sin(phase + 0.28 * Math.sin(phase));
      const flex = reach * reach * 4 * burst * Math.cos(phase - 0.3) * 0.12;
      const fold = still ? 0.13 : 0.13 + burst * (0.4 + 0.62 * stroke) + flex;
      x = side * (Math.min(Math.abs(x), 0.026) + reach * Math.cos(fold));
      z = reach * Math.sin(fold);
      y += reach * burst * Math.sin(phase - 0.25) * 0.032;
    }
    // Wings, body and antennae all share this rigid orientation and camera.
    const bankedX = x * cosBank + z * sinBank;
    const bankedZ = z * cosBank - x * sinBank;
    const pitchedY = y * cosPitch - bankedZ * sinPitch;
    const pitchedZ = y * sinPitch + bankedZ * cosPitch + lift;
    const worldX = bankedX * cosHeading - pitchedY * sinHeading;
    const worldY = bankedX * sinHeading + pitchedY * cosHeading;
    const screenY = worldY * cosCamera - pitchedZ * sinCamera;
    const depth = worldY * sinCamera + pitchedZ * cosCamera;
    const perspective = 3.4 / (3.4 - depth);
    return {
      x: butterfly.x + worldX * span * perspective,
      y: butterfly.y + screenY * span * perspective,
      depth,
    };
  }

  function drawSurface(image, side, start, end, columns, rows, light) {
    const vertices = [];
    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const source = { x: start + column / columns * (end - start), y: row / rows * height };
        const destination = project(source, side);
        bounds.left = Math.min(bounds.left, destination.x);
        bounds.right = Math.max(bounds.right, destination.x);
        bounds.top = Math.min(bounds.top, destination.y);
        bounds.bottom = Math.max(bounds.bottom, destination.y);
        vertices.push({ source, destination });
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * (columns + 1) + column;
        const corners = [vertices[index], vertices[index + 1], vertices[index + columns + 1], vertices[index + columns + 2]];
        for (const triangle of [[0, 1, 2], [1, 3, 2]]) {
          drawTriangle(context, image, triangle.map(corner => corners[corner].source), triangle.map(corner => corners[corner].destination), cell * 0.46, light);
        }
      }
    }
  }

  const sides = [-1, 1].sort((a, b) => project({ x: width * (0.5 + a * 0.3), y: height * 0.5 }, a).depth
    - project({ x: width * (0.5 + b * 0.3), y: height * 0.5 }, b).depth);
  for (const side of sides) {
    const light = still ? 1 : 0.95 + Math.cos(butterfly.beat + side * bank) * burst * 0.05;
    drawSurface(wings, side, side < 0 ? 0 : width / 2, side < 0 ? width / 2 : width, mobile ? 3 : 5, mobile ? 4 : 7, light);
  }
  drawSurface(body, 0, width * 0.34, width * 0.66, mobile ? 1 : 2, mobile ? 2 : 4, 1);
  return bounds;
}

export function initButterflies(canvas = document.querySelector('#butterfly-field')) {
  if (!canvas) return () => {};
  const context = canvas.getContext('2d', { alpha: true });
  const sample = makeCanvas(1, 1);
  const sampler = sample.getContext('2d', { willReadFrequently: true });
  if (!context || !sampler) return () => {};
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const textureAbort = new AbortController();
  let touchInput = false;
  const isMobile = () => coarsePointer.matches || window.innerWidth <= 809 || touchInput;
  const flight = createButterflyFlight();
  const restingButterflies = [0.3, 2.7].map(phase => ({ phase, x: 0, y: 0, angle: 0, bank: 0, pace: 0, beat: 0, burst: 0 }));
  const pointer = { active: false, x: 0, y: 0, vx: 0, vy: 0, last: 0 };
  let textures = null;
  let width = 0;
  let height = 0;
  let cell = 6.8;
  let visible = false;
  let frame = 0;
  let lastFrame = 0;
  let time = 0;
  let flightSpan = 0;
  let disposed = false;
  let loading = false;
  let texturePreparation = null;
  let touching = false;
  let scrollUntil = 0;
  let scrollTimer = 0;
  let resizePending = false;
  let flowUntil = 0;
  let hadFlow = false;
  let flowX = new Float32Array(0);
  let flowY = new Float32Array(0);
  let speedX = new Float32Array(0);
  let speedY = new Float32Array(0);

  const scrollPaused = () => touching || performance.now() < scrollUntil;

  function paint(dt = 0) {
    if (disposed || !visible || document.hidden || scrollPaused() || !width || !height || !textures) return;
    const still = preference.matches;
    const mobile = isMobile();
    if (!still) flight.step(dt);
    const butterflies = still ? restingButterflies : flight.butterflies;
    sampler.setTransform(sample.width / width, 0, 0, sample.height / height, 0, 0);
    sampler.clearRect(0, 0, width, height);
    const spacingX = width / sample.width;
    const spacingY = height / sample.height;
    const bounds = butterflies.map((butterfly, index) => drawButterfly(sampler, textures[index], butterfly, flightSpan * (index ? 0.91 : 1), time, still, cell, mobile));
    const useFlow = !mobile && !still && (pointer.active || time < flowUntil);
    if (hadFlow && !useFlow) {
      flowX.fill(0); flowY.fill(0); speedX.fill(0); speedY.fill(0);
    }
    hadFlow = useFlow;
    // Read and process the occupied area, not the full-width transparent field.
    const padding = useFlow ? 24 : cell * 2;
    const leftEdge = clamp(Math.floor((Math.min(...bounds.map(b => b.left)) - padding) / spacingX), 0, sample.width - 1);
    const topEdge = clamp(Math.floor((Math.min(...bounds.map(b => b.top)) - padding) / spacingY), 0, sample.height - 1);
    const rightEdge = clamp(Math.ceil((Math.max(...bounds.map(b => b.right)) + padding) / spacingX), leftEdge + 1, sample.width);
    const bottomEdge = clamp(Math.ceil((Math.max(...bounds.map(b => b.bottom)) + padding) / spacingY), topEdge + 1, sample.height);
    const pixelWidth = rightEdge - leftEdge;
    const pixelHeight = bottomEdge - topEdge;
    const pixels = sampler.getImageData(leftEdge, topEdge, pixelWidth, pixelHeight).data;
    context.clearRect(0, 0, width, height);
    const radius = Math.max(30, flightSpan * 1.2);
    const distortion = Math.min(0.4, flightSpan / 180);
    pointer.vx *= Math.exp(-dt * 8);
    pointer.vy *= Math.exp(-dt * 8);
    for (let row = topEdge; row < bottomEdge; row += 1) {
      for (let column = leftEdge; column < rightEdge; column += 1) {
        const index = row * sample.width + column;
        const x = (column + 0.5) * spacingX;
        const y = (row + 0.5) * spacingY;
        const pixel = ((row - topEdge) * pixelWidth + column - leftEdge) * 4;
        let alpha = pixels[pixel + 3] / 255;
        let red = pixels[pixel];
        let green = pixels[pixel + 1];
        let blue = pixels[pixel + 2];
        if (useFlow) {
          if (dt) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const distance = dx * dx + dy * dy;
            const influence = pointer.active && distance < radius * radius * 5 ? Math.exp(-distance / (radius * radius * 0.72)) : 0;
            const targetX = influence * distortion * (clamp(pointer.vx * 0.045, -34, 34) + Math.sin(y * 0.025 + time * 2.1) * 5);
            const targetY = influence * distortion * (clamp(pointer.vy * 0.045, -34, 34) + Math.cos(x * 0.023 - time * 1.8) * 5);
            speedX[index] += ((targetX - flowX[index]) * 54 - speedX[index] * 10) * dt;
            speedY[index] += ((targetY - flowY[index]) * 54 - speedY[index] * 10) * dt;
            flowX[index] += speedX[index] * dt;
            flowY[index] += speedY[index] * dt;
          }
          // Distort the sampled surface; the visible dots stay on a regular grid.
          const sampleX = clamp(column - leftEdge + flowX[index] / spacingX, 0, pixelWidth - 1);
          const sampleY = clamp(row - topEdge + flowY[index] / spacingY, 0, pixelHeight - 1);
          const left = Math.floor(sampleX);
          const top = Math.floor(sampleY);
          const mixX = sampleX - left;
          const mixY = sampleY - top;
          const topLeft = (top * pixelWidth + left) * 4;
          const topRight = (top * pixelWidth + Math.min(left + 1, pixelWidth - 1)) * 4;
          const bottomLeft = (Math.min(top + 1, pixelHeight - 1) * pixelWidth + left) * 4;
          const bottomRight = (Math.min(top + 1, pixelHeight - 1) * pixelWidth + Math.min(left + 1, pixelWidth - 1)) * 4;
          const channel = offset => (pixels[topLeft + offset] * (1 - mixX) + pixels[topRight + offset] * mixX) * (1 - mixY)
            + (pixels[bottomLeft + offset] * (1 - mixX) + pixels[bottomRight + offset] * mixX) * mixY;
          alpha = channel(3) / 255;
          red = channel(0);
          green = channel(1);
          blue = channel(2);
        }
        if (alpha < 0.07) continue;
        const brightness = Math.max(red, green, blue) / 255;
        const dotRadius = cell * (0.255 + brightness * 0.065) * Math.sqrt(alpha);
        context.beginPath();
        context.arc(x, y, dotRadius, 0, TAU);
        context.fillStyle = `rgb(${Math.round(red)} ${Math.round(green)} ${Math.round(blue)})`;
        context.fill();
      }
    }
  }

  function tick(now) {
    frame = 0;
    if (disposed || !visible || document.hidden || preference.matches || scrollPaused()) return;
    if (now - lastFrame >= 1000 / (isMobile() ? 30 : 60) - 1) {
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      time += dt;
      lastFrame = now;
      paint(dt);
    }
    frame = requestAnimationFrame(tick);
  }

  function resume() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = performance.now();
    if (disposed || !visible || document.hidden) return;
    if (scrollPaused()) {
      scheduleResume();
      return;
    }
    if (resizePending) resize(false);
    if (texturePreparation) {
      texturePreparation(true);
      texturePreparation = null;
    }
    if (!loading) prepareTextures();
    paint();
    if (textures && !preference.matches) frame = requestAnimationFrame(tick);
  }

  function resize(shouldPaint = true) {
    if (disposed) return;
    // Safari can resize its viewport as the browser chrome moves during a swipe.
    // Keep the current bitmap until scrolling settles instead of clearing it.
    if (scrollPaused()) { resizePending = true; return; }
    resizePending = false;
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);
    if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height)) return;
    width = nextWidth;
    height = nextHeight;
    flightSpan = Math.min(width * 0.20, height * 0.36, 132);
    flight.resize(width, height, flightSpan);
    restingButterflies.forEach((butterfly, index) => {
      butterfly.x = width * (index ? 0.67 : 0.40);
      butterfly.y = height * (index ? 0.54 : 0.46);
      butterfly.angle = index ? 0.30 : -0.24;
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cell = Math.max(1.25, Math.min(2.4, flightSpan / 30), Math.sqrt(width * height / 38000));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    sample.width = Math.max(1, Math.ceil(width / cell));
    sample.height = Math.max(1, Math.ceil(height / cell));
    const count = sample.width * sample.height;
    flowX = new Float32Array(count);
    flowY = new Float32Array(count);
    speedX = new Float32Array(count);
    speedY = new Float32Array(count);
    pointer.active = false;
    if (shouldPaint) paint();
  }

  function movePointer(event) {
    if (event.pointerType === 'touch' || preference.matches || !visible) return;
    touchInput = false;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const now = performance.now();
    const active = x >= 0 && x <= width && y >= 0 && y <= height;
    if (active && pointer.active) {
      const dt = Math.max(0.008, (now - pointer.last) / 1000);
      pointer.vx = clamp((x - pointer.x) / dt, -1000, 1000);
      pointer.vy = clamp((y - pointer.y) / dt, -1000, 1000);
    } else {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.last = now;
    pointer.active = active;
    if (active) flowUntil = time + 2;
  }

  function leavePointer(event) {
    if (!event.relatedTarget) pointer.active = false;
  }

  function clearPointer() { pointer.active = false; }

  function scheduleResume() {
    clearTimeout(scrollTimer);
    scrollTimer = 0;
    if (disposed || touching) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = 0;
      resume();
    }, Math.max(1, Math.ceil(scrollUntil - performance.now())));
  }

  function pauseForScroll() {
    clearPointer();
    if (disposed || (!isMobile() && !touching)) return;
    scrollUntil = performance.now() + 160;
    cancelAnimationFrame(frame);
    frame = 0;
    scheduleResume();
  }

  function touchStart() {
    touchInput = true;
    touching = true;
    pauseForScroll();
  }

  function touchMove(event) {
    touchInput = true;
    touching = Boolean(event.touches?.length ?? 1);
    pauseForScroll();
  }

  function touchEnd(event) {
    touching = Boolean(event.touches?.length);
    // Touch scrolling applies to large tablets too, even with a connected mouse.
    scrollUntil = performance.now() + 160;
    scheduleResume();
  }

  function visibilityChanged() {
    if (document.hidden) touching = false;
    resume();
  }

  function waitForIdle() {
    return new Promise(resolve => {
      if (disposed) resolve(false);
      else if (visible && !document.hidden && !scrollPaused()) resolve(true);
      else texturePreparation = resolve;
    });
  }

  function prepareTextures() {
    loading = true;
    loadTextures(waitForIdle, textureAbort.signal).then(result => {
      if (disposed) return;
      textures = result;
      canvas.dataset.renderer = 'texture-mesh';
      resume();
    }).catch(async () => {
      if (!await waitForIdle() || disposed) return;
      textures = fallbackTextures();
      canvas.dataset.renderer = 'fallback';
      resume();
    });
  }

  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (!visible) clearPointer();
    resume();
  });
  const resizeObserver = new ResizeObserver(() => resize());
  observer.observe(canvas);
  resizeObserver.observe(canvas);
  document.addEventListener('visibilitychange', visibilityChanged);
  preference.addEventListener('change', resume);
  window.addEventListener('pointermove', movePointer, { passive: true });
  window.addEventListener('pointerout', leavePointer, { passive: true });
  window.addEventListener('scroll', pauseForScroll, { passive: true });
  window.addEventListener('touchstart', touchStart, { passive: true });
  window.addEventListener('touchmove', touchMove, { passive: true });
  window.addEventListener('touchend', touchEnd, { passive: true });
  window.addEventListener('touchcancel', touchEnd, { passive: true });
  resize();
  canvas.dataset.renderer = 'loading';

  return () => {
    disposed = true;
    textureAbort.abort();
    cancelAnimationFrame(frame);
    clearTimeout(scrollTimer);
    if (texturePreparation) texturePreparation(false);
    texturePreparation = null;
    observer.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', visibilityChanged);
    preference.removeEventListener('change', resume);
    window.removeEventListener('pointermove', movePointer);
    window.removeEventListener('pointerout', leavePointer);
    window.removeEventListener('scroll', pauseForScroll);
    window.removeEventListener('touchstart', touchStart);
    window.removeEventListener('touchmove', touchMove);
    window.removeEventListener('touchend', touchEnd);
    window.removeEventListener('touchcancel', touchEnd);
  };
}
