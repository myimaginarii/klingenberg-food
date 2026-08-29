import { z } from 'zod'

import { WEEKDAY_KEYS } from '@/lib/time/calendar'

import { defineDraft } from './define'
import { optionalIsoDate, optionalRowId, optionalText, priceOre } from './primitives'

/**
 * Ugens ret with Lørdagsmenu, and Månedens burger — technical plan §4, §7d.
 *
 * Both are singleton rows that are rewritten rather than accumulated: there is no
 * weekly-special history table and no monthly archive, by design (§4). "Kopiér sidste
 * uge" (decision 4) seeds a draft from the currently live row and is phase 6; it will
 * write through this schema like any other edit.
 *
 * Neither sold-out field appears here. Udsolgt is the immediate path for the weekly
 * dish, the Saturday menu and the monthly burger alike (§6).
 *
 * `starts_on` / `ends_on` are content, not a scheduler. Publishing is always a human
 * action; the window only decides whether an already-published burger is currently
 * shown, and that decision is made at read time (§7d, clarification C4).
 */

export const weeklySpecialDraft = defineDraft({
  iso_year: z
    .union([z.int().min(2000).max(2999), z.null()], { error: 'Årstallet er ikke gyldigt.' })
    .optional(),
  iso_week: z
    .union([z.int().min(1).max(53), z.null()], { error: 'Ugenummeret skal være mellem 1 og 53.' })
    .optional(),

  // The weekday keys the schedule document uses, so the public card can say
  // "Onsdag–fredag" from the same vocabulary the hours engine speaks.
  days: z
    .array(z.enum(WEEKDAY_KEYS, { error: 'Ukendt ugedag.' }))
    .max(WEEKDAY_KEYS.length)
    .refine((days) => new Set(days).size === days.length, {
      error: 'Den samme ugedag kan kun stå én gang.',
    })
    .optional(),

  name: optionalText(200, 'Rettens navn').optional(),
  description: optionalText(600, 'Beskrivelsen').optional(),
  price_small_ore: priceOre('Prisen for lille portion').optional(),
  price_large_ore: priceOre('Prisen for stor portion').optional(),
  image_id: optionalRowId('Billedet').optional(),

  sat_enabled: z.boolean({ error: 'Lørdagsmenuen er slået til eller fra.' }).optional(),
  sat_name: optionalText(200, 'Lørdagsmenuens navn').optional(),
  sat_description: optionalText(600, 'Lørdagsmenuens beskrivelse').optional(),
  sat_price_ore: priceOre('Lørdagsmenuens pris').optional(),
  sat_deadline: optionalText(120, 'Bestillingsfristen').optional(),
})

export const monthlyBurgerDraft = defineDraft({
  name: optionalText(200, 'Burgerens navn').optional(),
  description: optionalText(600, 'Beskrivelsen').optional(),
  price_ore: priceOre('Prisen').optional(),
  image_id: optionalRowId('Billedet').optional(),
  starts_on: optionalIsoDate('Startdatoen').optional(),
  ends_on: optionalIsoDate('Slutdatoen').optional(),
  show_on_homepage: z.boolean({ error: 'Visning på forsiden er slået til eller fra.' }).optional(),
})
