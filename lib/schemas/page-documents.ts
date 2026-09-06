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
 * A section's image slot — the three Forside slots (phase 11A: 1u's "Hovedbillede",
 * "Udmærkelsesfoto" and "Holdfoto") and Om os's team and kitchen (phase 14B1). Each is
 * an `image_id` and nothing else: no path, no derivative, no alt text (the library owns
 * the description, §0y). The key is **required** in every section, for the reason
 * stated at the top of this file — a section without it would shallow-merge over the
 * published section and silently drop the live photo.
 *
 * `null` is a value ("no image") and is what a pending removal stores; the public
 * read renders the reserved frame for it.
 */
const sectionImage = () => optionalRowId('Billedet')

/** How many burgers "Tre fra menuen" features (1g). */
export const FEATURED_DISH_LIMIT = 3

/**
 * Forsiden (Owner only). Design 1g / 1l; editor 1u.
 *
 * The three Forside sections are **strict objects**, not merely complete ones.
 *
 * `defineDraft` makes the top level strict — an unknown *section* is a refusal — but a
 * nested `z.object()` strips by default, so until this pass a section could carry
 * `storage_path`, `alt_text` or any other key and have it silently removed on the way
 * in. That is not the contract: the document is the Owner's own, and a key the editor
 * did not draw is a refusal wherever it appears, exactly as it is at the top level.
 * The same strictness applies on the way out (`stored`), so a section written past
 * the application — a direct write with an Owner JWT — is `malformed` in the editor and
 * `invalid_draft` at publish rather than merged with its extra key attached.
 *
 * Three literal shapes rather than a helper, so the schema reads as the document does.
 */
export const homeDraft = defineDraft({
  hero: z
    .strictObject({
      heading: optionalText(HEADING_MAX, 'Overskriften'),
      intro: optionalText(INTRO_MAX, 'Introteksten'),
      image_id: sectionImage(),
    })
    .optional(),

  award: z
    .strictObject({
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
    .strictObject({
      heading: optionalText(HEADING_MAX, 'Overskriften'),
      text: optionalText(INTRO_MAX, 'Teksten'),
      image_id: sectionImage(),
    })
    .optional(),
})

/** The Mad ud af huset editor's limits (1aj), stated once for the form and the schema. */
export const TAKEAWAY_HEADING_MAX = HEADING_MAX
export const TAKEAWAY_INTRO_MAX = INTRO_MAX
export const TAKEAWAY_CTA_MAX = 60
export const TAKEAWAY_SECTION_HEADING_MAX = HEADING_MAX
export const TAKEAWAY_SECTION_BODY_MAX = BODY_MAX
export const TAKEAWAY_SECTION_LIMIT = 20
export const TAKEAWAY_SECTION_ID_MAX = 60

/**
 * One free text section on Mad ud af huset (1ai / 1aj) — a **strict** object since
 * phase 11B. The phase-11A completion pass found that these nested objects were
 * ordinary `z.object()`s and therefore *stripped* an unknown key instead of refusing
 * it; the document contract is "refuse", at every level a browser can write, so a
 * section carrying `price`, `storage_path` or any key the editor did not draw is a
 * refusal on the way in and `malformed` / `invalid_draft` on the way out — exactly
 * as the Forside's sections are. The four keys are the seed's own (`afsnit-1`,
 * heading, body, sort); nothing historical is refused.
 */
export const takeawaySection = z.strictObject({
  id: requiredText(TAKEAWAY_SECTION_ID_MAX, 'Afsnittets id'),
  heading: optionalText(TAKEAWAY_SECTION_HEADING_MAX, 'Afsnittets overskrift'),
  body: optionalText(TAKEAWAY_SECTION_BODY_MAX, 'Afsnittets tekst'),
  sort: sortOrder,
})

/**
 * Mad ud af huset (Staff). Design 1ai / 1aj; §4's shape — `heading`, `intro`,
 * `image_id`, `sections`, `cta_label` — plus the page's visibility.
 *
 * Every key is a top-level draft field, so the phase-4 delta rule applies per key:
 * a draft holds exactly the keys that differ from the published document.
 *
 * `image_id` (phase 11B) is 1aj's "Billede (valgfrit)": the id and nothing else — no
 * path, no derivative, no alt (the library owns the description, §0y). Unlike the
 * Forside's slots it is a top-level key, so a pending selection is the key alone and
 * a cleared selection is the key's absence.
 *
 * `is_visible` (phase 11B) is 1aj's "Vis siden på hjemmesiden". 1aj states the
 * page's one process — *"alt gemmes som kladde, forhåndsvises på den rigtige side og
 * går først live ved Offentliggør"* — and the visibility is part of "alt": a draft
 * carries the pending value here, `publish_page()` moves it into the `is_visible`
 * column (it is never merged into the document), and until then a guest keeps the
 * published page and the published navigation. It is the one page-draft key that is
 * not part of the document, and the SQL merge strips it for that reason.
 */
export const takeawayDraft = defineDraft({
  heading: optionalText(TAKEAWAY_HEADING_MAX, 'Overskriften').optional(),
  intro: optionalText(TAKEAWAY_INTRO_MAX, 'Introteksten').optional(),
  image_id: optionalRowId('Billedet').optional(),

  // Free text sections, not a fixed list of packages (1ai). Adding, removing and
  // reordering is the whole editor; nothing here is a price or a delivery term.
  sections: z
    .array(takeawaySection)
    .max(TAKEAWAY_SECTION_LIMIT, { error: `Siden kan højst have ${TAKEAWAY_SECTION_LIMIT} afsnit.` })
    .optional(),

  cta_label: optionalText(TAKEAWAY_CTA_MAX, 'Knapteksten').optional(),

  is_visible: z.boolean({ error: 'Synligheden skal være til eller fra.' }).optional(),
})

/** The Om os editor's limits (1i; phase 14B1), stated once for the form and the schema. */
export const ABOUT_HEADING_MAX = HEADING_MAX
export const ABOUT_TEXT_MAX = BODY_MAX
export const ABOUT_STORY_BLOCK_LIMIT = 10

/**
 * Om os (Staff). Design 1i; the editor is phase 14B1's `/admin/om-os`.
 *
 * §4's shape — `heading`, `story_blocks []`, `team {text, image_id}`, `method {heading,
 * text, image_id}`, `venue_image_id` — and **strict at every level a browser can write**.
 * Phase 11B's completion pass recorded that `team` and `method` were still ordinary
 * `z.object()`s, stripping an unknown nested key rather than refusing it, and left the
 * closure to the phase that built 1i's editor (§0aa, §0ac). This is that phase: the two
 * sections are `z.strictObject`s on both parses, so a key the editor did not draw is a
 * refusal on the way in and `malformed` / `invalid_draft` on the way out — exactly as
 * the Forside's sections and Mad ud af huset's are.
 *
 * THE THREE PHOTOGRAPHS (phase 14B1). 1i reserves three frames — "Stedet" (the facade
 * beside the story), "Ét holdfoto — fuld bredde" (the team) and "Køkken / tilberedning"
 * (beside the method) — and §4 names their paths. The team and kitchen ids sit inside
 * their sections, so a section is whole only with its `image_id` (the top-of-file
 * rule); the facade id is a top-level key, like Mad ud af huset's, so a pending
 * selection is the key alone and a cleared one its absence. Each is an id and nothing
 * else: the library owns the description (§0y).
 *
 * §4 also listed an `award_image_id`. It is deliberately **not** here: the award band
 * on Om os states the confirmed competition result (1ab) and its photograph is the
 * Forside document's own (`home.award.image_id`, Owner); a second award source on a
 * Staff page would be two owners for one fact (§0am).
 */
export const aboutDraft = defineDraft({
  heading: optionalText(ABOUT_HEADING_MAX, 'Overskriften').optional(),

  story_blocks: z
    .array(optionalText(ABOUT_TEXT_MAX, 'Et tekstafsnit'))
    .max(ABOUT_STORY_BLOCK_LIMIT, { error: `Historien kan højst have ${ABOUT_STORY_BLOCK_LIMIT} afsnit.` })
    .optional(),

  venue_image_id: optionalRowId('Billedet af stedet').optional(),

  team: z
    .strictObject({
      text: optionalText(ABOUT_TEXT_MAX, 'Teksten om holdet'),
      image_id: sectionImage(),
    })
    .optional(),

  method: z
    .strictObject({
      heading: optionalText(ABOUT_HEADING_MAX, 'Overskriften'),
      text: optionalText(ABOUT_TEXT_MAX, 'Teksten'),
      image_id: sectionImage(),
    })
    .optional(),
})
