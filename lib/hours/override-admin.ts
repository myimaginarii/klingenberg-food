import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { readAdminOverrideOn } from '@/lib/content/hours-overrides-admin'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { saveEntityDraft } from '@/lib/publishing/drafts'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import {
  overrideDraftWrite,
  toOverrideDraft,
  type OverrideContent,
  type OverrideFormValues,
  type OverrideProblem,
} from './override-form'

/**
 * The two writes a one-off override needs that the draft machinery cannot do — design 1t
 * (lower card); technical plan §4, §5, §6, §7e items 6 and 7.
 *
 * Everything *else* about this editor is phase 4's machinery, unchanged: `saveEntityDraft`
 * writes an edit, `publishPendingChange` publishes it, `readEditableEntity` and
 * `overlayDraft` merge it, `mayChangeEntity` authorizes it and `pending_changes` lists it.
 * This module exists for the two operations that have no draft to write:
 *
 *   * **creating** the row, because there is no row yet to attach a draft to;
 *   * **removing** it, because "this date has no override" is the absence of a row rather
 *     than a value a draft could hold.
 *
 * A **wrapper, not a mechanism**, exactly as `lib/announcements/visibility.ts` and the
 * three sold-out modules are: the transaction is the database's, and what happens here is
 * the three things that cannot happen inside it — the role matrix asked first so a refusal
 * is a sentence rather than a silent no-op from RLS (§5), the browser's intent reduced to
 * values the schema already describes, and the database's reply mapped to a status the
 * Server Action can act on.
 *
 * **Staff, not owner** — and that is the whole point of this half of the screen. §5's
 * matrix puts *"One-off opening-hour overrides ('Ret kun i dag')"* in **both** columns and
 * *"Normal weekly opening hours"* in the owner's alone, so the two cards on
 * `/admin/aabningstider` are two different permission domains. The question is asked of
 * the same registry publishing asks (`mayChangeEntity('opening_hours_override', …)`), and
 * RLS asks it again through the caller's own JWT — `overrides_insert_staff` and
 * `overrides_delete_staff`. Nothing in this module names `public.opening_hours`, so no
 * path through it can reach the recurring schedule.
 *
 * **No announcement, in any branch.** `public.announcement` is named nowhere here, and
 * neither is `announcement_created` — §4's column for the generated opening-hours message
 * of **phase 8C**. Creating, publishing and removing an override in phase 8B leaves the
 * announcement row byte-identical, which `supabase/tests/014_opening_hours_overrides.test.sql`
 * asserts from real JWTs.
 */

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export type CreateOverrideStatus =
  /** The row exists, pending. `overrideId` names it. */
  | 'created'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /**
   * There is already an override on that date.
   *
   * `date` is UNIQUE, so this is the database refusing a duplicate rather than the
   * application guessing. It is a real answer rather than a failure: the screen sends the
   * person to that date so they can see its current state and edit the right record, which
   * is what §7e's "show what is there rather than blindly creating" amounts to when two
   * people reach the same date from two tabs.
   */
  | 'exists'
  /** The database refused the insert — a CHECK, or an unreachable database. */
  | 'failed'

export type CreateOverrideResult = {
  readonly status: CreateOverrideStatus
  readonly overrideId: string | null
  /** The new row's version token (§6). Present only when `created`. */
  readonly updatedAt: string | null
}

/**
 * Create one pending override.
 *
 * The row is inserted with `status = 'draft'`, which is what keeps it out of the public
 * site: `overrides_select_public` hands a guest only published rows. So the three content
 * columns can carry the chosen values straight away — there is nothing live on that date
 * to protect, and a guest cannot read them. Every *later* edit goes through
 * `saveEntityDraft` like any other entity's, and `publish_opening_hours_override()` merges
 * whichever of the two has the newer answer.
 *
 * That is the same shape `createDishDraft` has, for the same reason: creation is not a
 * draft write, and the invisibility is carried by a column (`status` here, `is_new_draft`
 * there) rather than by ordering two writes carefully. The insert either produces an
 * invisible override or produces nothing.
 *
 * `content` is already validated — `toOverrideDraft` produced it — and `date` is already a
 * civil date the caller checked against Copenhagen's today. Neither is re-derived here,
 * and neither is taken from a form: this function is given values, never a request.
 */
export async function createOverrideDraft(
  profile: Profile,
  date: IsoDate,
  content: OverrideContent,
): Promise<CreateOverrideResult> {
  if (!mayChangeEntity('opening_hours_override', profile)) {
    return { status: 'forbidden', overrideId: null, updatedAt: null }
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('opening_hours_overrides')
    .insert({
      date,
      kind: content.kind,
      opens_at: content.opens_at,
      closes_at: content.closes_at,
      // The one column that makes this pending rather than live.
      status: 'draft',
    })
    .select('id, updated_at')
    .maybeSingle<{ id: string; updated_at: string }>()

  if (error !== null) {
    // 23505 is the UNIQUE on `date`; 42501 is RLS refusing a non-staff insert. Anything
    // else is a CHECK or an unreachable database. The message is for the server log.
    if (error.code === '23505') return { status: 'exists', overrideId: null, updatedAt: null }

    console.error(`Creating an opening-hours override failed: ${error.message}`)

    return {
      status: error.code === '42501' ? 'forbidden' : 'failed',
      overrideId: null,
      updatedAt: null,
    }
  }

  if (data === null) return { status: 'failed', overrideId: null, updatedAt: null }

  // `before` is null: there was nothing before. `after` records what was created, which is
  // what makes an accidental creation legible in the log (§8). The actor is stamped from
  // the JWT inside `log_audit`, never from a parameter.
  const audit = await supabase.rpc('log_audit', {
    p_action: 'create',
    p_entity: 'opening_hours_override',
    p_entity_id: data.id,
    p_before: null,
    p_after: { date, kind: content.kind, opens_at: content.opens_at, closes_at: content.closes_at, status: 'draft' },
  })

  if (audit.error !== null) {
    // The override exists and is invisible to guests; failing the whole creation here
    // would leave the person with a row they cannot see and no explanation. Record it and
    // carry on — the creation is visible in the administration, which is recoverable.
    console.error(
      `Could not write the audit row for opening-hours override ${data.id}: ${audit.error.message}`,
    )
  }

  return { status: 'created', overrideId: data.id, updatedAt: data.updated_at }
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

export type RemoveOverrideStatus =
  /** The row is gone; the date follows the weekly schedule again. */
  | 'removed'
  /** Somebody else changed or removed it first (§6). Nothing was written. */
  | 'conflict'
  /** No such row, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The database refused the delete, was unreachable, or answered something unknown. */
  | 'failed'

export type RemoveOverrideResult = {
  readonly status: RemoveOverrideStatus
  /** True when the removed override was live, so a guest's answer just changed. */
  readonly wasPublished: boolean
  /** The tags to expire — empty unless a **published** override was removed. */
  readonly cacheTags: readonly CacheTag[]
}

const removeResultSchema = z.object({
  status: z.enum(['removed', 'conflict', 'not_found', 'forbidden']),
  was_published: z.boolean().nullish(),
})

function refusal(status: RemoveOverrideStatus): RemoveOverrideResult {
  return { status, wasPublished: false, cacheTags: [] }
}

/**
 * Remove one override, so its date follows the normal weekly schedule again.
 *
 * §7e item 6 states a rule about *an override that is deleted*, and phase 1 gave staff a
 * DELETE policy on this table — the only content table besides `images` that has one. So
 * this is the lifecycle the model already intends rather than a new one, and it is a real
 * DELETE rather than a soft delete for the reason the migration records: an override
 * carries a date and at most two times, and re-creating one is the same three presses that
 * created it. There is nothing here that a row has to survive to preserve (§8, §0a D2).
 *
 * **The cache is expired only for a removal that a guest can notice.** Taking away a
 * *pending* override changes nothing anybody outside the administration could read, so
 * `cacheTags` is empty and the Server Action expires nothing; taking away a *published*
 * one changes the hjemmeside, so the `hours` tag is expired — after the transaction has
 * committed, and by the Server Action rather than by this module.
 *
 * The request is an id and a version token, and nothing else. No date, no status, no table
 * name: the database function locates the row and re-checks the version inside its own
 * DELETE, so a stale token is a refusal rather than a wrong write.
 */
export async function removeOverride(
  profile: Profile,
  request: { readonly overrideId: string; readonly expectedUpdatedAt: string },
): Promise<RemoveOverrideResult> {
  if (!mayChangeEntity('opening_hours_override', profile)) return refusal('forbidden')

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('remove_opening_hours_override', {
    p_id: request.overrideId,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the row and the audit log are as they were.
    console.error(`Removing an opening-hours override failed: ${error.message}`)
    return refusal('failed')
  }

  const parsed = removeResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected opening-hours override removal result.')
    return refusal('failed')
  }

  if (parsed.data.status !== 'removed') return refusal(parsed.data.status)

  const wasPublished = parsed.data.was_published === true

  return {
    status: 'removed',
    wasPublished,
    // Stated once, for the `opening_hours_override` entity, in the publishing registry —
    // so the tag a removal expires and the tag a publish expires cannot drift apart.
    cacheTags: wasPublished ? publishableEntity('opening_hours_override').cacheTags : [],
  }
}

// ---------------------------------------------------------------------------
// Saving the card — one implementation, two entrances
// ---------------------------------------------------------------------------

/**
 * What one Gem did, in a form both of the card's buttons can act on.
 *
 * 1t draws "Gem og offentliggør" as a single control, so the publish has to be able to run
 * *after* a save without either reimplementing it or being unreachable behind its redirect.
 * That is why saving is a function that **returns** rather than a Server Action that
 * redirects: the two actions in `app/(admin)/admin/aabningstider/` decide what to say and
 * where to send somebody, and this decides what happens to the row.
 */
export type OverrideSaveOutcome =
  /** The card did not describe a change this system can store. */
  | { readonly kind: 'invalid'; readonly errors: readonly OverrideProblem[] }
  /**
   * A version token from another row, or from no row.
   *
   * Somebody typed a different date into the field than the one the card was rendered for,
   * so their token belongs elsewhere and using it would be optimistic concurrency in name
   * only. The date is returned so the screen can open **that** date and show what is
   * already there — §7e's "show the current state and edit the correct record" rather than
   * "blindly create a duplicate", and the same answer when two tabs reach one date.
   */
  | { readonly kind: 'date_taken'; readonly date: IsoDate }
  /** The write was refused. `status` is the machinery's own word for why. */
  | { readonly kind: 'refused'; readonly date: IsoDate; readonly status: string }
  /** Written. `unchanged` means the edit put the row back to what it already held. */
  | {
      readonly kind: 'saved'
      readonly date: IsoDate
      readonly overrideId: string
      readonly unchanged: boolean
    }

export type OverrideSaveInput = {
  /** Exactly what the card submitted, unvalidated. */
  readonly form: OverrideFormValues
  /** The `updated_at` the card was rendered from (§6). */
  readonly version: unknown
  /** The date that version token was read for. A version belongs to one row. */
  readonly versionDate: string
}

/**
 * Save the one-off card: create the date's row, or write its draft.
 *
 * The order is fixed and every step is the server's own:
 *
 *   1. **what the card means**, against Copenhagen's today — `toOverrideDraft`, which is
 *      pure and knows no clock, so the date rule (§7e item 7) cannot be moved by a
 *      browser in another timezone;
 *   2. **that date's own row**, read through the caller's JWT so RLS decides it exists;
 *   3. **create it, or write its draft.** A date with no row yet is created with
 *      `status = 'draft'`, which is what keeps it out of the public site; a date that
 *      already has one has its `draft` written by `saveEntityDraft`, with the strict
 *      parse, the allow-list, the role matrix and the version check that every other
 *      draft write in this administration goes through.
 *
 * The delta is measured against the row's **columns** rather than against what the card
 * was rendered with, so an edit taken back to what the row already holds leaves no draft
 * behind (§4) — which is what stops the Kladde badge and the dashboard count from claiming
 * a change the database does not hold.
 */
export async function applyOverrideForm(
  profile: Profile,
  input: OverrideSaveInput,
): Promise<OverrideSaveOutcome> {
  const parsed = toOverrideDraft(input.form, copenhagenDateOf(new Date()))
  if (!parsed.ok) return { kind: 'invalid', errors: parsed.errors }

  const existing = await readAdminOverrideOn(parsed.date)

  if (existing === null) {
    const created = await createOverrideDraft(profile, parsed.date, parsed.content)

    if (created.status === 'exists') return { kind: 'date_taken', date: parsed.date }
    if (created.status !== 'created' || created.overrideId === null) {
      return { kind: 'refused', date: parsed.date, status: created.status }
    }

    return {
      kind: 'saved',
      date: parsed.date,
      overrideId: created.overrideId,
      unchanged: false,
    }
  }

  // The token has to be the one this row was rendered with.
  if (input.versionDate !== parsed.date || typeof input.version !== 'string') {
    return { kind: 'date_taken', date: parsed.date }
  }

  const write = overrideDraftWrite(parsed.content, existing.stored)

  const result = await saveEntityDraft(profile, {
    entity: 'opening_hours_override',
    entityId: existing.id,
    expectedUpdatedAt: input.version,
    mode: 'merge',
    values: write.values,
    clear: write.clear,
  })

  if (result.status !== 'saved') {
    return { kind: 'refused', date: parsed.date, status: result.status }
  }

  return {
    kind: 'saved',
    date: parsed.date,
    overrideId: existing.id,
    // Every field was cleared, so the row holds no pending edit of its own any more.
    unchanged: write.clear.length > 0,
  }
}
