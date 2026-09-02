import { z } from 'zod'

import { defineDraft } from './define'
import { optionalRowId, optionalText, requiredText, rowId, sortOrder } from './primitives'

/**
 * The three editable page documents — technical plan §4 ("Document shapes").
 *
 * `pages.published` is one jsonb document per page and `pages.draft` holds the
 * top-level sections that were edited. Publishing merges them shallowly
 * (`published || draft`), which has one consequence worth stating plainly:
 *
 *     **A section that appears in a draft must be complete.**
 *
 * Merging `{"hero": {"heading": "Ny"}}` over a live hero would drop its intro, because
 * a shallow merge replaces the whole `hero` value. So every section object below
 * requires all of its keys — a value may be `null`, but it may not be missing. An
 * editor therefore loads the live section, changes what it changes, and submits the
 * section whole; the schema is what makes that a rule rather than a convention.
 *
 * The keys are the document's own snake_case keys, because they are what the public
 * read layer already looks for (`lib/content/pages.ts`) and what the SQL merge sees.
 *
 * Owner and Staff are separated at the *entity* level here, exactly as the §5 matrix
 * describes it: Forsiden is Owner-only and the other two are Staff. That is why
 * `hero`, `award`, `featured_dish_ids` and `about_excerpt` exist in the home schema
 * and in no other — a staff member submitting them to the Mad ud af huset or Om os
 * editor is rejected for unknown keys before any authorization question is asked.
 */

const HEADING_MAX = 120
const INTRO_MAX = 400
const BODY_MAX = 2000

/** The Forside editor's two limits (1u), stated once for the form and the schema. */
export const HOME_HEADING_MAX = HEADING_MAX
export const HOME_TEXT_MAX = INTRO_MAX

/**
 * The three Forside image slots (phase 11A) — 1u's "Hovedbillede", "Udmærkelsesfoto"
 * and "Holdfoto". Each is an `image_id` and nothing else: no path, no derivative, no
 * alt text (the library owns the description, §0y). The key is **required** in every
 * section, for the reason stated at the top of this file — a section without it would
 * shallow-merge over the published section and silently drop the live photo.
 *
 * `null` is a value ("no image") and is what a pending removal stores; the public
 * read renders the reserved frame for it.
 */
const sectionImage = () => optionalRowId('Billedet')

/** How many burgers "Tre fra menuen" features (1g). */
export const FEATURED_DISH_LIMIT = 3

/** Forsiden (Owner only). Design 1g / 1l; editor 1u. */
export const homeDraft = defineDraft({
  hero: z
    .object({
      heading: optionalText(HEADING_MAX, 'Overskriften'),
      intro: optionalText(INTRO_MAX, 'Introteksten'),
      image_id: sectionImage(),
    })
    .optional(),

  award: z
    .object({
      title: optionalText(HEADING_MAX, 'Titlen på udmærkelsen'),
      text: optionalText(INTRO_MAX, 'Teksten om udmærkelsen'),
      image_id: sectionImage(),
    })
    .optional(),

  // Exactly the three burgers the Forside features (1g). Referenced by id, so a
  // renamed dish keeps working and a deleted one leaves no dangling name behind. The
  // same dish cannot be featured twice: three cards of one burger is not a choice
  // anybody makes on purpose, and the editor could not show which slot to clear.
  featured_dish_ids: z
    .array(rowId('En fremhævet ret'))
    .max(FEATURED_DISH_LIMIT, { error: 'Forsiden viser højst tre fremhævede retter.' })
    .refine((ids) => new Set(ids).size === ids.length, {
      error: 'Den samme ret kan kun fremhæves én gang.',
    })
    .optional(),

  about_excerpt: z
    .object({
      heading: optionalText(HEADING_MAX, 'Overskriften'),
      text: optionalText(INTRO_MAX, 'Teksten'),
      image_id: sectionImage(),
    })
    .optional(),
})

/** Mad ud af huset (Staff). Design 1ai / 1aj. */
export const takeawayDraft = defineDraft({
  heading: optionalText(HEADING_MAX, 'Overskriften').optional(),
  intro: optionalText(INTRO_MAX, 'Introteksten').optional(),
  cta_label: optionalText(60, 'Knapteksten').optional(),

  // Free text sections, not a fixed list of packages (1ai). Adding, removing and
  // reordering is the whole editor; nothing here is a price or a delivery term.
  sections: z
    .array(
      z.object({
        id: requiredText(60, 'Afsnittets id'),
        heading: optionalText(HEADING_MAX, 'Afsnittets overskrift'),
        body: optionalText(BODY_MAX, 'Afsnittets tekst'),
        sort: sortOrder,
      }),
    )
    .max(20, { error: 'Siden kan højst have 20 afsnit.' })
    .optional(),
})

/** Om os (Staff). Design 1i / 1o. */
export const aboutDraft = defineDraft({
  heading: optionalText(HEADING_MAX, 'Overskriften').optional(),

  story_blocks: z
    .array(optionalText(BODY_MAX, 'Et tekstafsnit'))
    .max(10, { error: 'Historien kan højst have 10 afsnit.' })
    .optional(),

  team: z.object({ text: optionalText(BODY_MAX, 'Teksten om holdet') }).optional(),

  method: z
    .object({
      heading: optionalText(HEADING_MAX, 'Overskriften'),
      text: optionalText(BODY_MAX, 'Teksten'),
    })
    .optional(),
})
