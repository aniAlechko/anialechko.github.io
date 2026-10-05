import { createWaterField } from './water-field.js';

export function initFooterFish() {
  let canvas = document.querySelector('#footer-fish');
  const footer = document.querySelector('#landing');
  if (!canvas || !footer) return { cleanup() {} };
  const copy = footer.querySelector('.contact-copy');
  const details = footer.querySelector('.contact-details');
  const header = document.querySelector('.contact-header');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const clips = ['warm', 'cool'].map((name, index) => {
    const video = document.createElement('video');
    video.muted = video.defaultMuted = video.playsInline = video.loop = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.setAttribute('playsinline', '');
    const angle = (index ? 33 : 0) * Math.PI / 180;
    return { video, index, name, phase: index ? .26 : 0, rate: index ? .94 : 1, aspect: 1,
      baseAngle: angle, layoutCosine: Math.cos(angle), layoutSine: Math.sin(angle),
      cosine: Math.cos(angle), sine: Math.sin(angle),
      swim: createSwim(angle, index),
      envelope: [.06, .04, .94, .96],
      ready: false, displayed: false, failed: false, decoded: 0, uploaded: -1,
      frameRequest: 0, frameEvents: typeof video.requestVideoFrameCallback === 'function' };
  });
  const anchors = [new Float32Array(4), new Float32Array(4)];
  const placements = [new Float32Array(4), new Float32Array(4)];
  const pointer = { x: .5, y: .5, targetX: .5, targetY: .5 };
  const waterField = createWaterField();
  const waterOffset = new Float32Array(2);
  let waterTime = 0;
  const request = new AbortController();
  let width = 0, height = 0, dpr = 1, cell = 3;
  let visible = false, disposed = false, frame = 0, resizeFrame = 0, lastTime = 0;
  let gl, glCanvas, program, uniforms, context;
  let lastFallbackDraw = -Infinity;

  const vertexSource = `#version 300 es
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    uniform sampler2D uVideoA, uVideoB;
    uniform vec2 uReady, uViewport, uPointer;
    uniform vec4 uFishA, uFishB, uFishRotation;
    uniform float uDpr, uCell, uTime, uDistortion;
    out vec4 outColor;
    vec3 sampleFish(vec2 p, vec4 placement, bool cool) {
      vec2 rotation = cool ? uFishRotation.zw : uFishRotation.xy;
      vec2 delta = p - placement.xy;
      vec2 local = vec2(rotation.x * delta.x + rotation.y * delta.y,
                        -rotation.y * delta.x + rotation.x * delta.y);
      vec2 uv = local / placement.zw + .5;
      if (any(lessThan(uv, vec2(0))) || any(greaterThan(uv, vec2(1)))) return vec3(0);
      if ((cool ? uReady.y : uReady.x) < .5) return vec3(0);
      return cool ? texture(uVideoB, vec2(uv.x, 1.0 - uv.y)).rgb
        : texture(uVideoA, vec2(uv.x, 1.0 - uv.y)).rgb;
    }
    vec2 rotatePoint(vec2 p, float angle) {
      float c = cos(angle), s = sin(angle);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }
    vec2 water(vec2 p) {
      if (uDistortion < .5) return vec2(0);
      vec2 aspect = vec2(uViewport.x / uViewport.y, 1);
      vec2 origin = vec2(.5) + (uPointer - .5) * .6;
      vec2 initial = (p / uViewport - origin) * aspect;
      vec2 q = rotatePoint(initial, 1.134464);
      float drift = uTime * .0384;
      float phase = uTime * .1875;
      q.y += drift;
      for (int i = 1; i <= 5; i++) {
        q = rotatePoint(q, float(i) * 1.2566370614);
        float frequency = 2.5 * float(i);
        q.x += .094 * cos(q.y * frequency + phase);
        q.y += .094 * sin(q.x * frequency + phase);
      }
      q.y -= drift;
      q = rotatePoint(q, -1.134464);
      float edge = min(min(p.x, uViewport.x - p.x), min(p.y, uViewport.y - p.y));
      return (q - initial) / aspect * uViewport * .13 * smoothstep(0.0, 48.0, edge);
    }
    vec3 scene(vec2 p) {
      return max(sampleFish(p, uFishA, false), sampleFish(p, uFishB, true));
    }
    void main() {
      vec2 pixel = vec2(gl_FragCoord.x / uDpr, uViewport.y - gl_FragCoord.y / uDpr);
      vec2 grid = pixel / uCell;
      vec2 center = (floor(grid) + .5) * uCell;
      vec2 shift = water(center);
      vec3 color = vec3(0);
      for (int y = -1; y <= 1; y += 2) {
        for (int x = -1; x <= 1; x += 2) {
          vec2 p = center + vec2(float(x), float(y)) * uCell * .26;
          color += vec3(scene(p + shift * 1.125).r,
                        scene(p + shift).g,
                        scene(p + shift * .875).b) * .25;
        }
      }
      color = pow(color, vec3(.9));
      float circle = 1.0 - smoothstep(.29, .40, length(fract(grid) - .5));
      outColor = vec4(color * circle, 1.0);
    }`;

  function initializeGL() {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!gl) return false;
    glCanvas = canvas;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        throw new Error('Fish shader unavailable.');
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Fish renderer unavailable.');
    gl.useProgram(program);
    uniforms = Object.fromEntries(['uVideoA', 'uVideoB', 'uReady', 'uViewport', 'uDpr', 'uCell', 'uFishA', 'uFishB', 'uFishRotation', 'uPointer', 'uTime', 'uDistortion']
      .map(name => [name, gl.getUniformLocation(program, name)]));
    for (const clip of clips) {
      clip.texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + clip.index);
      gl.bindTexture(gl.TEXTURE_2D, clip.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(uniforms.uVideoA, 0);
    gl.uniform1i(uniforms.uVideoB, 1);
    canvas.addEventListener('webglcontextlost', contextLost);
    return true;
  }
  function fallback() {
    if (gl) {
      for (const clip of clips) if (clip.texture) gl.deleteTexture(clip.texture);
      if (program) gl.deleteProgram(program);
      const replacement = canvas.cloneNode(false);
      canvas.replaceWith(replacement);
      canvas = replacement;
      gl = null;
    }
    context = canvas.getContext('2d', { alpha: false });
    for (const clip of clips) {
      clip.sampler = document.createElement('canvas');
      clip.sampler.width = clip.sampler.height = 256;
      clip.sampleContext = clip.sampler.getContext('2d', { willReadFrequently: true });
      clip.uploaded = -1;
      clip.displayed = Boolean(clip.pixels);
    }
  }
  function contextLost(event) {
    event.preventDefault();
    if (!disposed) { fallback(); measure(); }
  }
  try { if (!initializeGL()) fallback(); } catch { fallback(); }
  if (!gl && (!context || clips.some(clip => !clip.sampleContext))) return { cleanup() {} };

  function measure() {
    resizeFrame = 0;
    if (disposed) return;
    const bounds = footer.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cell = clamp(width / 64, 5, 6.5);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const blend = clamp((1100 - width) / 340, 0, 1);
    const compact = blend * blend * (3 - 2 * blend);
    const mix = (wide, narrow) => wide + (narrow - wide) * compact;
    const edge = clamp(Math.min(width, height) * .022, 10, 24);
    const copyBounds = copy?.getBoundingClientRect();
    const copyTop = copyBounds ? copyBounds.top - bounds.top : height * .32;
    const copyBottom = copyBounds ? copyBounds.bottom - bounds.top : height * .68;
    const top = Math.max(edge, (header?.getBoundingClientRect().height || 0) + 8);
    const detailsTop = details?.getBoundingClientRect().top;
    const floor = Math.min(height - Math.max(edge, 32),
      Number.isFinite(detailsTop) ? detailsTop - bounds.top - 8 : height);
    // Text wrapping and footer labels must not change the fish's scale.
    const sceneHeight = parseFloat(getComputedStyle(footer).minHeight) || height;
    const swimmingHeight = Math.max(1, sceneHeight - 128);
    for (const clip of clips) {
      const { index, aspect, layoutCosine: cosine, layoutSine: sine, envelope: [x0, y0, x1, y1] } = clip;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const u of [x0, x1]) for (const v of [y0, y1]) {
        const x = (u - .5) * aspect, y = v - .5;
        const rx = cosine * x - sine * y, ry = sine * x + cosine * y;
        minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
        minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
      }
      // Keep one scale ceiling across layouts; only the positions blend.
      const sizeY = Math.min(
        Math.max(width, 1100) * .66 / ((x1 - x0) * aspect),
        swimmingHeight * .46 / (y1 - y0),
        width * 1.5 / aspect,
      );
      const wideX = index ? edge - minX * sizeY : width - edge - maxX * sizeY;
      const wideY = index ? floor - maxY * sizeY + clamp(height * .20, 112, 208) : top - minY * sizeY;
      const narrowY = index ? Math.min(copyBottom + height * .045, floor - sizeY * .45)
        : Math.max(top + sizeY * .16, copyTop - clamp(height * .10, 48, 100));
      anchors[index].set([
        mix(wideX, width * (index ? .28 : .70)),
        mix(wideY, narrowY),
        sizeY * aspect, sizeY,
      ]);
    }
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    else context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function nextWaypoint(fish) {
    fish.bearing += fish.direction * (1.1 + Math.random() * .5);
    const radius = .7 + Math.random() * .3;
    return [Math.cos(fish.bearing) * radius, Math.sin(fish.bearing) * radius];
  }

  function createSwim(angle, index) {
    const fish = { angle, x: 0, y: 0, elapsed: 0, duration: 10.5 + index * 2,
      bearing: index ? .5 : Math.PI, direction: index ? -1 : 1,
      pace: index ? .94 : 1, targetPace: index ? .94 : 1,
      paceRemaining: index ? 3.8 : 1.2, rateElapsed: 0 };
    const first = nextWaypoint(fish);
    // Start moving from the layout anchor instead of spending the opening seconds at rest.
    fish.points = [[-first[0], -first[1]], [0, 0], first, nextWaypoint(fish)];
    return fish;
  }

  function updatePace(clip, dt) {
    const fish = clip.swim;
    fish.paceRemaining -= dt;
    if (fish.paceRemaining <= 0) {
      fish.targetPace = .88 + Math.random() * .34;
      fish.paceRemaining = 7 + Math.random() * 6 + clip.index * .8;
      const other = clips[1 - clip.index];
      if (other.ready && !other.failed && !other.video.paused &&
          Number.isFinite(clip.video.duration) && clip.video.duration > 0 &&
          Number.isFinite(other.video.duration) && other.video.duration > 0) {
        const difference = clip.video.currentTime / clip.video.duration -
          other.video.currentTime / other.video.duration;
        const gap = difference - Math.round(difference);
        if (Math.abs(gap) < .12 && Math.abs(fish.targetPace - other.swim.pace) < .09) {
          // Separate similar poses with a gradual tempo change, never a frame seek.
          const direction = gap >= 0 ? 1 : -1;
          let target = other.swim.pace + direction * .12;
          if (target < .86 || target > 1.24) target = other.swim.pace - direction * .12;
          fish.targetPace = clamp(target, .86, 1.24);
        }
      }
    }
    fish.pace += (fish.targetPace - fish.pace) * (1 - Math.exp(-dt / 2));
    fish.rateElapsed += dt;
    if (fish.rateElapsed >= .1) {
      fish.rateElapsed %= .1;
      if (Math.abs(clip.video.playbackRate - fish.pace) >= .005) {
        clip.video.playbackRate = fish.pace;
      }
    }
  }

  function updateSwim(dt) {
    for (const clip of clips) {
      if (!clip.ready || clip.failed || clip.video.paused) continue;
      const fish = clip.swim;
      updatePace(clip, dt);
      fish.elapsed += dt * fish.pace;
      if (fish.elapsed >= fish.duration) {
        fish.elapsed -= fish.duration;
        fish.points.shift();
        fish.points.push(nextWaypoint(fish));
      }
      const t = fish.elapsed / fish.duration;
      const [p0, p1, p2, p3] = fish.points;
      let vx = 0, vy = 0;
      // Joined curves preserve velocity as each new wandering destination takes over.
      for (let axis = 0; axis < 2; axis++) {
        const a = -p0[axis] + p2[axis];
        const b = 2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis];
        const c = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
        const position = .5 * (2 * p1[axis] + t * (a + t * (b + t * c)));
        const velocity = .5 * (a + t * (2 * b + t * 3 * c));
        if (axis === 0) { fish.x = position; vx = velocity; }
        else { fish.y = position; vy = velocity; }
      }
      const forward = -clip.layoutCosine * vx - clip.layoutSine * vy;
      const cross = clip.layoutSine * vx - clip.layoutCosine * vy;
      const turn = Math.tanh(2.4 * cross / (.35 + Math.abs(forward) * .65));
      const range = (clip.index ? 28 : 34) * Math.PI / 180;
      const target = clip.baseAngle + turn * range;
      // Make the bend visible while limiting both its extent and its turning speed.
      const maxTurn = 12 * Math.PI / 180 * dt;
      fish.angle += clamp((target - fish.angle) * (1 - Math.exp(-dt * 2.2)), -maxTurn, maxTurn);
    }
  }

  function draw2D() {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    if (!motion.matches) waterField.update(width, height, waterTime, pointer.x, pointer.y);
    const reach = motion.matches ? 0 : height * .10;
    for (const clip of clips) {
      if (!clip.displayed || !clip.pixels) continue;
      const [cx, cy, sizeX, sizeY] = placements[clip.index];
      const { cosine, sine } = clip;
      const data = clip.pixels;
      const spanX = Math.abs(cosine) * sizeX + Math.abs(sine) * sizeY;
      const spanY = Math.abs(sine) * sizeX + Math.abs(cosine) * sizeY;
      const startX = (Math.ceil(Math.max(0, cx - spanX / 2 - reach) / cell - .5) + .5) * cell;
      const startY = (Math.ceil(Math.max(0, cy - spanY / 2 - reach) / cell - .5) + .5) * cell;
      const endX = Math.min(width, cx + spanX / 2 + reach), endY = Math.min(height, cy + spanY / 2 + reach);
      for (let y = startY; y < endY; y += cell) for (let x = startX; x < endX; x += cell) {
        if (motion.matches) waterOffset.fill(0);
        else waterField.sample(x, y, waterOffset);
        const rgb = [0, 0, 0];
        for (let channel = 0; channel < 3; channel++) {
          const spread = 1.125 - channel * .125;
          const deltaX = x + waterOffset[0] * spread - cx;
          const deltaY = y + waterOffset[1] * spread - cy;
          const u = (cosine * deltaX + sine * deltaY) / sizeX + .5;
          const v = (-sine * deltaX + cosine * deltaY) / sizeY + .5;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const px = clamp(u * 255, 0, 255), py = clamp(v * 255, 0, 255);
          const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const p = (Math.min(255, iy + dy) * 256 + Math.min(255, ix + dx)) * 4;
            rgb[channel] += data[p + channel] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          }
        }
        if (rgb[0] + rgb[1] + rgb[2] < .1) continue;
        context.fillStyle = `rgb(${rgb.map(value => 255 * (value / 255) ** .9).join(',')})`;
        context.beginPath();
        context.arc(x, y, cell * .35, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  function draw() {
    if (disposed || !width || !height) return;
    for (const clip of clips) {
      const placement = placements[clip.index];
      placement.set(anchors[clip.index]);
      placement[0] += clip.swim.x * clamp(width * .08, 26, 96);
      placement[1] += clip.swim.y * clamp(height * .072, 26, 68);
      clip.cosine = Math.cos(clip.swim.angle);
      clip.sine = Math.sin(clip.swim.angle);
    }
    try {
      for (const clip of clips) {
        const decoded = clip.frameEvents ? clip.decoded : Math.floor(clip.video.currentTime * 60);
        if (!clip.ready || clip.failed || clip.video.readyState < 2 || decoded === clip.uploaded) continue;
        if (gl) {
          gl.activeTexture(gl.TEXTURE0 + clip.index);
          gl.bindTexture(gl.TEXTURE_2D, clip.texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, clip.video);
        } else {
          clip.sampleContext.drawImage(clip.video, 0, 0, 256, 256);
          clip.pixels = clip.sampleContext.getImageData(0, 0, 256, 256).data;
        }
        clip.uploaded = decoded;
        clip.displayed = true;
      }
      if (!gl) { draw2D(); return; }
      gl.uniform2f(uniforms.uReady, clips[0].displayed ? 1 : 0, clips[1].displayed ? 1 : 0);
      gl.uniform2f(uniforms.uViewport, width, height);
      gl.uniform1f(uniforms.uDpr, dpr);
      gl.uniform1f(uniforms.uCell, cell);
      gl.uniform2f(uniforms.uPointer, pointer.x, pointer.y);
      gl.uniform1f(uniforms.uTime, waterTime);
      gl.uniform1f(uniforms.uDistortion, motion.matches ? 0 : 1);
      gl.uniform4fv(uniforms.uFishA, placements[0]);
      gl.uniform4fv(uniforms.uFishB, placements[1]);
      gl.uniform4f(uniforms.uFishRotation, clips[0].cosine, clips[0].sine, clips[1].cosine, clips[1].sine);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } catch {
      if (gl) { fallback(); measure(); }
    }
  }

  function active() { return !disposed && visible && !document.hidden && !motion.matches && clips.some(clip => clip.ready && !clip.failed); }
  function tick(now) {
    frame = 0;
    if (!active()) { lastTime = 0; return; }
    const dt = lastTime ? clamp((now - lastTime) / 1000, 0, .05) : 0;
    lastTime = now;
    waterTime += dt;
    updateSwim(dt);
    const follow = 1 - Math.pow(.75, dt * 60);
    pointer.x += (pointer.targetX - pointer.x) * follow;
    pointer.y += (pointer.targetY - pointer.y) * follow;
    if (gl || now - lastFallbackDraw >= 1000 / 24) {
      draw();
      lastFallbackDraw = now;
    }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    if (disposed) return;
    if (active()) {
      for (const clip of clips) if (clip.ready && !clip.failed && clip.video.paused) clip.video.play().catch(() => draw());
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      frame = lastTime = 0;
      for (const clip of clips) clip.video.pause();
      if (visible && !document.hidden) draw();
    }
  }
  function moved(event) {
    if (!active() || event.pointerType === 'touch') return;
    const bounds = footer.getBoundingClientRect();
    pointer.targetX = clamp((event.clientX - bounds.left) / width, 0, 1);
    pointer.targetY = clamp((event.clientY - bounds.top) / height, 0, 1);
  }
  function resized() { if (!disposed && !resizeFrame) resizeFrame = requestAnimationFrame(measure); }
  const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); sync(); });
  const resizeObserver = new ResizeObserver(resized);
  observer.observe(footer);
  for (const element of [footer, copy, header, details]) if (element) resizeObserver.observe(element);
  document.fonts?.ready.then(resized);
  window.addEventListener('resize', resized, { passive: true });
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  footer.addEventListener('pointermove', moved, { passive: true });
  measure();

  fetch('/images/footer-fish.json', { signal: request.signal })
    .then(response => { if (!response.ok) throw new Error('Fish bounds unavailable.'); return response.json(); })
    .then(data => {
      if (disposed) return;
      for (const clip of clips) {
        const bounds = data[clip.name]?.bounds;
        if (Array.isArray(bounds) && bounds.length === 4 &&
          bounds.every(value => Number.isFinite(value) && value >= 0 && value <= 1) &&
          bounds[2] > bounds[0] && bounds[3] > bounds[1]) clip.envelope = bounds;
      }
      measure();
    }).catch(() => {});
  for (const clip of clips) {
    clip.metadata = () => {
      if (disposed || clip.offsetApplied) return;
      clip.offsetApplied = true;
      clip.aspect = clip.video.videoWidth / clip.video.videoHeight || 1;
      if (Number.isFinite(clip.video.duration)) clip.video.currentTime = clip.video.duration * clip.phase;
      measure();
    };
    clip.loaded = () => {
      if (disposed || clip.failed) return;
      clip.ready = clip.ready || !clip.video.seeking;
      clip.uploaded = -1;
      draw();
      sync();
    };
    clip.error = () => { clip.failed = true; sync(); };
    clip.video.addEventListener('loadedmetadata', clip.metadata);
    clip.video.addEventListener('loadeddata', clip.loaded);
    clip.video.addEventListener('seeked', clip.loaded);
    clip.video.addEventListener('error', clip.error);
    clip.video.playbackRate = clip.rate;
    clip.video.src = `/images/footer-fish-${clip.name}.mp4`;
    clip.video.load();
    if (clip.frameEvents) {
      const decoded = () => {
        if (disposed) return;
        clip.decoded++;
        clip.frameRequest = clip.video.requestVideoFrameCallback(decoded);
      };
      clip.frameRequest = clip.video.requestVideoFrameCallback(decoded);
    }
  }
  return {
    cleanup() {
      disposed = true;
      request.abort();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', resized);
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      footer.removeEventListener('pointermove', moved);
      for (const clip of clips) {
        if (clip.frameRequest) clip.video.cancelVideoFrameCallback(clip.frameRequest);
        clip.video.removeEventListener('loadedmetadata', clip.metadata);
        clip.video.removeEventListener('loadeddata', clip.loaded);
        clip.video.removeEventListener('seeked', clip.loaded);
        clip.video.removeEventListener('error', clip.error);
        clip.video.pause();
        clip.video.removeAttribute('src');
        clip.video.load();
        if (gl) gl.deleteTexture(clip.texture);
      }
      glCanvas?.removeEventListener('webglcontextlost', contextLost);
      if (gl) { gl.deleteProgram(program); gl.clear(gl.COLOR_BUFFER_BIT); }
      else context?.clearRect(0, 0, width, height);
    },
  };
}
