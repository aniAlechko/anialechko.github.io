export function initGarden() {
  const garden = document.querySelector('.garden-scene');
  const daylight = document.querySelector('.garden-daylight');
  const journey = document.querySelector('.journey');
  const hero = document.querySelector('.hero');
  if (!garden || !daylight || !journey || !hero) return { setRoute() {}, cleanup() {} };
  const statementLines = [...document.querySelectorAll('.statement-line-text')];
  const statementStage = document.querySelector('#statement-stage');
  const descent = document.querySelector('#descent-scene');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const lineReveals = [];
  let statementVisible = false;
  let statementAnimations = [];

  let route;
  let ready = false;
  let frame = 0;
  let disposed = false;
  let gardenTop = 0;
  let gardenHeight = 0;
  let holdDistance = 0;
  let lastTop;
  let lastPlaying;

  function setLineReveal(value) {
    statementLines.forEach((line, index) => {
      if (lineReveals[index] === value) return;
      line.style.setProperty('--line-reveal', value);
      lineReveals[index] = value;
    });
  }

  function cancelStatementAnimations() {
    for (const animation of statementAnimations) animation.cancel();
    statementAnimations = [];
  }

  function resetStatement() {
    cancelStatementAnimations();
    if (statementVisible) garden.classList.remove('is-statement-visible');
    statementVisible = false;
    setLineReveal('0');
  }

  function revealStatement(animate) {
    if (statementVisible) return;
    statementVisible = true;
    garden.classList.add('is-statement-visible');
    setLineReveal('1');
    if (!animate || motionPreference.matches) return;
    statementAnimations = statementLines.map(line => line.animate([
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: 620,
      easing: 'cubic-bezier(.22,1,.36,1)',
      fill: 'both',
    }));
  }

  function render() {
    frame = 0;
    if (disposed || !ready) return;
    const scroll = Math.max(0, window.scrollY);
    const hold = route ? Math.max(0, Math.min(holdDistance, scroll - route.total)) : 0;
    if (!route || motionPreference.matches) {
      cancelStatementAnimations();
      revealStatement(false);
    } else if (scroll <= .5) resetStatement();
    else if (!statementVisible && (descent ? descent.dataset.state === 'landed' : scroll >= route.total)) {
      revealStatement(true);
    }
    const playing = !document.hidden && scroll + window.innerHeight > gardenTop + hold
      && scroll < gardenTop + hold + gardenHeight ? 'running' : 'paused';
    if (playing !== lastPlaying) {
      garden.style.setProperty('--garden-play-state', playing);
      lastPlaying = playing;
    }
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  function motionChanged() {
    if (motionPreference.matches) cancelStatementAnimations();
    schedule();
  }
  function measure() {
    if (!ready) return;
    const heroHeight = route?.heroHeight || hero.getBoundingClientRect().height;
    gardenHeight = Math.max(heroHeight, route?.arrivalBottom || 0);
    holdDistance = route && statementStage ? heroHeight : 0;
    if (statementStage) statementStage.style.height = `${holdDistance}px`;
    journey.style.setProperty('--scene-hold-distance', `${holdDistance}px`);
    journey.style.setProperty('--scene-pin-top', `${route ? -route.total : 0}px`);
    garden.style.height = `${gardenHeight}px`;
    garden.style.top = route ? `${heroHeight}px` : '0px';
    if (Number.isFinite(route?.landedActorTop)) {
      garden.style.setProperty('--garden-character-top', `${route.landedActorTop}px`);
    } else garden.style.removeProperty('--garden-character-top');
    gardenTop = route ? heroHeight : garden.getBoundingClientRect().top + window.scrollY;
    const top = `${gardenTop.toFixed(2)}px`;
    if (top !== lastTop) {
      daylight.style.top = top;
      lastTop = top;
    }
    schedule();
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  motionPreference.addEventListener('change', motionChanged);
  const descentObserver = descent ? new MutationObserver(schedule) : null;
  descentObserver?.observe(descent, { attributes: true, attributeFilter: ['data-state'] });

  return {
    getHoldDistance: () => disposed ? 0 : holdDistance,
    setRoute(nextRoute) {
      if (disposed) return;
      route = Number.isFinite(nextRoute?.total) && nextRoute.total > 0 ? nextRoute : null;
      ready = true;
      journey.classList.toggle('has-static-garden', !route);
      garden.hidden = false;
      daylight.hidden = false;
      measure();
      cancelAnimationFrame(frame);
      render();
    },
    cleanup() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', measure);
      document.removeEventListener('visibilitychange', schedule);
      motionPreference.removeEventListener('change', motionChanged);
      descentObserver?.disconnect();
      resetStatement();
      journey.classList.remove('has-static-garden');
      journey.style.removeProperty('--scene-hold-distance');
      journey.style.removeProperty('--scene-pin-top');
      garden.style.removeProperty('--garden-character-top');
      if (statementStage) statementStage.style.height = '0px';
      garden.hidden = true;
      daylight.hidden = true;
    },
  };
}
