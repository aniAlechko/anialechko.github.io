export function initFooterActions() {
  const actions = document.querySelector('.contact-actions');
  const links = actions ? [...actions.querySelectorAll('.contact-link')] : [];
  if (links.length !== 2) return { cleanup() {} };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let measureFrame = 0;
  let animationFrame = 0;
  let layout;
  let progress;
  let transition;
  let disposed = false;
  const duration = 360;
  const mix = (from, to, amount) => from + (to - from) * amount;
  const ease = (start, end, value) => {
    const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
    return t * t * (3 - 2 * t);
  };

  function displayedProgress(time) {
    if (!transition) return progress;
    const elapsed = (time - transition.start) / duration;
    progress = mix(transition.from, transition.to, ease(0, 1, elapsed));
    if (elapsed >= 1) { progress = transition.to; transition = undefined; }
    return progress;
  }
  function stopTransition() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    transition = undefined;
  }
  function render() {
    const { width, ratio, gap, height } = layout;
    const firstWidth = Math.max(0, width - gap) * ratio / (ratio + 1);
    const secondWidth = Math.max(0, width - gap - firstWidth);
    // Make room vertically before the outlines move across one another.
    const vertical = ease(0, .52, progress);
    const horizontal = ease(.44, 1, progress);
    actions.classList.add('has-layout');
    actions.style.height = `${height + (height + gap) * vertical}px`;
    links.forEach((link, index) => {
      link.style.left = `${index ? (firstWidth + gap) * (1 - horizontal) : 0}px`;
      link.style.top = `${index ? (height + gap) * vertical : 0}px`;
      link.style.width = `${mix(index ? secondWidth : firstWidth, width, horizontal)}px`;
    });
  }
  function animate(time) {
    animationFrame = 0;
    if (disposed) return;
    displayedProgress(time);
    render();
    if (transition) animationFrame = requestAnimationFrame(animate);
  }

  function measure() {
    measureFrame = 0;
    if (disposed) return;
    const style = getComputedStyle(actions);
    const stacked = style.gridTemplateColumns.trim().split(/\s+/).length === 1;
    const gap = parseFloat(style.rowGap);
    const height = Math.max(...links.map(link => parseFloat(getComputedStyle(link).minHeight)));
    const bounds = actions.getBoundingClientRect();
    const width = bounds.width;
    const ratio = parseFloat(style.getPropertyValue('--contact-work-column'));
    const signature = [width, ratio, gap, height, stacked].join(',');
    if (layout?.signature === signature) return;
    const time = performance.now();
    const current = displayedProgress(time);
    const destination = transition?.to ?? progress;
    const next = stacked ? 1 : 0;
    layout = { width, ratio, gap, height, stacked, signature };
    const visible = bounds.bottom > 0 && bounds.top < window.innerHeight;
    if (current === undefined || !visible || motion.matches) {
      stopTransition();
      progress = next;
    } else if (destination !== next) {
      transition = { from: current, to: next, start: time };
    }
    render();
    if (transition && !animationFrame) animationFrame = requestAnimationFrame(animate);
  }

  function schedule() {
    if (!disposed && !measureFrame) measureFrame = requestAnimationFrame(measure);
  }
  function motionChanged() {
    if (motion.matches && layout) {
      stopTransition();
      progress = layout.stacked ? 1 : 0;
      render();
    }
  }
  measure();
  const observer = new ResizeObserver(schedule);
  observer.observe(actions);
  window.addEventListener('resize', schedule, { passive: true });
  motion.addEventListener('change', motionChanged);
  return {
    cleanup() {
      disposed = true;
      cancelAnimationFrame(measureFrame);
      stopTransition();
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      motion.removeEventListener('change', motionChanged);
      actions.classList.remove('has-layout');
      actions.style.removeProperty('height');
      for (const link of links) {
        for (const property of ['left', 'top', 'width']) link.style.removeProperty(property);
      }
    },
  };
}
