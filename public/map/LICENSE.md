# Static map asset — provenance

Technical plan §7g (decision 6) and §13, open item C.

This directory holds the single static map image the Find os page and the Forside show.
There is no map library, no tile provider and no runtime request to a map service. The
whole preview is one `<img>` inside one `<a>` that opens the guest's own map app.

| Field | Value |
|---|---|
| **Provenance** | `placeholder` |
| File | `klingenberg-food-placeholder.svg` |
| Dimensions | 1200 × 900 (4:3) |
| Source | Drawn for this repository. Not derived from any map data, tile set or aerial imagery. |
| Licence | None required — it depicts nothing real. |
| Attribution required | No. `site_contact.map_attribution` is therefore null. |
| Recorded | 2026-08-29 (phase 3) |

## What has to happen before launch

The placeholder is **launch-blocking** (§7g). Replacing it is a one-file change with no
code edit, because `components/site/StaticMap.tsx` reads the asset's path and intrinsic
size from a single descriptor:

1. Obtain a licensed static map image centred on Lumbyvej 62, 5792 Nørre Lyndelse, with
   the marker in the position this placeholder puts it, in the design's muted warm
   style, at 1× and 2×.
2. Drop it in this directory and point the descriptor at it.
3. Replace the table above: set **Provenance** to the real source, record the licence and
   the date, and set `site_contact.map_attribution` in the administration if the licence
   requires visible credit. The attribution renders as real, selectable text beneath the
   frame — never baked into the image.

The `Provenance: placeholder` line above is the machine-readable marker. `npm run
check:policy` fails if this file or that field goes missing, and the launch checklist
(phase 14) tightens the same check to reject the value `placeholder` in a production
build.
