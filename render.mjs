import { readFile } from 'node:fs/promises';

const sourceRoot = new URL('./dist/', import.meta.url);
export const pageRoutes = Object.freeze([
  '/', '/work', '/feed', '/about',
  ...Array.from({ length: 6 }, (_, index) => `/feed/feed-image-${String(index + 1).padStart(2, '0')}`)
]);

function normalizeRoute(pathname) {
  return pathname === '/index.html' ? '/' : pathname.replace(/\/$/, '') || '/';
}

export function isPageRoute(pathname) {
  return pageRoutes.includes(normalizeRoute(pathname));
}

// Local serving and static publishing use the same complete documents.
export async function renderPage(pathname) {
  const route = normalizeRoute(pathname);
  if (!pageRoutes.includes(route)) throw new Error(`Unknown page: ${pathname}`);
  const source = await readFile(new URL('index.html', sourceRoot), 'utf8');
  if (route === '/') return source;

  const feedNumber = route.startsWith('/feed/feed-image-') ? route.slice(-2) : null;
  const page = feedNumber ? 'feed-detail' : route.slice(1);
  const activePage = feedNumber ? 'feed' : page;
  const skipTarget = feedNumber ? 'feed-item' : page;
  let pageContent, title;
  if (feedNumber) {
    const current = Number(feedNumber);
    const entries = {
      current: feedNumber,
      previous: String(current === 1 ? 6 : current - 1).padStart(2, '0'),
      next: String(current === 6 ? 1 : current + 1).padStart(2, '0')
    };
    const template = await readFile(new URL('feed-item.html', sourceRoot), 'utf8');
    pageContent = template.replace(/\{\{(current|previous|next)\}\}/g, (_, key) => entries[key]);
    title = `Feed image ${entries.current} — Alex Rivkin`;
  } else {
    // Explicit markers keep overview sections and standalone pages in sync.
    const section = new RegExp(`<!-- section:${page}:start -->([\\s\\S]*?)<!-- section:${page}:end -->`).exec(source);
    if (!section) throw new Error(`Missing section: ${page}`);
    pageContent = section[1].trim()
      .replace(/<h2(\b[^>]*)>([\s\S]*?)<\/h2>/, '<h1$1>$2</h1>');
    if (page !== 'about') {
      pageContent = pageContent.replace(/<section class="([^"]+)"/, '<section class="$1 page-entry"');
    }
    title = `${page[0].toUpperCase()}${page.slice(1)} — Alex Rivkin`;
  }
  const html = source
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace('data-page="home"', `data-page="${page}"`)
    .replace(/<!-- page-content:start -->[\s\S]*?<!-- page-content:end -->/, () => pageContent)
    .replace('href="#work">Skip to work', `href="#${skipTarget}">Skip to content`)
    .replace(' aria-current="page"', '')
    .replace(`<a href="/${activePage}">`, `<a href="/${activePage}" aria-current="page">`);
  return html;
}
