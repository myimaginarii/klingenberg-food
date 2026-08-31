import { z } from 'zod'

import { WEEKDAY_KEYS } from '@/lib/time/calendar'

import { defineDraft } from './define'

/**
 * The weekly opening hours — technical plan §4, §5 (Owner only), §7.
 *
 * `opening_hours.schedule` is the document the whole time layer reads: the "Åbent nu"
 * badge, the footer table, Find os, and the sold-out reset in §7b all resolve through
 * it. It is validated in the database by `public.is_valid_opening_schedule()`, and the
 * schema here says the same thing in the same order, so a schedule the database would
 * refuse is refused with a Danish message first.
 *
 * A day is either closed or a pair of wall-clock times, and `from` must precede `to`.
 * Both are civil times with no timezone (`lib/time/calendar.ts`); turning them into
 * instants is the hours engine's job and happens nowhere else.
 */

const CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

const daySchedule = z.union([
  z.strictObject({ closed: z.literal(true) }),
  z
    .strictObject({
      from: z.string().regex(CLOCK_TIME, { error: 'Åbningstidspunktet skal skrives som TT:MM.' }),
      to: z.string().regex(CLOCK_TIME, { error: 'Lukketidspunktet skal skrives som TT:MM.' }),
    })
    .refine((day) => day.from < day.to, {
      error: 'Der skal være åbent i mindst et minut — lukketiden skal ligge efter åbningstiden.',
    }),
])

/** Exactly the seven weekday keys, no more and no fewer — as the CHECK requires. */
export const weeklyScheduleSchema = z.strictObject(
  Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, daySchedule])) as Record<
    (typeof WEEKDAY_KEYS)[number],
    typeof daySchedule
  >,
)

export const openingHoursDraft = defineDraft({
  schedule: weeklyScheduleSchema.optional(),
})

/**
 * A one-off override's pending edit — design 1t (lower card); technical plan §4, §7e.
 *
 * Three fields, and deliberately not a fourth. `date` is the row's **identity**, not its
 * content: it is UNIQUE, it is what a person selects before there is anything to edit, and
 * an override moved to another date is a different override. So a draft can change what
 * happens on a date and can never change *which* date — which is also why no form on the
 * screen submits a date together with a version token belonging to a different one.
 *
 * `status`, `updated_by` and the timestamps are absent for the ordinary reason every
 * draft schema leaves such fields out: they are not content. The strict parse in
 * `saveEntityDraft` therefore refuses a submission naming any of them rather than
 * ignoring it. Generated-announcement ownership is not in this list either, and cannot
 * be: since 8C-3A it lives on the *announcement* row as `source_override_id`, so there
 * is no override column for a draft to reach.
 *
 * The consistency rule between the three (closed carries no times; custom carries both,
 * opening before closing) is **not** stated here, because a Zod object shape cannot say
 * it without becoming a `ZodEffects` that no longer satisfies `DraftSpec`. It is stated
 * three times where it can be: `toOverrideDraft` in `lib/hours/override-form.ts` refuses
 * it with a Danish sentence, `overrideDraftWrite` always writes all three fields or clears
 * all three so a stored draft is complete or absent, and `overrides_shape_check` in the
 * database refuses the merge outright. The last of those is the guarantee.
 */
export const openingHoursOverrideDraft = defineDraft({
  kind: z.enum(['closed', 'custom'], { error: 'Vælg, hvad der sker den dag.' }).optional(),
  opens_at: z
    .string()
    .regex(CLOCK_TIME, { error: 'Åbningstidspunktet skal skrives som TT:MM.' })
    .nullable()
    .optional(),
  closes_at: z
    .string()
    .regex(CLOCK_TIME, { error: 'Lukketidspunktet skal skrives som TT:MM.' })
    .nullable()
    .optional(),
})
