import { readFile } from 'node:fs/promises';

const pageFile = new URL('./dist/index.html', import.meta.url);
export const pageRoutes = Object.freeze(['/']);

export function isPageRoute(pathname) {
  return pathname === '/' || pathname === '/index.html';
}

export async function renderPage(pathname) {
  if (!isPageRoute(pathname)) throw new Error(`Unknown page: ${pathname}`);
  return readFile(pageFile, 'utf8');
}
