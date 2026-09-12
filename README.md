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

**GitHub is still the record.** A price change, a new opening time, a news article or a
photograph is a commit — dated, revertible and diffable like any other change. There is
no database and nothing to keep running. What has changed is who writes the commit: the
restaurant does, from **Pages CMS**, without opening GitHub at all.

| What | Where |
|---|---|
| The menu, section by section, and the tapas board | [`content/site/menu.json`](content/site/menu.json), [`weekly-special.json`](content/site/weekly-special.json), [`monthly-burger.json`](content/site/monthly-burger.json) |
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

The restaurant edits in **Pages CMS** and presses **Gem**. That is the whole of the
normal workflow: no GitHub, no Netlify, no command to run, and nothing to approve.

Each save sets off this chain, and every step of it is automatic:

```
Pages CMS                        the restaurant presses Gem
    │
    ▼
content branch                   the save lands as a commit here
    │
    ▼
Publish a CMS save               the doorbell (cms-content-trigger.yml, on content)
    │
    ▼
Publish CMS content              composes the save onto main (cms-publish.yml)
    │
    ▼
cms-publish pull request         one branch, one pull request, auto-merge armed
    │
    ▼
CI                               the same required checks as every other change
    │
    ▼
main                             GitHub's auto-merge lands it
    │
    ▼
Netlify                          builds and publishes the site
```

**Only two directories cross from `content` into production:**

```
content/site/**      the JSON the pages are rendered from
public/photos/**     the photographs themselves
```

[`scripts/cms/compose-publication.mjs`](scripts/cms/compose-publication.mjs) is that
allow-list, and it is the only thing that copies anything: every other path in a
publication is `main`'s own, whatever the `content` branch says about it.

`.pages.yml` is Pages CMS's own configuration — it lives on the `content` branch, it
describes the editing forms and their Danish labels, and it is **never published**.
Neither Next.js, the build nor the tests read it.

`main` is protected, and nothing in this chain can push to it. A publication reaches
production by passing the same required checks as any other pull request, or it does
not reach production at all.

### When a CMS publication fails

If a publication fails in a way that needs a developer,
[`.github/workflows/cms-publication-status.yml`](.github/workflows/cms-publication-status.yml)
opens a single Danish issue titled **"CMS: Udgivelse kræver hjælp"**, with a link to the
run that failed. It comments on that same issue rather than opening a second one, and it
closes the issue by itself once a CMS publication reaches `main` again.

When that issue appears:

1. **Open the linked Actions run** and find the step that failed.
2. **Never merge a red `cms-publish` pull request by hand.** It is red because something
   would have reached the public site that should not.
3. **If `check:content` rejected the restaurant's content** — a price that is not a
   number, a date that is not a date, a required field left blank — the fix is in Pages
   CMS. Correct the field and press **Gem** again. No code change is needed.
4. **If the content was fine and the application rejected it** — a test that quotes copy
   the restaurant is allowed to rewrite, a loader that cannot read a shape the CMS can
   now produce — the fix belongs in the application, through an ordinary feature pull
   request to `main`.
5. **After that fix is on `main`**, run **Publish CMS content** once by hand (Actions →
   Publish CMS content → Run workflow) to republish the current content snapshot. The
   restaurant does not need to save again.
6. **A successful publication closes the issue automatically.** If it stays open, no
   publication has landed yet.

Two things that look like failures and are not:

- **A cancelled publication is normal.** Two saves a minute apart cancel the first run on
  purpose, so that the newer content is what gets published. No issue is opened for it.
- **Production is never left half-changed.** While publication is broken, `main` — and
  therefore the live site — stays on the last version that passed every check. A failed
  publication makes the site stale, never wrong.

### Changing the content as a developer

Editing a file by hand still works, and is the right thing for a change Pages CMS cannot
express — with one rule about **where** the edit has to exist.

**Under `content/site/**` and `public/photos/**`, the `content` branch is the source of
truth, not `main`.** The restaurant edits in Pages CMS, Pages CMS writes the `content`
branch, and every publication replaces those two directories on `main` with the `content`
branch's copy, whole (see [Changing the content](#changing-the-content)). A hand-edit
made only on `main` merges, and then disappears at the next **Gem**, when the publisher
writes the restaurant's snapshot over it. So a change under either root must also be
reflected on `content` — the same edit there, or made through Pages CMS. Application and
source-code changes are unaffected: they follow the normal route of feature branch →
pull request → `main`.

1. Edit the file and open a pull request to `main`.
2. `npm run check` — typecheck, lint, source policy, content validation, unit tests.
3. `npm run build` — the site is rebuilt in `out/`.

Be careful what a test asserts about content. **The unit suites do not freeze the
restaurant's own values** — not the number of sections, not a dish's price, not a
sentence of the Forside's prose — because each of those is an ordinary Pages CMS field,
and a test that quotes one turns the next ordinary save into a red build that blocks its
own publication. That has happened. What the suites hold is the *shape* of the content
and the rules the pages depend on: that a section's id is a usable anchor, that no two
sections share one, that a price can be read as a price.
[`tests/unit/content/static-site.test.ts`](tests/unit/content/static-site.test.ts) states
the rule at the top of the file, and `.pages.yml` — on the `content` branch — is the
authority on which fields are the restaurant's.

### Adding a photograph

The restaurant adds photographs in Pages CMS, which uploads them into `public/photos/`
and writes the reference into the content for you. By hand, the same two steps are:

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
