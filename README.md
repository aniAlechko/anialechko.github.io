# Alex Rivkin — Portfolio

An English-only UX/UI portfolio wireframe with local development and a static GitHub Pages export. Content and media are placeholders. Node.js 24 is used for development and publishing; no package installation, framework, or external runtime dependencies are needed.

## Run and check

- `npm run dev` — open http://127.0.0.1:5178 and refresh after edits.
- `npm run check` — syntax-check the server, shared renderer, build script and browser scripts.
- `npm run build` — generate the complete static site in `_site/`.

## GitHub Pages

The publishing target is the root user site, `aniAlechko/anialechko.github.io`, at https://anialechko.github.io/. In the repository's **Settings → Pages**, choose **GitHub Actions** as the source. The workflow in `.github/workflows/pages.yml` checks the source, builds the site, and deploys `_site/` on pushes to `main`. It also supports a manual run from the Actions tab.

Commit the source files, `dist/` and the workflow. `_site/` is generated and ignored by Git. It contains ten complete pages: `index.html`, `work/index.html`, `feed/index.html`, `about/index.html` and six `feed/feed-image-01/index.html` through `feed/feed-image-06/index.html` documents. Shared styles, browser modules and local fonts are copied unchanged. `.nojekyll` is included, and the feed-detail source template is excluded. The build only replaces the generated `_site/` directory inside this repository and refuses a linked output directory.

GitHub Pages serves inner routes from their directories, including direct visits and refreshes. Existing links work with or without a trailing slash. Assets and navigation use root-absolute paths, so this configuration is for a root user site or root custom domain; a project site under `/repository-name/` would need a base-path change. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Where to edit

| File | Owns |
| --- | --- |
| `dist/index.html` | Homepage overview, reusable Work/Feed/About sections, shared header/footer and SVG symbols |
| `dist/styles.css` | All styling; design controls and responsive overrides are at the top |
| `dist/site.js` | Menu, sound demo, scroll reveals, cursor follower and background fabric |
| `dist/navigation.js` | Load-before-transition navigation, history/scroll restoration and page-effect lifecycle |
| `dist/feed-item.html` | One detail template for the six feed entries |
| `dist/fonts/` | Local Rubik variable font and its license; Inter retained for reverting |
| `render.mjs` | Shared route list and full-document rendering for local serving and static export |
| `server.mjs` | Local HTTP server and static assets |
| `build.mjs` | Static export to `_site/` |
| `.github/workflows/pages.yml` | Source checks, static build and GitHub Pages deployment |

The homepage `/` keeps the complete overview. `/work`, `/feed`, and `/about` serve their own pages; feed entries run from `/feed/feed-image-01` to `/feed/feed-image-06`. Section and detail URLs also accept a trailing slash. Inner pages show the ALEX RIVKIN home link, the current navigation item, and one primary heading.

Keep the `page-content:start/end` and `section:work`, `section:feed`, `section:about` start/end markers in `dist/index.html`. The shared renderer selects those sections directly for both the local server and static build, so content is edited once. The About section includes the footer; Work, Feed, and feed details reuse that footer beneath their own content. Shared CSS and JavaScript modules use absolute URLs across every route.

Each route remains a complete document for direct loads, refresh and ordinary links. JavaScript enhances unmodified internal clicks: it fetches and validates the next page and prepares fonts and eager images while the current page remains visible. Only then does it swap content inside a same-document View Transition. The header stays in place and pages slide vertically, without unloading the browser document between routes. Back/Forward restores scroll; hashes stay within their page. New clicks cancel obsolete loads. A failed request leaves the current page available and displays a retry message. Without JavaScript links navigate normally; reduced motion or missing View Transition support switches the prepared content without animation.

`initPage()` in `site.js` returns its cleanup function. Navigation calls it before replacing body content so listeners, observers, video and animation frames do not accumulate. The homepage hero appears immediately, without entrance motion on load or refresh.

## Design controls

Edit the settings at the top of `dist/styles.css`, not individual component rules:

| Control | Purpose |
| --- | --- |
| `--text-name` | CSS name size from local font metrics: three columns on desktop, full width below 1024px |
| `--text-intro` | Hero introduction size |
| `--text-section` | Shared desktop size for WORK and FEED; safe fallback before full-width fitting below 1024px |
| `--text-greeting` | Safe single-line fallback for KAWABANGA* before its measured full-width fit on every viewport |
| `--text-feature`, `--text-body` | Below 1024px: descriptions 24px/32px; biography 19px/26.6px |
| `--text-nav`, `--text-menu` | Desktop navigation and mobile menu |
| `--weight-name`, `--weight-heading` | Name, section headings and main copy 500 |
| `--hero-work-gap` | Hero to WORK: 96px on desktop, 48px below 1024px |
| `--hero-top-gap`, `--hero-row-gap` | Below 1024px: 16px above the reel and 48px between reel, name and introduction |
| `--hero-logos-gap`, `--logo-gap`, `--logo-cycle` | Company placeholders: 32px below the introduction, 32px between logos, 36-second loop |
| `--work-title-gap` | WORK to first image: 32px on all viewports |
| `--row-gap` | Between complete projects, including captions: 64px on desktop, 48px below 1024px |
| `--project-caption-gap` | Image to caption: 26px on desktop, 24px below 1024px |

Responsive overrides sit directly below the desktop settings. On desktop, RIVKIN's visible letter edges fill the three-column name cell. ALEX inherits that size and aligns its visible right edge with RIVKIN. CSS sizes the name from the measured local Rubik metrics at weight 500, without JavaScript fitting; update these metrics if the name, font or weight changes. The introduction uses `(content width - two column gaps) / 31`, about 36px at the maximum. Both stop growing with the content container. Below 1024px, the surname fills the available width and aligns left; the introduction keeps `clamp(22px, 8.6cqw, 64px)`. Main typography uses this common narrow-screen scale without another size switch at 640px. Keep semantic controls separate even when their values match.

The active family is local Rubik Variable (weights 300–900), with a generic sans-serif fallback. The navigation uses weight 600; the name, section headings, introduction, descriptions and biography use 500. Other text inherits 400 unless its component overrides it. Media labels use system monospace. The introduction uses 1.3 line height and -0.02em tracking.

At 1024px and above, WORK and FEED use one shared fluid font size controlled by `--text-section`. KAWABANGA* is explicitly marked `data-fit-width`: the longer greeting fits the content width on one line at every viewport. Below 1024px, every heading uses full-width fitting. Headings share weight 500, line height 0.84 and -0.01em tracking without stretching glyphs. FEED keeps its individual spans and vertical stagger; the name remains on its separate scale. These rules apply to both the homepage overview and the standalone section pages. Existing homepage section anchors remain available for saved links.

`fitDisplayTitles()` in `dist/site.js` measures section headings, writing `--fit-font-size`. Headings marked `data-fit-width` fit on desktop; below 1024px, all section headings use full-width fitting. Other section-heading overrides clear on return to desktop, where CSS owns their shared size; homepage WORK right-aligns to the project grid edge, while standalone WORK aligns left. Fitting recalculates after font loading or width changes and also runs with reduced motion enabled. CSS tokens provide fallbacks, and name sizing remains entirely in CSS. Spacing remains controlled separately by the existing gap tokens.

## Layout and Figma

Desktop uses nine columns, 32px column gaps and an 1184px maximum content width. Hero spans 3/3/3; Work projects span 9/6; Feed heading and introduction span 5/4, and tiles span 2/3/4 then 4/3/2. Side gutters grow from 32px at 1024px to 128px at 1440px.

Below 1024px, six tracks share 16px side gutters, 24px column gaps and 48px row gaps. The hero has three full-width rows: reel, name, introduction, with 16px top spacing. WORK, the second project, FEED heading/intro and About copy also span the full width. At 640px and below, column gaps become 16px, feed tiles stack, and the first project image changes to 4:3. These image-layout changes do not reset the main type scale or 48px spacing.

The [Figma desktop frame](https://www.figma.com/design/RAEfAJBsKlqMt6RMtEdGj5/Alex-Rivkin-Portfolio?node-id=14-15) is a static reference. Compare its 1440px canvas with a browser content width of 1440px (a 1455px viewport when a scrollbar reserves 15px). CSS is the website's source of truth; there is no automatic synchronization with Figma. Visual edits, including optical-size settings, need separate updates and verification there. Figma does not reproduce CSS breakpoints, fluid type, or scroll animation.

## Interactions to preserve

- The header stays visible while scrolling. Hamburger below 1024px: closes with Escape, outside click, navigation, or focus leaving the header. Links remain usable without JavaScript.
- Hero sound control is a demo until a video source is supplied.
- Company 01–06 are fictional logo placeholders beneath the introduction. Edit their single list in `dist/index.html`; JavaScript adds an accessibility-hidden repeat for the seamless CSS loop. The small pause/play control appears on hover, keyboard focus, and touch. Reduced motion shows one static, wrapping list.
- The native pointer remains visible. Its offset follower grows over projects, shows a plus over Feed, and shows sound controls over the hero.
- Gravity affects only the background fabric. Text, media and click targets stay undistorted.
- Motion, cursor and fabric share one animation loop, which rests when settled or hidden. Touch, reduced-motion and forced-colors preferences remain supported.
- Project, résumé and contact placeholders do not have destination pages.
