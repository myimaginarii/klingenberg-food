import { MAIN_NAV, type SiteRoute } from '@/lib/site/navigation'

/**
 * The announcement's optional link — design 1ad, 1ac; technical plan §8.
 *
 * §8 names this row of its risk table "**open redirect / injected announcement link**",
 * and the prevention it states is two rules rather than one validator:
 *
 *   * `link_type='page'` is "an enum of our own routes" — a closed set, and since the
 *     static rebuild that set is literally `MAIN_NAV`: the site's own six routes, the
 *     ones the header renders. A path that is not one of them is not a destination.
 *   * `link_type='url'` is validated as `https:` and rendered with
 *     `rel='noopener noreferrer'`. Both halves of that one promise live in this module,
 *     so neither can be shipped without the other.
 *
 * Everything here is pure: it decides what a tracked announcement *means*. The
 * announcement itself is `content/site/announcement.ts`, so the only way a link reaches
 * a page is through a tracked, reviewed commit — but the rules stand anyway, because a
 * typo in a commit is exactly as capable of producing a bad anchor as a form was.
 *
 * **No HTML anywhere.** The message and the link label are plain strings rendered as
 * text by React, exactly like every other free-text field on this site (§8). There is
 * no `dangerouslySetInnerHTML` on the public site.
 */

/**
 * The closed set of internal destinations: the site's own routes, in navigation order.
 *
 * One list, not two. A route added to the site is a route an announcement may point at,
 * with no second place to remember.
 */
export const ANNOUNCEMENT_LINK_PAGES: readonly SiteRoute[] = MAIN_NAV.map((item) => item.href)

/** An internal destination — one of the site's own routes. */
export type AnnouncementPageRoute = SiteRoute

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

  // A URL with whitespace in it is refused before parsing rather than trimmed into
  // something that was never written.
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
 * Do the three link fields agree — `none` with neither, `page` with a page, `url` with
 * an address?
 *
 * A rule *between* fields, stated here beside the six routes and the https rule it
 * belongs with. It is deliberately about the **shape** and not about the values:
 * whether a page is one of the six and whether an address is `https:` are
 * {@link isAnnouncementPageRoute} and {@link isAllowedExternalUrl}.
 */
export function isConsistentAnnouncementLink(values: AnnouncementLinkValues): boolean {
  switch (values.link_type) {
    case 'none':
      return values.link_page === null && values.link_url === null
    case 'page':
      return values.link_page !== null && values.link_url === null
    case 'url':
      return values.link_url !== null && values.link_page === null
  }
}

/**
 * The link a tracked announcement means, or `null`.
 *
 * Every branch that is not fully consistent answers `null`, and deliberately: a
 * half-filled link is the one case where guessing produces a live anchor pointing
 * somewhere nobody chose.
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
