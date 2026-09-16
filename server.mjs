import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPageRoute, renderPage } from './render.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const port = Number(process.env.PORT || 5178);

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let path;
  try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const pageRoute = isPageRoute(path);
  const file = resolve(root, `.${pageRoute ? '/index.html' : path}`);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    const content = pageRoute ? Buffer.from(await renderPage(path)) : await readFile(file);
    const contentType = types[extname(file)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType.startsWith('text/') || contentType === 'image/svg+xml' ? `${contentType}; charset=utf-8` : contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
