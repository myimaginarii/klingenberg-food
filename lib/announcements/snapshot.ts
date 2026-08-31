import { z } from 'zod'

import { ANNOUNCEMENT_LINK_PAGES } from '@/lib/schemas/announcement'

import { isAnnouncementExpired } from './expiry'
import { isConsistentAnnouncementLink } from './link'
import type { AnnouncementValues } from './lifecycle'

/**
 * The previous announcement, as `announcement.previous` holds it — technical plan
 * §4, §6; design 1ae.
 *
 * §6's immediate-path table: *"Replace an existing announcement — writes new values,
 * **stashes the old in `previous jsonb`** — 10 s Fortryd restores from `previous`."*
 * This module is the statement of what that jsonb **is**, and it is deliberately a
 * closed shape rather than "the row, as json".
 *
 * WHY NOT THE WHOLE ROW
 *
 * A `to_jsonb(announcement)` would carry five things a restore must never put back:
 *
 *   * `draft`       — a draft is not published content. Stashing one would give a
 *                     restore a way to make public something nobody pressed
 *                     Offentliggør for, which is the single thing §6 exists to
 *                     prevent.
 *   * `previous`    — a snapshot inside a snapshot is a history stack with extra
 *                     steps. 1ad: *"intet arkiv, ingen kladdeliste, ingen historik"*,
 *                     and §4 lists the history table among those deliberately not
 *                     created. One level only.
 *   * `replaced_at` — a fact about the *replacement*, not about the announcement
 *                     being replaced.
 *   * `updated_at`  — the optimistic-concurrency token (§6). It belongs to the row
 *                     as it is now; writing an old one back would corrupt the model
 *                     every screen depends on.
 *   * `updated_by`  — an actor id. Attribution comes from the JWT of whoever acts
 *                     (§8), never from a stored value a caller could have chosen.
 *
 * So the snapshot is **eight keys**: the six the editor owns, plus the two that are
 * part of the published *state* rather than its content — whether the message was
 * being shown, and where it came from. A restore that lost either would not be a
 * restore: a message that was switched off would come back switched on, and a
 * generated opening-hours message would come back calling itself manual.
 *
 * WHERE THIS SCHEMA IS THE AUTHORITY, AND WHERE IT IS THE SECOND ANSWER
 *
 * `public.is_valid_announcement_snapshot()` states the same eight keys and the same
 * rules in SQL, and it is the one that runs inside the transaction — before a
 * snapshot is stored, and again before one is restored. This schema is the
 * application's own reading of the same shape, used to parse a snapshot the
 * administration wants to *describe* (1ae draws the message it is about to displace)
 * and to keep the TypeScript type honest. Neither is trusted as the only one.
 *
 * Everything here is pure and imports no server module, so the unit suite can hold
 * it to its rules without a database.
 */

/** The closed source vocabulary — the table's `announcement_source_check`, restated. */
export const ANNOUNCEMENT_SOURCES = ['manual', 'opening_hours'] as const

/**
 * Where a published announcement came from.
 *
 * `'manual'` — somebody wrote it at `/admin/besked` (1ad). Everything phases 7 and
 * 8A–8B can produce.
 * `'opening_hours'` — generated from a one-off opening-hours change. **Nothing
 * generates one yet**: composing that message is 8C-2. What 8C-1 provides is a
 * replacement path capable of *carrying* the value, from a server-side caller.
 */
export type AnnouncementSource = (typeof ANNOUNCEMENT_SOURCES)[number]

/**
 * The stored snapshot, strictly.
 *
 * `strictObject`, so an unknown key is a refusal rather than something silently
 * ignored — which is what makes "a draft cannot be stashed here" and "a `previous`
 * cannot nest" properties of the type rather than of a reviewer's memory. Every key
 * is required, because a snapshot with a missing field is one a restore would have
 * to guess at.
 */
export const announcementSnapshotSchema = z.strictObject({
  message: z.union([z.string().max(90), z.null()]),
  link_type: z.enum(['none', 'page', 'url']),
  link_page: z.union([z.enum(ANNOUNCEMENT_LINK_PAGES), z.null()]),
  link_url: z.union([z.string().regex(/^https:\/\/\S+$/), z.null()]),
  link_label: z.union([z.string(), z.null()]),
  expires_at: z.union([z.iso.datetime({ offset: true }), z.null()]),
  is_visible: z.boolean(),
  source: z.enum(ANNOUNCEMENT_SOURCES),
})

export type AnnouncementSnapshot = z.infer<typeof announcementSnapshotSchema>

/**
 * A stored `previous` value, parsed — or `null` for anything that is not one.
 *
 * `null` covers every way a snapshot can be wrong at once: absent, not an object, a
 * key too many, a key too few, a value of the wrong type, an inconsistent link. The
 * caller's answer is the same in every case — refuse, and say so — so there is one
 * return value rather than a taxonomy nobody would branch on.
 */
export function parseAnnouncementSnapshot(value: unknown): AnnouncementSnapshot | null {
  const parsed = announcementSnapshotSchema.safeParse(value)
  if (!parsed.success) return null

  // The one rule no per-field schema can state — the three link columns must agree —
  // asked of `./link.ts`, where §8's link rule lives, rather than restated here.
  // `is_valid_announcement_snapshot()` restates it in SQL, so a snapshot this refuses is
  // one the database would refuse to write back into the columns.
  return isConsistentAnnouncementLink(parsed.data) ? parsed.data : null
}

/** True when `value` is exactly a snapshot this system would restore. */
export function isAnnouncementSnapshot(value: unknown): value is AnnouncementSnapshot {
  return parseAnnouncementSnapshot(value) !== null
}

/**
 * The published state of an announcement, as the snapshot that would stash it.
 *
 * Takes the **published** values and the two state columns, never a merged row: a
 * draft is not part of what a replacement displaces, so it is not part of what a
 * restore puts back. The parameter shape is what makes that structural — there is no
 * argument here through which a draft could arrive.
 */
export function announcementSnapshotFrom(published: {
  readonly values: AnnouncementValues
  readonly isVisible: boolean
  readonly source: AnnouncementSource
}): AnnouncementSnapshot {
  return {
    message: published.values.message,
    link_type: published.values.link_type,
    link_page: published.values.link_page as AnnouncementSnapshot['link_page'],
    link_url: published.values.link_url,
    link_label: published.values.link_label,
    expires_at: published.values.expires_at,
    is_visible: published.isVisible,
    source: published.source,
  }
}

/**
 * Would a guest read this snapshot, if it were restored at `now`?
 *
 * The anonymous RLS policy's own three conditions — `is_visible and message is not
 * null and expires_at is not null and expires_at > now()` — asked of a snapshot
 * rather than of a row, and the same question {@link isAnnouncementPubliclyVisible}
 * asks of the live announcement.
 *
 * It exists for one case and says so: an expiry that passes inside the ~10 seconds
 * Fortryd is offered. **Nothing extends it.** The restore puts the previous state
 * back exactly as it stood, which may be a message no guest can read, and this is how
 * the administration knows to say so rather than reporting a success that a visitor
 * would contradict.
 */
export function isSnapshotShowable(snapshot: AnnouncementSnapshot, now: Date): boolean {
  if (!snapshot.is_visible) return false
  if (snapshot.message === null || snapshot.message.trim().length === 0) return false

  return !isAnnouncementExpired(snapshot.expires_at, now)
}
