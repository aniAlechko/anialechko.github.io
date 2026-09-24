import { initPage } from './site.js';

// Keep the current document visible while preparing the destination. The server
// still serves every URL independently for direct visits and ordinary links.
let disposePage;
let currentURL = new URL(location.href);
let currentIndex = history.state?.portfolio?.index ?? 0;
let requestNumber = 0;
let pendingLoad;
let transition;
let restoringIndex = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const routes = /^\/(?:work\/?|work\/project-(?:one|two)\/?|feed\/?|about\/?|feed\/feed-image-0[1-6]\/?|index\.html)?$/;
const positions = new Map();

history.scrollRestoration = 'manual';
const initialPosition = history.state?.portfolio?.position;
if (initialPosition) scrollTo({ left: initialPosition[0], top: initialPosition[1], behavior: 'instant' });
disposePage = initPage();
rememberPosition();

function rememberPosition() {
  const position = [scrollX, scrollY];
  positions.set(currentIndex, position);
  if (location.href === currentURL.href) {
    history.replaceState({ ...history.state, portfolio: { index: currentIndex, position } }, '', currentURL);
  }
}

function destinationPosition(url, entry) {
  if (entry) return positions.get(entry.index) ?? entry.position ?? [0, 0];
  const target = hashTarget(url);
  if (target && url.hash) {
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    return [0, Math.max(0, target.getBoundingClientRect().top + scrollY - margin)];
  }
  return [0, 0];
}

function hashTarget(url) {
  try { return document.getElementById(decodeURIComponent(url.hash.slice(1))); }
  catch { return null; }
}

function focusTarget(element) {
  if (!element) return;
  const hadTabIndex = element.hasAttribute('tabindex');
  if (!hadTabIndex) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  if (!hadTabIndex) element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true });
}

function updateHistory(url, entry) {
  if (entry) currentIndex = entry.index;
  else if (url.href !== location.href) {
    currentIndex = (history.state?.portfolio?.index ?? currentIndex) + 1;
    history.pushState({ portfolio: { index: currentIndex, position: [0, 0] } }, '', url);
  }
  currentURL = new URL(url);
}

function showError() {
  let status = document.querySelector('.navigation-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'navigation-status';
    status.setAttribute('role', 'alert');
    document.body.append(status);
  }
  status.textContent = 'This page could not load. Please try the link again.';
}

async function loadPage(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'text/html' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Page request failed');
  }
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (!page.querySelector('main') || !page.querySelector('.space-fabric') || !page.body.dataset.page) {
    throw new Error('Incomplete portfolio page');
  }
  page.querySelectorAll('script').forEach(script => script.remove());
  // Fonts and eager images are prepared before the old page is captured.
  const images = [...page.images].filter(image => image.loading !== 'lazy').map(image => {
    const resource = new Image();
    resource.src = new URL(image.getAttribute('src'), url).href;
    return resource.decode().catch(() => {});
  });
  await Promise.race([
    Promise.all([document.fonts.ready, ...images]),
    new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  ]);
  return page;
}

function settleLayout() {
  // Initialization paints the fabric synchronously. Allow its ResizeObservers
  // one frame before the new snapshot; a background tab must not block forever.
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timeout); resolve(); });
  });
}

async function navigate(url, entry = null) {
  const request = ++requestNumber;
  pendingLoad?.abort();
  pendingLoad = null;
  const previousTransition = transition;
  previousTransition?.skipTransition();
  if (previousTransition) await previousTransition.finished.catch(() => {});
  if (request !== requestNumber) return;
  transition = null;
  rememberPosition();
  document.querySelector('.navigation-status')?.remove();
  document.querySelector('main')?.removeAttribute('aria-busy');

  // In-page anchors and restored scroll do not need another document or slide.
  if (url.pathname === currentURL.pathname && url.search === currentURL.search) {
    updateHistory(url, entry);
    const [left, top] = destinationPosition(url, entry);
    scrollTo({ left, top, behavior: 'instant' });
    if (url.hash && !entry) focusTarget(hashTarget(url));
    rememberPosition();
    return;
  }

  const controller = new AbortController();
  pendingLoad = controller;
  const timeout = setTimeout(() => controller.abort(new Error('Page load timed out')), 12000);
  document.querySelector('main').setAttribute('aria-busy', 'true');
  try {
    const page = await loadPage(url, controller.signal);
    if (request !== requestNumber) return;
    const contents = document.importNode(page.body, true);
    const commit = async () => {
      // skipTransition() still invokes this callback; stale requests must not win.
      if (request !== requestNumber) return;
      disposePage();
      document.body.replaceChildren(...contents.childNodes);
      document.body.dataset.page = page.body.dataset.page;
      document.title = page.title;
      updateHistory(url, entry);
      const [left, top] = destinationPosition(url, entry);
      scrollTo({ left, top, behavior: 'instant' });
      disposePage = initPage();
      focusTarget(hashTarget(url) || document.querySelector('main h1'));
      await settleLayout();
      rememberPosition();
    };
    if (document.startViewTransition && !reducedMotion.matches && !document.hidden) {
      const currentTransition = document.startViewTransition(commit);
      transition = currentTransition;
      // A skipped animation can reject ready without invalidating the commit.
      currentTransition.ready.catch(() => {});
      await currentTransition.updateCallbackDone;
      await currentTransition.finished;
    } else {
      await commit();
    }
  } catch (error) {
    if (request !== requestNumber) return;
    // Back changes the URL before loading. Restore its original history entry on
    // failure so the visible page and address cannot silently disagree.
    const addressIndex = history.state?.portfolio?.index;
    if (addressIndex !== undefined && addressIndex !== currentIndex) {
      restoringIndex = currentIndex;
      history.go(currentIndex - addressIndex);
    }
    showError();
    console.error('Portfolio navigation failed:', error);
  } finally {
    clearTimeout(timeout);
    if (request === requestNumber) {
      pendingLoad = null;
      transition = null;
      document.querySelector('main')?.removeAttribute('aria-busy');
    }
  }
}

document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !routes.test(url.pathname)) return;
  event.preventDefault();
  void navigate(url);
});

window.addEventListener('scroll', rememberPosition, { passive: true });
window.addEventListener('pagehide', rememberPosition);
window.addEventListener('popstate', event => {
  const entry = event.state?.portfolio;
  if (restoringIndex !== null && entry?.index === restoringIndex) {
    restoringIndex = null;
    return;
  }
  if (!entry) { location.reload(); return; }
  void navigate(new URL(location.href), entry);
});
