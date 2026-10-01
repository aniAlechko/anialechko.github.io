import { initDescent } from './avatar-ladder.js';
import { initSmoothScroll } from './smooth-scroll.js';

const page = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const skillsSpace = document.querySelector('#descent-space');
const skillsColumn = document.querySelector('.hero-details .status');
const skillsList = skillsSpace?.querySelector('.descent-skills');
if (skillsList && skillsColumn) {
  const items = [...skillsList.children];
  const heroWords = [...skillsList.querySelectorAll('[data-hero-word]')].map(element => ({
    element,
    anchor: skillsColumn.querySelector(`[data-skill-anchor="${element.dataset.heroWord}"]`),
    x: 0,
    y: 0,
  }));
  const separators = [...skillsList.querySelectorAll('.skill-comma, .skill-and')];
  const addedWords = [...skillsList.querySelectorAll('.skill-added')];
  let rows = [];
  let peakScale = 1;
  let spread = 0;
  let radius = 220;
  let ladderShift = 0;
  let mobileSkills = false;
  let ladderScene;
  let motionFrame = 0;
  const clamp = value => Math.min(1, Math.max(0, value));
  const ease = value => value * value * (3 - 2 * value);
  const animateSkills = () => {
    motionFrame = 0;
    if (reducedMotion.matches) {
      for (const item of items) {
        item.style.removeProperty('opacity');
        item.style.removeProperty('transform');
      }
      for (const word of heroWords) word.element.style.removeProperty('transform');
      for (const element of [...separators, ...addedWords]) element.style.removeProperty('opacity');
      ladderScene?.style.removeProperty('--skills-ladder-shift');
      return;
    }
    const top = skillsList.getBoundingClientRect().top;
    const height = window.innerHeight;
    const entrance = clamp((window.scrollY - 24) / 64);
    const focusCenter = height * .5;
    const opening = ease(clamp(window.scrollY / 220));
    // Separate the shared first line vertically before moving words sideways.
    const splitY = ease(clamp(window.scrollY / (mobileSkills ? 32 : 140)));
    const splitX = ease(clamp((window.scrollY - (mobileSkills ? 8 : 80)) / (mobileSkills ? 48 : 140)));
    const addedProgress = ease(clamp((window.scrollY - (mobileSkills ? 56 : 220)) / 56));
    const activeSpread = spread * opening;
    // Rows expand as they approach the middle and retain that spacing above it.
    // Integrating this curve keeps neighboring rows in order in both directions.
    const integral = distance => {
      if (distance <= 0) return distance;
      const x = Math.min(distance, radius);
      const t = x / radius;
      return x * (1 - t * t + .5 * t * t * t);
    };
    const map = position => position + activeSpread * integral(position - focusCenter);
    let lower = top - activeSpread * radius / 2;
    let upper = Math.max(top, focusCenter);
    for (let iteration = 0; iteration < 18; iteration++) {
      const middle = (lower + upper) / 2;
      if (map(middle) < top) lower = middle;
      else upper = middle;
    }
    const virtualTop = (lower + upper) / 2;
    const shift = `${Math.round(-ladderShift * opening * 100) / 100}px`;
    ladderScene ||= document.querySelector('.descent-scene');
    if (ladderScene && ladderScene.style.getPropertyValue('--skills-ladder-shift') !== shift) {
      ladderScene.style.setProperty('--skills-ladder-shift', shift);
    }
    for (const word of heroWords) {
      const transform = `translate(${Math.round(word.x * (1 - splitX) * 100) / 100}px, ${Math.round(word.y * (1 - splitY) * 100) / 100}px)`;
      if (word.element.style.transform !== transform) word.element.style.transform = transform;
    }
    for (const separator of separators) separator.style.opacity = String(Math.round((1 - splitY) * 1000) / 1000);
    for (const word of addedWords) word.style.opacity = String(Math.round(addedProgress * 1000) / 1000);
    for (let index = 0; index < items.length; index++) {
      const row = rows[index];
      const virtualCenter = virtualTop + row.center;
      const start = map(virtualTop + row.top);
      const end = map(virtualTop + row.bottom);
      const center = (start + end) / 2;
      const falloff = clamp((virtualCenter - focusCenter) / radius);
      const focus = 1 - falloff * falloff * (3 - 2 * falloff);
      const edgeFade = Math.min(entrance,
        clamp((center - 64) / 96),
        clamp((height - center) / 96));
      const revealedOpacity = edgeFade * (.78 + .22 * focus);
      // The opening rows ARE the hero text, so they never fade to a copy.
      const opacity = items[index].classList.contains('skills-lead')
        ? 1 + (revealedOpacity - 1) * opening : revealedOpacity;
      // Never shrink below the original type size; reserve enough space for
      // the entire scaled row, including labels that wrap on small screens.
      const scale = Math.max(1, Math.min(1 + (peakScale - 1) * focus * opening,
        (end - start) / row.height));
      const offset = center - top - row.center;
      const transform = `translateY(${Math.round(offset * 100) / 100}px) scale(${Math.round(scale * 1000) / 1000})`;
      const value = String(Math.round(opacity * 1000) / 1000);
      if (items[index].style.opacity !== value) items[index].style.opacity = value;
      if (items[index].style.transform !== transform) items[index].style.transform = transform;
    }
  };
  const scheduleMotion = () => {
    if (!motionFrame) motionFrame = requestAnimationFrame(animateSkills);
  };
  const alignSkills = () => {
    page.classList.toggle('skills-ready', !reducedMotion.matches);
    skillsColumn.setAttribute('aria-hidden', String(!reducedMotion.matches));
    const column = skillsColumn.getBoundingClientRect();
    const type = getComputedStyle(skillsColumn);
    skillsSpace.style.setProperty('--skills-left', `${column.left}px`);
    skillsSpace.style.setProperty('--skills-width', `${column.width}px`);
    skillsSpace.style.setProperty('--skills-top', `${column.top - skillsSpace.getBoundingClientRect().top}px`);
    skillsSpace.style.setProperty('--skills-font-size', type.fontSize);
    skillsSpace.style.setProperty('--skills-line-height', type.lineHeight);
    const listStyle = getComputedStyle(skillsList);
    peakScale = Number(listStyle.getPropertyValue('--skills-peak-scale')) || 1;
    spread = Number(listStyle.getPropertyValue('--skills-spread')) || 0;
    radius = Math.min(220, document.querySelector('.hero').offsetHeight * .28);
    rows = items.map(item => ({
      top: item.offsetTop,
      bottom: item.offsetTop + item.offsetHeight,
      center: item.offsetTop + item.offsetHeight / 2,
      height: item.offsetHeight,
    }));
    const listBounds = skillsList.getBoundingClientRect();
    for (const word of heroWords) {
      const anchor = word.anchor.getBoundingClientRect();
      word.x = anchor.left - listBounds.left - word.element.offsetLeft;
      word.y = anchor.top - listBounds.top - word.element.parentElement.offsetTop - word.element.offsetTop;
    }
    // Reserve the maximum spread once, rather than changing page height on scroll.
    skillsList.style.minHeight = reducedMotion.matches ? ''
      : `${Math.ceil(rows.at(-1).bottom * (1 + spread))}px`;
    mobileSkills = listStyle.getPropertyValue('--skills-mobile').trim() === '1';
    if (mobileSkills) {
      const avatar = document.querySelector('.character').getBoundingClientRect();
      const actorRight = avatar.left + avatar.width / 2 + avatar.height * 524 / 2360;
      const textLeft = skillsList.getBoundingClientRect().right - skillsList.clientWidth * peakScale;
      ladderShift = Math.max(0, actorRight + 16 - textLeft);
    } else ladderShift = 0;
    scheduleMotion();
  };
  for (const item of items) item.classList.add('can-reveal');
  alignSkills();
  const skillsLayout = new ResizeObserver(alignSkills);
  skillsLayout.observe(skillsColumn);
  skillsLayout.observe(document.querySelector('.hero'));
  skillsLayout.observe(skillsList);
  window.addEventListener('scroll', scheduleMotion, { passive: true });
  window.addEventListener('resize', scheduleMotion, { passive: true });
  reducedMotion.addEventListener('change', alignSkills);
}

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
    onLayout: route => smoothScroll?.setRoute(route),
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
