let currentController;

export function initSmoothScroll({ onInteraction = () => {}, getPullMotion = () => null } = {}) {
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
  let heldPull = null;
  let pullRelease = null;
  let lastAcceptedScroll = window.scrollY;
  let touchY = null;

  function pullMotion() {
    let motion;
    try { motion = getPullMotion(); } catch { return null; }
    return motion && Number.isFinite(motion.start) && Number.isFinite(motion.end)
      && motion.end > motion.start && typeof motion.ready === 'boolean' ? motion : null;
  }

  function crossesPull(motion, from, to) {
    return motion && to > from && from < motion.end && to > motion.start;
  }

  function releaseHold() {
    heldPull = null;
    page.classList.remove('is-fishing-scroll-held');
  }

  function holdAtStart(motion, destination) {
    const top = Math.floor(clamp(motion.start, maxScroll()));
    const continuing = heldPull?.start === motion.start && heldPull?.end === motion.end;
    if (!continuing) {
      heldPull = { start: motion.start, end: motion.end, top };
      pullRelease = null;
      responseTime = 160;
      page.classList.add('is-fishing-scroll-held');
      position = Math.min(window.scrollY, top);
    }
    // Additional input updates bounded intent, without restarting the approach
    // or replacing its fractional position with the browser's rounded scrollY.
    target = clamp(Math.min(motion.start + window.innerHeight * .12,
      Math.max(target, destination, motion.start)), maxScroll());
    if (window.scrollY > top) {
      position = top;
      window.scrollTo({ top, behavior: 'instant' });
    }
    ownScroll = lastAcceptedScroll = window.scrollY;
    direction = 1;
    if (!frame) {
      previousTime = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }

  function holdForward(destination, event, motion = pullMotion()) {
    if (reducedMotion.matches || !motion || motion.ready
      || (!heldPull && !crossesPull(motion, window.scrollY, destination))) return false;
    if (event?.cancelable) event.preventDefault();
    onInteraction();
    holdAtStart(motion, destination);
    return true;
  }

  function stop() {
    releaseHold();
    pullRelease = null;
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
    const pull = pullMotion();
    if (heldPull) {
      if (!pull || pull.ready || pull.start !== heldPull.start || pull.end !== heldPull.end) {
        pullRelease = pull?.ready && pull.start === heldPull.start && pull.end === heldPull.end
          ? { from: heldPull.top, start: time } : null;
        releaseHold();
      } else {
        position += (heldPull.top - position) * (1 - Math.exp(-elapsed / responseTime));
        if (Math.abs(heldPull.top - position) < .4) position = heldPull.top;
        window.scrollTo({ top: position, behavior: 'instant' });
        ownScroll = lastAcceptedScroll = window.scrollY;
        frame = requestAnimationFrame(animate);
        return;
      }
    }
    let destination = target;
    if (pullRelease) {
      // Reveal the saved destination gradually. At release the effective target
      // is still the holding point, so approaching motion and rest both join it.
      const progress = clamp((time - pullRelease.start) / 180, 1);
      const eased = progress * progress * (3 - 2 * progress);
      destination = pullRelease.from + (target - pullRelease.from) * eased;
      if (progress === 1) pullRelease = null;
    }
    const next = position + (destination - position) * (1 - Math.exp(-elapsed / responseTime));
    if (pull && !pull.ready && crossesPull(pull, position, next)) {
      holdAtStart(pull, target);
      return;
    }
    position = next;
    const held = pull && !pull.ready && crossesPull(pull, position, target);
    const finished = !held && Math.abs(target - position) < 0.4;
    if (finished) position = target;
    window.scrollTo({ top: position, behavior: 'instant' });
    ownScroll = lastAcceptedScroll = window.scrollY;
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
      if (!heldPull) stop();
      return;
    }
    const sign = Math.sign(event.deltaY);
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const delta = event.deltaY * multiplier;
    if (!Number.isFinite(delta)) return;
    const reversingHold = sign < 0 && heldPull !== null;
    if (reversingHold) stop();
    if (sign > 0 && holdForward(
      Math.max(window.scrollY, frame ? target : window.scrollY) + delta, event)) return;
    if (!event.cancelable) {
      if (!heldPull) stop();
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
      if (!heldPull) stop();
      return;
    }
    const maximum = maxScroll();
    if (!maximum) return;
    mouseWheelUntil = now + 180;
    nativeWheelUntil = 0;
    const reversing = reversingHold || (direction && direction !== sign);
    // One distance, response and queue limit throughout the document.
    responseTime = reversing ? 100 : 160;
    if (!frame || reversing) {
      if (reversing) pullRelease = null;
      position = target = ownScroll = window.scrollY;
    }
    const lead = window.innerHeight * .45;
    const destination = clamp(Math.max(position - lead,
      Math.min(position + lead, target + delta)), maximum);
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
    const scroll = window.scrollY;
    const pull = pullMotion();
    if (!resizePending && !reducedMotion.matches && pull && !pull.ready
      && scroll > lastAcceptedScroll && lastAcceptedScroll < pull.end && scroll > pull.start) {
      holdAtStart(pull, scroll);
      return;
    }
    if (heldPull && scroll < lastAcceptedScroll - .5) stop();
    lastAcceptedScroll = scroll;
    if (heldPull) return;
    if (!frame || Math.abs(window.scrollY - ownScroll) <= 1.5) return;
    if (resizePending) position = ownScroll = window.scrollY;
    else stop();
  }

  function resized() {
    if (heldPull) stop();
    pullRelease = null;
    lastAcceptedScroll = window.scrollY;
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
    const down = ['ArrowDown', 'PageDown', 'End'].includes(event.key)
      || (event.key === ' ' && !event.shiftKey);
    if (nestedScrollCanMove(event, down ? 1 : -1)) return;
    if (!down) { stop(); return; }
    const amount = event.key === 'End' ? maxScroll() - window.scrollY
      : event.key === 'ArrowDown' ? 40 : window.innerHeight * .9;
    if (!holdForward(Math.max(window.scrollY, frame ? target : window.scrollY) + amount, event)) stop();
  }

  function pointerStarted() {
    if (!heldPull) stop();
  }

  function touchStarted(event) {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    if (!heldPull) stop();
  }

  function touchMoved(event) {
    if (touchY === null || event.touches.length !== 1) return;
    const nextY = event.touches[0].clientY;
    const delta = touchY - nextY;
    touchY = nextY;
    if (event.defaultPrevented || nestedScrollCanMove(event, Math.sign(delta))) return;
    if (delta < 0 && heldPull) stop();
    else if (delta > 0) holdForward(Math.max(window.scrollY, frame ? target : window.scrollY) + delta, event);
  }

  function touchEnded() {
    touchY = null;
  }

  function cleanup() {
    stop();
    window.removeEventListener('wheel', wheel);
    window.removeEventListener('scroll', scrolled);
    window.removeEventListener('touchstart', touchStarted);
    window.removeEventListener('touchmove', touchMoved);
    window.removeEventListener('touchend', touchEnded);
    window.removeEventListener('touchcancel', touchEnded);
    window.removeEventListener('pointerdown', pointerStarted);
    window.removeEventListener('keydown', keyed);
    window.removeEventListener('resize', resized);
    window.removeEventListener('pageshow', stop);
    reducedMotion.removeEventListener('change', stop);
    currentController = undefined;
  }

  window.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('scroll', scrolled, { passive: true });
  window.addEventListener('touchstart', touchStarted, { passive: true });
  window.addEventListener('touchmove', touchMoved, { passive: false });
  window.addEventListener('touchend', touchEnded, { passive: true });
  window.addEventListener('touchcancel', touchEnded, { passive: true });
  window.addEventListener('pointerdown', pointerStarted, { passive: true });
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
