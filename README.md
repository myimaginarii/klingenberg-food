# Klingenberg Food

The website of Klingenberg Food, Carl Nielsen Hallen — a **static Next.js site** built
from content tracked in this repository.

There is no database, no admin dashboard, no API, no authentication and no server of any
kind. `npm run build` reads the files under `content/`, renders every page to HTML, and
writes the whole site to `out/`. That directory is the deployable artefact, and any
static host serves it.

- **Design source of truth** — [`docs/design/Klingenberg Food Hi-fi.dc.html`](docs/design), screens 1a–1ab
- **Architecture history** — [`docs/technical-plan.md`](docs/technical-plan.md) describes the
  earlier database-backed system this one replaced. The code's `§`-references point into
  it. It is a record, not a description of what runs now.

## How it works

```
content/site/**/*.json   the restaurant's content, as JSON read by lib/content/load/
public/photos/           the photographs themselves, one tracked file each
        │
        │  npm run build
        ▼
generated/images.json    each photograph's measured size, written by sharp
public/media/<slot>/     AVIF + WebP derivatives, rendered by sharp at build time
out/                     the finished site: one index.html per page, plus the assets
```

**GitHub is the source of truth.** A price change, a new opening time, a news article or
a photograph is a commit — reviewed, dated and revertible like any other change. There is
nothing to log into and nothing to keep running.

| What | Where |
|---|---|
| Menu: nine sections, forty-six dishes, the tapas board | [`content/site/menu.json`](content/site/menu.json), [`weekly-special.json`](content/site/weekly-special.json), [`monthly-burger.json`](content/site/monthly-burger.json) |
| Opening hours and one-off changes | [`content/site/hours.json`](content/site/hours.json) |
| Address, telephone numbers, e-mail, Facebook | [`content/site/contact.json`](content/site/contact.json) |
| Forside, Om os and Mad ud af huset wording | [`content/site/pages/`](content/site/pages/), the award in [`award.json`](content/site/award.json) |
| News articles (there are none yet) | [`content/site/news/`](content/site/news/) |
| The sitewide message bar (there is none) | [`content/site/announcement.json`](content/site/announcement.json) |
| The photographs | [`public/photos/`](public/photos/) — each one selected, described and cropped by the content that shows it |

Each file explains what it holds and what adding an entry means. Nothing is invented:
where the restaurant has not supplied a fact, the page renders its designed empty state
rather than a placeholder.

### Changing the content

1. Edit the file above and commit.
2. `npm run check` — typecheck, lint, source policy, unit tests.
3. `npm run build` — the site is rebuilt in `out/`.

The unit suite holds the content to the confirmed facts (`tests/unit/content/static-site.test.ts`):
the nine sections, the forty-six dishes, the absence of anything nobody confirmed. A
change that breaks one of those is a failing test, not a surprise on the live site.

### Adding a photograph

1. Put the file in `public/photos/`, named in lower-case letters, digits and single
   hyphens: `dish-odin.png`, `home-hero.jpg`. `jpg`, `jpeg`, `png` and `webp` are
   accepted; the name is the photograph's identity everywhere else.
2. Name it from the content that shows it, in that thing's own JSON file:

   ```json
   "photo": { "file": "/photos/dish-odin.png", "alt": "", "focus": "center" }
   ```

   `alt` is the description a screen reader hears — empty is right for a photograph
   sitting beside the text that already names it, and nothing is invented to fill it.
   `focus` is `center` or `upper`, and says which part of the photograph a frame keeps
   when it has to crop. `null` instead of the object means the frame has no photograph,
   which is a real answer: the menu draws its reserved "Retfoto" card, and the pages
   that have no photograph give their text the full width.

Nothing else is maintained by hand. `scripts/images/build-static-derivatives.mjs` runs
before every dev server, build and test run: it measures each source with sharp into
`generated/images.json`, renders the derivative ladder — AVIF and WebP at
480 / 960 / 1440 / 2160, never upscaled — into `public/media/<name>/`, and deletes
whatever the current photographs no longer plan, so a replaced or removed photograph
leaves nothing stale behind. It refuses a name it cannot use, two files that would claim
one folder, and a file it cannot read as an image. Both outputs are git-ignored; the
photographs and the content that names them are the record.

## Deployment

`out/` is the whole deployable artefact, so any static host serves it. Two are configured,
and both run the same `npm run build` and publish the same directory. Neither **needs a
secret of any kind** — building and serving this site requires nothing but the repository,
and `npm run check:policy` fails if a backend name reappears anywhere.

**GitHub Pages**, through [`.github/workflows/pages.yml`](.github/workflows/pages.yml):
the workflow builds the export, uploads `out/` and publishes it, on a push to `main` and on
`workflow_dispatch`. `out/.nojekyll` (tracked as `public/.nojekyll`) keeps GitHub from
running the export through Jekyll, which would drop `_next/`.

**Netlify**, through [`netlify.toml`](netlify.toml): `npm ci && npm run build`, publish
`out/`, and nothing else — no function, no edge function, no database, no blob store.
`NETLIFY_NEXT_PLUGIN_SKIP` switches off Netlify's Next.js adapter, which exists to
provision the infrastructure a Next.js *server* needs and has nothing to do for an export.

### The address the site prints

Canonical URLs, the sitemap, the Open Graph URLs and `basePath` in
[`next.config.ts`](next.config.ts) all resolve through
[`lib/config/site.ts`](lib/config/site.ts) and nowhere else. It reads, in order:

1. **`SITE_URL`** — the deployment's **full** public address, origin *and* sub-path:

   ```
   SITE_URL=https://example.test           # the root of a host: no base path
   SITE_URL=https://example.test/a-repo/   # a project site: basePath /a-repo
   ```

   A GitHub Pages *project* site is the second form —
   `https://<owner>.github.io/<repository>/` — and the workflow takes the value from
   `actions/configure-pages`, which reports the address GitHub actually assigned.

2. **Netlify's own read-only variables**, on a Netlify builder and nowhere else: `URL` on a
   production deploy, `DEPLOY_PRIME_URL` on a Deploy Preview or branch deploy, so a preview
   prints its own address instead of claiming to be production. A Netlify site is served at
   the root of its host, so there is no base path, and attaching a custom domain later
   changes `URL` with no edit here. Netlify therefore needs **no environment variable set
   by hand**.

3. **`http://localhost:3000`**, with no base path — local development, and any build that
   states nothing.

Nothing in the repository writes an address down, so choosing the restaurant's domain
stays a configuration change rather than a code change.

To reproduce a project-site build locally and browse it the way GitHub Pages serves it:

```bash
SITE_URL=https://example.test/a-repo/ npm run build
npm start -- --base /a-repo          # http://localhost:3000/a-repo/
```

### Security headers

`headers()` is a server feature and does nothing in an export, so the response headers are
the host's to send. [`netlify.toml`](netlify.toml) states them — CSP, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, HSTS — with a comment recording
what each directive was measured against in the built output. GitHub Pages sends its own
defaults and cannot be given a policy.

The site is `noindex` until launch (`app/layout.tsx`).

## Running it

Node 24 or newer (`.nvmrc`).

```bash
npm ci
npm run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | The static export, into `out/` |
| `npm start` | Serves `out/` the way a static host would — directory indexes, trailing-slash redirects, `404.html`. `-- --base /prefix` mounts it under a sub-path, as a Pages project site is served |
| `npm run check` | Typecheck, lint, source policy, unit tests |
| `npm run test:e2e` | Playwright: desktop, mobile and a no-JavaScript pass, plus the accessibility suite, all against the built export |
| `npm run check:all` | Everything above, in order |

## The pages

`/` · `/menu/` · `/mad-ud-af-huset/` · `/om-os/` · `/nyheder/` · `/find-os/`, plus the
designed 404 and `/sitemap.xml`. Every address ends in a slash, because every page is a
directory with an `index.html` — which is what a static host serves for a folder.

## What the browser does

Almost nothing, on purpose. A visitor receives **zero cookies**, and the site makes no
request to any third party except the Google Maps embed on Find os. Fonts are
self-hosted.

Five components run in the browser, and three of them exist for one reason: **a static
site has no useful clock.** Every page was rendered once, when the site was built, so
anything that depends on "now" is decided in the browser or not claimed at all.

- The open/closed badge is neutral in the HTML — it reads "Åbningstider" — and the
  browser replaces it with "Åbent nu · til kl. 20:00" or "Lukket", rechecked every minute.
- The hours table marks no row as today until the browser says which one it is.
- An announcement whose expiry passes while the page is open removes itself.

Without JavaScript the site works completely: every page, every link, the fullscreen
menu, the seven-day hours disclosure and the telephone actions. What a visitor loses is
the live badge and the "· i dag" marker — and what they gain is that nothing on the page
claims something it cannot know. `tests/e2e/no-javascript.spec.ts` holds it to that.
