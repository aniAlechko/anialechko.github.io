import { initDescent } from './avatar-ladder.js';
import { initSmoothScroll } from './smooth-scroll.js';
import { initResponsiveLayout } from './responsive-layout.js';
import { initClouds } from './clouds.js';
import { initGarden } from './garden.js';
import { initFishing } from './fishing.js';
import { initFooterFish } from './footer-fish.js';
import { initFooterTitle } from './footer-title.js';
import { initFooterActions } from './footer-actions.js';
import { initFooterDetails } from './footer-details.js';

const page = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

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
let fishing;
try {
  smoothScroll = initSmoothScroll({
    onInteraction: skipIntro,
  });
} catch (error) {
  console.warn('Scroll easing unavailable; native scrolling remains usable.', error);
}
let clouds;
try {
  garden = initGarden();
} catch (error) {
  console.warn('Garden unavailable; the portfolio remains usable.', error);
}
try {
  fishing = initFishing({
    getFishingDistance: () => garden?.getFishingDistance?.() ?? 0,
    getPullRange: () => garden?.getPullRange?.() ?? null,
  });
} catch (error) {
  console.warn('Fishing unavailable; the character remains visible.', error);
}
try {
  initFooterFish();
} catch (error) {
  console.warn('Footer animation unavailable; contact links remain usable.', error);
}
try {
  initFooterActions();
} catch (error) {
  console.warn('Footer button transitions unavailable; contact links remain usable.', error);
}
try {
  initFooterTitle({ subscribeLayout: responsiveLayout.subscribe });
} catch (error) {
  console.warn('Footer title animation unavailable; the heading remains visible.', error);
}
try {
  initFooterDetails();
} catch (error) {
  console.warn('Local time unavailable; contact details remain visible.', error);
}
try {
  clouds = initClouds();
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
    },
    getScrollTarget: () => smoothScroll?.getTarget() ?? null,
  });
} catch (error) {
  console.warn('Character descent unavailable; the page remains scrollable.', error);
}
let enterBackground = () => {};
const backgroundReady = import('./background.js').then(async ({ initBackground }) => {
  enterBackground = await initBackground(fontsReady, {
    subscribeLayout: responsiveLayout.subscribe,
  });
  // A late renderer joins the settled page without replaying the entrance.
  if (page.classList.contains('is-ready')) enterBackground();
}).catch(error => {
  console.warn('Background unavailable; the portfolio contact page remains usable.', error);
});

const scrollIndicator = document.querySelector('.scroll-indicator');
scrollIndicator?.setAttribute('aria-label', 'Loading portfolio');
const sceneImagesReady = Promise.allSettled(
  [...document.querySelectorAll('.journey img')].map(image => image.decode()),
);
void Promise.allSettled([
  fontsReady, backgroundReady, characterReady, sceneImagesReady,
]).then(() => {
  page.classList.remove('is-loading');
  scrollIndicator?.setAttribute('aria-label', 'Scroll down');
});

// Start the entrance after its actual assets settle, regardless of connection speed.
await Promise.allSettled([fontsReady, backgroundReady, characterReady]);

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
