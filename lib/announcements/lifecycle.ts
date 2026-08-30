import { announcementDraft } from '@/lib/schemas/announcement'

import { isAnnouncementExpired, parseExpiryInstant } from './expiry'
import type { AnnouncementLinkValues } from './link'

/**
 * What an announcement *is*, and when a guest sees it — design 1ac, 1ad; technical
 * plan §4, §6, §7c.
 *
 * One announcement at a time, above the navigation, for temporary operational
 * information, with a required future expiry and an optional link. 1ac states the rules
 * in five lines and this module is those five lines as functions:
 *
 *   * Højst én besked ad gangen — the table is a singleton, so this is structural.
 *   * Kort besked — {@link ANNOUNCEMENT_MESSAGE_MAX_LENGTH}, which is also the column's
 *     own CHECK and the schema's own limit.
 *   * Link er valgfrit — `./link.ts`.
 *   * **Udløb er påkrævet** — {@link announcementPublishOutlook} refuses to call an
 *     announcement publishable without one, and without one *in the future*.
 *   * Ligger i flowet — a layout decision, made in `app/(site)/layout.tsx`.
 *
 * Everything here is pure and takes its `now` as an argument. The public bar, the
 * admin's state banner and the publish check all ask these functions, so "is this
 * message live?" has one answer in this system rather than three.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT CONTAIN
 *
 *   * **No immediate path.** "Vis besked" off, "Fjern beskeden nu", replacing an active
 *     announcement and restoring the previous one from `previous` are §6's immediate
 *     operations and belong to phase 7B. There is no function here that writes
 *     `is_visible`, no reference to `previous` or `replaced_at`, and no ten-second undo.
 *   * **No opening-hours announcement.** `source` stays `'manual'`; generating a message
 *     from a one-off override, and the conflict sheet 1ae draws for it, are phase 8.
 *   * **No history.** 1ad says it plainly: "intet arkiv, ingen kladdeliste, ingen
 *     historik". §4 lists the announcement history table among the tables deliberately
 *     not created.
 */

/** 1ac and 1ad both draw the counter as "… / 90", and the column CHECK agrees. */
export const ANNOUNCEMENT_MESSAGE_MAX_LENGTH = 90

/** The label of the announcement's accessible region (1ac, "Skærmlæser"). */
export const ANNOUNCEMENT_REGION_LABEL = 'Besked fra restauranten'

// ---------------------------------------------------------------------------
// The editable row
// ---------------------------------------------------------------------------

/** The editable content of `announcement`, in database casing. */
export type AnnouncementValues = AnnouncementLinkValues & {
  message: string | null
  /** An **instant**, as an ISO 8601 string. Never a civil date (§7c). */
  expires_at: string | null
}

export type AnnouncementField = keyof AnnouncementValues

/**
 * The fields 1ad's editor owns.
 *
 * Written as an exhaustive-by-construction record, the same way the dish, weekly and
 * monthly editors declare theirs, so a field added to {@link AnnouncementValues} has to
 * be placed here or left out deliberately.
 *
 * This editor happens to own **every** field the draft schema carries — an announcement
 * has no image, no sort order and no field another phase owns. That is a fact about this
 * entity rather than a licence to use `replace` when saving: `is_visible` is not in
 * `announcementDraft` at all, so a draft cannot carry it either way, and the save still
 * merges with an explicit `clear` for the same reason every other editor does (see
 * `lib/publishing/drafts.ts`).
 */
const ANNOUNCEMENT_EDITOR_FIELD_SET = {
  message: true,
  link_type: true,
  link_page: true,
  link_url: true,
  link_label: true,
  expires_at: true,
} as const satisfies Record<AnnouncementField, true>

export const ANNOUNCEMENT_EDITOR_FIELDS = Object.keys(
  ANNOUNCEMENT_EDITOR_FIELD_SET,
) as readonly AnnouncementField[]

/** Every field the stored draft may carry, from the schema itself. */
export const ANNOUNCEMENT_DRAFT_FIELDS: readonly string[] = announcementDraft.fields

// ---------------------------------------------------------------------------
// The delta rule — technical plan §4
// ---------------------------------------------------------------------------

/**
 * The fields a submission actually changes.
 *
 * §4 describes `draft` as holding "only the changed fields", and this is what keeps that
 * literally true for a form that submits everything it renders. A field changed back to
 * the published value produces no draft entry, so the Kladde badge cannot announce a
 * change the next publish will not make.
 *
 * `expires_at` is compared as an **instant**, not as a string: the same moment can be
 * written `2026-09-14T18:00:00Z` by this application and `2026-09-14T18:00:00+00:00` by
 * PostgREST, and a string comparison would call those two different expiries and put a
 * Kladde badge on a change nobody made.
 */
export function announcementDraftDelta(
  submitted: Partial<AnnouncementValues>,
  live: AnnouncementValues,
  fields: readonly AnnouncementField[] = ANNOUNCEMENT_EDITOR_FIELDS,
): Partial<AnnouncementValues> {
  const delta: Record<string, unknown> = {}

  for (const field of fields) {
    if (!Object.hasOwn(submitted, field)) continue

    if (field === 'expires_at') {
      if (sameInstant(submitted.expires_at ?? null, live.expires_at)) continue
      delta[field] = submitted.expires_at ?? null
      continue
    }

    if (submitted[field] === live[field]) continue
    delta[field] = submitted[field]
  }

  return delta as Partial<AnnouncementValues>
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right

  const a = parseExpiryInstant(left)
  const b = parseExpiryInstant(right)

  return a !== null && b !== null && a.getTime() === b.getTime()
}

/** What a save should write, and what it should take back out of the draft. */
export type AnnouncementDraftWrite = {
  readonly values: Partial<AnnouncementValues>
  readonly clear: readonly string[]
}

/**
 * `merge` plus an explicit `clear`, never `replace` — the rule `lib/publishing/drafts.ts`
 * sets out and the reasoning phase 5E had to undo once already.
 *
 * The fields this editor owns are merged; the ones that no longer differ from the
 * published values are cleared out of the draft, so a change made and changed back stops
 * being pending. Any other key a stored draft happens to hold is never mentioned in
 * either direction and survives untouched.
 */
export function announcementDraftWrite(
  submitted: Partial<AnnouncementValues>,
  live: AnnouncementValues,
  fields: readonly AnnouncementField[] = ANNOUNCEMENT_EDITOR_FIELDS,
): AnnouncementDraftWrite {
  const values = announcementDraftDelta(submitted, live, fields)

  return {
    values,
    clear: fields.filter((field) => !Object.hasOwn(values, field)),
  }
}

// ---------------------------------------------------------------------------
// Public eligibility — technical plan §7c, §8
// ---------------------------------------------------------------------------

/** The row as the eligibility rule reads it: content, expiry and the visibility flag. */
export type AnnouncementEligibilityInput = AnnouncementValues & {
  /**
   * `announcement.is_visible`.
   *
   * Written by exactly two things, and never by a draft: `publish_announcement()` sets it
   * (1ad — Offentliggør is how a message reaches the hjemmeside), and §6's immediate path
   * clears it (phase 7B's "Vis besked" off and "Fjern beskeden nu"). See §0f.
   */
  readonly is_visible: boolean
}

/**
 * Is this announcement one a guest may see, at `now`?
 *
 * Three conditions, all of which the anonymous RLS policy also states in SQL
 * (`is_visible and message is not null and expires_at is not null and expires_at > now()`).
 * The policy is the security boundary; this is the *rendering* boundary, and both exist
 * because they answer at different moments:
 *
 *   * RLS answers when the row is **fetched**, and the fetch is cached for up to five
 *     minutes (§6, §7a). An expiry that passes inside that window does not un-fetch a
 *     row that is already in the cache.
 *   * This answers when the page is **rendered**, against that render's own clock, which
 *     is what makes "an expired announcement is never rendered from a fresh page load"
 *     true rather than approximately true.
 *
 * The remaining gap — a *cached page* whose HTML was rendered before the expiry passed —
 * is the one §7c exists for, and is closed in the browser by `AnnouncementExpiryGuard`.
 * Three layers, each covering the previous one's blind spot; none of them trusted alone.
 */
export function isAnnouncementPubliclyVisible(
  announcement: AnnouncementEligibilityInput,
  now: Date,
): boolean {
  if (!announcement.is_visible) return false
  if (announcement.message === null || announcement.message.trim().length === 0) return false

  return !isAnnouncementExpired(announcement.expires_at, now)
}

// ---------------------------------------------------------------------------
// Publishing — technical plan §6; design 1ad
// ---------------------------------------------------------------------------

/**
 * Why an announcement can or cannot go live.
 *
 *   * `ready`      — a message, and an expiry still in the future.
 *   * `blank`      — no message. 1ac: the bar is a message; there is nothing to show.
 *   * `no_expiry`  — 1ac: "Udløb er påkrævet".
 *   * `expired`    — an expiry that has already passed. Publishing it would put a
 *                    message live that nothing would ever show.
 */
export type AnnouncementPublishOutlook = 'ready' | 'blank' | 'no_expiry' | 'expired'

/**
 * What publishing these values would produce, at `now`.
 *
 * Given the **merged** values — the live row with the draft over it — which is exactly
 * what `publish_announcement()` will write. The screen uses it to decide whether
 * Offentliggør is available (1ad: "Offentliggør er nedtonet, indtil feltet er gyldigt"),
 * and the Server Action uses it again before it publishes anything. Neither is trusted
 * as the only check: the database function repeats the same two rules in SQL and refuses
 * a publish that would break them, so a forged request meets the same answer.
 */
export function announcementPublishOutlook(
  values: AnnouncementValues,
  now: Date,
): AnnouncementPublishOutlook {
  if (values.message === null || values.message.trim().length === 0) return 'blank'
  if (values.expires_at === null) return 'no_expiry'
  if (isAnnouncementExpired(values.expires_at, now)) return 'expired'

  return 'ready'
}

/** The sentence beneath a disabled Offentliggør, or `null` when it is available. */
export function describePublishObstacle(outlook: AnnouncementPublishOutlook): string | null {
  switch (outlook) {
    case 'blank':
      return 'Skriv en besked, før du offentliggør den.'
    case 'no_expiry':
      return 'Vælg et tidspunkt ude i fremtiden — beskeden kan ikke offentliggøres uden.'
    case 'expired':
      return 'Vælg et tidspunkt ude i fremtiden — beskeden kan ikke offentliggøres uden.'
    case 'ready':
      return null
  }
}

// ---------------------------------------------------------------------------
// What the administration says about the hjemmeside — design 1ad's status pill
// ---------------------------------------------------------------------------

export type AnnouncementStateTone = 'neutral' | 'success' | 'warning'

export type AnnouncementStateReport = {
  /** The pill in the burgundy bar: "Vises nu", "Udløbet", "Ingen besked". */
  readonly badge: string
  /** One sentence about what a guest sees right now. */
  readonly sentence: string
  readonly tone: AnnouncementStateTone
}

/**
 * What the hjemmeside is showing, from the **published** values and one instant.
 *
 * Read off the live row, never off the draft: it is a statement about what a guest can
 * see, and a draft is by definition something no guest has seen. That is the same rule
 * §7d asks of Månedens burger, applied to the one other entity whose visibility is
 * decided by a date rather than by a person.
 *
 * `expiresAtLabel` is passed in rather than formatted here, because a Danish date is a
 * presentation decision that already has one home (`lib/format/danish.ts` and
 * `lib/hours/format.ts`) and this module owns rules rather than wording of dates.
 */
export function describeAnnouncementState(
  live: AnnouncementEligibilityInput,
  now: Date,
  expiresAtLabel: string | null,
): AnnouncementStateReport {
  const hasMessage = live.message !== null && live.message.trim().length > 0

  if (!hasMessage) {
    return {
      badge: 'Ingen besked',
      sentence: 'Der står ingen besked på hjemmesiden lige nu.',
      tone: 'neutral',
    }
  }

  if (!live.is_visible) {
    return {
      badge: 'Slået fra',
      sentence: 'Beskeden er slået fra, så den vises ikke på hjemmesiden.',
      tone: 'neutral',
    }
  }

  if (isAnnouncementExpired(live.expires_at, now)) {
    return {
      badge: 'Udløbet',
      sentence:
        expiresAtLabel === null
          ? 'Beskeden er udløbet og vises ikke længere på hjemmesiden.'
          : `Beskeden udløb ${expiresAtLabel} og vises ikke længere på hjemmesiden.`,
      tone: 'neutral',
    }
  }

  return {
    badge: 'Vises nu',
    sentence:
      expiresAtLabel === null
        ? 'Beskeden vises øverst på hjemmesiden.'
        : `Beskeden vises øverst på hjemmesiden indtil ${expiresAtLabel}.`,
    tone: 'success',
  }
}

// ---------------------------------------------------------------------------
// The Kladde band — 1aa's pending vocabulary
// ---------------------------------------------------------------------------

/** The Danish name of each editable field, for the pending sentence. */
const FIELD_NAMES: Record<string, string> = {
  message: 'beskeden',
  link_type: 'linket',
  link_page: 'linket',
  link_url: 'linket',
  link_label: 'linkteksten',
  expires_at: 'udløbstidspunktet',
}

/**
 * "Ny besked afventer offentliggørelse" — named by what actually changed.
 *
 * Derived from the stored draft's own changed fields, so the band cannot claim a change
 * the database does not hold. The three link columns collapse into one word, because
 * changing a page link to an address changes all three and a person made one change.
 */
export function describeAnnouncementPending(changedFields: readonly string[]): string | null {
  const named = [
    ...new Set(
      changedFields
        .filter((field) => ANNOUNCEMENT_DRAFT_FIELDS.includes(field))
        .map((field) => FIELD_NAMES[field])
        .filter((name): name is string => name !== undefined),
    ),
  ]

  if (named.length === 0) return null

  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} og ${named[named.length - 1]}`

  return `Ændringer i ${list} venter på at blive offentliggjort.`
}
