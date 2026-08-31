import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { ANNOUNCEMENT_LINK_PAGES } from '@/lib/schemas/announcement'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from './lifecycle'
import { isConsistentAnnouncementLink } from './link'
import {
  ANNOUNCEMENT_SOURCES,
  announcementSnapshotSchema,
  type AnnouncementSnapshot,
} from './snapshot'

/**
 * Replacing the published announcement, and putting the previous one back — design
 * 1ae; technical plan §4, §6, §7e item 8.
 *
 * §6's immediate path has three announcement rows. Phase 7B built the first two —
 * "Vis besked" off and "Fjern beskeden nu", with their ~10 s Fortryd. This module is
 * the third:
 *
 *     "Replace an existing announcement — writes new values, stashes the old in
 *      `previous jsonb` — 10 s Fortryd restores from `previous`."
 *
 * 1ae is the screen it exists for, and its own account of what follows "Erstat med
 * den nye besked" is the specification: *"Den nye besked går live, den gamle fjernes.
 * Grøn besked med Fortryd i 10 sekunder sætter den gamle tilbage."*
 *
 * A **wrapper, not a mechanism**, exactly as `./visibility.ts` and
 * `lib/menu/sold-out.ts` are. The transactions are `public.replace_announcement()`
 * and `public.restore_announcement()`; what happens here is the three things that
 * cannot happen inside the database:
 *
 *   1. the role matrix is asked first, so a refusal is a sentence rather than a
 *      silent no-op from RLS (§5);
 *   2. the payload is reduced to a closed, typed shape before it is sent — see
 *      {@link announcementReplacementSchema};
 *   3. the database's reply is mapped to a status a Server Action can act on.
 *
 * WHO CALLS IT, AND WHO DOES NOT
 *
 * **No ordinary Staff workflow reaches this.** `/admin/besked` has no "Erstat"
 * control, no source selector and no replacement form; 1ad's editor is unchanged and
 * stays what it has been since phase 7 — content through Ret → Forhåndsvis →
 * Offentliggør, visibility through the immediate switch. The caller this module is
 * built for is **8C-3**: after a one-off opening-hours change has been written (and
 * it is written *first and always*, §7e item 8), the conflict sheet 1ae draws asks
 * which message the guests should see, and "Erstat med den nye besked" calls this.
 *
 * Until then it is called from tests and from server code, which is what §3 of the
 * 8C-1 brief asks for and why there is no form vocabulary in this file.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * **It does not generate a message.** Nothing here reads the opening hours, an
 *     override, a weekday or a clock face. Composing *"Ændrede åbningstider søndag ·
 *     17:00–19:00"* is **8C-2**. This takes a replacement that has already been
 *     validated by whoever composed it and validates it again.
 *   * **It does not decide whether to ask.** Whether there is a conflict worth a
 *     sheet is 8C-3's question; {@link ReplaceAnnouncementResult.replaced} is the
 *     answer this layer provides for it.
 *   * **It does not touch a draft.** Neither database function names `draft`, and
 *     this module imports nothing from `lib/drafts` and nothing from `lib/publishing`
 *     beyond the role matrix and the cache tags stated once for the `announcement`
 *     entity. A pending manual announcement is byte-identical through a replacement
 *     and through the restore that follows it.
 *   * **It does not keep a history.** One snapshot, one level. A second replacement
 *     overwrites the first, and `audit_log` is the historical record (§4, 1ad).
 *   * **It does not expire a cache tag.** It returns the tags; the Server Action
 *     expires them, and only after a result that reached the row — the same split
 *     every publish and every immediate path in this repository uses.
 *   * **It does not move an expiry.** Not to make a replacement showable, and not to
 *     make a restore visible. See {@link RestoreAnnouncementResult.showable}.
 */

// ---------------------------------------------------------------------------
// The replacement payload
// ---------------------------------------------------------------------------

/**
 * What a replacement may set, and nothing else.
 *
 * `strictObject` over a **closed** set of fields, which is the application-side half
 * of the same promise the database function keeps by taking typed scalars rather than
 * a jsonb document: there is no key by which a caller could name a column, no shape
 * it could smuggle, and no way to reach `draft`, `previous`, `replaced_at`,
 * `updated_by` or `is_visible`.
 *
 * `is_visible` is absent because a replacement is always made public — 1ae: *"Den nye
 * besked går live"* — so it is not a choice anybody makes. `source` **is** present,
 * and is an enum of the two values the column's own CHECK allows: a caller may say
 * that the message it composed is a generated opening-hours one, and may say nothing
 * else.
 *
 * The rules are 1ac's, the same three `publish_announcement()` and 1ad's form apply:
 * a message that exists and is at most 90 characters, an expiry that exists (checked
 * against the clock by the database, at the moment of the write), and §8's link rule
 * — six approved routes or an `https:` address.
 */
export const announcementReplacementSchema = z.strictObject({
  message: z
    .string()
    .trim()
    .min(1, { error: 'Beskeden må ikke være tom.' })
    .max(ANNOUNCEMENT_MESSAGE_MAX_LENGTH, {
      error: `Beskeden må højst være ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} tegn.`,
    }),
  link_type: z.enum(['none', 'page', 'url']),
  link_page: z.union([z.enum(ANNOUNCEMENT_LINK_PAGES), z.null()]),
  link_url: z.union([z.string().regex(/^https:\/\/\S+$/), z.null()]),
  link_label: z.union([z.string().trim().min(1).max(60), z.null()]),
  expires_at: z.iso.datetime({ offset: true }),
  source: z.enum(ANNOUNCEMENT_SOURCES),
})

export type AnnouncementReplacement = z.infer<typeof announcementReplacementSchema>

/**
 * A payload parsed, or `null`.
 *
 * The between-fields rules no per-field schema can state: the three link columns must
 * agree, and an external address must carry a label because
 * `resolveAnnouncementLink()` renders no anchor without one. Both are restated by
 * `replace_announcement()` in SQL, so a forged call meets the same refusal.
 */
export function parseAnnouncementReplacement(
  value: unknown,
): AnnouncementReplacement | null {
  const parsed = announcementReplacementSchema.safeParse(value)
  if (!parsed.success) return null

  // The three link columns must agree — asked of `./link.ts`, where §8's link rule lives,
  // rather than restated here. `replace_announcement()` restates it in SQL.
  if (!isConsistentAnnouncementLink(parsed.data)) return null

  // And an external address must carry a label, because `resolveAnnouncementLink()`
  // renders no anchor without one: a replacement that silently dropped its link would be
  // one nobody could tell had gone wrong.
  if (parsed.data.link_type === 'url' && parsed.data.link_label === null) return null

  return parsed.data
}

// ---------------------------------------------------------------------------
// Replacing
// ---------------------------------------------------------------------------

/**
 * What the replacement displaced, decided by the **server** from the row it read.
 *
 * The distinction 1ae exists for is `'active'` and only `'active'`: a message a guest
 * can read right now. The other three are recorded rather than acted on here, because
 * whether they deserve a sheet is 8C-3's decision and not this layer's.
 *
 *   * `active`  — a publicly visible announcement was replaced.
 *   * `hidden`  — a valid, unexpired message that had been switched off. It is
 *                 snapshotted **with its own `is_visible = false`**, so a restore
 *                 puts it back switched off rather than switching it on.
 *   * `expired` — a message whose expiry had passed. No guest could see it, so it is
 *                 not a public conflict; it is stashed faithfully all the same.
 *   * `none`    — there was no message at all. Replacing nothing is allowed and is
 *                 not dressed up as a conflict; the snapshot records the empty state,
 *                 so Fortryd can put the emptiness back.
 */
export type ReplacedAnnouncementKind = 'active' | 'hidden' | 'expired' | 'none'

/** The outcome vocabulary. Only `replaced` changed anything. */
export type ReplaceAnnouncementStatus =
  /** The replacement is live, the previous state is stashed, one audit row written. */
  | 'replaced'
  /** The payload broke one of 1ac's or §8's rules. Nothing was written. */
  | 'invalid_payload'
  /** Somebody else changed the row first (§6). Nothing was written. */
  | 'conflict'
  /** No row, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The database refused the write, was unreachable, or answered something unknown. */
  | 'failed'

export type ReplaceAnnouncementResult = {
  readonly status: ReplaceAnnouncementStatus
  /** What was displaced — `null` unless the replacement happened. */
  readonly replaced: ReplacedAnnouncementKind | null
  /** The state that was stashed, so a screen can name it. `null` unless it happened. */
  readonly previous: AnnouncementSnapshot | null
  /** The new version token, so the Fortryd the screen offers is bound to *this* write. */
  readonly updatedAt: string | null
  /** Which rule refused the payload, for `invalid_payload`. */
  readonly reason: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type ReplaceAnnouncementRequest = {
  readonly replacement: AnnouncementReplacement
  /** The `updated_at` the screen was rendered from. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
}

/**
 * The database function's reply. Anything else is treated as a failure.
 *
 * `invalid_snapshot` is in the enum because `replace_announcement()` can return it,
 * and is mapped to `failed` because the application cannot produce it: the snapshot
 * is built from the row's own columns, every one of which the table's CHECKs already
 * constrain. Stated, mapped, unreachable — the same treatment `invalid_request` gets
 * in `./visibility.ts`.
 */
const replaceResultSchema = z.object({
  status: z.enum([
    'replaced',
    'invalid_payload',
    'invalid_snapshot',
    'conflict',
    'not_found',
    'forbidden',
  ]),
  reason: z.string().nullish(),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  replaced: z.enum(['active', 'hidden', 'expired', 'none']).nullish(),
  before: z.unknown().nullish(),
})

function replaceRefusal(
  status: ReplaceAnnouncementStatus,
  reason: string | null = null,
): ReplaceAnnouncementResult {
  return {
    status,
    replaced: null,
    previous: null,
    updatedAt: null,
    reason,
    cacheTags: [],
  }
}

/**
 * Replace the published announcement with `replacement`.
 *
 * One call, one transaction: the current published state is snapshotted into
 * `previous`, the replacement is written, `replaced_at` is stamped, the bar is made
 * visible and one audit row is written — or none of it is.
 */
export async function replaceAnnouncement(
  profile: Profile,
  request: ReplaceAnnouncementRequest,
): Promise<ReplaceAnnouncementResult> {
  // The announcement is a Staff row of the §5 matrix, and owners are staff — but the
  // question is asked of the same registry publishing asks, so a future matrix change
  // is one edit rather than several.
  if (!mayChangeEntity('announcement', profile)) return replaceRefusal('forbidden')

  // Parsed here as well as in SQL. A caller that composed the payload in server code
  // is still a caller, and 8C-2 will be one.
  const replacement = parseAnnouncementReplacement(request.replacement)
  if (replacement === null) return replaceRefusal('invalid_payload', 'shape')

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('replace_announcement', {
    p_message: replacement.message,
    p_link_type: replacement.link_type,
    p_link_page: replacement.link_page,
    p_link_url: replacement.link_url,
    p_link_label: replacement.link_label,
    p_expires_at: replacement.expires_at,
    p_source: replacement.source,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the row, `previous` and the audit log are as they
    // were. The message is for the server log, never for the browser.
    console.error(`Announcement replacement failed: ${error.message}`)
    return replaceRefusal('failed')
  }

  const parsed = replaceResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected announcement replacement result.')
    return replaceRefusal('failed')
  }

  const { status, reason } = parsed.data

  if (status === 'invalid_payload') return replaceRefusal('invalid_payload', reason ?? null)
  if (status === 'invalid_snapshot') return replaceRefusal('failed')
  if (status !== 'replaced') return replaceRefusal(status)

  return {
    status: 'replaced',
    // Read back from what the database answered rather than echoed from the request:
    // what the screen reports must be what was stored.
    replaced: parsed.data.replaced ?? null,
    previous: announcementSnapshotSchema.safeParse(parsed.data.before).data ?? null,
    updatedAt: parsed.data.updated_at ?? null,
    reason: null,
    // Stated once, for the `announcement` entity, in the publishing registry.
    cacheTags: publishableEntity('announcement').cacheTags,
  }
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

/** The outcome vocabulary. Only `restored` changed anything. */
export type RestoreAnnouncementStatus =
  /** The previous announcement is back, `previous` and `replaced_at` are cleared. */
  | 'restored'
  /** There was nothing stashed — nothing was replaced, or a restore already happened. */
  | 'nothing_to_restore'
  /** `previous` was not a snapshot this system wrote. Nothing written, nothing dropped. */
  | 'invalid_snapshot'
  /** Somebody else changed the row first (§6). Nothing was written. */
  | 'conflict'
  /** No row, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The database refused the write, was unreachable, or answered something unknown. */
  | 'failed'

export type RestoreAnnouncementResult = {
  readonly status: RestoreAnnouncementStatus
  /**
   * Whether the restored announcement is one a guest can actually read.
   *
   * `false` is the honest half, and the reason this field exists: an expiry can pass
   * inside the ~10 seconds Fortryd is offered, and **nothing extends it**. The
   * previous state is put back exactly as it stood, which may be a message that is
   * now ineligible for public display — so the administration says that, rather than
   * reporting a success a visitor would contradict.
   */
  readonly showable: boolean | null
  /** What is on the hjemmeside now, read back from the row. */
  readonly restored: AnnouncementSnapshot | null
  /** The new version token. */
  readonly updatedAt: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type RestoreAnnouncementRequest = {
  /**
   * The `updated_at` the screen was rendered from (§6).
   *
   * The **only** thing a caller sends. The previous announcement itself is read from
   * the database, so the browser never sends the old message back and there is no
   * parameter through which it could.
   */
  readonly expectedUpdatedAt: string
}

const restoreResultSchema = z.object({
  status: z.enum([
    'restored',
    'nothing_to_restore',
    'invalid_snapshot',
    'conflict',
    'not_found',
    'forbidden',
  ]),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  showable: z.boolean().nullish(),
  after: z.unknown().nullish(),
})

function restoreRefusal(status: RestoreAnnouncementStatus): RestoreAnnouncementResult {
  return { status, showable: null, restored: null, updatedAt: null, cacheTags: [] }
}

/**
 * Put back the announcement stashed in `previous` — 1ae's ten-second Fortryd.
 *
 * §6: *"Undo is not server-held state. The change is already live; undo is simply a
 * second authorized write."* The ten seconds are a message's lifetime rather than a
 * permission window: this call is guarded, validated, concurrency-checked and audited
 * on exactly the same terms as the replacement was, whether it arrives at second one
 * or from a stale tab. What *is* server-held is the previous announcement, which is
 * the whole purpose of the `previous jsonb` column.
 */
export async function restoreAnnouncement(
  profile: Profile,
  request: RestoreAnnouncementRequest,
): Promise<RestoreAnnouncementResult> {
  if (!mayChangeEntity('announcement', profile)) return restoreRefusal('forbidden')

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('restore_announcement', {
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    console.error(`Announcement restore failed: ${error.message}`)
    return restoreRefusal('failed')
  }

  const parsed = restoreResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected announcement restore result.')
    return restoreRefusal('failed')
  }

  if (parsed.data.status !== 'restored') return restoreRefusal(parsed.data.status)

  return {
    status: 'restored',
    showable: parsed.data.showable ?? null,
    restored: announcementSnapshotSchema.safeParse(parsed.data.after).data ?? null,
    updatedAt: parsed.data.updated_at ?? null,
    cacheTags: publishableEntity('announcement').cacheTags,
  }
}

// ---------------------------------------------------------------------------
// What the administration says afterwards
// ---------------------------------------------------------------------------

/**
 * The Fortryd strip's sentence after a replacement went through.
 *
 * 1ae's own wording for what has just happened — *"Den nye besked går live, den gamle
 * fjernes"* — told apart by what was actually displaced, because "den gamle" is a
 * different fact in each case and a strip that claimed one message had replaced
 * another when there had been none would be reporting something that did not happen.
 *
 * It lives here rather than inside a component for the reason
 * `describeAnnouncementVisibilityChange` lives in `./visibility.ts`: the vocabulary of
 * an operation belongs beside the operation's rules, where the unit suite can assert
 * it without rendering anything.
 */
export function describeAnnouncementReplacement(replaced: ReplacedAnnouncementKind): string {
  switch (replaced) {
    case 'active':
      return 'Den nye besked vises nu. Den forrige besked er fjernet.'
    case 'hidden':
      return 'Den nye besked vises nu. Den forrige besked var slået fra.'
    case 'expired':
      return 'Den nye besked vises nu. Den forrige besked var udløbet.'
    case 'none':
      return 'Den nye besked vises nu. Der stod ingen besked før.'
  }
}

/**
 * The sentence a restore leaves behind.
 *
 * Two of them, and the second is the point: a previous announcement whose expiry
 * passed while Fortryd was on offer is restored faithfully and is then invisible to
 * guests. **Nothing extended it to make this sentence say something nicer.** The
 * screen names the expiry as the reason and Offentliggør as the way past it, which is
 * the same sentence 1ad's own unavailable card gives for the same state.
 */
export function describeAnnouncementRestore(showable: boolean): string {
  return showable
    ? 'Den forrige besked er sat tilbage og vises igen på hjemmesiden.'
    : 'Den forrige besked er sat tilbage, men den er udløbet, så den vises ikke på hjemmesiden.'
}

/**
 * Why a restore could not happen, or `null` when it did.
 *
 * `nothing_to_restore` and `invalid_snapshot` are the two this operation owns; the
 * rest are the refusals every write in this administration shares, and they are worded
 * once here so a caller does not have to.
 */
export function describeRestoreObstacle(status: RestoreAnnouncementStatus): string | null {
  switch (status) {
    case 'restored':
      return null
    case 'nothing_to_restore':
      return 'Der er ingen tidligere besked at sætte tilbage.'
    case 'invalid_snapshot':
      return 'Den gemte tidligere besked kan ikke læses, så den blev ikke sat tilbage.'
    case 'conflict':
      return 'Nogen andre har rettet beskeden imens. Genindlæs siden, og prøv igen.'
    case 'not_found':
      return 'Beskeden blev ikke fundet.'
    case 'forbidden':
      return 'Du har ikke adgang til at ændre beskeden.'
    case 'failed':
      return 'Beskeden kunne ikke sættes tilbage. Prøv igen.'
  }
}
