/**
 * The facts the browser tests assert against — technical plan header, design 1ab.
 *
 * These are the owner-confirmed values, the same ones the tracked content under
 * `content/site/` carries (and `supabase/seed/confirmed.sql` before it). They are
 * stated once here so a test failure points at the site, not at a number typed twice.
 *
 * The headings are the confirmed launch copy (`content/launch/launch-copy.md`). Every
 * address is served with a trailing slash (`trailingSlash` in `next.config.ts`), which
 * is how the links render and how a static host serves a folder.
 */

export const PUBLIC_ROUTES = [
  { path: '/', heading: 'Burgeren der vandt Fyn', navLabel: 'Forside' },
  { path: '/menu/', heading: 'Menu', navLabel: 'Menu' },
  { path: '/mad-ud-af-huset/', heading: 'Mad ud af huset', navLabel: 'Mad ud af huset' },
  { path: '/om-os/', heading: 'Mad fra Carl Nielsen Hallen', navLabel: 'Om os' },
  { path: '/nyheder/', heading: 'Nyheder', navLabel: 'Nyheder' },
  { path: '/find-os/', heading: 'Find os', navLabel: 'Find os' },
] as const

export const PRIMARY_PHONE = '+45 63 90 83 00'
export const SECONDARY_PHONE = '+45 51 79 45 66'
export const PRIMARY_TEL_HREF = 'tel:+4563908300'
export const SECONDARY_TEL_HREF = 'tel:+4551794566'

export const ADDRESS_LINE = 'Lumbyvej 62, 5792 Nørre Lyndelse'

/** The public e-mail address, confirmed in the C4 factual check and printed on Find os. */
export const PUBLIC_EMAIL = 'soebylarsen@gmail.com'
export const PUBLIC_EMAIL_HREF = 'mailto:soebylarsen@gmail.com'

/** The nine confirmed menu sections, in the approved order (1h, 1m). */
export const MENU_CATEGORIES = [
  { name: 'Burgere', anchor: 'menu-burgere' },
  { name: 'Ugens ret', anchor: 'menu-ugens-ret' },
  { name: 'Andre retter', anchor: 'menu-andre-retter' },
  { name: 'Pommes & snacks', anchor: 'menu-pommes-og-snacks' },
  { name: 'Børn', anchor: 'menu-boern' },
  { name: 'Drikkevarer', anchor: 'menu-drikkevarer' },
  { name: 'Dessert', anchor: 'menu-dessert' },
  { name: 'Tapas', anchor: 'menu-tapas' },
  { name: 'Varm selv', anchor: 'menu-varm-selv' },
] as const
