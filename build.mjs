import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = await realpath(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(projectRoot, 'site');
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

// Read every page, including directory indexes, before replacing the last successful build.
async function readPages(directory, prefix = '') {
  const children = await readdir(directory, { withFileTypes: true });
  const pages = await Promise.all(children.map(async entry => {
    const name = prefix + entry.name;
    if (entry.isDirectory()) return readPages(resolve(directory, entry.name), `${name}/`);
    if (entry.isFile() && entry.name.endsWith('.html')) {
      return { name, html: await readFile(resolve(directory, entry.name), 'utf8') };
    }
    return [];
  }));
  return pages.flat();
}
const pages = await readPages(sourceRoot);

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
  if (entry.isFile() && entry.name.endsWith('.html')) continue;
  await cp(resolve(sourceRoot, entry.name), resolve(outputRoot, entry.name), { recursive: true });
}
for (const asset of assets.filter(asset => asset.name.endsWith('.js'))) {
  await writeFile(resolve(outputRoot, asset.name), versionModuleImports(asset.source));
}
for (const page of pages) await writeFile(resolve(outputRoot, page.name), versionHtmlAssets(page.html));
await writeFile(resolve(outputRoot, '.nojekyll'), '');
console.log(`Built portfolio in ${outputRoot}`);
