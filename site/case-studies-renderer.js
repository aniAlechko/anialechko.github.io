const MAP_COLUMNS = 18;
const MAP_ROWS = 12;
const COMPLETE_INTRO = 2.2;
const modulo = (n, period) => ((n % period) + period) % period;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

const vertex = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = vec2(aPosition.x, -aPosition.y) * .5 + .5;
  gl_Position = vec4(aPosition, 0., 1.);
}`;

const fragment = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec2 uPan;
uniform vec2 uCard;
uniform float uGap;
uniform float uBowY;
uniform float uTime;
uniform float uIntro;
uniform vec3 uHovers[4];
uniform vec2 uPointer;
uniform float uPointAmount;
uniform sampler2D uLabels;
uniform sampler2D uImages;
uniform sampler2D uMap;
uniform vec2 uAtlasGrid;
uniform int uEntryCount;
uniform float uSeeds[64];
uniform float uHasImages[64];

float noiseHash(vec3 p) {
  p = fract(p * vec3(.1031, .1030, .0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float roundedDistance(vec2 point, vec2 halfBox, float radius) {
  vec2 corner = abs(point) - halfBox + radius;
  return length(max(corner, 0.)) + min(max(corner.x, corner.y), 0.) - radius;
}
float sameCell(vec2 a, vec2 b) {
  return 1. - step(.5, abs(a.x - b.x) + abs(a.y - b.y));
}
float entrance(vec2 cell, vec2 pitch) {
  if (uIntro >= 2.2) return 1.;
  vec2 location = (cell + .5) * pitch - uPan - uResolution * .5;
  float reach = clamp(length(location) / max(length(uResolution) * .5, 1.), 0., 1.2);
  float delay = noiseHash(vec3(cell, 4.7)) * .24;
  return clamp((uIntro - reach * 1.15 - delay) / .72, 0., 1.);
}
float overshoot(float t) {
  float p = t - 1.;
  return 1. + 2.25 * p * p * p + 1.25 * p * p;
}
vec4 lettering(int index, vec2 uv) {
  float item = float(index);
  vec2 tile = vec2(mod(item, uAtlasGrid.x), floor(item / uAtlasGrid.x));
  return texture(uLabels, (tile + clamp(uv, vec2(.0015), vec2(.9985))) / uAtlasGrid);
}
vec3 picture(int index, vec2 uv, float seed) {
  float tick = floor(uTime * 24.);
  vec2 grain = floor(gl_FragCoord.xy / max(uCard / vec2(190., 170.), vec2(.01)));
  float snow = noiseHash(vec3(grain + seed * vec2(13.1, 7.3), tick));
  float scan = .5 + .5 * cos(gl_FragCoord.y / uCard.y * 120. * 6.2831853);
  float roll = fract(uv.y - uTime * .11 + seed * .037);
  float hold = exp(-pow((roll - .5) / .09, 2.));
  float flicker = 1. + .08 * (noiseHash(vec3(tick, seed, 2.)) - .5);
  float intensity = (.075 + pow(snow, .92) * .78) * (1. - .1 * scan) * flicker;
  intensity += hold * .07;
  vec3 base = vec3(intensity);
  if (uHasImages[index] > .5) {
    float item = float(index);
    vec2 tile = vec2(mod(item, uAtlasGrid.x), floor(item / uAtlasGrid.x));
    base = texture(uImages, (tile + clamp(uv, vec2(.0015), vec2(.9985))) / uAtlasGrid).rgb;
  }
  vec4 type = lettering(index, uv);
  return mix(base, type.rgb, type.a);
}
void main() {
  vec2 normalized = vUv * 2. - 1.;
  vec2 measured = normalized * vec2(1., uBowY);
  vec2 curved = normalized * (1. + .22 * dot(measured, measured));
  vec2 world = (curved * .5 + .5) * uResolution + uPan;
  vec2 pitch = uCard + uGap;
  vec2 cell = floor(world / pitch);
  vec2 local = world - (cell + .5) * pitch;
  ivec2 mapCell = ivec2(mod(cell, vec2(18., 12.)));
  int index = int(texelFetch(uMap, mapCell, 0).r * 255. + .5) - 1;
  index = clamp(index, 0, uEntryCount - 1);
  float seed = uSeeds[index];
  float hovered = 0.;
  for (int slot = 0; slot < 4; slot++) {
    hovered += sameCell(cell, uHovers[slot].xy) * uHovers[slot].z;
  }
  hovered = min(hovered, 1.);
  float arrival = entrance(cell, pitch);
  float arrivalOpacity = smoothstep(0., .4, arrival);
  float scale = min((1. + .04 * hovered) * mix(.6, 1., overshoot(arrival)), 1.05);
  local /= max(scale, .01);
  float radius = uCard.x * .15;
  float bevel = uCard.x * .135;
  float surfaceDistance = roundedDistance(local, uCard * .5, radius);
  float aa = clamp(fwidth(surfaceDistance), .75, 2.5);
  float body = (1. - smoothstep(-aa, aa, surfaceDistance)) * arrivalOpacity;
  vec2 normal = normalize(vec2(
    roundedDistance(local + vec2(1., 0.), uCard * .5, radius) - roundedDistance(local - vec2(1., 0.), uCard * .5, radius),
    roundedDistance(local + vec2(0., 1.), uCard * .5, radius) - roundedDistance(local - vec2(0., 1.), uCard * .5, radius)
  ) + vec2(.000001));
  float interior = clamp(-surfaceDistance / bevel, 0., 1.);
  float lens = pow(1. - interior, 2.2);
  vec2 picturePosition = local / uCard * 2.;
  picturePosition *= 1. + .04 * dot(picturePosition, picturePosition);
  vec2 uv = picturePosition * .5 + .5 + (vUv - uPointer) * .016 * hovered;
  vec2 refractOffset = -normal * lens * (.13 * uCard.x / uCard) * (1.55 - .55 * hovered);
  vec3 color;
  color.r = picture(index, uv + refractOffset * .93, seed).r;
  color.g = picture(index, uv + refractOffset, seed).g;
  color.b = picture(index, uv + refractOffset * 1.08, seed).b;

  vec2 restingLight = vec2(.5 + .07 * sin(uTime * .32), .44 + .05 * cos(uTime * .24));
  vec2 lightPosition = mix(restingLight, uPointer, uPointAmount);
  vec2 aim = (lightPosition - .5) * 2.;
  vec3 glassNormal = normalize(vec3(normal * lens * 2.1, .5));
  vec3 keyDirection = normalize(vec3(-.45 + aim.x * .85, .72 - aim.y * .7, .42));
  float key = pow(max(dot(glassNormal, keyDirection), 0.), 11.);
  float fill = pow(max(dot(glassNormal, normalize(vec3(.55, -.62, .56))), 0.), 9.);
  float sheen = pow(max(dot(glassNormal, normalize(vec3(.15, .2, .97))), 0.), 22.);
  color += key * .46 + fill * .20 + sheen * .14;
  vec2 toLight = lightPosition - vUv;
  color += exp(-dot(toLight, toLight) * 14.) * (.035 + hovered * .06);
  float streak = (vUv.y - lightPosition.y) * 1.6 + (vUv.x - lightPosition.x) * .25;
  color += exp(-streak * streak * 22.) * hovered * .05;
  color *= 1. + lens * .07;
  color += exp(-pow(surfaceDistance / 1.65, 2.)) * .32;
  color -= exp(-pow((surfaceDistance + bevel) / max(bevel * .22, 1.), 2.)) * .1;
  color *= 1. - .32 * .04 * dot(picturePosition, picturePosition);
  color *= 1. + hovered * .12;
  color = (color - .5) * (1. + hovered * .16) + .5;

  float glow = 0.;
  for (int slot = 0; slot < 4; slot++) {
    vec2 hoverLocal = (world - (uHovers[slot].xy + .5) * pitch) / (1. + .04 * uHovers[slot].z);
    float hoverDistance = roundedDistance(hoverLocal, uCard * .5, radius);
    glow += uHovers[slot].z * (exp(-abs(hoverDistance) / max(bevel * .16, 1.)) * .26 + exp(-abs(hoverDistance) / max(bevel * 1.1, 1.)) * .09);
  }
  vec3 finalColor = max(color, vec3(0.)) * body + glow * vec3(.55, .68, 1.);
  float alpha = max(body, clamp(glow * 2.2, 0., 1.));
  vec2 edge = abs(vUv * 2. - 1.);
  float fade = (1. - smoothstep(.85, 1., edge.x)) * (1. - smoothstep(.82, 1., edge.y));
  outColor = vec4(finalColor * fade, alpha * fade);
}`;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function makeLattice(entries) {
  const seed = entries.reduce((hash, entry) => {
    for (const char of String(entry.id)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash;
  }, 2166136261);
  const random = seededRandom(seed);
  const cells = new Int16Array(MAP_COLUMNS * MAP_ROWS).fill(-1);
  const counts = new Array(entries.length).fill(0);
  const neighborsContain = (column, row, candidate, radius) => {
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      if (!x && !y) continue;
      if (cells[modulo(row + y, MAP_ROWS) * MAP_COLUMNS + modulo(column + x, MAP_COLUMNS)] === candidate) return true;
    }
    return false;
  };
  for (const cell of shuffled(Array.from(cells.keys()), random)) {
    const column = cell % MAP_COLUMNS, row = Math.floor(cell / MAP_COLUMNS);
    const candidates = shuffled(Array.from(entries.keys()), random);
    let available = candidates.filter(index => !neighborsContain(column, row, index, 2));
    if (!available.length) available = candidates.filter(index => !neighborsContain(column, row, index, 1));
    if (!available.length) available = candidates;
    let selected = available[0];
    for (const candidate of available) if (counts[candidate] < counts[selected]) selected = candidate;
    cells[cell] = selected; counts[selected]++;
  }
  return cells;
}

function roundedDistance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius, qy = Math.abs(y) - halfHeight + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function jsHash(x, y, z) {
  let a = modulo(x * .1031, 1), b = modulo(y * .1030, 1), c = modulo(z * .0973, 1);
  const d = a * (b + 33.33) + b * (a + 33.33) + c * (c + 33.33);
  a += d; b += d; c += d;
  return modulo((a + b) * c, 1);
}

export class GlassWallRenderer {
  constructor(canvas, entries) {
    this.canvas = canvas;
    this.imageGeneration = 0;
    this.pendingImages = new Set();
    this.destroyed = false;
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL2 unavailable');
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Could not create shader');
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(reason || 'Shader compilation failed');
      }
      return shader;
    };
    this.vertexShader = compile(gl.VERTEX_SHADER, vertex);
    this.fragmentShader = compile(gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram();
    if (!this.program) throw new Error('Could not create program');
    gl.attachShader(this.program, this.vertexShader); gl.attachShader(this.program, this.fragmentShader); gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) || 'Program linking failed');
    gl.useProgram(this.program);
    this.vertexArray = gl.createVertexArray(); gl.bindVertexArray(this.vertexArray);
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(this.program, 'aPosition'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = Object.fromEntries(['Resolution', 'Pan', 'Card', 'Gap', 'BowY', 'Time', 'Intro', 'Pointer', 'PointAmount', 'Labels', 'Images', 'Map', 'AtlasGrid', 'EntryCount'].map(name => [name, gl.getUniformLocation(this.program, 'u' + name)]));
    this.uniforms.Hovers = gl.getUniformLocation(this.program, 'uHovers[0]');
    this.uniforms.Seeds = gl.getUniformLocation(this.program, 'uSeeds[0]');
    this.uniforms.HasImages = gl.getUniformLocation(this.program, 'uHasImages[0]');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
    gl.uniform1i(this.uniforms.Labels, 0); gl.uniform1i(this.uniforms.Map, 1); gl.uniform1i(this.uniforms.Images, 2);
    this.lastIntro = COMPLETE_INTRO;
    this.setEntries(entries);
    this.resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, devicePixelRatio || 1);
  }

  _texture(unit, filtering = this.gl.LINEAR) {
    const gl = this.gl, texture = gl.createTexture();
    if (!texture) throw new Error('Could not create texture');
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  setEntries(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 64) throw new Error('The wall needs between 1 and 64 entries');
    const gl = this.gl; gl.useProgram(this.program);
    this.entries = entries.slice(); this.cells = makeLattice(this.entries);
    if (this.mapTexture) gl.deleteTexture(this.mapTexture);
    this.mapTexture = this._texture(1, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MAP_COLUMNS, MAP_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, Uint8Array.from(this.cells, index => index + 1));

    const columns = Math.ceil(Math.sqrt(entries.length)), rows = Math.ceil(entries.length / columns);
    const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const cellWidth = Math.min(768, Math.floor(maximum / columns));
    const cellHeight = Math.round(cellWidth * .63);
    if (rows * cellHeight > maximum) throw new Error('Label atlas exceeds texture capacity');
    const atlas = document.createElement('canvas'); atlas.width = columns * cellWidth; atlas.height = rows * cellHeight;
    const ctx = atlas.getContext('2d');
    if (!ctx) throw new Error('Could not create label atlas');
    for (const [index, entry] of entries.entries()) {
      const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
      ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, cellWidth, cellHeight); ctx.clip();
      const shade = ctx.createLinearGradient(0, cellHeight * .3, 0, cellHeight);
      shade.addColorStop(0, 'rgba(6,6,14,0)'); shade.addColorStop(1, 'rgba(6,6,14,.86)');
      ctx.fillStyle = shade; ctx.fillRect(0, cellHeight * .28, cellWidth, cellHeight * .72);
      const inset = cellWidth * .115, available = cellWidth - inset * 2;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const fit = (text, size, weight) => {
        for (let attempt = 0; attempt < 14; attempt++) {
          ctx.font = `${weight} ${Math.round(size)}px "Neue Montreal", Arial, sans-serif`;
          if (ctx.measureText(text).width <= available) break;
          size *= .92;
        }
      };
      ctx.fillStyle = '#fff'; fit(entry.title || '', cellWidth * .08, 700);
      ctx.fillText(entry.title || '', inset, cellHeight - inset - cellWidth * .052);
      ctx.fillStyle = 'rgba(255,255,255,.74)'; fit(entry.subtitle || '', cellWidth * .026, 400);
      ctx.fillText(entry.subtitle || '', inset, cellHeight - inset);
      ctx.restore();
    }
    if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
    this.atlasTexture = this._texture(0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.uniform2f(this.uniforms.AtlasGrid, columns, rows); gl.uniform1i(this.uniforms.EntryCount, entries.length);
    const seeds = new Float32Array(64);
    entries.forEach((entry, index) => { seeds[index] = Number.isFinite(Number(entry.seed)) ? Number(entry.seed) : index + 1; });
    gl.uniform1fv(this.uniforms.Seeds, seeds);
    this._prepareImages(entries, columns, rows, maximum);
    this.hoverSlots = Array.from({ length: 4 }, () => ({ x: 1e8, y: 1e8, amount: 0, velocity: 0, target: 0 }));
    this.hoverUniform = new Float32Array(12);
    this.hoverTime = 0;
  }

  _advanceHovers(hover) {
    const now = performance.now();
    const dt = Math.min(.05, Math.max(0, (now - (this.hoverTime || now)) / 1000));
    this.hoverTime = now;
    for (const slot of this.hoverSlots) slot.target = 0;
    const target = clamp(hover.amount || 0, 0, 1);
    if (target > 0 && Number.isFinite(hover.x) && Number.isFinite(hover.y)) {
      let current = this.hoverSlots.find(slot => slot.x === hover.x && slot.y === hover.y);
      if (!current) {
        current = this.hoverSlots.reduce((smallest, slot) => slot.amount < smallest.amount ? slot : smallest);
        Object.assign(current, { x: hover.x, y: hover.y, amount: 0, velocity: 0 });
      }
      current.target = target;
    }
    // Independent critically damped springs let previous cards settle naturally.
    const omega = 18, decay = Math.exp(-omega * dt);
    for (const [index, slot] of this.hoverSlots.entries()) {
      const difference = slot.amount - slot.target;
      const change = (slot.velocity + omega * difference) * dt;
      slot.velocity = (slot.velocity - omega * change) * decay;
      slot.amount = clamp(slot.target + (difference + change) * decay, 0, 1);
      if (!slot.target && slot.amount < .0001) slot.amount = slot.velocity = 0;
      this.hoverUniform.set([slot.x, slot.y, slot.amount], index * 3);
    }
  }

  _cancelImages() {
    this.imageGeneration++;
    for (const image of this.pendingImages) {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
    }
    this.pendingImages.clear();
  }

  _prepareImages(entries, columns, rows, maximum) {
    this._cancelImages();
    const generation = this.imageGeneration;
    const gl = this.gl;
    if (this.imageTexture) gl.deleteTexture(this.imageTexture);
    this.imageTexture = this._texture(2);
    this.imageMask = new Float32Array(64);
    gl.uniform1fv(this.uniforms.HasImages, this.imageMask);
    // Keep empty galleries lightweight: no image atlas until an entry has an image.
    if (!entries.some(entry => typeof entry.image === 'string' && entry.image.trim())) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return;
    }
    const cellWidth = Math.min(512, Math.floor(maximum / columns));
    const cellHeight = Math.round(cellWidth * .63);
    const atlas = document.createElement('canvas');
    atlas.width = columns * cellWidth; atlas.height = rows * cellHeight;
    const ctx = atlas.getContext('2d');
    if (!ctx) throw new Error('Could not create project image atlas');
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    for (const [index, entry] of entries.entries()) {
      if (typeof entry.image !== 'string' || !entry.image.trim()) continue;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      this.pendingImages.add(image);
      image.onerror = () => { this.pendingImages.delete(image); };
      image.onload = () => {
        this.pendingImages.delete(image);
        if (this.destroyed || generation !== this.imageGeneration || gl.isContextLost()) return;
        const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
        const scale = Math.max(cellWidth / image.naturalWidth, cellHeight / image.naturalHeight);
        const drawnWidth = image.naturalWidth * scale, drawnHeight = image.naturalHeight * scale;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, cellWidth, cellHeight); ctx.clip();
        ctx.drawImage(image, x + (cellWidth - drawnWidth) * .5, y + (cellHeight - drawnHeight) * .5, drawnWidth, drawnHeight);
        ctx.restore();
        // Anonymous CORS failures leave the existing snow visible.
        try {
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
          this.imageMask[index] = 1;
          gl.useProgram(this.program); gl.uniform1fv(this.uniforms.HasImages, this.imageMask);
        } catch { this.imageMask[index] = 0; }
      };
      image.src = entry.image;
    }
  }

  resize(width, height, dpr = 1, zoom = .75) {
    const gl = this.gl;
    width = Math.max(1, width); height = Math.max(1, height); dpr = clamp(dpr || 1, .2, 1.5);
    const k = (width < 640 ? width * .86 / 520 : clamp(width / 1850, .52, .96) * 1.5) * zoom;
    this._layout = { cardWidth: 520 * k, cardHeight: 520 * k * .63, gap: 26 * k, dpr, width, height };
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    gl.useProgram(this.program); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.Resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.Card, this._layout.cardWidth * dpr, this._layout.cardHeight * dpr);
    gl.uniform1f(this.uniforms.Gap, this._layout.gap * dpr);
    gl.uniform1f(this.uniforms.BowY, clamp(height / width, 1, 1.5));
  }

  get layout() { return { ...this._layout }; }

  draw({ pan = [0, 0], time = 0, hover = {}, pointer = [.5, .42], pointAmount = 0, intro = COMPLETE_INTRO } = {}) {
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('WebGL context lost');
    const dpr = this._layout.dpr;
    this._advanceHovers(hover);
    this.lastIntro = Number.isFinite(intro) ? intro : COMPLETE_INTRO;
    gl.useProgram(this.program); gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mapTexture);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.uniform2f(this.uniforms.Pan, pan[0] * dpr, pan[1] * dpr);
    gl.uniform1f(this.uniforms.Time, time); gl.uniform1f(this.uniforms.Intro, this.lastIntro);
    gl.uniform3fv(this.uniforms.Hovers, this.hoverUniform);
    gl.uniform2f(this.uniforms.Pointer, pointer[0], pointer[1]); gl.uniform1f(this.uniforms.PointAmount, clamp(pointAmount || 0, 0, 1));
    gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  pick(cssX, cssY, pan = [0, 0]) {
    const { width, height, cardWidth, cardHeight, gap, dpr } = this._layout;
    let x = cssX / width * 2 - 1, y = cssY / height * 2 - 1;
    const bowY = clamp(height / width, 1, 1.5), curve = 1 + .22 * (x * x + y * bowY * y * bowY);
    x = (x * curve * .5 + .5) * (this.canvas.width / dpr) + pan[0];
    y = (y * curve * .5 + .5) * (this.canvas.height / dpr) + pan[1];
    const pitchX = cardWidth + gap, pitchY = cardHeight + gap;
    const column = Math.floor(x / pitchX), row = Math.floor(y / pitchY);
    const index = this.cells[modulo(row, MAP_ROWS) * MAP_COLUMNS + modulo(column, MAP_COLUMNS)];
    let scale = 1;
    const grow = this.hoverSlots.find(slot => column === slot.x && row === slot.y)?.amount || 0;
    let arrival = 1;
    if (this.lastIntro < COMPLETE_INTRO) {
      const cx = (column + .5) * pitchX - pan[0] - this.canvas.width / dpr * .5;
      const cy = (row + .5) * pitchY - pan[1] - this.canvas.height / dpr * .5;
      const reach = clamp(Math.hypot(cx, cy) / Math.max(Math.hypot(this.canvas.width / dpr, this.canvas.height / dpr) * .5, 1), 0, 1.2);
      arrival = clamp((this.lastIntro - reach * 1.15 - jsHash(column, row, 4.7) * .24) / .72, 0, 1);
      const t = arrival - 1, overshoot = 1 + 2.25 * t * t * t + 1.25 * t * t;
      scale = .6 + .4 * overshoot;
    }
    scale = Math.min(scale * (1 + .04 * grow), 1.05);
    const localX = (x - (column + .5) * pitchX) / scale, localY = (y - (row + .5) * pitchY) / scale;
    const distance = roundedDistance(localX, localY, cardWidth * .5, cardHeight * .5, cardWidth * .15);
    return { cell: [column, row], index, inside: distance <= 0 && arrival > .05 };
  }

  destroy() {
    this.destroyed = true;
    this._cancelImages();
    const gl = this.gl;
    gl.deleteTexture(this.atlasTexture); gl.deleteTexture(this.mapTexture); gl.deleteTexture(this.imageTexture);
    gl.deleteBuffer(this.buffer); gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program); gl.deleteShader(this.vertexShader); gl.deleteShader(this.fragmentShader);
  }
}
