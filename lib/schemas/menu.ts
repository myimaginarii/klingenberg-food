import { z } from 'zod'

import { defineDraft } from './define'
import {
  optionalRowId,
  optionalText,
  priceOre,
  requiredText,
  rowId,
  sortOrder,
} from './primitives'

/**
 * The menu — technical plan §4, decision 3.
 *
 * Two draft-bearing entities: the sections and the dishes in them. Both are Staff
 * editable in full (§5).
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *   * `sold_out_on`, `sold_out_changed_at/by` — Tilgængelig/Udsolgt is the immediate
 *     path with a 10 s Fortryd (§6). It never travels through a draft, so it is not a
 *     draft field, and a request that tries to set it through one is rejected for an
 *     unknown key rather than quietly ignored.
 *   * `deleted_at`, `is_new_draft` — publish state, written by the publish function.
 *   * `slug`, `kind` on a section — the slug is the anchor a visitor may have linked
 *     to (`#menu-burgere`) and the kind is structure, not content.
 *   * `visible` on a section — a switch, not an edit.
 *
 * The editors that use these schemas are phase 5; the schemas exist now because the
 * publish machinery, the draft overlay and the pgTAP suite all need them.
 */

/** The Tapas content document stored in `dishes.details` (§4, decision 3). */
const TAPAS_GROUPS = [
  { id: 'base', mode: 'fixed' },
  { id: 'choose7', mode: 'choose' },
  { id: 'dressing', mode: 'choose' },
] as const

export const tapasDetailsSchema = z.strictObject({
  kind: z.literal('tapas'),
  groups: z
    .array(
      z.strictObject({
        id: z.enum(TAPAS_GROUPS.map((group) => group.id), {
          error: 'Ukendt tapasgruppe.',
        }),
        heading: requiredText(80, 'Gruppens overskrift'),
        mode: z.enum(['fixed', 'choose'], { error: 'Ukendt gruppetype.' }),
        // "Vælg 7" and "Vælg 3 dressinger" — the number a guest chooses, not a price.
        choose: z.union([z.int().min(1).max(20), z.null()]),
        items: z
          .array(requiredText(120, 'Et punkt på listen'))
          .max(60, { error: 'Listen kan højst have 60 punkter.' }),
      }),
    )
    // The group ids and the group count are fixed by the schema; only the heading and
    // the items are editable (§4, decision 3).
    .length(TAPAS_GROUPS.length, { error: 'Tapaslisten har præcis tre grupper.' })
    .refine(
      (groups) => groups.every((group, index) => group.id === TAPAS_GROUPS[index]?.id),
      { error: 'Tapasgrupperne skal stå i den faste rækkefølge.' },
    ),
})

/** One menu section (1r). */
export const menuCategoryDraft = defineDraft({
  name: requiredText(120, 'Sektionens navn').optional(),
  intro: optionalText(400, 'Sektionens introtekst').optional(),
  note: optionalText(400, 'Sektionens note').optional(),
  sort_order: sortOrder.optional(),
})

/** One dish (1r / 1y). */
export const dishDraft = defineDraft({
  category_id: rowId('Sektionen').optional(),
  name: requiredText(200, 'Rettens navn').optional(),
  description: optionalText(600, 'Beskrivelsen').optional(),
  secondary_note: optionalText(200, 'Den lille note').optional(),
  price_ore: priceOre('Prisen').optional(),

  // At most four distinct, non-blank labels — the shape the database CHECK enforces.
  // The value set is deliberately open: the approved design uses the four system
  // labels *and* short descriptive ones (see docs/dependencies.md, phase 3).
  labels: z
    .array(requiredText(40, 'En mærkat'))
    .max(4, { error: 'En ret kan højst have fire mærkater.' })
    .refine((labels) => new Set(labels).size === labels.length, {
      error: 'Den samme mærkat kan kun stå én gang.',
    })
    .optional(),

  // `null` clears the tapas document, which is how an entry stops being the Tapas
  // entry. Every other dish has `details` null already.
  details: z.union([tapasDetailsSchema, z.null()]).optional(),

  image_id: optionalRowId('Billedet').optional(),
  sort_order: sortOrder.optional(),
})
