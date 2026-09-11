import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { loadMenu } from '@/lib/content/load/menu'
import { loadAboutPage, loadHomePage, loadTakeawayPage } from '@/lib/content/load/pages'
import { buildMenuView, categoryAnchorId, selectFeaturedDishes } from '@/lib/menu/view'
import { ABOUT_DEFAULT_HEADING } from '@/lib/site/defaults'
import { telHref } from '@/lib/site/links'

/**
 * What the browser tests expect to find on the running site — read from the same
 * content the build was made from, never written down a second time.
 *
 * This file used to be a list of confirmed facts: the launch headings, the two
 * telephone numbers, the nine section names. That was right while the launch copy was
 * the source of truth and nobody could change it, and it stopped being right the day
 * Pages CMS was connected. Almost everything on it — every heading, the numbers, the
 * e-mail address, the sections and their order — is an ordinary editable field, so a
 * copy of it here is a second source of truth that goes stale the first time the
 * restaurant saves, and takes CI red with it.
 *
 * So the values are **loaded**. `content/site/` is what the static export was built
 * from, and these loaders are the ones the pages themselves use, which makes every
 * assertion downstream a correspondence — *the page prints what the document says* —
 * rather than a quotation. The failure it can still catch is the one worth catching: a
 * page that shows something other than its own content, or shows nothing at all.
 *
 * What stays written down is what is not the restaurant's to change: the addresses the
 * routes are served at, the navigation vocabulary, the title pattern §11 produces
 * (`lib/seo/metadata.ts` — a code-side fact, not a content one), and the locked venue
 * address. Every address is served with a trailing slash (`trailingSlash` in
 * `next.config.ts`), which is how the links render and how a static host serves a folder.
 */

const CONTACT = loadContact()
const MENU = loadMenu()
const HOURS = loadOpeningHours()

/**
 * The `<h1>` each page renders.
 *
 * Three of the six are the pages' own words and three are their documents'. The
 * fallbacks are the pages' own (`app/(site)/page.tsx`, `AboutPageContent`,
 * `app/(site)/mad-ud-af-huset/page.tsx`) and apply only to a document that sets no
 * heading — they are the page's vocabulary, not the restaurant's content.
 */
const HOME_HEADING = loadHomePage().hero.heading ?? 'Klingenberg Food'
const ABOUT_HEADING = loadAboutPage().heading ?? ABOUT_DEFAULT_HEADING
const TAKEAWAY_HEADING = loadTakeawayPage().heading ?? 'Mad ud af huset'

/**
 * `title` is the document title §11's pattern produces (`lib/seo/metadata.ts`): one
 * separator, the business name, and no venue repeated into every page's width. The
 * Forside is the exception, because it is the page that has to say what the business is.
 * Titles are written in code and are not editable, so they are stated rather than loaded.
 */
export const PUBLIC_ROUTES = [
  {
    path: '/',
    heading: HOME_HEADING,
    navLabel: 'Forside',
    title: 'Klingenberg Food | Burgerbar i Carl Nielsen Hallen',
  },
  { path: '/menu/', heading: 'Menu', navLabel: 'Menu', title: 'Menu | Klingenberg Food' },
  {
    path: '/mad-ud-af-huset/',
    heading: TAKEAWAY_HEADING,
    navLabel: 'Mad ud af huset',
    title: 'Mad ud af huset | Klingenberg Food',
  },
  {
    path: '/om-os/',
    heading: ABOUT_HEADING,
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

/**
 * The telephone numbers, as `content/site/contact.json` carries them.
 *
 * The primary number is required — a restaurant that takes its orders by telephone
 * without one is not a state the design has, and `check:content` refuses it. The second
 * is Pages CMS's optional "Ekstra telefon", so it is `null` when there is none and the
 * suites that assert on it skip rather than fail.
 */
export const PRIMARY_PHONE = CONTACT.primaryPhone as string
export const SECONDARY_PHONE = CONTACT.secondaryPhone
export const PRIMARY_TEL_HREF = telHref(PRIMARY_PHONE)
export const SECONDARY_TEL_HREF = SECONDARY_PHONE === null ? null : telHref(SECONDARY_PHONE)

/**
 * The venue address — the one contact block that is **not** editable. Pages CMS marks
 * `venueName`, `addressLine1`, `postalCode` and `city` `readonly: true`, because the
 * restaurant does not move, and a wrong address is the one mistake on this site a guest
 * cannot recover from. Still read from the document rather than quoted, so the page and
 * the map link are proved to agree with it.
 */
export const ADDRESS_LINE = `${CONTACT.addressLine1}, ${CONTACT.postalCode} ${CONTACT.city}`
export const VENUE_NAME = CONTACT.venueName as string

/** The public e-mail address, printed on Find os and in every footer. Required. */
export const PUBLIC_EMAIL = CONTACT.email as string
export const PUBLIC_EMAIL_HREF = `mailto:${PUBLIC_EMAIL}`

/** The Facebook page, or `null` when the restaurant lists none. */
export const FACEBOOK_URL = CONTACT.facebookUrl

/** The menu's sections, in the order the document lists them, with the anchor each one gets. */
export const MENU_CATEGORIES = MENU.categories.map((category) => ({
  name: category.name,
  anchor: categoryAnchorId(category.slug),
  kind: category.kind,
}))

/** The published opening hours the pages print. */
export const SCHEDULE = HOURS.schedule
export const HOURS_OVERRIDES = HOURS.overrides

/** The whole menu, for the suites that check what the page lists against it. */
export const MENU_CONTENT = MENU

/**
 * The menu as a page draws it.
 *
 * The site is a static export, so a page's answers to the two time-dependent questions —
 * is this sold out, is Månedens burger inside its window — were decided when the build
 * ran. Asked here at test time, which is the same day; a run that straddles one of those
 * boundaries is a property of a prerendered site rather than something a suite can
 * paper over.
 */
export const MENU_VIEW = buildMenuView(MENU, HOURS, new Date())

/** The dishes marked "Vis på forsiden", in menu order — however many that is. */
export const FEATURED_DISHES = selectFeaturedDishes(MENU_VIEW.categories)

/** Månedens burger when today falls inside its window, otherwise `null`. */
export const MONTHLY_BURGER = MENU_VIEW.monthlyBurger

/** Ugens ret when a week is published, otherwise `null`. */
export const WEEKLY_SPECIAL =
  MENU_VIEW.weeklySpecial?.name === null ? null : MENU_VIEW.weeklySpecial

/** Every dish on the card, in the order the sections list them. */
export const EVERY_DISH = MENU_VIEW.categories.flatMap((category) => category.dishes)

/** The tapas board, whose three headings and items the menu page prints. */
export const TAPAS = MENU.tapas

/** The takeaway page's document, whose prose and button label the page prints. */
export const TAKEAWAY = loadTakeawayPage()
