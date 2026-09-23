import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageRoutes, renderPage } from './render.mjs';

const projectRoot = await realpath(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(projectRoot, 'dist');
const outputRoot = resolve(projectRoot, '_site');

// One content version keeps the stylesheet and the complete module graph in sync.
const entries = await readdir(sourceRoot, { withFileTypes: true });
const assets = await Promise.all(entries
  .filter(entry => entry.isFile() && /\.(?:js|css)$/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  .map(async entry => ({ name: entry.name, source: await readFile(resolve(sourceRoot, entry.name), 'utf8') })));
const hash = createHash('sha256');
for (const asset of assets) hash.update(asset.name).update('\0').update(asset.source).update('\0');
const assetVersion = hash.digest('hex').slice(0, 12);
const assetNames = new Set(assets.map(asset => asset.name));

function versionAssetUrl(url) {
  const match = url.match(/^(\/|\.\/)([^/?#]+)(\?[^#]*)?(#.*)?$/);
  if (!match || !assetNames.has(match[2])) return url;
  const query = new URLSearchParams(match[3] || '');
  query.set('v', assetVersion);
  return `${match[1]}${match[2]}?${query}${match[4] || ''}`;
}

function versionModuleImports(source) {
  return source.replace(/(\b(?:from\s+|import\s*(?:\(\s*)?))(["'])(\.\/[^"']+)\2/g,
    (_, prefix, quote, url) => `${prefix}${quote}${versionAssetUrl(url)}${quote}`);
}

function versionHtmlAssets(html) {
  return html.replace(/\b(src|href)=(["'])([^"']+)\2/g,
    (_, attribute, quote, url) => `${attribute}=${quote}${versionAssetUrl(url)}${quote}`);
}

// Render first, so an invalid source cannot erase the last successful export.
const pages = await Promise.all(pageRoutes.map(async route => ({ route, html: await renderPage(route) })));

// Only the generated _site directory directly inside this repository may be removed.
if (dirname(outputRoot) !== projectRoot || !outputRoot.startsWith(projectRoot + sep)) {
  throw new Error(`Unsafe build output: ${outputRoot}`);
}
try {
  const existing = await lstat(outputRoot);
  if (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(outputRoot) !== outputRoot) {
    throw new Error(`Build output must be a regular directory inside the repository: ${outputRoot}`);
  }
  await rm(outputRoot, { recursive: true, force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(outputRoot, { recursive: true });

for (const entry of entries) {
  if (entry.name === 'index.html' || entry.name === 'feed-item.html') continue;
  await cp(resolve(sourceRoot, entry.name), resolve(outputRoot, entry.name), { recursive: true });
}
for (const asset of assets.filter(asset => asset.name.endsWith('.js'))) {
  await writeFile(resolve(outputRoot, asset.name), versionModuleImports(asset.source));
}
for (const { route, html } of pages) {
  const directory = resolve(outputRoot, `.${route}`);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.html'), versionHtmlAssets(html));
}
await writeFile(resolve(outputRoot, '.nojekyll'), '');
console.log(`Built ${pages.length} pages and shared assets in ${outputRoot}`);
