const originalCanvas = document.querySelector('#hero-field');

if (originalCanvas) {
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TAU = Math.PI * 2;
  const SETTLED_AMPLITUDE = 0.0935;
  const SETTLED_MIX = 0.73;
  // Matches the reference's .00625-radian step at a steady 60 rendered fps.
  const PHASE_SPEED = 0.375;
  const TRAIL_COUNT = 8;
  let canvas = originalCanvas;
  let gl = null;
  let fallbackContext = null;
  let texturePixels = null;
  let sourceTexture = null;
  let program = null;
  let buffer = null;
  const uniforms = {};
  let width = 1;
  let height = 1;
  let dpr = 1;
  let frame = 0;
  let resizeFrame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let introStart = null;
  let entryStarted = false;
  let entryRequested = document.documentElement.dataset.heroEntered === 'true';
  let ready = false;
  const trails = new Float32Array(TRAIL_COUNT * 4);
  const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 2048;
  sourceCanvas.height = 256;
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const easeQuart = (value) => value < 0.5 ? 8 * value ** 4 : 1 - (-2 * value + 2) ** 4 / 2;

  const vertexSource = `
    attribute vec2 aPosition;
    void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
  `;

  const fragmentSource = `
    precision highp float;
    uniform vec2 uSize;
    uniform float uDpr;
    uniform float uCell;
    uniform float uTime;
    uniform float uAmplitude;
    uniform float uMix;
    uniform float uScale;
    uniform float uReveal;
    uniform float uTrailStrength;
    uniform vec2 uMouse;
    uniform vec4 uTrails[8];
    uniform sampler2D uSource;
    const float PI = 3.14159265359;

    vec2 rotatePoint(vec2 p, float angle) {
      float c = cos(angle), s = sin(angle);
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    vec2 liquidCoordinates(vec2 uv) {
      float aspect = uSize.x / uSize.y;
      vec2 pivot = vec2(0.5) + (uMouse - 0.5) * 0.16;
      vec2 p = uv - pivot;
      p.x *= aspect;
      for (int i = 1; i <= 5; i++) {
        float stage = float(i);
        p = rotatePoint(p, stage * (2.0 * PI / 5.0));
        float frequency = stage * 4.95;
        p.x += uAmplitude * cos(frequency * p.y + uTime);
        p.y += uAmplitude * sin(frequency * p.x + uTime);
      }
      p.x /= aspect;
      return p + pivot;
    }

    vec2 pointerDisplacement(vec2 uv) {
      if (uTrailStrength < 0.00001) return vec2(0.0);
      vec2 displacement = vec2(0.0);
      float aspect = uSize.x / uSize.y;
      for (int i = 0; i < 8; i++) {
        vec2 distance = (uv - uTrails[i].xy) * vec2(aspect, 1.0);
        float falloff = exp(-dot(distance, distance) / 0.025);
        displacement += uTrails[i].zw * falloff;
      }
      return clamp(displacement, vec2(-0.09), vec2(0.09));
    }

    float graphic(vec2 uv) {
      vec2 local = (uv - 0.5) / (vec2(1.725, 0.47) * max(uScale, 0.0001)) + 0.5;
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return 0.0;
      return texture2D(uSource, local).r;
    }

    vec3 toneMap(vec3 color) {
      const float a = 1.6, d = 0.977, maximum = 8.0, midIn = 0.18, midOut = 0.267;
      float b = (-pow(midIn, a) + pow(maximum, a) * midOut)
        / ((pow(maximum, a * d) - pow(midIn, a * d)) * midOut);
      float c = (pow(maximum, a * d) * pow(midIn, a) - pow(maximum, a) * pow(midIn, a * d) * midOut)
        / ((pow(maximum, a * d) - pow(midIn, a * d)) * midOut);
      return pow(color, vec3(a)) / (pow(color, vec3(a * d)) * b + c);
    }

    vec3 surfaceColor(vec2 uv) {
      vec2 trail = pointerDisplacement(uv);
      vec2 displacedUv = uv - trail;
      vec2 delta = liquidCoordinates(displacedUv) - displacedUv;
      vec2 warped = displacedUv + delta * uMix;
      vec2 separation = delta * uMix * 0.125 + trail * 0.03;
      vec3 color = vec3(graphic(warped + separation), graphic(warped), graphic(warped - separation));
      float mid = (max(max(color.r, color.g), color.b) + min(min(color.r, color.g), color.b)) * 0.5;
      color = vec3(mid) + (color - mid) * 0.68;
      color = clamp(2.0 * (toneMap(color) - 0.5) + 0.5 + vec3(-0.01, 0.0, 0.01), 0.0, 1.0);
      color *= 0.75;
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(color, vec3(0.2, 0.114, 0.749) * luminance, 0.2);
    }

    void main() {
      vec2 cssPixel = gl_FragCoord.xy / uDpr;
      vec2 grid = cssPixel / uCell;
      float distance = length(fract(grid) - 0.5);
      float antialias = 0.65 / (uCell * uDpr);
      float dotMask = 1.0 - smoothstep(0.25 - antialias, 0.25 + antialias, distance);
      if (dotMask <= 0.001 || uReveal <= 0.001) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      // The underlying graphic moves; the fixed circular lattice never deforms.
      vec2 uv = (floor(grid) + 0.5) * uCell / uSize;
      gl_FragColor = vec4(surfaceColor(uv) * dotMask * uReveal, 1.0);
    }
  `;

  function buildSourceGraphic() {
    const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#000';
    context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    context.font = '700 200px "Neue Montreal Display", Inter, Arial, sans-serif';
    context.textBaseline = 'alphabetic';
    const word = 'BUILDING';
    const metrics = context.measureText(word);
    const ascent = metrics.actualBoundingBoxAscent || 150;
    const descent = metrics.actualBoundingBoxDescent || 0;
    const left = metrics.actualBoundingBoxLeft || 0;
    const textWidth = metrics.actualBoundingBoxRight + left || metrics.width;
    context.save();
    context.translate(5, 4);
    context.scale((sourceCanvas.width - 10) / textWidth, (sourceCanvas.height - 8) / (ascent + descent));
    context.fillStyle = '#fff';
    context.fillText(word, left, ascent);
    context.restore();
    texturePixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
  }

  function shader(type, source) {
    const compiled = gl.createShader(type);
    gl.shaderSource(compiled, source);
    gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(compiled);
      gl.deleteShader(compiled);
      throw new Error(message || 'Background shader could not compile.');
    }
    return compiled;
  }

  function markRenderer(renderer) {
    canvas.dataset.renderer = renderer;
    document.documentElement.dataset.backgroundRenderer = renderer;
  }

  function initializeWebGL() {
    gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
    });
    if (!gl) throw new Error('WebGL is unavailable.');
    const vertex = shader(gl.VERTEX_SHADER, vertexSource);
    const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['uSize', 'uDpr', 'uCell', 'uTime', 'uAmplitude', 'uMix', 'uScale', 'uReveal', 'uTrailStrength', 'uMouse', 'uSource', 'uTrails[0]']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    sourceTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniforms.uSource, 0);
    markRenderer('webgl');
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      useStaticFallback();
      resize();
    }, { once: true });
  }

  function useStaticFallback() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (gl && !gl.isContextLost()) {
      if (sourceTexture) gl.deleteTexture(sourceTexture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    }
    gl = null;
    // Context types cannot be changed on a canvas that already acquired WebGL.
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement);
    canvas = replacement;
    fallbackContext = canvas.getContext('2d', { alpha: false });
    markRenderer('fallback');
  }

  function sampleGraphic(x, y) {
    const localX = (x - 0.5) / 1.725 + 0.5;
    const localY = 1 - ((y - 0.5) / 0.47 + 0.5);
    if (localX < 0 || localX >= 1 || localY < 0 || localY >= 1) return 0;
    const pixel = (Math.floor(localY * sourceCanvas.height) * sourceCanvas.width + Math.floor(localX * sourceCanvas.width)) * 4;
    return texturePixels[pixel] / 255;
  }

  function drawStatic() {
    if (!fallbackContext || !texturePixels) return;
    const context = fallbackContext;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const cell = width < 600 ? 5 : 6.8;
    const aspect = width / height;
    for (let py = cell * 0.5; py < height; py += cell) {
      for (let px = cell * 0.5; px < width; px += cell) {
        const uvX = px / width;
        const uvY = 1 - py / height;
        let x = (uvX - 0.5) * aspect;
        let y = uvY - 0.5;
        for (let stage = 1; stage <= 5; stage++) {
          const angle = stage * TAU / 5;
          const nextX = x * Math.cos(angle) - y * Math.sin(angle);
          y = x * Math.sin(angle) + y * Math.cos(angle);
          x = nextX + SETTLED_AMPLITUDE * Math.cos(stage * 4.95 * y + 1.1);
          y += SETTLED_AMPLITUDE * Math.sin(stage * 4.95 * x + 1.1);
        }
        const dx = (x / aspect + 0.5 - uvX) * SETTLED_MIX;
        const dy = (y + 0.5 - uvY) * SETTLED_MIX;
        let r = sampleGraphic(uvX + dx * 1.125, uvY + dy * 1.125);
        let g = sampleGraphic(uvX + dx, uvY + dy);
        let b = sampleGraphic(uvX + dx * 0.875, uvY + dy * 0.875);
        if (r + g + b < 0.01) continue;
        const mid = (Math.max(r, g, b) + Math.min(r, g, b)) * 0.5;
        r = clamp((mid + (r - mid) * 0.68) * 1.6 - 0.3) * 0.75;
        g = clamp((mid + (g - mid) * 0.68) * 1.6 - 0.3) * 0.75;
        b = clamp((mid + (b - mid) * 0.68) * 1.6 - 0.3) * 0.75;
        const luminance = r * 0.299 + g * 0.587 + b * 0.114;
        const red = Math.round((r * 0.8 + luminance * 0.04) * 255);
        const green = Math.round((g * 0.8 + luminance * 0.023) * 255);
        const blue = Math.round((b * 0.8 + luminance * 0.15) * 255);
        context.fillStyle = 'rgb(' + red + ' ' + green + ' ' + blue + ')';
        context.beginPath();
        context.arc(px, py, cell * 0.25, 0, TAU);
        context.fill();
      }
    }
  }

  function render() {
    if (!ready) return;
    if (!gl) {
      drawStatic();
      return;
    }
    let amplitude = SETTLED_AMPLITUDE;
    let mix = SETTLED_MIX;
    let scale = 1;
    let reveal = 1;
    if (introStart !== null && !motionPreference.matches) {
      const age = elapsed - introStart;
      amplitude = 0.203 - (0.203 - SETTLED_AMPLITUDE) * easeQuart(clamp(age / 2));
      mix = 1 - (1 - SETTLED_MIX) * easeQuart(clamp(age));
      scale = easeQuart(clamp(age / 1.5));
      reveal = easeQuart(clamp(age));
      if (age >= 2) introStart = null;
    }
    gl.uniform2f(uniforms.uSize, width, height);
    gl.uniform1f(uniforms.uDpr, dpr);
    gl.uniform1f(uniforms.uCell, width < 600 ? 5 : 6.8);
    gl.uniform1f(uniforms.uTime, 1.1 + elapsed * PHASE_SPEED);
    gl.uniform1f(uniforms.uAmplitude, amplitude);
    gl.uniform1f(uniforms.uMix, mix);
    gl.uniform1f(uniforms.uScale, scale);
    gl.uniform1f(uniforms.uReveal, reveal);
    let trailStrength = 0;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      trailStrength += Math.abs(trails[i * 4 + 2]) + Math.abs(trails[i * 4 + 3]);
    }
    gl.uniform1f(uniforms.uTrailStrength, trailStrength);
    gl.uniform2f(uniforms.uMouse, pointer.x, pointer.y);
    gl.uniform4fv(uniforms['uTrails[0]'], trails);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    render();
  }

  function updatePointer(delta) {
    const ease = 1 - Math.exp(-delta * 5.5);
    const dx = (pointer.targetX - pointer.x) * ease;
    const dy = (pointer.targetY - pointer.y) * ease;
    pointer.x += dx;
    pointer.y += dy;
    const fade = Math.exp(-delta * 3.8);
    for (let i = 0; i < TRAIL_COUNT; i++) {
      trails[i * 4 + 2] *= fade;
      trails[i * 4 + 3] *= fade;
    }
    if (Math.abs(dx) + Math.abs(dy) > 0.00001) {
      trails.copyWithin(4, 0, trails.length - 4);
      trails[0] = pointer.x;
      trails[1] = pointer.y;
      trails[2] = clamp(dx * 1.8, -0.025, 0.025);
      trails[3] = clamp(dy * 1.8, -0.025, 0.025);
    }
  }

  function animate(time) {
    frame = requestAnimationFrame(animate);
    if (lastTime && time - lastTime < 1000 / 60 - 0.75) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.08) : 0;
    lastTime = time;
    elapsed += delta;
    updatePointer(delta);
    render();
  }

  function updatePlayback() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (!ready || document.hidden) return;
    if (motionPreference.matches) {
      elapsed = 0;
      introStart = null;
      pointer.x = pointer.targetX = 0.5;
      pointer.y = pointer.targetY = 0.5;
      trails.fill(0);
      render();
    } else if (gl) {
      frame = requestAnimationFrame(animate);
    } else {
      render();
    }
  }

  function startEntry() {
    entryRequested = true;
    if (!ready || entryStarted) return;
    entryStarted = true;
    if (document.documentElement.classList.contains('is-ready')
        || document.documentElement.classList.contains('skip-intro')) return;
    if (!motionPreference.matches && gl) {
      elapsed = 0;
      introStart = 0;
      lastTime = 0;
      render();
    }
  }

  document.addEventListener('hero:enter', startEntry);
  window.addEventListener('pointermove', (event) => {
    if (motionPreference.matches || !gl || event.pointerType === 'touch') return;
    pointer.targetX = event.clientX / width;
    pointer.targetY = 1 - event.clientY / height;
  }, { passive: true });
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resize);
  }, { passive: true });
  motionPreference.addEventListener('change', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);

  async function initialize() {
    try {
      await Promise.race([
        document.fonts.load('700 200px "Neue Montreal Display"'),
        new Promise((resolve) => setTimeout(resolve, 1800)),
      ]);
    } catch {
      // A local browser font can still supply the source graphic if font loading fails.
    }
    buildSourceGraphic();
    try {
      initializeWebGL();
    } catch {
      useStaticFallback();
    }
    ready = true;
    // A slow module must join a page that has already entered in its settled state.
    if (entryRequested || document.documentElement.dataset.heroEntered === 'true'
        || document.documentElement.classList.contains('is-ready')) {
      entryStarted = true;
    }
    resize();
    document.documentElement.dataset.backgroundReady = 'true';
    document.dispatchEvent(new CustomEvent('hero:background-ready', { detail: { renderer: gl ? 'webgl' : 'fallback' } }));
    updatePlayback();
    setTimeout(() => {
      if (!entryStarted && document.documentElement.classList.contains('is-ready')) {
        entryStarted = true;
      } else if (!entryStarted) {
        startEntry();
      }
    }, 3000);
  }

  initialize();
}
