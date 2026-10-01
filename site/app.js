import { initDescent } from './avatar-ladder.js';
import { initSmoothScroll } from './smooth-scroll.js';

const page = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const skillsSpace = document.querySelector('#descent-space');
const skillsColumn = document.querySelector('.hero-details .status');
const skillsList = skillsSpace?.querySelector('.descent-skills');
let aboutLayout;
let descentRoute;
let refreshSkills = () => {};
if (skillsList && skillsColumn) {
  const intro = document.querySelector('.hero-intro');
  const introItems = [...intro?.querySelectorAll('.intro-row') || []];
  let introLayout;
  let introRows = [];
  const items = [...skillsList.children];
  const heroWords = [...skillsList.querySelectorAll('[data-hero-word]')].map(element => ({
    element,
    anchor: skillsColumn.querySelector(`[data-skill-anchor="${element.dataset.heroWord}"]`),
    x: 0,
    y: 0,
  }));
  const separators = [...skillsList.querySelectorAll('.skill-comma')];
  const addedWords = [...skillsList.querySelectorAll('.skill-added')];
  let rows = [];
  let listDocumentTop = 0;
  let peakScale = 1;
  let ladderShift = 0;
  let initialLadderShift = 0;
  let mobileSkills = false;
  let ladderScene;
  let motionFrame = 0;
  const clamp = value => Math.min(1, Math.max(0, value));
  const ease = value => value * value * (3 - 2 * value);
  const animateSkills = () => {
    motionFrame = 0;
    if (reducedMotion.matches) {
      for (const item of [...items, ...introItems]) {
        item.style.removeProperty('opacity');
        item.style.removeProperty('transform');
      }
      for (const word of heroWords) word.element.style.removeProperty('transform');
      for (const element of [...separators, ...addedWords]) element.style.removeProperty('opacity');
      ladderScene?.style.removeProperty('--skills-ladder-shift');
      for (const row of introRows) row.word.style.removeProperty('transform');
      return;
    }
    const height = window.innerHeight;
    const scroll = window.scrollY;
    const top = listDocumentTop - scroll;
    const stop = descentRoute?.about || { start: aboutLayout.scroll, end: aboutLayout.scroll + aboutLayout.hold };
    const progress = clamp(scroll / stop.start);
    // Give the compact hero words their own lines before enlarging the list.
    const separation = ease(clamp(progress / .35));
    const alignment = ease(clamp((progress - .15) / .25));
    const opening = ease(clamp((progress - .3) / .7));
    const departure = Math.max(0, scroll - stop.end);
    const groupOpacity = 1 - ease(clamp(departure / (height * .45)));
    const addedProgress = ease(clamp((progress - .4) / .3));
    // First clear the unscaled text; make the remaining room as the column grows.
    const initialShiftProgress = 1 - (1 - clamp(window.scrollY / 32)) ** 3;
    const shiftDistance = initialLadderShift * initialShiftProgress
      + (ladderShift - initialLadderShift) * opening;
    const shift = `${Math.round(-shiftDistance * 100) / 100}px`;
    ladderScene ||= document.querySelector('.descent-scene');
    if (ladderScene && ladderScene.style.getPropertyValue('--skills-ladder-shift') !== shift) {
      ladderScene.style.setProperty('--skills-ladder-shift', shift);
    }
    // Compensate for the parent scale, keeping words legible while their
    // compact lines separate vertically and then align into the column.
    const scale = 1 + (peakScale - 1) * opening;
    for (const word of heroWords) {
      const transform = `translate(${(word.x * (1 - alignment) / scale).toFixed(2)}px, ${(word.y * (1 - separation) / scale).toFixed(2)}px)`;
      if (word.element.style.transform !== transform) word.element.style.transform = transform;
    }
    for (const separator of separators) separator.style.opacity = String(Math.round((1 - ease(clamp(progress / .25))) * 1000) / 1000);
    for (const word of addedWords) word.style.opacity = String(Math.round(addedProgress * 1000) / 1000);
    // Every row arrives at one complete composition. The same DOM words stay
    // visible through the hold, so the first lines never scroll away early.
    const rowMotion = (row, lead) => {
      const initialCenter = top + row.top + row.height / 2;
      const finalCenter = row.stageTop + row.height * peakScale / 2 - departure;
      const center = initialCenter + (finalCenter - initialCenter) * opening;
      const opacity = (lead ? 1 : addedProgress) * groupOpacity;
      return { center, scale, opacity };
    };
    for (let index = 0; index < items.length; index++) {
      const row = rows[index];
      const { center, scale, opacity } = rowMotion(row, items[index].classList.contains('skills-lead'));
      const offset = center - top - row.center;
      const transform = `translateY(${Math.round(offset * 100) / 100}px) scale(${Math.round(scale * 1000) / 1000})`;
      const value = String(Math.round(opacity * 1000) / 1000);
      if (items[index].style.opacity !== value) items[index].style.opacity = value;
      if (items[index].style.transform !== transform) items[index].style.transform = transform;
    }
    const introSlide = mobileSkills ? 1 - (1 - clamp(window.scrollY / 24)) ** 3 : 0;
    for (const row of introRows) {
      // Keep the centered hero at rest; join the list as two ordinary rows.
      const rowTop = row.top + (row.targetTop - row.top) * separation;
      const motion = rowMotion({ top: rowTop, bottom: rowTop + row.height,
        center: rowTop + row.height / 2, height: row.height, stageTop: row.stageTop }, true);
      const x = introLayout.shiftX * introSlide;
      const y = motion.center - top - row.top - row.height / 2;
      row.element.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${motion.scale.toFixed(3)})`;
      row.element.style.opacity = motion.opacity.toFixed(3);
      row.word.style.transform = `translateX(${(-row.textInset * introSlide).toFixed(2)}px)`;
    }
  };
  const scheduleMotion = () => {
    if (!motionFrame) motionFrame = requestAnimationFrame(animateSkills);
  };
  refreshSkills = scheduleMotion;
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
    mobileSkills = listStyle.getPropertyValue('--skills-mobile').trim() === '1';
    peakScale = Number(listStyle.getPropertyValue('--skills-peak-scale')) || 1;
    rows = items.map(item => ({
      top: item.offsetTop,
      bottom: item.offsetTop + item.offsetHeight,
      center: item.offsetTop + item.offsetHeight / 2,
      height: item.offsetHeight,
    }));
    const listBounds = skillsList.getBoundingClientRect();
    listDocumentTop = listBounds.top + window.scrollY;
    if (intro) {
      // The container stays untransformed; only its individual rows animate.
      const bounds = intro.getBoundingClientRect();
      introLayout = {
        offset: bounds.top - listBounds.top,
        left: bounds.left,
        width: bounds.width,
        shiftX: mobileSkills ? listBounds.right - bounds.right : 0,
      };
      const lineHeight = Number.parseFloat(type.lineHeight);
      introRows = introItems.map((element, index) => {
        const word = element.querySelector('.intro-word');
        const rowTop = introLayout.offset + element.offsetTop;
        return { element, word, top: rowTop, height: lineHeight,
          targetTop: mobileSkills ? (index - introItems.length) * lineHeight : rowTop,
          textInset: mobileSkills ? (bounds.width - word.offsetWidth) / 2 : 0 };
      });
    }
    for (const word of heroWords) {
      const anchor = word.anchor.getBoundingClientRect();
      word.x = anchor.left - listBounds.left - word.element.offsetLeft;
      word.y = anchor.top - listBounds.top - word.element.parentElement.offsetTop - word.element.offsetTop;
    }
    const avatar = document.querySelector('.character').getBoundingClientRect();
    const actorWidth = avatar.height * 524 / 1180;
    const actorLeft = avatar.left + avatar.width / 2 - actorWidth / 2;
    const actorRight = actorLeft + actorWidth;
    if (mobileSkills) {
      const pageEdge = window.innerWidth - listBounds.right;
      const columnWidth = Math.max(skillsList.clientWidth, introLayout?.width || 0);
      const availableWidth = listBounds.right - pageEdge - actorWidth - 16;
      peakScale = Math.max(1, Math.min(peakScale, availableWidth / columnWidth));
      const textLeft = listBounds.right - columnWidth * peakScale;
      ladderShift = Math.max(0, actorRight + 16 - textLeft);
      initialLadderShift = Math.min(ladderShift,
        Math.max(0, actorRight + 16 - (listBounds.right - columnWidth)));
    } else {
      // A narrow desktop still needs clear lanes on both sides of the avatar.
      const leftScale = introLayout ? (actorLeft - introLayout.left - 16) / introLayout.width : peakScale;
      const rightScale = (listBounds.right - actorRight - 16) / skillsList.clientWidth;
      peakScale = Math.max(1, Math.min(peakScale, leftScale, rightScale));
      ladderShift = initialLadderShift = 0;
    }
    const stageHeight = document.querySelector('.hero').offsetHeight;
    const stageTop = Math.max(76, Math.min(140, stageHeight * .1));
    const bottomSpace = Math.max(40, stageHeight * .08);
    const stageRows = mobileSkills ? [...introRows, ...rows] : rows;
    const textHeight = stageRows.reduce((sum, row) => sum + row.height, 0);
    const availableHeight = stageHeight - stageTop - bottomSpace;
    const lineHeight = Number.parseFloat(type.lineHeight);
    const minGap = lineHeight * .2;
    peakScale = Math.max(1, Math.min(peakScale,
      (availableHeight - minGap * (stageRows.length - 1)) / textHeight));
    const gap = Math.max(0, Math.min(lineHeight * .7,
      (availableHeight - textHeight * peakScale) / (stageRows.length - 1)));
    let nextTop = stageTop;
    for (const row of stageRows) {
      row.stageTop = nextTop;
      nextTop += row.height * peakScale + gap;
    }
    if (!mobileSkills) introRows.forEach((row, index) => {
      row.stageTop = stageTop + index * (lineHeight * peakScale + gap);
    });
    const nextAboutLayout = {
      scroll: Math.max(220, listBounds.top + window.scrollY
        - (mobileSkills ? rows[0].stageTop : stageTop)),
      hold: stageHeight * .32,
      contentBottom: nextTop - gap,
    };
    const stageChanged = !aboutLayout
      || Math.abs(nextAboutLayout.scroll - aboutLayout.scroll) > .5
      || Math.abs(nextAboutLayout.hold - aboutLayout.hold) > .5
      || Math.abs(nextAboutLayout.contentBottom - aboutLayout.contentBottom) > .5;
    aboutLayout = nextAboutLayout;
    if (stageChanged) window.dispatchEvent(new Event('skills:layout'));
    scheduleMotion();
  };
  for (const item of items) item.classList.add('can-reveal');
  alignSkills();
  const skillsLayout = new ResizeObserver(alignSkills);
  if (intro) skillsLayout.observe(intro);
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
    getAboutLayout: () => aboutLayout,
    onLayout: route => {
      descentRoute = route;
      smoothScroll?.setRoute(route);
      refreshSkills();
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
