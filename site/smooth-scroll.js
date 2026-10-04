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
  let lastWheelTime = 0;
  let strength = 0;
  let responseTime = 90;
  let route;
  let resizeFrame = 0;
  let resizePending = false;

  function restingTarget(value, sign = 0) {
    const bounded = clamp(value, maxScroll());
    if (!route || bounded > route.total) return bounded;
    let destination = Math.round(bounded / route.pitch) * route.pitch;
    // A small line-mode wheel delta must still move in its requested direction.
    if (sign > 0 && destination <= position + 0.4) {
      destination = (Math.floor(position / route.pitch) + 1) * route.pitch;
    }
    if (sign < 0 && destination >= position - 0.4) {
      destination = (Math.ceil(position / route.pitch) - 1) * route.pitch;
    }
    return clamp(destination, Math.min(route.total, maxScroll()));
  }

  function stop() {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(resizeFrame);
    frame = 0;
    resizeFrame = 0;
    resizePending = false;
    direction = 0;
    strength = 0;
    lastWheelTime = 0;
    position = target = ownScroll = window.scrollY;
  }

  function animate(time) {
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
    if (reducedMotion.matches || !event.cancelable || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY
      || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      stop();
      return;
    }
    const now = performance.now();
    const sign = Math.sign(event.deltaY);
    // Touchpads already provide momentum. Keep their continuous gestures native.
    const continuous = event.deltaMode === 0
      && (Math.abs(event.deltaY) < 40 || !Number.isInteger(event.deltaY) || now < nativeWheelUntil);
    if (continuous || nestedScrollCanMove(event, sign)) {
      if (continuous) nativeWheelUntil = now + 180;
      stop();
      return;
    }
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = event.deltaY * multiplier;
    if (!Number.isFinite(delta)) return;
    const maximum = maxScroll();
    if (!maximum) return;
    const interval = now - lastWheelTime;
    const continuing = frame && direction === sign && interval < 220;
    strength = continuing
      ? Math.min(1, strength * Math.exp(-interval / 260) + Math.abs(delta) / 480)
      : Math.min(1, Math.abs(delta) / 700);
    responseTime = 105 - 35 * strength;
    lastWheelTime = now;
    if (!frame || (direction && direction !== sign)) {
      position = target = ownScroll = window.scrollY;
    }
    // Strong bursts build speed and leave a few rungs of momentum, without
    // accumulating a long queue after the user releases the wheel.
    const onLadder = route && ((position >= 0 && position <= route.total)
      || (target >= 0 && target <= route.total));
    const lead = onLadder ? route.pitch * (3 + 3 * strength) : window.innerHeight * 0.4;
    const requested = target + delta * (1 + 0.9 * strength);
    const destination = restingTarget(Math.max(position - lead, Math.min(position + lead, requested)), sign);
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
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
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
    setRoute(value) {
      route = value;
      if (frame) target = restingTarget(target, direction);
    },
  };
  return currentController;
}
