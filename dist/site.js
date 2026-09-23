// Shared interactions for all portfolio pages.
// The decorative follower never replaces the native pointer.
export function initPage() {
  const listeners = new AbortController();
  let disposed = false;
  const on = (target, type, handler, options = {}) =>
    target?.addEventListener(type, handler, { ...options, signal: listeners.signal });
  // Tuning: spacing is in pixels; animation response times are in milliseconds.
  const followerOffset = { x: -8, y: 24 };
  const initialHorizonAngle = -Math.PI / 4;
  const spacing = 18, depthLimit = 48;
  const lateralLimit = 18, toneSteps = 12;
  const elementGravityScale = 0.07;
  const motionTiming = {
    follower: 65,
    reveal: 110,
    fabric: 120,
    horizonRise: 85,
    horizonFade: 180,
    horizonTurn: 120
  };
  const clamp = value => Math.max(0, Math.min(1, value));

  // Shared DOM and animation state.
  const root = document.documentElement;
  const layer = document.querySelector('.cursor-layer');
  const position = document.querySelector('.cursor-position');
  const disc = document.querySelector('.cursor-disc');
  const label = document.querySelector('.cursor-label');
  let followerGrowth = 0, mouseWellDepth = 0;
  const heroVideo = document.querySelector('.hero-video');
  const heroSound = document.querySelector('.hero-sound');
  const heroDemoNote = document.querySelector('.hero-demo-note');
  const mouseMode = matchMedia('(hover: hover) and (pointer: fine) and (forced-colors: none)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, frame = 0, previousTime = 0;
  let x = 0, y = 0, targetX = 0, targetY = 0;
  let pointerX = 0, pointerY = 0;
  let horizonEnergy = 0, horizonAngle = initialHorizonAngle, horizonAim = horizonAngle;
  const canvas = document.querySelector('.space-fabric');
  const lightSection = document.querySelector('.about');
  const context = canvas.getContext('2d');
  const gravityElements = document.querySelectorAll(
    '.placeholder, h1, h2:not(.feed-heading), .feed-heading > span, h3, main p, .navigation a, .resume-placeholder'
  );
  let fabricBounds = canvas.getBoundingClientRect();
  let lightBounds = lightSection?.getBoundingClientRect();
  let geometryDirty = true;
  let resizeDirty = false;
  let layoutDirty = false;
  let viewportWidth = innerWidth;
  let fabricWidth = 0, fabricHeight = 0, fabricScale = 0;
  let gridColumns = 0;
  let dots = [];

  // Native scroll drives a small set of transforms; the fabric shares their frame.
  const feedHeading = document.querySelector('.feed-heading');
  const feedLetters = [...(feedHeading?.children || [])];
  const fittedTitles = [...document.querySelectorAll('.section-title')].map(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return { element, range, signature: '' };
  });
  const gravityTextRange = document.createRange();
  const revealItems = [...document.querySelectorAll(
    '.work .section-title, .feed-item, .feed-detail-media, .feed-detail-copy, .about .section-title, .portrait, .bio, .contact-copy'
  )].map(element => ({ element, media: element.matches('.placeholder, .feed-item'), top: 0, progress: 1 }));
  const textReveals = [...document.querySelectorAll('.feed-intro p')].map(element => {
    const copy = element.textContent;
    const words = copy.trim().split(/\s+/).map(word => {
      const span = document.createElement('span');
      span.className = 'reveal-word';
      span.textContent = word;
      return span;
    });
    element.replaceChildren(...words.flatMap((word, index) => index ? [' ', word] : [word]));
    return { element, words, top: 0, progress: 1 };
  });
  const motionItems = [...revealItems, ...textReveals];
  const feedMotion = { progress: 1 };
  let feedTop = 0, feedStep = 0;

  // A compact disclosure menu; regular links remain available without JavaScript.
  const siteHeader = document.querySelector('.site-header');
  const navigation = document.querySelector('.navigation');
  const menuToggle = document.querySelector('.menu-toggle');
  const menuViewport = matchMedia('(width < 1024px)');
  let menuOpen = false;

  function setMenuOpen(open, restoreFocus = false) {
    menuOpen = open && menuViewport.matches;
    siteHeader.classList.toggle('menu-open', menuOpen);
    root.classList.toggle('navigation-open', menuOpen);
    menuToggle.setAttribute('aria-expanded', String(menuOpen));
    menuToggle.setAttribute('aria-label', menuOpen ? 'Close navigation' : 'Open navigation');
    if (restoreFocus) menuToggle.focus({ preventScroll: true });
    updateHover();
    geometryDirty = true;
    wake();
  }

  on(menuToggle, 'click', () => setMenuOpen(!menuOpen));
  on(document, 'keydown', event => {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault();
      setMenuOpen(false, true);
    }
  });
  on(document, 'pointerdown', event => {
    if (menuOpen && !siteHeader.contains(event.target)) setMenuOpen(false);
  });
  on(siteHeader, 'focusout', event => {
    if (menuOpen && event.relatedTarget && !siteHeader.contains(event.relatedTarget)) setMenuOpen(false);
  });
  on(navigation, 'click', event => {
    if (menuOpen && event.target.closest('a')) setMenuOpen(false);
  });
  on(menuViewport, 'change', () => {
    const focused = document.activeElement;
    setMenuOpen(false);
    if (menuViewport.matches && navigation.contains(focused)) menuToggle.focus({ preventScroll: true });
    else if (!menuViewport.matches && focused === menuToggle) navigation.querySelector('a').focus({ preventScroll: true });
  });
  on(window, 'hashchange', () => { if (menuOpen) setMenuOpen(false); });
  root.classList.add('menu-ready');

  // Keep company placeholders in one editable list; the clone only closes the loop.
  const companyMarquee = document.querySelector('.company-marquee');
  if (companyMarquee) {
    const logos = companyMarquee.querySelector('.company-logos');
    const duplicate = logos.cloneNode(true);
    duplicate.setAttribute('aria-hidden', 'true');
    logos.parentElement.append(duplicate);
    companyMarquee.classList.add('is-ready');
  }

  // Scroll reveals.
  function layoutTop(element) {
    let top = 0;
    for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
    return top;
  }

  function fitDisplayTitles() {
    // All display titles fill their width in the stacked layout.
    // Desktop fits explicitly full-width headings; other sizes stay shared.
    const updates = [];
    for (const item of fittedTitles) {
      if (!menuViewport.matches && !item.element.hasAttribute('data-fit-width')) {
        item.element.style.removeProperty('--fit-font-size');
        item.signature = '';
        continue;
      }
      const style = getComputedStyle(item.element);
      const width = parseFloat(style.width) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const currentSize = parseFloat(style.fontSize);
      const tracking = (parseFloat(style.letterSpacing) || 0) / currentSize;
      const signature = [width, item.element.textContent, style.fontFamily, style.fontWeight,
        style.fontVariationSettings, tracking.toFixed(5)].join('|');
      if (!width || item.signature === signature) continue;
      item.range.selectNodeContents(item.element);
      // Range includes glyph sidebearings and the final letter-spacing advance.
      const textWidth = item.range.getBoundingClientRect().width;
      if (!textWidth) continue;
      const fittedSize = currentSize * Math.max(1, width - 0.5) / textWidth;
      item.signature = signature;
      if (Math.abs(fittedSize - currentSize) > 0.05) updates.push([item.element, fittedSize]);
    }
    for (const [element, size] of updates) element.style.setProperty('--fit-font-size', `${size.toFixed(3)}px`);
  }

  function measureMotion() {
    // offsetTop ignores our transforms, so scroll progress cannot feed back into itself.
    for (const item of motionItems) item.top = layoutTop(item.element);
    if (feedHeading) {
      feedTop = layoutTop(feedHeading);
      feedStep = parseFloat(getComputedStyle(feedHeading).fontSize) * 0.2;
    }
  }

  function updateMotion(elapsed, snap = false) {
    if (reducedMotion.matches) return false;
    const viewportHeight = innerHeight;
    const scroll = scrollY;
    const ease = snap ? 1 : 1 - Math.exp(-elapsed / motionTiming.reveal);
    let moving = false;
    function approach(item, goal) {
      const previous = item.progress;
      item.progress += (goal - previous) * ease;
      if (Math.abs(goal - item.progress) < 0.0005) item.progress = goal;
      else moving = true;
      return snap || item.progress !== previous;
    }
    for (const item of revealItems) {
      const progress = clamp((viewportHeight * 0.94 - (item.top - scroll)) / (viewportHeight * 0.52));
      const goal = 1 - (1 - progress) ** 3;
      if (!approach(item, goal)) continue;
      const hidden = 1 - item.progress;
      const lift = item.media ? (menuViewport.matches ? 48 : 96) : 28;
      const scale = item.media ? 1 - hidden * 0.1 : 1;
      item.element.style.transform = hidden ? `translate3d(0, ${hidden * lift}px, 0) scale(${scale})` : '';
      item.element.style.opacity = item.media ? '' : `${0.15 + item.progress * 0.85}`;
      geometryDirty = true;
    }
    for (const item of textReveals) {
      const goal = clamp((viewportHeight * 0.90 - (item.top - scroll)) / (viewportHeight * 0.40));
      if (!approach(item, goal)) continue;
      item.words.forEach((word, index) => {
        const progress = clamp(item.progress * 1.65 - index / item.words.length * 0.65);
        word.style.opacity = `${0.12 + progress * 0.88}`;
        word.style.transform = progress < 1 ? `translateY(${(1 - progress) * 10}px)` : '';
      });
      geometryDirty = true;
    }
    if (!feedHeading) return moving;
    const rawFeed = clamp((viewportHeight * 0.82 - (feedTop - scroll)) / (viewportHeight * 0.56));
    const feedGoal = rawFeed * rawFeed * (3 - 2 * rawFeed);
    if (approach(feedMotion, feedGoal)) {
      feedLetters.forEach((letter, index) => {
        letter.style.transform = `translate3d(0, ${index * feedStep * feedMotion.progress}px, 0)`;
      });
      geometryDirty = true;
    }
    return moving;
  }

  function syncMotionPreference() {
    root.classList.toggle('motion-ready', !reducedMotion.matches);
    if (reducedMotion.matches) {
      for (const element of [...revealItems.map(item => item.element), ...feedLetters,
        ...textReveals.flatMap(item => item.words)]) {
        element.style.removeProperty('transform');
        element.style.removeProperty('opacity');
      }
    } else {
      measureMotion();
      updateMotion(0, true);
    }
    geometryDirty = true;
    wake();
  }

  // Fabric: cache element gravity, then combine it with the moving pointer well.
  function resetFabric() {
    mouseWellDepth = 0;
  }

  function measureFabric() {
    fabricBounds = canvas.getBoundingClientRect();
    lightBounds = lightSection?.getBoundingClientRect();
    const masses = [];
    for (const element of gravityElements) {
      const isPanel = element.matches('.placeholder');
      const isBox = isPanel || element.matches('.resume-placeholder');
      const isFeedLetter = element.matches('.feed-heading > span');
      const isHeading = isFeedLetter || element.matches('h1, h2');
      const isSmall = element.matches('h3, a, .resume-placeholder');
      let rect;
      if (isBox) rect = element.getBoundingClientRect();
      else {
        // Unite printed text only; nested block spans can include empty column space.
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNode, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        while ((textNode = walker.nextNode())) {
          if (!textNode.textContent.trim()) continue;
          gravityTextRange.selectNodeContents(textNode);
          for (const line of gravityTextRange.getClientRects()) {
            if (!line.width || !line.height) continue;
            left = Math.min(left, line.left);
            top = Math.min(top, line.top);
            right = Math.max(right, line.right);
            bottom = Math.max(bottom, line.bottom);
          }
        }
        if (left === Infinity) continue;
        rect = { left, top, right, bottom, width: right - left, height: bottom - top };
      }
      const reach = isPanel ? 210 : isHeading ? 160 : isSmall ? 120 : 115;
      const rx = rect.width / 2 + reach, ry = rect.height / 2 + reach * 0.85;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      if (!rect.width || !rect.height || cy + ry < -spacing || cx + rx < -spacing
        || cy - ry > fabricBounds.height + spacing || cx - rx > fabricBounds.width + spacing) continue;
      masses.push({ cx, cy, rx, ry,
        depth: elementGravityScale * (isPanel ? 42 : isFeedLetter ? 12 : isHeading ? 28 : isSmall ? 3 : 14) });
    }
    // Cache the height and its gradient; overlapping wells merge before projection.
    for (const dot of dots) {
      let height = 0, gx = 0, gy = 0;
      for (const mass of masses) {
        const vx = mass.cx - dot.x, vy = mass.cy - dot.y;
        const q = (vx / mass.rx) ** 2 + (vy / mass.ry) ** 2;
        if (q >= 1) continue;
        const rim = 1 - q;
        height += mass.depth * rim ** 3;
        const slope = 6 * mass.depth * rim ** 2;
        gx += slope * vx / mass.rx ** 2;
        gy += slope * vy / mass.ry ** 2;
      }
      dot.baseDepth = height;
      dot.baseGX = gx;
      dot.baseGY = gy;
    }
    geometryDirty = false;
  }

  function measureLayout() {
    fitDisplayTitles();
    measureMotion();
    geometryDirty = true;
  }

  function resizeFabric() {
    if (!context) return;
    fabricBounds = canvas.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (fabricBounds.width === fabricWidth && fabricBounds.height === fabricHeight && scale === fabricScale) return;
    fabricWidth = fabricBounds.width;
    fabricHeight = fabricBounds.height;
    fabricScale = scale;
    const pixelWidth = Math.round(fabricWidth * scale);
    const pixelHeight = Math.round(fabricHeight * scale);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    dots = [];
    const start = spacing / 2 - spacing * 2;
    gridColumns = Math.ceil((fabricBounds.width + spacing * 2 - start) / spacing);
    const rows = Math.ceil((fabricBounds.height + spacing * 2 - start) / spacing);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < gridColumns; column++) {
        const px = start + column * spacing, py = start + row * spacing;
        dots.push({ x: px, y: py, baseDepth: 0, baseGX: 0, baseGY: 0 });
      }
    }
    geometryDirty = true;
  }

  function drawFabric(elapsed) {
    if (!context || document.hidden) return false;
    const localX = x - fabricBounds.left, localY = y - fabricBounds.top;
    const hasMouseGravity = active && mouseMode.matches && !reducedMotion.matches
      && localX >= 0 && localX <= fabricBounds.width
      && localY >= 0 && localY <= fabricBounds.height;
    // Pull only the fabric. Merge the broad pointer well into the height field
    // before projecting it, so text and media keep their original appearance.
    const gravityRadius = 190 + followerGrowth * 110;
    const depthGoal = hasMouseGravity ? 30 + followerGrowth * 40 : 0;
    mouseWellDepth += (depthGoal - mouseWellDepth) * (1 - Math.exp(-elapsed / motionTiming.fabric));
    const unsettled = Math.abs(depthGoal - mouseWellDepth) > 0.02;
    if (!unsettled) mouseWellDepth = depthGoal;
    context.clearRect(0, 0, fabricBounds.width, fabricBounds.height);
    const brightDots = Array.from({ length: toneSteps }, () => new Path2D());
    const darkDots = Array.from({ length: toneSteps }, () => new Path2D());
    for (const dot of dots) {
      const vx = localX - dot.x, vy = localY - dot.y;
      const q = (vx * vx + vy * vy) / (gravityRadius * gravityRadius);
      const rim = Math.max(0, 1 - q);
      const mouseDepth = mouseWellDepth * rim ** 3;
      const mouseSlope = 6 * mouseWellDepth * rim ** 2 / (gravityRadius * gravityRadius);
      const attenuation = Math.exp(-(dot.baseDepth + mouseDepth) / depthLimit);
      const depth = 1 - attenuation;
      const gx = (dot.baseGX + mouseSlope * vx) * attenuation;
      const gy = (dot.baseGY + mouseSlope * vy) * attenuation;
      const gradient = Math.hypot(gx, gy);
      const shift = lateralLimit * Math.tanh(gradient * 100 / lateralLimit);
      const scale = gradient > 0.00001 ? shift / gradient : 0;
      const px = dot.x + gx * scale;
      const py = dot.y + gy * scale + depth * 7;
      dot.px = px;
      dot.py = py;
      dot.onLight = Boolean(lightBounds && py >= lightBounds.top && py <= lightBounds.bottom);
      dot.thread = clamp((gradient - 0.025) / 0.11);

      // A soft upper-left light makes the slope legible, with a dimmer well floor.
      const highlight = Math.max(-0.035, Math.min(0.035, (-gx - gy) * 0.18));
      const alpha = Math.max(0.10, Math.min(0.20,
        0.15 + highlight + Math.min(0.02, gradient * 0.12) - depth * 0.025));
      const tone = Math.round((alpha - 0.10) / 0.10 * (toneSteps - 1));
      const radius = 0.76 * (1 - depth * 0.08);
      const path = (dot.onLight ? darkDots : brightDots)[tone];
      path.moveTo(px + radius, py);
      path.arc(px, py, radius, 0, Math.PI * 2);
    }
    // Whisper-thin threads appear only where the surface slopes; flat areas stay dotted.
    const brightThreads = Array.from({ length: 6 }, () => new Path2D());
    const darkThreads = Array.from({ length: 6 }, () => new Path2D());
    function connect(a, b) {
      const strength = Math.min(a.thread, b.thread);
      if (strength < 0.02 || a.onLight !== b.onLight) return;
      const path = (a.onLight ? darkThreads : brightThreads)[Math.min(5, Math.floor(strength * 6))];
      path.moveTo(a.px, a.py);
      path.lineTo(b.px, b.py);
    }
    for (let index = 0; index < dots.length; index++) {
      if (index % gridColumns < gridColumns - 1) connect(dots[index], dots[index + 1]);
      if (index + gridColumns < dots.length) connect(dots[index], dots[index + gridColumns]);
    }
    context.lineWidth = 0.6;
    for (let tone = 0; tone < 6; tone++) {
      const alpha = 0.008 + tone / 5 * 0.036;
      context.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      context.stroke(brightThreads[tone]);
      context.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.86})`;
      context.stroke(darkThreads[tone]);
    }
    for (let tone = 0; tone < toneSteps; tone++) {
      const alpha = 0.10 + tone / (toneSteps - 1) * 0.10;
      context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      context.fill(brightDots[tone]);
      context.fillStyle = `rgba(0, 0, 0, ${alpha * 0.86})`;
      context.fill(darkDots[tone]);
    }
    return unsettled;
  }

  // Follower position, event-horizon glow and contextual hover icons.
  function paintFollower() {
    position.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function resetHorizon() {
    horizonEnergy = 0;
    horizonAngle = horizonAim = initialHorizonAngle;
    for (const property of ['--horizon-bloom', '--horizon-glow', '--horizon-angle']) {
      disc.style.removeProperty(property);
    }
  }

  function updateHorizon(elapsed) {
    if (!active || reducedMotion.matches) return false;
    const dx = targetX - x, dy = targetY - y;
    const lag = Math.hypot(dx, dy);
    const goal = Math.min(1, lag / 70);
    if (lag > 2) horizonAim = Math.atan2(dy, dx);
    const previousEnergy = horizonEnergy, previousAngle = horizonAngle;
    const response = goal > horizonEnergy ? motionTiming.horizonRise : motionTiming.horizonFade;
    horizonEnergy += (goal - horizonEnergy) * (1 - Math.exp(-elapsed / response));
    if (Math.abs(goal - horizonEnergy) < 0.002) horizonEnergy = goal;
    // Follow the shortest arc, so crossing left never causes a full rotation.
    const turn = Math.atan2(Math.sin(horizonAim - horizonAngle), Math.cos(horizonAim - horizonAngle));
    horizonAngle += turn * (1 - Math.exp(-elapsed / motionTiming.horizonTurn));
    if (Math.abs(turn) < 0.002) horizonAngle = horizonAim;
    if (previousEnergy !== horizonEnergy || previousAngle !== horizonAngle) {
      disc.style.setProperty('--horizon-bloom', `${(horizonEnergy * 0.35).toFixed(3)}px`);
      disc.style.setProperty('--horizon-glow', (0.3 + horizonEnergy * 0.2).toFixed(3));
      disc.style.setProperty('--horizon-angle', `${(horizonAngle * 180 / Math.PI + 90).toFixed(2)}deg`);
    }
    // Glow completes its short decay before the shared animation loop sleeps.
    return horizonEnergy !== goal || Math.abs(turn) >= 0.002;
  }

  function updateHover() {
    if (!active) return;
    // Hover belongs to the real pointer, not the offset decorative follower.
    const hoveredElement = document.elementFromPoint(pointerX, pointerY);
    // Navigation keeps the ordinary follower, including the expanded menu.
    const target = siteHeader.contains(hoveredElement) ? null : hoveredElement;
    const project = target?.closest('[data-cursor-label]');
    const mode = target?.closest('.hero-sound') ? 'sound' : target?.closest('.feed-open') ? 'feed' : project ? 'project' : target?.closest('a, button') ? 'link' : 'default';
    const text = project ? project.dataset.cursorLabel : mode === 'link' ? (target.closest('[data-cursor-arrow]')?.dataset.cursorArrow || '↗') : '';
    if (layer.dataset.mode !== mode) layer.dataset.mode = mode;
    if (label.textContent !== text) label.textContent = text;
  }

  // One animation loop serves all effects and sleeps once they have settled.
  function wake() {
    if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(animate);
  }

  function animate(time) {
    if (disposed) return;
    if (layoutDirty) { layoutDirty = false; measureLayout(); }
    if (resizeDirty) { resizeDirty = false; resizeFabric(); }
    const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
    previousTime = time;
    const scrollMotion = updateMotion(elapsed);
    if (geometryDirty) measureFabric();
    const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed / motionTiming.follower);
    x += (targetX - x) * ease;
    y += (targetY - y) * ease;
    const cursorSettled = Math.hypot(targetX - x, targetY - y) < 0.1;
    if (cursorSettled) {
      x = targetX;
      y = targetY;
    }
    paintFollower();
    const horizonMoving = updateHorizon(elapsed);
    const fabricMoving = drawFabric(elapsed);
    if (cursorSettled && !horizonMoving && !fabricMoving && !scrollMotion) {
      frame = 0;
      previousTime = 0;
    } else {
      frame = requestAnimationFrame(animate);
    }
  }

  function hide() {
    active = false;
    resetHorizon();
    root.classList.remove('has-custom-cursor');
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    layer.dataset.mode = 'default';
    label.textContent = '';
    if (document.hidden) resetFabric();
    else wake();
  }

  // Pointer, viewport and accessibility changes wake or suspend that same loop.
  on(document, 'pointermove', event => {
    if (event.pointerType !== 'mouse' || !mouseMode.matches) {
      hide();
      return;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
    targetX = pointerX + followerOffset.x;
    targetY = pointerY + followerOffset.y;
    if (!active || reducedMotion.matches) {
      x = targetX;
      y = targetY;
      paintFollower();
    }
    active = true;
    updateHover();
    root.classList.add('has-custom-cursor');
    wake();
  }, { passive: true });
  // Scroll can change the hovered item even while the mouse stays still.
  on(window, 'scroll', () => {
    updateHover();
    geometryDirty = true;
    wake();
  }, { passive: true });
  on(window, 'resize', () => {
    // Mobile browser controls change height during scroll without changing layout width.
    if (innerWidth !== viewportWidth) {
      viewportWidth = innerWidth;
      layoutDirty = true;
    }
    resizeDirty = true;
    geometryDirty = true;
    hide();
  });
  on(window, 'blur', hide);
  on(document.documentElement, 'pointerleave', hide);
  on(document, 'pointercancel', hide);
  on(document, 'keydown', hide);
  on(document, 'pointerdown', event => {
    if (event.pointerType !== 'mouse') hide();
  }, { passive: true });
  on(document, 'visibilitychange', () => {
    if (document.hidden) hide();
    else { geometryDirty = true; wake(); }
  });
  on(mouseMode, 'change', hide);
  on(reducedMotion, 'change', () => { syncMotionPreference(); resetHorizon(); resetFabric(); wake(); });

  // The icon represents the next action; video.muted is the single source of truth.
  function syncHeroSound() {
    const ready = heroVideo.readyState >= 2;
    heroVideo.hidden = !ready;
    heroVideo.parentElement.classList.toggle('has-video', ready);
    heroSound.dataset.muted = String(heroVideo.muted);
    heroSound.setAttribute('aria-label', `${heroVideo.muted ? 'Unmute' : 'Mute'} video${ready ? '' : ' demo'}`);
    if (ready) heroSound.removeAttribute('aria-describedby');
    else heroSound.setAttribute('aria-describedby', 'hero-demo-note');
    heroDemoNote.textContent = `Sound ${heroVideo.muted ? 'off' : 'on'} demo · no video yet`;
    layer.dataset.sound = heroVideo.muted ? 'unmute' : 'mute';
    updateHover();
    wake();
  }
  on(heroSound, 'click', () => {
    heroVideo.muted = !heroVideo.muted;
    if (heroVideo.readyState >= 2 && heroVideo.paused) heroVideo.play().catch(() => {});
    syncHeroSound();
  });
  on(heroVideo, 'volumechange', syncHeroSound);
  on(heroVideo, 'loadeddata', () => {
    syncHeroSound();
    if (!reducedMotion.matches) heroVideo.play().catch(() => {});
  });
  on(heroVideo, 'emptied', syncHeroSound);
  on(heroVideo, 'error', syncHeroSound);
  // Initialise the optional hero, then the shared effects on every route.
  if (heroVideo && heroSound) syncHeroSound();
  measureLayout();
  syncMotionPreference();
  const discObserver = new ResizeObserver(([entry]) => {
    if (disposed) return;
    const diameter = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width + 2;
    followerGrowth = clamp((diameter - 16) / (96 - 16));
    wake();
  });
  discObserver.observe(disc, { box: 'border-box' });
  let observedWidth, observedHeight;
  const layoutObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width === observedWidth && height === observedHeight) return;
    observedWidth = width;
    observedHeight = height;
    // Content changes still need fresh geometry, independently of viewport height.
    layoutDirty = true;
    resizeDirty = true;
    wake();
  });
  layoutObserver.observe(root);
  document.fonts.ready.then(() => {
    if (disposed) return;
    for (const title of fittedTitles) title.signature = '';
    layoutDirty = true;
    wake();
  });
  resizeFabric();
  measureFabric();
  drawFabric(0);
  wake();
  return () => {
    disposed = true;
    listeners.abort();
    discObserver.disconnect();
    layoutObserver.disconnect();
    cancelAnimationFrame(frame);
    heroVideo?.pause();
    root.classList.remove('has-custom-cursor', 'menu-ready', 'motion-ready', 'navigation-open');
  };
}
