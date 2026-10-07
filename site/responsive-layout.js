const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (first, last, progress) => first + (last - first) * progress;
const ease = (start, end, value) => {
  const progress = clamp((value - start) / (end - start), 0, 1);
  return progress * progress * (3 - 2 * progress);
};
const box = (left, top, width, height) => ({ left, top, width, height });
const blendBox = (first, last, xProgress, yProgress = xProgress) => box(
  mix(first.left, last.left, xProgress), mix(first.top, last.top, yProgress),
  mix(first.width, last.width, xProgress), mix(first.height, last.height, yProgress),
);
const defaultMetrics = {
  nameWidths: [2.662, 3.398], introWidths: [9.414, 8.294], statusWidths: [9.363, 10.956],
};
const compactWidth = 809;
const portraitWidth = 500;
const portraitRatio = 1.2;
const getMode = (width, height) => ({
  progress: width <= portraitWidth || (width <= compactWidth && width / height <= portraitRatio) ? 1 : 0,
  sideProgress: width <= compactWidth ? 1 : 0,
});

// Resting layouts are complete. Fractional modes exist only during a timed transition.
export function getHeroLayout({ width, height, metrics = defaultMetrics,
  progress = getMode(width, height).progress, sideProgress = getMode(width, height).sideProgress }) {
  const compact = sideProgress;
  const short = (1 - ease(460, 540, height)) * ease(1.1, 1.3, width / height);
  const smallDetails = 1 - (1 - compact) * (1 - short);
  const edge = mix(clamp(width * .0167, 16, 32), 16, progress);
  const stageGap = clamp(width * .02, 16, 36);
  const portraitSpeech = clamp(height * .29, 212, 238);
  const portraitDetails = clamp(height * .02, 14, 17);
  const compositionGap = clamp(height * .03, 16, 24);
  const footerGap = clamp(height * .03, 16, 28);
  const breathingRoom = clamp((height - 500) * .07, 0, 24);
  const copyRows = metrics.introWidths.length + metrics.statusWidths.length;
  const portraitChrome = 84 + compositionGap + portraitSpeech / 3.2 + 8
    + footerGap + copyRows * 1.12 * portraitDetails + 8 + breathingRoom;
  // Size the character once for both compositions. Its ladder shares this scale;
  // switching rows must never make either grow as the viewport gets narrower.
  const referenceName = Math.min(height * .14, 160);
  const baseCharacter = clamp(height - portraitChrome - 1.72 * referenceName, 104, 250);
  const portraitLimit = clamp(height * portraitRatio, portraitWidth, compactWidth);
  const characterHeight = Math.min(baseCharacter + Math.max(0, width - portraitLimit) * .16,
    clamp(height * .38, 104, 360));
  const characterWidth = characterHeight * 444 / 1180;
  const availableName = (width - 2 * edge - characterWidth - 2 * stageGap) / 6.06;
  const wideName = Math.min(mix(availableName, Math.min(availableName, height * .42), short),
    (characterHeight + 16) / .86);
  const portraitName = Math.min((width - 32) / 3.4, referenceName);
  const speechWidth = mix(mix(clamp(width * .22, 230, 320), 212, smallDetails), portraitSpeech, progress);
  const detailSize = mix(mix(20, 15, smallDetails), portraitDetails, progress);
  const detailLineHeight = mix(1.2, 1.12, progress);
  // Make room for the bubble while the title moves from two columns to two rows.
  const titleClearance = Math.max(24, stageGap);
  const openName = Math.max(1, (width - 2 * edge - speechWidth - 2 * titleClearance)
    / (metrics.nameWidths[0] + metrics.nameWidths[1]));
  const clearing = ease(0, .2, progress) * (1 - ease(.6, 1, progress));
  const baseName = mix(wideName, portraitName, progress);
  const nameSize = mix(baseName, Math.min(baseName, openName), clearing);
  const nameHeight = nameSize * .86;
  const speechHeight = speechWidth / 3.2;
  const copyLineHeight = detailSize * detailLineHeight;
  const introHeight = metrics.introWidths.length * copyLineHeight;
  const statusHeight = metrics.statusWidths.length * copyLineHeight;
  const introWidth = Math.max(...metrics.introWidths) * detailSize;
  const statusWidth = Math.max(...metrics.statusWidths) * detailSize;
  const copyWidth = Math.max(introWidth, statusWidth);
  const widePaddingTop = mix(mix(130, 110, compact), 132, short);
  const widePaddingBottom = mix(mix(100, 70, compact), 64, short);
  const compositionHeight = Math.max(characterHeight, nameHeight);
  const portraitContentHeight = 2 * nameHeight + compositionGap + speechHeight + 8
    + characterHeight + footerGap + introHeight + statusHeight + 8;
  let heroHeight = mix(Math.max(height, widePaddingTop + compositionHeight + widePaddingBottom),
    Math.max(height, 84 + portraitContentHeight), progress);
  const wideCenterY = widePaddingTop + (heroHeight - widePaddingTop - widePaddingBottom) / 2;
  const wideCenterX = width / 2 - .367 * nameSize;
  const portraitTop = 64 + (heroHeight - 84 - portraitContentHeight) / 2;
  const portraitSpeechTop = portraitTop + 2 * nameHeight + compositionGap;
  const portraitCharacterTop = portraitSpeechTop + speechHeight + 8;
  const portraitCopyTop = portraitCharacterTop + characterHeight + footerGap;
  const nameWidths = metrics.nameWidths.map(ratio => ratio * nameSize);
  const nameX = ease(.6, 1, progress);
  const nameY = ease(.2, .45, progress);
  const characterY = ease(.4, .6, progress);
  const names = nameWidths.map((wordWidth, index) => blendBox(
    box(index ? width - edge - wordWidth : edge, wideCenterY - nameHeight / 2, wordWidth, nameHeight),
    box((width - wordWidth) / 2, portraitTop + index * nameHeight, wordWidth, nameHeight), nameX, nameY,
  ));
  const character = blendBox(box(wideCenterX - characterWidth / 2, wideCenterY - characterHeight / 2,
    characterWidth, characterHeight), box((width - characterWidth) / 2, portraitCharacterTop,
    characterWidth, characterHeight), progress, characterY);
  const speech = blendBox(box(wideCenterX - speechWidth / 2,
    wideCenterY - characterHeight / 2 - speechHeight - 12, speechWidth, speechHeight),
  box((width - speechWidth) / 2, portraitSpeechTop, speechWidth, speechHeight), progress, characterY);
  const copyBottom = mix(24, 16, smallDetails);
  const intro = blendBox(box(mix(24, 16, smallDetails), heroHeight - copyBottom - introHeight,
    introWidth, introHeight),
    box((width - copyWidth) / 2, portraitCopyTop, copyWidth, introHeight), nameX, nameY);
  const status = blendBox(box(width - mix(clamp(width * .0555, 24, 100), 16, smallDetails)
    - statusWidth, heroHeight - copyBottom - statusHeight, statusWidth, statusHeight),
  box((width - copyWidth) / 2, portraitCopyTop + introHeight + 8, copyWidth, statusHeight), nameX, nameY);
  const content = [...names, character, speech, intro, status];
  const headerClearance = Math.max(0, 64 - Math.min(...content.map(bounds => bounds.top)));
  for (const bounds of content) bounds.top += headerClearance;
  heroHeight = Math.max(heroHeight, ...content.map(bounds => bounds.top + bounds.height + 20));
  const rowOffsets = (ratios, row) => ratios.map(ratio => Math.max(0, (row.width - ratio * detailSize) / 2) * nameX);
  const smallIndicator = 1 - ease(620, 680, height);
  const indicatorSize = mix(mix(20, 16, short), mix(16, 12, smallIndicator), progress);
  const indicatorBottom = mix(mix(24, 16, short), mix(8, 4, smallIndicator), progress);
  return { width, height: heroHeight, progress, sideProgress, names, character, speech, intro, status,
    nameSize, detailSize, detailLineHeight, introRowOffsets: rowOffsets(metrics.introWidths, intro),
    statusRowOffsets: rowOffsets(metrics.statusWidths, status),
    indicator: box(mix(wideCenterX, width / 2, progress) - indicatorSize / 2,
      heroHeight - indicatorBottom - indicatorSize, indicatorSize, indicatorSize) };
}

export function initResponsiveLayout({ layoutReady = Promise.resolve() } = {}) {
  const hero = document.querySelector('.hero');
  if (!hero) return { subscribe: () => () => {}, cleanup() {} };
  const journey = hero.closest?.('.journey') || hero;
  const names = [...hero.querySelectorAll('.name-position')];
  const character = hero.querySelector('.character-position');
  const speech = hero.querySelector('.speech');
  const intro = hero.querySelector('.hero-intro');
  const status = hero.querySelector('.status');
  const indicator = hero.querySelector('.scroll-indicator');
  const introRows = [...intro.querySelectorAll('.intro-row')];
  const statusRows = [...status.querySelectorAll('.status-row')];
  const header = document.querySelector('.contact-header');
  const headerLinks = header ? [...header.querySelectorAll('a')] : [];
  let headerWidths;
  const listeners = new Set();
  let metrics = defaultMetrics;
  let layout;
  let lastCommit;
  let entryPrepared = false;
  let disposed = false;
  let mode;
  let transition;
  let frame = 0;
  let viewportSize;
  const visibleViewport = window.visualViewport;
  const transitionDuration = 800;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const pixels = value => `${value}px`;
  function place(element, bounds) {
    for (const property of ['left', 'top', 'width', 'height']) element.style[property] = pixels(bounds[property]);
  }
  function measureWidths(elements, parent) {
    const scale = parent ? parseFloat(getComputedStyle(parent).scale) || 1 : 1;
    return elements.map(element => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector('.name-word') || element);
      return range.getBoundingClientRect().width / (parseFloat(getComputedStyle(element).fontSize) * scale);
    });
  }
  function displayedMode(time) {
    if (!transition) return mode;
    const fraction = clamp((time - transition.start) / transitionDuration, 0, 1);
    const progress = ease(0, 1, fraction);
    mode = { progress: mix(transition.from.progress, transition.target.progress, progress),
      sideProgress: mix(transition.from.sideProgress, transition.target.sideProgress, progress) };
    if (fraction === 1) {
      mode = { ...transition.target };
      transition = undefined;
    }
    return mode;
  }
  function viewport() {
    const width = window.innerWidth;
    const smallHeight = parseFloat(getComputedStyle(hero).minHeight) || window.innerHeight;
    const largeHeight = parseFloat(getComputedStyle(hero, '::before').height) || smallHeight;
    const unzoomed = !visibleViewport || Math.abs(visibleViewport.scale - 1) < .01;
    const visibleHeight = unzoomed ? Math.max(window.innerHeight,
      (visibleViewport?.height || 0) + Math.max(0, visibleViewport?.offsetTop || 0)) : smallHeight;
    const coverHeight = Math.ceil(Math.max(smallHeight, largeHeight, visibleHeight));
    const layoutChanged = !viewportSize || viewportSize.width !== width
      || Math.abs(viewportSize.smallHeight - smallHeight) > .5
      || Math.abs(viewportSize.largeHeight - largeHeight) > .5;
    // Place the content in the opening viewport, but reserve the toolbar-free
    // height before scrolling. Closing Safari's bars cannot uncover the garden
    // early or change the character route halfway through the descent.
    if (layoutChanged || (unzoomed && Math.abs(window.scrollY) <= .5)) {
      viewportSize = { width, smallHeight, largeHeight,
        height: Math.ceil(Math.max(smallHeight, visibleHeight)), coverHeight };
    }
    return { width, height: viewportSize.height, coverHeight: viewportSize.coverHeight };
  }
  function animate(time) {
    frame = 0;
    commit(time);
  }
  function continueTransition() {
    if (transition && !frame) frame = requestAnimationFrame(animate);
    else if (!transition && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }
  function commit(time = performance.now(), size = viewport()) {
    if (disposed) return;
    mode ??= getMode(size.width, size.height);
    // Morph the composition only while it is visible. An offscreen morph would
    // keep moving the garden and footer after the viewport has already resized.
    if (transition && hero.getBoundingClientRect().bottom <= 0) {
      mode = { ...transition.target };
      transition = undefined;
    }
    const currentMode = displayedMode(time);
    if (lastCommit && lastCommit.width === size.width && lastCommit.height === size.height
      && lastCommit.coverHeight === size.coverHeight
      && lastCommit.progress === currentMode.progress && lastCommit.sideProgress === currentMode.sideProgress
      && lastCommit.metrics === metrics) {
      continueTransition();
      return;
    }
    lastCommit = { ...size, ...currentMode, metrics };
    layout = getHeroLayout({ ...size, metrics, ...currentMode });
    layout.height = Math.max(layout.height, size.coverHeight);
    hero.classList.add('layout-managed');
    hero.style.height = pixels(layout.height);
    hero.style.setProperty('--hero-viewport-height', pixels(size.height));
    hero.style.setProperty('--character-height', pixels(layout.character.height));
    hero.style.setProperty('--character-width', pixels(layout.character.width));
    // The static garden uses the same avatar scale and axis as the hero.
    journey.style.setProperty('--character-height', pixels(layout.character.height));
    journey.style.setProperty('--character-width', pixels(layout.character.width));
    journey.style.setProperty('--hero-axis', pixels(layout.character.left + layout.character.width / 2));
    hero.style.setProperty('--layout-name-size', pixels(layout.nameSize));
    hero.style.setProperty('--layout-details-size', pixels(layout.detailSize));
    hero.style.setProperty('--layout-details-line-height', layout.detailLineHeight);
    if (!entryPrepared) {
      entryPrepared = true;
      hero.style.setProperty('--name-entry-distance', pixels(mix(150, 10, layout.progress)));
      hero.style.setProperty('--given-entry-delay', `${mix(1.2, 1, layout.progress)}s`);
      hero.style.setProperty('--family-entry-delay', `${mix(1.6, 1.075, layout.progress)}s`);
      hero.style.setProperty('--given-entry-easing', `cubic-bezier(${mix(.5, .22, layout.progress)}, ${layout.progress}, ${mix(.88, .36, layout.progress)}, ${mix(.77, 1, layout.progress)})`);
      hero.style.setProperty('--family-entry-easing', `cubic-bezier(${mix(0, .22, layout.progress)}, ${mix(.72, 1, layout.progress)}, ${mix(.56, .36, layout.progress)}, 1)`);
    }
    names.forEach((element, index) => place(element, layout.names[index]));
    place(character, layout.character);
    place(speech, { ...layout.speech, left: layout.speech.left - layout.character.left,
      top: layout.speech.top - layout.character.top });
    place(intro, layout.intro);
    place(status, layout.status);
    introRows.forEach((element, index) => { element.style.marginLeft = pixels(layout.introRowOffsets[index]); });
    statusRows.forEach((element, index) => { element.style.marginLeft = pixels(layout.statusRowOffsets[index]); });
    place(indicator, layout.indicator);
    if (headerWidths) {
      const progress = layout.sideProgress;
      headerLinks.forEach((link, index) => {
        const [desktopWidth, mobileWidth] = headerWidths[index];
        const wideLeft = index ? layout.width * .55 - desktopWidth / 2 : 24;
        const mobileLeft = layout.width * (index ? .73 : .27) - mobileWidth / 2;
        link.style.left = pixels(mix(wideLeft, mobileLeft, progress));
        link.style.width = pixels(mix(desktopWidth, mobileWidth, progress));
      });
      const labelProgress = ease(.25, .75, progress);
      header.style.setProperty('--desktop-label-opacity', 1 - labelProgress);
      header.style.setProperty('--mobile-label-opacity', labelProgress);
    }
    // Consumers read the same displayed geometry, before the browser paints.
    for (const listener of listeners) listener(layout);
    continueTransition();
  }
  function resized() {
    if (disposed) return;
    const size = viewport();
    // Toolbar changes during scrolling leave the captured scene height intact.
    if (lastCommit && lastCommit.width === size.width && lastCommit.height === size.height
      && lastCommit.coverHeight === size.coverHeight
      && !(transition && reducedMotion?.matches)) return;
    const target = getMode(size.width, size.height);
    const time = performance.now();
    mode ??= target;
    const current = { ...displayedMode(time) };
    const destination = transition?.target || mode;
    if (reducedMotion?.matches || hero.getBoundingClientRect().bottom <= 0) {
      mode = target;
      transition = undefined;
    } else if (target.progress !== destination.progress || target.sideProgress !== destination.sideProgress) {
      transition = { from: current, target, start: time };
    }
    commit(time, size);
  }
  function returnedToTop() {
    if (Math.abs(window.scrollY) <= .5) resized();
  }
  window.addEventListener('resize', resized, { passive: true });
  window.addEventListener('scroll', returnedToTop, { passive: true });
  window.addEventListener('pageshow', returnedToTop, { passive: true });
  visibleViewport?.addEventListener('resize', resized, { passive: true });
  visibleViewport?.addEventListener('scroll', returnedToTop, { passive: true });
  reducedMotion?.addEventListener('change', resized);
  // Establish the covered viewport before the garden can be revealed, even
  // while fonts are pending. Font completion only refines the text measurements.
  commit();
  Promise.resolve(layoutReady).then(() => {
    if (disposed) return;
    metrics = { nameWidths: measureWidths(names), introWidths: measureWidths(introRows, intro),
      statusWidths: measureWidths(statusRows, status) };
    if (headerLinks.length) {
      header.classList.add('layout-managed');
      headerWidths = headerLinks.map(link => measureWidths([
        link.querySelector('.desktop-label'), link.querySelector('.mobile-label'),
      ]).map(ratio => ratio * parseFloat(getComputedStyle(link).fontSize)));
    }
    commit();
  }, () => commit());
  return { subscribe(listener) {
    listeners.add(listener);
    if (layout) listener(layout);
    return () => listeners.delete(listener);
  }, cleanup() {
    disposed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    listeners.clear();
    window.removeEventListener('resize', resized);
    window.removeEventListener('scroll', returnedToTop);
    window.removeEventListener('pageshow', returnedToTop);
    visibleViewport?.removeEventListener('resize', resized);
    visibleViewport?.removeEventListener('scroll', returnedToTop);
    reducedMotion?.removeEventListener('change', resized);
  } };
}
