import { cp, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageRoutes, renderPage } from './render.mjs';

const projectRoot = await realpath(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = resolve(projectRoot, 'dist');
const outputRoot = resolve(projectRoot, '_site');

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

for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (entry.name === 'index.html' || entry.name === 'feed-item.html') continue;
  await cp(resolve(sourceRoot, entry.name), resolve(outputRoot, entry.name), { recursive: true });
}
for (const { route, html } of pages) {
  const directory = resolve(outputRoot, `.${route}`);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.html'), html);
}
await writeFile(resolve(outputRoot, '.nojekyll'), '');
console.log(`Built ${pages.length} pages and shared assets in ${outputRoot}`);
