import { initDescent } from './avatar-ladder.js';
import { initSmoothScroll } from './smooth-scroll.js';

const page = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const backgroundReady = new Promise(resolve => {
  if (page.dataset.backgroundReady === 'true') return resolve();
  const ready = () => { clearTimeout(timeout); resolve(); };
  const timeout = setTimeout(() => {
    document.removeEventListener('hero:background-ready', ready);
    resolve();
  }, 1800);
  document.addEventListener('hero:background-ready', ready, { once: true });
});

const fontsReady = Promise.all([
  document.fonts.load('700 100px "Neue Montreal Display"'),
  document.fonts.load('700 20px "Neue Montreal"'),
]).catch(() => undefined);

const contactSection = document.querySelector('.landing');
const contactTitle = document.querySelector('#contact-title');
let refreshContact = () => {};

if (contactSection && contactTitle) {
  let revealStart = 0;
  let revealEnd = 1;
  let distance = 0;
  let motionFrame = 0;
  let measureFrame = 0;
  let previousShift;

  const renderContact = () => {
    motionFrame = 0;
    const progress = Math.min(1, Math.max(0, (window.scrollY - revealStart) / (revealEnd - revealStart)));
    const shift = reducedMotion.matches ? '0px' : `${((1 - progress) * distance).toFixed(2)}px`;
    if (shift === previousShift) return;
    previousShift = shift;
    contactTitle.style.setProperty('--contact-shift', shift);
  };
  const scheduleContact = () => {
    if (!motionFrame) motionFrame = requestAnimationFrame(renderContact);
  };
  const measureContact = () => {
    measureFrame = 0;
    const titleTop = contactTitle.getBoundingClientRect().top + window.scrollY;
    revealEnd = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    revealStart = Math.max(0, Math.min(revealEnd - 1, titleTop - window.innerHeight));
    distance = Math.min(160, window.innerWidth * .08);
    scheduleContact();
  };
  refreshContact = () => {
    if (!measureFrame) measureFrame = requestAnimationFrame(measureContact);
  };
  const contactObserver = new ResizeObserver(refreshContact);
  contactObserver.observe(contactSection);
  contactObserver.observe(contactTitle);
  window.addEventListener('scroll', scheduleContact, { passive: true });
  window.addEventListener('resize', refreshContact, { passive: true });
  reducedMotion.addEventListener('change', scheduleContact);
  fontsReady.then(refreshContact);
  refreshContact();
}

const character = document.querySelector('.character');
const idleImage = document.querySelector('.character-pose--idle .character-image');
const jumpImage = document.querySelector('.character-pose--jump .character-image');
const lastIntroWord = document.querySelector('.speech-word-mask:last-child .speech-word');
let jumpReady = false;
let introSkipped = false;
let introFinished = false;
const characterReady = Promise.all([
  idleImage?.decode().catch(() => undefined),
  jumpImage?.decode().then(() => { jumpReady = true; }).catch(() => undefined),
]);

const finishJump = event => {
  if (event.target !== character || event.animationName !== 'character-jump') return;
  character.removeEventListener('animationend', finishJump);
  character.removeEventListener('animationcancel', finishJump);
  page.classList.add('character-landed');
};
const finishIntro = event => {
  if (event.target !== lastIntroWord || event.animationName !== 'speech-word-rise') return;
  introFinished = true;
  removeIntroListeners();
  page.classList.remove('is-entering');
};
const skipIntro = () => {
  if (introSkipped || introFinished) return;
  introSkipped = true;
  removeIntroListeners();
  page.classList.add('skip-intro', 'character-landed', 'is-ready');
  page.classList.remove('is-entering');
};
const skipOnScroll = () => {
  if (Math.abs(window.scrollY) > 0.5) skipIntro();
};
function removeIntroListeners() {
  character?.removeEventListener('animationend', finishJump);
  character?.removeEventListener('animationcancel', finishJump);
  lastIntroWord?.removeEventListener('animationend', finishIntro);
  lastIntroWord?.removeEventListener('animationcancel', finishIntro);
  window.removeEventListener('scroll', skipOnScroll);
}

// Prepare scrolling before waiting for the entrance; interaction settles the hero first.
window.addEventListener('scroll', skipOnScroll, { passive: true });
skipOnScroll();
let smoothScroll;
try {
  smoothScroll = initSmoothScroll({ onInteraction: skipIntro });
} catch (error) {
  console.warn('Scroll easing unavailable; native scrolling remains usable.', error);
}
try {
  initDescent({
    onInteraction: skipIntro,
    layoutReady: fontsReady,
    onLayout: route => {
      smoothScroll?.setRoute(route);
      refreshContact();
    },
    getScrollTarget: () => smoothScroll?.getTarget() ?? null,
  });
} catch (error) {
  console.warn('Character descent unavailable; the page remains scrollable.', error);
}

import('./background.js').catch(error => {
  console.warn('Background unavailable; the portfolio contact page remains usable.', error);
  document.dispatchEvent(new CustomEvent('hero:background-ready'));
});

await Promise.race([
  Promise.all([fontsReady, backgroundReady, characterReady]),
  new Promise(resolve => setTimeout(resolve, 2000)),
]);

if (jumpReady) page.classList.add('has-jump-pose');
if (introSkipped || reducedMotion.matches || page.classList.contains('is-ready')) skipIntro();
else {
  page.classList.add('is-entering');
  character?.addEventListener('animationend', finishJump);
  character?.addEventListener('animationcancel', finishJump);
  lastIntroWord?.addEventListener('animationend', finishIntro);
  lastIntroWord?.addEventListener('animationcancel', finishIntro);
}

page.dataset.heroEntered = 'true';
document.dispatchEvent(new CustomEvent('hero:enter'));
page.classList.add('is-ready');
