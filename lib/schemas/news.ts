import { z } from 'zod'

import { NEWS_SLUG_PATTERN } from '@/lib/news/slug'

import { optionalIsoDate, requiredText } from './primitives'

/**
 * News — the write-side schema (§4, §7f; phase 9A).
 *
 * News is deliberately **not** a draft spec. An article has no `draft` column: it is
 * pending while `status = 'draft'`, and an edit writes the row's own columns (§4, and
 * the phase-9A record in the technical plan). So there is nothing here for
 * `lib/schemas/define.ts` to build — what this module states is the shape of one
 * article write, parsed strictly by `lib/news/admin.ts` immediately before the INSERT
 * or UPDATE, after the form module has already mapped and worded every field-level
 * refusal. Two layers, like every other editor: this one exists so a value no current
 * form could produce — a forged POST, an older tab — is refused before it reaches a
 * query, and the database's CHECK constraints stay the final authority.
 *
 * `status`, `published_at` and `image_id` are deliberately absent. The first two move
 * only through the trusted transitions (`publish_news`, `unpublish_news`), and the
 * third is phase 10's column — an editor that cannot name it cannot clear it.
 */

/**
 * The categories the design offers, and the only ones (frames 1s and 1z draw the
 * chips; the seed's articles carry three of them). The column itself is free text with
 * no CHECK, so this enum is the application's closed set, not a restatement of one.
 */
export const NEWS_CATEGORIES = [
  'Ny burger',
  'Særlige åbningstider',
  'Lukket',
  'Arrangement',
  'Udmærkelse',
] as const

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

/** One run of text. Bold and link are legal stored shapes (§7f); the 9A editor writes neither. */
const newsSpan = z.strictObject({
  text: z.string({ error: 'Tekstindholdet er ikke gyldigt.' }).min(1),
  bold: z.literal(true).optional(),
  href: z
    .url({ protocol: /^https$/, error: 'Links i teksten skal være https-adresser.' })
    .max(2048)
    .optional(),
})

const newsParagraph = z.strictObject({
  type: z.literal('paragraph'),
  spans: z.array(newsSpan).min(1, { error: 'Et afsnit kan ikke være tomt.' }),
})

/** `news.body` — structured paragraphs, never HTML (§8), never empty. */
export const newsBodySchema = z.strictObject({
  blocks: z.array(newsParagraph).min(1, { error: 'Skriv teksten til nyheden.' }),
})

/**
 * One article write: everything the editor owns, nothing it does not. Strict, so an
 * unknown key is a refusal rather than a column reached around the editor.
 */
export const newsArticleInput = z.strictObject({
  title: requiredText(200, 'Overskriften'),
  slug: z
    .string({ error: 'Adressen er ikke gyldig.' })
    .regex(NEWS_SLUG_PATTERN, { error: 'Adressen er ikke gyldig.' })
    .max(200, { error: 'Adressen er for lang.' }),
  body: newsBodySchema,
  category: z.union([z.enum(NEWS_CATEGORIES, { error: 'Ukendt kategori.' }), z.null()]),
  display_date: optionalIsoDate('Datoen'),
})

export type NewsArticleInput = z.infer<typeof newsArticleInput>
