import { initDescent } from './avatar-ladder.js';
import { initSmoothScroll } from './smooth-scroll.js';

const page = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function waitForAssets(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(resolve, milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

const fontsReady = Promise.allSettled([
  document.fonts.load('700 100px "Neue Montreal Display"'),
  document.fonts.load('700 20px "Neue Montreal"'),
]);

const contactSection = document.querySelector('.landing');
const contactTitle = document.querySelector('#contact-title');
let refreshContact = () => {};

if (contactSection && contactTitle) {
  let revealStart = 0;
  let revealEnd = 1;
  let distance = 0;
  let frame = 0;
  let needsMeasure = true;
  let previousShift;

  const renderContact = () => {
    frame = 0;
    if (needsMeasure) {
      needsMeasure = false;
      const titleTop = contactTitle.getBoundingClientRect().top + window.scrollY;
      revealEnd = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      revealStart = Math.max(0, Math.min(revealEnd - 1, titleTop - window.innerHeight));
      distance = Math.min(160, window.innerWidth * .08);
    }
    const progress = Math.min(1, Math.max(0, (window.scrollY - revealStart) / (revealEnd - revealStart)));
    const shift = reducedMotion.matches ? '0px' : `${((1 - progress) * distance).toFixed(2)}px`;
    if (shift === previousShift) return;
    previousShift = shift;
    contactTitle.style.setProperty('--contact-shift', shift);
  };
  const scheduleContact = () => {
    if (!frame) frame = requestAnimationFrame(renderContact);
  };
  refreshContact = () => {
    needsMeasure = true;
    scheduleContact();
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
  if (introFinished) return;
  introFinished = true;
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

let enterBackground = () => {};
const backgroundReady = import('./background.js').then(async ({ initBackground }) => {
  enterBackground = await initBackground(waitForAssets(fontsReady, 1800));
  // A late renderer joins the settled page without replaying the entrance.
  if (page.classList.contains('is-ready')) enterBackground();
}).catch(error => {
  console.warn('Background unavailable; the portfolio contact page remains usable.', error);
});

await waitForAssets(Promise.all([
  fontsReady, waitForAssets(backgroundReady, 1800), characterReady,
]), 2000);

if (jumpReady) page.classList.add('has-jump-pose');
if (introFinished || reducedMotion.matches || page.classList.contains('is-ready')) skipIntro();
else {
  page.classList.add('is-entering');
  character?.addEventListener('animationend', finishJump);
  character?.addEventListener('animationcancel', finishJump);
  lastIntroWord?.addEventListener('animationend', finishIntro);
  lastIntroWord?.addEventListener('animationcancel', finishIntro);
}

enterBackground();
page.classList.add('is-ready');
