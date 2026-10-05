const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function initFooterTitle({ subscribeLayout } = {}) {
  const footer = document.querySelector('#landing');
  const title = document.querySelector('#contact-title');
  if (!footer || !title) return { cleanup() {} };
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let disposed = false;
  let lastShift;

  function render() {
    frame = 0;
    if (disposed || document.hidden) return;
    let shift = 0;
    if (!motionPreference?.matches) {
      const bounds = footer.getBoundingClientRect();
      const viewportHeight = Math.max(1, parseFloat(getComputedStyle(footer).minHeight) || bounds.height);
      const remaining = clamp((bounds.top - 4)
        / Math.max(1, viewportHeight - 4), 0, 1);
      const eased = remaining * remaining * (3 - 2 * remaining);
      shift = Math.min(bounds.width * .08, 100) * eased;
    }
    const value = `${shift.toFixed(2)}px`;
    if (value === lastShift) return;
    title.style.setProperty('--footer-title-shift', value);
    lastShift = value;
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  motionPreference?.addEventListener('change', schedule);
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(footer);
  const copy = title.closest('.contact-copy');
  if (copy) resizeObserver.observe(copy);
  const unsubscribeLayout = typeof subscribeLayout === 'function'
    // Let other layout subscribers schedule their scene measurements first.
    ? subscribeLayout(() => queueMicrotask(schedule)) : null;
  render();

  return {
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      if (typeof unsubscribeLayout === 'function') unsubscribeLayout();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      motionPreference?.removeEventListener('change', schedule);
      title.style.removeProperty('--footer-title-shift');
    },
  };
}
