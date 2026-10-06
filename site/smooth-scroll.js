let currentController;

export function initSmoothScroll({ onInteraction = () => {} } = {}) {
  if (currentController) return currentController;
  const page = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const maxScroll = () => Math.max(0, page.scrollHeight - window.innerHeight);
  let frame = 0;
  let position = window.scrollY;
  let target = position;
  let ownScroll = position;
  let previousTime = 0;
  let direction = 0;
  let nativeWheelUntil = 0;
  let mouseWheelUntil = 0;
  let responseTime = 160;
  let resizeFrame = 0;
  let resizePending = false;

  function stop() {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    frame = 0;
    resizeFrame = 0;
    resizePending = false;
    direction = 0;
    mouseWheelUntil = 0;
    position = target = ownScroll = window.scrollY;
  }

  function animate(time) {
    frame = 0;
    // Keep fractional progress; reading rounded scrollY each frame would stall
    // the last few pixels of the ease-out.
    const elapsed = Math.min(50, Math.max(0, time - previousTime));
    previousTime = time;
    if (resizePending && Math.abs(window.scrollY - ownScroll) > 1.5) {
      position = ownScroll = window.scrollY;
    }
    target = clamp(target, maxScroll());
    position += (target - position) * (1 - Math.exp(-elapsed / responseTime));
    const finished = Math.abs(target - position) < 0.4;
    if (finished) position = target;
    window.scrollTo({ top: position, behavior: 'instant' });
    ownScroll = window.scrollY;
    if (finished) stop();
    else frame = requestAnimationFrame(animate);
  }

  function nestedScrollCanMove(event, sign) {
    return event.composedPath().some(element => {
      if (!(element instanceof HTMLElement) || element === document.body || element === page) return false;
      if (!/(auto|scroll)/.test(getComputedStyle(element).overflowY)) return false;
      return sign < 0 ? element.scrollTop > 0
        : element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    });
  }

  function wheel(event) {
    if (reducedMotion.matches) { stop(); return; }
    const vertical = !event.defaultPrevented
      && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.deltaY
      && Math.abs(event.deltaX) < Math.abs(event.deltaY);
    if (!vertical || nestedScrollCanMove(event, Math.sign(event.deltaY))) {
      stop();
      return;
    }
    const sign = Math.sign(event.deltaY);
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = event.deltaY * multiplier;
    if (!Number.isFinite(delta)) return;
    if (!event.cancelable) {
      stop();
      return;
    }
    const now = performance.now();
    // Keep the input mode stable within a gesture. High-resolution mouse wheels
    // can report fractional values or smaller deltas after the first notch.
    const continuous = event.deltaMode === 0
      && now >= mouseWheelUntil
      && (Math.abs(event.deltaY) < 40 || !Number.isInteger(event.deltaY) || now < nativeWheelUntil);
    if (continuous) {
      nativeWheelUntil = now + 180;
      stop();
      return;
    }
    const maximum = maxScroll();
    if (!maximum) return;
    mouseWheelUntil = now + 180;
    nativeWheelUntil = 0;
    const reversing = direction && direction !== sign;
    // Ease the full wheel distance, without capping a strong gesture or waiting
    // for scene animations. Touch and continuous trackpad momentum stay native.
    responseTime = reversing ? 100 : 160;
    if (!frame || reversing) {
      position = target = ownScroll = window.scrollY;
    }
    const destination = clamp(target + delta, maximum);
    if (!frame && Math.abs(destination - position) < 0.4) return;
    event.preventDefault();
    onInteraction();
    target = destination;
    direction = sign;
    if (!frame) {
      previousTime = now;
      frame = requestAnimationFrame(animate);
    }
  }

  function scrolled() {
    if (!frame || Math.abs(window.scrollY - ownScroll) <= 1.5) return;
    if (resizePending) position = ownScroll = window.scrollY;
    else stop();
  }

  function resized() {
    position = ownScroll = window.scrollY;
    if (!frame) {
      target = position;
      return;
    }
    // Keep wheel momentum while the ladder lays out its new rung positions.
    // Browser anchoring can follow reflow after the resize event has returned.
    resizePending = true;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resizePending = false;
      });
    });
  }

  function keyed(event) {
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
      || event.composedPath().some(element => element instanceof HTMLElement
        && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(element.tagName)))) return;
    stop();
  }

  function cleanup() {
    stop();
    window.removeEventListener('wheel', wheel);
    window.removeEventListener('scroll', scrolled);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('pointerdown', stop);
    window.removeEventListener('keydown', keyed);
    window.removeEventListener('resize', resized);
    window.removeEventListener('pageshow', stop);
    reducedMotion.removeEventListener('change', stop);
    currentController = undefined;
  }

  window.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('scroll', scrolled, { passive: true });
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('pointerdown', stop, { passive: true });
  window.addEventListener('keydown', keyed);
  window.addEventListener('resize', resized, { passive: true });
  window.addEventListener('pageshow', stop);
  reducedMotion.addEventListener('change', stop);
  currentController = {
    destroy: cleanup,
    getTarget: () => frame ? target : null,
  };
  return currentController;
}
