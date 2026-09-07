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
content/site/*.ts        the restaurant's content, as typed TypeScript
content/launch/photos/   the photographs, as supplied
        │
        │  npm run build
        ▼
public/media/<slot>/     AVIF + WebP derivatives, rendered by sharp at build time
out/                     the finished site: one index.html per page, plus the assets
```

**GitHub is the source of truth.** A price change, a new opening time, a news article or
a photograph is a commit — reviewed, dated and revertible like any other change. There is
nothing to log into and nothing to keep running.

| What | Where |
|---|---|
| Menu: nine sections, forty-six dishes, the tapas board | [`content/site/menu.ts`](content/site/menu.ts) |
| Opening hours and one-off changes | [`content/site/hours.ts`](content/site/hours.ts) |
| Address, telephone numbers, e-mail, Facebook | [`content/site/contact.ts`](content/site/contact.ts) |
| Forside, Om os and Mad ud af huset wording | [`content/site/pages.ts`](content/site/pages.ts) |
| News articles (there are none yet) | [`content/site/news.ts`](content/site/news.ts) |
| The sitewide message bar (there is none) | [`content/site/announcement.ts`](content/site/announcement.ts) |
| The photographs, and the description each one carries | [`content/site/photos.json`](content/site/photos.json) |

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

1. Put the file in `content/launch/photos/`.
2. Add an entry to `content/site/photos.json` — the slot name, the file, its measured
   width and height, and the description a screen reader should hear (`null` renders
   `alt=""`, which is right for a photograph sitting beside the text that names it).
3. Reference the slot with `launchPhoto('<slot>')` where the page needs it.

`scripts/images/build-static-derivatives.mjs` renders the derivative ladder — AVIF and
WebP at 480 / 960 / 1440 / 2160, never upscaled — into `public/media/<slot>/` on every
build, and refuses a source whose real dimensions differ from the recorded ones. The
rendered files are git-ignored; the tracked source and the registry are the record.

## Deployment

**GitHub Pages** is the target, through
[`.github/workflows/pages.yml`](.github/workflows/pages.yml): the workflow builds the
export, uploads `out/` and publishes it. It runs on a push to `main` and on
`workflow_dispatch`, and **needs no secret of any kind** — it reads nothing from
`secrets`, because building and serving this site requires nothing but the repository.
`npm run check:policy` fails the build if a backend name reappears anywhere.

One optional build-time variable exists, `SITE_URL`. It states the deployment's **full**
public address — origin *and* sub-path — and two things derive from it:

* every absolute URL the site prints (canonical, sitemap, Open Graph, JSON-LD);
* `basePath` in [`next.config.ts`](next.config.ts), for a site served under a sub-path.

```
SITE_URL=https://example.test           # the root of a host: no base path
SITE_URL=https://example.test/a-repo/   # a GitHub Pages project site: basePath /a-repo
```

A GitHub Pages *project* site is the second form — `https://<owner>.github.io/<repository>/`
— and the workflow takes the value from `actions/configure-pages`, which reports the
address GitHub actually assigned. Nothing in the repository writes an address down, so
both moving to a custom domain and dropping the sub-path are configuration, never a code
change. Unset, it falls back to `http://localhost:3000` with no base path, which is what
local development uses.

To reproduce a project-site build locally and browse it the way the deployment serves it:

```bash
SITE_URL=https://example.test/a-repo/ npm run build
npm start -- --base /a-repo          # http://localhost:3000/a-repo/
```

`out/.nojekyll` (tracked as `public/.nojekyll`) keeps GitHub from running the export
through Jekyll, which would drop `_next/`.

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
