import { z } from 'zod'

import { MAX_CUSTOM_LABEL_LENGTH, MAX_DISH_LABELS } from '@/lib/menu/labels'
import {
  MAX_TAPAS_HEADING_LENGTH,
  MAX_TAPAS_ITEM_LENGTH,
  MAX_TAPAS_ITEMS,
  TAPAS_GROUP_RULES,
} from '@/lib/menu/tapas'

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

/**
 * The Tapas content document stored in `dishes.details` (§4, decision 3).
 *
 * The structure — which groups exist, in which order, with which `mode` and which
 * `choose` count — comes from `TAPAS_GROUP_RULES` in `lib/menu/tapas.ts` and is stated
 * nowhere else. This schema is where that structure is *enforced*: a fourth group, a
 * renamed id, a group in the wrong place, a changed `mode` and a changed `choose` count
 * are each a refusal, so a hand-built request cannot turn "Vælg 7" into "Vælg 12" and a
 * stored draft written by an older editor cannot reach a live menu carrying a shape the
 * current rules would refuse.
 *
 * `choose` may be **absent** where the rules say `null`, which is what `supabase/seed.sql`
 * writes for the fixed-contents group: there is nothing to choose, so there is nothing to
 * say. Writing it explicitly as `null` is equally accepted, and is what the editor stores.
 *
 * Only `heading` and `items` are content, and they are the only things the editor
 * submits (`app/(admin)/admin/menu/tapas-form.ts`).
 */
export const tapasDetailsSchema = z.strictObject({
  kind: z.literal('tapas'),
  groups: z
    .array(
      z.strictObject({
        id: z.enum(
          TAPAS_GROUP_RULES.map((rule) => rule.id),
          { error: 'Ukendt tapasgruppe.' },
        ),
        heading: requiredText(MAX_TAPAS_HEADING_LENGTH, 'Gruppens overskrift'),
        mode: z.enum(['fixed', 'choose'], { error: 'Ukendt gruppetype.' }),
        // "Vælg 7" and "Vælg 3 dressinger" — the number a guest chooses, not a price.
        choose: z.union([z.int().min(1).max(20), z.null()]).optional(),
        items: z
          .array(requiredText(MAX_TAPAS_ITEM_LENGTH, 'Et punkt på listen'))
          .max(MAX_TAPAS_ITEMS, {
            error: `Listen kan højst have ${MAX_TAPAS_ITEMS} punkter.`,
          }),
      }),
    )
    .length(TAPAS_GROUP_RULES.length, { error: 'Tapaslisten har præcis tre grupper.' })
    .refine(
      (groups) =>
        groups.every((group, index) => {
          const rule = TAPAS_GROUP_RULES[index]

          return (
            rule !== undefined &&
            group.id === rule.id &&
            group.mode === rule.mode &&
            (group.choose ?? null) === rule.choose
          )
        }),
      {
        error:
          'Tapasgrupperne skal stå i den faste rækkefølge med deres faste type og antal.',
      },
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
  // labels *and* short descriptive ones (see docs/dependencies.md, phase 3, and the
  // confirmed phase-5B decision recorded in `lib/menu/labels.ts`).
  //
  // Three rules, each mirroring one the editor already applied, because this schema is
  // also what a *stored* draft is re-validated against before it is published: a draft
  // written by an older editor, or by anything that is not the editor, must not reach
  // a live menu carrying a label the current rules would refuse.
  //
  // The case-insensitive duplicate check is deliberately stricter than the database's
  // own `distinct`. "Kylling" and "kylling" beside the same dish is a mistake every
  // time, and the database cannot know that.
  labels: z
    .array(requiredText(MAX_CUSTOM_LABEL_LENGTH, 'En mærkat'))
    .max(MAX_DISH_LABELS, { error: `En ret kan højst have ${MAX_DISH_LABELS} mærkater.` })
    .refine(
      (labels) =>
        new Set(labels.map((label) => label.toLocaleLowerCase('da-DK'))).size === labels.length,
      { error: 'Den samme mærkat kan kun stå én gang.' },
    )
    .optional(),

  // `null` clears the tapas document, which is how an entry stops being the Tapas
  // entry. Every other dish has `details` null already.
  details: z.union([tapasDetailsSchema, z.null()]).optional(),

  image_id: optionalRowId('Billedet').optional(),
  sort_order: sortOrder.optional(),
})

/**
 * The dish draft's editable field names, as a type.
 *
 * Derived from the schema rather than typed a second time, so `lib/menu/admin.ts`
 * cannot describe a pending change in a field the schema does not have — and a field
 * added here without a Danish name there is a compile error rather than a row that
 * says nothing useful.
 */
export const MENU_DRAFT_FIELDS = dishDraft.fields as readonly (keyof typeof dishDraft.input.shape)[]

export type MenuDraftField = (typeof MENU_DRAFT_FIELDS)[number]

/**
 * Creating a dish — design 1r ("+ Tilføj ret"), technical plan §4, §6.
 *
 * A new dish starts life as an unpublished row (`is_new_draft = true`), so the two
 * things it cannot be created without are the two things that decide where it goes and
 * what it is called. Everything else — price, description, labels — is an ordinary
 * draft edit afterwards and is therefore governed by `dishDraft` above.
 *
 * Strict, like every other write path: an unknown key is a refusal rather than
 * something to ignore. The category is re-checked against `mayHoldDishes` in the
 * Server Action, because "is this a real uuid" and "is this a section that may hold
 * dishes" are different questions and only the second one knows about Ugens ret.
 */
export const newDishInput = z.strictObject({
  category_id: rowId('Sektionen'),
  name: requiredText(200, 'Rettens navn'),
})

export type NewDishInput = z.infer<typeof newDishInput>
