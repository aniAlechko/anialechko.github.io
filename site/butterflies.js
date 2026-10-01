const TAU = Math.PI * 2;
const FOREWING = 'M0 0C54-22 74-170 191-250C258-294 360-275 347-191C336-109 249-36 123-6C62 8 23 15 0 0Z';
const HINDWING = 'M0 0C65-27 151-38 221-2C311 53 297 149 234 169C191 179 158 145 127 196C91 183 56 144 20 63Z';
const PALETTES = [
  { root: '#241552', middle: '#2169d7', light: '#68e5f0', edge: '#283967', spot: '#b7efff', vein: '#10183d' },
  { root: '#371950', middle: '#ca5487', light: '#ffbd8f', edge: '#5b397f', spot: '#ffe7b4', vein: '#381e47' },
];

function makeWing(palette, forewing) {
  const texture = document.createElement('canvas');
  texture.width = 500;
  texture.height = 700;
  const context = texture.getContext('2d');
  if (!context) return null;
  context.scale(1.25, 1.25);
  context.translate(20, 290);
  const shape = new Path2D(forewing ? FOREWING : HINDWING);
  context.save();
  context.clip(shape);
  const wash = context.createLinearGradient(-10, 0, 340, forewing ? -180 : 110);
  wash.addColorStop(0, palette.root);
  wash.addColorStop(0.28, palette.middle);
  wash.addColorStop(0.7, palette.light);
  wash.addColorStop(1, palette.edge);
  context.fillStyle = wash;
  context.fillRect(-20, -290, 400, 560);

  // Long translucent scales give the wing a luminous surface between its veins.
  for (let index = 0; index < 32; index += 1) {
    const angle = forewing ? -1.03 + index * 0.032 : -0.05 + index * 0.045;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(angle) * 470, Math.sin(angle) * 470);
    context.strokeStyle = index % 3 === 0 ? '#ffffff13' : '#1408290b';
    context.lineWidth = 5 + (index % 4) * 2;
    context.stroke();
  }

  const veins = forewing
    ? [[191, -250], [245, -272], [304, -263], [348, -218], [329, -151], [276, -85], [211, -34], [133, -7]]
    : [[220, -3], [277, 54], [278, 107], [234, 166], [188, 158], [128, 194], [72, 157]];
  for (const [x, y] of veins) {
    context.beginPath();
    context.moveTo(3, 0);
    context.quadraticCurveTo(x * 0.48, y * 0.25 - 13, x, y);
    context.strokeStyle = palette.vein;
    context.lineWidth = 5;
    context.stroke();
    context.strokeStyle = '#ffffff28';
    context.lineWidth = 1.2;
    context.stroke();
  }
  context.lineWidth = forewing ? 19 : 15;
  context.strokeStyle = palette.vein;
  context.stroke(shape);

  const spots = forewing
    ? [[208, -247, 5], [241, -258, 6], [275, -254, 7], [309, -237, 8], [329, -211, 7], [324, -179, 6], [305, -144, 5], [280, -113, 4], [253, -87, 4]]
    : [[248, 34, 5], [266, 66, 6], [261, 102, 7], [235, 135, 6], [201, 139, 5], [160, 151, 5], [128, 167, 5], [102, 148, 4]];
  for (const [x, y, radius] of spots) {
    context.beginPath();
    context.ellipse(x, y, radius, radius * 1.5, forewing ? 0.75 : -0.6, 0, TAU);
    context.fillStyle = palette.spot;
    context.fill();
  }

  // A broad highlight remains readable after the surface is sampled into dots.
  const sheen = context.createRadialGradient(150, forewing ? -140 : 82, 3, 155, forewing ? -137 : 77, 135);
  sheen.addColorStop(0, '#fff5da35');
  sheen.addColorStop(1, '#fff5da00');
  context.fillStyle = sheen;
  context.fillRect(0, -280, 370, 500);
  context.restore();
  return texture;
}

function drawButterfly(context, wings, palette, x, y, size, angle, time, phase, still) {
  const beat = still ? 0.8 : Math.sin(time * 2.15 + phase);
  const lift = still ? 0 : Math.cos(time * 2.15 + phase);
  context.save();
  context.translate(x, y);
  context.rotate(angle + (still ? 0 : Math.sin(time * 0.52 + phase) * 0.045));
  context.scale(size / 710, size / 710);

  for (const forewing of [false, true]) {
    for (const side of [-1, 1]) {
      const reach = 0.8 + beat * 0.17 + side * 0.035;
      context.save();
      // The two lobes flex separately at their roots, keeping their volume as they fold.
      context.transform(side * reach, lift * (forewing ? -0.09 : -0.035), 0, 1 - Math.abs(lift) * 0.04, 0, 0);
      context.rotate((forewing ? -0.025 : 0.035) * lift);
      context.drawImage(wings[forewing ? 0 : 1], -20, -290, 400, 560);
      context.restore();
    }
  }

  context.strokeStyle = palette.spot;
  context.lineWidth = 4;
  context.lineCap = 'round';
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(side * 5, -43);
    context.quadraticCurveTo(side * 12, -91, side * 35, -115);
    context.stroke();
    context.beginPath();
    context.ellipse(side * 35, -115, 4, 6, side * 0.4, 0, TAU);
    context.fillStyle = palette.spot;
    context.fill();
  }
  const body = context.createLinearGradient(-11, 0, 11, 0);
  body.addColorStop(0, palette.vein);
  body.addColorStop(0.45, palette.edge);
  body.addColorStop(0.7, palette.spot);
  body.addColorStop(1, palette.root);
  context.fillStyle = body;
  context.beginPath();
  context.ellipse(0, 26, 9, 67, 0, 0, TAU);
  context.fill();
  context.beginPath();
  context.ellipse(0, -22, 13, 28, 0, 0, TAU);
  context.fill();
  context.beginPath();
  context.ellipse(0, -52, 9, 10, 0, 0, TAU);
  context.fill();
  context.restore();
}

export function initButterflies(canvas = document.querySelector('#butterfly-field')) {
  if (!canvas) return () => {};
  const context = canvas.getContext('2d', { alpha: true });
  const sample = document.createElement('canvas');
  const sampler = sample.getContext('2d', { willReadFrequently: true });
  if (!context || !sampler) return () => {};
  const wings = PALETTES.map(palette => [makeWing(palette, true), makeWing(palette, false)]);
  if (wings.some(pair => pair.some(wing => !wing))) return () => {};
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0;
  let height = 0;
  let cell = 6.8;
  let visible = false;
  let frame = 0;
  let lastFrame = 0;
  let time = 0;
  let disposed = false;

  function paint() {
    if (!width || !height) return;
    const portrait = width < 810 && height > width;
    const still = preference.matches;
    const drift = still ? 0 : Math.sin(time * 0.38) * Math.min(18, width * 0.014);
    sampler.setTransform(sample.width / width, 0, 0, sample.height / height, 0, 0);
    sampler.clearRect(0, 0, width, height);
    const span = portrait ? Math.min(width * 0.57, 310) : Math.min(width * 0.37, height * 0.77, 620);
    drawButterfly(sampler, wings[0], PALETTES[0], width * (portrait ? 0.22 : 0.205) + drift, height * 0.72 + drift * 0.6, span, -0.24, time, 0.2, still);
    drawButterfly(sampler, wings[1], PALETTES[1], width * 0.79 - drift * 0.7, height * (portrait ? 0.33 : height < 500 ? 0.4 : 0.28) - drift, span * 0.91, 0.34, time, 2.5, still);

    const pixels = sampler.getImageData(0, 0, sample.width, sample.height).data;
    context.clearRect(0, 0, width, height);
    const spacingX = width / sample.width;
    const spacingY = height / sample.height;
    for (let row = 0; row < sample.height; row += 1) {
      for (let column = 0; column < sample.width; column += 1) {
        const offset = (row * sample.width + column) * 4;
        const alpha = pixels[offset + 3] / 255;
        if (alpha < 0.08) continue;
        const brightness = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) / 255;
        const radius = cell * (0.28 + brightness * 0.15) * Math.sqrt(alpha);
        context.beginPath();
        context.arc((column + 0.5) * spacingX, (row + 0.5) * spacingY, radius, 0, TAU);
        context.fillStyle = `rgb(${pixels[offset]} ${pixels[offset + 1]} ${pixels[offset + 2]})`;
        context.fill();
      }
    }
  }

  function tick(now) {
    frame = 0;
    if (disposed || !visible || document.hidden || preference.matches) return;
    if (now - lastFrame >= 1000 / 30) {
      time += Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      paint();
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
    width = Math.round(bounds.width);
    height = Math.round(bounds.height);
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cell = width < 810 ? 5 : 6.8;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    sample.width = Math.max(1, Math.ceil(width / cell));
    sample.height = Math.max(1, Math.ceil(height / cell));
    paint();
  }

  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    resume();
  }, { rootMargin: '80px' });
  const resizeObserver = new ResizeObserver(resize);
  observer.observe(canvas);
  resizeObserver.observe(canvas);
  document.addEventListener('visibilitychange', resume);
  preference.addEventListener('change', resume);
  resize();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', resume);
    preference.removeEventListener('change', resume);
  };
}
