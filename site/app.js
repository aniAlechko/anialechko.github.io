import { initDescent } from './avatar-ladder.js';
import { initSmoothScroll } from './smooth-scroll.js';
import { initResponsiveLayout } from './responsive-layout.js';
import { initClouds } from './clouds.js';
import { initGarden } from './garden.js';
import { initFishing } from './fishing.js';
import { initFooterFish } from './footer-fish.js';
import { initFooterTitle } from './footer-title.js';
import { initFooterDetails } from './footer-details.js';

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
const responsiveLayout = initResponsiveLayout({ layoutReady: fontsReady });

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
let garden;
try {
  smoothScroll = initSmoothScroll({ onInteraction: skipIntro });
} catch (error) {
  console.warn('Scroll easing unavailable; native scrolling remains usable.', error);
}
let clouds;
let fishing;
try {
  garden = initGarden();
} catch (error) {
  console.warn('Garden unavailable; the portfolio remains usable.', error);
}
try {
  fishing = initFishing({ getHoldDistance: () => garden?.getHoldDistance?.() ?? 0 });
} catch (error) {
  console.warn('Fishing unavailable; the character remains visible.', error);
}
try {
  initFooterFish();
} catch (error) {
  console.warn('Footer animation unavailable; contact links remain usable.', error);
}
try {
  initFooterTitle();
} catch (error) {
  console.warn('Footer title animation unavailable; the heading remains visible.', error);
}
try {
  initFooterDetails();
} catch (error) {
  console.warn('Local time unavailable; contact details remain visible.', error);
}
try {
  clouds = initClouds({ getHoldDistance: () => garden?.getHoldDistance?.() ?? 0 });
} catch (error) {
  console.warn('Clouds unavailable; character descent remains usable.', error);
}
try {
  initDescent({
    subscribeLayout: responsiveLayout.subscribe,
    onInteraction: skipIntro,
    layoutReady: fontsReady,
    onLayout: route => {
      garden?.setRoute(route);
      fishing?.setRoute(route);
      clouds?.setRoute(route);
      smoothScroll?.setRoute(route);
    },
    getScrollTarget: () => smoothScroll?.getTarget() ?? null,
  });
} catch (error) {
  console.warn('Character descent unavailable; the page remains scrollable.', error);
}
let enterBackground = () => {};
const backgroundReady = import('./background.js').then(async ({ initBackground }) => {
  enterBackground = await initBackground(waitForAssets(fontsReady, 1800), {
    subscribeLayout: responsiveLayout.subscribe,
  });
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
