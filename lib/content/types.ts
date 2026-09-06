import type { AnnouncementLink } from '@/lib/announcements/link'
import type { PublicImage } from '@/lib/images/public'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * The shape of published content as the public site consumes it — technical plan §4.
 *
 * These are *domain* types, not row types. The database columns are snake_case and
 * carry draft and administration fields the public half has no business seeing; the
 * loaders in this folder map each row down to exactly what a page needs, in camelCase,
 * with prices in øre and dates as civil `YYYY-MM-DD` strings.
 *
 * Nothing here is a `Date`. Every value is a primitive that survives serialisation
 * unchanged, so a page can pass it to a Client Component (the open/closed badge) with
 * no conversion step to get wrong.
 */

/** `site_contact` — the facts that appear on every page (§4). */
export type SiteContact = {
  venueName: string | null
  addressLine1: string | null
  postalCode: string | null
  city: string | null
  primaryPhone: string | null
  secondaryPhone: string | null
  email: string | null
  facebookUrl: string | null
  mapAttribution: string | null
}

/** One of the four short labels a dish may carry (1aa "Mærkater & status"). */
export type DishLabel = string

/**
 * The Tapas content document (§4, decision 3).
 *
 * Three fixed groups whose ids and count are part of the schema; only the heading and
 * the items are editable. This is a content list and not an ordering configurator:
 * nothing is selectable by a visitor and nothing is priced per item.
 */
export type TapasGroup = {
  id: 'base' | 'choose7' | 'dressing'
  heading: string
  mode: 'fixed' | 'choose'
  choose: number | null
  items: string[]
}

export type TapasDetails = {
  kind: 'tapas'
  groups: TapasGroup[]
}

/** `dishes`, reduced to what the public menu renders. */
export type Dish = {
  id: string
  name: string
  description: string | null
  /** "Som menu med pommes frites og sodavand 124 kr." (1h), "1 kg · frost" (Varm selv). */
  secondaryNote: string | null
  priceOre: number | null
  labels: DishLabel[]
  /** Present only for the Tapas entry; `null` for every ordinary dish. */
  tapas: TapasDetails | null
  /** Copenhagen-local date the item was marked sold out. `null` = available (§7b). */
  soldOutOn: IsoDate | null
  /** The dish's library photo as the public site renders it, or `null` (phase 10C-2). */
  image: PublicImage | null
}

/** `menu_categories.kind` — an ordinary list of dishes, or the Ugens ret section. */
export type MenuCategoryKind = 'dishes' | 'weekly_special'

/** `menu_categories` with its dishes already attached — one grouped read, never N+1. */
export type MenuCategory = {
  id: string
  slug: string
  name: string
  intro: string | null
  note: string | null
  kind: MenuCategoryKind
  dishes: Dish[]
}

/** `weekly_special` — Ugens ret and the optional Lørdagsmenu, one singleton row (§4). */
export type WeeklySpecial = {
  isoYear: number | null
  isoWeek: number | null
  /** Weekday keys the dish is served on, in schedule order. */
  days: string[]
  name: string | null
  description: string | null
  priceSmallOre: number | null
  priceLargeOre: number | null
  soldOutOn: IsoDate | null
  /** Ugens ret's photo, resolved from the library (phase 10C-2). The Saturday menu has none (1af). */
  image: PublicImage | null
  saturday: {
    enabled: boolean
    name: string | null
    description: string | null
    priceOre: number | null
    deadline: string | null
    soldOutOn: IsoDate | null
  }
}

/** `monthly_burger` — Månedens burger, shown only inside its date window (§7d). */
export type MonthlyBurger = {
  name: string
  description: string | null
  priceOre: number | null
  startsOn: IsoDate | null
  endsOn: IsoDate | null
  soldOutOn: IsoDate | null
  showOnHomepage: boolean
  /** The burger's photo, resolved from the library (phase 10C-2). */
  image: PublicImage | null
}

/**
 * `announcement` — the one sitewide message, as the public bar renders it (§4, §7c).
 *
 * The row's administration fields are not here. `is_visible`, `source`, `previous` and
 * `replaced_at` decide *whether* there is an announcement to render, which the loader
 * has already answered by returning this object at all; the bar only needs the words,
 * the optional link and the instant it stops being shown.
 *
 * `expiresAt` is an ISO 8601 **instant** string rather than a `Date`, for the reason
 * stated at the top of this file: it is handed to a Client Component — the expiry guard
 * §7c calls for — and a primitive is what survives that boundary unchanged.
 */
export type SiteAnnouncement = {
  message: string
  link: AnnouncementLink | null
  expiresAt: string
}

/** One run of text inside a news paragraph. The editor offers exactly bold and link (§7f). */
export type NewsSpan = {
  text: string
  bold?: boolean
  href?: string
}

export type NewsParagraph = {
  type: 'paragraph'
  spans: NewsSpan[]
}

/**
 * `news.body`, stored as structured JSON rather than HTML (§8).
 *
 * There is no HTML parsing anywhere in the renderer, no `dangerouslySetInnerHTML`, and
 * therefore no sanitizer to get wrong. A new node type is a deliberate, reviewable
 * schema change — not an open HTML field.
 */
export type NewsBody = {
  blocks: NewsParagraph[]
}

/** `news`, published only. */
export type NewsArticle = {
  id: string
  title: string
  slug: string
  category: string | null
  displayDate: IsoDate | null
  /** The row's `updated_at` — `dateModified` in the article's JSON-LD (§11) and the
   *  sitemap's `lastModified` (§7f), so both always state actual data. */
  updatedAt: string
  body: NewsBody
  /** The article's photo, resolved from the library — null for an article without one (phase 10C-2). */
  image: PublicImage | null
}

/**
 * `pages.published` for `home` (§4, "Document shapes").
 *
 * The three photographs (phase 11A) are the Forside's own library images — the hero,
 * the award band's picture and the "Om os" excerpt's team photo — resolved through the
 * same public projection every entity image uses, inside the `page:home`-tagged read.
 * `null` renders the reserved frame the page has always drawn.
 */
export type HomeDocument = {
  hero: { heading: string | null; intro: string | null; image: PublicImage | null }
  award: { title: string | null; text: string | null; image: PublicImage | null }
  featuredDishIds: string[]
  aboutExcerpt: { heading: string | null; text: string | null; image: PublicImage | null }
}

/** One free text section on Mad ud af huset. The page has no fixed list of packages. */
export type TakeawaySection = {
  id: string
  heading: string | null
  body: string | null
}

/**
 * `pages.published` for `takeaway` (§4, "Document shapes").
 *
 * The photograph (phase 11B) is 1aj's "Billede (valgfrit)", resolved through the same
 * public projection every entity image uses, inside the `page:takeaway`-tagged read.
 * `null` is the frame's own no-image state: the text takes the whole width (1aj).
 * Sections with neither a heading nor a text are already left out.
 */
export type TakeawayDocument = {
  heading: string | null
  intro: string | null
  image: PublicImage | null
  sections: TakeawaySection[]
  ctaLabel: string | null
}

/**
 * `pages.published` for `about` (§4, "Document shapes").
 *
 * The three photographs (phase 14B1) are 1i's own reserved frames — the facade beside
 * the story ("Stedet"), the one team photo ("Ét holdfoto") and the kitchen beside the
 * method ("Køkken / tilberedning") — resolved through the same public projection every
 * entity image uses, inside the `page:about`-tagged read. `null` renders the reserved
 * frame the page has always drawn. The award band's words and picture are not here:
 * the words are the confirmed result (1ab) and the picture is the Forside's.
 */
export type AboutDocument = {
  heading: string | null
  storyBlocks: string[]
  venueImage: PublicImage | null
  team: { text: string | null; image: PublicImage | null }
  method: { heading: string | null; text: string | null; image: PublicImage | null }
}
