/**
 * The facts the browser tests assert against — technical plan header, design 1ab.
 *
 * These are the owner-confirmed values, the same ones the tracked content under
 * `content/site/` carries. They are stated once here so a test failure points at the
 * site, not at a number typed twice.
 *
 * The headings are the confirmed launch copy (`content/launch/launch-copy.md`). Every
 * address is served with a trailing slash (`trailingSlash` in `next.config.ts`), which
 * is how the links render and how a static host serves a folder.
 */

/**
 * `title` is the document title §11's pattern produces (`lib/seo/metadata.ts`): one
 * separator, the business name, and no venue repeated into every page's width. The
 * Forside is the exception, because it is the page that has to say what the business is.
 */
export const PUBLIC_ROUTES = [
  {
    path: '/',
    heading: 'Burgeren der vandt Fyn',
    navLabel: 'Forside',
    title: 'Klingenberg Food | Burgerbar i Carl Nielsen Hallen',
  },
  { path: '/menu/', heading: 'Menu', navLabel: 'Menu', title: 'Menu | Klingenberg Food' },
  {
    path: '/mad-ud-af-huset/',
    heading: 'Mad ud af huset',
    navLabel: 'Mad ud af huset',
    title: 'Mad ud af huset | Klingenberg Food',
  },
  {
    path: '/om-os/',
    heading: 'Mad fra Carl Nielsen Hallen',
    navLabel: 'Om os',
    title: 'Om os | Klingenberg Food',
  },
  { path: '/nyheder/', heading: 'Nyheder', navLabel: 'Nyheder', title: 'Nyheder | Klingenberg Food' },
  {
    path: '/find-os/',
    heading: 'Find os',
    navLabel: 'Find os',
    title: 'Find os og åbningstider | Klingenberg Food',
  },
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
