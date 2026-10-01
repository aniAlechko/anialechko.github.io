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

async function loadTextures() {
  const image = new Image();
  image.decoding = 'async';
  // Loaded images can be drawn even when a background tab delays decode().
  await new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('Butterfly texture timed out')), 15000);
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error('Empty butterfly image'));
    image.onerror = () => finish(new Error('Butterfly texture could not load'));
    image.src = ATLAS_URL;
    if (image.complete && image.naturalWidth && image.naturalHeight) finish();
  });
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
    const scale = Math.min(1, 512 / Math.max(cropWidth, cropHeight));
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

function drawButterfly(context, texture, butterfly, span, time, still, cell) {
  const { width, height, wings, body } = texture;
  const burst = still ? 0 : 0.16 + 0.84 * smoothstep(-0.4, 0.65, Math.sin(time * 1.16 + butterfly.phase));
  const pitch = still ? 0.14 : 0.21 + Math.sin(time * 0.63 + butterfly.phase) * 0.07 + butterfly.vy * 0.001;
  const yaw = still ? 0 : Math.sin(time * 0.43 + butterfly.phase) * 0.075;
  const cosRoll = Math.cos(butterfly.angle);
  const sinRoll = Math.sin(butterfly.angle);
  const breathing = still ? 1 : 1 + Math.sin(time * 0.41 + butterfly.phase) * 0.035;
  const size = span * breathing;

  function project(source, side) {
    let x = source.x / width - 0.5;
    let y = (source.y - height * 0.5) / width;
    const row = source.y / height;
    // The trailing edge follows the leading edge, rather than scaling a flat image.
    const lag = smoothstep(0.35, 0.88, row) * 0.5;
    const beat = Math.sin(butterfly.beat - lag + side * 0.09);
    const fold = still ? 0.16 : 0.19 + burst * (0.44 + 0.43 * beat);
    const flex = Math.pow(Math.abs(x) * 2, 2) * burst * Math.cos(butterfly.beat - lag) * 0.09;
    const angle = fold + flex;
    let z = Math.abs(x) * Math.sin(angle);
    x *= Math.cos(angle);
    y += Math.abs(x) * burst * Math.sin(butterfly.beat - lag) * 0.025;
    const pitchedY = y * Math.cos(pitch) - z * Math.sin(pitch);
    z = y * Math.sin(pitch) + z * Math.cos(pitch);
    const turnedX = x * Math.cos(yaw) + z * Math.sin(yaw);
    z = z * Math.cos(yaw) - x * Math.sin(yaw);
    const perspective = 2.8 / (2.8 - z);
    const screenX = turnedX * size * perspective;
    const screenY = pitchedY * size * perspective;
    return {
      x: butterfly.x + screenX * cosRoll - screenY * sinRoll,
      y: butterfly.y + screenX * sinRoll + screenY * cosRoll,
    };
  }

  const columns = 5;
  const rows = 7;
  for (const side of [-1, 1]) {
    const start = side === -1 ? 0 : width / 2;
    const vertices = [];
    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const source = { x: start + column / columns * width / 2, y: row / rows * height };
        vertices.push({ source, destination: project(source, side) });
      }
    }
    const light = still ? 1 : 0.93 + 0.07 * Math.cos(butterfly.beat + side * 0.4) * burst;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * (columns + 1) + column;
        const corners = [vertices[index], vertices[index + 1], vertices[index + columns + 1], vertices[index + columns + 2]];
        for (const triangle of [[0, 1, 2], [1, 3, 2]]) {
          drawTriangle(context, wings, triangle.map(corner => corners[corner].source), triangle.map(corner => corners[corner].destination), cell * 0.46, light);
        }
      }
    }
  }
  context.save();
  context.translate(butterfly.x, butterfly.y);
  context.rotate(butterfly.angle);
  context.scale(size / width, size / width * Math.cos(pitch));
  context.drawImage(body, -width / 2, -height / 2);
  context.restore();
}

export function initButterflies(canvas = document.querySelector('#butterfly-field')) {
  if (!canvas) return () => {};
  const context = canvas.getContext('2d', { alpha: true });
  const sample = makeCanvas(1, 1);
  const sampler = sample.getContext('2d', { willReadFrequently: true });
  if (!context || !sampler) return () => {};
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const butterflies = [0.3, 2.7].map(phase => ({ phase, beat: phase, x: 0, y: 0, vx: 0, vy: 0, angle: 0, initialized: false }));
  const pointer = { active: false, x: 0, y: 0, vx: 0, vy: 0, last: 0 };
  let textures = null;
  let width = 0;
  let height = 0;
  let cell = 6.8;
  let visible = false;
  let frame = 0;
  let lastFrame = 0;
  let time = 0;
  let disposed = false;
  let flowX = new Float32Array(0);
  let flowY = new Float32Array(0);
  let speedX = new Float32Array(0);
  let speedY = new Float32Array(0);

  function updateFlight(dt, still) {
    const portrait = width < 810 && height > width;
    butterflies.forEach((butterfly, index) => {
      const phase = butterfly.phase;
      const homeX = width * (index ? 0.79 : portrait ? 0.22 : 0.205);
      const homeY = height * (index ? portrait ? 0.33 : height < 500 ? 0.4 : 0.28 : 0.72);
      const driftX = still ? 0 : (Math.sin(time * 0.31 + phase) + Math.sin(time * 0.67 + phase) * 0.24) * Math.min(30, width * 0.033);
      const driftY = still ? 0 : (Math.cos(time * 0.39 + phase) + Math.sin(time * 0.83 + phase) * 0.22) * Math.min(23, height * 0.03);
      let targetX = homeX + driftX;
      let targetY = homeY + driftY;
      if (pointer.active && !still) {
        const dx = butterfly.x - pointer.x;
        const dy = butterfly.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        const influence = Math.pow(Math.max(0, 1 - distance / Math.min(240, width * 0.3)), 2);
        targetX += dx / Math.max(1, distance) * influence * 11;
        targetY += dy / Math.max(1, distance) * influence * 11;
      }
      if (!butterfly.initialized || still) {
        butterfly.x = targetX;
        butterfly.y = targetY;
        butterfly.vx = 0;
        butterfly.vy = 0;
        butterfly.initialized = true;
      } else {
        butterfly.vx += ((targetX - butterfly.x) * 3.2 - butterfly.vx * 2.7) * dt;
        butterfly.vy += ((targetY - butterfly.y) * 3.2 - butterfly.vy * 2.7) * dt;
        butterfly.x += butterfly.vx * dt;
        butterfly.y += butterfly.vy * dt;
      }
      const baseAngle = index ? 0.3 : -0.24;
      const angle = baseAngle + (still ? 0 : Math.sin(time * 0.37 + phase) * 0.085 + clamp(butterfly.vx * 0.008, -0.14, 0.14));
      butterfly.angle += (angle - butterfly.angle) * (still || !dt ? 1 : 1 - Math.exp(-3.5 * dt));
      butterfly.beat += dt * TAU * (3.25 + Math.sin(time * 0.7 + phase) * 0.55);
    });
  }

  function paint(dt = 0) {
    if (!width || !height || !textures) return;
    const still = preference.matches;
    const portrait = width < 810 && height > width;
    updateFlight(dt, still);
    sampler.setTransform(sample.width / width, 0, 0, sample.height / height, 0, 0);
    sampler.clearRect(0, 0, width, height);
    const span = portrait ? Math.min(width * 0.62, 330) : Math.min(width * 0.39, height * 0.79, 640);
    butterflies.forEach((butterfly, index) => drawButterfly(sampler, textures[index], butterfly, span * (index ? 0.91 : 1), time, still, cell));

    const pixels = sampler.getImageData(0, 0, sample.width, sample.height).data;
    context.clearRect(0, 0, width, height);
    const spacingX = width / sample.width;
    const spacingY = height / sample.height;
    const radius = Math.min(180, Math.max(95, width * 0.14));
    pointer.vx *= Math.exp(-dt * 8);
    pointer.vy *= Math.exp(-dt * 8);
    for (let row = 0; row < sample.height; row += 1) {
      for (let column = 0; column < sample.width; column += 1) {
        const index = row * sample.width + column;
        const x = (column + 0.5) * spacingX;
        const y = (row + 0.5) * spacingY;
        if (!still && dt) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = dx * dx + dy * dy;
          const influence = pointer.active && distance < radius * radius * 5 ? Math.exp(-distance / (radius * radius * 0.72)) : 0;
          const targetX = influence * (clamp(pointer.vx * 0.045, -34, 34) + Math.sin(y * 0.025 + time * 2.1) * 5);
          const targetY = influence * (clamp(pointer.vy * 0.045, -34, 34) + Math.cos(x * 0.023 - time * 1.8) * 5);
          speedX[index] += ((targetX - flowX[index]) * 54 - speedX[index] * 10) * dt;
          speedY[index] += ((targetY - flowY[index]) * 54 - speedY[index] * 10) * dt;
          flowX[index] += speedX[index] * dt;
          flowY[index] += speedY[index] * dt;
        }
        // Distort the sampled surface; the visible dots stay on a regular grid.
        const sampleX = clamp(column + (still ? 0 : flowX[index] / spacingX), 0, sample.width - 1);
        const sampleY = clamp(row + (still ? 0 : flowY[index] / spacingY), 0, sample.height - 1);
        const left = Math.floor(sampleX);
        const top = Math.floor(sampleY);
        const mixX = sampleX - left;
        const mixY = sampleY - top;
        const topLeft = (top * sample.width + left) * 4;
        const topRight = (top * sample.width + Math.min(left + 1, sample.width - 1)) * 4;
        const bottomLeft = (Math.min(top + 1, sample.height - 1) * sample.width + left) * 4;
        const bottomRight = (Math.min(top + 1, sample.height - 1) * sample.width + Math.min(left + 1, sample.width - 1)) * 4;
        const channel = offset => (pixels[topLeft + offset] * (1 - mixX) + pixels[topRight + offset] * mixX) * (1 - mixY)
          + (pixels[bottomLeft + offset] * (1 - mixX) + pixels[bottomRight + offset] * mixX) * mixY;
        const alpha = channel(3) / 255;
        if (alpha < 0.07) continue;
        const red = channel(0);
        const green = channel(1);
        const blue = channel(2);
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
    if (disposed || !visible || document.hidden || preference.matches) return;
    if (now - lastFrame >= 1000 / (width < 810 ? 30 : 60) - 1) {
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
    if (visible && !document.hidden) {
      paint();
      if (!preference.matches) frame = requestAnimationFrame(tick);
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);
    if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height)) return;
    width = nextWidth;
    height = nextHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cell = Math.max(width < 810 ? 4.6 : 6.8, Math.sqrt(width * height / 34000));
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
    butterflies.forEach(butterfly => { butterfly.initialized = false; });
    pointer.active = false;
    paint();
  }

  function movePointer(event) {
    if (event.pointerType === 'touch' || preference.matches || !visible) return;
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
  }

  function leavePointer(event) {
    if (!event.relatedTarget) pointer.active = false;
  }

  function clearPointer() { pointer.active = false; }

  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (!visible) clearPointer();
    resume();
  }, { rootMargin: '80px' });
  const resizeObserver = new ResizeObserver(resize);
  observer.observe(canvas);
  resizeObserver.observe(canvas);
  document.addEventListener('visibilitychange', resume);
  preference.addEventListener('change', resume);
  window.addEventListener('pointermove', movePointer, { passive: true });
  window.addEventListener('pointerout', leavePointer, { passive: true });
  window.addEventListener('scroll', clearPointer, { passive: true });
  resize();
  canvas.dataset.renderer = 'loading';
  loadTextures().then(result => {
    if (disposed) return;
    textures = result;
    canvas.dataset.renderer = 'texture-mesh';
    resume();
  }).catch(() => {
    if (disposed) return;
    textures = fallbackTextures();
    canvas.dataset.renderer = 'fallback';
    resume();
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', resume);
    preference.removeEventListener('change', resume);
    window.removeEventListener('pointermove', movePointer);
    window.removeEventListener('pointerout', leavePointer);
    window.removeEventListener('scroll', clearPointer);
  };
}
