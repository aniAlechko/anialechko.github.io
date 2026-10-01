import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'site');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const port = Number(process.env.PORT || 5178);

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let path;
  try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const pageRoute = path === '/' || path === '/index.html';
  const file = resolve(root, `.${pageRoute ? '/index.html' : path}`);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    const content = await readFile(file);
    const contentType = types[extname(file)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType.startsWith('text/') || contentType === 'image/svg+xml' ? `${contentType}; charset=utf-8` : contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const missing = !pageRoute && ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code);
    if (!missing) console.error(`Failed to serve ${path}:`, error);
    response.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : missing ? 'Not found' : 'Internal server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
