import type { OverrideSaveOutcome } from '@/lib/hours/override-admin'
import {
  decodeOverrideProblems,
  type OverrideFormValues,
  type OverrideProblem,
} from '@/lib/hours/override-form'

import { openingHoursHref } from './routes'

/**
 * The one-off card's vocabularies — design 1t (lower card), 1ae; technical plan §8.
 *
 * **Disjoint on purpose.** This screen carries two permission domains and, inside the
 * lower one, several operations that act on the same rows by different rules — an
 * ordinary Gem that writes a pending change, a removal that can take a live override off
 * the hjemmeside at once, and (since 8C-3B) the optional generated announcement with
 * 1ae's decision and its Fortryd. Keeping their field names apart is what makes
 * "a save can never remove anything, and a removal can never carry content" a property of
 * the parsers rather than a claim about the actions:
 *
 *   * {@link OVERRIDE_FORM} — what the *editor* submits: a date, a kind, two times and the
 *     version token. It has **no** field that could delete anything.
 *   * {@link OVERRIDE_ROW_FORM} — what the removal control submits: the row's id, the
 *     version token it was rendered from and, on the second press, the confirmation. No
 *     date, no kind, no times, so a removal cannot carry a content value at all. (The
 *     pending band's Offentliggør carries less still: one date, and the server resolves
 *     everything else from it.)
 *   * {@link OVERRIDE_ANNOUNCEMENT_FORM}, {@link OVERRIDE_CONFLICT_FORM} and
 *     {@link OVERRIDE_UNDO_FORM} — the generated announcement's three (8C-3B), documented
 *     on each below. The **wording** is the one content value any of them may carry.
 *
 * WHAT NO SHAPE HAS A FIELD FOR
 *
 * A table name, a column name, an entity name or a status: the entity is a literal in the
 * action and the row is located by an id RLS still has to allow. An **expiry**, a link, a
 * source or an owning override: the server re-derives all four from the published rows on
 * every call, so no submission can move them (§7e item 8). A weekday: this card is about
 * one calendar date and the recurring week is the other card's, whose twenty-one field
 * names (`aaben-*`, `fra-*`, `til-*`) are read by a different parser in a different file
 * and are Owner-only at three independent layers.
 *
 * `version` carries the `updated_at` the card was rendered from — the whole of optimistic
 * concurrency (§6). `version-dato` carries the date that version belongs to, because a
 * person may type a *different* date into the field than the one the screen was rendered
 * for, and a version token from another row is not a version token at all: see
 * `./override-actions.ts`, which refuses that submission rather than guessing.
 */

export const OVERRIDE_FORM = {
  date: 'dato',
  kind: 'art',
  from: 'fra',
  to: 'til',
  version: 'version',
  /** The date the `version` token was read for. A version belongs to one row. */
  versionDate: 'version-dato',
} as const

/**
 * The removal control: a row, the version it was rendered from, and the confirmation.
 *
 * No date, no kind and no times, so a removal can never carry a content value — which is
 * the other half of "a save can never remove anything". `bekraeft` is present only on the
 * second submission, and only for the one removal a guest would notice (see
 * `./override-remove-actions.ts`).
 */
export const OVERRIDE_ROW_FORM = {
  id: 'aendring',
  version: 'version',
  confirm: 'bekraeft',
} as const

/**
 * 1t's optional generated announcement — the three fields the card adds, and no others.
 *
 * **What the browser is allowed to say**, and it is the whole list: *whether* the person
 * asked for the message, *what wording* they approved, and *which version* of the
 * announcement they were looking at when they asked (§6). Nothing here can reach an
 * expiry, a link, a source, an owner, `previous` or `replaced_at`: the server re-reads
 * the published override and the recurring week and re-asks `generateOpeningHoursAnnouncement()`
 * for all five, on the first call and again on the confirmed one (§7 of the 8C-3B brief).
 *
 * `message` is the single exception, and it is an exception by design rather than by
 * omission: the override model has no reason column, so *"Lukket mandag 21.09"* is
 * deliberately neutral and 1t offers it as *"Foreslået besked — ret den gerne"*.
 * `withEditedMessage()` is where that permission ends — it validates the wording against
 * 1ac's rules and can assign to `message` and nothing else.
 */
export const OVERRIDE_ANNOUNCEMENT_FORM = {
  /** 1t's checkbox. Present and `'1'` exactly when the person asked for the message. */
  wanted: 'besked-til',
  /** The wording they approved — the generator's, or their own edit of it. */
  message: 'besked-tekst',
  /** The `updated_at` the announcement singleton was rendered from (§6). */
  version: 'besked-version',
} as const

/**
 * 1ae's own submission: which override, both version tokens, the wording, and the one bit.
 *
 * The sheet is a *second* request, so it carries its own tokens rather than trusting the
 * ones the first attempt used — and the server re-reads every row named here before it
 * writes. "Behold eksisterende besked" submits none of this: it is a link, and it writes
 * nothing at all (§12 of the 8C-3B brief).
 */
export const OVERRIDE_CONFLICT_FORM = {
  override: 'aendring',
  overrideVersion: 'aendring-version',
  version: 'besked-version',
  message: 'besked-tekst',
  /** 1ae's "Erstat med den nye besked". Never set by the first attempt. */
  confirm: 'erstat',
} as const

/** The Fortryd strip: the announcement version token the write returned, and nothing else. */
export const OVERRIDE_UNDO_FORM = {
  version: 'besked-version',
} as const

/** The query parameter a refused save carries its codes in. */
export const OVERRIDE_ERROR_FIELD = 'enkelt-fejl'

function text(source: FormData | URLSearchParams, name: string): string {
  const value = source.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Exactly what the editor submitted, before any rule has been applied to it.
 *
 * Five names are read and no others, so a form carrying `status`, `id`, `aaben-mon` or
 * `schedule` contributes nothing — the reading is by name rather than by iteration, which
 * is the structural half of "no extra value reaches the row".
 * `toOverrideDraft` is what decides whether these strings mean anything.
 */
export function readOverrideForm(source: FormData | URLSearchParams): OverrideFormValues {
  return {
    date: text(source, OVERRIDE_FORM.date),
    kind: text(source, OVERRIDE_FORM.kind),
    from: text(source, OVERRIDE_FORM.from),
    to: text(source, OVERRIDE_FORM.to),
  }
}

/** The date the submitted version token was read for, or `''`. */
export function readOverrideVersionDate(source: FormData | URLSearchParams): string {
  return text(source, OVERRIDE_FORM.versionDate)
}

/**
 * What the card asked for on behalf of the announcement — or `null` when it asked for
 * nothing.
 *
 * `null` is 1t's checkbox left clear, and §3 of the brief makes it a complete answer:
 * publish the hours, call no coordinator, touch no announcement, create no ownership and
 * show no sheet. It is read by name like everything else here, so a submission that
 * carries a message without the checkbox asks for nothing — the wording is not the
 * request.
 *
 * The message is passed on **as typed**, including the whitespace: trimming and 1ac's
 * 90-character rule are `withEditedMessage()`'s, applied on the server against the
 * generated announcement it is about to substitute into, so there is one implementation
 * of "is this message allowed" rather than one here and one there.
 */
export type AnnouncementRequest = {
  readonly message: string
  /** The announcement version the card was rendered from (§6). */
  readonly version: string
}

export function readAnnouncementRequest(
  source: FormData | URLSearchParams,
): AnnouncementRequest | null {
  if (text(source, OVERRIDE_ANNOUNCEMENT_FORM.wanted) !== '1') return null

  return {
    message: text(source, OVERRIDE_ANNOUNCEMENT_FORM.message),
    version: text(source, OVERRIDE_ANNOUNCEMENT_FORM.version),
  }
}

/**
 * The query string a refused save comes back with: the codes, and what was submitted.
 *
 * Opening hours, not personal data, and re-parsed by {@link readOverrideForm} on the way
 * back in — so the URL is a convenience for the person, never a source of authority. React
 * escapes the values when it renders them into the controls, and a time that is not one of
 * the offered options simply selects nothing.
 */
export function encodeOverrideEcho(
  form: OverrideFormValues,
  errors: readonly OverrideProblem[],
): URLSearchParams {
  const parameters = new URLSearchParams()

  for (const code of errors) parameters.append(OVERRIDE_ERROR_FIELD, code)

  parameters.set(OVERRIDE_FORM.date, form.date)
  parameters.set(OVERRIDE_FORM.kind, form.kind)
  parameters.set(OVERRIDE_FORM.from, form.from)
  parameters.set(OVERRIDE_FORM.to, form.to)

  return parameters
}

/** Only codes the domain module defined. Anything else in the URL contributes nothing. */
export { decodeOverrideProblems }

// ---------------------------------------------------------------------------
// Where a save sends somebody
// ---------------------------------------------------------------------------

/**
 * The address a save comes back to, for each outcome it can have.
 *
 * Here rather than in either action, because 1t draws **two** buttons that save — the
 * ordinary "Gem" and the "Gem og offentliggør" beside it — and a refusal must read the
 * same either way. One table rather than two that agree today.
 *
 * A pure function of the outcome, so nothing about *which control was pressed* can change
 * what a refusal says, and nothing here decides anything: the statuses are the machinery's
 * own words, prefixed so the lower card's messages cannot collide with the upper card's
 * (`conflict` means "the week moved" above and "this date moved" below, and they are two
 * different sentences).
 */
export function overrideSaveHref(
  form: OverrideFormValues,
  outcome: OverrideSaveOutcome,
): string {
  switch (outcome.kind) {
    case 'invalid':
      return openingHoursHref(
        { status: 'enkelt_ugyldig', overrideFocus: true },
        encodeOverrideEcho(form, outcome.errors),
      )
    case 'date_taken':
      // The date they chose, showing whatever is already there. Nothing was written.
      return openingHoursHref({
        date: outcome.date,
        overrideFocus: true,
        status: 'enkelt_findes',
      })
    case 'refused':
      return openingHoursHref({
        date: outcome.date,
        overrideFocus: true,
        status: `enkelt_${outcome.status}`,
      })
    case 'saved':
      return openingHoursHref({
        date: outcome.date,
        overrideFocus: true,
        status: outcome.unchanged ? 'enkelt_uaendret' : 'enkelt_gemt',
      })
  }
}
