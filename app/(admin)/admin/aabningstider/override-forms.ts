import type { OverrideSaveOutcome } from '@/lib/hours/override-admin'
import {
  decodeOverrideProblems,
  type OverrideFormValues,
  type OverrideProblem,
} from '@/lib/hours/override-form'

import { openingHoursHref } from './routes'

/**
 * The one-off card's two vocabularies — design 1t (lower card); technical plan §8.
 *
 * **Two, and they are disjoint on purpose.** This screen now carries two permission
 * domains and, inside the lower one, two operations that act on the same row by different
 * rules — an ordinary Gem that writes a pending change, and a removal that can take a live
 * override off the hjemmeside at once. Keeping their field names apart is what makes
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
 *
 * WHAT NEITHER SHAPE HAS A FIELD FOR
 *
 * A table name, a column name, an entity name or a status: the entity is a literal in the
 * action and the row is located by an id RLS still has to allow. A **message**, a link or
 * an expiry: the generated opening-hours announcement is **phase 8C**, and nothing
 * submitted here can reach `public.announcement`. A weekday: this card is about one
 * calendar date and the recurring week is the other card's, whose twenty-one field names
 * (`aaben-*`, `fra-*`, `til-*`) are read by a different parser in a different file and are
 * Owner-only at three independent layers.
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
