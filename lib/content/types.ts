import type { AnnouncementLink } from '@/lib/announcements/link'
import type { PublicImage } from '@/lib/images/public'
import type { IsoDate } from '@/lib/time/calendar'

/**
 * The shape of published content as the public site consumes it — technical plan §4.
 *
 * One shape per thing the site renders, written the way a page needs it: camelCase,
 * prices in øre, dates as civil `YYYY-MM-DD` strings. `content/site/` is read through `lib/content/load/`
 * into these types, so a content file that is missing a field or spells one wrong
 * is a build error rather than an empty section on the live site.
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
 * The three group ids and the two list modes, as values rather than as a type alone —
 * the same shape `IMAGE_FOCUSES` and `WEEKDAY_KEYS` already have, so the content
 * validator (`lib/content/validate/`) can hold a stored value against the vocabulary
 * without a second copy of it living next to the checker.
 */
export const TAPAS_GROUP_IDS = ['base', 'choose7', 'dressing'] as const
export const TAPAS_GROUP_MODES = ['fixed', 'choose'] as const

/**
 * The Tapas board — `content/site/tapas.json` (§4, decision 3).
 *
 * Three fixed groups whose ids and count are part of the schema; only the heading and
 * the items are editable. This is a content list and not an ordering configurator:
 * nothing is selectable by a visitor and nothing is priced per item.
 *
 * **It is its own document rather than a field on a dish.** The board is one special
 * structured thing the restaurant edits as a whole — a price for two, the line about
 * each extra person, and three lists — and none of that is a property an ordinary
 * burger could have. Keeping it here means {@link Dish} carries only what a dish has,
 * and the section that shows it says so with its own {@link MenuCategoryKind}, exactly
 * as the Ugens ret section already names the week's own document.
 */
export type TapasGroup = {
  id: (typeof TAPAS_GROUP_IDS)[number]
  heading: string
  mode: (typeof TAPAS_GROUP_MODES)[number]
  choose: number | null
  items: string[]
}

export type TapasBoard = {
  /** "Til to personer 295 kr." — the board's one price, in øre. */
  priceOre: number | null
  /** The small line beneath it: "+148 kr. pr. ekstra person". */
  secondaryNote: string | null
  groups: TapasGroup[]
}

/** `dishes`, reduced to what the public menu renders. */
export type Dish = {
  id: string
  name: string
  description: string | null
  /** "BBQ · chili · aioli" (Dip), "1 kg · frost" (Varm selv). The burgers' menu price is the
   *  Burgere section's `intro`, stated once, not a note on every card. */
  secondaryNote: string | null
  priceOre: number | null
  labels: DishLabel[]
  /** Copenhagen-local date the item was marked sold out. `null` = available (§7b). */
  soldOutOn: IsoDate | null
  /**
   * "Vis på forsiden" — whether this dish is one of the ones the Forside's "Tre fra
   * menuen" band shows (1g). It is a property of the dish rather than a list kept on
   * the Forside, so removing a dish removes it from the Forside too and there is no
   * reference left pointing at nothing. The band shows however many dishes carry it,
   * in the order the menu itself is written.
   */
  featured: boolean
  /** The dish's library photo as the public site renders it, or `null` (phase 10C-2). */
  image: PublicImage | null
}

/**
 * What a menu section holds — the three bodies `MenuCategorySection` can draw.
 *
 * `dishes` is an ordinary list of dishes and is what a section means when it says
 * nothing. The other two name a section whose body is **one other document**: Ugens ret
 * (`weekly-special.json`) and the tapas board (`tapas.json`). Those two sections carry
 * no dishes of their own, and there can be at most one of each.
 */
export const MENU_CATEGORY_KINDS = ['dishes', 'weekly_special', 'tapas'] as const
export type MenuCategoryKind = (typeof MENU_CATEGORY_KINDS)[number]

/**
 * Everything the menu page and the Forside read about the menu, as one value: the
 * sections with their dishes attached, the week's special (its empty state included),
 * Månedens burger or `null`, the tapas board, and the allergen line the menu page
 * prints under its title.
 */
export type MenuContent = {
  allergenNote: string | null
  categories: MenuCategory[]
  weeklySpecial: WeeklySpecial
  monthlyBurger: MonthlyBurger | null
  tapas: TapasBoard
}

/**
 * The confirmed competition result (1ab), printed by the Forside's award band and by
 * Om os's — one result, stated once (`content/site/award.json`).
 */
export type AwardContent = {
  title: string
  text: string
}

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
 * Whether there is an announcement at all is answered by `content/site/announcement.json`
 * being `null` or not; this type is only what the bar needs to draw one — the words,
 * the optional link and the instant it stops being shown.
 *
 * `expiresAt` is an ISO 8601 **instant** string rather than a `Date`, for the reason
 * stated at the top of this file: it is handed to a Client Component — the expiry guard
 * §7c calls for — and a primitive is what survives that boundary unchanged.
 *
 * **It is not the value written on disk.** `announcement.json` stores a Copenhagen wall
 * clock — `2026-09-11T12:00`, no offset — and `lib/content/load/announcement.ts` is
 * where that becomes the instant here (`2026-09-11T10:00:00.000Z`). The two forms are
 * deliberately different strings so that nothing can pass a raw document off as a
 * loaded one, and the conversion has exactly one home.
 */
export type SiteAnnouncement = {
  message: string
  link: AnnouncementLink | null
  expiresAt: string
}

/** One paragraph of a news article — the only kind of block the renderer draws. */
export type NewsParagraph = {
  type: 'paragraph'
  text: string
}

/**
 * `news.body`, as the renderer walks it (§8).
 *
 * **On disk an article's body is a plain list of paragraphs** — `["Første afsnit.",
 * "Andet afsnit."]` — and `lib/content/load/news.ts` is what turns that list into the
 * blocks below. The editor writes sentences; nothing about a document model reaches
 * the person writing the news.
 *
 * The block wrapper stays because it is the renderer's own shape and its extension
 * point: `type` is what a second kind of block (a picture between two paragraphs, say)
 * would be added as, deliberately and with a component to draw it, rather than by
 * opening the field to markup. There is no HTML parsing anywhere in the renderer, no
 * `dangerouslySetInnerHTML` and therefore no sanitizer to get wrong — and, since a
 * paragraph is now one string, nothing inside an article reaches the page as anything
 * but text.
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
  /** The confirmed result's words (`AwardContent`, shared with Om os) and the band's own photograph. */
  award: AwardContent & { image: PublicImage | null }
  /**
   * "Tre fra menuen" (1g): the menu-price line printed beneath the cards.
   *
   * *Which* dishes appear is not here. Each dish carries its own `featured` flag in
   * `menu.json` (see {@link Dish}), so the Forside holds no list of ids that a menu
   * edit could leave pointing at a dish that is gone.
   */
  featured: { note: string | null }
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
  /** The line under the hero's two numbers — "Bestilling og aftaler klarer vi over telefonen." */
  phoneNote: string | null
  sections: TakeawaySection[]
  /** The words on the page's call to action, required: a button with nothing on it is not a state. */
  ctaLabel: string
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
