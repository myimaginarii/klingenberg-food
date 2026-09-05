/**
 * The static map asset — technical plan §7g (decision 6), §13 item C; phase 14A.
 *
 * The one descriptor of the Find os / Forside map image: its public path and its
 * intrinsic size. `components/site/StaticMap.tsx` renders it; the launch guard
 * (`./map-launch-guard.ts`, run by `next.config.ts` at build time) checks it
 * against `public/map/LICENSE.md` before a real production deployment.
 *
 * Swapping the placeholder for the licensed image (phase 14B) is this one object
 * and the licence file: no component edit.
 */
export const MAP_ASSET = {
  src: '/map/klingenberg-food-placeholder.svg',
  width: 1200,
  height: 900,
} as const

/** The provenance record the launch guard reads (§7g, §11). */
export const MAP_LICENCE_FILE = 'public/map/LICENSE.md'
