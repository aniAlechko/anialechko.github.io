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

const character = document.querySelector('.construction-character');
const idleImage = document.querySelector('.character-pose--idle .character-image');
const jumpImage = document.querySelector('.character-pose--jump .character-image');
let jumpReady = false;
const characterReady = Promise.all([
  idleImage?.decode().catch(() => undefined),
  jumpImage?.decode().then(() => { jumpReady = true; }).catch(() => undefined),
]);

import('./construction-background.js').catch(error => {
  console.warn('Background unavailable; the portfolio contact page remains usable.', error);
  document.dispatchEvent(new CustomEvent('hero:background-ready'));
});

await Promise.race([
  Promise.all([fontsReady, backgroundReady, characterReady]),
  new Promise(resolve => setTimeout(resolve, 2000)),
]);

if (jumpReady) page.classList.add('has-jump-pose');
if (reducedMotion.matches || page.classList.contains('is-ready')) page.classList.add('skip-intro');
else page.classList.add('is-entering');

const finishJump = event => {
  if (event.target !== character || event.animationName !== 'cone-enter') return;
  character.removeEventListener('animationend', finishJump);
  character.removeEventListener('animationcancel', finishJump);
  page.classList.add('character-landed');
};
if (page.classList.contains('is-entering') && character) {
  character.addEventListener('animationend', finishJump);
  character.addEventListener('animationcancel', finishJump);
}

const lastIntroWord = document.querySelector('.speech-word-mask:last-child .speech-word');
const finishIntro = event => {
  if (event.animationName !== 'speech-word-rise') return;
  lastIntroWord.removeEventListener('animationend', finishIntro);
  lastIntroWord.removeEventListener('animationcancel', finishIntro);
  page.classList.remove('is-entering');
};
if (page.classList.contains('is-entering') && lastIntroWord) {
  lastIntroWord.addEventListener('animationend', finishIntro);
  lastIntroWord.addEventListener('animationcancel', finishIntro);
}
page.dataset.heroEntered = 'true';
document.dispatchEvent(new CustomEvent('hero:enter'));
page.classList.add('is-ready');
