import { z } from 'zod'

import { defineDraft } from './define'
import { optionalHttpsUrl, optionalText, optionalTimestamp } from './primitives'

/**
 * The announcement bar — technical plan §4, §7c, §8.
 *
 * The link is the security-sensitive part. §8 requires that an internal link be one of
 * *our own* routes chosen from a closed set, and that an external link be `https:` and
 * rendered with `rel="noopener noreferrer"`. `ANNOUNCEMENT_LINK_PAGES` below is that
 * closed set, and it is the same list the `announcement_link_page_check` constraint
 * carries — a link that is not one of these six values is refused twice.
 *
 * `is_visible` is absent. Showing the bar, hiding it and "Fjern beskeden nu" are the
 * immediate path with a 10 s Fortryd (§6); they are not edits and never become drafts.
 * `source`, `previous` and `replaced_at` are equally absent — the system writes those.
 *
 * ONE RULE THIS SCHEMA DOES NOT ENFORCE
 *
 * The three link fields must agree: `none` with neither, `page` with a page, `url`
 * with a URL. That is a rule about the *merged* row, and a draft is partial by
 * definition — a draft that only changes `link_label` cannot be judged against it. The
 * `announcement_link_shape_check` constraint is the authority, and it is checked at
 * the moment the merge happens. A publish that would break it raises inside the
 * publish function, so the transaction rolls back whole: live content unchanged, draft
 * intact, no audit row.
 */

/** The six public routes an announcement may point at (§8, and the table CHECK). */
export const ANNOUNCEMENT_LINK_PAGES = [
  '/',
  '/menu',
  '/mad-ud-af-huset',
  '/om-os',
  '/nyheder',
  '/find-os',
] as const

export const announcementDraft = defineDraft({
  // 90 characters, as the design and the CHECK constraint both say.
  message: optionalText(90, 'Beskeden').optional(),

  link_type: z.enum(['none', 'page', 'url'], { error: 'Ukendt linktype.' }).optional(),

  link_page: z
    .union([z.enum(ANNOUNCEMENT_LINK_PAGES, { error: 'Ukendt side.' }), z.null()])
    .optional(),

  link_url: optionalHttpsUrl('Linket').optional(),
  link_label: optionalText(60, 'Linkteksten').optional(),

  // Required in practice — the design will not let an announcement be published
  // without an expiry (§7c) — but nullable here, because clearing it is a legitimate
  // edit while a draft is being written.
  expires_at: optionalTimestamp('Udløbstidspunktet').optional(),
})
