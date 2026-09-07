# Launch content — safeguarded source material

This folder holds the source material needed to reproduce the finished public site's
real copy and photographs. It is **not read by the application** at build or run time.
It was created before the static rebuild (branch `static-rebuild`, archive tag
`pre-static-rebuild`) so that the finished design could not be lost when the
Supabase/admin architecture was retired. It since has been: the site now renders from
`content/site/`, and this folder is the provenance record for what went in there.

Before this folder existed the material lived only in the git-ignored `launch-assets/`
operator folder and, for a while, in the local image library and page editors — neither
of which survived a database reset. The table below is now the whole record.

## What is here

- `launch-copy.md` — the confirmed launch copy for Forside, Om os and Mad ud af huset,
  plus the contact facts, verbatim as supplied. Its own preamble says it is temporary
  launch text that must not be extended with unconfirmed facts. It has **not** been
  rewritten or humanized here. In the finished design each editor field was filled by
  joining that field's source paragraphs, unrewritten (technical plan, phase 14B2).
- `photos/` — the six supplied photographs the finished design actually uses, byte for
  byte as supplied, renamed after the slot they fill.

| Tracked file | Supplied as | Where the finished design uses it |
|---|---|---|
| `photos/home-hero-bacon-egg-burger.png` | `bacon-egg-burger.png` | Forside hero photograph (an unnamed dish; the hero makes no dish claim) |
| `photos/about-venue-dining-room.png` | `facade.png` | Om os venue slot ("Billede af stedet" — the dining room, not an exterior) **and** the Forside "Om os (uddrag)" slot: one photograph, two surfaces |
| `photos/takeaway-sandwich-trio.png` | `sandwich-trio.png` | Mad ud af huset page photograph |
| `photos/dish-odin.png` | `odin.png` | The **Odin** dish's photograph on the menu |
| `photos/dish-ragnar.png` | `ragnar.png` | The **Ragnar** dish's photograph on the menu |
| `photos/dish-tapas.png` | `tapaz.png` | The **Tapas** dish's photograph. Stored against the dish; the public Tapas board is a text table by design and renders no photo |

The photographs' descriptions are now tracked with the photographs, in
`content/site/photos.json`, which is what the pages read.

## What is kept elsewhere

- The logo (`logo.svg`, the handmade K, unaltered) is already committed as
  `public/brand/logo.svg` and `app/icon.svg`. It is not duplicated here.
- The confirmed menu, prices, tapas lists, contact details and opening hours are the
  tracked content the site renders, under `content/site/`.

## What was deliberately left out

Fourteen supplied photographs carry no confirmed dish identity and fill no slot in the
finished design, so they are not tracked: `bacon-red-onion-burger`, `bestla`,
`boefsandwich`, `chicken-red-cabbage-sandwich`, `double-crispy-chicken-burger`, `freja`,
`ivar`, `jacksparrow`, `norden`, `pulled-pork-crispy-burger`, `shwarma`, `valhalla`,
`wienerschnitzel`, `ydun`. A resemblance is not an identification; they stay in the
operator's `launch-assets/` folder for the restaurant to identify later.

The Om os team and kitchen slots and the Forside award slot have no supplied
photograph and render text-only or as the accepted no-image frame, by design.
