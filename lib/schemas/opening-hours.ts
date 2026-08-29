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
