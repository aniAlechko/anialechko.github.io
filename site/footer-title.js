const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function initFooterTitle() {
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
      const viewportHeight = Math.max(1, window.innerHeight);
      const remaining = clamp((footer.getBoundingClientRect().top - 4)
        / Math.max(1, viewportHeight - 4), 0, 1);
      const eased = remaining * remaining * (3 - 2 * remaining);
      shift = Math.min(window.innerWidth * .08, 100) * eased;
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
  render();

  return {
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      motionPreference?.removeEventListener('change', schedule);
      title.style.removeProperty('--footer-title-shift');
    },
  };
}
