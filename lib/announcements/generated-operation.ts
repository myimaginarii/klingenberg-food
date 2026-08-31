import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { readAdminOpeningHours } from '@/lib/content/hours-admin'
import { readAdminOverrides } from '@/lib/content/hours-overrides-admin'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import {
  generateOpeningHoursAnnouncement,
  withEditedMessage,
  type GeneratedAnnouncement,
} from './generated'
import {
  REPLACED_ANNOUNCEMENT_KINDS,
  announcementOwnershipOf,
  type AnnouncementOwnership,
  type ReplacedAnnouncementKind,
} from './ownership'
import { announcementSnapshotSchema, type AnnouncementSnapshot } from './snapshot'

/**
 * The coordinated generated-announcement operation — design 1t, 1ae; technical plan
 * §6, §7e items 6 and 8. **Phase 8C-3A.**
 *
 * 8C-1 built the replacement transaction. 8C-2 built the pure generator. This is the
 * thing between them: the server-side operation that 8C-3B's real form will call once
 * a one-off opening-hours change has been published and somebody has ticked *"Vis
 * også som besked øverst på hjemmesiden"*.
 *
 * THE ORDERING IS STRUCTURAL, AND THIS MODULE OWNS THE SECOND HALF ONLY
 *
 * §7e item 8: *"the hours override is written first and always; the announcement is
 * only attempted afterwards … There is no code path where a 'Behold eksisterende'
 * choice can roll back the hours."*
 *
 * So this module **publishes nothing about the hours**. It reads the override — and
 * refuses with `not_published` if the caller reached it before publishing — and every
 * refusal below is a `return`, not a rollback. There is no transaction here that
 * spans the two, no try/catch around a hours write, and no statement anywhere in this
 * file or in `apply_generated_announcement()` that touches `public.opening_hours` or
 * `public.opening_hours_overrides`. The hours cannot be undone by an announcement
 * conflict because nothing here is able to undo them.
 *
 * WHAT THE BROWSER MAY SAY, AND WHAT IT MAY NOT
 *
 * It may say **four things**: which override, that override's version token, the
 * announcement's version token, and — for a second attempt — that the conflict has
 * been seen and replacement is still wanted. It may also carry **one string**: the
 * message, because 1t draws the suggestion as an editable field.
 *
 * It may not say the link, the expiry, the source, the ownership, the visibility,
 * `previous`, `replaced_at` or `draft`. Those are **reconstructed here**, on every
 * call, from the *published* override row and the *published* weekly schedule, by the
 * 8C-2 generator — never read off a hidden field, and never trusted from a previous
 * request. {@link withEditedMessage} is the whole of what an edited message may reach.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * **It renders nothing.** 1ae's conflict sheet, its two buttons, its focus trap
 *     and the green Fortryd strip are **8C-3B**. What this returns is what such a
 *     sheet would need to be written — {@link ApplyGeneratedAnnouncementResult.current}
 *     is the message it would name — and no sheet exists.
 *   * **It expires no cache tag.** It returns the tags; the Server Action expires
 *     them, and only after a result that reached the row — the same split every
 *     publish and every immediate path in this repository uses.
 *   * **It writes no ownership marker of its own.** There is none to write:
 *     `announcement.source_override_id` is the single representation of ownership
 *     (`./ownership.ts`), and it moves inside `replace_announcement()`'s own UPDATE.
 *   * **It does not answer §7e item 6.** *"Does this override own the message on the
 *     hjemmeside?"* is `isOwnedByOverride()` in `./ownership.ts`, asked of
 *     `readAdminAnnouncement()`'s two columns — pure, and comparing ids rather than
 *     reading a word of the message. **8C-3B** is what asks it, and what decides what
 *     to do with a `true`.
 *   * **It is not a workflow engine.** One function, one operation, no step list, no
 *     registry, no table name.
 */

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export type ApplyGeneratedAnnouncementRequest = {
  /** The override the announcement will belong to. Already published (§7e item 8). */
  readonly overrideId: string
  /**
   * The `updated_at` that override was read with (§6).
   *
   * Concurrency on the **hours**, not on the announcement. The message this call
   * carries describes a particular set of times; if somebody has changed or
   * republished them since, the words no longer describe anything and `stale_override`
   * says so rather than publishing a sentence about hours nobody has.
   */
  readonly overrideExpectedUpdatedAt: string
  /** The `updated_at` the announcement was read with (§6). */
  readonly expectedUpdatedAt: string
  /**
   * The staff member's own wording, when they edited the suggestion.
   *
   * `undefined` means "use the generated default", which is what an untouched field
   * amounts to. Whatever arrives is validated against 1ac's rules and can reach
   * nothing but `message`.
   */
  readonly message?: string
  /**
   * 1ae's "Erstat med den nye besked", pressed after the sheet was shown.
   *
   * Only ever consulted for an `active` announcement, and never on the first attempt:
   * the server decides whether there is a conflict, from the row it reads, and this
   * is the one bit a person may contribute to that decision.
   */
  readonly confirmReplace?: boolean
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export type ApplyGeneratedAnnouncementStatus =
  /** The generated announcement is live and the override owns it. One transaction. */
  | 'applied'
  /**
   * An announcement a guest can read right now would be displaced, and replacement
   * was not confirmed — §7e item 8's own word. **Nothing was written**, no audit row
   * exists, and the published hours are untouched. 8C-3B renders 1ae for this.
   */
  | 'conflict'
  /** The override changes nothing a guest could notice (8C-2). Nothing was written. */
  | 'no_effect'
  /** The expiry this override implies has already passed (8C-2). Nothing was written. */
  | 'expired'
  /** The generated default would break 1ac's 90-character rule (8C-2). */
  | 'too_long'
  /**
   * The override is not on the hjemmeside yet.
   *
   * §7e item 8's ordering, refused rather than worked around: an announcement saying
   * the hours changed, published before the hours changed, is the one outcome the item
   * exists to prevent.
   */
  | 'not_published'
  /** Somebody changed the override since it was read (§6). Nothing was written. */
  | 'stale_override'
  /** Somebody changed the announcement since it was read (§6). Nothing was written. */
  | 'stale_announcement'
  /** The edited message broke one of 1ac's rules, or the payload did. */
  | 'invalid_payload'
  /**
   * One of the three rows this operation reads is not there, or the caller may not see
   * it: the override, the weekly schedule, or the announcement singleton.
   */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The database refused the write, was unreachable, or answered something unknown. */
  | 'failed'

export type ApplyGeneratedAnnouncementResult = {
  readonly status: ApplyGeneratedAnnouncementStatus
  /**
   * What the operation displaced, or would displace.
   *
   * Present for `applied` — where it says what actually went — and for `conflict`,
   * where it is always `'active'` and is what makes 1ae's sheet worth showing.
   */
  readonly conflict: ReplacedAnnouncementKind | null
  /**
   * The announcement standing in the way, for `conflict`, so a sheet can name it
   * without asking the browser what it thought was there. `null` otherwise.
   */
  readonly current: AnnouncementSnapshot | null
  /**
   * What was published — reconstructed here, never echoed from the request. `null`
   * unless the operation reached the row.
   */
  readonly announcement: GeneratedAnnouncement | null
  /** Who owns the announcement now, read back from what the database answered. */
  readonly ownership: AnnouncementOwnership | null
  /** What was stashed for Fortryd, including which override owned it. */
  readonly previous: AnnouncementSnapshot | null
  /** The new version token, so the Fortryd a screen offers is bound to *this* write. */
  readonly updatedAt: string | null
  /** Which rule refused the payload, for `invalid_payload`. */
  readonly reason: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

function refuse(
  status: ApplyGeneratedAnnouncementStatus,
  extra: Partial<ApplyGeneratedAnnouncementResult> = {},
): ApplyGeneratedAnnouncementResult {
  return {
    status,
    conflict: null,
    current: null,
    announcement: null,
    ownership: null,
    previous: null,
    updatedAt: null,
    reason: null,
    cacheTags: [],
    ...extra,
  }
}

/**
 * The database function's reply. Anything else is treated as a failure.
 *
 * `invalid_snapshot` is in the enum because `replace_announcement()` can return it and
 * this function passes it through; it is mapped to `failed` because the application
 * cannot produce it — the snapshot is built from the row's own columns, every one of
 * which the table's CHECKs already constrain. Stated, mapped, unreachable.
 */
const applyResultSchema = z.object({
  status: z.enum([
    'applied',
    'conflict',
    'invalid_payload',
    'invalid_snapshot',
    'stale_override',
    'stale_announcement',
    'not_found',
    'forbidden',
  ]),
  reason: z.string().nullish(),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  conflict: z.enum(REPLACED_ANNOUNCEMENT_KINDS).nullish(),
  source_override_id: z.union([z.uuid(), z.null()]).nullish(),
  current: z.unknown().nullish(),
  before: z.unknown().nullish(),
})

function parseSnapshot(value: unknown): AnnouncementSnapshot | null {
  return announcementSnapshotSchema.safeParse(value).data ?? null
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

/**
 * Publish the announcement a published one-off opening-hours change suggests.
 *
 * The order is fixed, and every step but the last is a read:
 *
 *   1. **the role matrix**, so a refusal is a sentence rather than a silent no-op
 *      from RLS (§5);
 *   2. **the published override**, through the caller's own JWT, by id — not by
 *      anything the browser described about it;
 *   3. **the published weekly schedule**, for the same reason: the expiry rule is the
 *      later of the two closings (§0m), and the recurring week is half of it;
 *   4. **the 8C-2 generator**, which composes the message, the link and the expiry
 *      from those two and nothing else. A refusal here is reported as it stands and
 *      never worked around;
 *   5. **the staff member's wording**, if they changed it — {@link withEditedMessage},
 *      which can reach `message` and nothing else;
 *   6. **the coordinator**, which re-reads the singleton inside its own transaction,
 *      decides the conflict there, and delegates the write to
 *      `replace_announcement()` so the content, the snapshot and the ownership move
 *      together or not at all.
 *
 * Steps 2 and 3 are what §7 of the brief means by *"the server must re-read the
 * published override and normal weekly schedule and reconstruct/validate all
 * authoritative generated fields"*. They happen on the **second** call as well as the
 * first: a confirmed replacement regenerates the payload rather than trusting the one
 * the first attempt produced, so a form that sat open while somebody edited the hours
 * cannot publish a stale sentence — and if the hours did move, step 6's own
 * `stale_override` says so.
 */
export async function applyGeneratedAnnouncement(
  profile: Profile,
  request: ApplyGeneratedAnnouncementRequest,
): Promise<ApplyGeneratedAnnouncementResult> {
  // The announcement is a Staff row of the §5 matrix, and owners are staff — but the
  // question is asked of the same registry publishing asks, so a future matrix change
  // is one edit rather than several.
  if (!mayChangeEntity('announcement', profile)) return refuse('forbidden')

  const overrides = await readAdminOverrides()
  const override = overrides.find((candidate) => candidate.id === request.overrideId) ?? null

  // `readAdminOverrides` lists today onwards, which is §7e item 7 from the other side:
  // a past date is one no guest can read and no editor may create, so it is also one
  // no announcement may be generated from.
  if (override === null) return refuse('not_found')

  // `live` is null exactly while the row has never been published. This is §7e item
  // 8's ordering, refused at the first step that can see it.
  if (override.live === null) return refuse('not_published')

  const hours = await readAdminOpeningHours()
  if (hours === null) return refuse('not_found')

  // The **published** halves of both, never the drafts: the announcement describes
  // what a guest can read, and a guest reads neither draft.
  const generated = generateOpeningHoursAnnouncement({
    date: override.date,
    override: override.live,
    schedule: hours.live,
    now: new Date(),
  })

  if (!generated.ok) return refuse(generated.reason)

  const announcement =
    request.message === undefined
      ? generated.announcement
      : withEditedMessage(generated.announcement, request.message)

  if (announcement === null) return refuse('invalid_payload', { reason: 'message' })

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('apply_generated_announcement', {
    p_override_id: request.overrideId,
    p_override_expected_updated_at: request.overrideExpectedUpdatedAt,
    p_message: announcement.message,
    // Reconstructed above, on this call, from the published rows. None of the five is
    // a field the browser could have sent.
    p_link_type: announcement.link_type,
    p_link_page: announcement.link_page,
    p_link_url: announcement.link_url,
    p_link_label: announcement.link_label,
    p_expires_at: announcement.expires_at,
    p_expected_updated_at: request.expectedUpdatedAt,
    p_confirm_replace: request.confirmReplace === true,
  })

  if (error) {
    // The transaction rolled back: the announcement, `previous` and the audit log are
    // as they were, and the published hours were never in it. The message is for the
    // server log, never for the browser.
    console.error(`Generated announcement failed: ${error.message}`)
    return refuse('failed')
  }

  const parsed = applyResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected generated announcement result.')
    return refuse('failed')
  }

  const { status, reason } = parsed.data

  if (status === 'conflict') {
    return refuse('conflict', {
      conflict: parsed.data.conflict ?? 'active',
      current: parseSnapshot(parsed.data.current),
      updatedAt: parsed.data.updated_at ?? null,
    })
  }

  if (status === 'invalid_payload') return refuse('invalid_payload', { reason: reason ?? null })
  if (status === 'invalid_snapshot') return refuse('failed')
  if (status !== 'applied') return refuse(status)

  return {
    status: 'applied',
    // Read back from what the database answered rather than echoed from the request:
    // what the screen reports must be what was stored.
    conflict: parsed.data.conflict ?? null,
    current: null,
    announcement,
    ownership: announcementOwnershipOf({
      source: 'opening_hours',
      source_override_id: parsed.data.source_override_id ?? null,
    }),
    previous: parseSnapshot(parsed.data.before),
    updatedAt: parsed.data.updated_at ?? null,
    reason: null,
    // Stated once, for the `announcement` entity, in the publishing registry.
    cacheTags: publishableEntity('announcement').cacheTags,
  }
}

// ---------------------------------------------------------------------------
// What the administration says afterwards
// ---------------------------------------------------------------------------

/**
 * The refusal a screen shows, or `null` when the operation went through.
 *
 * Worded once here so a caller does not have to, exactly as
 * `describeRestoreObstacle()` is in `./replacement.ts`. `conflict` is deliberately
 * **not** a sentence: it is not an obstacle but a question, and the question is 1ae's
 * sheet, which is 8C-3B's to draw.
 */
export function describeGeneratedAnnouncementObstacle(
  status: ApplyGeneratedAnnouncementStatus,
): string | null {
  switch (status) {
    case 'applied':
    case 'conflict':
      return null
    case 'no_effect':
      return 'Ændringen svarer til de normale åbningstider, så der er ikke noget at fortælle gæsterne.'
    case 'expired':
      return 'Tidspunktet er allerede passeret, så beskeden ville være udløbet med det samme.'
    case 'too_long':
      return 'Beskeden må højst være 90 tegn.'
    case 'not_published':
      return 'Offentliggør den ændrede åbningstid først. Beskeden fortæller om noget, der endnu ikke står på hjemmesiden.'
    case 'stale_override':
      return 'Nogen andre har rettet åbningstiden imens. Genindlæs siden, og prøv igen.'
    case 'stale_announcement':
      return 'Nogen andre har rettet beskeden imens. Genindlæs siden, og prøv igen.'
    case 'invalid_payload':
      return 'Beskeden kunne ikke bruges, som den står.'
    case 'not_found':
      return 'Ændringen blev ikke fundet.'
    case 'forbidden':
      return 'Du har ikke adgang til at ændre beskeden.'
    case 'failed':
      return 'Beskeden kunne ikke oprettes. Prøv igen.'
  }
}
