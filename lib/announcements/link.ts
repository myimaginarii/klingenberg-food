import { ANNOUNCEMENT_LINK_PAGES } from '@/lib/schemas/announcement'
import { MAIN_NAV, type SiteRoute } from '@/lib/site/navigation'

/**
 * The announcement's optional link — design 1ad, 1ac; technical plan §8.
 *
 * §8 names this row of its risk table "**open redirect / injected announcement link**",
 * and the prevention it states is two rules rather than one validator:
 *
 *   * `link_type='page'` is "an enum of our own routes" — a closed set, chosen from a
 *     list, never a path typed into a box. A relative path that arrived from a browser
 *     is not accepted at all, so there is nothing to normalise, nothing to resolve and
 *     no `../` to reason about.
 *   * `link_type='url'` is "validated as `https:` and rendered with
 *     `rel='noopener noreferrer'`". The validation lives in the schema
 *     (`optionalHttpsUrl`, which is also what the `announcement_link_url_check`
 *     constraint restates in SQL); the rendering rule lives in this module, so the two
 *     halves of one promise cannot be shipped separately.
 *
 * Everything here is pure. It decides what a stored row *means* — which is a different
 * question from what a form may submit (`app/(admin)/admin/besked/forms.ts`) and from
 * what the database will accept (the three link CHECK constraints). All three say the
 * same thing about the same six routes, and {@link ANNOUNCEMENT_PAGE_ROUTES_MATCH_NAV}
 * is asserted by the unit suite so they cannot drift.
 *
 * **No HTML anywhere.** The message and the link label are plain strings rendered as
 * text by React, exactly like every other free-text field in this system (§8). There is
 * no `dangerouslySetInnerHTML` on the public site, and this phase adds none.
 */

/** An internal destination, from the closed set the schema and the CHECK both carry. */
export type AnnouncementPageRoute = (typeof ANNOUNCEMENT_LINK_PAGES)[number]

/** The stored link fields, as the row holds them. */
export type AnnouncementLinkValues = {
  readonly link_type: 'none' | 'page' | 'url'
  readonly link_page: string | null
  readonly link_url: string | null
  readonly link_label: string | null
}

/**
 * A link the bar can actually render, or `null` for a message that has none.
 *
 * `null` is the important half: 1ac is explicit that "uden link er hele bjælken ren
 * tekst — ingen tom knap, ingen pil". So an announcement with no link produces no
 * anchor at all rather than an anchor with nothing in it.
 */
export type AnnouncementLink = {
  readonly href: string
  readonly label: string
  /** True for an external `https:` address, which is rendered with `rel` and `target`. */
  readonly external: boolean
}

/** The Danish name of each internal destination, taken from the site's own navigation. */
const PAGE_LABELS: Record<AnnouncementPageRoute, string> = Object.fromEntries(
  MAIN_NAV.map((item) => [item.href, item.label]),
) as Record<AnnouncementPageRoute, string>

/**
 * The link's six page routes *are* the site's six routes.
 *
 * Two lists describing one set is how they stop agreeing. They are separate because
 * they answer different questions — the schema's list mirrors a database CHECK, the
 * navigation's list mirrors the approved header — so instead of merging them, the unit
 * suite asserts this equality. A route added to the site and not to the announcement's
 * enum is then a failing test rather than a link nobody can choose.
 */
export const ANNOUNCEMENT_PAGE_ROUTES_MATCH_NAV: readonly SiteRoute[] =
  ANNOUNCEMENT_LINK_PAGES as readonly SiteRoute[]

/** Every internal destination with the words that name it, in the approved order. */
export const ANNOUNCEMENT_PAGE_OPTIONS: readonly {
  readonly route: AnnouncementPageRoute
  readonly label: string
}[] = ANNOUNCEMENT_LINK_PAGES.map((route) => ({ route, label: PAGE_LABELS[route] }))

/** True when `value` is one of our own six public routes. */
export function isAnnouncementPageRoute(value: unknown): value is AnnouncementPageRoute {
  return (
    typeof value === 'string' &&
    (ANNOUNCEMENT_LINK_PAGES as readonly string[]).includes(value)
  )
}

/**
 * True when `value` is an address this system will link a guest to.
 *
 * `https:` only, with a host. Everything §8 and the brief rule out fails here for a
 * structural reason rather than because it is on a deny-list: `http:`, `javascript:`
 * and `data:` are refused because their protocol is not `https`; a protocol-relative
 * `//example.test/x` is refused because it is not an absolute URL at all and `new URL`
 * cannot parse it without a base; and a malformed string is refused for the same
 * reason. A deny-list would have to be complete to be correct — this only has to be
 * right about one protocol.
 */
export function isAllowedExternalUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false

  // A URL with whitespace in it is refused before parsing, because the SQL CHECK
  // (`^https://[^\s]+$`) refuses it too and the two must agree.
  if (value.trim() !== value || /\s/.test(value)) return false

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  return url.protocol === 'https:' && url.hostname.length > 0
}

/**
 * The link a stored row means, or `null`.
 *
 * Every branch that is not fully consistent answers `null`, and deliberately: a
 * half-filled link is the one case where guessing produces a live anchor pointing
 * somewhere nobody chose. The database's `announcement_link_shape_check` makes an
 * inconsistent row unreachable in the first place; this is the second answer to the
 * same question, given by the component that would otherwise have to render it.
 *
 * The label falls back to the destination's own name for an internal page — "Find os"
 * links to /find-os — because that is a name the site already uses and a guest already
 * understands. An **external** address has no such name, so a link without a label is
 * not rendered at all rather than labelled with its own URL.
 */
export function resolveAnnouncementLink(values: AnnouncementLinkValues): AnnouncementLink | null {
  const label = values.link_label === null ? null : values.link_label.trim() || null

  if (values.link_type === 'page') {
    if (!isAnnouncementPageRoute(values.link_page)) return null
    if (values.link_url !== null) return null

    return {
      href: values.link_page,
      label: label ?? PAGE_LABELS[values.link_page],
      external: false,
    }
  }

  if (values.link_type === 'url') {
    if (!isAllowedExternalUrl(values.link_url) || values.link_page !== null) return null
    if (label === null) return null

    return { href: values.link_url as string, label, external: true }
  }

  return null
}
