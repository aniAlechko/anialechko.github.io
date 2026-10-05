import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'site');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.mp4': 'video/mp4', '.webm': 'video/webm' };
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
    if (contentType.startsWith('video/') && request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      const start = range?.[1] ? Number(range[1])
        : Math.max(0, content.length - Number(range?.[2]));
      const end = range?.[1] && range?.[2]
        ? Math.min(Number(range[2]), content.length - 1) : content.length - 1;
      if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end) || start > end || start >= content.length) {
        response.writeHead(416, { 'Content-Range': `bytes */${content.length}` }).end();
        return;
      }
      response.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${content.length}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      });
      response.end(request.method === 'HEAD' ? undefined : content.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType.startsWith('text/') || contentType === 'image/svg+xml' ? `${contentType}; charset=utf-8` : contentType,
      'Content-Length': content.length,
      ...(contentType.startsWith('video/') ? { 'Accept-Ranges': 'bytes' } : {}),
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
